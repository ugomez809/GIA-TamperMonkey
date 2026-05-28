(() => {
  const STATE_KEY = "__pdfWebhookGwpcPageHookInstalled";
  const SCRIPT_VERSION = "0.25.0";
  const existing = window[STATE_KEY];

  if (existing?.cleanup) {
    existing.cleanup();
  }

  const originalSubmit = HTMLFormElement.prototype.submit;
  const originalRequestSubmit = HTMLFormElement.prototype.requestSubmit;

  function isPolicyCenterUrl(url) {
    try {
      const parsed = new URL(url, location.href);

      return [
        "policycenter.farmersinsurance.com",
        "policycenter-2.farmersinsurance.com",
        "policycenter-3.farmersinsurance.com"
      ].includes(parsed.hostname);
    } catch {
      return false;
    }
  }

  function serializeForm(form, submitter, source) {
    const action = form.getAttribute("action") || location.href;
    const url = new URL(action, location.href).href;
    const method = (form.getAttribute("method") || form.method || "GET").toUpperCase();
    const enctype = form.enctype || form.getAttribute("enctype") || "application/x-www-form-urlencoded";
    const data = new FormData(form);
    const fields = [];
    let hasFile = false;

    if (submitter?.name && !data.has(submitter.name)) {
      data.append(submitter.name, submitter.value || "");
    }

    for (const [name, value] of data.entries()) {
      if (value instanceof File) {
        hasFile = true;
        fields.push({
          name,
          isFile: true,
          fileName: value.name || "",
          contentType: value.type || "",
          size: value.size || 0
        });
      } else {
        fields.push({
          name,
          value: `${value ?? ""}`
        });
      }
    }

    return {
      source,
      url,
      method,
      enctype,
      target: form.target || form.getAttribute("target") || "",
      name: form.getAttribute("name") || "",
      id: form.id || "",
      fieldCount: fields.length,
      hasFile,
      fields,
      capturedAt: new Date().toISOString()
    };
  }

  function notifyFormSubmit(form, submitter, source) {
    if (!form || !isPolicyCenterUrl(location.href)) {
      return;
    }

    let payload;

    try {
      payload = serializeForm(form, submitter, source);
    } catch {
      return;
    }

    if (!isPolicyCenterUrl(payload.url)) {
      return;
    }

    window.dispatchEvent(new CustomEvent("pdfWebhookGwpcFormSubmit", {
      detail: payload
    }));
  }

  function onSubmit(event) {
    notifyFormSubmit(event.target, event.submitter || null, "submit-event");
  }

  HTMLFormElement.prototype.submit = function patchedSubmit() {
    notifyFormSubmit(this, null, "form-submit");
    return originalSubmit.apply(this, arguments);
  };

  if (originalRequestSubmit) {
    HTMLFormElement.prototype.requestSubmit = function patchedRequestSubmit(submitter) {
      notifyFormSubmit(this, submitter || null, "request-submit");
      return originalRequestSubmit.apply(this, arguments);
    };
  }

  document.addEventListener("submit", onSubmit, true);

  window[STATE_KEY] = {
    version: SCRIPT_VERSION,
    installedAt: new Date().toISOString(),
    cleanup() {
      document.removeEventListener("submit", onSubmit, true);
      HTMLFormElement.prototype.submit = originalSubmit;
      if (originalRequestSubmit) {
        HTMLFormElement.prototype.requestSubmit = originalRequestSubmit;
      }
    }
  };
})();
