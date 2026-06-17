/**
 * Phonics Flash — Main Application
 * ==================================
 * Handles menu rendering, slide generation, URL parameters,
 * normal mode (units as stacks) and mix mode (round-robin interleaving).
 */
(() => {
  // ── State ──────────────────────────────────────────────────
  let phonicsData = null;
  let revealInstance = null;

  const options = {
    includeExtras: localStorage.getItem('phonics-flash-extras') === 'true',
    includeImages: localStorage.getItem('phonics-flash-images') === 'true',
    mixMode: localStorage.getItem('phonics-flash-mix') === 'true',
    dictationMode: localStorage.getItem('phonics-flash-dictation') === 'true',
    quizMode: localStorage.getItem('phonics-flash-quiz') === 'true',
    syncSlides: localStorage.getItem('phonics-flash-sync') !== 'false'
  };

  // ── SVG Icons ──────────────────────────────────────────────
  const ICONS = {
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    speaker: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
  };

  // ── Level Colors ───────────────────────────────────────────
  const LEVEL_COLORS = {
    L1: '#29A8E0', /* vivid cerulean / sky blue */
    L2: '#F5A623', /* warm golden yellow / light orange */
    L3: '#C0452A', /* earthy brick red / terracotta */
    L4: '#3DAA5C', /* vibrant leaf / kelly green */
    L5: '#9B3FAD'  /* rich plum / magenta-purple */
  };

  // ── Theme Management ──────────────────────────────────────
  function initTheme() {
    applyTheme('system');

    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // Listen to system theme changes to update icon dynamically
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.hasAttribute('data-theme')) {
        applyTheme('system');
      }
    });
  }

  function toggleTheme() {
    let current = document.documentElement.getAttribute('data-theme');
    if (!current) {
      // It is 'system' theme, detect current system preference
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      current = isSystemDark ? 'dark' : 'light';
    }
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  function applyTheme(theme) {
    let activeTheme = theme;
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      activeTheme = isSystemDark ? 'dark' : 'light';
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }

    const btn = document.getElementById('theme-toggle');
    if (btn) {
      // Show sun icon in dark mode (click → light), moon icon in light mode (click → dark)
      btn.innerHTML = activeTheme === 'dark' ? ICONS.sun : ICONS.moon;
      btn.title = activeTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  // ── Initialization ─────────────────────────────────────────
  async function init() {
    initTheme();
    initMenuEvents();

    // Log audio engine configuration status to assist in debugging
    if (typeof ELEVENLABS_CONFIG !== 'undefined') {
      if (!ELEVENLABS_CONFIG.apiKey || ELEVENLABS_CONFIG.apiKey === 'your-api-key-here') {
        console.log(
          '%c[Audio Engine]%c ElevenLabs API key is placeholder ("your-api-key-here") or empty. Fallback browser SpeechSynthesis is active.',
          'font-weight:bold;color:#4ECDC4;',
          'color:#FF6B6B;'
        );
      } else {
        const maskedKey = ELEVENLABS_CONFIG.apiKey.substring(0, 8) + '...';
        console.log(
          `%c[Audio Engine]%c ElevenLabs API is configured. Active key starts with: ${maskedKey}`,
          'font-weight:bold;color:#4ECDC4;',
          'color:#96CEB4;'
        );
      }
    } else {
      console.log(
        '%c[Audio Engine]%c ELEVENLABS_CONFIG is undefined. Using browser SpeechSynthesis fallback.',
        'font-weight:bold;color:#4ECDC4;',
        'color:#FFEAA7;'
      );
    }

    try {
      phonicsData = await loadData();
    } catch (err) {
      console.error('Failed to load phonics data:', err);
      document.getElementById('menu-screen').innerHTML =
        `<div style="text-align:center;padding:4rem;color:#FF6B6B;">
          <h2>Failed to load word data</h2>
          <p style="color:rgba(255,255,255,0.6);margin-top:1rem;">Check that <code>data/words.json</code> exists and is valid JSON.</p>
        </div>`;
      return;
    }

    // Check for URL parameters
    const urlConfig = parseURLParams();
    if (urlConfig) {
      let qm = urlConfig.quiz;
      let dm = urlConfig.dictation;
      if (qm && dm) {
        dm = false; // Quiz Mode takes priority
      }
      startSlideshow(urlConfig.unitIds, {
        includeExtras: urlConfig.extras,
        includeImages: urlConfig.images,
        mixMode: urlConfig.mix,
        dictationMode: dm,
        quizMode: qm
      });
    } else {
      renderMenu();
    }
  }

  // ── Data Loading ───────────────────────────────────────────
  async function loadData() {
    const response = await fetch('data/words.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  // ── URL Parameter Parsing ──────────────────────────────────
  function parseURLParams() {
    const params = new URLSearchParams(window.location.search);
    const units = params.get('units');
    if (!units) return null;

    return {
      unitIds: units.split(/[,-]/).map(s => s.trim()).filter(Boolean),
      extras: params.get('extras') === '1',
      images: params.get('images') !== '0', // default true
      mix: params.get('mix') === '1',
      dictation: params.get('dictation') === '1',
      quiz: params.get('quiz') === '1'
    };
  }

  // ── Build Bookmarkable URL ─────────────────────────────────
  function updateURLWithParams(unitIds, opts) {
    const params = new URLSearchParams();
    params.set('units', unitIds.join('-'));
    if (opts.includeExtras) params.set('extras', '1');
    if (!opts.includeImages) params.set('images', '0');
    if (opts.mixMode) params.set('mix', '1');
    if (opts.dictationMode) params.set('dictation', '1');
    if (opts.quizMode) params.set('quiz', '1');

    const newURL = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newURL);
  }

  // Helper to sync option button class with state
  function syncOptionButton(btnId, isActive) {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.classList.toggle('active', isActive);
    }
  }

  // Wire up toggles and buttons once on initialization
  function initMenuEvents() {
    document.getElementById('toggle-extras').addEventListener('click', (e) => {
      options.includeExtras = !options.includeExtras;
      syncOptionButton('toggle-extras', options.includeExtras);
      localStorage.setItem('phonics-flash-extras', options.includeExtras);
      updateStartButton();
    });

    document.getElementById('toggle-images').addEventListener('click', (e) => {
      options.includeImages = !options.includeImages;
      syncOptionButton('toggle-images', options.includeImages);
      localStorage.setItem('phonics-flash-images', options.includeImages);
    });

    document.getElementById('toggle-mix').addEventListener('click', (e) => {
      options.mixMode = !options.mixMode;
      syncOptionButton('toggle-mix', options.mixMode);
      localStorage.setItem('phonics-flash-mix', options.mixMode);
    });

    document.getElementById('toggle-dictation').addEventListener('click', (e) => {
      options.dictationMode = !options.dictationMode;
      if (options.dictationMode) {
        options.quizMode = false;
        syncOptionButton('toggle-quiz', false);
        localStorage.setItem('phonics-flash-quiz', 'false');
      }
      syncOptionButton('toggle-dictation', options.dictationMode);
      localStorage.setItem('phonics-flash-dictation', options.dictationMode);
    });

    document.getElementById('toggle-quiz').addEventListener('click', (e) => {
      options.quizMode = !options.quizMode;
      if (options.quizMode) {
        options.dictationMode = false;
        syncOptionButton('toggle-dictation', false);
        localStorage.setItem('phonics-flash-dictation', 'false');
      }
      syncOptionButton('toggle-quiz', options.quizMode);
      localStorage.setItem('phonics-flash-quiz', options.quizMode);
    });

    // Wire up start button
    document.getElementById('start-btn').addEventListener('click', handleStart);

    // Wire up reset button
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        // Clear saved units from storage
        localStorage.removeItem('phonics-flash-selected-units');

        // Uncheck all checkboxes in UI
        const checkboxes = document.querySelectorAll('#levels-container .unit-checkbox input[type="checkbox"]');
        checkboxes.forEach(cb => {
          cb.checked = false;
          cb.closest('.unit-checkbox').classList.remove('checked');
        });

        // Reset all level select all buttons
        const selectAllBtns = document.querySelectorAll('#levels-container .select-all-btn');
        selectAllBtns.forEach(btn => {
          btn.textContent = 'Select All';
        });

        // Collapse all level cards accordion
        const levelCards = document.querySelectorAll('#levels-container .level-card');
        levelCards.forEach(card => {
          card.classList.remove('expanded');
        });

        // Reset and save all option buttons
        options.includeExtras = false;
        options.includeImages = false;
        options.mixMode = false;
        options.dictationMode = false;
        options.quizMode = false;

        syncOptionButton('toggle-extras', false);
        syncOptionButton('toggle-images', false);
        syncOptionButton('toggle-mix', false);
        syncOptionButton('toggle-dictation', false);
        syncOptionButton('toggle-quiz', false);

        localStorage.setItem('phonics-flash-extras', 'false');
        localStorage.setItem('phonics-flash-images', 'false');
        localStorage.setItem('phonics-flash-mix', 'false');
        localStorage.setItem('phonics-flash-dictation', 'false');
        localStorage.setItem('phonics-flash-quiz', 'false');

        // Update start button
        updateStartButton();

        // Inform the user
        showToast('All selections cleared', 'info', 2000);
      });
    }
  }

  // ── Menu Rendering ─────────────────────────────────────────
  function renderMenu() {
    const container = document.getElementById('levels-container');
    container.innerHTML = '';

    const savedUnits = JSON.parse(localStorage.getItem('phonics-flash-selected-units') || '[]');

    phonicsData.levels.forEach((level, index) => {
      const card = createLevelCard(level, index, savedUnits);
      container.appendChild(card);
    });

    // Set initial toggle states in UI
    syncOptionButton('toggle-extras', options.includeExtras);
    syncOptionButton('toggle-images', options.includeImages);
    syncOptionButton('toggle-mix', options.mixMode);
    syncOptionButton('toggle-dictation', options.dictationMode);
    syncOptionButton('toggle-quiz', options.quizMode);

    updateStartButton();
  }

  function createLevelCard(level, index, savedUnits = []) {
    const card = document.createElement('div');
    card.className = 'level-card';
    card.dataset.levelId = level.id;

    // Check if any units in this level are saved/checked
    const checkedUnitsInLevel = level.units.filter(u => savedUnits.includes(u.id));
    const hasSelected = checkedUnitsInLevel.length > 0;
    const allChecked = level.units.length > 0 && checkedUnitsInLevel.length === level.units.length;

    // Auto-expand if units are selected in this level
    if (hasSelected) {
      card.classList.add('expanded');
    }

    const color = LEVEL_COLORS[level.id] || LEVEL_COLORS.L1;

    card.innerHTML = `
      <div class="level-header">
        <div class="level-header-left">
          <div class="level-color-dot" style="color:${color};background:${color}"></div>
          <h2>${level.name}</h2>
        </div>
        <div class="level-header-right">
          <button class="select-all-btn" data-level="${level.id}">${allChecked ? 'Deselect All' : 'Select All'}</button>
          <div class="level-chevron">${ICONS.chevron}</div>
        </div>
      </div>
      <div class="units-container">
        <div class="units-grid">
          ${level.units.map(unit => {
            const isChecked = savedUnits.includes(unit.id);
            return createUnitCheckboxHTML(unit, level.id, isChecked);
          }).join('')}
        </div>
      </div>
    `;

    // Accordion toggle
    const header = card.querySelector('.level-header');
    header.addEventListener('click', (e) => {
      if (e.target.closest('.select-all-btn')) return;
      card.classList.toggle('expanded');
    });

    // Select All / Deselect All
    const selectAllBtn = card.querySelector('.select-all-btn');
    selectAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Auto-expand the card so users can see what was selected
      if (!card.classList.contains('expanded')) {
        card.classList.add('expanded');
      }
      const checkboxes = card.querySelectorAll('.unit-checkbox input[type="checkbox"]');
      const allCheckedNow = Array.from(checkboxes).every(cb => cb.checked);

      checkboxes.forEach(cb => {
        cb.checked = !allCheckedNow;
        cb.closest('.unit-checkbox').classList.toggle('checked', !allCheckedNow);
      });

      selectAllBtn.textContent = allCheckedNow ? 'Select All' : 'Deselect All';
      updateStartButton();
      saveSelectedUnits();
    });

    // Unit checkbox clicks
    card.querySelectorAll('.unit-checkbox').forEach(label => {
      label.addEventListener('click', (e) => {
        e.preventDefault();
        const cb = label.querySelector('input[type="checkbox"]');
        cb.checked = !cb.checked;
        label.classList.toggle('checked', cb.checked);

        // Update Select All button text
        const allCbs = card.querySelectorAll('.unit-checkbox input[type="checkbox"]');
        const allCheckedNow = Array.from(allCbs).every(c => c.checked);
        selectAllBtn.textContent = allCheckedNow ? 'Deselect All' : 'Select All';

        updateStartButton();
        saveSelectedUnits();
      });
    });

    return card;
  }

  function createUnitCheckboxHTML(unit, levelId, isChecked = false) {
    return `
      <label class="unit-checkbox unit-checkbox-${levelId} ${isChecked ? 'checked' : ''}" data-unit-id="${unit.id}">
        <input type="checkbox" value="${unit.id}" ${isChecked ? 'checked' : ''}>
        <div class="unit-check-box">${ICONS.check}</div>
        <div class="unit-info-text">
          <span class="unit-name">${unit.name}</span>
        </div>
      </label>
    `;
  }

  function getSelectedUnitIds() {
    const checked = document.querySelectorAll('#levels-container .unit-checkbox input:checked');
    return Array.from(checked).map(cb => cb.value);
  }

  function saveSelectedUnits() {
    const selectedIds = getSelectedUnitIds();
    localStorage.setItem('phonics-flash-selected-units', JSON.stringify(selectedIds));
  }

  function updateStartButton() {
    const btn = document.getElementById('start-btn');
    const selectedIds = getSelectedUnitIds();
    const count = countWords(selectedIds);

    btn.disabled = selectedIds.length === 0;

    const countSpan = btn.querySelector('.start-btn-count');
    if (selectedIds.length === 0) {
      countSpan.textContent = 'Select at least one unit';
    } else {
      countSpan.textContent = `${selectedIds.length} unit${selectedIds.length > 1 ? 's' : ''} · ${count} words`;
    }
  }

  function countWords(unitIds) {
    let count = 0;
    for (const level of phonicsData.levels) {
      for (const unit of level.units) {
        if (unitIds.includes(unit.id)) {
          count += unit.words.length;
          if (options.includeExtras && unit.extraWords) {
            count += unit.extraWords.length;
          }
        }
      }
    }
    return count;
  }

  // ── Start Slideshow ────────────────────────────────────────
  function handleStart() {
    const unitIds = getSelectedUnitIds();
    if (unitIds.length === 0) return;

    startSlideshow(unitIds, { ...options });
  }

  function startSlideshow(unitIds, opts) {
    // Gather selected unit data with level context
    const selectedUnits = [];
    for (const level of phonicsData.levels) {
      for (const unit of level.units) {
        if (unitIds.includes(unit.id)) {
          selectedUnits.push({
            ...unit,
            levelId: level.id,
            levelName: level.name
          });
        }
      }
    }

    if (selectedUnits.length === 0) return;

    // Build slides — only word content (no chrome inside slides)
    const slidesContainer = document.querySelector('#slideshow-screen .slides');
    slidesContainer.innerHTML = '';

    if (opts.mixMode) {
      buildMixModeSlides(slidesContainer, selectedUnits, opts);
    } else {
      buildNormalModeSlides(slidesContainer, selectedUnits, opts);
    }

    // Preload audio files for instant playback
    const slides = slidesContainer.querySelectorAll('.word-slide');
    slides.forEach(slide => {
      const audioPath = slide.dataset.audioPath;
      if (audioPath) {
        AudioPlayer.preload(audioPath);
      }
    });

    // Update URL for bookmarking (always, even when launched from URL params)
    updateURLWithParams(unitIds, opts);

    // Switch screens
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('slideshow-screen').classList.remove('hidden');

    // Initialize reveal.js
    initReveal(opts.mixMode);

    // Show/hide and update state of the Sync toggle (after initReveal renders slideshow-chrome)
    const syncBtn = document.getElementById('toggle-sync');
    if (syncBtn) {
      if (!opts.mixMode && selectedUnits.length > 1) {
        syncBtn.classList.remove('hidden');
        syncBtn.classList.toggle('active', options.syncSlides);
      } else {
        syncBtn.classList.add('hidden');
      }
    }

    // Wire up back button
    document.getElementById('back-btn').onclick = backToMenu;
  }

  // ── Normal Mode: Horizontal = Units, Vertical = Words ─────
  function buildNormalModeSlides(container, units, opts) {
    // Prepend welcome intro slide
    container.appendChild(createIntroSlide());

    units.forEach(unit => {
      const unitSection = document.createElement('section');

      // Main words (shuffled)
      const mainWords = unit.words.map(w => ({ ...w, isExtra: false }));
      shuffleArray(mainWords);

      // Extra words (shuffled)
      let extraWords = [];
      if (opts.includeExtras && unit.extraWords && unit.extraWords.length > 0) {
        extraWords = unit.extraWords.map(w => ({ ...w, isExtra: true }));
        shuffleArray(extraWords);
      }

      const words = [...mainWords, ...extraWords];

      words.forEach((wordData, index) => {
        const wordSection = createWordSlide(wordData, unit, index, words.length, opts);
        unitSection.appendChild(wordSection);
      });

      container.appendChild(unitSection);
    });
  }

  // ── Mix Mode: Round-Robin Interleaving ─────────────────────
  function buildMixModeSlides(container, units, opts) {
    // Prepend welcome intro slide
    container.appendChild(createIntroSlide());

    // Prepare main words queues per unit (shuffled)
    const mainQueues = units.map(unit => {
      const words = unit.words.map(w => ({ ...w, isExtra: false }));
      shuffleArray(words);
      return { unit, words };
    });

    // Round-robin interleave main words
    const interleavedMain = interleaveRoundRobin(mainQueues);

    // Prepare extra words queues per unit (shuffled)
    let interleavedExtra = [];
    if (opts.includeExtras) {
      const extraQueues = units.map(unit => {
        const words = (unit.extraWords || []).map(w => ({ ...w, isExtra: true }));
        shuffleArray(words);
        return { unit, words };
      });
      // Round-robin interleave extra words
      interleavedExtra = interleaveRoundRobin(extraQueues);

      // Prevent back-to-back same unit at the boundary between main and extra words
      if (interleavedMain.length > 0 && interleavedExtra.length > 0) {
        const lastMainUnitId = interleavedMain[interleavedMain.length - 1].unit.id;
        if (interleavedExtra[0].unit.id === lastMainUnitId) {
          // Find the first element in interleavedExtra that has a different unit ID and swap
          const swapIdx = interleavedExtra.findIndex(item => item.unit.id !== lastMainUnitId);
          if (swapIdx > 0) {
            [interleavedExtra[0], interleavedExtra[swapIdx]] = [interleavedExtra[swapIdx], interleavedExtra[0]];
          }
        }
      }
    }

    const interleaved = [...interleavedMain, ...interleavedExtra];

    // Build flat slide sequence
    interleaved.forEach((item, index) => {
      const wordSection = createWordSlide(
        item.wordData,
        item.unit,
        index,
        interleaved.length,
        opts
      );
      container.appendChild(wordSection);
    });
  }

  /**
   * Round-robin interleave: ensures each unit is represented once per "round"
   * before a new round starts. Within each round, unit order is shuffled.
   * No back-to-back same unit across round boundaries.
   */
  function interleaveRoundRobin(queues) {
    const result = [];

    while (queues.some(q => q.words.length > 0)) {
      // Get units that still have words
      const available = queues.filter(q => q.words.length > 0);

      // Shuffle the round order
      shuffleArray(available);

      // Prevent back-to-back same unit at round boundary
      if (result.length > 0) {
        const lastUnitId = result[result.length - 1].unit.id;
        if (available.length > 1 && available[0].unit.id === lastUnitId) {
          // Swap first element with a random non-conflicting one
          const swapIdx = available.findIndex(q => q.unit.id !== lastUnitId);
          if (swapIdx > 0) {
            [available[0], available[swapIdx]] = [available[swapIdx], available[0]];
          }
        }
      }

      // Take one word from each available unit
      for (const queue of available) {
        result.push({
          wordData: queue.words.shift(),
          unit: queue.unit
        });
      }
    }

    return result;
  }

  // ── Create the Intro Welcome Slide ──────────────────────────
  function createIntroSlide() {
    const section = document.createElement('section');
    section.classList.add('word-slide', 'intro-slide');

    // Store metadata indicating this is the intro slide
    section.dataset.word = '';
    section.dataset.audioPath = '';
    section.dataset.unitLabel = '';
    section.dataset.progress = 'Start';
    section.dataset.isIntro = 'true';

    section.innerHTML = `
      <div class="slide-center intro-content">
        <img src="media/practice_time.png" alt="Practice Time!" class="intro-image" onerror="this.style.display='none'">
      </div>
    `;

    return section;
  }

  // ── Select a Distractor Word ────────────────────────────────
  function getDistractorWord(wordData, unit, opts) {
    let unitWords = [...unit.words];
    if (opts.includeExtras && unit.extraWords) {
      unitWords = [...unitWords, ...unit.extraWords];
    }

    const candidates = unitWords.filter(w => w.word.toLowerCase() !== wordData.word.toLowerCase());
    if (candidates.length > 0) {
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      return chosen.word;
    }

    const level = phonicsData.levels.find(l => l.id === unit.levelId);
    if (level) {
      let levelWords = [];
      level.units.forEach(u => {
        levelWords = [...levelWords, ...u.words];
        if (opts.includeExtras && u.extraWords) {
          levelWords = [...levelWords, ...u.extraWords];
        }
      });
      const levelCandidates = levelWords.filter(w => w.word.toLowerCase() !== wordData.word.toLowerCase());
      if (levelCandidates.length > 0) {
        const chosen = levelCandidates[Math.floor(Math.random() * levelCandidates.length)];
        return chosen.word;
      }
    }

    return 'Review';
  }

  // ── Create a Single Word Slide ─────────────────────────────
  // Only contains the word text and optional image.
  // Chrome (unit badge, audio button, progress) lives in the
  // persistent overlay and is updated via updateSlideChrome().
  function createWordSlide(wordData, unit, index, total, opts) {
    const section = document.createElement('section');
    section.classList.add('word-slide');
    if (unit.levelId) {
      section.classList.add(`slide-bg-${unit.levelId}`);
    }

    // Store all metadata as data attributes for the chrome overlay
    section.dataset.word = wordData.word;
    section.dataset.audioPath = wordData.audio || '';
    section.dataset.unitLabel = `${unit.levelName} · ${unit.name}`;
    section.dataset.targetSound = unit.targetSound || unit.sound || '';
    section.dataset.levelId = unit.levelId;
    section.dataset.progress = `${index + 1} / ${total}`;
    if (wordData.isExtra) section.dataset.extra = 'true';

    const hasImage = !!wordData.image;

    if (opts && opts.quizMode) {
      section.dataset.quizMode = "true";
      section.dataset.answered = "false";

      const distractor = getDistractorWord(wordData, unit, opts);
      const choices = [wordData.word, distractor];
      shuffleArray(choices);

      section.innerHTML = `
        <div class="slide-center quiz-mode-layout">
          ${hasImage
            ? `<img src="${wordData.image}" alt="Quiz Image" class="word-image quiz-image"
                 onerror="this.style.display='none'">`
            : ''}
          <div class="quiz-options-container">
            <button class="quiz-option-btn" data-word="${choices[0]}">${choices[0]}</button>
            <button class="quiz-option-btn" data-word="${choices[1]}">${choices[1]}</button>
          </div>
        </div>
      `;
    } else {
      const showImages = opts ? opts.includeImages : false;
      const showImageInDictation = opts ? opts.dictationMode : false;

      // Only render the word (+ optional image) — no chrome
      section.innerHTML = `
        <div class="slide-center">
          ${(showImages || showImageInDictation) && hasImage
            ? `<img src="${wordData.image}" alt="${wordData.word}" class="word-image"
                 onerror="this.style.display='none'">`
            : ''}
          <div class="word-text ${(opts && opts.dictationMode) ? 'dictation-hide' : ''}">${wordData.word}</div>
        </div>
      `;
    }

    return section;
  }

  // ── Slideshow Chrome (persistent overlay) ──────────────────
  // These UI elements live OUTSIDE the reveal.js slides so they
  // never animate during slide transitions.
  function initSlideChrome() {
    const chrome = document.getElementById('slideshow-chrome');
    chrome.innerHTML = `
      <div class="slide-meta-top">
        <span class="unit-badge" id="chrome-unit"></span>
        <span class="progress-badge" id="chrome-progress"></span>
        <button class="option-btn hidden" id="toggle-sync" title="Sync slide levels across decks">
          <span>Sync</span>
        </button>
      </div>

      <button class="audio-btn" id="chrome-audio" title="Play audio (Space / Enter)">
        ${ICONS.speaker}
      </button>
    `;

    // Wire up audio button click
    document.getElementById('chrome-audio').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      playCurrentSlideAudio();
    });
  }

  /**
   * Find the currently active slide section.
   * - Normal mode: nested <section> inside a stack
   * - Mix mode: top-level <section>
   */
  function getCurrentSlide() {
    // Nested (normal mode): the inner .present within the horizontal .present
    return document.querySelector('#slideshow-screen .reveal section.present > section.present') ||
           // Flat (mix mode): top-level .present
           document.querySelector('#slideshow-screen .reveal .slides > section.present');
  }

  /**
   * Read the current slide's data attributes and update the
   * persistent chrome overlay.
   */
  function updateSlideChrome() {
    const slide = getCurrentSlide();
    if (!slide) return;

    const isIntro = slide.dataset.isIntro === 'true';

    // Unit badge (with level-specific color class)
    const unitBadge = document.getElementById('chrome-unit');
    if (unitBadge) {
      unitBadge.textContent = slide.dataset.unitLabel || '';
      unitBadge.className = `unit-badge unit-badge-${slide.dataset.levelId || 'L1'}`;
      unitBadge.classList.toggle('hidden', isIntro);
    }

    // Progress counter
    const progressBadge = document.getElementById('chrome-progress');
    if (progressBadge) {
      progressBadge.textContent = slide.dataset.progress || '';
      progressBadge.classList.toggle('hidden', isIntro);
    }

    // Audio button
    const audioBtn = document.getElementById('chrome-audio');
    if (audioBtn) {
      const isQuiz = slide.dataset.quizMode === 'true';
      const isAnswered = slide.dataset.answered === 'true';
      const hideAudio = isIntro || (isQuiz && !isAnswered);
      audioBtn.classList.toggle('hidden', hideAudio);
    }
  }

  // ── Initialize Reveal.js ───────────────────────────────────
  function initReveal(isMixMode) {
    // Destroy previous instance if exists
    if (revealInstance) {
      try { revealInstance.destroy(); } catch (e) { /* ignore */ }
      revealInstance = null;
    }

    // Build the persistent chrome overlay
    initSlideChrome();

    const deck = document.querySelector('#slideshow-screen .reveal');

    revealInstance = new Reveal(deck, {
      // Navigation — linear in mix mode, grid (synced) or default in normal mode
      navigationMode: isMixMode ? 'linear' : (options.syncSlides ? 'grid' : 'default'),
      controls: true,
      controlsTutorial: true,
      controlsLayout: 'bottom-right',

      // Behavior
      hash: false,
      history: false,
      overview: false,
      loop: false,
      shuffle: false,
      center: false,

      // Appearance
      transition: 'slide',
      transitionSpeed: 'default',
      backgroundTransition: 'fade',
      progress: false,
      slideNumber: false,

      // Disable default keyboard for Space/Enter (we use them for audio)
      // and map Escape (27) to backToMenu()
      keyboard: {
        32: () => { revealOrPlayCurrentSlideAudio(); },  // Space
        13: () => { revealOrPlayCurrentSlideAudio(); },  // Enter
        27: () => { backToMenu(); }                      // Esc
      },

      // Touch — let reveal.js handle swipe gestures natively
      touch: true,

      // Disable scroll view on small/mobile screens — always use slide view
      // so swipe navigation and controls work properly
      scrollActivationWidth: 0,
    });

    revealInstance.initialize().then(() => {
      // Update chrome after reveal.js has set up the .present classes
      updateSlideChrome();
    });

    // Wire up sync button click
    const syncBtn = document.getElementById('toggle-sync');
    if (syncBtn) {
      syncBtn.onclick = (e) => {
        e.stopPropagation();
        options.syncSlides = !options.syncSlides;
        syncBtn.classList.toggle('active', options.syncSlides);
        localStorage.setItem('phonics-flash-sync', options.syncSlides);
        if (revealInstance && !isMixMode) {
          revealInstance.configure({
            navigationMode: options.syncSlides ? 'grid' : 'default'
          });
        }
      };
    }

    // Update chrome (instantly) whenever the slide changes
    revealInstance.on('slidechanged', () => {
      AudioPlayer.stop();
      updateSlideChrome();
    });

    // Click/tap on word text plays audio, click/tap background advances slide
    deck.addEventListener('click', handleSlideClick);
  }

  // ── Select a Choice / Reveal Quiz ──────────────────────────
  function revealQuizAnswer(slide, clickedBtn = null) {
    if (slide.dataset.answered === 'true') return;

    slide.dataset.answered = 'true';

    const correctWord = slide.dataset.word;
    const buttons = slide.querySelectorAll('.quiz-option-btn');
    buttons.forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.word === correctWord) {
        btn.classList.add('correct');
      } else if (clickedBtn && btn === clickedBtn) {
        btn.classList.add('incorrect');
      }
    });

    playCurrentSlideAudio();
    updateSlideChrome(); // Shows the audio button
  }

  // ── Slide Interaction ──────────────────────────────────────
  // Desktop click fallback (touch devices use touchend above)
  function handleSlideClick(e) {
    const isControl = e.target.closest('.controls');
    if (isControl) return;

    const currentSlide = getCurrentSlide();
    if (!currentSlide) return;

    // Advance slide if clicking on intro slide
    if (currentSlide.dataset.isIntro === 'true') {
      if (revealInstance) {
        revealInstance.next();
      }
      return;
    }

    // Quiz Mode Interaction
    if (currentSlide.dataset.quizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        e.preventDefault();
        e.stopPropagation();
        const clickedOption = e.target.closest('.quiz-option-btn');
        revealQuizAnswer(currentSlide, clickedOption);
      } else {
        if (revealInstance) {
          revealInstance.next();
        }
      }
      return;
    }

    // Dictation/Normal Mode Interaction
    const wordTextElement = currentSlide.querySelector('.word-text');
    if (wordTextElement && wordTextElement.classList.contains('dictation-hide')) {
      e.preventDefault();
      e.stopPropagation();
      wordTextElement.classList.remove('dictation-hide');
      playCurrentSlideAudio();
      return;
    }

    const wordText = e.target.closest('.word-text');
    if (wordText) {
      e.preventDefault();
      e.stopPropagation();
      playCurrentSlideAudio();
    } else {
      if (revealInstance) {
        revealInstance.next();
      }
    }
  }

  function revealOrPlayCurrentSlideAudio() {
    const currentSlide = getCurrentSlide();
    if (!currentSlide) return;

    // Advance slide if pressing key on intro slide
    if (currentSlide.dataset.isIntro === 'true') {
      if (revealInstance) {
        revealInstance.next();
      }
      return;
    }

    // Quiz Mode Keyboard Handling
    if (currentSlide.dataset.quizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        revealQuizAnswer(currentSlide);
      } else {
        if (revealInstance) {
          revealInstance.next();
        }
      }
      return;
    }

    const wordTextElement = currentSlide.querySelector('.word-text');
    if (wordTextElement && wordTextElement.classList.contains('dictation-hide')) {
      wordTextElement.classList.remove('dictation-hide');
      playCurrentSlideAudio();
      return;
    }

    playCurrentSlideAudio();
  }

  function playCurrentSlideAudio() {
    const currentSlide = getCurrentSlide();
    if (!currentSlide) return;

    const word = currentSlide.dataset.word;
    const audioPath = currentSlide.dataset.audioPath || '';

    AudioPlayer.playWord(word, audioPath || undefined);
  }

  // ── Back to Menu ───────────────────────────────────────────
  function backToMenu() {
    AudioPlayer.stop();
    AudioPlayer.clearCache();

    if (revealInstance) {
      const deck = document.querySelector('#slideshow-screen .reveal');
      deck.removeEventListener('click', handleSlideClick);
      try { revealInstance.destroy(); } catch (e) { /* ignore */ }
      revealInstance = null;
    }

    // Clean up sync toggle listeners
    const syncBtn = document.getElementById('toggle-sync');
    if (syncBtn) {
      syncBtn.onclick = null;
    }

    // Clear the chrome overlay
    const chrome = document.getElementById('slideshow-chrome');
    if (chrome) chrome.innerHTML = '';

    document.getElementById('slideshow-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');

    // Repopulate menu (especially important if launched via bookmark URL)
    renderMenu();

    // Clear URL params (theme is saved in localStorage, not needed in URL)
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  // ── Utilities ──────────────────────────────────────────────
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── Toast Notification System ──────────────────────────────
  function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Choose svg icon based on toast type
    let icon = '';
    if (type === 'error') {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (type === 'success') {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    } else if (type === 'warning') {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    } else {
      icon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;
    container.appendChild(toast);

    // Auto-remove toast
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      }, 300);
    }, duration);
  }

  // Expose toast function globally
  window.showToast = showToast;

  // ── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
