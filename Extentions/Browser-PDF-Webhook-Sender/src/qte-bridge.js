(() => {
  const READY_SOURCE = "quote-to-email";
  const READY_TYPE = "qte-intake-ready";
  const PDF_SOURCE = "qte-extension";
  const PDF_TYPE = "qte-intake-pdf";
  const PENDING_KEY = "qtePendingPdf";

  window.addEventListener("message", async (event) => {
    if (event.origin !== location.origin) {
      return;
    }

    const data = event.data;

    if (!data || data.source !== READY_SOURCE || data.type !== READY_TYPE) {
      return;
    }

    const stored = await chrome.storage.session.get(PENDING_KEY);
    const pending = stored[PENDING_KEY];

    if (!pending) {
      return;
    }

    if (pending.expiresAtMs && Date.now() > pending.expiresAtMs) {
      await chrome.storage.session.remove(PENDING_KEY);
      return;
    }

    window.postMessage({
      source: PDF_SOURCE,
      type: PDF_TYPE,
      filename: pending.filename || "quote.pdf",
      base64: stripDataUrlPrefix(pending.base64 || "")
    }, location.origin);

    await chrome.storage.session.remove(PENDING_KEY);

    chrome.runtime.sendMessage({
      type: "QTE_PENDING_PDF_DELIVERED",
      filename: pending.filename || "quote.pdf",
      appUrl: location.href
    }).catch(() => {});
  });

  function stripDataUrlPrefix(base64) {
    return `${base64}`.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
  }
})();
