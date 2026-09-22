// ==UserScript==
// @name         Ricochet SDR Transfer Script Sync
// @namespace    local.ricochet-sdr-transfer-script-sync
// @version      2.5.0
// @description  Sync the current Ricochet lead into the supplied home/auto SDR transfer guide.
// @author       JKira & Mr.G
// @homepageURL  https://github.com/ugomez809/GIA-TamperMonkey/tree/main/Ricochet/Call%20Script
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Call%20Script/ricochet-sdr-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Call%20Script/ricochet-sdr-sync.user.js
// @match        https://giainc.ricochet.me/*
// @match        https://example.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
'use strict';
function createTemplateLoader({getCache, setCache, download, mount, isBusy, onError}) {
  let current = '', queued = '', checking = false, mounting = false;
  const compatible = html => typeof html === 'string' && /<meta\s+name=["']ricochet-sdr-api["']\s+content=["']1["']\s*\/?\s*>/i.test(html);
  async function apply() {
    if (mounting || !queued || queued === current || (current && isBusy())) return;
    mounting = true;
    const candidate = queued;
    queued = '';
    try {
      await mount(candidate);
      current = candidate;
      setCache(current);
    } catch (error) {
      if (current) {
        try { await mount(current); } catch (rollbackError) { onError(rollbackError); }
      }
      onError(error);
    } finally { mounting = false; }
  }
  async function check() {
    if (checking || mounting) return;
    checking = true;
    try {
      const html = await download();
      if (!compatible(html)) throw new Error('Downloaded guide is missing the supported SDR API marker');
      queued = html === current ? '' : html;
      await apply();
    } catch (error) { onError(error); }
    finally { checking = false; }
  }
  async function start() {
    const cached = getCache();
    if (compatible(cached)) {
      mounting = true;
      try { await mount(cached); current = cached; }
      catch (error) { onError(error); }
      finally { mounting = false; }
    }
    await check();
  }
  return {start, check, apply};
}

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function buildPrefill(lead, sdrName) {
  const data = { sdrName: clean(sdrName), prospect: clean(lead.contact) };
  if (clean(lead.agency)) data.agency = clean(lead.agency).split(/\s+/)[0];
  for (const key of ['last', 'phone', 'dob', 'email', 'vehicles', 'street', 'city', 'state', 'zip', 'spouse', 'carrier', 'occupation', 'miles', 'plumbing', 'business', 'addl', 'proptype', 'built', 'sqft', 'claims']) {
    data[key] = clean(lead[key]);
  }
  const mode = clean(lead.lead).toLowerCase();
  const lob = clean(lead.lob).toLowerCase();
  const owns = clean(lead.owns).toLowerCase();
  if (['old', 'x-date', 'xdate', 'requote'].includes(mode)) data.lead = 'old';
  if (['new', 'new internet lead'].includes(mode)) data.lead = 'new';
  if (['home', 'homeowner', 'homeowners'].includes(lob)) data.lob = 'home';
  if (lob === 'auto') data.lob = 'auto';
  if (owns === 'buying') data.owns = 'buying';
  if (['own', 'owns'].includes(owns)) data.owns = 'owns';
  const vendor = clean(lead.vendor);
  if (vendor) {
    data.lead = /rq-/i.test(vendor) ? 'old' : 'new';
    data.lob = /auto/i.test(vendor) ? 'auto' : 'home';
  }
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== ''));
}

function createDisplaySync() {
  let lastApi, lastKey = '', previous = {};
  return {
    apply(api, payload) {
      if (!api || !['fill', 'get', 'reset'].every(key => typeof api[key] === 'function') || !payload || !payload.leadKey) return false;
      const incoming = payload.prefill || {};
      const changedLead = api !== lastApi || payload.leadKey !== lastKey;
      const delta = {};
      for (const [key, value] of Object.entries(incoming)) {
        if (value == null || value === '') continue;
        if (changedLead || value !== previous[key]) delta[key] = value;
      }
      if (changedLead) api.reset();
      if (changedLead || Object.keys(delta).length) api.fill(delta);
      lastApi = api;
      lastKey = payload.leadKey;
      // Keep the last observed non-empty value across partial DOM updates.
      previous = changedLead ? { ...incoming } : { ...previous, ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value != null && value !== '')) };
      return true;
    }
  };
}


