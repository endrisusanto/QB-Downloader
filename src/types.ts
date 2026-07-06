export type Credentials = { username: string; accessToken: string };
export type QuickBuildConfig = { baseUrl: string; apiSuffix: string };

export type ArtifactKind =
  | "all"
  | "ap"
  | "bl"
  | "cp"
  | "csc"
  | "md5"
  | "userdata"
  | "home"
  | "other";

export type Artifact = {
  id: string;
  buildId: string;
  name: string;
  size?: number;
  url?: string;
  kind: ArtifactKind;
  selected: boolean;
};

export type BuildArtifactGroup = {
  id: string;
  input: string;
  buildId?: string;
  status: string;
  version?: string;
  artifacts: Artifact[];
  error?: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  customFilters?: string[];
};

export type DownloadStatus =
  | "downloading"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type DownloadEvent = {
  jobId: string;
  artifactId: string;
  buildId: string;
  name: string;
  status: DownloadStatus;
  downloaded: number;
  total?: number;
  path?: string;
  message?: string;
  resumable: boolean;
  attempt: number;
  maxAttempts: number;
  nextRetryMs?: number;
};

export type DownloadHistoryEntry = {
  id: string;
  artifactId: string;
  buildId: string;
  name: string;
  status: DownloadStatus;
  downloaded: number;
  total?: number;
  path?: string;
  message?: string;
  jobId: string;
  startedAt: string;
  updatedAt: string;
};

export type TokenTestResult = {
  ok: boolean;
  selectedUsername?: string;
  attempts: { username: string; ok: boolean; message: string }[];
};

export type SettingsState = {
  username: string;
  accessToken: string;
  apiSuffix: string;
  quickBuildUrl: string;
  downloadTargetDir: string;
  selectedTypes: string[];
  showCompleteDialog: boolean;
  hideUncheckedArtifacts: boolean;
  darkMode: boolean;
  serverUrl: string;
  pcName: string;
  remoteCancelPin: string;
};

export type ProgressMode = "determinate" | "indeterminate" | "completed";
export type ProgressState = { mode: ProgressMode; percent: number };

export type DialogKind = "progress" | "complete";
export type DialogSnapshot = {
  kind: DialogKind;
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  slotSpeeds: Record<string, number>;
};

export type SectionKey = "fetched" | "progress" | "completed" | "failed";
