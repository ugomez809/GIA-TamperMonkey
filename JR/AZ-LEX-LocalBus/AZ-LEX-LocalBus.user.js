// ==UserScript==
// @name         AZ-LEX Bus
// @namespace    tm.az.lex.localbus
// @version      3.1.44
// @description  Single script for BOTH tabs (AZ + LEX). Local TM bus via GM_setValue + GM_addValueChangeListener (AZ_TO_LEX / LEX_TO_AZ). No ticket deletion. Never auto-stops: retries/reloads instead, Janiel CSR retry gate, red LEX "Policy no found" banner, hard LEX premium watchdog.
// @match        https://app.agencyzoom.com/*
// @match        https://farmersagent.lightning.force.com/*
// @run-at       document-idle
// @all-frames   true
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/JR/AZ-LEX-LocalBus/AZ-LEX-LocalBus.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// ==/UserScript==

(() => {
  'use strict';

const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info?.script?.version) || '3.1.44';

  // =========================
  // Shared: guard + helpers
  // =========================
  const IS_TOP = (() => { try { return window.top === window.self; } catch { return true; } })();
  if (!IS_TOP) return; // avoid double-running in iframes

  const HOST = String(location.hostname || '').toLowerCase();
  const IS_AZ  = HOST.includes('agencyzoom.com');
  const IS_LEX = HOST.includes('lightning.force.com');

  const BUS_KEYS = {
    AZ_TO_LEX: 'AZ_TO_LEX',
    LEX_TO_AZ: 'LEX_TO_AZ',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand  = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const nowStr = () => new Date().toLocaleTimeString();
  const norm = (s) => (s ?? '').toString().replace(/\s+/g, ' ').trim();
  const cleanPolicy = (s) => norm(s).replace(/[^\d]/g, '');
  const isLikelyPolicy = (s) => cleanPolicy(s).length >= 6;

  function safeJsonParse(v) { try { return JSON.parse(v); } catch { return null; } }
  function makeRefId() {
    const r = Math.random().toString(16).slice(2);
    return `${Date.now()}_${r}`;
  }

  function busSendToLex(msg) {
    try { GM_setValue(BUS_KEYS.AZ_TO_LEX, msg); } catch {}
  }
  function busSendToAz(msg) {
    try { GM_setValue(BUS_KEYS.LEX_TO_AZ, msg); } catch {}
  }

  // =========================
  // AZ SIDE
  // =========================
  function bootAZ() {
    // dispose old instance (SPA)
    try { window.__AZ_LEX_LOCALBUS__?.dispose?.(); } catch {}
    window.__AZ_LEX_LOCALBUS__ = { dispose: () => {} };

    const CFG = {
      allowedPipelineMatchers: ['03. Renewals Pipeline', '4. Personal Renewals'],
      hotkeys: { loop: { key: 'D', ctrl: true, alt: true, shift: false } },

      majorDelayMs: 200,
      startSendHoldMs: 250,

      afterCompleteClickMs: 350,
      afterCloseBeforeOpenNextMs: 350,

      stepRetries: 3,
      overallRetries: 2,
      advanceFailRetries: 2,

      wait: {
        appearTimeoutMs: 9000,
        betweenClicksMs: 90,
        settleDelayMs: 140,
        pollMs: 220,
        policyWatchMs: 28000,
        policyPassTimeoutMs: 9000,
        policySearchPasses: 3,
        mainTabSettleMs: 320,

        beforeCloseMs: 260,
        beforeCopyNewPolicyMs: 260,

        modalCloseTimeoutMs: 12000,
        panelCloseTimeoutMs: 15000,
        openTicketTimeoutMs: 18000,
        // Confirm submit watcher
        confirmMaxMs: 25000,
        confirmRetryWaitMs: 12000,
      },

      watchdog: {
        enabled: true,
        noProgressMs: 60000,
        checkEveryMs: 5000,
      },

      bus: {
        resendEveryMs: 1500,
        maxNoAckResends: 20,  // warning only; never reload before LEX has time to search
      },

      // ===== 03-only: Review lane status id (default from your capture) =====
      review03: {
        defaultLaneStatus: '271252',  // can be retrained via UI button
        reloadFuseWindowMs: 180000,   // 3 minutes
        reloadFuseMax: 4,             // log only; loop never auto-stops
      },

      // LEX may say "Cancelled", but AZ only cancels when the AZ ticket itself
      // is marked as cancel/cancell/cancelled.
      azCancelGuard: {
        markers: ['cancel', 'cancell', 'cancelled', 'canceled', 'cancellation'],
      },

      primaryCsr: {
        enabled: true,
        assignedToButton: '#notePanelContainer button[data-id="assignedTo"]',
        updateButton: '#notePanelContainer #btnUpdate, #btnUpdate',
        afterOptionClickMs: 900,
        assignedToReadyMs: 12000,
        nameWaitMs: 8000,
        updateReadyMs: 8000,
        afterUpdateMs: 4000,
        name: 'Janiel Rosario',
      },

      sel: {
        openResolution:
          '#notePanelContainer > div.az-dock__top-part > div.dock-header > div.az-dock__top > div.az-dock__top-right > div.az-dock__additional-options > a.resolution-action.btn-complete.az-tooltip-bottom.circle-link.tooltipstered',
        openResolutionFallback: '#notePanelContainer a.resolution-action.btn-complete',

        openCompletedDropdown: '#serviceCompForm > div > div > div:nth-child(2) > div > div > button',
        openActionDropdown: '#actionBlock > div > div > button',
        premiumBox: 'input[name="renew[0][PolicyRenewForm][policyPremium]"]',
        confirm:
          '#serviceCompDlg > div > div > div.modal-footer > button.btn.float-right.btn-success.ml-2, #serviceCompDlg .modal-footer button.btn-success, #serviceCompDlg button.btn-success, #serviceCompDlg button[type="submit"]',

        closeCandidates: [
          '#btnCloseNotePanel',
          '#notePanelContainer #btnCloseNotePanel',
          '#notePanelContainer .az-dock__close',
          '.az-dock__close',
          '#notePanelContainer .az-dock__nav .az-navigator__close',
          '#notePanelContainer .az-dock__nav a[title*="Close"]',
        ],

        ticketRoot: '#notePanelContainer',
        modalRoot: '#serviceCompDlg',
        mainTabCandidates: [
          '#notePanelContainer [role="tab"]',
          '#notePanelContainer .nav-link',
          '#notePanelContainer a',
          '#notePanelContainer button',
        ],
        relatedPolicyButtons: [
          '#notePanelContainer button.dropdown-toggle.btn-light[role="combobox"]',
          '#notePanelContainer button.dropdown-toggle[role="combobox"]',
          '#notePanelContainer button[role="combobox"]',
          '#notePanelContainer .bootstrap-select > button',
        ],

        nextBlockSelectors: [
          '#notePanelContainer a.az-navigator__next',
          '#notePanelContainer a.nav-next',
          '#notePanelContainer .az-navigator__next',
          'a.az-navigator__next',
          'a.nav-next',
          '.az-navigator__next',
        ],
      },
    };

    const LS = {
      LOOP_ON: 'tm_az_lex_loop_on_localbus',
      RESUME:  'tm_az_lex_resume_localbus',
      RECOV:   'tm_az_lex_recovery_localbus',

      // 03-only
      REVIEW03_STATUS: 'tm_az_review_lane_status_03_localbus',
      RELOAD_GUARD_03: 'tm_az_reload_guard_03_localbus',
    };

    // --------- state ---------
    let armed = false;
    let running = false;

    let loopOn = true; // Always auto-run after reload/page load
    let stopRequested = false;
    let autoResumeStarted = false;
    let lexDecisionPending = false;

    let lastProgressTs = Date.now();
    let watchdogTimer = null;

    // current send
    let pending = null;        // waiting for ACK / resend: {policy, refId, reason}
    let currentLexJob = null;  // waiting for RESULT after ACK: {policy, refId, reason, sentAt}
    const processedResultRefIds = new Set();
    let resendTimer = null;
    let resendAttempt = 0;
    let lastPolicySent = '';

    // to avoid double reload triggers
    let reloading = false;
    let reloadConfirming = false;
    let lastReloadTs = 0;

    // pipeline flags
    let PIPE03 = false;
    let PIPE4  = false;

    // 03-only: "set review lane" capture mode
    let pickReview03Mode = false;

    // --------- helpers ---------
    const qs = (s, r = document) => { try { return r.querySelector(s); } catch { return null; } };
    const qsa = (s, r = document) => { try { return [...r.querySelectorAll(s)]; } catch { return []; } };

    function markProgress() { lastProgressTs = Date.now(); }

    function isVisible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    }

    function isTicketPanelOpen() {
      const root = qs(CFG.sel.ticketRoot);
      return !!root && isVisible(root);
    }

    function isModalOpen() {
      const dlg = qs(CFG.sel.modalRoot);
      if (!dlg) return false;
      const st = getComputedStyle(dlg);
      const hidden = st.display === 'none' || st.visibility === 'hidden' || dlg.getAttribute('aria-hidden') === 'true';
      return !hidden && isVisible(dlg);
    }

    function modalLooksLoading() {
      const dlg = qs(CFG.sel.modalRoot);
      if (!dlg || !isModalOpen()) return false;
      if (dlg.querySelector('.spinner-border,.fa-spinner,.fa-spin,.loading,.loader,[class*="loading"]')) return true;

      const btn = qs(CFG.sel.confirm, dlg) || qs(CFG.sel.confirm);
      if (btn) {
        if (btn.disabled) return true;
        if (btn.getAttribute('aria-disabled') === 'true') return true;
        if (btn.classList.contains('disabled')) return true;
        if (btn.classList.contains('loading')) return true;
        if (btn.querySelector('.spinner-border,.fa-spinner,.fa-spin')) return true;
        const txt = (btn.textContent || '').toLowerCase();
        if (txt.includes('loading') || txt.includes('saving')) return true;
      }
      return false;
    }

    function getModalErrorText() {
      const dlg = qs(CFG.sel.modalRoot);
      if (!dlg || !isModalOpen()) return '';
      const err = dlg.querySelector('.invalid-feedback,.help-block,.alert.alert-danger,.text-danger,[class*="error"]');
      const t = (err?.textContent || '').trim();
      return t.length ? t.slice(0, 200) : '';
    }

    async function majorDelay(label) {
      if (!CFG.majorDelayMs) return;
      if (stopRequested) return;
      uiLog(`[AZ] Delay ${CFG.majorDelayMs}ms: ${label}`);
      await sleep(CFG.majorDelayMs);
    }

    async function waitFor(sel, ms = CFG.wait.appearTimeoutMs) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (stopRequested) return null;
        const el = qs(sel);
        if (el) return el;
        await sleep(120);
      }
      return null;
    }

    async function waitForCondition(fn, ms, label) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (stopRequested) return false;
        let ok = false;
        try { ok = !!fn(); } catch { ok = false; }
        if (ok) return true;
        await sleep(120);
      }
      uiLog(`[AZ] Wait timeout: ${label}`);
      return false;
    }

    async function clickSel(sel) {
      for (let i = 0; i < CFG.stepRetries; i++) {
        if (stopRequested) return false;
        const el = await waitFor(sel);
        if (!el) continue;
        await sleep(CFG.wait.betweenClicksMs);
        try { el.click(); markProgress(); return true; } catch {}
        await sleep(200);
      }
      return false;
    }

    async function clickAny(sels) {
      for (const sel of sels) {
        if (await clickSel(sel)) return true;
      }
      return false;
    }

    function textMatchesAny(text, choices) {
      const t = norm(text).toLowerCase();
      return choices.some((choice) => {
        const c = norm(choice).toLowerCase();
        return t === c || t.includes(c);
      });
    }

    function findButtonNearText(root, textChoices) {
      if (!root) return null;
      const labels = qsa('label,.control-label,.field-label,strong,span,div,p', root).filter((el) => {
        const txt = norm(el.textContent || '');
        return txt && textMatchesAny(txt, textChoices);
      });

      for (const label of labels) {
        const containers = [
          label.closest('.form-group, .field, .row, .col, .bootstrap-select, .dropdown, .section'),
          label.parentElement,
          label.parentElement?.parentElement,
          label.nextElementSibling,
          label.parentElement?.nextElementSibling,
        ].filter(Boolean);

        for (const container of containers) {
          const btn = qsa('button.dropdown-toggle,button[role="combobox"],.bootstrap-select > button,button', container).find(isVisible);
          if (btn) return btn;
        }
      }
      return null;
    }

    function getResolutionTypeButton() {
      const dlg = qs(CFG.sel.modalRoot) || document;
      const exact = qs(CFG.sel.openCompletedDropdown);
      if (exact && isVisible(exact)) return exact;

      const byLabel = findButtonNearText(dlg, ['resolution type', 'resolution status', 'status']);
      if (byLabel) return byLabel;

      const buttons = qsa('#serviceCompForm button.dropdown-toggle, #serviceCompForm button[role="combobox"], #serviceCompForm .bootstrap-select > button', dlg)
        .filter((btn) => isVisible(btn) && !btn.closest('#actionBlock'));
      return buttons[0] || null;
    }

    function getActionButton() {
      const dlg = qs(CFG.sel.modalRoot) || document;
      const exact = qs(CFG.sel.openActionDropdown);
      if (exact && isVisible(exact)) return exact;
      const byActionBlock = qsa('#actionBlock button.dropdown-toggle, #actionBlock button[role="combobox"], #actionBlock .bootstrap-select > button', dlg).find(isVisible);
      if (byActionBlock) return byActionBlock;
      return findButtonNearText(dlg, ['action']);
    }

    function findOpenDropdownOptionByText(textChoices) {
      const candidates = qsa([
        '.bootstrap-select.open .dropdown-menu li:not(.disabled) a',
        '.bootstrap-select.show .dropdown-menu li:not(.disabled) a',
        '.dropdown-menu.open li:not(.disabled) a',
        '.dropdown-menu.show li:not(.disabled) a',
        '.dropdown-menu li:not(.disabled) a',
        '[role="option"]',
      ].join(',')).filter(isVisible);

      const exact = candidates.find((el) => textChoices.some((choice) => norm(el.textContent).toLowerCase() === norm(choice).toLowerCase()));
      if (exact) return exact.closest('a,button,[role="option"],li') || exact;

      const loose = candidates.find((el) => textMatchesAny(el.textContent, textChoices));
      return loose ? (loose.closest('a,button,[role="option"],li') || loose) : null;
    }

    function findNativeSelectForButton(btn) {
      if (!btn) return null;
      const wrap = btn.closest('.bootstrap-select');
      const field = btn.closest('.form-group, .field, .row, .col, .section, #actionBlock, #serviceCompForm');
      const candidates = [
        wrap?.previousElementSibling,
        wrap?.nextElementSibling,
        wrap?.parentElement?.querySelector('select'),
        field?.querySelector('select'),
      ].filter(Boolean);

      return candidates.find((el) => String(el.tagName || '').toLowerCase() === 'select') || null;
    }

    function tryNativeSelectByText(btn, textChoices, label) {
      const select = findNativeSelectForButton(btn);
      if (!select?.options?.length) return false;

      const options = [...select.options];
      const exact = options.find((opt) => textChoices.some((choice) => norm(opt.textContent).toLowerCase() === norm(choice).toLowerCase()));
      const loose = exact || options.find((opt) => textMatchesAny(opt.textContent, textChoices));
      if (!loose) return false;

      try {
        select.value = loose.value;
        for (const opt of options) opt.selected = opt === loose;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));

        const rendered = btn.querySelector('.filter-option-inner-inner,.filter-option,.filter-option-inner');
        if (rendered) rendered.textContent = norm(loose.textContent);

        uiLog(`[AZ] ${label}: selected via native select "${norm(loose.textContent)}"`);
        return true;
      } catch {
        return false;
      }
    }

    async function selectBootstrapOption(buttonGetter, textChoices, label, opts = {}) {
      const { stopOnFail = true } = opts;

      for (let i = 1; i <= CFG.stepRetries; i++) {
        if (stopRequested) return false;

        const btn = typeof buttonGetter === 'function' ? buttonGetter() : qs(buttonGetter);
        if (!btn || !isVisible(btn)) {
          uiLog(`[AZ] ${label}: dropdown button not found (try ${i})`);
          await sleep(250);
          continue;
        }

        uiLog(`[AZ] ${label}: open dropdown (try ${i})`);
        humanClick(btn);
        await sleep(260);

        const option = findOpenDropdownOptionByText(textChoices);
        if (!option) {
          if (tryNativeSelectByText(btn, textChoices, label)) return true;
          uiLog(`[AZ] ${label}: option not found (${textChoices.join(' / ')})`);
          dispatchKeyEscape();
          await sleep(250);
          continue;
        }

        uiLog(`[AZ] ${label}: select "${norm(option.textContent)}"`);
        humanClick(option);
        await sleep(CFG.wait.settleDelayMs);
        return true;
      }

            if (stopOnFail) {
        toast(`${label} was not selected. Refreshing AgencyZoom and retrying.`, 5200);
        uiLog(`[AZ] ${label}: FAILED to select ${textChoices.join(' / ')} -> refresh AZ only, keep loop ON`);
        reloadAzOnly(`${label} not selected`);
      } else {
        uiLog(`[AZ] ${label}: optional selection missing (${textChoices.join(' / ')}) → skip`);
      }

      return false;
    }

    async function selectResolutionType(value, opts = {}) {
      const choices = value === 'completed'
        ? ['Completed', 'Complete']
        : ['Cancelled', 'Canceled'];
      return await selectBootstrapOption(getResolutionTypeButton, choices, 'Resolution type', opts);
    }

    function isPolicyActionStatusButton(btn) {
      if (!btn) return false;
      if (btn.getAttribute('data-id') === 'actionStatus') return true;
      const txt = norm(btn.textContent || '').toLowerCase();
      return txt.includes('leave it as it is') || !!btn.closest('#actionBlock');
    }

    function getFirstStepResolutionTypeButtons() {
      const dlg = qs(CFG.sel.modalRoot) || document;
      const candidates = [];
      const add = (btn) => {
        if (!btn || !isVisible(btn) || isPolicyActionStatusButton(btn)) return;
        if (!candidates.includes(btn)) candidates.push(btn);
      };

      add(qs(CFG.sel.openCompletedDropdown));
      add(findButtonNearText(dlg, ['resolution type']));
      qsa('#serviceCompForm button.dropdown-toggle, #serviceCompForm button[role="combobox"], #serviceCompForm .bootstrap-select > button', dlg)
        .forEach(add);
      return candidates;
    }

    async function selectFirstStepResolutionType(opts = {}) {
      const { stopOnFail = true } = opts;
      const choices = ['Confirm', 'Confirmed'];
      const label = 'First-step resolution type';

      for (let i = 1; i <= CFG.stepRetries; i++) {
        if (stopRequested) return false;
        const buttons = getFirstStepResolutionTypeButtons();
        if (!buttons.length) {
          uiLog(`[AZ] ${label}: dropdown button not found (try ${i})`);
          await sleep(250);
          continue;
        }

        for (const btn of buttons) {
          if (tryNativeSelectByText(btn, choices, label)) return true;

          uiLog(`[AZ] ${label}: open dropdown (try ${i})`);
          humanClick(btn);
          await sleep(260);

          const option = findOpenDropdownOptionByText(choices);
          if (option) {
            uiLog(`[AZ] ${label}: select "${norm(option.textContent)}"`);
            humanClick(option);
            await sleep(CFG.wait.settleDelayMs);
            return true;
          }

          dispatchKeyEscape();
          await sleep(180);
        }

        uiLog(`[AZ] ${label}: Confirm option not found (try ${i})`);
        await sleep(250);
      }

      if (stopOnFail) {
        toast(`${label} was not selected. Loop paused so you can inspect the modal.`, 5200);
        uiLog(`[AZ] ${label}: FAILED to select ${choices.join(' / ')} -> pause loop, no reload`);
        stopLoop(`${label} not selected`);
      }
      return false;
    }

    async function selectResolutionAction(value, opts = {}) {
      const choices = value === 'renew'
        ? ['Renew', 'Renewed']
        : ['Cancel', 'Cancelled', 'Canceled'];
      return await selectBootstrapOption(getActionButton, choices, 'Resolution action', opts);
    }

    function getAssignedToButton() {
      const root = getTicketRoot() || document;
      const candidates = uniqueEls([
        qs(CFG.primaryCsr.assignedToButton, root),
        qs(CFG.primaryCsr.assignedToButton),
        ...qsa('#notePanelContainer button[data-id="assignedTo"], button[data-id="assignedTo"]', root),
        ...qsa('#notePanelContainer button[data-id="assignedTo"], button[data-id="assignedTo"]'),
      ]).filter(Boolean);

      return candidates.find((btn) => isVisible(btn) && btn.getAttribute('data-id') === 'assignedTo') || null;
    }

    function getAssignedToText() {
      const btn = getAssignedToButton();
      if (!btn) return '';
      const visibleText = norm(btn.querySelector?.('.filter-option-inner-inner')?.textContent || '');
      return visibleText || getNodeLabelText(btn);
    }

    function findAssignedToOption(btn) {
      const name = CFG.primaryCsr.name;
      const owns = btn?.getAttribute?.('aria-owns') || '';
      if (owns) {
        const byOwnedId = qsa(`[id^="${owns}-"][role="option"], [id^="${owns}-"]`).filter(isVisible);
        const ownedMatch = byOwnedId.find((el) => norm(el.textContent).toLowerCase() === name.toLowerCase())
          || byOwnedId.find((el) => textMatchesAny(el.textContent, [name]));
        if (ownedMatch) return ownedMatch.closest('a,button,[role="option"],li') || ownedMatch;
      }

      return findOpenDropdownOptionByText([name]);
    }

    function getPrimaryCsrUpdateButton() {
      const root = getTicketRoot() || document;
      const exact = qs(CFG.primaryCsr.updateButton, root) || qs(CFG.primaryCsr.updateButton);
      if (exact && isVisible(exact)) return exact;

      return qsa('button#btnUpdate,button.btn-primary', root).find((btn) => {
        if (!isVisible(btn)) return false;
        return norm(btn.textContent).toLowerCase() === 'update';
      }) || null;
    }

    function assignedToIsName(name) {
      return norm(getAssignedToText()).toLowerCase() === norm(name).toLowerCase();
    }

    async function waitForAssignedToButton() {
      const deadline = Date.now() + CFG.primaryCsr.assignedToReadyMs;
      while (!stopRequested && Date.now() < deadline) {
        const btn = getAssignedToButton();
        if (btn) return btn;
        await sleep(180);
      }
      return null;
    }

    function stopForWrongPrimaryCsr(context) {
      const name = CFG.primaryCsr.name;
      const actual = getAssignedToText();
      toast(`Primary CSR is "${actual || 'not found'}", not "${name}". Reloading both and retrying.`, 5200);
      uiLog(`[AZ] CSR RETRY (${context}): current="${actual || '(not found)'}", required="${name}" -> reload BOTH`);
      reloadBoth('primary CSR not Janiel');
      return false;
    }

    async function verifyPrimaryCsrOrStop(context) {
      if (!CFG.primaryCsr.enabled) return true;
      if (assignedToIsName(CFG.primaryCsr.name)) return true;
      uiLog(`[AZ] Primary CSR gate (${context}): not Janiel yet -> retry CSR update`);
      if (await ensurePrimaryCsr()) return true;
      if (stopRequested || reloading) return false;
      return stopForWrongPrimaryCsr(context);
    }

    async function waitForAssignedToName(name) {
      const deadline = Date.now() + CFG.primaryCsr.nameWaitMs;
      while (!stopRequested && Date.now() < deadline) {
        if (assignedToIsName(name)) return true;
        await sleep(160);
      }
      return false;
    }

    async function waitForPrimaryCsrUpdateButton() {
      const deadline = Date.now() + CFG.primaryCsr.updateReadyMs;
      while (!stopRequested && Date.now() < deadline) {
        const btn = getPrimaryCsrUpdateButton();
        if (btn && isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') return btn;
        await sleep(160);
      }
      return null;
    }

    async function clickPrimaryCsrUpdate() {
      for (let i = 1; i <= CFG.stepRetries; i++) {
        if (stopRequested) return false;

        const btn = await waitForPrimaryCsrUpdateButton();
        if (!btn) {
          uiLog(`[AZ] Primary CSR: Update button not ready (try ${i})`);
          continue;
        }

        uiLog('[AZ] Primary CSR: click Update');
        try { document.activeElement?.blur?.(); } catch {}
        humanClick(btn);
        await sleep(CFG.primaryCsr.afterUpdateMs);
        return true;
      }

      toast('Primary CSR Update button was not clicked. Reloading both and retrying.', 4500);
      uiLog('[AZ] Primary CSR FAILED: Update button not clicked -> reload BOTH');
      reloadBoth('primary CSR update not clicked');
      return false;
    }

    async function ensurePrimaryCsr() {
      if (!CFG.primaryCsr.enabled) return true;

      const name = CFG.primaryCsr.name;
      for (let i = 1; i <= CFG.stepRetries; i++) {
        if (stopRequested) return false;

        const btn = await waitForAssignedToButton();
        if (!btn) {
          uiLog(`[AZ] Primary CSR: assignedTo dropdown not found (try ${i})`);
          await sleep(500);
          continue;
        }

        const current = getAssignedToText();
        if (norm(current).toLowerCase() === name.toLowerCase()) {
          uiLog(`[AZ] Primary CSR already ${name}`);
          return true;
        }

        uiLog(`[AZ] Primary CSR: change "${current || '(blank)'}" → "${name}"`);
        humanClick(btn);
        await sleep(300);

        const option = findAssignedToOption(btn);
        if (!option) {
          uiLog(`[AZ] Primary CSR: option "${name}" not found (try ${i})`);
          dispatchKeyEscape();
          await sleep(250);
          continue;
        }

        humanClick(option);
        await sleep(CFG.primaryCsr.afterOptionClickMs);
        closeDropdownsAndBlur();

        const nameVisible = await waitForAssignedToName(name);
        if (!nameVisible) {
          const currentAfterWait = getAssignedToText();
          uiLog(`[AZ] Primary CSR: Janiel not visible yet after selection (now="${currentAfterWait || '(blank)'}")`);
          continue;
        }

        const updatedText = getAssignedToText();
        if (norm(updatedText).toLowerCase() === name.toLowerCase()) {
          uiLog(`[AZ] Primary CSR shows ${name}; waiting before Update`);
          await sleep(500);
          if (!await clickPrimaryCsrUpdate()) return false;
          await sleep(500);
          await ensureMainTabOpen({ forceClick: true });

          const verifiedAfterMain = await waitForAssignedToName(name);
          if (verifiedAfterMain) {
            uiLog(`[AZ] Primary CSR verified as ${name} after Update + Main`);
            return true;
          }

          const afterMainText = getAssignedToText();
          uiLog(`[AZ] Primary CSR after Update + Main is "${afterMainText || '(blank)'}", not "${name}" → repeat CSR update`);
          await sleep(600);
          continue;
        }

        uiLog(`[AZ] Primary CSR: selected option, waiting for value update (now="${updatedText || '(blank)'}")`);
        await sleep(450);
      }

      toast(`Primary CSR was not changed to ${name}. Reloading both and retrying.`, 4500);
      uiLog(`[AZ] Primary CSR FAILED: could not select ${name} -> reload BOTH`);
      reloadBoth('primary CSR not set');
      return false;
    }

    function matchesHotkey(e, hk) {
      const k = (e.key || '').toUpperCase();
      return (
        k === hk.key.toUpperCase() &&
        !!e.ctrlKey === !!hk.ctrl &&
        !!e.altKey === !!hk.alt &&
        !!e.shiftKey === !!hk.shift
      );
    }

    // --------- UI overlay ---------
    const UI = { box: null, status: null, toggleBtn: null, reloadBtn: null, completeBtn: null, setReview03Btn: null, log: null };

    function toast(msg, ms = 2600) {
      markProgress();
      const d = document.createElement('div');
      d.textContent = msg;
      d.style.cssText = `
        position:fixed;bottom:14px;left:14px;z-index:2147483647;
        background:rgba(17,24,39,.92);color:#fff;padding:10px 12px;border-radius:12px;
        font:12px system-ui;pointer-events:none;max-width:520px;white-space:pre-line;`;
      document.documentElement.appendChild(d);
      setTimeout(() => d.remove(), ms);
    }

    function uiLog(line) {
      markProgress();
      if (!UI.log) return;
      const div = document.createElement('div');
      div.textContent = line;
      UI.log.appendChild(div);
      UI.log.scrollTop = UI.log.scrollHeight;
    }

    function setStatus(t) { if (UI.status) UI.status.textContent = t; }

    function refreshUI() {
      let st = '';
      if (!armed) st = 'Not armed (wrong pipeline)';
      else if (!loopOn) st = 'Loop OFF (Ctrl+Alt+D or Start)';
      else if (pending) st = `Loop ON — sending policy ${pending.policy}…`;
      else if (lexDecisionPending) st = 'Loop ON — waiting for LEX decision…';
      else if (currentLexJob) st = `Loop ON — waiting LEX result for ${currentLexJob.policy}…`;
      else st = 'Loop ON — waiting LEX…';

      setStatus(st);
      if (UI.toggleBtn) UI.toggleBtn.textContent = loopOn ? 'Stop' : 'Start';

      // 03-only button visibility
      if (UI.setReview03Btn) {
        UI.setReview03Btn.style.display = PIPE03 ? '' : 'none';
      }
    }

    function injectUI() {
      if (UI.box) return;

      const css = document.createElement('style');
      css.textContent = `
        #tmAzLexBox{position:fixed;right:12px;bottom:12px;z-index:2147483647;
          background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.18);
          border-radius:14px;padding:10px;width:430px;font-family:system-ui;color:#fff;
          box-shadow:0 10px 30px rgba(0,0,0,.45)}
        #tmAzLexRow{display:flex;gap:8px;align-items:center;justify-content:space-between}
        #tmAzLexStatus{font-size:12px;opacity:.95;max-width:240px}
        .tmAzBtn{border:1px solid rgba(255,255,255,.18);
          background:rgba(255,255,255,.08);color:#fff;padding:6px 10px;
          border-radius:999px;cursor:pointer;font-size:12px}
        .tmAzBtn:hover{background:rgba(255,255,255,.14)}
        #tmAzLexLog{margin-top:8px;max-height:200px;overflow:auto;font-size:11px;opacity:.9;line-height:1.25}
        #tmAzLexLog div{margin:0 0 6px 0}
      `;
      document.documentElement.appendChild(css);

      const box = document.createElement('div');
      box.id = 'tmAzLexBox';
      box.innerHTML = `
        <div id="tmAzLexRow">
          <div id="tmAzLexStatus">Boot…</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
           <button id="tmAzLexSetReview03" class="tmAzBtn" title="03 only: click, then click a ticket inside Review lane to save laneStatus">Set Review Lane (03)</button>
              <button id="tmAzLexComplete" class="tmAzBtn" title="Complete current ticket">Complete</button>
              <button id="tmAzLexReload" class="tmAzBtn" title="Reload BOTH pages now">Reload</button>
              <button id="tmAzLexToggle" class="tmAzBtn" title="Start/Stop Loop">Start</button>
          </div>
        </div>
        <div id="tmAzLexLog"></div>
      `;
      document.documentElement.appendChild(box);

      UI.box = box;
      UI.status = box.querySelector('#tmAzLexStatus');
      UI.toggleBtn = box.querySelector('#tmAzLexToggle');
UI.completeBtn = box.querySelector('#tmAzLexComplete');
UI.reloadBtn = box.querySelector('#tmAzLexReload');
UI.setReview03Btn = box.querySelector('#tmAzLexSetReview03');
UI.log = box.querySelector('#tmAzLexLog');

     UI.toggleBtn.addEventListener('click', () => { if (!loopOn) startLoop(); else stopLoop('button'); });

UI.completeBtn.addEventListener('click', async () => {
  try {
    uiLog('[AZ] Manual Complete button clicked');
    await runCompleteFlow();
  } catch (err) {
    uiLog(`[AZ] Manual Complete failed: ${err?.message || err}`);
  }
});

UI.reloadBtn.addEventListener('click', () => reloadBoth('manual reload'));

      UI.setReview03Btn.addEventListener('click', () => {
        if (!PIPE03) return;
        pickReview03Mode = true;
        toast('03: Click any ticket INSIDE the Review lane now…', 4000);
        uiLog('[AZ] 03: Set Review Lane mode ON (waiting click on a ticket)');
      });

      uiLog(`[AZ] Loaded v${SCRIPT_VERSION} (never auto-stops + Janiel CSR retry gate)`);
      refreshUI();
    }

    // --------- HARD BLOCK NEXT ---------
    function isNextTarget(t) {
      if (!t) return false;
      for (const s of CFG.sel.nextBlockSelectors) {
        try { if (t.closest?.(s)) return true; } catch {}
      }
      return false;
    }
    function onBlockNext(e) {
      if (!loopOn) return;
      if (!isNextTarget(e.target)) return;
      try { e.preventDefault(); } catch {}
      try { e.stopPropagation(); } catch {}
      try { e.stopImmediatePropagation?.(); } catch {}
      uiLog('[AZ] BLOCKED NEXT click (loop is ON)');
    }
    document.addEventListener('pointerdown', onBlockNext, true);
    document.addEventListener('mousedown', onBlockNext, true);
    document.addEventListener('click', onBlockNext, true);

    // --------- 03: capture laneStatus on click ---------
    function onPickReview03(e) {
      if (!pickReview03Mode || !PIPE03) return;

      // ignore clicks on our box
      if (UI.box && (e.target === UI.box || UI.box.contains(e.target))) return;

      const a = e.target?.closest?.('.dd-card a.customer, .dd-card a');
      if (!a) return;

      const laneBody =
        a.closest('.dd-cards.swim-lane-body.drag-target[data-status]') ||
        a.closest('.dd-cards.swim-lane-body[data-status]') ||
        a.closest('.swim-lane-body.drag-target[data-status]') ||
        a.closest('.swim-lane-body[data-status]') ||
        null;

      const st = laneBody?.getAttribute?.('data-status') || '';
      if (!st) return;

      pickReview03Mode = false;
      try { localStorage.setItem(LS.REVIEW03_STATUS, String(st)); } catch {}

      toast(`03: Saved Review laneStatus = ${st}`, 3500);
      uiLog(`[AZ] 03: Saved Review laneStatus=${st} (click: "${norm(a.textContent).slice(0, 80)}")`);
      refreshUI();
    }
    document.addEventListener('click', onPickReview03, true);

    // --------- click utils ---------
    function dispatchKeyEscape() {
      try {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
      } catch {}
    }

    function humanClick(el) {
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const topEl = document.elementFromPoint(x, y) || el;
      const target = el.contains(topEl) ? topEl : el;

      const base = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 0 };
      const fireMouse = (type) => { try { target.dispatchEvent(new MouseEvent(type, base)); } catch {} };
      const firePtr = (type) => {
        try {
          if (typeof PointerEvent !== 'undefined') {
            target.dispatchEvent(new PointerEvent(type, { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          }
        } catch {}
      };

      try { target.focus?.(); } catch {}
      firePtr('pointerdown'); fireMouse('mousedown');
      firePtr('pointerup');   fireMouse('mouseup');
      fireMouse('click');
      try { target.click?.(); } catch {}
      markProgress();
      return true;
    }

    // --------- confirm submit ---------
    function closeDropdownsAndBlur() {
      try { document.activeElement?.blur?.(); } catch {}
      try { document.body.click(); } catch {}
    }
    function dispatchEnter(el) {
      if (!el) return;
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      } catch {}
    }
    function fireSubmitFromConfirm(btn) {
      try {
        const dlg = qs(CFG.sel.modalRoot);
        const form = btn?.closest('form') || dlg?.querySelector('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      } catch {}
    }

    function clickConfirmButton(btn) {
      if (!btn) return false;
      try { btn.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      try { btn.focus?.(); } catch {}
      try { btn.click?.(); markProgress(); return true; } catch {}
      return humanClick(btn);
    }

    function pauseForConfirmProblem(reason, detail) {
      const msg = `${reason}${detail ? `: ${String(detail).slice(0, 140)}` : ''}`;
      toast(`Confirm problem. Loop paused.\n${reason}`, 5200);
      uiLog(`[AZ] Confirm problem -> pause loop, no reload. ${msg}`);
      stopLoop(msg);
    }

    async function clickConfirmAndWait(flowLabel) {
      uiLog(`[AZ] Confirm: ${flowLabel}…`);
      const btn = await waitFor(CFG.sel.confirm, 9000);
      if (!btn) {
        uiLog('[AZ] Confirm: button not found');
        pauseForConfirmProblem('Confirm button not found');
        return false;
      }

      closeDropdownsAndBlur();
      await sleep(160);

      const attemptClick = async (tryNo) => {
        const b = qs(CFG.sel.confirm);
        if (!b) return false;
        uiLog(`[AZ] Confirm click (try ${tryNo})`);
        clickConfirmButton(b);
        await sleep(220);
        return true;
      };

      await attemptClick(1);

      const deadline = Date.now() + CFG.wait.confirmMaxMs;
      let sawLoading = false;

      while (!stopRequested && Date.now() < deadline) {
        if (!isModalOpen()) { uiLog('[AZ] Confirm: modal closed ✅'); return true; }

        const err = getModalErrorText();
        if (err) {
          uiLog(`[AZ] Confirm: modal error detected -> ${err}`);
          pauseForConfirmProblem('Confirm modal error', err);
          return false;
        }

        if (modalLooksLoading()) sawLoading = true;
        await sleep(250);
      }

      uiLog('[AZ] Confirm: timeout (modal still open)');

      if (sawLoading) {
        toast('Confirm stuck → retrying once…', 2200);
        await attemptClick(2);

        const ok2 = await waitForCondition(() => !isModalOpen(), CFG.wait.confirmRetryWaitMs, 'modal closed after confirm retry');
        if (ok2) { uiLog('[AZ] Confirm: closed after retry ✅'); return true; }

        uiLog('[AZ] Confirm still stuck after retry -> pause loop, no reload');
        pauseForConfirmProblem('Confirm stuck after retry');
        return false;
      }

      pauseForConfirmProblem('Confirm timeout');
      return false;
    }

    // --------- modal / close helpers ---------
    function getCloseEl() {
      for (const s of CFG.sel.closeCandidates) {
        const el = qs(s);
        if (el) return { el, sel: s };
      }
      return { el: null, sel: '' };
    }

    async function waitModalClosed() {
      uiLog('[AZ] Wait modal close…');
      await waitForCondition(() => !isModalOpen(), CFG.wait.modalCloseTimeoutMs, 'modal closed');
    }

    async function prepareAzTicketForResolution(context) {
      await ensureMainTabOpen();
      if (!await ensurePrimaryCsr()) return false;
      return await verifyPrimaryCsrOrStop(context);
    }

    async function confirmOpenedCompletedResolution(flowLabel) {
      if (!await selectResolutionType('completed')) return false;
      const okConfirm = await clickConfirmAndWait(flowLabel);
      if (!okConfirm) return false;
      await majorDelay('after confirm success');
      return true;
    }

    async function prepareFirstTicketForLexHandoff(prevPolicy = '') {
      if (stopRequested) return makeGateResult('stop');

      uiLog('[AZ] LEX handoff: Main -> Janiel Primary CSR/Producer -> copy policy without opening Complete modal');
      if (!await prepareAzTicketForResolution('before LEX handoff')) return makeGateResult('stop');

      const gatePolicy = snapshotPolicyForNewTicketGate(prevPolicy || '');
      return makeGateResult('continue', gatePolicy);
    }

    // ======= FIND REVIEW LANE =======
    function getLaneHeaderText(body) {
      const lane = body?.closest?.('.swim-lane, .lane, .dd-lane, .kanban-lane, [class*="lane"]') || body?.parentElement || null;
      const header =
        lane?.querySelector?.('.swim-lane-header, .lane-header, .lane-title, .dd-heading-wrapper, .title, h2, h3, h4') ||
        body?.previousElementSibling ||
        lane?.previousElementSibling ||
        null;
      return norm(header?.textContent || '');
    }

    function findReviewLaneBody() {
      const bodies = qsa('.dd-cards.swim-lane-body.drag-target[data-status], .dd-cards.swim-lane-body[data-status], .swim-lane-body.drag-target[data-status], .swim-lane-body[data-status]');
      if (PIPE03) {
        const saved = (localStorage.getItem(LS.REVIEW03_STATUS) || '').trim();
        const want = saved || String(CFG.review03.defaultLaneStatus || '').trim();
        const byStatus = bodies.find(b => String(b.getAttribute('data-status') || '') === String(want));
        if (byStatus) return byStatus;

        uiLog(`[AZ] 03: Review laneStatus not found in DOM (want=${want}). Use "Set Review Lane (03)".`);
      }

      // fallback: header-only text match (works for pipeline 4 without matching card text)
      return bodies.find((b) => /\breview\b/i.test(getLaneHeaderText(b))) || null;
    }

    // --------- policy extraction ---------
    function extractPolicyNumber(text) {
      const m = String(text || '').match(/Policy\s*Number\s*:\s*([0-9]{6,})/i);
      return m ? m[1] : '';
    }
    function extractPolicyNumberLoose(text) {
      const matches = String(text || '').match(/\b([0-9]{6,})\b/g);
      if (!matches || !matches.length) return '';
      return String(matches[matches.length - 1] || '').replace(/[^\d]/g, '');
    }
    function getTicketRoot() {
      return qs(CFG.sel.ticketRoot);
    }
    function getPolicyTextNow() {
      const root = getTicketRoot();
      return (root && (root.textContent || '')) || '';
    }
    function getCurrentTicketTextLower() {
      const root = getTicketRoot();
      return norm(root?.textContent || '').toLowerCase();
    }
    function isCurrentTicketMarkedCancelOnAz() {
      const txt = getCurrentTicketTextLower();
      if (!txt) return false;
      return CFG.azCancelGuard.markers.some((m) => txt.includes(m));
    }
    function uniqueEls(list) {
      const out = [];
      const seen = new Set();
      for (const el of list || []) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        out.push(el);
      }
      return out;
    }
    function getNodeLabelText(el) {
      return norm(el?.getAttribute?.('title') || el?.getAttribute?.('aria-label') || el?.textContent || '');
    }
    function buildPolicyCandidate(raw, source, prevPolicy, allowPrevious) {
      const policy = extractPolicyNumberLoose(raw);
      if (!policy) return null;
      if (!allowPrevious && prevPolicy && policy === prevPolicy) return null;
      return { policy, source, raw: norm(raw).slice(0, 120) };
    }
    function collectRelatedPolicyButtons(root) {
      if (!root) return [];

      const found = [];
      const pushFound = (els) => {
        for (const el of els || []) if (el && isVisible(el)) found.push(el);
      };

      const queryButtons = (node) => {
        if (!node?.querySelectorAll) return [];
        const els = [];
        for (const sel of CFG.sel.relatedPolicyButtons) els.push(...qsa(sel, node));
        return els.filter(isVisible);
      };

      const labels = qsa('label,.control-label,.field-label,strong,span,div,p,h3,h4', root).filter((el) => {
        const txt = norm(el.textContent || '');
        return !!txt && /related policies/i.test(txt);
      });

      for (const label of labels) {
        const containers = [
          label.closest('.form-group, .field, .row, .col, .card, .panel, .section, .tab-pane'),
          label.parentElement,
          label.parentElement?.parentElement,
          label.nextElementSibling,
          label.parentElement?.nextElementSibling,
        ].filter(Boolean);

        for (const container of containers) pushFound(queryButtons(container));
      }

      if (found.length) return uniqueEls(found);
      return uniqueEls(queryButtons(root));
    }
    function findMainTabControl(root) {
      if (!root) return null;

      const candidates = [];
      for (const sel of CFG.sel.mainTabCandidates) candidates.push(...qsa(sel, root));

      return uniqueEls(candidates).find((el) => {
        if (!isVisible(el)) return false;
        const txt = getNodeLabelText(el).toLowerCase();
        if (!txt) return false;
        return txt === 'main' || txt.startsWith('main ') || txt.includes(' main ') || txt.endsWith(' main');
      }) || null;
    }
    async function ensureMainTabOpen(opts = {}) {
      const { forceClick = false } = opts;
      const root = getTicketRoot();
      if (!root) return false;

      const mainTab = findMainTabControl(root);
      if (!mainTab) {
        uiLog('[AZ] Policy search: Main tab control not found');
        return false;
      }

      const selected = String(mainTab.getAttribute('aria-selected') || '').toLowerCase() === 'true';
      const active = /\bactive\b|\bselected\b/i.test(String(mainTab.className || ''));
      if ((selected || active) && !forceClick) return true;

      uiLog(`[AZ] Policy search: ${forceClick ? 'clicking' : 'opening'} Main tab via "${getNodeLabelText(mainTab) || 'Main'}"`);
      humanClick(mainTab);
      await sleep(CFG.wait.mainTabSettleMs);
      return true;
    }
    function findCurrentPolicyCandidate(prevPolicy = '', { allowPrevious = true } = {}) {
      const root = getTicketRoot();
      if (!root) return null;

      const buttons = collectRelatedPolicyButtons(root);
      for (const btn of buttons) {
        const raw = getNodeLabelText(btn);
        if (!raw) continue;

        const source = /related policies/i.test(String(btn.closest?.('.form-group, .field, .row, .col, .card, .panel, .section, .tab-pane')?.textContent || ''))
          ? 'related_policies_button'
          : 'policy_combobox_button';
        const candidate = buildPolicyCandidate(raw, source, prevPolicy, allowPrevious);
        if (candidate) return candidate;
      }

      const policyText = getPolicyTextNow();
      const fromText = buildPolicyCandidate(policyText.match(/Policy\s*Number\s*:\s*[0-9]{6,}/i)?.[0] || '', 'ticket_text', prevPolicy, allowPrevious);
      if (fromText) return fromText;

      return null;
    }
    function getCurrentPolicyNumber() {
      return findCurrentPolicyCandidate('', { allowPrevious: true })?.policy || '';
    }

    function makeGateResult(action, policy = '') {
      return { action, policy: cleanPolicy(policy || '') };
    }

    function getGateAction(result) {
      return typeof result === 'string' ? result : String(result?.action || '');
    }

    function getGatePolicy(result) {
      return cleanPolicy(typeof result === 'string' ? '' : (result?.policy || ''));
    }

    function snapshotPolicyForNewTicketGate(prevPolicy = '') {
      const candidate = findCurrentPolicyCandidate(prevPolicy || '', { allowPrevious: true });
      if (candidate?.policy) {
        uiLog(`[AZ] LEX handoff copy: snapshot policy=${candidate.policy} via ${candidate.source}`);
        return candidate.policy;
      }

      const root = getTicketRoot();
      const btnCount = collectRelatedPolicyButtons(root).length;
      uiLog(`[AZ] LEX handoff copy: no policy snapshot before copy wait (buttons=${btnCount}, textChars=${(getPolicyTextNow() || '').length})`);
      return '';
    }

    async function useGatePolicySnapshot(policy, logLabel, copyToClipboard) {
      const pn = cleanPolicy(policy || '');
      if (!pn) return '';
      if (copyToClipboard) {
        const ok = await writeClipboardText(pn);
        if (!ok) window.prompt('Copy Policy Number:', pn);
      }
      toast(`${copyToClipboard ? 'Copied' : 'Found'} Policy #: ${pn}`, 2200);
      uiLog(`[AZ] ${logLabel}: using LEX handoff policy snapshot ${pn} -> send to LEX/Apex`);
      return pn;
    }

    async function writeClipboardText(text) {
      try {
        if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(String(text ?? '')); return true; }
      } catch {}
      return false;
    }

    async function copyPolicyFromCurrentTicketWait(prevPolicy, opts = {}) {
      const {
        silent = false,
        copyToClipboard = true,
        logLabel = 'Policy search',
        allowPrevious = false,
      } = opts;

      await sleep(CFG.wait.beforeCopyNewPolicyMs);
      await sleep(CFG.wait.settleDelayMs);

      const passes = Math.max(1, Number(CFG.wait.policySearchPasses) || 1);
      const passTimeoutMs = Math.max(1200, Number(CFG.wait.policyPassTimeoutMs) || CFG.wait.policyWatchMs);
      uiLog(`[AZ] ${logLabel}: copy search start prev=${prevPolicy || '(none)'} allowPrevious=${allowPrevious ? 'yes' : 'no'} copy=${copyToClipboard ? 'yes' : 'no'}`);

      for (let pass = 1; pass <= passes; pass++) {
        if (stopRequested) return '';

        const root = getTicketRoot();
        const btnCount = collectRelatedPolicyButtons(root).length;
        const textChars = (getPolicyTextNow() || '').length;
        uiLog(`[AZ] ${logLabel}: pass ${pass}/${passes} (policyButtons=${btnCount}, textChars=${textChars})`);
        await ensureMainTabOpen();

        const deadline = Date.now() + Math.min(passTimeoutMs, CFG.wait.policyWatchMs);
        while (!stopRequested && Date.now() < deadline) {
          const candidate = findCurrentPolicyCandidate(prevPolicy, { allowPrevious });
          if (candidate?.policy) {
            if (!await verifyPrimaryCsrOrStop(`${logLabel}: before using policy ${candidate.policy}`)) return '';
            if (copyToClipboard) {
              const ok = await writeClipboardText(candidate.policy);
              if (!ok) window.prompt('Copy Policy Number:', candidate.policy);
            }
            if (!silent) toast(`${copyToClipboard ? 'Copied' : 'Found'} Policy #: ${candidate.policy}`, 2200);
            uiLog(`[AZ] ${logLabel}: found ${candidate.policy} via ${candidate.source}`);
            return candidate.policy;
          }
          await sleep(CFG.wait.pollMs);
        }

        await sleep(CFG.wait.settleDelayMs);
      }

      if (!silent) toast('Policy # not found after a thorough search.', 4500);
      uiLog(`[AZ] ${logLabel}: no policy found after ${passes} passes (Prev=${prevPolicy || '(none)'})`);
      return '';
    }

    async function openFirstReviewTicketAndCopyPolicy(prevPolicy, opts = {}) {
      const {
        logLabel = 'Policy search',
        copyToClipboard = true,
        allowPrevious = false,
      } = opts;

      uiLog('[AZ] Open: Find Review lane…');
      const reviewBody = findReviewLaneBody();
      if (!reviewBody) {
        uiLog('[AZ] Review lane not found');
        toast(PIPE03 ? '03: Review lane not set. Click "Set Review Lane (03)".' : 'Review lane not found.', 5200);
        return '';
      }

      const firstLink = [
        ...qsa(':scope > .dd-card a.customer, .dd-card a.customer, :scope > .dd-card a, .dd-card a', reviewBody),
      ].find(isVisible);

      if (!firstLink) { uiLog('[AZ] No tickets found in Review lane'); toast('No tickets in Review lane.', 5000); return ''; }

      uiLog('[AZ] Open: 1st Review ticket…');
      humanClick(firstLink);

      const openedOk = await waitForCondition(() => {
        const pn = getCurrentPolicyNumber();
        const resBtn = qs(CFG.sel.openResolution) || qs(CFG.sel.openResolutionFallback);
        return !!resBtn || !!pn;
      }, CFG.wait.openTicketTimeoutMs, 'ticket opened');

      if (!openedOk) { uiLog('[AZ] Ticket did not open in time'); toast('Ticket did not open.', 6000); return ''; }

      await majorDelay('after ticket opened');
      const handoffResult = await prepareFirstTicketForLexHandoff(prevPolicy || '');
      if (getGateAction(handoffResult) === 'stop') return '';

      const gatePolicy = getGatePolicy(handoffResult);
      if (gatePolicy) return await useGatePolicySnapshot(gatePolicy, logLabel, copyToClipboard);

      await ensureMainTabOpen();
      if (!await ensurePrimaryCsr()) return '';
      return await copyPolicyFromCurrentTicketWait(prevPolicy || '', { logLabel, copyToClipboard, allowPrevious });
    }

    async function openTicketThenClickMainAndCopyPolicy(prevPolicy = '', logLabel = 'Startup policy search') {
      if (!isTicketPanelOpen()) {
        uiLog('[AZ] First step: open the first Review ticket');
        return await openFirstReviewTicketAndCopyPolicy(prevPolicy, { logLabel, copyToClipboard: false });
      }

      uiLog('[AZ] First step: ticket is already open -> prepare LEX/Apex handoff');
      const handoffResult = await prepareFirstTicketForLexHandoff(prevPolicy || '');
      if (getGateAction(handoffResult) === 'stop') return '';

      uiLog('[AZ] First step: ticket is already open → click Main');
      await ensureMainTabOpen();
      if (!await ensurePrimaryCsr()) return '';
      const gatePolicy = getGatePolicy(handoffResult);
      if (gatePolicy) return await useGatePolicySnapshot(gatePolicy, logLabel, false);
      return await copyPolicyFromCurrentTicketWait(prevPolicy, {
        copyToClipboard: false,
        logLabel,
        allowPrevious: true,
      });
    }

    async function closeTicketIfOpen() {
      if (!isTicketPanelOpen()) return true;

      uiLog('[AZ] Advance: Close ticket…');
      await sleep(CFG.wait.beforeCloseMs);
      await waitModalClosed();

      const { el: closeBtn, sel } = getCloseEl();
      if (!closeBtn) { uiLog('[AZ] Close button not found'); toast('Close button not found.', 6000); return false; }

      uiLog(`[AZ] Close click using: ${sel}`);
      humanClick(closeBtn);
      await majorDelay('after close click');

      const closedOk = await waitForCondition(() => !isTicketPanelOpen(), CFG.wait.panelCloseTimeoutMs, 'panel closed');
      if (!closedOk) {
        uiLog('[AZ] Panel did NOT close → ESC + retry');
        dispatchKeyEscape();
        await sleep(250);
        const { el: closeBtn2 } = getCloseEl();
        if (closeBtn2) humanClick(closeBtn2);
        const closedOk2 = await waitForCondition(() => !isTicketPanelOpen(), 8000, 'panel closed after retry');
        if (!closedOk2) { toast('Ticket did not close.', 8000); return false; }
      }

      uiLog(`[AZ] Pause ${CFG.afterCloseBeforeOpenNextMs}ms after close before opening next…`);
      await sleep(CFG.afterCloseBeforeOpenNextMs);
      return true;
    }

    async function closeTicketAndOpenFirstReview(prevPolicy, opts = {}) {
      const okClose = await closeTicketIfOpen();
      if (!okClose) return '';
      return await openFirstReviewTicketAndCopyPolicy(prevPolicy, opts);
    }

    // --------- premium paste ---------
    function setNativeValue(el, value) {
      const v = String(value ?? '');
      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        desc?.set ? desc.set.call(el, v) : (el.value = v);
      } catch { try { el.value = v; } catch {} }
    }
    function sanitizeToNumberText(raw) {
      const s = String(raw ?? '').trim();
      const m = s.match(/-?\d[\d,]*(?:\.\d+)?/);
      return m ? m[0].replace(/,/g, '') : '';
    }
    async function hardPastePremiumFromText(textRaw) {
      const numText = sanitizeToNumberText(textRaw);
      if (!numText) return false;

      uiLog(`[AZ] Premium pasted: ${numText}`);

      const el = await waitFor(CFG.sel.premiumBox, 6000);
      if (!el) return false;
      try { el.focus(); } catch {}
      await sleep(60);

      setNativeValue(el, numText);
      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch {}

      await sleep(140);
      try { el.blur?.(); } catch {}
      return true;
    }

    // --------- flows ---------
    async function runRenewFlowWithPremium(premiumText) {
      if (running) return '';
      running = true;
      try {
        for (let attempt = 1; attempt <= (1 + CFG.overallRetries); attempt++) {
          if (stopRequested) break;

          const prevPolicy = getCurrentPolicyNumber();
          await ensureMainTabOpen();
          if (!await ensurePrimaryCsr()) return '';
          if (!await verifyPrimaryCsrOrStop('before ACTIVE Complete click')) return '';

          const okRes = await clickAny([CFG.sel.openResolution, CFG.sel.openResolutionFallback]);
          if (!okRes) continue;
          uiLog(`[AZ] Pause ${CFG.afterCompleteClickMs}ms after Complete click…`);
          await sleep(CFG.afterCompleteClickMs);

          if (!await selectResolutionType('completed')) return '';

          const renewSelected = await selectResolutionAction('renew', { stopOnFail: false });
          if (renewSelected) {
            const okPaste = await hardPastePremiumFromText(premiumText);
            if (!okPaste) {
              uiLog('[AZ] Renew selected, but premium box missing/unusable → skip premium and continue to Confirm');
              toast('Premium box missing. Confirming as Completed only.', 2600);
            }
          } else {
            uiLog('[AZ] Renew action missing → skip Renew and premium; confirm Completed only');
            toast('Renew option missing. Confirming as Completed only.', 2600);
          }

          const okConfirm = await clickConfirmAndWait('RENEW');
          if (!okConfirm) continue;

          await majorDelay('after confirm success');
          reloadAzOnly('renew flow completed');
          return '';
        }
        return '';
      } finally { running = false; }
    }

    async function runCancelFlow() {
      if (running) return '';
      running = true;
      try {
        for (let attempt = 1; attempt <= (1 + CFG.overallRetries); attempt++) {
          if (stopRequested) break;

          const prevPolicy = getCurrentPolicyNumber();
          await ensureMainTabOpen();
          if (!await ensurePrimaryCsr()) return '';
          if (!await verifyPrimaryCsrOrStop('before CANCEL Complete click')) return '';

          const okRes = await clickAny([CFG.sel.openResolution, CFG.sel.openResolutionFallback]);
          if (!okRes) continue;
          uiLog(`[AZ] Pause ${CFG.afterCompleteClickMs}ms after Complete click…`);
          await sleep(CFG.afterCompleteClickMs);

          if (!await selectResolutionType('cancelled')) return '';
          const cancelActionSelected = await selectResolutionAction('cancel', { stopOnFail: false });
          if (!cancelActionSelected) {
            uiLog('[AZ] Cancel action dropdown missing/optional after Cancelled selected -> continue to Confirm');
            toast('Cancel action dropdown missing. Continuing to Confirm.', 2600);
          }

          const okConfirm = await clickConfirmAndWait('CANCEL');
          if (!okConfirm) continue;

          await majorDelay('after confirm success');
          reloadAzOnly('cancel flow completed');
return '';
        }
        return '';
      } finally { running = false; }
    }

    async function runCompleteFlow() {
      if (running) return '';
      running = true;
      try {
        for (let attempt = 1; attempt <= (1 + CFG.overallRetries); attempt++) {
          if (stopRequested) break;

          const prevPolicy = getCurrentPolicyNumber();
          if (!await prepareAzTicketForResolution('before COMPLETE click')) return '';

          const okRes = await clickAny([CFG.sel.openResolution, CFG.sel.openResolutionFallback]);
          if (!okRes) continue;
          uiLog(`[AZ] Pause ${CFG.afterCompleteClickMs}ms after Complete click…`);
          await sleep(CFG.afterCompleteClickMs);

          if (!await confirmOpenedCompletedResolution('COMPLETE')) continue;
          reloadAzOnly('complete flow completed');
return '';
        }
        return '';
      } finally { running = false; }
    }

    // ==========================================
    // RECOVERY: reload BOTH forever. Never delete tickets and never auto-stop.
    // ==========================================
    function getRecoverState() {
      try { return safeJsonParse(localStorage.getItem(LS.RECOV) || ''); } catch { return null; }
    }
    function setRecoverState(o) {
      try { localStorage.setItem(LS.RECOV, JSON.stringify(o || {})); } catch {}
    }

    async function fatalRecover(reason, policyKey, detail) {
      if (!loopOn || stopRequested) return;
      if (reloading) return;

      const key = `${String(reason || 'UNKNOWN')}|${String(policyKey || '')}`;
      const st = getRecoverState();
      const now = Date.now();
      const same = st && st.key === key && (now - (st.ts || 0) < 10 * 60 * 1000);
      const count = same ? (st.count || 0) + 1 : 1;

      setRecoverState({ key, count, ts: now });

      const reloadReason = `${reason}${detail ? `: ${String(detail).slice(0, 160)}` : ''} (recover#${count})`;
      uiLog(`[AZ] RECOVER #${count} → RELOAD BOTH, keep loop ON (reason=${reason}) ${detail ? `detail=${detail}` : ''}`);
      toast(`Recover: reload BOTH and keep running\n${reason}`, 2500);
      reloadBoth(reloadReason);
    }

    // ===== 03-only reload fuse =====
    function reloadFuse03Trip(now) {
      if (!PIPE03) return false;
      const win = CFG.review03.reloadFuseWindowMs;
      const max = CFG.review03.reloadFuseMax;

      let arr = [];
      try { arr = safeJsonParse(localStorage.getItem(LS.RELOAD_GUARD_03) || '[]') || []; } catch { arr = []; }
      arr = arr.filter((t) => typeof t === 'number' && (now - t) < win);
      arr.push(now);
      try { localStorage.setItem(LS.RELOAD_GUARD_03, JSON.stringify(arr)); } catch {}

      if (arr.length > max) {
        uiLog(`[AZ] 03: Reload fuse tripped (${arr.length} reloads in ${Math.round(win/1000)}s). Pausing loop.`);
        toast('03: too many reloads. Loop paused so you can inspect the ticket.', 5000);
        stopLoop('03 reload fuse');
        return true;
      }
      return false;
    }

    function cleanReloadReason(reason) {
      return String(reason || 'reload').replace(/\s*\[(confirmed|delayed)\]\s*$/i, '').trim() || 'reload';
    }

    function reloadNeedsUserConfirm(reason) {
      const text = String(reason || '');
      if (/\[(confirmed|delayed)\]\s*$/i.test(text)) return false;
      return /(not[\s_-]*found|no\s+policy|missing\s+policy|bad\/missing\s+policy|status\s+not\s+found|customer\s+link\s+not\s+found|policy\s+scope|account[_\s-]*copy|scope\s+within)/i.test(text);
    }

    function scheduleConfirmedReload(reason) {
      if (reloadConfirming || reloading || !loopOn || stopRequested) return;
      reloadConfirming = true;

      const displayReason = cleanReloadReason(reason);
      toast(`Reload needed: ${displayReason}\nReloading in 5s`, 6200);
      uiLog(`[AZ] Reload delayed 5s: ${displayReason}`);

      setTimeout(() => {
        reloadConfirming = false;
        if (!loopOn || stopRequested || reloading) return;
        reloadBoth(`${displayReason} [delayed]`);
      }, 5000);
    }

    function reloadBoth(reason) {
      if (!loopOn || stopRequested) return;
      if (reloading) return;
      if (reloadNeedsUserConfirm(reason)) {
        scheduleConfirmedReload(reason);
        return;
      }

      const now = Date.now();

      // 03-only: log frequent reloads, but keep the loop running
      if (reloadFuse03Trip(now)) return;

      if (now - lastReloadTs < 5000) {
        uiLog('[AZ] Reload throttle hit → delaying 2s');
        setTimeout(() => reloadBoth(reason), 2000);
        return;
      }

      reloading = true;
      lastReloadTs = now;

      busSendToLex({ type: 'CMD', cmd: 'RELOAD', reason: String(reason || 'reload'), from: 'AZ', ts: now });

      try { localStorage.setItem(LS.RESUME, JSON.stringify({ ts: now, reason: String(reason || ''), from: 'AZ' })); } catch {}

      uiLog(`[AZ] RELOAD BOTH → reason=${reason}`);
      toast(`Reloading BOTH…\n${reason}`, 1800);

      if (resendTimer) clearInterval(resendTimer);
      resendTimer = null;

      setTimeout(() => { try { location.reload(); } catch {} }, 650);
    }

function reloadAzOnly(reason) {
  if (!loopOn || stopRequested) return;
  if (reloading) return;

  const now = Date.now();
  reloading = true;
  lastReloadTs = now;

  try {
    localStorage.setItem(LS.RESUME, JSON.stringify({
      ts: now,
      reason: String(reason || ''),
      from: 'AZ_ONLY',
    }));
  } catch {}

  uiLog(`[AZ] REFRESH AZ ONLY → reason=${reason}`);
  toast(`Refreshing AgencyZoom only...\n${reason}`, 1800);

  if (resendTimer) clearInterval(resendTimer);
  resendTimer = null;
  pending = null;
  currentLexJob = null;
  lexDecisionPending = false;
  refreshUI();

  setTimeout(() => {
    try { location.reload(); } catch {}
  }, 650);
}

    // ==========================================
    // LOCAL BUS: send policy + ack/resend + receive results
    // ==========================================
    function stopResender() {
      if (resendTimer) clearInterval(resendTimer);
      resendTimer = null;
      resendAttempt = 0;
      pending = null;
      refreshUI();
    }

    function rememberProcessedResult(refId) {
      const id = String(refId || '').trim();
      if (!id) return;
      processedResultRefIds.add(id);
      if (processedResultRefIds.size <= 40) return;
      const first = processedResultRefIds.values().next().value;
      if (first) processedResultRefIds.delete(first);
    }

    function shouldAcceptLexResult(msg, policy) {
      const refId = String(msg?.refId || '').trim();
      const pn = cleanPolicy(policy || '');

      if (refId && processedResultRefIds.has(refId)) {
        uiLog(`[AZ] Ignore duplicate LEX result refId=${refId}`);
        return false;
      }

      if (currentLexJob?.refId) {
        if (refId && refId !== currentLexJob.refId) {
          uiLog(`[AZ] Ignore stale LEX result refId=${refId}; waiting for refId=${currentLexJob.refId}`);
          return false;
        }
        if (pn && currentLexJob.policy && pn !== currentLexJob.policy) {
          uiLog(`[AZ] Ignore LEX result policy mismatch ${pn}; waiting for ${currentLexJob.policy}`);
          return false;
        }
        return true;
      }

      if (refId) {
        uiLog(`[AZ] Ignore LEX result with no active AZ job refId=${refId}`);
        rememberProcessedResult(refId);
        return false;
      }

      return !!(pn && lastPolicySent && pn === lastPolicySent);
    }

    function pushPendingOnce() {
      if (!loopOn || stopRequested) return;
      if (!pending) return;

      resendAttempt++;
      uiLog(`[AZ] Push LOCAL -> AZ_TO_LEX policy=${pending.policy} refId=${pending.refId} attempt=${resendAttempt}`);
      busSendToLex({ type: 'POLICY', policy: pending.policy, refId: pending.refId, from: 'AZ', ts: Date.now() });

      if (resendAttempt >= CFG.bus.maxNoAckResends) {
        uiLog(`[AZ] Still waiting for LEX ACK after ${resendAttempt} sends. Keeping loop alive; no reload.`);
        toast('Waiting for LEX to receive policy. No reload.', 3200);
        resendAttempt = 0;
      }
    }

    function startResender() {
      if (resendTimer) clearInterval(resendTimer);
      resendTimer = setInterval(() => {
        try {
          if (!loopOn || stopRequested) return;
          if (!pending) return;
          pushPendingOnce();
        } catch {}
      }, CFG.bus.resendEveryMs);
    }

    async function sendPolicyToLex(policy, reason) {
      const pn = cleanPolicy(policy);
      if (!pn || !isLikelyPolicy(pn)) {
        uiLog(`[AZ] sendPolicyToLex refused (bad policy): "${policy}"`);
        const recoveredPolicy = await copyPolicyFromCurrentTicketWait(lastPolicySent || '', {
          silent: false,
          copyToClipboard: false,
          logLabel: 'Bad policy re-check',
          allowPrevious: true,
        });
        if (recoveredPolicy) {
          uiLog(`[AZ] Bad policy recovered via AZ re-check: ${recoveredPolicy}`);
          await sendPolicyToLex(recoveredPolicy, `${reason || 'send'}_recovered`);
          return;
        }

        toast('Bad or missing policy number. Reloading both and retrying. No ticket was deleted.', 4000);
        uiLog('[AZ] Bad policy after thorough AZ search → reload BOTH, keep loop ON (no delete)');
        reloadBoth('bad/missing policy');
        return;
      }

      await ensureMainTabOpen();
      if (!await verifyPrimaryCsrOrStop(`before sending policy ${pn} to LEX`)) return;

      lastPolicySent = pn;
      lexDecisionPending = false;
      const refId = makeRefId();
      pending = { policy: pn, refId, reason: String(reason || 'send') };
      currentLexJob = { ...pending, sentAt: Date.now() };
      resendAttempt = 0;

      toast(`Sent Policy -> LEX: ${pn}`, 1500);
      uiLog(`[AZ] Queue send -> LEX policy=${pn} reason=${pending.reason}`);
      refreshUI();

      pushPendingOnce();
      startResender();
    }

    async function handleLexMsg(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (String(msg.from || '').toUpperCase() === 'AZ') return;

      const type = String(msg.type || '').toUpperCase();

      if (type === 'ACK') {
        const refId = String(msg.refId || '');
        if (pending && refId && refId === pending.refId) {
          uiLog(`[AZ] Got ACK from LEX ✅ refId=${refId} (stop resends)`);
          stopResender();
        }
        return;
      }

      if (type === 'CMD') {
        const cmd = String(msg.cmd || '').toUpperCase();
        if (cmd === 'RELOAD') {
          uiLog(`[AZ] CMD from LEX: RELOAD (reason=${msg.reason || ''})`);
          reloadBoth(`LEX requested reload: ${msg.reason || 'unknown'}`);
        }
        if (cmd === 'DECISION_NEEDED') {
          lexDecisionPending = true;
          markProgress();
          toast(`LEX needs a decision for policy ${cleanPolicy(msg.policy || '') || 'unknown'}`, 4200);
          uiLog(`[AZ] LEX decision needed: policy=${cleanPolicy(msg.policy || '') || 'n/a'} reason=${msg.reason || ''}`);
          refreshUI();
        }
        return;
      }

      if (type !== 'RESULT') return;

      const status = String(msg.status || '').toUpperCase();
      const policy = cleanPolicy(msg.policy || '') || cleanPolicy(lastPolicySent || '') || cleanPolicy(getCurrentPolicyNumber() || '');
      uiLog(`[AZ] Got RESULT from LEX: ${status} (policy=${policy || 'n/a'})`);

      if (!loopOn || stopRequested || reloading) return;
      if (!shouldAcceptLexResult(msg, policy)) return;

      lexDecisionPending = false;
      if (pending) stopResender();
      rememberProcessedResult(msg.refId);
      currentLexJob = null;
      refreshUI();

      if (status === 'ERROR') {
        void fatalRecover('LEX_ERROR', policy, String(msg.reason || 'unknown'));
        return;
      }

      if (status === 'NOT_FOUND') {
        const key = policy || lastPolicySent || '';
        if (!key) {
          void fatalRecover('NOT_FOUND_NO_KEY', '', 'NOT_FOUND without policy');
          return;
        }

        const nfKey = `__nf_${key}`;
        const prev = Number(sessionStorage.getItem(nfKey) || '0');
        const next = prev + 1;
        sessionStorage.setItem(nfKey, String(next));

        if (next <= 2) {
          toast(`LEX NOT_FOUND → restart ${next}/2`, 2200);
          uiLog(`[AZ] NOT_FOUND restart ${next}/2 → resend policy=${key}`);
          await majorDelay('before NOT_FOUND resend');
          await sendPolicyToLex(key, `NOT_FOUND_retry_${next}`);
          return;
        }

        sessionStorage.removeItem(nfKey);
        toast('LEX NOT_FOUND 3x - reload confirmation required', 4200);
        uiLog('[AZ] NOT_FOUND 3x - reload BOTH requested; confirmation gate will handle it');
        reloadBoth('LEX NOT_FOUND x3');
        return;
      }

      if (status === 'ACTIVE') {
        const premium = String(msg.premium || '').trim();
        if (!premium) {
          void fatalRecover('ACTIVE_EMPTY_PREMIUM', policy, 'LEX returned ACTIVE but premium empty');
          return;
        }
        toast(`LEX: ACTIVE → Renew\nPremium: ${premium}`, 2600);
        uiLog(`[AZ] LEX premium: ${premium}`);

        const newPolicy = await runRenewFlowWithPremium(premium);
        if (!loopOn || stopRequested || reloading) return;

        if (!newPolicy) {
          uiLog('[AZ] Advance failed → retry 2x then reload, keep loop ON');
          const recovered = await recoverAdvanceOrReload(policy || lastPolicySent || '');
          if (!recovered) {
            void fatalRecover('ADVANCE_FAILED_AFTER_RECOVER', policy, 'advance still failing');
            return;
          }
          await sendPolicyToLex(recovered, 'advance_recovered');
          return;
        }

        await sendPolicyToLex(newPolicy, 'after_renew');
        return;
      }

      if (status === 'COMPLETE') {
        toast('LEX: manual COMPLETE → Complete flow', 2200);
        const newPolicy = await runCompleteFlow();
        if (!loopOn || stopRequested || reloading) return;

        if (!newPolicy) {
          uiLog('[AZ] Advance failed after manual COMPLETE → retry 2x then reload, keep loop ON');
          const recovered = await recoverAdvanceOrReload(policy || lastPolicySent || '');
          if (!recovered) {
            void fatalRecover('ADVANCE_FAILED_AFTER_RECOVER', policy, 'advance still failing');
            return;
          }
          await sendPolicyToLex(recovered, 'advance_recovered');
          return;
        }

        await sendPolicyToLex(newPolicy, 'after_manual_complete');
        return;
      }

      if (status === 'CANCELLED') {
        if (!msg.manualDecision && !isCurrentTicketMarkedCancelOnAz()) {
          const azPolicy = cleanPolicy(getCurrentPolicyNumber() || '');
          toast('LEX says CANCELLED, but AZ ticket is not marked cancel. Reloading both and retrying.', 4200);
          uiLog(`[AZ] Cancel guard: LEX policy=${policy || 'n/a'}, AZ policy=${azPolicy || 'n/a'}, no cancel marker found on AZ ticket -> reload BOTH`);
          reloadBoth('LEX cancelled but AZ not marked cancel');
          return;
        }

        toast('LEX: CANCELLED → Cancel flow', 2200);
        const newPolicy = await runCancelFlow();
        if (!loopOn || stopRequested || reloading) return;

        if (!newPolicy) {
          uiLog('[AZ] Advance failed → retry 2x then reload, keep loop ON');
          const recovered = await recoverAdvanceOrReload(policy || lastPolicySent || '');
          if (!recovered) {
            void fatalRecover('ADVANCE_FAILED_AFTER_RECOVER', policy, 'advance still failing');
            return;
          }
          await sendPolicyToLex(recovered, 'advance_recovered');
          return;
        }

        await sendPolicyToLex(newPolicy, 'after_cancel');
        return;
      }

      void fatalRecover('UNKNOWN_LEX_STATUS', policy, `status=${status}`);
    }

    async function recoverAdvanceOrReload(prevPolicyGuess) {
      for (let i = 1; i <= CFG.advanceFailRetries; i++) {
        if (!loopOn || stopRequested) return '';
        toast(`Advance failed → retry ${i}/${CFG.advanceFailRetries}`, 1600);
        uiLog(`[AZ] Advance retry ${i}/${CFG.advanceFailRetries}…`);
        await majorDelay(`before advance retry ${i}`);
        const np = await closeTicketAndOpenFirstReview(prevPolicyGuess || lastPolicySent || '');
        if (np) return np;
      }

      toast('Advance failed after retries. Reloading both and retrying. No ticket was deleted.', 3500);
      uiLog('[AZ] Advance failed after retries → reload BOTH, keep loop ON (no delete)');
      reloadBoth('advance failed after retries');
      return '';
    }

    // --------- Watchdog auto-reload (BOTH) ---------
    function startWatchdog() {
      if (!CFG.watchdog.enabled) return;
      if (watchdogTimer) return;

      watchdogTimer = setInterval(() => {
        try {
          if (!loopOn || stopRequested) return;
          if (lexDecisionPending) return;
          const idle = Date.now() - lastProgressTs;
          if (idle < CFG.watchdog.noProgressMs) return;

          uiLog('[AZ] Watchdog: no progress 60s → reload BOTH');
          reloadBoth('watchdog: no progress 60s');
        } catch {}
      }, CFG.watchdog.checkEveryMs);
    }

    // --------- Start/Stop + resume ---------
    function saveLoopOn() {
  // Do not persist STOP. Reload should always resume running.
  localStorage.setItem(LS.LOOP_ON, '1');
}

    async function resumeIfNeeded() {
      if (autoResumeStarted) return;
      autoResumeStarted = true;

      let raw = '';
      try { raw = localStorage.getItem(LS.RESUME) || ''; } catch {}

      if (raw) {
        try { localStorage.removeItem(LS.RESUME); } catch {}
        uiLog(`[AZ] Resume after reload (${safeJsonParse(raw)?.reason || 'unknown'})`);
      } else {
        uiLog('[AZ] Auto-resume after reload (loop was ON)');
      }

      stopRequested = false;
      loopOn = true;
      saveLoopOn();
      startWatchdog();
      refreshUI();

      let pn = await openTicketThenClickMainAndCopyPolicy('', 'Resume: open ticket then Main');
      if (reloading || stopRequested || !loopOn) return;
      if (!pn) {
        await closeTicketIfOpen();
        if (reloading || stopRequested || !loopOn) return;
        pn = await openFirstReviewTicketAndCopyPolicy('', { logLabel: 'Resume: reopen ticket then Main', copyToClipboard: false });
      }
      if (reloading || stopRequested || !loopOn) return;

      if (!pn) {
        toast('Resume: no policy found after opening ticket and Main. Reloading both and retrying. No ticket was deleted.', 4500);
        uiLog('[AZ] Resume: no policy after open ticket → Main → reload BOTH (no delete)');
        reloadBoth('resume no policy');
        return;
      }

      uiLog(`[AZ] Resume: send policy ${pn}`);
      await sleep(CFG.startSendHoldMs);
      await sendPolicyToLex(pn, raw ? 'resume' : 'auto_resume_after_reload');
    }

    async function startLoop() {
      if (!armed) { toast('Not armed (wrong pipeline)'); return; }

      stopRequested = false;
      loopOn = true;
      saveLoopOn();
      startWatchdog();
      refreshUI();

      let pn = await openTicketThenClickMainAndCopyPolicy('', 'Startup: open ticket then Main');
      if (reloading || stopRequested || !loopOn) return;

      if (!pn) {
        toast('No Policy # found after opening ticket and Main. Reloading both and retrying. No ticket was deleted.', 4500);
        uiLog('[AZ] No policy after open ticket → Main → search → reload BOTH (no delete)');
        reloadBoth('start no policy');
        return;
      }

      uiLog(`[AZ] Startup hold ${CFG.startSendHoldMs}ms before first send…`);
      await sleep(CFG.startSendHoldMs);
      await sendPolicyToLex(pn, 'startLoop');
    }

    function stopLoop(reason) {
      stopRequested = true;
      loopOn = false;
      busSendToLex({ type: 'CMD', cmd: 'STOP', reason: String(reason || 'stop'), from: 'AZ', ts: Date.now() });

      if (watchdogTimer) clearInterval(watchdogTimer);
      watchdogTimer = null;

      if (resendTimer) clearInterval(resendTimer);
      resendTimer = null;
      pending = null;
      currentLexJob = null;
      lexDecisionPending = false;
      resendAttempt = 0;

      saveLoopOn();
      toast(`Loop stopped (${reason || 'hotkey'})`, 1700);
      uiLog(`[AZ] Loop stopped (${reason || 'hotkey'})`);
      refreshUI();
    }

    // --------- hotkey ---------
    function onKeyDown(e) {
      if (e.repeat) return;
      const tag = e.target?.tagName?.toLowerCase?.() || '';
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

      if (matchesHotkey(e, CFG.hotkeys.loop)) {
        e.preventDefault(); e.stopPropagation();
        if (!loopOn) startLoop();
        else stopLoop('hotkey');
      }
    }

    // --------- arming ---------
    function getPipelineText() {
      const selectors = [
        '#servicePipelineFilter .pipelineDropdown .dropdown-toggle',
        '#servicePipelineFilter .pipelineDropdown button',
        '#servicePipelineFilter .dropdown-toggle',
        '.dashboard-header h1',
        '.dashboard-header h2',
        'h1',
        'h2',
      ];

      const seen = new Set();
      const candidates = [];
      for (const sel of selectors) {
        for (const el of qsa(sel)) {
          if (!el || seen.has(el)) continue;
          seen.add(el);
          candidates.push(el);
        }
      }

      for (const el of candidates) {
        const t = norm(el.textContent || el.getAttribute?.('title') || el.getAttribute?.('aria-label') || '');
        if (!t) continue;
        const low = t.toLowerCase();
        if (CFG.allowedPipelineMatchers.some(m => low.includes(String(m).toLowerCase()))) return t;
      }
      return '';
    }

    let lexListenerId = null;

    function tryArmOnce() {
      if (armed) return true;
      const pip = getPipelineText();
      if (!pip) return false;

      armed = true;
      PIPE03 = pip.toLowerCase().includes('03. renewals pipeline');
      PIPE4  = pip.toLowerCase().includes('4. personal renewals');

      injectUI();
      window.addEventListener('keydown', onKeyDown, false);
      uiLog(`[AZ] Armed in pipeline: ${pip}`);
      if (PIPE03) {
        const saved = (localStorage.getItem(LS.REVIEW03_STATUS) || '').trim();
        uiLog(`[AZ] 03: Review laneStatus = ${saved || CFG.review03.defaultLaneStatus} (saved=${saved ? 'yes' : 'no'})`);
      }

      try {
        if (lexListenerId) { try { GM_removeValueChangeListener(lexListenerId); } catch {} }
        lexListenerId = GM_addValueChangeListener(BUS_KEYS.LEX_TO_AZ, (_name, _oldV, newV, _remote) => {
          try { handleLexMsg(newV); } catch {}
        });
      } catch {}

      refreshUI();

      if (loopOn) {
        startWatchdog();
        resumeIfNeeded();
      }
      return true;
    }

    window.__AZ_LEX_LOCALBUS__.dispose = () => {
      try { document.removeEventListener('pointerdown', onBlockNext, true); } catch {}
      try { document.removeEventListener('mousedown', onBlockNext, true); } catch {}
      try { document.removeEventListener('click', onBlockNext, true); } catch {}
      try { document.removeEventListener('click', onPickReview03, true); } catch {}
      try { window.removeEventListener('keydown', onKeyDown, false); } catch {}
      try { if (watchdogTimer) clearInterval(watchdogTimer); } catch {}
      try { if (resendTimer) clearInterval(resendTimer); } catch {}
      try { if (lexListenerId) GM_removeValueChangeListener(lexListenerId); } catch {}
    };

    // --------- boot ---------
    setTimeout(tryArmOnce, 2000);
    setTimeout(tryArmOnce, 8000);
    let armTries = 0;
    const armInt = setInterval(() => {
      if (armed) { clearInterval(armInt); return; }
      armTries++;
      tryArmOnce();
      if (armTries >= 6) clearInterval(armInt);
    }, 5000);
  }

  // =========================
  // LEX SIDE
  // =========================
  function bootLEX() {
    // dispose old instance (SPA)
    try { window.__LEX_AZ_LOCALBUS__?.dispose?.(); } catch {}
    window.__LEX_AZ_LOCALBUS__ = { dispose: () => {} };

    const STEP_TIMEOUT_MS = 80000;
    const ACCOUNT_COPY_TIMEOUT_MS = 10000;
    const ACCOUNT_COPY_RELOAD_MAX = 3;
    const ACCOUNT_COPY_DECISION_DELAY_MS = 10000;
    const HTTP_ERROR_RELOAD_KEY = 'tmFarmersHttpErrorReload_LOCALBUS_v1';

    const JOB_KEY = 'tmFarmersPremiumJob_LOCALBUS_v1';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
    const shortWait = () => sleep(rand(160, 600));
    const longWait = () => sleep(rand(650, 1700));

    let lexReloading = false;
let lexStopRequested = false;
let accountPremiumWatchdogTimer = null;

let lastLexProgressTs = Date.now();
let lexInactivityWatchdogTimer = null;

function markLexProgress() {
  lastLexProgressTs = Date.now();
}

function startLexInactivityWatchdog() {
  if (lexInactivityWatchdogTimer) return;

  lexInactivityWatchdogTimer = setInterval(() => {
    try {
      if (lexReloading || lexStopRequested) return;

      const job = getJob();
      if (!job?.policy || job.stopRequested) return;

      const decisionOpen = !!document.querySelector('.tmFarmersPolicyNoFoundBox');
      if (decisionOpen) return;

      const idleMs = Date.now() - lastLexProgressTs;
      if (idleMs < 60000) return;

      const policy = cleanPolicy(job.policy || '');
      const reason = `LEX inactivity ${Math.round(idleMs / 1000)}s`;

      toast(`No LEX progress for ${Math.round(idleMs / 1000)}s. Reloading both.`, 'Watchdog', 'red', 4000);
      log(`${nowStr()} ${reason} -> reload BOTH`);

      busSendToAz({
        type: 'CMD',
        cmd: 'RELOAD',
        policy,
        refId: job.refId || '',
        reason,
        from: 'LEX',
        ts: Date.now(),
      });

      forceReloadLex(reason, 250);
    } catch {}
  }, 5000);
}

    function getJob() { try { return JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null'); } catch { return null; } }
    function setJob(j) { sessionStorage.setItem(JOB_KEY, JSON.stringify(j)); }
    function clearJob() { sessionStorage.removeItem(JOB_KEY); }

    function getHttpErrorReloadState() {
      try { return JSON.parse(sessionStorage.getItem(HTTP_ERROR_RELOAD_KEY) || 'null'); } catch { return null; }
    }
    function setHttpErrorReloadState(st) {
      try { sessionStorage.setItem(HTTP_ERROR_RELOAD_KEY, JSON.stringify(st || {})); } catch {}
    }
    function clearHttpErrorReloadState() {
      try { sessionStorage.removeItem(HTTP_ERROR_RELOAD_KEY); } catch {}
    }

    function forceReloadLex(reason, delayMs = 250) {
      if (lexReloading) return;
      lexReloading = true;

      try { log(`${nowStr()} LEX reload requested: ${reason}`); } catch {}
      try { setStatus(`Reloading: ${reason}`); } catch {}

      setTimeout(() => {
        try { location.reload(); } catch {}
        setTimeout(() => {
          try { location.replace(location.href); } catch {
            try { location.href = location.href; } catch {}
          }
        }, 1200);
      }, delayMs);
    }

    function isLexHttpErrorPage() {
      const txt = norm(document.body?.innerText || document.documentElement?.innerText || '');
      return /HTTP ERROR\s*431/i.test(txt) || /Request Header Fields Too Large/i.test(txt);
    }

    function showLexHttpErrorReloadNotice(message) {
      try {
        const d = document.createElement('div');
        d.textContent = message;
        d.style.cssText = `
          position:fixed;left:12px;bottom:12px;z-index:2147483647;
          background:rgba(18,18,18,.94);color:#fff;border:1px solid rgba(255,255,255,.2);
          border-radius:12px;padding:10px 12px;font:13px system-ui;max-width:520px;white-space:pre-line;`;
        document.documentElement.appendChild(d);
      } catch {}
    }

    function handleLexHttpErrorPage() {
      if (!isLexHttpErrorPage()) {
        clearHttpErrorReloadState();
        return false;
      }

      const now = Date.now();
      const prev = getHttpErrorReloadState();
      const fresh = prev && (now - Number(prev.ts || 0) < 5 * 60 * 1000);
      const count = fresh ? Number(prev.count || 0) + 1 : 1;
      setHttpErrorReloadState({ count, ts: now, url: location.href });

      showLexHttpErrorReloadNotice(`LEX HTTP 431 detected.\nReloading page ${count} and keeping the loop ON…`);
      busSendToAz({ type: 'CMD', cmd: 'LEX_HTTP_ERROR_RELOAD', reason: 'LEX HTTP 431 detected', from: 'LEX', ts: now });
      forceReloadLex('LEX HTTP 431 detected', 1200);
      return true;
    }

    function isVisible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    }

    async function waitFor(checkFn, { timeoutMs = STEP_TIMEOUT_MS, label = 'waitFor', pollMin = 170, pollMax = 340 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (lexStopRequested) throw new Error('STOP_REQUESTED');
        const job = getJob();
        if (job?.stopRequested) throw new Error('STOP_REQUESTED');

        let v = null;
        try { v = await Promise.resolve(checkFn()); } catch { v = null; }
        if (v) return v;

        await sleep(rand(pollMin, pollMax));
      }
      throw new Error(`Timeout: ${label}`);
    }

    function deepQueryAllWithin(root, selector) {
      const out = [];
      const seen = new Set();
      function walk(node) {
        if (!node || seen.has(node)) return;
        seen.add(node);
        try { out.push(...node.querySelectorAll(selector)); } catch {}
        const all = node.querySelectorAll ? node.querySelectorAll('*') : [];
        for (const el of all) if (el && el.shadowRoot) walk(el.shadowRoot);
        if (node.shadowRoot) walk(node.shadowRoot);
      }
      walk(root);
      return out;
    }
    const deepQueryAll = (sel) => deepQueryAllWithin(document, sel);

    function readTextDeep(el) {
      if (!el) return '';
      const t = norm(el.textContent);
      if (t) return t;
      try { return norm(el.shadowRoot?.textContent || ''); } catch { return ''; }
    }

    async function focusAndType(input, value) {
      input.focus();
      input.select?.();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await shortWait();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await shortWait();
    }

    async function pressEnter(input) {
      input.focus();
      await shortWait();
      const ev = (t) => new KeyboardEvent(t, { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 });
      input.dispatchEvent(ev('keydown'));
      input.dispatchEvent(ev('keypress'));
      input.dispatchEvent(ev('keyup'));
      await shortWait();
    }

    async function copyToClipboard(text) {
      const t = String(text ?? '');
      try { await navigator.clipboard.writeText(t); return true; } catch {}
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; }
      catch { document.body.removeChild(ta); return false; }
    }

    function premiumToNumber(p) {
      const m = String(p || '').trim().match(/-?\d[\d,]*(?:\.\d+)?/);
      return m ? m[0].replace(/,/g, '') : '';
    }

    // ---------- UI ----------
    const UI = { root: null, input: null, btnStop: null, status: null, logBody: null, toastHost: null };

    function escapeHtml(s) {
      return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    }

    function toast(message, title = 'Info', color = 'green', ms = 4000) {
      if (!UI.toastHost) return;
      const t = document.createElement('div');
      t.className = `tmFarmersToast ${color}`;
      t.innerHTML = `<div class="title">${escapeHtml(title)}</div><div class="msg">${escapeHtml(message)}</div><div class="small">Tip: select + copy this text</div>`;
      UI.toastHost.appendChild(t);
      setTimeout(() => t.remove(), ms);
    }

    function showPolicyNoFoundBox(policy, reason, opts = {}) {
      try {
        const cfg = typeof opts === 'number' ? { ms: opts } : (opts || {});
        const withActions = !!cfg.actions;
        const ms = Number(cfg.ms || (withActions ? 0 : 15000));
        const pn = cleanPolicy(policy || '');
        const refId = String(cfg.refId || '');
        const msg = String(reason || 'not found');

        document.querySelectorAll('.tmFarmersPolicyNoFoundBox').forEach((el) => el.remove());
        const d = document.createElement('div');
        d.className = 'tmFarmersPolicyNoFoundBox';
        const policyLine = pn ? `<div class="small">Policy: ${escapeHtml(pn)}</div>` : '';
        const reasonLine = msg ? `<div class="small">${escapeHtml(msg)}</div>` : '';
        const actions = withActions ? `
          <div class="question">What would you like to do?</div>
          <div class="actions">
            <button type="button" data-tm-action="complete">Complete</button>
            <button type="button" data-tm-action="cancel">Cancel</button>
            <button type="button" data-tm-action="reload">Reload</button>
          </div>
        ` : '';
        d.innerHTML = `<div class="big">Policy no found</div>${policyLine}${reasonLine}${actions}`;
        document.documentElement.appendChild(d);

        if (withActions) {
          const finish = (status) => {
            clearAccountPremiumWatchdog();
            if (status === 'RELOAD') {
              const job = getJob() || {};
              if (pn) {
                setJob({
                  ...job,
                  policy: pn,
                  stage: 'SEARCH',
                  stopRequested: false,
                  startedAt: Date.now(),
                  refId,
                  accountCopyReloads: 0,
                  resumeAfterReload: true,
                });
              }
              d.remove();
              toast(`Reloading LEX to retry ${pn || 'policy'}`, 'Reload', 'green', 3200);
              log(`${nowStr()} NOT_FOUND decision: Reload policy=${pn || ''}`);
              forceReloadLex(`manual policy-not-found reload ${pn || ''}`, 250);
              return;
            }

            if (pn) {
              sendResultToAz({ type: 'RESULT', status, policy: pn, refId, reason: msg, manualDecision: true, from: 'LEX', ts: Date.now() });
            }
            d.remove();
            clearJob();
            setStatus('Idle');
            log(`${nowStr()} NOT_FOUND decision: ${status} policy=${pn || ''}`);
          };

          d.querySelector('[data-tm-action="complete"]')?.addEventListener('click', () => finish('COMPLETE'));
          d.querySelector('[data-tm-action="cancel"]')?.addEventListener('click', () => finish('CANCELLED'));
          d.querySelector('[data-tm-action="reload"]')?.addEventListener('click', () => finish('RELOAD'));
        }

        if (ms > 0) setTimeout(() => d.remove(), ms);
      } catch {}
    }

    function log(line) {
      if (!UI.logBody) return;
      const div = document.createElement('div');
      div.textContent = line;
      UI.logBody.appendChild(div);
      UI.logBody.scrollTop = UI.logBody.scrollHeight;
    }

    function setStatus(t) { if (UI.status) UI.status.textContent = t; }

    function injectCss() {
      const css = document.createElement('style');
      css.textContent = `
        #tmFarmersPremiumMini{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:10px;align-items:center;padding:8px 10px;background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.18);border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.45);font-family:system-ui;color:#fff;}
        #tmFarmersPremiumMini input{width:220px;padding:7px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.18);outline:none;background:rgba(0,0,0,.35);color:#fff;font-size:13px;}
        #tmFarmersPremiumMini button{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;padding:7px 10px;border-radius:999px;cursor:pointer;font-size:13px;}
        #tmFarmersPremiumMini .pill{padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.25);font-size:12px;opacity:.95;white-space:nowrap;}
        #tmFarmersPremiumOverlay{position:fixed;right:12px;bottom:72px;z-index:2147483647;width:360px;max-height:42vh;background:rgba(18,18,18,.92);border:1px solid rgba(255,255,255,.18);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);overflow:hidden;font-family:system-ui;color:#fff;}
        #tmFarmersPremiumOverlay .hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);font-size:12px;}
        #tmFarmersPremiumOverlay .body{padding:8px 10px;overflow:auto;max-height:calc(42vh - 40px);font-size:12px;line-height:1.25;white-space:pre-wrap;}
        #tmFarmersPremiumToastHost{position:fixed;left:12px;bottom:72px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:min(520px,calc(100vw - 24px));}
        .tmFarmersToast{border:1px solid rgba(255,255,255,.18);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px 12px;background:rgba(18,18,18,.92);color:#fff;font-family:system-ui;font-size:13px;user-select:text;cursor:text;}
        .tmFarmersToast.green{border-color:rgba(0,255,140,.35);}
        .tmFarmersToast.red{border-color:rgba(255,70,70,.45);}
        .tmFarmersToast .title{font-weight:700;margin-bottom:4px;}
        .tmFarmersToast .small{font-size:12px;opacity:.85;margin-top:6px;}
        .tmFarmersPolicyNoFoundBox{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;min-width:280px;max-width:calc(100vw - 24px);padding:14px 18px;border-radius:12px;border:2px solid rgba(254,202,202,.95);background:#b91c1c;color:#fff;box-shadow:0 16px 40px rgba(0,0,0,.45);font-family:system-ui;text-align:center;user-select:text;}
        .tmFarmersPolicyNoFoundBox .big{font-size:19px;font-weight:800;line-height:1.1;}
        .tmFarmersPolicyNoFoundBox .small{font-size:12px;font-weight:600;opacity:.95;margin-top:6px;line-height:1.25;}
        .tmFarmersPolicyNoFoundBox .question{font-size:13px;font-weight:800;margin-top:12px;}
        .tmFarmersPolicyNoFoundBox .actions{display:flex;gap:8px;justify-content:center;margin-top:10px;flex-wrap:wrap;}
        .tmFarmersPolicyNoFoundBox .actions button{border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.16);color:#fff;border-radius:8px;padding:7px 12px;font:700 12px system-ui;cursor:pointer;}
        .tmFarmersPolicyNoFoundBox .actions button:hover{background:rgba(255,255,255,.28);}
      `;
      document.documentElement.appendChild(css);
    }

    function injectUi() {
      if (UI.root) return;
      injectCss();

      UI.root = document.createElement('div');

      const mini = document.createElement('div');
      mini.id = 'tmFarmersPremiumMini';
      mini.innerHTML = `
        <input id="tmFarmersPolicyPaste" placeholder="Paste policy #…" />
        <button id="tmFarmersStopBtn" title="Stop current run">Stop</button>
        <div class="pill" id="tmFarmersMiniStatus">Idle</div>
      `;

      const overlay = document.createElement('div');
      overlay.id = 'tmFarmersPremiumOverlay';
      overlay.innerHTML = `
        <div class="hdr">
          <div><strong>Farmers Premium Copier</strong> — log</div>
          <button id="tmFarmersLogClear" style="padding:6px 8px;border-radius:10px;">Clear</button>
        </div>
        <div class="body" id="tmFarmersLogBody"></div>
      `;

      const toastHost = document.createElement('div');
      toastHost.id = 'tmFarmersPremiumToastHost';

      UI.root.appendChild(mini);
      UI.root.appendChild(overlay);
      UI.root.appendChild(toastHost);
      document.documentElement.appendChild(UI.root);

      UI.input = mini.querySelector('#tmFarmersPolicyPaste');
      UI.btnStop = mini.querySelector('#tmFarmersStopBtn');
      UI.status = mini.querySelector('#tmFarmersMiniStatus');
      UI.logBody = overlay.querySelector('#tmFarmersLogBody');
      UI.toastHost = toastHost;

      overlay.querySelector('#tmFarmersLogClear').addEventListener('click', () => (UI.logBody.textContent = ''));

      UI.btnStop.addEventListener('click', () => {
        const job = getJob() || {};
        job.stopRequested = true;
        setJob(job);
        toast('Stopped', 'Stop', 'red', 3000);
        setStatus('Idle');
        log(`${nowStr()} Stop clicked`);
        clearJob();
        busSendToAz({ type: 'CMD', cmd: 'STOPPED', reason: 'LEX stop clicked', from: 'LEX', ts: Date.now() });
      });

      UI.input.addEventListener('paste', (e) => {
        const txt = (e.clipboardData || window.clipboardData).getData('text');
        const policy = cleanPolicy(txt);
        e.preventDefault();
        UI.input.value = policy;

        if (!isLikelyPolicy(policy)) {
          toast(`Not a valid policy #: "${txt}"`, 'Invalid', 'red', 4500);
          setStatus('Invalid');
          return;
        }
        startJob(policy, 'manual_paste', makeRefId()).catch(() => {});
      });
    }

    // ---------- Finders ----------
    function findGlobalSearchInput() {
      const c = deepQueryAll('input[role="combobox"], input[placeholder], input[title]').filter(isVisible);
      return c.find((el) => ((el.getAttribute('placeholder') || '').toLowerCase() === 'search...'))
        || c.find((el) => ((el.getAttribute('title') || '').toLowerCase() === 'search...'))
        || c.find((el) => ((el.getAttribute('placeholder') || '').toLowerCase().includes('search')))
        || c.find((el) => ((el.getAttribute('title') || '').toLowerCase().includes('search')))
        || c[0] || null;
    }

    function isTmUiNode(el) {
      return !!el?.closest?.('#tmFarmersPremiumMini,#tmFarmersPremiumOverlay,#tmFarmersPremiumToastHost,.tmFarmersPolicyNoFoundBox,.tmFarmersToast');
    }

    function findPolicyEl(policyNumber) {
      const pn = cleanPolicy(policyNumber);
      if (!pn) return null;
      return deepQueryAll('strong, a, span, lightning-base-formatted-text, lightning-formatted-text')
        .find((el) => !isTmUiNode(el) && isVisible(el) && cleanPolicy(readTextDeep(el) || el.textContent) === pn) || null;
    }

    function getPolicyContainer(policyNumber) {
      const policyEl = findPolicyEl(policyNumber);
      if (!policyEl) return null;
      return policyEl.closest('tr')
        || policyEl.closest('[role="row"]')
        || policyEl.closest('section')
        || policyEl.closest('article')
        || policyEl.closest('div')
        || policyEl.parentElement;
    }

    function findNoResultsSignal(policyNumber) {
      const pn = cleanPolicy(policyNumber);
      const nodes = deepQueryAll('div, span, p, li, td, th, h1, h2, h3, lightning-base-formatted-text, lightning-formatted-text')
        .filter((el) => !isTmUiNode(el) && isVisible(el));
      const patterns = [
        /\bno\s+results?\b/i,
        /\bno\s+records?\b/i,
        /\bno\s+items?\b/i,
        /\bno\s+matches?\b/i,
        /\bnothing\s+found\b/i,
        /\bnot\s+found\b/i,
        /couldn'?t\s+find/i,
        /did\s+not\s+find/i,
        /no\s+.*\s+found/i,
      ];
      return nodes.find((el) => {
        const txt = norm(readTextDeep(el) || el.textContent || '');
        if (!txt || txt.length > 700) return false;
        if (pn && cleanPolicy(txt) === pn) return false;
        return patterns.some((re) => re.test(txt));
      }) || null;
    }

    function findStatusLabelEl(policyNumber) {
      const container = getPolicyContainer(policyNumber);
      if (!container) return null;
      const spans = deepQueryAllWithin(container, 'span.slds-truncate, lightning-base-formatted-text, lightning-formatted-text, span').filter((el) => !isTmUiNode(el) && isVisible(el));
      return spans.find((el) => {
        const t = norm(readTextDeep(el) || el.textContent);
        return t === 'Active' || t === 'Cancelled';
      }) || null;
    }

    function findCustomerLinkForPolicy(policyNumber) {
      const pn = cleanPolicy(policyNumber);
      const container = getPolicyContainer(policyNumber);
      if (!container) return null;

      const links = Array.from(container.querySelectorAll('a[data-recordid][href*="/lightning/r/"][href*="/view"]')).filter(isVisible);
      const isNameLike = (a) => { const t = norm(a.textContent); return t && /[A-Za-z]/.test(t) && cleanPolicy(t) !== pn; };
      const classBoost = (a) => /forceOutputLookup|outputLookupLink/i.test(String(a.className || ''));
      return links.find((a) => isNameLike(a) && classBoost(a)) || links.find((a) => isNameLike(a)) || links[0] || null;
    }

    function findPolicyScopeByPolicyNumber(policyNumber) {
      const pn = cleanPolicy(policyNumber);
      const strongs = deepQueryAll('strong').filter(isVisible);
      const strongEl = strongs.find((s) => cleanPolicy(s.textContent) === pn);
      if (!strongEl) return { strongEl: null, scopeEl: null };
      const scopeEl = strongEl.closest('c-policy-tab-active') || strongEl.closest('.slds-card') || strongEl.closest('section') || strongEl.closest('article') || strongEl.closest('div') || strongEl.parentElement;
      return { strongEl, scopeEl };
    }

    function scrollIntoViewNice(el) {
      try { el?.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
      try { window.scrollBy(0, -140); } catch {}
    }

    function findPremiumForScope(scopeEl) {
      if (!scopeEl) return null;

      const labelCandidates = deepQueryAllWithin(scopeEl, '[title], p, span, strong, lightning-base-formatted-text').filter(isVisible);
      const labelEl = labelCandidates.find((n) => norm(n.getAttribute?.('title')) === 'Full Term Premium' || norm(n.textContent) === 'Full Term Premium');

      const collect = (root) => {
        const nums = deepQueryAllWithin(root, 'lightning-formatted-number');
        for (const el of nums) {
          const t = readTextDeep(el);
          const m = t.match(/\$\s*[\d,]+(\.\d{2})?/);
          if (m) return m[0].replace(/\s+/g, '');
        }
        return null;
      };

      if (labelEl) {
        const near = labelEl.closest('div') || labelEl.parentElement;
        return collect(near) || collect(scopeEl);
      }
      return collect(scopeEl);
    }

    function isAccountLikeView() {
      const p = location.pathname || '';
      return /\/lightning\/r\/Account\/[A-Za-z0-9]+\/view/.test(p) || /\/lightning\/r\/[A-Za-z0-9]+\/view/.test(p);
    }

    async function navToHref(href) {
      log(`${nowStr()} NAV -> ${href}`);
      const url = href.startsWith('http') ? href : `${location.origin}${href}`;
      window.location.assign(url);
    }

    // ---------- Local bus inbound ----------
    let azListenerId = null;

    function sendAck(refId, policy) {
      busSendToAz({ type: 'ACK', refId, policy, from: 'LEX', ts: Date.now() });
    }

    async function startJob(policy, source, refId) {
      const p = cleanPolicy(policy);
      if (!isLikelyPolicy(p)) return;

      lexStopRequested = false;
      const existing = getJob();
      if (existing?.policy && !existing.stopRequested) {
        if (existing.refId === refId || existing.policy === p) {
          log(`${nowStr()} Duplicate/active job ignored: policy=${p} refId=${refId || ''}`);
          return;
        }

        log(`${nowStr()} Replacing stale LEX job policy=${existing.policy} with incoming AZ policy=${p} refId=${refId || ''}`);
        clearAccountPremiumWatchdog();
        clearJob();
      }

      clearAccountPremiumWatchdog();
      UI.input.value = p;
      setJob({
        policy: p,
        stage: 'SEARCH',
        stopRequested: false,
        startedAt: Date.now(),
        source: source || 'bus',
        refId: refId || '',
        accountCopyReloads: 0,
      });
      log(`${nowStr()} Job set: policy=${p} stage=SEARCH (source=${source}) refId=${refId || ''}`);
      setStatus(`Running: ${p}`);
      runJob().catch((e) => fatalJob(e));
    }

    function sendResultToAz(payload) {
      busSendToAz(payload);
    }

    function isAccountCopyDecision(msg) {
      return /(policy\s*scope|account[_\s-]*copy|scope\s+within|premium\s+within|account page open|ACCOUNT_COPY_FAILED|ACCOUNT_PREMIUM_WATCHDOG)/i.test(String(msg || ''));
    }

    function needsPolicyDecision(msg) {
      return /(not\s*found|policy\s*scope|account[_\s-]*copy|scope\s+within|premium\s+within|account page open|ACCOUNT_COPY_FAILED|ACCOUNT_PREMIUM_WATCHDOG)/i.test(String(msg || ''));
    }

    function showDecisionNeeded(policy, refId, msg, delayMs = 0) {
      const pn = cleanPolicy(policy || '');
      const id = String(refId || '');
      const detail = String(msg || 'not found');

      const show = () => {
        const current = getJob();
        if (pn && current?.policy && cleanPolicy(current.policy) !== pn) return;
        showPolicyNoFoundBox(pn, detail, { actions: true, refId: id });
        toast(`Decision needed: ${detail}`, 'Decision Needed', 'red', 9000);
        log(`${nowStr()} Decision needed: ${detail}`);
        setStatus(`Decision needed: ${pn || 'policy'}`);
        if (pn) {
          busSendToAz({ type: 'CMD', cmd: 'DECISION_NEEDED', policy: pn, refId: id, reason: detail, from: 'LEX', ts: Date.now() });
        }
      };

      if (delayMs > 0) {
        toast(`Waiting ${Math.round(delayMs / 1000)}s before Policy no found options`, 'Decision Pending', 'red', delayMs + 1200);
        log(`${nowStr()} Decision delayed ${Math.round(delayMs / 1000)}s: ${detail}`);
        setStatus(`Decision in ${Math.round(delayMs / 1000)}s: ${pn || 'policy'}`);
        if (pn) {
          busSendToAz({ type: 'CMD', cmd: 'DECISION_NEEDED', policy: pn, refId: id, reason: `${detail} (waiting ${Math.round(delayMs / 1000)}s)`, from: 'LEX', ts: Date.now() });
        }
        setTimeout(show, delayMs);
        return;
      }

      show();
    }

    function fatalJob(err) {
      clearAccountPremiumWatchdog();
      const job = getJob();
      const policy = job?.policy || '';
      const refId = job?.refId || '';
      const msg = `${err?.message || err}`;

      if (msg === 'STOP_REQUESTED') {
        log(`${nowStr()} Job stopped by AZ`);
        clearJob();
        setStatus('Idle');
        return;
      }

      if (policy && needsPolicyDecision(msg)) {
        const delayMs = isAccountCopyDecision(msg) ? ACCOUNT_COPY_DECISION_DELAY_MS : 0;
        showDecisionNeeded(policy, refId, msg, delayMs);
        return;
      }
      toast(`Error: ${msg}`, 'Error', 'red', 9000);
      log(`${nowStr()} Error: ${msg}`);

      if (policy && msg !== 'STOP_REQUESTED') {
        sendResultToAz({ type: 'RESULT', status: 'ERROR', policy, refId, reason: msg, from: 'LEX', ts: Date.now() });
      }

      clearJob();
      setStatus('Idle');
    }

    function clearAccountPremiumWatchdog() {
      if (accountPremiumWatchdogTimer) clearTimeout(accountPremiumWatchdogTimer);
      accountPremiumWatchdogTimer = null;
    }

    function startAccountPremiumWatchdog(policy, refId) {
      clearAccountPremiumWatchdog();

      const pn = cleanPolicy(policy);
      accountPremiumWatchdogTimer = setTimeout(async () => {
        try {
          if (lexReloading) return;

          const job = getJob();
          if (!job?.policy || job.stopRequested) return;
          if (String(job.stage || '').toUpperCase() !== 'ACCOUNT') return;
          if (cleanPolicy(job.policy) !== pn) return;
          if (!isAccountLikeView()) return;

          const reason = `account page open ${ACCOUNT_COPY_TIMEOUT_MS}ms but premium not copied`;
          log(`${nowStr()} Account premium watchdog fired: policy=${pn} refId=${refId || ''}`);
          const didReload = await reloadLexForAccountCopyRetry(reason);
          if (!didReload) {
            fatalJob(new Error(`ACCOUNT_PREMIUM_WATCHDOG_FAILED_AFTER_${ACCOUNT_COPY_RELOAD_MAX}_RELOADS`));
          }
        } catch (err) {
          fatalJob(err);
        }
      }, ACCOUNT_COPY_TIMEOUT_MS);
    }

    async function reloadLexForAccountCopyRetry(reason) {
      clearAccountPremiumWatchdog();
      if (lexReloading) return true;
      const job = getJob();
      if (!job?.policy || job.stopRequested) return false;

      const used = Number(job.accountCopyReloads || 0);
      if (used >= ACCOUNT_COPY_RELOAD_MAX) {
        const msg = `Policy no found after ${ACCOUNT_COPY_RELOAD_MAX} account reloads: ${reason}`;
        showDecisionNeeded(job.policy, job.refId || '', msg, ACCOUNT_COPY_DECISION_DELAY_MS);
        return true;
      }

      job.stage = 'ACCOUNT';
      job.accountCopyReloads = used + 1;
      setJob(job);

      const msg = `Account copy timeout -> reload ${job.accountCopyReloads}/${ACCOUNT_COPY_RELOAD_MAX}: ${reason}`;
      toast(msg, 'Retry', 'red', 4500);
      log(`${nowStr()} ${msg}`);
      setStatus(`Reload ${job.accountCopyReloads}/${ACCOUNT_COPY_RELOAD_MAX}: ${job.policy}`);

      forceReloadLex(`account copy retry: ${reason}`, 250);
      return true;
    }

    async function waitForAccountCopyStep(checkFn, deadlineTs, label) {
      const msLeft = deadlineTs - Date.now();
      if (msLeft <= 0) throw new Error(`ACCOUNT_COPY_TIMEOUT: ${label}`);
      return await waitFor(checkFn, {
        timeoutMs: Math.max(250, msLeft),
        label,
        pollMin: 80,
        pollMax: 160,
      });
    }

    function completeNotFound(reason) {
      clearAccountPremiumWatchdog();
      const job = getJob();
      const policy = job?.policy || '';
      const refId = job?.refId || '';
      const msg = String(reason || 'not found');

      showDecisionNeeded(policy, refId, msg, 0);
    }

    async function runJob() {
      const job = getJob();
      if (!job?.policy) return;

      const policy = job.policy;
      const refId = job.refId || '';

      if (job.stage === 'SEARCH') {
        log(`${nowStr()} Stage=SEARCH`);
        const searchInput = await waitFor(() => {
          const el = findGlobalSearchInput();
          return el && isVisible(el) ? el : null;
        }, { label: 'global search input' });

        await focusAndType(searchInput, policy);
        await pressEnter(searchInput);
        await longWait();

        job.stage = 'STATUS';
        setJob(job);
        log(`${nowStr()} Stage -> STATUS`);
      }

      if (job.stage === 'STATUS') {
        log(`${nowStr()} Stage=STATUS`);
        let statusEl = null;
        try {
          statusEl = await waitFor(() => {
            const noResult = findNoResultsSignal(policy);
            if (noResult && !findPolicyEl(policy)) {
              const txt = norm(readTextDeep(noResult) || noResult.textContent || 'no results');
              return { __policyNotFoundSignal: true, text: txt.slice(0, 180) };
            }
            const el = findStatusLabelEl(policy);
            return el && isVisible(el) ? el : null;
          }, { label: 'status label', timeoutMs: 65000 });
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg.startsWith('Timeout: status label')) {
            const hasPolicyOnPage = !!findPolicyEl(policy);
            completeNotFound(`policy ${policy}: ${hasPolicyOnPage ? 'status not found near policy after search' : 'policy not found after search'}`);
            return;
          }
          throw err;
        }

        if (statusEl?.__policyNotFoundSignal) {
          completeNotFound(`policy ${policy}: ${statusEl.text || 'not found after search'}`);
          return;
        }

        const status = norm(statusEl.textContent);
        log(`${nowStr()} Status=${status}`);

        if (/\bcancell?ed\b|\bcancelled\b/i.test(status)) {
          toast(`Cancelled — ${policy}`, 'Cancelled', 'red', 10000);
          log(`${nowStr()} Cancelled. Send -> AZ`);
          sendResultToAz({ type: 'RESULT', status: 'CANCELLED', policy, refId, from: 'LEX', ts: Date.now() });
          clearJob();
          setStatus('Idle');
          return;
        }

        let customerLink = null;
        try {
          customerLink = await waitFor(() => {
            const a = findCustomerLinkForPolicy(policy);
            return a && isVisible(a) ? a : null;
          }, { label: 'customer link', timeoutMs: 65000 });
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg.startsWith('Timeout: customer link')) {
            completeNotFound(`policy ${policy}: customer link not found`);
            return;
          }
          throw err;
        }

        const href = customerLink.getAttribute('href');
        log(`${nowStr()} Open account "${norm(customerLink.textContent)}" href=${href}`);

        job.stage = 'ACCOUNT';
        job.accountCopyReloads = 0;
        setJob(job);

        await shortWait();
        await navToHref(href);
        return;
      }

      if (job.stage === 'ACCOUNT') {
        log(`${nowStr()} Stage=ACCOUNT copyReloads=${Number(job.accountCopyReloads || 0)}/${ACCOUNT_COPY_RELOAD_MAX}`);
        if (!isAccountLikeView()) {
          await waitFor(() => (isAccountLikeView() ? true : null), { label: 'account view', timeoutMs: 65000 });
          await longWait();
        }

        startAccountPremiumWatchdog(policy, refId);

        try {
          const deadlineTs = Date.now() + ACCOUNT_COPY_TIMEOUT_MS;

          const found = await waitForAccountCopyStep(() => {
            const x = findPolicyScopeByPolicyNumber(policy);
            return x.strongEl && x.scopeEl ? x : null;
          }, deadlineTs, 'policy scope within 10s');

          scrollIntoViewNice(found.strongEl);
          scrollIntoViewNice(found.scopeEl);
          await shortWait();

          const premium = await waitForAccountCopyStep(() => {
            const p = findPremiumForScope(found.scopeEl);
            return p ? p : null;
          }, deadlineTs, 'premium within 10s');

          const premiumNum = premiumToNumber(premium);
          const ok = await copyToClipboard(premiumNum || premium);

          toast(ok ? `Copied: ${premiumNum || premium} (Policy ${policy})`
                   : `Found: ${premiumNum || premium} (Copy failed - sent to AZ by bus)`, 'Premium', 'green', 9000);

          log(`${nowStr()} DONE premium=${premiumNum || premium} copyOk=${ok}`);

          clearAccountPremiumWatchdog();
          sendResultToAz({ type: 'RESULT', status: 'ACTIVE', policy, refId, premium: premiumNum || premium, from: 'LEX', ts: Date.now() });

          clearJob();
          setStatus('Idle');
        } catch (err) {
          const msg = String(err?.message || err);
          if (msg === 'STOP_REQUESTED') throw err;

          const didReload = await reloadLexForAccountCopyRetry(msg);
          if (didReload) return;

          throw new Error(`ACCOUNT_COPY_FAILED_AFTER_${ACCOUNT_COPY_RELOAD_MAX}_RELOADS: ${msg}`);
        }
      }
    }

    // ---------- Inbound bus handler ----------
    function handleAzMsg(msg) {
      if (!msg || typeof msg !== 'object') return;
      if (String(msg.from || '').toUpperCase() === 'LEX') return;

      const type = String(msg.type || '').toUpperCase();

      if (type === 'CMD') {
        const cmd = String(msg.cmd || '').toUpperCase();
        if (cmd === 'RELOAD') {
          toast(`Reloading… (${msg.reason || 'cmd'})`, 'CMD', 'green', 2500);
          log(`${nowStr()} CMD RELOAD: ${msg.reason || ''}`);
          setTimeout(() => { try { location.reload(); } catch {} }, 450);
        }
        if (cmd === 'STOP') {
          lexStopRequested = true;
          clearAccountPremiumWatchdog();
          const job = getJob() || {};
          if (job.policy) {
            job.stopRequested = true;
            setJob(job);
          } else {
            clearJob();
          }
          toast('Stop requested by AZ', 'Stop', 'red', 2500);
          log(`${nowStr()} CMD STOP`);
          setStatus('Idle');
        }
        return;
      }

      if (type !== 'POLICY') return;

      const policy = cleanPolicy(msg.policy);
      const refId = String(msg.refId || '');
      if (!isLikelyPolicy(policy)) return;

      sendAck(refId, policy);

      const job = getJob();
      if (job?.policy === policy && job?.refId === refId && !job?.stopRequested) {
        log(`${nowStr()} Duplicate POLICY received (same refId) → ACK only`);
        return;
      }

      toast(`From AZ: ${policy}`, 'LocalBus', 'green', 2500);
      log(`${nowStr()} BUS received policy=${policy} refId=${refId}`);

      startJob(policy, 'bus', refId).catch(() => {});
    }

    function boot() {
      if (handleLexHttpErrorPage()) return;

      injectUi();
      log(`${nowStr()} Ready. Paste policy # OR receive from AZ (LOCAL BUS).`);

      try {
        if (azListenerId) { try { GM_removeValueChangeListener(azListenerId); } catch {} }
        azListenerId = GM_addValueChangeListener(BUS_KEYS.AZ_TO_LEX, (_n, _o, newV, _remote) => {
          try { handleAzMsg(newV); } catch {}
        });
      } catch {}

      const job = getJob();
      if (job?.policy && !job.stopRequested) {
        const stage = String(job.stage || '').toUpperCase();
        const retryReloadFresh = job.resumeAfterReload && (Date.now() - Number(job.startedAt || 0)) < 120000;
        if (stage === 'ACCOUNT' || retryReloadFresh) {
          log(`${nowStr()} Resume ${stage || 'SEARCH'} job after ${retryReloadFresh ? 'manual reload' : 'account navigation'}: policy=${job.policy}`);
          if (retryReloadFresh) {
            job.resumeAfterReload = false;
            setJob(job);
          }
          setStatus(`Running: ${job.policy}`);
          runJob().catch(fatalJob);
        } else {
          log(`${nowStr()} Clearing stale saved job on LEX boot: policy=${job.policy} stage=${job.stage}`);
          clearJob();
          setStatus('Idle');
        }
      } else {
        setStatus('Idle');
      }

      busSendToAz({ type: 'HELLO', from: 'LEX', ts: Date.now() });
    }

    window.__LEX_AZ_LOCALBUS__.dispose = () => {
      try { if (azListenerId) GM_removeValueChangeListener(azListenerId); } catch {}
    };

    boot();
  }

  // =========================
  // ROUTER
  // =========================
  if (IS_AZ) bootAZ();
  else if (IS_LEX) bootLEX();
})();
