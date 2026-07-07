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

const cancelModal = document.getElementById("cancel-modal");
const cancelPin = document.getElementById("cancel-pin");
const cancelMessage = document.getElementById("cancel-message");
let cancelRequest = null;
function closeCancelModal() { cancelModal.classList.add("hidden"); cancelRequest = null; }
function openCancelModal(pcId, groupId, artifactId) {
  cancelRequest = { pcId, groupId, artifactId, requestId: crypto.randomUUID() };
  const label = artifactId ? "Cancel artifact" : groupId ? "Cancel download" : "Cancel all downloads";
  document.getElementById("cancel-title").textContent = label;
  document.getElementById("submit-cancel").textContent = artifactId ? "Cancel artifact" : groupId ? "Cancel download" : "Cancel all";
  cancelMessage.hidden = true;
  cancelPin.value = "";
  cancelModal.classList.remove("hidden");
  cancelPin.focus();
}
document.getElementById("close-cancel").addEventListener("click", closeCancelModal);
document.getElementById("dismiss-cancel").addEventListener("click", closeCancelModal);
document.getElementById("cancel-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!cancelRequest) return;
  cancelMessage.hidden = true;
  sendCommand({ type: cancelRequest.artifactId ? "remote_cancel_artifact" : cancelRequest.groupId ? "remote_cancel_group" : "remote_cancel_all", ...cancelRequest, pin: cancelPin.value });
});

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
      else if (msg.type === "cancel_result" && cancelRequest?.requestId === msg.requestId) {
        if (msg.ok) { closeCancelModal(); showToast("PIN correct. Cancellation requested", "ok"); }
        else { cancelMessage.textContent = "Incorrect cancel PIN"; cancelMessage.hidden = false; showToast("PIN incorrect", "error"); cancelPin.select(); }
      }
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

window.remoteCancelGroup = (pcId, groupId) => {
  openCancelModal(pcId, groupId);
};

window.remoteCancelArtifact = (pcId, groupId, artifactId) => {
  openCancelModal(pcId, groupId, artifactId);
};

window.remoteCancelAll = (pcId) => {
  openCancelModal(pcId);
};

window.remoteCancelGroups = (pcId, groupIds) => {
  window.remoteCancelAll(pcId);
};

window.remoteStartGroup = (pcId, groupId) => {
  sendCommand({ type: "remote_start_group", pcId, groupId });
};

window.remoteStartGroups = (pcId, groupIds) => {
  groupIds.forEach((groupId) => sendCommand({ type: "remote_start_group", pcId, groupId }));
};

window.remoteDeleteGroups = (pcId, groupIds) => {
  if (confirm(`Delete ${groupIds.length} fetched build${groupIds.length === 1 ? "" : "s"}?`)) {
    groupIds.forEach((groupId) => sendCommand({ type: "remote_delete_group", pcId, groupId }));
  }
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
  const qbIds = document.getElementById("dl-qb-id").value.split(/[\s,]+/).filter(Boolean);
  if (!qbIds.length) { document.getElementById("dl-qb-id").focus(); return; }
  if (!selectedTypes.size) { showToast("Select at least one artifact type", "error"); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast("Not connected to server", "error"); return; }
  const autoStart = !document.getElementById("dl-fetch-only").checked;
  ws.send(JSON.stringify({ type: "remote_download", pcId: selectedPcId, qbIds, artifactTypes: [...selectedTypes], autoStart }));
  downloadModal.classList.add("hidden");
  showToast(`${qbIds.length} download command${qbIds.length === 1 ? "" : "s"} sent!`, "ok");
}

