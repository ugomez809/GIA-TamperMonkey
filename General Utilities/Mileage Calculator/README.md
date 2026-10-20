# Mileage Calculator

- `mileage-calculator-popup.html` contains the calculator UI and calculations.
- `policycenter-mileage-calculator.user.js` adds the option 1 text button beside Annual Miles on vehicle-detail pages and beside Retrieve Purchase Date on Auto Data Prefill. It opens the hosted calculator outside the vehicle-details panel.
- `policycenter-mileage-calculator-updater.user.js` installs once and loads the launcher from this repository, following the Google Review Helper updater's cached-load pattern.

## Install

Install [the Mileage Calculator Updater](https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/General%20Utilities/Mileage%20Calculator/policycenter-mileage-calculator-updater.user.js) in Tampermonkey. Disable the separately installed Hosted Mileage Calculator and earlier design-switcher/placeholder scripts to avoid duplicate buttons. Save any unfinished PolicyCenter draft before reloading. The prototype remains a separate script.

The updater uses the same PolicyCenter hosts as the launcher. It runs the cached launcher immediately and checks GitHub on page load, at most once per 15 minutes. Downloads use the latest commit SHA, with the main-branch raw URL as a fallback. A changed launcher is cached for the next page load; the updater never forces a refresh or replaces an already-running launcher. If GitHub is unavailable, the cached launcher still works. The updater's own metadata also points back to this UGomez repository.

The installer configuration includes the updater with no employee positions assigned. Use the existing Installer manager to assign positions when ready for wider rollout, or use the direct installation link above now.

For troubleshooting, add `mileageUpdaterDebug=1`, `mileageUpdaterForce=1`, or `mileageUpdaterClear=1` to the PolicyCenter URL to log status, force a remote check, or discard the saved launcher before loading, respectively. The shared `staffUpdaterDebug`, `staffUpdaterForce`, and `staffUpdaterClear` flags are also supported. Remove the flag after use.

## Launcher versions

Version 1.1.0 adds automatic iframe sizing, dragging, and remembered position. Update the launcher once to receive these features.

Version 1.1.1 resets older saved coordinates so the initial popup sits 12px beyond the white vehicle-details card, in the gray area. Automatic placement follows the current card boundary; only deliberately dragged or keyboard-moved positions are remembered. Positions saved before 1.1.1 are reset once.

Version 1.2.0 supports Auto Data Prefill on `policycenter.farmersinsurance.com` and `policycenter-2.farmersinsurance.com`. Its toolbar button sits immediately after Retrieve Purchase Date and remains available when the vendor action is disabled. Opening the calculator does not retrieve purchase data or require a vehicle selection. The Annual Miles placement on existing vehicle-detail pages is preserved.

Version 1.3.0 makes Copy miles fill Annual Miles directly. On Auto Data Prefill, check exactly one vehicle before clicking Copy miles. The checkbox selection at the time of the click determines the target, even if selection changed while the calculator was open. Zero or multiple selected vehicles produce an inline message and no field changes. On a vehicle-detail page, the target is the Annual Miles input beside the launcher that opened the calculator.

## Future Google Sheets integration

The updater declares `GM_xmlhttpRequest` and network access to `script.google.com`, `script.googleusercontent.com`, `docs.google.com`, `spreadsheets.google.com`, and `sheets.googleapis.com`. These cover the existing repository's Apps Script approach, its response redirects, and the Sheets API. The launcher loaded by the updater can use that request grant when a future Sheets integration is implemented.

These are Tampermonkey network permissions, not Google account authorization or permission to a particular spreadsheet. No spreadsheet, endpoint, OAuth token, or Google request is configured now, and no results are being sent to Google. Future work must add the chosen destination and its authentication or sharing setup. The embedded calculator does not inherit Tampermonkey APIs; any privileged future request belongs in the parent launcher, using a validated message from the iframe.

## Update the calculator

Edit `mileage-calculator-popup.html` in this folder and commit it to `main`. The existing GitHub Pages workflow automatically publishes it to:

https://ugomez809.github.io/GIA-TamperMonkey/General%20Utilities/Mileage%20Calculator/mileage-calculator-popup.html

After deployment finishes, close and reopen the calculator. Each open loads the hosted HTML with a fresh cache key. Calculator-only changes do not require a userscript update. Keep this file path unchanged.

Embedded mode removes standalone preview margins. A ResizeObserver reports the calculator root's width and height to the launcher, so tab changes and future content changes resize the iframe automatically. Preserve `#gmc-root`, the embedded size-reporting code, and the `gia-mileage:apply` / `gia-mileage:applied` message bridge when editing the calculator. Both sides validate the message origin and sending window. Direct fill requires launcher version 1.3.0 or later.

The first opening uses empty space to the right of the vehicle-details card, or to its left when that space is available. If neither side fits, it opens below the card. Windows larger than the available viewport scroll instead of extending off-screen.

Drag the top title bar to move the popup. Closing it after moving saves its last position in this browser for this PolicyCenter origin, including across page reloads. A manually chosen position takes precedence over automatic placement. Positions are clamped to the current viewport. The focused title bar also supports arrow keys (10px) and Shift+arrow keys (40px).

The userscript does not send customer or vehicle details to the calculator. Copy miles fills only the chosen Annual Miles field and raises input/change events so Guidewire can process the edit. It rejects non-integer/negative values, results longer than the field permits, and read-only/disabled targets. The calculator reports Filled only after the launcher acknowledges the edit. It also attempts the original clipboard copy; browser clipboard permissions may apply. Standalone calculator pages retain clipboard-only behavior. The launcher does not click Save Draft, Quote, or submit the policy.

The iframe can be closed with its close button, by clicking the launcher again, or with Escape inside the calculator or parent page. It closes automatically when PolicyCenter replaces the active vehicle field.

GitHub Pages is provided by `.github/workflows/deploy-updater-installers.yml`; keep the calculator HTML in that workflow's trigger paths and published artifact.

## Verify the updater

Run `node --test "General Utilities/Mileage Calculator/mileage-updater.test.cjs"` from the repository root. The tests cover first install, cached/offline use, deferred updates, commit lookup fallback, invalid downloads, cache clearing, supported hosts, and the permission metadata.
