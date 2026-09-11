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
  let initPromise = null;
  let pushDebounceTimer = null;
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

  // ── 2. Storage Persistence (IndexedDB + localStorage preferences) ──
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

  async function saveToStorage() {
    // 1. Primary persistence: Dexie IndexedDB (curriculum table)
    if (typeof MediaDB !== 'undefined' && typeof MediaDB.saveAllCurriculaRecords === 'function') {
      try {
        await MediaDB.saveAllCurriculaRecords(curricula);
      } catch (e) {
        console.warn('[EditorStore] Error writing to IndexedDB:', e);
      }
    }

    // 2. Preferences & lightweight fallback in localStorage
    try {
      localStorage.setItem(ACTIVE_BOOK_KEY, activeCurriculumId);
      localStorage.setItem(HIDE_BUILTIN_KEY, hideBuiltIn ? 'true' : 'false');
      const serialized = JSON.stringify(curricula);
      // Only cache in localStorage if payload is under 2.5MB to avoid QuotaExceededError
      if (serialized.length < 2.5 * 1024 * 1024) {
        localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
      }
    } catch (e) {
      console.warn('[EditorStore] localStorage write error (safe with IndexedDB):', e);
    }
  }

  // Backward compatibility alias
  function saveToLocalStorage() {
    saveToStorage();
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

  function debouncedPushToUpstash() {
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
    pushDebounceTimer = setTimeout(() => {
      pushToUpstash();
    }, 1500);
  }

  async function pushToUpstash() {
    const creds = getUpstashCredentials();
    if (!creds) return false;

    const maxLocalUpdate = curricula.reduce((max, c) => Math.max(max, c.updatedAt || 0), Date.now());

    const payload = {
      version: 1,
      updatedAt: maxLocalUpdate,
      activeCurriculumId,
      hideBuiltIn,
      curricula
    };

    try {
      const cleanUrl = creds.url.replace(/\/$/, '');
      const bodyStr = JSON.stringify(payload);
      const headers = {
        'Authorization': `Bearer ${creds.token}`,
        'Content-Type': 'application/json'
      };

      // Save to shared key for Word-Tac-Toe / MatchMaker / Treasure Hunt
      const res1 = await fetch(`${cleanUrl}/set/${encodeURIComponent(UPSTASH_SHARED_KEY)}`, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      // Also mirror to app-specific key
      const res2 = await fetch(`${cleanUrl}/set/${encodeURIComponent(UPSTASH_APP_KEY)}`, {
        method: 'POST',
        headers,
        body: bodyStr
      });

      return (res1.ok && res2.ok);
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
        // Timestamp check: only replace if remote is genuinely newer than local data
        const localMaxUpdate = curricula.reduce((max, c) => Math.max(max, c.updatedAt || 0), 0);
        if (remote.updatedAt && remote.updatedAt <= localMaxUpdate) {
          // Local edits are newer or matching; do not overwrite!
          return false;
        }

        curricula = remote.curricula;
        if (remote.activeCurriculumId) activeCurriculumId = remote.activeCurriculumId;
        if (typeof remote.hideBuiltIn === 'boolean') hideBuiltIn = remote.hideBuiltIn;
        await saveToStorage();
        notifyChange();
        return true;
      }
    } catch (e) {
      console.warn('[EditorStore] Upstash pull failed:', e);
    }
    return false;
  }

  // ── 4. Initialization & Default Base Load (Mutex Protected) ──
  function init() {
    if (isInitialized) return Promise.resolve();
    if (!initPromise) {
      initPromise = _doInit();
    }
    return initPromise;
  }

  async function _doInit() {
    // 1. Attempt to load from IndexedDB first
    let loadedFromDb = false;
    if (typeof MediaDB !== 'undefined' && typeof MediaDB.getAllCurriculaRecords === 'function') {
      try {
        const idbCurricula = await MediaDB.getAllCurriculaRecords();
        if (Array.isArray(idbCurricula) && idbCurricula.length > 0) {
          curricula = idbCurricula;
          loadedFromDb = true;
        }
      } catch (err) {
        console.warn('[EditorStore] IndexedDB load failed, falling back:', err);
      }
    }

    // 2. Fall back to localStorage and migrate into IndexedDB
    if (!loadedFromDb) {
      loadFromLocalStorage();
      if (curricula.length > 0 && typeof MediaDB !== 'undefined' && typeof MediaDB.saveAllCurriculaRecords === 'function') {
        MediaDB.saveAllCurriculaRecords(curricula).catch(() => {});
      }
    }

    activeCurriculumId = localStorage.getItem(ACTIVE_BOOK_KEY) || DEFAULT_BOOK_ID;
    hideBuiltIn = localStorage.getItem(HIDE_BUILTIN_KEY) === 'true';

    // 3. Check if smart-phonics exists in curricula
    let smartPhonics = curricula.find(c => c.id === DEFAULT_BOOK_ID);

    if (!smartPhonics) {
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
          // Double-check no duplicate was inserted during the async fetch
          if (!curricula.some(c => c.id === DEFAULT_BOOK_ID)) {
            curricula.unshift(smartPhonics);
            await saveToStorage();
          }
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

    // Background cloud sync pull & orphan media pruning
    pullFromUpstash().catch(() => {});
    if (typeof MediaDB !== 'undefined' && typeof MediaDB.pruneOrphanedMedia === 'function') {
      MediaDB.pruneOrphanedMedia(curricula).catch(() => {});
    }
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
        // Regenerate unique level & unit IDs scoped to new book ID (C6)
        levels.forEach((lvl, lIdx) => {
          lvl.id = `${id}_L${lIdx + 1}`;
          if (Array.isArray(lvl.units)) {
            lvl.units.forEach((u, uIdx) => {
              u.id = `${lvl.id}_U${uIdx + 1}`;
            });
          }
        });
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
    saveToStorage();
    debouncedPushToUpstash();
    notifyChange();
    return newBook;
  }

  function renameCurriculum(id, newName) {
    const book = getCurriculum(id);
    if (!book) return false;
    book.name = newName.trim();
    book.updatedAt = Date.now();
    saveToStorage();
    debouncedPushToUpstash();
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
    saveToStorage();
    debouncedPushToUpstash();
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
    const [deletedBook] = curricula.splice(idx, 1);

    // Cascading media and DB record cleanup (C4)
    if (typeof MediaDB !== 'undefined') {
      if (typeof MediaDB.deleteCurriculumMedia === 'function') {
        MediaDB.deleteCurriculumMedia(deletedBook).catch(() => {});
      }
      if (typeof MediaDB.deleteCurriculumRecord === 'function') {
        MediaDB.deleteCurriculumRecord(id).catch(() => {});
      }
    }

    if (activeCurriculumId === id) {
      if (hideBuiltIn) {
        const nextCustom = curricula.find(c => c.id !== DEFAULT_BOOK_ID);
        if (nextCustom) {
          activeCurriculumId = nextCustom.id;
        } else {
          hideBuiltIn = false;
          activeCurriculumId = DEFAULT_BOOK_ID;
        }
      } else {
        activeCurriculumId = curricula[0]?.id || DEFAULT_BOOK_ID;
      }
    }
    saveToStorage();
    debouncedPushToUpstash();
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
          const smart = getCurriculum(DEFAULT_BOOK_ID);
          if (smart) {
            smart.levels = fresh.levels || [];
            smart.updatedAt = Date.now();
          } else {
            curricula.unshift({
              id: DEFAULT_BOOK_ID,
              name: 'Smart Phonics',
              isCustom: false,
              description: '5-Level EFL/ESL Phonics Curriculum',
              levels: fresh.levels || [],
              updatedAt: Date.now()
            });
          }
          saveToStorage();
          debouncedPushToUpstash();
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

    let targetLevel = null;
    if (!levelData.id) {
      // New Level
      const nextNum = book.levels.length + 1;
      levelData.id = `${book.id}_L${Date.now()}`;
      if (!levelData.name) levelData.name = `Level ${nextNum}`;
      if (!levelData.units) levelData.units = [];
      book.levels.push(levelData);
      targetLevel = levelData;
    } else {
      // Update existing
      const idx = book.levels.findIndex(l => l.id === levelData.id);
      if (idx !== -1) {
        book.levels[idx] = { ...book.levels[idx], ...levelData };
        targetLevel = book.levels[idx];
      } else {
        book.levels.push(levelData);
        targetLevel = levelData;
      }
    }

    book.updatedAt = Date.now();
    saveToStorage();
    debouncedPushToUpstash();
    notifyChange();
    return targetLevel;
  }

  function deleteLevel(currId, levelId) {
    const book = getCurriculum(currId);
    if (!book) return false;
    const idx = book.levels.findIndex(l => l.id === levelId);
    if (idx === -1) return false;

    book.levels.splice(idx, 1);
    book.updatedAt = Date.now();
    saveToStorage();
    debouncedPushToUpstash();
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
    saveToStorage();
    debouncedPushToUpstash();
    notifyChange();
    return true;
  }

  // ── 7. Unit CRUD ────────────────────────────────────────────
  function saveUnit(currId, levelId, unitData) {
    const book = getCurriculum(currId);
    if (!book) return null;
    const level = book.levels.find(l => l.id === levelId);
    if (!level) return null;

    let targetUnit = null;
    if (!unitData.id) {
      // New Unit
      const nextNum = level.units.length + 1;
      unitData.id = `${level.id}_U${Date.now()}`;
      if (!unitData.name) unitData.name = `Unit ${nextNum}`;
      if (!unitData.words) unitData.words = [];
      if (!unitData.extraWords) unitData.extraWords = [];
      if (!unitData.sightWords) unitData.sightWords = [];
      level.units.push(unitData);
      targetUnit = unitData;
    } else {
      const idx = level.units.findIndex(u => u.id === unitData.id);
      if (idx !== -1) {
        level.units[idx] = { ...level.units[idx], ...unitData };
        targetUnit = level.units[idx];
      } else {
        level.units.push(unitData);
        targetUnit = unitData;
      }
    }

    book.updatedAt = Date.now();
    saveToStorage();
    debouncedPushToUpstash();
    notifyChange();
    return targetUnit;
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
    saveToStorage();
    debouncedPushToUpstash();
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
    saveToStorage();
    debouncedPushToUpstash();
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
    saveToStorage();
    debouncedPushToUpstash();
    notifyChange();
    return true;
  }

  // ── 8. JSON Export & Import (Portable base64 MediaDB handling - H10) ────
  async function _embedBlobsForExport(levels) {
    const cloned = JSON.parse(JSON.stringify(levels));
    if (typeof MediaDB === 'undefined' || typeof MediaDB.getMediaBlob !== 'function') {
      return cloned;
    }

    for (const lvl of cloned) {
      if (!Array.isArray(lvl.units)) continue;
      for (const u of lvl.units) {
        const wordLists = [u.words, u.extraWords, u.sightWords];
        for (const list of wordLists) {
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            if (item.image && MediaDB.isMediaId(item.image)) {
              try {
                const blob = await MediaDB.getMediaBlob(item.image);
                if (blob) {
                  item.image = await MediaDB.blobToBase64(blob);
                }
              } catch (e) {
                console.warn('[EditorStore] Export blob conversion failed for image:', item.image, e);
              }
            }
            if (item.audio && MediaDB.isMediaId(item.audio)) {
              try {
                const blob = await MediaDB.getMediaBlob(item.audio);
                if (blob) {
                  item.audio = await MediaDB.blobToBase64(blob);
                }
              } catch (e) {
                console.warn('[EditorStore] Export blob conversion failed for audio:', item.audio, e);
              }
            }
          }
        }
      }
    }
    return cloned;
  }

  async function _extractBlobsForImport(levels) {
    if (typeof MediaDB === 'undefined' || typeof MediaDB.saveMediaBlob !== 'function') {
      return;
    }

    for (const lvl of levels) {
      if (!Array.isArray(lvl.units)) continue;
      for (const u of lvl.units) {
        const wordLists = [u.words, u.extraWords, u.sightWords];
        for (const list of wordLists) {
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            if (item.image && typeof item.image === 'string' && item.image.startsWith('data:image/')) {
              try {
                const blob = await MediaDB.base64ToBlob(item.image);
                item.image = await MediaDB.saveMediaBlob(blob, 'img');
              } catch (e) {
                console.warn('[EditorStore] Import base64 conversion failed for image:', e);
              }
            }
            if (item.audio && typeof item.audio === 'string' && item.audio.startsWith('data:audio/')) {
              try {
                const blob = await MediaDB.base64ToBlob(item.audio);
                item.audio = await MediaDB.saveMediaBlob(blob, 'audio');
              } catch (e) {
                console.warn('[EditorStore] Import base64 conversion failed for audio:', e);
              }
            }
          }
        }
      }
    }
  }

  async function exportBookJSON(currId = activeCurriculumId) {
    const book = getCurriculum(currId);
    if (!book) return;

    // Convert local media: URIs to portable base64 Data URLs (H10)
    const exportLevels = await _embedBlobsForExport(book.levels);
    const exportObj = {
      name: book.name,
      id: book.id,
      description: book.description || '',
      exportedAt: new Date().toISOString(),
      levels: exportLevels
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

  async function exportWordsJsonFormat(currId = activeCurriculumId) {
    const book = getCurriculum(currId);
    if (!book) return;

    // Convert local media: URIs to portable base64 Data URLs (H10)
    const exportLevels = await _embedBlobsForExport(book.levels);
    const exportObj = {
      levels: exportLevels
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

  async function importBookJSON(parsedJson) {
    if (!parsedJson || (!parsedJson.levels && !Array.isArray(parsedJson))) {
      throw new Error('Invalid curriculum JSON: Missing "levels" array');
    }

    const levels = Array.isArray(parsedJson) ? parsedJson : parsedJson.levels;
    const bookName = parsedJson.name || `Imported Book (${new Date().toLocaleDateString()})`;
    const slug = bookName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'book';
    const id = `custom_${slug}_${Date.now().toString(36)}`;

    // Convert any embedded base64 data URIs into local MediaDB blobs (H10)
    await _extractBlobsForImport(levels);

    // Ensure IDs are unique - always regenerate level and unit IDs scoped to this newly created book id (C6)
    levels.forEach((lvl, lIdx) => {
      lvl.id = `${id}_L${lIdx + 1}`;
      if (Array.isArray(lvl.units)) {
        lvl.units.forEach((u, uIdx) => {
          u.id = `${lvl.id}_U${uIdx + 1}`;
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
    saveToStorage();
    debouncedPushToUpstash();
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
    saveToStorage,
    debouncedPushToUpstash,
    pushToUpstash,
    pullFromUpstash
  };
})();
