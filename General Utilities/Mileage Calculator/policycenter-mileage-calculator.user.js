// ==UserScript==
// @name         PolicyCenter - Hosted Mileage Calculator
// @namespace    local.policycenter.hosted-mileage
// @version      1.3.0
// @description  Opens a fitted, draggable mileage calculator and fills Annual Miles for the chosen vehicle.
// @match        https://policycenter.farmersinsurance.com/pc/*
// @match        https://policycenter-2.farmersinsurance.com/pc/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/Mileage%20Calculator/policycenter-mileage-calculator.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/Mileage%20Calculator/policycenter-mileage-calculator.user.js
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  const CALCULATOR_URL = 'https://ugomez809.github.io/GIA-TamperMonkey/General%20Utilities/Mileage%20Calculator/mileage-calculator-popup.html';
  const calculatorOrigin = new URL(CALCULATOR_URL).origin;
  const positionKey = 'gia-mileage-calculator-position';
  const selector = 'input[name$="-AnnualMileageCA_DV"]';
  const retrieveSelector = '[id$="-PAVehiclesExtPanelSet-VehiclesLV_tb-VehiclesScreen_RetrievePurchaseDate"]';
  const margin = 12;
  const style = document.createElement('style');
  style.textContent = `
    .gia-mileage-row {display:flex!important;align-items:center;gap:6px;}
    .gia-mileage-row > input {flex:1 1 0;min-width:0;width:0;}
    .gia-mileage-launch {
      flex:none;padding:4px 9px;border:1px solid #209bc0;border-radius:4px;
      background:#007b9e;color:#fff;font:inherit;line-height:1.2;white-space:nowrap;cursor:pointer;
    }
    .gia-mileage-launch:hover {background:#006783;}
    .gia-mileage-toolbar-launch {margin-left:6px;padding:3px 9px;align-self:center;vertical-align:middle;}
    .gia-mileage-launch:focus-visible,#gia-mileage-popup :focus-visible {
      outline:2px solid #50cfff;outline-offset:2px;
    }
    #gia-mileage-popup {
      position:fixed;z-index:100000;box-sizing:border-box;display:flex;flex-direction:column;
      border:1px solid #41677c;border-radius:8px;overflow:hidden;
      box-shadow:0 8px 32px #0005;background:#fff;color:#fff;font:13px/1.4 Arial,sans-serif;
    }
    #gia-mileage-popup header {
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      box-sizing:border-box;flex:none;padding:6px 10px;background:#122d3b;
      cursor:grab;touch-action:none;user-select:none;
    }
    #gia-mileage-popup[data-dragging] header {cursor:grabbing;}
    #gia-mileage-popup button {
      padding:2px 7px;background:transparent;color:#fff;border:1px solid #557281;
      border-radius:3px;font:inherit;cursor:pointer;
    }
    #gia-mileage-popup iframe {display:block;flex:1;min-height:0;width:100%;border:0;background:#fff;}
    #gia-mileage-popup .gia-mileage-loading {padding:7px 10px;color:#526676;font-size:12px;}
  `;
  document.head.append(style);

  let popup = null, frame = null, header = null, loading = null;
  let activeAnchor = null, activeButton = null;
  let contentSize = null, position = null, drag = null;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

  function readPosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey));
      // Older versions saved automatic placements too; those can drift from the panel edge.
      if (saved?.manual === true && Number.isFinite(saved.left) && Number.isFinite(saved.top)) return saved;
    } catch { /* Position memory is optional when storage is unavailable. */ }
    return null;
  }

  function closeCalculator(returnFocus = false) {
    if (popup) {
      const {left, top} = popup.getBoundingClientRect();
      try {
        if (position) localStorage.setItem(positionKey, JSON.stringify({left, top, manual: true}));
        else localStorage.removeItem(positionKey);
      } catch { /* Optional preference. */ }
      popup.remove();
    }
    popup = frame = header = loading = null;
    drag = null;
    activeButton?.setAttribute('aria-expanded', 'false');
    if (returnFocus && activeButton?.isConnected) activeButton.focus();
    activeAnchor = activeButton = null;
  }

  function positionCalculator() {
    if (!popup) return;
    if (!activeAnchor?.isConnected) return closeCalculator();
    const field = activeAnchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const css = getComputedStyle(popup);
    const borderX = parseFloat(css.borderLeftWidth) + parseFloat(css.borderRightWidth);
    const borderY = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
    const width = Math.min(Math.ceil((contentSize?.width || 300) + borderX), Math.max(1, vw - margin * 2));
    popup.style.width = `${width}px`;
    const chrome = header.getBoundingClientRect().height + borderY;
    let height = Math.min(Math.ceil((contentSize?.height || 28) + chrome), Math.max(chrome + 1, vh - margin * 2));
    let left, top;
    if (position) {
      left = clamp(position.left, margin, vw - width - margin);
      top = clamp(position.top, margin, vh - height - margin);
    } else {
      const panel = activeAnchor.closest('[id$="-VehicleDetailCard"], [id$="-PAVehiclesExtPanelSet-VehiclesLV"], [data-gia-mileage-panel]')
        || activeAnchor.closest('.gw-DetailViewWidget') || activeAnchor.parentElement;
      const bounds = panel.getBoundingClientRect();
      const mainLeft = activeAnchor.closest('#gw-center-panel')?.getBoundingClientRect().left || 0;
      if (bounds.right + margin + width <= vw - margin) {
        left = bounds.right + margin;
        top = clamp(field.top, margin, vh - height - margin);
      } else if (bounds.left - width - margin >= mainLeft + margin) {
        left = bounds.left - width - margin;
        top = clamp(field.top, margin, vh - height - margin);
      } else {
        // If the side gutter is too narrow, use space below the entire details card.
        left = clamp(field.left, margin, vw - width - margin);
        top = bounds.bottom + margin;
        if (vh - top - margin > chrome) height = Math.min(height, vh - top - margin);
        else top = clamp(top, margin, vh - height - margin);
      }
    }
    popup.style.height = `${height}px`;
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function makeDraggable() {
    header.tabIndex = 0;
    header.title = 'Drag to move. Arrow keys move the window; Shift moves faster.';
    header.setAttribute('aria-label', 'Move mileage calculator');
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = popup.getBoundingClientRect();
      drag = {x: event.clientX - rect.left, y: event.clientY - rect.top};
      header.setPointerCapture(event.pointerId);
      popup.setAttribute('data-dragging', '');
      frame.style.pointerEvents = 'none';
    });
    header.addEventListener('pointermove', event => {
      if (!drag) return;
      position = {left: event.clientX - drag.x, top: event.clientY - drag.y};
      positionCalculator();
    });
    const endDrag = () => {
      if (!popup || !drag) return;
      drag = null;
      const {left, top} = popup.getBoundingClientRect();
      position = {left, top};
      popup.removeAttribute('data-dragging');
      frame.style.pointerEvents = '';
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
    header.addEventListener('lostpointercapture', endDrag);
    header.addEventListener('keydown', event => {
      if (event.target !== header || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const {left, top} = popup.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 10;
      position = {left: left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
        top: top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)};
      positionCalculator();
    });
  }

  function openCalculator(anchor, button) {
    if (popup && activeAnchor === anchor) return closeCalculator(true);
    closeCalculator();
    activeAnchor = anchor;
    activeButton = button;
    position = readPosition();
    contentSize = null;
    popup = document.createElement('section');
    popup.id = 'gia-mileage-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Mileage Calculator');
    header = document.createElement('header');
    const heading = document.createElement('span');
    heading.textContent = 'Mileage Calculator';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close mileage calculator');
    close.addEventListener('click', event => {
      event.preventDefault();event.stopPropagation();closeCalculator(true);
    });
    header.append(heading, close);
    loading = document.createElement('div');
    loading.className = 'gia-mileage-loading';
    loading.textContent = 'Loading calculator…';
    frame = document.createElement('iframe');
    frame.title = 'Annual mileage calculator';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.allow = 'clipboard-write';
    frame.style.visibility = 'hidden';
    const url = new URL(CALCULATOR_URL);
    url.searchParams.set('embed', '1');
    url.searchParams.set('parentOrigin', location.origin);
    url.searchParams.set('v', Date.now().toString());
    frame.src = url.href;
    popup.append(header, loading, frame);
    document.body.append(popup);
    makeDraggable();
    button.setAttribute('aria-expanded', 'true');
    positionCalculator();
    close.focus();
  }

  function mileageTarget() {
    if (!activeAnchor?.isConnected) throw new Error('The vehicle page changed. Reopen the calculator.');
    if (activeAnchor.matches(selector)) return activeAnchor;
    const panel = activeAnchor.closest('[id$="-PAVehiclesExtPanelSet-VehiclesLV"]');
    if (!panel) throw new Error('Annual Miles could not be found on this page.');
    const selected = Array.from(panel.querySelectorAll('input[name$="-AnnualMileage"]')).filter(input =>
      input.closest('tr')?.querySelector('[role="checkbox"][id$="-_Checkbox_checkboxDiv"][aria-checked="true"]'));
    if (selected.length === 0) throw new Error('Select one vehicle using its checkbox, then click Copy miles again.');
    if (selected.length > 1) throw new Error('Select only one vehicle, then click Copy miles again.');
    return selected[0];
  }

  function fillAnnualMiles(miles) {
    if (!Number.isSafeInteger(miles) || miles < 0) throw new Error('Calculate a valid whole number of annual miles first.');
    const input = mileageTarget();
    if (input.disabled || input.readOnly) throw new Error('Annual Miles is not editable for this vehicle.');
    const value = String(miles);
    if (input.maxLength > 0 && value.length > input.maxLength) throw new Error('The result is too large for the Annual Miles field.');
    if (input.value === value) return;
    input.focus({preventScroll: true});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    input.blur();
  }

  window.addEventListener('message', event => {
    if (!popup || !frame?.contentWindow || event.origin !== calculatorOrigin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (data?.type === 'gia-mileage:apply') {
      if (!Number.isSafeInteger(data.requestId) || data.requestId < 1) return;
      let reply;
      try {
        fillAnnualMiles(data.miles);
        reply = {ok: true, message: 'Annual Miles filled.'};
      } catch (error) {
        reply = {ok: false, message: error.message || 'Annual Miles could not be filled.'};
      }
      event.source.postMessage({type: 'gia-mileage:applied', requestId: data.requestId, ...reply}, event.origin);
      return;
    }
    if (data?.type === 'gia-mileage:close') return closeCalculator(true);
    if (data?.type !== 'gia-mileage:resize' || !Number.isFinite(data.width) || !Number.isFinite(data.height)
      || data.width <= 0 || data.height <= 0 || data.width > 10000 || data.height > 10000) return;
    contentSize = {width: Math.ceil(data.width), height: Math.ceil(data.height)};
    loading?.remove();loading = null;
    frame.style.visibility = 'visible';
    positionCalculator();
  });

  function makeLauncher(anchor) {
    const button = document.createElement('button');
    button.type = 'button';button.className = 'gia-mileage-launch';
    button.textContent = 'Mileage Calculator';
    button.setAttribute('aria-haspopup', 'dialog');button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'gia-mileage-popup');
    button.addEventListener('click', event => {
      event.preventDefault();event.stopPropagation();openCalculator(anchor, button);
    });
    return button;
  }

  function refresh() {
    if (popup && !activeAnchor?.isConnected) closeCalculator();
    document.querySelectorAll(selector).forEach(input => {
      const row = input.parentElement;
      if (row.querySelector('.gia-mileage-launch')) return;
      row.classList.add('gia-mileage-row');
      input.insertAdjacentElement('afterend', makeLauncher(input));
    });
    document.querySelectorAll(retrieveSelector).forEach(retrieve => {
      if (retrieve.parentElement.querySelector('.gia-mileage-toolbar-launch')) return;
      const button = makeLauncher(retrieve);
      button.classList.add('gia-mileage-toolbar-launch');
      // Keep our control outside the vendor action's disabled container.
      retrieve.insertAdjacentElement('afterend', button);
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popup) {event.preventDefault();event.stopPropagation();closeCalculator(true);}
  });
  window.addEventListener('resize', positionCalculator);
  document.addEventListener('scroll', positionCalculator, true);
  refresh();
  new MutationObserver(refresh).observe(document.body, {childList:true, subtree:true});
})();
