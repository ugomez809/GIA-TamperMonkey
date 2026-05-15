// ==UserScript==
// @name         PolicyCenter — HOME Selector Mapper (Click-to-Capture JSON)
// @namespace    tm.pc.home.selector.mapper
// @version      1.0.1
// @description  ON/OFF/RESET. Prompts you to click each Home field. While ON: hover-highlights + captures selector/xpath/frameChain. Draggable UI (starts centered). Auto-downloads JSON when complete. Works across PolicyCenter frames.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-selector-mapper.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-selector-mapper.user.js
// ==/UserScript==

(() => {
  'use strict';

  const IS_TOP = (window.top === window.self);

  const K = {
    STATE: 'tm_pc_home_selector_mapper_state_v1',
    POS: 'tm_pc_home_selector_mapper_pos_v1'
  };

  // Ordered prompts (you navigate to the right screen/tab, then click the target field/table/section).
  const STEPS = [
    // Top Banner
    { key: 'TopBanner.Account', prompt: 'From Top Banner: click the Account value' },
    { key: 'TopBanner.Policy', prompt: 'From Top Banner: click the Policy # value' },
    { key: 'TopBanner.Status', prompt: 'From Top Banner: click the Status (In Force/Expired/etc.) value' },

    // Policy Info
    { key: 'PolicyInfo.PrimaryNamedInsured', prompt: 'From Policy Info: click Primary Named Insured' },
    { key: 'PolicyInfo.PhonePreferred', prompt: 'From Policy Info: click Phone (Preferred)' },
    { key: 'PolicyInfo.EmailPreferred', prompt: 'From Policy Info: click Email (Preferred)' },
    { key: 'PolicyInfo.Occupation', prompt: 'From Policy Info: click Occupation' },
    { key: 'PolicyInfo.OccupationType', prompt: 'From Policy Info: click Occupation Type' },
    { key: 'PolicyInfo.eSignature', prompt: 'From Policy Info: click eSignature' },
    { key: 'PolicyInfo.PaperlessPolicy', prompt: 'From Policy Info: click Paperless Policy' },
    { key: 'PolicyInfo.PaperlessBilling', prompt: 'From Policy Info: click Paperless Billing' },
    { key: 'PolicyInfo.AdditionalNamedInsureds', prompt: 'From Policy Info: click Additional Name Insureds (area/list)' },

    // Policy Details
    { key: 'PolicyDetails.TermType', prompt: 'Policy Details: click Term Type' },
    { key: 'PolicyDetails.PolicyType', prompt: 'Policy Details: click Policy Type' },
    { key: 'PolicyDetails.ProductType', prompt: 'Policy Details: click Product Type' },
    { key: 'PolicyDetails.EffectiveDate', prompt: 'Policy Details: click Effective Date' },
    { key: 'PolicyDetails.ExpirationDate', prompt: 'Policy Details: click Expiration Date' },
    { key: 'PolicyDetails.CommissionCode', prompt: 'Policy Details: click Commission Code' },

    // Dwelling
    { key: 'Dwelling.RiskAddress', prompt: 'From Dwelling: click Risk Address' },
    { key: 'Dwelling.County', prompt: 'From Dwelling: click County' },
    { key: 'Dwelling.ProtectionClassCode', prompt: 'From Dwelling: click Protection Class Code' },
    { key: 'Dwelling.FirelineCode', prompt: 'From Dwelling: click Fireline Code' },
    { key: 'Dwelling.YearBuilt', prompt: 'From Dwelling: click Year Built' },
    { key: 'Dwelling.SquareFeet', prompt: 'From Dwelling: click Square Feet' },
    { key: 'Dwelling.Occupancy', prompt: 'From Dwelling: click Occupancy' },
    { key: 'Dwelling.DwellingProtection_AllInOneCell', prompt: 'From Dwelling: click Dwelling Protection (the full area you want as 1 cell)' },

    // Eligibility Sub-Tab
    { key: 'Eligibility.DogsAtResidence', prompt: 'From Eligibility sub-tab: click “Are there any dogs kept at the residence?” (answer/value)' },
    { key: 'Eligibility.MortgageeTable', prompt: 'From Eligibility sub-tab: click the Mortgagee table (anywhere inside the table container)' },

    // Coverages Tab
    { key: 'Coverages.AllCoverages', prompt: 'From Coverages tab: click the “All Coverages” section/container you want captured' },
    { key: 'Coverages.ExclusionsAndConditions_All', prompt: 'From Coverages tab: click the “Exclusions and Conditions” section/container (everything here)' },

    // Quote Tab
    { key: 'Quote.TotalPremium', prompt: 'From Quote tab: click Total Premium' },
    { key: 'Quote.FeesTaxesSurcharges', prompt: 'From Quote tab: click Fees, Taxes and Surcharges' },
    { key: 'Quote.TotalCost', prompt: 'From Quote tab: click Total Cost' },
    { key: 'Quote.Discounts', prompt: 'From Quote tab: click Discounts (area/list)' }
  ];

  // -----------------------------
  // Shared (all frames): hover highlight + click capture sender
  // -----------------------------
  let armedLocal = true; // ON by default on load
  let lastHoverEl = null;
  let lastHoverFrameKey = '';

  injectHoverCSS();
  installMessageReceiver();
  installHoverHighlighter();
  installClickCapture();

  // -----------------------------
  // Top frame UI + state
  // -----------------------------
  if (IS_TOP) {
    const ui = createUI();
    document.documentElement.appendChild(ui.root);

    // apply saved position (or center default)
    applySavedPosition(ui.root);

    const state = loadState();
    renderUI(ui, state);

    window.addEventListener('message', (ev) => {
      try {
        if (!ev || !ev.data) return;
        if (ev.origin !== location.origin) return;

        const data = ev.data;
        if (!data || data.__tm_pc_home_sel_capture__ !== true) return;

        const st = loadState();
        if (!st.armedTop) return;

        if (st.idx >= STEPS.length) {
          toast(ui, 'Already complete. RESET to start over.');
          return;
        }

        const step = STEPS[st.idx];

        st.map[step.key] = {
          key: step.key,
          prompt: step.prompt,
          captured_at: new Date().toISOString(),
          capture: data.payload
        };

        st.idx += 1;

        if (st.idx >= STEPS.length) {
          st.completed = true;
          saveState(st);
          renderUI(ui, st);
          toast(ui, '✅ Complete. Downloading JSON…');
          downloadJSON(buildExport(st));
          toast(ui, '✅ JSON downloaded. RESET if you want to redo.');
          return;
        }

        saveState(st);
        renderUI(ui, st);
        toast(ui, `Saved: ${step.key}`);
      } catch (e) {
        // ignore
      }
    }, false);

    // Keep armedLocal in this frame synced to top UI state
    applyArmedFromTop(loadState().armedTop, true);
  }

  // -----------------------------
  // State
  // -----------------------------
  function defaultState() {
    return {
      v: '1.0.1',
      created_at: new Date().toISOString(),
      idx: 0,
      map: {},
      completed: false,
      armedTop: true
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(K.STATE);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const st = { ...defaultState(), ...parsed };
      if (!st.map || typeof st.map !== 'object') st.map = {};
      if (typeof st.idx !== 'number') st.idx = 0;
      if (typeof st.armedTop !== 'boolean') st.armedTop = true;
      return st;
    } catch {
      return defaultState();
    }
  }

  function saveState(st) {
    try {
      localStorage.setItem(K.STATE, JSON.stringify(st));
    } catch {}
  }

  function buildExport(st) {
    const nowIso = new Date().toISOString();
    return {
      meta: {
        exporter: 'tm.pc.home.selector.mapper',
        version: '1.0.1',
        exported_at: nowIso,
        href: location.href,
        title: document.title,
        origin: location.origin,
        total_steps: STEPS.length
      },
      steps: STEPS.map(s => ({ key: s.key, prompt: s.prompt })),
      progress: {
        idx: st.idx,
        completed: !!st.completed
      },
      selectors: st.map
    };
  }

  function downloadJSON(obj) {
    try {
      const pad2 = (n) => String(n).padStart(2, '0');
      const d = new Date();
      const stamp =
        d.getFullYear() +
        pad2(d.getMonth() + 1) +
        pad2(d.getDate()) + '_' +
        pad2(d.getHours()) +
        pad2(d.getMinutes()) +
        pad2(d.getSeconds());

      const filename = `pc_home_selector_map_${stamp}.json`;
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 2500);
    } catch {}
  }

  // -----------------------------
  // Hover highlighting
  // -----------------------------
  function injectHoverCSS() {
    const css = `
      .tmPcHomeSel-hover {
        outline: 3px solid rgba(0, 200, 255, 0.9) !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 2px rgba(0,0,0,0.2) inset !important;
        cursor: crosshair !important;
      }
      .tmPcHomeSel-noSelect, .tmPcHomeSel-noSelect * {
        user-select: none !important;
      }
      .tmPcHomeSel-dragHandle {
        cursor: grab !important;
      }
      .tmPcHomeSel-dragging .tmPcHomeSel-dragHandle {
        cursor: grabbing !important;
      }
      @keyframes tmPcHomeSelFade {
        0% { opacity: 0; transform: translateY(6px); }
        100% { opacity: 1; transform: translateY(0); }
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  function installMessageReceiver() {
    window.addEventListener('message', (ev) => {
      try {
        if (!ev || !ev.data) return;
        if (ev.origin !== location.origin) return;

        const d = ev.data;

        if (d && d.__tm_pc_home_sel_arm__ === true) {
          armedLocal = !!d.armed;
          if (!armedLocal) clearHover();
        }

        if (d && d.__tm_pc_home_sel_reset__ === true) {
          clearHover();
        }
      } catch {}
    }, false);
  }

  function installHoverHighlighter() {
    let lastT = 0;

    document.addEventListener('mousemove', (e) => {
      if (!armedLocal) return;

      const now = performance.now();
      if (now - lastT < 25) return;
      lastT = now;

      const el = safeElementFromEvent(e);
      if (!el) {
        clearHover();
        return;
      }

      if (IS_TOP) {
        const uiRoot = document.getElementById('tmPcHomeSelUIRoot');
        if (uiRoot && uiRoot.contains(el)) {
          clearHover();
          return;
        }
      }

      if (el === lastHoverEl) return;

      clearHover();
      lastHoverEl = el;
      lastHoverFrameKey = getFrameKey();
      try { el.classList.add('tmPcHomeSel-hover'); } catch {}
    }, { passive: true });
  }

  function installClickCapture() {
    document.addEventListener('click', (e) => {
      try {
        if (!armedLocal) return;

        if (IS_TOP) {
          const st = loadState();
          if (!st.armedTop) return;
          if (st.idx >= STEPS.length) return;

          const uiRoot = document.getElementById('tmPcHomeSelUIRoot');
          if (uiRoot && uiRoot.contains(e.target)) return;
        }

        if (IS_TOP) {
          const st = loadState();
          if (st.idx >= STEPS.length) return;
        }

        const target = e.target;
        if (!target || target.nodeType !== 1) return;

        const payload = buildCapturePayload(target);

        if (IS_TOP) {
          window.postMessage({ __tm_pc_home_sel_capture__: true, payload }, location.origin);
        } else {
          window.top.postMessage({ __tm_pc_home_sel_capture__: true, payload }, location.origin);
        }
      } catch {}
    }, true);
  }

  function safeElementFromEvent(e) {
    try {
      if (e && e.target && e.target.nodeType === 1) return e.target;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return (el && el.nodeType === 1) ? el : null;
    } catch {
      return null;
    }
  }

  function clearHover() {
    try {
      if (lastHoverEl && lastHoverFrameKey === getFrameKey()) {
        lastHoverEl.classList.remove('tmPcHomeSel-hover');
      } else if (lastHoverEl) {
        lastHoverEl.classList.remove('tmPcHomeSel-hover');
      }
    } catch {}
    lastHoverEl = null;
    lastHoverFrameKey = '';
  }

  function getFrameKey() {
    try {
      return `${location.origin}::${location.pathname}::${(window.top === window.self) ? 'top' : 'frame'}`;
    } catch {
      return 'frame';
    }
  }

  // -----------------------------
  // Capture payload
  // -----------------------------
  function buildCapturePayload(el) {
    const doc = el.ownerDocument || document;

    const cssCandidates = buildCssCandidates(el, doc);
    const cssBest = pickBestUnique(cssCandidates, doc) || cssCandidates[0] || '';

    const xpath = buildXPath(el, doc);
    const sampleText = getSampleText(el);

    return {
      frameChain: getFrameChain(),
      href: location.href,
      title: doc.title || '',
      tag: (el.tagName || '').toLowerCase(),
      css: cssBest,
      cssCandidates,
      xpath,
      sampleText,
      attrs: pickUsefulAttrs(el)
    };
  }

  function pickUsefulAttrs(el) {
    const out = {};
    try {
      const attrs = ['id', 'name', 'role', 'type', 'title', 'aria-label', 'aria-labelledby', 'aria-describedby', 'data-testid', 'data-test', 'data-gw', 'data-gw-id'];
      for (const a of attrs) {
        const v = el.getAttribute && el.getAttribute(a);
        if (v) out[a] = String(v).slice(0, 200);
      }
      const cls = el.className;
      if (cls && typeof cls === 'string') out.class = cls.slice(0, 200);
    } catch {}
    return out;
  }

  function getSampleText(el) {
    try {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const v = el.value;
        if (v != null && String(v).trim()) return String(v).trim().slice(0, 200);
      }
      const txt = (el.innerText || el.textContent || '').trim();
      return txt ? txt.slice(0, 200) : '';
    } catch {
      return '';
    }
  }

  function buildCssCandidates(el) {
    const list = [];

    const id = safeAttr(el, 'id');
    if (id) list.push(`#${cssEscape(id)}`);

    const attrs = [
      { a: 'name', wrap: (v) => `${el.tagName.toLowerCase()}[name="${cssAttrEscape(v)}"]` },
      { a: 'aria-label', wrap: (v) => `${el.tagName.toLowerCase()}[aria-label="${cssAttrEscape(v)}"]` },
      { a: 'title', wrap: (v) => `${el.tagName.toLowerCase()}[title="${cssAttrEscape(v)}"]` },
      { a: 'data-testid', wrap: (v) => `${el.tagName.toLowerCase()}[data-testid="${cssAttrEscape(v)}"]` },
      { a: 'data-test', wrap: (v) => `${el.tagName.toLowerCase()}[data-test="${cssAttrEscape(v)}"]` }
    ];

    for (const it of attrs) {
      const v = safeAttr(el, it.a);
      if (v) list.push(it.wrap(v));
    }

    const classSel = buildClassSelector(el);
    if (classSel) list.push(classSel);

    list.push(buildCssPath(el));

    const uniq = [];
    const seen = new Set();
    for (const s of list) {
      const ss = String(s || '').trim();
      if (!ss) continue;
      if (seen.has(ss)) continue;
      seen.add(ss);
      uniq.push(ss);
    }
    return uniq;
  }

  function pickBestUnique(candidates, doc) {
    for (const sel of candidates) {
      try {
        const matches = doc.querySelectorAll(sel);
        if (matches && matches.length === 1) return sel;
      } catch {}
    }
    for (const sel of candidates) {
      try {
        const matches = doc.querySelectorAll(sel);
        if (matches && matches.length >= 1) return sel;
      } catch {}
    }
    return '';
  }

  function buildClassSelector(el) {
    try {
      const tag = el.tagName.toLowerCase();
      const cls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (!cls) return '';
      const parts = cls.split(/\s+/).map(s => s.trim()).filter(Boolean);

      const filtered = parts.filter(c =>
        c.length <= 32 &&
        !/\d/.test(c) &&
        /^[a-zA-Z_-]+$/.test(c) &&
        !c.toLowerCase().includes('active') &&
        !c.toLowerCase().includes('selected') &&
        !c.toLowerCase().includes('focus')
      );

      if (!filtered.length) return '';

      const use = filtered.slice(0, 2).map(c => `.${cssEscape(c)}`).join('');
      return `${tag}${use}`;
    } catch {
      return '';
    }
  }

  function buildCssPath(el) {
    const parts = [];
    let cur = el;

    while (cur && cur.nodeType === 1 && cur.tagName && cur !== document.documentElement) {
      const tag = cur.tagName.toLowerCase();

      const id = safeAttr(cur, 'id');
      if (id) {
        parts.unshift(`${tag}#${cssEscape(id)}`);
        break;
      }

      const parent = cur.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }

      const siblings = Array.from(parent.children).filter(n => n.tagName && n.tagName.toLowerCase() === tag);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        parts.unshift(`${tag}:nth-of-type(${idx})`);
      } else {
        parts.unshift(tag);
      }

      if (parts.length >= 7) break;
      cur = parent;
    }

    return parts.join(' > ');
  }

  function buildXPath(el, doc) {
    try {
      const id = safeAttr(el, 'id');
      if (id) return `//*[@id="${xpathEscape(id)}"]`;

      const segs = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
        const tag = cur.tagName.toLowerCase();
        const parent = cur.parentNode;
        if (!parent || parent.nodeType !== 1) {
          segs.unshift(`/${tag}`);
          break;
        }
        const siblings = Array.from(parent.childNodes).filter(n => n.nodeType === 1 && n.tagName.toLowerCase() === tag);
        if (siblings.length === 1) {
          segs.unshift(`/${tag}`);
        } else {
          const idx = siblings.indexOf(cur) + 1;
          segs.unshift(`/${tag}[${idx}]`);
        }
        if (segs.length >= 8) break;
        cur = parent;
      }
      return segs.join('');
    } catch {
      return '';
    }
  }

  function getFrameChain() {
    try {
      const chain = [];
      let w = window;

      while (w && w !== w.top) {
        const fe = w.frameElement;
        const p = w.parent;
        if (!fe || !p) break;

        const frames = Array.from(p.document.querySelectorAll('iframe,frame'));
        const idx = frames.indexOf(fe);

        chain.unshift({
          index: idx,
          tag: (fe.tagName || '').toLowerCase(),
          id: fe.id || '',
          name: fe.name || '',
          src: fe.getAttribute('src') || ''
        });

        w = p;
      }

      return chain;
    } catch {
      return [];
    }
  }

  function safeAttr(el, name) {
    try {
      const v = el.getAttribute && el.getAttribute(name);
      return v ? String(v).trim() : '';
    } catch {
      return '';
    }
  }

  function cssEscape(s) {
    try { if (window.CSS && CSS.escape) return CSS.escape(s); } catch {}
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
  }

  function cssAttrEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function xpathEscape(s) {
    return String(s).replace(/"/g, '\\"');
  }

  // -----------------------------
  // UI (top only) + draggable
  // -----------------------------
  function createUI() {
    const root = document.createElement('div');
    root.id = 'tmPcHomeSelUIRoot';
    root.className = 'tmPcHomeSel-noSelect';
    root.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'width:360px',
      'background:rgba(20,20,20,0.92)',
      'color:#fff',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:10px',
      'box-shadow:0 12px 30px rgba(0,0,0,0.35)',
      'font-family:Segoe UI, Arial, sans-serif',
      'font-size:12px',
      'padding:10px',
      'line-height:1.25'
    ].join(';');

    // DRAG HANDLE (title bar)
    const titleBar = document.createElement('div');
    titleBar.className = 'tmPcHomeSel-dragHandle';
    titleBar.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:10px',
      'font-weight:700',
      'font-size:13px',
      'margin-bottom:8px',
      'padding:6px 8px',
      'border-radius:8px',
      'background:rgba(255,255,255,0.06)',
      'border:1px solid rgba(255,255,255,0.10)'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'HOME Selector Mapper';

    const hint = document.createElement('div');
    hint.textContent = 'drag';
    hint.style.cssText = 'font-weight:600;opacity:0.7;font-size:11px;';

    titleBar.append(title, hint);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';

    const btnOn = mkBtn('ON');
    const btnOff = mkBtn('OFF');
    const btnReset = mkBtn('RESET');
    row.append(btnOn, btnOff, btnReset);

    const status = document.createElement('div');
    status.style.cssText = 'margin-bottom:6px;opacity:0.95;';

    const prompt = document.createElement('div');
    prompt.style.cssText = 'padding:8px;border-radius:8px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.08);margin-bottom:8px;';

    const small = document.createElement('div');
    small.style.cssText = 'opacity:0.85;margin-bottom:6px;';
    small.textContent = 'Go to the right tab/screen, then click exactly the value/area you want captured.';

    const list = document.createElement('div');
    list.style.cssText = 'max-height:210px;overflow:auto;border-top:1px solid rgba(255,255,255,0.08);padding-top:8px;';

    const toastWrap = document.createElement('div');
    toastWrap.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;pointer-events:none;';

    root.append(titleBar, row, status, prompt, small, list);
    document.documentElement.appendChild(toastWrap);

    const api = { root, titleBar, status, prompt, list, toastWrap, btnOn, btnOff, btnReset };

    // draggable
    makeDraggable(root, titleBar);

    // handlers
    btnOn.onclick = () => {
      const st = loadState();
      st.armedTop = true;
      saveState(st);
      renderUI(api, st);
      broadcastArm(true);
      toast(api, 'ON (recording clicks)');
    };

    btnOff.onclick = () => {
      const st = loadState();
      st.armedTop = false;
      saveState(st);
      renderUI(api, st);
      broadcastArm(false);
      toast(api, 'OFF (not recording)');
    };

    btnReset.onclick = () => {
      localStorage.removeItem(K.STATE);
      const st = loadState();
      saveState(st);
      renderUI(api, st);
      broadcastReset();
      broadcastArm(true);
      toast(api, 'RESET (started over)');
    };

    return api;
  }

  function mkBtn(txt) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = txt;
    b.style.cssText = [
      'flex:1',
      'padding:6px 8px',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.15)',
      'background:rgba(255,255,255,0.06)',
      'color:#fff',
      'cursor:pointer',
      'font-weight:700'
    ].join(';');
    b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.12)';
    b.onmouseleave = () => b.style.background = 'rgba(255,255,255,0.06)';
    return b;
  }

  function renderUI(ui, st) {
    const total = STEPS.length;
    const idx = Math.min(st.idx, total);

    ui.status.textContent =
      `State: ${st.armedTop ? 'ON' : 'OFF'}  •  Progress: ${idx}/${total}  •  ${st.completed ? 'DONE' : 'IN PROGRESS'}`;

    if (st.completed || idx >= total) {
      ui.prompt.textContent = '✅ Completed. JSON was downloaded. Press RESET to start again.';
    } else {
      ui.prompt.textContent = `👉 ${STEPS[idx].prompt}`;
    }

    ui.list.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const step = STEPS[i];
      const done = !!st.map[step.key];
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;align-items:flex-start;';
      const dot = document.createElement('div');
      dot.textContent = done ? '✅' : (i === idx ? '👉' : '•');
      dot.style.cssText = 'width:18px;flex:0 0 18px;opacity:0.95;';
      const txt = document.createElement('div');
      txt.textContent = step.key;
      txt.style.cssText = `flex:1;opacity:${done ? 0.9 : 0.75};`;
      row.append(dot, txt);
      ui.list.appendChild(row);
    }

    ui.btnOn.style.outline = st.armedTop ? '2px solid rgba(0,255,150,0.65)' : 'none';
    ui.btnOff.style.outline = !st.armedTop ? '2px solid rgba(255,200,0,0.7)' : 'none';

    applyArmedFromTop(st.armedTop, false);
  }

  function toast(ui, msg) {
    try {
      const t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = [
        'background:rgba(20,20,20,0.92)',
        'color:#fff',
        'border:1px solid rgba(255,255,255,0.12)',
        'border-radius:10px',
        'padding:8px 10px',
        'box-shadow:0 10px 24px rgba(0,0,0,0.35)',
        'font-family:Segoe UI, Arial, sans-serif',
        'font-size:12px',
        'animation:tmPcHomeSelFade 120ms ease-out'
      ].join(';');
      ui.toastWrap.appendChild(t);
      setTimeout(() => { try { t.remove(); } catch {} }, 2200);
    } catch {}
  }

  // -----------------------------
  // Draggable positioning
  // -----------------------------
  function applySavedPosition(root) {
    const pos = loadPos();
    if (pos && pos.mode === 'free' && isFinite(pos.left) && isFinite(pos.top)) {
      root.style.left = `${clamp(pos.left, 0, window.innerWidth - 60)}px`;
      root.style.top = `${clamp(pos.top, 0, window.innerHeight - 60)}px`;
      root.style.transform = 'none';
    } else {
      // default: centered
      root.style.left = '50%';
      root.style.top = '50%';
      root.style.transform = 'translate(-50%, -50%)';
    }

    window.addEventListener('resize', () => {
      const p = loadPos();
      if (p && p.mode === 'free') {
        const rect = root.getBoundingClientRect();
        const left = clamp(rect.left, 0, window.innerWidth - 60);
        const top = clamp(rect.top, 0, window.innerHeight - 60);
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.transform = 'none';
        savePos({ mode: 'free', left, top });
      }
    }, { passive: true });
  }

  function makeDraggable(root, handle) {
    let dragging = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      // ignore right click
      if (e.button != null && e.button !== 0) return;

      dragging = true;
      root.classList.add('tmPcHomeSel-dragging');

      // If centered with translate, convert to px first
      const rect = root.getBoundingClientRect();
      root.style.left = `${rect.left}px`;
      root.style.top = `${rect.top}px`;
      root.style.transform = 'none';

      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      try { handle.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const left = clamp(startLeft + dx, 0, window.innerWidth - 60);
      const top = clamp(startTop + dy, 0, window.innerHeight - 60);

      root.style.left = `${left}px`;
      root.style.top = `${top}px`;
      root.style.transform = 'none';

      savePos({ mode: 'free', left, top });
    });

    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('tmPcHomeSel-dragging');
      try { handle.releasePointerCapture(e.pointerId); } catch {}
    };

    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function loadPos() {
    try {
      const raw = localStorage.getItem(K.POS);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && typeof p === 'object' ? p : null;
    } catch {
      return null;
    }
  }

  function savePos(p) {
    try { localStorage.setItem(K.POS, JSON.stringify(p)); } catch {}
  }

  function clamp(n, min, max) {
    const nn = Number(n);
    if (!isFinite(nn)) return min;
    return Math.max(min, Math.min(max, nn));
  }

  // -----------------------------
  // Arm control broadcast
  // -----------------------------
  function applyArmedFromTop(armed, clearHoverNow) {
    armedLocal = !!armed;
    if (!armedLocal && clearHoverNow) clearHover();
  }

  function broadcastArm(armed) {
    try {
      armedLocal = !!armed;
      if (!armedLocal) clearHover();

      const msg = { __tm_pc_home_sel_arm__: true, armed: !!armed };
      walkFrames(window.top, (w) => {
        try { w.postMessage(msg, location.origin); } catch {}
      });
    } catch {}
  }

  function broadcastReset() {
    try {
      const msg = { __tm_pc_home_sel_reset__: true };
      walkFrames(window.top, (w) => {
        try { w.postMessage(msg, location.origin); } catch {}
      });
    } catch {}
  }

  function walkFrames(rootWin, fn) {
    try {
      fn(rootWin);
      const frames = rootWin.frames;
      for (let i = 0; i < frames.length; i++) {
        const fw = frames[i];
        try {
          void fw.location.href; // same-origin check
          walkFrames(fw, fn);
        } catch {}
      }
    } catch {}
  }
})();
