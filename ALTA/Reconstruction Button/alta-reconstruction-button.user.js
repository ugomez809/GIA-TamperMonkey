// ==UserScript==
// @name         ALTA Reconstruction Calculator Button
// @namespace    GPG_Scripts
// @version      0.3
// @description  Add one Reconstruction Calculator button to ALTA Home features
// @match        https://alta.farmers.com/quote/*
// @run-at       document-idle
// @grant        none
// @author       Mr.G
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SYNC_DELAY_MS = 100;
    const RECONSTRUCTION_BASE_URL = 'https://gomezagency.net/zipcodes.html';
    const ROOT_ATTR = 'data-gpg-alta-reconstruction-root';
    const LINK_ATTR = 'data-gpg-alta-reconstruction-link';
    const STYLE_ID = 'gpg-alta-reconstruction-link-colors';
    const RECONSTRUCTION_TEXT_COLOR = '#f97316';
    const ZILLOW_TEXT_COLOR = '#005ea8';
    const GOOGLE_MAPS_TEXT_COLOR = '#188038';

    const HOME_FEATURES_PATH = '/quote/home/home-features';
    const MOUNT_SELECTORS = [
        'app-home-features .map-links-section',
        '.home-feature-wrapper .map-links-section',
        '.titleAndAddress .map-links-section',
        '[data-test-id="Near_Maps_Launch"]'
    ];
    const ADDRESS_SELECTORS = [
        'app-home-features .address-line',
        '.home-feature-wrapper .address-line',
        '.titleAndAddress .address-line',
        '[data-test-id="Google_Maps_Launch"]',
        '[data-test-id="Zillow_Launch"]'
    ];
    const DIRECT_SQUARE_FOOTAGE_SELECTORS = [
        '[data-test-id="LIVABLE_SQUARE_FEET_INPUT"]',
        '#livableSquareFeet',
        '[name="livableSquareFeet"]',
        '[aria-labelledby~="livableSqfeetLabel"]',
        '[formcontrolname*="square" i]',
        '[formcontrolname*="sqft" i]',
        '[formcontrolname*="sqFt" i]',
        '[formcontrolname*="foot" i]',
        '[formcontrolname*="livingArea" i]',
        '[formcontrolname*="living_area" i]',
        '[formcontrolname*="totalLiving" i]',
        '[formcontrolname*="dwellingArea" i]',
        '[formcontrolname*="dwellingSize" i]',
        '[formcontrolname*="homeSize" i]',
        '[aria-label*="square" i]',
        '[aria-label*="sq ft" i]',
        '[aria-label*="sq. ft" i]',
        '[aria-label*="footage" i]',
        '[aria-label*="living area" i]',
        '[aria-labelledby*="square" i]',
        '[aria-labelledby*="sq" i]',
        '[id*="square" i]',
        '[id*="sqft" i]',
        '[id*="footage" i]',
        '[id*="livingArea" i]',
        '[id*="living-area" i]',
        '[name*="square" i]',
        '[name*="sqft" i]',
        '[name*="footage" i]',
        '[name*="livingArea" i]'
    ];
    const SQUARE_FOOTAGE_LABEL_PATTERN =
        /\b(?:square\s*(?:feet|footage|ft)|sq\.?\s*ft\.?|sqft|living\s*area|total\s*(?:living\s*)?area|dwelling\s*(?:area|size)|home\s*(?:area|size)|structure\s*(?:area|size))\b/i;

    const uniqueElements = (selectors, scope) => {
        const root = scope || document;
        const seen = new Set();
        const results = [];

        selectors.forEach((selector) => {
            root.querySelectorAll(selector).forEach((element) => {
                if (!seen.has(element)) {
                    seen.add(element);
                    results.push(element);
                }
            });
        });

        return results;
    };

    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

    const ensureLinkTextColors = () => {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }

        style.textContent = `
app-home-features .map-links-section [data-test-id="Reconstruction_Calculator_Launch"],
app-home-features .map-links-section [data-test-id="Reconstruction_Calculator_Launch"] .launch-icon-text,
app-home-features .map-links-section [data-test-id="Reconstruction_Calculator_Launch"] mat-icon,
.home-feature-wrapper .map-links-section [data-test-id="Reconstruction_Calculator_Launch"],
.home-feature-wrapper .map-links-section [data-test-id="Reconstruction_Calculator_Launch"] .launch-icon-text,
.home-feature-wrapper .map-links-section [data-test-id="Reconstruction_Calculator_Launch"] mat-icon,
.titleAndAddress .map-links-section [data-test-id="Reconstruction_Calculator_Launch"],
.titleAndAddress .map-links-section [data-test-id="Reconstruction_Calculator_Launch"] .launch-icon-text,
.titleAndAddress .map-links-section [data-test-id="Reconstruction_Calculator_Launch"] mat-icon {
    color: ${RECONSTRUCTION_TEXT_COLOR} !important;
}

app-home-features .map-links-section [data-test-id="Zillow_Launch"],
app-home-features .map-links-section [data-test-id="Zillow_Launch"] .launch-icon-text,
app-home-features .map-links-section [data-test-id="Zillow_Launch"] mat-icon,
.home-feature-wrapper .map-links-section [data-test-id="Zillow_Launch"],
.home-feature-wrapper .map-links-section [data-test-id="Zillow_Launch"] .launch-icon-text,
.home-feature-wrapper .map-links-section [data-test-id="Zillow_Launch"] mat-icon,
.titleAndAddress .map-links-section [data-test-id="Zillow_Launch"],
.titleAndAddress .map-links-section [data-test-id="Zillow_Launch"] .launch-icon-text,
.titleAndAddress .map-links-section [data-test-id="Zillow_Launch"] mat-icon {
    color: ${ZILLOW_TEXT_COLOR} !important;
}

app-home-features .map-links-section [data-test-id="Google_Maps_Launch"],
app-home-features .map-links-section [data-test-id="Google_Maps_Launch"] .launch-icon-text,
app-home-features .map-links-section [data-test-id="Google_Maps_Launch"] mat-icon,
.home-feature-wrapper .map-links-section [data-test-id="Google_Maps_Launch"],
.home-feature-wrapper .map-links-section [data-test-id="Google_Maps_Launch"] .launch-icon-text,
.home-feature-wrapper .map-links-section [data-test-id="Google_Maps_Launch"] mat-icon,
.titleAndAddress .map-links-section [data-test-id="Google_Maps_Launch"],
.titleAndAddress .map-links-section [data-test-id="Google_Maps_Launch"] .launch-icon-text,
.titleAndAddress .map-links-section [data-test-id="Google_Maps_Launch"] mat-icon {
    color: ${GOOGLE_MAPS_TEXT_COLOR} !important;
}
`.trim();
    };

    const cssEscape = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(value);
        }

        return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };

    const readElementValue = (element) => {
        if (!element) {
            return '';
        }

        if ('value' in element && typeof element.value === 'string' && element.value.trim()) {
            return element.value.trim();
        }

        if (element.getAttribute) {
            const href = element.getAttribute('href');
            if (href && href !== '#') {
                return href;
            }

            const value = element.getAttribute('value');
            if (value) {
                return value;
            }

            const label = element.getAttribute('aria-label');
            if (label && /\d/.test(label)) {
                return label;
            }
        }

        return normalizeText(element.textContent || '');
    };

    const readElementOwnText = (element) => {
        if (!element) {
            return '';
        }

        const ariaLabel = element.getAttribute && element.getAttribute('aria-label');
        if (ariaLabel) {
            return normalizeText(ariaLabel);
        }

        return normalizeText(
            Array.from(element.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent || '')
                .join(' ')
        );
    };

    const isHomeFeaturesPage = () => window.location.pathname.startsWith(HOME_FEATURES_PATH);

    const findMountElement = () => {
        for (const selector of MOUNT_SELECTORS) {
            const element = document.querySelector(selector);
            if (!element) {
                continue;
            }

            if (element.matches && element.matches('.map-links-section')) {
                return element;
            }

            const mapLinksSection = element.closest('.map-links-section');
            if (mapLinksSection) {
                return mapLinksSection;
            }
        }

        return null;
    };

    const normalizeZipCode = (value) => {
        if (!value) {
            return '';
        }

        const decodedValue = decodeURIComponent(String(value).replace(/\+/g, ' '));
        const caMatch = decodedValue.match(/\bCA\s+(\d{5})(?:-\d{4})?\b/i);
        if (caMatch) {
            return caMatch[1];
        }

        const zipMatches = decodedValue.match(/\b\d{5}(?:-\d{4})?\b/g);
        return zipMatches && zipMatches.length ? zipMatches[zipMatches.length - 1].slice(0, 5) : '';
    };

    const findZipCode = () => {
        const candidates = uniqueElements(ADDRESS_SELECTORS);

        for (const element of candidates) {
            const zipCode = normalizeZipCode(readElementValue(element));
            if (zipCode) {
                return zipCode;
            }
        }

        return '';
    };

    const normalizeSquareFootage = (value) => {
        const text = normalizeText(value).replace(/,/g, '');
        if (!text) {
            return '';
        }

        const numericMatch = text.match(/\b\d{3,5}(?:\.\d+)?\b/);
        if (!numericMatch) {
            return '';
        }

        const numericValue = Number(numericMatch[0]);
        if (!Number.isFinite(numericValue) || numericValue < 300 || numericValue > 30000) {
            return '';
        }

        return String(Math.round(numericValue));
    };

    const hasSquareFootageContext = (element) => {
        if (!element) {
            return false;
        }

        const attributes = [
            element.getAttribute('formcontrolname'),
            element.getAttribute('aria-label'),
            element.getAttribute('name'),
            element.getAttribute('id')
        ];
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
            labelledBy.split(/\s+/).forEach((id) => {
                const label = document.getElementById(id);
                if (label) {
                    attributes.push(label.textContent || '');
                }
            });
        }

        const contextText = attributes.filter(Boolean).join(' ');
        return SQUARE_FOOTAGE_LABEL_PATTERN.test(contextText);
    };

    const findSquareFootageByDirectSelectors = () => {
        const candidates = uniqueElements(DIRECT_SQUARE_FOOTAGE_SELECTORS);

        for (const element of candidates) {
            if (!hasSquareFootageContext(element)) {
                continue;
            }

            const squareFootage = normalizeSquareFootage(readElementValue(element));
            if (squareFootage) {
                return {
                    element,
                    rawValue: readElementValue(element),
                    value: squareFootage
                };
            }
        }

        return null;
    };

    const readFieldValueNearLabel = (labelElement) => {
        const labelledValue = labelElement.id
            ? document.querySelector(`[aria-labelledby~="${cssEscape(labelElement.id)}"]`)
            : null;
        if (labelledValue) {
            const value = readElementValue(labelledValue);
            if (value) {
                return { element: labelledValue, rawValue: value };
            }
        }

        const row = labelElement.closest('.row, .form-row, .mat-mdc-form-field, div') || labelElement.parentElement;
        if (!row) {
            return null;
        }

        const fieldSelectors = [
            'input',
            'textarea',
            'mat-select',
            '.mat-mdc-select-value-text',
            '.mat-mdc-select-min-line',
            '.mat-mdc-input-element',
            '[role="spinbutton"]',
            '[role="textbox"]',
            '[data-test-id]',
            '.section-items',
            '.tui-input-text',
            '.tui-input-text-2'
        ];
        const fields = uniqueElements(fieldSelectors, row).filter((candidate) => candidate !== labelElement);

        for (const field of fields) {
            const value = readElementValue(field);
            if (normalizeSquareFootage(value)) {
                return { element: field, rawValue: value };
            }
        }

        return null;
    };

    const findSquareFootageByLabels = () => {
        const labelCandidates = uniqueElements([
            'label',
            'p',
            'span',
            'div',
            '[id]',
            '[aria-label]',
            '[data-test-id]'
        ]).filter((element) => SQUARE_FOOTAGE_LABEL_PATTERN.test(readElementOwnText(element)));

        for (const labelElement of labelCandidates) {
            const nearbyValue = readFieldValueNearLabel(labelElement);
            if (!nearbyValue) {
                continue;
            }

            const squareFootage = normalizeSquareFootage(nearbyValue.rawValue);
            if (squareFootage) {
                return {
                    element: nearbyValue.element,
                    rawValue: nearbyValue.rawValue,
                    value: squareFootage
                };
            }
        }

        return null;
    };

    const findSquareFootage = () => findSquareFootageByDirectSelectors() || findSquareFootageByLabels();

    const getReconstructionLookup = () => {
        const zipCode = findZipCode();
        const squareFootage = findSquareFootage();

        if (!zipCode || !squareFootage) {
            return {
                zipCode,
                squareFootage,
                url: null
            };
        }

        return {
            zipCode,
            squareFootage,
            url: `${RECONSTRUCTION_BASE_URL}?zipcode=${encodeURIComponent(zipCode)}&squareFootage=${encodeURIComponent(
                squareFootage.value
            )}`
        };
    };

    const createIcon = () => {
        const icon = document.createElement('mat-icon');
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('data-mat-icon-type', 'font');
        icon.className = 'mat-icon notranslate mat-open-new-window-icon material-icons mat-ligature-font mat-icon-no-color';
        icon.textContent = 'open_in_new';
        return icon;
    };

    const createReconstructionLink = () => {
        const link = document.createElement('a');
        link.href = '#';
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = 'opens Reconstruction Calculator in a new window';
        link.setAttribute('data-test-id', 'Reconstruction_Calculator_Launch');
        link.setAttribute(LINK_ATTR, 'true');

        const text = document.createElement('span');
        text.className = 'launch-icon-text';
        text.textContent = 'Reconstruction Calculator';

        link.appendChild(createIcon());
        link.appendChild(text);

        let lastOpenAt = 0;

        const openCalculator = (event) => {
            if (event.button != null && event.button !== 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === 'function') {
                event.stopImmediatePropagation();
            }

            const now = Date.now();
            if (now - lastOpenAt < 700) {
                return;
            }
            lastOpenAt = now;

            const lookup = getReconstructionLookup();
            if (!lookup.url) {
                scheduleSync();
                console.warn('[ALTA Reconstruction Calculator] Missing data', {
                    zipCode: lookup.zipCode || '',
                    squareFootage: lookup.squareFootage ? lookup.squareFootage.value : ''
                });
                window.alert('Reconstruction Calculator needs ZIP code and square footage before it can open.');
                lastOpenAt = 0;
                return;
            }

            const popup = window.open('about:blank', '_blank');
            if (popup) {
                popup.opener = null;
                popup.location.replace(lookup.url);
                return;
            }

            window.open(lookup.url, '_blank', 'noopener');
        };

        link.addEventListener('click', openCalculator, true);

        return link;
    };

    const isRootMountedOnTarget = (root, mountElement) => root && mountElement && root.parentElement === mountElement;

    const getExistingRoot = (mountElement) =>
        Array.from(document.querySelectorAll(`[${ROOT_ATTR}="true"]`)).find((root) => isRootMountedOnTarget(root, mountElement)) || null;

    const refreshButtonState = (root) => {
        const link = root ? root.querySelector(`[${LINK_ATTR}="true"]`) : null;
        if (!link) {
            return;
        }

        const lookup = getReconstructionLookup();
        const hasUrl = Boolean(lookup.url);
        link.href = hasUrl ? lookup.url : '#';
        link.style.opacity = hasUrl ? '' : '0.65';
        link.style.cursor = 'pointer';
        link.setAttribute('aria-disabled', hasUrl ? 'false' : 'true');
        link.title = hasUrl
            ? 'opens Reconstruction Calculator in a new window'
            : 'Click to re-check ZIP code and square footage';
    };

    const removeStaleRoots = (mountElement) => {
        document.querySelectorAll(`[${ROOT_ATTR}="true"]`).forEach((root) => {
            if (!isRootMountedOnTarget(root, mountElement)) {
                root.remove();
            }
        });
    };

    const ensureButton = () => {
        ensureLinkTextColors();

        if (!isHomeFeaturesPage()) {
            removeStaleRoots(null);
            return;
        }

        const mountElement = findMountElement();
        if (!mountElement) {
            return;
        }

        removeStaleRoots(mountElement);

        let root = getExistingRoot(mountElement);
        if (!root) {
            root = document.createElement('div');
            root.setAttribute(ROOT_ATTR, 'true');
            root.appendChild(createReconstructionLink());
            mountElement.appendChild(root);
        }

        refreshButtonState(root);
    };

    let syncScheduled = false;

    function scheduleSync() {
        if (syncScheduled) {
            return;
        }

        syncScheduled = true;

        window.setTimeout(() => {
            syncScheduled = false;
            ensureButton();
        }, SYNC_DELAY_MS);
    }

    const observerTarget = document.body || document.documentElement;
    const observer = new MutationObserver(scheduleSync);
    observer.observe(observerTarget, { childList: true, subtree: true });

    window.addEventListener('load', scheduleSync);
    window.addEventListener('popstate', scheduleSync);
    document.addEventListener('readystatechange', scheduleSync);
    document.addEventListener('input', scheduleSync, true);
    document.addEventListener('change', scheduleSync, true);

    scheduleSync();
})();
