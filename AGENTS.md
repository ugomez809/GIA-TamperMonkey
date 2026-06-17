# Repository Ownership Guide

Read this before making changes in either GIA automation repository.

## Source of truth

- Tampermonkey userscripts belong in UGomez: https://github.com/ugomez809/GIA-TamperMonkey
- Browser extensions belong in JanielRosario: https://github.com/JanielRosario/Gia-Extensions

## Rules for agents

- Put `.user.js` Tampermonkey scripts, Tampermonkey updater scripts, and script support docs in the UGomez repository.
- Put Chrome/Edge extension manifests, service workers, content scripts, icons, deployment scripts, and extension docs in the JanielRosario repository.
- Do not add extension folders or extension deployment workflows to UGomez.
- Do not add Tampermonkey script folders to JanielRosario.
- Before editing update metadata, verify `@updateURL`, `@downloadURL`, GitHub API URLs, and raw GitHub URLs point to the correct source-of-truth repository.
- If a future change is found in the wrong repository, move the newest version into the correct repository before making additional edits.

## Archive and updater exceptions

- Treat `BackUps/` as an archive folder. Do not include scripts in `BackUps/` in active script inventories, updater-pair checks, installer pages, or automatic updater creation unless the user explicitly asks to work on backups.
- The following active scripts intentionally do not have updater scripts right now:
  - `AgencyZoom/AI Follow-Up Composer/agencyzoom-ai-follow-up-composer.user.js`
  - `Admins/Spam Guru Risk Ratings/ricochet-spam-guru-risk-ratings.user.js`
  - `PolicyCenter/Reconstruction Calculator/policycenter-reconstruction-button.user.js`
  - `PolicyCenter/Zillow & Google Maps Links/policycenter-zillow-googlemaps.user.js`
