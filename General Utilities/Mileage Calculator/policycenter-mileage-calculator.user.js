// ==UserScript==
// @name         PolicyCenter - Hosted Mileage Calculator
// @namespace    local.policycenter.hosted-mileage
// @version      1.1.1
// @description  Opens a content-sized, draggable mileage calculator outside the vehicle details.
// @match        https://policycenter.farmersinsurance.com/pc/*
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
  let activeInput = null, activeButton = null;
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
    activeInput = activeButton = null;
  }

  function positionCalculator() {
    if (!popup) return;
    if (!activeInput?.isConnected) return closeCalculator();
    const field = activeInput.getBoundingClientRect();
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
      const panel = activeInput.closest('[id$="-VehicleDetailCard"], [data-gia-mileage-panel]')
        || activeInput.closest('.gw-DetailViewWidget') || activeInput.parentElement;
      const bounds = panel.getBoundingClientRect();
      const mainLeft = activeInput.closest('#gw-center-panel')?.getBoundingClientRect().left || 0;
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

  function openCalculator(input, button) {
    if (popup && activeInput === input) return closeCalculator(true);
    closeCalculator();
    activeInput = input;
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

  window.addEventListener('message', event => {
    if (!popup || event.origin !== calculatorOrigin || event.source !== frame?.contentWindow) return;
    const data = event.data;
    if (data?.type === 'gia-mileage:close') return closeCalculator(true);
    if (data?.type !== 'gia-mileage:resize' || !Number.isFinite(data.width) || !Number.isFinite(data.height)
      || data.width <= 0 || data.height <= 0 || data.width > 10000 || data.height > 10000) return;
    contentSize = {width: Math.ceil(data.width), height: Math.ceil(data.height)};
    loading?.remove();loading = null;
    frame.style.visibility = 'visible';
    positionCalculator();
  });

  function refresh() {
    if (popup && !activeInput?.isConnected) closeCalculator();
    document.querySelectorAll(selector).forEach(input => {
      const row = input.parentElement;
      if (row.querySelector('.gia-mileage-launch')) return;
      row.classList.add('gia-mileage-row');
      const button = document.createElement('button');
      button.type = 'button';button.className = 'gia-mileage-launch';
      button.textContent = 'Mileage Calculator';
      button.setAttribute('aria-haspopup', 'dialog');button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'gia-mileage-popup');
      button.addEventListener('click', event => {
        event.preventDefault();event.stopPropagation();openCalculator(input, button);
      });
      input.insertAdjacentElement('afterend', button);
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
