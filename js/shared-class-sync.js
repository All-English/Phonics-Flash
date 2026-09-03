/**
 * shared-class-sync.js
 * Universal schedule parsing, time-matching, and unit translation
 * Shared across Phonics Flash, Word-Tac-Toe, MatchMaker, and Treasure Hunt.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SharedClassSync = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const SHARED_SETS_KEY = 'shared_player_sets';
  const SHARED_ACTIVE_PLAYERS_KEY = 'shared_active_players';
  const SHARED_CLASS_PROFILES_KEY = 'shared_class_profiles';
  const UPSTASH_URL_KEY = 'upstash_redis_url';
  const UPSTASH_TOKEN_KEY = 'upstash_redis_token';

  // ── 1. Schedule Parsing from Class Name ────────────────────────
  const DAY_PATTERNS = [
    { pattern: /\bMWF\b/i, days: ['Mon', 'Wed', 'Fri'] },
    { pattern: /\b(TTh|TuTh|TT)\b/i, days: ['Tue', 'Thu'] },
    { pattern: /\bWF\b/i, days: ['Wed', 'Fri'] },
    { pattern: /\bMW\b/i, days: ['Mon', 'Wed'] },
    { pattern: /\bMon(day)?\b/i, days: ['Mon'] },
    { pattern: /\bTue(s|sday)?\b/i, days: ['Tue'] },
    { pattern: /\bWed(nesday)?\b/i, days: ['Wed'] },
    { pattern: /\bThu(r|rs|rsday)?\b/i, days: ['Thu'] },
    { pattern: /\bFri(day)?\b/i, days: ['Fri'] },
    { pattern: /\bSat(urday)?\b/i, days: ['Sat'] },
    { pattern: /\bSun(day)?\b/i, days: ['Sun'] }
  ];

  function parseScheduleFromName(className) {
    if (!className || typeof className !== 'string') {
      return { days: ['Mon', 'Wed', 'Fri'], startTime: '15:00', endTime: '16:00' };
    }

    // 1. Extract Days
    let matchedDays = null;
    for (const entry of DAY_PATTERNS) {
      if (entry.pattern.test(className)) {
        matchedDays = entry.days;
        break;
      }
    }
    if (!matchedDays) {
      matchedDays = ['Mon', 'Wed', 'Fri'];
    }

    // 2. Extract Start Time
    // Matches patterns like "3:00", "4:00", "6:50", "7:45", "14:30"
    const timeMatch = className.match(/(\d{1,2}):(\d{2})/);
    let startHour = 15;
    let startMin = 0;

    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      // Academy / hagwon hours 1..7 are PM (13:00 to 19:00)
      if (h >= 1 && h <= 7) {
        h += 12;
      }
      startHour = h;
      startMin = m;
    }

    const startMinutesTotal = startHour * 60 + startMin;
    // Standard default duration: 60 minutes
    const endMinutesTotal = startMinutesTotal + 60;

    const endH = Math.floor(endMinutesTotal / 60) % 24;
    const endM = endMinutesTotal % 60;

    const formatTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    return {
      days: matchedDays,
      startTime: formatTime(startHour, startMin),
      endTime: formatTime(endH, endM)
    };
  }

  // ── 2. Strict In-Session Time Matching ─────────────────────────
  /**
   * Finds the active scheduled class strictly during its in-session window:
   * startTime <= currentTime < endTime.
   * Never activates before startTime. No post-class grace bleed.
   */
  function findActiveScheduledClass(classProfiles, date = new Date()) {
    if (!classProfiles || typeof classProfiles !== 'object') return null;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[date.getDay()];
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    const candidates = [];

    for (const [className, profile] of Object.entries(classProfiles)) {
      const schedule = profile.schedule || parseScheduleFromName(className);
      if (!schedule || !Array.isArray(schedule.days) || !schedule.days.includes(currentDay)) {
        continue;
      }

      const startParts = (schedule.startTime || '00:00').split(':').map(Number);
      const endParts = (schedule.endTime || '23:59').split(':').map(Number);

      const startMin = (startParts[0] || 0) * 60 + (startParts[1] || 0);
      let endMin = (endParts[0] || 0) * 60 + (endParts[1] || 0);
      if (endMin <= startMin) {
        endMin = startMin + 60; // 60 min default
      }

      // Strictly in-session check
      if (currentMinutes >= startMin && currentMinutes < endMin) {
        candidates.push({
          className,
          profile,
          startMin,
          endMin
        });
      }
    }

    if (candidates.length === 0) return null;

    // If multiple overlap on a boundary, pick the most recent start time
    candidates.sort((a, b) => b.startMin - a.startMin);
    return candidates[0];
  }

  // ── 3. Universal Smart Phonics Unit Translators ────────────────
  /**
   * Normalizes any app's unit string to a canonical object:
   * { level: 2, unit: 3, id: "L2U3" }
   *
   * Handles:
   * - "L2U3", "L2U03" (Phonics Flash)
   * - "Book2|Unit3" (Word-Tac-Toe)
   * - "SmartPhonics|2|3" (MatchMaker)
   * - "level2:unit3" (Treasure Hunt)
   */
  function toCanonicalUnit(unitStr) {
    if (!unitStr || typeof unitStr !== 'string') return null;
    const str = unitStr.trim();

    // 1. Phonics Flash: L2U3
    let m = str.match(/L(\d+)U(\d+)/i);
    if (m) {
      const level = parseInt(m[1], 10);
      const unit = parseInt(m[2], 10);
      return { level, unit, id: `L${level}U${unit}` };
    }

    // 2. Word-Tac-Toe: Book2|Unit3
    m = str.match(/Book(\d+)\|Unit(\d+)/i);
    if (m) {
      const level = parseInt(m[1], 10);
      const unit = parseInt(m[2], 10);
      return { level, unit, id: `L${level}U${unit}` };
    }

    // 3. MatchMaker: SmartPhonics|2|3
    m = str.match(/(?:SmartPhonics|SP)\|(\d+)\|(\d+)/i);
    if (m) {
      const level = parseInt(m[1], 10);
      const unit = parseInt(m[2], 10);
      return { level, unit, id: `L${level}U${unit}` };
    }

    // 4. Treasure Hunt: level2:unit3
    m = str.match(/level(\d+):unit(\d+)/i);
    if (m) {
      const level = parseInt(m[1], 10);
      const unit = parseInt(m[2], 10);
      return { level, unit, id: `L${level}U${unit}` };
    }

    return null;
  }

  function toPhonicsFlash(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `L${c.level}U${c.unit}` : null;
  }

  function toTicTacToe(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `Book${c.level}|Unit${c.unit}` : null;
  }

  function toMatchMaker(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `SmartPhonics|${c.level}|${c.unit}` : null;
  }

  function toTreasureHunt(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `level${c.level}:unit${c.unit}` : null;
  }

  /**
   * For single-select dropdowns (like Treasure Hunt),
   * returns the highest level and unit from an array of units.
   */
  function getHighestUnit(unitsArray) {
    if (!Array.isArray(unitsArray) || unitsArray.length === 0) return null;
    const parsed = unitsArray
      .map(toCanonicalUnit)
      .filter(Boolean);

    if (parsed.length === 0) return null;

    // Sort descending: highest level first, then highest unit
    parsed.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return b.unit - a.unit;
    });

    return parsed[0];
  }

  // ── 4. Upstash REST API Helper ─────────────────────────────────
  function getCredentials() {
    let url = '';
    let token = '';

    if (typeof localStorage !== 'undefined') {
      url = localStorage.getItem(UPSTASH_URL_KEY) || '';
      token = localStorage.getItem(UPSTASH_TOKEN_KEY) || '';
    }

    if (!url && typeof window !== 'undefined' && window.UPSTASH_CONFIG) {
      url = window.UPSTASH_CONFIG.url || '';
      token = window.UPSTASH_CONFIG.token || '';
    }

    if (url && url.endsWith('/')) {
      url = url.slice(0, -1);
    }

    return { url, token };
  }

  async function fetchUpstash(key) {
    const { url, token } = getCredentials();
    if (!url || !token) return null;

    try {
      const res = await fetch(`${url}/get/${key}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.result === null || data.result === undefined) return null;

      if (typeof data.result === 'string') {
        try {
          return JSON.parse(data.result);
        } catch {
          return data.result;
        }
      }
      return data.result;
    } catch (err) {
      console.warn(`[SharedClassSync] Fetch error for key "${key}":`, err);
      return null;
    }
  }

  async function syncUpstash(key, value) {
    const { url, token } = getCredentials();
    if (!url || !token) return false;

    try {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      const res = await fetch(`${url}/set/${key}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: payload
      });
      return res.ok;
    } catch (err) {
      console.warn(`[SharedClassSync] Sync error for key "${key}":`, err);
      return false;
    }
  }

  // ── 5. Unified Profile Loader & Manager ────────────────────────
  /**
   * Merges rosters from shared_player_sets and profiles from shared_class_profiles.
   * Auto-generates initial schedule if missing.
   */
  async function loadAllClasses() {
    let playerSets = {};
    let classProfiles = {};

    // 1. Try local storage first
    if (typeof localStorage !== 'undefined') {
      try {
        const localSets = localStorage.getItem(SHARED_SETS_KEY);
        if (localSets) playerSets = JSON.parse(localSets) || {};
        const localProfiles = localStorage.getItem(SHARED_CLASS_PROFILES_KEY);
        if (localProfiles) classProfiles = JSON.parse(localProfiles) || {};
      } catch (e) {
        console.warn('[SharedClassSync] Error reading local storage:', e);
      }
    }

    // 2. Fetch from Upstash
    const cloudSets = await fetchUpstash(SHARED_SETS_KEY);
    if (cloudSets && typeof cloudSets === 'object') {
      playerSets = cloudSets;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_SETS_KEY, JSON.stringify(cloudSets));
      }
    }

    const cloudProfiles = await fetchUpstash(SHARED_CLASS_PROFILES_KEY);
    if (cloudProfiles && typeof cloudProfiles === 'object') {
      classProfiles = cloudProfiles;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(cloudProfiles));
      }
    }

    // 3. Ensure every class in playerSets has a valid profile
    let profilesChanged = false;
    for (const className of Object.keys(playerSets)) {
      if (!classProfiles[className]) {
        classProfiles[className] = {
          schedule: parseScheduleFromName(className),
          units: [],
          updatedAt: Date.now()
        };
        profilesChanged = true;
      } else if (!classProfiles[className].schedule) {
        classProfiles[className].schedule = parseScheduleFromName(className);
        profilesChanged = true;
      }
    }

    if (profilesChanged) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(classProfiles));
      }
      syncUpstash(SHARED_CLASS_PROFILES_KEY, classProfiles);
    }

    return { playerSets, classProfiles };
  }

  /**
   * Save units for a specific class and push to Upstash
   */
  async function saveClassUnits(className, canonicalUnitsArray) {
    if (!className) return false;
    let profiles = {};
    if (typeof localStorage !== 'undefined') {
      try {
        profiles = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}');
      } catch {}
    }

    if (!profiles[className]) {
      profiles[className] = {
        schedule: parseScheduleFromName(className),
        units: [],
        updatedAt: Date.now()
      };
    }

    profiles[className].units = canonicalUnitsArray;
    profiles[className].updatedAt = Date.now();

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
    }
    return syncUpstash(SHARED_CLASS_PROFILES_KEY, profiles);
  }

  return {
    SHARED_SETS_KEY,
    SHARED_ACTIVE_PLAYERS_KEY,
    SHARED_CLASS_PROFILES_KEY,
    UPSTASH_URL_KEY,
    UPSTASH_TOKEN_KEY,
    parseScheduleFromName,
    findActiveScheduledClass,
    toCanonicalUnit,
    toPhonicsFlash,
    toTicTacToe,
    toMatchMaker,
    toTreasureHunt,
    getHighestUnit,
    getCredentials,
    fetchUpstash,
    syncUpstash,
    loadAllClasses,
    saveClassUnits
  };
});
