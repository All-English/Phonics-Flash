/**
 * Phonics Flash — Image Picker Modal Controller
 * ==============================================
 * Provides a unified tabbed modal to select, upload, search,
 * or AI-generate flashcard images.
 */

window.ImagePicker = (() => {
  let modalEl = null;
  let currentCallback = null;
  let currentWord = '';
  let activeTab = 'clipart';
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
    modalEl.id = 'image-picker-modal';
    modalEl.className = 'modal-overlay hidden';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');

    modalEl.innerHTML = `
      <div class="modal-card image-picker-card">
        <div class="modal-header">
          <div class="modal-title-group">
            <h2 id="image-modal-title">Choose Flashcard Image</h2>
            <span class="modal-subtitle" id="image-modal-subtitle">Word: "..."</span>
          </div>
          <button type="button" class="modal-close-btn" id="image-picker-close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-tabs">
          <button type="button" class="modal-tab-btn active" data-tab="clipart">🎨 Clipart (Free)</button>
          <button type="button" class="modal-tab-btn" data-tab="ai">🤖 AI Generator</button>
          <button type="button" class="modal-tab-btn" data-tab="pixabay">📸 Pixabay</button>
          <button type="button" class="modal-tab-btn" data-tab="unsplash">📷 Unsplash</button>
          <button type="button" class="modal-tab-btn" data-tab="upload">📁 Upload File</button>
          <button type="button" class="modal-tab-btn" data-tab="url">🔗 Image URL</button>
        </div>

        <div class="modal-body image-picker-body">
          <!-- TAB 1: Clipart (Free) -->
          <div class="modal-tab-content active" id="tab-clipart">
            <div class="search-bar-row">
              <input type="text" id="clipart-search-input" class="search-input" placeholder="Search clipart (e.g. apple, cat, sun)...">
              <button type="button" id="clipart-search-btn" class="btn btn-primary">Search</button>
            </div>
            <div class="search-results-container" id="clipart-results">
              <div class="empty-state">Type a word to search educational clipart (100% free, no API key needed).</div>
            </div>
          </div>

          <!-- TAB 2: AI Generator -->
          <div class="modal-tab-content" id="tab-ai">
            <div class="ai-controls-box">
              <div class="form-group">
                <label for="ai-prompt-input">Flashcard Art Prompt</label>
                <textarea id="ai-prompt-input" rows="2" class="form-textarea" placeholder="Prompt for image..."></textarea>
              </div>

              <div class="ai-provider-row">
                <label class="radio-chip">
                  <input type="radio" name="ai-engine" value="pollinations" checked>
                  <span>⚡ Instant Free AI (No key needed)</span>
                </label>
                <label class="radio-chip">
                  <input type="radio" name="ai-engine" value="imagen">
                  <span>✨ Google Imagen 3 (Gemini Key)</span>
                </label>
              </div>

              <div class="ai-actions-row">
                <button type="button" id="ai-generate-btn" class="btn btn-primary">✨ Generate Image</button>
                <button type="button" id="ai-reset-prompt-btn" class="btn btn-secondary">Reset Prompt</button>
              </div>
            </div>

            <div class="ai-preview-container" id="ai-preview-area">
              <div class="empty-state">Click "Generate Image" to create custom cartoon flashcard artwork.</div>
            </div>
          </div>

          <!-- TAB 3: Pixabay -->
          <div class="modal-tab-content" id="tab-pixabay">
            <div class="api-key-banner" id="pixabay-key-banner">
              <input type="password" id="pixabay-key-input" class="key-inline-input" placeholder="Paste Pixabay API Key (Optional)">
              <button type="button" id="save-pixabay-key-btn" class="btn btn-secondary btn-sm">Save Key</button>
            </div>
            <div class="search-bar-row">
              <input type="text" id="pixabay-search-input" class="search-input" placeholder="Search Pixabay photos & illustrations...">
              <button type="button" id="pixabay-search-btn" class="btn btn-primary">Search</button>
            </div>
            <div class="search-results-container" id="pixabay-results">
              <div class="empty-state">Enter a Pixabay API key above to search millions of royalty-free images.</div>
            </div>
          </div>

          <!-- TAB 4: Unsplash -->
          <div class="modal-tab-content" id="tab-unsplash">
            <div class="api-key-banner" id="unsplash-key-banner">
              <input type="password" id="unsplash-key-input" class="key-inline-input" placeholder="Paste Unsplash Access Key (Optional)">
              <button type="button" id="save-unsplash-key-btn" class="btn btn-secondary btn-sm">Save Key</button>
            </div>
            <div class="search-bar-row">
              <input type="text" id="unsplash-search-input" class="search-input" placeholder="Search Unsplash photos...">
              <button type="button" id="unsplash-search-btn" class="btn btn-primary">Search</button>
            </div>
            <div class="search-results-container" id="unsplash-results">
              <div class="empty-state">Enter an Unsplash Access Key above to search photos.</div>
            </div>
          </div>

          <!-- TAB 5: Upload File -->
          <div class="modal-tab-content" id="tab-upload">
            <div class="drop-zone" id="image-drop-zone">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drop-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <p class="drop-title">Drag &amp; drop an image file here</p>
              <p class="drop-subtitle">or click to browse from your device (PNG, JPG, WebP, GIF)</p>
              <input type="file" id="image-file-input" accept="image/*" style="display:none">
              <button type="button" class="btn btn-secondary" id="browse-image-btn">Browse Device</button>
            </div>
            <div class="error-msg hidden" id="upload-error-msg" style="margin-top:8px"></div>
            <div class="upload-preview-area hidden" id="upload-preview-container">
              <img id="upload-preview-img" src="" alt="Upload preview">
              <div class="upload-preview-actions">
                <button type="button" id="confirm-upload-btn" class="btn btn-primary">Use This Image</button>
                <button type="button" id="clear-upload-btn" class="btn btn-secondary">Choose Another</button>
              </div>
            </div>
          </div>

          <!-- TAB 6: Direct URL -->
          <div class="modal-tab-content" id="tab-url">
            <div class="form-group">
              <label for="direct-url-input">Direct Image URL</label>
              <div class="url-input-row">
                <input type="url" id="direct-url-input" class="search-input" placeholder="https://example.com/image.jpg">
                <button type="button" id="preview-url-btn" class="btn btn-secondary">Preview</button>
              </div>
              <span class="field-hint">Paste any HTTPS image link on the web.</span>
            </div>
            <div class="url-preview-area" id="url-preview-area">
              <div class="empty-state">Paste a URL above and click "Preview".</div>
            </div>
            <div class="url-actions-row hidden" id="url-actions-row">
              <button type="button" id="confirm-url-btn" class="btn btn-primary">Use This Image</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalEl);
  }

  function bindEvents() {
    // Close button
    modalEl.querySelector('#image-picker-close-btn').addEventListener('click', close);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) close();
    });

    // Close on Escape key (M5)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl && !modalEl.classList.contains('hidden')) {
        close();
      }
    });

    // Tab switching
    const tabBtns = modalEl.querySelectorAll('.modal-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        modalEl.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        activeTab = btn.dataset.tab;
        const target = modalEl.querySelector(`#tab-${activeTab}`);
        if (target) target.classList.add('active');
      });
    });

    // Clipart search
    const clipartInput = modalEl.querySelector('#clipart-search-input');
    const clipartBtn = modalEl.querySelector('#clipart-search-btn');
    clipartBtn.addEventListener('click', () => runClipartSearch(clipartInput.value));
    clipartInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runClipartSearch(clipartInput.value);
    });

    // AI Generate
    const aiBtn = modalEl.querySelector('#ai-generate-btn');
    const aiPromptInput = modalEl.querySelector('#ai-prompt-input');
    const aiResetPromptBtn = modalEl.querySelector('#ai-reset-prompt-btn');

    aiResetPromptBtn.addEventListener('click', () => {
      aiPromptInput.value = MediaAPIs.getFlashcardPrompt(currentWord);
    });
    aiBtn.addEventListener('click', runAIGeneration);

    // Pixabay search & key (non-blocking visual confirmation - M4)
    const pixabayKeyInput = modalEl.querySelector('#pixabay-key-input');
    const savePixabayBtn = modalEl.querySelector('#save-pixabay-key-btn');
    savePixabayBtn.addEventListener('click', () => {
      MediaAPIs.setPixabayKey(pixabayKeyInput.value);
      const orig = savePixabayBtn.textContent;
      savePixabayBtn.textContent = '✓ Saved!';
      setTimeout(() => { savePixabayBtn.textContent = orig; }, 2000);
    });
    const pixabayBtn = modalEl.querySelector('#pixabay-search-btn');
    const pixabayInput = modalEl.querySelector('#pixabay-search-input');
    pixabayBtn.addEventListener('click', () => runPixabaySearch(pixabayInput.value));
    pixabayInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runPixabaySearch(pixabayInput.value);
    });

    // Unsplash search & key (non-blocking visual confirmation - M4)
    const unsplashKeyInput = modalEl.querySelector('#unsplash-key-input');
    const saveUnsplashBtn = modalEl.querySelector('#save-unsplash-key-btn');
    saveUnsplashBtn.addEventListener('click', () => {
      MediaAPIs.setUnsplashKey(unsplashKeyInput.value);
      const orig = saveUnsplashBtn.textContent;
      saveUnsplashBtn.textContent = '✓ Saved!';
      setTimeout(() => { saveUnsplashBtn.textContent = orig; }, 2000);
    });
    const unsplashBtn = modalEl.querySelector('#unsplash-search-btn');
    const unsplashInput = modalEl.querySelector('#unsplash-search-input');
    unsplashBtn.addEventListener('click', () => runUnsplashSearch(unsplashInput.value));
    unsplashInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runUnsplashSearch(unsplashInput.value);
    });

    // Upload file
    const dropZone = modalEl.querySelector('#image-drop-zone');
    const fileInput = modalEl.querySelector('#image-file-input');
    const browseBtn = modalEl.querySelector('#browse-image-btn');

    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleImageFile(e.target.files[0]);
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleImageFile(e.dataTransfer.files[0]);
      }
    });

    // Direct URL
    const urlInput = modalEl.querySelector('#direct-url-input');
    const urlPreviewBtn = modalEl.querySelector('#preview-url-btn');
    const confirmUrlBtn = modalEl.querySelector('#confirm-url-btn');

    urlPreviewBtn.addEventListener('click', () => previewDirectUrl(urlInput.value));
    confirmUrlBtn.addEventListener('click', () => {
      if (urlInput.value.trim()) {
        selectImage(urlInput.value.trim());
      }
    });
  }

  // ── Actions ──────────────────────────────────────────────────
  async function runClipartSearch(query) {
    const container = modalEl.querySelector('#clipart-results');
    container.innerHTML = '<div class="loading-spinner-box">Searching free clipart...</div>';

    try {
      const results = await MediaAPIs.searchClipart(query);
      if (results.length === 0) {
        container.innerHTML = '<div class="empty-state">No clipart found for "' + escapeHtml(query) + '". Try a different keyword.</div>';
        return;
      }
      renderImageGrid(results, container);
    } catch (e) {
      container.innerHTML = `<div class="error-msg">Clipart search failed: ${e.message}</div>`;
    }
  }

  async function runPixabaySearch(query) {
    const container = modalEl.querySelector('#pixabay-results');
    const key = MediaAPIs.getPixabayKey();
    if (!key) {
      container.innerHTML = '<div class="empty-state">Please enter your free Pixabay API key above to search.</div>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner-box">Searching Pixabay...</div>';
    try {
      const results = await MediaAPIs.searchPixabay(query, key);
      if (results.length === 0) {
        container.innerHTML = '<div class="empty-state">No results found for "' + escapeHtml(query) + '".</div>';
        return;
      }
      renderImageGrid(results, container);
    } catch (e) {
      container.innerHTML = `<div class="error-msg">Pixabay error: ${e.message}</div>`;
    }
  }

  async function runUnsplashSearch(query) {
    const container = modalEl.querySelector('#unsplash-results');
    const key = MediaAPIs.getUnsplashKey();
    if (!key) {
      container.innerHTML = '<div class="empty-state">Please enter your Unsplash Access Key above to search.</div>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner-box">Searching Unsplash...</div>';
    try {
      const results = await MediaAPIs.searchUnsplash(query, key);
      if (results.length === 0) {
        container.innerHTML = '<div class="empty-state">No results found for "' + escapeHtml(query) + '".</div>';
        return;
      }
      renderImageGrid(results, container);
    } catch (e) {
      container.innerHTML = `<div class="error-msg">Unsplash error: ${e.message}</div>`;
    }
  }

  async function runAIGeneration() {
    const area = modalEl.querySelector('#ai-preview-area');
    const promptInput = modalEl.querySelector('#ai-prompt-input');
    const engineRadio = modalEl.querySelector('input[name="ai-engine"]:checked');
    const engine = engineRadio ? engineRadio.value : 'pollinations';
    const prompt = promptInput.value.trim() || MediaAPIs.getFlashcardPrompt(currentWord);

    area.innerHTML = '<div class="loading-spinner-box">🎨 Generating artwork with AI... this may take 4-8 seconds.</div>';

    try {
      let blob = null;
      let displayUrl = '';

      if (engine === 'imagen') {
        blob = await MediaAPIs.generateGoogleImagen(prompt);
        displayUrl = trackObjectUrl(URL.createObjectURL(blob));
      } else {
        // Pollinations (H1: fetch blob once and create preview from same blob)
        blob = await MediaAPIs.fetchPollinationsImage(prompt);
        displayUrl = trackObjectUrl(URL.createObjectURL(blob));
      }

      area.innerHTML = `
        <div class="ai-result-box">
          <img src="${displayUrl}" alt="AI artwork" class="ai-generated-img">
          <div class="ai-result-actions">
            <button type="button" class="btn btn-primary" id="use-ai-img-btn">Use This Image</button>
            <button type="button" class="btn btn-secondary" id="regen-ai-img-btn">Regenerate</button>
          </div>
        </div>
      `;

      area.querySelector('#use-ai-img-btn').addEventListener('click', async () => {
        // Save to MediaDB
        if (blob) {
          const mediaUri = await MediaDB.saveMediaBlob(blob, 'img');
          selectImage(mediaUri);
        } else {
          selectImage(displayUrl);
        }
      });

      area.querySelector('#regen-ai-img-btn').addEventListener('click', runAIGeneration);

    } catch (e) {
      area.innerHTML = `<div class="error-msg">Generation failed: ${e.message}</div>`;
    }
  }

  let pendingUploadBlob = null;
  function handleImageFile(file) {
    const uploadErr = modalEl.querySelector('#upload-error-msg');
    if (uploadErr) uploadErr.classList.add('hidden');

    if (!file || !file.type.startsWith('image/')) {
      if (uploadErr) {
        uploadErr.textContent = 'Please select an image file (PNG, JPG, WebP, GIF).';
        uploadErr.classList.remove('hidden');
      }
      return;
    }

    pendingUploadBlob = file;
    const dropZone = modalEl.querySelector('#image-drop-zone');
    const previewContainer = modalEl.querySelector('#upload-preview-container');
    const previewImg = modalEl.querySelector('#upload-preview-img');

    // Revoke previous upload preview if any (H2)
    if (previewImg.src && previewImg.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(previewImg.src); } catch (_) {}
      activeObjectUrls.delete(previewImg.src);
    }

    previewImg.src = trackObjectUrl(URL.createObjectURL(file));
    dropZone.classList.add('hidden');
    previewContainer.classList.remove('hidden');

    const confirmBtn = modalEl.querySelector('#confirm-upload-btn');
    const clearBtn = modalEl.querySelector('#clear-upload-btn');

    confirmBtn.onclick = async () => {
      try {
        const mediaUri = await MediaDB.saveMediaBlob(pendingUploadBlob, 'img');
        selectImage(mediaUri);
      } catch (err) {
        if (uploadErr) {
          uploadErr.textContent = 'Failed to save image: ' + err.message;
          uploadErr.classList.remove('hidden');
        }
      }
    };

    clearBtn.onclick = () => {
      if (previewImg.src && previewImg.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(previewImg.src); } catch (_) {}
        activeObjectUrls.delete(previewImg.src);
      }
      previewImg.src = '';
      pendingUploadBlob = null;
      previewContainer.classList.add('hidden');
      dropZone.classList.remove('hidden');
      modalEl.querySelector('#image-file-input').value = '';
      if (uploadErr) uploadErr.classList.add('hidden');
    };
  }

  function previewDirectUrl(url) {
    const area = modalEl.querySelector('#url-preview-area');
    const actions = modalEl.querySelector('#url-actions-row');

    if (!url || !url.trim()) {
      area.innerHTML = '<div class="empty-state">Please enter an image URL.</div>';
      actions.classList.add('hidden');
      return;
    }

    const trimmed = url.trim();
    // Validate protocol: allow http:, https:, or data:image/
    let isValid = false;
    if (trimmed.startsWith('data:image/')) {
      isValid = true;
    } else {
      try {
        const parsed = new URL(trimmed, window.location.origin);
        isValid = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch (_) {
        isValid = false;
      }
    }

    if (!isValid) {
      area.innerHTML = '<div class="error-msg">Invalid image URL. Must start with http://, https://, or data:image/.</div>';
      actions.classList.add('hidden');
      return;
    }

    area.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'direct-url-preview';

    const img = document.createElement('img');
    img.alt = 'URL preview';
    img.onerror = () => {
      container.innerHTML = '<div class="error-msg">Could not load image from this URL. Please verify the link.</div>';
    };
    img.src = trimmed;

    container.appendChild(img);
    area.appendChild(container);
    actions.classList.remove('hidden');
  }

  function renderImageGrid(items, container) {
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'image-results-grid';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'image-grid-item';
      card.innerHTML = `
        <img src="${item.thumb}" alt="${escapeHtml(item.title)}" loading="lazy">
        <div class="image-grid-overlay">
          <span class="image-select-label">Select</span>
        </div>
      `;
      card.addEventListener('click', () => {
        if (item.source === 'Unsplash' && item.downloadLocation) {
          MediaAPIs.trackUnsplashDownload(item.downloadLocation);
        }
        selectImage(item.full || item.thumb);
      });
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  function selectImage(imageUriOrUrl) {
    if (currentCallback) {
      currentCallback(imageUriOrUrl);
    }
    revokeAllObjectUrls();
    close();
  }

  function open(options = {}) {
    init();
    currentWord = options.word || '';
    currentCallback = options.onSelect || null;

    // Reset active tab to clipart (M3)
    activeTab = 'clipart';
    const tabBtns = modalEl.querySelectorAll('.modal-tab-btn');
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'clipart'));
    modalEl.querySelectorAll('.modal-tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-clipart'));

    // Reset AI preview area (M3)
    const aiPreview = modalEl.querySelector('#ai-preview-area');
    if (aiPreview) {
      aiPreview.innerHTML = '<div class="empty-state">Click "Generate Image" to create custom cartoon flashcard artwork.</div>';
    }

    // Reset URL preview area (M3)
    const urlPreview = modalEl.querySelector('#url-preview-area');
    if (urlPreview) {
      urlPreview.innerHTML = '<div class="empty-state">Paste a URL above and click "Preview".</div>';
    }
    const urlActions = modalEl.querySelector('#url-actions-row');
    if (urlActions) urlActions.classList.add('hidden');
    const urlInput = modalEl.querySelector('#direct-url-input');
    if (urlInput) urlInput.value = '';

    modalEl.querySelector('#image-modal-subtitle').textContent = currentWord ? `Word: "${currentWord}"` : 'Select an image';

    // Populate search inputs
    const clipartInput = modalEl.querySelector('#clipart-search-input');
    clipartInput.value = currentWord;
    modalEl.querySelector('#pixabay-search-input').value = currentWord;
    modalEl.querySelector('#unsplash-search-input').value = currentWord;

    // Pre-fill prompt
    const aiPromptInput = modalEl.querySelector('#ai-prompt-input');
    aiPromptInput.value = MediaAPIs.getFlashcardPrompt(currentWord);

    // Populate API keys
    modalEl.querySelector('#pixabay-key-input').value = MediaAPIs.getPixabayKey();
    modalEl.querySelector('#unsplash-key-input').value = MediaAPIs.getUnsplashKey();

    // Reset upload preview (M3)
    modalEl.querySelector('#image-drop-zone').classList.remove('hidden');
    modalEl.querySelector('#upload-preview-container').classList.add('hidden');
    const uploadErr = modalEl.querySelector('#upload-error-msg');
    if (uploadErr) {
      uploadErr.textContent = '';
      uploadErr.classList.add('hidden');
    }
    const fileInput = modalEl.querySelector('#image-file-input');
    if (fileInput) fileInput.value = '';

    modalEl.classList.remove('hidden');

    // Auto search clipart on open if word exists
    if (currentWord && activeTab === 'clipart') {
      runClipartSearch(currentWord);
    }
  }

  function close() {
    revokeAllObjectUrls();
    if (modalEl) modalEl.classList.add('hidden');
    currentCallback = null;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  return {
    init,
    open,
    close
  };
})();
