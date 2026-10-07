# Ricochet Call Script

Displays the integrated Home/Auto SDR guide in a separate Chrome window and fills it from Ricochet's top Scripts/call boxes. The guide HTML is downloaded automatically from this folder’s `html/sdr-transfer-script.html`; no manual HTML download is needed.

## Install

Install **only the updater** in Tampermonkey:

[Install Ricochet Call Script Updater](https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Call%20Script/ricochet-sdr-sync-updater.user.js)

Disable any earlier standalone copy of this call-script userscript before enabling the updater. Other Ricochet scripts, such as counters and voicemail reminders, can remain enabled.

Allow popups for `https://giainc.ricochet.me` so the guide can open and reopen automatically. Tampermonkey must be allowed to run userscripts on Ricochet and on the guide page at `https://example.com/#tm-auto-shop-script-window`. Set your SDR name when prompted.

## Google Sheet access toggle

The script registers each saved SDR name with the Google Sheet web app in `sdr-script-sheet-webapp.gs`. New names are added to the `SDR Script Access` sheet with `Enabled` set to `TRUE`. Set `Enabled` to `FALSE` for a name to stop that PC from opening the transfer script; setting it back to `TRUE` reenables it on the next check. SDRs cannot change the Sheet URL from the Tampermonkey menu.

## Automatic updates

The updater checks GitHub every 30 seconds, caches the call script in Tampermonkey storage, and can start from the cached copy if GitHub is unavailable. It runs on both the Ricochet page and the guide window. New code is cached immediately; a page reload to apply it waits until no lead box is open. Each updated page reloads once per script version.

The guide checks for a closed window every five seconds. A newly opened lead becomes selected, and the guide asks Ricochet to bring its window forward after filling that lead. Existing open leads remain available in the switcher, with separate temporary notes. Closing or reloading the guide clears its temporary notes.

The Notify Sales Agent button selects the matching agency Teams webhook. The supplied toolbar's Quote form button opens the prefilled Jotform for review; it does not submit the form or trigger the old form webhook. These actions happen only when clicked.

The v17 guide also accepts last name, phone, additional insured, property type, year built, square footage, recent claims, occupation, annual mileage, plumbing, and business-on-property details when available in the selected top lead box. Missing information remains available for manual entry. Agency abbreviations and ISO dates of birth are converted for the quote form.

## Files

- [Main script, v2.5.8](./ricochet-sdr-sync.user.js)
- [Updater, v1.0.0](./ricochet-sdr-sync-updater.user.js)
- [Google Sheet web app source](./sdr-script-sheet-webapp.gs)

The main script has its own GitHub update/download links for direct installations, but the updater above is the recommended installer. Do not enable both installations together.

## Editing the HTML independently

Edit [html/sdr-transfer-script.html](./html/sdr-transfer-script.html) and commit it to GitHub. The guide checks for HTML changes every 30 seconds, subject to GitHub caching, and applies them when no lead box is open. No userscript rebuild or version bump is required for compatible HTML edits. The most recent successfully loaded HTML is cached for offline startup. First installation requires a successful download. Invalid downloads keep the working guide; a template that fails runtime validation rolls back to the previous working HTML when available.

Keep `<meta name="ricochet-sdr-api" content="1">`, the placeholder mappings, and `window.SDR` methods `get`, `fill`, `reset`, `restore`, `setActions`, and `setAgency`. Preserve the `sdr:ready` and `sdr:action` events (action `notify`). The quote button opens Jotform directly from the HTML. Layout, wording, styling, and internal guide behavior can change without changing the userscript. Changes to that integration contract require a corresponding userscript update. Keep CSS/JavaScript inline or use absolute resource URLs; relative paths do not resolve against the GitHub HTML folder.

Existing updater installations already grant GitHub download access and automatically receive v2.5.8 between calls.

## Access-check reliability (v2.5.8)

An already approved guide stays open during a temporary Sheet request failure. The script retries in five seconds and closes the guide if no successful TRUE response arrives within five minutes. A confirmed FALSE still closes it immediately; a fresh page still requires a successful TRUE before opening.

## Sheet access fix (v2.5.7)

The guide opens only after the Sheet confirms `TRUE` for the saved SDR name. A `FALSE` reply closes the guide and clears its visible content. Missing names, failed requests, invalid replies, and outdated replies do not grant access. On a fresh page, the guide stays closed until a successful check. The controller checks every 30 seconds; existing updater installs apply updates when no lead box is open.

## Window clipping fix (v2.5.6)

The guide removes example.com's host styles before building its display. The iframe fills the popup without the host page's top padding, side padding, or width limit. Expanded fields scroll within half the window height so the script remains reachable in short windows. Agency display names are also reapplied consistently for quote-form prefilling.

Verified with 71 unit/integration tests, the Chrome browser regression suite, and 31 Playwright layout checks on the real host page. Layout checks cover resizing, minimizing, maximizing, restoring, narrow/short windows, expanded fields, scrolling, lead switching, and reloads with cached HTML. These checks use the development userscript bridge; they do not replace verification of an installed Tampermonkey copy.

## Remembered window placement

The guide saves its window position and size every 250 ms, on resize, and before closing. A reopened popup restores its own saved placement before tracking starts. Chrome can adjust off-screen placement if the monitor setup changes.


## Original v17 HTML

Version 2.5.1 serves the supplied v17 HTML unchanged, including its toolbar, theme, layout, wording, and quote button. The userscript appends an API adapter at runtime for Ricochet field mapping, temporary lead drafts, and the notification connection. New templates may use the native v17 SDR API (get, fill, reset, setAgency, quoteUrl, and sdr:ready/sdr:notify) instead of the earlier custom marker and methods. The adapter supplies restore and setActions without changing the template file.
