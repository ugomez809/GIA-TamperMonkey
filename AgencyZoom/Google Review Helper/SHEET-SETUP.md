# Google Sheet review helper v0.2.0

Source: https://docs.google.com/spreadsheets/d/1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA/edit?gid=0

The helper reads the public CSV for tab gid 0. Required headers: `Name`, `Timestamp`, `Rating 1-5`. `Review ID` is optional. All GMB Page values are included, including Farmers, GIA and blanks. It does not modify the sheet.

## Install the standalone version for testing

1. Disable **Ulises AgencyZoom Google Review Helper Updater** in Tampermonkey. Run only one copy of the helper to avoid duplicate interfaces and downloads.
2. Create/open **Ulises AgencyZoom Google Review Helper** in Tampermonkey, replace its contents with `ulises-google-review-helper.user.js` from this folder and save. Enable only this main helper, not the updater at the same time.
3. Accept Tampermonkey's Google connection permissions if prompted, then reload AgencyZoom.

The first use downloads the sheet. The helper persists only reviewer names, ratings, dates and IDs in Tampermonkey storage. Emails, comments and AI responses are downloaded as part of Google's CSV but discarded before caching.

Subsequent page reloads reuse the saved list for **four hours**. A lightweight local timer checks expiry every minute on visible AgencyZoom tabs; it does not download the sheet every minute. Returning to a visible tab also checks expiry. There is no background download when AgencyZoom is closed. Each browser/profile has its own cache; simultaneous tabs may independently refresh at expiry, while ordinary navigation reuses stored data.

**Refresh review sheet** forces an immediate download from the SMS helper. Downloads have a 30-second timeout. Automatic failures back off for five minutes and preserve the last successful list. Stale negative results show an unknown/stale status instead of asserting no review; successful matching cached entries remain visible. Empty or malformed CSV never replaces valid cached data.

Automatic matching uses the complete normalized reviewer name. Manual search supports partial names and displays up to eight of at most fifty matches. Name differences can still prevent automatic matching; no name match is not proof a person has never reviewed.

## Staff rollout through the updater

Both `.user.js` files are released together at their existing paths in `ugomez809/GIA-TamperMonkey`. Install/update `ulises-google-review-helper-updater.user.js` version 0.2.0 in Tampermonkey and accept its Google connection permissions, then reload AgencyZoom. Version 0.2.0 adds Google permissions and a fresh code-cache key so cached Supabase code is not executed. With the updated updater installed, disable the standalone helper. An old updater cannot acquire new permissions merely by downloading the new main code, so upgrade/reinstall the updater itself.

## Validation

Run `node --test "AgencyZoom/Google Review Helper/sheet-reviews.test.js"` and `node "AgencyZoom/Google Review Helper/ulises-google-review-helper.test.js"` from the repository root. Also run `node --check` against both userscripts.

Live CSV parsing/indexing was checked against the shared sheet. Actual AgencyZoom/Tampermonkey interaction still needs a browser smoke check: initial load, reload without a new CSV request, manual refresh, existing-review match, no-name-match state, and Service Pipeline markers.
