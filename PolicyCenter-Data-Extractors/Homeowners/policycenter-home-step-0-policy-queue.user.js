// ==UserScript==
// @name         PolicyCenter — Step 0: Policy Queue (loop → GO AHEAD Step1) (chunk counter + pause countdown)
// @namespace    tm.pc.step0.policyqueue
// @version      1.4.3
// @description  Manual START loop. CUSTOM: every N successes pause M minutes. Shows CHUNK counter + PAUSE countdown (live tick). Clears extractor state before each policy.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-start
// @all-frames   true
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-0-policy-queue.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-0-policy-queue.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;

  const LS = {
    GO_AHEAD: 'tm_pc_go_ahead_v1',
    Q:        'tm_pc_step0_queue_v1',
    OK:       'tm_pc_step0_success_v1',
    BAD:      'tm_pc_step0_fail_v1',
    IN_DRAFT: 'tm_pc_step0_input_draft_v1',
    UI_RIGHT:        'tm_pc_step0_ui_right_v3',
    UI_BOTTOM:       'tm_pc_step0_ui_bottom_v3',
    UI_BOXES_OFF:    'tm_pc_step0_ui_boxes_off_v1',
    UI_MINI:         'tm_pc_step0_ui_mini_v1',
    UI_REQUEUE_FAIL: 'tm_pc_step0_ui_requeue_fail_v1',

    // Long-break state
    LB_COUNT: 'tm_pc_step0_longbreak_count_v1',
    LB_UNTIL: 'tm_pc_step0_longbreak_until_v1',

    // Long-break config (CUSTOM)
    LB_EVERY:   'tm_pc_step0_longbreak_every_v1',     // integer: successes per pause (0 disables)
    LB_MINUTES: 'tm_pc_step0_longbreak_minutes_v1',   // integer: pause minutes
  };

  const SEL = {
    POLICY_DROPDOWN_BTN: '.gw-action--expand-button',
    INPUT_PRIMARY: '#TabBar-PolicyTab-PolicyTab_PolicyRetrievalItem > div > input[type="text"]',
    INPUT_ALT: '.gw-subMenu[aria-hidden="false"] input[type="text"]',
    INPUT_WIDE: '#TabBar-PolicyTab-PolicyTab_PolicyRetrievalItem input[type="text"], .gw-subMenu[aria-hidden="false"] input[type="text"], input[type="text"]',
    SUBMIT: '#TabBar-PolicyTab-PolicyTab_PolicyRetrievalItem_Button, #TabBar-PolicyTab-PolicyTab_PolicyRetrievalItem_Button > span',
    HDR_SEARCH:  '#PolicySearch-PolicySearchScreen-ttlBar .gw-TitleBar--title',
    HDR_SUMMARY: '#PolicyFile_Summary-Policy_SummaryScreen-0 .gw-TitleBar--title',
    HDR_RISK:    '#PolicyFile_RiskAnalysis-PolicyFile_RiskAnalysisScreen-0 .gw-TitleBar--title',
  };

  const CFG = {
    watchdogMs: 900,
    pollMs: 160,

    cooldownBetweenPoliciesMs: 2000,

    afterExpandWaitMs: 220,
    inputAppearTimeoutPerBtnMs: 4500,
    afterSubmitMinWaitMs: 800,

    outcomeInitialDelayMs: 2000,

    retryTypingDelayMs:       [18, 34, 55],
    retryInputTimeoutMs:      [9000, 13000, 17000],
    retryOutcomeTimeoutMs:    [24000, 32000, 40000],
    retryBackoffBeforeTryMs:  [0, 1200, 2200],

    waitRiskMaxMs: 20 * 60 * 1000,

    maxPastePolicies: 1000,

    logKeep: 260,
    logLinesShown: 14,

    toastDedupeMs: 900,

    minRight: 8,
    minBottom: 8,
    edgePad: 8,
    panelWidth: 360,
    panelHeightEstimate: 640,
    miniSize: 52,
    maxRightPad: 24,
    maxBottomPad: 24,
    defaultRight: 14,
    defaultBottom: 14,

    baseHex: '#393b87',

    // Defaults
    defaultEverySuccesses: 50,
    defaultPauseMinutes: 15,

    // Safety limits for prompts
    maxEvery: 10000,
    maxMinutes: 600,
  };

  const EXTRACTOR_LOCAL_KEYS = [
    LS.GO_AHEAD,
    'tm_pc_home_payload_v1',
    'tm_pc_home_step1_policyinfo_v1',
    'tm_pc_home_step1_ready_v1',
    'tm_pc_home_dwelling_v1',
    'tm_pc_home_dwelling_ready_v1',
    'tm_pc_home_stage_v1',
    'tm_pc_home_step2_go_v1',
    'tm_pc_home_step3_go_v1',
    'tm_pc_coverages_v1',
    'tm_pc_coverages_ready_v1',
    'tm_pc_coverages_done_policy_v1',
    'tm_pc_quote_v1',
    'tm_pc_quote_ready_v1',
    'tm_pc_stage_v1',
  ];

  const STORE = (() => {
    const hasGM = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');
    const get = (k, fb) => { try { return hasGM ? GM_getValue(k, fb) : fb; } catch { return fb; } };
    const set = (k, v) => { try { if (hasGM) GM_setValue(k, v); } catch {} };
    const del = (k) => { try { if (hasGM && typeof GM_deleteValue === 'function') GM_deleteValue(k); } catch {} };
    return { hasGM, get, set, del };
  })();

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const clamp = (n, a, b) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return a;
    return Math.max(a, Math.min(b, x));
  };
  const maxUiRight = (width = CFG.panelWidth) =>
    Math.max(CFG.minRight, window.innerWidth - width - CFG.edgePad);
  const maxUiBottom = (height = CFG.miniSize) =>
    Math.max(CFG.minBottom, window.innerHeight - height - CFG.edgePad);
  const preferredUiRight = () => CFG.defaultRight;
  const preferredUiBottom = (height = CFG.panelHeightEstimate) =>
    clamp(Math.round((window.innerHeight - height) / 2), CFG.minBottom, maxUiBottom(height));
  const readUiRight = (width = CFG.panelWidth) =>
    clamp(Number(loadStr(LS.UI_RIGHT, preferredUiRight())), CFG.minRight, maxUiRight(width));
  const readUiBottom = (height = CFG.panelHeightEstimate) =>
    clamp(Number(loadStr(LS.UI_BOTTOM, preferredUiBottom(height))), CFG.minBottom, maxUiBottom(height));

  function loadArr(key) {
    try {
      const v = STORE.get(key, '[]');
      const a = JSON.parse(String(v || '[]'));
      return Array.isArray(a) ? a.map(x => String(x)) : [];
    } catch { return []; }
  }
  function saveArr(key, arr) { try { STORE.set(key, JSON.stringify(arr)); } catch {} }
  function loadStr(key, fb = '') { try { return String(STORE.get(key, fb) ?? fb); } catch { return fb; } }
  function saveStr(key, v) { STORE.set(key, String(v ?? '')); }
  function loadBool(key, fb) {
    try {
      const v = STORE.get(key, null);
      if (v == null) return fb;
      const s = String(v).toLowerCase().trim();
      return (s === '1' || s === 'true' || s === 'yes' || s === 'on');
    } catch { return fb; }
  }
  function saveBool(key, v) { STORE.set(key, v ? '1' : '0'); }

  // IMPORTANT: no bitwise (timestamps overflow 32-bit)
  function loadNum(key, fb = 0) {
    try {
      const raw = STORE.get(key, null);
      if (raw == null) return fb;
      const n = Math.floor(Number(raw));
      return Number.isFinite(n) ? n : fb;
    } catch { return fb; }
  }
  function saveNum(key, v) {
    try {
      const n = Math.floor(Number(v));
      STORE.set(key, String(Number.isFinite(n) ? n : 0));
    } catch {}
  }

  function fmtMs(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || '1') === 0) return false;
      return true;
    } catch { return false; }
  }

  function getAllDocs() {
    const out = [];
    const seen = new Set();
    function walk(doc, depth) {
      if (!doc || depth > 6) return;
      if (seen.has(doc)) return;
      seen.add(doc);
      out.push(doc);
      const frames = doc.querySelectorAll('iframe, frame');
      for (const f of frames) {
        try { if (f.contentDocument) walk(f.contentDocument, depth + 1); } catch {}
      }
    }
    walk(document, 0);
    return out;
  }

  function qAny(sel) {
    for (const d of getAllDocs()) {
      try {
        const el = d.querySelector(sel);
        if (el) return el;
      } catch {}
    }
    return null;
  }

  function qAnyAll(sel) {
    const out = [];
    for (const d of getAllDocs()) {
      try { out.push(...Array.from(d.querySelectorAll(sel))); } catch {}
    }
    return out;
  }

  function hitClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch {}
    try {
      const r = el.getBoundingClientRect();
      const x = (r.left + r.width / 2) | 0;
      const y = (r.top + r.height / 2) | 0;
      const doc = el.ownerDocument || document;
      const tgt = doc.elementFromPoint(x, y) || el;
      ['pointerdown','mousedown','mouseup','pointerup','click'].forEach(t => {
        tgt.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, clientX:x, clientY:y }));
      });
      return true;
    } catch {
      try { el.click(); return true; } catch { return false; }
    }
  }

  function setNativeValue(el, value) {
    try {
      const proto = el.constructor && el.constructor.prototype;
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      const setter = desc && desc.set;
      if (setter) setter.call(el, value);
      else el.value = value;
    } catch {
      try { el.value = value; } catch {}
    }
  }

  function pickPolicyDigits(s) {
    const str = String(s || '');
    const m9 = str.match(/\b(\d{9})\b/);
    if (m9) return m9[1];
    const m8 = str.match(/\b(\d{8})\b/);
    if (m8) return m8[1];
    const digits = str.replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.length >= 9) return digits.slice(-9);
    if (digits.length === 8) return digits;
    return '';
  }

  function buildAttemptStrings(policy) {
    const p = String(policy || '').trim();
    if (!p) return [];
    if (/^\d{8}$/.test(p)) return [p, '0' + p];
    return [p];
  }

  function ensureDefaults() {
    const e = STORE.get(LS.LB_EVERY, null);
    const m = STORE.get(LS.LB_MINUTES, null);
    if (e == null) saveNum(LS.LB_EVERY, CFG.defaultEverySuccesses);
    if (m == null) saveNum(LS.LB_MINUTES, CFG.defaultPauseMinutes);
  }

  function getEvery() {
    const n = loadNum(LS.LB_EVERY, CFG.defaultEverySuccesses);
    return clamp(n, 0, CFG.maxEvery);
  }
  function getPauseMinutes() {
    const n = loadNum(LS.LB_MINUTES, CFG.defaultPauseMinutes);
    return clamp(n, 0, CFG.maxMinutes);
  }
  function getPauseMs() {
    return getPauseMinutes() * 60 * 1000;
  }

  const UI = {
    host: null,
    root: null,
    state: {
      running: false,
      busy: false,
      current: '',
      logs: [],
      toastTimer: null,
      lastToastMsg: '',
      lastToastTs: 0,
      skipRiskWait: false,
      boxesHidden: loadBool(LS.UI_BOXES_OFF, false),
      mini: loadBool(LS.UI_MINI, false),
      drag: { on: false, sx: 0, sy: 0, sr: 0, sb: 0 },
      draftTimer: null,
      liveSyncSetup: false,
    },
    isFocusedInInput() {
      try {
        const ae = this.root?.activeElement;
        return !!(ae && ae.id === 'taIn');
      } catch { return false; }
    },
    mount(force = false) {
      let host = document.getElementById('tm-pc-step0-host');
      const exists = !!(host && host.shadowRoot && host.shadowRoot.getElementById('wrap'));
      if (exists && !force) return;

      if (!host) {
        host = document.createElement('div');
        host.id = 'tm-pc-step0-host';
        const right = readUiRight();
        const bottom = readUiBottom();
        host.style.cssText = `position:fixed;right:${right}px;bottom:${bottom}px;z-index:2147483647;pointer-events:auto;`;
        (document.documentElement || document.body).appendChild(host);
      }

      this.host = host;
      if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
      this.root = host.shadowRoot;

      const BASE = CFG.baseHex;

      this.root.innerHTML = `
<style>
  :root{--base:${BASE};--baseB: rgba(57,59,135,.34);--baseC: rgba(57,59,135,.55);--txt:#e5e7eb;--txt2:#f3f4f6;--line: rgba(255,255,255,.12);}
  .wrap{width:${CFG.panelWidth}px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);color:var(--txt);border:1px solid var(--line);border-radius:16px;
    background: radial-gradient(900px 420px at 10% 10%, rgba(57,59,135,.42), transparent 55%), linear-gradient(180deg, rgba(17,24,39,.92), rgba(3,7,18,.88));
    box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden;font:12px/1.25 system-ui,Segoe UI,Arial;backdrop-filter: blur(10px);}
  .hdr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:grab;user-select:none;touch-action:none}
  .hdr:active{cursor:grabbing}
  .ttl{font-weight:950;letter-spacing:.2px;color:var(--txt2)}
  .pill{font-weight:900;font-size:11px;padding:5px 8px;border-radius:999px;border:1px solid rgba(57,59,135,.45);background:rgba(57,59,135,.14);color:var(--txt2);white-space:nowrap}
  .body{padding:10px 12px 12px;max-height:calc(100vh - 82px);overflow:auto}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
  .btn{padding:7px 10px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--txt2);cursor:pointer;font-weight:950}
  .btn:hover{background:rgba(255,255,255,.10)}
  .btn:disabled{opacity:.55;cursor:not-allowed}
  .btn.primary{background:var(--baseB);border-color:var(--baseC)}
  .btn.primary:hover{background:rgba(57,59,135,.44)}
  .btn.off{background:rgba(239,68,68,.16);border-color:rgba(239,68,68,.26)}
  .btn.ghost{background:transparent}
  .meta{font:11px/1.25 ui-monospace,Consolas,monospace;color:rgba(229,231,235,.92);padding:8px 10px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.04);margin-bottom:10px}
  .counters{white-space:pre-wrap}
  .section{display:flex;flex-direction:column;gap:6px;margin-bottom:10px}
  .lbl{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .lbl .t{font-weight:950;color:var(--txt2)}
  .lbl .s{font:11px ui-monospace,Consolas,monospace;opacity:.85}
  textarea{width:100%;resize:vertical;min-height:76px;max-height:240px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.28);color:var(--txt);padding:9px 10px;outline:none;font:11px/1.25 ui-monospace,Consolas,monospace}
  textarea:focus{border-color: rgba(57,59,135,.60); box-shadow: 0 0 0 3px rgba(57,59,135,.22);}
  textarea[readonly]{opacity:.95}
  .log{border-top:1px solid var(--line);padding-top:10px;margin-top:10px}
  pre{margin:0;max-height:130px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.25 ui-monospace,Consolas,monospace;color:rgba(229,231,235,.92);padding:8px 10px;border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.04)}
  .miniBtn{width:52px;height:52px;border-radius:18px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(57,59,135,.45);
    background:radial-gradient(180px 120px at 20% 20%, rgba(57,59,135,.42), transparent 60%),linear-gradient(180deg, rgba(17,24,39,.92), rgba(3,7,18,.88));
    box-shadow:0 18px 50px rgba(0,0,0,.45);cursor:pointer;user-select:none;font-weight:1000;letter-spacing:.3px;color:var(--txt2)}
  .toast{position:fixed;right:16px;bottom:16px;z-index:2147483647;background:rgba(0,0,0,.86);color:#fff;border:1px solid rgba(57,59,135,.45);border-radius:14px;padding:10px 12px;font:12px system-ui,Segoe UI,Arial;box-shadow:0 10px 26px rgba(0,0,0,.35);display:none}
</style>

<div id="mini" class="miniBtn" style="display:none;">PC0</div>

<div class="wrap" id="wrap">
  <div class="hdr" id="drag">
    <div class="ttl">PC Step0 — Policy Queue</div>
    <div class="pill" id="stat">IDLE</div>
  </div>

  <div class="body">
    <div class="row">
      <button class="btn primary" id="btnStart">START</button>
      <button class="btn" id="btnStop">STOP</button>
      <button class="btn primary" id="btnAdd">ADD</button>
      <button class="btn primary" id="btnSkipWait">SKIP WAIT</button>
      <button class="btn" id="btnCustom">CUSTOM</button>
      <button class="btn" id="btnRequeueFail">FAIL REQUEUE: OFF</button>
      <button class="btn" id="btnBoxes">BOXES: ON</button>
      <button class="btn ghost" id="btnMini">MINI</button>
      <button class="btn off" id="btnClearAll">CLEAR ALL</button>
    </div>

    <div class="meta" id="meta">loading…</div>
    <div class="meta counters" id="counters">loading…</div>

    <div id="boxesArea">
      <div class="section">
        <div class="lbl"><div class="t">1) Input (type / paste)</div><div class="s">Ctrl+Enter = ADD</div></div>
        <textarea id="taIn" placeholder="Paste or type policy numbers here…"></textarea>
      </div>

      <div class="section">
        <div class="lbl"><div class="t">2) Queue</div><div class="s">pending</div></div>
        <textarea id="taQ" readonly></textarea>
      </div>

      <div class="section">
        <div class="lbl"><div class="t">3) Success</div><div class="s">processed</div></div>
        <textarea id="taOk" readonly></textarea>
      </div>

      <div class="section" style="margin-bottom:0;">
        <div class="lbl"><div class="t">4) Fail</div><div class="s">after 3 attempts</div></div>
        <textarea id="taBad" readonly></textarea>
      </div>
    </div>

    <div class="log">
      <pre id="log"></pre>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>
      `;

      const $ = (id) => this.root.getElementById(id);
      const wrap = $('wrap');

      ['pointerdown','mousedown','mouseup','click','dblclick','keydown','keyup'].forEach(ev => {
        wrap.addEventListener(ev, (e) => e.stopPropagation(), false);
      });

      const taIn = $('taIn');
      taIn.value = loadStr(LS.IN_DRAFT, '');

      taIn.addEventListener('input', () => {
        clearTimeout(this.state.draftTimer);
        this.state.draftTimer = setTimeout(() => saveStr(LS.IN_DRAFT, taIn.value || ''), 180);
      });

      taIn.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          ingestFromInput(false);
        }
      });

      $('btnStart').addEventListener('click', (e) => {
        e.preventDefault();
        const before = loadArr(LS.Q).length;
        ingestFromInput(false, true);
        const after = loadArr(LS.Q).length;
        if (after > before) this.log(`START: auto-added ${after - before} to queue`);
        this.state.running = true;
        this.log('START pressed');
        this.render();
        setTimeout(pump, 0);
      });

      $('btnStop').addEventListener('click', (e) => {
        e.preventDefault();
        this.state.running = false;
        this.log('STOP pressed (this tab only)');
        this.render();
      });

      $('btnAdd').addEventListener('click', (e) => { e.preventDefault(); ingestFromInput(false); });

      $('btnSkipWait').addEventListener('click', (e) => {
        e.preventDefault();
        this.state.skipRiskWait = true;
        this.toast('Skip Risk wait (one time)');
        this.log('SKIP WAIT armed (one time)');
      });

      $('btnCustom').addEventListener('click', (e) => {
        e.preventDefault();

        const curEvery = getEvery();
        const curMin = getPauseMinutes();

        const sEvery = prompt('How many you want per pause? (0 = disable)', String(curEvery));
        if (sEvery == null) return;

        const every = parseInt(String(sEvery).trim(), 10);
        if (!Number.isFinite(every) || every < 0 || every > CFG.maxEvery) {
          this.toast('Invalid "per pause" number');
          this.log(`CUSTOM: invalid every="${sEvery}"`);
          return;
        }

        const sMin = prompt('How long (the pause) in minutes? (0 = disable)', String(curMin));
        if (sMin == null) return;

        const minutes = parseInt(String(sMin).trim(), 10);
        if (!Number.isFinite(minutes) || minutes < 0 || minutes > CFG.maxMinutes) {
          this.toast('Invalid "pause minutes" number');
          this.log(`CUSTOM: invalid minutes="${sMin}"`);
          return;
        }

        saveNum(LS.LB_EVERY, every);
        saveNum(LS.LB_MINUTES, minutes);

        // reset + cancel active pause
        saveNum(LS.LB_COUNT, 0);
        saveNum(LS.LB_UNTIL, 0);

        if (every === 0 || minutes === 0) {
          this.toast('Custom pause DISABLED');
          this.log(`CUSTOM: pause disabled (every=${every}, minutes=${minutes})`);
        } else {
          this.toast(`Custom pause: every ${every}, ${minutes} min`);
          this.log(`CUSTOM: set every=${every} successes, pause=${minutes} min (counter reset)`);
        }

        this.render(true);
      });

      $('btnRequeueFail').addEventListener('click', (e) => {
        e.preventDefault();
        const v = !loadBool(LS.UI_REQUEUE_FAIL, false);
        saveBool(LS.UI_REQUEUE_FAIL, v);
        this.toast(v ? 'Fail requeue ON' : 'Fail requeue OFF');
        this.log(v ? 'FAIL REQUEUE enabled (synced)' : 'FAIL REQUEUE disabled (synced)');
        this.render(true);
      });

      $('btnBoxes').addEventListener('click', (e) => {
        e.preventDefault();
        this.state.boxesHidden = !this.state.boxesHidden;
        saveBool(LS.UI_BOXES_OFF, this.state.boxesHidden);
        this.log(this.state.boxesHidden ? 'Boxes hidden (synced)' : 'Boxes shown (synced)');
        this.render(true);
      });

      $('btnMini').addEventListener('click', (e) => {
        e.preventDefault();
        this.state.mini = true;
        saveBool(LS.UI_MINI, true);
        this.log('Mini mode ON (synced)');
        this.render(true);
      });

      $('mini').addEventListener('click', (e) => {
        e.preventDefault();
        this.state.mini = false;
        saveBool(LS.UI_MINI, false);
        this.log('Mini mode OFF (synced)');
        this.render(true);
      });

      $('btnClearAll').addEventListener('click', (e) => {
        e.preventDefault();
        saveArr(LS.Q, []);
        saveArr(LS.OK, []);
        saveArr(LS.BAD, []);
        saveStr(LS.IN_DRAFT, '');
        const ta = this.root.getElementById('taIn');
        if (ta) ta.value = '';
        this.state.current = '';
        this.log('Cleared ALL shared lists');
        this.render(true);
      });

      const dragEl = $('drag');
      const isInteractive = (node) => !!node?.closest?.('button, textarea, input, select, a');

      const onDown = (e) => {
        if (isInteractive(e.target)) return;
        if (this.state.mini) return;
        e.preventDefault();

        const box = this.host?.getBoundingClientRect?.();
        const right = readUiRight(Math.max(CFG.miniSize, box?.width || CFG.panelWidth));
        const bottom = readUiBottom(Math.max(CFG.miniSize, box?.height || CFG.miniSize));

        this.state.drag.on = true;
        this.state.drag.sx = e.clientX;
        this.state.drag.sy = e.clientY;
        this.state.drag.sr = right;
        this.state.drag.sb = bottom;

        try { dragEl.setPointerCapture(e.pointerId); } catch {}
      };

      const onMove = (e) => {
        if (!this.state.drag.on) return;
        const dx = e.clientX - this.state.drag.sx;
        const dy = e.clientY - this.state.drag.sy;

        let nextRight = this.state.drag.sr - dx;
        let nextBottom = this.state.drag.sb - dy;

        const box = this.host?.getBoundingClientRect?.();
        nextRight = clamp(nextRight, CFG.minRight, maxUiRight(Math.max(CFG.miniSize, box?.width || CFG.panelWidth)));
        nextBottom = clamp(nextBottom, CFG.minBottom, maxUiBottom(Math.max(CFG.miniSize, box?.height || CFG.miniSize)));

        this.host.style.right = `${nextRight}px`;
        this.host.style.bottom = `${nextBottom}px`;
      };

      const onUp = () => {
        if (!this.state.drag.on) return;
        this.state.drag.on = false;

        this.keepInViewport(true);
      };

      dragEl.addEventListener('pointerdown', onDown);
      dragEl.addEventListener('pointermove', onMove);
      dragEl.addEventListener('pointerup', onUp);
      dragEl.addEventListener('pointercancel', onUp);

      window.addEventListener('resize', () => {
        this.keepInViewport(true);
      }, { passive: true });

      const right = readUiRight();
      const bottom = readUiBottom();
      this.host.style.right = `${right}px`;
      this.host.style.bottom = `${bottom}px`;

      this.render(true);
      this.keepInViewport(true);
    },

    keepInViewport(save = false) {
      if (!this.host || !this.root) return;
      const active = this.state.mini ? this.root.getElementById('mini') : this.root.getElementById('wrap');
      const box = active?.getBoundingClientRect?.() || this.host.getBoundingClientRect?.();
      const width = Math.max(CFG.miniSize, box?.width || (this.state.mini ? CFG.miniSize : CFG.panelWidth));
      const height = Math.max(CFG.miniSize, box?.height || CFG.miniSize);
      const currentRight = parseInt(this.host.style.right || `${preferredUiRight()}`, 10);
      const currentBottom = parseInt(this.host.style.bottom || `${preferredUiBottom(height)}`, 10);
      const right = clamp(currentRight, CFG.minRight, maxUiRight(width));
      const bottom = clamp(currentBottom, CFG.minBottom, maxUiBottom(height));
      this.host.style.right = `${right}px`;
      this.host.style.bottom = `${bottom}px`;
      if (save) {
        saveStr(LS.UI_RIGHT, right);
        saveStr(LS.UI_BOTTOM, bottom);
      }
    },

    toast(msg) {
      const t = this.root?.getElementById('toast');
      if (!t) return;

      const now = Date.now();
      const s = String(msg || '');
      if (s && s === this.state.lastToastMsg && (now - this.state.lastToastTs) < CFG.toastDedupeMs) return;

      this.state.lastToastMsg = s;
      this.state.lastToastTs = now;

      t.textContent = s;
      t.style.display = 'block';
      clearTimeout(this.state.toastTimer);
      this.state.toastTimer = setTimeout(() => { t.style.display = 'none'; }, 1600);
    },

    log(msg) {
      const s = String(msg || '').trim();
      if (!s) return;

      const now = Date.now();
      const last = this.state.logs.length ? this.state.logs[this.state.logs.length - 1] : null;

      if (last && last.msg === s) last.n = (last.n || 1) + 1;
      else this.state.logs.push({ ts: now, msg: s, n: 1 });

      if (this.state.logs.length > CFG.logKeep) this.state.logs = this.state.logs.slice(-CFG.logKeep);
      this.render();
    },

    setStatus(s) {
      const stat = this.root?.getElementById('stat');
      if (stat) stat.textContent = s;
    },

    render(forceReloadTextareas = false) {
      if (!this.root) return;

      this.state.boxesHidden = loadBool(LS.UI_BOXES_OFF, this.state.boxesHidden);
      this.state.mini = loadBool(LS.UI_MINI, this.state.mini);

      const q = loadArr(LS.Q);
      const ok = loadArr(LS.OK);
      const bad = loadArr(LS.BAD);
      const requeueFail = loadBool(LS.UI_REQUEUE_FAIL, false);

      const every = getEvery();
      const minutes = getPauseMinutes();

      const lbCount = loadNum(LS.LB_COUNT, 0);
      const lbUntil = loadNum(LS.LB_UNTIL, 0);
      const now = Date.now();
      const lbRemain = (lbUntil && lbUntil > now) ? (lbUntil - now) : 0;
      const nextIn = (every > 0) ? Math.max(0, every - lbCount) : 0;

      const meta = this.root.getElementById('meta');
      const counters = this.root.getElementById('counters');
      const log = this.root.getElementById('log');
      const boxesArea = this.root.getElementById('boxesArea');
      const btnBoxes = this.root.getElementById('btnBoxes');
      const btnRequeueFail = this.root.getElementById('btnRequeueFail');

      const wrap = this.root.getElementById('wrap');
      const mini = this.root.getElementById('mini');

      if (btnRequeueFail) btnRequeueFail.textContent = requeueFail ? 'FAIL REQUEUE: ON' : 'FAIL REQUEUE: OFF';

      if (this.state.mini) {
        if (wrap) wrap.style.display = 'none';
        if (mini) mini.style.display = 'flex';
      } else {
        if (wrap) wrap.style.display = 'block';
        if (mini) mini.style.display = 'none';
      }

      if (boxesArea) boxesArea.style.display = this.state.boxesHidden ? 'none' : 'block';
      if (btnBoxes) btnBoxes.textContent = this.state.boxesHidden ? 'BOXES: OFF' : 'BOXES: ON';

      if (meta) {
        meta.textContent =
          `status=${this.state.busy ? 'BUSY' : (this.state.running ? 'RUN' : 'IDLE')} | current=${this.state.current || '(none)'} | queue=${q.length} ok=${ok.length} fail=${bad.length} | requeueFail=${requeueFail ? 'ON' : 'OFF'} | goAhead(local)=${localStorage.getItem(LS.GO_AHEAD) || '0'}`;
      }

      if (counters) {
        counters.textContent =
          `Chunk config: ${every ? `every ${every} successes` : 'OFF'} | pause ${minutes || 0} min\n` +
          `Chunk progress: ${every ? `${lbCount}/${every}` : '—'} | next pause in: ${every ? `${nextIn}` : '—'}\n` +
          `Pause remaining: ${lbRemain ? fmtMs(lbRemain) : '—'}`;
      }

      if (log) {
        const tail = this.state.logs.slice(-CFG.logLinesShown).map(e => {
          const d = new Date(e.ts);
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          const ss = String(d.getSeconds()).padStart(2, '0');
          return `[${hh}:${mm}:${ss}] ${e.msg}${(e.n && e.n > 1) ? ` (x${e.n})` : ''}`;
        });
        log.textContent = tail.join('\n');
      }

      if (!this.state.boxesHidden) {
        const taIn = this.root.getElementById('taIn');
        const taQ = this.root.getElementById('taQ');
        const taOk = this.root.getElementById('taOk');
        const taBad = this.root.getElementById('taBad');

        if (taIn && (forceReloadTextareas || !this.isFocusedInInput())) {
          const draft = loadStr(LS.IN_DRAFT, '');
          if (taIn.value !== draft) taIn.value = draft;
        }

        if (taQ && (forceReloadTextareas || taQ.value !== q.join('\n'))) taQ.value = q.join('\n');
        if (taOk && (forceReloadTextareas || taOk.value !== ok.join('\n'))) taOk.value = ok.join('\n');
        if (taBad && (forceReloadTextareas || taBad.value !== bad.join('\n'))) taBad.value = bad.join('\n');
      }
      this.keepInViewport(false);
    },

    setupLiveSync() {
      if (this.state.liveSyncSetup) return;
      this.state.liveSyncSetup = true;

      const keys = [
        LS.Q, LS.OK, LS.BAD, LS.IN_DRAFT,
        LS.UI_RIGHT, LS.UI_BOTTOM, LS.UI_BOXES_OFF, LS.UI_MINI, LS.UI_REQUEUE_FAIL,
        LS.LB_COUNT, LS.LB_UNTIL, LS.LB_EVERY, LS.LB_MINUTES
      ];

      if (STORE.hasGM && typeof GM_addValueChangeListener === 'function') {
        for (const k of keys) {
          GM_addValueChangeListener(k, (_name, _old, _new, remote) => {
            if (!remote) return;
            if (k === LS.UI_RIGHT || k === LS.UI_BOTTOM) {
              if (this.host) {
                this.host.style.right = `${readUiRight()}px`;
                this.host.style.bottom = `${readUiBottom()}px`;
                this.keepInViewport(false);
              }
            }
            this.render(true);
          });
        }
        this.log('Live sync ON');
      }
    }
  };

  function parsePoliciesFromText(text) {
    const raw = String(text || '');
    const chunks = raw.match(/\d{8,12}/g) || [];
    let list = chunks.map(x => pickPolicyDigits(x)).filter(Boolean);
    if (list.length > CFG.maxPastePolicies) list = list.slice(0, CFG.maxPastePolicies);

    const seen = new Set();
    const out = [];
    for (const p of list) {
      const pp = String(p);
      if (!pp) continue;
      if (seen.has(pp)) continue;
      seen.add(pp);
      out.push(pp);
    }
    return out;
  }

  function ingestFromInput(_clearAfterIgnoredNow = false, silent = false) {
    const ta = UI.root?.getElementById('taIn');
    if (!ta) return;

    const incoming = parsePoliciesFromText(ta.value);
    if (!incoming.length) {
      if (!silent) { UI.toast('No policies found'); UI.log('ADD: no policies detected'); }
      return;
    }

    const requeueFail = loadBool(LS.UI_REQUEUE_FAIL, false);

    const q = loadArr(LS.Q);
    const okSet = new Set(loadArr(LS.OK));
    const badSet = new Set(loadArr(LS.BAD));

    const merged = [...q];
    let added = 0, skippedOk = 0, skippedBad = 0, skippedDup = 0;

    for (const p of incoming) {
      if (okSet.has(p)) { skippedOk++; continue; }
      if (!requeueFail && badSet.has(p)) { skippedBad++; continue; }
      if (merged.includes(p)) { skippedDup++; continue; }
      merged.push(p);
      added++;
    }

    saveArr(LS.Q, merged);
    saveStr(LS.IN_DRAFT, ta.value || '');

    if (!silent) {
      UI.toast(`Added ${added}`);
      UI.log(`ADD: +${added} (skipped ok=${skippedOk}, fail=${skippedBad}, dup=${skippedDup}) (queue=${merged.length})`);
    }
    UI.render(true);
  }

  async function findPolicyInput(timeoutMs, stopFn) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (stopFn?.()) return null;

      let el = qAny(SEL.INPUT_PRIMARY) || qAny(SEL.INPUT_ALT);

      if (!el) {
        const all = qAnyAll(SEL.INPUT_WIDE);
        const cand = all.filter(n => {
          if (!isVisible(n)) return false;
          if (n.closest && n.closest('#tm-pc-step0-host')) return false;
          const id = (n.id || '').toLowerCase();
          const ph = String(n.getAttribute('placeholder') || '').toLowerCase();
          const aria = String(n.getAttribute('aria-label') || '').toLowerCase();
          if (id.includes('policyretrieval') || aria.includes('policy') || ph.includes('policy')) return true;
          const sub = n.closest && n.closest('.gw-subMenu[aria-hidden="false"]');
          return !!sub;
        });
        el = cand[0] || null;
      }

      if (isVisible(el)) return el;
      await sleep(110);
    }
    return null;
  }

  async function openPolicyDropdown(stopFn) {
    const btns = qAnyAll(SEL.POLICY_DROPDOWN_BTN).filter(isVisible);

    if (!btns.length) {
      UI.log('❌ No expand buttons found');
      return false;
    }

    const ordered = [];
    if (btns[1]) ordered.push(btns[1]);
    for (const b of btns) if (!ordered.includes(b)) ordered.push(b);

    UI.log(`Policy expand buttons visible: ${btns.length}`);

    for (let i = 0; i < ordered.length; i++) {
      if (stopFn?.()) return false;

      hitClick(ordered[i]);
      await sleep(CFG.afterExpandWaitMs);

      const got = await findPolicyInput(CFG.inputAppearTimeoutPerBtnMs, stopFn);
      if (got) {
        UI.log(`✅ Policy dropdown opened (button #${i + 1})`);
        return true;
      }
    }

    UI.log('❌ Expand clicked, but input never appeared');
    return false;
  }

  async function typePolicyNumber(input, policyNum, charDelayMs, stopFn) {
    if (!input) return false;
    try { input.focus({ preventScroll: true }); } catch {}
    try {
      setNativeValue(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(50);

      const s = String(policyNum || '');

      for (const ch of s) {
        if (stopFn?.()) return false;

        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
        input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: ch }));

        setNativeValue(input, (input.value || '') + ch);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));

        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
        await sleep(charDelayMs);
      }

      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  async function clickSubmit() {
    const el = qAny(SEL.SUBMIT);
    if (!isVisible(el)) return false;
    hitClick(el);
    await sleep(CFG.afterSubmitMinWaitMs);
    return true;
  }

  async function waitOutcome(policyNum, timeoutMs, stopFn) {
    const settle = (CFG.outcomeInitialDelayMs | 0);
    if (settle > 0) {
      const s0 = Date.now();
      while (Date.now() - s0 < settle) {
        if (stopFn?.()) return { type: 'stopped' };
        await sleep(120);
      }
    }

    const t0 = Date.now();
    const p = String(policyNum || '');
    while (Date.now() - t0 < timeoutMs) {
      if (stopFn?.()) return { type: 'stopped' };

      const sumEl = qAny(SEL.HDR_SUMMARY);
      if (isVisible(sumEl)) {
        const txt = clean(sumEl.textContent);
        if (/^policy summary/i.test(txt)) {
          if (!p || txt.includes(p) || !/\b\d{8,9}\b/.test(txt)) return { type: 'success', text: txt };
        }
      }

      const searchEl = qAny(SEL.HDR_SEARCH);
      if (isVisible(searchEl)) {
        const txt = clean(searchEl.textContent);
        if (txt === 'Search Policies') return { type: 'fail', text: txt };
      }

      await sleep(CFG.pollMs);
    }
    return { type: 'timeout' };
  }

  async function waitForRiskHeader(stopFn) {
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.waitRiskMaxMs) {
      if (stopFn?.()) return false;
      if (UI.state.skipRiskWait) {
        UI.state.skipRiskWait = false;
        UI.log('Risk wait SKIPPED (one time)');
        return true;
      }
      const el = qAny(SEL.HDR_RISK);
      if (isVisible(el) && clean(el.textContent) === 'Risk Analysis') return true;
      await sleep(260);
    }
    UI.log('⚠️ Timed out waiting Risk Analysis (continuing)');
    return true;
  }

  function signalStep1() {
    try {
      localStorage.setItem(LS.GO_AHEAD, '0');
      setTimeout(() => { try { localStorage.setItem(LS.GO_AHEAD, '1'); } catch {} }, 80);
      return true;
    } catch { return false; }
  }

  function shouldStop() { return !UI.state.running; }

  function resetExtractorStorageForPolicy(policyNum) {
    for (const key of EXTRACTOR_LOCAL_KEYS) {
      try { localStorage.removeItem(key); } catch {}
    }
    try { localStorage.setItem(LS.GO_AHEAD, '0'); } catch {}
    UI.log(`Extractor storage reset for ${policyNum}`);
  }

  function moveToSuccess(policyNum) {
    const q = loadArr(LS.Q);
    const ok = loadArr(LS.OK);
    const p = String(policyNum || '');
    saveArr(LS.Q, q.filter(x => x !== p));
    if (!ok.includes(p)) ok.unshift(p);
    saveArr(LS.OK, ok);
  }

  function moveToFail(policyNum) {
    const q = loadArr(LS.Q);
    const bad = loadArr(LS.BAD);
    const p = String(policyNum || '');
    saveArr(LS.Q, q.filter(x => x !== p));
    if (!bad.includes(p)) bad.unshift(p);
    saveArr(LS.BAD, bad);
  }

  async function enforceLongBreakIfActive() {
    const until = loadNum(LS.LB_UNTIL, 0);
    if (!until || until <= Date.now()) {
      if (until) saveNum(LS.LB_UNTIL, 0);
      return;
    }

    UI.log('⏸ PAUSE active — waiting…');
    while (Date.now() < until) {
      if (shouldStop()) return;
      const rem = until - Date.now();
      UI.setStatus(`PAUSE ${fmtMs(rem)}`); // live pill countdown
      UI.render();
      await sleep(1000);
    }

    saveNum(LS.LB_UNTIL, 0);
    UI.log('✅ PAUSE done — resuming');
    UI.setStatus('RUN');
    UI.render();
  }

  async function bumpSuccessAndMaybePause() {
    const every = getEvery();
    const pauseMs = getPauseMs();

    if (every <= 0 || pauseMs <= 0) return;

    let c = loadNum(LS.LB_COUNT, 0);
    c++;

    if (c < every) {
      saveNum(LS.LB_COUNT, c);
      UI.log(`Chunk progress: ${c}/${every}`);
      return;
    }

    saveNum(LS.LB_COUNT, 0);

    const until = Date.now() + pauseMs;
    saveNum(LS.LB_UNTIL, until);

    UI.toast(`PAUSE ${getPauseMinutes()} min`);
    UI.log(`⏸ PAUSE after ${every} successes — ${getPauseMinutes()} min`);
    await enforceLongBreakIfActive();
  }

  async function processOne(policyNum) {
    const pOrig = String(policyNum || '').trim();
    if (!pOrig) return { type: 'fail' };

    UI.state.current = pOrig;
    UI.setStatus('SEARCH');
    UI.render();
    resetExtractorStorageForPolicy(pOrig);

    const variants = buildAttemptStrings(pOrig);

    for (let vi = 0; vi < variants.length; vi++) {
      const pTryBase = variants[vi];

      for (let attempt = 1; attempt <= 3; attempt++) {
        if (shouldStop()) return { type: 'stopped' };

        const idx = attempt - 1;
        const typingDelay = CFG.retryTypingDelayMs[idx] ?? CFG.retryTypingDelayMs[0];
        const inputTimeout = CFG.retryInputTimeoutMs[idx] ?? CFG.retryInputTimeoutMs[0];
        const outcomeTimeout = CFG.retryOutcomeTimeoutMs[idx] ?? CFG.retryOutcomeTimeoutMs[0];
        const backoff = CFG.retryBackoffBeforeTryMs[idx] ?? 0;

        const variantLabel = (variants.length === 2 && vi === 1) ? 'leading-0' : 'normal';

        if (backoff) { UI.log(`Attempt ${attempt}/3 (${variantLabel}) backoff ${backoff}ms`); await sleep(backoff); }
        else UI.log(`Attempt ${attempt}/3 (${variantLabel})`);

        UI.log(variantLabel === 'leading-0' ? `Try policy (0+): ${pTryBase}` : `Try policy: ${pTryBase}`);

        const opened = await openPolicyDropdown(shouldStop);
        if (!opened) { UI.log('❌ Could not open Policy dropdown'); continue; }

        const input = await findPolicyInput(inputTimeout, shouldStop);
        if (!input) { UI.log('❌ Policy input not found'); continue; }

        const typed = await typePolicyNumber(input, pTryBase, typingDelay, shouldStop);
        if (!typed) { UI.log('❌ Could not type policy #'); continue; }

        const submitted = await clickSubmit();
        if (!submitted) { UI.log('❌ Submit not clickable'); continue; }

        const out = await waitOutcome(pTryBase, outcomeTimeout, shouldStop);
        if (out.type === 'success') { UI.log(`✅ SUCCESS: ${out.text || 'Policy Summary'}`); return { type: 'success' }; }
        if (out.type === 'fail') { UI.log('❌ FAIL: Search Policies'); continue; }
        if (out.type === 'timeout') { UI.log('⚠️ Outcome timeout'); continue; }
        if (out.type === 'stopped') return { type: 'stopped' };
      }

      if (variants.length === 2 && vi === 0) {
        UI.log('Normal 8-digit failed 3x → trying leading-0 (3 tries)');
      }
    }

    return { type: 'fail' };
  }

  async function cooldownBetweenPolicies() {
    const ms = CFG.cooldownBetweenPoliciesMs | 0;
    if (ms <= 0) return;
    UI.setStatus('COOLDOWN');
    UI.log(`Cooldown ${ms}ms…`);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (shouldStop()) return;
      await sleep(120);
    }
  }

  async function pump() {
    if (UI.state.busy) return;
    if (!UI.state.running) return;

    UI.state.busy = true;
    try {
      while (UI.state.running) {
        await enforceLongBreakIfActive();
        if (!UI.state.running) break;

        const queue = loadArr(LS.Q);
        if (!queue.length) {
          UI.log('Queue empty — press ADD then START');
          UI.setStatus('WAIT');
          UI.state.current = '';
          UI.render(true);
          break;
        }

        const policy = queue[0];
        UI.toast(`Working: ${policy}`);
        UI.log(`▶ Next: ${policy}`);

        const res = await processOne(policy);

        if (res.type === 'stopped') {
          UI.setStatus('STOPPED');
          UI.log('Stopped by user');
          break;
        }

        if (res.type === 'success') {
          moveToSuccess(policy);
          UI.render(true);

          const signaled = signalStep1();
          UI.log(signaled ? `GO_AHEAD sent (${LS.GO_AHEAD}=1)` : '❌ GO_AHEAD failed');
          UI.setStatus('WAIT');

          UI.log('⏸ Waiting Risk Analysis…');
          await waitForRiskHeader(shouldStop);

          await cooldownBetweenPolicies();
          if (!UI.state.running) { UI.setStatus('STOPPED'); UI.log('Stopped during cooldown'); break; }

          await bumpSuccessAndMaybePause();
          if (!UI.state.running) { UI.setStatus('STOPPED'); UI.log('Stopped during pause'); break; }

          UI.log('Risk Analysis detected → next');
          UI.setStatus('RUN');
          UI.render(true);
          continue;
        }

        moveToFail(policy);
        UI.toast(`Fail: ${policy}`);
        UI.log(`⏭ FAIL after tries: ${policy}`);
        UI.setStatus('RUN');
        UI.render(true);

        await cooldownBetweenPolicies();
        if (!UI.state.running) { UI.setStatus('STOPPED'); UI.log('Stopped during cooldown'); break; }
      }
    } finally {
      UI.state.busy = false;
      UI.setStatus(UI.state.running ? 'RUN' : 'IDLE');
      UI.render();
    }
  }

  function watchdog() {
    try {
      const host = document.getElementById('tm-pc-step0-host');
      const ok = !!(host && host.shadowRoot && host.shadowRoot.getElementById('wrap'));
      if (!ok) UI.mount(true);
    } catch {}
  }

  function uiTicker() {
    try {
      const until = loadNum(LS.LB_UNTIL, 0);
      const rem = until - Date.now();
      if (rem > 0) {
        UI.setStatus(`PAUSE ${fmtMs(rem)}`);
      }
      UI.render();
    } catch {}
  }

  function boot() {
    try {
      ensureDefaults();
      UI.mount(true);
      UI.setupLiveSync();
      UI.log('Loaded. NOT auto-starting.');
      UI.setStatus('IDLE');
      setInterval(watchdog, CFG.watchdogMs);
      setInterval(uiTicker, 1000); // <- live counter + countdown tick
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    setTimeout(() => { try { if (!document.getElementById('tm-pc-step0-host')) boot(); } catch {} }, 1200);
  } else {
    boot();
  }
})();
