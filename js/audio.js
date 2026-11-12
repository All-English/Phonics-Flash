/**
 * Audio Playback Module
 * =====================
 * Three-tier fallback chain:
 *   1. Local MP3 file (if audio path exists in word data)
 *   2. ElevenLabs TTS (if API key configured, random voice)
 *   3. Web Speech API (browser built-in, always available)
 *
 * Caches ElevenLabs audio blobs per word for instant replay.
 */
const AudioPlayer = (() => {
  const cache = new Map(); // ElevenLabs blob cache
  const audioCache = new Map(); // local Audio elements cache
  const wordVoicePools = new Map(); // Exhaustion pools per word: wordKey -> { candidatesKey, pool, lastPlayed }
  let currentAudio = null;
  let isPlaying = false; // Declared module-scoped variable (High #1)
  const STORAGE_KEY = 'phonics-flash-elevenlabs-key';
  const VOICE_STORAGE_KEY = 'phonics-flash-elevenlabs-voice';
  const SPEED_STORAGE_KEY = 'phonics-flash-elevenlabs-speed';

  function getApiKey() {
    if (typeof window !== 'undefined' && window.SharedClassSync?.getSharedApiKey) {
      const shared = window.SharedClassSync.getSharedApiKey();
      if (shared) return shared;
    }
    return localStorage.getItem(STORAGE_KEY)?.trim() || localStorage.getItem('elevenlabs_api_key')?.trim() || null;
  }

  function getSelectedVoiceId() {
    return localStorage.getItem(VOICE_STORAGE_KEY)?.trim() || '';
  }

  function getPlaybackSpeed() {
    const val = parseFloat(localStorage.getItem(SPEED_STORAGE_KEY));
    if (!isNaN(val) && val >= 0.5 && val <= 2.0) {
      return val;
    }
    return 0.85; // Default to 0.85x
  }

  function getWordPoolKey(word) {
    return String(word || '').trim().toLowerCase();
  }

  function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Resets all word voice exhaustion pools so subsequent plays start a fresh cycle.
   */
  function resetWordVoicePools() {
    wordVoicePools.clear();
  }

  /**
   * Selects the next audio URL for a word using an exhaustion pool (deal without replacement).
   * Ensures every voice variant is heard before any voice repeats, and avoids back-to-back
   * repeats across cycle boundaries.
   * @param {string} word - The word being spoken
   * @param {string[]} candidates - Available candidate URLs
   * @returns {string} The chosen audio URL
   */
  function getNextExhaustiveVoice(word, candidates) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const key = getWordPoolKey(word);
    let entry = wordVoicePools.get(key);

    // Validate that existing entry matches the current candidates set
    const candidatesKey = candidates.map(c => String(c).trim()).sort().join('|');
    if (!entry || entry.candidatesKey !== candidatesKey) {
      entry = {
        candidatesKey,
        pool: shuffle(candidates),
        lastPlayed: null
      };
      wordVoicePools.set(key, entry);
    }

    // If pool has been exhausted, refill with all candidates shuffled
    if (entry.pool.length === 0) {
      entry.pool = shuffle(candidates);
      // Avoid back-to-back duplicate across cycle boundaries if > 1 option
      if (entry.pool.length > 1 && entry.pool[0] === entry.lastPlayed) {
        const swapIdx = Math.floor(Math.random() * (entry.pool.length - 1)) + 1;
        [entry.pool[0], entry.pool[swapIdx]] = [entry.pool[swapIdx], entry.pool[0]];
      }
    }

    const chosen = entry.pool.shift();
    entry.lastPlayed = chosen;
    return chosen;
  }

  /**
   * Preload a single audio URL or path into audioCache.
   * Sets preload = 'auto' and triggers buffering.
   * @param {string} url - Audio path or URL
   * @param {string} [aliasKey] - Optional secondary lookup key (e.g. original un-resolved path)
   */
  async function preloadSingle(url, aliasKey = null) {
    if (!url || typeof url !== 'string') return;
    const pathKey = url.trim();
    if (!pathKey) return;

    if (audioCache.has(pathKey)) {
      if (aliasKey && typeof aliasKey === 'string' && !audioCache.has(aliasKey.trim())) {
        audioCache.set(aliasKey.trim(), audioCache.get(pathKey));
      }
      return;
    }

    let effectiveUrl = pathKey;
    if (typeof MediaDB !== 'undefined' && MediaDB.isMediaId(pathKey)) {
      try {
        effectiveUrl = await MediaDB.resolveMediaUrl(pathKey);
        if (!effectiveUrl) return;
      } catch (e) {
        return;
      }
    }

    try {
      const audio = new Audio(effectiveUrl);
      audio.preload = 'auto';
      audio.addEventListener('ended', () => {
        if (currentAudio === audio) {
          setButtonState(document.getElementById('chrome-audio'), 'idle');
          currentAudio = null;
          isPlaying = false;
        }
      });
      audio.load();
      audioCache.set(pathKey, audio);
      if (effectiveUrl !== pathKey) {
        audioCache.set(effectiveUrl, audio);
      }
      if (aliasKey && typeof aliasKey === 'string') {
        audioCache.set(aliasKey.trim(), audio);
      }
    } catch (e) {
      console.warn('[AudioPlayer] Preload error for:', effectiveUrl, e);
    }
  }

  /**
   * Preload audio files for instant playback. Supports path, array of paths, and word.
   * When word is provided, resolves and preloads all voice variants (official + 3 AI voices).
   * @param {string|string[]} [audioPath] - Path, media URI, or array of paths
   * @param {string} [word] - Optional word string to resolve multi-voice candidates
   */
  async function preload(audioPath, word) {
    if (!audioPath && !word) return;

    if (Array.isArray(audioPath)) {
      audioPath.forEach(p => preload(p, word));
      return;
    }
    if (typeof audioPath === 'string' && audioPath.startsWith('[') && audioPath.endsWith(']')) {
      try {
        const parsed = JSON.parse(audioPath);
        if (Array.isArray(parsed)) {
          parsed.forEach(p => preload(p, word));
          return;
        }
      } catch (e) {}
    }

    const isCustomMedia = typeof MediaDB !== 'undefined' && MediaDB.isMediaId(audioPath);
    const isSingleLetter = String(word || '').trim().length <= 1;

    // If word is provided and not single letter, resolve all voice candidates
    if (!isCustomMedia && !isSingleLetter && word && typeof window !== 'undefined' && window.SharedClassSync?.getWordAudioUrls) {
      try {
        const mode = (localStorage.getItem('word_voice_mode') || 'mixed').toLowerCase();
        const candidateUrls = window.SharedClassSync.getWordAudioUrls(word, { officialUrl: audioPath, mode });
        if (candidateUrls && candidateUrls.length > 0) {
          candidateUrls.forEach(url => preloadSingle(url, audioPath));
          return;
        }
      } catch (e) {
        console.warn('[AudioPlayer] Error resolving voice candidate URLs:', e);
      }
    }

    if (audioPath) {
      preloadSingle(audioPath);
    }
  }

  /**
   * Play a word using the fallback chain.
   * @param {string} word - The word to speak
   * @param {string} [audioPath] - Optional path to an MP3 file
   * @returns {Promise<void>}
   */
  async function playWord(word, audioPath) {
    // Stop any currently playing audio
    stop();

    const btn = document.getElementById('chrome-audio');

    try {
      setButtonState(btn, 'loading');

      // 1. Try local/CDN MP3 file or MediaDB audio recording (supports multi-voice modes and random choice)
      let selectedPath = audioPath;
      const isCustomMedia = typeof MediaDB !== 'undefined' && MediaDB.isMediaId(selectedPath);
      const isSingleLetter = String(word || '').trim().length <= 1;

      if (!isCustomMedia && !isSingleLetter && typeof window !== 'undefined' && window.SharedClassSync?.getWordAudioUrls) {
        const mode = (localStorage.getItem('word_voice_mode') || 'mixed').toLowerCase();
        const candidateUrls = window.SharedClassSync.getWordAudioUrls(word, { officialUrl: selectedPath, mode });
        if (candidateUrls && candidateUrls.length > 0) {
          selectedPath = getNextExhaustiveVoice(word, candidateUrls);
        }
      } else if (Array.isArray(audioPath)) {
        selectedPath = audioPath.length > 0 ? getNextExhaustiveVoice(word || 'array_audio', audioPath) : null;
      } else if (typeof audioPath === 'string' && audioPath.startsWith('[') && audioPath.endsWith(']')) {
        try {
          const parsed = JSON.parse(audioPath);
          if (Array.isArray(parsed) && parsed.length > 0) {
            selectedPath = getNextExhaustiveVoice(word || 'parsed_audio', parsed);
          }
        } catch (e) {}
      }

      let effectiveAudio = selectedPath;
      if (typeof MediaDB !== 'undefined' && MediaDB.isMediaId(selectedPath)) {
        try {
          effectiveAudio = await MediaDB.resolveMediaUrl(selectedPath);
        } catch (e) {
          console.warn('[AudioPlayer] Could not resolve media audio:', e);
        }
      }

      if (effectiveAudio) {
        const played = await tryPlayMP3(effectiveAudio);
        if (played) {
          setButtonState(btn, 'playing');
          return;
        }
      }

      // 2. Try ElevenLabs TTS (strictly from localStorage)
      const apiKey = getApiKey();
      if (apiKey) {
        const played = await tryPlayElevenLabs(word);
        if (played) {
          setButtonState(btn, 'playing');
          return;
        }
      }

      // 3. Fall back to Web Speech API
      playWithSpeechSynthesis(word);
      setButtonState(btn, 'playing');

    } catch (err) {
      console.error('Audio playback error:', err);
      setButtonState(btn, 'idle');
    }
  }

  /**
   * Attempt to play a local MP3 file.
   */
  async function tryPlayMP3(audioPath) {
    return new Promise((resolve) => {
      const pathKey = audioPath.trim();
      let audio = audioCache.get(pathKey);
      if (!audio) {
        audio = new Audio(pathKey);
        audio.preload = 'auto';
        audio.addEventListener('ended', () => {
          if (currentAudio === audio) {
            setButtonState(document.getElementById('chrome-audio'), 'idle');
            currentAudio = null;
            isPlaying = false;
          }
        });
        audioCache.set(pathKey, audio);
      }
      currentAudio = audio;

      try {
        audio.playbackRate = getPlaybackSpeed();
      } catch (e) {}

      if (audio.readyState >= 2) {
        audio.currentTime = 0;
        audio.play()
          .then(() => {
            isPlaying = true;
            resolve(true);
          })
          .catch((err) => {
            console.error('Preloaded audio playback failed:', err);
            resolve(false);
          });
      } else {
        const onCanPlay = () => {
          audio.currentTime = 0;
          audio.play()
            .then(() => {
              isPlaying = true;
              resolve(true);
            })
            .catch(() => resolve(false));
          cleanup();
        };

        const onError = () => {
          console.warn(`MP3 not found or unplayable: ${audioPath}`);
          currentAudio = null;
          resolve(false);
          cleanup();
        };

        const cleanup = () => {
          audio.removeEventListener('canplay', onCanPlay);
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
        };

        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('canplaythrough', onCanPlay);
        audio.addEventListener('error', onError);
        audio.load();

        // Timeout if file takes too long
        setTimeout(() => {
          if (audio.readyState < 2) {
            cleanup();
            currentAudio = null;
            resolve(false);
          }
        }, 3000);
      }
    });
  }

  /**
   * Attempt to play using ElevenLabs TTS API.
   * Caches audio blobs per word.
   */
  async function tryPlayElevenLabs(word) {
    try {
      const apiKey = getApiKey();
      if (!apiKey) return false;

      const cacheKey = word.toLowerCase().trim();

      let blob = cache.get(cacheKey);

      if (!blob) {
        const voices = (typeof ELEVENLABS_CONFIG !== 'undefined' && ELEVENLABS_CONFIG.voices) || [];
        const preferredVoiceId = getSelectedVoiceId();
        let voiceId = preferredVoiceId;

        if (!voiceId) {
          const voice = voices.length > 0
            ? voices[Math.floor(Math.random() * voices.length)]
            : { voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica (Default)' };
          voiceId = voice.voice_id || 'cgSgspJ2msm6clMCkdW9';
        }

        const modelId = (typeof ELEVENLABS_CONFIG !== 'undefined' && ELEVENLABS_CONFIG.modelId) || 'eleven_v4_turbo';

        const currentSpeed = getPlaybackSpeed();

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': apiKey
            },
            body: JSON.stringify({
              text: word,
              model_id: modelId,
              voice_settings: {
                speed: currentSpeed,
                stability: 0.5,
                similarity_boost: 0.75
              }
            })
          }
        );

        if (!response.ok) {
          console.error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
          if (typeof window.showToast === 'function') {
            if (response.status === 401) {
              window.showToast('ElevenLabs: Invalid API Key (401)', 'error');
            } else if (response.status === 429) {
              window.showToast('ElevenLabs: Quota Exceeded (429)', 'error');
            } else {
              window.showToast(`ElevenLabs API Error: ${response.status}`, 'error');
            }
          }
          return false;
        }

        blob = await response.blob();
        cache.set(cacheKey, blob);
      }

      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      currentAudio = audio;

      audio.addEventListener('ended', () => {
        setButtonState(document.getElementById('chrome-audio'), 'idle');
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        isPlaying = false;
      }, { once: true });

      await audio.play();
      isPlaying = true;
      return true;

    } catch (err) {
      console.error('ElevenLabs playback failed:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('ElevenLabs request failed (network or CORS error)', 'error');
      }
      return false;
    }
  }

  /**
   * Test an ElevenLabs API key directly with a sample word.
   * Plays the result and returns true on success or throws an Error.
   * @param {string} testKey
   * @param {string} [voiceId]
   * @param {string} [word]
   * @param {number} [customSpeed]
   * @returns {Promise<boolean>}
   */
  async function testElevenLabs(testKey, voiceId, word = 'phonics', customSpeed = null) {
    const key = (testKey || getApiKey() || '').trim();
    if (!key) {
      throw new Error('Please enter an ElevenLabs API key first.');
    }

    const targetVoiceId = voiceId || getSelectedVoiceId() || 'cgSgspJ2msm6clMCkdW9'; // Jessica default
    const modelId = (typeof ELEVENLABS_CONFIG !== 'undefined' && ELEVENLABS_CONFIG.modelId) || 'eleven_v4_turbo';
    const testSpeed = typeof customSpeed === 'number' ? customSpeed : getPlaybackSpeed();

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': key
        },
        body: JSON.stringify({
          text: word,
          model_id: modelId,
          voice_settings: {
            speed: testSpeed,
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid API Key (401). Please check your key.');
      } else if (response.status === 429) {
        throw new Error('Quota Exceeded (429). Your ElevenLabs credits may be depleted.');
      } else {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
    }

    const blob = await response.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    stop();
    currentAudio = audio;
    await audio.play();
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) currentAudio = null;
    }, { once: true });

    return true;
  }

  /**
   * Play using the browser's built-in Web Speech API.
   */
  function playWithSpeechSynthesis(word) {
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = getPlaybackSpeed(); // Use user-selected speed (default 0.85)
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Try to find a good English voice
    const voices = speechSynthesis.getVoices();
    const englishVoice = voices.find(v => v.lang === 'en-US' && v.localService) ||
                         voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    utterance.addEventListener('end', () => {
      setButtonState(document.getElementById('chrome-audio'), 'idle');
      isPlaying = false;
    });

    speechSynthesis.speak(utterance);
    isPlaying = true;
  }

  /**
   * Stop any currently playing audio.
   */
  function stop() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (e) {}
      currentAudio = null;
    }
    // Also pause and reset ALL cached audio elements so multiple sounds can never overlap
    audioCache.forEach(audio => {
      if (audio && !audio.paused) {
        try {
          audio.pause();
          audio.currentTime = 0;
        } catch (e) {}
      }
    });
    speechSynthesis.cancel();
    isPlaying = false;

    const btn = document.getElementById('chrome-audio');
    setButtonState(btn, 'idle');
  }

  /**
   * Update the audio button visual state.
   */
  function setButtonState(btn, state) {
    if (!btn) return;
    btn.classList.remove('loading', 'playing');
    if (state === 'loading') btn.classList.add('loading');
    if (state === 'playing') btn.classList.add('playing');
  }

  /**
   * Clear the audio cache (e.g., when resetting TTS settings or changing books).
   * @param {boolean} [clearAudioElements=false] - Whether to also purge preloaded MP3 HTMLAudioElement cache.
   */
  function clearCache(clearAudioElements = false) {
    cache.clear();
    if (clearAudioElements) {
      audioCache.clear();
      resetWordVoicePools();
    }
  }

  // Pre-load Web Speech API voices
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.getVoices();
    speechSynthesis.addEventListener('voiceschanged', () => {
      speechSynthesis.getVoices();
    });
  }

  return {
    playWord,
    stop,
    preload,
    clearCache,
    resetWordVoicePools,
    getNextExhaustiveVoice,
    getApiKey,
    getSelectedVoiceId,
    getPlaybackSpeed,
    testElevenLabs,
    get isPlaying() { return isPlaying; }
  };
})();
