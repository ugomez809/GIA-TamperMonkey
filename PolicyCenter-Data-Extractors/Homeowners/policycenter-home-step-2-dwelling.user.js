// ==UserScript==
// @name         PolicyCenter — Step 2: Dwelling Extractor (Details + Eligibility + Mortgagee) (ALWAYS ON)
// @namespace    tm.pc.step2.dwelling
// @version      1.0.7
// @description  ALWAYS ON. Auto-arms on load (STOP is session-only). Rule: EVERY time Dwelling header becomes visible → run ONCE → wait until Dwelling NOT visible before allowing another run. If run errors, gate clears to auto-retry while still on Dwelling. When Dwelling header is visible: wait 5s → ensure Details tab loaded → extract Dwelling fields + Details blocks (HomeShare/HVAC/Plumbing/Roofing) → click Eligibility (wait 2s) → extract Dogs row → click Additional Interests (wait 2s) → extract Mortgagee table → save → click Coverages → signal Step3.
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-2-dwelling.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-home-step-2-dwelling.user.js
// ==/UserScript==

(() => {
  "use strict";
  if (window.top !== window.self) return;

  /******************************************************************
   * KEYS
   ******************************************************************/
  const LS = {
    PAYLOAD: "tm_pc_home_payload_v1",
    OUT: "tm_pc_home_dwelling_v1",
    READY: "tm_pc_home_dwelling_ready_v1",
    STAGE: "tm_pc_home_stage_v1",
    STEP3_GO: "tm_pc_home_step3_go_v1",
  };

  /******************************************************************
   * SELECTORS
   ******************************************************************/
  const SEL = {
    TITLE_ANY: ".gw-TitleBar--title",

    INFOBAR_POLICY: "#PolicyFile-PolicyFileMenuInfoBar-PolicyNumber .gw-infoValue",
    INFOBAR_ACCOUNT: "#PolicyFile-PolicyFileMenuInfoBar-AccountNumber .gw-infoValue",

    DWELLING_ROOT: "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen",

    DW_RISK_ADDRESS:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-HODwellingLocationHOEInputSet-HODwellingLocationInput_Input",
    DW_COUNTY:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-countyName_Input",
    DW_PPC:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-ppcCode_Input",
    DW_FIRELINE_LABEL: "#l--7",
    DW_YEAR_BUILT:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingConstructionDetailsHOEDV-YearBuilt_Input",
    DW_SQFT:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingConstructionDetailsHOEDV-ApproxSqFoot_Input",
    DW_OCCUPANCY:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingConstructionDetailsHOEDV-DwellingOccupancy_Input",
    DW_PROTECTION_BLOCK:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingConstructionDetailsHOEDV-7",

    SUBTAB_ELIGIBILITY:
      'div.gw-CardTabWidget.gw-styleTag--CardTabsWidget:nth-of-type(2) > div[role="tab"].gw-action--inner.gw-hasDivider',
    SUBTAB_DETAILS:
      'div.gw-CardTabWidget.gw-styleTag--CardTabsWidget:nth-of-type(1) > div[role="tab"].gw-action--inner.gw-hasDivider',
    SUBTAB_ADDL_INT:
      'div.gw-CardTabWidget.gw-styleTag--CardTabsWidget:nth-of-type(3) > div[role="tab"].gw-action--inner.gw-hasDivider',

    ELIG_TABLE:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingSingleHOEPanelSet-QuestionSetsDV-0-QuestionSetLV table.gw-ListViewWidget--table",

    MORTGAGEE_BLOCK:
      "#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingSingleHOEPanelSet-MortgageeDetails_ExtDV-0",
  };

  const CFG = {
    POLL_MS: 450,
    LOAD_WAIT_MS: 5200,

    START_ON_DWELLING_WAIT_MS: 5000,
    BETWEEN_SUBTAB_WAIT_MS: 2000,

    WAIT_TITLE_TIMEOUT_MS: 25000,
    WAIT_BLOCK_TIMEOUT_MS: 20000,

    DETAILS_READY_TIMEOUT_MS: 15000,
  };

  /******************************************************************
   * UI
   ******************************************************************/
  const UI = (() => {
    const RIGHT_NEXT_TO_STEP1 = 346;

    const host = document.createElement("div");
    host.id = "tm_pc_step2_host";
    host.style.cssText = [
      "position:fixed",
      `right:${RIGHT_NEXT_TO_STEP1}px`,
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
    title.textContent = "PC Step2 — Dwelling";
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
    mini.textContent = "PC2";
    mini.title = "Click to show/hide";
    mini.style.cssText = [
      "position:fixed",
      `right:${RIGHT_NEXT_TO_STEP1}px`,
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
    };

    const setStatus = (s) => {
      status.textContent = s;
    };

    return { btnStart, btnStop, btnForce, log, setStatus };
  })();

  /******************************************************************
   * HELPERS
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
      try {
        out.push(...Array.from(d.querySelectorAll(sel)));
      } catch {}
    }
    return out;
  }

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
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {}
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    try {
      const seq = [
        () =>
          el.dispatchEvent(
            new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 1 })
          ),
        () => el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 })),
        () =>
          el.dispatchEvent(
            new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: 0 })
          ),
        () => el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 })),
        () => el.dispatchEvent(new MouseEvent("click", { ...opts, buttons: 0 })),
      ];
      seq.forEach((fn) => fn());
      return true;
    } catch {
      try {
        el.click();
        return true;
      } catch {
        return false;
      }
    }
  };

  const readJSON = (k, fb) => {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return fb;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : fb;
    } catch {
      return fb;
    }
  };

  const writeJSON = (k, obj) => {
    localStorage.setItem(k, JSON.stringify(obj));
  };

  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const getTitleText = () => {
    const titles = qAnyAll(SEL.TITLE_ANY).filter(isVisible);
    for (const t of titles) {
      const s = clean(t.textContent);
      if (s) return s;
    }
    return "";
  };

  const isDwellingScreen = () => clean(getTitleText()).toLowerCase() === "dwelling";

  const readInfoBarNumbers = () => {
    const policyNumber = clean(qAny(SEL.INFOBAR_POLICY)?.textContent);
    const accountNumber = clean(qAny(SEL.INFOBAR_ACCOUNT)?.textContent);
    return { policyNumber, accountNumber };
  };

  function groupValueFromEl(el) {
    if (!el) return "";
    const txt = String(el.textContent || "");
    const lines = txt.split("\n").map((s) => clean(s)).filter(Boolean);
    if (!lines.length) return "";
    if (lines.length === 1) return lines[0];
    return clean(lines.slice(1).join(" "));
  }

  function protectionAllInOneFromEl(el) {
    if (!el) return "";
    const txt = String(el.textContent || "");
    const lines = txt.split("\n").map((s) => clean(s)).filter(Boolean);
    if (!lines.length) return "";
    const filtered = lines[0].toLowerCase() === "dwelling protection" ? lines.slice(1) : lines.slice(0);

    const pairs = [];
    for (let i = 0; i < filtered.length; i += 2) {
      const k = filtered[i] || "";
      const v = filtered[i + 1] || "";
      if (!k && !v) continue;
      pairs.push(v ? `${k}: ${v}` : k);
    }
    return clean(pairs.join(" | "));
  }

  function findValueByLabelText(root, labelRegex) {
    if (!root) return "";
    const labels = Array.from(root.querySelectorAll("div.gw-label, label, span.gw-label")).filter((n) => {
      const t = clean(n.textContent);
      return t && labelRegex.test(t);
    });

    for (const lab of labels) {
      const row =
        lab.closest('[role="group"], .gw-InputWidget, .gw-InputColumnWidget, .gw-DetailViewWidget, .gw-ValueWidget, .gw-RowWidget') ||
        lab.parentElement;

      if (!row) continue;

      const vEl =
        row.querySelector(".gw-value.gw-infoValue") ||
        row.querySelector(".gw-infoValue") ||
        row.querySelector(".gw-value") ||
        row.querySelector("input,select,textarea");

      if (vEl) {
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
      const lines = rowText.split("\n").map((s) => clean(s)).filter(Boolean);
      if (lines.length >= 2) return clean(lines.slice(1).join(" "));
    }
    return "";
  }

  function findValueByExactLabel(root, labelText) {
    const rx = new RegExp("^" + escapeRegExp(clean(labelText)) + "$", "i");
    return findValueByLabelText(root, rx);
  }

  function extractDogsAtResidenceFromEligibilityTable(tableEl) {
    if (!tableEl) return "";
    const rows = Array.from(tableEl.querySelectorAll("tbody tr[role='row'], tbody tr.gw-row"));
    const want = "are there any dogs kept at the residence?";

    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (tds.length < 2) continue;

      const qText = clean(tds[0].textContent || "");
      if (!qText) continue;
      if (qText.toLowerCase() !== want) continue;

      const answerTd = tds[1];

      const lbl = answerTd.querySelector(".gw-label");
      const lblTxt = clean(lbl?.textContent || "");
      if (/^(yes|no)$/i.test(lblTxt)) return lblTxt[0].toUpperCase() + lblTxt.slice(1).toLowerCase();

      const rv = answerTd.querySelector(".gw-RangeValue[data-gw-value]");
      const val = (rv?.getAttribute("data-gw-value") || "").toLowerCase().trim();
      if (val === "true") return "Yes";
      if (val === "false") return "No";

      const raw = clean(answerTd.textContent || "");
      if (/^yes$/i.test(raw)) return "Yes";
      if (/^no$/i.test(raw)) return "No";
      const m = raw.match(/\b(yes|no)\b/i);
      if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();

      return "";
    }
    return "";
  }

  function tableToOneCellString(containerEl) {
    if (!containerEl) return "";
    const raw = clean(containerEl.textContent || "");
    if (/no\s+data\s+to\s+display/i.test(raw)) return "No data to display";

    const table = containerEl.querySelector("table");
    if (!table) return raw || "";

    const headers = Array.from(table.querySelectorAll("thead th")).map((th) => clean(th.textContent)).filter(Boolean);
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    if (!rows.length) return "No data to display";

    const lines = [];
    if (headers.length) lines.push(headers.join(" | "));
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => clean(td.textContent));
      const line = cells.filter(Boolean).join(" | ");
      if (line) lines.push(line);
    }
    return clean(lines.join("\n"));
  }

  function findMenuItem(label) {
    for (const d of getAllDocs()) {
      try {
        const labelDiv = d.querySelector(`.gw-action--inner .gw-label[aria-label="${label}"]`);
        if (labelDiv) return labelDiv.closest('div[role="menuitem"]') || labelDiv;
      } catch {}
    }
    for (const d of getAllDocs()) {
      try {
        const mini = d.querySelector(`.gw-action--inner [data-gw-tooltip="${label}"]`);
        if (mini) return mini.closest('div[role="menuitem"]') || mini;
      } catch {}
    }
    for (const d of getAllDocs()) {
      try {
        const all = Array.from(d.querySelectorAll('div[role="menuitem"].gw-action--inner, div[role="menuitem"]'));
        const hit = all.find((n) => clean(n.textContent).includes(label));
        if (hit) return hit;
      } catch {}
    }
    return null;
  }

  function signalStep3() {
    try {
      localStorage.setItem(LS.STEP3_GO, "0");
      setTimeout(() => {
        try {
          localStorage.setItem(LS.STEP3_GO, "1");
        } catch {}
      }, 80);
      return true;
    } catch {
      return false;
    }
  }

  /******************************************************************
   * Details labels
   ******************************************************************/
  const DETAILS_LABELS = {
    HOMESHARE_Q: "Is this residence used for Homeshare such as Airbnb?",
    HOMESHARE_WARN: "There is no coverage for Homeshare losses.",
    HVAC_PRIMARY: "Primary Heating Source",
    HVAC_SECONDARY: "Secondary Heating Source",
    PLUMBING_TYPE: "Plumbing Type",
    PLUMBING_REPLACED_Q:
      "As of the NB effective date, has the (entire) home's plumbing system been replaced in the last 20 years?",
    ROOF_REPLACED_Q: "Has the roof been completely replaced?",
  };

  function hasTextAnywhere(root, exactText) {
    if (!root) return false;
    const t = String(root.textContent || "");
    return t.includes(exactText);
  }

  function extractDwellingDetailsExt(dwellingRoot) {
    const homeShareAnswer = findValueByExactLabel(dwellingRoot, DETAILS_LABELS.HOMESHARE_Q);

    return {
      HomeShare: {
        Question: DETAILS_LABELS.HOMESHARE_Q,
        Answer: clean(homeShareAnswer),
        Warning: hasTextAnywhere(dwellingRoot, DETAILS_LABELS.HOMESHARE_WARN) ? DETAILS_LABELS.HOMESHARE_WARN : "",
      },
      HVAC: {
        PrimaryHeatingSource: clean(findValueByExactLabel(dwellingRoot, DETAILS_LABELS.HVAC_PRIMARY)),
        SecondaryHeatingSource: clean(findValueByExactLabel(dwellingRoot, DETAILS_LABELS.HVAC_SECONDARY)),
      },
      Plumbing: {
        PlumbingType: clean(findValueByExactLabel(dwellingRoot, DETAILS_LABELS.PLUMBING_TYPE)),
        ReplacedLast20Years_Q: DETAILS_LABELS.PLUMBING_REPLACED_Q,
        ReplacedLast20Years_A: clean(findValueByExactLabel(dwellingRoot, DETAILS_LABELS.PLUMBING_REPLACED_Q)),
      },
      Roofing: {
        RoofCompletelyReplaced_Q: DETAILS_LABELS.ROOF_REPLACED_Q,
        RoofCompletelyReplaced_A: clean(findValueByExactLabel(dwellingRoot, DETAILS_LABELS.ROOF_REPLACED_Q)),
      },
    };
  }

  function detailsReady(dwellingRoot) {
    const labels = Array.from(dwellingRoot.querySelectorAll("div.gw-label, label, span.gw-label")).map((n) => clean(n.textContent));
    const set = new Set(labels.map((s) => s.toLowerCase()));
    return (
      set.has(DETAILS_LABELS.HOMESHARE_Q.toLowerCase()) ||
      set.has(DETAILS_LABELS.HVAC_PRIMARY.toLowerCase()) ||
      set.has(DETAILS_LABELS.PLUMBING_TYPE.toLowerCase()) ||
      set.has(DETAILS_LABELS.ROOF_REPLACED_Q.toLowerCase())
    );
  }

  /******************************************************************
   * RUNNER
   ******************************************************************/
  let armed = false;
  let busy = false;
  let pollTimer = null;
  let runCount = 0;

  // run once per Dwelling VISIBILITY (no policy-based dedupe)
  let ranThisVisibility = false;

  const setArmedUI = (v) => {
    armed = v;
    UI.btnStart.disabled = v;
    UI.btnStop.disabled = !v;
    UI.btnStop.style.opacity = v ? "1" : "0.55";
    UI.btnStart.style.opacity = v ? "0.55" : "1";
  };

  async function clickSubtab(selector, labelTextFallback) {
    let el = qAny(selector);
    if (!el || !isVisible(el)) {
      const tabs = qAnyAll('div[role="tab"]').filter(isVisible);
      const hit = tabs.find((t) => clean(t.textContent).toLowerCase() === String(labelTextFallback || "").toLowerCase());
      el = hit || null;
    }
    if (!el) return { ok: false, why: `subtab not found: ${labelTextFallback || selector}` };
    realClick(el);
    return { ok: true };
  }

  async function clickCoveragesTab() {
    const el = await waitFor(() => {
      const m = findMenuItem("Coverages");
      return m && isVisible(m) ? m : null;
    }, { timeout: 12000 });

    if (!el) return { ok: false, why: "Coverages tab not found" };

    UI.log("Clicking tab: Coverages");
    realClick(el);

    UI.log(`Waiting ${CFG.LOAD_WAIT_MS}ms for load...`);
    await sleep(CFG.LOAD_WAIT_MS);

    return { ok: true };
  }

  async function runOnce(why) {
    if (busy) return true;
    busy = true;
    runCount++;

    let okOverall = false;

    try {
      UI.setStatus("RUNNING");
      UI.log(`Run #${runCount} start (${why})`);

      const okTitle = await waitFor(() => (isDwellingScreen() ? true : null), { timeout: CFG.WAIT_TITLE_TIMEOUT_MS });
      if (!okTitle) {
        UI.log("ERROR: Dwelling header not visible");
        UI.setStatus("ERROR");
        return false;
      }

      UI.log(`Dwelling visible → waiting ${CFG.START_ON_DWELLING_WAIT_MS}ms...`);
      await sleep(CFG.START_ON_DWELLING_WAIT_MS);

      const { policyNumber, accountNumber } = readInfoBarNumbers();
      UI.log(`InfoBar: policy=${policyNumber || "(none)"} account=${accountNumber || "(none)"}`);

      const dwellingRoot = await waitFor(() => {
        const r = qAny(SEL.DWELLING_ROOT);
        return r && isVisible(r) ? r : null;
      }, { timeout: CFG.WAIT_BLOCK_TIMEOUT_MS });

      if (!dwellingRoot) {
        UI.log("ERROR: Dwelling root not visible");
        UI.setStatus("ERROR");
        return false;
      }

      UI.log("Click subtab: Details");
      const c0 = await clickSubtab(SEL.SUBTAB_DETAILS, "Details");
      if (!c0.ok) UI.log(`WARN: ${c0.why}`);
      await sleep(CFG.BETWEEN_SUBTAB_WAIT_MS);

      const ready = await waitFor(() => (detailsReady(dwellingRoot) ? true : null), { timeout: CFG.DETAILS_READY_TIMEOUT_MS });
      UI.log(ready ? "Details ready" : "WARN: Details not confirmed (continuing)");

      const riskAddress = groupValueFromEl(qAny(SEL.DW_RISK_ADDRESS));
      const county = groupValueFromEl(qAny(SEL.DW_COUNTY));
      const protectionClass = groupValueFromEl(qAny(SEL.DW_PPC));

      let fireline = clean(findValueByLabelText(dwellingRoot, /fireline/i));
      if (!fireline) {
        const fireLab = qAny(SEL.DW_FIRELINE_LABEL);
        const ctx =
          fireLab?.closest('[role="group"], .gw-InputWidget, .gw-InputColumnWidget, .gw-DetailViewWidget') ||
          fireLab?.parentElement ||
          null;

        if (!ctx && fireLab?.id) {
          const byAria = qAny(`[aria-labelledby="${fireLab.id}"]`);
          if (byAria) fireline = groupValueFromEl(byAria);
        }

        if (!fireline && ctx) {
          const vEl = ctx.querySelector(".gw-infoValue, .gw-value, input, select, textarea");
          if (vEl) {
            if (vEl.tagName && vEl.tagName.toLowerCase() === "select") {
              const opt = vEl.selectedOptions && vEl.selectedOptions[0];
              fireline = clean(opt ? opt.textContent : vEl.value);
            } else if (vEl.tagName && vEl.tagName.toLowerCase() === "input") {
              fireline = clean(vEl.value || vEl.getAttribute("value") || "");
            } else {
              fireline = clean(vEl.textContent);
            }
          } else {
            fireline = groupValueFromEl(ctx);
          }
        }
      }

      const yearBuilt = groupValueFromEl(qAny(SEL.DW_YEAR_BUILT)); // ✅ fixed
      const squareFeet = groupValueFromEl(qAny(SEL.DW_SQFT));
      const occupancy = groupValueFromEl(qAny(SEL.DW_OCCUPANCY));
      const protectionAll = protectionAllInOneFromEl(qAny(SEL.DW_PROTECTION_BLOCK));

      const dwellingData = {
        RiskAddress: clean(riskAddress),
        County: clean(county),
        ProtectionClassCode: clean(protectionClass),
        FirelineCode: clean(fireline),
        YearBuilt: clean(yearBuilt),
        SquareFeet: clean(squareFeet),
        Occupancy: clean(occupancy),
        DwellingProtection_AllInOneCell: clean(protectionAll),
      };

      const detailsExt = extractDwellingDetailsExt(dwellingRoot);

      UI.log(`HomeShare: ${detailsExt.HomeShare.Answer || "(blank)"} | warn=${detailsExt.HomeShare.Warning ? "Y" : "N"}`);
      UI.log(`HVAC: ${detailsExt.HVAC.PrimaryHeatingSource || "(blank)"} / ${detailsExt.HVAC.SecondaryHeatingSource || "(blank)"}`);
      UI.log(`Plumbing: ${detailsExt.Plumbing.PlumbingType || "(blank)"} | 20y=${detailsExt.Plumbing.ReplacedLast20Years_A || "(blank)"}`);
      UI.log(`Roof: ${detailsExt.Roofing.RoofCompletelyReplaced_A || "(blank)"}`);

      UI.log("Click subtab: Eligibility");
      const c1 = await clickSubtab(SEL.SUBTAB_ELIGIBILITY, "Eligibility");
      if (!c1.ok) UI.log(`WARN: ${c1.why}`);
      await sleep(CFG.BETWEEN_SUBTAB_WAIT_MS);

      const eligTable = await waitFor(() => {
        const t = qAny(SEL.ELIG_TABLE);
        return t && isVisible(t) ? t : null;
      }, { timeout: CFG.WAIT_BLOCK_TIMEOUT_MS });

      const dogs = extractDogsAtResidenceFromEligibilityTable(eligTable);

      UI.log("Click subtab: Additional Interests");
      const c2 = await clickSubtab(SEL.SUBTAB_ADDL_INT, "Additional Interests");
      if (!c2.ok) UI.log(`WARN: ${c2.why}`);
      await sleep(CFG.BETWEEN_SUBTAB_WAIT_MS);

      const mortBlock = await waitFor(() => {
        const e = qAny(SEL.MORTGAGEE_BLOCK);
        return e && isVisible(e) ? e : null;
      }, { timeout: CFG.WAIT_BLOCK_TIMEOUT_MS });

      const mortgageeTable = tableToOneCellString(mortBlock);

      const eligibilityData = {
        DogsAtResidence: clean(dogs),
        MortgageeTable: clean(mortgageeTable),
      };

      const payload = readJSON(LS.PAYLOAD, {});
      payload.Dwelling = Object.assign({}, payload.Dwelling || {}, dwellingData);
      payload.Eligibility = Object.assign({}, payload.Eligibility || {}, eligibilityData);
      payload.DwellingDetails_Ext = Object.assign({}, payload.DwellingDetails_Ext || {}, detailsExt);
      writeJSON(LS.PAYLOAD, payload);

      const out = {
        ok: true,
        ts: Date.now(),
        url: location.href,
        tab: "Dwelling",
        policyNumber: policyNumber || "",
        accountNumber: accountNumber || "",
        data: { Dwelling: dwellingData, Eligibility: eligibilityData, DwellingDetails_Ext: detailsExt },
      };

      writeJSON(LS.OUT, out);
      writeJSON(LS.READY, { ok: true, ts: out.ts, tab: "Dwelling" });
      localStorage.setItem(LS.STAGE, "dwelling_done");

      UI.log("Saved + merged payload");

      const cv = await clickCoveragesTab();
      if (!cv.ok) {
        UI.log("WARN: " + cv.why);
      } else {
        const signaled = signalStep3();
        UI.log(signaled ? `Step3 GO → ${LS.STEP3_GO}="1"` : "WARN: Step3 GO failed");
      }

      UI.setStatus("ARMED");
      UI.log("Run complete. Waiting until Dwelling is NOT visible to allow next run...");

      okOverall = true;
      return true;
    } finally {
      busy = false;
      if (!okOverall && isDwellingScreen()) {
        ranThisVisibility = false;
        UI.log("Run failed; gate cleared → will retry while still on Dwelling.");
      }
    }
  }

  function startPolling() {
    if (armed) return;
    setArmedUI(true);
    UI.setStatus("ARMED");
    UI.log("Loaded. Double-click title to collapse. Auto-arming...");
    UI.log("ARMED. Rule: Dwelling visible → run once → wait until not visible.");

    pollTimer = window.setInterval(() => {
      if (!armed || busy) return;

      const visible = isDwellingScreen();

      if (!visible && ranThisVisibility) {
        ranThisVisibility = false;
        UI.log("Dwelling not visible anymore. Gate reset ✅");
      }

      if (visible && !ranThisVisibility) {
        ranThisVisibility = true;
        runOnce("DWELLING_VISIBLE");
      }
    }, CFG.POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = null;
    setArmedUI(false);
    UI.setStatus("IDLE");
    UI.log("Stopped (session-only). Reload will re-arm.");
  }

  UI.btnStart.addEventListener("click", () => startPolling());
  UI.btnStop.addEventListener("click", () => stopPolling());
  UI.btnForce.addEventListener("click", () => runOnce("FORCE_RUN"));

  startPolling();
})();
