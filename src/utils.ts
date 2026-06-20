import { defaultSettings } from "./constants";
import type { Artifact, ArtifactKind, BuildArtifactGroup, DownloadEvent, ProgressState, SettingsState } from "./types";

const LEGACY_FILTERS: Record<string, string> = {
  ALL: "ALL_",
  AP: "AP_",
  BL: "BL_",
  CP: "CP_",
  CSC: "CSC_",
  USERDATA: "USERDATA_",
  HOME: "HOME_",
};

export function splitBulkInput(value: string) {
  return [...new Set(value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean))];
}

export function migrateFilters(filters: unknown): string[] {
  if (!Array.isArray(filters)) return defaultSettings.selectedTypes;
  return [...new Set(filters.map((item) => LEGACY_FILTERS[String(item)] || String(item)))];
}

export function sanitizePreferences(raw: Partial<SettingsState> = {}) {
  return {
    quickBuildUrl: raw.quickBuildUrl || defaultSettings.quickBuildUrl,
    downloadTargetDir: raw.downloadTargetDir || "",
    maxConcurrent: Math.min(16, Math.max(1, Number(raw.maxConcurrent) || 3)),
    selectedTypes: migrateFilters(raw.selectedTypes),
    showProgressDialog: Boolean(raw.showProgressDialog),
    showCompleteDialog: raw.showCompleteDialog !== false,
    hideUncheckedArtifacts: Boolean(raw.hideUncheckedArtifacts),
    darkMode: Boolean(raw.darkMode),
    serverUrl: raw.serverUrl || "",
    pcName: raw.pcName || "",
  };
}

export function normalizeGroup(raw: BuildArtifactGroup, fallbackInput: string): BuildArtifactGroup {
  const buildId = raw?.buildId || "";
  return {
    id: raw?.id || crypto.randomUUID(),
    input: raw?.input || fallbackInput,
    buildId: buildId || undefined,
    status: raw?.status || "ready",
    version: raw?.version,
    error: raw?.error,
    lastCheckedAt: raw?.lastCheckedAt,
    nextCheckAt: raw?.nextCheckAt,
    artifacts: (Array.isArray(raw?.artifacts) ? raw.artifacts : [])
      .map((artifact, index) => normalizeArtifact(artifact, buildId, index))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  };
}

function normalizeArtifact(raw: Artifact, buildId: string, index: number): Artifact {
  return {
    id: raw?.id || `${buildId}:${index}:${raw?.name || "artifact"}`,
    buildId: raw?.buildId || buildId,
    name: raw?.name || `Artifact ${index + 1}`,
    size: raw?.size,
    url: raw?.url,
    kind: normalizeArtifactKind(raw?.kind),
    selected: Boolean(raw?.selected),
  };
}

function normalizeArtifactKind(kind: unknown): ArtifactKind {
  const value = String(kind || "other").toLowerCase();
  return ["all", "ap", "bl", "cp", "csc", "md5", "userdata", "home"].includes(value)
    ? (value as ArtifactKind)
    : "other";
}

export function prepareGroup(group: BuildArtifactGroup, filters: string[], autoCheck: boolean): BuildArtifactGroup {
  const enabled = new Set(filters);
  return {
    ...group,
    artifacts: group.artifacts.map((artifact) => ({
      ...artifact,
      selected: autoCheck ? filterForKind(artifact.kind, artifact.name, enabled) : false,
    })),
  };
}

function filterForKind(kind: ArtifactKind, name: string, enabled: Set<string>) {
  if (kind === "md5") return enabled.has("md5") && name.toLowerCase().endsWith(".md5");
  const prefix = `${kind.toUpperCase()}_`;
  return enabled.has(prefix) && name.toUpperCase().startsWith(prefix);
}

export function selectedArtifacts(group: BuildArtifactGroup) {
  return group.artifacts.filter((artifact) => artifact.selected);
}

export function visibleArtifacts(group: BuildArtifactGroup, filters: string[]) {
  const enabled = new Set(filters);
  return group.artifacts.filter((artifact) => filterForKind(artifact.kind, artifact.name, enabled));
}

export function areAllBuildsExpanded(groupIds: string[], expanded: Record<string, boolean>) {
  return groupIds.length > 0 && groupIds.every((id) => expanded[id] ?? true);
}

export function jobIdFromStatus(status?: string) {
  return status?.startsWith("job:") ? status.slice(4) : undefined;
}

export function progressState(row?: Pick<DownloadEvent, "status" | "downloaded" | "total">): ProgressState {
  if (row?.status === "completed") return { mode: "completed", percent: 100 };
  if (row?.total && row.total > 0) {
    return {
      mode: "determinate",
      percent: Math.max(0, Math.min(100, Math.round((row.downloaded / row.total) * 100))),
    };
  }
  if (row?.status === "downloading") return { mode: "indeterminate", percent: 0 };
  return { mode: "determinate", percent: 0 };
}

export function statusLabel(row?: Pick<DownloadEvent, "status" | "downloaded" | "total">) {
  if (!row) return "ready";
  const progress = progressState(row);
  if (row.status === "downloading" && progress.mode !== "indeterminate") {
    return `downloading ${progress.percent}%`;
  }
  return row.status;
}

export function groupProgress(artifacts: Artifact[], rows: Record<string, DownloadEvent>): ProgressState {
  if (!artifacts.length) return { mode: "determinate", percent: 0 };
  const values = artifacts.map((artifact) => progressState(rows[artifact.id]));
  if (values.every((value) => value.mode === "completed")) return { mode: "completed", percent: 100 };
  if (values.some((value) => value.mode === "indeterminate")) return { mode: "indeterminate", percent: 0 };
  return {
    mode: "determinate",
    percent: Math.round(values.reduce((sum, value) => sum + value.percent, 0) / values.length),
  };
}

export function formatBytes(value?: number) {
  if (value == null) return "Unknown";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatSpeed(value: number) {
  return value > 0 ? `${formatBytes(value)}/s` : "Idle";
}

export function kindLabel(kind: ArtifactKind) {
  return kind === "md5" ? "MD5" : kind === "other" ? "Other" : `${kind.toUpperCase()}_`;
}

export function folderFromFilePath(path: string) {
  return path.replace(/[\\/][^\\/]+$/, "");
}
