# AgencyZoom Hidden Tags

This project adds a manager-controlled hidden-tag list for AgencyZoom cards.

## Files

- `agencyzoom-hidden-tag-manager.user.js`: manager Tampermonkey script for selecting tags.
- `agencyzoom-producer-hide-tags.user.js`: producer Tampermonkey script that hides selected tags.
- `google-apps-script/agencyzoom-hidden-tags.gs`: Google Apps Script backend for the Google Sheet.

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

For many PCs, install the master updater once:

- `agencyzoom-master-updater.user.js`

The updater checks GitHub for AgencyZoom script changes in the background, caches the newest versions locally, reloads AgencyZoom once when it finds updates, and then runs the updated scripts. Producer PCs default to the `producer` role, so they do not load the manager hidden-tags panel. The updater is silent and does not add Tampermonkey menu commands on producer PCs.

Install individual scripts only if you do not want to use the updater:

- Managers install `agencyzoom-hidden-tag-manager.user.js`.
- Producers install `agencyzoom-producer-hide-tags.user.js`.

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
