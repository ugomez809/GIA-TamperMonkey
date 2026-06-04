// ==UserScript==
// @name         AgencyZoom Cleanup & Force USA Country
// @namespace    GPG_Scripts
// @version      2.0
// @description  Remove all "Same as mailing address" boxes and auto-select USA in country dropdowns
// @match        https://app.agencyzoom.com/*
// @grant        none
// @author       Mr.G & JanielR
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/STAFF%20scripts/AgencyZoom%20Cleanup%20Force%20USA%20Country/agencyzoom-remove-locationbox.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/STAFF%20scripts/AgencyZoom%20Cleanup%20Force%20USA%20Country/agencyzoom-remove-locationbox.user.js
// ==/UserScript==

(function () {
    'use strict';

    // 1) Target checkbox wrappers
    const MAILING_CHECKBOX_SELECTOR = '.mailing-address-checkbox';

    // 2) Force every country dropdown to USA
    const COUNTRY_SELECTOR = '.propertyAddress-country';

    function hideMailingCheckboxes() {
        document.querySelectorAll(MAILING_CHECKBOX_SELECTOR)
            .forEach(el => {
                // Keep element for form logic, just hide it
                el.style.display = 'none';
                el.style.visibility = 'hidden';
            });
    }

    function selectUSAInDropdowns() {
        document.querySelectorAll(COUNTRY_SELECTOR).forEach(sel => {
            if (sel instanceof HTMLSelectElement) {
                if (sel.value !== 'USA') {
                    sel.value = 'USA';
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });
    }

    function runScript() {
        hideMailingCheckboxes();
        selectUSAInDropdowns();
    }

    // Poll until we see at least one target element, then apply once
    const interval = setInterval(() => {
        if (
            document.querySelector(MAILING_CHECKBOX_SELECTOR) ||
            document.querySelector(COUNTRY_SELECTOR)
        ) {
            runScript();
            clearInterval(interval);
        }
    }, 500);

    // Safety cutoff after 10 seconds
    setTimeout(() => clearInterval(interval), 10000);
})();
