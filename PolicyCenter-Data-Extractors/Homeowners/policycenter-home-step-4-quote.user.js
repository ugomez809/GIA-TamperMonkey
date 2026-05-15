// ==UserScript==
// @name         PolicyCenter — Step 4: Quote Extractor (ALWAYS ON)
// @namespace    tm.pc.step4.quote
// @version      1.1.0
// @description  ALWAYS ON. Coverages-done gate + Quote visible → run ONCE → then wait until Quote is NOT visible before allowing another run. STOP is session-only; reload re-arms. Split Discounts vs Surcharges and capture Reconstruction Cost block.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-4-quote.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-4-quote.user.js
// ==/UserScript==

(() => {
  "use strict";
  if (window.top !== window.self) return;

  /******************************************************************
   * CONFIG (localStorage keys)
   ******************************************************************/
  const LS = {
    STAGE: "tm_pc_stage_v1",
    COVERAGES_OUT: "tm_pc_coverages_v1",
    OUT: "tm_pc_quote_v1",
    READY: "tm_pc_quote_ready_v1",
  };

  /******************************************************************
   * SELECTORS (Pricing / Quote)
   ******************************************************************/
  const SEL_PRICING_ROOT = "#PolicyFile_Pricing-PolicyFile_PricingScreen";
  const SEL_QUOTE_SUMMARY =
    "#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV";

  // Totals
  const SEL_TOTAL_PREMIUM =
    "#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV-TotalPremium_Input";
  const SEL_FEES_TAXES =
    "#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV-FeesTaxesAndSurcharges_Input";
  const SEL_TOTAL_COST =
    "#PolicyFile_Pricing-PolicyFile_PricingScreen-PolicyFile_Quote_SummaryDV-TotalCost_Input";

  // Discounts/Surcharges container
  const SEL_DS_BLOCK =
    '[id*="PolicyFile_Quote_SummaryDV-DiscountInputSet_Ext-QuoteAppliedDiscountDetails_ExtInputSet"]';

  // ✅ DIRECT LIST READ (your HTML)
  const SEL_DISCOUNT_ITEMS =
    `${SEL_DS_BLOCK} [id*="DiscountModifiers-"][id$="-mod"] .gw-value-readonly-wrapper, ` +
    `${SEL_DS_BLOCK} [id*="DiscountModifiers-"][id$="-mod_Input"] .gw-value-readonly-wrapper`;

  const SEL_SURCHARGE_ITEMS =
    `${SEL_DS_BLOCK} [id*="SurchargeModifiers-"][id$="-mod"] .gw-value-readonly-wrapper, ` +
    `${SEL_DS_BLOCK} [id*="SurchargeModifiers-"][id$="-mod_Input"] .gw-value-readonly-wrapper`;

  const SEL_INFOBAR_POLICY =
    "#PolicyFile-PolicyFileMenuInfoBar-PolicyNumber .gw-infoValue";

  const TAB_LABEL_FORMS = "Forms";

  const LOAD_WAIT_MS = 5200;
  const QUOTE_WAIT_MS = 5000;

  /******************************************************************
   * UI
   ******************************************************************/
  const UI = (() => {
    const host = document.createElement("div");
    host.id = "tm_pc_step4_host";
    host.style.cssText = [
      "position:fixed",
      "right:1010px",
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
    title.textContent = "PC Step4 — Quote";
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
    mini.textContent = "PC4";
    mini.title = "Click to show/hide";
    mini.style.cssText = [
      "position:fixed",
      "right:1010px",
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
   * HELPERS (iframe-safe)
   ******************************************************************/
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());

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

  const isVisible = (el) => {
    if (!el) return false;
    try {
      const w = el.ownerDocument?.defaultView || window;
      const cs = w.getComputedStyle(el);
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
    const w = el.ownerDocument?.defaultView || window;
    const opts = { bubbles: true, cancelable: true, composed: true, view: w };

    [
      () => el.dispatchEvent(new w.PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 })),
      () => el.dispatchEvent(new w.MouseEvent("mousedown", { ...opts, buttons: 1 })),
      () => el.dispatchEvent(new w.PointerEvent("pointerup",   { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 })),
      () => el.dispatchEvent(new w.MouseEvent("mouseup",   { ...opts, buttons: 0 })),
      () => el.dispatchEvent(new w.MouseEvent("click",     { ...opts, buttons: 0 })),
    ].forEach(fn => { try { fn(); } catch {} });

    return true;
  };

  const writeLS = (key, obj) => localStorage.setItem(key, JSON.stringify(obj));

  const fix = (v) => {
    v = clean(v);
    if (v === "AddressAddress" || v === "SelectedSelected") return "";
    if (v === "-" || v === "—") return "";
    return v;
  };

  /******************************************************************
   * MENU CLICK (iframe-safe)
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

  const clickTabAndWait = async (label) => {
    const el = await waitFor(() => {
      const m = findMenuItem(label);
      return (m && isVisible(m)) ? m : null;
    }, { timeout: 12000 });

    if (!el) return { ok: false, why: `tab not found: ${label}` };

    UI.log(`Clicking tab: ${label}`);
    realClick(el);

    UI.log(`Waiting ${LOAD_WAIT_MS}ms for load...`);
    await sleep(LOAD_WAIT_MS);

    return { ok: true };
  };

  /******************************************************************
   * TOTALS (selector + label fallback)
   ******************************************************************/
  function getWidgetValueFromRoot(root) {
    if (!root) return "";
    const wrappers = Array.from(root.querySelectorAll(".gw-value-readonly-wrapper"))
      .map(x => clean(x.textContent))
      .filter(Boolean);
    if (wrappers.length) {
      const uniq = [];
      for (const w of wrappers) if (!uniq.includes(w)) uniq.push(w);
      return uniq.join("\n");
    }
    const vw = root.querySelector(".gw-vw--value");
    if (vw) {
      const t = clean(vw.textContent);
      if (t) return t;
    }
    const inp = root.querySelector("input,textarea,select");
    if (inp) {
      const tag = inp.tagName.toLowerCase();
      const type = (inp.getAttribute("type") || "").toLowerCase();
      if (tag === "select") {
        const opt = inp.selectedOptions && inp.selectedOptions[0];
        return clean(opt ? opt.textContent : inp.value);
      }
      if (type === "checkbox") return inp.checked ? "Yes" : "No";
      return clean(inp.value || inp.getAttribute("value") || "");
    }
    return clean(root.textContent);
  }

  const getWidgetValue = (sel) => {
    const root = qAny(sel);
    if (!root) return "";
    return getWidgetValueFromRoot(root);
  };

  function findValueByLabelText(root, labelRegex) {
    if (!root) return "";
    const labels = Array.from(root.querySelectorAll("div.gw-label, label, span.gw-label"))
      .map(el => ({ el, t: clean(el.textContent) }))
      .filter(x => x.t && labelRegex.test(x.t));

    for (const { el: lab } of labels) {
      const row =
        lab.closest('[role="group"], .gw-InputWidget, .gw-InputColumnWidget, .gw-DetailViewWidget, .gw-ValueWidget, .gw-RowWidget')
        || lab.parentElement;

      if (!row) continue;

      const vEl =
        row.querySelector(".gw-value-readonly-wrapper") ||
        row.querySelector(".gw-value.gw-infoValue") ||
        row.querySelector(".gw-infoValue") ||
        row.querySelector(".gw-value") ||
        row.querySelector("input,select,textarea");

      if (vEl) {
        if (vEl.classList && vEl.classList.contains("gw-value-readonly-wrapper")) return clean(vEl.textContent);
        if (vEl.tagName && vEl.tagName.toLowerCase() === "select") {
          const opt = vEl.selectedOptions && vEl.selectedOptions[0];
          return clean(opt ? opt.textContent : vEl.value);
        }
        if (vEl.tagName && vEl.tagName.toLowerCase() === "input") {
          const type = (vEl.getAttribute("type") || "").toLowerCase();
          if (type === "checkbox") return vEl.checked ? "Yes" : "No";
          return clean(vEl.value || vEl.getAttribute("value") || "");
        }
        return clean(vEl.textContent);
      }

      const rowText = String(row.textContent || "");
      const lines = rowText.split("\n").map(s => clean(s)).filter(Boolean);
      if (lines.length >= 2) return clean(lines.slice(1).join(" "));
    }
    return "";
  }

  function readTotalsWithFallback() {
    const quoteSummary = qAny(SEL_QUOTE_SUMMARY) || qAny(SEL_PRICING_ROOT);

    const totalPremiumSel = fix(getWidgetValue(SEL_TOTAL_PREMIUM));
    const feesTaxesSel    = fix(getWidgetValue(SEL_FEES_TAXES));
    const totalCostSel    = fix(getWidgetValue(SEL_TOTAL_COST));

    const totalPremium = totalPremiumSel || fix(findValueByLabelText(quoteSummary, /^total premium$/i));
    const totalCost    = totalCostSel    || fix(findValueByLabelText(quoteSummary, /^total cost$/i));

    const feesTaxes =
      feesTaxesSel ||
      fix(findValueByLabelText(quoteSummary, /^fees,\s*taxes\s*and\s*surcharges$/i)) ||
      fix(findValueByLabelText(quoteSummary, /fees.*taxes.*surcharges/i));

    return { totalPremium, feesTaxes, totalCost };
  }

  /******************************************************************
   * ✅ DISCOUNTS / SURCHARGES (direct list read)
   ******************************************************************/
  function readDiscountsAndSurchargesSplit() {
    const block = qAny(SEL_DS_BLOCK);
    if (!block) return { discounts: "", surcharges: "" };

    const discounts = qAnyAll(SEL_DISCOUNT_ITEMS)
      .filter(isVisible)
      .map(el => clean(el.textContent))
      .filter(Boolean);

    const surcharges = qAnyAll(SEL_SURCHARGE_ITEMS)
      .filter(isVisible)
      .map(el => clean(el.textContent))
      .filter(Boolean);

    // de-dupe keep order
    const dedup = (arr) => {
      const out = [];
      for (const v of arr) {
        const s = clean(v);
        if (!s) continue;
        if (s === "-" || s === "—") continue;
        if (!out.includes(s)) out.push(s);
      }
      return out.join("\n");
    };

    // If there are zero items, check if "NoDiscounts" / "NoSurcharges" placeholders are present
    // (we keep empty string as you want)
    return {
      discounts: dedup(discounts),
      surcharges: dedup(surcharges),
    };
  }

  /******************************************************************
   * Reconstruction Cost block (Homeowners)
   ******************************************************************/
  function readReconstructionCostBlock() {
    const labels = qAnyAll("div.gw-label")
      .map(el => ({ el, t: clean(el.textContent) }))
      .filter(x => x.t && /^reconstruction cost$/i.test(x.t));

    for (const { el } of labels) {
      const col = el.closest("div.gw-InputColumnWidget") || el.closest('[role="group"]');
      if (!col) continue;

      const allLabTxt = Array.from(col.querySelectorAll("div.gw-label"))
        .map(x => clean(x.textContent))
        .filter(Boolean);

      const note = allLabTxt.find(t => /\(dwelling coverage is/i.test(t) && /reconstruction cost\)/i.test(t)) || "";
      const costWrap = col.querySelector('[id*="ReconstructionCost"] .gw-value-readonly-wrapper');
      const cost = clean(costWrap?.textContent || "");

      if (!cost && !note) continue;

      const outLines = [];
      outLines.push("Reconstruction Cost");
      if (cost) outLines.push(cost);
      if (note) outLines.push(note);

      return clean(outLines.join("\n"));
    }

    return "";
  }

  /******************************************************************
   * VISIBILITY DETECTION
   ******************************************************************/
  const titleLooksLikeQuote = () => {
    const titles = qAnyAll(".gw-TitleBar--title, .gw-TitleBarWidget .gw-TitleBar--title").filter(isVisible);
    return !!titles.find(x => /quote/i.test(clean(x.textContent)));
  };

  const isQuoteVisible = () => {
    const pricingRoot = qAny(SEL_PRICING_ROOT);
    if (pricingRoot && isVisible(pricingRoot)) return true;

    if (titleLooksLikeQuote()) return true;

    const tp = qAny(SEL_TOTAL_PREMIUM);
    if (tp && isVisible(tp)) return true;

    return false;
  };

  const readPolicyNumber = () => clean(qAny(SEL_INFOBAR_POLICY)?.textContent);
  const lsGet = (key) => {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  };
  const readJSON = (key, fallback = {}) => {
    try {
      const raw = lsGet(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  };
  const canAutoRunQuote = () => {
    const stage = clean(lsGet(LS.STAGE));
    if (stage !== "coverages_done") return { ok: false, why: `${LS.STAGE}=${stage || "(blank)"}` };

    const cov = readJSON(LS.COVERAGES_OUT, {});
    const currentPolicy = readPolicyNumber();
    const covPolicy = clean(cov.policyNumber);
    if (currentPolicy && covPolicy && currentPolicy !== covPolicy) {
      return { ok: false, why: `coverages policy mismatch ${covPolicy} != ${currentPolicy}` };
    }

    return { ok: true, why: "coverages_done" };
  };

  /******************************************************************
   * RUNNER (run once per visibility)
   ******************************************************************/
  let armed = false;
  let busy = false;
  let pollTimer = null;
  let ranThisVisibility = false;
  let lastGateLogAt = 0;

  const setArmedUI = (v) => {
    armed = v;
    UI.btnStart.disabled = v;
    UI.btnStop.disabled = !v;
    UI.btnStop.style.opacity = v ? "1" : "0.55";
    UI.btnStart.style.opacity = v ? "0.55" : "1";
  };

  const extractAndSave = async (why) => {
    if (busy) return;
    busy = true;

    try {
      UI.setStatus("RUNNING");
      UI.log(`Run start (${why})`);

      if (why !== "FORCE_RUN") {
        const gate = canAutoRunQuote();
        if (!gate.ok) {
          UI.log(`Skip: waiting for Coverages done (${gate.why})`);
          UI.setStatus("ARMED");
          return;
        }
      }

      const ok = await waitFor(() => isQuoteVisible() ? true : null, { timeout: 12000 });
      if (!ok) {
        UI.log("Quote not visible anymore. Back to waiting.");
        UI.setStatus("ARMED");
        return;
      }

      UI.log(`Quote detected. Waiting ${QUOTE_WAIT_MS}ms...`);
      await sleep(QUOTE_WAIT_MS);

      const { totalPremium, feesTaxes, totalCost } = readTotalsWithFallback();
      const { discounts, surcharges } = readDiscountsAndSurchargesSplit();
      const reconstructionCostBlock = fix(readReconstructionCostBlock());

      const data = {
        "Quote.TotalPremium": fix(totalPremium),
        "Quote.FeesTaxesAndSurcharges": fix(feesTaxes),
        "Quote.TotalCost": fix(totalCost),

        "Quote.Discounts": fix(discounts),
        "Quote.Surcharges": fix(surcharges),

        "Quote.ReconstructionCost_Block": reconstructionCostBlock,
      };

      const payload = {
        ok: true,
        ts: Date.now(),
        url: location.href,
        tab: "Quote",
        policyNumber: readPolicyNumber() || "",
        data,
      };

      writeLS(LS.OUT, payload);
      writeLS(LS.READY, { ok: true, ts: payload.ts, tab: "Quote", policyNumber: payload.policyNumber });
      localStorage.setItem(LS.STAGE, "quote_done");

      UI.log("Saved to localStorage:");
      UI.log(`- ${LS.OUT}`);
      UI.log(`- ${LS.READY}`);
      UI.log(`- ${LS.STAGE} = quote_done`);

      UI.log(`Discount lines: ${data["Quote.Discounts"] ? data["Quote.Discounts"].split("\n").length : 0}`);
      UI.log(`Surcharge lines: ${data["Quote.Surcharges"] ? data["Quote.Surcharges"].split("\n").length : 0}`);

      UI.log("Clicking Forms...");
      await clickTabAndWait(TAB_LABEL_FORMS);

      UI.setStatus("ARMED");
      UI.log("Run complete. Waiting until Quote is NOT visible to allow next run...");
    } finally {
      busy = false;
    }
  };

  const startPolling = () => {
    if (armed) return;
    setArmedUI(true);
    UI.setStatus("ARMED");
    UI.log("Loaded. Double-click title to collapse. Auto-arming...");
    UI.log("ARMED. Rule: Quote visible → run once → wait until not visible.");

    pollTimer = window.setInterval(() => {
      if (!armed || busy) return;

      const visible = isQuoteVisible();

      if (!visible && ranThisVisibility) {
        ranThisVisibility = false;
        UI.log("Quote not visible anymore. Gate reset ✅");
      }

      if (visible && !ranThisVisibility) {
        const gate = canAutoRunQuote();
        if (!gate.ok) {
          const now = Date.now();
          if (now - lastGateLogAt > 3000) {
            UI.log(`Quote visible, waiting for Coverages done (${gate.why})`);
            lastGateLogAt = now;
          }
          return;
        }

        ranThisVisibility = true;
        extractAndSave("QUOTE_VISIBLE");
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

  UI.btnStart.addEventListener("click", () => startPolling());
  UI.btnStop.addEventListener("click", () => stopPolling());
  UI.btnForce.addEventListener("click", () => extractAndSave("FORCE_RUN"));

  startPolling();
})();
