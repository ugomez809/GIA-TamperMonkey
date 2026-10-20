# Mileage Calculator

- `mileage-calculator-popup.html` contains the calculator UI and calculations.
- `policycenter-mileage-calculator.user.js` adds the option 1 text button beside Annual Miles in PolicyCenter. It opens the hosted calculator outside the full vehicle-details card.

## Install

Install the userscript in Tampermonkey. Disable the earlier design-switcher/placeholder script to avoid duplicate buttons, then reload PolicyCenter. That prototype remains a separate script.

Version 1.1.0 adds automatic iframe sizing, dragging, and remembered position. Update the launcher once to receive these features.

Version 1.1.1 resets older saved coordinates so the initial popup sits 12px beyond the white vehicle-details card, in the gray area. Automatic placement follows the current card boundary; only deliberately dragged or keyboard-moved positions are remembered. Positions saved before 1.1.1 are reset once.

## Update the calculator

Edit `mileage-calculator-popup.html` in this folder and commit it to `main`. The existing GitHub Pages workflow automatically publishes it to:

https://ugomez809.github.io/GIA-TamperMonkey/General%20Utilities/Mileage%20Calculator/mileage-calculator-popup.html

After deployment finishes, close and reopen the calculator. Each open loads the hosted HTML with a fresh cache key. Calculator-only changes do not require a userscript update. Keep this file path unchanged.

Embedded mode removes standalone preview margins. A ResizeObserver reports the calculator root's width and height to the launcher, so tab changes and future content changes resize the iframe automatically. Preserve `#gmc-root` and the embedded size-reporting code when editing the calculator. The parent validates both the message origin and the sending iframe.

The first opening uses empty space to the right of the vehicle-details card, or to its left when that space is available. If neither side fits, it opens below the card. Windows larger than the available viewport scroll instead of extending off-screen.

Drag the top title bar to move the popup. Closing it after moving saves its last position in this browser for this PolicyCenter origin, including across page reloads. A manually chosen position takes precedence over automatic placement. Positions are clamped to the current viewport. The focused title bar also supports arrow keys (10px) and Shift+arrow keys (40px).

The userscript does not send policy information to the calculator or change Annual Miles. The calculator's Copy miles button copies the result for manual entry. Browser clipboard permissions may apply.

The iframe can be closed with its close button, by clicking the launcher again, or with Escape inside the calculator or parent page. It closes automatically when PolicyCenter replaces the active vehicle field.

GitHub Pages is provided by `.github/workflows/deploy-updater-installers.yml`; keep the calculator HTML in that workflow's trigger paths and published artifact.
