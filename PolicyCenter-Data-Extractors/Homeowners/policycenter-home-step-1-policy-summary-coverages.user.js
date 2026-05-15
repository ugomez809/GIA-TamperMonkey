// ==UserScript==
// @name         PolicyCenter — HOME Helper: Policy Summary → Coverages → Optional → Detailed (MANUAL)
// @namespace    tm.pc.step1.summary.to.coverages
// @version      1.0.4
// @description  MANUAL helper. When started and header starts with "Policy Summary" (ex: "Policy Summary: 123") → click Coverages once → wait 2s → click Optional Coverages → wait 2s → click Detailed Coverages. Kept manual so it does not race the extraction chain.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-1-policy-summary-coverages.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-1-policy-summary-coverages.user.js
// ==/UserScript==

(() => {
  "use strict";
  if (window.top !== window.self) return;

  /******************************************************************
   * CONFIG
   ******************************************************************/
  const CFG = {
    POLL_MS: 450,
    BETWEEN_CLICKS_MS: 2000,
    CLICK_RETRY_MS: 1500,     // tries to find/click within this window (does NOT add extra "between clicks" delay)
    CLICK_RETRY_STEP_MS: 120,
  };

  const TITLE_PREFIX_POLICY_SUMMARY = "policy summary";
  const MAIN_TAB_COVERAGES = "Coverages";
  const SUBTAB_OPTIONAL = "Optional Coverages";
  const SUBTAB_DETAILED = "Detailed Coverages";

  /******************************************************************
   * UI
   ******************************************************************/
  const UI = (() => {
    const RIGHT_PX = 1342;
    const BOTTOM_PX = 14;

    const host = document.createElement("div");
    host.id = "tm_pc_step1_summary_host";
    host.style.cssText = [
      "position:fixed",
      `right:${RIGHT_PX}px`,
      `bottom:${BOTTOM_PX}px`,
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
    title.textContent = "PC Helper — Summary → Coverages";
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
    const btnStop = mkBtn("STOP");
    const btnForce = mkBtn("FORCE RUN");

    btnStop.style.opacity = "0.55";
    btnStop.disabled = true;

    btnRow.appendChild(btnStart);
    btnRow.appendChild(btnStop);
    btnRow.appendChild(btnForce);

    const logWrap = document.createElement("div");
    logWrap.style.cssText = "padding:10px;max-height:220px;overflow:auto";

    const pre = document.createElement("pre");
    pre.style.cssText =
      "margin:0;white-space:pre-wrap;word-break:break-word;font:11px/1.25 ui-monospace,Consolas,monospace;opacity:.95";
    logWrap.appendChild(pre);

    panel.appendChild(top);
    panel.appendChild(btnRow);
    panel.appendChild(logWrap);
    host.appendChild(panel);

    const mini = document.createElement("div");
    mini.textContent = "PC1S";
    mini.title = "Click to show/hide";
    mini.style.cssText = [
      "position:fixed",
      `right:${RIGHT_PX}px`,
      `bottom:${BOTTOM_PX}px`,
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
    const setCollapsed = (v) => {
      collapsed = v;
      panel.style.display = collapsed ? "none" : "block";
      mini.style.display = collapsed ? "flex" : "none";
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
      try { console.log("[PC Summary Helper]", msg); } catch {}
    };

    const setStatus = (s) => (status.textContent = s);

    return { btnStart, btnStop, btnForce, log, setStatus };
  })();

  /******************************************************************
   * HELPERS (iframe-safe)
   ******************************************************************/
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());

  const isVisible = (el) => {
    if (!el) return false;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || "1") === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    } catch {
      return false;
    }
  };

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
        try {
          if (f.contentDocument) walk(f.contentDocument, depth + 1);
        } catch {}
      }
    }
    walk(document, 0);
    return out;
  }

  function qAnyAll(sel) {
    const out = [];
    for (const d of getAllDocs()) {
      try { out.push(...Array.from(d.querySelectorAll(sel))); } catch {}
    }
    return out;
  }

  const realClick = (el) => {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try {
      const seq = [
        () => el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 })),
        () => el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 })),
        () => el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 })),
        () => el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 })),
        () => el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0 })),
      ];
      seq.forEach((fn) => fn());
      return true;
    } catch {
      try { el.click(); return true; } catch { return false; }
    }
  };

  /******************************************************************
   * HEADER DETECT (prefix match)
   ******************************************************************/
  const getHeaderTitle = () => {
    const titles = qAnyAll(".gw-TitleBar--title").filter(isVisible);
    for (const el of titles) {
      const t = clean(el.textContent);
      if (t) return t;
    }
    return "";
  };

  const onPolicySummary = () => {
    const t = clean(getHeaderTitle()).toLowerCase();
    // matches "Policy Summary" and "Policy Summary: 779700736"
    return t.startsWith(TITLE_PREFIX_POLICY_SUMMARY);
  };

  /******************************************************************
   * CLICK MAIN TAB + SUBTABS
   ******************************************************************/
  function findMenuItem(label) {
    for (const d of getAllDocs()) {
      try {
        const aria = d.querySelector(`.gw-action--inner .gw-label[aria-label="${label}"]`);
        if (aria) return aria.closest('div[role="menuitem"]') || aria;

        const tip = d.querySelector(`.gw-action--inner [data-gw-tooltip="${label}"]`);
        if (tip) return tip.closest('div[role="menuitem"]') || tip;

        const all = Array.from(d.querySelectorAll('div[role="menuitem"].gw-action--inner, div[role="menuitem"]'));
        const hit = all.find((n) => clean(n.textContent).includes(label));
        if (hit) return hit;
      } catch {}
    }
    return null;
  }

  function findCardTabs() {
    const scoped = [];
    for (const d of getAllDocs()) {
      try {
        scoped.push(...Array.from(d.querySelectorAll(".gw-CardTabWidget div[role='tab'].gw-action--inner")));
      } catch {}
    }
    const visScoped = scoped.filter(isVisible);
    if (visScoped.length) return visScoped;
    return qAnyAll("div[role='tab'].gw-action--inner").filter(isVisible);
  }

  function findCardTabElByText(label) {
    const want = String(label || "").toLowerCase();
    const tabs = findCardTabs();
    return (
      tabs.find((el) => clean(el.textContent).toLowerCase() === want) ||
      tabs.find((el) => clean(el.textContent).toLowerCase().includes(want)) ||
      null
    );
  }

  async function clickWithRetry(getElFn, what) {
    const t0 = Date.now();
    while (Date.now() - t0 < CFG.CLICK_RETRY_MS) {
      const el = (() => { try { return getElFn(); } catch { return null; } })();
      if (el && isVisible(el)) {
        UI.log(`Clicking: ${what}`);
        return realClick(el);
      }
      await sleep(CFG.CLICK_RETRY_STEP_MS);
    }
    UI.log(`WARN: Could not find/click: ${what}`);
    return false;
  }

  const clickCoverages = () => clickWithRetry(() => findMenuItem(MAIN_TAB_COVERAGES), "main tab Coverages");
  const clickOptional  = () => clickWithRetry(() => findCardTabElByText(SUBTAB_OPTIONAL), "subtab Optional Coverages");
  const clickDetailed  = () => clickWithRetry(() => findCardTabElByText(SUBTAB_DETAILED), "subtab Detailed Coverages");

  /******************************************************************
   * RUNNER
   ******************************************************************/
  let armed = false;
  let busy = false;
  let pollTimer = null;
  let runCount = 0;
  let ranThisVisibility = false;

  const setArmedUI = (v) => {
    armed = v;
    UI.btnStart.disabled = v;
    UI.btnStop.disabled = !v;
    UI.btnStop.style.opacity = v ? "1" : "0.55";
    UI.btnStart.style.opacity = v ? "0.55" : "1";
  };

  async function runOnce(why) {
    if (busy) return true;
    busy = true;
    runCount++;

    try {
      UI.setStatus("RUNNING");
      UI.log(`Run #${runCount} start (${why})`);
      UI.log(`Header now: "${getHeaderTitle() || "(blank)"}"`);

      await clickCoverages();
      await sleep(CFG.BETWEEN_CLICKS_MS);

      await clickOptional();
      await sleep(CFG.BETWEEN_CLICKS_MS);

      await clickDetailed();

      UI.setStatus("ARMED");
      UI.log("Done. Waiting until Policy Summary is NOT visible to allow next run...");
      return true;
    } finally {
      busy = false;
    }
  }

  function startPolling() {
    if (armed) return;
    setArmedUI(true);
    UI.setStatus("ARMED");
    UI.log("Loaded. Double-click title to collapse.");
    UI.log('ARMED. Rule: header starts with "Policy Summary" → run once → wait until not visible.');

    pollTimer = window.setInterval(() => {
      if (!armed || busy) return;

      const visible = onPolicySummary();

      if (!visible && ranThisVisibility) {
        ranThisVisibility = false;
        UI.log("Policy Summary not visible anymore. Gate reset ✅");
      }

      if (visible && !ranThisVisibility) {
        ranThisVisibility = true;
        runOnce("POLICY_SUMMARY_VISIBLE");
      }
    }, CFG.POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
    setArmedUI(false);
    UI.setStatus("IDLE");
    UI.log("Stopped.");
  }

  UI.btnStart.addEventListener("click", () => startPolling());
  UI.btnStop.addEventListener("click", () => stopPolling());
  UI.btnForce.addEventListener("click", () => runOnce("FORCE_RUN"));

  UI.setStatus("IDLE");
  UI.log("Manual helper is idle. Press START only when you want Policy Summary → Coverages navigation.");
})();
