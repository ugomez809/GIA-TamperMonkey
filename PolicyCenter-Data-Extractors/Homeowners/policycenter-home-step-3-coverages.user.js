// ==UserScript==
// @name         PolicyCenter — Step 3: Coverages Extractor (All + Optional + Detailed + Exclusions/Conditions) (ALWAYS ON)
// @namespace    tm.pc.step3.coverages
// @version      1.1.0
// @description  ALWAYS ON. Auto-arms on load (STOP is session-only). Rule: Step2 signal + Coverages visible → run ONCE → wait until Coverages NOT visible before allowing another run. If run errors, gate clears to auto-retry. Per-subtab timebox: wait up to 2s for "ready"; if not ready, capture whatever is there and move on.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-3-coverages.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-3-coverages.user.js
// ==/UserScript==

(() => {
  "use strict";
  if (window.top !== window.self) return;

  /******************************************************************
   * CONFIG
   ******************************************************************/
  const LS = {
    STAGE: "tm_pc_stage_v1",
    HOME_STAGE: "tm_pc_home_stage_v1",
    STEP3_GO: "tm_pc_home_step3_go_v1",
    OUT: "tm_pc_coverages_v1",
    READY: "tm_pc_coverages_ready_v1",
    DONE_POLICY: "tm_pc_coverages_done_policy_v1",
  };

  const TAB_LABEL_COVERAGES = "Coverages";
  const TAB_LABEL_QUOTE = "Quote";

  const SEL_ALL_COVERAGES_ROOT =
    "#PolicyFileHomeownersCoveragesHOE-PolicyFile_HomeownersCoveragesScreen-HOPolicyLevelCoveragesID";

  const SEL_EXCL_ROOT =
    "#PolicyFileHomeownersCoveragesHOE-PolicyFile_HomeownersCoveragesScreen-PolicyLevelConditionsAndExclusions-HOAdditionalExclusionsAndConditionsPanelSet";

  const SEL_EXCL_TAB_PREF =
    "div.gw-CardTabWidget.gw-styleTag--CardTabsWidget:nth-of-type(4) > div[role=\"tab\"].gw-action--inner.gw-hasDivider";

  const SEL_INFOBAR_POLICY =
    "#PolicyFile-PolicyFileMenuInfoBar-PolicyNumber .gw-infoValue";

  const WAIT_ON_COVERAGES_MS = 5000;

  // Sentinels you gave me (H2 aria-level=2)
  const SENTINELS = {
    "Optional Coverages": "Increased Personal Property Limits",
    "Detailed Coverages": "Scheduled Personal Property",
  };

  // Timeboxes (your request)
  const SUBTAB_READY_MS = 2000; // if not ready by 2s -> capture and move on
  const SUBTAB_HARD_MS  = 3000; // never spend >3s per subtab total
  const ACTIVE_TAB_WAIT_MS = 700; // small, within subtab budget
  const SAMPLE_MS = 150;
  const MIN_TEXT_CHARS = 60;

  /******************************************************************
   * UI + LOGS — chains LEFT of Step2
   ******************************************************************/
  const UI = (() => {
    const host = document.createElement("div");
    host.id = "tm_pc_step3_host";
    host.style.cssText = [
      "position:fixed",
      "left:auto",
      "right:678px",
      "bottom:14px",
      "z-index:2147483647",
      "font:12px/1.2 system-ui,Segoe UI,Roboto,Arial",
      "color:#111",
      "pointer-events:auto",
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "width:320px",
      "border:1px solid rgba(0,0,0,.15)",
      "border-radius:12px",
      "background:#fff",
      "box-shadow:0 10px 30px rgba(0,0,0,.15)",
      "overflow:hidden",
    ].join(";");

    const top = document.createElement("div");
    top.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:10px 10px 8px;border-bottom:1px solid rgba(0,0,0,.08)";

    const title = document.createElement("div");
    title.textContent = "PC Step3 — Coverages";
    title.style.cssText = "font-weight:700";

    const status = document.createElement("div");
    status.textContent = "BOOT";
    status.style.cssText = "font-weight:700;opacity:.8";

    top.appendChild(title);
    top.appendChild(status);

    const btnRow = document.createElement("div");
    btnRow.style.cssText =
      "display:flex;gap:8px;padding:10px;border-bottom:1px solid rgba(0,0,0,.08)";

    const mkBtn = (text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.style.cssText = [
        "flex:1",
        "padding:8px 10px",
        "border-radius:10px",
        "border:1px solid rgba(0,0,0,.18)",
        "background:#f7f7f7",
        "cursor:pointer",
        "font-weight:700",
      ].join(";");
      return b;
    };

    const btnStart = mkBtn("START");
    const btnStop  = mkBtn("STOP");
    const btnForce = mkBtn("FORCE RUN");

    btnStop.style.opacity = "0.55";
    btnStop.disabled = true;

    btnRow.appendChild(btnStart);
    btnRow.appendChild(btnStop);
    btnRow.appendChild(btnForce);

    const logWrap = document.createElement("div");
    logWrap.style.cssText = "padding:10px;max-height:260px;overflow:auto";

    const pre = document.createElement("pre");
    pre.style.cssText =
      "margin:0;white-space:pre-wrap;word-break:break-word;font:11px/1.25 ui-monospace,Consolas,monospace;opacity:.95";
    logWrap.appendChild(pre);

    panel.appendChild(top);
    panel.appendChild(btnRow);
    panel.appendChild(logWrap);
    host.appendChild(panel);

    const mini = document.createElement("div");
    mini.textContent = "PC3";
    mini.title = "Click to show/hide";
    mini.style.cssText = [
      "position:fixed",
      "left:auto",
      "right:678px",
      "bottom:14px",
      "width:44px",
      "height:44px",
      "border-radius:999px",
      "background:#111",
      "color:#fff",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "font-weight:800",
      "cursor:pointer",
      "z-index:2147483647",
      "box-shadow:0 10px 30px rgba(0,0,0,.25)",
      "pointer-events:auto",
    ].join(";");

    let collapsed = false;

    const GAP = 12;
    const MY_W = 320;
    const DEFAULT_BOTTOM = 14;

    const safeRect = (r) =>
      r && isFinite(r.left) && isFinite(r.right) && r.width > 30 && r.height > 20;

    function findMiniByText(txt) {
      const all = Array.from(document.querySelectorAll("div"));
      for (const el of all) {
        try {
          if (el.textContent === txt && el.title === "Click to show/hide") {
            const r = el.getBoundingClientRect();
            if (safeRect(r)) return r;
          }
        } catch {}
      }
      return null;
    }

    function findAnchorRect() {
      const step2Host = document.querySelector("#tm_pc_step2_host");
      if (step2Host) {
        const r = step2Host.getBoundingClientRect();
        if (safeRect(r)) return r;
      }
      const step2Mini = findMiniByText("PC2");
      if (step2Mini) return step2Mini;

      const step1Host = document.querySelector("#tm_pc_step1_host");
      if (step1Host) {
        const r = step1Host.getBoundingClientRect();
        if (safeRect(r)) return r;
      }
      const step1Mini = findMiniByText("PC1");
      if (step1Mini) return step1Mini;

      return null;
    }

    function applyPosLeftOf(rect) {
      let left = Math.round(rect.left - MY_W - GAP);
      let bottom = DEFAULT_BOTTOM;

      if (left < 8) {
        left = Math.round(rect.left);
        bottom = Math.round(DEFAULT_BOTTOM + rect.height + GAP);
      }

      left = Math.max(8, left);

      host.style.left = left + "px";
      host.style.right = "auto";
      host.style.bottom = bottom + "px";

      mini.style.left = left + "px";
      mini.style.right = "auto";
      mini.style.bottom = DEFAULT_BOTTOM + "px";
    }

    function applyFallback() {
      host.style.left = "auto";
      host.style.right = "678px";
      host.style.bottom = DEFAULT_BOTTOM + "px";

      mini.style.left = "auto";
      mini.style.right = "678px";
      mini.style.bottom = DEFAULT_BOTTOM + "px";
    }

    function positionChained() {
      const r = findAnchorRect();
      if (r) applyPosLeftOf(r);
      else applyFallback();
    }

    const setCollapsed = (v) => {
      collapsed = v;
      panel.style.display = collapsed ? "none" : "block";
      mini.style.display  = collapsed ? "flex" : "none";
      positionChained();
    };

    mini.addEventListener("click", () => setCollapsed(false));
    title.addEventListener("dblclick", () => setCollapsed(true));

    document.documentElement.appendChild(host);
    document.documentElement.appendChild(mini);

    const log = (msg) => {
      const t = new Date();
      const hh = String(t.getHours()).padStart(2, "0");
      const mm = String(t.getMinutes()).padStart(2, "0");
      const ss = String(t.getSeconds()).padStart(2, "0");
      pre.textContent += `[${hh}:${mm}:${ss}] ${msg}\n`;
      logWrap.scrollTop = logWrap.scrollHeight;
      try { console.log("[PC Step3]", msg); } catch {}
    };

    const setStatus = (s) => { status.textContent = s; };

    positionChained();
    window.addEventListener("resize", () => positionChained(), { passive: true });

    return { btnStart, btnStop, btnForce, log, setStatus, positionChained };
  })();

  /******************************************************************
   * HELPERS (iframe-safe)
   ******************************************************************/
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function getAllDocs() {
    const out = [];
    const seen = new Set();
    function walk(doc, depth) {
      if (!doc || depth > 6) return;
      if (seen.has(doc)) return;
      seen.add(doc);
      out.push(doc);
      const frames = doc.querySelectorAll("iframe, frame");
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

  const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());

  const isVisible = (el) => {
    if (!el) return false;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || "1") === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch { return false; }
  };

  const waitFor = async (fn, { timeout = 20000, min = 120, max = 420 } = {}) => {
    const t0 = Date.now();
    let delay = min;
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(delay);
      delay = Math.min(max, Math.floor(delay * 1.25));
    }
    return null;
  };

  const realClick = (el) => {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    const seq = [
      () => el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 })),
      () => el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 })),
      () => el.dispatchEvent(new PointerEvent("pointerup",   { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 })),
      () => el.dispatchEvent(new MouseEvent("mouseup",   { ...opts, buttons: 0 })),
      () => el.dispatchEvent(new MouseEvent("click",     { ...opts, buttons: 0 })),
    ];
    seq.forEach(fn => { try { fn(); } catch {} });
    return true;
  };

  const textBlock = (el) => {
    if (!el) return "";
    let t = "";
    try { t = el.innerText || el.textContent || ""; } catch {}
    t = String(t || "").replace(/\r/g, "");
    const lines = t.split("\n").map(x => x.trim()).filter(Boolean);
    return lines.join("\n");
  };

  const getHeaderTitle = () => {
    const titles = qAnyAll(".gw-TitleBar--title").filter(isVisible);
    for (const el of titles) {
      const t = clean(el.textContent);
      if (t) return t;
    }
    return "";
  };

  const readPolicyNumber = () => clean(qAny(SEL_INFOBAR_POLICY)?.textContent);
  const lsGet = (key) => {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  };
  const lsSet = (key, value) => {
    try { localStorage.setItem(key, String(value ?? "")); } catch {}
  };
  const step3GateReady = () =>
    clean(lsGet(LS.STEP3_GO)) === "1" || clean(lsGet(LS.HOME_STAGE)) === "dwelling_done";
  const consumeStep3Gate = () => lsSet(LS.STEP3_GO, "0");

  /******************************************************************
   * NAV + CARD SUBTABS
   ******************************************************************/
  const findMenuItem = (label) => {
    for (const d of getAllDocs()) {
      try {
        const aria = d.querySelector(`.gw-action--inner .gw-label[aria-label="${label}"]`);
        if (aria) return aria.closest('div[role="menuitem"]') || aria;

        const tip = d.querySelector(`.gw-action--inner [data-gw-tooltip="${label}"]`);
        if (tip) return tip.closest('div[role="menuitem"]') || tip;

        const all = Array.from(d.querySelectorAll('div[role="menuitem"].gw-action--inner'));
        const hit = all.find(n => clean(n.textContent).includes(label));
        if (hit) return hit;
      } catch {}
    }
    return null;
  };

  const clickMainTab = async (label) => {
    const el = await waitFor(() => findMenuItem(label), { timeout: 12000 });
    if (!el) return false;
    UI.log(`Clicking tab: ${label}`);
    realClick(el);
    return true;
  };

  function findCardTabs() {
    const scoped = qAnyAll(".gw-CardTabWidget div[role='tab'].gw-action--inner").filter(isVisible);
    if (scoped.length) return scoped;
    return qAnyAll("div[role='tab'].gw-action--inner").filter(isVisible);
  }

  function getActiveCardTabText() {
    const tabs = findCardTabs();
    const active =
      tabs.find(t => (t.getAttribute("aria-selected") || "").toLowerCase() === "true") ||
      tabs.find(t => (t.className || "").toLowerCase().includes("active")) ||
      tabs.find(t => (t.className || "").toLowerCase().includes("selected"));
    return clean(active?.textContent || "");
  }

  function findCardTabElByText(label) {
    const want = String(label || "").toLowerCase();
    const tabs = findCardTabs();
    return (
      tabs.find(el => clean(el.textContent).toLowerCase() === want) ||
      tabs.find(el => clean(el.textContent).toLowerCase().includes(want)) ||
      null
    );
  }

  function findHeadingH2Exact(text) {
    const want = clean(text);
    if (!want) return null;

    for (const d of getAllDocs()) {
      try {
        const els = Array.from(
          d.querySelectorAll('.gw-TitleBar--title[role="heading"][aria-level="2"]')
        );
        for (const el of els) {
          if (!isVisible(el)) continue;
          if (clean(el.textContent) === want) return el;
        }
      } catch {}
    }
    return null;
  }

  async function gotoSubtab(label, budgetEndTs) {
    const el = findCardTabElByText(label);
    if (!el) return false;

    UI.log(`Clicking subtab: ${label}`);
    realClick(el);

    const deadline = Math.min(budgetEndTs, Date.now() + ACTIVE_TAB_WAIT_MS);
    while (Date.now() < deadline) {
      const a = getActiveCardTabText();
      if (clean(a).toLowerCase() === String(label).toLowerCase()) return true;
      await sleep(100);
    }

    UI.log(`WARN: "${label}" not marked active (continuing)`);
    return true;
  }

  const clickExclusionsTab = async () => {
    const pref = qAny(SEL_EXCL_TAB_PREF);
    if (isVisible(pref)) {
      UI.log("Clicking subtab: Exclusions and Conditions (preferred selector)");
      realClick(pref);
      return true;
    }
    const el = findCardTabElByText("Exclusions and Conditions");
    if (!el) return false;
    UI.log("Clicking subtab: Exclusions and Conditions");
    realClick(el);
    return true;
  };

  /******************************************************************
   * TIMEBOXED READY + CAPTURE
   ******************************************************************/
  function bestVisibleBigContainerText() {
    // fallback: pick the biggest visible panel-like container
    const candidates = [
      SEL_ALL_COVERAGES_ROOT,
      SEL_EXCL_ROOT,
      ".gw-PanelWidget",
      ".gw-ListViewWidget",
      ".gw-TableWidget",
      "body",
    ];

    let bestEl = null;
    let bestScore = 0;

    for (const d of getAllDocs()) {
      for (const sel of candidates) {
        let els = [];
        try { els = Array.from(d.querySelectorAll(sel)); } catch { els = []; }
        for (const el of els) {
          if (!isVisible(el)) continue;
          const txtLen = (el.textContent || "").length;
          const h = el.scrollHeight || 0;
          const score = txtLen + Math.min(50000, h);
          if (score > bestScore) {
            bestScore = score;
            bestEl = el;
          }
        }
      }
    }

    return textBlock(bestEl);
  }

  async function timeboxedWaitReady({ label, rootSel, sentinelText, clickFn }) {
    const t0 = Date.now();
    const hardEnd = t0 + SUBTAB_HARD_MS;
    const readyEnd = t0 + SUBTAB_READY_MS;

    // click
    if (clickFn) await clickFn(hardEnd);
    else await gotoSubtab(label, hardEnd);

    // quick “ready” loop (max 2s)
    while (Date.now() < readyEnd) {
      const root = qAny(rootSel);
      if (root && isVisible(root)) {
        const txt = clean(root.textContent || "");
        if (txt.length >= MIN_TEXT_CHARS) {
          if (!sentinelText) return { ready: true, reason: "root_has_text" };
          if (txt.includes(clean(sentinelText))) return { ready: true, reason: "sentinel_in_root" };
        }
      }

      // sentinel itself visible (can be faster than root text)
      if (sentinelText) {
        const h2 = findHeadingH2Exact(sentinelText);
        if (h2) {
          // still accept as "ready" even if root text lagging, per your timebox rule
          return { ready: true, reason: "h2_visible" };
        }
      }

      await sleep(SAMPLE_MS);
    }

    return { ready: false, reason: "timeout_2s" };
  }

  function captureNow(rootSel) {
    const root = qAny(rootSel);
    const txt = textBlock(root);
    if (txt && txt.length) return txt;
    return bestVisibleBigContainerText();
  }

  /******************************************************************
   * EXTRACTION
   ******************************************************************/
  const writeLS = (key, obj) => localStorage.setItem(key, JSON.stringify(obj));

  const logCopied = (dataObj) => {
    for (const k of Object.keys(dataObj || {})) {
      const v = String(dataObj[k] || "");
      UI.log(`[COPIED] ${k} = ${v.slice(0, 220)}${v.length > 220 ? "…" : ""}`);
    }
  };

  async function extractCoverages() {
    // All Coverages (timeboxed)
    let st = await timeboxedWaitReady({
      label: "All Coverages",
      rootSel: SEL_ALL_COVERAGES_ROOT,
      sentinelText: null,
      clickFn: (hardEnd) => gotoSubtab("All Coverages", hardEnd),
    });
    UI.log(st.ready ? `All Coverages ready (${st.reason})` : "All Coverages not ready in 2s → capturing partial");
    const allTxt = captureNow(SEL_ALL_COVERAGES_ROOT);

    // Optional (timeboxed)
    st = await timeboxedWaitReady({
      label: "Optional Coverages",
      rootSel: SEL_ALL_COVERAGES_ROOT,
      sentinelText: SENTINELS["Optional Coverages"],
      clickFn: (hardEnd) => gotoSubtab("Optional Coverages", hardEnd),
    });
    UI.log(st.ready ? `Optional ready (${st.reason})` : "Optional not ready in 2s → capturing partial");
    const optTxt = captureNow(SEL_ALL_COVERAGES_ROOT);

    // Detailed (timeboxed)
    st = await timeboxedWaitReady({
      label: "Detailed Coverages",
      rootSel: SEL_ALL_COVERAGES_ROOT,
      sentinelText: SENTINELS["Detailed Coverages"],
      clickFn: (hardEnd) => gotoSubtab("Detailed Coverages", hardEnd),
    });
    UI.log(st.ready ? `Detailed ready (${st.reason})` : "Detailed not ready in 2s → capturing partial");
    const detTxt = captureNow(SEL_ALL_COVERAGES_ROOT);

    // Exclusions (timeboxed)
    st = await timeboxedWaitReady({
      label: "Exclusions and Conditions",
      rootSel: SEL_EXCL_ROOT,
      sentinelText: null,
      clickFn: async () => { await clickExclusionsTab(); },
    });
    UI.log(st.ready ? `Exclusions ready (${st.reason})` : "Exclusions not ready in 2s → capturing partial");
    const exclTxt = captureNow(SEL_EXCL_ROOT);

    return {
      ok: true,
      data: {
        "Coverages.AllCoverages": allTxt || "",
        "Coverages.OptionalCoverages_All": optTxt || "",
        "Coverages.DetailedCoverages_All": detTxt || "",
        "Coverages.ExclusionsAndConditions_All": exclTxt || "",
      }
    };
  }

  /******************************************************************
   * RUNNER
   ******************************************************************/
  let armed = false;
  let busy = false;
  let pollTimer = null;
  let runCount = 0;
  let lastGateLogAt = 0;

  // gate: run once per Coverages visibility
  let ranThisVisibility = false;

  const setArmedUI = (v) => {
    armed = v;
    UI.btnStart.disabled = v;
    UI.btnStop.disabled = !v;
    UI.btnStop.style.opacity = v ? "1" : "0.55";
    UI.btnStart.style.opacity = v ? "0.55" : "1";
  };

  const alreadyDoneForPolicy = (policyNumber) => {
    const p = String(policyNumber || "");
    const last = String(localStorage.getItem(LS.DONE_POLICY) || "");
    return !!p && p === last;
  };

  const markDoneForPolicy = (policyNumber) => {
    const p = String(policyNumber || "");
    if (p) localStorage.setItem(LS.DONE_POLICY, p);
  };

  const onCoveragesScreen = () =>
    clean(getHeaderTitle()).toLowerCase() === TAB_LABEL_COVERAGES.toLowerCase();

  const runOnce = async (why) => {
    if (busy) return true;
    if (why !== "FORCE_RUN" && !step3GateReady()) {
      UI.log(`Skip: waiting for Step2 signal (${LS.STEP3_GO}=1)`);
      return false;
    }
    busy = true;
    runCount++;

    let okOverall = false;

    try {
      UI.positionChained();
      UI.setStatus("RUNNING");
      UI.log(`Run #${runCount} start (${why})`);

      if (!onCoveragesScreen()) {
        UI.log("Not on Coverages. Clicking Coverages…");
        const ok = await clickMainTab(TAB_LABEL_COVERAGES);
        if (!ok) {
          UI.log("ERROR: Could not click Coverages tab");
          UI.setStatus("ERROR");
          return false;
        }
        await sleep(5200);
      }

      UI.log(`Coverages detected. Waiting ${WAIT_ON_COVERAGES_MS}ms…`);
      await sleep(WAIT_ON_COVERAGES_MS);

      const policyNumber = readPolicyNumber();
      if (policyNumber && alreadyDoneForPolicy(policyNumber) && why !== "FORCE_RUN") {
        UI.log(`Skip: already done for policy ${policyNumber}`);
        UI.setStatus("ARMED");
        okOverall = true;
        return true;
      }

      UI.log("Extracting Coverages…");
      const res = await extractCoverages();
      if (!res.ok) {
        UI.log("ERROR: extraction failed");
        UI.setStatus("ERROR");
        return false;
      }

      const payload = {
        ok: true,
        ts: Date.now(),
        url: location.href,
        tab: "Coverages",
        policyNumber: policyNumber || "",
        data: res.data,
      };

      writeLS(LS.OUT, payload);
      writeLS(LS.READY, { ok: true, ts: payload.ts, tab: "Coverages", policyNumber: payload.policyNumber });

      localStorage.setItem(LS.STAGE, "coverages_done");
      consumeStep3Gate();
      markDoneForPolicy(payload.policyNumber);

      UI.log("Saved to localStorage:");
      UI.log(`- ${LS.OUT}`);
      UI.log(`- ${LS.READY}`);
      UI.log(`- ${LS.STAGE} = coverages_done`);

      logCopied(res.data);

      UI.log("Clicking Quote…");
      await clickMainTab(TAB_LABEL_QUOTE);

      UI.setStatus("ARMED");
      UI.log("Run complete. Waiting until Coverages is NOT visible to allow next run…");

      okOverall = true;
      return true;
    } finally {
      busy = false;

      // if fail while still on Coverages -> allow retry
      if (!okOverall && onCoveragesScreen()) {
        ranThisVisibility = false;
        UI.log("Run failed; gate cleared → will retry while still on Coverages.");
      }
    }
  };

  const startPolling = () => {
    if (armed) return;
    setArmedUI(true);
    UI.positionChained();
    UI.setStatus("ARMED");
    UI.log("Loaded. Double-click title to collapse. Auto-arming...");
    UI.log("ARMED. Rule: Coverages visible → run once → wait until not visible.");

    pollTimer = window.setInterval(() => {
      if (!armed || busy) return;

      UI.positionChained();

      const visible = onCoveragesScreen();

      // gate reset when leaving Coverages
      if (!visible && ranThisVisibility) {
        ranThisVisibility = false;
        UI.log("Coverages not visible anymore. Gate reset ✅");
      }

      // run once per Coverages visibility session
      if (visible && !ranThisVisibility) {
        if (!step3GateReady()) {
          const now = Date.now();
          if (now - lastGateLogAt > 3000) {
            UI.log(`Coverages visible, waiting for Step2 signal (${LS.STEP3_GO}=1)`);
            lastGateLogAt = now;
          }
          return;
        }

        const policyNumber = readPolicyNumber();
        if (policyNumber && alreadyDoneForPolicy(policyNumber)) {
          ranThisVisibility = true;
          UI.log(`Skip: already done for policy ${policyNumber} (gate set; will reset when leaving Coverages)`);
          return;
        }

        ranThisVisibility = true;
        runOnce("COVERAGES_VISIBLE");
      }
    }, 650);
  };

  const stopPolling = () => {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
    setArmedUI(false);
    UI.setStatus("IDLE");
    UI.log("Stopped (session-only). Reload will re-arm.");
  };

  /******************************************************************
   * WIRE UI
   ******************************************************************/
  UI.btnStart.addEventListener("click", () => startPolling());
  UI.btnStop.addEventListener("click", () => stopPolling());
  UI.btnForce.addEventListener("click", () => runOnce("FORCE_RUN"));

  startPolling();
})();
