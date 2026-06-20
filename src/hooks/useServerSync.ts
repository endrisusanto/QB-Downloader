import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadEvent } from "../types";

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
 * - Sends heartbeat every 30s so the server knows this PC is alive.
 * - Forwards all download events as `progress` messages.
 * - Calls `onRemoteDownload` when the server issues a `start_download` command.
 */
export function useServerSync(
  serverUrl: string,
  pcName: string,
  onRemoteDownload: (qbId: string, artifactTypes: string[]) => void,
) {
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const jobsRef = useRef<Record<string, DownloadEvent>>({});
  const pcId = getOrCreatePcId();
  const displayName = pcName || `PC-${pcId.slice(0, 8)}`;

  // Keep a stable ref to onRemoteDownload to avoid reconnect cycles on re-render
  const onRemoteDownloadRef = useRef(onRemoteDownload);
  useEffect(() => {
    onRemoteDownloadRef.current = onRemoteDownload;
  }, [onRemoteDownload]);

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
      // Convert http(s) → ws(s) and append agent path
      const wsUrl = cleanUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/ws/agent";
      setStatus("connecting");
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setStatus("connected");
        send({ type: "heartbeat", pcId, pcName: displayName, os: navigator.platform });
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
            onRemoteDownloadRef.current(msg.qbId, msg.artifactTypes ?? []);
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
      send({ type: "heartbeat", pcId, pcName: displayName, os: navigator.platform });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [send, pcId, displayName, serverUrl]);

  // Forward Tauri download events → server
  useEffect(() => {
    if (!serverUrl) return;
    const names = ["queued", "progress", "retrying", "completed", "failed", "cancelled"];
    const unlisten = Promise.all(
      names.map((name) =>
        listen<DownloadEvent>(`download://${name}`, ({ payload }) => {
          jobsRef.current[payload.artifactId] = payload;
          // Prune old completed/cancelled to keep payload small
          for (const [id, job] of Object.entries(jobsRef.current)) {
            if ((job.status === "completed" || job.status === "cancelled") && id !== payload.artifactId) {
              // keep last 20 terminal entries max
            }
          }
          send({ type: "progress", pcId, jobs: Object.values(jobsRef.current) });
        }),
      ),
    );
    return () => void unlisten.then((fns) => fns.forEach((f) => f()));
  }, [send, pcId, serverUrl]);

  return { status };
}
