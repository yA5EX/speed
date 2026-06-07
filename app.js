const STORAGE_KEY = "sprint-hud-state-v1";
const MAX_POINTS_PER_SESSION = 1200;
const FIXED_TARGET = 500;
const FIXED_SPLITS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];

const els = {
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  speedValue: document.querySelector("#speedValue"),
  maxSpeedValue: document.querySelector("#maxSpeedValue"),
  distanceValue: document.querySelector("#distanceValue"),
  splitGrid: document.querySelector("#splitGrid"),
  runMeta: document.querySelector("#runMeta"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  csvButton: document.querySelector("#csvButton"),
  userNameInput: document.querySelector("#userNameInput"),
  displacementInput: document.querySelector("#displacementInput"),
  machineInput: document.querySelector("#machineInput"),
  autoStartInput: document.querySelector("#autoStartInput"),
  accuracyInput: document.querySelector("#accuracyInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  clearButton: document.querySelector("#clearButton"),
  settingsTab: document.querySelector("#settingsTab"),
  rankingTab: document.querySelector("#rankingTab"),
  settingsView: document.querySelector("#settingsView"),
  rankingView: document.querySelector("#rankingView"),
  rankingMetricInput: document.querySelector("#rankingMetricInput"),
  refreshRankingButton: document.querySelector("#refreshRankingButton"),
  rankingList: document.querySelector("#rankingList"),
  historyBody: document.querySelector("#historyBody"),
  messageText: document.querySelector("#messageText")
};

const state = loadState();
let watchId = null;
let run = createEmptyRun();

restoreSettings();
buildSplits();
render();
checkPermissionState();

els.startButton.addEventListener("click", start);
els.stopButton.addEventListener("click", stop);
els.csvButton.addEventListener("click", downloadCsv);
els.saveSettingsButton.addEventListener("click", persistSettings);
els.clearButton.addEventListener("click", clearLocal);
els.settingsTab.addEventListener("click", () => setTab("settings"));
els.rankingTab.addEventListener("click", () => setTab("ranking"));
els.refreshRankingButton.addEventListener("click", refreshRanking);

for (const input of [
  els.userNameInput,
  els.displacementInput,
  els.machineInput,
  els.autoStartInput,
  els.accuracyInput
]) {
  input.addEventListener("change", () => {
    persistSettings(false);
    buildSplits();
    render();
  });
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return {
      settings: { ...defaultSettings(), ...(parsed?.settings || {}) },
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : []
    };
  } catch {
    return { settings: defaultSettings(), sessions: [] };
  }
}

function defaultSettings() {
  return {
    userName: "",
    displacementCc: "",
    machine: "",
    autoStart: 2,
    accuracyLimit: 25
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function restoreSettings() {
  els.userNameInput.value = state.settings.userName || "";
  els.displacementInput.value = state.settings.displacementCc || "";
  els.machineInput.value = state.settings.machine || "";
  els.autoStartInput.value = String(state.settings.autoStart || 2);
  els.accuracyInput.value = String(state.settings.accuracyLimit || 25);
}

function persistSettings(showMessage = true) {
  state.settings.userName = els.userNameInput.value.trim();
  state.settings.displacementCc = els.displacementInput.value.trim();
  state.settings.machine = els.machineInput.value.trim();
  state.settings.autoStart = Number(els.autoStartInput.value);
  state.settings.accuracyLimit = Number(els.accuracyInput.value);
  saveState();
  if (showMessage) setMessage("Settings saved");
}

function createEmptyRun() {
  return {
    id: makeId(),
    armed: false,
    running: false,
    finished: false,
    startAt: null,
    endAt: null,
    startPos: null,
    lastPos: null,
    distance: 0,
    maxSpeed: 0,
    marks: {},
    points: []
  };
}

function buildSplits() {
  const distances = getSplitDistances();
  els.splitGrid.innerHTML = distances.map(distance => `
    <div class="split" id="split-${distance}">
      <span>${distance} m</span>
      <strong>--</strong>
    </div>
  `).join("");

  els.rankingMetricInput.innerHTML = distances.map(distance => (
    `<option value="${distance}">${distance} m</option>`
  )).join("");
}

function getSplitDistances() {
  return FIXED_SPLITS;
}

function start() {
  if (!("geolocation" in navigator)) {
    setStatus("GPS unavailable", "error");
    setMessage("Use HTTPS or allow location permission");
    return;
  }

  if (!window.isSecureContext) {
    setStatus("HTTPS required", "error");
    setMessage("GPS works on HTTPS. Use the GitHub Pages URL on your phone.");
    return;
  }

  persistSettings(false);
  checkPermissionState();
  run = createEmptyRun();
  run.armed = true;
  buildSplits();
  setStatus("Armed", "warn");
  setMessage("Move to start timing");
  els.startButton.disabled = true;
  els.stopButton.disabled = false;

  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 10000,
    timeout: 60000
  });

  render();
}

function stop() {
  stopWatch();
  if (run.running || run.points.length > 0) {
    finishRun(false);
  } else {
    setStatus("Ready", "");
  }
  render();
}

function stopWatch() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  els.startButton.disabled = false;
  els.stopButton.disabled = true;
}

