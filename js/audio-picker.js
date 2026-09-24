/**
 * Phonics Flash — Audio Picker & Voice Recording Modal Controller
 * ================================================================
 * Enables teachers to record their voice directly via microphone,
 * upload local audio files, paste audio URLs, or use automatic TTS.
 */

window.AudioPicker = (() => {
  let modalEl = null;
  let currentCallback = null;
  let currentWord = '';
  let currentAudio = '';
  let recorder = null;
  let recordedBlob = null;
  let timerInterval = null;
  let recordSeconds = 0;
  const activeObjectUrls = new Set();

  function trackObjectUrl(url) {
    if (url && typeof url === 'string' && url.startsWith('blob:')) {
      activeObjectUrls.add(url);
    }
    return url;
  }

  function revokeAllObjectUrls() {
    activeObjectUrls.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    });
    activeObjectUrls.clear();
  }

  function init() {
    if (modalEl) return;
    createModalDOM();
    bindEvents();
  }

  function createModalDOM() {
    modalEl = document.createElement('div');
    modalEl.id = 'audio-picker-modal';
    modalEl.className = 'modal-overlay hidden';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');

    modalEl.innerHTML = `
      <div class="modal-card audio-picker-card">
        <div class="modal-header">
          <div class="modal-title-group">
            <h2 id="audio-modal-title">Word Audio &amp; Voice</h2>
            <span class="modal-subtitle" id="audio-modal-subtitle">Word: "..."</span>
          </div>
          <button type="button" class="modal-close-btn" id="audio-picker-close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-tabs">
          <button type="button" class="modal-tab-btn active" data-tab="record">🎙️ Record Voice</button>
          <button type="button" class="modal-tab-btn" data-tab="upload">📁 Upload File</button>
          <button type="button" class="modal-tab-btn" data-tab="url">🔗 Audio URL</button>
          <button type="button" class="modal-tab-btn" data-tab="tts">🗣️ Auto TTS</button>
        </div>

        <div class="modal-body audio-picker-body">
          <!-- TAB 1: Record Voice -->
          <div class="modal-tab-content active" id="tab-audio-record">
            <div class="record-box">
              <div class="mic-status-indicator" id="mic-status-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mic-svg"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
              </div>
              <span class="record-timer" id="record-timer-display">0:00</span>
              <p class="record-prompt" id="record-prompt-text">Click "Start Recording" and pronounce the word clearly.</p>

              <div class="record-actions-row">
                <button type="button" id="start-record-btn" class="btn btn-primary btn-record">
                  <span class="record-dot"></span>
                  <span id="record-btn-text">Start Recording</span>
                </button>
              </div>

              <!-- Playback preview of recorded voice -->
              <div class="record-preview-box hidden" id="record-preview-box">
                <audio id="record-audio-player" controls class="custom-audio-player"></audio>
                <div class="record-confirm-actions">
                  <button type="button" id="confirm-record-btn" class="btn btn-primary">Save Voice Clip</button>
                  <button type="button" id="retry-record-btn" class="btn btn-secondary">Re-record</button>
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 2: Upload Audio File -->
          <div class="modal-tab-content" id="tab-audio-upload">
            <div class="drop-zone" id="audio-drop-zone">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drop-icon"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
              <p class="drop-title">Select audio file from your device</p>
              <p class="drop-subtitle">Supported formats: MP3, WAV, M4A, OGG, WebM</p>
              <input type="file" id="audio-file-input" accept="audio/*" style="display:none">
              <button type="button" class="btn btn-secondary" id="browse-audio-btn">Browse Files</button>
            </div>

            <div class="error-msg hidden" id="audio-upload-error-msg" style="margin-top:8px"></div>
            <div class="upload-preview-area hidden" id="audio-upload-preview">
              <p class="audio-filename" id="audio-filename-display">file.mp3</p>
              <audio id="upload-audio-player" controls class="custom-audio-player"></audio>
              <div class="upload-preview-actions">
                <button type="button" id="confirm-audio-upload-btn" class="btn btn-primary">Use This Audio</button>
                <button type="button" id="clear-audio-upload-btn" class="btn btn-secondary">Choose Another</button>
              </div>
            </div>
          </div>

          <!-- TAB 3: Audio URL -->
          <div class="modal-tab-content" id="tab-audio-url">
            <div class="form-group">
              <label for="direct-audio-url-input">Web Audio URL (MP3 / WAV)</label>
              <div class="url-input-row">
                <input type="url" id="direct-audio-url-input" class="search-input" placeholder="https://example.com/sound.mp3">
                <button type="button" id="test-audio-url-btn" class="btn btn-secondary">Test Audio</button>
              </div>
              <span class="field-hint">Direct link to an audio file hosted online.</span>
            </div>
            <div class="error-msg hidden" id="url-audio-error-msg" style="margin-top:8px"></div>

            <div class="url-audio-preview hidden" id="url-audio-preview">
              <audio id="url-audio-player" controls class="custom-audio-player"></audio>
            </div>

            <div class="url-actions-row">
              <button type="button" id="confirm-audio-url-btn" class="btn btn-primary">Save Audio URL</button>
            </div>
          </div>

          <!-- TAB 4: Auto TTS -->
          <div class="modal-tab-content" id="tab-audio-tts">
            <div class="tts-info-card">
              <h3>🗣️ Automatic Text-to-Speech</h3>
              <p>
                When no custom audio recording or file is set, Phonics Flash automatically pronounces the word using your configured speech engine:
              </p>
              <div class="tts-tiers-list">
                <div class="tts-tier-item">
                  <span class="tier-num">1</span>
                  <span class="tier-name">ElevenLabs Natural AI Voice</span>
                  <span class="tier-desc">If ElevenLabs key is configured in Settings.</span>
                </div>
                <div class="tts-tier-item">
                  <span class="tier-num">2</span>
                  <span class="tier-name">Browser Web Speech Synthesis</span>
                  <span class="tier-desc">Always available natively in every modern browser.</span>
                </div>
              </div>

              <div class="tts-test-row">
                <button type="button" id="test-tts-btn" class="btn btn-primary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  <span>Test TTS for "<span id="tts-word-label">word</span>"</span>
                </button>
                <button type="button" id="use-auto-tts-btn" class="btn btn-secondary">Set to Auto TTS (Clear Custom Audio)</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);
  }

  function bindEvents() {
    // Close button
    modalEl.querySelector('#audio-picker-close-btn').addEventListener('click', close);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });

    // Close on Escape key (M5)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl && !modalEl.classList.contains('hidden')) {
        close();
      }
    });

    // Tabs
    const tabBtns = modalEl.querySelectorAll('.modal-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        modalEl.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = modalEl.querySelector(`#tab-audio-${btn.dataset.tab}`);
        if (target) target.classList.add('active');
      });
    });

    // Recording logic
    const startRecordBtn = modalEl.querySelector('#start-record-btn');
    const recordBtnText = modalEl.querySelector('#record-btn-text');
    const micIndicator = modalEl.querySelector('#mic-status-icon');
    const recordTimer = modalEl.querySelector('#record-timer-display');
    const recordPrompt = modalEl.querySelector('#record-prompt-text');
    const recordPreviewBox = modalEl.querySelector('#record-preview-box');
    const recordAudioPlayer = modalEl.querySelector('#record-audio-player');
    const confirmRecordBtn = modalEl.querySelector('#confirm-record-btn');
    const retryRecordBtn = modalEl.querySelector('#retry-record-btn');

    startRecordBtn.addEventListener('click', async () => {
      if (!recorder) recorder = new MediaAPIs.MicrophoneRecorder();

      if (!recorder.isRecording) {
        startRecordBtn.disabled = true;
        recordBtnText.textContent = 'Starting...';
        try {
          await recorder.start();
          startRecordBtn.classList.add('recording');
          micIndicator.classList.add('pulse-recording');
          recordBtnText.textContent = 'Stop Recording';
          recordPrompt.textContent = 'Speaking now... click Stop when finished.';
          recordPrompt.classList.remove('error-msg');
          recordPreviewBox.classList.add('hidden');

          recordSeconds = 0;
          recordTimer.textContent = '0:00';
          timerInterval = setInterval(() => {
            recordSeconds++;
            const m = Math.floor(recordSeconds / 60);
            const s = (recordSeconds % 60).toString().padStart(2, '0');
            recordTimer.textContent = `${m}:${s}`;
          }, 1000);

        } catch (err) {
          recordPrompt.textContent = 'Microphone access failed: ' + err.message;
          recordPrompt.classList.add('error-msg');
          recordBtnText.textContent = 'Start Recording';
        } finally {
          startRecordBtn.disabled = false;
        }
      } else {
        // Stop recording
        clearInterval(timerInterval);
        startRecordBtn.disabled = true;
        recordBtnText.textContent = 'Processing...';

        try {
          recordedBlob = await recorder.stop();
          startRecordBtn.classList.remove('recording');
          micIndicator.classList.remove('pulse-recording');
          recordBtnText.textContent = 'Start Recording';
          recordPrompt.textContent = 'Recording complete. Listen or save below.';
          recordPrompt.classList.remove('error-msg');

          if (recordAudioPlayer.src && recordAudioPlayer.src.startsWith('blob:')) {
            try { URL.revokeObjectURL(recordAudioPlayer.src); } catch (_) {}
            activeObjectUrls.delete(recordAudioPlayer.src);
          }
          recordAudioPlayer.src = trackObjectUrl(URL.createObjectURL(recordedBlob));
          recordPreviewBox.classList.remove('hidden');
        } catch (err) {
          recordPrompt.textContent = 'Failed to process recording: ' + err.message;
          recordPrompt.classList.add('error-msg');
          recordBtnText.textContent = 'Start Recording';
        } finally {
          startRecordBtn.disabled = false;
        }
      }
    });

    retryRecordBtn.addEventListener('click', () => {
      if (recordAudioPlayer.src && recordAudioPlayer.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(recordAudioPlayer.src); } catch (_) {}
        activeObjectUrls.delete(recordAudioPlayer.src);
      }
      recordAudioPlayer.src = '';
      recordedBlob = null;
      recordPreviewBox.classList.add('hidden');
      recordTimer.textContent = '0:00';
      recordPrompt.textContent = 'Click "Start Recording" to re-record.';
      recordPrompt.classList.remove('error-msg');
    });

    confirmRecordBtn.addEventListener('click', async () => {
      if (!recordedBlob) return;
      confirmRecordBtn.disabled = true;
      try {
        const mediaUri = await MediaDB.saveMediaBlob(recordedBlob, 'audio');
        selectAudio(mediaUri);
      } catch (err) {
        recordPrompt.textContent = 'Failed to save audio recording: ' + err.message;
        recordPrompt.classList.add('error-msg');
      } finally {
        confirmRecordBtn.disabled = false;
      }
    });

    // Upload audio
    const browseAudioBtn = modalEl.querySelector('#browse-audio-btn');
    const audioFileInput = modalEl.querySelector('#audio-file-input');
    const audioDropZone = modalEl.querySelector('#audio-drop-zone');
    const audioUploadPreview = modalEl.querySelector('#audio-upload-preview');
    const uploadAudioPlayer = modalEl.querySelector('#upload-audio-player');
    const audioFilenameDisplay = modalEl.querySelector('#audio-filename-display');
    const confirmAudioUploadBtn = modalEl.querySelector('#confirm-audio-upload-btn');
    const clearAudioUploadBtn = modalEl.querySelector('#clear-audio-upload-btn');

    let pendingAudioBlob = null;

    browseAudioBtn.addEventListener('click', () => audioFileInput.click());
    audioFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleAudioFile(e.target.files[0]);
      }
    });

    // Drag and drop handlers for audio drop zone (H3)
    audioDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      audioDropZone.classList.add('drag-over');
    });
    audioDropZone.addEventListener('dragleave', () => audioDropZone.classList.remove('drag-over'));
    audioDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      audioDropZone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleAudioFile(e.dataTransfer.files[0]);
      }
    });

    function handleAudioFile(file) {
      const uploadErr = modalEl.querySelector('#audio-upload-error-msg');
      if (uploadErr) uploadErr.classList.add('hidden');

      if (!file) return;
      // Validate audio MIME type or extension (H4)
      const isAudioType = file.type && file.type.startsWith('audio/');
      const hasAudioExt = /\.(mp3|wav|ogg|m4a|aac|webm|flac|mp4)$/i.test(file.name || '');
      if (!isAudioType && !hasAudioExt) {
        if (uploadErr) {
          uploadErr.textContent = 'Please select a valid audio file (MP3, WAV, M4A, OGG, WebM, AAC).';
          uploadErr.classList.remove('hidden');
        }
        return;
      }

      if (uploadAudioPlayer.src && uploadAudioPlayer.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(uploadAudioPlayer.src); } catch (_) {}
        activeObjectUrls.delete(uploadAudioPlayer.src);
      }

      pendingAudioBlob = file;
      audioFilenameDisplay.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      uploadAudioPlayer.src = trackObjectUrl(URL.createObjectURL(file));
      audioDropZone.classList.add('hidden');
      audioUploadPreview.classList.remove('hidden');
    }

    confirmAudioUploadBtn.addEventListener('click', async () => {
      if (!pendingAudioBlob) return;
      const uploadErr = modalEl.querySelector('#audio-upload-error-msg');
      try {
        const mediaUri = await MediaDB.saveMediaBlob(pendingAudioBlob, 'audio');
        selectAudio(mediaUri);
      } catch (err) {
        if (uploadErr) {
          uploadErr.textContent = 'Failed to save audio file: ' + err.message;
          uploadErr.classList.remove('hidden');
        }
      }
    });

    clearAudioUploadBtn.addEventListener('click', () => {
      if (uploadAudioPlayer.src && uploadAudioPlayer.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(uploadAudioPlayer.src); } catch (_) {}
        activeObjectUrls.delete(uploadAudioPlayer.src);
      }
      uploadAudioPlayer.src = '';
      pendingAudioBlob = null;
      audioUploadPreview.classList.add('hidden');
      audioDropZone.classList.remove('hidden');
      audioFileInput.value = '';
      const uploadErr = modalEl.querySelector('#audio-upload-error-msg');
      if (uploadErr) uploadErr.classList.add('hidden');
    });

    // Audio URL
    const audioUrlInput = modalEl.querySelector('#direct-audio-url-input');
    const testAudioUrlBtn = modalEl.querySelector('#test-audio-url-btn');
    const urlAudioPreview = modalEl.querySelector('#url-audio-preview');
    const urlAudioPlayer = modalEl.querySelector('#url-audio-player');
    const confirmAudioUrlBtn = modalEl.querySelector('#confirm-audio-url-btn');

    function isValidAudioUrl(urlStr) {
      if (!urlStr || typeof urlStr !== 'string') return false;
      const trimmed = urlStr.trim();
      if (trimmed.startsWith('data:audio/')) return true;
      try {
        const parsed = new URL(trimmed, window.location.origin);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (_) {
        return false;
      }
    }

    testAudioUrlBtn.addEventListener('click', () => {
      const url = audioUrlInput.value.trim();
      const urlErr = modalEl.querySelector('#url-audio-error-msg');
      if (urlErr) urlErr.classList.add('hidden');
      if (!url) return;
      if (!isValidAudioUrl(url)) {
        if (urlErr) {
          urlErr.textContent = 'Invalid audio URL. Must start with http://, https://, or data:audio/.';
          urlErr.classList.remove('hidden');
        }
        return;
      }
      urlAudioPlayer.src = url;
      urlAudioPreview.classList.remove('hidden');
      urlAudioPlayer.play().catch(e => {
        if (urlErr) {
          urlErr.textContent = 'Audio test playback error: ' + e.message;
          urlErr.classList.remove('hidden');
        }
      });
    });

    confirmAudioUrlBtn.addEventListener('click', () => {
      const url = audioUrlInput.value.trim();
      const urlErr = modalEl.querySelector('#url-audio-error-msg');
      if (urlErr) urlErr.classList.add('hidden');
      if (!url) return;
      if (!isValidAudioUrl(url)) {
        if (urlErr) {
          urlErr.textContent = 'Invalid audio URL. Must start with http://, https://, or data:audio/.';
          urlErr.classList.remove('hidden');
        }
        return;
      }
      selectAudio(url);
    });

    // Auto TTS
    const testTtsBtn = modalEl.querySelector('#test-tts-btn');
    const useAutoTtsBtn = modalEl.querySelector('#use-auto-tts-btn');

    testTtsBtn.addEventListener('click', () => {
      if (typeof AudioPlayer !== 'undefined' && typeof AudioPlayer.playWord === 'function') {
        AudioPlayer.playWord(currentWord, null);
      } else if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(currentWord);
        u.lang = 'en-US';
        window.speechSynthesis.speak(u);
      }
    });

    useAutoTtsBtn.addEventListener('click', () => {
      selectAudio(''); // empty string means auto TTS!
    });
  }

  function selectAudio(audioUriOrUrl) {
    if (currentCallback) {
      currentCallback(audioUriOrUrl);
    }
    revokeAllObjectUrls();
    close();
  }

  function open(options = {}) {
    init();
    currentWord = options.word || '';
    currentAudio = options.currentAudio || '';
    currentCallback = options.onSelect || null;

    // Reset active tab to record (M3)
    const tabBtns = modalEl.querySelectorAll('.modal-tab-btn');
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'record'));
    modalEl.querySelectorAll('.modal-tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-audio-record'));

    modalEl.querySelector('#audio-modal-subtitle').textContent = currentWord ? `Word: "${currentWord}"` : 'Audio Settings';
    modalEl.querySelector('#tts-word-label').textContent = currentWord || 'word';

    // Reset recording state
    if (recorder && recorder.isRecording) recorder.cancel();
    if (timerInterval) clearInterval(timerInterval);
    recordedBlob = null;
    modalEl.querySelector('#record-timer-display').textContent = '0:00';
    modalEl.querySelector('#record-preview-box').classList.add('hidden');
    const startRecordBtn = modalEl.querySelector('#start-record-btn');
    startRecordBtn.disabled = false;
    startRecordBtn.classList.remove('recording');
    modalEl.querySelector('#mic-status-icon').classList.remove('pulse-recording');
    modalEl.querySelector('#record-btn-text').textContent = 'Start Recording';
    const recordPrompt = modalEl.querySelector('#record-prompt-text');
    recordPrompt.textContent = 'Click "Start Recording" and pronounce the word clearly.';
    recordPrompt.classList.remove('error-msg');

    // Reset upload area (M3)
    modalEl.querySelector('#audio-drop-zone').classList.remove('hidden');
    modalEl.querySelector('#audio-upload-preview').classList.add('hidden');
    const uploadErr = modalEl.querySelector('#audio-upload-error-msg');
    if (uploadErr) {
      uploadErr.textContent = '';
      uploadErr.classList.add('hidden');
    }
    const audioFileInput = modalEl.querySelector('#audio-file-input');
    if (audioFileInput) audioFileInput.value = '';

    // Reset URL preview area (M3)
    modalEl.querySelector('#url-audio-preview').classList.add('hidden');
    const urlErr = modalEl.querySelector('#url-audio-error-msg');
    if (urlErr) {
      urlErr.textContent = '';
      urlErr.classList.add('hidden');
    }

    // Prepopulate URL if current audio is an external URL
    const urlInput = modalEl.querySelector('#direct-audio-url-input');
    if (currentAudio && !MediaDB.isMediaId(currentAudio) && !currentAudio.startsWith('media/')) {
      const mediaBase = typeof SharedClassSync !== 'undefined' ? SharedClassSync.getMediaBase() : 'https://all-english-media.allenglish.link';
      urlInput.value = currentAudio.replace(/^https?:\/\/all-english-media\.netlify\.app\/?/, `${mediaBase}/`);
    } else {
      urlInput.value = '';
    }

    modalEl.classList.remove('hidden');
  }

  function close() {
    if (recorder && recorder.isRecording) recorder.cancel();
    if (timerInterval) clearInterval(timerInterval);
    revokeAllObjectUrls();

    // Pause and reset all audio players (M1)
    const recordAudio = modalEl?.querySelector('#record-audio-player');
    if (recordAudio) {
      recordAudio.pause();
      recordAudio.currentTime = 0;
      recordAudio.src = '';
    }
    const uploadAudio = modalEl?.querySelector('#upload-audio-player');
    if (uploadAudio) {
      uploadAudio.pause();
      uploadAudio.currentTime = 0;
      uploadAudio.src = '';
    }
    const urlAudio = modalEl?.querySelector('#url-audio-player');
    if (urlAudio) {
      urlAudio.pause();
      urlAudio.currentTime = 0;
      urlAudio.src = '';
    }

    if (modalEl) modalEl.classList.add('hidden');
    currentCallback = null;
  }

  return {
    init,
    open,
    close
  };
})();
