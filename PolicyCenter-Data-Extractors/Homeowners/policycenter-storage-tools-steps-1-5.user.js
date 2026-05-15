// ==UserScript==
// @name         PolicyCenter — Storage Tools (Export TXT + Clear) Steps 1–5
// @namespace    tm.pc.tools.localstorage
// @version      1.1.0
// @description  Two tiny buttons (top-right): Green = download export TXT for tm_pc_* keys (local+session); Red = clear tm_pc_* keys (local+session).
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @run-at       document-idle
// @all-frames   true
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-storage-tools-steps-1-5.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/PolicyCenter-Data-Extractors/Homeowners/policycenter-storage-tools-steps-1-5.user.js
// ==/UserScript==

(() => {
  'use strict';
  if (window.top !== window.self) return;

  const TOOL_ID = 'tm_pc_ls_tools_v1';

  const CFG = {
    sizePx: 16,
    gapPx: 6,
    topPx: 10,
    rightPx: 10,
    includeSessionStorage: true, // ✅ catches Step5 if it saved there by accident
    broadMatchTmPc: true,        // ✅ match any tm_pc_* key (covers Step5 variants)
  };

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function prettyValue(raw) {
    if (raw == null) return '';
    const s = String(raw);
    const parsed = safeJsonParse(s);
    if (parsed !== null) {
      try { return JSON.stringify(parsed, null, 2); } catch { return s; }
    }
    return s;
  }

  // Old prefixes (kept) + broad tm_pc_ match
  const PREFIXES = [
    'tm_pc_policyinfo', 'tm_pc_step1',
    'tm_pc_drivers',    'tm_pc_step2',
    'tm_pc_vehicles',   'tm_pc_step3',
    'tm_pc_pacoverages','tm_pc_step4',
    'tm_pc_quote',      'tm_pc_step5',
  ];

  const EXACT_KEYS = new Set([
    'tm_pc_stage_v1',
  ]);

  const STEP5_HINT = /step\s*5|step5|quote|premium|cost|billing|payment|rater|rate/i;

  function isOurKey(k) {
    if (!k) return false;
    if (EXACT_KEYS.has(k)) return true;

    if (CFG.broadMatchTmPc && (k.startsWith('tm_pc_') || k.startsWith('tm_pc'))) return true;

    for (const p of PREFIXES) {
      if (k.startsWith(p)) return true;
    }
    return false;
  }

  function listKeysSorted(store) {
    const keys = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (isOurKey(k)) keys.push(k);
    }
    keys.sort((a, b) => a.localeCompare(b));
    return keys;
  }

  function buildExportTxt(localKeys, sessionKeys) {
    const out = [];
    out.push('PolicyCenter Storage Export — Steps 1–5');
    out.push('=========================================');
    out.push(`exported_at: ${new Date().toISOString()}`);
    out.push(`href: ${location.href}`);
    out.push(`localStorage_keys_found: ${localKeys.length}`);
    out.push(`sessionStorage_keys_found: ${sessionKeys.length}`);
    out.push('');

    if (localKeys.length) {
      out.push('=== localStorage ===');
      out.push('');
      for (const k of localKeys) {
        out.push(`[KEY] ${k}`);
        out.push('------------------------------------------------');
        out.push(prettyValue(localStorage.getItem(k)));
        out.push('');
      }
    }

    if (sessionKeys.length) {
      out.push('=== sessionStorage ===');
      out.push('');
      for (const k of sessionKeys) {
        out.push(`[KEY] ${k}`);
        out.push('------------------------------------------------');
        out.push(prettyValue(sessionStorage.getItem(k)));
        out.push('');
      }
    }

    return out.join('\n');
  }

  function downloadTxt(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function tsFile() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  function toast(msg) {
    const id = 'tm_pc_ls_toast';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.style.cssText = `
        position:fixed; top:40px; right:10px; z-index:2147483647;
        background:#111; color:#fff; padding:8px 10px; border-radius:10px;
        font:12px/1.2 system-ui,Segoe UI,Roboto,Arial; box-shadow:0 10px 30px rgba(0,0,0,.25);
        opacity:.95;
      `;
      document.documentElement.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => { try { el.remove(); } catch {} }, 2200);
  }

  function injectButtons() {
    if (document.getElementById(TOOL_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = TOOL_ID;
    wrap.style.cssText = `
      position:fixed; top:${CFG.topPx}px; right:${CFG.rightPx}px; z-index:2147483647;
      display:flex; gap:${CFG.gapPx}px; align-items:center;
    `;

    const mkDot = (bg, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      b.style.cssText = `
        width:${CFG.sizePx}px; height:${CFG.sizePx}px; border-radius:999px;
        border:1px solid rgba(0,0,0,.25); background:${bg};
        cursor:pointer; box-shadow:0 6px 16px rgba(0,0,0,.18);
        padding:0;
      `;
      return b;
    };

    const btnExport = mkDot('#1db954', 'Export Steps 1–5 (tm_pc_*) storage → TXT');
    const btnClear  = mkDot('#ff3b30', 'Clear Steps 1–5 (tm_pc_*) storage');

    btnExport.addEventListener('click', () => {
      const localKeys = listKeysSorted(localStorage);
      const sessionKeys = CFG.includeSessionStorage ? listKeysSorted(sessionStorage) : [];

      const txt = buildExportTxt(localKeys, sessionKeys);
      const name = `pc_storage_steps1-5_${tsFile()}.txt`;
      downloadTxt(name, txt);

      const step5Local = localKeys.filter(k => STEP5_HINT.test(k)).length;
      const step5Sess  = sessionKeys.filter(k => STEP5_HINT.test(k)).length;

      toast(`Exported L:${localKeys.length} S:${sessionKeys.length} | Step5-ish L:${step5Local} S:${step5Sess}`);
    });

    btnClear.addEventListener('click', (ev) => {
      const localKeys = listKeysSorted(localStorage);
      const sessionKeys = CFG.includeSessionStorage ? listKeysSorted(sessionStorage) : [];
      const total = localKeys.length + sessionKeys.length;

      const ok = ev.shiftKey || confirm(`Clear ${total} keys (tm_pc_*) from local+session storage?`);
      if (!ok) return;

      for (const k of localKeys) { try { localStorage.removeItem(k); } catch {} }
      for (const k of sessionKeys) { try { sessionStorage.removeItem(k); } catch {} }

      toast(`Cleared ${total} keys`);
    });

    wrap.appendChild(btnExport);
    wrap.appendChild(btnClear);
    document.documentElement.appendChild(wrap);
  }

  injectButtons();
})();