const PAYLOAD_KEY = 'tmRicochetSdrV2Payload';
const HEARTBEAT_KEY = 'tmRicochetSdrV2Heartbeat';
const OPEN_KEY = 'tmRicochetSdrV2OpenRequest';
const REP_KEY = 'tmRicochetCallScriptRep';
const ACTION_KEY = 'tmRicochetSdrAction';
const RESULT_KEY = 'tmRicochetSdrActionResult';
const TEAM_LABELS = {Carlos:'to Carlos Teams', Ulises:'to Ulises Teams', Stefanie:'to Stefanie Teams'};
const DISPLAY_HASH = '#tm-auto-shop-script-window';
const DISPLAY_URL = 'https://example.com/' + DISPLAY_HASH;
const TYPE = 'ricochet-sdr-v2';
const TEMPLATE_URL = 'https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Call%20Script/html/sdr-transfer-script.html';
const TEMPLATE_CACHE_KEY = 'tmRicochetSdrHtmlV1';
const WINDOW_BOUNDS_KEY = 'tmRicochetSdrWindowBounds';

function validWindowBounds(bounds) {
  return bounds && ['left','top','width','height'].every(key => Number.isFinite(bounds[key]))
    && bounds.width >= 100 && bounds.height >= 100 && bounds.width <= 20000 && bounds.height <= 20000
    && Math.abs(bounds.left) < 30000 && Math.abs(bounds.top) < 30000;
}

if (location.hostname === 'example.com' && location.hash === DISPLAY_HASH) startDisplay();
else if (location.hostname === 'giainc.ricochet.me') startController();

function readPayload() {
  try {
    const payload = JSON.parse(GM_getValue(PAYLOAD_KEY, 'null'));
    return payload && payload.type === TYPE && payload.leadKey ? payload : null;
  } catch (_) { return null; }
}

