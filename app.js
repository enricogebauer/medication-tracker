const KEYS = {
  config: "medication-tracker-config-v1",
  history: "medication-tracker-history-v1",
  lastBackup: "medication-tracker-last-backup-v1"
};

const state = {
  config: readJson(KEYS.config),
  history: readJson(KEYS.history) || {},
  installPrompt: null
};

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function installHelpHtml() {
  const agent = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(agent);
  const android = /Android/.test(agent);
  const edgeAndroid = /EdgA\//.test(agent);
  const inApp = /FBAN|FBAV|Instagram|Line|WhatsApp|OneDrive|GSA/i.test(agent);

  if (isInstalled()) {
    return "<p>This tracker is already running as an installed app.</p>";
  }
  if (inApp) {
    return `<p>This in-app browser cannot install websites.</p>
      <ol><li>Open the browser menu.</li><li>Choose <strong>Open in Safari</strong> or <strong>Open in Chrome</strong>.</li><li>Return to this page and use its install or home-screen option.</li></ol>`;
  }
  if (ios) {
    return `<ol><li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button.</li><li>Scroll down and tap <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>
      <p class="muted">iPhone and iPad do not display Chrome-style website installation prompts.</p>`;
  }
  if (edgeAndroid) {
    return `<ol><li>Tap Edge's <strong>three-line menu</strong> at the bottom.</li><li>Tap <strong>Add to phone</strong>, <strong>Install app</strong>, or <strong>Add to Home screen</strong>.</li><li>Confirm <strong>Install</strong> or <strong>Add</strong>.</li></ol>
      <p class="muted">If the option is missing, refresh this page once and reopen the menu.</p>`;
  }
  if (android) {
    return `<ol><li>Open this page in <strong>Chrome</strong>.</li><li>Tap Chrome's three-dot menu.</li><li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li></ol>`;
  }
  return `<ol><li>Open the browser menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li></ol>`;
}

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function save() {
  if (state.config) localStorage.setItem(KEYS.config, JSON.stringify(state.config));
  localStorage.setItem(KEYS.history, JSON.stringify(state.history));
}

function parseDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid schedule date: ${value}`);
  return date;
}

function validateConfig(config) {
  if (!config || config.version !== 1 || !config.patient?.name || !Array.isArray(config.schedule)) {
    throw new Error("This is not a valid medication tracker configuration.");
  }
  const ids = new Set();
  config.schedule.forEach(slot => {
    if (!slot.id || ids.has(slot.id) || !Array.isArray(slot.medications)) {
      throw new Error("The schedule contains an invalid or duplicate slot.");
    }
    ids.add(slot.id);
    parseDate(slot.at);
    slot.medications.forEach(med => {
      if (!med.id || !med.name || (!med.dose && !Array.isArray(med.options))) {
        throw new Error("A medication entry is incomplete.");
      }
    });
  });
  return config;
}

function recordKey(slotId, medicationId) {
  return `${slotId}:${medicationId}`;
}

function formatDate(date) {
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fileSafeDate(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isGiven(slotId, medicationId) {
  return Boolean(state.history[recordKey(slotId, medicationId)]);
}

function sortedSchedule() {
  if (!state.config) return [];
  return [...state.config.schedule].sort((a, b) => parseDate(a.at) - parseDate(b.at));
}

function nextPending() {
  const now = Date.now();
  for (const slot of sortedSchedule()) {
    const pending = slot.medications.filter(med => !isGiven(slot.id, med.id));
    if (pending.length && parseDate(slot.at).getTime() >= now - 3 * 60 * 60 * 1000) {
      return { slot, pending };
    }
  }
  return null;
}

function renderHeader() {
  const patient = state.config?.patient;
  document.getElementById("patient-name").textContent = patient?.name || "Medication Tracker";
  document.getElementById("subtitle").textContent = patient?.subtitle || "Private data stays in this browser";
  document.title = patient ? `${patient.name} Medication Tracker` : "Medication Tracker";
}

function renderNext() {
  const next = nextPending();
  if (!next) {
    document.getElementById("next-time").textContent = "No remaining doses";
    document.getElementById("next-meds").textContent = "";
    document.getElementById("countdown").textContent = "";
    return;
  }
  const date = parseDate(next.slot.at);
  document.getElementById("next-time").textContent = `${formatDate(date)} · ${formatTime(date)}`;
  document.getElementById("next-meds").textContent = next.pending.map(med => med.name).join(" · ");
  const difference = date.getTime() - Date.now();
  if (difference <= 0) {
    document.getElementById("countdown").textContent = `Due ${Math.floor(Math.abs(difference) / 60000)} minutes ago`;
  } else {
    const hours = Math.floor(difference / 3600000);
    const minutes = Math.floor((difference % 3600000) / 60000);
    document.getElementById("countdown").textContent = `In ${hours ? `${hours} hr ` : ""}${minutes} min`;
  }
}

function visibleSchedule() {
  const now = Date.now();
  return sortedSchedule().filter(slot => {
    const time = parseDate(slot.at).getTime();
    return time >= now - 5 * 60 * 60 * 1000 && time <= now + 42 * 60 * 60 * 1000;
  });
}

function renderSchedule() {
  const container = document.getElementById("schedule");
  const slotTemplate = document.getElementById("slot-template");
  const medTemplate = document.getElementById("med-template");
  container.replaceChildren();

  visibleSchedule().forEach(slot => {
    const fragment = slotTemplate.content.cloneNode(true);
    const date = parseDate(slot.at);
    fragment.querySelector(".slot-date").textContent = formatDate(date);
    fragment.querySelector(".slot-time").textContent = formatTime(date);
    const completed = slot.medications.filter(med => isGiven(slot.id, med.id)).length;
    fragment.querySelector(".slot-state").textContent = `${completed}/${slot.medications.length} given`;
    const list = fragment.querySelector(".med-list");

    slot.medications.forEach(med => {
      const medFragment = medTemplate.content.cloneNode(true);
      const key = recordKey(slot.id, med.id);
      const existing = state.history[key];
      const row = medFragment.querySelector(".med-row");
      medFragment.querySelector(".med-name").textContent = med.name;
      medFragment.querySelector(".med-note").textContent = med.note || "";
      const select = medFragment.querySelector(".dose-select");
      const options = med.options?.length ? med.options : [med.dose];
      options.forEach(value => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      });
      select.value = existing?.dose || options[0];
      select.disabled = Boolean(existing);

      const button = medFragment.querySelector(".given-button");
      if (existing) {
        row.classList.add("given");
        button.classList.add("done");
        button.textContent = "Given ✓";
      }
      button.addEventListener("click", () => {
        if (state.history[key]) {
          delete state.history[key];
        } else {
          state.history[key] = { givenAt: new Date().toISOString(), dose: select.value };
        }
        save();
        requestPersistentStorage();
        render();
      });
      list.append(medFragment);
    });
    container.append(fragment);
  });
}

function historyEntries() {
  if (!state.config) return [];
  const slots = new Map(state.config.schedule.map(slot => [slot.id, slot]));
  return Object.entries(state.history).map(([key, record]) => {
    const separator = key.lastIndexOf(":");
    const slotId = key.slice(0, separator);
    const medicationId = key.slice(separator + 1);
    const slot = slots.get(slotId);
    const medication = slot?.medications.find(item => item.id === medicationId);
    return medication ? { medication, record } : null;
  }).filter(Boolean).sort((a, b) => new Date(b.record.givenAt) - new Date(a.record.givenAt));
}

function renderHistory() {
  const entries = historyEntries();
  document.getElementById("history").innerHTML = entries.length
    ? entries.map(({ medication, record }) => `
      <div class="history-item">
        <strong>${medication.name} · ${record.dose}</strong>
        <div class="history-time">${formatDate(new Date(record.givenAt))} · ${formatTime(new Date(record.givenAt))}</div>
      </div>`).join("")
    : "<p class=\"muted\">No doses recorded.</p>";
}

function renderWarnings() {
  const lastBackup = Number(localStorage.getItem(KEYS.lastBackup) || 0);
  document.getElementById("backup-warning").hidden = Date.now() - lastBackup < 24 * 60 * 60 * 1000;
  document.getElementById("backup-time").textContent = lastBackup
    ? `Last full backup: ${new Date(lastBackup).toLocaleString()}`
    : "No full backup downloaded yet.";

  const next = nextPending();
  const overdue = document.getElementById("overdue-warning");
  if (next && parseDate(next.slot.at).getTime() < Date.now()) {
    overdue.hidden = false;
    overdue.textContent = "A scheduled dose is overdue. Check history before giving anything; do not double an uncertain dose.";
  } else {
    overdue.hidden = true;
  }
}

function render() {
  const configured = Boolean(state.config);
  document.getElementById("setup-card").hidden = configured;
  document.getElementById("app").hidden = !configured;
  renderHeader();
  if (!configured) return;
  renderNext();
  renderSchedule();
  renderHistory();
  renderWarnings();
}

async function importJson(file, restoreHistory) {
  const parsed = JSON.parse(await file.text());
  if (restoreHistory) {
    if (!parsed.config || !parsed.history) throw new Error("This is not a full tracker backup.");
    state.config = validateConfig(parsed.config);
    state.history = parsed.history;
    if (parsed.lastBackup) localStorage.setItem(KEYS.lastBackup, String(parsed.lastBackup));
  } else {
    state.config = validateConfig(parsed);
    if (parsed.initialHistory && typeof parsed.initialHistory === "object") {
      state.history = { ...state.history, ...parsed.initialHistory };
    }
  }
  save();
  requestPersistentStorage();
  render();
}

function fullBackup() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    config: state.config,
    history: state.history,
    lastBackup: Date.now()
  };
  download(`medication-tracker-backup-${fileSafeDate()}.json`, JSON.stringify(backup, null, 2), "application/json");
  localStorage.setItem(KEYS.lastBackup, String(backup.lastBackup));
  renderWarnings();
}

["config-input", "replacement-input"].forEach(id => {
  document.getElementById(id).addEventListener("change", async event => {
    try {
      if (event.target.files[0]) await importJson(event.target.files[0], false);
    } catch (error) {
      alert(error.message);
    } finally {
      event.target.value = "";
    }
  });
});

document.getElementById("restore-input").addEventListener("change", async event => {
  try {
    if (event.target.files[0]) await importJson(event.target.files[0], true);
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
});

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === button));
    document.querySelectorAll(".panel").forEach(panel => { panel.hidden = true; });
    document.getElementById(`${button.dataset.tab}-panel`).hidden = false;
  });
});

document.getElementById("backup-button").addEventListener("click", fullBackup);
document.getElementById("warning-backup-button").addEventListener("click", fullBackup);

document.getElementById("csv-button").addEventListener("click", () => {
  const rows = [["Given time", "Medication", "Dose"]];
  historyEntries().forEach(({ medication, record }) => {
    rows.push([new Date(record.givenAt).toLocaleString(), medication.name, record.dose]);
  });
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  download(`medication-history-${fileSafeDate()}.csv`, csv, "text/csv");
});

document.getElementById("erase-button").addEventListener("click", () => {
  if (!confirm("Erase the schedule and all dose history from this browser?")) return;
  Object.values(KEYS).forEach(key => localStorage.removeItem(key));
  state.config = null;
  state.history = {};
  render();
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  state.installPrompt = event;
});

document.getElementById("install-button").addEventListener("click", async () => {
  await requestPersistentStorage();
  if (state.installPrompt) {
    await state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;
    state.installPrompt = null;
    if (choice.outcome === "accepted") {
      document.getElementById("install-button").hidden = true;
      return;
    }
  }
  document.getElementById("install-instructions").innerHTML = installHelpHtml();
  document.getElementById("install-dialog").showModal();
});

document.getElementById("close-install-dialog").addEventListener("click", () => {
  document.getElementById("install-dialog").close();
});

window.addEventListener("appinstalled", () => {
  document.getElementById("install-button").hidden = true;
});

if (isInstalled()) document.getElementById("install-button").hidden = true;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

render();
setInterval(render, 60000);
