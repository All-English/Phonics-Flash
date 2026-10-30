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
    // 1. Check SharedClassSync if available
    if (typeof window !== 'undefined' && window.SharedClassSync?.getCredentials) {
      const creds = window.SharedClassSync.getCredentials();
      if (creds && creds.url && creds.token) {
        return { url: creds.url.trim(), token: creds.token.trim() };
      }
    }

    // 2. Check shared Upstash keys used across all apps
    if (typeof localStorage !== 'undefined') {
      const sharedUrl = localStorage.getItem('upstash_redis_url');
      const sharedToken = localStorage.getItem('upstash_redis_token');
      if (sharedUrl && sharedToken) {
        return { url: sharedUrl.trim(), token: sharedToken.trim() };
      }
    }

    // 3. Check localStorage phonics-flash-upstash-config
    try {
      const local = JSON.parse(localStorage.getItem(UPSTASH_LOCAL_KEY) || '{}');
      if (local.url && local.token) return local;
    } catch (e) { /* ignore */ }

    // 4. Fall back to config.js if defined
    if (typeof UPSTASH_CONFIG !== 'undefined' && UPSTASH_CONFIG.url && UPSTASH_CONFIG.token) {
      return UPSTASH_CONFIG;
    }

    return null;
  }

  function setUpstashConfig(url, token) {
    if (!url && !token) {
      localStorage.removeItem(UPSTASH_LOCAL_KEY);
      localStorage.removeItem('upstash_redis_url');
      localStorage.removeItem('upstash_redis_token');
      if (typeof window !== 'undefined' && window.SharedClassSync?.clearCredentials) {
        window.SharedClassSync.clearCredentials();
      }
    } else {
      localStorage.setItem(UPSTASH_LOCAL_KEY, JSON.stringify({ url: url.trim(), token: token.trim() }));
      // Also write to shared keys so all apps stay aligned
      localStorage.setItem('upstash_redis_url', url.trim());
      localStorage.setItem('upstash_redis_token', token.trim());
      if (typeof window !== 'undefined' && window.SharedClassSync?.saveCredentials) {
        window.SharedClassSync.saveCredentials(url, token);
      }
    }
  }

  // ── Local Storage Store ─────────────────────────────────────
  function loadLocalData() {
    let classes = [];
    let activeClassId = null;
    let updatedAt = 0;

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.classes)) {
          classes = parsed.classes;
          activeClassId = parsed.activeClassId || null;
          updatedAt = parsed.updatedAt || 0;
        }
      }
    } catch (e) {
      console.warn('[ClassesManager] Error loading local classes:', e);
    }

    // Merge with SharedClassSync player sets & profiles if available
    if (typeof SharedClassSync !== 'undefined') {
      try {
        const rawSets = localStorage.getItem(SharedClassSync.SHARED_SETS_KEY);
        const rawProfiles = localStorage.getItem(SharedClassSync.SHARED_CLASS_PROFILES_KEY);
        const sets = rawSets ? JSON.parse(rawSets) : {};
        const profiles = rawProfiles ? JSON.parse(rawProfiles) : {};

        const allSharedNames = new Set([
          ...Object.keys(sets),
          ...Object.keys(profiles),
          ...classes.map(c => c.name).filter(Boolean)
        ]);
        let profilesDirty = false;

        // Ensure all shared player sets and class profiles exist as classes
        for (const setName of allSharedNames) {
          const playerList = sets[setName];
          let existing = classes.find(c => c.name === setName);
          const prof = profiles[setName] || {};
          const sched = prof.schedule || SharedClassSync.parseScheduleFromName(setName);
          const savedUnits = Array.isArray(prof.units)
            ? prof.units.map(u => SharedClassSync.toPhonicsFlash(u) || u).filter(Boolean)
            : [];

          if (!existing) {
            existing = {
              id: `shared_${setName.replace(/[^a-zA-Z0-9]/g, '_')}`,
              name: setName,
              schedule: sched,
              curriculumId: prof.curriculumId || 'smart-phonics',
              selectedUnits: savedUnits,
              options: {
                includeExtras: false,
                includeSightWords: true,
                sightWordsOnly: false,
                includeImages: true,
                letterCase: 'both',
                mixMode: false,
                dictationMode: false,
                quizMode: false,
                soundQuizMode: false,
                pictureQuizMode: false,
                wordChart: false,
                highlightSounds: true
              },
              players: Array.isArray(playerList) ? playerList : [],
              updatedAt: prof.updatedAt || 0
            };
            classes.push(existing);
          } else {
            const profTime = prof.updatedAt || 0;
            const localTime = existing.updatedAt || 0;

            // Keep schedule aligned with shared_class_profiles if shared profile has one and is newer, or if local is missing
            if (!existing.schedule && sched) {
              existing.schedule = sched;
            } else if (prof.schedule && profTime > localTime) {
              existing.schedule = prof.schedule;
            }

            if (prof.curriculumId && (profTime > localTime || !existing.curriculumId)) {
              existing.curriculumId = prof.curriculumId;
            } else if (!existing.curriculumId) {
              existing.curriculumId = 'smart-phonics';
            }

            // Adopt units from shared_class_profiles when shared profile has non-empty units and is newer (or local has no units)
            if (savedUnits.length > 0 && (profTime > localTime || !Array.isArray(existing.selectedUnits) || existing.selectedUnits.length === 0)) {
              existing.selectedUnits = [...savedUnits];
              if (profTime > localTime) existing.updatedAt = profTime;
            } else if (Array.isArray(existing.selectedUnits) && existing.selectedUnits.length > 0 && (localTime > profTime || savedUnits.length === 0)) {
              // Local Phonics Flash class has units that shared_class_profiles lacks or is newer: propagate to shared_class_profiles
              const canonicals = existing.selectedUnits
                .map(u => SharedClassSync.toCanonicalUnit(u)?.id)
                .filter(Boolean);
              if (canonicals.length > 0) {
                profiles[setName] = {
                  ...prof,
                  schedule: existing.schedule || sched,
                  curriculumId: existing.curriculumId || 'smart-phonics',
                  units: canonicals,
                  updatedAt: Math.max(localTime, profTime)
                };
                profilesDirty = true;
              }
            }

            if (Array.isArray(playerList)) existing.players = playerList;
          }
        }

        if (profilesDirty) {
          localStorage.setItem(SharedClassSync.SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
        }
      } catch (err) {
        console.warn('[ClassesManager] Error merging shared sets:', err);
      }
    }

    return {
      classes,
      activeClassId,
      updatedAt
    };
  }

  function saveLocalData(data, { touchUpdatedAt = true } = {}) {
    if (touchUpdatedAt) {
      data.updatedAt = Date.now();
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  // ── Auto-Schedule Day/Time Matching (Strict In-Session) ──────
  function findCurrentScheduledClass(classes, date = new Date()) {
    if (!classes || classes.length === 0) return null;

    if (typeof SharedClassSync !== 'undefined') {
      const profiles = {};
      classes.forEach(c => {
        profiles[c.name] = { schedule: c.schedule };
      });
      const match = SharedClassSync.findActiveScheduledClass(profiles, date);
      if (match) {
        return classes.find(c => c.name === match.className) || null;
      }
      return null;
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[date.getDay()];
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    for (const cls of classes) {
      if (!cls.schedule || !Array.isArray(cls.schedule.days) || !cls.schedule.days.includes(currentDay)) {
        continue;
      }
      const startParts = (cls.schedule.startTime || '00:00').split(':').map(Number);
      const endParts = (cls.schedule.endTime || '23:59').split(':').map(Number);
      const startMin = (startParts[0] || 0) * 60 + (startParts[1] || 0);
      let endMin = (endParts[0] || 0) * 60 + (endParts[1] || 0);
      if (endMin <= startMin) endMin = startMin + 60;

      if (currentMinutes >= startMin && currentMinutes < endMin) {
        return cls;
      }
    }

    return null;
  }

  // ── Helper: Schedule Auto-Parser from Class Name ────────────
  function format24Hour(hour, minute, ampm) {
    let h = hour;
    const m = minute || 0;
    if (ampm === 'pm' && h < 12) {
      h += 12;
    } else if (ampm === 'am' && h === 12) {
      h = 0;
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function addMinutesToTime(timeStr, minsToAdd) {
    const [hStr, mStr] = timeStr.split(':');
    const totalMins = (parseInt(hStr, 10) * 60 + parseInt(mStr, 10) + minsToAdd) % (24 * 60);
    const newH = Math.floor(totalMins / 60);
    const newM = totalMins % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  }

  function parseScheduleFromClassName(name) {
    if (!name || typeof name !== 'string') return { days: null, time: null };
    const trimmed = name.trim();
    if (!trimmed) return { days: null, time: null };

    const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    let parsedDays = new Set();

    // Strip out AM / PM strings so they do not falsely trigger day tokens like "M"
    const cleanForDays = trimmed.replace(/\b[ap]\.?m\.?\b/gi, ' ');

    if (/\b(?:mon(?:day)?\s*[-–~to]+\s*fri(?:day)?|m\s*[-–~]\s*f|weekdays?)\b/i.test(cleanForDays)) {
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].forEach(d => parsedDays.add(d));
    } else if (/\b(?:weekends?)\b/i.test(cleanForDays)) {
      ['Sat', 'Sun'].forEach(d => parsedDays.add(d));
    } else if (/\b(?:every\s*day|daily)\b/i.test(cleanForDays)) {
      ALL_DAYS.forEach(d => parsedDays.add(d));
    } else {
      const upperTokens = cleanForDays.toUpperCase();
      if (/\bMWF\b/.test(upperTokens) || /\bM[\/,\-\s]+W[\/,\-\s]+F\b/i.test(cleanForDays)) {
        ['Mon', 'Wed', 'Fri'].forEach(d => parsedDays.add(d));
      }
      if (/\b(?:TTHS|TTS)\b/.test(upperTokens)) {
        ['Tue', 'Thu', 'Sat'].forEach(d => parsedDays.add(d));
      } else if (/\b(?:TTH|TR|TT)\b/.test(upperTokens) || /\bT[\/,\-\s]+TH\b/i.test(cleanForDays)) {
        ['Tue', 'Thu'].forEach(d => parsedDays.add(d));
      }
      if (/\bMW\b/.test(upperTokens) || /\bM[\/,\-\s]+W\b/i.test(cleanForDays)) {
        ['Mon', 'Wed'].forEach(d => parsedDays.add(d));
      }
      if (/\bWF\b/.test(upperTokens) || /\bW[\/,\-\s]+F\b/i.test(cleanForDays)) {
        ['Wed', 'Fri'].forEach(d => parsedDays.add(d));
      }
      if (/\bMF\b/.test(upperTokens) || /\bM[\/,\-\s]+F\b/i.test(cleanForDays)) {
        ['Mon', 'Fri'].forEach(d => parsedDays.add(d));
      }

      if (/\b(?:mon|monday)s?\b/i.test(cleanForDays)) parsedDays.add('Mon');
      if (/\b(?:tue|tues|tuesday)s?\b/i.test(cleanForDays)) parsedDays.add('Tue');
      if (/\b(?:wed|weds|wednesday)s?\b/i.test(cleanForDays)) parsedDays.add('Wed');
      if (/\b(?:thu|thur|thurs|thursday|th)s?\b/i.test(cleanForDays)) parsedDays.add('Thu');
      if (/\b(?:fri|friday)s?\b/i.test(cleanForDays)) parsedDays.add('Fri');
      if (/\b(?:sat|satur|saturday|sa)s?\b/i.test(cleanForDays)) parsedDays.add('Sat');
      if (/\b(?:sun|sunday|su)s?\b/i.test(cleanForDays)) parsedDays.add('Sun');

      // Standalone single letters if no days matched yet
      if (parsedDays.size === 0) {
        if (/\bM\b/i.test(cleanForDays)) parsedDays.add('Mon');
        if (/\bW\b/i.test(cleanForDays)) parsedDays.add('Wed');
        if (/\bF\b/i.test(cleanForDays)) parsedDays.add('Fri');
      }
    }

    const orderedDays = ALL_DAYS.filter(d => parsedDays.has(d));
    let parsedTime = null;

    // 1. Time range: e.g. "9:00 - 9:50", "9:00-9:50", "9 - 9:50", "9:00 to 9:50", "1:30pm - 2:20pm"
    const rangeRegex = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|~|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;
    const rangeMatch = trimmed.match(rangeRegex);

    if (rangeMatch && (rangeMatch[2] !== undefined || rangeMatch[3] !== undefined || rangeMatch[5] !== undefined || rangeMatch[6] !== undefined)) {
      const sH = parseInt(rangeMatch[1], 10);
      const sM = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
      const sAmPm = rangeMatch[3]?.toLowerCase();

      const eH = parseInt(rangeMatch[4], 10);
      const eM = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
      const eAmPm = rangeMatch[6]?.toLowerCase();

      if (sH >= 0 && sH <= 24 && eH >= 0 && eH <= 24 && sM >= 0 && sM < 60 && eM >= 0 && eM < 60) {
        const resolvedEndAmPm = eAmPm || (eH < 12 ? 'pm' : undefined);
        const resolvedStartAmPm = sAmPm || (eAmPm ? eAmPm : (sH < 12 ? 'pm' : undefined));

        const startTime = format24Hour(sH, sM, resolvedStartAmPm);
        const endTime = format24Hour(eH, eM, resolvedEndAmPm);
        parsedTime = { startTime, endTime };
      }
    }

    // 2. Single time with colon: e.g. "9:00", "9:00pm", "03:30", "15:00"
    if (!parsedTime) {
      const colonMatch = trimmed.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
      if (colonMatch) {
        const h = parseInt(colonMatch[1], 10);
        const min = parseInt(colonMatch[2], 10);
        const ampm = colonMatch[3]?.toLowerCase();
        if (h >= 0 && h <= 24 && min >= 0 && min < 60) {
          const resolvedAmPm = ampm || (h < 12 ? 'pm' : undefined);
          const startTime = format24Hour(h, min, resolvedAmPm);
          const endTime = addMinutesToTime(startTime, 60);
          parsedTime = { startTime, endTime };
        }
      }
    }

    // 3. Single time with explicit am/pm: e.g. "9pm", "10am", "4 pm"
    if (!parsedTime) {
      const ampmMatch = trimmed.match(/\b(\d{1,2})\s*(am|pm)\b/i);
      if (ampmMatch) {
        const h = parseInt(ampmMatch[1], 10);
        const ampm = ampmMatch[2].toLowerCase();
        if (h >= 0 && h <= 24) {
          const startTime = format24Hour(h, 0, ampm);
          const endTime = addMinutesToTime(startTime, 60);
          parsedTime = { startTime, endTime };
        }
      }
    }

    // 4. Standalone hour following day or at/@: e.g. "MWF 9", "Level 2 at 9", "Mon 3"
    if (!parsedTime) {
      const dayPrefixMatch = trimmed.match(/(?:@|\b(?:at|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|mwf|tth|tts|mw|wf|mf))\s+(\d{1,2})\b/i);
      if (dayPrefixMatch) {
        const h = parseInt(dayPrefixMatch[1], 10);
        if (h >= 1 && h <= 12) {
          const startTime = format24Hour(h, 0, 'pm');
          const endTime = addMinutesToTime(startTime, 60);
          parsedTime = { startTime, endTime };
        }
      }
    }

    return {
      days: orderedDays.length > 0 ? orderedDays : null,
      time: parsedTime
    };
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

    getActiveClassId() {
      return loadLocalData().activeClassId || null;
    },

    setActiveClassId(classId) {
      const store = loadLocalData();
      store.activeClassId = classId || null;
      saveLocalData(store, { touchUpdatedAt: false });

      if (typeof SharedClassSync !== 'undefined') {
        const cls = classId ? store.classes.find(c => c.id === classId) : null;
        if (cls && cls.name) {
          try {
            localStorage.setItem(SharedClassSync.SHARED_ACTIVE_CLASS_KEY, cls.name);
          } catch {}
          SharedClassSync.writeSharedSyncCookie?.({ actClass: cls.name });
        } else {
          try {
            localStorage.removeItem(SharedClassSync.SHARED_ACTIVE_CLASS_KEY);
          } catch {}
          SharedClassSync.writeSharedSyncCookie?.({ actClass: '' });
        }
      }
      return store;
    },

    addClass(classObj) {
      const store = loadLocalData();
      const newClass = {
        id: `class_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        name: classObj.name || 'Untitled Class',
        curriculumId: classObj.curriculumId || 'smart-phonics',
        schedule: {
          days: classObj.schedule?.days || ['Mon', 'Wed', 'Fri'],
          startTime: classObj.schedule?.startTime || '15:00',
          endTime: classObj.schedule?.endTime || '16:00'
        },
        selectedUnits: classObj.selectedUnits || [],
        options: {
          includeExtras: !!classObj.options?.includeExtras,
          includeSightWords: !!classObj.options?.includeSightWords,
          sightWordsOnly: !!classObj.options?.sightWordsOnly,
          includeImages: classObj.options?.includeImages !== false,
          letterCase: classObj.options?.letterCase || 'both',
          mixMode: !!classObj.options?.mixMode,
          dictationMode: !!classObj.options?.dictationMode,
          quizMode: !!classObj.options?.quizMode,
          soundQuizMode: !!classObj.options?.soundQuizMode,
          pictureQuizMode: !!classObj.options?.pictureQuizMode,
          wordChart: !!classObj.options?.wordChart,
          highlightSounds: !!classObj.options?.highlightSounds
        },
        updatedAt: Date.now()
      };

      if (typeof SharedClassSync !== 'undefined') {
        try {
          const profiles = JSON.parse(localStorage.getItem(SharedClassSync.SHARED_CLASS_PROFILES_KEY) || '{}');
          const existingProf = profiles[newClass.name];
          if ((!newClass.selectedUnits || newClass.selectedUnits.length === 0) && Array.isArray(existingProf?.units) && existingProf.units.length > 0) {
            newClass.selectedUnits = existingProf.units.map(u => SharedClassSync.toPhonicsFlash(u) || u).filter(Boolean);
          }
          profiles[newClass.name] = {
            ...(existingProf || {}),
            schedule: newClass.schedule,
            curriculumId: newClass.curriculumId,
            units: (newClass.selectedUnits && newClass.selectedUnits.length > 0)
              ? newClass.selectedUnits.map(u => SharedClassSync.toCanonicalUnit(u)?.id || u).filter(Boolean)
              : (existingProf?.units || []),
            updatedAt: newClass.updatedAt
          };
          localStorage.setItem(SharedClassSync.SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
        } catch {}
        if (newClass.selectedUnits && newClass.selectedUnits.length > 0) {
          SharedClassSync.saveClassUnits(newClass.name, newClass.selectedUnits, newClass.curriculumId);
        }
      }

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

      const updated = store.classes[idx];
      saveLocalData(store);
      debouncedPushToUpstash(store);

      if (typeof SharedClassSync !== 'undefined') {
        try {
          const profiles = JSON.parse(localStorage.getItem(SharedClassSync.SHARED_CLASS_PROFILES_KEY) || '{}');
          const existingProf = profiles[updated.name];
          const updatedCanonicals = Array.isArray(updated.selectedUnits) && updated.selectedUnits.length > 0
            ? updated.selectedUnits.map(u => SharedClassSync.toCanonicalUnit(u)?.id || u).filter(Boolean)
            : (existingProf?.units || []);
          profiles[updated.name] = {
            ...(existingProf || {}),
            schedule: updated.schedule,
            curriculumId: updated.curriculumId || 'smart-phonics',
            units: updatedCanonicals,
            updatedAt: updated.updatedAt
          };
          localStorage.setItem(SharedClassSync.SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
          SharedClassSync.syncUpstash(SharedClassSync.SHARED_CLASS_PROFILES_KEY, profiles);
        } catch {}
      }

      return updated;
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

    saveCurrentToActiveClass(selectedUnits, currentOptions, { isUnitChange = false } = {}) {
      const store = loadLocalData();
      const activeCurId = (typeof EditorStore !== 'undefined' && EditorStore.getActiveCurriculumId)
        ? EditorStore.getActiveCurriculumId()
        : null;
      const hasNonEmptyUnits = Array.isArray(selectedUnits) && selectedUnits.length > 0;

      if (!store.activeClassId) {
        if (hasNonEmptyUnits && typeof SharedClassSync !== 'undefined' && SharedClassSync.saveActiveUnits) {
          SharedClassSync.saveActiveUnits(selectedUnits, activeCurId || 'smart-phonics', null);
        }
        return null;
      }

      const cls = store.classes.find(c => c.id === store.activeClassId);
      if (!cls) {
        if (hasNonEmptyUnits && typeof SharedClassSync !== 'undefined' && SharedClassSync.saveActiveUnits) {
          SharedClassSync.saveActiveUnits(selectedUnits, activeCurId || 'smart-phonics', null);
        }
        return null;
      }

      if (isUnitChange || hasNonEmptyUnits) {
        cls.selectedUnits = [...selectedUnits];
      }
      if (activeCurId) {
        cls.curriculumId = activeCurId;
      }
      cls.options = {
        includeExtras: !!currentOptions.includeExtras,
        includeSightWords: !!currentOptions.includeSightWords,
        sightWordsOnly: !!currentOptions.sightWordsOnly,
        includeImages: currentOptions.includeImages !== false,
        letterCase: currentOptions.letterCase || 'both',
        mixMode: !!currentOptions.mixMode,
        dictationMode: !!currentOptions.dictationMode,
        quizMode: !!currentOptions.quizMode,
        soundQuizMode: !!currentOptions.soundQuizMode,
        pictureQuizMode: !!currentOptions.pictureQuizMode,
        wordChart: !!currentOptions.wordChart,
        highlightSounds: !!currentOptions.highlightSounds
      };
      cls.updatedAt = Date.now();

      saveLocalData(store);
      debouncedPushToUpstash(store);

      if (typeof SharedClassSync !== 'undefined' && (isUnitChange || hasNonEmptyUnits)) {
        SharedClassSync.saveClassUnits(cls.name, cls.selectedUnits, cls.curriculumId);
      }
      return cls;
    },

    findCurrentScheduledClass(date) {
      const store = loadLocalData();
      return findCurrentScheduledClass(store.classes, date);
    },

    async syncCloud() {
      const remote = await fetchFromUpstash();
      const local = loadLocalData();

      if (!remote || !Array.isArray(remote.classes)) {
        const pushed = await pushToUpstash(local);
        return { success: pushed, source: 'local_pushed', data: local };
      }

      let remoteHadNewer = false;
      let localHadNewer = false;
      const mergedClassesMap = new Map();

      for (const lCls of (local.classes || [])) {
        if (lCls && lCls.name) {
          mergedClassesMap.set(lCls.name, { ...lCls });
        }
      }

      for (const rCls of (remote.classes || [])) {
        if (!rCls || !rCls.name) continue;
        const lCls = mergedClassesMap.get(rCls.name);
        if (!lCls) {
          mergedClassesMap.set(rCls.name, { ...rCls });
          remoteHadNewer = true;
        } else {
          const rTime = rCls.updatedAt || 0;
          const lTime = lCls.updatedAt || 0;
          const rHasUnits = Array.isArray(rCls.selectedUnits) && rCls.selectedUnits.length > 0;
          const lHasUnits = Array.isArray(lCls.selectedUnits) && lCls.selectedUnits.length > 0;

          if (rTime > lTime) {
            mergedClassesMap.set(rCls.name, {
              ...lCls,
              ...rCls,
              id: lCls.id || rCls.id,
              selectedUnits: rHasUnits ? rCls.selectedUnits : (lHasUnits ? lCls.selectedUnits : [])
            });
            remoteHadNewer = true;
          } else if (lTime > rTime) {
            if (!lHasUnits && rHasUnits) {
              lCls.selectedUnits = rCls.selectedUnits;
              remoteHadNewer = true;
            }
            localHadNewer = true;
          } else if (!lHasUnits && rHasUnits) {
            lCls.selectedUnits = rCls.selectedUnits;
            remoteHadNewer = true;
          }
        }
      }

      const mergedStore = {
        classes: Array.from(mergedClassesMap.values()),
        activeClassId: local.activeClassId || remote.activeClassId || null,
        updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
      };

      saveLocalData(mergedStore, { touchUpdatedAt: false });
      const finalStore = loadLocalData();
      saveLocalData(finalStore, { touchUpdatedAt: false });

      if (localHadNewer || (local.updatedAt || 0) > (remote.updatedAt || 0)) {
        await pushToUpstash(finalStore);
      }

      return {
        success: true,
        source: remoteHadNewer ? 'remote_loaded' : 'local_synced',
        data: finalStore
      };
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
    },

    parseScheduleFromClassName(name) {
      return parseScheduleFromClassName(name);
    }
  };
})();