function startDisplay() {
  document.title = 'SDR Transfer Script';
  document.body.replaceChildren();
  const style = document.createElement('style');
  style.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:flex;flex-direction:column}#ricochet-sdr-frame{width:100%;flex:1;min-height:0;border:0}#ricochet-leads{padding:6px 10px;background:#edf3f1;display:flex;gap:6px;flex-wrap:wrap;font:12px system-ui}#ricochet-leads[hidden]{display:none}#ricochet-leads button{font:inherit;padding:5px 9px;border:1px solid #708c80;border-radius:5px;background:white;color:#182e25;cursor:pointer}#ricochet-leads button[aria-pressed=true]{background:#245f48;color:white}#ricochet-sync-status{position:fixed;bottom:8px;left:8px;max-width:calc(100vw - 130px);padding:5px 9px;border-radius:5px;background:#12201ce8;color:white;font:12px system-ui;pointer-events:none;z-index:9999}';
  document.head.appendChild(style);
  const frame = document.createElement('iframe');
  frame.id = 'ricochet-sdr-frame';
  frame.title = 'SDR Transfer Script';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
  const status = document.createElement('div');
  status.id = 'ricochet-sync-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Waiting for Ricochet lead…';
  const switcher = document.createElement('nav');
  switcher.id = 'ricochet-leads';
  switcher.setAttribute('aria-label', 'Switch lead');
  switcher.hidden = true;
  const syncs = new Map(), drafts = new Map();
  let selectedKey = '', activeKey = '', activeApi, choicesSignature = '';
  let focusedLeadKey = '';
  let previousKeys = new Set();
  let pending = readPayload();
  let readyDocument;
  let actionPending;
  const actionMessages = new Map();
  function sendAction(event) {
    const action = event.detail?.action;
    if (!['notify','quote'].includes(action) || actionPending) return;
    const chosen = (pending?.leads || []).find(lead => lead.leadKey === selectedKey);
    if (!chosen || !pending.controllerId) return;
    const agency = chosen.prefill.agency || '';
    if (action === 'notify' && !TEAM_LABELS[agency]) return;
    actionPending = {id:crypto.randomUUID(), controllerId:pending.controllerId, leadKey:selectedKey, agency, action, sentAt:Date.now()};
    actionMessages.set(selectedKey, 'Requesting ' + (action === 'quote' ? 'Quoting / Info Form' : agency + ' Teams') + '…');
    GM_setValue(ACTION_KEY, JSON.stringify(actionPending));
    applyPending();
  }
  function checkActionResult() {
    if (!actionPending) return;
    let result;
    try { result = JSON.parse(GM_getValue(RESULT_KEY, 'null')); } catch (_) {}
    if (result?.id === actionPending.id) {
      actionMessages.set(actionPending.leadKey, result.message);
      actionPending = null;
    } else if (Date.now() - actionPending.sentAt > 10000) {
      actionMessages.set(actionPending.leadKey, 'No confirmation from Ricochet. Check its webhook result before trying again.');
      actionPending = null;
    }
  }
  function applyPending() {
    // Access the template's page-world API when the userscript runs in an isolated world.
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const view = page.document.getElementById(frame.id)?.contentWindow;
    if (!view) return;
    // The iframe WindowProxy survives srcdoc navigation, but its listeners do not.
    // Rebind for each new document, including asynchronous HTML downloads/updates.
    if (view.document !== readyDocument) {
      readyDocument = view.document;
      view.addEventListener('sdr:ready', applyPending);
      view.addEventListener('sdr:action', sendAction);
    }
    if (!pending) return;
    try {
      const leads = pending.leads || [pending];
      const keys = new Set(leads.map(lead => lead.leadKey));
      const addedLead = leads.filter(lead => !previousKeys.has(lead.leadKey)).at(-1);
      if (addedLead) selectedKey = addedLead.leadKey;
      previousKeys = keys;
      for (const key of syncs.keys()) if (!keys.has(key)) { drafts.delete(key); syncs.delete(key); }
      if (!keys.has(selectedKey)) selectedKey = leads.at(-1)?.leadKey || '';
      const chosen = leads.find(lead => lead.leadKey === selectedKey);
      const signature = JSON.stringify([selectedKey, leads.map(lead => [lead.leadKey, lead.label])]);
      if (signature !== choicesSignature) {
        switcher.replaceChildren();
        switcher.hidden = leads.length < 2;
        for (const lead of leads) {
          const button = document.createElement('button');
          const name = lead.prefill.prospect || lead.label || 'Lead';
          const first = name.split(/\s+/)[0];
          const duplicate = leads.filter(item => (item.prefill.prospect || item.label || 'Lead').split(/\s+/)[0] === first).length > 1;
          button.textContent = 'Switch to ' + (duplicate ? name : first);
          button.title = name;
          button.setAttribute('aria-pressed', String(lead.leadKey === selectedKey));
          button.onclick = () => { selectedKey = lead.leadKey; applyPending(); };
          switcher.appendChild(button);
        }
        choicesSignature = signature;
      }
      const api = view.SDR;
      api?.setActions?.({available:!!chosen && !!pending.controllerId, agencyKnown:!!TEAM_LABELS[chosen?.prefill.agency], busy:!!actionPending,
        message:actionMessages.get(selectedKey) || (!chosen ? 'Open a lead box in Ricochet to use these actions.' : !TEAM_LABELS[chosen.prefill.agency] ? 'Agency unknown: Teams notification unavailable.' : '')});
      if (!chosen) {
        focusedLeadKey = '';
        document.title = 'No open lead | SDR Transfer Script';
        status.textContent = 'No open Ricochet lead box' + (activeKey ? ' · Previous script retained' : '');
        if (!activeKey && api?.get().agency && typeof api.setAgency === 'function') api.setAgency('');
        return;
      }
      if (!api) return;
      if (activeApi !== api) { drafts.clear(); syncs.clear(); activeKey = ''; activeApi = api; }
      if (activeKey !== selectedKey) {
        if (activeKey && keys.has(activeKey)) drafts.set(activeKey, api.get());
        api.reset();
        if (drafts.has(selectedKey)) api.restore(drafts.get(selectedKey));
        activeKey = selectedKey;
      }
      if (!syncs.has(selectedKey)) syncs.set(selectedKey, createDisplaySync());
      if (!syncs.get(selectedKey).apply(api, chosen)) return;
      const agency = chosen.prefill.agency || '';
      if (api.get().agency !== agency && typeof api.setAgency === 'function') api.setAgency(agency);
      const label = chosen.prefill.prospect || chosen.label || 'Lead';
      document.title = label + ' | SDR Transfer Script';
      const manual = !chosen.prefill.lead || !chosen.prefill.lob;
      status.textContent = 'Synced: ' + label + (manual ? ' · Check New/Old and Home/Auto' : '');
      if (focusedLeadKey !== selectedKey) {
        focusedLeadKey = selectedKey;
        window.focus();
        window.opener?.postMessage({type:'ricochet-sdr-focus', controllerId:pending.controllerId, leadKey:selectedKey}, 'https://giainc.ricochet.me');
      }
    } catch (error) {
      status.textContent = 'Sync failed; waiting to retry';
      console.error('[Ricochet SDR]', error);
    }
  }
  frame.addEventListener('load', applyPending);
  document.body.append(switcher, frame, status);
  const templates = createTemplateLoader({
    getCache: () => GM_getValue(TEMPLATE_CACHE_KEY, ''),
    setCache: html => GM_setValue(TEMPLATE_CACHE_KEY, html),
    isBusy: () => !!readPayload()?.leads?.length || !!actionPending,
    download: () => new Promise((resolve, reject) => {
      GM_xmlhttpRequest({method:'GET', url:TEMPLATE_URL + '?check=' + Date.now(), timeout:15000,
        onload: response => response.status === 200 ? resolve(response.responseText) : reject(new Error('Guide download HTTP ' + response.status)),
        onerror: () => reject(new Error('Guide download unavailable')),
        ontimeout: () => reject(new Error('Guide download timed out'))});
    }),
    mount: html => new Promise((resolve, reject) => {
      const previousApi = frame.contentWindow?.SDR;
      frame.srcdoc = html;
      const deadline = Date.now() + 10000;
      function ready() {
        const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        const api = page.document.getElementById(frame.id)?.contentWindow?.SDR;
        if (api && api !== previousApi && ['get','fill','reset','restore','setActions','setAgency'].every(name => typeof api[name] === 'function')) {
          pending = readPayload(); applyPending(); resolve();
        } else if (Date.now() >= deadline) reject(new Error('Guide did not expose the supported SDR API'));
        else setTimeout(ready, 100);
      }
      setTimeout(ready, 0);
    }),
    onError: error => {
      console.warn('[Ricochet SDR HTML]', error);
      if (!frame.contentWindow?.SDR) status.textContent = 'Guide unavailable. Retrying download automatically…';
    }
  });
  void templates.start();
  setInterval(() => { void templates.check(); }, 30000);
  setInterval(() => { void templates.apply(); }, 750);
  if (typeof GM_addValueChangeListener === 'function') {
    GM_addValueChangeListener(PAYLOAD_KEY, () => { pending = readPayload(); applyPending(); });
  }
  setInterval(() => { checkActionResult(); pending = readPayload(); applyPending(); }, 750);
  let restoringBounds = false;
  let savedBounds;
  try { savedBounds = JSON.parse(GM_getValue(WINDOW_BOUNDS_KEY, 'null')); } catch (_) {}
  if (validWindowBounds(savedBounds)) {
    restoringBounds = true;
    function restoreBounds() {
      // Opening coordinates can be ignored; restore from inside the new popup too.
      if (Number.isFinite(savedBounds.outerWidth) && Number.isFinite(savedBounds.outerHeight)
          && savedBounds.outerWidth >= 100 && savedBounds.outerHeight >= 100
          && savedBounds.outerWidth <= 20000 && savedBounds.outerHeight <= 20000) {
        window.resizeTo(savedBounds.outerWidth, savedBounds.outerHeight);
      }
      window.moveTo(savedBounds.left, savedBounds.top);
    }
    restoreBounds();
    setTimeout(restoreBounds, 250);
    setTimeout(() => { restoreBounds(); restoringBounds = false; }, 1000);
  }
  function saveWindowBounds() {
    if (restoringBounds) return;
    const bounds = {left:window.screenX, top:window.screenY, width:window.innerWidth, height:window.innerHeight};
    if (!validWindowBounds(bounds)) return;
    if (window.outerWidth >= 100 && window.outerHeight >= 100) {
      bounds.outerWidth = window.outerWidth;
      bounds.outerHeight = window.outerHeight;
    }
    const saved = JSON.stringify(bounds);
    if (GM_getValue(WINDOW_BOUNDS_KEY, '') !== saved) GM_setValue(WINDOW_BOUNDS_KEY, saved);
  }
  function heartbeat() { GM_setValue(HEARTBEAT_KEY, Date.now()); saveWindowBounds(); }
  heartbeat();
  setInterval(heartbeat, 1000);
  setInterval(saveWindowBounds, 250);
  window.addEventListener('resize', saveWindowBounds);
  window.addEventListener('beforeunload', saveWindowBounds);
  window.addEventListener('pagehide', () => GM_setValue(HEARTBEAT_KEY, 0));
}

