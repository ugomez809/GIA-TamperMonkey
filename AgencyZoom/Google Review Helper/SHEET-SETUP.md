# Google Sheet review helper v0.4.2

Review sheet: https://docs.google.com/spreadsheets/d/1oAcXoR9E-Qi9P7aJDCGrYLjzS1VLb5ZwEeiBEnUxYNA/edit?gid=0

## Reading and matching

The script downloads public CSV once every hour per browser/profile. A lightweight timer checks expiry on visible tabs; it does not download every minute. Cached data survives reloads. Failed reads retain the last good list and back off for five minutes. No paid review-lookup service is used.

Exact normalized reviewer names and full confirmed names are green. Shared complete name words are yellow. No matching word is red. SMS rows use only a colored left edge; ticket and message backgrounds remain unchanged. Google logos appear beside ticket/SMS names, including unnamed SMS contacts. Unknown contacts show Missing name and retain manual search; a name is required to save a confirmation.

## Shared confirmations in column I

Header: `AgencyZoom Matches`. Each cell contains one confirmed AgencyZoom name per line. Reviewer names and columns A–H remain unchanged. For example, the Selina Perez review can have `Carlos Perez` in I; Carlos then matches that review exactly on every browser's next one-hour pull. Confirmations are name mappings, not proof of identity; customers sharing the same full name cannot be distinguished by this scheme.

- Displayed exact full-name matches are queued automatically, up to 25 in a batch; duplicate observations are combined. Network failures retry after five minutes, up to three attempts per review/name per page session. Already recorded names do not generate new writes.
- A checkmark beside a manual result or hover review confirms it for that customer. Manual search uses the currently open ticket/SMS customer, never the search text. Hover results use the customer whose logo opened the panel.
- The client marks a manual confirmation only after the server acknowledges it. A failed save shows an error and can be retried safely.
- Confirmed aliases offer Undo. Direct full-name matches remain matches and cannot be removed through Undo.
- A successful save updates the current browser immediately. Per-review local acknowledgments carry ordered server revisions, so separate tabs do not overwrite each other’s confirmation cache; an overlapping CSV download cannot discard a save acknowledged while it was in flight. Other browsers receive it on their next regular refresh; this is not a real-time push.
- Keep column I intact when adding new reviews. If the incoming integration overwrites I, saved confirmations will be lost.

## Apps Script service

Project: https://script.google.com/home/projects/1VRbvLMBC5vbBcxHI9LKfgyybazLlwZZ32Ejb3BzLkZE1nRZc6ws_Rgzy/edit

Source: `shared-matches.gs`. Deploy as the owner, access Anyone; the POST handler requires the private `MATCH_WRITE_KEY` Script Property. GET returns service/version health only. The code fixes the target spreadsheet and gid 0 and can write only column I. It locks the read/merge/write operation so simultaneous staff saves preserve existing names. It rejects an unrelated I header, non-exact automatic confirmations, invalid names, changed rows, and ambiguous identical review rows. It identifies reviews by their displayed name/date/rating/comment/page/ID, not a mutable row number. Never put the staff key in the public repository.

## Install the standalone test

1. Disable the Review Helper Updater and any older duplicate main helper.
2. Replace the main helper in Tampermonkey with v0.4.2; save and reload AgencyZoom. Accept its new `script.google.com` connection permission if prompted.
3. The private preconfigured test download initializes the save settings in this helper's Tampermonkey storage. Keep that copy private; it contains the staff save key. Public repository source contains the endpoint URL but no key.
4. When using the public source instead, choose Tampermonkey → Configure shared review saves. Accept the prefilled URL and enter the private staff key.

Configuration is per Tampermonkey script/browser profile. The main helper and updater have separate storage: configure the updater too when switching to it. Cache schema v3 includes column-I confirmations and causes one initial CSV download after upgrading.

## Staff rollout

Main and updater are both v0.4.2. The updater needs reinstall/update because the new save endpoint and configuration menu require new grants. Do not run standalone and updater together. Install the v0.4.2 updater from GitHub, reload AgencyZoom, then use Configure shared review saves to enter the private staff key. The key must be shared privately and is not included in public downloads. Future public main updates retain saved staff configuration.

## Verification

Run all Node tests in this folder, plus syntax checks on both userscripts and `git diff --check`. Tests cover CSV/cache TTL, shared aliases, undo, stale-customer protection, failed writes, batch deduplication, authorization-before-access, write-column limits, ambiguous rows, and locked merging. Live setup on 2026-10-16 verified endpoint health, invalid-key rejection, and an exact Chaelynn Kim confirmation written to I and read back through public CSV. No fabricated customer/review relationship was written to the live sheet.
