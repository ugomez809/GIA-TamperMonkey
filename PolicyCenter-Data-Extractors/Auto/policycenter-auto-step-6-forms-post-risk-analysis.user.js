// ==UserScript==
// @name         PolicyCenter — Step 6: Forms → POST ONCE → Clear → ALWAYS Click Risk Analysis (ALWAYS ON)
// @namespace    tm.pc.step6.forms.post.risk
// @version      1.2.7
// @description  ALWAYS ON. When Forms header is visible: wait 5s → POST policy payload ONCE (no retries, no duplicates) → clear all tm_pc_* (keeps Step6 dedupe keys) → click Risk Analysis. FAILSAFE: after 2 minutes on Forms, click Risk Analysis no matter what (ignores busy). Sends Vehicles ONLY when VIN matches a Step5 subtotal VIN (unmatched VINs are skipped). Saves failed policy numbers to auto-downloaded pc_failed_posts.txt. UI: bottom-left circle toggles log drawer.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-6-forms-post-risk-analysis.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-6-forms-post-risk-analysis.user.js
// ==/UserScript==

(() => {
  'use strict';
  try { if (window.top !== window.self) return; } catch {}

  if (window.__tm_pc_step6_v127_running) return;
  window.__tm_pc_step6_v127_running = true;

  const CFG = {
    scriptId: 'tm_pc_step6_forms_post_risk_v1',
    webappUrl: 'https://script.google.com/macros/s/AKfycbzBwYlW17jiQOsSh0DqwG1PiGWqFgiCBsBdphccXxV22FAo4pV-cSH7HopKDjMTCOdoAQ/exec',

    tickMs: 1200,
    stableMs: 1200,
    cooldownMs: 4000,
    waitAfterFormsMs: 5000,

    postTimeoutMs: 90000,
    dedupeMs: 30 * 60 * 1000,
    dedupeKeyPrefix: 'tm_pc_step6_posted_',

    riskClickRetryEveryMs: 350,
    riskMaxWaitMs: 20000,
    riskFailsafeMs: 2 * 60 * 1000,

    failKey: 'tm_pc_failed_posts_v1',
    failDownloadName: 'pc_failed_posts.txt',
    failDlCooldownMs: 60 * 1000,
    failDlLastKey: 'tm_pc_failed_posts_last_dl_v1',

    uiOpenKey: 'tm_pc_step6_ui_open_v1',
  };

  // STOP is session-only
  const STOP_KEY = `${CFG.scriptId}_stop_session`;
  let stopped = false;
  try { stopped = sessionStorage.getItem(STOP_KEY) === '1'; } catch {}

  // session inflight lock
  const INFLIGHT_KEY = `${CFG.scriptId}_inflight`;
  const getInflight = () => { try { return sessionStorage.getItem(INFLIGHT_KEY) === '1'; } catch { return false; } };
  const setInflight = (v) => { try { sessionStorage.setItem(INFLIGHT_KEY, v ? '1' : '0'); } catch {} };

  // ---------- UI (bottom-left circle + drawer) ----------
  const UI = (() => {
    const rootId = `${CFG.scriptId}_ui`;
    const styleId = `${rootId}_style`;
    let open = false;
    try { open = GM_getValue(CFG.uiOpenKey, '0') === '1'; } catch {}

    const ensure = () => {
      if (!document.getElementById(styleId)) {
        const s = document.createElement('style');
        s.id = styleId;
        s.textContent = `
          #${rootId}{position:fixed;left:12px;bottom:12px;z-index:2147483647;font:12px system-ui,Segoe UI,Arial}
          #${rootId}_fab{
            width:44px;height:44px;border-radius:999px;display:flex;align-items:center;justify-content:center;
            background:rgba(20,20,20,.92);color:#fff;border:1px solid rgba(255,255,255,.18);
            box-shadow:0 10px 28px rgba(0,0,0,.35);cursor:pointer;user-select:none
          }
          #${rootId}_fab:hover{background:rgba(30,30,30,.94)}
          #${rootId}_badge{
            position:absolute;left:32px;bottom:32px;
            background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.18);
            border-radius:999px;padding:2px 6px;font-size:10px;min-width:18px;text-align:center
          }
          #${rootId}_drawer{
            position:absolute;left:0;bottom:54px;width:min(700px, calc(100vw - 24px));min-width:min(520px, calc(100vw - 24px));max-height:calc(100vh - 86px);
            background:rgba(20,20,20,.92);color:#fff;border:1px solid rgba(255,255,255,.15);
            border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.4);overflow:hidden
          }
          #${rootId}_top{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12)}
          #${rootId}_title{font-weight:800}
          #${rootId}_state{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.18);opacity:.95}
          #${rootId}_top button{
            font:inherit;color:#fff;background:rgba(255,255,255,.08);
            border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:4px 8px;cursor:pointer
          }
          #${rootId}_top button:hover{background:rgba(255,255,255,.12)}
          #${rootId}_log{
            padding:8px 10px;font-size:11px;opacity:.95;max-height:260px;overflow:auto;white-space:pre-wrap
          }
        `;
        document.documentElement.appendChild(s);
      }

      let root = document.getElementById(rootId);
      if (root) return root;

      root = document.createElement('div');
      root.id = rootId;

      root.innerHTML = `
        <div id="${rootId}_fab" title="Step6 logs (click)">S6</div>
        <div id="${rootId}_badge">0</div>

        <div id="${rootId}_drawer" style="display:${open ? 'block' : 'none'}">
          <div id="${rootId}_top">
            <div id="${rootId}_title">Step6</div>
            <div id="${rootId}_state">arming…</div>
            <div style="flex:1"></div>
            <button id="${rootId}_post">POST NOW</button>
            <button id="${rootId}_fails">FAILS</button>
            <button id="${rootId}_toggle">${stopped ? 'START' : 'STOP'}</button>
          </div>
          <div id="${rootId}_log"></div>
        </div>
      `;
      document.documentElement.appendChild(root);

      const fab = root.querySelector(`#${rootId}_fab`);
      const drawer = root.querySelector(`#${rootId}_drawer`);

      fab.addEventListener('click', () => {
        open = !open;
        drawer.style.display = open ? 'block' : 'none';
        try { GM_setValue(CFG.uiOpenKey, open ? '1' : '0'); } catch {}
      });

      root.querySelector(`#${rootId}_toggle`).addEventListener('click', () => {
        stopped = !stopped;
        try { sessionStorage.setItem(STOP_KEY, stopped ? '1' : '0'); } catch {}
        root.querySelector(`#${rootId}_toggle`).textContent = stopped ? 'START' : 'STOP';
        setState(stopped ? 'STOPPED' : 'WATCHING');
        log(stopped ? 'Stopped for this tab session. (Reload resumes)' : 'Resumed.');
        if (!stopped) tick(true);
      });

      root.querySelector(`#${rootId}_post`).addEventListener('click', async () => {
        log('Manual POST NOW…');
        await fire(true);
      });

      root.querySelector(`#${rootId}_fails`).addEventListener('click', () => {
        const set = loadFailSet();
        log(`Fails count=${set.size}`);
        downloadFailList(set);
      });

      setState(stopped ? 'STOPPED' : 'WATCHING');
      return root;
    };

    let logCount = 0;

    const setState = (t) => {
      const root = ensure();
      const el = root.querySelector(`#${rootId}_state`);
      if (el) el.textContent = t;
    };

    const log = (m) => {
      const root = ensure();
      const box = root.querySelector(`#${rootId}_log`);
      const badge = root.querySelector(`#${rootId}_badge`);
      if (box) {
        box.textContent = (box.textContent + `[${new Date().toLocaleTimeString()}] ${m}\n`).slice(-22000);
        box.scrollTop = box.scrollHeight;
      }
      logCount++;
      if (badge) badge.textContent = String(logCount);
    };

    return { ensure, setState, log };
  })();

  UI.ensure();

  // -------- helpers --------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => !!el && el.ownerDocument.contains(el) && el.getClientRects().length > 0;

  const hitClick = (el) => {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const r = el.getBoundingClientRect();
    const x = (r.left + r.width / 2) | 0, y = (r.top + r.height / 2) | 0;
    const tgt = el.ownerDocument.elementFromPoint(x, y) || el;
    ['pointerdown','mousedown','mouseup','pointerup','click']
      .forEach(t => tgt.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, clientX:x, clientY:y })));
  };

  const formsHeaderVisible = () => {
    const t =
      document.querySelector('#PolicyFile_Forms_PA-PolicyFile_PolicyLine_FormsScreen-0 .gw-TitleBar--title')?.textContent?.trim()
      || document.querySelector('.gw-TitleBarWidget.gw-isScreenTitle .gw-TitleBar--title')?.textContent?.trim()
      || document.querySelector('.gw-TitleBar--title')?.textContent?.trim()
      || '';
    return /forms/i.test(t);
  };

  const isBusy = () => {
    if (document.body?.classList?.contains('gw-busy')) return true;
    return !!document.querySelector(
      '.gw-busyIndicator, .gw-BusyIndicator, .gw-glassPane, .gw-glasspane, .gw-ProgressBarWidget, [aria-busy="true"]'
    );
  };

  const findRiskEl = () => {
    let el = document.querySelector('#PolicyFile-MenuLinks-PolicyFile_PolicyFile_RiskAnalysis');
    if (vis(el)) return el;

    const menu = document.querySelector('#PolicyFile-MenuLinks');
    if (menu) {
      const nodes = menu.querySelectorAll('a, button, [role="menuitem"], .gw-action--inner, [data-gw-click]');
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (vis(n) && /risk\s*analysis/i.test((n.textContent || '').trim())) return n;
      }
    }
    return null;
  };

  const clickRiskWithWait = async (tag) => {
    const start = Date.now();
    while (Date.now() - start < CFG.riskMaxWaitMs) {
      if (stopped) return false;
      if (!formsHeaderVisible()) return false;
      if (isBusy()) { await sleep(200); continue; }

      const el = findRiskEl();
      if (el) { hitClick(el); UI.log(`Risk clicked ✅ (${tag})`); return true; }
      await sleep(CFG.riskClickRetryEveryMs);
    }
    return false;
  };

  const forceClickRisk = async (tag) => {
    const start = Date.now();
    while (Date.now() - start < CFG.riskMaxWaitMs) {
      if (stopped) return false;
      if (!formsHeaderVisible()) return false;

      const el = findRiskEl();
      if (el) { hitClick(el); UI.log(`Risk FORCE clicked ✅ (${tag})`); return true; }
      await sleep(250);
    }
    return false;
  };

  // IMPORTANT: clears policy data, but keeps Step6 dedupe keys
  const clearAllPcLocalStorage = () => {
    try {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (!k.startsWith('tm_pc_')) continue;
        if (k.startsWith(CFG.dedupeKeyPrefix)) continue; // keep dedupe marks
        localStorage.removeItem(k);
      }
    } catch {}
  };

  const dedupeKey = (pn) => `${CFG.dedupeKeyPrefix}${String(pn || '').trim()}`;
  const isDeduped = (pn) => {
    try {
      const ts = Number(localStorage.getItem(dedupeKey(pn)) || 0);
      return ts && (Date.now() - ts) < CFG.dedupeMs;
    } catch { return false; }
  };
  const markDeduped = (pn) => { try { localStorage.setItem(dedupeKey(pn), String(Date.now())); } catch {} };

  const loadFailSet = () => {
    try { return new Set(JSON.parse(GM_getValue(CFG.failKey, '[]'))); }
    catch { return new Set(); }
  };
  const saveFailSet = (set) => GM_setValue(CFG.failKey, JSON.stringify(Array.from(set)));

  const canDownloadFailNow = () => {
    try {
      const last = Number(GM_getValue(CFG.failDlLastKey, '0') || 0);
      return (Date.now() - last) > CFG.failDlCooldownMs;
    } catch { return true; }
  };
  const touchFailDl = () => { try { GM_setValue(CFG.failDlLastKey, String(Date.now())); } catch {} };

  const downloadFailList = (set) => {
    const text = Array.from(set).sort().join('\n') + '\n';
    const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(text);
    GM_download({
      url,
      name: CFG.failDownloadName,
      saveAs: false,
      onload: () => UI.log('Fail TXT downloaded ✅'),
      onerror: () => UI.log('Fail TXT download blocked ❌'),
    });
  };

  const recordFail = (pn) => {
    const policy = String(pn || '').trim() || 'UNKNOWN_POLICY';
    const set = loadFailSet();
    set.add(policy);
    saveFailSet(set);
    UI.log(`FAIL saved: ${policy}`);
    if (canDownloadFailNow()) {
      touchFailDl();
      downloadFailList(set);
    } else {
      UI.log('Fail TXT download throttled (cooldown).');
    }
  };

  // payload builder
  const ls = (k) => localStorage.getItem(k) || '';
  const deepParse = (v, depth = 0) => {
    if (depth > 4) return v;
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t) return v;
      try { return deepParse(JSON.parse(t), depth + 1); } catch { return v; }
    }
    return v;
  };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const asObj = (v) => { v = deepParse(v); return isObj(v) ? v : {}; };
  const s = (v) => (v == null ? '' : String(v));

  const extractRowsArray = (wrap) => {
    const o = asObj(wrap);
    if (Array.isArray(o.rows)) return o.rows;
    if (Array.isArray(o.data?.rows)) return o.data.rows;
    const parsed = deepParse(wrap);
    if (Array.isArray(parsed)) return parsed;
    return [];
  };

  // VIN helpers
  const normalizeVin = (vin) => {
    const t = s(vin).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return t.length === 17 ? t : '';
  };
  const findVinInText = (txt) => {
    const t = s(txt).toUpperCase();
    // VIN excludes I,O,Q; use VIN-safe chars
    const m = t.match(/([A-HJ-NPR-Z0-9]{17})/);
    return m ? normalizeVin(m[1]) : '';
  };
  const extractVinFromAny = (v) => {
    if (!v) return '';
    if (typeof v === 'string') return findVinInText(v);

    if (Array.isArray(v)) {
      for (const cell of v) {
        const vin = extractVinFromAny(cell);
        if (vin) return vin;
      }
      return '';
    }

    if (isObj(v)) {
      // common keys
      const keys = [
        'vin','VIN','Vin','vehicle_vin','VehicleVIN','vehicleVIN',
        'vin_number','VINNumber','VIN_Number','vinNo','VINNo'
      ];
      for (const k of keys) {
        const vin = normalizeVin(v[k]);
        if (vin) return vin;
      }

      // try scan a few likely text fields
      const textKeys = [
        'vehicle','Vehicle','desc','Desc','description','Description',
        'name','Name','label','Label','display','Display','text','Text'
      ];
      for (const k of textKeys) {
        const vin = findVinInText(v[k]);
        if (vin) return vin;
      }

      // last resort: stringify object and scan
      try {
        const vin = findVinInText(JSON.stringify(v));
        if (vin) return vin;
      } catch {}
    }

    return '';
  };

  const moneyToNumberString = (raw) => {
    const t = s(raw).trim();
    if (!t) return '';
    // keep digits + dot
    const n = t.replace(/[^0-9.]/g, '');
    return n ? n : '';
  };

  // IMPORTANT: make Quote match your Apps Script expectations:
  // Q.discounts_count and Q.discounts (array)
  const normalizeQuoteForReceiver = (q) => {
    if (!isObj(q)) q = {};

    let arr = [];
    if (Array.isArray(q.discounts_list)) arr = q.discounts_list.slice();
    else if (Array.isArray(q.discounts)) arr = q.discounts.slice();

    arr = arr.map(x => s(x).trim()).filter(Boolean);

    q.discounts = arr;
    q.discounts_count = arr.length;

    q.discounts_joined = arr.join(', ');
    q.Discounts_Count = arr.length;
    q.Discounts_Joined = arr.join(', ');

    if (typeof q.discounts_raw !== 'string') q.discounts_raw = s(q.discounts_raw);

    return q;
  };

  // Build VIN -> subtotal map from Step5 Quote object (supports multiple shapes)
  const buildVinSubtotalMapFromQuote = (quoteObj) => {
    const map = new Map();

    const tryAdd = (vinMaybe, itemMaybe) => {
      const vin = normalizeVin(vinMaybe) || extractVinFromAny(itemMaybe);
      if (!vin) return;

      const it = isObj(itemMaybe) ? itemMaybe : {};
      const raw =
        s(it.subtotal_raw || it.subtotalRaw || it.subtotal || it.premium_raw || it.premiumRaw || it.premium || it.amount_raw || it.amountRaw || it.amount)
        || '';
      const num =
        s(it.subtotal_number || it.subtotalNumber || it.subtotal_num || it.premium_number || it.premiumNumber || it.amount_number || it.amountNumber)
        || moneyToNumberString(raw);

      // last-wins
      map.set(vin, {
        vin,
        subtotal_raw: raw,
        subtotal_number: num,
      });
    };

    const q = isObj(quoteObj) ? quoteObj : {};

    // Case: explicit map objects
    const mapObjs = [
      q.vin_subtotals,
      q.vinSubtotals,
      q.vehicle_subtotals_by_vin,
      q.vehicleSubtotalsByVin,
      q.subtotals_by_vin,
      q.subtotalsByVin
    ].filter(isObj);

    for (const mo of mapObjs) {
      for (const [k, v] of Object.entries(mo)) {
        if (isObj(v)) tryAdd(k, v);
        else tryAdd(k, { subtotal_raw: v });
      }
    }

    // Case: arrays
    const arrKeys = [
      'vehicle_subtotals','vehicleSubtotals',
      'per_vehicle_subtotals','perVehicleSubtotals',
      'vehicle_subtotals_list','vehicleSubtotalsList',
      'subtotals','subtotals_list','subtotalsList',
      'vehicles','vehiclePremiums','vehicle_premiums','vehiclePremiumRows','vehicle_subtotal_rows'
    ];

    for (const k of arrKeys) {
      const arr = q[k];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (isObj(item)) {
          // prefer item.vin, else parse from item.vehicle/desc etc.
          tryAdd(item.vin || item.VIN || item.Vin, item);
        } else {
          // string case: "....VIN.... $123.45"
          const vin = extractVinFromAny(item);
          if (!vin) continue;
          const raw = s(item);
          tryAdd(vin, { subtotal_raw: raw, subtotal_number: moneyToNumberString(raw) });
        }
      }
    }

    return map;
  };

  const buildVehicleCoveragesFromRowPairs = (row) => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const vehicle = s(row[2 + i * 2] || '').trim();
      const coverages = s(row[3 + i * 2] || '').trim();
      if (!vehicle && !coverages) continue;
      out.push({ idx: i + 1, vehicle, coverages });
    }
    return out;
  };

  const buildPayload = () => {
    const piRaw = ls('tm_pc_policyinfo_v1');
    if (!piRaw) return { ok:false, pn:'UNKNOWN_POLICY', error:'Missing tm_pc_policyinfo_v1' };

    const piWrap = asObj(deepParse(piRaw));
    const pi = asObj(piWrap.data || piWrap);

    const Policy_Info = {
      'PolicyNumber': s(pi.PolicyNumber || pi['PolicyNumber']),
      'Account Number': s(pi['Account Number']),
      'Primary Insured Name': s(pi['Primary Insured Name']),
      'Secondary Insured Name (if any)': s(pi['Secondary Insured Name (if any)']),
      'Phone Number (Preferred)': s(pi['Phone Number (Preferred)']),
      'Email Address (Preferred)': s(pi['Email Address (Preferred)']),
      'Policy Expiration Date': s(pi['Policy Expiration Date']),
      'Rolling Signature (eSignature) (Yes/No)': s(pi['Rolling Signature (eSignature) (Yes/No)']),
      'Policy Type': s(pi['Policy Type']),
      'Paperless Policy': s(pi['Paperless Policy']),
      'Paperless Billing': s(pi['Paperless Billing']),
    };

    const pn = Policy_Info.PolicyNumber || 'UNKNOWN_POLICY';

    const Drivers = extractRowsArray(ls('tm_pc_drivers_v1'));

    // ---- Vehicles merge-by-VIN with Step5 subtotals ----
    const VehiclesAll = extractRowsArray(ls('tm_pc_vehicles_v1'));

    const qWrap = asObj(ls('tm_pc_quote_v1'));
    const qRawObj = asObj(qWrap.data || qWrap);
    const vinToSubtotal = buildVinSubtotalMapFromQuote(qRawObj);

    const Vehicles = [];
    let skippedNoVin = 0;
    let skippedNoMatch = 0;

    for (const v of VehiclesAll) {
      const vin = extractVinFromAny(v);
      if (!vin) { skippedNoVin++; continue; }

      const sub = vinToSubtotal.get(vin);
      if (!sub) { skippedNoMatch++; continue; }

      // keep vehicle shape but ensure object
      let out;
      if (isObj(v)) out = { ...v };
      else if (Array.isArray(v)) out = { row: v };
      else out = { value: v };

      // force normalized vin + attach subtotal
      out.vin = vin;
      out.subtotal_raw = s(sub.subtotal_raw);
      out.subtotal_number = s(sub.subtotal_number);

      Vehicles.push(out);
    }

    // PA Coverages: use row[1] for all_coverages; blank export_txt
    const paRowObj = asObj(ls('tm_pc_pacoverages_row_v1'));
    let row = Array.isArray(paRowObj.row) ? paRowObj.row : null;
    if (!row) {
      const rv = deepParse(ls('tm_pc_pacoverages_row_values_v1'));
      row = Array.isArray(rv) ? rv : [];
    }

    const PA_Coverages = {
      all_label: s(row?.[0] || '').trim(),
      all_coverages: s(row?.[1] || '').trim(),
      vehicle_coverages: Array.isArray(row) ? buildVehicleCoveragesFromRowPairs(row) : [],
      export_txt: '',
    };

    // Quote (fix for receiver)
    const Quote = normalizeQuoteForReceiver(asObj(qRawObj));

    const dbg = {
      drivers_count: Array.isArray(Drivers) ? Drivers.length : 0,
      vehicles_all_count: Array.isArray(VehiclesAll) ? VehiclesAll.length : 0,
      vehicles_matched_count: Array.isArray(Vehicles) ? Vehicles.length : 0,
      vehicles_skipped_no_vin: skippedNoVin,
      vehicles_skipped_no_match: skippedNoMatch,
      quote_vin_subtotals_count: vinToSubtotal.size,
      vc_count: Array.isArray(PA_Coverages.vehicle_coverages) ? PA_Coverages.vehicle_coverages.length : 0,
      all_coverages_len: (PA_Coverages.all_coverages || '').length,
      discounts_count: Number(Quote.discounts_count || 0),
      discounts_joined_len: String(Quote.discounts_joined || '').length,
    };

    return {
      ok:true,
      pn,
      payload: {
        Policy_Info,
        Drivers,
        Vehicles,
        PA_Coverages,
        Quote,
        _meta: { sent_at: new Date().toISOString(), from: 'tm_step6_v1.2.5', dbg }
      }
    };
  };

  const postOnce = (payload) => new Promise((resolve) => {
    const data = JSON.stringify(payload);
    GM_xmlhttpRequest({
      method: 'POST',
      url: CFG.webappUrl,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      data,
      timeout: CFG.postTimeoutMs,
      onload: (r) => {
        const status = Number(r.status || 0);
        const txt = String(r.responseText || '');
        resolve({ ok: status >= 200 && status < 300, status, txt });
      },
      onerror: () => resolve({ ok:false, status:0, txt:'onerror' }),
      ontimeout: () => resolve({ ok:false, status:0, txt:'timeout' }),
    });
  });

  // per-visit state + failsafe
  let prevForms = false;
  let formsSeenAt = 0;
  let firedThisVisit = false;
  let running = false;
  let lastFireAt = 0;

  let riskClickedThisVisit = false;
  let failsafeTimer = null;

  const clearFailsafe = () => { if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null; } };
  const armFailsafe = () => {
    clearFailsafe();
    riskClickedThisVisit = false;
    failsafeTimer = setTimeout(async () => {
      if (stopped) return;
      if (!formsHeaderVisible()) return;
      if (riskClickedThisVisit) return;
      UI.log('FAILSAFE: 2 minutes → FORCE click Risk (ignoring busy)…');
      const ok = await forceClickRisk('failsafe');
      riskClickedThisVisit = !!ok;
      if (!ok) UI.log('FAILSAFE: Risk still not found/clickable.');
    }, CFG.riskFailsafeMs);
    UI.log(`Failsafe armed: ${Math.round(CFG.riskFailsafeMs / 1000)}s`);
  };

  async function fire(manual = false) {
    if (running) return;
    if (getInflight()) return;

    running = true;
    setInflight(true);
    firedThisVisit = true;

    try {
      UI.setState('RUNNING');

      if (!manual) {
        if (!formsHeaderVisible()) return;
        if (isBusy()) return;
      }

      const built = buildPayload();
      UI.log(`Payload policy=${built.pn} ok=${built.ok}`);

      if (!built.ok) {
        UI.log(`Build failed: ${built.error}`);
        recordFail(built.pn);
        clearAllPcLocalStorage();
        UI.log('Cleared tm_pc_* ✅');
        const c = await clickRiskWithWait('build-fail');
        riskClickedThisVisit = riskClickedThisVisit || !!c;
        return;
      }

      const pn = built.pn;

      // show match stats (quick)
      try {
        const dbg = built.payload?._meta?.dbg;
        if (dbg) UI.log(`Vehicles matched=${dbg.vehicles_matched_count}/${dbg.vehicles_all_count} (noVIN=${dbg.vehicles_skipped_no_vin}, noMatch=${dbg.vehicles_skipped_no_match}, qMap=${dbg.quote_vin_subtotals_count})`);
      } catch {}

      if (isDeduped(pn) && !manual) {
        UI.log(`DEDUPED: ${pn} (no post)`);
        clearAllPcLocalStorage();
        UI.log('Cleared tm_pc_* ✅');
        const c = await clickRiskWithWait('dedupe');
        riskClickedThisVisit = riskClickedThisVisit || !!c;
        return;
      }

      if (!manual) {
        UI.log(`Wait ${CFG.waitAfterFormsMs}ms…`);
        await sleep(CFG.waitAfterFormsMs);
        if (stopped) return;
        if (!formsHeaderVisible()) { UI.log('Abort: left Forms'); return; }
      }

      markDeduped(pn);

      UI.log('POST ONCE…');
      const res = await postOnce(built.payload);

      UI.log(`POST status=${res.status} ok=${res.ok} resp="${(res.txt || '').slice(0, 140).replace(/\s+/g,' ').trim()}"`);

      if (!res.ok) recordFail(pn);

      clearAllPcLocalStorage();
      UI.log('Cleared tm_pc_* ✅');

      const clicked = await clickRiskWithWait(res.ok ? 'after-post' : 'after-post-fail');
      riskClickedThisVisit = riskClickedThisVisit || !!clicked;
      UI.log(clicked ? 'Risk click done ✅' : 'Risk not clicked yet ❌ (failsafe will force)');
    } finally {
      lastFireAt = Date.now();
      UI.setState(stopped ? 'STOPPED' : 'WATCHING');
      running = false;
      setInflight(false);
    }
  }

  function tick(force = false) {
    if (stopped) {
      UI.setState('STOPPED');
      prevForms = false;
      formsSeenAt = 0;
      firedThisVisit = false;
      clearFailsafe();
      riskClickedThisVisit = false;
      return;
    }

    UI.setState('WATCHING');

    const curForms = formsHeaderVisible();

    if (!curForms) {
      prevForms = false;
      formsSeenAt = 0;
      firedThisVisit = false;
      clearFailsafe();
      riskClickedThisVisit = false;
      return;
    }

    if (!prevForms) {
      formsSeenAt = Date.now();
      firedThisVisit = false;
      UI.log('Forms detected (new visit) — waiting stable…');
      armFailsafe();
    }
    prevForms = true;

    if (firedThisVisit && !force) return;
    if (isBusy()) return;
    if (Date.now() - formsSeenAt < CFG.stableMs) return;
    if (Date.now() - lastFireAt < CFG.cooldownMs) return;

    fire(false);
  }

  tick(true);
  setInterval(() => tick(false), CFG.tickMs);
})();
