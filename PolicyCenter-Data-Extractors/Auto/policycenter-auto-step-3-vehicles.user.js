// ==UserScript==
// @name         PolicyCenter — Step 3: Vehicles (ALWAYS ON + Annual Miles + PA Coverages click/verify)
// @namespace    tm.pc.step3.vehicles
// @version      1.1.5
// @description  ALWAYS ON each load. Watches for Vehicles header; when visible runs: extract Vehicles table + Annual Miles, save to localStorage, real-click PA Coverages and verify by URL/header. STOP only stops this page session; reload forgets STOP and resumes.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-3-vehicles.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-3-vehicles.user.js
// ==/UserScript==

(() => {
  'use strict';

  /**********************
   * KEYS
   **********************/
  const KEYS = {
    payload: 'tm_pc_vehicles_v1',
    ready: 'tm_pc_vehicles_ready_v1',
    stage: 'tm_pc_stage_v1',

    paused: 'tm_pc_step3_paused_v1',        // kept for UI display only; not persisted by STOP
    cmd: 'tm_pc_step3_cmd_v1',
    status: 'tm_pc_step3_status_v1',
    logs: 'tm_pc_step3_logs_v1',

    owner: 'tm_pc_step3_top_owner_v1',
    ownerHb: 'tm_pc_step3_top_owner_hb_v1',

    lastRunAt: 'tm_pc_step3_last_run_at_v1',
    cooldownUntilHeaderGone: 'tm_pc_step3_cooldown_v1', // we keep but never allow "stuck"
  };

  const UI = {
    hostId: 'tm_pc_step3_host',
    bubbleId: 'tm_pc_step3_bubble',
    rightPx: 678,
    bottomPx: 14,
    widthPx: 320,
  };

  const SELECTORS = {
    titleBarHeading: 'div.gw-TitleBar--title[role="heading"][aria-level="1"]',
    vehiclesHeaderText: 'Vehicles',

    vehiclesTbody: [
      '#PolicyFile_Vehicles-VehiclesScreen-VehiclesDV-VehiclesLV table > tbody',
      '[id$="VehiclesLV"] table > tbody',
      '[id*="VehiclesLV"] table > tbody',
      '[id*="VehiclesScreen"] table > tbody',
    ],

    paCoveragesMenuTop1: '#PolicyFile-PolicyFileAcceleratedMenuActions-PolicyMenuItemSet-PolicyMenuItemSet_PersonalAuto',
  };

  const DETAIL = {
    annualLabel: 'Annual Miles',
    annualInputIdContains: 'AnnualMileageCA_DV_Input',
    annualValueIdContains: 'AnnualMileageCA_DV',
  };

  const FRAME_ID = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const MSG_CH = '__tm_pc_step3__';

  /**********************
   * UTILS
   **********************/
  const pad2 = (n) => String(n).padStart(2, '0');
  const ts = () => {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  };
  const normText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const safeJsonParse = (s, fb = null) => { try { return JSON.parse(s); } catch { return fb; } };

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
  const lsDel = (k) => { try { localStorage.removeItem(k); return true; } catch { return false; } };

  const isTop = () => window.top === window.self;

  // ✅ ALWAYS ON EVERY LOAD (STOP is session-only)
  // Clear "stuck" states on load
  try {
    lsSet(KEYS.paused, '0');
    lsSet(KEYS.cooldownUntilHeaderGone, '0');
    lsDel(KEYS.owner);
    lsDel(KEYS.ownerHb);
  } catch {}

  const sleep = (ms, signal) => new Promise((res) => {
    if (signal?.aborted) return res(false);
    const t = setTimeout(() => res(true), ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); res(false); }, { once: true });
  });

  const isVisibleEl = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  function postToTop(type, payload) {
    try {
      window.top.postMessage({ [MSG_CH]: 1, type, payload }, window.location.origin);
      return true;
    } catch { return false; }
  }

  function pushLogLine(line) {
    const max = 500;
    const cur = safeJsonParse(lsGet(KEYS.logs) || '[]', []);
    cur.push(line);
    while (cur.length > max) cur.shift();
    lsSet(KEYS.logs, JSON.stringify(cur));
  }

  const UI_STATE = { uiReady: false, appendLog: () => {}, setStatusText: () => {} };

  function log(msg) {
    const line = `[${ts()}] ${msg}`;
    pushLogLine(line);
    if (isTop() && UI_STATE.uiReady) return UI_STATE.appendLog(line);
    postToTop('log', line);
  }

  function setStatus(st) {
    lsSet(KEYS.status, JSON.stringify({ status: st, ts: Date.now(), by: FRAME_ID }));
    if (isTop() && UI_STATE.uiReady) UI_STATE.setStatusText(st);
    postToTop('status', st);
  }

  function digitsOnly(s) {
    const m = normText(s).match(/\d[\d,]*/);
    if (!m) return '';
    return m[0].replace(/[^\d]/g, '');
  }

  /**********************
   * REAL CLICK
   **********************/
  function dispatchPointerMouseSequence(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });

      const r = el.getBoundingClientRect();
      const cx = Math.floor(r.left + r.width / 2);
      const cy = Math.floor(r.top + r.height / 2);

      const common = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, screenX: cx, screenY: cy };

      try { el.focus?.({ preventScroll: true }); } catch {}

      el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      el.dispatchEvent(new MouseEvent('mousedown', { ...common, button: 0, buttons: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('mouseup', { ...common, button: 0, buttons: 0 }));
      el.dispatchEvent(new MouseEvent('click', { ...common, button: 0, buttons: 0 }));
      return true;
    } catch (e) {
      log(`Real-click failed: ${e?.message || e}`);
      return false;
    }
  }

  async function realClick(el, why = '', signal) {
    if (signal?.aborted) return false;
    if (!el) return false;

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) return false;
      const ok = dispatchPointerMouseSequence(el);
      if (ok) return true;
      await sleep(180 + attempt * 120, signal);
    }
    log(`Real-click failed after retries${why ? ` (${why})` : ''}`);
    return false;
  }

  function getRowClickTarget(tr) {
    return tr?.querySelector?.('td, [role="gridcell"], [role="cell"]') || tr;
  }

  /**********************
   * HEADERS / TABLE
   **********************/
  function findTitleBarHeading(textExactOrNull) {
    const els = document.querySelectorAll(SELECTORS.titleBarHeading);
    for (const el of els) {
      if (!isVisibleEl(el)) continue;
      const t = normText(el.textContent);
      if (!textExactOrNull) return el;
      if (t === textExactOrNull) return el;
    }
    return null;
  }

  function titleBarText() {
    const el = findTitleBarHeading(null);
    return normText(el?.textContent || '');
  }

  function isVehiclesHeaderVisible() {
    return !!findTitleBarHeading(SELECTORS.vehiclesHeaderText);
  }

  function findVehiclesTbody() {
    for (const sel of SELECTORS.vehiclesTbody) {
      const tb = document.querySelector(sel);
      if (tb && tb.tagName === 'TBODY') return tb;
    }
    return null;
  }

  function looksHeaderLike(unitNo, vin, modelYear, rowTextLower) {
    if (unitNo === 'Unit #' || vin === 'VIN' || modelYear === 'Model Year') return true;
    const tokens = ['unit', 'vehicle type', 'model year', 'vin'];
    let hits = 0;
    for (const t of tokens) if (rowTextLower.includes(t)) hits++;
    return hits >= 2;
  }

  function isEmptyRow(unitNo, vin, make, model, modelYear) {
    return !unitNo && !vin && !make && !model && !modelYear;
  }

  function getCellText(cells, idx0) {
    const td = cells?.[idx0];
    return normText(td?.textContent || '');
  }

  /**********************
   * ANNUAL MILES
   **********************/
  function findAnnualMilesGroup() {
    const groups = Array.from(document.querySelectorAll(`[id*="${DETAIL.annualInputIdContains}"]`));
    for (const g of groups) {
      if (!isVisibleEl(g)) continue;
      const lab = g.querySelector('.gw-label');
      if (lab && normText(lab.textContent) === DETAIL.annualLabel) return g;
    }

    const labels = Array.from(document.querySelectorAll('.gw-label, label, div, span, td'))
      .filter(el => isVisibleEl(el) && normText(el.textContent) === DETAIL.annualLabel);
    if (labels.length) {
      labels.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
      const el = labels[0];
      return el.closest?.('[role="group"], .gw-InputWidget, .gw-InputColumnWidget, [class*="InputWidget"]') || el.parentElement || el;
    }
    return null;
  }

  function readAnnualMilesFromGroup(group) {
    if (!group) return '';
    const v1 = group.querySelector('.gw-value-readonly-wrapper');
    if (v1) return digitsOnly(v1.textContent);

    const any =
      group.querySelector(`[id*="${DETAIL.annualValueIdContains}"] .gw-value-readonly-wrapper`) ||
      group.querySelector(`[id*="${DETAIL.annualValueIdContains}"] .gw-vw--value`) ||
      group.querySelector('.gw-vw--value') ||
      group.querySelector('.gw-value');

    return digitsOnly(any?.textContent || '');
  }

  function getAnnualMiles() {
    const g = findAnnualMilesGroup();
    const v = readAnnualMilesFromGroup(g);
    return { value: v || '', has: !!g };
  }

  async function waitForAnnualMiles(prevVal, signal) {
    const t0 = Date.now();
    const timeoutMs = 9000;

    while (!signal?.aborted && (Date.now() - t0) < timeoutMs) {
      const cur = getAnnualMiles();
      if (cur.has) {
        if (cur.value && cur.value !== prevVal) break;
        if (cur.value && (Date.now() - t0) > 1200) break;
      }
      await sleep(220, signal);
    }

    const settle = 450 + Math.floor(Math.random() * 351);
    await sleep(settle, signal);
    return true;
  }

  /**********************
   * PA COVERAGES CLICK + VERIFY
   **********************/
  function listWestPanelMenuNames() {
    const els = Array.from(document.querySelectorAll('.gw-WestPanelMenuItem, .gw-MenuItemWidget'));
    const names = els
      .filter(isVisibleEl)
      .map(el => normText(el.textContent))
      .filter(Boolean);
    const uniq = [];
    const seen = new Set();
    for (const n of names) {
      const k = n.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(n);
      if (uniq.length >= 40) break;
    }
    return uniq;
  }

  function findPaCoveragesMenuEl() {
    const el = document.querySelector(SELECTORS.paCoveragesMenuTop1);
    if (el && isVisibleEl(el)) return el;

    const items = Array.from(document.querySelectorAll('.gw-WestPanelMenuItem, .gw-MenuItemWidget'))
      .filter(isVisibleEl);

    const hit = items.find(x => normText(x.textContent).toLowerCase().includes('pa cover'));
    return hit || null;
  }

  function verifyPaNow(hrefBefore) {
    const href = String(location.href || '');
    const header = titleBarText();
    const hrefLow = href.toLowerCase();
    const headerLow = header.toLowerCase();

    const urlHasPa =
      hrefLow.includes('personalautolinepacoverages') ||
      hrefLow.includes('pacoverages') ||
      hrefLow.includes('pacoverage');

    const urlChangedToCover = (href !== hrefBefore) && hrefLow.includes('cover');
    const headerLooksPa = header && headerLow.includes('cover') && headerLow !== 'vehicles';

    return { ok: !!(urlHasPa || urlChangedToCover || headerLooksPa), href, header, urlHasPa, urlChangedToCover, headerLooksPa };
  }

  async function clickPaCoveragesAndVerify(signal) {
    const el = findPaCoveragesMenuEl();
    if (!el) {
      const names = listWestPanelMenuNames();
      log(`PA Coverages NOT found. West menu: ${names.join(' | ') || '(none)'}`);
      return false;
    }

    const inner = el.querySelector('.gw-action--inner') || el.querySelector('[class*="gw-action--inner"]') || null;

    const hrefBefore = String(location.href || '');
    const headerBefore = titleBarText();
    log(`Clicking PA Coverages… (before href="${hrefBefore}" header="${headerBefore}")`);

    let ok = false;
    if (inner && isVisibleEl(inner)) {
      ok = await realClick(inner, 'PA Coverages inner', signal);
      if (!ok) log('Inner click failed; trying outer…');
    }
    if (!ok) ok = await realClick(el, 'PA Coverages outer', signal);
    if (!ok) return false;

    const waitVerify = async (label) => {
      const t0 = Date.now();
      while (!signal?.aborted && (Date.now() - t0) < 20000) {
        const v = verifyPaNow(hrefBefore);
        if (v.ok) {
          log(`PA verified (${label}): urlHasPa=${v.urlHasPa} urlChangedCover=${v.urlChangedToCover} headerCover=${v.headerLooksPa} href="${v.href}" header="${v.header}"`);
          return true;
        }
        await sleep(300, signal);
      }
      const v = verifyPaNow(hrefBefore);
      log(`PA NOT verified (${label}): href="${v.href}" header="${v.header}"`);
      return false;
    };

    let verified = await waitVerify('attempt1');
    if (verified) return true;

    log('Retrying PA Coverages click once…');
    await sleep(800, signal);

    if (inner && isVisibleEl(inner)) await realClick(inner, 'PA Coverages inner retry', signal);
    else await realClick(el, 'PA Coverages outer retry', signal);

    verified = await waitVerify('attempt2');
    return verified;
  }

  /**********************
   * TOP-RUN LOCK (only TOP runs)
   **********************/
  const TOPLOCK = { amOwner: false, hbTimer: null };

  function topOwnerObj() { return safeJsonParse(lsGet(KEYS.owner) || 'null', null); }
  function topHbAgeMs() {
    const hb = Number(lsGet(KEYS.ownerHb) || '0') || 0;
    if (!hb) return Infinity;
    return Date.now() - hb;
  }
  function topAlive() { return topHbAgeMs() <= 5000; }

  function writeTopOwner(reason) {
    lsSet(KEYS.owner, JSON.stringify({ id: FRAME_ID, ts: Date.now(), reason: reason || '', href: location.href }));
    lsSet(KEYS.ownerHb, String(Date.now()));
  }

  function startTopHb() {
    if (TOPLOCK.hbTimer) return;
    TOPLOCK.hbTimer = setInterval(() => {
      if (!TOPLOCK.amOwner) return;
      lsSet(KEYS.ownerHb, String(Date.now()));
    }, 1000);
  }

  function stopTopHb() {
    if (TOPLOCK.hbTimer) clearInterval(TOPLOCK.hbTimer);
    TOPLOCK.hbTimer = null;
  }

  function claimTopOwner(reason) {
    if (!isTop()) return false;
    const cur = topOwnerObj();
    if (!cur) writeTopOwner(reason);
    else if (cur.id !== FRAME_ID) {
      if (!topAlive()) writeTopOwner('steal_' + (reason || ''));
      else return false;
    }
    const confirm = topOwnerObj();
    TOPLOCK.amOwner = confirm?.id === FRAME_ID;
    if (TOPLOCK.amOwner) startTopHb();
    return TOPLOCK.amOwner;
  }

  function clearTopOwner() {
    lsDel(KEYS.owner);
    lsDel(KEYS.ownerHb);
    TOPLOCK.amOwner = false;
    stopTopHb();
  }

  /**********************
   * CONTROL (session-only STOP)
   **********************/
  const WORK = {
    running: false,
    aborter: null,
    paused: false,                 // session-only
    lastCmdSeenTs: 0,
    lastGateLogTs: 0,
    kickTimer: null,
  };

  function setPausedSessionOnly(v) {
    WORK.paused = !!v;
    // We still write KEYS.paused for UI to reflect state, BUT we don't trust it across reload.
    lsSet(KEYS.paused, WORK.paused ? '1' : '0');
  }

  function stopRunOnly() {
    if (WORK.aborter) { try { WORK.aborter.abort(); } catch {} }
    WORK.aborter = null;
    WORK.running = false;
    setStatus(WORK.paused ? 'IDLE' : 'WATCHING');
  }

  function handleCmd(cmdObj) {
    if (!cmdObj?.cmd || !cmdObj.ts) return;
    if (cmdObj.ts <= WORK.lastCmdSeenTs) return;
    WORK.lastCmdSeenTs = cmdObj.ts;

    const cmd = cmdObj.cmd;

    if (cmd === 'stop') {
      log('STOP pressed (session-only).');
      setPausedSessionOnly(true);
      stopRunOnly();
      return;
    }

    if (cmd === 'start') {
      log('START pressed (session-only resume).');
      setPausedSessionOnly(false);
      lsSet(KEYS.cooldownUntilHeaderGone, '0');
      setStatus('WATCHING');
      kick('manual_start');
      return;
    }

    if (cmd === 'force') {
      log('FORCE RUN pressed.');
      setPausedSessionOnly(false);
      lsSet(KEYS.cooldownUntilHeaderGone, '0');
      runExtraction(true, 'force_run');
      return;
    }

    if (cmd === 'clear_owner') {
      log('Clearing Step3 top-owner keys.');
      clearTopOwner();
      return;
    }
  }

  function startCmdPolling() {
    setInterval(() => {
      const obj = safeJsonParse(lsGet(KEYS.cmd) || 'null', null);
      if (obj?.ts && obj.ts > WORK.lastCmdSeenTs) handleCmd(obj);

      if (!WORK.paused) runIfEligible('auto_tick');
    }, 650);
  }

  function recentlyDone() {
    const readyTs = Number(lsGet(KEYS.ready) || '0') || 0;
    const st = String(lsGet(KEYS.stage) || '');
    return (st === 'vehicles_done' && readyTs && (Date.now() - readyTs) < 10000);
  }

  function kick(why) {
    if (!isTop()) return;
    if (WORK.kickTimer) return;
    WORK.kickTimer = setTimeout(() => {
      WORK.kickTimer = null;
      runIfEligible(why || 'kick');
    }, 220);
  }

  function runIfEligible(why) {
    if (!isTop()) return;
    if (WORK.paused) return;
    if (WORK.running) return;

    // Never allow "stuck cooldown" – clear it if Vehicles header is visible (your new always-running rule)
    if (lsGet(KEYS.cooldownUntilHeaderGone) === '1') {
      if (isVehiclesHeaderVisible()) {
        lsSet(KEYS.cooldownUntilHeaderGone, '0');
        log('Cooldown was set but Vehicles is visible → cooldown cleared (always-running rule).');
      } else {
        // header not visible: keep as is; it will clear when it returns
        return;
      }
    }

    if (!isVehiclesHeaderVisible()) return;

    if (recentlyDone()) return;

    const lastRun = Number(lsGet(KEYS.lastRunAt) || '0') || 0;
    if (Date.now() - lastRun < 8000) return;

    const tb = findVehiclesTbody();
    if (!tb) return;

    if (!claimTopOwner('vehicles_visible_' + why)) return;

    runExtraction(false, why);
  }

  /**********************
   * EXTRACTION
   **********************/
  async function runExtraction(isForce, why) {
    if (WORK.running) return;
    WORK.running = true;
    WORK.aborter = new AbortController();
    const signal = WORK.aborter.signal;

    try {
      if (!isForce && !isVehiclesHeaderVisible()) {
        log('Guard: Vehicles header not visible — skipping.');
        WORK.running = false;
        setStatus('WATCHING');
        return;
      }

      lsSet(KEYS.lastRunAt, String(Date.now()));
      setStatus('RUNNING');

      log(`Vehicles header visible → wait 5s… (${why})`);
      if (!await sleep(5000, signal)) throw new Error('Aborted');

      log('Finding Vehicles table…');

      let tbody = null;
      for (let i = 0; i < 16; i++) {
        if (signal.aborted) throw new Error('Aborted');
        tbody = findVehiclesTbody();
        if (tbody && isVisibleEl(tbody.closest('table') || tbody)) break;
        await sleep(240 + i * 60, signal);
      }

      if (!tbody) {
        log('Vehicles table tbody not found.');
        savePayload({ step: 'vehicles', extracted_at: new Date().toISOString(), count: 0, rows: [], meta: { ok: false, note: 'Vehicles table not found' } });
        setStatus('WATCHING');
        return;
      }

      const trList = Array.from(tbody.querySelectorAll('tr'));
      log(`Vehicle rows found = ${trList.length}`);

      const picked = [];
      for (const tr of trList) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (!tds.length) continue;

        const hasEmptyC1 = tds.length >= 8;

        const unit_no      = hasEmptyC1 ? getCellText(tds, 1) : getCellText(tds, 0);
        const vehicle_type = hasEmptyC1 ? getCellText(tds, 2) : getCellText(tds, 1);
        const model_year   = hasEmptyC1 ? getCellText(tds, 3) : getCellText(tds, 2);
        const make         = hasEmptyC1 ? getCellText(tds, 4) : getCellText(tds, 3);
        const model        = hasEmptyC1 ? getCellText(tds, 5) : getCellText(tds, 4);
        const vin          = hasEmptyC1 ? getCellText(tds, 7) : getCellText(tds, 6);

        const rowTextLower = normText(tr.textContent).toLowerCase();
        if (looksHeaderLike(unit_no, vin, model_year, rowTextLower)) continue;
        if (isEmptyRow(unit_no, vin, make, model, model_year)) continue;

        picked.push({ tr, base: { unit_no, vehicle_type, model_year, make, model, vin } });
        if (picked.length >= 10) break;
      }

      log(`Extracted vehicles = ${picked.length}`);
      log('Skipping Odometer + Odometer Date (per request).');

      const outRows = [];
      let prevAnnual = getAnnualMiles().value || '';

      for (let i = 0; i < picked.length; i++) {
        if (signal.aborted) throw new Error('Aborted');

        const { tr, base } = picked[i];
        log(`Clicking row ${i + 1}/${picked.length}…`);

        const target = getRowClickTarget(tr);
        const rowClicked = await realClick(target, 'vehicle row', signal);
        if (!rowClicked) log('Row click failed → Annual Miles may stay stale.');

        await waitForAnnualMiles(prevAnnual, signal);

        const annual = getAnnualMiles().value || '';
        prevAnnual = annual;

        log(`Detail extracted: annual_mileage="${annual}"`);

        outRows.push({
          ...base,
          annual_mileage: annual,
          odometer: '',
          odometer_date: '',
        });
      }

      savePayload({
        step: 'vehicles',
        extracted_at: new Date().toISOString(),
        count: outRows.length,
        rows: outRows,
        meta: { ok: true, note: 'ALWAYS-ON; Annual Miles; PA verify widened' }
      });

      const verified = await clickPaCoveragesAndVerify(signal);
      log(verified ? 'PA Coverages verified → proceeding.' : 'PA Coverages NOT verified.');

      // Always-running: never require Vehicles header to disappear to run again.
      lsSet(KEYS.cooldownUntilHeaderGone, '0');

      setStatus('WATCHING');

    } catch (e) {
      log(`Run error: ${e?.message || e}`);
      savePayload({ step: 'vehicles', extracted_at: new Date().toISOString(), count: 0, rows: [], meta: { ok: false, note: `Error: ${e?.message || e}` } });
      setStatus('WATCHING');
    } finally {
      WORK.running = false;
      WORK.aborter = null;

      // Re-arm quickly if Vehicles still visible (but respect debounce)
      if (!WORK.paused && isVehiclesHeaderVisible()) setTimeout(() => kick('post_run'), 900);
    }
  }

  function savePayload(payloadObj) {
    const payloadStr = JSON.stringify(payloadObj);

    lsSet(KEYS.payload, payloadStr);
    log(`Copied → ${KEYS.payload} = ${payloadStr}`);

    const readyStr = String(Date.now());
    lsSet(KEYS.ready, readyStr);
    log(`Copied → ${KEYS.ready} = ${readyStr}`);

    lsSet(KEYS.stage, 'vehicles_done');
    log(`Copied → ${KEYS.stage} = vehicles_done`);
  }

  /**********************
   * UI (TOP ONLY)
   **********************/
  function injectUI_topOnly() {
    if (!isTop()) return;
    if (document.getElementById(UI.hostId)) return;

    const style = document.createElement('style');
    style.textContent = `
#${UI.hostId}{
  position:fixed; right:${UI.rightPx}px; bottom:${UI.bottomPx}px;
  z-index:2147483647; font:12px/1.2 system-ui, Segoe UI, Roboto, Arial; color:#111;
}
#${UI.hostId} .tm_panel{
  width:${UI.widthPx}px; border:1px solid rgba(0,0,0,.15); border-radius:12px;
  background:#fff; box-shadow:0 10px 30px rgba(0,0,0,.15); overflow:hidden;
}
#${UI.hostId} .tm_topbar{
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 10px; border-bottom:1px solid rgba(0,0,0,.10); user-select:none;
}
#${UI.hostId} .tm_title{ font-weight:800; letter-spacing:.2px; cursor:default; }
#${UI.hostId} .tm_status{ font-weight:800; opacity:.85; }
#${UI.hostId} .tm_btnrow{ display:flex; gap:8px; padding:10px; border-bottom:1px solid rgba(0,0,0,.08); }
#${UI.hostId} button.tm_btn{
  flex:1; padding:8px 8px; border-radius:10px; border:1px solid rgba(0,0,0,.18);
  background:#f7f7f7; font-weight:800; cursor:pointer;
}
#${UI.hostId} button.tm_btn:active{ transform:translateY(1px); }
#${UI.hostId} .tm_logs{ padding:10px; max-height:260px; overflow:auto; }
#${UI.hostId} .tm_logs pre{
  margin:0; font:11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  white-space:pre-wrap;
}
#${UI.bubbleId}{
  position:fixed; right:${UI.rightPx}px; bottom:${UI.bottomPx}px; width:44px; height:44px;
  z-index:2147483647; display:none; align-items:center; justify-content:center;
  background:#111; color:#fff; border-radius:999px; box-shadow:0 10px 30px rgba(0,0,0,.25);
  font:12px/1 system-ui, Segoe UI, Roboto, Arial; font-weight:900; cursor:pointer; user-select:none;
}`;
    document.documentElement.appendChild(style);

    const host = document.createElement('div');
    host.id = UI.hostId;

    const panel = document.createElement('div');
    panel.className = 'tm_panel';

    const topbar = document.createElement('div');
    topbar.className = 'tm_topbar';

    const title = document.createElement('div');
    title.className = 'tm_title';
    title.textContent = 'PC Step3 — Vehicles';

    const status = document.createElement('div');
    status.className = 'tm_status';
    status.textContent = 'WATCHING';

    topbar.appendChild(title);
    topbar.appendChild(status);

    const btnrow = document.createElement('div');
    btnrow.className = 'tm_btnrow';

    const btnStart = document.createElement('button');
    btnStart.className = 'tm_btn';
    btnStart.textContent = 'START';

    const btnStop = document.createElement('button');
    btnStop.className = 'tm_btn';
    btnStop.textContent = 'STOP';

    const btnForce = document.createElement('button');
    btnForce.className = 'tm_btn';
    btnForce.textContent = 'FORCE RUN';

    btnrow.appendChild(btnStart);
    btnrow.appendChild(btnStop);
    btnrow.appendChild(btnForce);

    const logsWrap = document.createElement('div');
    logsWrap.className = 'tm_logs';

    const pre = document.createElement('pre');
    pre.textContent = '';
    logsWrap.appendChild(pre);

    panel.appendChild(topbar);
    panel.appendChild(btnrow);
    panel.appendChild(logsWrap);
    host.appendChild(panel);

    const bubble = document.createElement('div');
    bubble.id = UI.bubbleId;
    bubble.textContent = 'PC3';

    document.documentElement.appendChild(host);
    document.documentElement.appendChild(bubble);

    title.addEventListener('dblclick', () => { host.style.display = 'none'; bubble.style.display = 'flex'; });
    bubble.addEventListener('click', () => { bubble.style.display = 'none'; host.style.display = 'block'; });

    function cmd(cmd) {
      lsSet(KEYS.cmd, JSON.stringify({ cmd, ts: Date.now(), from: 'ui_top' }));
      refreshButtons();
    }

    btnStart.addEventListener('click', () => {
      cmd('clear_owner');
      setPausedSessionOnly(false);
      cmd('start');
    });

    btnStop.addEventListener('click', () => {
      setPausedSessionOnly(true);
      cmd('stop');
    });

    btnForce.addEventListener('click', () => {
      cmd('clear_owner');
      setPausedSessionOnly(false);
      cmd('force');
    });

    function refreshButtons() {
      const paused = WORK.paused;
      btnStop.disabled = paused;
      btnStop.style.opacity = paused ? '0.55' : '1';
    }

    window.addEventListener('message', (ev) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data;
      if (!data || data[MSG_CH] !== 1) return;

      if (data.type === 'log') appendLogLine(data.payload);
      if (data.type === 'status') { status.textContent = String(data.payload || '').toUpperCase(); refreshButtons(); }
    });

    function appendLogLine(line) {
      pre.textContent += (pre.textContent ? '\n' : '') + String(line);
      const lines = pre.textContent.split('\n');
      if (lines.length > 700) pre.textContent = lines.slice(-520).join('\n');
      logsWrap.scrollTop = logsWrap.scrollHeight;
    }

    UI_STATE.uiReady = true;
    UI_STATE.appendLog = appendLogLine;
    UI_STATE.setStatusText = (st) => { status.textContent = String(st || '').toUpperCase(); refreshButtons(); };

    const storedLogs = safeJsonParse(lsGet(KEYS.logs) || '[]', []);
    if (storedLogs.length) {
      pre.textContent = storedLogs.slice(-140).join('\n');
      logsWrap.scrollTop = logsWrap.scrollHeight;
    }

    refreshButtons();
  }

  /**********************
   * BOOT
   **********************/
  injectUI_topOnly();

  // ✅ Always WATCHING on load
  setPausedSessionOnly(false);
  lsSet(KEYS.cooldownUntilHeaderGone, '0');
  setStatus('WATCHING');
  if (isTop()) log('Loaded → WATCHING (ALWAYS ON this load; STOP is session-only).');

  window.addEventListener('storage', (ev) => {
    if (ev.key === KEYS.cmd) handleCmd(safeJsonParse(ev.newValue || 'null', null));
  });

  // Mutation watcher to kick when Vehicles header becomes visible
  if (isTop()) {
    try {
      const mo = new MutationObserver(() => {
        if (WORK.paused || WORK.running) return;
        if (isVehiclesHeaderVisible()) kick('vehicles_visible_mut');
      });
      mo.observe(document.documentElement, { subtree: true, childList: true });
    } catch {}
  }

  startCmdPolling();
})();
