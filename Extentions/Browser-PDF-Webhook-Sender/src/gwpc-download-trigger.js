(() => {
  const DOWNLOAD_BUTTON_ID = "SubmissionWizard-JobWizardToolsMenuWizardStepSet-MLI_Illustration_ExtScreen-actionableButtonDV-downloadPkId";
  const STATE_KEY = "__pdfWebhookGwpcDownloadTriggerInstalled";
  const SCRIPT_VERSION = "0.25.0";
  const PAGE_HOOK_SCRIPT_ID = "__pdfWebhookGwpcPageHookScript";
  const ARM_STALE_MS = 30000;
  const CLICK_ARM_WAIT_MS = 1800;
  const EVENT_HANDLED_KEY = "__pdfWebhookGwpcHandled";
  const existing = window[STATE_KEY];

  if (existing?.cleanup) {
    existing.cleanup();
  }

  const state = {
    armAttemptId: "",
    armPromise: null,
    armReady: false,
    armStartedAt: 0,
    replaying: false,
    directButtons: new WeakSet(),
    timers: new Set(),
    observer: null
  };

  function injectPageHook() {
    if (document.getElementById(PAGE_HOOK_SCRIPT_ID)) {
      return;
    }

    try {
      const script = document.createElement("script");
      script.id = PAGE_HOOK_SCRIPT_ID;
      script.src = chrome.runtime.getURL("src/gwpc-page-hook.js");
      script.async = false;
      script.onload = () => script.remove();
      (document.documentElement || document.head || document.body)?.append(script);
    } catch {
      // Page-hook capture is best-effort; normal click watching still works.
    }
  }

  function now() {
    return Date.now();
  }

  function makeAttemptId() {
    return `${now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getEscapedDownloadButtonId() {
    return globalThis.CSS?.escape
      ? CSS.escape(DOWNLOAD_BUTTON_ID)
      : DOWNLOAD_BUTTON_ID.replace(/"/g, "\\\"");
  }

  function getButtonInfo(button) {
    return {
      pageUrl: location.href,
      pageTitle: document.title || "",
      buttonId: button?.id || "",
      buttonText: (button?.textContent || "").trim().slice(0, 80),
      buttonAction: button?.getAttribute?.("data-gw-click") || "",
      triggerAttemptId: state.armAttemptId || makeAttemptId()
    };
  }

  function isArmFresh() {
    return Boolean(state.armStartedAt) && now() - state.armStartedAt < ARM_STALE_MS;
  }

  function findDownloadButtonFromTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = target;

    if (element.id === DOWNLOAD_BUTTON_ID) {
      return element;
    }

    if (typeof element.closest !== "function") {
      return null;
    }

    return element.closest(`#${getEscapedDownloadButtonId()}`)
      || element.closest("[data-gw-click*='downloadHandler']");
  }

  function findDownloadButton(event) {
    const path = event.composedPath ? event.composedPath() : [];

    for (const target of path) {
      const button = findDownloadButtonFromTarget(target);

      if (button) {
        return button;
      }
    }

    return findDownloadButtonFromTarget(event.target);
  }

  function listDownloadButtons() {
    return Array.from(document.querySelectorAll(
      `#${getEscapedDownloadButtonId()}, [data-gw-click*='downloadHandler']`
    ));
  }

  function schedule(callback, delay) {
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      callback();
    }, delay);

    state.timers.add(timer);
  }

  function sendRuntimeMessage(payload) {
    try {
      const result = chrome.runtime.sendMessage(payload);
      return result?.then ? result : Promise.resolve(result);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function onPageFormSubmit(event) {
    const detail = event.detail || {};

    if (!state.armReady && !isArmFresh()) {
      return;
    }

    sendRuntimeMessage({
      type: "GWPC_FORM_SUBMIT_CAPTURED",
      pageUrl: location.href,
      pageTitle: document.title || "",
      triggerAttemptId: state.armAttemptId || "",
      form: detail
    }).catch(() => {});
  }

  function armWatcher(button, phase) {
    if (!button) {
      return Promise.resolve(false);
    }

    if (state.armPromise && now() - state.armStartedAt < ARM_STALE_MS) {
      return state.armPromise;
    }

    state.armAttemptId = makeAttemptId();
    state.armReady = false;
    state.armStartedAt = now();
    state.armPromise = sendRuntimeMessage({
      type: "GWPC_DOWNLOAD_BUTTON_PREPARE",
      triggerPhase: phase,
      ...getButtonInfo(button)
    }).then((response) => {
      if (response?.ok === false) {
        throw new Error(response.error || "GWPC PDF watcher could not be prepared.");
      }

      state.armReady = true;
      return true;
    }).catch(() => {
      state.armReady = false;
      return false;
    });

    return state.armPromise;
  }

  function waitForArm(button, phase) {
    const armPromise = armWatcher(button, phase);

    return Promise.race([
      armPromise,
      new Promise((resolve) => setTimeout(() => resolve(false), CLICK_ARM_WAIT_MS))
    ]);
  }

  function notifyClicked(button, phase) {
    return sendRuntimeMessage({
      type: "GWPC_DOWNLOAD_BUTTON_CLICKED",
      triggerPhase: phase,
      interceptedClick: phase === "intercepted-click",
      ...getButtonInfo(button)
    }).then((response) => {
      if (response?.ok === false) {
        throw new Error(response.error || "GWPC PDF watcher could not be armed.");
      }

      state.armReady = true;
      return true;
    }).catch(() => false);
  }

  function replayClick(button, originalEvent) {
    state.replaying = true;

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: originalEvent?.detail || 1,
      screenX: originalEvent?.screenX || 0,
      screenY: originalEvent?.screenY || 0,
      clientX: originalEvent?.clientX || 0,
      clientY: originalEvent?.clientY || 0,
      ctrlKey: Boolean(originalEvent?.ctrlKey),
      shiftKey: Boolean(originalEvent?.shiftKey),
      altKey: Boolean(originalEvent?.altKey),
      metaKey: Boolean(originalEvent?.metaKey),
      button: originalEvent?.button || 0,
      buttons: originalEvent?.buttons || 0
    });

    button.dispatchEvent(event);
    schedule(() => {
      state.replaying = false;
    }, 0);
  }

  function onPointerPrep(event) {
    const button = findDownloadButton(event);

    if (button) {
      armWatcher(button, event.type).catch(() => {});
    }
  }

  async function onClick(event) {
    const button = findDownloadButton(event);

    if (!button || state.replaying) {
      return;
    }

    if (event[EVENT_HANDLED_KEY]) {
      return;
    }

    Object.defineProperty(event, EVENT_HANDLED_KEY, {
      value: true
    });

    if (state.armReady && isArmFresh()) {
      notifyClicked(button, "trusted-click").catch(() => {});
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const armed = await waitForArm(button, "intercepted-click");
    await notifyClicked(button, armed ? "intercepted-click" : "intercepted-click-timeout");
    replayClick(button, event);
  }

  async function onKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const button = findDownloadButton(event);

    if (!button || state.replaying) {
      return;
    }

    if (event[EVENT_HANDLED_KEY]) {
      return;
    }

    Object.defineProperty(event, EVENT_HANDLED_KEY, {
      value: true
    });

    event.preventDefault();
    event.stopImmediatePropagation();

    await waitForArm(button, `keydown-${event.key}`);
    await notifyClicked(button, "keyboard-click");
    replayClick(button, event);
  }

  function attachDirectButtonListeners(button) {
    if (!button || state.directButtons.has(button)) {
      return;
    }

    state.directButtons.add(button);
    button.addEventListener("pointerdown", onPointerPrep, true);
    button.addEventListener("mousedown", onPointerPrep, true);
    button.addEventListener("mouseover", onPointerPrep, true);
    button.addEventListener("focus", onPointerPrep, true);
    button.addEventListener("click", onClick, true);
    button.addEventListener("keydown", onKeyDown, true);
    armWatcher(button, "button-visible").catch(() => {});
  }

  function scanForButtons() {
    listDownloadButtons().forEach(attachDirectButtonListeners);
  }

  document.addEventListener("pointerdown", onPointerPrep, true);
  document.addEventListener("mousedown", onPointerPrep, true);
  document.addEventListener("mouseover", onPointerPrep, true);
  document.addEventListener("focus", onPointerPrep, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pdfWebhookGwpcFormSubmit", onPageFormSubmit, true);

  state.observer = new MutationObserver(() => scanForButtons());

  if (document.documentElement) {
    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  injectPageHook();
  scanForButtons();
  schedule(scanForButtons, 500);
  schedule(scanForButtons, 1500);
  schedule(scanForButtons, 3500);

  window[STATE_KEY] = {
    version: SCRIPT_VERSION,
    installedAt: new Date().toISOString(),
    cleanup() {
      document.removeEventListener("pointerdown", onPointerPrep, true);
      document.removeEventListener("mousedown", onPointerPrep, true);
      document.removeEventListener("mouseover", onPointerPrep, true);
      document.removeEventListener("focus", onPointerPrep, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pdfWebhookGwpcFormSubmit", onPageFormSubmit, true);
      state.observer?.disconnect();
      state.timers.forEach((timer) => clearTimeout(timer));
      state.timers.clear();
    }
  };
})();
