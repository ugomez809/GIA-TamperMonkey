(() => {
  const STATE_KEY = "__pdfWebhookAegisQuoteTriggerInstalled";
  const SCRIPT_VERSION = "0.25.0";
  const QUOTE_IFRAME_SELECTOR = "iframe#pdfQuoteIframe";
  const QUOTE_PATH = "/GameChanger/PolicyFrame/Quote/QuotePrintPdf";
  const existing = window[STATE_KEY];

  if (existing?.cleanup) {
    existing.cleanup();
  }

  const state = {
    observer: null,
    seenUrls: new Set(),
    timers: new Set()
  };

  function sendRuntimeMessage(payload) {
    try {
      const result = chrome.runtime.sendMessage(payload);
      return result?.then ? result : Promise.resolve(result);
    } catch {
      return Promise.resolve(null);
    }
  }

  function schedule(callback, delay) {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      callback();
    }, delay);

    state.timers.add(timer);
  }

  function cleanup() {
    state.observer?.disconnect();

    for (const timer of state.timers) {
      clearTimeout(timer);
    }

    state.timers.clear();
  }

  function normalizeQuoteUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
      return "";
    }

    try {
      const parsed = new URL(rawUrl, location.href);

      if (parsed.hostname !== "prod.aegisinsurance.com") {
        return "";
      }

      if (parsed.pathname !== QUOTE_PATH) {
        return "";
      }

      parsed.hash = "";
      return parsed.href;
    } catch {
      return "";
    }
  }

  async function handleQuoteIframe(iframe, triggerSource = "") {
    const quoteUrl = normalizeQuoteUrl(iframe?.getAttribute("src") || iframe?.src || "");

    if (!quoteUrl || state.seenUrls.has(quoteUrl)) {
      return;
    }

    state.seenUrls.add(quoteUrl);

    await sendRuntimeMessage({
      type: "AEGIS_QUOTE_IFRAME_DETECTED",
      version: SCRIPT_VERSION,
      quoteUrl,
      frameUrl: location.href,
      pageTitle: document.title || "",
      iframeId: iframe.id || "",
      iframeSrc: iframe.getAttribute("src") || iframe.src || "",
      triggerSource
    });
  }

  function scan(source) {
    document.querySelectorAll(QUOTE_IFRAME_SELECTOR).forEach((iframe) => {
      handleQuoteIframe(iframe, source).catch(() => {});
    });
  }

  state.observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          if (node?.nodeType !== Node.ELEMENT_NODE) {
            continue;
          }

          if (node.matches?.(QUOTE_IFRAME_SELECTOR)) {
            handleQuoteIframe(node, "added").catch(() => {});
          }

          node.querySelectorAll?.(QUOTE_IFRAME_SELECTOR).forEach((iframe) => {
            handleQuoteIframe(iframe, "added-descendant").catch(() => {});
          });
        }
      }

      if (mutation.type === "attributes" && mutation.target?.matches?.(QUOTE_IFRAME_SELECTOR)) {
        handleQuoteIframe(mutation.target, "src-changed").catch(() => {});
      }
    }
  });

  state.observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"]
  });

  scan("initial");
  schedule(() => scan("after-500ms"), 500);
  schedule(() => scan("after-1500ms"), 1500);
  schedule(() => scan("after-3000ms"), 3000);

  window[STATE_KEY] = {
    version: SCRIPT_VERSION,
    cleanup
  };
})();
