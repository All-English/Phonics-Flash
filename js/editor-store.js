/**
 * Phonics Flash — Multi-Book Curriculum Store
 * ============================================
 * Manages first-class textbook series (Smart Phonics, Oxford Phonics World, etc.),
 * levels, units, and words with local persistence, Dexie storage, and Upstash Redis cloud sync.
 *
 * Server files (data/words.json) remain immutable and safe. Custom edits live in browser storage.
 */

window.EditorStore = (() => {
  const LOCAL_STORAGE_KEY = 'phonics-flash-curricula';
  const ACTIVE_BOOK_KEY = 'phonics-flash-active-curriculum';
  const HIDE_BUILTIN_KEY = 'phonics-flash-hide-builtin';
  const UPSTASH_SHARED_KEY = 'shared_phonics_curriculum';
  const UPSTASH_APP_KEY = 'phonics_flash:curriculum';
  const DEFAULT_BOOK_ID = 'smart-phonics';

  let curricula = [];
  let activeCurriculumId = DEFAULT_BOOK_ID;
  let hideBuiltIn = false;
  let isInitialized = false;
  const changeListeners = new Set();

  // ── 1. Event Subscriptions ──────────────────────────────────
  function subscribe(fn) {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  }

  function notifyChange() {
    for (const fn of changeListeners) {
      try {
        fn(getActiveCurriculum(), curricula);
      } catch (e) {
        console.error('[EditorStore] Listener error:', e);
      }
    }
  }

  // ── 2. Local Storage Load & Save ─────────────────────────────
  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          curricula = parsed;
        }
      }
      activeCurriculumId = localStorage.getItem(ACTIVE_BOOK_KEY) || DEFAULT_BOOK_ID;
      hideBuiltIn = localStorage.getItem(HIDE_BUILTIN_KEY) === 'true';
    } catch (e) {
      console.warn('[EditorStore] Error loading local storage:', e);
    }
  }

  function saveToLocalStorage() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(curricula));
      localStorage.setItem(ACTIVE_BOOK_KEY, activeCurriculumId);
      localStorage.setItem(HIDE_BUILTIN_KEY, hideBuiltIn ? 'true' : 'false');
    } catch (e) {
      console.warn('[EditorStore] Error writing to local storage:', e);
    }
  }

  // ── 3. Upstash Cloud Sync ────────────────────────────────────
  function getUpstashCredentials() {
    // 1. Check SharedClassSync if available
    if (typeof SharedClassSync !== 'undefined' && typeof SharedClassSync.getCredentials === 'function') {
      const creds = SharedClassSync.getCredentials();
      if (creds && creds.url && creds.token) return creds;
    }
    // 2. Check localStorage
    if (typeof localStorage !== 'undefined') {
      const url = localStorage.getItem('upstash_redis_url');
      const token = localStorage.getItem('upstash_redis_token');
      if (url && token) return { url: url.trim(), token: token.trim() };
    }
    // 3. Fallback to UPSTASH_CONFIG in config.js
    if (typeof UPSTASH_CONFIG !== 'undefined' && UPSTASH_CONFIG.url && UPSTASH_CONFIG.token) {
      return UPSTASH_CONFIG;
    }
    return null;
  }

  async function pushToUpstash() {
    const creds = getUpstashCredentials();
    if (!creds) return false;

    const payload = {
      version: 1,
      updatedAt: Date.now(),
      activeCurriculumId,
      hideBuiltIn,
      curricula
    };

    try {
      const cleanUrl = creds.url.replace(/\/$/, '');
      const bodyStr = JSON.stringify(payload);

      // Save to shared key for Word-Tac-Toe / MatchMaker / Treasure Hunt
      await fetch(`${cleanUrl}/set/${encodeURIComponent(UPSTASH_SHARED_KEY)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}` },
        body: bodyStr
      });

      // Also mirror to app-specific key
      await fetch(`${cleanUrl}/set/${encodeURIComponent(UPSTASH_APP_KEY)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}` },
        body: bodyStr
      });

      return true;
    } catch (e) {
      console.warn('[EditorStore] Upstash push failed:', e);
      return false;
    }
  }

  async function pullFromUpstash() {
    const creds = getUpstashCredentials();
    if (!creds) return false;

    try {
      const cleanUrl = creds.url.replace(/\/$/, '');
      const res = await fetch(`${cleanUrl}/get/${encodeURIComponent(UPSTASH_SHARED_KEY)}`, {
        headers: { Authorization: `Bearer ${creds.token}` }
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !data.result) return false;

      let remote = null;
      try {
        remote = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      } catch (e) {
        return false;
      }

      if (remote && Array.isArray(remote.curricula) && remote.curricula.length > 0) {
        // Merge or replace
        curricula = remote.curricula;
        if (remote.activeCurriculumId) activeCurriculumId = remote.activeCurriculumId;
        if (typeof remote.hideBuiltIn === 'boolean') hideBuiltIn = remote.hideBuiltIn;
        saveToLocalStorage();
        notifyChange();
        return true;
      }
    } catch (e) {
      console.warn('[EditorStore] Upstash pull failed:', e);
    }
    return false;
  }

  // ── 4. Initialization & Default Base Load ───────────────────
  async function init() {
    if (isInitialized) return;

    loadFromLocalStorage();

    // Check if smart-phonics exists in curricula
    let smartPhonics = curricula.find(c => c.id === DEFAULT_BOOK_ID);

    if (!smartPhonics) {
      // Fetch pristine data/words.json
      try {
        const response = await fetch('data/words.json');
        if (response.ok) {
          const rawData = await response.json();
          smartPhonics = {
            id: DEFAULT_BOOK_ID,
            name: 'Smart Phonics',
            isCustom: false,
            description: '5-Level EFL/ESL Phonics Curriculum',
            levels: rawData.levels || [],
            updatedAt: Date.now()
          };
          curricula.unshift(smartPhonics);
          saveToLocalStorage();
        }
      } catch (e) {
        console.warn('[EditorStore] Could not load data/words.json:', e);
      }
    }

    // Ensure an active book is valid
    if (!curricula.some(c => c.id === activeCurriculumId)) {
      activeCurriculumId = curricula[0]?.id || DEFAULT_BOOK_ID;
    }

    isInitialized = true;

    // Background cloud sync pull
    pullFromUpstash().catch(() => {});
  }

  // ── 5. Curriculum / Book Series CRUD ─────────────────────────
  function getCurricula() {
    if (hideBuiltIn) {
      return curricula.filter(c => c.id !== DEFAULT_BOOK_ID);
    }
    return curricula;
  }

  function getAllCurriculaRaw() {
    return curricula;
  }

  function getCurriculum(id) {
    return curricula.find(c => c.id === id) || null;
  }

  function getActiveCurriculumId() {
    return activeCurriculumId;
  }

  function getActiveCurriculum() {
    let book = getCurriculum(activeCurriculumId);
    if (!book && curricula.length > 0) {
      book = curricula[0];
      activeCurriculumId = book.id;
    }
    return book;
  }

  function setActiveCurriculum(id) {
    if (curricula.some(c => c.id === id)) {
      activeCurriculumId = id;
      saveToLocalStorage();
      notifyChange();
      return true;
    }
    return false;
  }

  function setHideBuiltIn(hide) {
    hideBuiltIn = !!hide;
    if (hideBuiltIn && activeCurriculumId === DEFAULT_BOOK_ID) {
      const custom = curricula.find(c => c.id !== DEFAULT_BOOK_ID);
      if (custom) activeCurriculumId = custom.id;
    }
    saveToLocalStorage();
    notifyChange();
  }

  function isBuiltInHidden() {
    return hideBuiltIn;
  }

  /**
   * Create a new book series.
   */
  function createCurriculum(name, options = {}) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '') || 'book';
    const id = `custom_${slug}_${Date.now().toString(36)}`;

    let levels = [];
    if (options.templateId) {
      const template = getCurriculum(options.templateId);
      if (template) {
        levels = JSON.parse(JSON.stringify(template.levels));
      }
    } else if (options.autoCreateLevels) {
      // Auto-generate 5 empty levels
      const colors = ['#29A8E0', '#F5A623', '#C0452A', '#3DAA5C', '#9B3FAD'];
      for (let i = 1; i <= 5; i++) {
        levels.push({
          id: `${id}_L${i}`,
          name: `Level ${i}`,
          color: colors[i - 1] || '#FF6B6B',
          units: []
        });
      }
    }

    const newBook = {
      id: id,
      name: name.trim(),
      description: options.description || '',
      isCustom: true,
      levels: levels,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    curricula.push(newBook);
    activeCurriculumId = id;
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return newBook;
  }

  function renameCurriculum(id, newName) {
    const book = getCurriculum(id);
    if (!book) return false;
    book.name = newName.trim();
    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  function saveCurriculum(updatedBook) {
    if (!updatedBook || !updatedBook.id) return false;
    const idx = curricula.findIndex(c => c.id === updatedBook.id);
    updatedBook.updatedAt = Date.now();
    if (idx !== -1) {
      curricula[idx] = updatedBook;
    } else {
      curricula.push(updatedBook);
    }
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  function duplicateCurriculum(id, newName) {
    const source = getCurriculum(id);
    if (!source) return null;
    const name = newName || `${source.name} (Copy)`;
    return createCurriculum(name, { templateId: id });
  }

  function deleteCurriculum(id) {
    if (id === DEFAULT_BOOK_ID) {
      console.warn('[EditorStore] Cannot delete built-in Smart Phonics. Use resetToDefaults instead.');
      return false;
    }
    const idx = curricula.findIndex(c => c.id === id);
    if (idx === -1) return false;
    curricula.splice(idx, 1);

    if (activeCurriculumId === id) {
      activeCurriculumId = curricula[0]?.id || DEFAULT_BOOK_ID;
    }
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  /**
   * Reset Smart Phonics to pristine factory defaults from data/words.json
   */
  async function resetToDefaults(id = DEFAULT_BOOK_ID) {
    if (id === DEFAULT_BOOK_ID) {
      try {
        const res = await fetch('data/words.json');
        if (res.ok) {
          const fresh = await res.json();
          const smart = curricula.find(c => c.id === DEFAULT_BOOK_ID);
          if (smart) {
            smart.levels = fresh.levels || [];
            smart.updatedAt = Date.now();
          } else {
            curricula.unshift({
              id: DEFAULT_BOOK_ID,
              name: 'Smart Phonics',
              isCustom: false,
              levels: fresh.levels || [],
              updatedAt: Date.now()
            });
          }
          saveToLocalStorage();
          pushToUpstash();
          notifyChange();
          return true;
        }
      } catch (e) {
        console.error('[EditorStore] Failed to reset to defaults:', e);
      }
    }
    return false;
  }

  // ── 6. Level CRUD ───────────────────────────────────────────
  function saveLevel(currId, levelData) {
    const book = getCurriculum(currId);
    if (!book) return null;

    if (!levelData.id) {
      // New Level
      const nextNum = book.levels.length + 1;
      levelData.id = `${book.id}_L${Date.now()}`;
      if (!levelData.name) levelData.name = `Level ${nextNum}`;
      if (!levelData.units) levelData.units = [];
      book.levels.push(levelData);
    } else {
      // Update existing
      const idx = book.levels.findIndex(l => l.id === levelData.id);
      if (idx !== -1) {
        book.levels[idx] = { ...book.levels[idx], ...levelData };
      } else {
        book.levels.push(levelData);
      }
    }

    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return levelData;
  }

  function deleteLevel(currId, levelId) {
    const book = getCurriculum(currId);
    if (!book) return false;
    const idx = book.levels.findIndex(l => l.id === levelId);
    if (idx === -1) return false;

    book.levels.splice(idx, 1);
    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  function reorderLevels(currId, orderedLevelIds) {
    const book = getCurriculum(currId);
    if (!book) return false;

    const map = new Map(book.levels.map(l => [l.id, l]));
    const newLevels = [];
    for (const id of orderedLevelIds) {
      if (map.has(id)) newLevels.push(map.get(id));
    }
    // Add any missing
    for (const l of book.levels) {
      if (!newLevels.includes(l)) newLevels.push(l);
    }

    book.levels = newLevels;
    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  // ── 7. Unit CRUD ────────────────────────────────────────────
  function saveUnit(currId, levelId, unitData) {
    const book = getCurriculum(currId);
    if (!book) return null;
    const level = book.levels.find(l => l.id === levelId);
    if (!level) return null;

    if (!unitData.id) {
      // New Unit
      const nextNum = level.units.length + 1;
      unitData.id = `${level.id}_U${Date.now()}`;
      if (!unitData.name) unitData.name = `Unit ${nextNum}`;
      if (!unitData.words) unitData.words = [];
      if (!unitData.extraWords) unitData.extraWords = [];
      if (!unitData.sightWords) unitData.sightWords = [];
      level.units.push(unitData);
    } else {
      const idx = level.units.findIndex(u => u.id === unitData.id);
      if (idx !== -1) {
        level.units[idx] = { ...level.units[idx], ...unitData };
      } else {
        level.units.push(unitData);
      }
    }

    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return unitData;
  }

  function deleteUnit(currId, levelId, unitId) {
    const book = getCurriculum(currId);
    if (!book) return false;
    const level = book.levels.find(l => l.id === levelId);
    if (!level) return false;

    const idx = level.units.findIndex(u => u.id === unitId);
    if (idx === -1) return false;

    level.units.splice(idx, 1);
    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  function duplicateUnit(currId, levelId, unitId) {
    const book = getCurriculum(currId);
    if (!book) return null;
    const level = book.levels.find(l => l.id === levelId);
    if (!level) return null;

    const source = level.units.find(u => u.id === unitId);
    if (!source) return null;

    const copy = JSON.parse(JSON.stringify(source));
    copy.id = `${level.id}_U${Date.now()}`;
    copy.name = `${source.name} (Copy)`;
    level.units.push(copy);

    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return copy;
  }

  function reorderUnits(currId, levelId, orderedUnitIds) {
    const book = getCurriculum(currId);
    if (!book) return false;
    const level = book.levels.find(l => l.id === levelId);
    if (!level) return false;

    const map = new Map(level.units.map(u => [u.id, u]));
    const newUnits = [];
    for (const id of orderedUnitIds) {
      if (map.has(id)) newUnits.push(map.get(id));
    }
    for (const u of level.units) {
      if (!newUnits.includes(u)) newUnits.push(u);
    }

    level.units = newUnits;
    book.updatedAt = Date.now();
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return true;
  }

  // ── 8. JSON Export & Import ─────────────────────────────────
  function exportBookJSON(currId = activeCurriculumId) {
    const book = getCurriculum(currId);
    if (!book) return;

    // Build clean JSON matching words.json format
    const exportObj = {
      name: book.name,
      id: book.id,
      description: book.description || '',
      exportedAt: new Date().toISOString(),
      levels: book.levels
    };

    const str = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const filename = `${book.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-curriculum.json`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportWordsJsonFormat(currId = activeCurriculumId) {
    const book = getCurriculum(currId);
    if (!book) return;

    // Pure words.json format for direct replacement in VS Code repository
    const exportObj = {
      levels: book.levels
    };

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

  function importBookJSON(parsedJson) {
    if (!parsedJson || (!parsedJson.levels && !Array.isArray(parsedJson))) {
      throw new Error('Invalid curriculum JSON: Missing "levels" array');
    }

    const levels = Array.isArray(parsedJson) ? parsedJson : parsedJson.levels;
    const bookName = parsedJson.name || `Imported Book (${new Date().toLocaleDateString()})`;
    const slug = bookName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'book';
    const id = `custom_${slug}_${Date.now().toString(36)}`;

    // Ensure IDs are unique
    levels.forEach((lvl, lIdx) => {
      if (!lvl.id) lvl.id = `${id}_L${lIdx + 1}`;
      if (Array.isArray(lvl.units)) {
        lvl.units.forEach((u, uIdx) => {
          if (!u.id) u.id = `${lvl.id}_U${uIdx + 1}`;
        });
      }
    });

    const newBook = {
      id: id,
      name: bookName,
      description: parsedJson.description || 'Imported pack',
      isCustom: true,
      levels: levels,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    curricula.push(newBook);
    activeCurriculumId = id;
    saveToLocalStorage();
    pushToUpstash();
    notifyChange();
    return newBook;
  }

  return {
    init,
    subscribe,
    getCurricula,
    getAllCurriculaRaw,
    getCurriculum,
    getActiveCurriculumId,
    getActiveCurriculum,
    setActiveCurriculum,
    setHideBuiltIn,
    isBuiltInHidden,
    createCurriculum,
    saveCurriculum,
    renameCurriculum,
    duplicateCurriculum,
    deleteCurriculum,
    resetToDefaults,
    saveLevel,
    deleteLevel,
    reorderLevels,
    saveUnit,
    deleteUnit,
    duplicateUnit,
    reorderUnits,
    exportBookJSON,
    exportWordsJsonFormat,
    importBookJSON,
    pushToUpstash,
    pullFromUpstash
  };
})();
