# Ricochet Call Script

Displays the integrated Home/Auto SDR guide in a separate Chrome window and fills it from Ricochet's top Scripts/call boxes. The HTML is embedded; no separate HTML download is needed.

## Install

Install **only the updater** in Tampermonkey:

[Install Ricochet Call Script Updater](https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Call%20Script/ricochet-sdr-sync-updater.user.js)

Disable any earlier standalone copy of this call-script userscript before enabling the updater. Other Ricochet scripts, such as counters and voicemail reminders, can remain enabled.

Allow popups for `https://giainc.ricochet.me` so the guide can open and reopen automatically. Tampermonkey must be allowed to run userscripts on Ricochet and on the guide page at `https://example.com/#tm-auto-shop-script-window`. Set your SDR name when prompted.

## Automatic updates

The updater checks GitHub every 30 seconds, caches the call script in Tampermonkey storage, and can start from the cached copy if GitHub is unavailable. It runs on both the Ricochet page and the guide window. New code is cached immediately; a page reload to apply it waits until no lead box is open. Each updated page reloads once per script version.

The guide checks for a closed window every five seconds. A newly opened lead becomes selected, and the guide asks Ricochet to bring its window forward after filling that lead. Existing open leads remain available in the switcher, with separate temporary notes. Closing or reloading the guide clears its temporary notes.

The Notify Sales Agent button selects the matching agency Teams webhook. The smaller Quoting / Info Form button selects Ricochet's corresponding form webhook. These actions happen only when clicked.

## Files

- [Main script, v2.3.4](./ricochet-sdr-sync.user.js)
- [Updater, v1.0.0](./ricochet-sdr-sync-updater.user.js)

The main script has its own GitHub update/download links for direct installations, but the updater above is the recommended installer. Do not enable both installations together.

