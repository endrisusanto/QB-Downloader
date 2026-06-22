import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildArtifactGroup, DownloadEvent } from "../types";

// Types matching the Rust implementation
export type SystemStats = {
  cpuUsage: number;
  ramTotal: number;
  ramUsed: number;
  diskTotal: number;
  diskAvailable: number;
};

export type SyncStatus = "disconnected" | "connecting" | "connected";

const PC_ID_KEY = "quickbuild-pc-id";

/** Stable random ID for this PC installation, stored in localStorage */
export function getOrCreatePcId(): string {
  const existing = localStorage.getItem(PC_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(PC_ID_KEY, id);
  return id;
}

/**
 * Connects to the remote relay server via WebSocket.
 * - Broadcasts full Tauri state (groups, rows, presetTypes) and system stats.
 * - Handles remote commands: delete_group, delete_artifact, restart_artifact, start_group, set_artifact_selected.
 */
export function useServerSync(
  serverUrl: string,
  pcName: string,
  downloadTargetDir: string,
  presetTypes: string[],
  groups: BuildArtifactGroup[],
  rows: Record<string, DownloadEvent>,
  totalSpeed: number,
  onRemoteDownload: (qbIds: string | string[], artifactTypes: string[], autoStart: boolean) => void | Promise<void>,
  onRemoteDeleteGroup: (groupId: string) => void,
  onRemoteDeleteArtifact: (groupId: string, artifactId: string) => void,
  onRemoteRestartArtifact: (groupId: string, artifactId: string) => void,
  onRemoteStartGroup: (groupId: string) => void,
  onRemoteToggleArtifact: (groupId: string, artifactId: string, selected: boolean) => void,
) {
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);
  const [localIp, setLocalIp] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const pcId = getOrCreatePcId();
  const displayName = pcName || `PC-${pcId.slice(0, 8)}`;

  // Keep stable refs to handlers to prevent socket reconnection loops
  const onRemoteDownloadRef = useRef(onRemoteDownload);
  const onRemoteDeleteGroupRef = useRef(onRemoteDeleteGroup);
  const onRemoteDeleteArtifactRef = useRef(onRemoteDeleteArtifact);
  const onRemoteRestartArtifactRef = useRef(onRemoteRestartArtifact);
  const onRemoteStartGroupRef = useRef(onRemoteStartGroup);
  const onRemoteToggleArtifactRef = useRef(onRemoteToggleArtifact);

  const groupsRef = useRef(groups);
  const rowsRef = useRef(rows);
  const presetTypesRef = useRef(presetTypes);
  const sysStatsRef = useRef(sysStats);
  const totalSpeedRef = useRef(totalSpeed);
  const localIpRef = useRef(localIp);

  useEffect(() => {
    onRemoteDownloadRef.current = onRemoteDownload;
    onRemoteDeleteGroupRef.current = onRemoteDeleteGroup;
    onRemoteDeleteArtifactRef.current = onRemoteDeleteArtifact;
    onRemoteRestartArtifactRef.current = onRemoteRestartArtifact;
    onRemoteStartGroupRef.current = onRemoteStartGroup;
    onRemoteToggleArtifactRef.current = onRemoteToggleArtifact;
  }, [onRemoteDownload, onRemoteDeleteGroup, onRemoteDeleteArtifact, onRemoteRestartArtifact, onRemoteStartGroup, onRemoteToggleArtifact]);

  useEffect(() => {
    groupsRef.current = groups;
    rowsRef.current = rows;
    presetTypesRef.current = presetTypes;
    sysStatsRef.current = sysStats;
    totalSpeedRef.current = totalSpeed;
    localIpRef.current = localIp;
  }, [groups, rows, presetTypes, sysStats, totalSpeed, localIp]);

  useEffect(() => {
    void invoke<string | null>("get_local_ipv4").then((ip) => setLocalIp(ip || "")).catch(() => setLocalIp(""));
  }, []);

  // Fetch CPU, RAM and disk capacity stats periodically
  useEffect(() => {
    if (!serverUrl || !downloadTargetDir) {
      setSysStats(null);
      return;
    }
    const fetchStats = async () => {
      try {
        const stats = await invoke<SystemStats>("get_system_stats", { targetDir: downloadTargetDir });
        setSysStats(stats);
      } catch (err) {
        console.error("Failed to get system stats:", err);
      }
    };
    fetchStats();
    const timer = window.setInterval(fetchStats, 10_000);
    return () => window.clearInterval(timer);
  }, [serverUrl, downloadTargetDir]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    const cleanUrl = serverUrl.trim();
    if (!cleanUrl) return;
    if (reconnectTimer.current) { window.clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
    try {
      const wsUrl = cleanUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/agent";
      setStatus("connecting");
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      const getPayload = (type: string) => ({
        type,
        pcId,
        pcName: displayName,
        ip: localIpRef.current,
        os: navigator.platform,
        presetTypes: presetTypesRef.current,
        groups: groupsRef.current,
        rows: rowsRef.current,
        sysStats: sysStatsRef.current
          ? { ...sysStatsRef.current, totalSpeed: totalSpeedRef.current }
          : { cpuUsage: 0, ramTotal: 0, ramUsed: 0, diskTotal: 0, diskAvailable: 0, totalSpeed: totalSpeedRef.current },
      });

      socket.onopen = () => {
        setStatus("connected");
        send(getPayload("heartbeat"));
      };
      socket.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;
        reconnectTimer.current = window.setTimeout(connect, 5_000);
      };
      socket.onerror = () => { /* onclose will fire */ };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "start_download") {
            void onRemoteDownloadRef.current(
              msg.qbIds ?? msg.qbId,
              msg.artifactTypes ?? [],
              msg.autoStart !== false && msg.autoStart !== "false"
            );
          } else if (msg.type === "delete_group") {
            onRemoteDeleteGroupRef.current(msg.groupId);
          } else if (msg.type === "delete_artifact") {
            onRemoteDeleteArtifactRef.current(msg.groupId, msg.artifactId);
          } else if (msg.type === "restart_artifact") {
            onRemoteRestartArtifactRef.current(msg.groupId, msg.artifactId);
          } else if (msg.type === "start_group") {
            onRemoteStartGroupRef.current(msg.groupId);
          } else if (msg.type === "set_artifact_selected") {
            onRemoteToggleArtifactRef.current(msg.groupId, msg.artifactId, Boolean(msg.selected));
          } else if (msg.type === "start_artifact") {
            onRemoteRestartArtifactRef.current(msg.groupId, msg.artifactId);
          }
        } catch { /* ignore malformed */ }
      };
    } catch {
      setStatus("disconnected");
      reconnectTimer.current = window.setTimeout(connect, 5_000);
    }
  }, [serverUrl, pcId, displayName, send]);

  // Connect / reconnect when serverUrl changes
  useEffect(() => {
    if (!serverUrl) { setStatus("disconnected"); return; }
    connect();
    return () => {
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect, serverUrl]);

  // Heartbeat every 30s
  useEffect(() => {
    if (!serverUrl) return;
    const timer = window.setInterval(() => {
      send({
        type: "heartbeat",
        pcId,
        pcName: displayName,
        ip: localIpRef.current,
        os: navigator.platform,
        presetTypes: presetTypesRef.current,
        sysStats: sysStatsRef.current
          ? { ...sysStatsRef.current, totalSpeed: totalSpeedRef.current }
          : { cpuUsage: 0, ramTotal: 0, ramUsed: 0, diskTotal: 0, diskAvailable: 0, totalSpeed: totalSpeedRef.current },
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [send, pcId, displayName, serverUrl]);

  // Forward full state whenever it changes
  useEffect(() => {
    if (!serverUrl || status !== "connected") return;
    send({
      type: "progress",
      pcId,
      pcName: displayName,
      ip: localIp,
      os: navigator.platform,
      presetTypes,
      groups,
      rows,
      sysStats: sysStats ? { ...sysStats, totalSpeed } : { cpuUsage: 0, ramTotal: 0, ramUsed: 0, diskTotal: 0, diskAvailable: 0, totalSpeed },
    });
  }, [serverUrl, status, pcId, displayName, localIp, presetTypes, groups, rows, sysStats, totalSpeed, send]);

  return { status };
}
