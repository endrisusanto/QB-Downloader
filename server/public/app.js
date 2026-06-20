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
// ── Remote Download modal ─────────────────────────────────────────────────────
const expandedStates = {};

window.setExpandedState = (pcId, category, open) => {
  const key = `${pcId}-${category}`;
  expandedStates[key] = open;
};

function isExpanded(pcId, category) {
  const key = `${pcId}-${category}`;
  if (expandedStates[key] === undefined) {
    expandedStates[key] = true; // default to open
  }
  return expandedStates[key];
}

function sendCommand(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    showToast("Not connected to server", "error");
  }
}

window.remoteDeleteGroup = (pcId, groupId) => {
  if (confirm("Are you sure you want to cancel and delete this build?")) {
    sendCommand({ type: "remote_delete_group", pcId, groupId });
  }
};

window.remoteStartGroup = (pcId, groupId) => {
  sendCommand({ type: "remote_start_group", pcId, groupId });
};

window.remoteDeleteArtifact = (pcId, groupId, artifactId) => {
  if (confirm("Delete this artifact file from disk?")) {
    sendCommand({ type: "remote_delete_artifact", pcId, groupId, artifactId });
  }
};

window.remoteRestartArtifact = (pcId, groupId, artifactId) => {
  sendCommand({ type: "remote_restart_artifact", pcId, groupId, artifactId });
};

window.remoteStartArtifact = (pcId, groupId, artifactId) => {
  sendCommand({ type: "remote_start_artifact", pcId, groupId, artifactId });
};

window.remoteSetArtifactSelected = (pcId, groupId, artifactId, selected) => {
  sendCommand({ type: "remote_set_artifact_selected", pcId, groupId, artifactId, selected });
};

