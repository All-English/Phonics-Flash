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
  let slideshowKeydownHandler = null;
  let slideshowResizeHandler = null;

  function getRevealDimensions() {
    const isPortrait = window.innerHeight > window.innerWidth;
    return isPortrait
      ? { width: 700, height: 1200, margin: 0.04 }
      : { width: 960, height: 700, margin: 0.04 };
  }

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
    includeExtras: false,
    includeSightWords: false,
    sightWordsOnly: false,
    highlightSounds: true,
    includeImages: false,
    letterCase: 'both',
    mixMode: false,
    dictationMode: false,
    quizMode: false,
    soundQuizMode: false,
    pictureQuizMode: false,
    wordChart: false,
    syncSlides: true
  };

  // ── Phonics Engine Delegates ────────────────────────────────
  function highlightTargetSound(word, targetSoundStr, levelId) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.highlightTargetSound(word, targetSoundStr, levelId);
    }
    return word;
  }

  function getBlankedWord(word, targetSoundStr, levelId) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.getBlankedWord(word, targetSoundStr, levelId);
    }
    return word;
  }

  function getTargetSoundInfo(word, unit, opts = {}) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.getTargetSoundInfo(word, unit, opts, phonicsData);
    }
    return null;
  }

  // ── SVG Icons ──────────────────────────────────────────────
  const ICONS = {
    chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    speaker: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
    sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    shuffle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
    undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`
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

    // 1. Initialize EditorStore first so books & custom curricula are loaded into memory
    if (typeof EditorStore !== 'undefined') {
      try {
        await EditorStore.init();

        EditorStore.subscribe((activeBook) => {
          if (activeBook) {
            phonicsData = activeBook;
            if (window.PhonicsEngine) {
              PhonicsEngine.setPhonicsData(activeBook);
            }
            renderBookDropdown();
            renderMenu();
          }
        });
      } catch (e) {
        console.warn('[EditorStore] Init error:', e);
      }
    }

    // 2. Check auto-schedule matching for classes (can safely read EditorStore.getCurriculum())
    if (typeof ClassesManager !== 'undefined') {
      if (typeof SharedClassSync !== 'undefined') {
        try {
          await SharedClassSync.loadAllClasses();
        } catch (e) {
          console.warn('[ClassesManager] Error loading shared classes:', e);
        }
      }

      const scheduledClass = ClassesManager.findCurrentScheduledClass();
      if (scheduledClass) {
        ClassesManager.setActiveClassId(scheduledClass.id);
        applyClassProfile(scheduledClass);
      } else {
        ClassesManager.setActiveClassId(null);
        // Do not wipe saved units on startup (High #3)
      }
      initClassesUI();

      // Cloud pull in background if configured
      ClassesManager.syncCloud().then(res => {
        if (res && res.success && res.source === 'remote_loaded') {
          // Only auto-apply scheduled class if user has not explicitly navigated via URL or selected a book (High #5)
          const urlParams = new URLSearchParams(window.location.search);
          const hasExplicitParam = urlParams.has('book') || urlParams.has('b') || urlParams.has('units') || urlParams.has('q');
          const isMenuVisible = !document.getElementById('menu-screen')?.classList.contains('hidden');

          if (!hasExplicitParam && isMenuVisible && !ClassesManager.getActiveClassId()) {
            const scheduled = ClassesManager.findCurrentScheduledClass();
            if (scheduled) {
              ClassesManager.setActiveClassId(scheduled.id);
              applyClassProfile(scheduled);
            }
          }
          if (typeof populateClassDropdown === 'function') {
            populateClassDropdown();
          }
        }
      }).catch(console.warn);
    }

    // 3. Explicit book parameter in URL takes precedence (e.g. from editor "Preview in App" or bookmarks)
    if (typeof EditorStore !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const bookParam = urlParams.get('book') || urlParams.get('b');
      if (bookParam && EditorStore.getCurriculum(bookParam)) {
        EditorStore.setActiveCurriculum(bookParam);
      }
    }

    // Log audio engine configuration status to assist in debugging
    const effectiveKey = typeof AudioPlayer !== 'undefined' ? AudioPlayer.getApiKey() : null;
    if (effectiveKey) {
      const maskedKey = effectiveKey.substring(0, 8) + '...';
      console.log(
        `%c[Audio Engine]%c ElevenLabs API is active via browser storage. Key starts with: ${maskedKey}`,
        'font-weight:bold;color:#4ECDC4;',
        'color:#96CEB4;'
      );
    } else {
      console.log(
        '%c[Audio Engine]%c No ElevenLabs API key saved in browser storage. Fallback browser SpeechSynthesis is active.',
        'font-weight:bold;color:#4ECDC4;',
        'color:#FF6B6B;'
      );
    }

    try {
      phonicsData = await loadData();
      if (window.PhonicsEngine) {
        PhonicsEngine.setPhonicsData(phonicsData);
      }
      if (window.ChartScreen) {
        ChartScreen.init({
          getSelectedUnitIds: () => getSelectedUnitIds(),
          getOptions: () => options,
          getPhonicsData: () => phonicsData,
          onClose: () => {
            renderMenu();
          },
          onCaseChange: (selectedCase) => {
            options.letterCase = selectedCase;
            localStorage.setItem('phonics-flash-letter-case', selectedCase);
            syncCaseButtons(selectedCase);
          }
        });
      }
    } catch (err) {
      console.error('Failed to load phonics data:', err);
      document.getElementById('menu-screen').innerHTML =
        `<div style="text-align:center;padding:4rem;color:#FF6B6B;">
          <h2>Failed to load word data</h2>
          <p style="color:rgba(255,255,255,0.6);margin-top:1rem;">Check that <code>data/words.json</code> exists and is valid JSON.</p>
        </div>`;
      return;
    }

    // Initialize Book Selector
    renderBookDropdown();
    initBookSelect();

    // Check for URL parameters
    const urlConfig = parseURLParams();
    if (urlConfig) {
      if (urlConfig.isChart) {
        options.letterCase = urlConfig.letterCase;
        if (urlConfig.highlightSounds) options.highlightSounds = true;
        openChart(urlConfig.chartLevel || 'L1', urlConfig.unitIds.length > 0 ? urlConfig.unitIds : null);
        return;
      }

      let qm = urlConfig.quiz;
      let dm = urlConfig.dictation;
      let sqm = urlConfig.soundQuiz;
      let pqm = urlConfig.pictureQuiz;
      if (pqm) {
        qm = false;
        dm = false;
        sqm = false;
      } else if (sqm && (qm || dm)) {
        qm = false;
        dm = false;
      } else if (qm && dm) {
        dm = false; // Word Quiz takes priority
      }
      startSlideshow(urlConfig.unitIds, {
        includeExtras: urlConfig.extras,
        includeSightWords: urlConfig.sightWords,
        sightWordsOnly: urlConfig.sightWordsOnly,
        highlightSounds: urlConfig.highlightSounds,
        includeImages: urlConfig.images,
        letterCase: urlConfig.letterCase,
        mixMode: urlConfig.mix,
        dictationMode: dm,
        quizMode: qm,
        soundQuizMode: sqm,
        pictureQuizMode: pqm
      });
    } else {
      renderMenu();
    }
  }

  // ── Reset to Default Settings (No Class Selected) ───────────
  function resetToDefaultSettings() {
    if (typeof ClassesManager !== 'undefined') {
      ClassesManager.setActiveClassId(null);
    }

    // Clear saved units and option keys from localStorage
    localStorage.removeItem('phonics-flash-selected-units');
    localStorage.setItem('phonics-flash-extras', 'false');
    localStorage.setItem('phonics-flash-sight', 'false');
    localStorage.setItem('phonics-flash-sight-only', 'false');
    localStorage.setItem('phonics-flash-highlight-sounds', 'true');
    localStorage.setItem('phonics-flash-images', 'false');
    localStorage.setItem('phonics-flash-letter-case', 'both');
    localStorage.setItem('phonics-flash-mix', 'false');
    localStorage.setItem('phonics-flash-dictation', 'false');
    localStorage.setItem('phonics-flash-quiz', 'false');
    localStorage.setItem('phonics-flash-sound-quiz', 'false');
    localStorage.setItem('phonics-flash-picture-quiz', 'false');
    localStorage.setItem('phonics-flash-word-chart', 'false');

    // Reset options in memory
    options.includeExtras = false;
    options.includeSightWords = false;
    options.sightWordsOnly = false;
    options.highlightSounds = true;
    options.includeImages = false;
    options.letterCase = 'both';
    options.mixMode = false;
    options.dictationMode = false;
    options.quizMode = false;
    options.soundQuizMode = false;
    options.pictureQuizMode = false;
    options.wordChart = false;
    options.syncSlides = true;

    // Uncheck all checkboxes in UI if already rendered
    const checkboxes = document.querySelectorAll('#levels-container .unit-checkbox input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = false;
      const parent = cb.closest('.unit-checkbox');
      if (parent) parent.classList.remove('checked');
    });

    // Reset all level select all buttons
    const selectAllBtns = document.querySelectorAll('#levels-container .select-all-btn');
    selectAllBtns.forEach(btn => {
      btn.textContent = 'Select All';
    });

    // Collapse all level cards
    const levelCards = document.querySelectorAll('#levels-container .level-card');
    levelCards.forEach(card => {
      card.classList.remove('expanded');
    });

    // Sync button states in UI
    syncOptionButton('toggle-extras', false);
    syncSightButton();
    syncOptionButton('toggle-images', false);
    syncCaseButtons('both');
    syncOptionButton('toggle-mix', false);
    syncActivityTabs();
    syncModeOptionDependencies();

    const classSelect = document.getElementById('class-select');
    if (classSelect) {
      classSelect.value = '';
    }

    if (phonicsData) {
      updateStartButton();
    }
  }

  // ── Class Profile Application ──────────────────────────────
  function applyClassProfile(cls) {
    if (!cls) return;

    if (cls.options) {
      options.includeExtras = !!cls.options.includeExtras;
      options.includeSightWords = !!cls.options.includeSightWords;
      options.sightWordsOnly = !!cls.options.sightWordsOnly;
      options.highlightSounds = true;
      options.includeImages = cls.options.includeImages !== false;
      options.letterCase = normalizeLetterCase(cls.options.letterCase || 'both');
      options.mixMode = !!cls.options.mixMode;
      options.dictationMode = !!cls.options.dictationMode;
      options.quizMode = !!cls.options.quizMode;
      options.soundQuizMode = !!cls.options.soundQuizMode;
      options.pictureQuizMode = !!cls.options.pictureQuizMode;
      options.wordChart = !!cls.options.wordChart;

      if (options.quizMode || options.dictationMode || options.pictureQuizMode) {
        options.includeExtras = false;
        options.includeSightWords = false;
        options.sightWordsOnly = false;
        options.includeImages = true;
      } else if (options.soundQuizMode) {
        options.includeExtras = false;
        options.includeSightWords = false;
        options.sightWordsOnly = false;
        options.includeImages = cls.options?.includeImages !== false;
      } else if (options.wordChart) {
        options.includeImages = false;
        options.mixMode = false;
      }

      localStorage.setItem('phonics-flash-extras', options.includeExtras);
      localStorage.setItem('phonics-flash-sight', options.includeSightWords);
      localStorage.setItem('phonics-flash-sight-only', options.sightWordsOnly);
      localStorage.setItem('phonics-flash-highlight-sounds', 'true');
      localStorage.setItem('phonics-flash-images', options.includeImages);
      localStorage.setItem('phonics-flash-letter-case', options.letterCase);
      localStorage.setItem('phonics-flash-mix', options.mixMode);
      localStorage.setItem('phonics-flash-dictation', options.dictationMode);
      localStorage.setItem('phonics-flash-quiz', options.quizMode);
      localStorage.setItem('phonics-flash-sound-quiz', options.soundQuizMode);
      localStorage.setItem('phonics-flash-picture-quiz', options.pictureQuizMode);
      localStorage.setItem('phonics-flash-word-chart', options.wordChart);
    }

    if (cls.selectedUnits && Array.isArray(cls.selectedUnits)) {
      localStorage.setItem('phonics-flash-selected-units', JSON.stringify(cls.selectedUnits));
    }

    // Auto-switch book series if class has an assigned curriculumId (fallback to smart-phonics for legacy classes - High #7)
    const targetCurId = cls.curriculumId || 'smart-phonics';
    if (typeof EditorStore !== 'undefined') {
      if (EditorStore.getActiveCurriculumId() !== targetCurId && EditorStore.getCurriculum(targetCurId)) {
        EditorStore.setActiveCurriculum(targetCurId);
        phonicsData = EditorStore.getActiveCurriculum();
        const bookSelect = document.getElementById('book-select');
        if (bookSelect) bookSelect.value = targetCurId;
      }
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
    if (typeof EditorStore !== 'undefined') {
      await EditorStore.init();
      const activeCurriculum = EditorStore.getActiveCurriculum();
      // If a user has an active custom curriculum, use it
      if (activeCurriculum && activeCurriculum.isCustom && Array.isArray(activeCurriculum.levels) && activeCurriculum.levels.length > 0) {
        return activeCurriculum;
      }
    }

    // Try central CurriculumLoader (Upstash live -> CDN -> words.json)
    if (typeof SharedClassSync !== 'undefined' && SharedClassSync.CurriculumLoader) {
      try {
        const loaded = await SharedClassSync.CurriculumLoader.load();
        if (loaded) {
          const adapted = SharedClassSync.CurriculumAdapter.toPhonicsFlash(loaded);
          if (adapted && adapted.levels && adapted.levels.length > 0) {
            return adapted;
          }
        }
      } catch (err) {
        console.warn('[PhonicsFlash] CurriculumLoader fallback:', err);
      }
    }

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
    const levelParam = params.get('level') || params.get('l');
    
    let unitIds = [];
    if (units) {
      const allUnitIds = [];
      (phonicsData?.levels || []).forEach(l => (l.units || []).forEach(u => allUnitIds.push(u.id)));

      const trimmedUnits = units.trim();
      if (allUnitIds.includes(trimmedUnits)) {
        unitIds = [trimmedUnits];
      } else if (trimmedUnits.includes(',')) {
        unitIds = trimmedUnits.split(',').map(s => s.trim()).filter(Boolean);
      } else if (trimmedUnits.includes('-')) {
        // Only split on hyphen if all parts match known unit IDs (preserves custom_oxford-1_L1_U1)
        const parts = trimmedUnits.split('-').map(s => s.trim()).filter(Boolean);
        if (parts.length > 1 && parts.every(p => allUnitIds.includes(p))) {
          unitIds = parts;
        } else {
          unitIds = [trimmedUnits];
        }
      } else {
        unitIds = [trimmedUnits];
      }
    }

    let chartLevel = levelParam ? levelParam.toUpperCase() : null;
    if (!chartLevel && unitIds.length > 0) {
      const match = unitIds[0].match(/^(?:.*_)?(L\d+)/i);
      if (match) chartLevel = match[1].toUpperCase();
    }
    if (!chartLevel) chartLevel = 'L1';

    return {
      isChart: isChart,
      chartLevel: chartLevel,
      unitIds: unitIds,
      extras: params.get('extras') === '1',
      sightWords: params.get('sight') === '1' || params.get('sightwords') === '1' || params.get('sight') === 'only' || params.get('sightwords') === 'only' || params.get('sightonly') === '1',
      sightWordsOnly: params.get('sight') === 'only' || params.get('sightwords') === 'only' || params.get('sightonly') === '1',
      highlightSounds: true,
      images: params.get('images') !== '0', // default true
      letterCase: caseParam ? normalizeLetterCase(caseParam) : (options.letterCase || 'both'),
      mix: params.get('mix') === '1',
      dictation: params.get('dictation') === '1',
      quiz: params.get('quiz') === '1',
      soundQuiz: params.get('soundquiz') === '1' || params.get('sq') === '1' || chartParam === 'soundquiz',
      pictureQuiz: params.get('picturequiz') === '1' || params.get('picquiz') === '1' || params.get('pq') === '1' || chartParam === 'picturequiz'
    };
  }

  // ── Build Bookmarkable URL ─────────────────────────────────
  function updateURLWithParams(unitIds, opts) {
    const params = new URLSearchParams();
    if (typeof EditorStore !== 'undefined') {
      const curId = EditorStore.getActiveCurriculumId();
      if (curId && curId !== 'smart-phonics') {
        params.set('book', curId);
      }
    }
    params.set('units', unitIds.join(','));
    if (opts.includeExtras) params.set('extras', '1');
    if (opts.sightWordsOnly) {
      params.set('sight', 'only');
    } else if (opts.includeSightWords) {
      params.set('sight', '1');
    }
    if (opts.highlightSounds) params.set('highlight', '1');
    if (!opts.includeImages) params.set('images', '0');
    if (opts.letterCase && opts.letterCase !== 'both') params.set('case', opts.letterCase);
    if (opts.mixMode) params.set('mix', '1');
    if (opts.dictationMode) params.set('dictation', '1');
    if (opts.quizMode) params.set('quiz', '1');
    if (opts.soundQuizMode) params.set('soundquiz', '1');
    if (opts.pictureQuizMode) params.set('picturequiz', '1');

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

  // Helper to sync 3-way sight button state, label, and title
  function syncSightButton() {
    const btn = document.getElementById('toggle-sight');
    if (!btn) return;
    const span = btn.querySelector('span') || btn;
    if (options.sightWordsOnly) {
      btn.classList.add('active');
      span.textContent = 'Sight Words Only';
      btn.title = 'Practicing sight words only (Click to turn off)';
    } else if (options.includeSightWords) {
      btn.classList.add('active');
      span.textContent = 'Sight Words';
      btn.title = 'Sight words included with core words (Click for Sight Words Only)';
    } else {
      btn.classList.remove('active');
      span.textContent = 'Sight Words';
      btn.title = 'Include sight words with selected units';
    }
  }

  // Helper to sync segmented activity tabs with current active mode
  function syncActivityTabs() {
    let currentActivity = 'flashcards';
    if (options.pictureQuizMode) currentActivity = 'picture-quiz';
    else if (options.soundQuizMode) currentActivity = 'sound-quiz';
    else if (options.quizMode) currentActivity = 'word-quiz';
    else if (options.dictationMode) currentActivity = 'dictation';
    else if (options.wordChart) currentActivity = 'word-chart';

    const tabs = document.querySelectorAll('.activity-tab');
    tabs.forEach(tab => {
      const isActive = tab.dataset.activity === currentActivity;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function setActiveActivity(activityId) {
    options.quizMode = (activityId === 'word-quiz');
    options.soundQuizMode = (activityId === 'sound-quiz');
    options.pictureQuizMode = (activityId === 'picture-quiz');
    options.dictationMode = (activityId === 'dictation');
    options.wordChart = (activityId === 'word-chart');

    localStorage.setItem('phonics-flash-quiz', options.quizMode);
    localStorage.setItem('phonics-flash-sound-quiz', options.soundQuizMode);
    localStorage.setItem('phonics-flash-picture-quiz', options.pictureQuizMode);
    localStorage.setItem('phonics-flash-dictation', options.dictationMode);
    localStorage.setItem('phonics-flash-word-chart', options.wordChart);

    syncModeOptionDependencies();
  }

  // Helper to enforce option constraints when Quiz, Dictation, or Word Chart Mode is active
  function syncModeOptionDependencies() {
    const extrasBtn = document.getElementById('toggle-extras');
    const sightBtn = document.getElementById('toggle-sight');
    const imagesBtn = document.getElementById('toggle-images');
    const mixBtn = document.getElementById('toggle-mix');

    const quizTab = document.getElementById('mode-word-quiz');
    const soundQuizTab = document.getElementById('mode-sound-quiz');
    const picQuizTab = document.getElementById('mode-picture-quiz');
    const dictationTab = document.getElementById('mode-dictation');
    const flashcardsTab = document.getElementById('mode-flashcards');
    const wordChartTab = document.getElementById('mode-word-chart');

    if (options.sightWordsOnly) {
      // Sight Words Only: Quiz and Dictation modes are unavailable
      // If currently in a quiz or dictation mode, revert to flashcards
      if (options.quizMode || options.soundQuizMode || options.pictureQuizMode || options.dictationMode) {
        options.quizMode = false;
        options.soundQuizMode = false;
        options.pictureQuizMode = false;
        options.dictationMode = false;
        localStorage.setItem('phonics-flash-quiz', 'false');
        localStorage.setItem('phonics-flash-sound-quiz', 'false');
        localStorage.setItem('phonics-flash-picture-quiz', 'false');
        localStorage.setItem('phonics-flash-dictation', 'false');
      }

      // Disable quiz and dictation activity tabs
      [quizTab, soundQuizTab, picQuizTab, dictationTab].forEach(tab => {
        if (tab) {
          tab.disabled = true;
          tab.title = 'Unavailable in Sight Words Only mode';
        }
      });
      if (flashcardsTab) {
        flashcardsTab.disabled = false;
        flashcardsTab.title = 'Full screen flashcards';
      }
      if (wordChartTab) {
        wordChartTab.disabled = false;
        wordChartTab.title = 'Full screen interactive word grid';
      }

      // Extras and Images are unavailable for Sight Words Only
      options.includeExtras = false;
      options.includeImages = false;
      localStorage.setItem('phonics-flash-extras', 'false');
      localStorage.setItem('phonics-flash-images', 'false');

      if (extrasBtn) {
        extrasBtn.disabled = true;
        extrasBtn.title = 'Extra words unavailable in Sight Words Only mode';
      }
      if (sightBtn) {
        sightBtn.disabled = false;
      }
      if (imagesBtn) {
        imagesBtn.disabled = true;
        imagesBtn.title = 'Images unavailable in Sight Words Only mode';
      }
      if (mixBtn) {
        mixBtn.disabled = !!options.wordChart;
        mixBtn.title = options.wordChart ? 'All-in-One Deck unavailable in Word Chart' : 'Interleave words from selected units';
      }
    } else {
      // Re-enable all activity tabs
      [quizTab, soundQuizTab, picQuizTab, dictationTab, flashcardsTab, wordChartTab].forEach(tab => {
        if (tab) tab.disabled = false;
      });
      if (quizTab) quizTab.title = 'Show picture with two word choices';
      if (soundQuizTab) soundQuizTab.title = 'Show picture with blanked sound and two sound choices';
      if (picQuizTab) picQuizTab.title = 'Show target sound with two picture choices';
      if (dictationTab) dictationTab.title = 'Show image first, reveal word text';
      if (flashcardsTab) flashcardsTab.title = 'Full screen flashcards';
      if (wordChartTab) wordChartTab.title = 'Full screen interactive word grid';

      if (options.wordChart) {
        // Word Chart disables Images and All-in-One Deck
        options.includeImages = false;
        options.mixMode = false;

        localStorage.setItem('phonics-flash-images', 'false');
        localStorage.setItem('phonics-flash-mix', 'false');

        if (imagesBtn) {
          imagesBtn.disabled = true;
          imagesBtn.title = 'Images unavailable in Word Chart';
        }
        if (mixBtn) {
          mixBtn.disabled = true;
          mixBtn.title = 'All-in-One Deck unavailable in Word Chart';
        }
        if (extrasBtn) {
          extrasBtn.disabled = false;
          extrasBtn.title = 'Include extra words in the review';
        }
        if (sightBtn) {
          sightBtn.disabled = false;
        }
      } else if (options.soundQuizMode) {
        // Extra words and sight words cannot be enabled in Sound Quiz (focus on target phonics blends/vowels)
        options.includeExtras = false;
        options.includeSightWords = false;
        options.sightWordsOnly = false;

        localStorage.setItem('phonics-flash-extras', 'false');
        localStorage.setItem('phonics-flash-sight', 'false');
        localStorage.setItem('phonics-flash-sight-only', 'false');

        if (extrasBtn) {
          extrasBtn.disabled = true;
          extrasBtn.title = 'Extra words unavailable in Sound Quiz';
        }
        if (sightBtn) {
          sightBtn.disabled = true;
          sightBtn.title = 'Sight words unavailable in Sound Quiz';
        }
        if (imagesBtn) {
          imagesBtn.disabled = false;
          imagesBtn.title = 'Show or hide pictures in Sound Quiz';
        }
        if (mixBtn) {
          mixBtn.disabled = false;
          mixBtn.title = 'Interleave words from selected units';
        }
      } else if (options.quizMode || options.dictationMode || options.pictureQuizMode) {
        const modeName = options.pictureQuizMode ? 'Picture Quiz' : (options.quizMode ? 'Word Quiz' : 'Dictation Mode');
        // Extra words and sight words cannot be enabled (no pictures)
        options.includeExtras = false;
        options.includeSightWords = false;
        options.sightWordsOnly = false;
        // Images are required for Word Quiz, Picture Quiz, and Dictation modes and cannot be disabled
        options.includeImages = true;

        localStorage.setItem('phonics-flash-extras', 'false');
        localStorage.setItem('phonics-flash-sight', 'false');
        localStorage.setItem('phonics-flash-sight-only', 'false');
        localStorage.setItem('phonics-flash-images', 'true');

        if (extrasBtn) {
          extrasBtn.disabled = true;
          extrasBtn.title = `Extra words unavailable in ${modeName} (no pictures)`;
        }
        if (sightBtn) {
          sightBtn.disabled = true;
          sightBtn.title = `Sight words unavailable in ${modeName} (no pictures)`;
        }
        if (imagesBtn) {
          imagesBtn.disabled = true;
          imagesBtn.title = `Images are required for ${modeName} and cannot be disabled`;
        }
        if (mixBtn) {
          mixBtn.disabled = false;
          mixBtn.title = 'Interleave words from selected units';
        }
      } else {
        if (extrasBtn) {
          extrasBtn.disabled = false;
          extrasBtn.title = 'Include extra words in the review';
        }
        if (sightBtn) {
          sightBtn.disabled = false;
        }
        if (imagesBtn) {
          imagesBtn.disabled = false;
          imagesBtn.title = 'Show images with words';
        }
        if (mixBtn) {
          mixBtn.disabled = false;
          mixBtn.title = 'Interleave words from selected units';
        }
      }
    }

    syncOptionButton('toggle-extras', options.includeExtras);
    syncSightButton();
    syncOptionButton('toggle-images', options.includeImages);
    syncOptionButton('toggle-mix', options.mixMode);
    syncActivityTabs();
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
      if (options.quizMode || options.dictationMode || options.soundQuizMode || options.pictureQuizMode) return;
      options.includeExtras = !options.includeExtras;
      syncOptionButton('toggle-extras', options.includeExtras);
      localStorage.setItem('phonics-flash-extras', options.includeExtras);
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    document.getElementById('toggle-sight').addEventListener('click', (e) => {
      if (options.quizMode || options.dictationMode || options.soundQuizMode || options.pictureQuizMode) return;
      // 3-way cycle: Off -> Include -> Only -> Off
      if (!options.includeSightWords) {
        options.includeSightWords = true;
        options.sightWordsOnly = false;
      } else if (options.includeSightWords && !options.sightWordsOnly) {
        options.includeSightWords = true;
        options.sightWordsOnly = true;
      } else {
        options.includeSightWords = false;
        options.sightWordsOnly = false;
      }
      localStorage.setItem('phonics-flash-sight', options.includeSightWords);
      localStorage.setItem('phonics-flash-sight-only', options.sightWordsOnly);
      syncSightButton();
      syncModeOptionDependencies();
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    document.getElementById('toggle-images').addEventListener('click', (e) => {
      if (options.quizMode || options.dictationMode || options.pictureQuizMode || options.wordChart || options.sightWordsOnly) return;
      options.includeImages = !options.includeImages;
      syncOptionButton('toggle-images', options.includeImages);
      localStorage.setItem('phonics-flash-images', options.includeImages);
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    document.getElementById('toggle-mix').addEventListener('click', (e) => {
      if (options.wordChart) return;
      options.mixMode = !options.mixMode;
      syncOptionButton('toggle-mix', options.mixMode);
      localStorage.setItem('phonics-flash-mix', options.mixMode);
      saveCurrentOptionsToActiveClass();
      updateStartButton();
    });

    // Wire up activity segmented tabs
    const activityTabs = document.querySelectorAll('.activity-tab');
    activityTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.disabled) return;
        const activity = tab.dataset.activity;
        if (activity) {
          setActiveActivity(activity);
          saveCurrentOptionsToActiveClass();
          updateStartButton();
        }
      });
    });

    // Wire up start button click & Enter key shortcut
    const startBtn = document.getElementById('start-btn');
    startBtn.addEventListener('click', handleStart);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.repeat) return;

      // Only active when menu screen is visible
      const menuScreen = document.getElementById('menu-screen');
      if (!menuScreen || menuScreen.classList.contains('hidden')) return;

      // Do not trigger if modal is open
      const classModal = document.getElementById('class-modal');
      if (classModal && !classModal.classList.contains('hidden')) return;

      // Do not trigger if user is interacting with text inputs, textareas, or select dropdowns
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName;
        const isEditable = active.isContentEditable || tag === 'TEXTAREA' || (tag === 'INPUT' && !['checkbox', 'radio'].includes(active.type));
        if (isEditable || tag === 'SELECT') return;

        // If user explicitly keyboard-navigated (:focus-visible) to utility buttons, let Enter trigger that button instead
        if (
          (active.id === 'open-settings-btn' || active.id === 'reset-btn' || active.id === 'theme-toggle') &&
          active.matches && active.matches(':focus-visible')
        ) {
          return;
        }
      }

      // Check if start button is available and enabled
      if (!startBtn || startBtn.disabled) return;

      e.preventDefault();
      handleStart();
    });

    // Escape or Backspace returns to menu when inside slideshow
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' && e.key !== 'Backspace') return;
      const slideshowScreen = document.getElementById('slideshow-screen');
      if (!slideshowScreen || slideshowScreen.classList.contains('hidden')) return;

      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      e.preventDefault();
      backToMenu();
    });

    // Wire up reset button
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetToDefaultSettings();
        showToast('All selections cleared', 'info', 2000);
      });
    }
  }

  // ── Book Series Dropdown ───────────────────────────────────
  let bookSelectInitialized = false;

  function renderBookDropdown() {
    const bookSelect = document.getElementById('book-select');
    if (!bookSelect || typeof EditorStore === 'undefined') return;

    const curricula = EditorStore.getCurricula();
    const activeId = EditorStore.getActiveCurriculumId();

    bookSelect.innerHTML = '';
    curricula.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      bookSelect.appendChild(opt);
    });

    if (activeId && bookSelect.querySelector(`option[value="${CSS.escape(activeId)}"]`)) {
      bookSelect.value = activeId;
    } else if (bookSelect.options.length > 0) {
      bookSelect.selectedIndex = 0;
    }
  }

  function initBookSelect() {
    if (bookSelectInitialized) return;
    const bookSelect = document.getElementById('book-select');
    if (!bookSelect || typeof EditorStore === 'undefined') return;
    bookSelectInitialized = true;

    bookSelect.addEventListener('change', (e) => {
      const selectedBookId = e.target.value;
      if (selectedBookId && selectedBookId !== EditorStore.getActiveCurriculumId()) {
        if (typeof MediaDB !== 'undefined') {
          MediaDB.revokeAllUrls();
        }
        EditorStore.setActiveCurriculum(selectedBookId);
        phonicsData = EditorStore.getActiveCurriculum();
        localStorage.removeItem('phonics-flash-selected-units');

        // Deselect active class if class's curriculum does not match selected book (High #8)
        if (typeof ClassesManager !== 'undefined') {
          const activeClass = ClassesManager.getActiveClass();
          if (activeClass && (activeClass.curriculumId || 'smart-phonics') !== selectedBookId) {
            ClassesManager.setActiveClassId(null);
            const classSelect = document.getElementById('class-select');
            if (classSelect) classSelect.value = '';
          }
        }

        renderMenu();
        showToast(`Switched to "${phonicsData?.name || selectedBookId}"`, 'info', 2000);
      }
    });
  }

  // ── Menu Rendering ─────────────────────────────────────────
  function renderMenu() {
    renderBookDropdown();

    const container = document.getElementById('levels-container');
    container.innerHTML = '';

    if (!phonicsData || !Array.isArray(phonicsData.levels) || phonicsData.levels.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:3rem 1rem;color:var(--text-muted);">
          <p style="font-size:1.1rem;font-weight:600;margin-bottom:0.5rem;">No levels in this book series yet</p>
          <p style="font-size:0.9rem;margin-bottom:1.5rem;">Use the curriculum editor to create levels, units, and flashcards.</p>
          <a href="editor.html" class="btn btn-primary" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;">
            Open Curriculum Editor
          </a>
        </div>
      `;
      updateStartButton();
      return;
    }

    const savedUnits = JSON.parse(localStorage.getItem('phonics-flash-selected-units') || '[]');

    phonicsData.levels.forEach((level, index) => {
      const card = createLevelCard(level, index, savedUnits);
      container.appendChild(card);
    });

    // Set initial toggle states in UI
    syncCaseButtons(options.letterCase);
    syncModeOptionDependencies();

    updateStartButton();
  }

  function createLevelCard(level, index, savedUnits = []) {
    const card = document.createElement('div');
    card.className = 'level-card';
    card.dataset.levelId = level.id;

    const units = Array.isArray(level.units) ? level.units : [];

    // Check if any units in this level are saved/checked
    const checkedUnitsInLevel = units.filter(u => savedUnits.includes(u.id));
    const hasSelected = checkedUnitsInLevel.length > 0;
    const allChecked = units.length > 0 && checkedUnitsInLevel.length === units.length;

    // Auto-expand if units are selected in this level
    if (hasSelected) {
      card.classList.add('expanded');
    }

    const color = level.color || LEVEL_COLORS[level.id] || LEVEL_COLORS.L1;

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
          </div>
        ` : ''}
        <div class="units-grid">
          ${units.length > 0 ? units.map(unit => {
            const isChecked = savedUnits.includes(unit.id);
            return createUnitCheckboxHTML(unit, level.id, isChecked);
          }).join('') : '<p style="padding:1rem;color:var(--text-muted);font-size:0.85rem;">No units in this level yet.</p>'}
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

    // Level 1 specific case buttons
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
    if (!btn) return;
    const selectedIds = getSelectedUnitIds();

    btn.disabled = selectedIds.length === 0;

    const actionText = options.wordChart ? 'Open Word Chart' : 'Start Review';
    const countSpan = btn.querySelector('.start-btn-count');
    if (selectedIds.length === 0) {
      if (btn.childNodes[0]) {
        btn.childNodes[0].nodeValue = `${actionText}\n        `;
      }
      if (countSpan) countSpan.textContent = 'Select at least one unit';
      btn.title = options.wordChart ? 'Select at least one unit to open Word Chart' : 'Select at least one unit to start review';
    } else {
      const count = countWords(selectedIds);
      if (btn.childNodes[0]) {
        btn.childNodes[0].nodeValue = `${actionText}\n        `;
      }
      const wordType = options.sightWordsOnly ? 'sight words' : 'words';
      if (countSpan) countSpan.textContent = `${selectedIds.length} unit${selectedIds.length > 1 ? 's' : ''} · ${count} ${wordType}`;
      btn.title = `${actionText} (Enter)`;
    }
  }

  /**
   * Transforms and deduplicates words for a unit according to opts (Images, LetterCase).
   */
  function prepareUnitWords(unit, isExtra = false, opts = options) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.prepareUnitWords(unit, isExtra, opts);
    }
    return isExtra ? (unit.extraWords || []) : (unit.words || []);
  }

  function prepareUnitSightWords(unit) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.prepareUnitSightWords(unit);
    }
    return (unit.sightWords || []).map(sw => typeof sw === 'string' ? { word: sw, isSightWord: true } : { ...sw, isSightWord: true });
  }

  function countWords(unitIds) {
    if (!phonicsData || !phonicsData.levels || !unitIds || unitIds.length === 0) {
      return 0;
    }
    let count = 0;
    const selectedSightWords = [];

    for (const level of (phonicsData?.levels || [])) {
      for (const unit of (level?.units || [])) {
        if (unitIds.includes(unit.id)) {
          const unitWithLevel = { ...unit, levelId: level.id, levelName: level.name };
          if (!options.sightWordsOnly) {
            const mainWords = prepareUnitWords(unitWithLevel, false, options);
            count += mainWords.length;
            if (options.includeExtras && unit.extraWords) {
              const extraWords = prepareUnitWords(unitWithLevel, true, options);
              count += extraWords.length;
            }
          }
          if ((options.includeSightWords || options.sightWordsOnly) && unit.sightWords) {
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

    if ((options.includeSightWords || options.sightWordsOnly) && options.mixMode && selectedSightWords.length > 0) {
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

    if (options.wordChart) {
      openChart(null, unitIds);
      return;
    }

    startSlideshow(unitIds, { ...options });
  }

  function startSlideshow(unitIds, opts) {
    // Enforce quiz/dictation/sound-quiz/picture-quiz mode constraints
    if (opts.quizMode || opts.dictationMode || opts.pictureQuizMode) {
      opts.includeExtras = false;
      opts.includeSightWords = false;
      opts.sightWordsOnly = false;
      opts.includeImages = true;
    } else if (opts.soundQuizMode) {
      opts.includeExtras = false;
      opts.includeSightWords = false;
      opts.sightWordsOnly = false;
      // opts.includeImages is optional for Sound Quiz
    }

    // Gather selected unit data with level context
    let selectedUnits = [];
    for (const level of (phonicsData?.levels || [])) {
      for (const unit of (level?.units || [])) {
        if (unitIds.includes(unit.id)) {
          selectedUnits.push({
            ...unit,
            levelId: level.id,
            levelName: level.name
          });
        }
      }
    }

    // If no units found in active book, check other available books (High #4)
    if (selectedUnits.length === 0 && typeof EditorStore !== 'undefined') {
      const allBooks = EditorStore.getAllCurriculaRaw();
      for (const b of allBooks) {
        if (b.id === EditorStore.getActiveCurriculumId()) continue;
        const matchingUnits = [];
        for (const lvl of (b.levels || [])) {
          for (const u of (lvl.units || [])) {
            if (unitIds.includes(u.id)) {
              matchingUnits.push({ ...u, levelId: lvl.id, levelName: lvl.name });
            }
          }
        }
        if (matchingUnits.length > 0) {
          EditorStore.setActiveCurriculum(b.id);
          phonicsData = EditorStore.getActiveCurriculum();
          const bookSelect = document.getElementById('book-select');
          if (bookSelect) bookSelect.value = b.id;
          selectedUnits = matchingUnits;
          break;
        }
      }
    }

    if (selectedUnits.length === 0) {
      showToast('No matching units found for slideshow', 'error', 3000);
      return;
    }

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
      let words = [];

      if (opts.sightWordsOnly) {
        if (unit.sightWords && unit.sightWords.length > 0) {
          words = prepareUnitSightWords(unit);
          shuffleArray(words);
        }
      } else {
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

        words = [...mainWords, ...extraWords, ...sightWords];
      }

      if (words.length === 0) return;

      const unitSection = document.createElement('section');
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

    if (opts.sightWordsOnly) {
      // Prepare sight words (deduplicated across all selected units)
      const allSightWords = [];
      units.forEach(unit => {
        if (unit.sightWords && unit.sightWords.length > 0) {
          const sws = prepareUnitSightWords(unit);
          sws.forEach(sw => {
            allSightWords.push({ wordData: sw, unit });
          });
        }
      });

      // Deduplicate sight words across selected units by word string (case-insensitive)
      const seen = new Set();
      const uniqueSightItems = allSightWords.filter(item => {
        const key = (item.wordData.word || '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      shuffleArray(uniqueSightItems);

      uniqueSightItems.forEach((item, index) => {
        const wordSection = createWordSlide(
          item.wordData,
          item.unit,
          index,
          uniqueSightItems.length,
          opts
        );
        container.appendChild(wordSection);
      });
      return;
    }

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
    if (opts && opts.mixMode) modeTags.push('All-in-One Deck');
    if (opts && opts.dictationMode) modeTags.push('Dictation Mode');
    if (opts && opts.quizMode) modeTags.push('Word Quiz');
    if (opts && opts.soundQuizMode) modeTags.push('Sound Quiz');
    if (opts && opts.pictureQuizMode) modeTags.push('Picture Quiz');
    if (opts && opts.sightWordsOnly) modeTags.push('Sight Words Only');
    else if (opts && opts.includeSightWords) modeTags.push('Sight Words');
    if (opts && opts.includeExtras) modeTags.push('Extra Words');

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
            <span>Let's Read! ▶</span>
          </button>
          <p class="intro-hint">Press <kbd>Space</kbd>, <kbd>Enter</kbd>, <kbd>→</kbd> or click anywhere to begin</p>
        </div>
      </div>
    `;

    return section;
  }

  // ── Distractor Generators (Word & Picture Quiz) ─────────────
  function getDistractorWord(wordData, unit, opts) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.getDistractorWord(wordData, unit, opts, phonicsData);
    }
    return 'Review';
  }

  function getDistractorPictureCandidate(wordData, unit, opts) {
    if (window.PhonicsEngine) {
      return PhonicsEngine.getDistractorPictureCandidate(wordData, unit, opts, phonicsData);
    }
    return null;
  }

  /**
   * Format the unit badge label for slide chrome.
   * In dictation mode, target sounds (e.g. "Unit 5: sm, sn, st, sw" -> "Unit 5")
   * are omitted to avoid giving students hints.
   */
  function formatUnitLabel(unit, isDictationMode) {
    if (!unit) return '';
    let name = (unit.name || '').trim();
    if (isDictationMode) {
      if (name.includes(':')) {
        name = name.split(':')[0].trim();
      } else if (/^Unit\s+\d+\s*[-–—]/i.test(name)) {
        name = name.split(/[-–—]/)[0].trim();
      } else if (unit.targetSound && name.toLowerCase().includes(unit.targetSound.toLowerCase())) {
        const escaped = unit.targetSound.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        name = name.replace(new RegExp(escaped, 'gi'), '').replace(/[-–—:\s]+$/, '').trim();
      }

      if (!name) {
        const match = (unit.id || '').match(/U(\d+)$/i);
        name = match ? `Unit ${match[1]}` : '';
      }
    }

    if (unit.levelName && name) {
      return `${unit.levelName} · ${name}`;
    }
    return unit.levelName || name || '';
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
      const level = (phonicsData && phonicsData.levels)
        ? phonicsData.levels.find(l => l.id === unit.levelId)
        : null;
      if (level) {
        const targetColor = level.targetSoundColor || (level.color && typeof PhonicsEngine !== 'undefined' && PhonicsEngine.getContrastingTargetSoundColor ? PhonicsEngine.getContrastingTargetSoundColor(level.color) : null);
        if (targetColor && !['L1', 'L2', 'L3', 'L4', 'L5'].includes(unit.levelId)) {
          section.style.setProperty('--target-sound-color', targetColor);
        }
      }
    }

    // Store all metadata as data attributes for the chrome overlay
    section.dataset.word = wordData.word;
    section.dataset.audioPath = wordData.audio || '';
    const isDictation = !!(opts && opts.dictationMode);
    const isSoundQuiz = !!(opts && opts.soundQuizMode);
    const isPictureQuiz = !!(opts && opts.pictureQuizMode);
    section.dataset.unitLabel = formatUnitLabel(unit, isDictation || isSoundQuiz || isPictureQuiz);
    section.dataset.targetSound = unit.targetSound || unit.sound || '';
    section.dataset.levelId = unit.levelId;
    section.dataset.progress = `${index + 1} / ${total}`;
    if (isDictation) section.dataset.dictationMode = 'true';
    if (isSoundQuiz) section.dataset.soundQuizMode = 'true';
    if (isPictureQuiz) section.dataset.pictureQuizMode = 'true';
    if (wordData.isExtra) section.dataset.extra = 'true';
    if (wordData.isSightWord) section.dataset.sightWord = 'true';

    const hasImage = !!wordData.image;
    const isSightWord = !!wordData.isSightWord;
    const isMediaUri = hasImage && wordData.image.startsWith('media:');

    if (opts && opts.quizMode) {
      section.dataset.quizMode = "true";
      section.dataset.answered = "false";
      section.dataset.hasImage = hasImage ? 'true' : 'false';

      const distractor = getDistractorWord(wordData, unit, opts);
      const choices = [wordData.word, distractor];
      shuffleArray(choices);

      const targetSound = unit.targetSound || unit.sound || '';
      const choice0Display = (opts && opts.highlightSounds && !isSightWord)
        ? highlightTargetSound(choices[0], targetSound, unit.levelId)
        : choices[0];
      const choice1Display = (opts && opts.highlightSounds && !isSightWord)
        ? highlightTargetSound(choices[1], targetSound, unit.levelId)
        : choices[1];

      const maxLen = Math.max(choices[0].length, choices[1].length);

      section.innerHTML = `
        <div class="slide-center quiz-mode-layout">
          ${isSightWord ? '<div class="sight-word-badge">Sight Word</div>' : ''}
          ${hasImage
            ? `<img ${isMediaUri ? `data-media-uri="${wordData.image}" style="display:none;"` : `src="${wordData.image}"`} alt="Quiz Image" class="word-image quiz-image"
                 onerror="if(this.src) this.style.display='none'">`
            : ''}
          <div class="quiz-options-container" data-max-len="${maxLen}">
            <button class="quiz-option-btn" data-word="${choices[0]}" data-len="${maxLen}">${choice0Display}</button>
            <button class="quiz-option-btn" data-word="${choices[1]}" data-len="${maxLen}">${choice1Display}</button>
          </div>
        </div>
      `;
    } else if (opts && opts.soundQuizMode) {
      section.dataset.soundQuizMode = "true";
      section.dataset.answered = "false";

      const showImageInSoundQuiz = opts ? !!opts.includeImages : false;
      const hasSoundQuizImage = showImageInSoundQuiz && hasImage;
      section.dataset.hasImage = hasSoundQuizImage ? 'true' : 'false';

      const soundInfo = getTargetSoundInfo(wordData.word, unit, opts);
      const correctSound = soundInfo ? soundInfo.correctSound : '';
      const distractor = soundInfo ? soundInfo.distractor : '';
      section.dataset.correctSound = correctSound;

      const choices = [correctSound, distractor];
      // Keep possible answer choices in alphabetical order for consistency
      choices.sort((a, b) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' }) || (a || '').localeCompare(b || ''));

      const targetSound = unit.targetSound || unit.sound || '';
      const blankedWordDisplay = getBlankedWord(wordData.word, targetSound, unit.levelId);
      const fullWordDisplay = (opts && opts.highlightSounds && !isSightWord)
        ? highlightTargetSound(wordData.word, targetSound, unit.levelId)
        : wordData.word;

      section.innerHTML = `
        <div class="slide-center sound-quiz-layout ${!hasSoundQuizImage ? 'no-image' : ''}" data-len="${wordData.word.length}">
          ${isSightWord ? '<div class="sight-word-badge">Sight Word</div>' : ''}
          ${hasSoundQuizImage
            ? `<img ${isMediaUri ? `data-media-uri="${wordData.image}" style="display:none;"` : `src="${wordData.image}"`} alt="Sound Quiz Image" class="word-image quiz-image"
                 onerror="if(this.src) this.style.display='none'">`
            : ''}
          <div class="sound-quiz-interactive-group">
            <div class="sound-quiz-word-row">
              <div class="sound-quiz-blanked-word" data-full-word="${encodeURIComponent(fullWordDisplay)}" data-len="${wordData.word.length}" title="Click to hear sound">${blankedWordDisplay}</div>
            </div>
            <div class="quiz-options-container">
              <button class="quiz-option-btn sound-option-btn" data-len="${wordData.word.length}" data-sound="${choices[0]}">${choices[0]}</button>
              <button class="quiz-option-btn sound-option-btn" data-len="${wordData.word.length}" data-sound="${choices[1]}">${choices[1]}</button>
            </div>
          </div>
        </div>
      `;
    } else if (opts && opts.pictureQuizMode) {
      section.dataset.pictureQuizMode = "true";
      section.dataset.answered = "false";

      const soundInfo = getTargetSoundInfo(wordData.word, unit, opts);
      const targetSound = soundInfo ? soundInfo.correctSound : (unit.targetSound || unit.sound || '');
      section.dataset.correctSound = targetSound;

      const distractorData = getDistractorPictureCandidate(wordData, unit, opts);

      const choices = [
        {
          word: wordData.word,
          image: wordData.image,
          isCorrect: true,
          unit: unit
        },
        {
          word: distractorData ? distractorData.word : 'Review',
          image: distractorData ? distractorData.image : '',
          isCorrect: false,
          unit: distractorData ? { levelId: distractorData.levelId, targetSound: distractorData.targetSound } : unit
        }
      ];
      shuffleArray(choices);

      const maxCardWordLen = Math.max((choices[0].word || '').length, (choices[1].word || '').length);

      const cardsHTML = choices.map((c) => {
        const cTargetSound = c.unit.targetSound || c.unit.sound || '';
        const cDisplay = (opts && opts.highlightSounds)
          ? highlightTargetSound(c.word, cTargetSound, c.unit.levelId)
          : c.word;
        const cIsMedia = c.image && c.image.startsWith('media:');

        return `
          <button class="picture-option-card" data-correct="${c.isCorrect ? 'true' : 'false'}" data-word="${c.word}" type="button">
            <span class="picture-card-status-badge" aria-hidden="true"></span>
            <img ${cIsMedia ? `data-media-uri="${c.image}" style="display:none;"` : `src="${c.image || ''}"`} alt="${c.word}" class="picture-card-img word-image" onerror="if(this.src) this.style.display='none'">
            <div class="picture-card-word" data-len="${maxCardWordLen}">${cDisplay}</div>
          </button>
        `;
      }).join('');

      section.innerHTML = `
        <div class="slide-center picture-quiz-layout">
          <div class="target-sound-bubble">${targetSound}</div>
          <div class="picture-options-container">
            ${cardsHTML}
          </div>
        </div>
      `;
    } else {
      const showImages = opts ? opts.includeImages : false;
      const showImageInDictation = opts ? opts.dictationMode : false;
      const slideHasImage = !!((showImages || showImageInDictation) && hasImage);
      section.dataset.hasImage = slideHasImage ? 'true' : 'false';

      const targetSound = unit.targetSound || unit.sound || '';
      const wordDisplay = (opts && opts.highlightSounds && !isSightWord)
        ? highlightTargetSound(wordData.word, targetSound, unit.levelId)
        : wordData.word;

      const blankedWordDisplay = isDictation
        ? getBlankedWord(wordData.word, targetSound, unit.levelId)
        : '';

      // Only render the word (+ optional image + optional sight word badge) — no chrome
      section.innerHTML = `
        <div class="slide-center">
          ${isSightWord ? '<div class="sight-word-badge">Sight Word</div>' : ''}
          ${(showImages || showImageInDictation) && hasImage
            ? `<img ${isMediaUri ? `data-media-uri="${wordData.image}" style="display:none;"` : `src="${wordData.image}"`} alt="${wordData.word}" class="word-image"
                 onerror="if(this.src) this.style.display='none'">`
            : ''}
          <div class="word-display-container">
            <div class="word-text ${isDictation ? 'dictation-hide' : ''}" data-len="${wordData.word.length}">${wordDisplay}</div>
            ${isDictation ? `<div class="dictation-hint-text hidden" data-len="${wordData.word.length}">${blankedWordDisplay}</div>` : ''}
            ${isDictation ? `<button class="dictation-hint-btn" type="button" title="Show Hint (H)">Hint</button>` : ''}
          </div>
        </div>
      `;
    }

    if (typeof MediaDB !== 'undefined') {
      const mediaImgEls = section.querySelectorAll('img[data-media-uri]');
      mediaImgEls.forEach(imgEl => {
        const uri = imgEl.dataset.mediaUri;
        if (uri) {
          MediaDB.resolveMediaUrl(uri).then(blobUrl => {
            if (blobUrl) {
              imgEl.src = blobUrl;
              imgEl.style.display = '';
            }
          }).catch(err => {
            console.warn('[MediaDB] Slide image resolution failed:', uri, err);
          });
        }
      });
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
      // Word Quiz and Picture Quiz hide audio until answered so students don't hear the word prematurely.
      // Sound Quiz hides the top audio button completely to maximize vertical space for a larger illustration;
      // students can click the word/picture or use keyboard shortcuts (Shift / Space) anytime to hear audio.
      const isWordOrPicQuiz = slide.dataset.quizMode === 'true' || slide.dataset.pictureQuizMode === 'true';
      const isSoundQuiz = slide.dataset.soundQuizMode === 'true';
      const isAnswered = slide.dataset.answered === 'true';
      const hideAudio = isIntro || isSoundQuiz || (isWordOrPicQuiz && !isAnswered);
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

    if (slideshowResizeHandler) {
      window.removeEventListener('resize', slideshowResizeHandler);
      window.removeEventListener('orientationchange', slideshowResizeHandler);
      slideshowResizeHandler = null;
    }

    // Build the persistent chrome overlay
    initSlideChrome();

    const deck = document.querySelector('#slideshow-screen .reveal');
    const dims = getRevealDimensions();

    revealInstance = new Reveal(deck, {
      width: dims.width,
      height: dims.height,
      margin: dims.margin,

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
      // and map Escape (27) & Backspace (8) to backToMenu()
      // 'H' (72) for Dictation Hint / left navigation
      // '1' (49/97) and '2' (50/98) for option selections
      // 'Shift' (16) for playing audio anytime without revealing answer
      keyboard: {
        32: () => { revealOrPlayCurrentSlideAudio(); },  // Space
        13: () => { revealOrPlayCurrentSlideAudio(); },  // Enter
        27: () => { backToMenu(); },                     // Esc
        8: () => { backToMenu(); },                       // Backspace
        72: () => { handleDictationHintShortcut(); },    // H (Hint)
        49: () => { handleQuizOptionKey(0); },           // 1 (Option 1)
        50: () => { handleQuizOptionKey(1); },           // 2 (Option 2)
        97: () => { handleQuizOptionKey(0); },           // Numpad 1
        98: () => { handleQuizOptionKey(1); },           // Numpad 2
        16: () => { playCurrentSlideAudio(); }           // Shift (Play audio)
      },

      // Touch — let reveal.js handle swipe gestures natively
      touch: true,

      // Disable scroll view on small/mobile screens — always use slide view
      // so swipe navigation and controls work properly
      scrollActivationWidth: 0,
    });
    window.revealInstance = revealInstance;

    revealInstance.initialize().then(() => {
      // Update chrome after reveal.js has set up the .present classes
      updateSlideChrome();
      const currentSlide = getCurrentSlide();
      if (currentSlide && currentSlide.dataset.soundQuizMode === 'true' && currentSlide.dataset.hasImage !== 'true' && currentSlide.dataset.isIntro !== 'true') {
        playCurrentSlideAudio();
      }
    });

    // Dynamic responsive layout updates for orientation / window resize
    let resizeTimer = null;
    slideshowResizeHandler = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!revealInstance) return;
        const currentDims = getRevealDimensions();
        const cfg = revealInstance.getConfig();
        if (cfg.width !== currentDims.width || cfg.height !== currentDims.height) {
          revealInstance.configure({
            width: currentDims.width,
            height: currentDims.height,
            margin: currentDims.margin
          });
          revealInstance.layout();
        }
      }, 150);
    };
    window.addEventListener('resize', slideshowResizeHandler);
    window.addEventListener('orientationchange', slideshowResizeHandler);

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

    // Update chrome and trigger auto-play if needed whenever slide changes
    revealInstance.on('slidechanged', () => {
      AudioPlayer.stop();
      updateSlideChrome();
      const currentSlide = getCurrentSlide();
      if (currentSlide && currentSlide.dataset.soundQuizMode === 'true' && currentSlide.dataset.hasImage !== 'true' && currentSlide.dataset.answered !== 'true' && currentSlide.dataset.isIntro !== 'true') {
        playCurrentSlideAudio();
      }
    });

    // Dedicated keydown handler for Shift key (plays audio without revealing answer)
    if (slideshowKeydownHandler) {
      window.removeEventListener('keydown', slideshowKeydownHandler);
    }
    slideshowKeydownHandler = (e) => {
      if (document.getElementById('slideshow-screen')?.classList.contains('hidden')) return;
      if (e.key === 'Shift') {
        e.preventDefault();
        playCurrentSlideAudio();
      }
    };
    window.addEventListener('keydown', slideshowKeydownHandler);

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

  // ── Select a Choice / Reveal Sound Quiz ────────────────────
  function revealSoundQuizAnswer(slide, clickedBtn = null) {
    if (slide.dataset.answered === 'true') return;

    slide.dataset.answered = 'true';

    const correctSound = slide.dataset.correctSound;
    const buttons = slide.querySelectorAll('.sound-option-btn');
    buttons.forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.sound === correctSound) {
        btn.classList.add('correct');
      } else if (clickedBtn && btn === clickedBtn) {
        btn.classList.add('incorrect');
      }
    });

    const blankedWordEl = slide.querySelector('.sound-quiz-blanked-word');
    if (blankedWordEl && blankedWordEl.dataset.fullWord) {
      blankedWordEl.innerHTML = decodeURIComponent(blankedWordEl.dataset.fullWord);
      blankedWordEl.classList.add('filled');
    }

    playCurrentSlideAudio();
    updateSlideChrome(); // Shows the audio button
  }

  // ── Select a Choice / Reveal Picture Quiz ──────────────────
  function revealPictureQuizAnswer(slide, clickedCard = null) {
    if (slide.dataset.answered === 'true') return;

    slide.dataset.answered = 'true';

    const cards = slide.querySelectorAll('.picture-option-card');
    cards.forEach(card => {
      card.disabled = true;
      card.classList.add('answered');
      if (card.dataset.correct === 'true') {
        card.classList.add('correct');
      } else if (clickedCard && card === clickedCard) {
        card.classList.add('incorrect');
      }
    });

    playCurrentSlideAudio();
    updateSlideChrome(); // Shows the audio button
  }

  // ── Dictation Mode Hint & Reveal ───────────────────────────
  function triggerDictationHint(slide) {
    if (!slide) return;
    const hintBtn = slide.querySelector('.dictation-hint-btn');
    const hintText = slide.querySelector('.dictation-hint-text');
    const wordText = slide.querySelector('.word-text');

    if (hintText && hintText.classList.contains('hidden')) {
      hintText.classList.remove('hidden');
      if (hintBtn) hintBtn.classList.add('hidden');
    } else if (wordText && wordText.classList.contains('dictation-hide')) {
      revealDictationWord(slide);
    }
  }

  function revealDictationWord(slide) {
    if (!slide) return;
    const wordText = slide.querySelector('.word-text');
    const hintBtn = slide.querySelector('.dictation-hint-btn');
    const hintText = slide.querySelector('.dictation-hint-text');

    if (wordText && wordText.classList.contains('dictation-hide')) {
      wordText.classList.remove('dictation-hide');
      if (hintBtn) hintBtn.classList.add('hidden');
      if (hintText) hintText.classList.add('hidden');
      playCurrentSlideAudio();
    }
  }

  function handleDictationHintShortcut() {
    const currentSlide = getCurrentSlide();
    if (!currentSlide) return;

    if (currentSlide.dataset.dictationMode === 'true') {
      const wordTextEl = currentSlide.querySelector('.word-text');
      if (wordTextEl && wordTextEl.classList.contains('dictation-hide')) {
        triggerDictationHint(currentSlide);
        return;
      }
    }

    if (revealInstance) {
      revealInstance.left();
    }
  }

  function handleQuizOptionKey(index) {
    const currentSlide = getCurrentSlide();
    if (!currentSlide) return;

    if (currentSlide.dataset.pictureQuizMode === 'true' && currentSlide.dataset.answered !== 'true') {
      const cards = currentSlide.querySelectorAll('.picture-option-card');
      if (cards && cards[index]) {
        revealPictureQuizAnswer(currentSlide, cards[index]);
      }
      return;
    }

    if (currentSlide.dataset.soundQuizMode === 'true' && currentSlide.dataset.answered !== 'true') {
      const buttons = currentSlide.querySelectorAll('.sound-option-btn');
      if (buttons && buttons[index]) {
        revealSoundQuizAnswer(currentSlide, buttons[index]);
      }
      return;
    }

    if (currentSlide.dataset.quizMode === 'true' && currentSlide.dataset.answered !== 'true') {
      const buttons = currentSlide.querySelectorAll('.quiz-option-btn');
      if (buttons && buttons[index]) {
        revealQuizAnswer(currentSlide, buttons[index]);
      }
      return;
    }
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

    // Picture Quiz Mode Interaction
    if (currentSlide.dataset.pictureQuizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        e.preventDefault();
        e.stopPropagation();
        const clickedCard = e.target.closest('.picture-option-card');
        if (clickedCard) {
          revealPictureQuizAnswer(currentSlide, clickedCard);
        }
      } else {
        const correctCard = e.target.closest('.picture-option-card.correct');
        if (correctCard) {
          e.preventDefault();
          e.stopPropagation();
          playCurrentSlideAudio();
        } else {
          if (revealInstance) {
            revealInstance.next();
          }
        }
      }
      return;
    }

    // Quiz Mode Interaction
    if (currentSlide.dataset.quizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        e.preventDefault();
        e.stopPropagation();
        const clickedOption = e.target.closest('.quiz-option-btn');
        if (clickedOption) {
          revealQuizAnswer(currentSlide, clickedOption);
        }
      } else {
        if (revealInstance) {
          revealInstance.next();
        }
      }
      return;
    }

    // Sound Quiz Mode Interaction
    if (currentSlide.dataset.soundQuizMode === 'true') {
      const clickedAudioTarget = e.target.closest('.sound-quiz-blanked-word, .sound-quiz-layout .quiz-image');
      if (clickedAudioTarget) {
        e.preventDefault();
        e.stopPropagation();
        playCurrentSlideAudio();
        return;
      }

      if (currentSlide.dataset.answered !== 'true') {
        e.preventDefault();
        e.stopPropagation();
        const clickedOption = e.target.closest('.sound-option-btn');
        if (clickedOption) {
          revealSoundQuizAnswer(currentSlide, clickedOption);
        }
      } else {
        if (revealInstance) {
          revealInstance.next();
        }
      }
      return;
    }

    // Dictation Mode Hint Button Click
    const hintBtn = e.target.closest('.dictation-hint-btn');
    if (hintBtn) {
      e.preventDefault();
      e.stopPropagation();
      triggerDictationHint(currentSlide);
      return;
    }

    // Dictation Mode Reveal
    const wordTextElement = currentSlide.querySelector('.word-text');
    if (wordTextElement && wordTextElement.classList.contains('dictation-hide')) {
      e.preventDefault();
      e.stopPropagation();
      revealDictationWord(currentSlide);
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

    // Picture Quiz Mode Keyboard Handling
    if (currentSlide.dataset.pictureQuizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        revealPictureQuizAnswer(currentSlide);
      } else {
        playCurrentSlideAudio();
      }
      return;
    }

    // Sound Quiz Mode Keyboard Handling
    if (currentSlide.dataset.soundQuizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        revealSoundQuizAnswer(currentSlide);
      } else {
        playCurrentSlideAudio();
      }
      return;
    }

    // Quiz Mode Keyboard Handling
    if (currentSlide.dataset.quizMode === 'true') {
      if (currentSlide.dataset.answered !== 'true') {
        revealQuizAnswer(currentSlide);
      } else {
        playCurrentSlideAudio();
      }
      return;
    }

    const wordTextElement = currentSlide.querySelector('.word-text');
    if (wordTextElement && wordTextElement.classList.contains('dictation-hide')) {
      revealDictationWord(currentSlide);
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
    if (typeof MediaDB !== 'undefined') {
      MediaDB.revokeAllUrls();
    }

    if (slideshowKeydownHandler) {
      window.removeEventListener('keydown', slideshowKeydownHandler);
      slideshowKeydownHandler = null;
    }

    if (slideshowResizeHandler) {
      window.removeEventListener('resize', slideshowResizeHandler);
      window.removeEventListener('orientationchange', slideshowResizeHandler);
      slideshowResizeHandler = null;
    }

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

  // ── Chart Mode Delegates ────────────────────────────────────
  function openChart(levelId = null, customUnitIds = null) {
    if (window.ChartScreen) {
      ChartScreen.open(levelId, customUnitIds);
    }
  }

  const openLetterChart = (customUnitIds = null) => openChart('L1', customUnitIds);

  function closeChart() {
    if (window.ChartScreen) {
      ChartScreen.close();
    }
  }

  const closeLetterChart = closeChart;

  // ── Classes & Settings Modal Delegates ──────────────────────
  function populateClassDropdown() {
    if (window.SettingsModal) {
      SettingsModal.populateClassDropdown();
    }
  }

  function openClassModal(tabId = "classes-tab") {
    if (window.SettingsModal) {
      SettingsModal.open(tabId);
    }
  }

  function closeClassModal() {
    if (window.SettingsModal) {
      SettingsModal.close();
    }
  }

  function initClassesUI() {
    if (window.SettingsModal) {
      SettingsModal.init({
        onClassSelect: (cls) => applyClassProfile(cls),
        onClassDeselect: () => resetToDefaultSettings(),
        getSelectedUnitIds: () => getSelectedUnitIds(),
        getOptions: () => options,
        onCurriculumChange: () => renderMenu(),
        showToast: (msg, type, dur) => showToast(msg, type, dur)
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
