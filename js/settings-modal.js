/**
 * Phonics Flash — Settings & Classes Modal Module
 * Handles Class Management, Schedule / Presets, Voice & TTS settings,
 * Media & AI Keys configuration, and Cloud Sync / Backup.
 */
(function (window) {
  'use strict';

  let classesUIInitialized = false;

  let context = {
    onClassSelect: () => {},
    onClassDeselect: () => {},
    getSelectedUnitIds: () => [],
    getOptions: () => ({}),
    onCurriculumChange: () => {},
    showToast: (msg, type, dur) => {
      console.log(`[Toast ${type}] ${msg}`);
    }
  };

  function init(ctx = {}) {
    context = { ...context, ...ctx };
    initClassesUI();
  }

  function populateClassDropdown() {
    const classSelect = document.getElementById('class-select');
    if (!classSelect || typeof ClassesManager === 'undefined') return;
    const classes = ClassesManager.getClasses();
    const activeClass = ClassesManager.getActiveClass();

    const sortedClasses = [...classes].sort((a, b) => a.name.localeCompare(b.name));

    classSelect.innerHTML = `<option value="">General (No Class)</option>`;
    sortedClasses.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      classSelect.appendChild(opt);
    });

    if (activeClass) {
      classSelect.value = activeClass.id;
    } else {
      classSelect.value = '';
    }
  }

  function openClassModal(tabId = 'classes-tab') {
    const modal = document.getElementById('class-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    switchModalTab(tabId);
  }

  function closeClassModal() {
    const modal = document.getElementById('class-modal');
    if (modal) modal.classList.add('hidden');
  }

  function switchModalTab(tabId) {
    const tabBtns = document.querySelectorAll('.modal-tab-btn');
    const modalTitle = document.getElementById('modal-title');

    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.modal-tab-content').forEach(c => {
      c.classList.toggle('active', c.id === tabId);
    });

    if (modalTitle) {
      if (tabId === 'classes-tab') modalTitle.textContent = 'My Classes';
      else if (tabId === 'tts-tab') modalTitle.textContent = 'Voice & TTS Settings';
      else if (tabId === 'media-tab') modalTitle.textContent = 'Media & AI Keys';
      else if (tabId === 'sync-tab') modalTitle.textContent = 'Cloud Sync & Backup';
      else modalTitle.textContent = 'Settings & Classes';
    }

    if (tabId === 'classes-tab') {
      hideClassForm();
      renderClassesListModal();
    } else if (tabId === 'tts-tab') {
      populateTTSSettings();
    } else if (tabId === 'media-tab') {
      populateMediaSettings();
    } else if (tabId === 'sync-tab') {
      populateSyncForm();
    }
  }

  function updateSpeedUI(val) {
    const speedDisplay = document.getElementById('elevenlabs-speed-display');
    const specsSpeedVal = document.getElementById('specs-speed-val');
    const num = parseFloat(val);
    const formatted = (isNaN(num) ? 0.85 : num).toFixed(2) + 'x';
    if (speedDisplay) speedDisplay.textContent = formatted;
    if (specsSpeedVal) specsSpeedVal.textContent = formatted;
  }

  function updateTTSBadge() {
    const statusBadge = document.getElementById('tts-status-badge');
    if (!statusBadge || typeof AudioPlayer === 'undefined') return;
    const key = AudioPlayer.getApiKey();
    if (key) {
      statusBadge.className = 'tts-status-badge active';
      const masked = key.length > 8 ? key.slice(0, 4) + '...' + key.slice(-4) : 'Active';
      statusBadge.textContent = `Active (${masked})`;
      statusBadge.title = `ElevenLabs API active: ${key}`;
    } else {
      statusBadge.className = 'tts-status-badge fallback';
      statusBadge.textContent = 'Browser Speech';
      statusBadge.title = 'No ElevenLabs key saved. Using browser Web Speech API fallback.';
    }
  }

  function populateTTSSettings() {
    const keyInput = document.getElementById('elevenlabs-key-input');
    const voiceSelect = document.getElementById('elevenlabs-voice-select');
    const speedInput = document.getElementById('elevenlabs-speed-input');
    const feedbackEl = document.getElementById('tts-test-feedback');

    if (keyInput && typeof AudioPlayer !== 'undefined') {
      keyInput.value = AudioPlayer.getApiKey() || '';
    }
    if (voiceSelect && typeof AudioPlayer !== 'undefined') {
      voiceSelect.value = AudioPlayer.getSelectedVoiceId() || '';
    }
    if (typeof AudioPlayer !== 'undefined') {
      const currentSpeed = AudioPlayer.getPlaybackSpeed();
      if (speedInput) speedInput.value = currentSpeed.toFixed(2);
      updateSpeedUI(currentSpeed);
    }
    if (feedbackEl) {
      feedbackEl.className = 'tts-feedback-msg hidden';
      feedbackEl.textContent = '';
    }
    updateTTSBadge();
  }

  function renderClassesListModal() {
    const container = document.getElementById('classes-list-container');
    const modal = document.getElementById('class-modal');
    if (!container || typeof ClassesManager === 'undefined') return;

    const classes = ClassesManager.getClasses();
    const activeClass = ClassesManager.getActiveClass();

    if (classes.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--text-muted);">
          <p>No classes created yet.</p>
          <p style="margin-top:0.5rem;font-size:0.85rem;">Click "+ New Class" above to create one.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    const sortedClasses = [...classes].sort((a, b) => a.name.localeCompare(b.name));
    sortedClasses.forEach(c => {
      const isActive = activeClass && activeClass.id === c.id;

      const card = document.createElement('div');
      card.className = `class-card-item ${isActive ? 'active-class' : ''}`;
      card.innerHTML = `
        <div class="class-card-info" title="Click to use this class">
          <div class="class-card-name">
            <span class="class-name-text"></span>
            ${isActive ? '<span class="active-pill">Active</span>' : ''}
          </div>
        </div>
        <div class="class-card-actions">
          <button class="btn-icon-small edit-btn" title="Edit class">✏️ Edit</button>
          <button class="btn-icon-small select-btn" title="Use this class">✔️ Use</button>
          <button class="btn-icon-small delete delete-btn" title="Delete class">🗑️</button>
        </div>
      `;
      card.querySelector('.class-name-text').textContent = c.name;

      const selectHandler = () => {
        ClassesManager.setActiveClassId(c.id);
        context.onClassSelect(c);
        populateClassDropdown();
        if (modal) modal.classList.add('hidden');
      };

      card.querySelector('.class-card-info').addEventListener('click', selectHandler);
      card.querySelector('.select-btn').addEventListener('click', selectHandler);

      card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        showClassForm(c);
      });

      card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete class "${c.name}"?`)) {
          ClassesManager.deleteClass(c.id);
          populateClassDropdown();
          renderClassesListModal();
          context.onCurriculumChange();
        }
      });

      container.appendChild(card);
    });
  }

  function showClassForm(cls) {
    const classesListView = document.getElementById('classes-list-view');
    const classFormView = document.getElementById('class-form-view');
    const classFormTitle = document.getElementById('class-form-title');

    if (classesListView) classesListView.classList.add('hidden');
    if (classFormView) classFormView.classList.remove('hidden');

    const nameInput = document.getElementById('form-class-name');
    document.getElementById('form-class-id').value = cls ? cls.id : '';
    if (nameInput) nameInput.value = cls ? cls.name : '';
    document.getElementById('form-start-time').value = cls?.schedule?.startTime || '15:00';
    document.getElementById('form-end-time').value = cls?.schedule?.endTime || '16:00';

    const selectedDays = cls?.schedule?.days || ['Mon', 'Wed', 'Fri'];
    document.querySelectorAll('#class-form input[name="days"]').forEach(cb => {
      cb.checked = selectedDays.includes(cb.value);
    });

    const curSelect = document.getElementById('form-class-curriculum');
    if (curSelect && typeof EditorStore !== 'undefined') {
      let curricula = EditorStore.getCurricula();
      if (!curricula || curricula.length === 0) {
        curricula = EditorStore.getAllCurriculaRaw();
      }
      curSelect.innerHTML = '';
      curricula.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        curSelect.appendChild(opt);
      });
      const selectedCurId = cls ? (cls.curriculumId || 'smart-phonics') : EditorStore.getActiveCurriculumId();
      curSelect.value = selectedCurId;
      if (!curSelect.value && curSelect.options.length > 0) {
        curSelect.selectedIndex = 0;
      }
    }

    if (classFormTitle) {
      classFormTitle.textContent = cls ? `Edit Class: ${cls.name}` : 'Create New Class';
    }

    if (nameInput) {
      setTimeout(() => nameInput.focus(), 50);
    }
  }

  function hideClassForm() {
    const classesListView = document.getElementById('classes-list-view');
    const classFormView = document.getElementById('class-form-view');
    if (classFormView) classFormView.classList.add('hidden');
    if (classesListView) classesListView.classList.remove('hidden');
  }

  function populateMediaSettings() {
    const pixabayInput = document.getElementById('pixabay-key-settings');
    const geminiInput = document.getElementById('gemini-key-settings');
    const unsplashInput = document.getElementById('unsplash-key-settings');
    const hideSmartCb = document.getElementById('hide-smart-phonics-checkbox');

    if (pixabayInput && typeof MediaAPIs !== 'undefined') {
      pixabayInput.value = MediaAPIs.getPixabayKey() || '';
    }
    if (geminiInput && typeof MediaAPIs !== 'undefined') {
      geminiInput.value = MediaAPIs.getGeminiKey() || '';
    }
    if (unsplashInput && typeof MediaAPIs !== 'undefined') {
      unsplashInput.value = MediaAPIs.getUnsplashKey() || '';
    }
    if (hideSmartCb && typeof EditorStore !== 'undefined') {
      hideSmartCb.checked = EditorStore.isBuiltInHidden();
    }
  }

  function populateSyncForm() {
    if (typeof ClassesManager === 'undefined') return;
    const upstashCfg = ClassesManager.getUpstashConfig();
    const urlInput = document.getElementById('upstash-url-input');
    const tokenInput = document.getElementById('upstash-token-input');
    if (urlInput && upstashCfg?.url) urlInput.value = upstashCfg.url;
    if (tokenInput && upstashCfg?.token) tokenInput.value = upstashCfg.token;
  }

  function initClassesUI() {
    populateClassDropdown();
    if (classesUIInitialized) return;
    classesUIInitialized = true;

    const classSelect = document.getElementById('class-select');
    const settingsBtn = document.getElementById('open-settings-btn');
    const modal = document.getElementById('class-modal');
    const closeBtn = document.getElementById('modal-close-btn');
    const tabBtns = document.querySelectorAll('.modal-tab-btn');
    const addClassBtn = document.getElementById('add-class-btn');
    const classForm = document.getElementById('class-form');
    const cancelFormBtn = document.getElementById('form-cancel-btn');
    const formBackBtn = document.getElementById('form-back-btn');
    const saveUpstashBtn = document.getElementById('save-upstash-btn');
    const exportBtn = document.getElementById('export-classes-btn');
    const importInput = document.getElementById('import-classes-input');

    // ElevenLabs / TTS Settings Elements
    const keyInput = document.getElementById('elevenlabs-key-input');
    const visibilityBtn = document.getElementById('toggle-key-visibility');
    const voiceSelect = document.getElementById('elevenlabs-voice-select');
    const speedInput = document.getElementById('elevenlabs-speed-input');
    const speedResetBtn = document.getElementById('speed-reset-default-btn');
    const saveTtsBtn = document.getElementById('save-elevenlabs-btn');
    const testTtsBtn = document.getElementById('test-elevenlabs-btn');
    const clearTtsBtn = document.getElementById('clear-elevenlabs-btn');
    const feedbackEl = document.getElementById('tts-test-feedback');

    // Dropdown change
    if (classSelect) {
      classSelect.addEventListener('change', (e) => {
        const classId = e.target.value;
        if (!classId) {
          context.onClassDeselect();
        } else {
          const cls = ClassesManager.getClasses().find(c => c.id === classId);
          if (cls) {
            ClassesManager.setActiveClassId(cls.id);
            context.onClassSelect(cls);
          }
        }
      });
    }

    // Settings button -> Open modal to My Classes tab
    if (settingsBtn && modal) {
      settingsBtn.addEventListener('click', () => {
        openClassModal('classes-tab');
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

    // Speed range slider & reset
    if (speedInput) {
      speedInput.addEventListener('input', (e) => {
        updateSpeedUI(e.target.value);
      });
    }

    if (speedResetBtn && speedInput) {
      speedResetBtn.addEventListener('click', () => {
        speedInput.value = '0.85';
        updateSpeedUI(0.85);
      });
    }

    // Toggle API key visibility
    if (visibilityBtn && keyInput) {
      visibilityBtn.addEventListener('click', () => {
        const isPassword = keyInput.type === 'password';
        keyInput.type = isPassword ? 'text' : 'password';
        visibilityBtn.title = isPassword ? 'Hide API key' : 'Show API key';
        visibilityBtn.classList.toggle('active', isPassword);
      });
    }

    // Save TTS preferences
    if (saveTtsBtn) {
      saveTtsBtn.addEventListener('click', () => {
        const newKey = (keyInput ? keyInput.value : '').trim();
        const voiceId = (voiceSelect ? voiceSelect.value : '').trim();
        const speedVal = speedInput ? parseFloat(speedInput.value) : 0.85;

        if (newKey) {
          localStorage.setItem('phonics-flash-elevenlabs-key', newKey);
        } else {
          localStorage.removeItem('phonics-flash-elevenlabs-key');
        }

        if (voiceId) {
          localStorage.setItem('phonics-flash-elevenlabs-voice', voiceId);
        } else {
          localStorage.removeItem('phonics-flash-elevenlabs-voice');
        }

        if (!isNaN(speedVal)) {
          localStorage.setItem('phonics-flash-elevenlabs-speed', speedVal.toString());
        }

        if (typeof AudioPlayer !== 'undefined') {
          AudioPlayer.clearCache();
        }

        updateTTSBadge();

        if (feedbackEl) {
          feedbackEl.className = 'tts-feedback-msg success';
          feedbackEl.textContent = newKey
            ? '✓ ElevenLabs API key and voice preferences saved!'
            : '✓ Preferences saved (using browser speech fallback).';
          feedbackEl.classList.remove('hidden');
          setTimeout(() => {
            if (feedbackEl) feedbackEl.classList.add('hidden');
          }, 4000);
        }

        context.showToast('Voice settings saved!', 'success', 2500);
      });
    }

    // Test Voice
    if (testTtsBtn) {
      testTtsBtn.addEventListener('click', async () => {
        const testKey = (keyInput ? keyInput.value : '').trim() || (typeof AudioPlayer !== 'undefined' ? AudioPlayer.getApiKey() : null);
        const voiceId = (voiceSelect ? voiceSelect.value : '').trim();
        const testSpeed = speedInput ? parseFloat(speedInput.value) : null;

        if (!testKey) {
          if (feedbackEl) {
            feedbackEl.className = 'tts-feedback-msg error';
            feedbackEl.textContent = '⚠️ Please enter an ElevenLabs API key first.';
            feedbackEl.classList.remove('hidden');
          }
          if (keyInput) keyInput.focus();
          return;
        }

        const originalBtnHTML = testTtsBtn.innerHTML;
        testTtsBtn.disabled = true;
        testTtsBtn.innerHTML = `<span>Testing voice...</span>`;
        if (feedbackEl) {
          feedbackEl.className = 'tts-feedback-msg';
          feedbackEl.textContent = 'Connecting to ElevenLabs API...';
          feedbackEl.classList.remove('hidden');
        }

        try {
          await AudioPlayer.testElevenLabs(testKey, voiceId, 'phonics', testSpeed);
          if (feedbackEl) {
            feedbackEl.className = 'tts-feedback-msg success';
            feedbackEl.textContent = '✓ Voice synthesis connected! Test audio played successfully.';
            feedbackEl.classList.remove('hidden');
          }
        } catch (err) {
          if (feedbackEl) {
            feedbackEl.className = 'tts-feedback-msg error';
            feedbackEl.textContent = `✕ ${err.message || 'ElevenLabs request failed'}`;
            feedbackEl.classList.remove('hidden');
          }
        } finally {
          testTtsBtn.disabled = false;
          testTtsBtn.innerHTML = originalBtnHTML;
        }
      });
    }

    // Clear key
    if (clearTtsBtn) {
      clearTtsBtn.addEventListener('click', () => {
        if (!confirm('Are you sure you want to remove your saved ElevenLabs API key from this browser?')) {
          return;
        }
        localStorage.removeItem('phonics-flash-elevenlabs-key');
        localStorage.removeItem('phonics-flash-elevenlabs-speed');
        if (keyInput) keyInput.value = '';
        if (speedInput) speedInput.value = '0.85';
        updateSpeedUI(0.85);

        if (typeof AudioPlayer !== 'undefined') {
          AudioPlayer.clearCache();
        }
        updateTTSBadge();

        if (feedbackEl) {
          feedbackEl.className = 'tts-feedback-msg';
          feedbackEl.textContent = 'API key removed. Audio will now use browser Speech Synthesis fallback.';
          feedbackEl.classList.remove('hidden');
          setTimeout(() => {
            if (feedbackEl) feedbackEl.classList.add('hidden');
          }, 4000);
        }

        context.showToast('API key removed from browser', 'info', 2500);
      });
    }

    // Add / Form buttons
    if (addClassBtn) {
      addClassBtn.addEventListener('click', () => {
        showClassForm(null);
      });
    }

    if (cancelFormBtn) {
      cancelFormBtn.addEventListener('click', hideClassForm);
    }

    if (formBackBtn) {
      formBackBtn.addEventListener('click', hideClassForm);
    }

    // Auto-parse schedule from class name input
    const classNameInput = document.getElementById('form-class-name');
    if (classNameInput) {
      classNameInput.addEventListener('input', () => {
        const val = classNameInput.value;
        if (typeof ClassesManager !== 'undefined' && ClassesManager.parseScheduleFromClassName) {
          const { days, time } = ClassesManager.parseScheduleFromClassName(val);
          if (days && days.length > 0) {
            document.querySelectorAll('#class-form input[name="days"]').forEach(cb => {
              cb.checked = days.includes(cb.value);
            });
          }
          if (time) {
            const startEl = document.getElementById('form-start-time');
            const endEl = document.getElementById('form-end-time');
            if (startEl && time.startTime) startEl.value = time.startTime;
            if (endEl && time.endTime) endEl.value = time.endTime;
          }
        }
      });
    }

    if (classForm) {
      classForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const classId = document.getElementById('form-class-id').value;
        const name = document.getElementById('form-class-name').value.trim();
        const startTime = document.getElementById('form-start-time').value;
        const endTime = document.getElementById('form-end-time').value;
        const checkedDays = Array.from(document.querySelectorAll('#class-form input[name="days"]:checked')).map(cb => cb.value);
        const curSelect = document.getElementById('form-class-curriculum');
        const curriculumId = curSelect ? curSelect.value : 'smart-phonics';

        if (!name) return;

        if (classId) {
          ClassesManager.updateClass(classId, {
            name,
            curriculumId,
            schedule: { days: checkedDays, startTime, endTime }
          });
          context.showToast(`Updated class "${name}"`, 'success', 2000);
        } else {
          const currentUnits = context.getSelectedUnitIds();
          const currentOptions = context.getOptions();
          ClassesManager.addClass({
            name,
            curriculumId,
            schedule: { days: checkedDays, startTime, endTime },
            selectedUnits: currentUnits,
            options: { ...currentOptions }
          });
          context.showToast(`Created class "${name}"`, 'success', 2000);
        }

        populateClassDropdown();
        renderClassesListModal();
        hideClassForm();
      });
    }

    // Save Media & AI Keys
    const saveMediaKeysBtn = document.getElementById('save-media-keys-btn');
    if (saveMediaKeysBtn) {
      saveMediaKeysBtn.addEventListener('click', () => {
        const pixabay = document.getElementById('pixabay-key-settings')?.value.trim() || '';
        const gemini = document.getElementById('gemini-key-settings')?.value.trim() || '';
        const unsplash = document.getElementById('unsplash-key-settings')?.value.trim() || '';
        const hideSmart = document.getElementById('hide-smart-phonics-checkbox')?.checked || false;

        if (typeof MediaAPIs !== 'undefined') {
          MediaAPIs.setPixabayKey(pixabay);
          MediaAPIs.setGeminiKey(gemini);
          MediaAPIs.setUnsplashKey(unsplash);
        }

        if (typeof EditorStore !== 'undefined') {
          EditorStore.setHideBuiltIn(hideSmart);
          context.onCurriculumChange();
        }

        const msgSpan = document.getElementById('media-keys-status-msg');
        if (msgSpan) {
          msgSpan.textContent = '✅ Saved!';
          msgSpan.style.color = '#3DAA5C';
          setTimeout(() => { if (msgSpan) msgSpan.textContent = ''; }, 3000);
        }
        context.showToast('Media & AI settings saved', 'success', 2000);
      });
    }

    const hideSmartCheckbox = document.getElementById('hide-smart-phonics-checkbox');
    if (hideSmartCheckbox) {
      hideSmartCheckbox.addEventListener('change', (e) => {
        if (typeof EditorStore !== 'undefined') {
          EditorStore.setHideBuiltIn(e.target.checked);
          context.onCurriculumChange();
        }
      });
    }

    // Cloud Sync
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
            context.showToast('Connected and synced to Upstash Redis!', 'success', 3000);
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
        context.showToast('Classes backup exported!', 'success', 2000);
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
            context.onCurriculumChange();
            context.showToast(`Imported ${res.count} classes!`, 'success', 3000);
          } else {
            context.showToast(`Import failed: ${res.error}`, 'error', 4000);
          }
        };
        reader.readAsText(file);
      });
    }

    updateTTSBadge();
  }

  // ── Public Export ──────────────────────────────────────────
  window.SettingsModal = {
    init,
    open: openClassModal,
    close: closeClassModal,
    switchTab: switchModalTab,
    populateClassDropdown,
    updateTTSBadge
  };

})(window);
