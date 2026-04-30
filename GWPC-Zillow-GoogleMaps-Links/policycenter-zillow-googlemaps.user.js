// ==UserScript==
// @name         Zillow and Google Maps Links for PolicyCenter
// @namespace    GPG_Scripts
// @version      2.4
// @description  Add buttons for Zillow and Google Maps to PolicyCenter/Guidewire
// @match        https://policycenter.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-2.farmersinsurance.com/pc/PolicyCenter.do*
// @match        https://policycenter-3.farmersinsurance.com/pc/PolicyCenter.do*
// @grant        none
// @author       Mr.G
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/GWPC-Zillow-GoogleMaps-Links/policycenter-zillow-googlemaps.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/GWPC-Zillow-GoogleMaps-Links/policycenter-zillow-googlemaps.user.js
// ==/UserScript==

(function () {
    'use strict';

    const targetSelectors = [
        '#SubmissionWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-0',
        '#PolicyFileDwellingHOE-PolicyFile_Homeowners_Dwelling_Screen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-0',
        '#PolicyChangeWizard-LOBWizardStepGroup-LineWizardStepSet-HODwellingHOEScreen-HODwellingSingleHOEPanelSet-HODwellingDetailsHOEDV-0'
    ];

    const createButton = (text, color, action) => {
        const btn = document.createElement('button');
        btn.innerText = text;
        btn.style.margin = '10px';
        btn.style.padding = '5px 10px';
        btn.style.cursor = 'pointer';
        btn.style.backgroundColor = color;
        btn.style.color = '#fff';
        btn.style.border = 'none';
        btn.style.borderRadius = '4px';
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            action();
        };
        return btn;
    };

    const addButtons = (container) => {
        if (container.querySelector('.custom-zillow-button')) {
            return;
        }

        const addressEl = container.querySelector('div.gw-link.gw-label');
        if (!addressEl) {
            return;
        }

        const address = addressEl.textContent.trim();
        if (!address) {
            return;
        }

        const zillowUrl = `https://www.zillow.com/homes/${encodeURIComponent(address)}`;
        const zillowBtn = createButton('Open in Zillow', '#0074cc', () => window.open(zillowUrl, '_blank', 'noopener'));
        zillowBtn.classList.add('custom-zillow-button');

        const googleMapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(address)}`;
        const mapsBtn = createButton(
            'Open in Google Maps',
            '#34a853',
            () => window.open(googleMapsUrl, '_blank', 'noopener')
        );
        mapsBtn.classList.add('custom-maps-button');

        container.appendChild(zillowBtn);
        container.appendChild(mapsBtn);
    };

    const initialize = () => {
        targetSelectors.forEach((selector) => {
            const container = document.querySelector(selector);
            if (container) {
                addButtons(container);
            }
        });
    };

    const observer = new MutationObserver(() => {
        targetSelectors.forEach((selector) => {
            const container = document.querySelector(selector);
            if (container) {
                addButtons(container);
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    initialize();
})();
