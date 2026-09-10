/**
 * Phonics Flash — Content & Curriculum Editor UI Controller
 * ==========================================================
 * Connects editor.html with EditorStore, MediaDB, ImagePicker, and AudioPicker.
 */

(() => {
  let activeBook = null;        // Persisted book from EditorStore
  let workingBook = null;       // In-memory mutable draft
  let isDirty = false;          // True when workingBook has unsaved edits
  let selectedLevelId = null;
  let selectedUnitId = null;
  let activeWorkspaceTab = 'core';
  let previewIndex = 0;
  let isInternalStoreChange = false;
  let coreWordsRenderSeq = 0;
  let stagedImportText = '';
  let pendingUnsavedAction = null;

  const AI_PROMPT_TEMPLATE = `I need you to generate a curriculum JSON file for my Phonics Flash web application.

Please output ONLY a valid, raw JSON object (with NO markdown backticks, NO markdown formatting, and NO conversational text before or after).

SCHEMA SPECIFICATION:
{
  "name": "Series Name (e.g. Oxford Phonics World 1)",
  "description": "Short description of this phonics curriculum",
  "levels": [
    {
      "name": "Level 1: Short Vowels",
      "color": "#29A8E0",
      "units": [
        {
          "title": "Unit 1: Short a",
          "sound": "a",
          "words": [
            { "word": "cat", "image": "", "audio": "" },
            { "word": "bat", "image": "", "audio": "" },
            { "word": "hat", "image": "", "audio": "" },
            { "word": "mat", "image": "", "audio": "" }
          ],
          "extraWords": [
            { "word": "rat" },
            { "word": "sat" }
          ],
          "sightWords": [
            { "word": "the" },
            { "word": "is" }
          ]
        }
      ]
    }
  ]
}

RULES:
1. "name": The title of your curriculum or book series.
2. "levels": Array of levels (e.g. Level 1, Level 2). Each level has "name", "color" (hex color code), and "units".
3. "units": Array of units inside each level. Each unit has "title", "sound" (target phonics sound, e.g. "a", "ch", "ee"), "words", "extraWords", and "sightWords".
4. "words": Core flashcard words. Each item MUST have "word", "image": "", and "audio": "". Leave image and audio empty strings (""); teachers assign images or use auto-pronunciation in the app.
5. "extraWords": Additional vocabulary for supplementary practice.
6. "sightWords": High-frequency sight words for this unit.
7. Output valid JSON only with no trailing commas.`;

  // ── Dirty State & Save Management ───────────────────────────
  function setDirty(dirty) {
    isDirty = !!dirty;
    updateSaveBtnUI();
  }

  function updateSaveBtnUI() {
    const btn = document.getElementById('save-changes-btn');
    const label = document.getElementById('save-btn-label');
    if (!btn || !label) return;

    if (isDirty) {
      btn.classList.add('dirty');
      btn.removeAttribute('disabled');
      label.textContent = 'Save Changes';
      document.title = `* ${workingBook?.name || 'Curriculum'} — Editor`;
    } else {
      btn.classList.remove('dirty');
      btn.setAttribute('disabled', 'true');
      label.textContent = 'Saved';
      document.title = `${workingBook?.name || 'Curriculum'} — Editor`;
    }
  }

  async function commitChanges() {
    if (!workingBook) return;
    isInternalStoreChange = true;
    try {
      EditorStore.saveCurriculum(workingBook);
      activeBook = EditorStore.getCurriculum(workingBook.id);
      workingBook = JSON.parse(JSON.stringify(activeBook));
      setDirty(false);
      showSaveToast('Changes saved successfully');
    } finally {
      isInternalStoreChange = false;
    }
  }

  function discardChanges() {
    if (!activeBook) return;
    workingBook = JSON.parse(JSON.stringify(activeBook));
    setDirty(false);
    renderSidebarTree();
    renderUnitWorkspace();
  }

  function showSaveToast(message = 'Changes saved successfully') {
    let toast = document.getElementById('save-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'save-toast';
      toast.className = 'save-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = `✓ ${message}`;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  function loadBook(bookId) {
    if (bookId) {
      EditorStore.setActiveCurriculum(bookId);
    }
    activeBook = EditorStore.getActiveCurriculum();
    workingBook = activeBook ? JSON.parse(JSON.stringify(activeBook)) : null;
    setDirty(false);
    renderBookDropdown();
    renderSidebarTree();
  }

  function promptUnsavedChanges(onConfirm) {
    if (!isDirty) {
      onConfirm();
      return;
    }
    pendingUnsavedAction = onConfirm;
    const modal = document.getElementById('unsaved-modal');
    const bookNameEl = document.getElementById('unsaved-book-name');
    if (bookNameEl && workingBook) {
      bookNameEl.textContent = workingBook.name;
    }
    modal.classList.remove('hidden');
  }

  // ── 1. Application Initialization ───────────────────────────
  async function init() {
    initTheme();

    // Initialize data store
    await EditorStore.init();

    // Subscribe to store updates
    EditorStore.subscribe((book, allBooks) => {
      if (isInternalStoreChange) return;
      activeBook = book;
      if (!isDirty) {
        workingBook = activeBook ? JSON.parse(JSON.stringify(activeBook)) : null;
        renderBookDropdown();
        renderSidebarTree();
        if (selectedUnitId) renderUnitWorkspace();
      } else {
        renderBookDropdown();
      }
    });

    const params = new URLSearchParams(window.location.search);
    const bookParam = params.get('book');
    const unitParam = params.get('unit') || params.get('u');

    if (bookParam && EditorStore.getCurriculum(bookParam)) {
      EditorStore.setActiveCurriculum(bookParam);
    }

    activeBook = EditorStore.getActiveCurriculum();
    workingBook = activeBook ? JSON.parse(JSON.stringify(activeBook)) : null;
    setDirty(false);

    renderBookDropdown();
    renderSidebarTree();
    bindHeaderEvents();
    bindWorkspaceEvents();
    bindModalEvents();
    bindImportModalEvents();
    bindUnsavedModalEvents();

    if (unitParam) {
      selectUnitById(unitParam);
    } else if (workingBook && workingBook.levels && workingBook.levels[0]?.units?.[0]) {
      selectUnit(workingBook.levels[0].id, workingBook.levels[0].units[0].id);
    }
  }

  // ── 2. Theme Management ─────────────────────────────────────
  function initTheme() {
    const savedTheme = localStorage.getItem('phonics-flash-theme') || 'system';
    applyTheme(savedTheme);

    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        let current = document.documentElement.getAttribute('data-theme');
        if (!current) {
          const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          current = isSystemDark ? 'dark' : 'light';
        }
        const next = current === 'dark' ? 'light' : 'dark';
        localStorage.setItem('phonics-flash-theme', next);
        applyTheme(next);
      });
    }
  }

  function applyTheme(theme) {
    let active = theme;
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      active = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.innerHTML = active === 'dark'
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="header-icon"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="header-icon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  }

  // ── 3. Book Series Dropdown & Switcher ───────────────────────
  function renderBookDropdown() {
    const select = document.getElementById('active-book-select');
    if (!select) return;

    select.innerHTML = '';
    const books = EditorStore.getCurricula();

    books.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name}${b.isCustom ? ' (Custom)' : ' (Built-in)'}`;
      if (b.id === (workingBook ? workingBook.id : EditorStore.getActiveCurriculumId())) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    select.onchange = () => {
      const newBookId = select.value;
      if (newBookId === (workingBook ? workingBook.id : '')) return;

      const performSwitch = () => {
        MediaDB.revokeAllUrls();
        loadBook(newBookId);
        if (workingBook && workingBook.levels && workingBook.levels[0]?.units?.[0]) {
          selectUnit(workingBook.levels[0].id, workingBook.levels[0].units[0].id);
        } else {
          selectedLevelId = workingBook?.levels?.[0]?.id || null;
          selectedUnitId = null;
          renderUnitWorkspace();
        }
      };

      if (isDirty) {
        promptUnsavedChanges(performSwitch);
      } else {
        performSwitch();
      }
    };
  }

  // ── 4. Sidebar Levels & Units Tree ───────────────────────────
  function renderSidebarTree() {
    const container = document.getElementById('levels-tree');
    if (!container) return;
    container.innerHTML = '';

    if (!workingBook || !workingBook.levels || workingBook.levels.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No levels in this book yet.<br>
          Click <strong>+ Level</strong> above to create one.
        </div>
      `;
      return;
    }

    workingBook.levels.forEach((level, lIdx) => {
      const levelEl = document.createElement('div');
      levelEl.className = 'tree-level-item';
      levelEl.dataset.levelId = level.id;

      // Check if this level contains the active unit
      const isLevelActive = level.id === selectedLevelId ||
        (level.units && level.units.some(u => u.id === selectedUnitId));

      if (isLevelActive || lIdx === 0) {
        levelEl.classList.add('open');
      }

      const color = level.color || '#29A8E0';
      const unitCount = level.units ? level.units.length : 0;

      levelEl.innerHTML = `
        <div class="tree-level-header">
          <div class="tree-level-left">
            <span class="tree-color-badge" style="background:${color}"></span>
            <span class="tree-level-title" title="${escapeHtml(level.name)}">${escapeHtml(level.name)}</span>
          </div>
          <div class="tree-level-right">
            <span class="unit-count-pill">${unitCount}</span>
            <button type="button" class="btn-icon tree-level-edit-btn" title="Edit Level Name / Color">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

        <div class="tree-units-list">
          ${(level.units || []).map(unit => `
            <div class="tree-unit-row ${unit.id === selectedUnitId ? 'selected' : ''}" data-unit-id="${unit.id}" data-level-id="${level.id}">
              <span class="tree-unit-name">${escapeHtml(unit.name)}</span>
              ${unit.targetSound ? `<span class="tree-unit-sound">${escapeHtml(unit.targetSound)}</span>` : ''}
            </div>
          `).join('')}
          <button type="button" class="tree-add-unit-btn" data-level-id="${level.id}">+ Add Unit</button>
        </div>
      `;

      // Header click toggles accordion
      levelEl.querySelector('.tree-level-header').addEventListener('click', (e) => {
        if (e.target.closest('.tree-level-edit-btn')) return;
        levelEl.classList.toggle('open');
      });

      // Edit level button
      levelEl.querySelector('.tree-level-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openLevelModal(level);
      });

      // Add unit button
      levelEl.querySelector('.tree-add-unit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        addNewUnitToLevel(level.id);
      });

      // Unit row selection
      levelEl.querySelectorAll('.tree-unit-row').forEach(row => {
        row.addEventListener('click', () => {
          selectUnit(row.dataset.levelId, row.dataset.unitId);
        });
      });

      container.appendChild(levelEl);
    });
  }

  function selectUnitById(unitId) {
    if (!workingBook || !workingBook.levels) return;
    for (const lvl of workingBook.levels) {
      if (lvl.units && lvl.units.some(u => u.id === unitId)) {
        selectUnit(lvl.id, unitId);
        return;
      }
    }
  }

  function selectUnit(levelId, unitId) {
    // Revoke previous unit's object URLs to keep memory completely clear
    MediaDB.revokeAllUrls();

    selectedLevelId = levelId;
    selectedUnitId = unitId;
    previewIndex = 0;

    // Highlight selected row in sidebar
    document.querySelectorAll('.tree-unit-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.unitId === unitId);
    });

    renderUnitWorkspace();
  }

  function addNewUnitToLevel(levelId) {
    if (!workingBook) return;
    const level = (workingBook.levels || []).find(l => l.id === levelId);
    if (!level) return;

    if (!level.units) level.units = [];
    const unitNum = level.units.length + 1;
    const unitId = `${levelId}_U${unitNum}_${Date.now().toString(36)}`;
    const newUnit = {
      id: unitId,
      name: `Unit ${unitNum}: New Sound`,
      targetSound: '',
      words: [],
      extraWords: [],
      sightWords: []
    };

    level.units.push(newUnit);
    setDirty(true);
    renderSidebarTree();
    selectUnit(levelId, newUnit.id);
  }

  // ── 5. Main Unit Workspace ──────────────────────────────────
  function getSelectedUnit() {
    if (!workingBook || !selectedLevelId || !selectedUnitId) return null;
    const level = (workingBook.levels || []).find(l => l.id === selectedLevelId);
    if (!level || !level.units) return null;
    return level.units.find(u => u.id === selectedUnitId) || null;
  }

  function renderUnitWorkspace() {
    const emptyState = document.getElementById('editor-empty-state');
    const workspace = document.getElementById('unit-workspace');
    const unit = getSelectedUnit();

    if (!unit) {
      emptyState.classList.remove('hidden');
      workspace.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    workspace.classList.remove('hidden');

    // Populate unit details
    const titleInput = document.getElementById('unit-title-input');
    const soundInput = document.getElementById('unit-target-sound-input');
    const levelSelect = document.getElementById('unit-level-select');

    titleInput.value = unit.name || '';
    soundInput.value = unit.targetSound || '';

    // Populate level select
    levelSelect.innerHTML = '';
    (workingBook.levels || []).forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      opt.selected = l.id === selectedLevelId;
      levelSelect.appendChild(opt);
    });

    // Update count badges
    document.getElementById('core-words-count').textContent = (unit.words || []).length;
    document.getElementById('extra-words-count').textContent = (unit.extraWords || []).length;
    document.getElementById('sight-words-count').textContent = (unit.sightWords || []).length;

    // Render active tab
    renderWorkspaceTabContent();
  }

  function renderWorkspaceTabContent() {
    const unit = getSelectedUnit();
    if (!unit) return;

    if (activeWorkspaceTab === 'core') {
      renderCoreWordsList(unit);
    } else if (activeWorkspaceTab === 'extras') {
      renderChipsList(unit.extraWords || [], 'extra-words-chips', 'extraWords');
    } else if (activeWorkspaceTab === 'sight') {
      renderChipsList(unit.sightWords || [], 'sight-words-chips', 'sightWords');
    } else if (activeWorkspaceTab === 'preview') {
      renderLiveCardPreview(unit);
    }
  }

  // ── 6. Core Words Grid & Cards ──────────────────────────────
  async function renderCoreWordsList(unit) {
    const thisSeq = ++coreWordsRenderSeq;
    const container = document.getElementById('word-cards-list');

    const words = unit.words || [];

    if (words.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          No flashcard words in this unit yet.<br>
          Click <strong>+ Add Word Card</strong> or <strong>Batch Add Words</strong> above to get started.
        </div>
      `;
      return;
    }

    // Resolve all image URLs asynchronously first
    const resolvedImages = await Promise.all(
      words.map(w => w.image ? MediaDB.resolveMediaUrl(w.image).catch(() => '') : Promise.resolve(''))
    );

    // If another render was initiated while resolving images, cancel this stale render
    if (thisSeq !== coreWordsRenderSeq) return;

    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (let idx = 0; idx < words.length; idx++) {
      const wordItem = words[idx];
      const card = document.createElement('div');
      card.className = 'word-editor-card';
      card.dataset.index = idx;

      const displayImgUrl = resolvedImages[idx] || '';

      const hasCustomAudio = !!wordItem.audio;
      const audioStatusLabel = hasCustomAudio
        ? (MediaDB.isMediaId(wordItem.audio) ? '🎙️ Custom Audio' : '🔗 Web Audio')
        : '🗣️ Auto TTS';

      card.innerHTML = `
        <div class="card-top-row">
          <div class="word-input-box">
            <input type="text" class="form-input card-word-input" value="${escapeHtml(wordItem.word || '')}" placeholder="Word...">
          </div>
          <div class="card-reorder-btns">
            <button type="button" class="card-mini-btn btn-move-up" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="card-mini-btn btn-move-down" title="Move Down" ${idx === words.length - 1 ? 'disabled' : ''}>▼</button>
          </div>
        </div>

        <!-- Image box -->
        <div class="word-card-image-box ${displayImgUrl ? 'has-image' : ''}" title="Click to choose image">
          ${displayImgUrl ? `
            <img src="${displayImgUrl}" alt="${escapeHtml(wordItem.word)}" class="card-img-preview">
            <button type="button" class="remove-img-btn" title="Remove image">&times;</button>
            <div class="image-hover-overlay">Change Image</div>
          ` : `
            <div class="empty-img-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <span>+ Add Image</span>
            </div>
          `}
        </div>

        <!-- Audio row -->
        <div class="card-audio-row">
          <span class="audio-status-pill ${hasCustomAudio ? 'custom' : ''}">
            ${audioStatusLabel}
          </span>
          <div class="card-audio-actions">
            <button type="button" class="card-play-audio-btn play-audio-test-btn" title="Play audio">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            </button>
            <button type="button" class="btn btn-secondary btn-sm edit-audio-btn">Set Audio</button>
          </div>
        </div>

        <!-- Bottom action row -->
        <div class="card-bottom-row">
          <button type="button" class="btn btn-secondary btn-sm duplicate-card-btn" title="Duplicate card">Copy</button>
          <button type="button" class="btn btn-danger btn-sm delete-card-btn" title="Delete card">Delete</button>
        </div>
      `;

      // Word spelling change
      const wordInput = card.querySelector('.card-word-input');
      wordInput.addEventListener('change', () => {
        wordItem.word = wordInput.value.trim();
        saveCurrentUnit();
      });

      // Image selection
      const imgBox = card.querySelector('.word-card-image-box');
      imgBox.addEventListener('click', (e) => {
        if (e.target.closest('.remove-img-btn')) {
          e.stopPropagation();
          wordItem.image = '';
          saveCurrentUnit();
          renderCoreWordsList(unit);
          return;
        }
        ImagePicker.open({
          word: wordItem.word || '',
          currentImage: wordItem.image || '',
          onSelect: (newUri) => {
            wordItem.image = newUri;
            saveCurrentUnit();
            renderCoreWordsList(unit);
          }
        });
      });

      // Audio selection
      card.querySelector('.edit-audio-btn').addEventListener('click', () => {
        AudioPicker.open({
          word: wordItem.word || '',
          currentAudio: wordItem.audio || '',
          onSelect: (newUri) => {
            wordItem.audio = newUri;
            saveCurrentUnit();
            renderCoreWordsList(unit);
          }
        });
      });

      // Play audio test
      card.querySelector('.play-audio-test-btn').addEventListener('click', async () => {
        await playTestAudio(wordItem.word, wordItem.audio);
      });

      // Reorder buttons
      card.querySelector('.btn-move-up').addEventListener('click', () => {
        if (idx > 0) {
          const temp = words[idx];
          words[idx] = words[idx - 1];
          words[idx - 1] = temp;
          saveCurrentUnit();
          renderCoreWordsList(unit);
        }
      });
      card.querySelector('.btn-move-down').addEventListener('click', () => {
        if (idx < words.length - 1) {
          const temp = words[idx];
          words[idx] = words[idx + 1];
          words[idx + 1] = temp;
          saveCurrentUnit();
          renderCoreWordsList(unit);
        }
      });

      // Duplicate card
      card.querySelector('.duplicate-card-btn').addEventListener('click', () => {
        const copy = JSON.parse(JSON.stringify(wordItem));
        words.splice(idx + 1, 0, copy);
        saveCurrentUnit();
        renderCoreWordsList(unit);
        document.getElementById('core-words-count').textContent = words.length;
      });

      // Delete card
      card.querySelector('.delete-card-btn').addEventListener('click', () => {
        words.splice(idx, 1);
        saveCurrentUnit();
        renderCoreWordsList(unit);
        document.getElementById('core-words-count').textContent = words.length;
      });

      frag.appendChild(card);
    }

    container.appendChild(frag);
  }

  async function playTestAudio(word, audioUri) {
    if (!word && !audioUri) return;

    if (audioUri) {
      try {
        const playableUrl = await MediaDB.resolveMediaUrl(audioUri);
        const snd = new Audio(playableUrl);
        await snd.play();
        return;
      } catch (e) {
        console.warn('Audio playback error, falling back to TTS:', e);
      }
    }

    // Fallback: ElevenLabs or Web Speech API
    if (typeof AudioPlayer !== 'undefined' && typeof AudioPlayer.playWord === 'function') {
      AudioPlayer.playWord(word, null);
    } else if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(word);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  }

  // ── 7. Extra Words & Sight Words Chips ───────────────────────
  function renderChipsList(items, containerId, propName) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const unit = getSelectedUnit();
    if (!unit) return;

    if (items.length === 0) {
      container.innerHTML = '<span class="text-muted" style="font-size:0.85rem">No words added yet.</span>';
      return;
    }

    items.forEach((item, idx) => {
      const chip = document.createElement('span');
      chip.className = 'word-chip';
      chip.innerHTML = `
        <span>${escapeHtml(item.word || '')}</span>
        <button type="button" class="chip-remove-btn" title="Remove">&times;</button>
      `;
      chip.querySelector('.chip-remove-btn').addEventListener('click', () => {
        items.splice(idx, 1);
        saveCurrentUnit();
        renderChipsList(items, containerId, propName);
        document.getElementById(`${propName === 'extraWords' ? 'extra' : 'sight'}-words-count`).textContent = items.length;
      });
      container.appendChild(chip);
    });
  }

  // ── 8. Live Deck Preview ─────────────────────────────────────
  async function renderLiveCardPreview(unit) {
    const words = unit.words || [];
    const counterEl = document.getElementById('preview-counter');
    const imgEl = document.getElementById('preview-img');
    const textEl = document.getElementById('preview-text');
    const fabAudio = document.getElementById('preview-fab-audio');

    if (words.length === 0) {
      counterEl.textContent = '0 / 0';
      imgEl.classList.add('hidden');
      textEl.textContent = 'No words in unit';
      return;
    }

    if (previewIndex >= words.length) previewIndex = 0;
    if (previewIndex < 0) previewIndex = words.length - 1;

    const currentCard = words[previewIndex];
    counterEl.textContent = `Card ${previewIndex + 1} / ${words.length}`;
    textEl.textContent = currentCard.word || 'Word';

    if (currentCard.image) {
      const resolved = await MediaDB.resolveMediaUrl(currentCard.image);
      imgEl.src = resolved;
      imgEl.classList.remove('hidden');
    } else {
      imgEl.classList.add('hidden');
    }

    fabAudio.onclick = async () => {
      await playTestAudio(currentCard.word, currentCard.audio);
    };
  }

  // ── 9. Bind Workspace Events ────────────────────────────────
  function bindWorkspaceEvents() {
    // Unit title & target sound auto-save
    const titleInput = document.getElementById('unit-title-input');
    const soundInput = document.getElementById('unit-target-sound-input');
    const levelSelect = document.getElementById('unit-level-select');

    titleInput.addEventListener('change', () => {
      const unit = getSelectedUnit();
      if (unit) {
        unit.name = titleInput.value.trim() || 'Untitled Unit';
        saveCurrentUnit();
        renderSidebarTree();
      }
    });

    soundInput.addEventListener('change', () => {
      const unit = getSelectedUnit();
      if (unit) {
        unit.targetSound = soundInput.value.trim();
        saveCurrentUnit();
        renderSidebarTree();
      }
    });

    levelSelect.addEventListener('change', () => {
      const unit = getSelectedUnit();
      const newLevelId = levelSelect.value;
      if (unit && newLevelId !== selectedLevelId && workingBook) {
        // Move unit to new level
        const oldLevel = (workingBook.levels || []).find(l => l.id === selectedLevelId);
        if (oldLevel && oldLevel.units) {
          oldLevel.units = oldLevel.units.filter(u => u.id !== selectedUnitId);
        }
        const newLevel = (workingBook.levels || []).find(l => l.id === newLevelId);
        if (newLevel) {
          if (!newLevel.units) newLevel.units = [];
          newLevel.units.push(unit);
        }
        selectedLevelId = newLevelId;
        setDirty(true);
        renderSidebarTree();
        selectUnit(newLevelId, unit.id);
      }
    });

    // Duplicate & Delete unit
    document.getElementById('duplicate-unit-btn').addEventListener('click', () => {
      if (selectedUnitId && selectedLevelId && workingBook) {
        const level = (workingBook.levels || []).find(l => l.id === selectedLevelId);
        if (!level || !level.units) return;
        const unit = level.units.find(u => u.id === selectedUnitId);
        if (!unit) return;
        const copy = JSON.parse(JSON.stringify(unit));
        copy.id = `${selectedLevelId}_U${Date.now().toString(36)}`;
        copy.name = `${unit.name} (Copy)`;
        const origIdx = level.units.findIndex(u => u.id === selectedUnitId);
        level.units.splice(origIdx + 1, 0, copy);
        setDirty(true);
        renderSidebarTree();
        selectUnit(selectedLevelId, copy.id);
      }
    });

    document.getElementById('delete-unit-btn').addEventListener('click', () => {
      if (confirm('Are you sure you want to delete this unit?')) {
        const level = (workingBook.levels || []).find(l => l.id === selectedLevelId);
        if (level && level.units) {
          level.units = level.units.filter(u => u.id !== selectedUnitId);
        }
        selectedUnitId = null;
        setDirty(true);
        renderSidebarTree();
        renderUnitWorkspace();
      }
    });

    // Workspace tabs
    document.querySelectorAll('.w-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.w-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.w-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        activeWorkspaceTab = btn.dataset.wtab;
        const target = document.getElementById(`wtab-${activeWorkspaceTab}`);
        if (target) target.classList.add('active');
        renderWorkspaceTabContent();
      });
    });

    // Add word card
    document.getElementById('add-word-card-btn').addEventListener('click', async () => {
      const unit = getSelectedUnit();
      if (!unit) return;
      if (!unit.words) unit.words = [];
      unit.words.push({ word: '', image: '', audio: '' });
      saveCurrentUnit();
      await renderCoreWordsList(unit);
      document.getElementById('core-words-count').textContent = unit.words.length;
      const inputs = document.querySelectorAll('.card-word-input');
      if (inputs.length > 0) {
        const lastInput = inputs[inputs.length - 1];
        lastInput.focus();
        lastInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    // Batch Add Words
    document.getElementById('batch-add-words-btn').addEventListener('click', () => {
      document.getElementById('batch-words-modal').classList.remove('hidden');
    });

    // Extra Words add input
    const extraInput = document.getElementById('add-extra-word-input');
    const extraAddBtn = document.getElementById('add-extra-word-btn');
    const addExtraAction = () => {
      const val = extraInput.value.trim();
      if (!val) return;
      const unit = getSelectedUnit();
      if (!unit) return;
      if (!unit.extraWords) unit.extraWords = [];
      unit.extraWords.push({ word: val });
      extraInput.value = '';
      saveCurrentUnit();
      renderChipsList(unit.extraWords, 'extra-words-chips', 'extraWords');
      document.getElementById('extra-words-count').textContent = unit.extraWords.length;
    };
    extraAddBtn.addEventListener('click', addExtraAction);
    extraInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addExtraAction();
    });

    // Sight Words add input
    const sightInput = document.getElementById('add-sight-word-input');
    const sightAddBtn = document.getElementById('add-sight-word-btn');
    const addSightAction = () => {
      const val = sightInput.value.trim();
      if (!val) return;
      const unit = getSelectedUnit();
      if (!unit) return;
      if (!unit.sightWords) unit.sightWords = [];
      unit.sightWords.push({ word: val });
      sightInput.value = '';
      saveCurrentUnit();
      renderChipsList(unit.sightWords, 'sight-words-chips', 'sightWords');
      document.getElementById('sight-words-count').textContent = unit.sightWords.length;
    };
    sightAddBtn.addEventListener('click', addSightAction);
    sightInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addSightAction();
    });

    // Preview navigation
    document.getElementById('preview-prev-btn').addEventListener('click', () => {
      previewIndex--;
      const unit = getSelectedUnit();
      if (unit) renderLiveCardPreview(unit);
    });
    document.getElementById('preview-next-btn').addEventListener('click', () => {
      previewIndex++;
      const unit = getSelectedUnit();
      if (unit) renderLiveCardPreview(unit);
    });

    // Empty state starter buttons
    document.getElementById('empty-add-level-btn').addEventListener('click', () => {
      openLevelModal(null);
    });
    document.getElementById('empty-clone-smart-btn').addEventListener('click', () => {
      const cloned = EditorStore.createCurriculum('My Smart Phonics', { templateId: 'smart-phonics' });
      loadBook(cloned.id);
    });

    // Sidebar add level button
    document.getElementById('sidebar-add-level-btn').addEventListener('click', () => {
      openLevelModal(null);
    });
  }

  function saveCurrentUnit() {
    setDirty(true);
    if (activeWorkspaceTab === 'preview') {
      const unit = getSelectedUnit();
      if (unit) renderLiveCardPreview(unit);
    }
  }

  // ── 10. Bind Header Events ──────────────────────────────────
  function bindHeaderEvents() {
    // Save Changes button
    document.getElementById('save-changes-btn').addEventListener('click', () => {
      if (isDirty) commitChanges();
    });

    // Keyboard shortcut Cmd+S / Ctrl+S
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isDirty) commitChanges();
      }
    });

    // Back to App with unsaved warning
    document.getElementById('back-to-app-btn')?.addEventListener('click', (e) => {
      if (isDirty) {
        e.preventDefault();
        promptUnsavedChanges(() => {
          window.location.href = 'index.html';
        });
      }
    });

    // Before unload warning for browser tab close/reload
    window.addEventListener('beforeunload', (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // New Book button
    document.getElementById('header-new-book-btn').addEventListener('click', () => {
      document.getElementById('new-book-modal').classList.remove('hidden');
    });

    // Book options button
    document.getElementById('header-book-options-btn').addEventListener('click', () => {
      openBookOptionsModal();
    });

    // Preview in App (automatically saves pending changes before launching)
    document.getElementById('preview-slideshow-btn').addEventListener('click', async () => {
      if (isDirty) {
        await commitChanges();
      }
      if (selectedUnitId && workingBook) {
        window.location.href = `index.html?book=${encodeURIComponent(workingBook.id)}&u=${encodeURIComponent(selectedUnitId)}`;
      } else if (workingBook) {
        window.location.href = `index.html?book=${encodeURIComponent(workingBook.id)}`;
      } else {
        window.location.href = 'index.html';
      }
    });

    // Export dropdown toggle
    const exportBtn = document.getElementById('export-menu-btn');
    const exportDropdown = document.getElementById('export-dropdown');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      exportDropdown.classList.add('hidden');
    });

    document.getElementById('export-book-json-btn').addEventListener('click', () => {
      if (workingBook) {
        const exportObj = {
          name: workingBook.name,
          id: workingBook.id,
          description: workingBook.description || '',
          exportedAt: new Date().toISOString(),
          levels: workingBook.levels
        };
        const str = JSON.stringify(exportObj, null, 2);
        const blob = new Blob([str], { type: 'application/json' });
        const filename = `${workingBook.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-curriculum.json`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    });

    document.getElementById('export-words-json-btn').addEventListener('click', () => {
      if (workingBook) {
        const exportObj = { levels: workingBook.levels };
        const str = JSON.stringify(exportObj, null, 2);
        const blob = new Blob([str], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'words.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
    });
  }

  // ── 11. Modal Bindings ──────────────────────────────────────
  function bindModalEvents() {
    // New Book modal
    const newBookModal = document.getElementById('new-book-modal');
    document.getElementById('new-book-close-btn').addEventListener('click', () => newBookModal.classList.add('hidden'));
    document.getElementById('new-book-cancel-btn').addEventListener('click', () => newBookModal.classList.add('hidden'));
    document.getElementById('new-book-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('new-book-name-input').value.trim();
      const desc = document.getElementById('new-book-desc-input').value.trim();
      const template = document.querySelector('input[name="book-template"]:checked').value;

      if (!name) return;

      let options = { description: desc };
      if (template === '5levels') options.autoCreateLevels = true;
      if (template === 'clone-smart') options.templateId = 'smart-phonics';

      const newBook = EditorStore.createCurriculum(name, options);
      newBookModal.classList.add('hidden');
      document.getElementById('new-book-form').reset();
      loadBook(newBook.id);
      if (workingBook && workingBook.levels && workingBook.levels[0]?.units?.[0]) {
        selectUnit(workingBook.levels[0].id, workingBook.levels[0].units[0].id);
      } else {
        selectedLevelId = workingBook?.levels?.[0]?.id || null;
        selectedUnitId = null;
        renderUnitWorkspace();
      }
      showSaveToast(`Created "${newBook.name}"`);
    });

    // Book Options modal
    const bookOptionsModal = document.getElementById('book-options-modal');
    document.getElementById('book-options-close-btn').addEventListener('click', () => bookOptionsModal.classList.add('hidden'));

    document.getElementById('save-book-name-btn').addEventListener('click', () => {
      const newName = document.getElementById('edit-book-name-input').value.trim();
      if (newName && workingBook) {
        EditorStore.renameCurriculum(workingBook.id, newName);
        workingBook.name = newName;
        renderBookDropdown();
        updateSaveBtnUI();
        bookOptionsModal.classList.add('hidden');
        showSaveToast(`Renamed to "${newName}"`);
      }
    });

    document.getElementById('reset-smart-phonics-btn').addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset Smart Phonics to factory defaults? All local edits will be replaced with original data/words.json.')) {
        await EditorStore.resetToDefaults('smart-phonics');
        loadBook('smart-phonics');
        bookOptionsModal.classList.add('hidden');
        alert('Smart Phonics has been restored to factory defaults.');
      }
    });

    document.getElementById('delete-book-btn').addEventListener('click', () => {
      if (confirm(`Are you sure you want to permanently delete "${workingBook.name}"?`)) {
        EditorStore.deleteCurriculum(workingBook.id);
        bookOptionsModal.classList.add('hidden');
        loadBook(EditorStore.getActiveCurriculumId());
      }
    });

    // Level modal
    const levelModal = document.getElementById('level-modal');
    document.getElementById('level-modal-close-btn').addEventListener('click', () => levelModal.classList.add('hidden'));
    document.getElementById('level-modal-cancel-btn').addEventListener('click', () => levelModal.classList.add('hidden'));

    // Preset color buttons
    levelModal.querySelectorAll('.color-preset-dot').forEach(dot => {
      dot.addEventListener('click', () => {
        document.getElementById('level-modal-color-input').value = dot.dataset.color;
      });
    });

    document.getElementById('level-modal-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const levelId = document.getElementById('level-modal-id').value;
      const levelName = document.getElementById('level-modal-name-input').value.trim();
      const levelColor = document.getElementById('level-modal-color-input').value;

      if (!levelName || !workingBook) return;
      if (!workingBook.levels) workingBook.levels = [];

      if (levelId) {
        // Edit existing level
        const lvl = workingBook.levels.find(l => l.id === levelId);
        if (lvl) {
          lvl.name = levelName;
          lvl.color = levelColor;
        }
      } else {
        // Create new level
        const nextNum = workingBook.levels.length + 1;
        const newLvl = {
          id: `${workingBook.id}_L${nextNum}_${Date.now().toString(36)}`,
          name: levelName,
          color: levelColor,
          units: []
        };
        workingBook.levels.push(newLvl);
        selectedLevelId = newLvl.id;
      }

      setDirty(true);
      levelModal.classList.add('hidden');
      renderSidebarTree();
      if (selectedUnitId) renderUnitWorkspace();
    });

    // Batch Words modal
    const batchModal = document.getElementById('batch-words-modal');
    document.getElementById('batch-words-close-btn').addEventListener('click', () => batchModal.classList.add('hidden'));
    document.getElementById('batch-words-cancel-btn').addEventListener('click', () => batchModal.classList.add('hidden'));
    document.getElementById('batch-words-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = document.getElementById('batch-words-textarea').value;
      const unit = getSelectedUnit();
      if (!text || !unit) return;

      // Split by commas, newlines, semicolons
      const words = text.split(/[\n,;]+/).map(w => w.trim()).filter(Boolean);
      if (words.length > 0) {
        if (!unit.words) unit.words = [];
        words.forEach(w => {
          unit.words.push({
            word: w,
            image: '',
            audio: ''
          });
        });
        saveCurrentUnit();
        renderCoreWordsList(unit);
        document.getElementById('core-words-count').textContent = unit.words.length;
      }

      batchModal.classList.add('hidden');
      document.getElementById('batch-words-textarea').value = '';
    });
  }

  // ── 12. Bind Import Modal & AI Prompt Events ─────────────────
  function bindImportModalEvents() {
    const importModal = document.getElementById('import-modal');
    const importBtn = document.getElementById('header-import-btn');
    const closeBtn = document.getElementById('import-modal-close-btn');
    const cancelBtn = document.getElementById('import-cancel-btn');
    const copyPromptBtn = document.getElementById('copy-ai-prompt-btn');
    const copyPromptText = document.getElementById('copy-ai-prompt-text');
    const promptDisplay = document.getElementById('ai-prompt-display');
    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('modal-import-file-input');
    const fileBadge = document.getElementById('file-selected-badge');
    const filenameEl = document.getElementById('selected-filename');
    const clearFileBtn = document.getElementById('clear-selected-file-btn');
    const pasteTextarea = document.getElementById('import-paste-textarea');
    const submitBtn = document.getElementById('import-submit-btn');
    const statusBox = document.getElementById('import-status-box');

    if (promptDisplay) promptDisplay.textContent = AI_PROMPT_TEMPLATE;

    let activeImportTab = 'upload';

    function openImportModal() {
      statusBox.className = 'import-status-box hidden';
      statusBox.textContent = '';
      stagedImportText = '';
      pasteTextarea.value = '';
      fileBadge.classList.add('hidden');
      dropzone.classList.remove('hidden');
      importModal.classList.remove('hidden');
    }

    importBtn?.addEventListener('click', openImportModal);
    closeBtn?.addEventListener('click', () => importModal.classList.add('hidden'));
    cancelBtn?.addEventListener('click', () => importModal.classList.add('hidden'));

    // Copy AI Prompt
    copyPromptBtn?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(AI_PROMPT_TEMPLATE);
        copyPromptText.textContent = '✓ Copied!';
        copyPromptBtn.classList.remove('btn-primary');
        copyPromptBtn.classList.add('btn-secondary');
        setTimeout(() => {
          copyPromptText.textContent = 'Copy AI Prompt';
          copyPromptBtn.classList.remove('btn-secondary');
          copyPromptBtn.classList.add('btn-primary');
        }, 2000);
      } catch (err) {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = AI_PROMPT_TEMPLATE;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copyPromptText.textContent = '✓ Copied!';
        setTimeout(() => { copyPromptText.textContent = 'Copy AI Prompt'; }, 2000);
      }
    });

    // Import Tabs
    document.querySelectorAll('.import-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.import-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.import-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        activeImportTab = btn.dataset.importTab;
        const pane = document.getElementById(`import-pane-${activeImportTab}`);
        if (pane) pane.classList.add('active');
      });
    });

    // Dropzone file handling
    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        await handleFile(e.dataTransfer.files[0]);
      }
    });

    fileInput?.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        await handleFile(e.target.files[0]);
      }
    });

    async function handleFile(file) {
      try {
        const text = await file.text();
        stagedImportText = text;
        filenameEl.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
        fileBadge.classList.remove('hidden');
        dropzone.classList.add('hidden');
        statusBox.className = 'import-status-box hidden';
      } catch (err) {
        showImportStatus('Could not read file: ' + err.message, 'error');
      }
    }

    clearFileBtn?.addEventListener('click', () => {
      stagedImportText = '';
      fileInput.value = '';
      fileBadge.classList.add('hidden');
      dropzone.classList.remove('hidden');
    });

    function showImportStatus(msg, type = 'error') {
      statusBox.textContent = msg;
      statusBox.className = `import-status-box ${type}`;
      statusBox.classList.remove('hidden');
    }

    // Submit Import
    submitBtn?.addEventListener('click', () => {
      let rawText = '';
      if (activeImportTab === 'upload') {
        rawText = stagedImportText.trim();
        if (!rawText) {
          showImportStatus('Please choose or drag & drop a .json file first.', 'error');
          return;
        }
      } else {
        rawText = pasteTextarea.value.trim();
        if (!rawText) {
          showImportStatus('Please paste your curriculum JSON into the text box.', 'error');
          return;
        }
      }

      // Sanitize markdown fences if present (e.g. ```json ... ```)
      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }

      let parsed = null;
      try {
        parsed = JSON.parse(rawText);
      } catch (err) {
        showImportStatus(`JSON Parse Error: ${err.message}. Ensure there are no trailing commas or missing brackets.`, 'error');
        return;
      }

      try {
        const imported = EditorStore.importBookJSON(parsed);
        importModal.classList.add('hidden');
        loadBook(imported.id);
        if (workingBook && workingBook.levels && workingBook.levels[0]?.units?.[0]) {
          selectUnit(workingBook.levels[0].id, workingBook.levels[0].units[0].id);
        } else {
          selectedLevelId = workingBook?.levels?.[0]?.id || null;
          selectedUnitId = null;
          renderUnitWorkspace();
        }
        showSaveToast(`Successfully imported "${imported.name}"!`);
      } catch (err) {
        showImportStatus(`Import Failed: ${err.message}`, 'error');
      }
    });
  }

  // ── 13. Bind Unsaved Changes Modal Events ───────────────────
  function bindUnsavedModalEvents() {
    const unsavedModal = document.getElementById('unsaved-modal');
    const saveBtn = document.getElementById('unsaved-save-btn');
    const discardBtn = document.getElementById('unsaved-discard-btn');
    const cancelBtn = document.getElementById('unsaved-cancel-btn');
    const closeBtn = document.getElementById('unsaved-modal-close-btn');

    saveBtn?.addEventListener('click', async () => {
      await commitChanges();
      unsavedModal.classList.add('hidden');
      if (pendingUnsavedAction) {
        const action = pendingUnsavedAction;
        pendingUnsavedAction = null;
        action();
      }
    });

    discardBtn?.addEventListener('click', () => {
      discardChanges();
      unsavedModal.classList.add('hidden');
      if (pendingUnsavedAction) {
        const action = pendingUnsavedAction;
        pendingUnsavedAction = null;
        action();
      }
    });

    const closeHandler = () => {
      unsavedModal.classList.add('hidden');
      pendingUnsavedAction = null;
      const select = document.getElementById('active-book-select');
      if (select && workingBook) select.value = workingBook.id;
    };

    cancelBtn?.addEventListener('click', closeHandler);
    closeBtn?.addEventListener('click', closeHandler);
  }

  function openBookOptionsModal() {
    if (!workingBook) return;
    const modal = document.getElementById('book-options-modal');
    document.getElementById('book-options-title').textContent = `Options for "${workingBook.name}"`;
    document.getElementById('edit-book-name-input').value = workingBook.name;

    const isSmart = workingBook.id === 'smart-phonics';
    document.getElementById('smart-phonics-reset-row').classList.toggle('hidden', !isSmart);
    document.getElementById('custom-book-delete-row').classList.toggle('hidden', isSmart);

    modal.classList.remove('hidden');
  }

  function openLevelModal(level) {
    const modal = document.getElementById('level-modal');
    const idInput = document.getElementById('level-modal-id');
    const nameInput = document.getElementById('level-modal-name-input');
    const colorInput = document.getElementById('level-modal-color-input');
    const title = document.getElementById('level-modal-title');

    if (level) {
      title.textContent = 'Edit Level Details';
      idInput.value = level.id;
      nameInput.value = level.name;
      colorInput.value = level.color || '#29A8E0';
    } else {
      title.textContent = 'Add New Level';
      idInput.value = '';
      const nextNum = (workingBook && workingBook.levels ? workingBook.levels.length : 0) + 1;
      nameInput.value = `Level ${nextNum}`;
      colorInput.value = '#29A8E0';
    }

    modal.classList.remove('hidden');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  // Run initialization on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
