const form = document.getElementById("settingsForm");
const webhookUrl = document.getElementById("webhookUrl");
const sendMode = document.getElementById("sendMode");
const deliveryMode = document.getElementById("deliveryMode");
const remoteConfigUrl = document.getElementById("remoteConfigUrl");
const remoteAuthToken = document.getElementById("remoteAuthToken");
const statusMessage = document.getElementById("statusMessage");
const syncButton = document.getElementById("syncButton");
const refreshDiagnosticsButton = document.getElementById("refreshDiagnosticsButton");
const copyDiagnosticsButton = document.getElementById("copyDiagnosticsButton");
const diagnosticsLog = document.getElementById("diagnosticsLog");

function setStatus(text, tone = "") {
  statusMessage.textContent = text;
  statusMessage.className = `message ${tone}`.trim();
}

async function loadSettings() {
  const response = await sendRuntimeMessage({ type: "GET_SETTINGS" });
  const settings = response.settings || {};

  webhookUrl.value = settings.webhookUrl || "";
  sendMode.value = settings.sendMode === "json" ? "multipart" : settings.sendMode || "multipart";
  deliveryMode.value = ["webApp", "webhook", "both"].includes(settings.deliveryMode)
    ? settings.deliveryMode
    : "webApp";
  remoteConfigUrl.value = settings.remoteConfigUrl || "";
  remoteAuthToken.value = settings.remoteAuthToken || "";
}

function renderDiagnostics(diagnostics) {
  const state = diagnostics?.state || null;
  const latestPdf = diagnostics?.latestPdf || null;
  const log = diagnostics?.log || [];
  const header = {
    state,
    latestPdf
  };
  const lines = log
    .slice(-80)
    .map((entry) => {
      const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
      return `[${entry.time}] ${entry.step}: ${entry.message}${data}`;
    });

  diagnosticsLog.textContent = [
    JSON.stringify(header, null, 2),
    "",
    ...lines
  ].join("\n");
}

async function loadDiagnostics() {
  const diagnostics = await sendRuntimeMessage({ type: "GET_DIAGNOSTICS" });
  renderDiagnostics(diagnostics);
  return diagnostics;
}

function readFormSettings() {
  return {
    webhookUrl: webhookUrl.value.trim(),
    sendMode: sendMode.value,
    deliveryMode: deliveryMode.value,
    remoteConfigUrl: remoteConfigUrl.value.trim(),
    remoteAuthToken: remoteAuthToken.value.trim()
  };
}

async function sendRuntimeMessage(payload) {
  const response = await chrome.runtime.sendMessage(payload);

  if (response?.ok === false) {
    throw new Error(response.error || "Extension request failed.");
  }

  return response;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Saving...");

  try {
    await sendRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings: readFormSettings()
    });
    setStatus("Settings saved.", "success");
  } catch (error) {
    setStatus(error.message || "Could not save settings.", "error");
  }
});

syncButton.addEventListener("click", async () => {
  setStatus("Syncing remote config...");
  syncButton.disabled = true;

  try {
    await sendRuntimeMessage({
      type: "SAVE_SETTINGS",
      settings: readFormSettings()
    });

    const response = await sendRuntimeMessage({ type: "SYNC_REMOTE_CONFIG" });
    setStatus(response.message || "Remote config synced.", "success");
  } catch (error) {
    setStatus(error.message || "Remote sync failed.", "error");
  } finally {
    syncButton.disabled = false;
    await loadSettings();
  }
});

refreshDiagnosticsButton.addEventListener("click", async () => {
  refreshDiagnosticsButton.disabled = true;

  try {
    await loadDiagnostics();
    setStatus("Diagnostics refreshed.", "success");
  } catch (error) {
    setStatus(error.message || "Could not refresh diagnostics.", "error");
  } finally {
    refreshDiagnosticsButton.disabled = false;
  }
});

copyDiagnosticsButton.addEventListener("click", async () => {
  copyDiagnosticsButton.disabled = true;

  try {
    const diagnostics = await loadDiagnostics();
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setStatus("Diagnostics copied.", "success");
  } catch (error) {
    setStatus(error.message || "Could not copy diagnostics.", "error");
  } finally {
    copyDiagnosticsButton.disabled = false;
  }
});

loadSettings().catch((error) => {
  setStatus(error.message || "Could not load settings.", "error");
});

loadDiagnostics().catch(() => {});
