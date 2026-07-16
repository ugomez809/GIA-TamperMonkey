# Ricochet Tampermonkey Scripts

Updater installer links:

```text
Ricochet Pickup & Hangup Counters Updater
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Pickup%20%26%20Hangup%20Counters/ricochet-pickup-hangup-counters-updater.user.js

Ricochet Voicemail Lead Watcher Updater
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Voicemail%20Lead%20Watcher/ricochet-voicemail-lead-watcher-updater.user.js
```

Install only the updater for the script each PC needs. Each updater fetches, caches, and runs only the Ricochet script in its folder.

Each updater checks GitHub every 30 seconds while Ricochet is open and reloads once when it finds a script change.

Direct script links:

```text
Ricochet Pickup & Hangup Counters
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Pickup%20%26%20Hangup%20Counters/ricochet-pickup-hangup-counters.user.js

Ricochet Voicemail Lead Watcher
https://raw.githubusercontent.com/ugomez809/GIA-TamperMonkey/main/Ricochet/Voicemail%20Lead%20Watcher/ricochet-voicemail-lead-watcher.user.js
```

Counters roll over at 11:59 PM California time so each day starts from zero.

Counts are stored in Tampermonkey storage, not Ricochet page storage, so clearing Ricochet cache/cookies should not reset them.

Report payloads include `submittedBy`, `reportSentBy`, `sentBy`, and `whoSentIt` for webhook table mapping.

Clicking Hang Ups `+` increases both Hang Ups and Pick Ups by one.

The navbar block includes a live 12-hour California time clock next to Pick Ups.

The clock uses a small `PT` marker to identify Pacific time.

## Voicemail routing

Ricochet Voicemail Lead Watcher can filter the voicemail dropdown by vendor.

Routing source:

```text
https://docs.google.com/spreadsheets/d/1u4eFoyKGE5j3iKl_PuGg54ftwni4OSnHT1N5Sc_xkLE/edit
```

Sheet name: `Ricochet Voicemail Routing`

Tab name: `Voicemail Routing`

Columns:

```text
Vendor | Group | Active | Notes | Show Reminder
```

`Show Reminder` is optional and defaults to `TRUE` when blank or missing. Set it to `FALSE` to hide only the red "Remember to Leave a Voicemail" box for that vendor. It does not change voicemail filtering or auto-select.

Example for a vendor that should not get the reminder:

```text
everquote-ulises-auto | NoVoicemail | TRUE | No voicemail for this vendor | FALSE
```

Apps Script project:

```text
https://script.google.com/d/1Dm5IsbJH0gfPZdm8UVcXJ6XFDR_eO-WjtWJvET8Jj0WV_COupHtVociQ/edit
```

Web App URL:

```text
https://script.google.com/macros/s/AKfycbxAJWax-LOjK1_3-Caf0ZfzFenma9jtzxiG3wBav3w1hkjXHgnekq6E0zFDRLjeLs2Q/exec
```

The endpoint source is tracked in `Ricochet/Voicemail Lead Watcher/apps-script/Code.js`.