// ── Render ────────────────────────────────────────────────────────────────────
function formatBytes(b) {
  if (!b) return "0 B";
  const units = ["B","KB","MB","GB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatETA(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "Calculating...";
  if (seconds > 86400 * 365) return "∞"; // Too long
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function classifyGroups(groups, rows) {
  const fetched = [];
  const progress = [];
  const completed = [];
  const failed = [];
  for (const group of groups) {
    const artifacts = group.artifacts || [];
    const hasActiveOrFinished = artifacts.some((a) => {
      const status = rows[a.id]?.status;
      return status === "queued" || status === "downloading" || status === "retrying" || status === "completed" || status === "failed";
    });
    if (!hasActiveOrFinished) {
      fetched.push(group);
    }

    const failedSelected = artifacts.filter((a) => rows[a.id]?.status === "failed");
    if (failedSelected.length > 0) {
      failed.push({
        ...group,
        artifacts: failedSelected,
      });
    }

    const progressSelected = artifacts.filter((a) => {
      const status = rows[a.id]?.status;
      return status === "queued" || status === "downloading" || status === "retrying";
    });
    if (progressSelected.length > 0) {
      progress.push({
        ...group,
        artifacts: progressSelected,
      });
    }

    const completedSelected = artifacts.filter((a) => rows[a.id]?.status === "completed");
    if (completedSelected.length > 0) {
      completed.push({
        ...group,
        artifacts: completedSelected,
      });
    }
  }
  return { fetched, progress, completed, failed };
}

function calculatePcProgress(pc, progressGroups) {
  let totalBytes = 0;
  let downloadedBytes = 0;
  for (const group of progressGroups) {
    for (const a of group.artifacts) {
      const row = pc.rows[a.id];
      if (row && (row.status === "downloading" || row.status === "queued" || row.status === "retrying")) {
        const total = row.total || a.size || 0;
        const downloaded = row.downloaded || 0;
        totalBytes += total;
        downloadedBytes += downloaded;
      }
    }
  }
  return { downloadedBytes, totalBytes };
}

function calculatePcETA(pc, progressGroups) {
  const { downloadedBytes, totalBytes } = calculatePcProgress(pc, progressGroups);
  const remainingBytes = totalBytes - downloadedBytes;
  if (remainingBytes <= 0) return null;
  const speed = pc.sysStats?.totalSpeed || 0;
  if (speed === 0) return null;
  return remainingBytes / speed;
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
    const isWaiting = g.status === "watching";
    const isProgress = type === "progress";
    const isCompleted = type === "completed";
    const isFailed = type === "failed";

    let actionHtml = "";
    if (isWaiting) {
      actionHtml = `
        <div class="group-actions">
          <span class="art-status pending">Waiting for artifacts</span>
          <button class="btn-danger btn-sm" onclick="remoteDeleteGroup('${pc.pcId}', '${g.id}')">Delete</button>
        </div>
      `;
    } else if (isFetched) {
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
            <button class="btn-danger btn-sm" onclick="remoteCancelGroup('${pc.pcId}', '${g.id}')">Cancel</button>
          </div>
        </div>
      `;
    }

    const noArtifactsHtml = !isWaiting && g.artifacts.length === 0
      ? `<div class="art-row art-empty">Artifacts tidak ada. Mungkin QB ID sudah expired.</div>`
      : "";
    const artHtml = noArtifactsHtml || g.artifacts.filter((a) => matchesArtifactFilter(a, g.customFilters || pc.presetTypes)).map((a) => {
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
        artActionsHtml = `<button class="btn-danger btn-sm" onclick="remoteCancelArtifact('${pc.pcId}', '${g.id}', '${a.id}')">Cancel</button>`;
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
          ${(isFetched || isProgress) ? `<input type="checkbox" ${a.selected !== false ? "checked" : ""} onchange="remoteSetArtifactSelected('${pc.pcId}', '${g.id}', '${a.id}', this.checked)" title="Select artifact">` : ""}
          <div class="art-name" title="${a.name}">${a.name}${a.size ? `<span class="art-size-badge">${formatBytes(a.size)}</span>` : ""}</div>
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
          <div class="group-box-title">${g.buildId || g.input}${isWaiting ? '<div class="group-waiting-message">Build is running. Waiting for artifacts.</div>' : ""}</div>
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

  const { fetched, progress, completed, failed } = classifyGroups(pc.groups || [], pc.rows || {});
  
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

    const etaSecs = calculatePcETA(pc, progress);
    const etaStr = etaSecs ? formatETA(etaSecs) : "";
    const { downloadedBytes, totalBytes } = calculatePcProgress(pc, progress);

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
        <div class="sys-stat-item progress-item" title="Overall Progress" style="${totalBytes > 0 ? '' : 'display:none'}">
          <span class="stat-icon">📊</span>
          <span class="stat-lbl">Progress:</span>
          <span class="stat-val">${totalBytes > 0 ? `${Math.round(downloadedBytes * 100 / totalBytes)}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})` : ''}</span>
        </div>
        <div class="sys-stat-item eta-item" title="Estimated Time" style="${etaStr ? '' : 'display:none'}">
          <span class="stat-icon">⏳</span>
          <span class="stat-lbl">ETA:</span>
          <span class="stat-val">${etaStr || '0s'}</span>
        </div>
      </div>
    `;
  }

  const fetchedIds = fetched.map((group) => group.id).join(",");
  const progressIds = progress.map((group) => group.id).join(",");

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
          ${fetched.length ? `<div class="bulk-actions"><button class="btn-primary btn-sm bulk-start-btn" data-pc-id="${pc.pcId}" data-group-ids="${fetchedIds}">Download all</button><button class="btn-secondary btn-sm bulk-deselect-btn">Deselect all</button><button class="btn-danger btn-sm bulk-delete-btn" data-pc-id="${pc.pcId}" data-group-ids="${fetchedIds}">Delete all</button></div>` : ""}
          ${renderGroupList(pc, fetched, "fetched")}
        </div>
      </details>
      <details ${isExpanded(pc.pcId, "progress") ? "open" : ""} ontoggle="window.setExpandedState('${pc.pcId}', 'progress', this.open)">
        <summary>Progress (${progress.length})</summary>
        <div class="accordion-content">
          ${progress.length ? `<div class="bulk-actions"><button class="btn-danger btn-sm bulk-cancel-btn" data-pc-id="${pc.pcId}" data-group-ids="${progressIds}">Cancel all</button></div>` : ""}
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
  card.querySelectorAll(".bulk-start-btn").forEach((btn) => {
    btn.addEventListener("click", () => remoteStartGroups(btn.dataset.pcId, btn.dataset.groupIds.split(",").filter(Boolean)));
  });
  card.querySelectorAll(".bulk-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => remoteDeleteGroups(btn.dataset.pcId, btn.dataset.groupIds.split(",").filter(Boolean)));
  });
  card.querySelectorAll(".bulk-deselect-btn").forEach((btn) => {
    btn.addEventListener("click", () => fetched.forEach((group) => group.artifacts.filter((artifact) => artifact.selected !== false).forEach((artifact) => remoteSetArtifactSelected(pc.pcId, group.id, artifact.id, false))));
  });
  card.querySelectorAll(".bulk-cancel-btn").forEach((btn) => {
    btn.addEventListener("click", () => remoteCancelGroups(btn.dataset.pcId, btn.dataset.groupIds.split(",").filter(Boolean)));
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
    if (existing) {
      patchPcCard(existing, pc);
    } else {
      pcList.appendChild(renderPc(pc));
    }
  }
}

