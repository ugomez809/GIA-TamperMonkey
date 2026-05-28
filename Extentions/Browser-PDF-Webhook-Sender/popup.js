const pdfStatus = document.getElementById("pdfStatus");
const tabTitle = document.getElementById("tabTitle");
const tabUrl = document.getElementById("tabUrl");
const message = document.getElementById("message");
const latestFound = document.getElementById("latestFound");
const latestFileName = document.getElementById("latestFileName");
const latestSize = document.getElementById("latestSize");
const latestCapturedAt = document.getElementById("latestCapturedAt");
const latestSourceMode = document.getElementById("latestSourceMode");
const latestSourceUrl = document.getElementById("latestSourceUrl");
const sendLatestButton = document.getElementById("sendLatestButton");
const sendCurrentButton = document.getElementById("sendCurrentButton");
const stopWatchingButton = document.getElementById("stopWatchingButton");
const clearLatestButton = document.getElementById("clearLatestButton");
const settingsButton = document.getElementById("settingsButton");
const copyDiagnosticsButton = document.getElementById("copyDiagnosticsButton");
const diagnosticsLog = document.getElementById("diagnosticsLog");

let currentState = {
  canSendLatestPdf: false,
  canSendCurrentPdf: false,
  canStopWatching: false
};

function setMessage(text, tone = "") {
  message.textContent = text;
  message.className = `message ${tone}`.trim();
}

function setStatus(text, tone) {
  pdfStatus.textContent = text;
  pdfStatus.className = `status ${tone}`;
}

function render(state) {
  currentState = state;

  tabTitle.textContent = state.tab?.title || "Untitled tab";
  tabUrl.textContent = state.tab?.url || "";

  if (state.canSendCurrentPdf) {
    setStatus("Ready", "good");
  } else {
    setStatus("Blocked", "bad");
  }

  if (!state.canSendCurrentPdf) {
    setMessage(state.browserPdfDisabledReason || "Add a webhook URL in settings before sending.", "error");
  } else {
    const modeLabel = getSendModeLabel(state.settings.sendMode);
    setMessage(`Ready. Cached PDFs and current PDFs send only when you click a send button. Mode: ${modeLabel}.`);
  }

  sendLatestButton.disabled = !state.canSendLatestPdf || state.isSending;
  sendCurrentButton.disabled = !state.canSendCurrentPdf || state.isSending;
  stopWatchingButton.disabled = !state.networkCapture?.active || state.isSending;
  clearLatestButton.disabled = !state.latestPdf || state.isSending;

  renderLatestPdf(state.latestPdf);
  renderDiagnostics(state.diagnostics);

  if (state.networkCapture?.active) {
    setStatus("Watching", "good");
    setMessage("GWPC PDF trigger is watching the next PDF response. Sending still requires a button click.", "success");
  }
}

function renderLatestPdf(pdf) {
  if (!pdf) {
    latestFound.textContent = "No";
    latestFileName.textContent = "-";
    latestSize.textContent = "-";
    latestCapturedAt.textContent = "-";
    latestSourceMode.textContent = "-";
    latestSourceUrl.textContent = "-";
    return;
  }

  latestFound.textContent = "Yes";
  latestFileName.textContent = pdf.fileName || "document.pdf";
  latestSize.textContent = formatBytes(pdf.fileSize || 0);
  latestCapturedAt.textContent = formatDateTime(pdf.capturedAt || pdf.foundAt || "");
  latestSourceMode.textContent = pdf.sourceMode || "Universal Manual";
  latestSourceUrl.textContent = pdf.sourceUrl || "-";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getSendModeLabel(sendMode) {
  if (sendMode === "jsonBase64") {
    return "JSON with base64 PDF";
  }

  if (sendMode === "rawPdf") {
    return "raw PDF bytes";
  }

  return "multipart PDF upload";
}

function renderDiagnostics(diagnostics) {
  const log = diagnostics?.log || [];

  if (!log.length) {
    diagnosticsLog.textContent = "No events yet.";
    return;
  }

  diagnosticsLog.textContent = log
    .slice(-40)
    .map((entry) => {
      const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
      return `[${entry.time}] ${entry.step}: ${entry.message}${data}`;
    })
    .join("\n");
}

async function sendRuntimeMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);

  if (response?.ok === false) {
    throw new Error(response.error || "Extension request failed.");
  }

  return response;
}

async function loadState() {
  try {
    const state = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    render(state);
  } catch (error) {
    setStatus("Error", "bad");
    setMessage(error.message || "Could not inspect the active tab.", "error");
  }
}

function setBusy(isBusy) {
  sendLatestButton.disabled = isBusy || !currentState.canSendLatestPdf;
  sendCurrentButton.disabled = isBusy || !currentState.canSendCurrentPdf;
  stopWatchingButton.disabled = isBusy || !currentState.networkCapture?.active;
  clearLatestButton.disabled = isBusy || !currentState.latestPdf;
}

sendLatestButton.addEventListener("click", async () => {
  setBusy(true);
  setMessage("Sending latest cached PDF...");

  try {
    const result = await sendRuntimeMessage({ type: "SEND_LATEST_PDF" });

    setStatus("Sent", "good");
    setMessage(result.message || "Latest PDF sent successfully.", "success");
    await loadState();
  } catch (error) {
    setStatus("Error", "bad");
    setMessage(error.message || "Could not send the latest PDF.", "error");
  } finally {
    setBusy(false);
  }
});

sendCurrentButton.addEventListener("click", async () => {
  setBusy(true);
  setMessage("Finding and sending current tab PDF...");

  try {
    const result = await sendRuntimeMessage({ type: "SEND_BROWSER_PDF" });
    setStatus("Sent", "good");
    setMessage(result.message || "Current PDF sent successfully.", "success");
    await loadState();
  } catch (error) {
    setStatus("Error", "bad");
    setMessage(error.message || "Could not send the current PDF.", "error");
  } finally {
    setBusy(false);
  }
});

stopWatchingButton.addEventListener("click", async () => {
  setBusy(true);
  setMessage("Stopping GWPC PDF watch...");

  try {
    const result = await sendRuntimeMessage({ type: "STOP_NETWORK_PDF_CAPTURE" });

    setStatus("Ready", "good");
    setMessage(result.message || "PDF watch stopped.", "success");
    await loadState();
  } catch (error) {
    setStatus("Error", "bad");
    setMessage(error.message || "Could not stop watching.", "error");
  } finally {
    setBusy(false);
  }
});

clearLatestButton.addEventListener("click", async () => {
  setBusy(true);

  try {
    const result = await sendRuntimeMessage({ type: "CLEAR_LATEST_PDF" });
    setStatus("Ready", "good");
    setMessage(result.message || "Cached latest PDF cleared.", "success");
    await loadState();
  } catch (error) {
    setStatus("Error", "bad");
    setMessage(error.message || "Could not clear cached PDF.", "error");
  } finally {
    setBusy(false);
  }
});

copyDiagnosticsButton.addEventListener("click", async () => {
  try {
    const diagnostics = await sendRuntimeMessage({ type: "GET_DIAGNOSTICS" });
    const payload = JSON.stringify(diagnostics, null, 2);

    await navigator.clipboard.writeText(payload);
    setMessage("Diagnostic log copied.", "success");
  } catch (error) {
    setMessage(error.message || "Could not copy diagnostic log.", "error");
  }
});

settingsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadState();
