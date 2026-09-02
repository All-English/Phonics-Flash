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

  function normalizeLetterCase(val) {
    if (!val) return 'both';
    const lower = val.toLowerCase();
    if (['both', 'separate', 'upper', 'lower'].includes(lower)) return lower;
    if (lower === 'split' || lower === 'both-separate' || lower === 'independent') return 'separate';
    if (lower === 'a' || lower === 'upper') return 'upper';
    if (lower === 'lower') return 'lower';
    if (lower === 'aa') return 'both';
    return 'both';
  }

  const options = {
    includeExtras: localStorage.getItem('phonics-flash-extras') === 'true',
    includeSightWords: localStorage.getItem('phonics-flash-sight') === 'true',
    includeImages: localStorage.getItem('phonics-flash-images') === 'true',
    letterCase: normalizeLetterCase(localStorage.getItem('phonics-flash-letter-case') || 'both'),
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

    // Check auto-schedule matching for classes
    if (typeof ClassesManager !== 'undefined') {
      const scheduledClass = ClassesManager.findCurrentScheduledClass();
      if (scheduledClass) {
        ClassesManager.setActiveClassId(scheduledClass.id);
        applyClassProfile(scheduledClass);
        showToast(`⏰ Auto-selected: ${scheduledClass.name}`, 'info', 4000);
      } else {
        const activeClass = ClassesManager.getActiveClass();
        if (activeClass) {
          applyClassProfile(activeClass);
        }
      }
      initClassesUI();

      // Cloud pull in background if configured
      ClassesManager.syncCloud().then(res => {
        if (res && res.success && res.source === 'remote_loaded') {
          initClassesUI();
        }
      }).catch(console.warn);
    }

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
      if (urlConfig.isChart) {
        options.letterCase = urlConfig.letterCase;
        openLetterChart(urlConfig.unitIds.length > 0 ? urlConfig.unitIds : null);
        return;
      }

      let qm = urlConfig.quiz;
      let dm = urlConfig.dictation;
      if (qm && dm) {
        dm = false; // Quiz Mode takes priority
      }
      startSlideshow(urlConfig.unitIds, {
        includeExtras: urlConfig.extras,
        includeSightWords: urlConfig.sightWords,
        includeImages: urlConfig.images,
        letterCase: urlConfig.letterCase,
        mixMode: urlConfig.mix,
        dictationMode: dm,
        quizMode: qm
      });
    } else {
      renderMenu();
    }
  }

  // ── Class Profile Application ──────────────────────────────
  function applyClassProfile(cls) {
    if (!cls) return;

    if (cls.options) {
      options.includeExtras = !!cls.options.includeExtras;
      options.includeSightWords = !!cls.options.includeSightWords;
      options.includeImages = cls.options.includeImages !== false;
      options.letterCase = normalizeLetterCase(cls.options.letterCase || 'both');
      options.mixMode = !!cls.options.mixMode;
      options.dictationMode = !!cls.options.dictationMode;
      options.quizMode = !!cls.options.quizMode;

      localStorage.setItem('phonics-flash-extras', options.includeExtras);
      localStorage.setItem('phonics-flash-sight', options.includeSightWords);
      localStorage.setItem('phonics-flash-images', options.includeImages);
      localStorage.setItem('phonics-flash-letter-case', options.letterCase);
      localStorage.setItem('phonics-flash-mix', options.mixMode);
      localStorage.setItem('phonics-flash-dictation', options.dictationMode);
      localStorage.setItem('phonics-flash-quiz', options.quizMode);
    }

    if (Array.isArray(cls.selectedUnits)) {
      localStorage.setItem('phonics-flash-selected-units', JSON.stringify(cls.selectedUnits));
    }

    const select = document.getElementById('class-select');
    if (select) {
      select.value = cls.id;
    }

    if (phonicsData) {
      renderMenu();
    }
  }

  function saveCurrentOptionsToActiveClass() {
    if (typeof ClassesManager !== 'undefined') {
      const selectedIds = getSelectedUnitIds();
      ClassesManager.saveCurrentToActiveClass(selectedIds, options);
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
    const units = params.get('units') || params.get('u');
    const qParam = params.get('q');
    const chartParam = params.get('chart') || params.get('mode');

    const isChart = chartParam === '1' || chartParam === 'chart' || qParam === 'chart' || qParam === '1';

    // If neither units nor chart query is specified, return null
    if (!units && !isChart) return null;

    const caseParam = params.get('case') || params.get('c');

    return {
      isChart: isChart,
      unitIds: units ? units.split(/[,-]/).map(s => s.trim()).filter(Boolean) : [],
      extras: params.get('extras') === '1',
      sightWords: params.get('sight') === '1' || params.get('sightwords') === '1',
      images: params.get('images') !== '0', // default true
      letterCase: caseParam ? normalizeLetterCase(caseParam) : (localStorage.getItem('phonics-flash-letter-case') || 'both'),
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
    if (opts.includeSightWords) params.set('sight', '1');
    if (!opts.includeImages) params.set('images', '0');
    if (opts.letterCase && opts.letterCase !== 'both') params.set('case', opts.letterCase);
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

  // Helper to sync letter case buttons with state
  function syncCaseButtons(activeCase) {
    const btns = document.querySelectorAll('.case-btn');
    btns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.case === activeCase);
    });
  }

  // Wire up toggles and buttons once on initialization
  function initMenuEvents() {
    document.getElementById('toggle-extras').addEventListener('click', (e) => {
      options.includeExtras = !options.includeExtras;
      syncOptionButton('toggle-extras', options.includeExtras);
      localStorage.setItem('phonics-flash-extras', options.includeExtras);
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    document.getElementById('toggle-sight').addEventListener('click', (e) => {
      options.includeSightWords = !options.includeSightWords;
      syncOptionButton('toggle-sight', options.includeSightWords);
      localStorage.setItem('phonics-flash-sight', options.includeSightWords);
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    document.getElementById('toggle-images').addEventListener('click', (e) => {
      options.includeImages = !options.includeImages;
      syncOptionButton('toggle-images', options.includeImages);
      localStorage.setItem('phonics-flash-images', options.includeImages);
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    document.getElementById('toggle-mix').addEventListener('click', (e) => {
      options.mixMode = !options.mixMode;
      syncOptionButton('toggle-mix', options.mixMode);
      localStorage.setItem('phonics-flash-mix', options.mixMode);
      saveCurrentOptionsToActiveClass();
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
      saveCurrentOptionsToActiveClass();
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
      saveCurrentOptionsToActiveClass();
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
        options.includeSightWords = false;
        options.includeImages = false;
        options.letterCase = 'both';
        options.mixMode = false;
        options.dictationMode = false;
        options.quizMode = false;

        syncOptionButton('toggle-extras', false);
        syncOptionButton('toggle-sight', false);
        syncOptionButton('toggle-images', false);
        syncCaseButtons('both');
        syncOptionButton('toggle-mix', false);
        syncOptionButton('toggle-dictation', false);
        syncOptionButton('toggle-quiz', false);

        localStorage.setItem('phonics-flash-extras', 'false');
        localStorage.setItem('phonics-flash-sight', 'false');
        localStorage.setItem('phonics-flash-images', 'false');
        localStorage.setItem('phonics-flash-letter-case', 'both');
        localStorage.setItem('phonics-flash-mix', 'false');
        localStorage.setItem('phonics-flash-dictation', 'false');
        localStorage.setItem('phonics-flash-quiz', 'false');

        saveCurrentOptionsToActiveClass();

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
    syncOptionButton('toggle-sight', options.includeSightWords);
    syncOptionButton('toggle-images', options.includeImages);
    syncCaseButtons(options.letterCase);
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
        ${level.id === 'L1' ? `
          <div class="level-tools-bar">
            <div class="case-selector-group" title="Select letter casing for Level 1">
              <span class="case-label">Letter Case:</span>
              <div class="case-btn-group">
                <button class="case-btn ${options.letterCase === 'both' ? 'active' : ''}" data-case="both" title="Both side-by-side (Aa)">Aa</button>
                <button class="case-btn ${options.letterCase === 'separate' ? 'active' : ''}" data-case="separate" title="Both independent slides (A & a)">A &amp; a</button>
                <button class="case-btn ${options.letterCase === 'upper' ? 'active' : ''}" data-case="upper" title="Uppercase only (A)">A</button>
                <button class="case-btn ${options.letterCase === 'lower' ? 'active' : ''}" data-case="lower" title="Lowercase only (a)">a</button>
              </div>
            </div>
            <button class="chart-launch-btn" title="Open full screen letter chart for selected Level 1 units">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              <span>Letter Chart</span>
            </button>
          </div>
        ` : ''}
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

    // Level 1 specific handlers (Case buttons & Chart Launch button)
    if (level.id === 'L1') {
      card.querySelectorAll('.case-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const selectedCase = normalizeLetterCase(btn.dataset.case);
          options.letterCase = selectedCase;
          syncCaseButtons(selectedCase);
          localStorage.setItem('phonics-flash-letter-case', selectedCase);
          saveCurrentOptionsToActiveClass();
          updateStartButton();
        });
      });

      const chartBtn = card.querySelector('.chart-launch-btn');
      if (chartBtn) {
        chartBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openLetterChart();
        });
      }
    }

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
    saveCurrentOptionsToActiveClass();
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

  /**
   * Transforms and deduplicates words for a unit according to opts (Images, LetterCase).
   */
  function prepareUnitWords(unit, isExtra = false, opts = options) {
    const rawWords = isExtra ? (unit.extraWords || []) : (unit.words || []);
    if (!rawWords || rawWords.length === 0) return [];

    const isL1 = unit.levelId === 'L1' || (unit.id && unit.id.startsWith('L1'));

    let words = rawWords.map(w => ({ ...w, isExtra }));

    // If Level 1 and Images are disabled, deduplicate identical letters
    if (isL1 && !opts.includeImages) {
      const seen = new Set();
      words = words.filter(w => {
        const key = (w.word || '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Apply Letter Casing
    const letterCase = opts.letterCase || 'both';

    if (isL1) {
      if (letterCase === 'separate') {
        // Expand each word into two separate entries: Uppercase and Lowercase
        const expanded = [];
        words.forEach(w => {
          const baseChar = w.word ? w.word.charAt(0) : '';
          expanded.push({
            ...w,
            word: baseChar.toUpperCase()
          });
          expanded.push({
            ...w,
            word: baseChar.toLowerCase()
          });
        });
        return expanded;
      } else if (letterCase === 'upper') {
        return words.map(w => ({
          ...w,
          word: w.word ? w.word.charAt(0).toUpperCase() : w.word
        }));
      } else if (letterCase === 'lower') {
        return words.map(w => ({
          ...w,
          word: w.word ? w.word.charAt(0).toLowerCase() : w.word
        }));
      } else {
        // 'both' -> e.g. "Aa"
        return words.map(w => {
          if (w.word && w.word.length >= 1) {
            const first = w.word.charAt(0).toUpperCase();
            const second = (w.word.length > 1 ? w.word.charAt(1) : w.word.charAt(0)).toLowerCase();
            return { ...w, word: first + second };
          }
          return w;
        });
      }
    }

    return words;
  }

  function prepareUnitSightWords(unit) {
    if (!unit || !unit.sightWords || unit.sightWords.length === 0) return [];
    return unit.sightWords.map(sw => {
      if (typeof sw === 'string') {
        return { word: sw, isSightWord: true };
      }
      return { ...sw, isSightWord: true };
    });
  }

  function countWords(unitIds) {
    let count = 0;
    const selectedSightWords = [];

    for (const level of phonicsData.levels) {
      for (const unit of level.units) {
        if (unitIds.includes(unit.id)) {
          const unitWithLevel = { ...unit, levelId: level.id, levelName: level.name };
          const mainWords = prepareUnitWords(unitWithLevel, false, options);
          count += mainWords.length;
          if (options.includeExtras && unit.extraWords) {
            const extraWords = prepareUnitWords(unitWithLevel, true, options);
            count += extraWords.length;
          }
          if (options.includeSightWords && unit.sightWords) {
            const sightWords = prepareUnitSightWords(unitWithLevel);
            if (options.mixMode) {
              selectedSightWords.push(...sightWords);
            } else {
              count += sightWords.length;
            }
          }
        }
      }
    }

    if (options.includeSightWords && options.mixMode && selectedSightWords.length > 0) {
      // Deduplicate sight words across selected units in Mix Mode
      const seen = new Set();
      const uniqueSight = selectedSightWords.filter(sw => {
        const key = (sw.word || '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      count += uniqueSight.length;
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
    container.appendChild(createIntroSlide(units, opts));

    units.forEach(unit => {
      const unitSection = document.createElement('section');

      // Main words (shuffled)
      const mainWords = prepareUnitWords(unit, false, opts);
      shuffleArray(mainWords);

      // Extra words (shuffled)
      let extraWords = [];
      if (opts.includeExtras && unit.extraWords && unit.extraWords.length > 0) {
        extraWords = prepareUnitWords(unit, true, opts);
        shuffleArray(extraWords);
      }

      // Sight words (shuffled) placed at the end of the unit
      let sightWords = [];
      if (opts.includeSightWords && unit.sightWords && unit.sightWords.length > 0) {
        sightWords = prepareUnitSightWords(unit);
        shuffleArray(sightWords);
      }

      const words = [...mainWords, ...extraWords, ...sightWords];

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
    container.appendChild(createIntroSlide(units, opts));

    // Prepare main words queues per unit (shuffled)
    const mainQueues = units.map(unit => {
      const words = prepareUnitWords(unit, false, opts);
      shuffleArray(words);
      return { unit, words };
    });

    // Round-robin interleave main words
    const interleavedMain = interleaveRoundRobin(mainQueues);

    // Prepare extra words queues per unit (shuffled)
    let interleavedExtra = [];
    if (opts.includeExtras) {
      const extraQueues = units.map(unit => {
        const words = prepareUnitWords(unit, true, opts);
        shuffleArray(words);
        return { unit, words };
      });
      // Round-robin interleave extra words
      interleavedExtra = interleaveRoundRobin(extraQueues);

      // Prevent back-to-back same unit at the boundary between main and extra words
      if (interleavedMain.length > 0 && interleavedExtra.length > 0) {
        const lastMainUnitId = interleavedMain[interleavedMain.length - 1].unit.id;
        if (interleavedExtra[0].unit.id === lastMainUnitId) {
          const swapIdx = interleavedExtra.findIndex(item => item.unit.id !== lastMainUnitId);
          if (swapIdx > 0) {
            [interleavedExtra[0], interleavedExtra[swapIdx]] = [interleavedExtra[swapIdx], interleavedExtra[0]];
          }
        }
      }
    }

    // Prepare sight words (deduplicated across all selected units)
    let interleavedSight = [];
    if (opts.includeSightWords) {
      const allSightWords = [];
      units.forEach(unit => {
        if (unit.sightWords && unit.sightWords.length > 0) {
          const sws = prepareUnitSightWords(unit);
          sws.forEach(sw => {
            allSightWords.push({ wordData: sw, unit });
          });
        }
      });

      // Deduplicate sight words by word string (case-insensitive)
      const seen = new Set();
      const uniqueSightItems = allSightWords.filter(item => {
        const key = (item.wordData.word || '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      shuffleArray(uniqueSightItems);
      interleavedSight = uniqueSightItems;
    }

    const interleaved = [...interleavedMain, ...interleavedExtra, ...interleavedSight];

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

  // ── Create the Intro Welcome Slide (Combined Option 1 & 2) ──
  function createIntroSlide(units = [], opts = options) {
    const section = document.createElement('section');
    section.classList.add('word-slide', 'intro-slide');

    // Store metadata indicating this is the intro slide
    section.dataset.word = '';
    section.dataset.audioPath = '';
    section.dataset.unitLabel = '';
    section.dataset.progress = 'Start';
    section.dataset.isIntro = 'true';

    // Build unit review cards with target sounds
    const unitPills = units.map(u => {
      const sound = u.targetSound || u.sound || '';
      return `
        <div class="intro-unit-card slide-bg-${u.levelId || 'L1'}">
          <div class="intro-unit-level">${u.levelName || ''}</div>
          <div class="intro-unit-name">${u.name || ''}</div>
          ${sound ? `<div class="intro-target-sound">Target Sound: <span>${sound}</span></div>` : ''}
        </div>
      `;
    }).join('');

    // Additional mode tags
    const modeTags = [];
    if (opts && opts.mixMode) modeTags.push('🔀 Mix Mode');
    if (opts && opts.dictationMode) modeTags.push('✍️ Dictation');
    if (opts && opts.quizMode) modeTags.push('❓ Quiz Mode');
    if (opts && opts.includeSightWords) modeTags.push('👁️ Sight Words');
    if (opts && opts.includeExtras) modeTags.push('★ Extra Words');

    const modeBadgesHTML = modeTags.length > 0
      ? `<div class="intro-modes-row">${modeTags.map(t => `<span class="intro-mode-pill">${t}</span>`).join('')}</div>`
      : '';

    section.innerHTML = `
      <div class="slide-center intro-content">
        <div class="intro-hero-icon" aria-hidden="true">
          <div class="intro-icon-glow"></div>
          <span class="intro-icon-emoji">📖</span>
        </div>

        <h1 class="intro-title" aria-label="Practice Time!">
          <span class="intro-word">
            <span class="wave-letter" style="--i:1"><span class="wave-letter-inner">P</span></span>
            <span class="wave-letter" style="--i:2"><span class="wave-letter-inner">R</span></span>
            <span class="wave-letter" style="--i:3"><span class="wave-letter-inner">A</span></span>
            <span class="wave-letter" style="--i:4"><span class="wave-letter-inner">C</span></span>
            <span class="wave-letter" style="--i:5"><span class="wave-letter-inner">T</span></span>
            <span class="wave-letter" style="--i:6"><span class="wave-letter-inner">I</span></span>
            <span class="wave-letter" style="--i:7"><span class="wave-letter-inner">C</span></span>
            <span class="wave-letter" style="--i:8"><span class="wave-letter-inner">E</span></span>
          </span>
          <span class="intro-word-space">&nbsp;</span>
          <span class="intro-word">
            <span class="wave-letter" style="--i:9"><span class="wave-letter-inner">T</span></span>
            <span class="wave-letter" style="--i:10"><span class="wave-letter-inner">I</span></span>
            <span class="wave-letter" style="--i:11"><span class="wave-letter-inner">M</span></span>
            <span class="wave-letter" style="--i:12"><span class="wave-letter-inner">E</span></span>
            <span class="wave-letter" style="--i:13"><span class="wave-letter-inner">!</span></span>
          </span>
        </h1>

        <div class="intro-overview-panel">
          <div class="intro-panel-header">
            <span class="intro-panel-title">🎯 Today's Target Sounds &amp; Units</span>
            ${modeBadgesHTML}
          </div>
          <div class="intro-units-grid ${units.length > 3 ? 'compact' : ''}">
            ${unitPills}
          </div>
        </div>

        <div class="intro-cta-wrapper">
          <button class="intro-start-cta" type="button" aria-label="Start Practice">
            <span class="cta-pulse"></span>
            <span>Let's Read! ▶</span>
          </button>
          <p class="intro-hint">Press <kbd>Space</kbd>, <kbd>Enter</kbd>, <kbd>→</kbd> or click anywhere to begin</p>
        </div>
      </div>
    `;

    return section;
  }

  // ── Select a Distractor Word ────────────────────────────────
  function getDistractorWord(wordData, unit, opts) {
    let unitWords = prepareUnitWords(unit, false, opts);
    if (opts.includeExtras && unit.extraWords) {
      unitWords = [...unitWords, ...prepareUnitWords(unit, true, opts)];
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
        const uWithLevel = { ...u, levelId: level.id, levelName: level.name };
        levelWords = [...levelWords, ...prepareUnitWords(uWithLevel, false, opts)];
        if (opts.includeExtras && u.extraWords) {
          levelWords = [...levelWords, ...prepareUnitWords(uWithLevel, true, opts)];
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
    if (wordData.isSightWord) section.dataset.sightWord = 'true';

    const hasImage = !!wordData.image;
    const isSightWord = !!wordData.isSightWord;

    if (opts && opts.quizMode) {
      section.dataset.quizMode = "true";
      section.dataset.answered = "false";

      const distractor = getDistractorWord(wordData, unit, opts);
      const choices = [wordData.word, distractor];
      shuffleArray(choices);

      section.innerHTML = `
        <div class="slide-center quiz-mode-layout">
          ${isSightWord ? '<div class="sight-word-badge">Sight Word</div>' : ''}
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

      // Only render the word (+ optional image + optional sight word badge) — no chrome
      section.innerHTML = `
        <div class="slide-center">
          ${isSightWord ? '<div class="sight-word-badge">Sight Word</div>' : ''}
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

  // ── Letter Chart Mode (Level 1 Fullscreen Grid) ───────────
  let chartKeyboardHandler = null;
  let currentChartIndex = -1;

  function updateChartURL(targetUnits) {
    const params = new URLSearchParams();
    params.set('q', 'chart');
    if (targetUnits && targetUnits.length > 0) {
      const allL1Count = phonicsData.levels.find(l => l.id === 'L1')?.units.length || 8;
      if (targetUnits.length < allL1Count) {
        params.set('units', targetUnits.map(u => u.id).join('-'));
      }
    }
    if (options.letterCase && options.letterCase !== 'both') {
      params.set('case', options.letterCase);
    }
    const newURL = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newURL);
  }

  function openLetterChart(customUnitIds = null) {
    const selectedIds = customUnitIds || getSelectedUnitIds();
    const l1Level = phonicsData.levels.find(l => l.id === 'L1');
    if (!l1Level) return;

    // Filter selected Level 1 units, or if none in Level 1 are selected, use all Level 1 units
    let targetUnits = l1Level.units.filter(u => selectedIds.includes(u.id));
    if (targetUnits.length === 0) {
      targetUnits = l1Level.units;
    }

    currentChartIndex = -1;

    // Update URL with q=chart
    updateChartURL(targetUnits);

    // Switch screen to chart-screen
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('slideshow-screen').classList.add('hidden');
    document.getElementById('chart-screen').classList.remove('hidden');

    // Render the grid
    renderLetterChartGrid(targetUnits);

    // Wire up header buttons inside chart screen
    const backBtn = document.getElementById('chart-back-btn');
    if (backBtn) {
      backBtn.onclick = closeLetterChart;
    }

    // Wire up case buttons inside chart screen
    const chartCaseBtns = document.querySelectorAll('#chart-screen .case-btn');
    chartCaseBtns.forEach(btn => {
      btn.onclick = () => {
        const selectedCase = normalizeLetterCase(btn.dataset.case);
        options.letterCase = selectedCase;
        syncCaseButtons(selectedCase);
        localStorage.setItem('phonics-flash-letter-case', selectedCase);
        updateStartButton();
        updateChartURL(targetUnits);
        currentChartIndex = -1;
        renderLetterChartGrid(targetUnits);
      };
    });

    // Wire up keyboard shortcuts (Arrow keys, letters a-z, Space/Enter, Escape)
    if (chartKeyboardHandler) {
      window.removeEventListener('keydown', chartKeyboardHandler);
    }
    chartKeyboardHandler = (e) => {
      if (e.key === 'Escape') {
        closeLetterChart();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateChart2D('right');
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateChart2D('left');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateChart2D('down');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateChart2D('up');
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (currentChartIndex >= 0) {
          setActiveChartTile(currentChartIndex, true);
        } else {
          setActiveChartTile(0, true);
        }
        return;
      }

      const char = e.key.toUpperCase();
      if (/^[A-Z]$/.test(char)) {
        const tiles = Array.from(document.querySelectorAll('#chart-grid .letter-tile'));
        const targetIndex = tiles.findIndex(t => t.dataset.baseLetter === char);
        if (targetIndex >= 0) {
          setActiveChartTile(targetIndex, true);
        }
      }
    };
    window.addEventListener('keydown', chartKeyboardHandler);
  }

  function setActiveChartTile(index, playAudio = true) {
    const tiles = Array.from(document.querySelectorAll('#chart-grid .letter-tile'));
    if (tiles.length === 0) return;

    if (index < 0) index = 0;
    if (index >= tiles.length) index = tiles.length - 1;

    currentChartIndex = index;

    tiles.forEach((t, i) => {
      t.classList.toggle('active-focus', i === currentChartIndex);
    });

    const targetTile = tiles[currentChartIndex];
    if (targetTile && playAudio) {
      playLetterTile(targetTile);
    }
  }

  function navigateChart2D(direction) {
    const rows = Array.from(document.querySelectorAll('#chart-grid .chart-row'));
    if (rows.length === 0) return;

    const allTiles = Array.from(document.querySelectorAll('#chart-grid .letter-tile'));
    if (allTiles.length === 0) return;

    if (currentChartIndex < 0) {
      setActiveChartTile(0, true);
      return;
    }

    const currentTile = allTiles[currentChartIndex];
    const currentRowEl = currentTile ? currentTile.closest('.chart-row') : null;
    const currentRowIndex = rows.indexOf(currentRowEl);
    const rowTiles = currentRowEl ? Array.from(currentRowEl.querySelectorAll('.letter-tile')) : [];
    const currentColIndex = rowTiles.indexOf(currentTile);

    if (direction === 'right') {
      const nextIndex = (currentChartIndex + 1) % allTiles.length;
      setActiveChartTile(nextIndex, true);
    } else if (direction === 'left') {
      const nextIndex = (currentChartIndex - 1 + allTiles.length) % allTiles.length;
      setActiveChartTile(nextIndex, true);
    } else if (direction === 'down') {
      const nextRowIndex = (currentRowIndex + 1) % rows.length;
      const nextRowTiles = Array.from(rows[nextRowIndex].querySelectorAll('.letter-tile'));
      const targetCol = Math.min(currentColIndex, nextRowTiles.length - 1);
      const targetTile = nextRowTiles[targetCol];
      const targetIndex = allTiles.indexOf(targetTile);
      setActiveChartTile(targetIndex, true);
    } else if (direction === 'up') {
      const prevRowIndex = (currentRowIndex - 1 + rows.length) % rows.length;
      const prevRowTiles = Array.from(rows[prevRowIndex].querySelectorAll('.letter-tile'));
      const targetCol = Math.min(currentColIndex, prevRowTiles.length - 1);
      const targetTile = prevRowTiles[targetCol];
      const targetIndex = allTiles.indexOf(targetTile);
      setActiveChartTile(targetIndex, true);
    }
  }

  function renderLetterChartGrid(targetUnits) {
    const grid = document.getElementById('chart-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Collect all unique base letters from the target units in order
    const letterMap = new Map();
    targetUnits.forEach(unit => {
      unit.words.forEach(w => {
        const baseLetter = w.word ? w.word.charAt(0).toUpperCase() : '';
        if (baseLetter && !letterMap.has(baseLetter)) {
          letterMap.set(baseLetter, {
            baseLetter: baseLetter,
            word: w.word,
            audio: w.audio || `media/SmartPhonics/1/sounds/SingleLetters/${baseLetter}${baseLetter.toLowerCase()}.mp3`
          });
        }
      });
    });

    const uniqueLetters = Array.from(letterMap.values());
    // Sort in standard alphabetical order
    uniqueLetters.sort((a, b) => a.baseLetter.localeCompare(b.baseLetter));

    // Determine letter items based on active case
    const letterCase = options.letterCase || 'both';
    let displayItems = [];

    if (letterCase === 'separate') {
      uniqueLetters.forEach(item => {
        displayItems.push({
          displayText: item.baseLetter.toUpperCase(),
          baseLetter: item.baseLetter,
          audio: item.audio
        });
        displayItems.push({
          displayText: item.baseLetter.toLowerCase(),
          baseLetter: item.baseLetter,
          audio: item.audio
        });
      });
    } else if (letterCase === 'upper') {
      displayItems = uniqueLetters.map(item => ({
        displayText: item.baseLetter.toUpperCase(),
        baseLetter: item.baseLetter,
        audio: item.audio
      }));
    } else if (letterCase === 'lower') {
      displayItems = uniqueLetters.map(item => ({
        displayText: item.baseLetter.toLowerCase(),
        baseLetter: item.baseLetter,
        audio: item.audio
      }));
    } else {
      // 'both'
      displayItems = uniqueLetters.map(item => ({
        displayText: item.baseLetter.toUpperCase() + item.baseLetter.toLowerCase(),
        baseLetter: item.baseLetter,
        audio: item.audio
      }));
    }

    // Update count badge
    const badge = document.getElementById('chart-count-badge');
    if (badge) {
      badge.textContent = `${displayItems.length} Letter${displayItems.length > 1 ? 's' : ''}`;
    }

    // Update case button active state in chart header
    syncCaseButtons(letterCase);

    // Calculate balanced row distribution
    const rowCounts = calculateRowDistribution(displayItems.length);
    grid.dataset.rows = rowCounts.length;

    let itemIndex = 0;
    rowCounts.forEach(count => {
      const rowEl = document.createElement('div');
      rowEl.className = 'chart-row';

      for (let i = 0; i < count; i++) {
        if (itemIndex >= displayItems.length) break;
        const currentIdx = itemIndex;
        const item = displayItems[itemIndex++];

        const tile = document.createElement('div');
        tile.className = 'letter-tile';
        tile.dataset.baseLetter = item.baseLetter;
        tile.dataset.audio = item.audio;
        tile.dataset.text = item.displayText;
        tile.dataset.tileIndex = currentIdx;
        tile.innerHTML = `<span class="letter-tile-text">${item.displayText}</span>`;

        tile.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveChartTile(currentIdx, true);
        });

        rowEl.appendChild(tile);
      }

      grid.appendChild(rowEl);
    });
  }

  function calculateRowDistribution(totalItems) {
    if (totalItems <= 4) {
      return [totalItems];
    }
    let numRows = 2;
    if (totalItems <= 8) numRows = 2;
    else if (totalItems <= 18) numRows = 3;
    else if (totalItems <= 28) numRows = 4;
    else if (totalItems <= 42) numRows = 5;
    else numRows = 6;

    const base = Math.floor(totalItems / numRows);
    const remainder = totalItems % numRows;
    const distribution = [];
    for (let r = 0; r < numRows; r++) {
      distribution.push(r < remainder ? base + 1 : base);
    }
    return distribution;
  }

  function playLetterTile(tile) {
    if (!tile) return;

    // Visual pulse
    tile.classList.remove('playing');
    void tile.offsetWidth; // trigger reflow
    tile.classList.add('playing');
    setTimeout(() => {
      tile.classList.remove('playing');
    }, 600);

    const audioPath = tile.dataset.audio;
    const text = tile.dataset.text;
    AudioPlayer.playWord(text, audioPath || undefined);
  }

  function closeLetterChart() {
    AudioPlayer.stop();
    if (chartKeyboardHandler) {
      window.removeEventListener('keydown', chartKeyboardHandler);
      chartKeyboardHandler = null;
    }
    currentChartIndex = -1;
    document.getElementById('chart-screen').classList.add('hidden');
    document.getElementById('menu-screen').classList.remove('hidden');
    renderMenu();

    // Clear URL params (theme is saved in localStorage, not needed in URL)
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  // ── Classes & Schedule UI Management ──────────────────────
  function initClassesUI() {
    const classSelect = document.getElementById('class-select');
    const manageBtn = document.getElementById('manage-classes-btn');
    const quickSyncBtn = document.getElementById('quick-cloud-sync-btn');
    const modal = document.getElementById('class-modal');
    const closeBtn = document.getElementById('modal-close-btn');
    const tabBtns = document.querySelectorAll('.modal-tab-btn');
    const addClassBtn = document.getElementById('add-class-btn');
    const classForm = document.getElementById('class-form');
    const cancelFormBtn = document.getElementById('form-cancel-btn');
    const saveUpstashBtn = document.getElementById('save-upstash-btn');
    const exportBtn = document.getElementById('export-classes-btn');
    const importInput = document.getElementById('import-classes-input');

    function populateClassDropdown() {
      if (!classSelect || typeof ClassesManager === 'undefined') return;
      const classes = ClassesManager.getClasses();
      const activeClass = ClassesManager.getActiveClass();

      classSelect.innerHTML = `<option value="">General (No Class)</option>`;
      classes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        const daysStr = c.schedule?.days?.join('/') || 'No days';
        const timeStr = c.schedule?.startTime ? ` (${c.schedule.startTime})` : '';
        opt.textContent = `${c.name} [${daysStr}${timeStr}]`;
        classSelect.appendChild(opt);
      });

      if (activeClass) {
        classSelect.value = activeClass.id;
      } else {
        classSelect.value = "";
      }
    }

    // Populate dropdown initially
    populateClassDropdown();

    // Dropdown change
    if (classSelect) {
      classSelect.addEventListener('change', (e) => {
        const classId = e.target.value;
        if (!classId) {
          ClassesManager.setActiveClassId(null);
          showToast('Switched to General profile', 'info', 2000);
        } else {
          const cls = ClassesManager.getClasses().find(c => c.id === classId);
          if (cls) {
            ClassesManager.setActiveClassId(cls.id);
            applyClassProfile(cls);
            showToast(`🏫 Switched to: ${cls.name}`, 'success', 2500);
          }
        }
      });
    }

    // Manage button -> Open modal
    if (manageBtn && modal) {
      manageBtn.addEventListener('click', () => {
        openClassModal('classes-tab');
      });
    }

    // Quick Cloud Sync button
    if (quickSyncBtn) {
      quickSyncBtn.addEventListener('click', async () => {
        quickSyncBtn.classList.add('syncing');
        try {
          const res = await ClassesManager.syncCloud();
          if (res && res.success) {
            populateClassDropdown();
            showToast('☁️ Synced with Upstash Redis!', 'success', 3000);
          } else {
            showToast('Cloud sync skipped (check Upstash URL & Token in Manage Classes)', 'warning', 3500);
          }
        } catch (e) {
          showToast(`Sync error: ${e.message}`, 'error', 3000);
        } finally {
          quickSyncBtn.classList.remove('syncing');
        }
      });
    }

    // Modal close
    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }

    // Tab switching
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        switchModalTab(targetTab);
      });
    });

    function switchModalTab(tabId) {
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
      document.querySelectorAll('.modal-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === tabId);
      });

      if (tabId === 'classes-tab') {
        renderClassesListModal();
      } else if (tabId === 'sync-tab') {
        populateSyncForm();
      }
    }

    function openClassModal(tabId = 'classes-tab') {
      if (!modal) return;
      modal.classList.remove('hidden');
      switchModalTab(tabId);
    }

    function renderClassesListModal() {
      const container = document.getElementById('classes-list-container');
      if (!container || typeof ClassesManager === 'undefined') return;

      const classes = ClassesManager.getClasses();
      const activeClass = ClassesManager.getActiveClass();

      if (classes.length === 0) {
        container.innerHTML = `
          <div style="text-align:center;padding:2rem;color:var(--text-muted);">
            <p>No classes created yet.</p>
            <p style="margin-top:0.5rem;font-size:0.85rem;">Click "+ New Class" above to set up your schedule.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = '';
      classes.forEach(c => {
        const isActive = activeClass && activeClass.id === c.id;
        const daysStr = c.schedule?.days?.join(', ') || 'No days';
        const timeStr = `${c.schedule?.startTime || '15:00'} - ${c.schedule?.endTime || '15:50'}`;
        const unitCount = Array.isArray(c.selectedUnits) ? c.selectedUnits.length : 0;

        const card = document.createElement('div');
        card.className = `class-card-item ${isActive ? 'active-class' : ''}`;
        card.innerHTML = `
          <div class="class-card-info">
            <div class="class-card-name">
              <span>${c.name}</span>
              ${isActive ? '<span class="active-pill">Active</span>' : ''}
            </div>
            <div class="class-card-meta">
              <span>📅 ${daysStr}</span>
              <span>⏰ ${timeStr}</span>
              <span>📚 ${unitCount} unit${unitCount === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div class="class-card-actions">
            <button class="btn-icon-small edit-btn" title="Edit schedule">✏️ Edit</button>
            <button class="btn-icon-small select-btn" title="Select this class">✔️ Use</button>
            <button class="btn-icon-small delete delete-btn" title="Delete class">🗑️</button>
          </div>
        `;

        card.querySelector('.class-card-info').addEventListener('click', () => {
          ClassesManager.setActiveClassId(c.id);
          applyClassProfile(c);
          populateClassDropdown();
          modal.classList.add('hidden');
          showToast(`🏫 Active class: ${c.name}`, 'success', 2500);
        });

        card.querySelector('.select-btn').addEventListener('click', () => {
          ClassesManager.setActiveClassId(c.id);
          applyClassProfile(c);
          populateClassDropdown();
          modal.classList.add('hidden');
          showToast(`🏫 Active class: ${c.name}`, 'success', 2500);
        });

        card.querySelector('.edit-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          editClassForm(c);
        });

        card.querySelector('.delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Delete class "${c.name}"?`)) {
            ClassesManager.deleteClass(c.id);
            populateClassDropdown();
            renderClassesListModal();
            renderMenu();
          }
        });

        container.appendChild(card);
      });
    }

    function editClassForm(cls) {
      document.getElementById('form-class-id').value = cls ? cls.id : '';
      document.getElementById('form-class-name').value = cls ? cls.name : '';
      document.getElementById('form-start-time').value = cls?.schedule?.startTime || '15:00';
      document.getElementById('form-end-time').value = cls?.schedule?.endTime || '15:50';

      const selectedDays = cls?.schedule?.days || ['Mon', 'Wed', 'Fri'];
      document.querySelectorAll('#schedule-tab input[name="days"]').forEach(cb => {
        cb.checked = selectedDays.includes(cb.value);
      });

      switchModalTab('schedule-tab');
    }

    if (addClassBtn) {
      addClassBtn.addEventListener('click', () => {
        editClassForm(null);
      });
    }

    if (cancelFormBtn) {
      cancelFormBtn.addEventListener('click', () => {
        switchModalTab('classes-tab');
      });
    }

    if (classForm) {
      classForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const classId = document.getElementById('form-class-id').value;
        const name = document.getElementById('form-class-name').value.trim();
        const startTime = document.getElementById('form-start-time').value;
        const endTime = document.getElementById('form-end-time').value;
        const checkedDays = Array.from(document.querySelectorAll('#schedule-tab input[name="days"]:checked')).map(cb => cb.value);

        if (!name) return;

        if (classId) {
          // Update existing
          ClassesManager.updateClass(classId, {
            name,
            schedule: { days: checkedDays, startTime, endTime }
          });
          showToast(`Updated class "${name}"`, 'success', 2000);
        } else {
          // Add new class (captures currently selected units & options)
          const currentUnits = getSelectedUnitIds();
          const newCls = ClassesManager.addClass({
            name,
            schedule: { days: checkedDays, startTime, endTime },
            selectedUnits: currentUnits,
            options: { ...options }
          });
          showToast(`Created class "${name}"`, 'success', 2000);
        }

        populateClassDropdown();
        switchModalTab('classes-tab');
      });
    }

    // Cloud Sync Tab Setup
    function populateSyncForm() {
      const upstashCfg = ClassesManager.getUpstashConfig();
      const urlInput = document.getElementById('upstash-url-input');
      const tokenInput = document.getElementById('upstash-token-input');
      if (urlInput && upstashCfg?.url) urlInput.value = upstashCfg.url;
      if (tokenInput && upstashCfg?.token) tokenInput.value = upstashCfg.token;
    }

    if (saveUpstashBtn) {
      saveUpstashBtn.addEventListener('click', async () => {
        const url = document.getElementById('upstash-url-input').value.trim();
        const token = document.getElementById('upstash-token-input').value.trim();
        const msgSpan = document.getElementById('sync-status-msg');

        ClassesManager.setUpstashConfig(url, token);

        if (!url || !token) {
          msgSpan.textContent = 'Configuration cleared.';
          return;
        }

        msgSpan.textContent = 'Testing connection & syncing...';
        try {
          const res = await ClassesManager.syncCloud();
          if (res && res.success) {
            msgSpan.textContent = '✅ Connected and synced to Upstash!';
            msgSpan.style.color = '#3DAA5C';
            populateClassDropdown();
            showToast('Connected and synced to Upstash Redis!', 'success', 3000);
          } else {
            msgSpan.textContent = '⚠️ Cloud sync failed. Check URL & Token.';
            msgSpan.style.color = '#FF6B6B';
          }
        } catch (err) {
          msgSpan.textContent = `❌ Error: ${err.message}`;
          msgSpan.style.color = '#FF6B6B';
        }
      });
    }

    // Export JSON
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const json = ClassesManager.exportJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `phonics-flash-classes-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Classes backup exported!', 'success', 2000);
      });
    }

    // Import JSON
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
          const res = ClassesManager.importJSON(ev.target.result);
          if (res && res.success) {
            populateClassDropdown();
            renderClassesListModal();
            renderMenu();
            showToast(`Imported ${res.count} classes!`, 'success', 3000);
          } else {
            showToast(`Import failed: ${res.error}`, 'error', 4000);
          }
        };
        reader.readAsText(file);
      });
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
