// ponytail: vanilla JS dashboard — no bundler, no framework
"use strict";

const FILTER_OPTIONS = ["ALL_", "AP_", "BL_", "CP_", "CSC_", "md5", "USERDATA_", "HOME_"];
const STORAGE_KEY = "qb-dashboard-config";

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
}
function saveConfig(c) { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); }

let config = loadConfig();
// Default: auto-detect server from current page URL (works when served by Docker)
if (!config.serverUrl) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  config.serverUrl = `${proto}//${location.host}`;
}

// ── State ────────────────────────────────────────────────────────────────────
let ws = null;
let pcs = []; // array of PcState
let selectedPcId = null; // for remote download dialog
let selectedTypes = new Set(FILTER_OPTIONS);

// ── DOM refs ─────────────────────────────────────────────────────────────────
const connBadge = document.getElementById("conn-badge");
const pcList = document.getElementById("pc-list");
const emptyMsg = document.getElementById("empty-msg");
const emptyUrl = document.getElementById("empty-url");

const settingsModal = document.getElementById("settings-modal");
const serverUrlInput = document.getElementById("server-url-input");
const apiKeyInput = document.getElementById("api-key-input");
document.getElementById("settings-btn").addEventListener("click", openSettings);
document.getElementById("close-settings").addEventListener("click", () => settingsModal.classList.add("hidden"));
document.getElementById("save-settings").addEventListener("click", saveSettings);

const downloadModal = document.getElementById("download-modal");
document.getElementById("close-download").addEventListener("click", () => downloadModal.classList.add("hidden"));
document.getElementById("cancel-download").addEventListener("click", () => downloadModal.classList.add("hidden"));
document.getElementById("submit-download").addEventListener("click", submitDownload);

// ── WebSocket ─────────────────────────────────────────────────────────────────
function setBadge(state) {
  connBadge.className = `badge badge-${state}`;
  connBadge.querySelector(".badge-label").textContent =
    state === "connected" ? "Connected" : state === "connecting" ? "Connecting…" : "Disconnected";
}

let reconnectTimer = null;
function connect() {
  if (ws) { try { ws.close(); } catch { /**/ } }
  setBadge("connecting");

  const url = new URL(config.serverUrl.replace(/^http/, "ws"));
  url.pathname = "/ws/client";
  if (config.apiKey) url.searchParams.set("token", config.apiKey);

  ws = new WebSocket(url.toString());

  ws.onopen = () => setBadge("connected");
  ws.onclose = () => {
    setBadge("disconnected");
    ws = null;
    reconnectTimer = setTimeout(connect, 5000);
  };
  ws.onerror = () => { /* onclose will fire */ };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "state_update") { pcs = msg.pcs; render(); }
      else if (msg.type === "error") showToast(msg.message, "error");
      else if (msg.type === "download_ack" && msg.status === "accepted") showToast("Download started on PC!", "ok");
    } catch { /**/ }
  };
}

// ── Settings modal ────────────────────────────────────────────────────────────
function openSettings() {
  serverUrlInput.value = config.serverUrl || "";
  apiKeyInput.value = config.apiKey || "";
  settingsModal.classList.remove("hidden");
}
function saveSettings() {
  config.serverUrl = serverUrlInput.value.trim() || config.serverUrl;
  config.apiKey = apiKeyInput.value.trim();
  saveConfig(config);
  settingsModal.classList.add("hidden");
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  connect();
}

// ── Remote Download modal ─────────────────────────────────────────────────────
function openDownload(pcId, pcName) {
  selectedPcId = pcId;
  selectedTypes = new Set(FILTER_OPTIONS);
  document.getElementById("dl-pc-name").textContent = pcName;
  document.getElementById("dl-qb-id").value = "";
  renderChips();
  downloadModal.classList.remove("hidden");
  setTimeout(() => document.getElementById("dl-qb-id").focus(), 50);
}

function renderChips() {
  const grid = document.getElementById("dl-chips");
  grid.innerHTML = FILTER_OPTIONS.map((f) =>
    `<div class="chip${selectedTypes.has(f) ? " selected" : ""}" data-filter="${f}">${f}</div>`
  ).join("");
  grid.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const f = chip.dataset.filter;
      selectedTypes.has(f) ? selectedTypes.delete(f) : selectedTypes.add(f);
      chip.classList.toggle("selected", selectedTypes.has(f));
    });
  });
}

