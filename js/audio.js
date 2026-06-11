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
  let currentAudio = null;
  let isPlaying = false;

  /**
   * Preload a local MP3 file.
   * @param {string} audioPath - Path to the MP3 file
   */
  function preload(audioPath) {
    if (!audioPath) return;
    const pathKey = audioPath.trim();
    if (audioCache.has(pathKey)) return;

    const audio = new Audio(pathKey);
    audio.addEventListener('ended', () => {
      if (currentAudio === audio) {
        setButtonState(document.getElementById('chrome-audio'), 'idle');
        currentAudio = null;
        isPlaying = false;
      }
    });
    audio.load();
    audioCache.set(pathKey, audio);
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

      // 1. Try local MP3 file
      if (audioPath) {
        const played = await tryPlayMP3(audioPath);
        if (played) {
          setButtonState(btn, 'playing');
          return;
        }
      }

      // 2. Try ElevenLabs TTS
      const apiKey = typeof ELEVENLABS_CONFIG !== 'undefined' ? ELEVENLABS_CONFIG.apiKey?.trim() : null;
      if (apiKey && apiKey !== 'your-api-key-here') {
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

      if (audio.readyState >= 3) {
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
          audio.removeEventListener('canplaythrough', onCanPlay);
          audio.removeEventListener('error', onError);
        };

        audio.addEventListener('canplaythrough', onCanPlay);
        audio.addEventListener('error', onError);
        audio.load();

        // Timeout if file takes too long
        setTimeout(() => {
          if (audio.readyState < 3) {
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
      const cacheKey = word.toLowerCase().trim();

      let blob = cache.get(cacheKey);

      if (!blob) {
        // Pick a random voice, fallback to a hardcoded default if list is empty
        const voices = ELEVENLABS_CONFIG.voices || [];
        const voice = voices.length > 0
          ? voices[Math.floor(Math.random() * voices.length)]
          : { voice_id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica (Default)' };
        
        const voiceId = voice.voice_id || 'cgSgspJ2msm6clMCkdW9';

        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': ELEVENLABS_CONFIG.apiKey
            },
            body: JSON.stringify({
              text: word,
              model_id: ELEVENLABS_CONFIG.modelId || 'eleven_flash_v2',
              voice_settings: {
                speed: 0.85,
                stability: 0.85,
                similarity_boost: 0.80
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
   * Play using the browser's built-in Web Speech API.
   */
  function playWithSpeechSynthesis(word) {
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.8;  // Slower for ESL learners
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
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
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
   * Clear the audio cache (e.g., when returning to menu).
   */
  function clearCache() {
    cache.clear();
    audioCache.clear();
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
    get isPlaying() { return isPlaying; }
  };
})();
