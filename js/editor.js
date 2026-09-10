/**
 * Phonics Flash — Content & Curriculum Editor UI Controller
 * ==========================================================
 * Connects editor.html with EditorStore, MediaDB, ImagePicker, and AudioPicker.
 */

(() => {
  let activeBook = null;
  let selectedLevelId = null;
  let selectedUnitId = null;
  let activeWorkspaceTab = 'core';
  let previewIndex = 0;
  let isInternalStoreChange = false;
  let coreWordsRenderSeq = 0;

  // ── 1. Application Initialization ───────────────────────────
  async function init() {
    initTheme();

    // Initialize data store
    await EditorStore.init();

    // Subscribe to store updates
    EditorStore.subscribe((book, allBooks) => {
      activeBook = book;
      renderBookDropdown();
      renderSidebarTree();
      if (!isInternalStoreChange && selectedUnitId) {
        renderUnitWorkspace();
      }
    });

    activeBook = EditorStore.getActiveCurriculum();

    renderBookDropdown();
    renderSidebarTree();
    bindHeaderEvents();
    bindWorkspaceEvents();
    bindModalEvents();

    // Check URL query parameters for auto-selection (e.g. ?book=...&unit=...)
    const params = new URLSearchParams(window.location.search);
    const bookParam = params.get('book');
    const unitParam = params.get('unit') || params.get('u');

    if (bookParam && EditorStore.getCurriculum(bookParam)) {
      EditorStore.setActiveCurriculum(bookParam);
      activeBook = EditorStore.getActiveCurriculum();
      renderBookDropdown();
      renderSidebarTree();
    }

    if (unitParam) {
      selectUnitById(unitParam);
    } else if (activeBook && activeBook.levels && activeBook.levels[0] && activeBook.levels[0].units && activeBook.levels[0].units[0]) {
      // Auto-select first unit
      selectUnit(activeBook.levels[0].id, activeBook.levels[0].units[0].id);
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
      if (b.id === EditorStore.getActiveCurriculumId()) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    select.onchange = () => {
      // Aggressively revoke object URLs before switching books
      MediaDB.revokeAllUrls();
      EditorStore.setActiveCurriculum(select.value);
      activeBook = EditorStore.getActiveCurriculum();
      selectedLevelId = null;
      selectedUnitId = null;
      renderSidebarTree();
      renderUnitWorkspace();
    };
  }

  // ── 4. Sidebar Levels & Units Tree ───────────────────────────
  function renderSidebarTree() {
    const container = document.getElementById('levels-tree');
    if (!container) return;
    container.innerHTML = '';

    if (!activeBook || !activeBook.levels || activeBook.levels.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          No levels in this book yet.<br>
          Click <strong>+ Level</strong> above to create one.
        </div>
      `;
      return;
    }

    activeBook.levels.forEach((level, lIdx) => {
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
    if (!activeBook || !activeBook.levels) return;
    for (const lvl of activeBook.levels) {
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
    const level = activeBook.levels.find(l => l.id === levelId);
    if (!level) return;

    const unitNum = (level.units ? level.units.length : 0) + 1;
    const newUnit = {
      name: `Unit ${unitNum}: New Sound`,
      targetSound: '',
      words: [],
      extraWords: [],
      sightWords: []
    };

    const saved = EditorStore.saveUnit(activeBook.id, levelId, newUnit);
    selectUnit(levelId, saved.id);
  }

  // ── 5. Main Unit Workspace ──────────────────────────────────
  function getSelectedUnit() {
    if (!activeBook || !selectedLevelId || !selectedUnitId) return null;
    const level = activeBook.levels.find(l => l.id === selectedLevelId);
    if (!level) return null;
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
    activeBook.levels.forEach(l => {
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
      if (unit && newLevelId !== selectedLevelId) {
        // Move unit to new level
        EditorStore.deleteUnit(activeBook.id, selectedLevelId, selectedUnitId);
        const moved = EditorStore.saveUnit(activeBook.id, newLevelId, unit);
        selectUnit(newLevelId, moved.id);
      }
    });

    // Duplicate & Delete unit
    document.getElementById('duplicate-unit-btn').addEventListener('click', () => {
      if (selectedUnitId && selectedLevelId) {
        const copy = EditorStore.duplicateUnit(activeBook.id, selectedLevelId, selectedUnitId);
        if (copy) selectUnit(selectedLevelId, copy.id);
      }
    });

    document.getElementById('delete-unit-btn').addEventListener('click', () => {
      if (confirm('Are you sure you want to delete this unit?')) {
        EditorStore.deleteUnit(activeBook.id, selectedLevelId, selectedUnitId);
        selectedUnitId = null;
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
      EditorStore.createCurriculum('My Smart Phonics', { templateId: 'smart-phonics' });
    });

    // Sidebar add level button
    document.getElementById('sidebar-add-level-btn').addEventListener('click', () => {
      openLevelModal(null);
    });
  }

  function saveCurrentUnit() {
    const unit = getSelectedUnit();
    if (unit && activeBook && selectedLevelId) {
      isInternalStoreChange = true;
      try {
        EditorStore.saveUnit(activeBook.id, selectedLevelId, unit);
      } finally {
        isInternalStoreChange = false;
      }
    }
  }

  // ── 10. Bind Header Events & Modals ─────────────────────────
  function bindHeaderEvents() {
    // New Book button
    document.getElementById('header-new-book-btn').addEventListener('click', () => {
      document.getElementById('new-book-modal').classList.remove('hidden');
    });

    // Book options button
    document.getElementById('header-book-options-btn').addEventListener('click', () => {
      openBookOptionsModal();
    });

    // Preview in App
    document.getElementById('preview-slideshow-btn').addEventListener('click', () => {
      if (selectedUnitId && activeBook) {
        window.location.href = `index.html?book=${encodeURIComponent(activeBook.id)}&u=${encodeURIComponent(selectedUnitId)}`;
      } else if (activeBook) {
        window.location.href = `index.html?book=${encodeURIComponent(activeBook.id)}`;
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
      EditorStore.exportBookJSON(activeBook.id);
    });
    document.getElementById('export-words-json-btn').addEventListener('click', () => {
      EditorStore.exportWordsJsonFormat(activeBook.id);
    });

    // Import JSON input
    const importInput = document.getElementById('import-json-input');
    importInput.addEventListener('change', async (e) => {
      if (e.target.files && e.target.files[0]) {
        try {
          const text = await e.target.files[0].text();
          const parsed = JSON.parse(text);
          const imported = EditorStore.importBookJSON(parsed);
          alert(`Successfully imported "${imported.name}"!`);
        } catch (err) {
          alert('Failed to import JSON: ' + err.message);
        }
        importInput.value = '';
      }
    });
  }

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

      EditorStore.createCurriculum(name, options);
      newBookModal.classList.add('hidden');
      document.getElementById('new-book-form').reset();
    });

    // Book Options modal
    const bookOptionsModal = document.getElementById('book-options-modal');
    document.getElementById('book-options-close-btn').addEventListener('click', () => bookOptionsModal.classList.add('hidden'));

    document.getElementById('save-book-name-btn').addEventListener('click', () => {
      const newName = document.getElementById('edit-book-name-input').value.trim();
      if (newName && activeBook) {
        EditorStore.renameCurriculum(activeBook.id, newName);
        bookOptionsModal.classList.add('hidden');
      }
    });

    document.getElementById('reset-smart-phonics-btn').addEventListener('click', async () => {
      if (confirm('Are you sure you want to reset Smart Phonics to factory defaults? All local edits will be replaced with original data/words.json.')) {
        await EditorStore.resetToDefaults('smart-phonics');
        bookOptionsModal.classList.add('hidden');
        alert('Smart Phonics has been restored to factory defaults.');
      }
    });

    document.getElementById('delete-book-btn').addEventListener('click', () => {
      if (confirm(`Are you sure you want to permanently delete "${activeBook.name}"?`)) {
        EditorStore.deleteCurriculum(activeBook.id);
        bookOptionsModal.classList.add('hidden');
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

      if (!levelName || !activeBook) return;

      const levelData = {
        name: levelName,
        color: levelColor
      };
      if (levelId) levelData.id = levelId;

      EditorStore.saveLevel(activeBook.id, levelData);
      levelModal.classList.add('hidden');
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

  function openBookOptionsModal() {
    if (!activeBook) return;
    const modal = document.getElementById('book-options-modal');
    document.getElementById('book-options-title').textContent = `Options for "${activeBook.name}"`;
    document.getElementById('edit-book-name-input').value = activeBook.name;

    const isSmart = activeBook.id === 'smart-phonics';
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
      const nextNum = (activeBook.levels ? activeBook.levels.length : 0) + 1;
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
