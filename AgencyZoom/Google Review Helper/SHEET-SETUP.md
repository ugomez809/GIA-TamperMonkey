# Google Sheet review helper v0.4.3

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

Source: `shared-matches.gs`. Deploy as the owner, access Anyone. Match submissions do not require a key; anyone with the endpoint can submit or undo valid name mappings in column I. GET returns service/version health only. The code fixes the target spreadsheet and gid 0 and can write only column I. It locks the read/merge/write operation so simultaneous staff saves preserve existing names. It rejects an unrelated I header, non-exact automatic confirmations, invalid names, changed rows, and ambiguous identical review rows. It identifies reviews by their displayed name/date/rating/comment/page/ID, not a mutable row number. Never put the staff key in the public repository.

## Staff rollout

Install the v0.4.3 updater from GitHub and reload AgencyZoom. No endpoint or staff-key setup is required. Do not run the standalone helper and updater together. The updater includes permission to reach the Apps Script service. Staff still on v0.2.0 need the updater upgrade for that permission.

Deploy the v0.4.3 Apps Script service before publishing the keyless client. Existing keyed clients remain compatible because the server ignores their extra token field. Old locally stored save settings are no longer read.

## Verification

Run all Node tests in this folder, plus syntax checks on both userscripts and `git diff --check`. Tests cover CSV/cache TTL, shared aliases, undo, stale-customer protection, failed writes, batch deduplication, keyless saves and batch validation before access, write-column limits, ambiguous rows, and locked merging. Live setup on 2026-10-16 verified endpoint health, invalid-key rejection, and an exact Chaelynn Kim confirmation written to I and read back through public CSV. No fabricated customer/review relationship was written to the live sheet.
