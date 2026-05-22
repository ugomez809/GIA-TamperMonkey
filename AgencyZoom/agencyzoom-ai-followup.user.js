// ==UserScript==
// @name         LOCAL AgencyZoom AI Follow-Up Composer
// @namespace    local.agencyzoom.ai-followup
// @version      3.4
// @description  Generates first-quote and follow-up email/SMS options from AgencyZoom Activities using OpenAI and prompt templates from a published Sheet CSV.
// @match        https://app.agencyzoom.com/referral/pipeline*
// @exclude      https://app.agencyzoom.com/login*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @connect      api.openai.com
// @connect      docs.google.com
// @connect      spreadsheets.google.com
// @connect      googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-ai-followup.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/agencyzoom-ai-followup.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '3.4';
  const WORKFLOW = 'first_quote_followup';
  const STEP_OPTIONS = [
    { id: 'first_quote', label: 'First Quote', sheetDay: 'first_quote', kind: 'first_quote', followupDay: '' },
    { id: 'followup_day_1', label: 'Day 1', sheetDay: '1', kind: 'followup', followupDay: '1' },
    { id: 'followup_day_2', label: 'Day 2', sheetDay: '2', kind: 'followup', followupDay: '2' },
    { id: 'followup_day_3', label: 'Day 3', sheetDay: '3', kind: 'followup', followupDay: '3' },
    { id: 'followup_day_4', label: 'Day 4', sheetDay: '4', kind: 'followup', followupDay: '4' },
    { id: 'followup_day_5', label: 'Day 5', sheetDay: '5', kind: 'followup', followupDay: '5' }
  ];
  const STYLE_ID = 'tm-az-ai-followup-style';
  const BOX_ID = 'tm-az-ai-followup-box';
  const DEBUG_PANEL_ID = 'tm-az-ai-debug-panel';
  const DEFAULT_MODEL = 'gpt-4o-mini';
  const DEFAULT_PROMPT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1I7S3qpilMvAm0NXwYkAJNM-WWv4uozsL6bXLEdaxj9k/edit?gid=0#gid=0';
  const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
  const MAX_ACTIVITY_CHARS = 18000;
  const MAX_ACTIVITY_ITEMS = 30;
  const OPTION_COUNT = 2;
  const STORAGE_KEYS = {
    apiKey: 'tmAzAiFollowupOpenAiApiKey',
    model: 'tmAzAiFollowupModel',
    selectedDay: 'tmAzAiFollowupSelectedDay',
    selectedStep: 'tmAzAiFollowupSelectedStep',
    debugVisible: 'tmAzAiFollowupDebugVisible',
    sentMemory: 'tmAzAiFollowupSentMemoryV1'
  };

  let selectedStepId = normalizeStepId(storageGet(STORAGE_KEYS.selectedStep, storageGet(STORAGE_KEYS.selectedDay, 'first_quote')));
  let composerObserver = null;
  let scanTimer = 0;
  let activeComposer = null;
  let lastOptions = [];
  let lastOptionsChannel = '';
  let lastGeneratedComposer = null;
  let lastGeneratedStepId = '';
  let lastGeneratedTicketId = '';
  let pendingSendMemory = null;
  let debugEntries = [];

  boot();

  function boot() {
    if (!isLeadPipelinePage()) return;
    onReady(() => {
      try {
        injectStyle();
        registerMenuCommands();
        document.addEventListener('click', handleDocumentClickForSendMemory, true);
        startComposerObserver();
        scheduleComposerScan(50);
        debugLog('script_started', { version: VERSION, url: location.href });
      } catch (err) {
        console.error('[AZ AI Follow-Up] Startup failed:', err);
      }
    });
  }

  function onReady(callback) {
    if (document.body) {
      callback();
      return;
    }
    document.addEventListener('DOMContentLoaded', callback, { once: true });
  }

  function isLeadPipelinePage() {
    return /(^|\.)app\.agencyzoom\.com$/i.test(String(location.hostname || '')) &&
      location.pathname.replace(/\/+$/, '') === '/referral/pipeline';
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('AZ AI: Toggle debug log', toggleDebugPanel);
    GM_registerMenuCommand('AZ AI: Set/Clear OpenAI API key', promptSetOrClearApiKey);
    GM_registerMenuCommand('AZ AI: Set model', promptSetModel);
  }

  function startComposerObserver() {
    if (composerObserver) composerObserver.disconnect();
    composerObserver = new MutationObserver(() => scheduleComposerScan(180));
    composerObserver.observe(document.body, { childList: true, subtree: true });
    window.setInterval(() => scheduleComposerScan(0), 1600);
  }

  function scheduleComposerScan(delay) {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => {
      try {
        syncComposerBox();
      } catch (err) {
        debugLog('composer_scan_error', { message: errorMessage(err) });
      }
    }, delay);
  }

  function syncComposerBox() {
    if (!isLeadPipelinePage()) {
      document.getElementById(BOX_ID)?.remove();
      activeComposer = null;
      return;
    }

    const context = findComposerContext();
    const existing = document.getElementById(BOX_ID);

    if (!context) {
      activeComposer = null;
      if (existing) existing.remove();
      return;
    }

    activeComposer = context;
    if (!existing) {
      mountComposerBox(context);
      restoreOptionsForContext(context);
      debugLog('composer_detected', describeComposer(context));
      return;
    }

    if (existing.dataset.channel !== context.channel) {
      existing.remove();
      mountComposerBox(context);
      restoreOptionsForContext(context);
      debugLog('composer_detected', describeComposer(context));
      return;
    }

    existing.dataset.composerId = context.id;
    updateComposerBoxHeader(existing, context);
    updateBoxTicketContext(existing, context);
    ensureBoxPlacement(existing, context);
  }

  function mountComposerBox(context) {
    const box = document.createElement('section');
    box.id = BOX_ID;
    box.className = 'tm-az-ai-box';
    box.dataset.composerId = context.id;
    box.dataset.channel = context.channel;
    box.setAttribute('aria-label', 'First Quote and Follow-up AI helper');
    updateBoxTicketContext(box, context);

    const header = document.createElement('div');
    header.className = 'tm-az-ai-box-header';

    const title = document.createElement('strong');
    title.textContent = 'Quote Follow-up';
    header.appendChild(title);

    const channel = document.createElement('span');
    channel.className = 'tm-az-ai-channel';
    channel.textContent = context.channel.toUpperCase();
    header.appendChild(channel);

    const days = document.createElement('div');
    days.className = 'tm-az-ai-day-table';
    for (const step of STEP_OPTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tm-az-ai-day';
      button.dataset.stepId = step.id;
      button.dataset.day = step.sheetDay;
      button.textContent = step.label;
      button.addEventListener('click', () => {
        if (isDayButtonSent(box, button)) {
          showBoxStatus('That day is already marked sent for this ticket. Right-click it to reset.', 'error');
          return;
        }
        selectedStepId = step.id;
        storageSet(STORAGE_KEYS.selectedStep, step.id);
        storageSet(STORAGE_KEYS.selectedDay, step.sheetDay);
        updateSelectedStep(box);
        debugLog('selected_step_changed', step);
      });
      button.addEventListener('contextmenu', (event) => {
        if (!isDayButtonSent(box, button)) return;
        event.preventDefault();
        const stepName = step.label;
        const channelName = String(box.dataset.channel || '').toUpperCase();
        if (!confirm(`Clear sent memory for ${stepName} ${channelName} on this ticket?`)) return;
        clearSentStep(box.dataset.ticketId, box.dataset.channel, step.id);
        updateSelectedStep(box);
        showBoxStatus(`${stepName} ${channelName} was reset for this ticket.`, 'ready');
      });
      days.appendChild(button);
    }

    const controls = document.createElement('div');
    controls.className = 'tm-az-ai-controls';

    const generate = document.createElement('button');
    generate.type = 'button';
    generate.className = 'tm-az-ai-generate';
    generate.textContent = 'Generate 2 Drafts';
    generate.addEventListener('click', () => {
      generateOptionsFromCurrentComposer().catch((err) => handleGenerationError(err));
    });
    controls.appendChild(generate);

    const status = document.createElement('div');
    status.className = 'tm-az-ai-status';
    status.textContent = 'Choose First Quote or a follow-up day, then generate drafts.';

    const options = document.createElement('div');
    options.className = 'tm-az-ai-options';

    box.appendChild(header);
    box.appendChild(days);
    box.appendChild(controls);
    box.appendChild(status);
    box.appendChild(options);

    insertBoxNearComposer(box, context);
    updateSelectedStep(box);
  }

  function updateComposerBoxHeader(box, context) {
    const channel = box.querySelector('.tm-az-ai-channel');
    if (channel) channel.textContent = context.channel.toUpperCase();
  }

  function updateBoxTicketContext(box, context) {
    if (!box || !context) return;
    const ticket = getTicketDetailsForComposer(context);
    box.dataset.ticketId = ticket.ticketId || '';
    updateSelectedStep(box);
  }

  function insertBoxNearComposer(box, context) {
    const preferred = getPreferredBoxAnchor(context);
    if (preferred && preferred.parentElement && !isAiElement(preferred.parentElement)) {
      preferred.insertAdjacentElement('afterend', box);
      return;
    }

    const anchor = context.bodyField?.wrapper || context.bodyField?.el || null;
    if (anchor && anchor.parentElement && !isAiElement(anchor.parentElement)) {
      anchor.insertAdjacentElement('afterend', box);
      return;
    }

    const host = context.root.querySelector('.modal-body, .panel-body, .card-body, form') || context.root;
    host.appendChild(box);
  }

  function ensureBoxPlacement(box, context) {
    const preferred = getPreferredBoxAnchor(context);
    if (!preferred || !preferred.parentElement) return;
    if (box.previousElementSibling === preferred && box.parentElement === preferred.parentElement) return;
    preferred.insertAdjacentElement('afterend', box);
  }

  function getPreferredBoxAnchor(context) {
    const emailForm = context.root.matches?.('#emailForm')
      ? context.root
      : context.root.closest?.('#emailForm');
    if (emailForm) {
      return getSendButtonAnchor(emailForm) ||
        emailForm.querySelector('#emailEditorPart') ||
        emailForm.querySelector('#emailContactArea') ||
        emailForm.querySelector('.cke')?.closest?.('.az-form-group, .form-group') ||
        emailForm.querySelector('.cke') ||
        null;
    }

    const smsForm = context.root.matches?.('#smsForm, form[action*="sms"], form[action*="SMS"]')
      ? context.root
      : context.root.closest?.('#smsForm, form[action*="sms"], form[action*="SMS"]');
    if (smsForm) {
      return getSendButtonAnchor(smsForm) ||
        context.bodyField?.wrapper ||
        smsForm.querySelector('textarea')?.closest?.('.az-form-group, .form-group') ||
        smsForm.querySelector('textarea') ||
        null;
    }

    return null;
  }

  function getSendButtonAnchor(root) {
    const send = findSendActionElement(root);
    if (!send) return null;

    const container = send.closest?.([
      '.modal-footer',
      '.az-form-actions',
      '.form-actions',
      '.text-right',
      '.text-center',
      '.btn-toolbar',
      '.button-group',
      '.actions',
      '.d-flex'
    ].join(','));

    if (container && container !== root && !isAiElement(container)) return container;
    const parent = send.parentElement;
    if (parent && parent !== root && parent.tagName !== 'FORM' && !isAiElement(parent)) return parent;
    return send;
  }

  function updateSelectedStep(box = document.getElementById(BOX_ID)) {
    if (!box) return;
    const selectedSent = isStepSent(box.dataset.ticketId, box.dataset.channel, selectedStepId);
    if (selectedSent) {
      const available = STEP_OPTIONS.find((step) => !isStepSent(box.dataset.ticketId, box.dataset.channel, step.id));
      if (available) {
        selectedStepId = available.id;
        storageSet(STORAGE_KEYS.selectedStep, available.id);
        storageSet(STORAGE_KEYS.selectedDay, available.sheetDay);
      }
    }

    for (const button of Array.from(box.querySelectorAll('.tm-az-ai-day'))) {
      const sent = isDayButtonSent(box, button);
      button.classList.toggle('tm-az-ai-day-sent', sent);
      button.classList.toggle('tm-az-ai-day-active', !sent && button.dataset.stepId === selectedStepId);
      button.setAttribute('aria-disabled', sent ? 'true' : 'false');
      button.title = sent ? 'Already sent. Right-click to reset.' : '';
    }
  }

  function isDayButtonSent(box, button) {
    return !!(box && button && isStepSent(box.dataset.ticketId, box.dataset.channel, button.dataset.stepId));
  }

  function restoreOptionsForContext(context) {
    if (!lastOptions.length || lastOptionsChannel !== context.channel) return;
    const box = document.getElementById(BOX_ID);
    if (box) {
      box.dataset.generatedStepId = lastGeneratedStepId || '';
      box.dataset.ticketId = lastGeneratedTicketId || box.dataset.ticketId || '';
    }
    renderOptions(lastOptions, context.channel);
    showBoxStatus(`Ready: ${lastOptions.length} ${context.channel.toUpperCase()} options.`, 'ready');
    debugLog('options_restored_after_box_remount', {
      channel: context.channel,
      optionCount: lastOptions.length,
      composerId: context.id
    });
  }

  async function generateOptionsFromCurrentComposer() {
    const box = document.getElementById(BOX_ID);
    const composer = findComposerContext();
    activeComposer = composer;
    if (!composer) throw new Error('Open an AgencyZoom email or SMS composer first.');

    debugLog('composer_detected', describeComposer(composer));
    showBoxStatus('Reading Activities and composer text...', 'loading');

    const selectedStep = getSelectedStep();
    const context = await collectTicketContext(composer);
    if (isStepSent(context.ticket.ticketId, composer.channel, selectedStep.id)) {
      throw new Error(`${selectedStep.label} is already marked sent for this ${composer.channel.toUpperCase()} ticket. Right-click the gray day to reset it.`);
    }

    const promptConfig = await loadPromptFor(composer.channel, selectedStep);
    const placeholders = buildPlaceholders(context, composer, selectedStep);
    const resolvedSystemPrompt = applyPlaceholders(promptConfig.system_prompt, placeholders);
    const resolvedUserPrompt = applyPlaceholders(promptConfig.user_prompt, placeholders);
    const payload = buildOpenAiPayload(resolvedSystemPrompt, resolvedUserPrompt, context, composer.channel, selectedStep);
    const readablePayload = buildReadablePayloadSummary({
      context,
      composer,
      step: selectedStep,
      placeholders,
      systemPrompt: resolvedSystemPrompt,
      userPrompt: resolvedUserPrompt,
      payload
    });
    const cleanPayloadText = buildCleanOpenAiPayloadText(payload);

    debugLog('selected_generation', { workflow: WORKFLOW, step: selectedStep, channel: composer.channel });
    debugLog('placeholder_values', placeholders);
    debugLog('resolved_prompt', { system_prompt: resolvedSystemPrompt, user_prompt: resolvedUserPrompt });
    debugLog('api_payload_clean_readable', cleanPayloadText);
    debugLog('api_payload_clean', readablePayload);
    debugLog('api_payload', redactSecrets(payload));

    showBoxStatus(`Asking OpenAI for ${OPTION_COUNT} options...`, 'loading');
    const draft = await requestFollowUpDraft(payload);
    lastOptions = normalizeOptions(draft.options);
    lastOptionsChannel = composer.channel;
    lastGeneratedComposer = composer;
    debugLog('parsed_options', lastOptions);

    if (!lastOptions.length) throw new Error('OpenAI did not return any usable options.');

    renderOptions(lastOptions, composer.channel);
    showBoxStatus(`Ready: ${lastOptions.length} ${composer.channel.toUpperCase()} options.`, 'ready');
    lastGeneratedStepId = selectedStep.id;
    lastGeneratedTicketId = context.ticket.ticketId || '';

    if (box) {
      box.dataset.composerId = composer.id;
      box.dataset.channel = composer.channel;
      box.dataset.generatedStepId = selectedStep.id;
      box.dataset.ticketId = context.ticket.ticketId || box.dataset.ticketId || '';
      updateSelectedStep(box);
    }
  }

  function renderOptions(options, channel) {
    const box = document.getElementById(BOX_ID);
    if (!box) return;

    const target = box.querySelector('.tm-az-ai-options');
    target.innerHTML = '';

    options.forEach((option, index) => {
      const card = document.createElement('article');
      card.className = 'tm-az-ai-option';

      const title = document.createElement('div');
      title.className = 'tm-az-ai-option-title';
      title.textContent = option.title || `Option ${index + 1}`;
      card.appendChild(title);

      if (channel === 'email' && option.subject) {
        const subject = document.createElement('div');
        subject.className = 'tm-az-ai-option-subject';
        subject.textContent = option.subject;
        card.appendChild(subject);
      }

      const body = document.createElement('textarea');
      body.className = 'tm-az-ai-option-body';
      body.rows = channel === 'sms' ? 4 : 7;
      body.value = option.body || '';
      body.addEventListener('input', () => {
        option.body = body.value;
      });
      card.appendChild(body);

      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'tm-az-ai-use';
      use.textContent = 'Use this';
      use.addEventListener('click', () => {
        const edited = {
          ...option,
          body: body.value
        };
        useOption(edited).catch((err) => handleInsertionError(err, edited));
      });
      card.appendChild(use);

      target.appendChild(card);
    });
  }

  async function useOption(option) {
    const boxChannel = document.getElementById(BOX_ID)?.dataset.channel || '';
    const rememberedComposer = isComposerUsable(lastGeneratedComposer) &&
      (!boxChannel || lastGeneratedComposer.channel === boxChannel)
      ? lastGeneratedComposer
      : null;
    const composer = rememberedComposer || findComposerContext() || activeComposer;
    if (!composer) throw new Error('Could not find the current email/SMS composer.');

    debugLog('insertion_target', describeComposer(composer));
    const inserted = insertDraftIntoComposer(composer, option);
    if (!inserted) {
      const fallback = composer.channel === 'email' && option.subject
        ? `Subject: ${option.subject}\n\n${option.body}`
        : option.body;
      await copyText(fallback);
      throw new Error('Could not paste into the AgencyZoom composer. The draft was copied to clipboard instead.');
    }

    debugLog('draft_inserted', {
      channel: composer.channel,
      title: option.title,
      subject: composer.channel === 'email' ? option.subject : ''
    });
    rememberPendingSend(composer);
    showBoxStatus('Inserted into the current composer.', 'ready');
  }

  function rememberPendingSend(composer) {
    const box = document.getElementById(BOX_ID);
    const stepId = box?.dataset.generatedStepId || lastGeneratedStepId || selectedStepId;
    const ticketId = box?.dataset.ticketId || lastGeneratedTicketId || getTicketDetailsForComposer(composer).ticketId || '';
    if (!ticketId || !composer?.channel || !stepId) {
      pendingSendMemory = null;
      debugLog('pending_sent_memory_skipped', { ticketId, channel: composer?.channel || '', stepId });
      return;
    }

    pendingSendMemory = {
      ticketId,
      channel: composer.channel,
      stepId,
      composerId: composer.id,
      insertedAt: new Date().toISOString()
    };
    debugLog('pending_sent_memory_ready', pendingSendMemory);
  }

  function handleDocumentClickForSendMemory(event) {
    if (!isLeadPipelinePage()) return;

    const target = event.target;
    if (!target || isAiElement(target)) return;

    const control = findClickedActionControl(target);
    if (!control || isAiElement(control) || !isSendActionElement(control)) return;

    const composer = findComposerContext();
    if (!composer || !composer.root || !composer.root.contains(control)) return;

    const pending = pendingSendMemory && pendingSendMemory.channel === composer.channel
      ? pendingSendMemory
      : null;
    const ticket = getTicketDetailsForComposer(composer);
    const ticketId = pending?.ticketId || ticket.ticketId || '';
    const stepId = pending?.stepId || selectedStepId;

    if (!ticketId || !stepId) {
      debugLog('sent_memory_not_marked_missing_context', {
        ticketId,
        stepId,
        channel: composer.channel,
        control: summarizeElement(control)
      });
      return;
    }

    markSentStep(ticketId, composer.channel, stepId);
    pendingSendMemory = null;
    updateSelectedStep(document.getElementById(BOX_ID));
    debugLog('sent_memory_marked_from_send_click', {
      ticketId,
      channel: composer.channel,
      stepId,
      control: summarizeElement(control)
    });
  }

  function findClickedActionControl(target) {
    if (!target?.closest) return null;
    return target.closest('button, a, input[type="button"], input[type="submit"], [role="button"]') ||
      target.closest('i');
  }

  function findSendActionElement(root) {
    const preferred = safeQueryAll(root, [
      '#sendEmail',
      '#sendSms',
      '#sendSMS',
      '#sendText',
      'button[id*="send"]',
      'a[id*="send"]',
      'input[id*="send"]',
      'button[class*="send"]',
      'a[class*="send"]',
      'input[class*="send"]',
      'button',
      'a',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]'
    ].join(','));

    return preferred.find((el) => !isAiElement(el) && isVisible(el) && isSendActionElement(el)) || null;
  }

  function isSendActionElement(el) {
    const signature = lower([
      el.id,
      el.className,
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('title'),
      el.getAttribute?.('data-original-title'),
      el.getAttribute?.('data-action'),
      el.value,
      el.textContent
    ].filter(Boolean).join(' '));

    return /\bsend\b|sendemail|sendsms|btn-send|paper-plane|fa-paper-plane/.test(signature);
  }

  function isComposerUsable(composer) {
    if (!composer || !composer.root || !composer.bodyField) return false;
    const target = composer.bodyField.iframe || composer.bodyField.el;
    return composer.root.isConnected &&
      (!target || target.isConnected !== false) &&
      (isVisible(composer.root) || isVisible(target));
  }

  function insertDraftIntoComposer(composer, option) {
    let bodyOk = false;
    let subjectOk = true;

    if (composer.channel === 'email' && option.subject && composer.subjectField) {
      subjectOk = setFieldValue(composer.subjectField, option.subject);
    }

    if (composer.bodyField) {
      bodyOk = setFieldValue(composer.bodyField, option.body || '', { richEmail: composer.channel === 'email' });
    }

    return bodyOk && subjectOk;
  }

  async function collectTicketContext(composer = null) {
    const root = findOpenTicketRoot(composer);
    if (!root) throw new Error('Could not find the open AgencyZoom ticket/Activities area.');

    const activityScope = findActivityScope(root) || root;
    const activities = extractActivityItems(activityScope);
    const activityText = limitText(
      activities.map((item) => {
        const stamp = item.timestamp ? ` - ${item.timestamp}` : '';
        return `[${item.index}] ${item.kind}${stamp}\n${item.text}`;
      }).join('\n\n'),
      MAX_ACTIVITY_CHARS
    );

    const context = {
      source: 'AgencyZoom visible Activities tab',
      collectedAt: new Date().toISOString(),
      pageUrl: location.href,
      ticket: extractTicketDetails(root),
      composer: composer ? {
        channel: composer.channel,
        existingText: getFieldText(composer.bodyField)
      } : null,
      activities,
      activityText,
      warnings: buildContextWarnings(activities, activityText)
    };

    debugLog('collected_ticket_context', context);
    return context;
  }

  function buildContextWarnings(activities, activityText) {
    const warnings = [];
    if (!activities.length) warnings.push('No individual activity cards were detected; fallback text extraction was used.');
    if (activityText.length >= MAX_ACTIVITY_CHARS) warnings.push('Activity text was truncated before sending to OpenAI.');
    return warnings;
  }

  function findOpenTicketRoot(composer = null) {
    const candidates = uniqueElements([
      document.querySelector('.az-dock__container'),
      document.querySelector('.az-dock'),
      document.querySelector('#detailDockform')?.closest?.('.az-dock__container, .az-dock'),
      document.querySelector('#detailDockform'),
      findElementByAttrContains('id', 'activit')?.closest?.('.az-dock__container, .az-dock, main, .content-wrapper, .page-content, .container-fluid'),
      findElementByAttrContains('class', 'activit')?.closest?.('.az-dock__container, .az-dock, main, .content-wrapper, .page-content, .container-fluid'),
      document.querySelector('main'),
      document.querySelector('#content'),
      document.querySelector('.content-wrapper'),
      document.querySelector('.main-content'),
      document.querySelector('.page-content'),
      document.querySelector('.container-fluid'),
      document.body
    ].filter(Boolean)).filter((root) => {
      if (isAiElement(root)) return false;
      if (composer && root === composer.root) return false;
      return clean(getVisibleText(root)).length > 40;
    });

    return candidates
      .map((root) => ({ root, score: scoreTicketRoot(root) }))
      .sort((a, b) => b.score - a.score)[0]?.root || null;
  }

  function scoreTicketRoot(root) {
    const attrs = lower([root.id, root.className, root.getAttribute('aria-label')].filter(Boolean).join(' '));
    const text = lower(getVisibleText(root)).slice(0, 5000);

    let score = 0;
    if (root.matches && root.matches('.az-dock__container, .az-dock')) score += 30;
    if (attrs.includes('lead') || attrs.includes('ticket') || attrs.includes('detail')) score += 12;
    if (attrs.includes('activit') || text.includes('activities')) score += 20;
    if (attrs.includes('timeline') || text.includes('timeline')) score += 10;
    if (/\b(email|sms|text|call|note|task|status|voicemail)\b/.test(text)) score += 8;
    if (root === document.body) score -= 8;
    score += Math.min(12, Math.floor(clean(text).length / 300));
    return score;
  }

  function findActivityScope(root) {
    const selectors = [
      '.tab-pane.active',
      '.tab-content .active',
      '[role="tabpanel"]',
      '#activities',
      '#activity',
      '[id*="Activities"]',
      '[id*="activities"]',
      '[id*="Activity"]',
      '[id*="activity"]',
      '[class*="activities"]',
      '[class*="activity"]',
      '[class*="timeline"]'
    ].join(',');

    const candidates = safeQueryAll(root, selectors)
      .filter((el) => !isAiElement(el) && clean(getVisibleText(el)).length > 30)
      .map((el) => ({ el, score: scoreActivityScope(el) }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.el || root;
  }

  function scoreActivityScope(el) {
    const attrs = lower([el.id, el.className, el.getAttribute('aria-label'), el.getAttribute('data-tab')].filter(Boolean).join(' '));
    const text = lower(getVisibleText(el)).slice(0, 2500);

    let score = 0;
    if (attrs.includes('activit')) score += 20;
    if (attrs.includes('timeline')) score += 12;
    if (text.includes('activity')) score += 8;
    if (/\b(email|sms|text|call|note|task|status|voicemail)\b/.test(text)) score += 7;
    score += Math.min(12, Math.floor(clean(text).length / 250));
    return score;
  }

  function extractActivityItems(scope) {
    const elements = collectActivityElements(scope);
    const activities = [];
    const seen = new Set();

    for (const el of elements) {
      const text = limitText(normalizeMultiline(getVisibleText(el)), 1400);
      if (text.length < 18) continue;

      const fingerprint = clean(text).toLowerCase().slice(0, 700);
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      activities.push({
        index: activities.length + 1,
        kind: extractActivityKind(text),
        timestamp: extractActivityTimestamp(text),
        text
      });

      if (activities.length >= MAX_ACTIVITY_ITEMS) break;
    }

    if (activities.length) return activities;

    const fallback = limitText(normalizeMultiline(getVisibleText(scope)), MAX_ACTIVITY_CHARS);
    return fallback ? [{
      index: 1,
      kind: 'Activity timeline',
      timestamp: '',
      text: fallback
    }] : [];
  }

  function collectActivityElements(scope) {
    const selectors = [
      '#pinTopTimelineCard .lead-note',
      '.lead-note',
      '.timeline-card',
      '.timeline-item',
      '.az-timeline-card',
      '.activity-item',
      '.activity-card',
      '.lead-activity',
      '.task-item',
      '[data-activity-id]',
      '[class*="timeline"] .az-defcard',
      '[class*="activity"] .az-defcard',
      '.az-defcard'
    ].join(',');

    const elements = uniqueElements(safeQueryAll(scope, selectors))
      .filter((el) => !isAiElement(el) && clean(getVisibleText(el)).length > 18);

    return elements.filter((el) => {
      return !elements.some((other) => {
        if (other === el || !el.contains(other)) return false;
        const outer = clean(getVisibleText(el)).length;
        const inner = clean(getVisibleText(other)).length;
        return inner > 18 && outer > inner + 35;
      });
    });
  }

  function extractActivityKind(text) {
    const raw = lower(text);
    if (raw.includes('email')) return 'Email';
    if (raw.includes('sms') || raw.includes('text message') || raw.includes('texted')) return 'SMS';
    if (raw.includes('call') || raw.includes('voicemail')) return 'Call';
    if (raw.includes('note')) return 'Note';
    if (raw.includes('task')) return 'Task';
    if (raw.includes('status')) return 'Status update';
    return 'Activity';
  }

  function extractActivityTimestamp(text) {
    const raw = clean(text);
    const match = raw.match(/\b(?:\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}?)(?:\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i);
    return match ? match[0] : '';
  }

  function extractTicketDetails(root) {
    const text = normalizeMultiline(getVisibleText(root));
    const titleEl = [
      '.az-dock__title',
      '.dock-title',
      '.customer-name',
      '.lead-name',
      'h1',
      'h2',
      'h3'
    ].map((selector) => root.querySelector(selector)).find(Boolean);

    return {
      ticketId: clean(readValue(root, 'input[name="id"], input[name="leadId"], input[name="CustomerReferral[id]"]')) || extractTicketIdFromRoot(root),
      name: clean(titleEl?.textContent || ''),
      email: extractFirstEmail(text),
      phone: extractFirstPhone(text),
      visibleSummary: limitText(text, 3500)
    };
  }

  function getTicketDetailsForComposer(composer) {
    const root = findOpenTicketRoot(composer);
    return root ? extractTicketDetails(root) : {
      ticketId: '',
      name: '',
      email: '',
      phone: '',
      visibleSummary: ''
    };
  }

  function extractTicketIdFromRoot(root) {
    const html = String(root?.innerHTML || '');
    const patterns = [
      /TaskModel\.init\(\{leadId:\s*(\d{5,})/i,
      /data-referralid=["'](\d{5,})["']/i,
      /data-sourceleadid=["'](\d{5,})["']/i,
      /CustomerReferral\[id\][^>]*value=["'](\d{5,})["']/i,
      /"id"\s*:\s*(\d{5,})/i,
      /\bleadId\s*[:=]\s*(\d{5,})/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return clean(match[1]);
    }
    return '';
  }

  function getSentMemory() {
    const parsed = parseJson(storageGet(STORAGE_KEYS.sentMemory, '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  }

  function saveSentMemory(memory) {
    storageSet(STORAGE_KEYS.sentMemory, JSON.stringify(memory || {}));
  }

  function sentMemoryKey(ticketId, channel, stepId) {
    const cleanTicketId = clean(ticketId);
    const cleanChannel = lower(channel);
    const cleanStepId = normalizeStepId(stepId);
    if (!cleanTicketId || !cleanChannel || !cleanStepId) return '';
    return `${cleanTicketId}|${cleanChannel}|${cleanStepId}`;
  }

  function isStepSent(ticketId, channel, stepId) {
    const key = sentMemoryKey(ticketId, channel, stepId);
    if (!key) return false;
    return !!getSentMemory()[key];
  }

  function markSentStep(ticketId, channel, stepId) {
    const key = sentMemoryKey(ticketId, channel, stepId);
    if (!key) return false;

    const memory = getSentMemory();
    memory[key] = {
      ticketId: clean(ticketId),
      channel: lower(channel),
      stepId: normalizeStepId(stepId),
      sentAt: new Date().toISOString()
    };
    saveSentMemory(memory);
    return true;
  }

  function clearSentStep(ticketId, channel, stepId) {
    const key = sentMemoryKey(ticketId, channel, stepId);
    if (!key) return false;

    const memory = getSentMemory();
    delete memory[key];
    saveSentMemory(memory);
    return true;
  }

  function findComposerContext() {
    const candidates = collectComposerCandidates()
      .map((candidate) => buildComposerContext(candidate.root, candidate.field, candidate.sourceScore))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return candidates[0] || null;
  }

  function collectComposerCandidates() {
    const candidates = [];
    const active = document.activeElement;
    if (active && !isAiElement(active)) {
      const activeRoot = active.closest?.('#emailForm, #smsForm, form[action*="/common/email/send"], form[action*="email/send"], form[action*="sms"], form[action*="SMS"], .modal, .popover, form, [class*="compose"], [id*="compose"]');
      if (activeRoot) candidates.push({ root: activeRoot, field: null, sourceScore: 15 });
    }

    for (const field of getEditableFields(document.body)) {
      if (isSubjectLike(field) || isRecipientLike(field)) continue;
      const root = findComposerRootForField(field);
      if (root) candidates.push({ root, field, sourceScore: 12 });
    }

    for (const root of safeQueryAll(document, [
      '#emailForm',
      'form[action*="/common/email/send"]',
      'form[action*="email/send"]',
      '#smsForm',
      'form[action*="sms"]',
      'form[action*="SMS"]'
    ].join(','))) {
      candidates.push({ root, field: null, sourceScore: 45 });
    }

    for (const root of safeQueryAll(document, [
      '.modal',
      '.popover',
      '.panel',
      'form',
      '#emailForm',
      '[id*="dockEmail"]',
      '[id*="dockSms"]',
      '[id*="email"]',
      '[id*="Email"]',
      '[class*="email"]',
      '[class*="Email"]',
      '[id*="sms"]',
      '[id*="SMS"]',
      '[class*="sms"]',
      '[class*="SMS"]',
      '[id*="compose"]',
      '[id*="Compose"]',
      '[class*="compose"]',
      '[class*="Compose"]',
      '[id*="message"]',
      '[id*="Message"]',
      '[class*="message"]',
      '[class*="Message"]'
    ].join(','))) {
      candidates.push({ root, field: null, sourceScore: 0 });
    }

    return uniqueComposerCandidates(candidates).filter(({ root, field, sourceScore }) => {
      const fieldEl = field?.iframe || field?.el || null;
      if (!root || isAiElement(root) || (!isVisible(root) && !isVisible(fieldEl))) return false;
      if (field && sourceScore > 0) return true;
      const text = lower(getVisibleText(root)).slice(0, 3000);
      const attrs = lower([root.id, root.className, root.getAttribute('aria-label')].filter(Boolean).join(' '));
      return /email|sms|text|message|compose|subject|recipient|send/.test(`${attrs} ${text}`);
    });
  }

  function findComposerRootForField(field) {
    const el = field.iframe || field.el;
    return el.closest?.([
      '#emailForm',
      'form[action*="/common/email/send"]',
      'form[action*="email/send"]',
      '#smsForm',
      'form[action*="sms"]',
      'form[action*="SMS"]',
      '.modal',
      '.popover',
      '.panel',
      'form',
      '[id*="email"]',
      '[id*="Email"]',
      '[class*="email"]',
      '[class*="Email"]',
      '[id*="sms"]',
      '[id*="SMS"]',
      '[class*="sms"]',
      '[class*="SMS"]',
      '[id*="compose"]',
      '[id*="Compose"]',
      '[class*="compose"]',
      '[class*="Compose"]',
      '[id*="message"]',
      '[id*="Message"]',
      '[class*="message"]',
      '[class*="Message"]'
    ].join(',')) || el.closest?.('body') || null;
  }

  function uniqueComposerCandidates(candidates) {
    const byRoot = new Map();
    for (const candidate of candidates) {
      if (!candidate.root) continue;
      const existing = byRoot.get(candidate.root);
      if (!existing ||
          candidate.sourceScore > existing.sourceScore ||
          (!existing.field && candidate.field)) {
        byRoot.set(candidate.root, candidate);
      }
    }

    const seen = new Set();
    const unique = [];
    for (const candidate of byRoot.values()) {
      if (!candidate.root || seen.has(candidate.root)) continue;
      seen.add(candidate.root);
      unique.push(candidate);
    }
    return unique;
  }

  function buildComposerContext(root, preferredBodyField = null, sourceScore = 0) {
    const bodyField = preferredBodyField || findBodyField(root);
    if (!bodyField) return null;

    const subjectField = findSubjectField(root);
    const channel = detectComposerChannel(root, bodyField, subjectField);
    if (!channel) return null;
    if (!isSendComposerRoot(root, channel, bodyField, subjectField)) return null;

    const score = scoreComposerRoot(root, channel, bodyField, subjectField) + sourceScore;
    if (score < 22) return null;

    return {
      id: getStableElementId(root),
      root,
      channel,
      bodyField,
      subjectField,
      score
    };
  }

  function isSendComposerRoot(root, channel, bodyField, subjectField) {
    const rootText = lower(getVisibleText(root)).slice(0, 3000);
    const rootAttrs = lower([
      root.id,
      root.className,
      root.getAttribute('aria-label'),
      root.getAttribute('title')
    ].filter(Boolean).join(' '));
    const bodyAttrs = lower([
      bodyField.el.getAttribute?.('placeholder'),
      bodyField.el.getAttribute?.('aria-label'),
      bodyField.el.getAttribute?.('name'),
      bodyField.el.getAttribute?.('id'),
      bodyField.el.className
    ].filter(Boolean).join(' '));
    const combined = `${rootAttrs} ${bodyAttrs} ${rootText}`;
    const smsLike = /\bsms\b|text message|send sms|send text|characters remaining|char(?:acter)? limit/.test(combined);
    const richEmailLike = isRichEmailComposer(root, bodyField);

    const hasSend = /\bsend\b|send email|send sms|send text|compose|reply/.test(combined) ||
      !!findVisibleButtonByText(root, ['send', 'send email', 'send sms', 'send text']) ||
      hasSendControl(root);

    if (channel === 'sms') {
      return hasSend && smsLike;
    }

    if (channel === 'email') {
      return hasSend && !smsLike && (subjectField || richEmailLike || /\bemail\b|send email|subject|cc:|bcc:|recipient/.test(combined));
    }

    return false;
  }

  function isRichEmailComposer(root, bodyField) {
    if (!bodyField) return false;
    if (bodyField.type === 'iframe') return true;
    if (bodyField.type === 'contenteditable') return true;
    if (safeQueryAll(root, '.ql-toolbar, .ql-container, .note-editor, .tox-tinymce, [class*="wysiwyg"], [class*="rich-text"]').length) return true;
    const rect = bodyField.iframe?.getBoundingClientRect?.() || bodyField.el.getBoundingClientRect?.() || { height: 0 };
    return bodyField.el.tagName === 'TEXTAREA' && rect.height >= 110;
  }

  function findVisibleButtonByText(root, values) {
    const wanted = values.map(lower);
    return safeQueryAll(root, 'button, a, input[type="button"], input[type="submit"], [role="button"]')
      .find((el) => {
        if (isAiElement(el) || !isVisible(el)) return false;
        const text = lower(el.value || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
        return wanted.some((value) => text === value || text.includes(value));
      }) || null;
  }

  function hasSendControl(root) {
    return !!safeQueryAll(root, 'button, a, input[type="button"], input[type="submit"], [role="button"], i')
      .find((el) => {
        if (isAiElement(el) || !isVisible(el)) return false;
        const signature = lower([
          el.id,
          el.className,
          el.getAttribute?.('aria-label'),
          el.getAttribute?.('title'),
          el.getAttribute?.('data-original-title'),
          el.getAttribute?.('data-action'),
          el.value,
          el.textContent
        ].filter(Boolean).join(' '));
        return /\bsend\b|paper-plane|fa-paper-plane|btn-send|sendemail|sendsms/.test(signature);
      });
  }

  function findBodyField(root) {
    const fields = getEditableFields(root)
      .filter((field) => !isSubjectLike(field) && !isRecipientLike(field))
      .map((field) => ({ field, score: scoreBodyField(field) }))
      .sort((a, b) => b.score - a.score);

    return fields[0]?.field || null;
  }

  function getEditableFields(root) {
    const fields = [];

    for (const el of safeQueryAll(root, 'textarea, input[type="text"], input:not([type]), [contenteditable="true"], .ql-editor[contenteditable="true"]')) {
      if (isAiElement(el) || !isVisible(el) || isHiddenInput(el)) continue;
      fields.push(wrapField(el));
    }

    for (const iframe of safeQueryAll(root, 'iframe')) {
      const wrapped = wrapIframeField(iframe);
      if (wrapped) fields.push(wrapped);
    }

    return fields;
  }

  function wrapField(el) {
    return {
      type: el.matches('.ql-editor, [contenteditable="true"]') ? 'contenteditable' : 'input',
      el,
      wrapper: el.closest('.form-group, .input-group, .ql-container, .editor, .compose-body') || el
    };
  }

  function wrapIframeField(iframe) {
    if (isAiElement(iframe) || !isVisible(iframe)) return null;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      const body = doc?.body;
      if (!body) return null;
      const cke = iframe.closest('.cke');
      const editable = body.isContentEditable ||
        body.getAttribute?.('contenteditable') === 'true' ||
        lower(doc.designMode) === 'on' ||
        !!body.querySelector?.('[contenteditable="true"]');
      if (!editable && !cke) return null;

      const editorGroup = cke?.closest?.('.az-form-group, .form-group') || cke;
      return {
        type: 'iframe',
        el: body,
        iframe,
        wrapper: editorGroup || iframe.closest('.form-group, .editor, .compose-body') || iframe
      };
    } catch {
      return null;
    }
  }

  function findSubjectField(root) {
    const selectors = [
      'input[name*="subject"]',
      'input[name*="Subject"]',
      'input[id*="subject"]',
      'input[id*="Subject"]',
      'input[placeholder*="subject"]',
      'input[placeholder*="Subject"]',
      'textarea[name*="subject"]',
      'textarea[name*="Subject"]',
      'textarea[id*="subject"]',
      'textarea[id*="Subject"]'
    ].join(',');

    return safeQueryAll(root, selectors)
      .filter((el) => !isAiElement(el) && isVisible(el))
      .map(wrapField)[0] || null;
  }

  function detectComposerChannel(root, bodyField, subjectField) {
    const attrs = lower([
      root.id,
      root.className,
      root.getAttribute('aria-label'),
      bodyField.el.getAttribute?.('placeholder'),
      bodyField.el.getAttribute?.('name'),
      bodyField.el.getAttribute?.('id')
    ].filter(Boolean).join(' '));
    const text = lower(getVisibleText(root)).slice(0, 2000);
    const combined = `${attrs} ${text}`;
    const maxLength = Number(bodyField.el.getAttribute?.('maxlength') || 0);
    const smsScore = scoreSmsEvidence(combined, bodyField, maxLength);
    const emailScore = scoreEmailEvidence(combined, subjectField);
    const hasSend = /\bsend\b|compose|reply/.test(combined) ||
      !!findVisibleButtonByText(root, ['send', 'send email']) ||
      hasSendControl(root);
    const richEmailLike = isRichEmailComposer(root, bodyField);

    if (smsScore >= 10 && smsScore >= emailScore) return 'sms';
    if (emailScore >= 10) return 'email';
    if (smsScore >= 8) return 'sms';
    if (hasSend && richEmailLike && smsScore < 10) return 'email';

    if (maxLength > 0 && maxLength <= 800) return 'sms';
    return null;
  }

  function scoreSmsEvidence(combined, bodyField, maxLength) {
    let score = 0;
    if (/\bsms\b/.test(combined)) score += 18;
    if (/text message|texting|characters remaining|char(?:acter)? limit/.test(combined)) score += 16;
    if (/\bmessage\b/.test(combined)) score += 4;
    if (maxLength > 0 && maxLength <= 800) score += 18;
    const rows = Number(bodyField.el.getAttribute?.('rows') || 0);
    if (bodyField.el.tagName === 'TEXTAREA' && rows > 0 && rows <= 5) score += 8;
    return score;
  }

  function scoreEmailEvidence(combined, subjectField) {
    let score = 0;
    if (subjectField) score += 28;
    if (/\bemail\b|e-mail/.test(combined)) score += 10;
    if (/\bsubject\b|cc:|bcc:|recipient/.test(combined)) score += 14;
    if (/\bto:/.test(combined)) score += 4;
    return score;
  }

  function scoreComposerRoot(root, channel, bodyField, subjectField) {
    const attrs = lower([root.id, root.className, root.getAttribute('aria-label')].filter(Boolean).join(' '));
    const text = lower(getVisibleText(root)).slice(0, 2500);
    let score = 0;

    if (attrs.includes(channel)) score += 15;
    if (attrs.includes('compose') || text.includes('compose')) score += 8;
    if (text.includes('send')) score += 10;
    if (channel === 'email' && subjectField) score += 20;
    if (channel === 'sms' && /\bsms\b|text message|characters remaining/.test(`${attrs} ${text}`)) score += 20;
    if (bodyField.type === 'contenteditable' || bodyField.type === 'iframe') score += 6;
    score += Math.min(10, Math.floor((bodyField.el.getBoundingClientRect?.().height || 0) / 20));
    return score;
  }

  function scoreBodyField(field) {
    const el = field.el;
    const attrs = lower([
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.className
    ].filter(Boolean).join(' '));
    const rect = field.iframe?.getBoundingClientRect?.() || el.getBoundingClientRect?.() || { height: 0, width: 0 };
    let score = 0;

    if (field.type === 'contenteditable' || field.type === 'iframe') score += 20;
    if (el.tagName === 'TEXTAREA') score += 18;
    if (attrs.includes('message') || attrs.includes('body') || attrs.includes('sms') || attrs.includes('email')) score += 18;
    if (attrs.includes('subject') || attrs.includes('search') || attrs.includes('recipient')) score -= 40;
    score += Math.min(18, Math.floor(rect.height / 12));
    score += Math.min(10, Math.floor(rect.width / 80));
    return score;
  }

  function isSubjectLike(field) {
    const el = field.el;
    const attrs = lower([
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.className
    ].filter(Boolean).join(' '));
    return attrs.includes('subject');
  }

  function isRecipientLike(field) {
    const el = field.el;
    const attrs = lower([
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('aria-label'),
      el.getAttribute?.('name'),
      el.getAttribute?.('id'),
      el.className
    ].filter(Boolean).join(' '));
    return /\b(to|cc|bcc|recipient|search|phone|email address)\b/.test(attrs);
  }

  function isHiddenInput(el) {
    return el.tagName === 'INPUT' && /hidden|checkbox|radio|submit|button|file/i.test(el.getAttribute('type') || '');
  }

  async function loadPromptFor(channel, step) {
    const rawSheetUrl = DEFAULT_PROMPT_SHEET_URL;
    if (!rawSheetUrl) {
      debugLog('prompt_sheet_missing', {});
      throw new Error('Prompt Sheet URL is not configured in the script.');
    }

    const sheetUrl = toGoogleSheetCsvUrl(rawSheetUrl);
    debugLog('prompt_sheet_fetch_start', { configuredUrl: rawSheetUrl, fetchUrl: sheetUrl });
    const response = await httpRequest({ method: 'GET', url: sheetUrl });
    const status = Number(response.status || 0);
    const csv = String(response.responseText || response.response || '');
    debugLog('prompt_sheet_fetch_result', {
      status,
      characters: csv.length,
      preview: csv.slice(0, 240)
    });

    if (status < 200 || status >= 300) throw new Error(`Could not read prompt Sheet CSV. HTTP ${status}`);
    if (looksLikeHtml(csv)) {
      throw new Error('Prompt Sheet URL returned HTML instead of CSV. Publish/share the sheet or use the export CSV URL.');
    }

    const rows = parseCsv(csv).map(normalizePromptRow);
    const selectedStep = normalizeStep(step);
    const wantedDay = normalizePromptDay(selectedStep.sheetDay);
    const wantedChannel = lower(channel);
    const matched = rows.find((row) => {
      return row.workflow === WORKFLOW &&
        normalizePromptDay(row.day) === wantedDay &&
        row.channel === wantedChannel &&
        row.system_prompt &&
        row.user_prompt;
    });

    debugLog('prompt_rows_loaded', {
      count: rows.length,
      available: rows.map((row) => ({
        workflow: row.workflow,
        day: row.day,
        channel: row.channel
      })).slice(0, 30)
    });
    debugLog('prompt_row_match', { step: selectedStep, day: selectedStep.sheetDay, channel: wantedChannel, found: !!matched, row: matched || null });
    if (!matched) {
      throw new Error(`No prompt row found for workflow=${WORKFLOW}, day=${selectedStep.sheetDay}, channel=${wantedChannel}.`);
    }

    return matched;
  }

  function normalizePromptRow(row) {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizePromptKey(key)] = cleanPreserveLines(stripBom(value));
    }
    return {
      workflow: lower(normalized.workflow),
      day: clean(normalized.day),
      channel: lower(normalized.channel),
      system_prompt: normalized.system_prompt || '',
      user_prompt: normalized.user_prompt || ''
    };
  }

  function normalizePromptKey(key) {
    return lower(stripBom(key)).replace(/\s+/g, '_');
  }

  function normalizePromptDay(value) {
    const text = clean(value);
    const key = normalizeKey(text);
    if (['first_quote', 'initial_quote', 'quote_ready', 'quote'].includes(key)) return 'first_quote';
    const match = text.match(/\d+/);
    return match ? String(Number(match[0])) : text;
  }

  function looksLikeHtml(text) {
    return /^\s*<!doctype html/i.test(text) ||
      /^\s*<html[\s>]/i.test(text) ||
      /<title>.*google/i.test(text.slice(0, 1000));
  }

  function toGoogleSheetCsvUrl(url) {
    const raw = clean(url);
    if (!raw) return '';
    if (/\/export\?/i.test(raw) && /format=csv/i.test(raw)) return raw;

    const match = raw.match(/\/spreadsheets\/d\/([^/]+)/i);
    if (!match) return raw;

    let gid = '0';
    try {
      const parsed = new URL(raw);
      gid = parsed.searchParams.get('gid') || (parsed.hash.match(/gid=(\d+)/)?.[1]) || '0';
    } catch {
      gid = raw.match(/[?#&]gid=(\d+)/)?.[1] || '0';
    }

    return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv&gid=${gid}`;
  }

  function parseCsv(csv) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < csv.length; i += 1) {
      const char = csv[i];
      const next = csv[i + 1];

      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
        continue;
      }

      if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (char !== '\r') {
        cell += char;
      }
    }

    row.push(cell);
    rows.push(row);

    const headers = (rows.shift() || []).map((header) => clean(stripBom(header)));
    return rows
      .filter((values) => values.some((value) => clean(value)))
      .map((values) => {
        const object = {};
        headers.forEach((header, index) => {
          object[header] = values[index] || '';
        });
        return object;
      });
  }

  function buildPlaceholders(context, composer, step) {
    const selectedStep = normalizeStep(step);
    return {
      followup_day: selectedStep.followupDay || selectedStep.label,
      workflow_step: selectedStep.id,
      followup_label: selectedStep.label,
      is_first_quote: selectedStep.kind === 'first_quote' ? 'true' : 'false',
      channel: composer.channel,
      today: formatToday(),
      activities: context.activityText || '',
      composer_existing_text: getFieldText(composer.bodyField),
      'ticket.name': context.ticket.name || '',
      'ticket.email': context.ticket.email || '',
      'ticket.phone': context.ticket.phone || '',
      'ticket.ticketId': context.ticket.ticketId || '',
      'ticket.visibleSummary': context.ticket.visibleSummary || ''
    };
  }

  function applyPlaceholders(template, placeholders) {
    return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key) => {
      const normalized = clean(key);
      return Object.prototype.hasOwnProperty.call(placeholders, normalized) ? String(placeholders[normalized]) : match;
    });
  }

  function buildOpenAiPayload(systemPrompt, userPrompt, context, channel, step) {
    const selectedStep = normalizeStep(step);
    return {
      model: clean(storageGet(STORAGE_KEYS.model, DEFAULT_MODEL)) || DEFAULT_MODEL,
      input: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            userPrompt,
            '',
            `Return exactly ${OPTION_COUNT} options as JSON that matches the schema.`,
            '',
            'Gathered AgencyZoom context JSON:',
            JSON.stringify({
              workflow: WORKFLOW,
              workflow_step: selectedStep.id,
              followup_day: selectedStep.followupDay,
              followup_label: selectedStep.label,
              is_first_quote: selectedStep.kind === 'first_quote',
              channel,
              ticket: context.ticket,
              activities: context.activities,
              activityText: context.activityText,
              composer: context.composer,
              warnings: context.warnings
            }, null, 2)
          ].join('\n')
        }
      ],
      max_output_tokens: 1800,
      text: {
        format: {
          type: 'json_schema',
          name: 'agencyzoom_followup_options',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    title: { type: 'string' },
                    subject: { type: 'string' },
                    body: { type: 'string' }
                  },
                  required: ['title', 'subject', 'body']
                }
              }
            },
            required: ['options']
          }
        }
      }
    };
  }

  function buildReadablePayloadSummary(details) {
    const context = details.context;
    const composer = details.composer;
    return {
      request: {
        workflow: WORKFLOW,
        workflowStep: details.step.id,
        followupDay: details.step.followupDay,
        followupLabel: details.step.label,
        isFirstQuote: details.step.kind === 'first_quote',
        channel: composer.channel,
        model: details.payload.model,
        optionCount: OPTION_COUNT,
        pageUrl: context.pageUrl
      },
      composer: {
        detectedChannel: composer.channel,
        existingText: limitText(details.placeholders.composer_existing_text || '', 1200),
        target: describeComposer(composer)
      },
      ticket: {
        id: context.ticket.ticketId || '',
        name: context.ticket.name || '',
        email: context.ticket.email || '',
        phone: context.ticket.phone || '',
        visibleSummary: limitText(context.ticket.visibleSummary || '', 1600)
      },
      activities: {
        count: context.activities.length,
        text: limitText(context.activityText || '', 4000)
      },
      prompts: {
        system: details.systemPrompt,
        user: details.userPrompt
      },
      placeholders: details.placeholders
    };
  }

  function buildCleanOpenAiPayloadText(payload) {
    const systemMessage = payload.input?.find?.((item) => item.role === 'system')?.content || '';
    const userMessage = payload.input?.find?.((item) => item.role === 'user')?.content || '';
    return [
      'OPENAI REQUEST - CLEAN READABLE VERSION',
      '',
      `Endpoint: ${OPENAI_RESPONSES_URL}`,
      `Model: ${payload.model || ''}`,
      `Max output tokens: ${payload.max_output_tokens || ''}`,
      `Response format: ${payload.text?.format?.name || payload.text?.format?.type || ''}`,
      '',
      'SYSTEM PROMPT',
      String(systemMessage || ''),
      '',
      'USER MESSAGE SENT TO OPENAI',
      Array.isArray(userMessage)
        ? userMessage.map((part) => typeof part === 'string' ? part : JSON.stringify(part, null, 2)).join('\n')
        : String(userMessage || '')
    ].join('\n');
  }

  async function requestFollowUpDraft(payload) {
    return requestOpenAiDirect(payload);
  }

  async function requestOpenAiDirect(payload) {
    const apiKey = ensureApiKey();
    if (!apiKey) throw new Error('OpenAI API key not configured.');

    const response = await httpRequest({
      method: 'POST',
      url: OPENAI_RESPONSES_URL,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      data: JSON.stringify(payload)
    });

    debugLog('raw_api_response', {
      status: response.status,
      body: safeParseForDebug(response.responseText || response.response || '')
    });
    return parseResponseBody(response);
  }

  function parseResponseBody(response) {
    const status = Number(response.status || 0);
    const bodyText = String(response.responseText || response.response || '');
    const json = parseJson(bodyText);

    if (status < 200 || status >= 300) {
      const detail = clean(json?.error?.message || bodyText || `HTTP ${status}`);
      throw new Error(`OpenAI request failed: ${detail}`);
    }

    if (!json) throw new Error('The API response was not JSON.');
    if (json.options) return json;
    if (json.error) throw new Error(json.error.message || 'OpenAI returned an error.');

    const outputText = extractOutputText(json);
    const parsed = parseJson(outputText);
    if (!parsed) throw new Error('The response did not contain parseable draft JSON.');
    return parsed;
  }

  function extractOutputText(json) {
    if (typeof json.output_text === 'string') return json.output_text;

    const chunks = [];
    for (const item of Array.isArray(json.output) ? json.output : []) {
      for (const content of Array.isArray(item.content) ? item.content : []) {
        if (typeof content.text === 'string') chunks.push(content.text);
        if (typeof content.output_text === 'string') chunks.push(content.output_text);
      }
    }
    return chunks.join('\n').trim();
  }

  function normalizeOptions(options) {
    return (Array.isArray(options) ? options : [])
      .slice(0, OPTION_COUNT)
      .map((option, index) => ({
        title: clean(option?.title || `Option ${index + 1}`),
        subject: clean(option?.subject || ''),
        body: cleanPreserveLines(option?.body || '')
      }))
      .filter((option) => option.body);
  }

  function httpRequest(details) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          ...details,
          timeout: 60000,
          onload: resolve,
          onerror: () => reject(new Error('Network request failed.')),
          ontimeout: () => reject(new Error('Network request timed out.'))
        });
        return;
      }

      fetch(details.url, {
        method: details.method || 'GET',
        headers: details.headers || {},
        body: details.data,
        credentials: 'omit'
      })
        .then(async (res) => resolve({
          status: res.status,
          responseText: await res.text()
        }))
        .catch(reject);
    });
  }

  function handleGenerationError(err) {
    const message = errorMessage(err);
    debugLog('generation_error', { message });
    showBoxStatus(message, 'error');
    showDebugPanel();
  }

  function handleInsertionError(err, option) {
    const message = errorMessage(err);
    debugLog('insertion_error', { message, option });
    showBoxStatus(message, 'error');
    showDebugPanel();
  }

  function showBoxStatus(message, state = '') {
    const box = document.getElementById(BOX_ID);
    if (!box) {
      alert(message);
      return;
    }

    const status = box.querySelector('.tm-az-ai-status');
    if (!status) return;
    status.className = `tm-az-ai-status ${state ? `tm-az-ai-status-${state}` : ''}`;
    status.textContent = message;
  }

  function toggleDebugPanel() {
    const existing = document.getElementById(DEBUG_PANEL_ID);
    if (existing) {
      existing.remove();
      storageSet(STORAGE_KEYS.debugVisible, '');
      return;
    }
    showDebugPanel();
  }

  function showDebugPanel() {
    storageSet(STORAGE_KEYS.debugVisible, '1');
    renderDebugPanel();
  }

  function renderDebugPanel() {
    let panel = document.getElementById(DEBUG_PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = DEBUG_PANEL_ID;
      panel.className = 'tm-az-ai-debug';
      panel.setAttribute('aria-label', 'AgencyZoom AI debug log');

      const header = document.createElement('div');
      header.className = 'tm-az-ai-debug-header';

      const title = document.createElement('strong');
      title.textContent = 'AZ AI Debug';
      header.appendChild(title);

      const actions = document.createElement('div');
      actions.className = 'tm-az-ai-debug-actions';

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => copyText(formatDebugEntries()));
      actions.appendChild(copy);

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => {
        debugEntries = [];
        renderDebugPanel();
      });
      actions.appendChild(clear);

      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Hide';
      close.addEventListener('click', () => {
        panel.remove();
        storageSet(STORAGE_KEYS.debugVisible, '');
      });
      actions.appendChild(close);

      header.appendChild(actions);

      const pre = document.createElement('pre');
      pre.className = 'tm-az-ai-debug-body';

      panel.appendChild(header);
      panel.appendChild(pre);
      document.body.appendChild(panel);
    }

    const body = panel.querySelector('.tm-az-ai-debug-body');
    if (body) {
      body.textContent = formatDebugEntries();
      body.scrollTop = body.scrollHeight;
    }
  }

  function debugLog(event, data = {}) {
    const entry = {
      at: new Date().toISOString(),
      event,
      data: redactSecrets(data)
    };
    debugEntries.push(entry);
    if (debugEntries.length > 100) debugEntries = debugEntries.slice(-100);
    if (document.getElementById(DEBUG_PANEL_ID)) renderDebugPanel();
    try {
      console.debug('[AZ AI Follow-Up]', event, entry.data);
    } catch {}
  }

  function formatDebugEntries() {
    if (!debugEntries.length) return 'No debug entries yet.';
    return debugEntries.map((entry) => {
      const data = typeof entry.data === 'string'
        ? entry.data
        : JSON.stringify(entry.data, null, 2);
      return `[${entry.at}] ${entry.event}\n${data}`;
    }).join('\n\n');
  }

  function describeComposer(composer) {
    if (!composer) return null;
    return {
      id: composer.id,
      channel: composer.channel,
      root: summarizeElement(composer.root),
      bodyField: summarizeElement(composer.bodyField?.iframe || composer.bodyField?.el),
      subjectField: summarizeElement(composer.subjectField?.el),
      score: composer.score,
      existingTextLength: getFieldText(composer.bodyField).length
    };
  }

  function summarizeElement(el) {
    if (!el) return null;
    return {
      tag: lower(el.tagName || ''),
      id: el.id || '',
      className: clean(String(el.className || '')).slice(0, 160),
      name: el.getAttribute?.('name') || '',
      placeholder: el.getAttribute?.('placeholder') || ''
    };
  }

  function redactSecrets(value) {
    if (value == null) return value;
    if (typeof value === 'string') {
      return value.replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-...REDACTED');
    }
    if (Array.isArray(value)) return value.map(redactSecrets);
    if (typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        if (/authorization|api[_-]?key|token|secret/i.test(key)) {
          out[key] = 'REDACTED';
        } else {
          out[key] = redactSecrets(child);
        }
      }
      return out;
    }
    return value;
  }

  function safeParseForDebug(text) {
    const raw = String(text || '');
    const parsed = parseJson(raw);
    return parsed ? redactSecrets(parsed) : redactSecrets(raw.slice(0, 12000));
  }

  function setFieldValue(field, value, options = {}) {
    if (!field) return false;
    const text = String(value || '');
    const html = options.richEmail ? plainTextToEmailHtml(text) : '';

    if (field.type === 'iframe') {
      const ckeditor = getCkeditorInstance(field);
      if (ckeditor && typeof ckeditor.setData === 'function') {
        ckeditor.setData(html || text);
        try { ckeditor.updateElement(); } catch {}
        try { ckeditor.focus(); } catch {}
        return true;
      }
      return setContentEditableValue(field.el, text, { html });
    }

    const el = field.el;
    if (field.type === 'contenteditable') {
      const quill = getQuillInstance(el);
      if (!html && quill && typeof quill.setText === 'function') {
        quill.setText(text, 'user');
        quill.focus();
        return true;
      }
      return setContentEditableValue(el, text, { html });
    }

    if ('value' in el) {
      el.focus();
      el.value = text;
      emitInput(el);
      return true;
    }

    return false;
  }

  function getCkeditorInstance(field) {
    try {
      const page = getPageWindow();
      const instances = page.CKEDITOR?.instances;
      if (!instances) return null;

      const cke = field.iframe?.closest?.('.cke');
      const className = String(cke?.className || '');
      const match = className.match(/\bcke_editor_([^\s]+)/);
      if (match && instances[match[1]]) return instances[match[1]];

      const priorTextarea = cke?.previousElementSibling;
      if (priorTextarea?.id && instances[priorTextarea.id]) return instances[priorTextarea.id];

      const wrapperTextarea = field.wrapper?.querySelector?.('textarea.rich[id], textarea[id]');
      if (wrapperTextarea?.id && instances[wrapperTextarea.id]) return instances[wrapperTextarea.id];
    } catch {}
    return null;
  }

  function setContentEditableValue(el, value, options = {}) {
    if (!el) return false;
    el.focus();
    if (options.html) {
      el.innerHTML = options.html;
      emitInput(el);
      return true;
    }

    const paragraphs = String(value || '').split(/\n/).map((line) => {
      const div = document.createElement('div');
      div.textContent = line || '\u00a0';
      return div.outerHTML;
    }).join('');
    el.innerHTML = paragraphs || '<div><br></div>';
    emitInput(el);
    return true;
  }

  function plainTextToEmailHtml(value) {
    const text = String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
    if (!text) return '';

    return text.split(/\n{2,}/)
      .map((paragraph) => {
        const lines = paragraph.split(/\n/).map((line) => escapeHtml(line.trimEnd()));
        return `<p>${lines.join('<br>')}</p>`;
      })
      .join('');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function getFieldText(field) {
    if (!field) return '';
    const el = field.el;
    if (field.type === 'iframe') return cleanPreserveLines(el.innerText || el.textContent || '');
    if (field.type === 'contenteditable') return cleanPreserveLines(el.innerText || el.textContent || '');
    return cleanPreserveLines(el.value || el.getAttribute?.('value') || el.textContent || '');
  }

  function getQuillInstance(editor) {
    try {
      const page = getPageWindow();
      if (page.Quill && typeof page.Quill.find === 'function') {
        const direct = page.Quill.find(editor);
        if (direct && typeof direct.setText === 'function') return direct;
        const container = editor.closest('.ql-container');
        const fromContainer = container ? page.Quill.find(container) : null;
        if (fromContainer && typeof fromContainer.setText === 'function') return fromContainer;
      }
    } catch {}
    return editor.__quill || editor.closest?.('.ql-container')?.__quill || null;
  }

  function emitInput(el) {
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }));
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }

    const temp = document.createElement('textarea');
    temp.value = text;
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    temp.className = 'tm-az-ai-temp-copy';
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    temp.remove();
  }

  function ensureApiKey() {
    let apiKey = clean(storageGet(STORAGE_KEYS.apiKey, ''));
    if (apiKey) return apiKey;

    const ok = confirm('OpenAI recommends keeping API keys out of browser/client code. For personal Tampermonkey testing, this can store your key in Tampermonkey storage on this browser. Continue?');
    if (!ok) return '';

    apiKey = clean(prompt('Paste your temporary OpenAI API key:', '') || '');
    if (apiKey) storageSet(STORAGE_KEYS.apiKey, apiKey);
    return apiKey;
  }

  function promptSetOrClearApiKey() {
    const current = clean(storageGet(STORAGE_KEYS.apiKey, ''));
    const masked = current ? `${current.slice(0, 7)}...${current.slice(-4)}` : 'not set';
    const value = prompt(`OpenAI API key (${masked}). Paste a new key, leave blank to clear, or Cancel to keep current:`, '');
    if (value == null) return;
    if (!clean(value)) {
      storageDelete(STORAGE_KEYS.apiKey);
      alert('Stored OpenAI API key cleared.');
      return;
    }

    storageSet(STORAGE_KEYS.apiKey, clean(value));
    alert('OpenAI API key saved in Tampermonkey storage.');
  }

  function promptSetModel() {
    const current = clean(storageGet(STORAGE_KEYS.model, DEFAULT_MODEL)) || DEFAULT_MODEL;
    const value = prompt('OpenAI model for AgencyZoom follow-up drafts:', current);
    if (value == null) return;
    storageSet(STORAGE_KEYS.model, clean(value) || DEFAULT_MODEL);
    alert(`OpenAI model set to ${clean(value) || DEFAULT_MODEL}.`);
  }

  function storageGet(key, fallback = '') {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch {}
    try {
      return localStorage.getItem(key) || fallback;
    } catch {}
    return fallback;
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return;
      }
    } catch {}
    try { localStorage.setItem(key, value); } catch {}
  }

  function storageDelete(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
        return;
      }
    } catch {}
    try { localStorage.removeItem(key); } catch {}
  }

  function parseJson(text) {
    let raw = htmlDecode(String(text || '').trim());
    if (!raw) return null;
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(raw); } catch {}
    try { return JSON.parse(raw.replace(/&quot;/g, '"')); } catch {}

    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try { return JSON.parse(raw.slice(firstBrace, lastBrace + 1)); } catch {}
    }
    return null;
  }

  function readValue(root, selector) {
    const el = root && root.querySelector ? root.querySelector(selector) : null;
    return clean(el && (el.value || el.getAttribute('value') || el.textContent));
  }

  function extractFirstEmail(text) {
    const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0] : '';
  }

  function extractFirstPhone(text) {
    const matches = String(text || '').match(/\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/g) || [];
    return matches.find((value) => normalizePhone(value)) || '';
  }

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits.length === 10 ? digits : '';
  }

  function getStableElementId(el) {
    if (!el) return '';
    if (!el.dataset.tmAzAiComposerId) {
      el.dataset.tmAzAiComposerId = `composer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return el.dataset.tmAzAiComposerId;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom >= 0 &&
      rect.right >= 0 &&
      rect.top <= window.innerHeight &&
      rect.left <= window.innerWidth;
  }

  function isAiElement(el) {
    return !!(el && el.closest && el.closest(`#${BOX_ID}, #${DEBUG_PANEL_ID}, [class*="tm-az-ai"]`));
  }

  function getVisibleText(el) {
    if (!el) return '';
    let target = el;
    if (el.querySelector && el.querySelector(`#${BOX_ID}, #${DEBUG_PANEL_ID}, [class*="tm-az-ai"]`)) {
      target = el.cloneNode(true);
      target.querySelectorAll(`#${BOX_ID}, #${DEBUG_PANEL_ID}, [class*="tm-az-ai"]`).forEach((node) => node.remove());
    }
    return normalizeMultiline(target.innerText || target.textContent || '');
  }

  function normalizeMultiline(value) {
    return String(value == null ? '' : value)
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function cleanPreserveLines(value) {
    return String(value == null ? '' : value)
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stripBom(value) {
    return String(value == null ? '' : value).replace(/^\uFEFF/, '');
  }

  function limitText(value, maxLength) {
    const text = String(value == null ? '' : value);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 18).trim()}... [truncated]`;
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function safeQueryAll(root, selector) {
    if (!root || !root.querySelectorAll) return [];
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (err) {
      debugLog('selector_error', { selector, message: errorMessage(err) });
      return [];
    }
  }

  function findElementByAttrContains(attr, text) {
    const wanted = lower(text);
    const selector = attr === 'class' ? '[class]' : '[id]';
    return safeQueryAll(document, selector).find((el) => lower(el.getAttribute(attr) || '').includes(wanted)) || null;
  }

  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch {}
    return window;
  }

  function formatToday() {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date());
  }

  function getSelectedStep() {
    return normalizeStep(selectedStepId);
  }

  function normalizeStep(value) {
    return STEP_OPTIONS.find((step) => step.id === normalizeStepId(value)) || STEP_OPTIONS[0];
  }

  function normalizeStepId(value) {
    const key = normalizeKey(value);
    if (['first_quote', 'initial_quote', 'quote_ready', 'quote', '0'].includes(key)) return 'first_quote';

    const dayMatch = key.match(/(?:followup_?)?day_?([1-5])$/) || key.match(/^([1-5])$/);
    if (dayMatch) return `followup_day_${dayMatch[1]}`;

    return STEP_OPTIONS.some((step) => step.id === key) ? key : 'first_quote';
  }

  function normalizeKey(value) {
    return lower(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function htmlDecode(text) {
    const ta = document.createElement('textarea');
    ta.innerHTML = String(text || '');
    return ta.value;
  }

  function errorMessage(err) {
    return err && err.message ? err.message : String(err);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tm-az-ai-box {
        box-sizing: border-box;
        width: min(100%, 520px);
        margin: 10px 0;
        padding: 10px;
        border: 1px solid rgba(15, 23, 42, .16);
        border-radius: 8px;
        background: #f8fafc;
        color: #111827;
        box-shadow: 0 8px 22px rgba(15, 23, 42, .12);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tm-az-ai-box-header,
      .tm-az-ai-controls,
      .tm-az-ai-debug-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tm-az-ai-box-header {
        margin-bottom: 8px;
        font-size: 13px;
      }
      .tm-az-ai-channel {
        border-radius: 999px;
        background: #0f766e;
        color: #ffffff;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 700;
      }
      .tm-az-ai-day-table {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
        margin-bottom: 8px;
      }
      .tm-az-ai-day,
      .tm-az-ai-generate,
      .tm-az-ai-use,
      .tm-az-ai-debug button {
        min-height: 28px;
        border: 1px solid rgba(15, 23, 42, .16);
        border-radius: 6px;
        background: #ffffff;
        color: #0f172a;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      .tm-az-ai-day:hover,
      .tm-az-ai-debug button:hover {
        background: #e2e8f0;
      }
      .tm-az-ai-day-active {
        background: #0f766e;
        color: #ffffff;
      }
      .tm-az-ai-day-sent,
      .tm-az-ai-day-sent:hover {
        border-color: rgba(100, 116, 139, .3);
        background: #e5e7eb;
        color: #64748b;
        cursor: not-allowed;
        opacity: .72;
        text-decoration: line-through;
      }
      .tm-az-ai-generate,
      .tm-az-ai-use {
        background: #2563eb;
        color: #ffffff;
        padding: 0 10px;
      }
      .tm-az-ai-generate:hover,
      .tm-az-ai-use:hover {
        background: #1d4ed8;
      }
      .tm-az-ai-status {
        margin-top: 8px;
        padding: 7px 8px;
        border-radius: 6px;
        background: #ffffff;
        color: #475569;
        font-size: 12px;
        line-height: 1.35;
      }
      .tm-az-ai-status-loading {
        background: #eff6ff;
        color: #1e3a8a;
      }
      .tm-az-ai-status-ready {
        background: #ecfdf5;
        color: #065f46;
      }
      .tm-az-ai-status-error {
        background: #fef2f2;
        color: #7f1d1d;
      }
      .tm-az-ai-options {
        display: grid;
        gap: 8px;
        margin-top: 8px;
      }
      .tm-az-ai-option {
        border: 1px solid rgba(15, 23, 42, .12);
        border-radius: 8px;
        background: #ffffff;
        padding: 8px;
      }
      .tm-az-ai-option-title {
        margin-bottom: 5px;
        font-size: 12px;
        font-weight: 800;
        color: #0f172a;
      }
      .tm-az-ai-option-subject {
        margin-bottom: 6px;
        color: #334155;
        font-size: 12px;
        font-weight: 700;
      }
      .tm-az-ai-option-body {
        box-sizing: border-box;
        width: 100%;
        min-height: 78px;
        margin-bottom: 7px;
        border: 1px solid rgba(15, 23, 42, .18);
        border-radius: 6px;
        padding: 7px;
        resize: vertical;
        color: #111827;
        background: #ffffff;
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tm-az-ai-debug {
        position: fixed;
        left: 42px;
        bottom: 58px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        width: min(620px, calc(100vw - 28px));
        max-height: min(720px, calc(100vh - 28px));
        overflow: hidden;
        border: 1px solid rgba(15, 23, 42, .2);
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        box-shadow: 0 18px 50px rgba(15, 23, 42, .28);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .tm-az-ai-debug-header {
        padding: 9px 10px;
        border-bottom: 1px solid rgba(15, 23, 42, .12);
        background: #f8fafc;
        color: #0f172a;
      }
      .tm-az-ai-debug-actions {
        display: flex;
        gap: 5px;
      }
      .tm-az-ai-debug button {
        min-height: 24px;
        border-color: rgba(15, 23, 42, .16);
        background: #ffffff;
        color: #0f172a;
        padding: 0 8px;
      }
      .tm-az-ai-debug-body {
        flex: 1;
        overflow: auto;
        margin: 0;
        padding: 10px;
        background: #ffffff;
        color: #111827;
        white-space: pre-wrap;
        word-break: break-word;
        font: 11px/1.45 Consolas, "Courier New", monospace;
      }
      @media (max-width: 640px) {
        .tm-az-ai-day-table {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .tm-az-ai-debug {
          left: 36px;
          bottom: 50px;
          width: calc(100vw - 44px);
          max-height: calc(100vh - 16px);
        }
      }
    `;
    document.head.appendChild(style);
  }
})();
