/**
 * Phonics Flash — Chart Screen Module
 * Full-screen Letter Chart (L1) and Word Chart (L2-L5 / Multi-level).
 * Handles tile grid layout, type-ahead HUD, 2D keyboard navigation,
 * and tile sound playback.
 */
(function (window) {
  'use strict';

  let chartKeyboardHandler = null;
  let currentChartIndex = -1;
  let currentChartLevel = null;
  let currentChartUnits = [];
  let chartIsRandom = false;
  let chartTypeAheadBuffer = '';
  let chartTypeAheadTimer = null;
  const TYPEAHEAD_TIMEOUT_MS = 1000;

  // External context hooks
  let context = {
    getSelectedUnitIds: () => [],
    getOptions: () => ({ letterCase: 'both', highlightSounds: true }),
    getPhonicsData: () => null,
    onClose: () => {},
    onCaseChange: () => {}
  };

  function init(ctx = {}) {
    context = { ...context, ...ctx };
  }

  function clearTypeAhead() {
    chartTypeAheadBuffer = '';
    if (chartTypeAheadTimer) {
      clearTimeout(chartTypeAheadTimer);
      chartTypeAheadTimer = null;
    }
    hideChartSearchHUD();
  }

  function resetTypeAheadTimer() {
    if (chartTypeAheadTimer) {
      clearTimeout(chartTypeAheadTimer);
    }
    chartTypeAheadTimer = setTimeout(() => {
      clearTypeAhead();
    }, TYPEAHEAD_TIMEOUT_MS);
  }

  function showChartSearchHUD(text, matched = true) {
    const hud = document.getElementById('chart-typeahead-hud');
    if (!hud) return;
    const textEl = hud.querySelector('.hud-text');
    if (textEl) {
      textEl.textContent = text + (matched ? '' : ' (not found)');
    }
    hud.classList.toggle('not-found', !matched);
    hud.classList.remove('hidden');
  }

  function hideChartSearchHUD() {
    const hud = document.getElementById('chart-typeahead-hud');
    if (!hud) return;
    hud.classList.add('hidden');
  }

  function shuffleArray(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function normalizeLetterCase(caseVal) {
    if (caseVal === 'upper' || caseVal === 'lower' || caseVal === 'both' || caseVal === 'separate') {
      return caseVal;
    }
    return 'both';
  }

  function updateChartURL(targetUnits, uniqueLevelIds) {
    const params = new URLSearchParams();
    params.set('q', 'chart');
    if (typeof EditorStore !== 'undefined') {
      const curId = EditorStore.getActiveCurriculumId();
      if (curId && curId !== 'smart-phonics') {
        params.set('book', curId);
      }
    }
    if (uniqueLevelIds && uniqueLevelIds.length === 1 && uniqueLevelIds[0] !== 'L1') {
      params.set('level', uniqueLevelIds[0]);
    }
    if (targetUnits && targetUnits.length > 0) {
      params.set('units', targetUnits.map(u => u.id).join(','));
    }
    const options = context.getOptions();
    if (uniqueLevelIds && uniqueLevelIds.includes('L1') && options.letterCase && options.letterCase !== 'both') {
      params.set('case', options.letterCase);
    }
    const newURL = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newURL);
  }

  function openChart(levelId = null, customUnitIds = null) {
    clearTypeAhead();
    const phonicsData = context.getPhonicsData();
    const options = context.getOptions();
    const selectedIds = customUnitIds || context.getSelectedUnitIds();

    // Gather selected units across all levels
    let targetUnits = [];
    for (const level of (phonicsData?.levels || [])) {
      for (const unit of (level?.units || [])) {
        if (selectedIds.includes(unit.id)) {
          targetUnits.push({
            ...unit,
            levelId: level.id,
            levelName: level.name
          });
        }
      }
    }

    // Fallback: if no units selected, use units of the specified level or first level
    if (targetUnits.length === 0) {
      const fallbackLevel = phonicsData?.levels?.find(l => l.id === levelId) || phonicsData?.levels?.[0];
      if (fallbackLevel) {
        targetUnits = (fallbackLevel.units || []).map(u => ({
          ...u,
          levelId: fallbackLevel.id,
          levelName: fallbackLevel.name
        }));
      }
    }

    if (targetUnits.length === 0) return;

    currentChartUnits = targetUnits;
    currentChartIndex = -1;
    chartIsRandom = false;

    // Detect unique levels and sort in natural curriculum order
    const uniqueLevelIds = [...new Set(targetUnits.map(u => u.levelId))];
    const levelOrder = ['L1', 'L2', 'L3', 'L4', 'L5'];
    uniqueLevelIds.sort((a, b) => {
      const idxA = levelOrder.indexOf(a);
      const idxB = levelOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.localeCompare(b);
    });

    const isSingleLevel = uniqueLevelIds.length === 1;
    const isOnlyLevel1 = isSingleLevel && uniqueLevelIds[0] === 'L1';
    const hasLevel1 = uniqueLevelIds.includes('L1');

    currentChartLevel = isSingleLevel ? (phonicsData?.levels?.find(l => l.id === uniqueLevelIds[0]) || null) : null;

    // Update URL with q=chart and level
    updateChartURL(targetUnits, uniqueLevelIds);

    // Dynamic background for #chart-screen
    const chartScreen = document.getElementById('chart-screen');
    if (chartScreen) {
      chartScreen.classList.remove('chart-bg-L1', 'chart-bg-L2', 'chart-bg-L3', 'chart-bg-L4', 'chart-bg-L5', 'chart-bg-multi');
      if (isSingleLevel) {
        chartScreen.classList.add(`chart-bg-${uniqueLevelIds[0]}`);
        chartScreen.style.background = '';
      } else {
        chartScreen.classList.add('chart-bg-multi');
        const getLevelSuffix = (lvlId) => {
          if (['L1', 'L2', 'L3', 'L4', 'L5'].includes(lvlId)) return lvlId;
          const m = (lvlId || '').match(/L([1-5])/i);
          return m ? `L${m[1]}` : 'L1';
        };

        const N = uniqueLevelIds.length;
        const stops = [];
        if (N === 2) {
          const s0 = getLevelSuffix(uniqueLevelIds[0]);
          const s1 = getLevelSuffix(uniqueLevelIds[1]);
          stops.push(`var(--level-bg-start-${s0}) 0%`);
          stops.push(`var(--level-bg-mid-${s0}) 35%`);
          stops.push(`var(--level-bg-mid-${s1}) 65%`);
          stops.push(`var(--level-bg-end-${s1}) 100%`);
        } else {
          uniqueLevelIds.forEach((lvlId, i) => {
            const s = getLevelSuffix(lvlId);
            const pct = Math.round((i / (N - 1)) * 100);
            if (i === 0) {
              stops.push(`var(--level-bg-start-${s}) 0%`);
            } else if (i === N - 1) {
              stops.push(`var(--level-bg-end-${s}) 100%`);
            } else {
              stops.push(`var(--level-bg-mid-${s}) ${pct}%`);
            }
          });
        }
        chartScreen.style.background = `linear-gradient(160deg, ${stops.join(', ')})`;
      }
    }

    // Update header title
    const titleEl = document.querySelector('#chart-screen .chart-title');
    if (titleEl) {
      if (isOnlyLevel1) {
        titleEl.textContent = 'Level 1 Letter Chart';
      } else if (isSingleLevel) {
        const lvlName = targetUnits[0]?.levelName || `Level ${uniqueLevelIds[0]}`;
        titleEl.textContent = `${lvlName} Word Chart`;
      } else {
        titleEl.textContent = hasLevel1 ? 'Word & Letter Chart' : 'Word Chart';
      }
    }

    // Show/hide case controls (only relevant if Level 1 is among the selected units)
    const caseBar = document.querySelector('#chart-screen .chart-case-bar');
    if (caseBar) {
      caseBar.style.display = hasLevel1 ? '' : 'none';
    }

    // Switch screen to chart-screen
    document.getElementById('menu-screen')?.classList.add('hidden');
    document.getElementById('slideshow-screen')?.classList.add('hidden');
    document.getElementById('chart-screen')?.classList.remove('hidden');

    // Wire up header buttons inside chart screen
    const backBtn = document.getElementById('chart-back-btn');
    if (backBtn) {
      backBtn.onclick = closeChart;
    }

    const randomBtn = document.getElementById('chart-random-btn');
    if (randomBtn) {
      randomBtn.onclick = () => {
        clearTypeAhead();
        chartIsRandom = true;
        currentChartIndex = -1;
        renderChartGrid(currentChartUnits);
      };
    }

    const resetOrderBtn = document.getElementById('chart-reset-order-btn');
    if (resetOrderBtn) {
      resetOrderBtn.onclick = () => {
        clearTypeAhead();
        chartIsRandom = false;
        currentChartIndex = -1;
        renderChartGrid(currentChartUnits);
      };
    }

    // Render the grid
    renderChartGrid(targetUnits);

    // Wire up case buttons inside chart screen (Level 1 only)
    const chartCaseBtns = document.querySelectorAll('#chart-screen .case-btn');
    chartCaseBtns.forEach(btn => {
      btn.onclick = () => {
        if (!hasLevel1) return;
        clearTypeAhead();
        const selectedCase = normalizeLetterCase(btn.dataset.case);
        const curOpts = context.getOptions();
        curOpts.letterCase = selectedCase;
        localStorage.setItem('phonics-flash-letter-case', selectedCase);
        context.onCaseChange(selectedCase);
        updateChartURL(targetUnits, uniqueLevelIds);
        currentChartIndex = -1;
        renderChartGrid(currentChartUnits);
      };
    });

    // Wire up keyboard shortcuts
    if (chartKeyboardHandler) {
      window.removeEventListener('keydown', chartKeyboardHandler);
    }
    chartKeyboardHandler = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        clearTypeAhead();
        closeChart();
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        if (chartTypeAheadBuffer.length > 0) {
          chartTypeAheadBuffer = chartTypeAheadBuffer.slice(0, -1);
          if (chartTypeAheadBuffer.length > 0) {
            const tiles = Array.from(document.querySelectorAll('#chart-grid .letter-tile'));
            const matchIndex = tiles.findIndex(t => {
              const text = (t.dataset.text || t.dataset.baseLetter || '').trim().toLowerCase();
              return text.startsWith(chartTypeAheadBuffer);
            });
            if (matchIndex !== -1) {
              setActiveChartTile(matchIndex, true);
              showChartSearchHUD(chartTypeAheadBuffer, true);
            } else {
              showChartSearchHUD(chartTypeAheadBuffer, false);
            }
            resetTypeAheadTimer();
          } else {
            clearTypeAhead();
          }
          return;
        }
        closeChart();
        return;
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        clearTypeAhead();
        navigateChart2D('right');
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        clearTypeAhead();
        navigateChart2D('left');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        clearTypeAhead();
        navigateChart2D('down');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        clearTypeAhead();
        navigateChart2D('up');
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        clearTypeAhead();
        if (currentChartIndex >= 0) {
          setActiveChartTile(currentChartIndex, true);
        } else {
          setActiveChartTile(0, true);
        }
        return;
      }

      if (/^[a-zA-Z]$/.test(e.key)) {
        const keyChar = e.key.toLowerCase();
        const tiles = Array.from(document.querySelectorAll('#chart-grid .letter-tile'));
        if (tiles.length === 0) return;

        // 1. Cycle through words starting with that letter if repeated
        if (chartTypeAheadBuffer.length === 1 && chartTypeAheadBuffer === keyChar) {
          const matchingIndices = [];
          tiles.forEach((t, idx) => {
            const text = (t.dataset.text || t.dataset.baseLetter || '').trim().toLowerCase();
            if (text.startsWith(keyChar)) {
              matchingIndices.push(idx);
            }
          });

          if (matchingIndices.length > 0) {
            e.preventDefault();
            const currPos = matchingIndices.indexOf(currentChartIndex);
            const nextPos = currPos >= 0 ? (currPos + 1) % matchingIndices.length : 0;
            const nextIdx = matchingIndices[nextPos];
            setActiveChartTile(nextIdx, true);
            const countLabel = matchingIndices.length > 1 ? ` (${nextPos + 1}/${matchingIndices.length})` : '';
            showChartSearchHUD(`${keyChar.toUpperCase()}${countLabel}`, true);
            resetTypeAheadTimer();
            return;
          }
        }

        // 2. Try extending current buffer
        const extendedQuery = chartTypeAheadBuffer + keyChar;
        const extendedMatchIndex = tiles.findIndex(t => {
          const text = (t.dataset.text || t.dataset.baseLetter || '').trim().toLowerCase();
          return text.startsWith(extendedQuery);
        });

        if (extendedMatchIndex !== -1) {
          e.preventDefault();
          chartTypeAheadBuffer = extendedQuery;
          setActiveChartTile(extendedMatchIndex, true);
          showChartSearchHUD(chartTypeAheadBuffer, true);
          resetTypeAheadTimer();
          return;
        }

        // 3. If extended query didn't match, try fresh search with keyChar
        const singleMatchIndex = tiles.findIndex(t => {
          const text = (t.dataset.text || t.dataset.baseLetter || '').trim().toLowerCase();
          return text.startsWith(keyChar);
        });

        if (singleMatchIndex !== -1) {
          e.preventDefault();
          chartTypeAheadBuffer = keyChar;
          setActiveChartTile(singleMatchIndex, true);
          showChartSearchHUD(chartTypeAheadBuffer, true);
          resetTypeAheadTimer();
          return;
        }

        // 4. No match
        e.preventDefault();
        showChartSearchHUD(extendedQuery, false);
        resetTypeAheadTimer();
      }
    };
    window.addEventListener('keydown', chartKeyboardHandler);
  }

  const openLetterChart = (customUnitIds = null) => openChart('L1', customUnitIds);

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
    if (targetTile) {
      targetTile.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      if (playAudio) {
        playLetterTile(targetTile);
      }
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

  function renderChartGrid(targetUnits) {
    const grid = document.getElementById('chart-grid');
    if (!grid || !targetUnits) return;
    grid.innerHTML = '';

    const phonicsData = context.getPhonicsData();
    const options = context.getOptions();
    const uniqueLevels = [...new Set(targetUnits.map(u => u.levelId || 'L1'))];
    const isOnlyLevel1 = uniqueLevels.length === 1 && uniqueLevels[0] === 'L1';
    grid.classList.toggle('words-mode', !isOnlyLevel1);

    let displayItems = [];
    const seenWords = new Set();
    const letterMap = new Map();

    if (options.sightWordsOnly) {
      targetUnits.forEach(unit => {
        const uLevelId = unit.levelId || 'L1';
        const sightWords = (unit.sightWords || []).map(sw => typeof sw === 'string' ? { word: sw, isSightWord: true } : { ...sw, isSightWord: true });
        sightWords.forEach(w => {
          const cleanWord = w.word ? w.word.trim() : '';
          if (cleanWord && !seenWords.has(cleanWord.toLowerCase())) {
            seenWords.add(cleanWord.toLowerCase());
            displayItems.push({
              displayText: cleanWord,
              baseLetter: cleanWord.charAt(0).toUpperCase(),
              word: cleanWord,
              audio: w.audio,
              levelId: uLevelId,
              targetSound: unit.targetSound || unit.sound || '',
              isSightWord: true
            });
          }
        });
      });
    } else {
      targetUnits.forEach(unit => {
        const uLevelId = unit.levelId || 'L1';
        if (uLevelId === 'L1') {
          (unit.words || []).forEach(w => {
            const baseLetter = w.word ? w.word.charAt(0).toUpperCase() : '';
            if (baseLetter && !letterMap.has(baseLetter)) {
              const singleAudio = `media/SmartPhonics/1/sounds/SingleLetters_single/${baseLetter}${baseLetter.toLowerCase()}.mp3`;
              letterMap.set(baseLetter, {
                baseLetter: baseLetter,
                word: w.word,
                audio: singleAudio,
                levelId: 'L1'
              });
            }
          });
        } else {
          const wordsList = [...(unit.words || [])];
          if (options.includeExtras && unit.extraWords) {
            wordsList.push(...unit.extraWords);
          }
          if (options.includeSightWords && unit.sightWords) {
            const swList = unit.sightWords.map(sw => typeof sw === 'string' ? { word: sw, isSightWord: true } : { ...sw, isSightWord: true });
            wordsList.push(...swList);
          }
          wordsList.forEach(w => {
            const cleanWord = w.word ? w.word.trim() : '';
            if (cleanWord && !seenWords.has(cleanWord.toLowerCase())) {
              seenWords.add(cleanWord.toLowerCase());
              displayItems.push({
                displayText: cleanWord,
                baseLetter: cleanWord.charAt(0).toUpperCase(),
                word: cleanWord,
                audio: w.audio,
                levelId: uLevelId,
                targetSound: unit.targetSound || unit.sound || '',
                isSightWord: !!w.isSightWord
              });
            }
          });
        }
      });
    }

    // Format Level 1 letters
    if (letterMap.size > 0) {
      const uniqueLetters = Array.from(letterMap.values());
      uniqueLetters.sort((a, b) => a.baseLetter.localeCompare(b.baseLetter));

      const letterCase = options.letterCase || 'both';
      const l1Items = [];
      if (letterCase === 'separate') {
        uniqueLetters.forEach(item => {
          l1Items.push({
            displayText: item.baseLetter.toUpperCase(),
            baseLetter: item.baseLetter,
            audio: item.audio,
            levelId: 'L1'
          });
          l1Items.push({
            displayText: item.baseLetter.toLowerCase(),
            baseLetter: item.baseLetter,
            audio: item.audio,
            levelId: 'L1'
          });
        });
      } else if (letterCase === 'upper') {
        uniqueLetters.forEach(item => {
          l1Items.push({
            displayText: item.baseLetter.toUpperCase(),
            baseLetter: item.baseLetter,
            audio: item.audio,
            levelId: 'L1'
          });
        });
      } else if (letterCase === 'lower') {
        uniqueLetters.forEach(item => {
          l1Items.push({
            displayText: item.baseLetter.toLowerCase(),
            baseLetter: item.baseLetter,
            audio: item.audio,
            levelId: 'L1'
          });
        });
      } else {
        uniqueLetters.forEach(item => {
          l1Items.push({
            displayText: item.baseLetter.toUpperCase() + item.baseLetter.toLowerCase(),
            baseLetter: item.baseLetter,
            audio: item.audio,
            levelId: 'L1'
          });
        });
      }

      displayItems = [...l1Items, ...displayItems];
    }

    if (chartIsRandom) {
      displayItems = shuffleArray(displayItems);
    }

    // Preload audio files
    if (typeof AudioPlayer !== 'undefined' && AudioPlayer.preload) {
      displayItems.forEach(item => {
        if (item.audio) AudioPlayer.preload(item.audio);
      });
    }

    // Update count badge
    const badge = document.getElementById('chart-count-badge');
    if (badge) {
      let label = 'Items';
      if (isOnlyLevel1) {
        label = displayItems.length === 1 ? 'Letter' : 'Letters';
      } else if (!letterMap.size) {
        label = displayItems.length === 1 ? 'Word' : 'Words';
      } else {
        label = displayItems.length === 1 ? 'Item' : 'Items';
      }
      badge.textContent = `${displayItems.length} ${label}`;
    }

    // Update randomize and reset order button states
    const randomBtn = document.getElementById('chart-random-btn');
    if (randomBtn) {
      randomBtn.classList.toggle('active', chartIsRandom);
      randomBtn.title = chartIsRandom ? 'Randomized order (click to re-shuffle)' : 'Randomize word/letter order';
    }
    const resetOrderBtn = document.getElementById('chart-reset-order-btn');
    if (resetOrderBtn) {
      resetOrderBtn.classList.toggle('hidden', !chartIsRandom);
    }

    // Calculate balanced row distribution
    const rowCounts = calculateRowDistribution(displayItems.length, !isOnlyLevel1);
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
        if (item.levelId) {
          tile.classList.add(`tile-level-${item.levelId}`);
          tile.dataset.level = item.levelId;
          const level = (phonicsData && phonicsData.levels)
            ? phonicsData.levels.find(l => l.id === item.levelId)
            : null;
          if (level) {
            const targetColor = level.targetSoundColor || (level.color && window.PhonicsEngine && window.PhonicsEngine.getContrastingTargetSoundColor ? window.PhonicsEngine.getContrastingTargetSoundColor(level.color) : null);
            if (targetColor && !['L1', 'L2', 'L3', 'L4', 'L5'].includes(item.levelId)) {
              tile.style.setProperty('--target-sound-color', targetColor);
            }
          }
        }
        tile.dataset.baseLetter = item.baseLetter;
        tile.dataset.audio = item.audio || '';
        tile.dataset.text = item.displayText;
        tile.dataset.tileIndex = currentIdx;

        const highlightFn = (window.PhonicsEngine && window.PhonicsEngine.highlightTargetSound) || null;
        const formattedText = (options.highlightSounds && item.levelId !== 'L1' && !item.isSightWord && item.targetSound && highlightFn)
          ? highlightFn(item.displayText, item.targetSound, item.levelId)
          : item.displayText;
        tile.innerHTML = `<span class="letter-tile-text">${formattedText}</span>`;

        tile.addEventListener('click', (e) => {
          e.stopPropagation();
          clearTypeAhead();
          setActiveChartTile(currentIdx, true);
        });

        rowEl.appendChild(tile);
      }

      grid.appendChild(rowEl);
    });
  }

  function calculateRowDistribution(totalItems, isWordsMode = false) {
    if (totalItems <= 4) {
      return [totalItems];
    }
    let numRows = 2;
    if (isWordsMode) {
      if (totalItems <= 8) numRows = 2;
      else if (totalItems <= 16) numRows = 3;
      else if (totalItems <= 24) numRows = 4;
      else if (totalItems <= 36) numRows = 5;
      else if (totalItems <= 50) numRows = 6;
      else if (totalItems <= 72) numRows = 7;
      else numRows = 8;
    } else {
      if (totalItems <= 8) numRows = 2;
      else if (totalItems <= 18) numRows = 3;
      else if (totalItems <= 28) numRows = 4;
      else if (totalItems <= 42) numRows = 5;
      else if (totalItems <= 56) numRows = 6;
      else numRows = 7;
    }

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

    tile.classList.remove('playing');
    void tile.offsetWidth;
    tile.classList.add('playing');
    setTimeout(() => {
      tile.classList.remove('playing');
    }, 500);

    const audioPath = tile.dataset.audio;
    const text = tile.dataset.text;
    if (typeof AudioPlayer !== 'undefined' && AudioPlayer.playWord) {
      AudioPlayer.playWord(text, audioPath || undefined);
    }
  }

  function closeChart() {
    if (typeof AudioPlayer !== 'undefined' && AudioPlayer.stop) {
      AudioPlayer.stop();
    }
    if (typeof MediaDB !== 'undefined' && MediaDB.revokeAllUrls) {
      MediaDB.revokeAllUrls();
    }
    clearTypeAhead();
    if (chartKeyboardHandler) {
      window.removeEventListener('keydown', chartKeyboardHandler);
      chartKeyboardHandler = null;
    }
    currentChartIndex = -1;
    currentChartLevel = null;
    currentChartUnits = [];
    chartIsRandom = false;
    const chartScreen = document.getElementById('chart-screen');
    if (chartScreen) {
      chartScreen.classList.remove('chart-bg-L1', 'chart-bg-L2', 'chart-bg-L3', 'chart-bg-L4', 'chart-bg-L5', 'chart-bg-multi');
      chartScreen.style.background = '';
      chartScreen.classList.add('hidden');
    }
    document.getElementById('menu-screen')?.classList.remove('hidden');

    context.onClose();

    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }

  // ── Public Export ──────────────────────────────────────────
  window.ChartScreen = {
    init,
    open: openChart,
    openLetter: openLetterChart,
    close: closeChart,
    renderGrid: renderChartGrid,
    setActiveTile: setActiveChartTile
  };

})(window);
