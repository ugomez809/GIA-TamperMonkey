// ==UserScript==
// @name         ALTA Reconstruction Calculator Button
// @namespace    GPG_Scripts
// @version      0.7
// @description  Add Reconstruction Calculator links next to ALTA Google Maps links
// @match        https://alta.farmers.com/*
// @run-at       document-idle
// @grant        none
// @author       Mr.G
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/ALTA/Reconstruction%20Button/alta-reconstruction-button.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SYNC_DELAY_MS = 100;
    const STARTUP_SCAN_INTERVAL_MS = 300;
    const STARTUP_SCAN_DURATION_MS = 20000;
    const RECONSTRUCTION_BASE_URL = 'https://gomezagency.net/zipcodes.html';
    const ROOT_ATTR = 'data-gpg-alta-reconstruction-root';
    const LINK_ATTR = 'data-gpg-alta-reconstruction-link';
    const STYLE_ID = 'gpg-alta-reconstruction-link-colors';
    const RECONSTRUCTION_TEXT_COLOR = '#f97316';
    const ZILLOW_TEXT_COLOR = '#005ea8';
    const GOOGLE_MAPS_TEXT_COLOR = '#188038';

    const HOME_FEATURES_PATH = '/quote/home/home-features';
    const CACHE_STORAGE_KEY = 'gpg.alta.reconstruction.lookupCache.v1';
    const GOOGLE_MAPS_LABEL = 'google maps';
    const GOOGLE_MAPS_SELECTOR = '[data-test-id="Google_Maps_Launch"]';
    const CLICKABLE_SELECTORS = [
        'a',
        'button',
        '[role="button"]',
        '[href]',
        '[onclick]',
        '[data-test-id]'
    ].join(',');
    const MOUNT_SCOPE_SELECTORS = [
        '.map-links-section',
        'app-home-features',
        '.home-feature-wrapper',
        '.titleAndAddress',
        '[class*="map" i]',
        '[class*="link" i]',
        '[class*="action" i]'
    ].join(',');
    const ADDRESS_SELECTORS = [
        'app-home-features .address-line',
        '.home-feature-wrapper .address-line',
        '.titleAndAddress .address-line',
        GOOGLE_MAPS_SELECTOR,
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

    const decodeValue = (value) => {
        const text = String(value || '').replace(/\+/g, ' ');
        try {
            return decodeURIComponent(text);
        } catch (_error) {
            return text;
        }
    };

    const isHomeFeaturesPage = () => window.location.pathname.startsWith(HOME_FEATURES_PATH);

    const readCacheState = () => {
        try {
            const parsed = JSON.parse(window.sessionStorage.getItem(CACHE_STORAGE_KEY) || '{}');
            return {
                activeKey: parsed && typeof parsed.activeKey === 'string' ? parsed.activeKey : '',
                entries: parsed && parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {}
            };
        } catch (_error) {
            return {
                activeKey: '',
                entries: {}
            };
        }
    };

    const writeCacheState = (state) => {
        try {
            window.sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(state));
        } catch (_error) {
            // sessionStorage can be unavailable in locked-down browser contexts.
        }
    };

    const hashText = (value) => {
        let hash = 0;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash = (hash * 31 + text.charCodeAt(index)) | 0;
        }

        return Math.abs(hash).toString(36);
    };

    const ensureLinkTextColors = () => {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(style);
        }

        style.textContent = `
[data-test-id="Reconstruction_Calculator_Launch"],
[data-test-id="Reconstruction_Calculator_Launch"] .launch-icon-text,
[data-test-id="Reconstruction_Calculator_Launch"] mat-icon,
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

[data-test-id="Zillow_Launch"],
[data-test-id="Zillow_Launch"] .launch-icon-text,
[data-test-id="Zillow_Launch"] mat-icon,
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

${GOOGLE_MAPS_SELECTOR},
${GOOGLE_MAPS_SELECTOR} .launch-icon-text,
${GOOGLE_MAPS_SELECTOR} mat-icon,
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

    const isGoogleMapsLaunch = (element) => {
        if (!element || !element.matches) {
            return false;
        }

        if (element.matches(GOOGLE_MAPS_SELECTOR)) {
            return true;
        }

        const label = element.querySelector && element.querySelector('.launch-icon-text');
        return Boolean(label && normalizeText(label.textContent).toLowerCase() === GOOGLE_MAPS_LABEL);
    };

    const findGoogleMapsLaunches = () => {
        const launches = uniqueElements([GOOGLE_MAPS_SELECTOR]);

        document.querySelectorAll('.launch-icon-text').forEach((label) => {
            if (normalizeText(label.textContent).toLowerCase() !== GOOGLE_MAPS_LABEL) {
                return;
            }

            const launch = label.closest(CLICKABLE_SELECTORS);
            if (launch && !launches.includes(launch)) {
                launches.push(launch);
            }
        });

        return launches.filter(isGoogleMapsLaunch);
    };

    const getDirectChildWithin = (ancestor, element) => {
        if (!ancestor || !element || !ancestor.contains(element)) {
            return null;
        }

        let current = element;
        while (current.parentElement && current.parentElement !== ancestor) {
            current = current.parentElement;
        }

        return current.parentElement === ancestor ? current : null;
    };

    const getButtonTarget = (googleMapsLaunch) => {
        const closestMount = googleMapsLaunch.closest(MOUNT_SCOPE_SELECTORS);
        const mountElement = closestMount && closestMount !== googleMapsLaunch ? closestMount : googleMapsLaunch.parentElement;
        const insertionElement = getDirectChildWithin(mountElement, googleMapsLaunch) || googleMapsLaunch;

        if (!mountElement || !insertionElement) {
            return null;
        }

        return {
            googleMapsLaunch,
            mountElement,
            insertionElement
        };
    };

    const normalizeZipCode = (value) => {
        if (!value) {
            return '';
        }

        const decodedValue = decodeValue(value);
        const caMatch = decodedValue.match(/\bCA\s+(\d{5})(?:-\d{4})?\b/i);
        if (caMatch) {
            return caMatch[1];
        }

        const zipMatches = decodedValue.match(/\b\d{5}(?:-\d{4})?\b/g);
        return zipMatches && zipMatches.length ? zipMatches[zipMatches.length - 1].slice(0, 5) : '';
    };

    const findZipCodeInElements = (elements) => {
        const seen = new Set();

        for (const element of elements) {
            if (!element || seen.has(element)) {
                continue;
            }

            seen.add(element);
            const zipCode = normalizeZipCode(readElementValue(element));
            if (zipCode) {
                return zipCode;
            }
        }

        return '';
    };

    const findZipCode = (googleMapsLaunch) => {
        const localCandidates = [];

        if (googleMapsLaunch) {
            localCandidates.push(googleMapsLaunch);

            if (googleMapsLaunch.querySelectorAll) {
                localCandidates.push(...uniqueElements(['[href]', '[aria-label]', '[value]', '.launch-icon-text'], googleMapsLaunch));
            }

            const addressScope =
                googleMapsLaunch.closest('app-home-features, .home-feature-wrapper, .titleAndAddress, form, section') ||
                googleMapsLaunch.parentElement;
            if (addressScope) {
                localCandidates.push(...uniqueElements(ADDRESS_SELECTORS, addressScope));
            }
        }

        return findZipCodeInElements(localCandidates) || findZipCodeInElements(uniqueElements(ADDRESS_SELECTORS));
    };

    const getElementSignatureValues = (element) => {
        if (!element) {
            return [];
        }

        const values = [
            readElementValue(element),
            element.textContent || ''
        ];

        if (element.getAttribute) {
            values.push(
                element.getAttribute('href'),
                element.getAttribute('aria-label'),
                element.getAttribute('title'),
                element.getAttribute('value')
            );
        }

        if (element.querySelectorAll) {
            uniqueElements(['[href]', '[aria-label]', '[title]', '[value]'], element).forEach((child) => {
                values.push(readElementValue(child));
            });
        }

        return values
            .map((value) => normalizeText(decodeValue(value)).toLowerCase())
            .filter((value) => value && (normalizeZipCode(value) || /\d{3,}/.test(value)));
    };

    const getUrlIdentifierKey = () => {
        const params = new URLSearchParams(`${window.location.search || ''}&${(window.location.hash || '').replace(/^#/, '')}`);
        const idNames = [
            'quoteId',
            'quoteID',
            'quote',
            'applicationId',
            'customerId',
            'accountId',
            'policyId',
            'submissionId',
            'sessionId',
            'id'
        ];

        for (const name of idNames) {
            const value = params.get(name);
            if (value && value.length >= 5) {
                return `url:${name}:${hashText(value)}`;
            }
        }

        const routeMatch = window.location.href.match(/\b(?:quote|customer|account|submission|policy|application)[=/:-]+([a-z0-9-]{5,})/i);
        return routeMatch ? `url:route:${hashText(routeMatch[1])}` : '';
    };

    const getCacheKey = (googleMapsLaunch) => {
        const candidates = [];

        if (googleMapsLaunch) {
            candidates.push(googleMapsLaunch);

            const addressScope =
                googleMapsLaunch.closest('app-home-features, .home-feature-wrapper, .titleAndAddress, form, section') ||
                googleMapsLaunch.parentElement;
            if (addressScope) {
                candidates.push(...uniqueElements(ADDRESS_SELECTORS, addressScope));
            }
        }

        for (const candidate of candidates) {
            const signature = getElementSignatureValues(candidate)[0];
            if (signature) {
                return `customer:${hashText(signature)}`;
            }
        }

        return getUrlIdentifierKey() || 'tab';
    };

    const saveLookupCache = (googleMapsLaunch, zipCode, squareFootage) => {
        if (!zipCode || !squareFootage || !squareFootage.value) {
            return null;
        }

        const key = getCacheKey(googleMapsLaunch);
        const state = readCacheState();
        const entry = {
            key,
            zipCode,
            squareFootage: {
                value: squareFootage.value,
                rawValue: squareFootage.rawValue || squareFootage.value
            },
            sourcePath: window.location.pathname,
            source: isHomeFeaturesPage() ? 'home-features' : 'live-page',
            updatedAt: Date.now()
        };

        state.activeKey = key;
        state.entries[key] = entry;
        writeCacheState(state);
        return entry;
    };

    const readLookupCache = (googleMapsLaunch, liveZipCode) => {
        const state = readCacheState();
        const key = getCacheKey(googleMapsLaunch);
        const entry = state.entries[key] || (state.activeKey ? state.entries[state.activeKey] : null);

        if (!entry) {
            return null;
        }

        if (liveZipCode && entry.zipCode && liveZipCode !== entry.zipCode) {
            return null;
        }

        return entry;
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

    const getReconstructionLookup = (googleMapsLaunch) => {
        const liveZipCode = findZipCode(googleMapsLaunch);
        const liveSquareFootage = findSquareFootage();

        if (liveZipCode && liveSquareFootage) {
            saveLookupCache(googleMapsLaunch, liveZipCode, liveSquareFootage);
        }

        const cachedLookup = readLookupCache(googleMapsLaunch, liveZipCode);
        const zipCode = liveZipCode || (cachedLookup ? cachedLookup.zipCode : '');
        const squareFootage =
            liveSquareFootage ||
            (cachedLookup && cachedLookup.squareFootage && cachedLookup.squareFootage.value
                ? {
                      value: cachedLookup.squareFootage.value,
                      rawValue: cachedLookup.squareFootage.rawValue || cachedLookup.squareFootage.value,
                      cached: true
                  }
                : null);

        if (!zipCode || !squareFootage) {
            return {
                zipCode,
                squareFootage,
                cachedLookup,
                url: null
            };
        }

        return {
            zipCode,
            squareFootage,
            cachedLookup,
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

    const createReconstructionLink = (googleMapsLaunch) => {
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

            const lookup = getReconstructionLookup(googleMapsLaunch);
            if (!lookup.url) {
                scheduleSync();
                console.warn('[ALTA Reconstruction Calculator] Missing data', {
                    zipCode: lookup.zipCode || '',
                    squareFootage: lookup.squareFootage ? lookup.squareFootage.value : ''
                });
                window.alert('Reconstruction Calculator needs ZIP code and square footage. Visit Home Features once so the script can save them for this tab.');
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

    const isRootMountedOnTarget = (root, target) =>
        root &&
        target &&
        root.parentElement === target.mountElement &&
        root.previousElementSibling === target.insertionElement;

    const getExistingRoot = (target) => {
        const nextElement = target.insertionElement.nextElementSibling;
        return nextElement && nextElement.getAttribute(ROOT_ATTR) === 'true' ? nextElement : null;
    };

    const refreshButtonState = (root, googleMapsLaunch) => {
        const link = root ? root.querySelector(`[${LINK_ATTR}="true"]`) : null;
        if (!link) {
            return;
        }

        const lookup = getReconstructionLookup(googleMapsLaunch);
        const hasUrl = Boolean(lookup.url);
        link.href = hasUrl ? lookup.url : '#';
        link.style.opacity = hasUrl ? '' : '0.65';
        link.style.cursor = 'pointer';
        link.setAttribute('aria-disabled', hasUrl ? 'false' : 'true');
        link.title = hasUrl
            ? 'opens Reconstruction Calculator in a new window'
            : 'Visit Home Features once so ZIP code and square footage can be saved for this tab';
    };

    const removeStaleRoots = (targets) => {
        document.querySelectorAll(`[${ROOT_ATTR}="true"]`).forEach((root) => {
            if (!targets.some((target) => isRootMountedOnTarget(root, target))) {
                root.remove();
            }
        });
    };

    const ensureButtons = () => {
        ensureLinkTextColors();

        const targets = findGoogleMapsLaunches()
            .map(getButtonTarget)
            .filter(Boolean);

        if (!targets.length) {
            removeStaleRoots([]);
            return;
        }

        removeStaleRoots(targets);

        targets.forEach((target) => {
            let root = getExistingRoot(target);
            if (!root) {
                root = document.createElement('div');
                root.setAttribute(ROOT_ATTR, 'true');
                root.appendChild(createReconstructionLink(target.googleMapsLaunch));
                target.mountElement.insertBefore(root, target.insertionElement.nextSibling);
            }

            refreshButtonState(root, target.googleMapsLaunch);
        });
    };

    let syncScheduled = false;
    let observer = null;
    let startupScanTimer = 0;
    let lastKnownHref = window.location.href;

    function scheduleSync() {
        if (syncScheduled) {
            return;
        }

        syncScheduled = true;

        window.setTimeout(() => {
            syncScheduled = false;
            try {
                ensureButtons();
            } catch (error) {
                console.warn('[ALTA Reconstruction Calculator] Sync failed', error);
            }
        }, SYNC_DELAY_MS);
    }

    function startStartupScan() {
        if (startupScanTimer) {
            return;
        }

        const startedAt = Date.now();
        const scan = () => {
            scheduleSync();

            if (Date.now() - startedAt >= STARTUP_SCAN_DURATION_MS) {
                startupScanTimer = 0;
                return;
            }

            startupScanTimer = window.setTimeout(scan, STARTUP_SCAN_INTERVAL_MS);
        };

        scan();
    }

    function startObserver() {
        const observerTarget = document.body || document.documentElement;
        if (!observerTarget) {
            window.setTimeout(startObserver, SYNC_DELAY_MS);
            return;
        }

        if (!observer) {
            observer = new MutationObserver(() => {
                scheduleSync();
            });
            observer.observe(observerTarget, { childList: true, subtree: true });
        }

        scheduleSync();
        startStartupScan();
    }

    function scheduleAndScan() {
        scheduleSync();
        startStartupScan();
    }

    function startRouteWatcher() {
        window.setInterval(() => {
            if (lastKnownHref === window.location.href) {
                return;
            }

            lastKnownHref = window.location.href;
            scheduleAndScan();
        }, 1000);
    }

    window.addEventListener('load', scheduleAndScan);
    window.addEventListener('pageshow', scheduleAndScan);
    window.addEventListener('popstate', scheduleAndScan);
    window.addEventListener('hashchange', scheduleAndScan);
    window.addEventListener('focus', scheduleSync);
    document.addEventListener('DOMContentLoaded', scheduleAndScan);
    document.addEventListener('readystatechange', scheduleAndScan);
    document.addEventListener('visibilitychange', scheduleSync);
    document.addEventListener('input', scheduleSync, true);
    document.addEventListener('change', scheduleSync, true);

    startObserver();
    startRouteWatcher();
})();
