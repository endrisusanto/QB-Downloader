// ponytail: minimal WebSocket hub — no DB, in-memory only, 2 deps
"use strict";
const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer } = require("ws");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ""; // empty = no auth required

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** @type {Map<string, {ws: import('ws'), info: object, jobs: object[], lastSeen: string}>} */
const pcs = new Map();
/** @type {Set<import('ws')>} */
const viewers = new Set();

function checkAuth(req, ws) {
  if (!API_KEY) return true;
  const url = new URL(req.url, "http://localhost");
  const token = url.searchParams.get("token") || (req.headers.authorization || "").replace("Bearer ", "");
  if (token !== API_KEY) { ws.close(4001, "Unauthorized"); return false; }
  return true;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim().replace(/^::ffff:/, "");
}

function stateMessage() {
  return JSON.stringify({
    type: "state_update",
    pcs: [...pcs.values()].map((pc) => ({
      pcId: pc.info.pcId,
      pcName: pc.info.pcName || pc.info.pcId.slice(0, 8),
      ip: pc.info.ip || "",
      os: pc.info.os || "",
      online: true,
      lastSeen: pc.lastSeen,
      presetTypes: pc.info.presetTypes || [],
      groups: pc.info.groups || [],
      rows: pc.info.rows || {},
      sysStats: pc.info.sysStats || null,
    })),
  });
}

function broadcastState() {
  const msg = stateMessage();
  for (const v of viewers) if (v.readyState === 1) v.send(msg);
}

function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function buildIds(value) {
  return (Array.isArray(value) ? value : [value]).flatMap((id) => String(id || "").split(/[\s,]+/)).filter(Boolean);
}

wss.on("connection", (ws, req) => {
  if (!checkAuth(req, ws)) return;
  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/ws/agent") {
    let pcId = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "heartbeat") {
          pcId = msg.pcId;
          const existing = pcs.get(pcId);
          pcs.set(pcId, {
            ws,
            info: { ...existing?.info, ...msg, ip: msg.ip || existing?.info?.ip || clientIp(req) },
            lastSeen: new Date().toISOString()
          });
          broadcastState();

        } else if (msg.type === "progress" && msg.pcId) {
          const pc = pcs.get(msg.pcId);
          if (pc) {
            pc.info = { ...pc.info, ...msg };
            pc.lastSeen = new Date().toISOString();
          }
          broadcastState();

        } else if (msg.type === "download_ack") {
          // Forward ack to all viewers
          const payload = JSON.stringify({ type: "download_ack", ...msg });
          for (const v of viewers) if (v.readyState === 1) v.send(payload);
        }
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => {
      if (!pcId) return;
      // Keep in map but mark offline after 90s if no reconnect
      setTimeout(() => {
        const pc = pcs.get(pcId);
        if (pc && pc.ws === ws) { pcs.delete(pcId); broadcastState(); }
      }, 90_000);
    });

  } else if (path === "/ws/client") {
    viewers.add(ws);
    sendTo(ws, JSON.parse(stateMessage())); // send current state immediately

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "remote_download") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            for (const qbId of buildIds(msg.qbIds || msg.qbId)) sendTo(pc.ws, {
              type: "start_download", commandId: randomUUID(), qbId,
              artifactTypes: msg.artifactTypes, autoStart: msg.autoStart !== false
            });
          } else {
            sendTo(ws, { type: "error", message: "PC not online or not found" });
          }
        } else if (msg.type === "remote_delete_group") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            sendTo(pc.ws, { type: "delete_group", groupId: msg.groupId });
          }
        } else if (msg.type === "remote_delete_artifact") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            sendTo(pc.ws, { type: "delete_artifact", groupId: msg.groupId, artifactId: msg.artifactId });
          }
        } else if (msg.type === "remote_restart_artifact") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            sendTo(pc.ws, { type: "restart_artifact", groupId: msg.groupId, artifactId: msg.artifactId });
          }
        } else if (msg.type === "remote_start_artifact") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            sendTo(pc.ws, { type: "start_artifact", groupId: msg.groupId, artifactId: msg.artifactId });
          }
        } else if (msg.type === "remote_set_artifact_selected") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            sendTo(pc.ws, { type: "set_artifact_selected", groupId: msg.groupId, artifactId: msg.artifactId, selected: msg.selected === true });
          }
        } else if (msg.type === "remote_start_group") {
          const pc = pcs.get(msg.pcId);
          if (pc?.ws?.readyState === 1) {
            sendTo(pc.ws, { type: "start_group", groupId: msg.groupId });
          }
        }
      } catch { /* ignore */ }
    });

    ws.on("close", () => viewers.delete(ws));

  } else {
    ws.close(4004, "Unknown path");
  }
});

// Sweep stale PCs every 30s (fallback for crashed agents that don't disconnect cleanly)
setInterval(() => {
  const cutoff = Date.now() - 90_000;
  let changed = false;
  for (const [id, pc] of pcs) {
    if (new Date(pc.lastSeen).getTime() < cutoff) { pcs.delete(id); changed = true; }
  }
  if (changed) broadcastState();
}, 30_000);

// REST endpoints — useful for Android polling fallback and healthcheck
app.get("/api/health", (_, res) => res.json({ ok: true, pcs: pcs.size }));

app.get("/api/state", (req, res) => {
  if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) return res.status(401).json({ error: "Unauthorized" });
  res.json(JSON.parse(stateMessage()));
});

app.post("/api/download", (req, res) => {
  if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) return res.status(401).json({ error: "Unauthorized" });
  const { pcId, qbId, qbIds: requestedIds, artifactTypes, autoStart } = req.body || {};
  const qbIds = buildIds(requestedIds || qbId);
  if (!pcId || !qbIds.length || !artifactTypes?.length) return res.status(400).json({ error: "Missing pcId, qbIds, or artifactTypes" });
  const pc = pcs.get(pcId);
  if (!pc?.ws || pc.ws.readyState !== 1) return res.status(404).json({ error: "PC not online" });
  const commandIds = qbIds.map((qbId) => {
    const commandId = randomUUID();
    sendTo(pc.ws, { type: "start_download", commandId, qbId, artifactTypes, autoStart: autoStart !== false });
    return commandId;
  });
  res.json({ ok: true, commandIds });
});

// SPA fallback
app.get("*", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

server.listen(PORT, () => console.log(`QB Dashboard running on http://localhost:${PORT}`));
