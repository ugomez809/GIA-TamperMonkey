# Mileage Calculator

- `mileage-calculator-popup.html` contains the calculator UI and calculations.
- `policycenter-mileage-calculator.user.js` adds the option 1 text button beside Annual Miles in PolicyCenter. It opens the hosted calculator in an iframe beside the field.

## Install

Install the userscript in Tampermonkey. Disable the earlier design-switcher/placeholder script to avoid duplicate buttons, then reload PolicyCenter. That prototype remains a separate script.

## Update the calculator

Edit `mileage-calculator-popup.html` in this folder and commit it to `main`. The existing GitHub Pages workflow automatically publishes it to:

https://ugomez809.github.io/GIA-TamperMonkey/General%20Utilities/Mileage%20Calculator/mileage-calculator-popup.html

After deployment finishes, close and reopen the calculator. Each open loads the hosted HTML with a fresh cache key. Calculator-only changes do not require a userscript update. Keep this file path unchanged.

The userscript does not send policy information to the calculator or change Annual Miles. The calculator's Copy miles button copies the result for manual entry. Browser clipboard permissions may apply.

The iframe can be closed with its close button or by clicking the launcher again. Escape also closes it while focus is in the parent page. It closes automatically when PolicyCenter replaces the active vehicle field.

GitHub Pages is provided by `.github/workflows/deploy-updater-installers.yml`; keep the calculator HTML in that workflow's trigger paths and published artifact.
