# Google Sheet review lookup

Goal: Replace Supabase lookups with automatically refreshed CSV data from the user's shared sheet, gid 0.

Approved direction: automatic sheet downloads, persistent local cache, four-hour refresh, local name matching, last-good-data fallback and manual refresh. All sheet pages are included (Farmers, GIA and blank). No sheet writes.

- [x] Add behavioral Node tests for quoted/multiline CSV, normalized matching, concurrent reads sharing one download, persistent cache, expiry, invalid downloads and retry backoff.
- [x] Implement a self-contained review store within the main userscript. Cache only name, rating, timestamp and review ID; never persist email/comments/responses. Validate headers and reject HTML or empty data. Use a name Map for exact matches and capped local substring search for manual lookup.
- [x] Wire store into existing UI, refresh active results after scheduled/manual downloads, and distinguish unavailable/stale data from verified absence. Preserve SMS draft actions.
- [x] Update main/updater versions, Google connection permissions, persistent-storage grants and old-loader-cache migration. Keep source URLs pointing to ugomez809/GIA-TamperMonkey.
- [x] Run Node behavior/regression tests, syntax checks, live CSV parse/performance smoke check and review the diff. Deliver local script and updater with installation instructions; do not publish to main without authorization.

Validation commands: `node --test "AgencyZoom/Google Review Helper/sheet-reviews.test.js"`; `node "AgencyZoom/Google Review Helper/ulises-google-review-helper.test.js"`; `node --check` on both userscripts; `git diff --check`.
