// ==UserScript==
// @name         Generate-downloadable-quote-from-the-CFP-Platform
// @namespace    GIA.Scripts
// @version      10.3
// @description  Generate a custom PDF with the CFP quick quote
// @author       Mr.G
// @match        https://*.duckcreekondemand.com/*
// @match        https://duckcreekondemand.com/*
// @grant        GM_getResourceText
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js
// @resource     cfpPdf https://gomezagency.net/monkey/resources/CFP-quote-pdf-template-base64.txt
// @updateURL    https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/STAFF%20scripts/CFP%20Quick%20Quote%20PDF/cfpqq.user.js
// @downloadURL  https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/STAFF%20scripts/CFP%20Quick%20Quote%20PDF/cfpqq.user.js
// ==/UserScript==

(function () {
  'use strict';

  /********************************************************
   * 0) LOAD THE PDF BASE64 FROM @RESOURCE
   ********************************************************/
  console.log('[DEBUG] Using GM_getResourceText to load PDF base64.');
  const pdfTemplateBase64 = GM_getResourceText('cfpPdf') || '';
  console.log('[DEBUG] pdfTemplateBase64 length =', pdfTemplateBase64.length);

  if (!pdfTemplateBase64) {
    console.warn('[DEBUG] pdfTemplateBase64 is empty - PDF generation may fail if used.');
  }

  /********************************************************
   * 1) CREATE THE FLOATING "GENERATE QUOTE" BUTTON
   ********************************************************/
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
    display: 'none', // Hidden until condition is met
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

  /********************************************************
   * 2) OBSERVE "CALCULATE PREMIUM" BUTTON & PREMIUM DISPLAY
   ********************************************************/
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
    console.log('[DEBUG] "Calculate Premium" button clicked.');

    if (premiumCheckInterval) {
      clearInterval(premiumCheckInterval);
    }

    // Start monitoring for premium visibility
    premiumCheckInterval = setInterval(() => {
      const premiumField = document.querySelector('[fieldref="data.TotalPremium"]');
      const premiumValue = premiumField?.value?.trim();

      // Show the button if the premium is visible
      if (premiumValue) {
        button.style.display = 'inline-block';
        clearInterval(premiumCheckInterval); // Stop the interval once the premium is visible
      }
    }, 500);
  }

  function monitorPremiumVisibility() {
    const premiumField = document.querySelector('[fieldref="data.TotalPremium"]');
    const premiumValue = premiumField?.value?.trim();

    // Show the button if the premium is visible
    if (premiumValue) {
      button.style.display = 'inline-block';
    } else {
      button.style.display = 'none';
    }
  }

  setInterval(monitorPremiumVisibility, 500); // Check for premium visibility periodically

  /********************************************************
   * 3) OBSERVE "COMPLETE AN APPLICATION" BUTTON
   ********************************************************/
  function observeCompleteApplicationButton() {
    const completeAppBtn = document.querySelector('[actionref="completeAnApplication"]');
    if (completeAppBtn) {
      completeAppBtn.addEventListener('click', () => {
        console.log('[DEBUG] "Complete an Application" clicked. Hiding button.');
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

  /********************************************************
   * 4) CREATE THE MODAL FOR CLIENT NAME
   ********************************************************/
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.5); z-index: 10001;
                display: flex; justify-content: center; align-items: center;">
      <div style="background: #ffffff; padding: 20px; border-radius: 8px; width: 300px; text-align: center;">
        <h3 style="margin-bottom: 10px;">Enter Client's Name</h3>
        <input type="text" id="clientNameInput" placeholder="Client Name"
               style="width: 100%; padding: 8px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 4px;" />
        <button id="submitClientName"
                style="padding: 10px 15px; background: #007bff; color: #ffffff;
                       border: none; border-radius: 5px; cursor: pointer;">
          Submit
        </button>
      </div>
    </div>
  `;
  modal.style.display = 'none';
  document.body.appendChild(modal);

  button.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  const submitButton = modal.querySelector('#submitClientName');
  submitButton.addEventListener('click', () => {
    const clientName = document.querySelector('#clientNameInput').value.trim();
    if (clientName) {
      modal.style.display = 'none';
      generatePDF(clientName);
    } else {
      alert("Please enter the client's name.");
    }
  });

  /********************************************************
   * 5) GENERATE PDF FUNCTION
   ********************************************************/
  async function generatePDF(clientName) {
    try {
      const pdfBytes = Uint8Array.from(atob(pdfTemplateBase64), (c) => c.charCodeAt(0));
      const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
      const helveticaBoldFont = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      const [firstPage] = pdfDoc.getPages();

      const fields = gatherFields();
      const currentDate = new Date().toLocaleDateString('en-US');

      firstPage.drawText(`${currentDate}`, { x: 110, y: 627, size: 12 });
      firstPage.drawText(`${clientName}`, { x: 180, y: 600, size: 12 });
      firstPage.drawText(`${fields.address}`, { x: 170, y: 572, size: 11 });
      firstPage.drawText(`${fields.occupancyType}`, { x: 210, y: 545, size: 12 });
      firstPage.drawText(`${fields.dwellingCoverage}`, { x: 255, y: 512, size: 14 });
      firstPage.drawText(`${fields.deductible}`, { x: 190, y: 483, size: 14 });
      firstPage.drawText(`${fields.extendedCoverage}`, { x: 330, y: 455, size: 14 });
      firstPage.drawText(`${fields.otherStructures}`, { x: 240, y: 428, size: 14 });
      firstPage.drawText(`${fields.personalProperty}`, { x: 248, y: 400, size: 14 });
      firstPage.drawText(`${fields.fairRentalValue}`, { x: 240, y: 372, size: 14 });
      firstPage.drawText(`${fields.ordinanceOrLawCoverage}`, { x: 247, y: 346, size: 14 });
      firstPage.drawText(`${fields.debrisRemoval}`, { x: 228, y: 317, size: 14 });
      firstPage.drawText(`${fields.totalCoverageLimit}`, { x: 262, y: 278, size: 14 });

      firstPage.drawText(`${fields.estimatedPremium}`, {
        x: 330,
        y: 215,
        size: 18,
        font: helveticaBoldFont
      });

      const pdfData = await pdfDoc.save();
      const blob = new Blob([pdfData], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `CFPQQ_${clientName}_${currentDate}.pdf`;
      link.click();
    } catch (error) {
      console.error('[DEBUG] Error generating PDF:', error);
    }
  }

  function gatherFields() {
    const address = `${document.querySelector('[fieldref="AccountInput.Address1"]')?.value || ''} ${
      document.querySelector('[fieldref="AccountInput.Address2"]')?.value || ''}, ${
      document.querySelector('[fieldref="AccountInput.City"]')?.value || ''}, ${
      document.querySelector('[fieldref="AccountInput.State"]')?.value || ''} ${
      document.querySelector('[fieldref="AccountInput.ZipCode"]')?.value || ''}`.trim();

    return {
      address,
      occupancyType: document.querySelector('[fieldref="DwellingInput.Occupancy"]')?.value || '',
      dwellingCoverage: document.querySelector('[fieldref="CoverageADwellingInput.Limit"]')?.value || '',
      deductible: document.querySelector('[fieldref="DeductibleInput.Limit"]')?.value || '',
      extendedCoverage: document.querySelector('[fieldref="ExtendedDwellingCoverageInput.Indicator"]')?.checked ? 'Yes' : 'No',
      otherStructures: document.querySelector('[fieldref="CoverageBOtherStructuresInput.LimitQuickQuote"]')?.value || '',
      personalProperty: document.querySelector('[fieldref="PersonalPropertyInput.Limit"]')?.value || '',
      fairRentalValue: document.querySelector('[fieldref="FairRentalValueInput.Limit"]')?.value || '',
      ordinanceOrLawCoverage: document.querySelector('[fieldref="OrdinanceOrLawInput.Limit"]')?.value || '',
      debrisRemoval: document.querySelector('[fieldref="DebrisRemovalInput.Limit"]')?.value || '',
      totalCoverageLimit: document.querySelector('[fieldref="TotalCoverageLimitInput.TotalCoverageLimitQuickQuote"]')?.value || '',
      estimatedPremium: document.querySelector('[fieldref="data.TotalPremium"]')?.value || ''
    };
  }
})();