function startController() {
  let displayWindow;
  const controllerId = crypto.randomUUID();
  window.addEventListener('message', event => {
    const request = event.data;
    if (event.origin !== 'https://example.com' || request?.type !== 'ricochet-sdr-focus' || request.controllerId !== controllerId || !event.source) return;
    if (displayWindow && !displayWindow.closed && event.source !== displayWindow) return;
    if (!readLeads(document).some(lead => lead.key === request.leadKey)) return;
    displayWindow = event.source;
    displayWindow.focus();
  });
  let lastAction = GM_getValue(ACTION_KEY, '');
  function handleAction() {
    const raw = GM_getValue(ACTION_KEY, '');
    if (!raw || raw === lastAction) return;
    lastAction = raw;
    let request;
    try { request = JSON.parse(raw); } catch (_) { return; }
    if (request.controllerId !== controllerId) return;
    const reply = message => GM_setValue(RESULT_KEY, JSON.stringify({id:request.id, message}));
    if (!['notify','quote'].includes(request.action) || Date.now() - request.sentAt > 10000) return reply('Request expired. Nothing clicked.');
    const matches = Array.from(document.querySelectorAll('.lead-popup-main-row, .lead-popup-main-row-opened-script'))
      .filter(root => visible(root) && readLead(root)?.key === request.leadKey);
    if (matches.length !== 1) return reply('The selected lead box is closed or ambiguous. Nothing clicked.');
    const root = matches[0], agency = buildPrefill(readLead(root), '').agency || '';
    if (request.action === 'notify' && (!TEAM_LABELS[agency] || agency !== request.agency)) return reply('Agency changed or is unknown. Nothing clicked.');
    const label = request.action === 'quote' ? 'Quoting / Info Form' : TEAM_LABELS[agency];
    const links = Array.from(root.querySelectorAll('webhook-trigger[ui="lead_popup"] a[ng-click]'))
      .filter(link => clean(link.textContent) === label && link.getAttribute('ng-click').startsWith('triggerWebhook('));
    if (links.length !== 1) return reply(label + ' is unavailable or ambiguous. Nothing clicked.');
    // Click Ricochet's own action. Its UI owns server success/error feedback.
    links[0].click();
    reply(label + ' requested. Check Ricochet for success or error.');
  }
  if (typeof GM_addValueChangeListener === 'function') GM_addValueChangeListener(ACTION_KEY, handleAction);
  setInterval(handleAction, 300);
  let candidate = '', lastSent = '';
  function publish(force = false) {
    const rep = GM_getValue(REP_KEY, '') || GM_getValue('callerName', '');
    const leads = readLeads(document).map(lead => ({leadKey:lead.key, prefill:buildPrefill(lead, rep), label:lead.name || lead.phone || ''}));
    if (!leads.length && !lastSent && !readPayload()) { candidate = ''; return; }
    const payload = {type: TYPE, controllerId, ...(leads.at(-1) || {leadKey:'none', prefill:{}}), leads};
    const signature = JSON.stringify(payload);
    // Wait for two identical snapshots so intermediate SPA renders do not switch calls.
    if (!force && signature !== candidate) { candidate = signature; return; }
    candidate = signature;
    if (signature === lastSent) return;
    GM_setValue(PAYLOAD_KEY, JSON.stringify({...payload, sentAt:Date.now()}));
    lastSent = signature;
  }
  function openDisplay(focus = false) {
    const now = Date.now();
    if (displayWindow && !displayWindow.closed) {
      if (focus) displayWindow.focus();
      return;
    }
    if (!displayWindow?.closed && now - Number(GM_getValue(HEARTBEAT_KEY, 0)) < 8000) return;
    if (!focus && !displayWindow?.closed && now - Number(GM_getValue(OPEN_KEY, 0)) < 10000) return;
    const height = Math.max(400, Math.min(950, screen.availHeight - 80));
    let geometry = 'width=920,height=' + height;
    try {
      const bounds = JSON.parse(GM_getValue(WINDOW_BOUNDS_KEY, 'null'));
      if (validWindowBounds(bounds)) geometry = 'width=' + bounds.width + ',height=' + bounds.height + ',left=' + bounds.left + ',top=' + bounds.top;
    } catch (_) {}
    displayWindow = window.open(DISPLAY_URL, 'ricochet-sdr-display', 'popup=yes,' + geometry + ',resizable=yes,scrollbars=yes');
    if (displayWindow) {
      GM_setValue(OPEN_KEY, now);
      document.getElementById('ricochet-open-script-window')?.remove();
      if (focus) displayWindow.focus();
    } else if (!document.getElementById('ricochet-open-script-window')) {
      const button = document.createElement('button');
      button.id = 'ricochet-open-script-window';
      button.textContent = 'Open call script window';
      button.title = 'Chrome blocked the popup. Click to open, or allow pop-ups for Ricochet.';
      button.style.cssText = 'position:fixed;bottom:60px;right:16px;z-index:99999;padding:10px 14px;background:#16634e;color:white;border:0;border-radius:6px;font:14px system-ui;cursor:pointer';
      button.onclick = preview;
      document.body.appendChild(button);
    }
  }
  function preview() { publish(true); openDisplay(true); }
  GM_registerMenuCommand('Open SDR Script Display', () => openDisplay(true));
  GM_registerMenuCommand('Preview Current Lead (Ctrl+Alt+S)', preview);
  GM_registerMenuCommand('Set SDR Name', () => {
    const name = window.prompt('Your SDR name', GM_getValue(REP_KEY, '') || GM_getValue('callerName', ''));
    if (name !== null) { GM_setValue(REP_KEY, clean(name)); publish(true); }
  });
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (event.defaultPrevented || event.repeat || !event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
    if (event.code !== 'KeyS' && String(event.key).toLowerCase() !== 's') return;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    event.preventDefault();
    preview();
  }, true);
  publish();
  setInterval(publish, 500);
  openDisplay();
  setInterval(() => openDisplay(), 5000);
  if (!clean(GM_getValue(REP_KEY, '') || GM_getValue('callerName', ''))) {
    setTimeout(() => {
      const name = window.prompt('Your SDR name for the transfer script', '');
      if (name !== null) { GM_setValue(REP_KEY, clean(name)); publish(true); }
    }, 350);
  }
}

