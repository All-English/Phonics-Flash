/**
 * Phonics Flash — Classes & Auto-Schedule Manager
 * ===============================================
 * Handles class profiles, time/day matching, local persistence,
 * and namespaced Upstash Redis cloud synchronization.
 */

window.ClassesManager = (() => {
  const STORAGE_KEY = 'phonics-flash-classes';
  const UPSTASH_LOCAL_KEY = 'phonics-flash-upstash-config';
  const REDIS_KEY = 'phonics_flash:classes';

  // ── Helper: Get Upstash Credentials ─────────────────────────
  function getUpstashConfig() {
    // Check localStorage first
    try {
      const local = JSON.parse(localStorage.getItem(UPSTASH_LOCAL_KEY) || '{}');
      if (local.url && local.token) return local;
    } catch (e) { /* ignore */ }

    // Fall back to config.js if defined
    if (typeof UPSTASH_CONFIG !== 'undefined' && UPSTASH_CONFIG.url && UPSTASH_CONFIG.token) {
      return UPSTASH_CONFIG;
    }

    return null;
  }

  function setUpstashConfig(url, token) {
    if (!url && !token) {
      localStorage.removeItem(UPSTASH_LOCAL_KEY);
    } else {
      localStorage.setItem(UPSTASH_LOCAL_KEY, JSON.stringify({ url: url.trim(), token: token.trim() }));
    }
  }

  // ── Local Storage Store ─────────────────────────────────────
  function loadLocalData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.classes)) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[ClassesManager] Error loading local classes:', e);
    }

    return {
      classes: [],
      activeClassId: null,
      updatedAt: Date.now()
    };
  }

  function saveLocalData(data) {
    data.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  // ── Auto-Schedule Day/Time Matching ─────────────────────────
  function findCurrentScheduledClass(classes, date = new Date()) {
    if (!classes || classes.length === 0) return null;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[date.getDay()];
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    // Filter classes that run on the current day
    const todaysClasses = classes.filter(cls => 
      cls.schedule && Array.isArray(cls.schedule.days) && cls.schedule.days.includes(currentDay)
    ).map(cls => {
      const startParts = (cls.schedule.startTime || '00:00').split(':').map(Number);
      const endParts = (cls.schedule.endTime || '23:59').split(':').map(Number);
      const startMin = (startParts[0] || 0) * 60 + (startParts[1] || 0);
      let endMin = (endParts[0] || 0) * 60 + (endParts[1] || 0);
      if (endMin <= startMin) {
        endMin = startMin + 45; // Default 45 min duration
      }
      return { cls, startMin, endMin };
    });

    if (todaysClasses.length === 0) return null;

    // 1. First Priority: Is a class currently in-session right now?
    const inSession = todaysClasses.filter(c => currentMinutes >= c.startMin && currentMinutes < c.endMin);
    if (inSession.length > 0) {
      // If boundary overlap, pick the most recently started active class
      inSession.sort((a, b) => b.startMin - a.startMin);
      return inSession[0].cls;
    }

    // 2. Second Priority: An upcoming class starting soon (within 20 minutes before class)
    const upcoming = todaysClasses.filter(c => currentMinutes < c.startMin && (c.startMin - currentMinutes) <= 20);
    if (upcoming.length > 0) {
      upcoming.sort((a, b) => a.startMin - b.startMin);
      return upcoming[0].cls;
    }

    // 3. Third Priority: Class just finished (within 10 minutes grace wrap-up window)
    const justEnded = todaysClasses.filter(c => currentMinutes >= c.endMin && (currentMinutes - c.endMin) <= 10);
    if (justEnded.length > 0) {
      justEnded.sort((a, b) => b.endMin - a.endMin);
      return justEnded[0].cls;
    }

    return null;
  }

  // ── Upstash REST Cloud Sync (Key: phonics_flash:classes) ─────
  async function fetchFromUpstash() {
    const config = getUpstashConfig();
    if (!config || !config.url || !config.token) return null;

    try {
      const cleanUrl = config.url.replace(/\/+$/, '');
      const response = await fetch(`${cleanUrl}/get/${encodeURIComponent(REDIS_KEY)}`, {
        headers: {
          Authorization: `Bearer ${config.token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Upstash HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data && data.result) {
        const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
        return parsed;
      }
    } catch (err) {
      console.warn('[ClassesManager] Upstash cloud pull failed:', err);
    }
    return null;
  }

  async function pushToUpstash(data) {
    const config = getUpstashConfig();
    if (!config || !config.url || !config.token) return false;

    try {
      const cleanUrl = config.url.replace(/\/+$/, '');
      const payload = JSON.stringify(data);
      const response = await fetch(`${cleanUrl}/set/${encodeURIComponent(REDIS_KEY)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Upstash HTTP ${response.status}`);
      }

      const resData = await response.json();
      return resData && resData.result === 'OK';
    } catch (err) {
      console.warn('[ClassesManager] Upstash cloud push failed:', err);
      return false;
    }
  }

  // Debounced auto-push to prevent spamming REST API on rapid checkbox changes
  let pushTimeout = null;
  function debouncedPushToUpstash(data) {
    if (pushTimeout) clearTimeout(pushTimeout);
    pushTimeout = setTimeout(() => {
      pushToUpstash(data);
    }, 1500);
  }

  // ── Public API ──────────────────────────────────────────────
  return {
    getUpstashConfig,
    setUpstashConfig,

    getStore() {
      return loadLocalData();
    },

    getClasses() {
      return loadLocalData().classes || [];
    },

    getActiveClass() {
      const store = loadLocalData();
      if (!store.activeClassId) return null;
      return store.classes.find(c => c.id === store.activeClassId) || null;
    },

    setActiveClassId(classId) {
      const store = loadLocalData();
      store.activeClassId = classId || null;
      saveLocalData(store);
      debouncedPushToUpstash(store);
      return store;
    },

    addClass(classObj) {
      const store = loadLocalData();
      const newClass = {
        id: `class_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        name: classObj.name || 'Untitled Class',
        schedule: {
          days: classObj.schedule?.days || ['Mon', 'Wed', 'Fri'],
          startTime: classObj.schedule?.startTime || '15:00',
          endTime: classObj.schedule?.endTime || '15:50'
        },
        selectedUnits: classObj.selectedUnits || [],
        options: {
          includeExtras: !!classObj.options?.includeExtras,
          includeSightWords: !!classObj.options?.includeSightWords,
          includeImages: classObj.options?.includeImages !== false,
          letterCase: classObj.options?.letterCase || 'both',
          mixMode: !!classObj.options?.mixMode,
          dictationMode: !!classObj.options?.dictationMode,
          quizMode: !!classObj.options?.quizMode
        },
        updatedAt: Date.now()
      };

      store.classes.push(newClass);
      store.activeClassId = newClass.id;
      saveLocalData(store);
      debouncedPushToUpstash(store);
      return newClass;
    },

    updateClass(classId, updates) {
      const store = loadLocalData();
      const idx = store.classes.findIndex(c => c.id === classId);
      if (idx === -1) return null;

      store.classes[idx] = {
        ...store.classes[idx],
        ...updates,
        updatedAt: Date.now()
      };

      saveLocalData(store);
      debouncedPushToUpstash(store);
      return store.classes[idx];
    },

    deleteClass(classId) {
      const store = loadLocalData();
      store.classes = store.classes.filter(c => c.id !== classId);
      if (store.activeClassId === classId) {
        store.activeClassId = null;
      }
      saveLocalData(store);
      debouncedPushToUpstash(store);
      return store;
    },

    saveCurrentToActiveClass(selectedUnits, currentOptions) {
      const store = loadLocalData();
      if (!store.activeClassId) return null;

      const cls = store.classes.find(c => c.id === store.activeClassId);
      if (!cls) return null;

      cls.selectedUnits = [...selectedUnits];
      cls.options = {
        includeExtras: !!currentOptions.includeExtras,
        includeSightWords: !!currentOptions.includeSightWords,
        includeImages: currentOptions.includeImages !== false,
        letterCase: currentOptions.letterCase || 'both',
        mixMode: !!currentOptions.mixMode,
        dictationMode: !!currentOptions.dictationMode,
        quizMode: !!currentOptions.quizMode
      };
      cls.updatedAt = Date.now();

      saveLocalData(store);
      debouncedPushToUpstash(store);
      return cls;
    },

    findCurrentScheduledClass(date) {
      const store = loadLocalData();
      return findCurrentScheduledClass(store.classes, date);
    },

    async syncCloud() {
      const remote = await fetchFromUpstash();
      const local = loadLocalData();

      if (!remote) {
        // No remote data or pull failed, try pushing local
        const pushed = await pushToUpstash(local);
        return { success: pushed, source: 'local_pushed' };
      }

      // If remote is newer, update local
      const remoteTime = remote.updatedAt || 0;
      const localTime = local.updatedAt || 0;

      if (remoteTime > localTime) {
        saveLocalData(remote);
        return { success: true, source: 'remote_loaded', data: remote };
      } else {
        await pushToUpstash(local);
        return { success: true, source: 'local_synced', data: local };
      }
    },

    exportJSON() {
      const store = loadLocalData();
      return JSON.stringify(store, null, 2);
    },

    importJSON(jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed && Array.isArray(parsed.classes)) {
          parsed.updatedAt = Date.now();
          saveLocalData(parsed);
          debouncedPushToUpstash(parsed);
          return { success: true, count: parsed.classes.length };
        }
      } catch (e) {
        return { success: false, error: e.message };
      }
      return { success: false, error: 'Invalid class backup format' };
    }
  };
})();