function openDownload(pcId, pcName) {
  selectedPcId = pcId;
  const pc = pcs.find((p) => p.pcId === pcId);
  selectedTypes = new Set(pc && pc.presetTypes && pc.presetTypes.length > 0 ? pc.presetTypes : FILTER_OPTIONS);
  document.getElementById("dl-pc-name").textContent = pcName;
  document.getElementById("dl-qb-id").value = "";
  document.getElementById("dl-fetch-only").checked = true;
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
  const autoStart = !document.getElementById("dl-fetch-only").checked;
  ws.send(JSON.stringify({ type: "remote_download", pcId: selectedPcId, qbId, artifactTypes: [...selectedTypes], autoStart }));
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

function classifyGroups(groups, rows) {
  const fetched = [];
  const progress = [];
  const completed = [];
  const failed = [];
  for (const group of groups) {
    const selected = (group.artifacts || []).filter((a) => a.selected !== false);
    const hasActiveOrFinished = selected.some((a) => {
      const status = rows[a.id]?.status;
      return status === "queued" || status === "downloading" || status === "retrying" || status === "completed" || status === "failed";
    });
    if (!hasActiveOrFinished) {
      fetched.push(group);
    }

    const failedSelected = selected.filter((a) => rows[a.id]?.status === "failed");
    if (failedSelected.length > 0) {
      failed.push({
        ...group,
        artifacts: failedSelected,
      });
    }

    const progressSelected = selected.filter((a) => {
      const status = rows[a.id]?.status;
      return status === "queued" || status === "downloading" || status === "retrying";
    });
    if (progressSelected.length > 0) {
      progress.push({
        ...group,
        artifacts: progressSelected,
      });
    }

    const completedSelected = selected.filter((a) => rows[a.id]?.status === "completed");
    if (completedSelected.length > 0) {
      completed.push({
        ...group,
        artifacts: completedSelected,
      });
    }
  }
  return { fetched, progress, completed, failed };
}

function matchesArtifactFilter(artifact, filters) {
  if (!filters?.length) return true;
  const name = artifact.name.toUpperCase();
  return filters.some((filter) => filter === "md5" ? name.endsWith(".MD5") : name.startsWith(filter.toUpperCase()));
}

function renderGroupList(pc, groupList, type) {
  if (groupList.length === 0) return `<div class="empty-accordion-msg">No builds in this category</div>`;
  return groupList.map((g) => {
    const isFetched = type === "fetched";
    const isProgress = type === "progress";
    const isCompleted = type === "completed";
    const isFailed = type === "failed";

    let actionHtml = "";
    if (isFetched) {
      actionHtml = `
        <div class="group-actions">
          <button class="btn-primary btn-sm" onclick="remoteStartGroup('${pc.pcId}', '${g.id}')">Start Download</button>
          <button class="btn-danger btn-sm" onclick="remoteDeleteGroup('${pc.pcId}', '${g.id}')">Delete</button>
        </div>
      `;
    } else if (isProgress) {
      let total = 0;
      let downloaded = 0;
      g.artifacts.forEach((a) => {
        const row = pc.rows[a.id];
        if (row) {
          total += row.total || a.size || 0;
          downloaded += row.downloaded || 0;
        }
      });
      const p = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
      actionHtml = `
        <div class="group-progress-info">
          <div class="progress-bar">
            <div class="progress-fill" style="width:${p}%"></div>
          </div>
          <div class="progress-meta">
            <span>${p}% (${formatBytes(downloaded)} / ${formatBytes(total)})</span>
            <button class="btn-danger btn-sm" onclick="remoteDeleteGroup('${pc.pcId}', '${g.id}')">Cancel</button>
          </div>
        </div>
      `;
    }

    const artHtml = g.artifacts.filter((a) => matchesArtifactFilter(a, g.customFilters || pc.presetTypes)).map((a) => {
      const row = pc.rows[a.id] || {};
      let rowStatusHtml = "";
      let artActionsHtml = "";

      if (isCompleted) {
        rowStatusHtml = `<span class="art-status completed">completed</span>`;
        artActionsHtml = `<button class="btn-danger-icon" onclick="remoteDeleteArtifact('${pc.pcId}', '${g.id}', '${a.id}')" title="Delete file from disk">🗑️</button>`;
      } else if (isFailed) {
        rowStatusHtml = `<span class="art-status failed" title="${row.message || "Unknown error"}">failed</span>`;
        artActionsHtml = `
          <div class="art-actions">
            <button class="btn-primary-icon" onclick="remoteRestartArtifact('${pc.pcId}', '${g.id}', '${a.id}')" title="Restart download">🔄</button>
            <button class="btn-danger-icon" onclick="remoteDeleteArtifact('${pc.pcId}', '${g.id}', '${a.id}')" title="Delete">🗑️</button>
          </div>
        `;
      } else if (isProgress) {
        const total = row.total || a.size || 0;
        const percent = total > 0 ? Math.min(100, Math.round(((row.downloaded || 0) / total) * 100)) : 0;
        rowStatusHtml = `<span class="art-status ${row.status || "queued"}">${row.status || "queued"} · ${percent}%</span>`;
        artActionsHtml = `<button class="btn-danger btn-sm" onclick="remoteDeleteArtifact('${pc.pcId}', '${g.id}', '${a.id}')">Cancel</button>`;
      } else {
        rowStatusHtml = `<span class="art-status pending">pending</span>`;
        artActionsHtml = `
          <div class="art-actions">
            <button class="btn-primary-icon" onclick="remoteStartArtifact('${pc.pcId}', '${g.id}', '${a.id}')" title="Download">⬇</button>
            <button class="btn-danger-icon" onclick="remoteDeleteArtifact('${pc.pcId}', '${g.id}', '${a.id}')" title="Delete">🗑️</button>
          </div>
        `;
      }

      return `
        <div class="art-row ${isProgress ? "art-progress-row" : ""}">
          ${isFetched ? `<input type="checkbox" ${a.selected !== false ? "checked" : ""} onchange="remoteSetArtifactSelected('${pc.pcId}', '${g.id}', '${a.id}', this.checked)" title="Select artifact">` : ""}
          <div class="art-name" title="${a.name}">${a.name}</div>
          <div class="art-right ${isProgress ? "art-progress-actions" : ""}">
            ${rowStatusHtml}
            ${artActionsHtml}
          </div>
        </div>
      `;
    }).join("");

    return `
      <div class="group-box">
        <div class="group-box-header">
          <div class="group-box-title">${g.buildId || g.input}</div>
          ${actionHtml}
        </div>
        <div class="group-box-artifacts">
          ${artHtml}
        </div>
      </div>
    `;
  }).join("");
}

function renderPc(pc) {
  const card = document.createElement("div");
  card.className = `pc-card ${pc.online ? "online" : "offline"}`;
  card.id = `pc-${pc.pcId}`;

  let sysStatsHtml = "";
  if (pc.sysStats) {
    const s = pc.sysStats;
    const cpuVal = s.cpuUsage ? s.cpuUsage.toFixed(1) : "0.0";
    const ramUsedStr = formatBytes(s.ramUsed);
    const ramTotalStr = formatBytes(s.ramTotal);
    const ramPct = s.ramTotal ? Math.round((s.ramUsed / s.ramTotal) * 100) : 0;
    const diskAvailStr = formatBytes(s.diskAvailable);
    const diskTotalStr = formatBytes(s.diskTotal);
    const speedStr = formatBytes(s.totalSpeed || 0);

    sysStatsHtml = `
      <div class="sys-stats-container">
        <div class="sys-stat-item" title="CPU Usage">
          <span class="stat-icon">💻</span>
          <span class="stat-lbl">CPU:</span>
          <span class="stat-val">${cpuVal}%</span>
        </div>
        <div class="sys-stat-item" title="RAM Usage">
          <span class="stat-icon">🧠</span>
          <span class="stat-lbl">RAM:</span>
          <span class="stat-val">${ramUsedStr} / ${ramTotalStr} (${ramPct}%)</span>
        </div>
        <div class="sys-stat-item" title="Available Disk Storage">
          <span class="stat-icon">💾</span>
          <span class="stat-lbl">Storage:</span>
          <span class="stat-val">${diskAvailStr} free of ${diskTotalStr}</span>
        </div>
        <div class="sys-stat-item" title="Total Speed">
          <span class="stat-icon">⚡</span>
          <span class="stat-lbl">Speed:</span>
          <span class="stat-val">${speedStr}/s</span>
        </div>
      </div>
    `;
  }

  const { fetched, progress, completed, failed } = classifyGroups(pc.groups || [], pc.rows || {});

  card.innerHTML = `
    <div class="pc-card-header">
      <div class="pc-info">
        <div class="pc-name">${pc.pcName}</div>
        <div class="pc-meta">
          <span class="pc-os">${pc.os || "Windows"}</span>
          <span class="pc-id">${pc.pcId.slice(0, 8)}</span>
          ${pc.ip ? `<span class="pc-ip">${pc.ip}</span>` : ""}
        </div>
      </div>
      <div class="pc-status-badge ${pc.online ? "online" : "offline"}">${pc.online ? "Online" : "Offline"}</div>
    </div>

    ${sysStatsHtml}

    <div class="pc-actions">
      <button class="btn-primary remote-dl-btn" ${!pc.online ? "disabled" : ""} data-pc-id="${pc.pcId}" data-pc-name="${pc.pcName}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Remote Download
      </button>
    </div>

    <div class="pc-accordions">
      <details ${isExpanded(pc.pcId, "fetched") ? "open" : ""} ontoggle="window.setExpandedState('${pc.pcId}', 'fetched', this.open)">
        <summary>Fetched Builds (${fetched.length})</summary>
        <div class="accordion-content">
          ${renderGroupList(pc, fetched, "fetched")}
        </div>
      </details>
      <details ${isExpanded(pc.pcId, "progress") ? "open" : ""} ontoggle="window.setExpandedState('${pc.pcId}', 'progress', this.open)">
        <summary>Progress (${progress.length})</summary>
        <div class="accordion-content">
          ${renderGroupList(pc, progress, "progress")}
        </div>
      </details>
      <details ${isExpanded(pc.pcId, "completed") ? "open" : ""} ontoggle="window.setExpandedState('${pc.pcId}', 'completed', this.open)">
        <summary>Completed (${completed.length})</summary>
        <div class="accordion-content">
          ${renderGroupList(pc, completed, "completed")}
        </div>
      </details>
      <details ${isExpanded(pc.pcId, "failed") ? "open" : ""} ontoggle="window.setExpandedState('${pc.pcId}', 'failed', this.open)">
        <summary>Failed (${failed.length})</summary>
        <div class="accordion-content">
          ${renderGroupList(pc, failed, "failed")}
        </div>
      </details>
    </div>
  `;

  card.querySelectorAll(".remote-dl-btn").forEach((btn) => {
    btn.addEventListener("click", () => openDownload(btn.dataset.pcId, btn.dataset.pcName));
  });
  return card;
}

function render() {
  emptyUrl.textContent = config.serverUrl || window.location.origin;

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