// ponytail: targeted DOM patching — only touch elements whose text actually changed
function patchPcCard(card, pc) {
  // Update online/offline status
  card.className = `pc-card ${pc.online ? "online" : "offline"}`;
  const statusBadge = card.querySelector(".pc-status-badge");
  if (statusBadge) {
    statusBadge.className = `pc-status-badge ${pc.online ? "online" : "offline"}`;
    statusBadge.textContent = pc.online ? "Online" : "Offline";
  }

  const { fetched, progress, completed, failed } = classifyGroups(pc.groups || [], pc.rows || {});

  // Patch sys stats values only
  if (pc.sysStats) {
    const stats = card.querySelectorAll(".stat-val");
    if (stats.length >= 4) {
      const s = pc.sysStats;
      patchText(stats[0], `${(s.cpuUsage || 0).toFixed(1)}%`);
      const ramPct = s.ramTotal ? Math.round((s.ramUsed / s.ramTotal) * 100) : 0;
      patchText(stats[1], `${formatBytes(s.ramUsed)} / ${formatBytes(s.ramTotal)} (${ramPct}%)`);
      patchText(stats[2], `${formatBytes(s.diskAvailable)} free of ${formatBytes(s.diskTotal)}`);
      patchText(stats[3], `${formatBytes(s.totalSpeed || 0)}/s`);
      
      if (stats.length >= 6) {
        const { downloadedBytes, totalBytes } = calculatePcProgress(pc, progress);
        if (totalBytes > 0) {
          patchText(stats[4], `${Math.round(downloadedBytes * 100 / totalBytes)}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`);
          stats[4].parentElement.style.display = "";
        } else {
          stats[4].parentElement.style.display = "none";
        }

        const etaSecs = calculatePcETA(pc, progress);
        const etaStr = etaSecs ? formatETA(etaSecs) : "";
        if (etaStr) {
          patchText(stats[5], etaStr);
          stats[5].parentElement.style.display = "";
        } else {
          stats[5].parentElement.style.display = "none";
        }
      }
    }
  }

  // Patch remote download button disabled state
  const dlBtn = card.querySelector(".remote-dl-btn");
  if (dlBtn) dlBtn.disabled = !pc.online;

  // Patch accordion contents — full replace only inside accordion-content divs
  const categories = [
    { list: fetched, type: "fetched" },
    { list: progress, type: "progress" },
    { list: completed, type: "completed" },
    { list: failed, type: "failed" },
  ];

  const accordions = card.querySelectorAll(".pc-accordions > details");
  categories.forEach(({ list, type }, i) => {
    const detail = accordions[i];
    if (!detail) return;

    // Update summary count
    const summary = detail.querySelector("summary");
    const labels = ["Fetched Builds", "Progress", "Completed", "Failed"];
    const newSummary = `${labels[i]} (${list.length})`;
    if (summary && summary.textContent !== newSummary) summary.textContent = newSummary;

    // Only patch accordion-content if this section is open
    if (!detail.open) return;

    const content = detail.querySelector(".accordion-content");
    if (!content) return;

    // Build new HTML for this accordion
    const fetchedIds = type === "fetched" ? list.map((g) => g.id).join(",") : "";
    const progressIds = type === "progress" ? list.map((g) => g.id).join(",") : "";
    let bulkHtml = "";
    if (type === "fetched" && list.length) {
      bulkHtml = `<div class="bulk-actions"><button class="btn-primary btn-sm bulk-start-btn" data-pc-id="${pc.pcId}" data-group-ids="${fetchedIds}">Download all</button><button class="btn-secondary btn-sm bulk-deselect-btn">Deselect all</button><button class="btn-danger btn-sm bulk-delete-btn" data-pc-id="${pc.pcId}" data-group-ids="${fetchedIds}">Delete all</button></div>`;
    } else if (type === "progress" && list.length) {
      bulkHtml = `<div class="bulk-actions"><button class="btn-danger btn-sm bulk-cancel-btn" data-pc-id="${pc.pcId}" data-group-ids="${progressIds}">Cancel all</button></div>`;
    }
    const groupHtml = renderGroupList(pc, list, type);
    const newInner = bulkHtml + groupHtml;

    // Compare and only replace if changed
    if (content.innerHTML !== newInner) {
      content.innerHTML = newInner;
      // Re-bind event listeners
      content.querySelectorAll(".bulk-start-btn").forEach((btn) => {
        btn.addEventListener("click", () => remoteStartGroups(btn.dataset.pcId, btn.dataset.groupIds.split(",").filter(Boolean)));
      });
      content.querySelectorAll(".bulk-delete-btn").forEach((btn) => {
        btn.addEventListener("click", () => remoteDeleteGroups(btn.dataset.pcId, btn.dataset.groupIds.split(",").filter(Boolean)));
      });
      content.querySelectorAll(".bulk-deselect-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ft = classifyGroups(pc.groups || [], pc.rows || {}).fetched;
          ft.forEach((group) => group.artifacts.filter((a) => a.selected !== false).forEach((a) => remoteSetArtifactSelected(pc.pcId, group.id, a.id, false)));
        });
      });
      content.querySelectorAll(".bulk-cancel-btn").forEach((btn) => {
        btn.addEventListener("click", () => remoteCancelGroups(btn.dataset.pcId, btn.dataset.groupIds.split(",").filter(Boolean)));
      });
    }
  });
}

// ponytail: only touch DOM if text actually changed
function patchText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
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
