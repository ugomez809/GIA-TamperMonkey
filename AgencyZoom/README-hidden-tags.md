# AgencyZoom Hidden Tags

This project adds a manager-controlled hidden-tag list for AgencyZoom cards.

## Folders

- `Hidden-Tag-Manager/`: manager Tampermonkey script and updater for selecting tags.
- `Producer-Tag-Hider/`: producer Tampermonkey script and updater that hides selected tags.
- `Click-to-Call/`: click-to-call, SMS, email, and note helper script and updater.
- `AI-Follow-Up/`: AI follow-up composer script and updater.
- `google-apps-script/`: Google Apps Script backend for the Google Sheet.

## Google Sheet Setup

1. Create a Google Sheet for the hidden tag registry.
2. Open `Extensions > Apps Script`.
3. Paste `google-apps-script/agencyzoom-hidden-tags.gs` into `Code.gs`.
4. Optional but recommended: add Script properties:
   - `MANAGER_TOKEN`: required for manager writes.
   - `READ_TOKEN`: optional token required for producer reads.
   - `SPREADSHEET_ID`: only needed if the Apps Script is not bound to the Sheet.
5. Run `setupHiddenTagsSheet` once from Apps Script.
6. Deploy as a Web App:
   - Execute as: `Me`
   - Who has access: `Anyone with the link`
7. Copy the `/exec` Web App URL.

## Tampermonkey Setup

Install only the updater for the script each PC actually needs. Each updater is a tiny Tampermonkey script that fetches, caches, and runs one target script from GitHub. This does not depend on Tampermonkey's native update timing for normal script changes.

- Managers install Hidden Tag Manager Updater:
  `https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/Hidden-Tag-Manager/agencyzoom-hidden-tag-manager-updater.user.js`
- Producers install Producer Hide Tags Updater:
  `https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/Producer-Tag-Hider/agencyzoom-producer-hide-tags-updater.user.js`
- Optional helper, Click-to-Call Updater:
  `https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/AgencyZoom/Click-to-Call/agencyzoom-phone-click-to-call-updater.user.js`
- Optional helper, AI Follow-Up Updater:
  `https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/refs/heads/main/AgencyZoom/AI-Follow-Up/agencyzoom-ai-followup-updater.user.js`

Do not install or enable `LOCAL AgencyZoom Master Updater` on office PCs. It is retired and removed from this folder.

Migration from the master updater:

1. Disable or delete `LOCAL AgencyZoom Master Updater`.
2. Disable or delete the direct non-updater AgencyZoom scripts on that PC.
3. Install the per-script updater links needed for that PC.
4. Refresh AgencyZoom.
5. Leave unrelated AgencyZoom scripts disabled unless that PC actually uses them.

`master-uploader.ps1` is still useful in the repo. It is the local publishing tool that bumps versions, checks update URLs in the subfolders, commits, and pushes AgencyZoom scripts to GitHub.

Per-script update model:

- Updating Hidden Tag Manager only updates PCs that installed Hidden Tag Manager Updater.
- Updating Producer Hide Tags only updates PCs that installed Producer Hide Tags Updater.
- Each updater downloads and runs only one target script.
- Each updater checks GitHub every 30 seconds while AgencyZoom is open, caches the newest target script, and reloads once when it finds a change.

In AgencyZoom, use the Tampermonkey menu:

- Manager script:
  - `AZ Tags: Configure Web App URL`
  - `AZ Tags: Set manager token`
  - `AZ Tags: Set read token`, only if `READ_TOKEN` is set
  - `AZ Tags: Open manager panel`

- Producer script:
  - `AZ Hidden Tags: Refresh now`

## How It Works

The manager script stores each selected tag as visible text, a normalized key, and optional AgencyZoom tag attributes. The producer script reads that list on the first AgencyZoom load of each local browser day, caches it locally, and keeps hiding matching tags as cards are dynamically rendered. For the rest of that day, producers use the cached list instead of calling Google again.

Producers can still force an immediate sync from Tampermonkey with `AZ Hidden Tags: Refresh now`.

If AgencyZoom exposes stable tag IDs on the card tags, the scripts also use those IDs. Otherwise, matching is based on normalized tag text.
