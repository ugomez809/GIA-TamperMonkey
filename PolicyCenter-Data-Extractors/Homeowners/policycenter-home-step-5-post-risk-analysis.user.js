// ==UserScript==
// @name         PolicyCenter — Step 5: Homeowners → POST to Sheets + HARD Risk Analysis Click (ALWAYS ON)
// @namespace    tm.pc.home.step5.post.sheets
// @version      1.0.13
// @description  ALWAYS ON. When tm_pc_stage_v1 == quote_done: build complete Homeowners payload from tm_pc_home_payload_v1 + tm_pc_coverages_v1 + tm_pc_quote_v1, refuse incomplete posts, then HARD click Risk Analysis after a successful POST. STOP session-only; reload re-arms.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-5-post-risk-analysis.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-5-post-risk-analysis.user.js
// ==/UserScript==

(() => {
  "use strict";
  try { if (window.top !== window.self) return; } catch {}

  if (window.__tm_pc_home_step5_running_v1011) return;
  window.__tm_pc_home_step5_running_v1011 = true;

  const CFG = {
    scriptId: "tm_pc_home_step5_post_sheets_v1",
    webappUrl: "https://script.google.com/macros/s/AKfycbw-Y_HcCwYQDx-dGnLdWUKX_Wel4nAs-vBuk1TK6g_p-2OUj89hX6fWMYbTidr7OqdVEA/exec",

    tickMs: 1200,
    stableMs: 1200,
    cooldownMs: 2500,

    postTimeoutMs: 90000,

    dedupeMs: 30 * 60 * 1000,
    dedupeKeyPrefix: "tm_pc_step5_posted_",
    sessionTokenKey: "tm_pc_step5_last_token_session_v1",

    // Risk click behavior
    riskSelectorExact: "#PolicyFile-MenuLinks-PolicyFile_PolicyFile_RiskAnalysis > div.gw-action--inner",
    riskParentSel: "#PolicyFile-MenuLinks-PolicyFile_PolicyFile_RiskAnalysis",
    riskClickRetryEveryMs: 350,
    riskMaxWaitMs: 25000,
    riskFailsafeMs: 60 * 1000, // 1 minute

    uiOpenKey: "tm_pc_step5_ui_open_v1",

    kStage: "tm_pc_stage_v1",
    kHome: "tm_pc_home_payload_v1",
    kCov: "tm_pc_coverages_v1",
    kQuote: "tm_pc_quote_v1",

    kLastPostedPolicy: "tm_pc_home_step5_last_posted_policy_v1",
    kLastPostedAt: "tm_pc_home_step5_last_posted_at_v1",
  };

  // STOP is session-only
  const STOP_KEY = `${CFG.scriptId}_stop_session`;
  let stopped = false;
  try { stopped = sessionStorage.getItem(STOP_KEY) === "1"; } catch {}

  // session inflight lock (timestamp; auto-recovers if stuck)
  const INFLIGHT_KEY = `${CFG.scriptId}_inflight_ts`;
  const INFLIGHT_MAX_MS = 2 * 60 * 1000;

  const getInflight = () => {
    try {
      const raw = sessionStorage.getItem(INFLIGHT_KEY);
      if (!raw) return false;
      if (raw === "1") return true; // legacy
      const ts = Number(raw || 0);
      if (!ts) return false;
      if ((Date.now() - ts) > INFLIGHT_MAX_MS) {
        sessionStorage.removeItem(INFLIGHT_KEY);
        return false;
      }
      return true;
    } catch { return false; }
  };

  const setInflight = (v) => {
    try {
      if (v) sessionStorage.setItem(INFLIGHT_KEY, String(Date.now()));
      else sessionStorage.removeItem(INFLIGHT_KEY);
    } catch {}
  };

  if (stopped) setInflight(false);

  // ---------- UI ----------
  const UI = (() => {
    const rootId = `${CFG.scriptId}_ui`;
    const styleId = `${rootId}_style`;
    let open = false;
    try { open = GM_getValue(CFG.uiOpenKey, "0") === "1"; } catch {}

    const ensure = () => {
      if (!document.getElementById(styleId)) {
        const s = document.createElement("style");
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
            position:absolute;left:0;bottom:54px;width:min(740px, calc(100vw - 24px));min-width:min(520px, calc(100vw - 24px));max-height:calc(100vh - 86px);
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

      root = document.createElement("div");
      root.id = rootId;

      root.innerHTML = `
        <div id="${rootId}_fab" title="Step 5 logs (click)">S5</div>
        <div id="${rootId}_badge">0</div>

        <div id="${rootId}_drawer" style="display:${open ? "block" : "none"}">
          <div id="${rootId}_top">
            <div id="${rootId}_title">Step 5</div>
            <div id="${rootId}_state">arming…</div>
            <div style="flex:1"></div>
            <button id="${rootId}_post">POST NOW</button>
            <button id="${rootId}_risk">RISK</button>
            <button id="${rootId}_toggle">${stopped ? "START" : "STOP"}</button>
          </div>
          <div id="${rootId}_log"></div>
        </div>
      `;
      document.documentElement.appendChild(root);

      const fab = root.querySelector(`#${rootId}_fab`);
      const drawer = root.querySelector(`#${rootId}_drawer`);

      fab.addEventListener("click", () => {
        open = !open;
        drawer.style.display = open ? "block" : "none";
        try { GM_setValue(CFG.uiOpenKey, open ? "1" : "0"); } catch {}
      });

      root.querySelector(`#${rootId}_toggle`).addEventListener("click", () => {
        stopped = !stopped;
        try { sessionStorage.setItem(STOP_KEY, stopped ? "1" : "0"); } catch {}
        if (stopped) setInflight(false);
        root.querySelector(`#${rootId}_toggle`).textContent = stopped ? "START" : "STOP";
        setState(stopped ? "STOPPED" : "WATCHING");
        log(stopped ? "Stopped for this tab session. (Reload resumes)" : "Resumed.");
        if (!stopped) tick(true);
      });

      root.querySelector(`#${rootId}_post`).addEventListener("click", async () => {
        log("Manual POST NOW…");
        await fire(true);
      });

      root.querySelector(`#${rootId}_risk`).addEventListener("click", async () => {
        log("Manual Risk click…");
        const ok = await clickRiskWithWait("manual");
        log(ok ? "Risk clicked ✅" : "Risk not found/clickable ❌");
      });

      setState(stopped ? "STOPPED" : "WATCHING");
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
      try { console.log("[PC Step 5]", m); } catch {}
    };

    return { ensure, setState, log };
  })();

  UI.ensure();

  // -------- helpers --------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const s = (v) => (v == null ? "" : String(v));
  const clean = (v) => s(v).replace(/\s+/g, " ").trim();

  const normNL = (t) => s(t).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const compactMultiline = (t) => {
    const lines = normNL(t).split("\n").map(x => x.trim()).filter(Boolean);
    return lines.join("\n").trim();
  };

  const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  const deepParse = (v, depth = 0) => {
    if (depth > 6) return v;
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return v;
      try { return deepParse(JSON.parse(t), depth + 1); } catch { return v; }
    }
    return v;
  };
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const asObj = (v) => { v = deepParse(v); return isObj(v) ? v : {}; };

  const isBusy = () => {
    if (document.body?.classList?.contains("gw-busy")) return true;
    return !!document.querySelector(
      ".gw-busyIndicator, .gw-BusyIndicator, .gw-glassPane, .gw-glasspane, .gw-ProgressBarWidget, [aria-busy='true']"
    );
  };

  // ===== HARD Risk click (Guidewire-safe) =====
  const vis = (el) => !!el && el.ownerDocument.contains(el) && el.getClientRects().length > 0;

  const mouseChain = (el) => {
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    const r = el.getBoundingClientRect();
    const x = (r.left + r.width / 2) | 0, y = (r.top + r.height / 2) | 0;
    const tgt = el.ownerDocument.elementFromPoint(x, y) || el;
    ["pointerdown","mousedown","mouseup","pointerup","click"]
      .forEach(t => tgt.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, clientX:x, clientY:y })));
  };

  const keyActivate = (el) => {
    try { el.focus({ preventScroll: true }); } catch {}
    const mk = (type, key, code) => new KeyboardEvent(type, {
      bubbles: true, cancelable: true,
      key, code, keyCode: key === "Enter" ? 13 : 32, which: key === "Enter" ? 13 : 32
    });
    el.dispatchEvent(mk("keydown", "Enter", "Enter"));
    el.dispatchEvent(mk("keyup", "Enter", "Enter"));
    el.dispatchEvent(mk("keydown", " ", "Space"));
    el.dispatchEvent(mk("keyup", " ", "Space"));
  };

  const gwActivate = (el) => {
    const gw = el?.getAttribute?.("data-gw-click") ? el : el?.closest?.("[data-gw-click]");
    if (gw) {
      try { gw.click(); } catch {}
      try { mouseChain(gw); } catch {}
    }
  };

  const wakeMenu = () => {
    const menu = document.querySelector("#PolicyFile-MenuLinks");
    if (menu && vis(menu)) {
      try { menu.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
      try { menu.focus?.({ preventScroll: true }); } catch {}
    }
  };

  const findRiskEl = () => {
    const exact = document.querySelector(CFG.riskSelectorExact);
    if (vis(exact)) return exact;

    const parent = document.querySelector(CFG.riskParentSel);
    if (vis(parent)) return parent;

    const menu = document.querySelector("#PolicyFile-MenuLinks");
    if (menu) {
      const nodes = menu.querySelectorAll("a, button, [role='menuitem'], .gw-action--inner, [data-gw-click]");
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (vis(n) && /risk\s*analysis/i.test((n.textContent || "").trim())) return n;
      }
    }
    return null;
  };

  const tryActivateRisk = (el) => {
    if (!el) return { ok:false, trace:"no-el" };
    try { keyActivate(el); } catch {}
    try { gwActivate(el); } catch {}
    try { mouseChain(el); } catch {}
    return { ok:true, trace:"key+gw+mouse" };
  };

  const clickRiskWithWait = async (tag) => {
    const start = Date.now();
    while (Date.now() - start < CFG.riskMaxWaitMs) {
      if (stopped) return false;
      if (isBusy()) { await sleep(200); continue; }

      wakeMenu();

      const el = findRiskEl();
      if (el) {
        const r = tryActivateRisk(el);
        UI.log(`Risk attempt (${tag}) via ${r.trace} sel=${el === document.querySelector(CFG.riskSelectorExact) ? "exact" : "fallback"}`);
        return true;
      }
      await sleep(CFG.riskClickRetryEveryMs);
    }
    UI.log(`Risk not found within wait (${tag}).`);
    return false;
  };

  const forceClickRisk = async (tag) => {
    const start = Date.now();
    while (Date.now() - start < CFG.riskMaxWaitMs) {
      if (stopped) return false;
      wakeMenu();
      const el = findRiskEl();
      if (el) {
        tryActivateRisk(el);
        UI.log(`Risk FORCE attempt (${tag}) done`);
        return true;
      }
      await sleep(250);
    }
    return false;
  };
  // ================================================================

  // failsafe timer (1 minute)
  let riskClickedThisVisit = false;
  let failsafeTimer = null;

  const clearFailsafe = () => {
    if (failsafeTimer) { clearTimeout(failsafeTimer); failsafeTimer = null; }
  };

  const armFailsafe = () => {
    clearFailsafe();
    riskClickedThisVisit = false;
    failsafeTimer = setTimeout(async () => {
      if (stopped) return;
      if (riskClickedThisVisit) return;
      UI.log("FAILSAFE: 1 minute → FORCE click Risk (ignoring busy)...");
      const ok = await forceClickRisk("failsafe");
      riskClickedThisVisit = riskClickedThisVisit || !!ok;
      if (!ok) UI.log("FAILSAFE: Risk still not found/clickable.");
    }, CFG.riskFailsafeMs);

    UI.log(`Failsafe armed: ${Math.round(CFG.riskFailsafeMs / 1000)}s`);
  };

  // dedupe
  const dedupeKey = (pn) => `${CFG.dedupeKeyPrefix}${String(pn || "").trim()}`;
  const isDeduped = (pn) => {
    try {
      const ts = Number(lsGet(dedupeKey(pn)) || 0);
      return ts && (Date.now() - ts) < CFG.dedupeMs;
    } catch { return false; }
  };
  const markDeduped = (pn) => { try { lsSet(dedupeKey(pn), String(Date.now())); } catch {} };

  const alreadyPostedLast = (pn) => {
    const lastPn = clean(lsGet(CFG.kLastPostedPolicy));
    if (!pn || !lastPn) return false;
    if (pn !== lastPn) return false;
    const lastAt = Number(lsGet(CFG.kLastPostedAt) || 0);
    return lastAt && (Date.now() - lastAt) < CFG.dedupeMs;
  };
  const markPostedLast = (pn) => {
    if (!pn) return;
    lsSet(CFG.kLastPostedPolicy, pn);
    lsSet(CFG.kLastPostedAt, String(Date.now()));
  };

  const getSessionToken = () => { try { return sessionStorage.getItem(CFG.sessionTokenKey) || ""; } catch { return ""; } };
  const setSessionToken = (t) => { try { sessionStorage.setItem(CFG.sessionTokenKey, t || ""); } catch {} };

  // cleaning helpers
  const stripLeadingLabel = (val, label) => {
    const t = s(val);
    if (!t) return "";
    const re = new RegExp("^\\s*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:?\\s*", "i");
    return t.replace(re, "");
  };

  const looksLikeUiDump = (t) => {
    const markers = [
      "My Worklist",
      "Launch Session",
      "Farmers Links",
      "Policy Contract",
      "Policy File",
      "Quick Compare",
      "Manual Adjustments",
      "Help / Chat",
      "Policy Summary:",
      "Account Information",
      "Completed Policy Transactions",
    ];
    let hit = 0;
    for (const m of markers) if (t.includes(m)) hit++;
    return hit >= 2 || (t.includes("My Worklist") && t.length > 200);
  };

  const cleanCoverageSubtabBlob = (val) => {
    const raw = s(val || "").replace(/\r/g, "").trim();
    if (!raw) return "";
    if (looksLikeUiDump(raw)) return "";
    return raw;
  };

  const cleanAllCoveragesBlob = (val) => {
    let raw = s(val || "").replace(/\r/g, "").trim();
    if (!raw) return "";

    const hasCoverageShape = /Primary Coverages|Deductibles|All Perils|Dwelling\s*\nAmount/i.test(raw);
    if (looksLikeUiDump(raw) && !hasCoverageShape) return "";

    const idx = raw.indexOf("Primary Coverages");
    if (idx >= 0) raw = raw.slice(idx).trim();

    return raw;
  };

  // ===== FORMATTING (NO BLANK LINES) =====
  const formatStatus = (val) => {
    const raw = clean(val);
    if (!raw) return "";
    let m = raw.match(/^(.+?)\s*\(\s*Expiration\s*:\s*([^)]+?)\s*\)\s*$/i);
    if (m) {
      const st = m[1].trim();
      const exp = m[2].trim();
      return compactMultiline(`${st}\n(Expiration:\n${exp})`);
    }
    if (/Expiration\s*:/i.test(raw)) {
      let t = raw.replace(/\s*\(\s*Expiration\s*:\s*/i, "\n(Expiration:\n");
      return compactMultiline(t);
    }
    return raw;
  };

  const formatDiscounts = (val) => {
    let t = clean(val);
    if (!t) return "";
    t = normNL(t).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    t = t.replace(/,\s*/g, "\n");
    t = t.replace(/(\bDiscount\b)(?=\s+[A-Z])/g, "$1\n");
    return compactMultiline(t);
  };

  const formatProtectionPairs = (val) => {
    let t = s(val || "");
    t = stripLeadingLabel(t, "Dwelling Protection");
    t = t.replace(/\u00A0/g, " ");
    t = normNL(t).trim();
    if (!t) return "";

    const labels = ["Theft Protection", "Fire Protection", "Water Protection", "FORTIFIED Home"];
    const labelSet = new Set(labels.map(x => x.toLowerCase()));

    for (const lab of labels) {
      const esc = lab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp(esc, "g"), `\n${lab}\n`);
    }

    t = t.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{2,}/g, "\n").trim();
    const parts = t.split("\n").map(x => x.trim()).filter(Boolean);
    if (!parts.length) return "";

    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const pl = p.toLowerCase();

      if (labelSet.has(pl)) {
        const nxt = parts[i + 1] || "";
        const nxtIsLabel = nxt && labelSet.has(nxt.toLowerCase());
        if (nxt && !nxtIsLabel) { out.push(`${p}: ${nxt}`); i++; }
        else out.push(p);
      } else {
        const nxt = parts[i + 1] || "";
        if (nxt && !labelSet.has(nxt.toLowerCase())) { out.push(`${p}: ${nxt}`); i++; }
        else out.push(p);
      }
    }

    return compactMultiline(out.join("\n"));
  };

  const isValueLike = (x) => {
    const t = (x || "").trim();
    if (!t) return false;
    if (/[$%]/.test(t)) return true;
    if (/\d/.test(t)) return true;
    if (/\bmonths?\b/i.test(t)) return true;
    if (/\b(replacement|actual|value|certified|device|mitigation|included|yes|no|next gen|acv|rcv)\b/i.test(t)) return true;
    return false;
  };

  const formatAllCoveragesFieldValue = (val) => {
    let raw = cleanAllCoveragesBlob(s(val || ""));
    if (!raw) return "";

    const lines = normNL(raw).split("\n").map(x => x.trim()).filter(Boolean);
    if (!lines.length) return "";

    const out = [];
    for (let i = 0; i < lines.length; ) {
      const cur = lines[i];
      const next = lines[i + 1];

      if (next != null && isValueLike(next)) { out.push(`${cur}: ${next}`); i += 2; continue; }
      out.push(cur);
      i += 1;
    }

    return compactMultiline(out.join("\n"));
  };
  // =========================================

  const cleanDwellingField = (key, val) => {
    let t = s(val);

    if (key === "RiskAddress") t = stripLeadingLabel(t, "Risk Address");
    if (key === "County") t = stripLeadingLabel(t, "County");
    if (key === "YearBuilt") t = stripLeadingLabel(t, "Year Built");
    if (key === "SquareFeet") t = stripLeadingLabel(t, "Square Feet");
    if (key === "Occupancy") t = stripLeadingLabel(t, "Occupancy");
    if (key === "ProtectionClassCode") t = stripLeadingLabel(t, "Code");

    if (key === "DwellingProtection_AllInOneCell") return formatProtectionPairs(t);

    return clean(t);
  };

  const cleanMortgageeTable = (txt) => {
    let t = s(txt || "");
    if (!t) return "";
    t = t.replace(/Name\s*\|\s*Address\s*\|\s*Interest\s*Type.*Loan\s*Number.*Who\s*Pays\?/gi, "");
    t = t.replace(/NameName\s*\|\s*AddressAddress\s*\|\s*Interest\s*TypeInterest\s*Type.*Loan\s*NumberLoan\s*Number.*Who\s*Pays\?Who\s*Pays\?/gi, "");

    const lines = normNL(t).split("\n").map(x => x.trim()).filter(Boolean);
    const out = [];

    for (const line of lines) {
      const l = line.toLowerCase();
      const headerish =
        (l.includes("name") && l.includes("address") && l.includes("interest type") && l.includes("loan number") && l.includes("who pays")) ||
        (l.includes("namename") && l.includes("addressaddress") && l.includes("interest typeinterest type") && l.includes("loan numberloan number") && l.includes("who pays?who pays"));
      if (headerish) continue;
      out.push(line);
    }
    return out.join("\n").trim();
  };

  const findPolicyNumber = (home, covWrap, quoteWrap) => {
    return (
      clean(home?.Policy_Info?.PolicyNumber) ||
      clean(home?.PolicyNumber) ||
      clean(covWrap?.policyNumber) ||
      clean(quoteWrap?.policyNumber) ||
      ""
    );
  };

  const buildToken = (pn, quoteWrap) => `${pn || ""}:${String(quoteWrap?.ts || "")}`;

  // ===== *N/A FOR EMPTY CELLS =====
  const NA_TOKEN = "*N/A";
  const isEmptyVal = (v) => {
    if (v == null) return true;
    if (typeof v === "string") return v.trim() === "";
    return false;
  };
  const fillNADeep = (v) => {
    if (Array.isArray(v)) return v.map(fillNADeep);
    if (isObj(v)) {
      const out = {};
      for (const k of Object.keys(v)) out[k] = fillNADeep(v[k]);
      return out;
    }
    return isEmptyVal(v) ? NA_TOKEN : v;
  };
  const ensureStrKey = (obj, key) => {
    if (!isObj(obj)) return;
    if (!(key in obj) || isEmptyVal(obj[key])) obj[key] = NA_TOKEN;
  };
  const usefulText = (v) => {
    const t = clean(v);
    return !!t && t !== NA_TOKEN;
  };
  const anyUseful = (obj, keys) => {
    if (!isObj(obj)) return false;
    return keys.some((key) => usefulText(obj[key]));
  };
  const allCoveragesUseful = (cov) => {
    if (!isObj(cov)) return false;
    const t = clean(cov["Coverages.AllCoverages"]);
    return t.length > 30 && /Primary Coverages|Deductibles|Dwelling|Personal Property|All Perils/i.test(t);
  };
  const missingPayloadParts = (out) => {
    const missing = [];

    if (!anyUseful(out.Policy_Info, [
      "Account Number",
      "Primary Named Insured",
      "Effective Date",
      "Expiration Date",
    ])) missing.push("Policy_Info");

    if (!anyUseful(out.Dwelling, [
      "RiskAddress",
      "County",
      "YearBuilt",
      "SquareFeet",
      "Occupancy",
      "DwellingProtection_AllInOneCell",
    ])) missing.push("Dwelling");

    if (!anyUseful(out.Eligibility, [
      "DogsAtResidence",
      "MortgageeTable",
    ])) missing.push("Eligibility");

    if (!allCoveragesUseful(out.Coverages)) missing.push("Coverages.AllCoverages");

    if (!anyUseful(out.Quote, [
      "Quote.TotalPremium",
      "Quote.TotalCost",
      "Quote.FeesTaxesAndSurcharges",
    ])) missing.push("Quote");

    return missing;
  };
  // =================================

  const buildPayload = () => {
    const home = asObj(lsGet(CFG.kHome));
    const covWrap = asObj(lsGet(CFG.kCov));
    const quoteWrap = asObj(lsGet(CFG.kQuote));

    const pn = findPolicyNumber(home, covWrap, quoteWrap);
    if (!pn) return { ok: false, pn: "", error: `Missing policyNumber (need ${CFG.kHome})` };

    const covPn = clean(covWrap.policyNumber);
    const quotePn = clean(quoteWrap.policyNumber);

    const coveragesData = asObj(covWrap.data || {});
    const quoteData = asObj(quoteWrap.data || {});

    let out = asObj(home);

    out.meta = (out.meta && isObj(out.meta)) ? out.meta : {};
    out.meta.sent_at = new Date().toISOString();
    out.meta.from = "tm_step5_home_v1.0.13";
    out.meta.stage = clean(lsGet(CFG.kStage));
    out.policyNumber = pn;
    out.PolicyNumber = pn;

    // Policy_Info
    if (out.Policy_Info && isObj(out.Policy_Info)) {
      const p = { ...out.Policy_Info };
      if ("Status" in p) p.Status = formatStatus(p.Status);
      if ("StatusRaw" in p) p.StatusRaw = formatStatus(p.StatusRaw);
      out.Policy_Info = p;
    } else {
      out.Policy_Info = {};
    }
    ensureStrKey(out.Policy_Info, "Status");
    ensureStrKey(out.Policy_Info, "StatusRaw");
    out.Policy_Info.PolicyNumber = pn;

    // Dwelling
    if (out.Dwelling && isObj(out.Dwelling)) {
      const d = out.Dwelling;
      const dd = {};
      for (const k of Object.keys(d)) dd[k] = cleanDwellingField(k, d[k]);
      out.Dwelling = dd;
    } else {
      out.Dwelling = {};
    }
    ensureStrKey(out.Dwelling, "DwellingProtection_AllInOneCell");

    // Eligibility
    if (out.Eligibility && isObj(out.Eligibility)) {
      const e = out.Eligibility;
      out.Eligibility = { ...e, MortgageeTable: cleanMortgageeTable(e.MortgageeTable) };
    } else {
      out.Eligibility = {};
    }
    ensureStrKey(out.Eligibility, "MortgageeTable");

    // Coverages
    if (covPn && covPn !== pn) {
      out.meta.coverages_mismatch = { expected: pn, got: covPn };
      out.Coverages = out.Coverages && isObj(out.Coverages) ? out.Coverages : {};
    } else {
      const cov = { ...coveragesData };
      cov["Coverages.AllCoverages"] = formatAllCoveragesFieldValue(cov["Coverages.AllCoverages"]);
      cov["Coverages.OptionalCoverages_All"] = cleanCoverageSubtabBlob(cov["Coverages.OptionalCoverages_All"]);
      cov["Coverages.DetailedCoverages_All"] = cleanCoverageSubtabBlob(cov["Coverages.DetailedCoverages_All"]);
      cov["Coverages.ExclusionsAndConditions_All"] = cleanCoverageSubtabBlob(cov["Coverages.ExclusionsAndConditions_All"]);
      out.Coverages = cov;
    }
    // ensure keys exist for headers
    ensureStrKey(out.Coverages, "Coverages.AllCoverages");
    ensureStrKey(out.Coverages, "Coverages.OptionalCoverages_All");
    ensureStrKey(out.Coverages, "Coverages.DetailedCoverages_All");
    ensureStrKey(out.Coverages, "Coverages.ExclusionsAndConditions_All");

    // Quote
    if (quotePn && quotePn !== pn) {
      out.meta.quote_mismatch = { expected: pn, got: quotePn };
      out.Quote = out.Quote && isObj(out.Quote) ? out.Quote : {};
    } else {
      const q = asObj(quoteData);
      if (typeof q["Quote.Discounts"] === "string") q["Quote.Discounts"] = formatDiscounts(q["Quote.Discounts"]);
      if (typeof q["Discounts"] === "string") q["Discounts"] = formatDiscounts(q["Discounts"]);
      if (isObj(q.Quote) && typeof q.Quote.Discounts === "string") q.Quote.Discounts = formatDiscounts(q.Quote.Discounts);
      out.Quote = q;
    }
    // header you care about is Quote.Quote.Discounts -> usually out.Quote.Discounts
    ensureStrKey(out.Quote, "Discounts");

    out.meta.has_coverages = !!out.Coverages;
    out.meta.has_quote = !!out.Quote;

    const missing = missingPayloadParts(out);
    if (missing.length) {
      out.meta.incomplete_missing = missing;
      return { ok: false, pn, error: `Incomplete payload; not posting. Missing: ${missing.join(", ")}` };
    }

    // ✅ FINAL PASS: turn any remaining empty leaf values into *N/A
    out = fillNADeep(out);

    return { ok: true, pn, token: buildToken(pn, quoteWrap), payload: out };
  };

  const postOnce = (payload) => new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: "POST",
      url: CFG.webappUrl,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      data: JSON.stringify(payload),
      timeout: CFG.postTimeoutMs,
      onload: (r) => {
        const status = Number(r.status || 0);
        const txt = String(r.responseText || "");
        resolve({ ok: status >= 200 && status < 300, status, txt });
      },
      onerror: () => resolve({ ok: false, status: 0, txt: "onerror" }),
      ontimeout: () => resolve({ ok: false, status: 0, txt: "timeout" }),
    });
  });

  let prevReady = false;
  let readySeenAt = 0;
  let firedThisVisit = false;
  let running = false;
  let lastFireAt = 0;

  const isReady = () => clean(lsGet(CFG.kStage)) === "quote_done";

  async function fire(manual = false) {
    if (running) return;
    if (getInflight()) return;

    running = true;
    setInflight(true);
    firedThisVisit = true;

    try {
      UI.setState("RUNNING");

      const built = buildPayload();
      UI.log(`Payload build ok=${built.ok} policy=${built.pn || "?"}`);

      if (!built.ok) {
        UI.log(`Build failed: ${built.error}`);
        clearFailsafe();
        firedThisVisit = false;
        readySeenAt = Date.now();
        return;
      }

      const pn = built.pn;
      const token = built.token || "";

      // HARD gates
      if (!manual) {
        if (alreadyPostedLast(pn)) {
          UI.log(`SKIP: last-policy gate pn=${pn}`);
          clearFailsafe();
          return;
        }
        if (isDeduped(pn)) {
          UI.log(`SKIP: deduped pn=${pn}`);
          clearFailsafe();
          return;
        }
        const lastTok = clean(getSessionToken());
        if (token && lastTok && token === lastTok) {
          UI.log(`SKIP: session-token gate token=${token}`);
          clearFailsafe();
          return;
        }
      }

      UI.log("POST ONCE…");
      const res = await postOnce(built.payload);

      UI.log(`POST status=${res.status} ok=${res.ok} resp="${(res.txt || "").slice(0, 160).replace(/\s+/g, " ").trim()}"`);

      if (!res.ok) {
        UI.log("POST failed; staying on this page so it can retry instead of advancing with missing data.");
        clearFailsafe();
        firedThisVisit = false;
        readySeenAt = Date.now();
        return;
      }

      if (res.ok) {
        markDeduped(pn);
        markPostedLast(pn);
        if (token) setSessionToken(token);
      }

      // ✅ HARD click risk
      UI.log("Risk click: start…");
      const clicked = await clickRiskWithWait("after-post");
      riskClickedThisVisit = riskClickedThisVisit || !!clicked;

      if (!clicked) {
        UI.log("Risk click: not found yet — retry #2…");
        await sleep(700);
        const clicked2 = await clickRiskWithWait("after-post-retry2");
        riskClickedThisVisit = riskClickedThisVisit || !!clicked2;

        UI.log(clicked2 ? "Risk click: done ✅" : "Risk click: still failing ❌ (failsafe will force)");
      } else {
        UI.log("Risk click: done ✅");
      }

    } finally {
      lastFireAt = Date.now();
      UI.setState(stopped ? "STOPPED" : "WATCHING");
      running = false;
      setInflight(false);
    }
  }

  function tick(force = false) {
    if (stopped) {
      UI.setState("STOPPED");
      prevReady = false;
      readySeenAt = 0;
      firedThisVisit = false;
      clearFailsafe();
      riskClickedThisVisit = false;
      setInflight(false);
      return;
    }

    UI.setState("WATCHING");

    const ready = isReady();

    if (!ready) {
      prevReady = false;
      readySeenAt = 0;
      firedThisVisit = false;
      clearFailsafe();
      riskClickedThisVisit = false;
      return;
    }

    if (!prevReady) {
      prevReady = true;
      readySeenAt = Date.now();
      firedThisVisit = false;
      UI.log("Ready detected (stage=quote_done) — waiting stable…");
      armFailsafe();
    }

    if (firedThisVisit && !force) return;
    if (isBusy()) return;
    if (Date.now() - readySeenAt < CFG.stableMs) return;
    if (Date.now() - lastFireAt < CFG.cooldownMs) return;

    fire(false);
  }

  UI.log("Loaded. Auto-arming… (stage=quote_done → complete payload → post once → Risk click)");
  tick(true);
  setInterval(() => tick(false), CFG.tickMs);
})();
