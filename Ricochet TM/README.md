# Ricochet Tampermonkey Scripts

Install/update links:

```text
Ricochet Pickup / Hangup Counters
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20Pickup%20Hangup%20Counters/ricochet-counters.user.js

Ricochet Pickup / Hangup Counters Updater
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20Pickup%20Hangup%20Counters/ricochet-counters-updater.user.js

Ricochet VoiceMail Lead Watcher
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20VoiceMail%20Lead%20Watcher/ricochet-voicemail-lead-watcher.user.js

Ricochet VoiceMail Lead Watcher Updater
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet%20TM/Ricochet%20VoiceMail%20Lead%20Watcher/ricochet-voicemail-lead-watcher-updater.user.js
```

Tampermonkey uses the same raw GitHub URL in `@updateURL` and `@downloadURL`.

Each updater checks only the Ricochet script in its folder and opens that script's install/update URL when a new version is available.

Counters roll over at 11:59 PM California time so each day starts from zero.

Counts are stored in Tampermonkey storage, not Ricochet page storage, so clearing Ricochet cache/cookies should not reset them.

Report payloads include `submittedBy`, `reportSentBy`, `sentBy`, and `whoSentIt` for webhook table mapping.

Clicking Hang Ups `+` increases both Hang Ups and Pick Ups by one.

The navbar block includes a live 12-hour California time clock next to Pick Ups.

The clock uses a small `PT` marker to identify Pacific time.