function submitDownload() {
  const qbId = document.getElementById("dl-qb-id").value.trim();
  if (!qbId) { document.getElementById("dl-qb-id").focus(); return; }
  if (!selectedTypes.size) { showToast("Select at least one artifact type", "error"); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast("Not connected to server", "error"); return; }
  ws.send(JSON.stringify({ type: "remote_download", pcId: selectedPcId, qbId, artifactTypes: [...selectedTypes] }));
  downloadModal.classList.add("hidden");
  showToast("Download command sent!", "ok");
}

// ── Render ────────────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (!b) return "0 B";
  const units = ["B","KB","MB","GB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function pct(job) {
  if (job.status === "completed") return 100;
  if (job.total && job.total > 0) return Math.min(100, Math.round((job.downloaded / job.total) * 100));
  return 0;
}

function renderJob(job) {
  const p = pct(job);
  return `
    <div class="job-row">
      <div class="job-name" title="${job.name}">${job.name}</div>
      <div class="job-status ${job.status}">${job.status}</div>
      <div class="progress-bar">
        <div class="progress-fill ${job.status === "completed" ? "completed" : ""}" style="width:${p}%"></div>
      </div>
    </div>`;
}

function renderPc(pc) {
  const card = document.createElement("div");
  card.className = `pc-card ${pc.online ? "online" : "offline"}`;
  card.id = `pc-${pc.pcId}`;

  const activeJobs = (pc.jobs || []).filter((j) => ["queued","downloading","retrying","completed","failed"].includes(j.status));
  const downloading = activeJobs.filter((j) => ["queued","downloading","retrying"].includes(j.status)).length;
  const completed = activeJobs.filter((j) => j.status === "completed").length;
  const shownJobs = activeJobs.slice(0, 5);
  const moreCount = Math.max(0, activeJobs.length - shownJobs.length);

  card.innerHTML = `
    <div class="pc-card-header">
      <div class="pc-info">
        <div class="pc-name">${pc.pcName}</div>
        <div class="pc-meta">
          <span class="pc-os">${pc.os || "Windows"}</span>
          <span class="pc-id">${pc.pcId.slice(0, 8)}</span>
        </div>
      </div>
      <div class="pc-status-badge ${pc.online ? "online" : "offline"}">${pc.online ? "Online" : "Offline"}</div>
    </div>
    <div class="pc-stats">
      <span>Active: <span class="stat-val">${downloading}</span></span>
      <span>Completed: <span class="stat-val">${completed}</span></span>
      <span>Total: <span class="stat-val">${activeJobs.length}</span></span>
    </div>
    <div class="pc-actions">
      <button class="btn-primary remote-dl-btn" ${!pc.online ? "disabled" : ""} data-pc-id="${pc.pcId}" data-pc-name="${pc.pcName}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Remote Download
      </button>
    </div>
    ${shownJobs.length > 0 ? `
      <div class="pc-jobs">
        <div class="pc-jobs-header">Active Downloads</div>
        ${shownJobs.map(renderJob).join("")}
        ${moreCount > 0 ? `<div class="pc-jobs-more">+${moreCount} more jobs…</div>` : ""}
      </div>` : ""}`;

  card.querySelectorAll(".remote-dl-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDownload(btn.dataset.pcId, btn.dataset.pcName));
  });
  return card;
}

function render() {
  emptyUrl.textContent = config.serverUrl || window.location.origin;

  // Remove cards for gone PCs
  const currentIds = new Set(pcs.map((p) => p.pcId));
  document.querySelectorAll(".pc-card").forEach((el) => {
    if (!currentIds.has(el.id.replace("pc-", ""))) el.remove();
  });

  if (!pcs.length) {
    emptyMsg.style.display = "";
    return;
  }
  emptyMsg.style.display = "none";

  for (const pc of pcs) {
    const existing = document.getElementById(`pc-${pc.pcId}`);
    const newCard = renderPc(pc);
    if (existing) existing.replaceWith(newCard);
    else pcList.appendChild(newCard);
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = "ok") {
  const t = document.createElement("div");
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:200;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;color:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.4);animation:modal-in 0.2s ease;background:${type==="ok"?"#166534":"#9f1239"};border:1px solid ${type==="ok"?"#22c55e40":"#ef444440"}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── Init ──────────────────────────────────────────────────────────────────────
render();
connect();
