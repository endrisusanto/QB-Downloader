import { DIALOG_CHANNEL } from "./constants";
import type { BuildArtifactGroup, DialogKind, DialogSnapshot, DownloadEvent } from "./types";

const SNAPSHOT_FLUSH_MS = 750;
const snapshotTimers: Record<string, number> = {};
const pendingSnapshots: Record<string, DialogSnapshot> = {};

export function dialogStorageKey(kind: DialogKind, groupId: string) { return `qb-dialog:${kind}:${groupId}`; }
export function dialogWindowLabel(kind: DialogKind, groupId: string) { return `qb-${kind}-${groupId.replace(/[^a-zA-Z0-9-]/g, "-")}`; }
export function writeDialogSnapshot(kind: DialogKind, group: BuildArtifactGroup, rows: Record<string, DownloadEvent>, slotSpeeds: Record<string, number> = {}) {
  const key = dialogStorageKey(kind, group.id);
  localStorage.setItem(key, JSON.stringify({ kind, group, rows, slotSpeeds } satisfies DialogSnapshot));
  const channel = new BroadcastChannel(DIALOG_CHANNEL);
  channel.postMessage({ key });
  channel.close();
}
export function scheduleDialogSnapshot(kind: DialogKind, group: BuildArtifactGroup, rows: Record<string, DownloadEvent>, slotSpeeds: Record<string, number> = {}) {
  const key = dialogStorageKey(kind, group.id);
  pendingSnapshots[key] = { kind, group, rows, slotSpeeds };
  if (snapshotTimers[key]) return;
  snapshotTimers[key] = window.setTimeout(() => {
    delete snapshotTimers[key];
    const snapshot = pendingSnapshots[key];
    delete pendingSnapshots[key];
    if (snapshot) writeDialogSnapshot(snapshot.kind, snapshot.group, snapshot.rows, snapshot.slotSpeeds);
  }, SNAPSHOT_FLUSH_MS);
}
export function readDialogSnapshot(key: string): DialogSnapshot | null {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
export function standaloneDialogConfig() {
  const params = new URLSearchParams(location.search);
  const kind = params.get("dialog");
  const storageKey = params.get("key");
  return (kind === "progress" || kind === "complete") && storageKey ? { kind, storageKey } as const : null;
}
