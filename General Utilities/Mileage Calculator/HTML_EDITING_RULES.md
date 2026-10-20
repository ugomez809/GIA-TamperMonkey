# Mileage calculator HTML editing rules

Edit `mileage-calculator-popup.html` in this folder. Its UI, labels, formulas, colors, and layout can change without reinstalling the Tampermonkey launcher, provided the integration contract below is preserved.

- [GitHub folder](https://github.com/ugomez809/GIA-TamperMonkey/tree/main/General%20Utilities/Mileage%20Calculator)
- [HTML source](https://github.com/ugomez809/GIA-TamperMonkey/blob/main/General%20Utilities/Mileage%20Calculator/mileage-calculator-popup.html)
- [Published calculator](https://ugomez809.github.io/GIA-TamperMonkey/General%20Utilities/Mileage%20Calculator/mileage-calculator-popup.html)

## Keep the URL and deployment

Keep the filename, folder, and published URL unchanged. Commit calculator changes to `main` and wait for **Deploy Updater Installer Page** to succeed. The workflow must continue to include this HTML in its trigger paths and Pages artifact. After deployment, close and reopen the calculator to load the new HTML.

A path, hosting-origin, or incompatible message-contract change requires a matching launcher update. The updater's grants are fixed by the installed updater metadata; changing the HTML cannot add Tampermonkey permissions.

## Preserve embedded sizing

1. Keep one outer calculator element with `id="gmc-root"`. Put all visible calculator content, including validation, results, and future panels, inside it. Keep required overlays/popovers inside its measurable bounds, or update the sizing implementation to measure them as well.
2. Preserve `embed=1` detection and the `gmc-embedded` class. Embedded mode must remove the standalone page margins, padding, background, and shadows that would create extra iframe space.
3. Keep a `ResizeObserver` on the root and send an initial size report. Report its actual dimensions again whenever content or tabs resize. Send positive, finite pixel numbers no greater than 10000; the launcher adds its own title bar and border and caps the result to the viewport.
4. Keep embedded dimensions independent of iframe viewport height. Avoid root/body `height:100vh`, `min-height:100vh`, or similar rules that cause a resize feedback loop or extra blank space. Scope widget CSS to `#gmc-root`; keep any preview-only page styles overridden in embedded mode.

```js
window.parent.postMessage({
  type: 'gia-mileage:resize',
  width: Math.ceil(root.getBoundingClientRect().width),
  height: Math.ceil(root.getBoundingClientRect().height)
}, parentOrigin);
```

## Preserve Copy miles and its acknowledgment

Calculate a plain JavaScript whole number, such as `14000`, rather than a formatted string such as `"14,000"`. The launcher requires a nonnegative safe integer and rejects values longer than the target field permits; Auto Data Prefill currently allows six digits.

Send this message when the user clicks Copy miles:

```js
window.parent.postMessage({
  type: 'gia-mileage:apply',
  requestId: ++nextRequest,
  miles: Math.round(calculatedMiles)
}, parentOrigin);
```

`requestId` must be a positive safe integer, unique among requests in that iframe instance. Keep one pending apply request, prevent repeated clicks until it finishes, and retain timeout/error handling so the user can retry.

The parent replies with:

```js
{
  type: 'gia-mileage:applied',
  requestId: 1,
  ok: true, // false if the edit failed
  message: 'Annual Miles filled.'
}
```

Accept a reply only when its request ID matches the pending request. Show **Filled** only after receiving `ok === true`. Show `ok === false` and timeout messages without claiming the field was changed. Keep standalone mode's clipboard-only behavior.

The parent launcher owns the target field: on Auto Data Prefill version 1.4.0+, it is the Annual Miles input beside the button that opened the popup. Checkbox selection does not change that target. The HTML must not choose a row or attempt to access PolicyCenter's DOM across origins.

## Preserve message security and close behavior

- Read and validate `parentOrigin` from the URL as the current code does, and send messages to that exact origin. Never use `'*'` for the message target.
- Before accepting a parent reply, check both `event.origin === parentOrigin` and `event.source === window.parent`. The launcher likewise verifies the hosted calculator's origin and iframe window.
- Preserve Escape handling using `{type:'gia-mileage:close'}` sent to `parentOrigin`. The parent owns the draggable title bar, close button, remembered position, and PolicyCenter field changes.
- Keep JavaScript compatible with an iframe sandboxed with `allow-scripts allow-same-origin`. Avoid top-level navigation, popups, or APIs that require additional sandbox permissions.
- Preserve `data-f`, `data-mode`, `data-panel`, `data-months`, `data-out`, and `data-act` hooks if retaining the current calculator JavaScript. If you rename or remove a hook, update every JavaScript reference in the same HTML. Keep button types, labels, keyboard access, and the status live region working.
- Keep the root's existing `gmc:mileage` custom event when changing the Copy action. It is separate from the required cross-frame apply message; it cannot fill PolicyCenter by itself.
- Google Sheets network permissions are declared on the updater, but the iframe does not inherit `GM_xmlhttpRequest`. A future Sheets integration needs an explicit destination and authentication plus parent-side request code and validated iframe messages. No results are sent to Google by the current integration.

## Check before delivering an HTML change

Use sample vehicles for fill tests. Check both calculator tabs, resizing, Copy/acknowledgment/error messages, standalone clipboard behavior, Escape, dragging, close/reopen, and remembered position. For Auto Data Prefill, open each row's button and verify only that row changes, regardless of checkbox selection. Verify read-only fields and oversized results show errors. Verify a vehicle-list redraw closes the old popup and restores exactly one button per mileage field. Do not submit or quote a customer policy as a test.

For launcher or permission changes, update the corresponding `.user.js` version and test the updater too. Formula/design-only changes that preserve this contract need only the HTML deployment.