function onPosition(pos) {
  const point = toPoint(pos);
  const accuracyLimit = Number(state.settings.accuracyLimit || 25);

  if (point.accuracy > accuracyLimit) {
    setStatus(`Low accuracy ${Math.round(point.accuracy)}m`, "warn");
    updateSpeed(point.speedKmh);
    return;
  }

  updateSpeed(point.speedKmh);
  run.maxSpeed = Math.max(run.maxSpeed, point.speedKmh);

  if (!run.lastPos) {
    run.lastPos = point;
    render();
    return;
  }

  const move = haversine(run.lastPos.latitude, run.lastPos.longitude, point.latitude, point.longitude);
  if (run.armed && !run.running && move >= Number(state.settings.autoStart || 2)) {
    run.running = true;
    run.armed = false;
    run.startAt = Date.now();
    run.startPos = point;
    run.points = [];
    setStatus("Running", "active");
  }

  if (run.running && run.startPos) {
    run.distance = haversine(run.startPos.latitude, run.startPos.longitude, point.latitude, point.longitude);
    addPoint(point);
    checkMarks();
    if (run.distance >= FIXED_TARGET) {
      finishRun(true);
      stopWatch();
    }
  }

  run.lastPos = point;
  render();
}

function toPoint(pos) {
  const coords = pos.coords;
  const speedMps = Number.isFinite(coords.speed) ? coords.speed : 0;
  return {
    timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy || 0,
    altitude: coords.altitude,
    heading: coords.heading,
    speedMps,
    speedKmh: speedMps * 3.6
  };
}

function addPoint(point) {
  run.points.push(point);
  if (run.points.length > MAX_POINTS_PER_SESSION) {
    run.points.splice(0, run.points.length - MAX_POINTS_PER_SESSION);
  }
}

function checkMarks() {
  const elapsed = Date.now() - run.startAt;
  for (const distance of getSplitDistances()) {
    if (!run.marks[distance] && run.distance >= distance) {
      run.marks[distance] = elapsed;
      const el = document.querySelector(`#split-${distance}`);
      if (el) {
        el.classList.add("reached");
        el.querySelector("strong").textContent = formatSeconds(elapsed);
      }
    }
  }
}

function finishRun(completed) {
  if (run.finished) return;
  run.finished = true;
  run.running = false;
  run.armed = false;
  run.endAt = Date.now();

  const session = {
    id: run.id,
    userName: state.settings.userName || "runner",
    displacementCc: state.settings.displacementCc || "",
    machine: state.settings.machine || "",
    target: FIXED_TARGET,
    split: 50,
    startAt: run.startAt ? new Date(run.startAt).toISOString() : new Date().toISOString(),
    endAt: new Date(run.endAt).toISOString(),
    durationMs: run.startAt ? run.endAt - run.startAt : 0,
    completed,
    distance: run.distance,
    maxSpeed: run.maxSpeed,
    marks: { ...run.marks },
    points: [...run.points]
  };

  state.sessions.unshift(session);
  state.sessions = state.sessions.slice(0, 100);
  saveState();
  setStatus(completed ? "Finished" : "Stopped", completed ? "active" : "");
  setMessage(completed ? "Run finished" : "Run saved locally");
}

function refreshRanking() {
  const metric = Number(els.rankingMetricInput.value || getSplitDistances().at(-1));
  renderRanking(localRanking(metric), "Local");
}

function localRanking(metric) {
  return state.sessions
    .map(session => ({
      userName: session.userName,
      machine: session.machine,
      displacementCc: session.displacementCc,
      metric,
      timeMs: Number(session.marks?.[metric]),
      maxSpeed: session.maxSpeed,
      startAt: session.startAt
    }))
    .filter(row => Number.isFinite(row.timeMs) && row.timeMs > 0)
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, 10);
}

