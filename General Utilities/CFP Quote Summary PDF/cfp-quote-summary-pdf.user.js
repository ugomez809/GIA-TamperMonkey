// ==UserScript==
// @name         CFP Quote Summary PDF
// @namespace    GIA.Scripts
// @version      1.3.13
// @description  Generate a CA FAIR Plan quote summary PDF from the CFP quick quote page
// @author       Mr.G
// @match        https://*.duckcreekondemand.com/*
// @match        https://duckcreekondemand.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/CFP%20Quote%20Summary%20PDF/cfp-quote-summary-pdf.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/CFP%20Quote%20Summary%20PDF/cfp-quote-summary-pdf.user.js
// ==/UserScript==

(function () {
  'use strict';

  const AGENCY = {
    name: 'Ulises Gomez Agency',
    license: '0M96663',
    phone: '(408) 879-9735',
    email: 'ulises@gomezagency.net',
    address: '1514 Moffett St Unit c, Salinas, CA 93905',
    addressLines: ['835 Blossom Hill Rd Ste 107', 'San Jose, CA 95123']
  };

  const COLORS = {
    navy: PDFLib.rgb(0.10, 0.24, 0.42),
    text: PDFLib.rgb(0.10, 0.13, 0.18),
    muted: PDFLib.rgb(0.31, 0.39, 0.50),
    paleBlue: PDFLib.rgb(0.92, 0.95, 0.98),
    stripe: PDFLib.rgb(0.96, 0.98, 0.99),
    border: PDFLib.rgb(0.78, 0.84, 0.90),
    green: PDFLib.rgb(0.08, 0.36, 0.13),
    white: PDFLib.rgb(1, 1, 1)
  };

  const DEDUCTIBLE_OPTIONS = [
    { label: '$5,000', value: '$5000' },
    { label: '$10,000', value: '$10000' },
    { label: '$20,000', value: '$20000' }
  ];

  const GLOSSARY_SECTIONS = [
    {
      title: 'Dwelling (Coverage A)',
      covers: 'Protects the structure of your home, including attached structures like a garage or deck, against covered perils such as fire, lightning, smoke, and internal explosions.',
      excludes: 'It does not cover damage from earthquakes, floods, or wear and tear.'
    },
    {
      title: 'Other Structures (Coverage B)',
      covers: 'Protects detached structures on your property, like sheds, fences, or guest houses, from the same covered perils as your home.',
      excludes: 'It excludes structures used for business purposes.'
    },
    {
      title: 'Personal Property (Coverage C)',
      covers: 'Protects your personal belongings, such as furniture, electronics, and clothing, against specific perils like fire or smoke damage.',
      excludes: 'Does not cover items lost or damaged by theft, water damage, or earthquakes.'
    },
    {
      title: 'Fair Rental Value / Additional Living Expenses (Coverage D/E)',
      covers: 'Provides compensation for lost rental income or temporary housing expenses if a covered peril makes the property uninhabitable.',
      excludes: 'Does not cover loss of income or expenses if the property is uninhabitable for reasons other than covered damages.'
    },
    {
      title: 'Debris Removal',
      covers: 'Pays for the removal of debris following a covered peril, such as clearing burned materials after a fire.',
      excludes: 'Excludes costs related to hazardous materials unless specified.'
    },
    {
      title: 'Improvements, Alterations, and Additions',
      covers: 'Applies when you live in a rented or condo space, covering improvements or alterations you made that are damaged by a covered peril.',
      excludes: 'This does not apply to the full dwelling structure, only to the improvements or changes you made.'
    },
    {
      title: 'Extended Coverage Endorsement',
      covers: 'Adds protection for additional perils like windstorms, hail, riots, and vehicles when struck by a vehicle.',
      excludes: 'This does not include earthquake or flood protection.'
    },
    {
      title: 'Vandalism or Malicious Mischief',
      covers: 'Provides protection against damages caused by vandalism or malicious actions aimed at your property.',
      excludes: 'Theft and intentional acts of the insured are excluded.'
    }
  ];

  const button = document.createElement('button');
  button.innerText = 'Generate Quote';
  Object.assign(button.style, {
    position: 'fixed',
    top: '50%',
    right: '20px',
    transform: 'translateY(-50%)',
    padding: '10px 15px',
    fontSize: '16px',
    backgroundColor: '#ff4d4d',
    color: '#ffffff',
    border: 'none',
    borderRadius: '5px',
    boxShadow: '0px 4px 6px rgba(0, 0, 0, 0.1)',
    cursor: 'pointer',
    display: 'none',
    zIndex: '9999'
  });

  button.addEventListener('mouseover', () => {
    button.style.boxShadow = '0px 6px 10px rgba(0, 0, 0, 0.2)';
  });
  button.addEventListener('mouseout', () => {
    button.style.boxShadow = '0px 4px 6px rgba(0, 0, 0, 0.1)';
  });

  document.body.appendChild(button);

  let premiumCheckInterval = null;
  let deductiblePremiumsPromise = null;
  let queuedGenerateClientName = '';

  function observeCalculatePremiumButton() {
    const calcButton = document.querySelector('[actionref="CalculatePremium"]');
    if (calcButton) {
      calcButton.addEventListener('click', onCalculatePremiumClick);
    } else {
      setTimeout(observeCalculatePremiumButton, 500);
    }
  }
  observeCalculatePremiumButton();

  function onCalculatePremiumClick() {
    if (premiumCheckInterval) {
      clearInterval(premiumCheckInterval);
    }

    premiumCheckInterval = setInterval(() => {
      const premiumValue = readField('data.TotalPremium');
      if (premiumValue) {
        button.style.display = 'inline-block';
        clearInterval(premiumCheckInterval);
      }
    }, 500);
  }

  function monitorPremiumVisibility() {
    button.style.display = readField('data.TotalPremium') ? 'inline-block' : 'none';
  }
  setInterval(monitorPremiumVisibility, 500);

  function observeCompleteApplicationButton() {
    const completeAppBtn = document.querySelector('[actionref="completeAnApplication"]');
    if (completeAppBtn) {
      completeAppBtn.addEventListener('click', () => {
        button.style.display = 'none';
        if (premiumCheckInterval) {
          clearInterval(premiumCheckInterval);
          premiumCheckInterval = null;
        }
      });
    } else {
      setTimeout(observeCompleteApplicationButton, 500);
    }
  }
  observeCompleteApplicationButton();

  const modal = document.createElement('div');
  modal.innerHTML = `
    <div style="background: #ffffff; padding: 18px; border-radius: 8px; width: 340px;
                text-align: left; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
                border: 1px solid #d7dce2;">
      <button id="closeQuoteModal" type="button" aria-label="Close"
              style="float: right; width: 26px; height: 26px; border: none; border-radius: 50%;
                     background: #eef2f7; color: #243b53; font-weight: 700; cursor: pointer;">
        X
      </button>
      <h3 style="margin: 0 0 12px; text-align: center;">Generate Quote Summary</h3>
      <label style="display: block; margin-bottom: 6px; font-weight: 600;">Insured Name</label>
      <input type="text" id="clientNameInput" placeholder="Insured Name"
             style="box-sizing: border-box; width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px;" />
      <div id="deductibleStatus" style="font-size: 12px; color: #44546a; margin-bottom: 12px;">
        Preparing deductible premiums...
      </div>
      <button id="submitClientName"
              style="width: 100%; padding: 10px 15px; background: #007bff; color: #ffffff;
                     border: none; border-radius: 5px; cursor: pointer;">
        Generate
      </button>
    </div>
  `;
  Object.assign(modal.style, {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '10001'
  });
  modal.style.display = 'none';
  document.body.appendChild(modal);

  button.addEventListener('click', () => {
    resetDeductiblePremiumCollection();
    queuedGenerateClientName = '';
    setDeductibleStatus('Preparing deductible premiums...');
    submitButton.disabled = false;
    submitButton.innerText = 'Generate';
    modal.style.display = 'flex';
    setTimeout(() => modal.querySelector('#clientNameInput').focus(), 0);
    setTimeout(() => beginDeductiblePremiumCollection(), 0);
  });

  const submitButton = modal.querySelector('#submitClientName');
  const closeButton = modal.querySelector('#closeQuoteModal');
  closeButton.addEventListener('click', closeQuoteModal);

  modal.querySelector('#clientNameInput').addEventListener('blur', (event) => {
    if (event.relatedTarget === submitButton) return;
    setTimeout(() => keepNameInputFocused(), 0);
  });

  submitButton.addEventListener('click', () => {
    const clientName = modal.querySelector('#clientNameInput').value.trim();
    if (!clientName) {
      alert("Please enter the insured's name.");
      return;
    }

    queueGenerateAfterDeductibles(clientName);
  });

  function setDeductibleStatus(message) {
    const status = modal.querySelector('#deductibleStatus');
    if (status) status.innerText = message;
  }

  async function queueGenerateAfterDeductibles(clientName) {
    if (queuedGenerateClientName) return;
    queuedGenerateClientName = clientName;

    try {
      submitButton.disabled = true;
      submitButton.innerText = 'Queued...';
      setDeductibleStatus('Generate queued. Finishing deductible premiums...');
      if (!deductiblePremiumsPromise) {
        resetDeductiblePremiumCollection();
      }
      const deductiblePremiums = await beginDeductiblePremiumCollection();
      const queuedClientName = queuedGenerateClientName;
      queuedGenerateClientName = '';
      if (!queuedClientName) return;
      modal.style.display = 'none';
      await generatePDF(queuedClientName, deductiblePremiums);
    } catch (error) {
      console.error('[CFP Quote Summary] Unable to collect deductible premiums:', error);
      const queuedClientName = queuedGenerateClientName;
      queuedGenerateClientName = '';
      deductiblePremiumsPromise = null;
      if (queuedClientName) {
        const fallbackPremiums = blankDeductiblePremiums();
        setDeductibleStatus('Deductible premiums unavailable. Downloading quote with blanks.');
        modal.style.display = 'none';
        await generatePDF(queuedClientName, fallbackPremiums);
      } else {
        closeQuoteModal();
      }
    } finally {
      submitButton.disabled = false;
      submitButton.innerText = 'Generate';
    }
  }

  function closeQuoteModal() {
    queuedGenerateClientName = '';
    modal.style.display = 'none';
    submitButton.disabled = false;
    submitButton.innerText = 'Generate';
  }

  function keepNameInputFocused() {
    const input = modal.querySelector('#clientNameInput');
    if (modal.style.display !== 'flex' || !input || document.activeElement === submitButton) return;
    input.focus({ preventScroll: true });
  }

  function readField(fieldref) {
    const el = document.querySelector(`[fieldref="${fieldref}"]`);
    if (!el) return '';

    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return el.checked ? 'Yes' : 'No';
    if (tag === 'select') return el.options?.[el.selectedIndex]?.text || el.value || '';
    return (el.value || el.textContent || '').trim();
  }

  function readRadioField(fieldref) {
    const checked = document.querySelector(`[fieldref="${fieldref}"]:checked`);
    if (!checked) return '--';

    const id = checked.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label?.textContent?.trim()) return label.textContent.trim();
    }

    const parentText = checked.parentElement?.textContent?.trim();
    return parentText || (checked.value || 'Yes');
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitFor(test, timeoutMs = 30000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (test()) return;
      await wait(intervalMs);
    }
    throw new Error('Timed out while waiting for CFP to finish calculating premium.');
  }

  function normalizeDeductible(value) {
    return String(value || '').replace(/[^0-9]/g, '');
  }

  function selectedDeductible() {
    return readField('DeductibleInput.Limit') || document.querySelector('#cb_8_options .nav-link.is-selected')?.textContent?.trim() || '';
  }

  function clickElementLikeUser(element) {
    const rect = element.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      buttons: 1,
      clientX: rect.left + (rect.width / 2),
      clientY: rect.top + (rect.height / 2)
    };

    if (window.PointerEvent) {
      element.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    }
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    if (window.PointerEvent) {
      element.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }));
    }
    element.dispatchEvent(new MouseEvent('mouseup', { ...eventInit, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...eventInit, buttons: 0 }));
  }

  async function selectDeductibleOption(option) {
    if (normalizeDeductible(selectedDeductible()) === normalizeDeductible(option.value)) {
      return false;
    }

    const toggle = document.querySelector('[data-toggle="DeductibleInput.Limit"]');
    const optionLink = Array.from(document.querySelectorAll('#cb_8_options .nav-link'))
      .find((link) => normalizeDeductible(link.textContent) === normalizeDeductible(option.value));

    if (!toggle) throw new Error('Could not find deductible dropdown button.');
    if (!optionLink) throw new Error(`Could not find deductible option: ${option.label}`);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      clickElementLikeUser(toggle);
      await wait(75);
      clickElementLikeUser(optionLink);
      try {
        await waitFor(() => normalizeDeductible(selectedDeductible()) === normalizeDeductible(option.value), 1000, 50);
        keepNameInputFocused();
        return true;
      } catch (error) {
        keepNameInputFocused();
        await wait(150);
      }
    }

    keepNameInputFocused();
    throw new Error(`Could not select deductible option: ${option.label}`);
  }

  async function calculatePremium() {
    const calcButton = document.querySelector('[actionref="CalculatePremium"]');
    if (!calcButton) throw new Error('Could not find Calculate Premium button.');

    const previousPremium = readField('data.TotalPremium');
    const startedAt = Date.now();
    calcButton.click();
    keepNameInputFocused();
    await wait(250);

    await waitFor(() => {
      const currentPremium = readField('data.TotalPremium');
      if (!currentPremium) return false;
      if (currentPremium !== previousPremium) return true;
      if (!isCalculateButtonBusy(calcButton) && Date.now() - startedAt > 1500) return true;
      return Date.now() - startedAt > 20000;
    }, 25000, 100);
    keepNameInputFocused();
  }

  function isCalculateButtonBusy(calcButton) {
    return calcButton.disabled ||
      calcButton.getAttribute('aria-disabled') === 'true' ||
      calcButton.getAttribute('aria-busy') === 'true' ||
      calcButton.classList.contains('is-loading') ||
      calcButton.classList.contains('loading');
  }

  async function collectDeductiblePremiumForOption(option) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const status = modal.querySelector('#deductibleStatus');
        if (status) {
          status.innerText = queuedGenerateClientName
            ? `Generate queued. Calculating ${option.label} deductible...`
            : `Calculating ${option.label} deductible...`;
        }
        keepNameInputFocused();
        const changed = await selectDeductibleOption(option);
        if (changed) await calculatePremium();
        keepNameInputFocused();

        const premium = readField('data.TotalPremium');
        if (!premium) throw new Error(`No premium returned for ${option.label} deductible.`);
        return {
          deductible: option.label,
          premium
        };
      } catch (error) {
        if (attempt === 1) {
          console.warn('[CFP Quote Summary] Deductible premium unavailable:', error);
          return {
            deductible: option.label,
            premium: '',
            error: error.message
          };
        }
        const status = modal.querySelector('#deductibleStatus');
        if (status) status.innerText = `Retrying ${option.label} deductible...`;
        await wait(400);
      }
    }

    return {
      deductible: option.label,
      premium: '',
      error: `Unable to calculate ${option.label} deductible.`
    };
  }

  function blankDeductiblePremiums() {
    return DEDUCTIBLE_OPTIONS.map((option) => ({
      deductible: option.label,
      premium: ''
    }));
  }

  async function collectDeductiblePremiums() {
    const premiums = [];

    for (const option of DEDUCTIBLE_OPTIONS) {
      premiums.push(await collectDeductiblePremiumForOption(option));
    }

    const status = modal.querySelector('#deductibleStatus');
    if (status) {
      status.innerText = queuedGenerateClientName
        ? 'Generate queued. Deductible premiums ready. Downloading...'
        : 'Deductible premiums ready.';
    }
    return premiums;
  }

  function resetDeductiblePremiumCollection() {
    deductiblePremiumsPromise = null;
  }

  function beginDeductiblePremiumCollection() {
    if (!deductiblePremiumsPromise) {
      deductiblePremiumsPromise = collectDeductiblePremiums().catch((error) => {
        resetDeductiblePremiumCollection();
        throw error;
      });
    }
    return deductiblePremiumsPromise;
  }

  function gatherFields(clientName) {
    const address1 = readField('AccountInput.Address1');
    const address2 = readField('AccountInput.Address2');
    const city = readField('AccountInput.City');
    const state = readField('AccountInput.State');
    const zip = readField('AccountInput.ZipCode');

    return {
      insuredName: clientName,
      quoteNumber: readField('PolicyHeaderInput.SearchText') || '--',
      policyPeriod: '12 Months',
      addressLine1: [address1, address2].filter(Boolean).join(' '),
      addressLine2: [city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      yearBuilt: readField('DwellingInput.YearBuilt') || '--',
      occupancy: readField('DwellingInput.Occupancy') || '--',
      locationType: readField('DwellingInput.LocationType') || '--',
      construction: readField('DwellingInput.Construction') || '--',
      numberOfFamilies: readField('DwellingInput.NumberOfFamilies') || '--',
      shortTermRental: readField('DwellingInput.ShortTermRental') || '--',
      isCondoOrApt: readRadioField('DwellingInput.IsCondoOrApt'),
      coveredPeril: readField('DwellingInput.CoveredPeril'),
      dwellingCoverage: readField('CoverageADwellingInput.Limit'),
      otherStructures: readField('CoverageBOtherStructuresInput.LimitQuickQuote'),
      personalProperty: readField('PersonalPropertyInput.Limit'),
      fairRentalValue: readField('FairRentalValueInput.Limit'),
      additionsAlterations: readField('AdditionsAlterationsInput.Limit'),
      permittedIncidentalOccupancy: readField('PermittedIncidentalOccupancyOtherStructuresInput.Limit'),
      ordinanceOrLawCoverage: readField('OrdinanceOrLawInput.Limit'),
      debrisRemoval: readField('DebrisRemovalInput.Limit'),
      fencesMetal: readField('FencesInput.FencesMetal'),
      fencesOther: readField('FencesInput.FencesOther'),
      plantsShrubsTrees: readField('PlantsShrubsAndTreesInput.Limit'),
      awnings: readField('AwningsInput.Limit'),
      signs: readField('SignsInput.Limit'),
      dwellingReplacementCost: readField('ReplacementCostDwellingInput.Indicator'),
      personalPropertyReplacementCost: readField('ReplacementCostContentsInput.Indicator'),
      extendedCoverage: readField('ExtendedDwellingCoverageInput.Indicator'),
      deductible: readField('DeductibleInput.Limit'),
      estimatedPremium: readField('data.TotalPremium')
    };
  }

  function parseMoney(value) {
    const numeric = String(value || '').replace(/[^0-9.-]/g, '');
    if (!numeric) return null;
    const amount = Number(numeric);
    return Number.isFinite(amount) ? amount : null;
  }

  function money(value, options = {}) {
    const amount = parseMoney(value);
    if (amount === null) return options.blank || '--';
    const cents = options.cents ?? false;
    return amount.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0
    });
  }

  function cleanFilePart(value) {
    return String(value || 'Quote').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  }

  function preparedDate(date) {
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function drawText(page, text, x, y, options) {
    const value = String(text ?? '');
    page.drawText(value, { x, y, ...options });
  }

  function drawRight(page, text, rightX, y, options) {
    const value = String(text ?? '');
    const width = options.font.widthOfTextAtSize(value, options.size);
    drawText(page, value, rightX - width, y, options);
  }

  function truncateToWidth(text, font, size, maxWidth) {
    let value = String(text ?? '');
    if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
    while (value.length > 1 && font.widthOfTextAtSize(`${value}...`, size) > maxWidth) {
      value = value.slice(0, -1);
    }
    return `${value}...`;
  }

  function wrappedLines(text, font, size, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';

    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    });

    if (current) lines.push(current);
    return lines;
  }

  function drawSectionHeader(page, title, x, y, width, fonts) {
    page.drawRectangle({ x, y, width, height: 18, color: COLORS.navy });
    drawText(page, title, x + 8, y + 5, {
      size: 9,
      font: fonts.bold,
      color: COLORS.white
    });
  }

  function drawDocumentHeader(page, title, now, fonts, margin) {
    page.drawRectangle({ x: 0, y: 720, width: 612, height: 72, color: COLORS.navy });
    drawText(page, AGENCY.name, margin, 760, {
      size: 19,
      font: fonts.bold,
      color: COLORS.white
    });
    drawText(page, AGENCY.phone, margin, 746, { size: 9, font: fonts.regular, color: COLORS.white });
    drawText(page, AGENCY.email, margin, 734, { size: 9, font: fonts.regular, color: COLORS.white });

    drawRight(page, title, 572, 760, {
      size: 13,
      font: fonts.bold,
      color: COLORS.white
    });
    drawRight(page, `Prepared: ${preparedDate(now)}`, 572, 744, {
      size: 10,
      font: fonts.regular,
      color: COLORS.white
    });
  }

  function drawDocumentFooter(page, title, fonts, margin) {
    const footerHeight = 28;
    page.drawRectangle({ x: 0, y: 0, width: 612, height: footerHeight, color: COLORS.navy });
    drawText(page, `${AGENCY.name}  |  CA License # ${AGENCY.license}  |  ${AGENCY.address}`, margin, 10, {
      size: 7.5,
      font: fonts.regular,
      color: COLORS.white
    });
    drawRight(page, title, 572, 10, {
      size: 8,
      font: fonts.regular,
      color: COLORS.white
    });
    return footerHeight;
  }

  function drawInsuredColumns(page, columns, startY, rowGap, fonts) {
    columns.forEach((column) => {
      column.rows.forEach((row, index) => {
        const y = startY - (index * rowGap);
        const size = row.size || 8;

        if (!row.label) {
          drawText(page, truncateToWidth(row.value, fonts.regular, size, column.width), column.x, y, {
            size,
            font: fonts.regular,
            color: COLORS.text
          });
          return;
        }

        drawText(page, row.label, column.x, y, {
          size,
          font: fonts.bold,
          color: COLORS.muted
        });
        drawText(page, truncateToWidth(row.value, fonts.regular, size, row.valueWidth), column.x + row.labelWidth, y, {
          size,
          font: fonts.regular,
          color: COLORS.text
        });
      });
    });
  }

  function drawRows(page, rows, x, y, width, rowHeight, fonts, options = {}) {
    const bottomY = y - (rows.length - 1) * rowHeight;
    rows.forEach((row, index) => {
      const rowY = y - index * rowHeight;
      if (index % 2 === 1) {
        page.drawRectangle({ x, y: rowY, width, height: rowHeight, color: COLORS.stripe });
      }
      const labelColor = options.labelColor || COLORS.muted;
      const valueColor = row.valueColor || options.valueColor || COLORS.text;
      drawText(page, row.label, x + 8, rowY + 5, {
        size: row.labelSize || 9,
        font: row.labelFont || fonts.regular,
        color: labelColor
      });
      drawRight(page, row.value, x + width - 8, rowY + 5, {
        size: row.valueSize || 9,
        font: row.valueFont || fonts.bold,
        color: valueColor
      });
    });
    page.drawRectangle({
      x,
      y: bottomY,
      width,
      height: rows.length * rowHeight,
      borderColor: COLORS.border,
      borderWidth: 0.6
    });
    return bottomY;
  }

  function drawSectionWithRows(page, title, rows, sectionY, fonts, options = {}) {
    const margin = 40;
    const contentWidth = 532;
    const sectionGap = 20;
    const sectionHeaderHeight = 18;
    const rowHeight = 16;
    drawSectionHeader(page, title, margin, sectionY, contentWidth, fonts);
    const tableBottomY = drawRows(page, rows, margin, sectionY - sectionHeaderHeight, contentWidth, rowHeight, fonts, options);
    return tableBottomY - sectionGap - sectionHeaderHeight;
  }

  function drawWrappedText(page, text, x, y, maxWidth, fonts, options = {}) {
    const size = options.size || 6.6;
    const lineHeight = options.lineHeight || 8.4;
    const font = options.font || fonts.regular;
    const color = options.color || COLORS.text;
    const lines = wrappedLines(text, font, size, maxWidth);
    lines.forEach((line, index) => {
      drawText(page, line, x, y - (index * lineHeight), { size, font, color });
    });
    return y - (lines.length * lineHeight);
  }

  function drawGlossaryEntry(page, entry, x, y, width, height, fonts) {
    page.drawRectangle({ x, y, width, height, color: COLORS.paleBlue });
    page.drawRectangle({ x, y, width, height, borderColor: COLORS.border, borderWidth: 0.6 });
    const titleLines = wrappedLines(entry.title, fonts.bold, 11, width - 16).slice(0, 2);
    titleLines.forEach((line, index) => {
      drawText(page, line, x + 8, y + height - 15 - (index * 10), {
        size: 11,
        font: fonts.bold,
        color: COLORS.navy
      });
    });

    let textY = y + height - 30 - ((titleLines.length - 1) * 10);
    drawText(page, 'What it covers:', x + 8, textY, { size: 9.5, font: fonts.bold, color: COLORS.muted });
    textY = drawWrappedText(page, entry.covers, x + 8, textY - 9, width - 16, fonts, { size: 9, lineHeight: 10.8 });
    drawText(page, "What's not covered:", x + 8, textY - 2, { size: 9.5, font: fonts.bold, color: COLORS.muted });
    drawWrappedText(page, entry.excludes, x + 8, textY - 11, width - 16, fonts, { size: 9, lineHeight: 10.8 });
  }

  function drawGlossaryPage(pdfDoc, fonts, now, margin, contentWidth) {
    const page = pdfDoc.addPage([612, 792]);
    drawDocumentHeader(page, 'California Fair Plan Coverage Glossary', now, fonts, margin);
    drawSectionHeader(page, 'CALIFORNIA FAIR PLAN COVERAGE GLOSSARY', margin, 681, contentWidth, fonts);

    const columnGap = 14;
    const columnWidth = (contentWidth - columnGap) / 2;
    const boxHeight = 129;
    const boxGap = 10;
    const firstBoxTop = 665;

    GLOSSARY_SECTIONS.forEach((entry, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = margin + (column * (columnWidth + columnGap));
      const y = firstBoxTop - boxHeight - (row * (boxHeight + boxGap));
      drawGlossaryEntry(page, entry, x, y, columnWidth, boxHeight, fonts);
    });

    drawDocumentFooter(page, 'California Fair Plan Coverage Glossary', fonts, margin);
  }

  function hasCoveredPeril(fields, token) {
    const peril = fields.coveredPeril.toLowerCase();
    return peril.includes(token);
  }

  function coveredPerilValue(fields, token) {
    return hasCoveredPeril(fields, token) ? 'Yes' : '--';
  }

  function coveredPerilColor(fields, token) {
    return hasCoveredPeril(fields, token) ? COLORS.green : COLORS.muted;
  }

  function isCondoAptYes(fields) {
    return String(fields.isCondoOrApt || '').toLowerCase() === 'yes';
  }

  function deductibleRows(deductiblePremiums) {
    return DEDUCTIBLE_OPTIONS.map((option) => {
      const match = deductiblePremiums.find((row) => row.deductible === option.label);
      return {
        label: option.label,
        value: match?.premium ? money(match.premium, { cents: false }) : '--',
        labelFont: null,
        valueFont: null
      };
    });
  }

  function optionalMoney(...values) {
    const usable = values.find((value) => parseMoney(value) !== null);
    return usable ? money(usable) : '--';
  }

  async function generatePDF(clientName, deductiblePremiums) {
    try {
      const fields = gatherFields(clientName);
      const now = new Date();
      const pdfDoc = await PDFLib.PDFDocument.create();
      const page = pdfDoc.addPage([612, 792]);
      const fonts = {
        regular: await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica),
        bold: await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold)
      };

      const margin = 40;
      const contentWidth = 532;

      drawDocumentHeader(page, 'CA FAIR Plan Quote Summary', now, fonts, margin);

      page.drawRectangle({ x: margin, y: 627, width: contentWidth, height: 84, color: COLORS.paleBlue });
      drawText(page, 'INSURED', margin + 8, 696, { size: 9, font: fonts.bold, color: COLORS.navy });
      const insuredColumnWidth = contentWidth / 3;
      const insuredColumns = [
        {
          x: margin + 8,
          width: insuredColumnWidth - 16,
          rows: [
            { value: fields.insuredName, size: 9 },
            { value: fields.addressLine1, size: 8 },
            { value: fields.addressLine2, size: 8 },
            { label: 'Year Built:', value: fields.yearBuilt, labelWidth: 50, valueWidth: 95, size: 8 }
          ]
        },
        {
          x: margin + insuredColumnWidth + 8,
          width: insuredColumnWidth - 16,
          rows: [
            { label: 'Quote #:', value: fields.quoteNumber, labelWidth: 42, valueWidth: 105, size: 8 },
            { label: 'Policy Period:', value: fields.policyPeriod, labelWidth: 62, valueWidth: 86, size: 8 },
            { label: 'Occupancy:', value: fields.occupancy, labelWidth: 58, valueWidth: 90, size: 8 },
            { label: 'Location Type:', value: fields.locationType, labelWidth: 66, valueWidth: 82, size: 8 }
          ]
        },
        {
          x: margin + (insuredColumnWidth * 2) + 8,
          width: insuredColumnWidth - 16,
          rows: [
            { label: 'Construction:', value: fields.construction, labelWidth: 62, valueWidth: 86, size: 8 },
            { label: 'Families:', value: fields.numberOfFamilies, labelWidth: 42, valueWidth: 106, size: 8 },
            { label: 'Short Term Rental:', value: fields.shortTermRental, labelWidth: 76, valueWidth: 72, size: 8 },
            { label: 'Condo/Apt:', value: fields.isCondoOrApt, labelWidth: 50, valueWidth: 98, size: 8 }
          ]
        }
      ];
      drawInsuredColumns(page, insuredColumns, 681, 13, fonts);

      let sectionY = 599;
      const dwellingCoverageLimitRows = [
        { label: 'Dwelling (Coverage A)', value: money(fields.dwellingCoverage) },
        { label: 'Other Structures (Coverage B)', value: money(fields.otherStructures) },
        { label: 'Personal Property (Coverage C)', value: money(fields.personalProperty) },
        { label: 'Fair Rental Value (Coverage D)', value: money(fields.fairRentalValue) },
        { label: 'Ordinance or Law', value: money(fields.ordinanceOrLawCoverage) },
        { label: 'Debris Removal', value: money(fields.debrisRemoval) },
        { label: 'Fences', value: optionalMoney(fields.fencesMetal, fields.fencesOther) },
        { label: 'Plants, Shrubs & Trees', value: money(fields.plantsShrubsTrees) },
        { label: 'Awnings', value: money(fields.awnings) },
        { label: 'Signs', value: money(fields.signs) }
      ];
      const condoCoverageLimitRows = [
        { label: 'Improvements, Alterations & Additions', value: money(fields.additionsAlterations) },
        { label: 'Personal Property (Coverage C)', value: money(fields.personalProperty) },
        { label: 'Fair Rental Value (Coverage D)', value: money(fields.fairRentalValue) },
        { label: 'Permitted Incidental Occupancy', value: money(fields.permittedIncidentalOccupancy) },
        { label: 'Ordinance or Law', value: money(fields.ordinanceOrLawCoverage) },
        { label: 'Debris Removal', value: money(fields.debrisRemoval) }
      ];
      const coverageLimitRows = isCondoAptYes(fields) ? condoCoverageLimitRows : dwellingCoverageLimitRows;
      sectionY = drawSectionWithRows(page, 'COVERAGE LIMITS', coverageLimitRows, sectionY, fonts);

      sectionY = drawSectionWithRows(page, 'ENDORSEMENTS & OPTIONS', [
        {
          label: 'Dwelling Replacement Cost',
          value: fields.dwellingReplacementCost === 'Yes' ? 'Included' : '--',
          valueColor: fields.dwellingReplacementCost === 'Yes' ? COLORS.green : COLORS.muted
        },
        { label: 'Inflation Guard', value: 'Included', valueColor: COLORS.green },
        {
          label: 'Personal Property Replacement Cost',
          value: fields.personalPropertyReplacementCost === 'Yes' ? 'Included' : '--',
          valueColor: fields.personalPropertyReplacementCost === 'Yes' ? COLORS.green : COLORS.muted
        }
      ], sectionY, fonts);

      sectionY = drawSectionWithRows(page, 'COVERED PERILS', [
        {
          label: 'Fire or Lightning',
          value: coveredPerilValue(fields, 'fire'),
          valueColor: coveredPerilColor(fields, 'fire')
        },
        {
          label: 'Internal Explosion & Smoke Damage',
          value: coveredPerilValue(fields, 'ece'),
          valueColor: coveredPerilColor(fields, 'ece')
        },
        {
          label: 'Extended Coverages',
          value: coveredPerilValue(fields, 'ece'),
          valueColor: coveredPerilColor(fields, 'ece')
        },
        {
          label: 'Vandalism or Malicious Mischief',
          value: coveredPerilValue(fields, 'vmm'),
          valueColor: coveredPerilColor(fields, 'vmm')
        }
      ], sectionY, fonts);

      const sectionHeaderHeight = 18;
      drawSectionHeader(page, 'DEDUCTIBLE OPTIONS & ANNUAL PREMIUMS', margin, sectionY, contentWidth, fonts);
      const deductibleSubheaderY = sectionY - sectionHeaderHeight;
      page.drawRectangle({ x: margin, y: deductibleSubheaderY, width: contentWidth, height: 16, color: PDFLib.rgb(0.90, 0.93, 0.97) });
      drawText(page, 'Deductible', margin + 8, deductibleSubheaderY + 5, { size: 9, font: fonts.bold, color: COLORS.navy });
      drawRight(page, 'Annual Premium', margin + contentWidth - 8, deductibleSubheaderY + 5, {
        size: 9,
        font: fonts.bold,
        color: COLORS.navy
      });

      const deductibles = deductibleRows(deductiblePremiums).map((row) => ({
        ...row,
        labelFont: fonts.bold,
        valueFont: fonts.bold,
        labelSize: 10,
        valueSize: 10
      }));
      drawRows(page, deductibles, margin, deductibleSubheaderY - 16, contentWidth, 16, fonts, { labelColor: COLORS.navy });

      const footerHeight = 28;
      const noticeY = footerHeight + 8;
      page.drawRectangle({ x: margin, y: noticeY, width: contentWidth, height: 56, color: PDFLib.rgb(0.96, 0.98, 1.0) });
      drawText(page, 'IMPORTANT NOTICE', margin + 10, noticeY + 42, {
        size: 8,
        font: fonts.bold,
        color: COLORS.muted
      });
      const notice =
        'This quote summary is for review purposes only and is not a binding insurance contract. Final coverage, terms, and premium are subject to underwriting approval by the California FAIR Plan Association. Multiple deductible options are shown above where available. Please contact your agent to confirm selected coverage.';
      wrappedLines(notice, fonts.regular, 7.5, contentWidth - 20).slice(0, 4).forEach((line, index) => {
        drawText(page, line, margin + 10, noticeY + 28 - index * 10, {
          size: 7.5,
          font: fonts.regular,
          color: COLORS.muted
        });
      });

      drawDocumentFooter(page, 'CA FAIR Plan Quote Summary', fonts, margin);
      drawGlossaryPage(pdfDoc, fonts, now, margin, contentWidth);

      const pdfData = await pdfDoc.save();
      const blob = new Blob([pdfData], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `CFPQQ_${cleanFilePart(clientName)}_${now.toLocaleDateString('en-US').replace(/\//g, '-')}.pdf`;
      link.click();
    } catch (error) {
      console.error('[CFP Quote Summary] Error generating PDF:', error);
      alert('Unable to generate quote summary. Check the browser console for details.');
    }
  }
})();
