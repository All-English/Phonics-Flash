/**
 * Phonics Flash — Phonics Engine Module
 * Pure phonics logic: sound highlighting, blanking, sound choice distractors,
 * Picture Quiz candidate matching, and word preparation.
 */
(function (window) {
  'use strict';

  let _phonicsData = null;

  function setPhonicsData(data) {
    _phonicsData = data;
  }

  function getPhonicsData() {
    return _phonicsData || (typeof window.phonicsData !== 'undefined' ? window.phonicsData : null);
  }

  // ── Phonics Target Sound Highlight Helper ──────────────────
  function highlightTargetSound(word, targetSoundStr, levelId) {
    if (!word || !targetSoundStr) return word;
    if (levelId === 'L1') return word;

    const rawTargets = targetSoundStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (rawTargets.length === 0) return word;

    const lowerWord = word.toLowerCase();

    // Level 3 (Split Digraph / Magic E): e.g. targetSound "a, e", "a_e", "a-e"
    // Highlight both the vowel and final silent 'e'
    let isL3Split = false;
    let l3Vowel = '';
    if (levelId === 'L3' && lowerWord.endsWith('e')) {
      if (rawTargets.length === 2 && rawTargets[1] === 'e') {
        isL3Split = true;
        l3Vowel = rawTargets[0];
      } else if (targetSoundStr.length === 3 && (targetSoundStr[1] === '_' || targetSoundStr[1] === '-') && targetSoundStr[2].toLowerCase() === 'e') {
        isL3Split = true;
        l3Vowel = targetSoundStr[0].toLowerCase();
      }
    }
    if (isL3Split) {
      const vowelIdx = lowerWord.indexOf(l3Vowel);
      const lastEIdx = lowerWord.length - 1;
      if (vowelIdx !== -1 && vowelIdx < lastEIdx) {
        let res = '';
        for (let i = 0; i < word.length; i++) {
          if (i === vowelIdx || i === lastEIdx) {
            res += `<span class="target-sound">${word[i]}</span>`;
          } else {
            res += word[i];
          }
        }
        return res;
      }
    }

    // Sort targets by length descending so longer multi-letter combinations match first (e.g. "all" before "al")
    const sortedTargets = [...rawTargets].sort((a, b) => b.length - a.length);

    for (const target of sortedTargets) {
      const idx = lowerWord.indexOf(target);
      if (idx !== -1) {
        const before = word.slice(0, idx);
        const matched = word.slice(idx, idx + target.length);
        const after = word.slice(idx + target.length);
        return `${before}<span class="target-sound">${matched}</span>${after}`;
      }
    }

    return word;
  }

  // ── Target Sound Blanking Helper ───────────────────────────
  function getBlankedWord(word, targetSoundStr, levelId) {
    if (!word) return word;
    if (levelId === 'L1') {
      return `<span class="sound-blank">_</span><span class="sound-blank">_</span>`;
    }
    if (!targetSoundStr) return word;

    const rawTargets = targetSoundStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (rawTargets.length === 0) return word;

    const lowerWord = word.toLowerCase();

    // Level 3 Magic E / Split Digraph: e.g. targetSound 'a, e', 'a_e', 'a-e' -> b _ k _
    let isL3BlankSplit = false;
    let l3BlankVowel = '';
    if (levelId === 'L3' && lowerWord.endsWith('e')) {
      if (rawTargets.length === 2 && rawTargets[1] === 'e') {
        isL3BlankSplit = true;
        l3BlankVowel = rawTargets[0];
      } else if (targetSoundStr.length === 3 && (targetSoundStr[1] === '_' || targetSoundStr[1] === '-') && targetSoundStr[2].toLowerCase() === 'e') {
        isL3BlankSplit = true;
        l3BlankVowel = targetSoundStr[0].toLowerCase();
      }
    }
    if (isL3BlankSplit) {
      const vowelIdx = lowerWord.indexOf(l3BlankVowel);
      const lastEIdx = lowerWord.length - 1;
      if (vowelIdx !== -1 && vowelIdx < lastEIdx) {
        let res = '';
        for (let i = 0; i < word.length; i++) {
          if (i === vowelIdx || i === lastEIdx) {
            res += `<span class="sound-blank">_</span>`;
          } else {
            res += word[i];
          }
        }
        return res;
      }
    }

    const sortedTargets = [...rawTargets].sort((a, b) => b.length - a.length);
    for (const target of sortedTargets) {
      const idx = lowerWord.indexOf(target);
      if (idx !== -1) {
        const before = word.slice(0, idx);
        const blanks = target.split('').map(() => `<span class="sound-blank">_</span>`).join('');
        const after = word.slice(idx + target.length);
        return `${before}${blanks}${after}`;
      }
    }

    return word;
  }

  // ── Target Sound Choices & Distractor Generator ───────────
  function getTargetSoundInfo(word, unit, opts = {}, data = null) {
    if (!word || !unit) return null;
    const currentPhonics = data || getPhonicsData();
    const levelId = unit.levelId || '';
    const rawTargetStr = unit.targetSound || unit.sound || '';
    const rawTargets = rawTargetStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const lowerWord = word.toLowerCase();

    let correctSound = '';
    let distractor = '';

    if (levelId === 'L1') {
      const baseChar = word.charAt(0).toUpperCase();
      correctSound = baseChar;
      const allL1 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
      const candidates = allL1.filter(l => l !== correctSound);
      distractor = candidates[Math.floor(Math.random() * candidates.length)];
    } else if (levelId === 'L3' && ((rawTargets.length === 2 && rawTargets[1] === 'e') || (rawTargetStr.length === 3 && (rawTargetStr[1] === '_' || rawTargetStr[1] === '-') && rawTargetStr[2].toLowerCase() === 'e')) && lowerWord.endsWith('e')) {
      const vowel = rawTargets.length === 2 ? rawTargets[0] : rawTargetStr[0].toLowerCase();
      correctSound = `${vowel}_e`;
      const allL3 = ['a_e', 'i_e', 'o_e', 'u_e'].filter(s => s !== correctSound);
      distractor = allL3[Math.floor(Math.random() * allL3.length)];
    } else if (levelId === 'L2') {
      const sortedTargets = [...rawTargets].sort((a, b) => b.length - a.length);
      correctSound = sortedTargets.find(t => lowerWord.includes(t)) || rawTargets[0] || 'a';
      const allL2 = ['a', 'e', 'i', 'o', 'u'].filter(s => s !== correctSound);
      distractor = allL2[Math.floor(Math.random() * allL2.length)];
    } else {
      const sortedTargets = [...rawTargets].sort((a, b) => b.length - a.length);
      correctSound = sortedTargets.find(t => lowerWord.includes(t)) || rawTargets[0] || '';

      // Priority 1: Same unit
      const sameUnitCandidates = rawTargets.filter(t => t !== correctSound);
      if (sameUnitCandidates.length > 0) {
        distractor = sameUnitCandidates[Math.floor(Math.random() * sameUnitCandidates.length)];
      } else {
        // Priority 2: Same level
        const level = (currentPhonics?.levels || []).find(l => l.id === levelId);
        const levelSounds = [];
        if (level) {
          (level.units || []).forEach(u => {
            const uTargets = (u.targetSound || u.sound || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
            uTargets.forEach(t => {
              if (t !== correctSound && !levelSounds.includes(t)) levelSounds.push(t);
            });
          });
        }
        distractor = levelSounds.length > 0 ? levelSounds[Math.floor(Math.random() * levelSounds.length)] : 'th';
      }
    }

    // Apply Letter Casing
    const letterCase = opts.letterCase || 'both';
    if (letterCase === 'upper') {
      correctSound = correctSound.toUpperCase();
      distractor = distractor.toUpperCase();
    }

    return { correctSound, distractor };
  }

  // ── Word Preparation ───────────────────────────────────────
  function prepareUnitWords(unit, isExtra = false, opts = {}) {
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

  // ── Distractor Word Generator (Word Quiz) ──────────────────
  function getDistractorWord(wordData, unit, opts = {}, data = null) {
    const currentPhonics = data || getPhonicsData();
    let unitWords = prepareUnitWords(unit, false, opts);
    if (opts.includeExtras && unit.extraWords) {
      unitWords = [...unitWords, ...prepareUnitWords(unit, true, opts)];
    }

    const candidates = unitWords.filter(w => w.word.toLowerCase() !== wordData.word.toLowerCase());
    if (candidates.length > 0) {
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      return chosen.word;
    }

    const level = (currentPhonics?.levels || []).find(l => l.id === unit.levelId);
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

  // ── Distractor Picture Word Generator (Picture Quiz) ──────
  function getDistractorPictureCandidate(wordData, unit, opts = {}, data = null) {
    const currentPhonics = data || getPhonicsData();
    const soundInfo = getTargetSoundInfo(wordData.word, unit, opts, currentPhonics);
    const activeSound = soundInfo ? soundInfo.correctSound.toLowerCase() : '';

    function getCandidateSound(candWord, candUnit) {
      const info = getTargetSoundInfo(candWord, candUnit, opts, currentPhonics);
      return info ? info.correctSound.toLowerCase() : '';
    }

    // Priority 1: Pick from same unit if it has a different sound and has an image
    const unitWords = prepareUnitWords(unit, false, opts);
    const sameUnitCandidates = unitWords.filter(w => {
      if (!w.image || w.word.toLowerCase() === wordData.word.toLowerCase()) return false;
      const sound = getCandidateSound(w.word, unit);
      return sound !== activeSound;
    });

    if (sameUnitCandidates.length > 0) {
      const chosen = sameUnitCandidates[Math.floor(Math.random() * sameUnitCandidates.length)];
      return {
        ...chosen,
        targetSound: unit.targetSound || unit.sound || '',
        levelId: unit.levelId
      };
    }

    // Priority 2: Pick from other units in the same level
    const level = (currentPhonics?.levels || []).find(l => l.id === unit.levelId);
    if (level) {
      const levelCandidates = [];
      level.units.forEach(u => {
        if (u.id === unit.id) return;
        const uWithLevel = { ...u, levelId: level.id, levelName: level.name };
        const words = prepareUnitWords(uWithLevel, false, opts);
        words.forEach(w => {
          if (!w.image || w.word.toLowerCase() === wordData.word.toLowerCase()) return false;
          const sound = getCandidateSound(w.word, uWithLevel);
          if (sound !== activeSound) {
            levelCandidates.push({
              ...w,
              targetSound: u.targetSound || u.sound || '',
              levelId: level.id
            });
          }
        });
      });

      if (levelCandidates.length > 0) {
        return levelCandidates[Math.floor(Math.random() * levelCandidates.length)];
      }
    }

    // Priority 3: Fallback from any other unit with an image
    const fallbackCandidates = [];
    (currentPhonics?.levels || []).forEach(l => {
      (l.units || []).forEach(u => {
        const uWithLevel = { ...u, levelId: l.id, levelName: l.name };
        (u.words || []).forEach(w => {
          if (w.image && w.word.toLowerCase() !== wordData.word.toLowerCase()) {
            fallbackCandidates.push({
              ...w,
              targetSound: u.targetSound || u.sound || '',
              levelId: l.id
            });
          }
        });
      });
    });

    if (fallbackCandidates.length > 0) {
      return fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];
    }

    return null;
  }

  // ── Automatic Smart Contrast for Target Sounds ─────────────
  function hexToHsl(hex) {
    if (!hex) return { h: 0, s: 0, l: 0 };
    hex = String(hex).replace(/^#/, '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const num = parseInt(hex, 16);
    if (isNaN(num)) return { h: 0, s: 0, l: 0 };
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function getContrastingTargetSoundColor(hexColor) {
    const { h } = hexToHsl(hexColor);
    // Smart complementary mapping optimized for WCAG readability on pastel/light & dark backgrounds
    if (h >= 170 && h < 240) {
      // Blue / Cyan family -> Vivid Rose / Magenta
      return 'light-dark(#ad1457, #ff80ab)';
    } else if (h >= 240 && h < 310) {
      // Purple / Violet family -> Golden Amber
      return 'light-dark(#e65100, #ffd54f)';
    } else if (h >= 310 || h < 25) {
      // Red / Coral / Pink family -> Electric Cyan / Deep Sky Blue
      return 'light-dark(#01579b, #40c4ff)';
    } else if (h >= 25 && h < 75) {
      // Orange / Amber / Yellow family -> Deep Crimson
      return 'light-dark(#b71c1c, #ff5252)';
    } else {
      // Green / Mint / Lime family (75 to 170) -> Bright Ruby / Coral
      return 'light-dark(#b71c1c, #ff8a80)';
    }
  }

  // ── Public Export ──────────────────────────────────────────
  window.PhonicsEngine = {
    setPhonicsData,
    getPhonicsData,
    highlightTargetSound,
    getBlankedWord,
    getTargetSoundInfo,
    prepareUnitWords,
    prepareUnitSightWords,
    getDistractorWord,
    getDistractorPictureCandidate,
    hexToHsl,
    getContrastingTargetSoundColor
  };

})(window);
