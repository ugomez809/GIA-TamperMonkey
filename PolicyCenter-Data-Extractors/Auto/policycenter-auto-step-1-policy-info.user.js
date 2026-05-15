// ==UserScript==
// @name         PolicyCenter — Step 1: Policy Info Extractor (InfoBar Policy + Account) (ALWAYS ON)
// @namespace    tm.pc.step1.policyinfo
// @version      1.3.0
// @description  ALWAYS ON. Auto-arms on load (STOP is session-only). Waits for GO_AHEAD, CONSUMES it (sets to "0"), clicks Policy Info, extracts Policy Info + InfoBar Policy/Account + Paperless status, saves to localStorage, clicks Drivers, then re-arms for next GO_AHEAD.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-1-policy-info.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Auto/policycenter-auto-step-1-policy-info.user.js
// ==/UserScript==

(() => {
  "use strict";
  if (window.top !== window.self) return;

  /******************************************************************
   * CONFIG
   ******************************************************************/
  const LS = {
    GO_AHEAD: "tm_pc_go_ahead_v1",
    STAGE: "tm_pc_stage_v1",
    OUT: "tm_pc_policyinfo_v1",
    READY: "tm_pc_policyinfo_ready_v1",
  };

  const TAB_LABEL_POLICYINFO = "Policy Info";
  const TAB_LABEL_DRIVERS = "Drivers";

  const SEL_POLICYINFO_TAB_BY_ID =
    "#PolicyFile-PolicyFileAcceleratedMenuActions-PolicyMenuItemSet-PolicyMenuItemSet_PolicyInfo > div";

  const SEL_POLICYINFO_ROOT = "#PolicyFile_PolicyInfo-PolicyFile_PolicyInfoScreen";

  const SEL_INFOBAR = "#PolicyFile-PolicyFileMenuInfoBar";
  const SEL_INFOBAR_ACCOUNT = "#PolicyFile-PolicyFileMenuInfoBar-AccountNumber .gw-infoValue";
  const SEL_INFOBAR_POLICY  = "#PolicyFile-PolicyFileMenuInfoBar-PolicyNumber .gw-infoValue";

  const LOAD_WAIT_MS = 5200;

  const IGNORE_LABELS = new Set([
    "agency",
    "agent number",
    "agent name",
    "agent phone",
    "agent email",
  ]);

  // ✅ Key behavior change: consume GO_AHEAD so sender can keep setting "1"
  const CONSUME_GO_AHEAD = true;
  const GO_AHEAD_CONSUMED_VALUE = "0";

  /******************************************************************
   * UI + LOGS
   ******************************************************************/
  const UI = (() => {
    const host = document.createElement("div");
    host.id = "tm_pc_step1_host";
    host.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:2147483647",
      "font:12px/1.2 system-ui,Segoe UI,Roboto,Arial",
      "color:#111",
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
    title.textContent = "PC Step1 — Policy Info";
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
    mini.textContent = "PC1";
    mini.title = "Click to show/hide";
    mini.style.cssText = [
      "position:fixed",
      "right:14px",
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
    ].join(";");

    let collapsed = false;
    const setCollapsed = (v) => {
      collapsed = v;
      panel.style.display = collapsed ? "none" : "block";
      mini.style.display  = collapsed ? "flex" : "none";
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
    };

    const setStatus = (s) => { status.textContent = s; };

    return { btnStart, btnStop, btnForce, log, setStatus };
  })();

  /******************************************************************
   * HELPERS
   ******************************************************************/
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const isVisible = (el) => {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity || "1") === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
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

  const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());
  const normLabel = (s) => clean(s).replace(/:$/, "").toLowerCase();
  const shouldIgnoreLabel = (labelText) => IGNORE_LABELS.has(normLabel(labelText));

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
    seq.forEach(fn => fn());
    return true;
  };

  const findMenuItem = (label, preferIdSel) => {
    if (preferIdSel) {
      const byId = document.querySelector(preferIdSel);
      if (byId) return byId;
    }
    const labelDiv = document.querySelector(`.gw-action--inner .gw-label[aria-label="${label}"]`);
    if (labelDiv) return labelDiv.closest('div[role="menuitem"]') || labelDiv;
    const mini = document.querySelector(`.gw-action--inner [data-gw-tooltip="${label}"]`);
    if (mini) return mini.closest('div[role="menuitem"]') || mini;
    const all = Array.from(document.querySelectorAll('div[role="menuitem"].gw-action--inner'));
    const hit = all.find(n => clean(n.textContent).includes(label));
    return hit || null;
  };

  /******************************************************************
   * EXTRACTION (Policy Info)
   ******************************************************************/
  const readInfoBarNumbers = () => {
    const bar = document.querySelector(SEL_INFOBAR);
    if (!bar) return { policyNumber: "", accountNumber: "" };
    const accountNumber = clean(document.querySelector(SEL_INFOBAR_ACCOUNT)?.textContent);
    const policyNumber  = clean(document.querySelector(SEL_INFOBAR_POLICY)?.textContent);
    return { policyNumber, accountNumber };
  };

  const buildLabelValueMap = (root) => {
    const map = Object.create(null);

    const labelEls = Array.from(root.querySelectorAll("div.gw-label:not(.gw-infoValue)"));
    for (const lab of labelEls) {
      const k = clean(lab.textContent);
      if (!k) continue;

      if (shouldIgnoreLabel(k)) continue;

      const parent = lab.parentElement;
      if (!parent) continue;

      const valEl =
        parent.querySelector("div.gw-value.gw-infoValue") ||
        parent.querySelector("div.gw-label.gw-infoValue") ||
        parent.querySelector("span.gw-value.gw-infoValue") ||
        parent.querySelector("span.gw-infoValue") ||
        parent.querySelector("div.gw-value") ||
        null;

      let v = "";
      if (valEl && valEl !== lab) v = clean(valEl.textContent);

      if (!v) {
        const inp = parent.querySelector("input,textarea,select");
        if (inp) {
          const tag = inp.tagName.toLowerCase();
          const type = (inp.getAttribute("type") || "").toLowerCase();

          if (tag === "select") {
            const opt = inp.selectedOptions && inp.selectedOptions[0];
            v = clean(opt ? opt.textContent : inp.value);
          } else if (type === "checkbox") {
            v = inp.checked ? "Yes" : "No";
          } else {
            v = clean(inp.value || inp.getAttribute("value") || "");
          }
        }
      }

      if (!v) continue;

      if (!map[k] || (String(v).length > String(map[k]).length)) map[k] = v;
    }
    return map;
  };

  const pickFirst = (map, keys) => {
    for (const k of keys) {
      if (map[k]) return map[k];
      const foundKey = Object.keys(map).find(x => x.toLowerCase() === String(k).toLowerCase());
      if (foundKey && map[foundKey]) return map[foundKey];
      const contains = Object.keys(map).find(x => x.toLowerCase().includes(String(k).toLowerCase()));
      if (contains && map[contains]) return map[contains];
    }
    return "";
  };

  const extractPolicyInfoData = async () => {
    await waitFor(() => document.querySelector(SEL_INFOBAR), { timeout: 12000 });

    const { policyNumber, accountNumber } = readInfoBarNumbers();

    const root = await waitFor(() => {
      const r = document.querySelector(SEL_POLICYINFO_ROOT);
      return (r && isVisible(r)) ? r : null;
    }, { timeout: 20000 });

    if (!root) return { ok: false, why: "Policy Info root not visible", rootSel: SEL_POLICYINFO_ROOT };

    const map = buildLabelValueMap(root);

    const data = {
      "PolicyNumber": policyNumber || pickFirst(map, ["Policy Number", "Policy #"]),
      "Account Number": accountNumber || pickFirst(map, ["Account Number", "Account #"]),
      "Primary Insured Name": pickFirst(map, ["Primary Named Insured Name", "Primary Insured Name", "Primary Named Insured", "Name"]),
      "Secondary Insured Name (if any)": pickFirst(map, ["Secondary Named Insured Name", "Secondary Insured Name", "Secondary Named Insured", "Secondary Name"]),
      "Phone Number (Preferred)": pickFirst(map, ["Phone (Preferred)", "Phone Preferred", "Phone"]),
      "Email Address (Preferred)": pickFirst(map, ["Email (Preferred)", "Email Preferred", "Email"]),
      "Policy Expiration Date": pickFirst(map, ["Expiration Date", "Policy Expiration Date"]),
      "Rolling Signature (eSignature) (Yes/No)": pickFirst(map, ["Rolling Signature", "eSignature", "Rolling Signature (eSignature)"]),
      "Policy Type": pickFirst(map, ["Policy Type"]),

      "Paperless Policy": pickFirst(map, ["Paperless Policy", "Paperless"]),
      "Paperless Billing": pickFirst(map, ["Paperless Billing"]),
    };

    for (const k of Object.keys(data)) {
      data[k] = clean(data[k]);
      if (data[k] === "AddressAddress" || data[k] === "SelectedSelected") data[k] = "";
    }

    return { ok: true, data, policyNumber: data["PolicyNumber"], accountNumber: data["Account Number"] };
  };

  /******************************************************************
   * RUNNER
   ******************************************************************/
  let armed = false;
  let busy = false;
  let pollTimer = null;
  let runCount = 0;

  const setArmedUI = (v) => {
    armed = v;
    UI.btnStart.disabled = v;
    UI.btnStop.disabled = !v;
    UI.btnStop.style.opacity = v ? "1" : "0.55";
    UI.btnStart.style.opacity = v ? "0.55" : "1";
  };

  const isGoAhead = () => {
    const v = localStorage.getItem(LS.GO_AHEAD);
    if (!v) return false;
    const s = String(v).toLowerCase().trim();
    if (!s || s === "0" || s === "false" || s === "no") return false;
    return true;
  };

  const consumeGoAhead = () => {
    if (!CONSUME_GO_AHEAD) return;
    try { localStorage.setItem(LS.GO_AHEAD, GO_AHEAD_CONSUMED_VALUE); } catch {}
  };

  const writeLS = (key, obj) => {
    localStorage.setItem(key, JSON.stringify(obj));
  };

  const logCopied = (dataObj) => {
    const keys = Object.keys(dataObj || {});
    for (const k of keys) UI.log(`[COPIED] ${k} = ${dataObj[k]}`);
  };

  const clickTabAndWait = async (label, preferSel) => {
    const el = await waitFor(() => {
      const x = findMenuItem(label, preferSel);
      return x ? x : null;
    }, { timeout: 12000 });

    if (!el) return { ok: false, why: `tab not found: ${label}` };

    UI.log(`Clicking tab: ${label}`);
    realClick(el);

    UI.log(`Waiting ${LOAD_WAIT_MS}ms for load...`);
    await sleep(LOAD_WAIT_MS);

    return { ok: true };
  };

  const runOnce = async (why) => {
    if (busy) return;
    busy = true;
    runCount++;

    try {
      UI.setStatus("RUNNING");
      UI.log(`Run #${runCount} start (${why})`);

      const sw = await clickTabAndWait(TAB_LABEL_POLICYINFO, SEL_POLICYINFO_TAB_BY_ID);
      if (!sw.ok) {
        UI.log(`ERROR: ${sw.why}`);
        UI.setStatus("ERROR");
        return;
      }

      UI.log("Extracting Policy Info...");
      const res = await extractPolicyInfoData();
      if (!res.ok) {
        UI.log(`ERROR: ${res.why}`);
        UI.setStatus("ERROR");
        return;
      }

      const payload = {
        ok: true,
        ts: Date.now(),
        url: location.href,
        tab: "Policy Info",
        data: res.data,
      };
      writeLS(LS.OUT, payload);
      writeLS(LS.READY, { ok: true, ts: payload.ts, tab: "Policy Info" });
      localStorage.setItem(LS.STAGE, "policyinfo_done");

      UI.log("Saved to localStorage:");
      UI.log(`- ${LS.OUT}`);
      UI.log(`- ${LS.READY}`);
      UI.log(`- ${LS.STAGE} = policyinfo_done`);

      logCopied(res.data);

      UI.log("Switching to Drivers...");
      await clickTabAndWait(TAB_LABEL_DRIVERS);

      // ✅ key change: DO NOT stop polling; re-arm for next job
      UI.setStatus("ARMED");
      UI.log("Run complete. Waiting for next GO AHEAD...");
    } finally {
      busy = false;
    }
  };

  const startPolling = () => {
    if (armed) return;
    setArmedUI(true);
    UI.setStatus("ARMED");
    UI.log(`ARMED. Waiting for GO AHEAD key: ${LS.GO_AHEAD} (consume=${CONSUME_GO_AHEAD})`);

    pollTimer = window.setInterval(() => {
      if (!armed || busy) return;

      if (isGoAhead()) {
        UI.log("GO AHEAD detected ✅");
        if (CONSUME_GO_AHEAD) {
          UI.log(`Consuming GO AHEAD → set ${LS.GO_AHEAD}=${GO_AHEAD_CONSUMED_VALUE}`);
          consumeGoAhead();
        }
        runOnce("GO_AHEAD");
      }
    }, 450);
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

  UI.log("Loaded. Double-click title to collapse. Auto-arming...");
  startPolling();
})();