function renderRanking(rows, source) {
  if (!rows.length) {
    els.rankingList.innerHTML = `<div class="rank-row"><span>--</span><div class="rank-user">${source}</div><strong>No records</strong></div>`;
    return;
  }

  els.rankingList.innerHTML = rows.map((row, index) => `
    <div class="rank-row">
      <span>#${index + 1}</span>
      <div class="rank-user">${escapeHtml(row.userName || "runner")} ${formatMachine(row.machine)} ${formatCc(row.displacementCc)} <small>${source}</small></div>
      <strong>${formatSeconds(row.timeMs)}</strong>
    </div>
  `).join("");
}

function downloadCsv() {
  const header = ["startAt", "userName", "machine", "displacementCc", "target", "distance", "durationSec", "maxSpeedKmh", "marks"];
  const rows = state.sessions.map(session => [
    session.startAt,
    session.userName,
    session.machine,
    session.displacementCc,
    session.target,
    session.distance.toFixed(2),
    (session.durationMs / 1000).toFixed(3),
    session.maxSpeed.toFixed(2),
    JSON.stringify(session.marks)
  ].map(csvCell).join(","));

  const csv = [header.join(","), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `sprint-hud-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function clearLocal() {
  if (!window.confirm("Delete local settings and run history?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.settings = defaultSettings();
  state.sessions = [];
  restoreSettings();
  buildSplits();
  render();
  setMessage("Local data cleared");
}

function render() {
  els.maxSpeedValue.textContent = run.maxSpeed.toFixed(1);
  els.distanceValue.textContent = run.distance.toFixed(1);
  els.runMeta.textContent = run.running
    ? `${state.settings.userName || "runner"} / ${FIXED_TARGET}m`
    : `${state.sessions.length} local result${state.sessions.length === 1 ? "" : "s"}`;

  renderHistory();
}

function renderHistory() {
  els.historyBody.innerHTML = state.sessions.slice(0, 40).map(session => {
    const finish = session.marks?.[session.target] || session.durationMs;
    return `<tr>
      <td>${escapeHtml(formatDate(session.startAt))}</td>
      <td>${escapeHtml(session.userName || "runner")} ${formatCc(session.displacementCc)}</td>
      <td>${escapeHtml(session.machine || "--")}</td>
      <td>${session.target} m</td>
      <td>${formatSeconds(finish)}</td>
      <td>${session.maxSpeed.toFixed(1)} km/h</td>
    </tr>`;
  }).join("") || `<tr><td colspan="6">No history</td></tr>`;
}

function setTab(tab) {
  const ranking = tab === "ranking";
  els.rankingView.hidden = !ranking;
  els.settingsView.hidden = ranking;
  els.rankingTab.classList.toggle("active", ranking);
  els.settingsTab.classList.toggle("active", !ranking);
  if (ranking) refreshRanking();
}

function updateSpeed(speed) {
  els.speedValue.textContent = Number(speed || 0).toFixed(1);
}

function setStatus(text, mode) {
  els.statusText.textContent = text;
  els.statusDot.classList.toggle("active", mode === "active");
  els.statusDot.classList.toggle("warn", mode === "warn");
  els.statusDot.classList.toggle("error", mode === "error");
}

function setMessage(text) {
  els.messageText.textContent = text;
  window.clearTimeout(setMessage.timer);
  setMessage.timer = window.setTimeout(() => {
    els.messageText.textContent = "";
  }, 15000);
}

async function checkPermissionState() {
  if (!("permissions" in navigator) || !navigator.permissions.query) return;

  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    if (permission.state === "denied") {
      setStatus("GPS blocked", "error");
      setMessage("This site is blocked from using location. Reset this site's location permission.");
    }
  } catch {
    // Some mobile browsers do not expose geolocation through Permissions API.
  }
}

function onError(error) {
  const statusLabels = {
    1: "GPS denied",
    2: "GPS unavailable",
    3: "GPS timeout"
  };
  const messages = {
    1: "Location permission was denied. Allow location for this site.",
    2: "GPS position is unavailable. Move outdoors and keep the screen on.",
    3: "GPS request timed out. Move outdoors and try again."
  };
  setStatus(statusLabels[error.code] || "GPS error", "error");
  setMessage(`${messages[error.code] || "GPS error"} code=${error.code || "?"} ${error.message || ""}`.trim());
}

function haversine(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return value * Math.PI / 180;
}

function formatSeconds(ms) {
  return Number.isFinite(Number(ms)) && Number(ms) > 0
    ? `${(Number(ms) / 1000).toFixed(2)}s`
    : "--";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCc(value) {
  const cc = Number(value);
  return Number.isFinite(cc) && cc > 0 ? `<small>${cc}cc</small>` : "";
}

function formatMachine(value) {
  return value ? `<small>${escapeHtml(value)}</small>` : "";
}

function makeId() {
  return globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}