function visible(el) {
  if (!el || el.closest('[hidden], .ng-hide')) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function readLeads(doc) {
  const popups = Array.from(doc.querySelectorAll('.lead-popup-main-row, .lead-popup-main-row-opened-script'))
    .filter(el => visible(el) && el.querySelector('#lead-popup-phone-number, .outbound-calls'));
  // Only the top Scripts/call box is a source. Never read the bottom record page.
  return Array.from(new Map(popups.map(readLead).filter(Boolean).map(lead => [lead.key, lead])).values());
}

function readLead(root) {
  // Ricochet keeps additional vehicle values on this exact top popup's Angular
  // model even when its configurable field layout omits Year. Never use the
  // bottom record's model or request another record from the server.
  let popupData;
  try {
    const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    popupData = page.angular?.element(root).scope()?.lead;
  } catch (_) {}
  const value = (...names) => readField(root, names);
  const extra = (...names) => value(...names) || clean(names.map(name => popupData?.lead_field_data?.[name.replace(/ /g, '_')]).find(v => v !== undefined && v !== null && String(v).trim() !== ''));
  const vehiclePart = (order, part) => value(order + ' Vehicle ' + part)
    || clean(popupData?.lead_field_data?.[order + '_Vehicle_' + part]);
  const text = selector => clean(Array.from(root.querySelectorAll(selector)).find(visible)?.textContent);
  const address = parsePopupAddress(text('.led-usr-addr'));
  const lead = {
    contact: value('First Name', 'Contact Name', 'Listed Contact', 'Contact Person') || text('h2'),
    last: value('Last Name') || clean(popupData?.last_name) || text('h2').split(/\s+/).slice(1).join(' '),
    name: value('Company Name') || clean(value('First Name') + ' ' + value('Last Name')) || text('h2'),
    phone: value('Phone - Main', 'Phone - Work', 'Phone') || text('#lead-popup-phone-number'),
    email: value('Email') || text('.led-usr-email'),
    dob: value('Date of Birth', 'DOB', 'Birth Date', "1st Driver's DOB")
      || clean(popupData?.lead_field_data?.DOB || popupData?.lead_field_data?.driver_1_dob),
    street: value('Street Address', 'Address 1', 'Address') || address.street,
    city: value('City') || address.city, state: value('State') || address.state,
    zip: value('Zip', 'Zip Code', 'Postal Code') || address.zip,
    vehicles: value('Vehicles', 'Vehicle', 'Make/Model of Vehicles') || ['1st', '2nd', '3rd', '4th'].map(order =>
      ['Year', 'Make', 'Model'].map(part => vehiclePart(order, part)).filter(Boolean).join(' ')
    ).filter(Boolean).join(', '),
    spouse: value('Spouse Name', 'Spouse'),
    occupation: extra('Occupation', '1st Driver Occupation'),
    miles: extra('Annual Mileage', 'Miles per Year', '1st Vehicle Annual Mileage'),
    plumbing: extra('Plumbing Type'),
    business: extra('Business on Property'),
    addl: extra('Additional Insured', 'Additional Insured Name', 'Additional Driver Name'),
    proptype: extra('Property Type', 'Dwelling Type', 'Type of Home'),
    built: extra('Year Built', 'Year Home Built'),
    sqft: extra('Square Footage', 'Square Feet', 'Living Area'),
    claims: extra('Claims in Last 3 Years', 'Claims in 3 Years'),
    carrier: value('Current Carrier', 'Current Insurer')
      || clean(popupData?.lead_field_data?.Current_Insurance_Carrier || popupData?.lead_field_data?.Carrier),
    lead: value('Lead Type'), lob: value('Line of Business'), owns: value('Home Ownership'),
    vendor: value('Vendor') || readVendor(root),
    agency: value('Agency') || readAgency(root)
  };
  lead.phone = String(lead.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const recordId = value('ID') || clean(root.querySelector('webhook-trigger[ui="lead_popup"]')?.getAttribute('lead-id')) || clean(popupData?.popleadId);
  lead.key = /^\d+$/.test(recordId) ? 'id:' + recordId : lead.phone ? 'phone:' + lead.phone : lead.email ? 'email:' + lead.email.toLowerCase() : lead.name ? 'name:' + lead.name.toLowerCase() : '';
  return lead.key ? lead : null;
}

function readField(root, names) {
  const normalize = value => clean(value).replace(/^enter\s+/i, '').replace(/\s*:\s*$/, '').toLowerCase();
  const fields = Array.from(root.querySelectorAll('input, textarea, select')).filter(visible);
  const labels = Array.from(root.querySelectorAll('label'));
  for (const name of names) {
    const wanted = normalize(name);
    for (const field of fields) {
      const label = labels.find(item => (item.htmlFor && item.htmlFor === field.id) || item.contains(field));
      const group = field.closest('.input-group, [as-sortable-item-handle]');
      const groupLabel = group && root.contains(group) ? group.querySelector('label') : null;
      if (![field.getAttribute('placeholder'), field.getAttribute('aria-label'), label?.textContent, groupLabel?.textContent].some(text => normalize(text) === wanted)) continue;
      const result = clean(field.tagName === 'SELECT' ? field.selectedOptions[0]?.textContent : field.value);
      if (result) return result;
    }
  }
  return '';
}

function readVendor(root) {
  for (const group of root.querySelectorAll('.dropdown-button-wrapper')) {
    if (clean(group.querySelector('.dropdown-label')?.textContent).toLowerCase() === 'vendor') {
      const text = clean(group.querySelector('.dropdown-text')?.textContent);
      return text === 'Select Option' ? '' : text;
    }
  }
  // The legacy popup renders Vendor as adjacent columns instead of an input.
  for (const row of root.querySelectorAll('.row')) {
    if (!visible(row)) continue;
    const label = Array.from(row.children).find(el => clean(el.textContent).toLowerCase() === 'vendor:');
    if (label) return clean(label.nextElementSibling?.textContent);
  }
  return '';
}

function readAgency(root) {
  const names = Array.from(root.querySelectorAll('[ng-repeat="tag in lead.lead_tags"]'))
    .map(el => clean(el.textContent)).filter(name => /\s+Agency$/i.test(name));
  if (names.length) return names.length === 1 ? names[0].split(/\s+/)[0] : '';
  // Some sources omit agency tags. Only recognize the known owner names,
  // delimited in the vendor label; do not guess an owner from arbitrary text.
  const vendor = readField(root, ['Vendor']) || readVendor(root);
  const owners = [
    ['Carlos', /(?:^|[\s_-])Carlos(?:Perez)?(?=$|[\s_-])/i],
    ['Ulises', /(?:^|[\s_-])Ulises(?:Gomez)?(?=$|[\s_-])/i],
    ['Stefanie', /(?:^|[\s_-])(?:StefanieP?|Stephanie\s+Pinheiro)(?=$|[\s_-])/i]
  ].filter(([, pattern]) => pattern.test(vendor));
  return owners.length === 1 ? owners[0][0] : '';
}

function parsePopupAddress(value) {
  // The visible popup formats street[, unit], city, state, ZIP with commas.
  // Do not split an unstructured address by guessing where a multiword city starts.
  const raw = clean(value);
  const match = raw.match(/^(.+),\s*([^,]+),\s*([a-z]{2})\s*,?\s*(\d{5}(?:-\d{4})?)$/i)
    || raw.match(/^(.+),\s*([^,]+?)\s+([a-z]{2})\s+(\d{5}(?:-\d{4})?)(?:\s*,\s*)*(?:\3\s*,?\s*)?$/i);
  return match ? {street:clean(match[1]), city:clean(match[2]), state:match[3], zip:match[4]} : {};
}

})();

