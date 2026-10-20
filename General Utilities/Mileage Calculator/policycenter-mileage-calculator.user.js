// ==UserScript==
// @name         PolicyCenter - Hosted Mileage Calculator
// @namespace    local.policycenter.hosted-mileage
// @version      1.0.0
// @description  Opens the separately hosted mileage calculator beside Annual Miles.
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
  const selector = 'input[name$="-AnnualMileageCA_DV"]';
  const style = document.createElement('style');
  style.textContent = `
    .gia-mileage-row { display:flex!important;align-items:center;gap:6px; }
    .gia-mileage-row > input { flex:1 1 0;min-width:0;width:0; }
    .gia-mileage-launch {
      flex:none;padding:4px 9px;border:1px solid #209bc0;border-radius:4px;
      background:#007b9e;color:#fff;font:inherit;line-height:1.2;
      white-space:nowrap;cursor:pointer;
    }
    .gia-mileage-launch:hover { background:#006783; }
    .gia-mileage-launch:focus-visible,#gia-mileage-popup button:focus-visible {
      outline:2px solid #50cfff;outline-offset:2px;
    }
    #gia-mileage-popup {
      position:fixed;z-index:100000;box-sizing:border-box;
      display:flex;flex-direction:column;width:360px;
      max-width:calc(100vw - 24px);height:620px;max-height:calc(100vh - 24px);
      border:1px solid #41677c;border-radius:8px;overflow:hidden;
      box-shadow:0 8px 32px #0006;background:#e9edf1;
      color:#fff;font:13px/1.4 Arial,sans-serif;
    }
    #gia-mileage-popup header {
      display:flex;align-items:center;justify-content:space-between;gap:8px;
      flex:none;padding:6px 10px;background:#122d3b;
    }
    #gia-mileage-popup button {
      padding:2px 7px;background:transparent;color:#fff;
      border:1px solid #557281;border-radius:3px;font:inherit;cursor:pointer;
    }
    #gia-mileage-popup iframe { flex:1;min-height:0;width:100%;border:0;background:#e9edf1; }
  `;
  document.head.append(style);

  let popup = null;
  let activeInput = null;
  let activeButton = null;

  function closeCalculator(returnFocus = false) {
    popup?.remove();
    popup = null;
    activeButton?.setAttribute('aria-expanded', 'false');
    if (returnFocus && activeButton?.isConnected) activeButton.focus();
    activeInput = null;
    activeButton = null;
  }

  function positionCalculator() {
    if (!popup) return;
    if (!activeInput?.isConnected) return closeCalculator();
    const field = activeInput.getBoundingClientRect();
    const row = activeInput.parentElement.getBoundingClientRect();
    if (field.bottom < 0 || field.top > innerHeight) return closeCalculator();
    const margin = 12;
    const {width, height} = popup.getBoundingClientRect();
    let left;
    if (row.right + margin + width <= innerWidth - margin) left = row.right + margin;
    else if (row.left - margin - width >= margin) left = row.left - margin - width;
    else left = Math.min(Math.max(margin, field.left), innerWidth - width - margin);
    const top = Math.max(margin, Math.min(field.top, innerHeight - height - margin));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  function openCalculator(input, button) {
    if (popup && activeInput === input) return closeCalculator(true);
    closeCalculator();
    activeInput = input;
    activeButton = button;
    popup = document.createElement('section');
    popup.id = 'gia-mileage-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Mileage Calculator');
    const header = document.createElement('header');
    const heading = document.createElement('span');
    heading.textContent = 'Mileage Calculator';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close mileage calculator');
    close.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      closeCalculator(true);
    });
    header.append(heading, close);
    const frame = document.createElement('iframe');
    frame.title = 'Annual mileage calculator';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.allow = 'clipboard-write';
    // A new request on every open picks up published calculator changes.
    const url = new URL(CALCULATOR_URL);
    url.searchParams.set('v', Date.now().toString());
    frame.src = url.href;
    popup.append(header, frame);
    document.body.append(popup);
    button.setAttribute('aria-expanded', 'true');
    positionCalculator();
    close.focus();
  }

  function refresh() {
    if (popup && !activeInput?.isConnected) closeCalculator();
    document.querySelectorAll(selector).forEach(input => {
      const row = input.parentElement;
      if (row.querySelector('.gia-mileage-launch')) return;
      row.classList.add('gia-mileage-row');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'gia-mileage-launch';
      button.textContent = 'Mileage Calculator';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-controls', 'gia-mileage-popup');
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openCalculator(input, button);
      });
      input.insertAdjacentElement('afterend', button);
    });
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popup) {
      event.preventDefault();
      event.stopPropagation();
      closeCalculator(true);
    }
  });
  window.addEventListener('resize', positionCalculator);
  document.addEventListener('scroll', positionCalculator, true);
  refresh();
  new MutationObserver(refresh).observe(document.body, {childList:true, subtree:true});
})();
