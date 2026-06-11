import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  KeyRound,
  Moon,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import {
  Component,
  CSSProperties,
  ErrorInfo,
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Credentials = {
  username: string;
  accessToken: string;
};

type ArtifactKind = "all" | "ap" | "bl" | "cp" | "csc" | "md5" | "userdata" | "home" | "other";

type Artifact = {
  id: string;
  buildId: string;
  name: string;
  size?: number;
  url?: string;
  kind: ArtifactKind;
  selected: boolean;
};

type BuildArtifactGroup = {
  id: string;
  input: string;
  buildId?: string;
  status: string;
  version?: string;
  artifacts: Artifact[];
  error?: string;
};

type DownloadEvent = {
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
  speedBps?: number;
  updatedAt?: number;
  speedSamples?: SpeedSample[];
};

type SpeedSample = {
  at: number;
  downloaded: number;
};

type DownloadStatus =
  | "queued"
  | "fetching"
  | "ready"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

type TokenTestAttempt = {
  username: string;
  ok: boolean;
  message: string;
};

type TokenTestResult = {
  ok: boolean;
  selectedUsername?: string;
  attempts: TokenTestAttempt[];
};

type SettingsState = {
  username: string;
  accessToken: string;
  downloadTargetDir: string;
  maxConcurrent: number;
  selectedTypes: string[];
  showProgressDialog: boolean;
  showCompleteDialog: boolean;
  darkMode: boolean;
};

type DialogKind = "progress" | "complete";

type DialogSnapshot = {
  kind: DialogKind;
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
};

const STORAGE_KEY = "quickbuild-download-manager-settings";
const DIALOG_CHANNEL = "quickbuild-download-dialogs";
const DEFAULT_TYPES = ["ALL", "AP", "BL", "CP", "CSC", "md5", "USERDATA", "HOME"];
const TYPE_OPTIONS = ["ALL", "AP", "BL", "CP", "CSC", "md5", "USERDATA", "HOME"];

const defaultSettings: SettingsState = {
  username: "",
  accessToken: "",
  downloadTargetDir: "",
  maxConcurrent: 3,
  selectedTypes: DEFAULT_TYPES,
  showProgressDialog: false,
  showCompleteDialog: true,
  darkMode: false,
};

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="app-shell">
        <section className="content-area">
          <div className="empty-state compact app-error">
            <img src="/quickbuild-logo.svg" alt="" />
            <h1>App render error</h1>
            <p>{this.state.error.message || "Unknown error"}</p>
            <button className="primary-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </section>
      </main>
    );
  }
}

function AppContent() {
  const standaloneDialog = getStandaloneDialogConfig();
  if (standaloneDialog) {
    return <StandaloneDialogWindow kind={standaloneDialog.kind} storageKey={standaloneDialog.storageKey} />;
  }

  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [groups, setGroups] = useState<BuildArtifactGroup[]>([]);
  const [downloadRows, setDownloadRows] = useState<Record<string, DownloadEvent>>({});
  const [query, setQuery] = useState("");
  const [loadingInputs, setLoadingInputs] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(!hasRequiredSettings(loadSettings()));
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [progressGroupId, setProgressGroupId] = useState<string | null>(null);
  const [completeGroupId, setCompleteGroupId] = useState<string | null>(null);
  const completedNotifiedRef = useRef<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!settings.showCompleteDialog) return;

    for (const group of groups) {
      if (!group.buildId || completedNotifiedRef.current.has(group.id)) continue;
      const rows = selectedArtifacts(group).map((artifact) => downloadRows[artifact.id]).filter(Boolean);
      if (rows.length > 0 && rows.every((row) => row.status === "completed")) {
        completedNotifiedRef.current.add(group.id);
        void openDialogWindow("complete", group).then((opened) => {
          if (!opened) setCompleteGroupId(group.id);
        });
        break;
      }
    }
  }, [downloadRows, groups, settings.showCompleteDialog]);

  useEffect(() => {
    for (const group of groups) {
      if (groupArtifacts(group).some((artifact) => downloadRows[artifact.id])) {
        writeDialogSnapshot("progress", group, downloadRows);
        writeDialogSnapshot("complete", group, downloadRows);
      }
    }
  }, [downloadRows, groups]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const unlisten = Promise.all(
      [
        "download://queued",
        "download://progress",
        "download://paused",
        "download://completed",
        "download://failed",
        "download://cancelled",
      ].map((eventName) =>
        listen<DownloadEvent>(eventName, (event) => {
          const payload = event.payload;
          if (!payload.artifactId) return;
          const now = Date.now();
          setDownloadRows((current) => {
            const previous = current[payload.artifactId];
            if (shouldSkipDownloadUpdate(payload, previous, now)) {
              return current;
            }
            return {
              ...current,
              [payload.artifactId]: enrichDownloadEvent(payload, previous, now),
            };
          });
        }),
      ),
    );

    return () => {
      void unlisten.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  const credentials = useMemo<Credentials>(
    () => ({
      username: settings.username,
      accessToken: settings.accessToken,
    }),
    [settings.username, settings.accessToken],
  );

  async function fetchOne(rawInput: string) {
    const input = rawInput.trim();
    if (!input) return;
    if (!hasRequiredSettings(settings)) {
      setSettingsOpen(true);
      return;
    }

    setLoadingInputs((current) => new Set(current).add(input));
    try {
      const group = await invoke<BuildArtifactGroup>("fetch_build_artifacts", {
        input,
        credentials,
      });
      const prepared = prepareGroup(normalizeGroup(group, input), settings.selectedTypes);
      setGroups((current) => upsertGroup(current, prepared));
      setExpanded((current) => ({ ...current, [prepared.id]: true }));
    } catch (error) {
      const failed: BuildArtifactGroup = {
        id: createId(),
        input,
        status: "failed",
        artifacts: [],
        error: String(error),
      };
      setGroups((current) => [failed, ...current]);
    } finally {
      setLoadingInputs((current) => {
        const next = new Set(current);
        next.delete(input);
        return next;
      });
    }
  }

  async function fetchBulk(inputs: string[]) {
    const clean = normalizeInputs(inputs);
    if (!clean.length) return;
    if (!hasRequiredSettings(settings)) {
      setSettingsOpen(true);
      return;
    }

    setLoadingInputs((current) => {
      const next = new Set(current);
      clean.forEach((input) => next.add(input));
      return next;
    });

    try {
      const results = await invoke<BuildArtifactGroup[]>("fetch_bulk_build_artifacts", {
        inputs: clean,
        credentials,
      });
      const prepared = results.map((group, index) =>
        prepareGroup(normalizeGroup(group, clean[index] || "bulk"), settings.selectedTypes),
      );
      setGroups((current) => prepared.reduce((acc, group) => upsertGroup(acc, group), current));
      setExpanded((current) => {
        const next = { ...current };
        prepared.forEach((group) => {
          next[group.id] = true;
        });
        return next;
      });
    } finally {
      setLoadingInputs((current) => {
        const next = new Set(current);
        clean.forEach((input) => next.delete(input));
        return next;
      });
    }
  }

  async function startDownload(group: BuildArtifactGroup) {
    if (!group.buildId) return;
    if (!settings.downloadTargetDir) {
      setSettingsOpen(true);
      return;
    }

    const selected = selectedArtifacts(group);
    if (!selected.length) return;

    setDownloadRows((current) => omitArtifactRows(current, selected.map((artifact) => artifact.id)));

    const jobId = await invoke<string>("start_download", {
      group: {
        buildId: group.buildId,
        targetDir: settings.downloadTargetDir,
        credentials,
        maxConcurrent: settings.maxConcurrent,
        artifacts: selected,
      },
    });

    setGroups((current) =>
      current.map((item) => (item.id === group.id ? { ...item, status: `job:${jobId}` } : item)),
    );

    if (settings.showProgressDialog) {
      void openDialogWindow("progress", group).then((opened) => {
        if (!opened) setProgressGroupId(group.id);
      });
    }
  }

  function setGroupSelection(groupId: string, selected: boolean) {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              artifacts: groupArtifacts(group).map((artifact) => ({ ...artifact, selected })),
            }
          : group,
      ),
    );
  }

  function removeGroup(group: BuildArtifactGroup) {
    const jobId = jobIdFromStatus(group.status);
    if (jobId) {
      void controlDownload("cancel_download", jobId);
    }

    const artifactIds = groupArtifacts(group).map((artifact) => artifact.id);
    setGroups((current) => current.filter((item) => item.id !== group.id));
    setDownloadRows((current) => omitArtifactRows(current, artifactIds));
    setExpanded((current) => {
      const next = { ...current };
      delete next[group.id];
      return next;
    });
    completedNotifiedRef.current.delete(group.id);
    if (progressGroupId === group.id) setProgressGroupId(null);
    if (completeGroupId === group.id) setCompleteGroupId(null);
  }

  async function openDialogWindow(kind: DialogKind, group: BuildArtifactGroup) {
    writeDialogSnapshot(kind, group, downloadRows);
    const label = dialogWindowLabel(kind, group.id);
    const title =
      kind === "progress"
        ? `Download progress - ${group.buildId || group.input}`
        : `Download complete - ${group.buildId || group.input}`;

    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        await existing.setFocus();
        return true;
      }

      const webview = new WebviewWindow(label, {
        url: `index.html?dialog=${kind}&key=${encodeURIComponent(dialogStorageKey(kind, group.id))}`,
        title,
        width: kind === "progress" ? 780 : 460,
        height: kind === "progress" ? 620 : 320,
        center: true,
        resizable: true,
        decorations: true,
      });

      return await new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (opened: boolean) => {
          if (settled) return;
          settled = true;
          resolve(opened);
        };

        void webview.once("tauri://created", () => settle(true));
        void webview.once("tauri://error", (event) => {
          console.error(event.payload);
          settle(false);
        });
        window.setTimeout(() => settle(true), 600);
      });
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async function controlDownload(command: string, jobId?: string) {
    if (!jobId) return;
    try {
      await invoke(command, { jobId });
    } catch (error) {
      console.error(error);
    }
  }

  async function pickFolder() {
    const selected = await invoke<string | null>("pick_download_dir");
    if (selected) {
      setSettings((current) => ({ ...current, downloadTargetDir: selected }));
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const inputs = normalizeInputs(splitBulkInput(query));
    setQuery("");
    if (inputs.length > 1) {
      void fetchBulk(inputs);
    } else if (inputs[0]) {
      void fetchOne(inputs[0]);
    }
  }

  function onPaste(text: string) {
    const inputs = normalizeInputs(splitBulkInput(text));
    if (inputs.length > 1) {
      setQuery("");
      void fetchBulk(inputs);
    }
  }

  const visibleDownloadRows = visibleRows(groups, downloadRows);
  const activeCount = visibleDownloadRows.filter((row) => row.status === "downloading").length;
  const completedCount = visibleDownloadRows.filter((row) => row.status === "completed").length;
  const totalSize = groups.reduce(
    (sum, group) => sum + groupArtifacts(group).reduce((groupSum, artifact) => groupSum + (artifact.size || 0), 0),
    0,
  );
  const selectedTotal = groups.reduce((sum, group) => sum + selectedArtifacts(group).length, 0);
  const averageSpeed = visibleDownloadRows.reduce((sum, row) => sum + (row.speedBps || 0), 0);
  const inProgressGroups = groups.filter((group) =>
    selectedArtifacts(group).some((artifact) => {
      const status = downloadRows[artifact.id]?.status;
      return status === "queued" || status === "downloading" || status === "paused";
    }),
  );
  const readyGroups = groups.filter((group) => !inProgressGroups.some((active) => active.id === group.id));
  const progressGroup = groups.find((group) => group.id === progressGroupId) || null;
  const completeGroup = groups.find((group) => group.id === completeGroupId) || null;

  function renderBuildGroup(group: BuildArtifactGroup) {
    const isExpanded = expanded[group.id] ?? true;
    const jobId = jobIdFromStatus(group.status);
    const artifacts = groupArtifacts(group);
    const visibleArtifacts = jobId ? selectedArtifacts(group) : artifacts;
    const selectedCount = selectedArtifacts(group).length;
    const groupRows = visibleArtifacts.map((artifact) => downloadRows[artifact.id]);
    const isRunning = groupRows.some((row) => row?.status === "downloading");
    const hasPaused = groupRows.some((row) => row?.status === "paused");
    const hasDownloadRows = groupRows.some(Boolean);
    const cardPercent = groupProgress(visibleArtifacts, downloadRows);

    return (
      <article
        className={`build-group ${group.error ? "failed" : ""}`}
        key={group.id}
        style={{ "--card-progress": `${cardPercent}%` } as CSSProperties}
      >
        <div className="group-header">
          <button
            className="ghost-icon"
            onClick={() => setExpanded((current) => ({ ...current, [group.id]: !isExpanded }))}
          >
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
          <div className="group-title">
            <strong>{group.buildId || group.input}</strong>
            <span>
              {group.error
                ? group.error
                : `${selectedCount}/${artifacts.length} selected${group.version ? ` • ${group.version}` : ""}`}
            </span>
          </div>
          <div className="group-actions">
            {!jobId && artifacts.length > 0 && (
              <div className="selection-actions">
                <button className="secondary-button compact" onClick={() => setGroupSelection(group.id, true)}>
                  <Check size={15} />
                  Select all
                </button>
                <button className="secondary-button compact" onClick={() => setGroupSelection(group.id, false)}>
                  Deselect
                </button>
              </div>
            )}
            {jobId && (
              <>
                {hasDownloadRows && (
                  <button
                    className="icon-button"
                    title="Open progress"
                    onClick={() => {
                      void openDialogWindow("progress", group).then((opened) => {
                        if (!opened) setProgressGroupId(group.id);
                      });
                    }}
                  >
                    <Activity size={16} />
                  </button>
                )}
                <button
                  className="icon-button"
                  title={hasPaused ? "Resume" : "Pause"}
                  onClick={() => controlDownload(hasPaused ? "resume_download" : "pause_download", jobId)}
                >
                  {hasPaused ? <Play size={16} /> : <Pause size={16} />}
                </button>
                <button className="icon-button" title="Retry" onClick={() => controlDownload("retry_download", jobId)}>
                  <RefreshCcw size={16} />
                </button>
                <button
                  className="icon-button danger"
                  title="Cancel"
                  onClick={() => controlDownload("cancel_download", jobId)}
                >
                  <X size={16} />
                </button>
              </>
            )}
            <button
              className="primary-button download-selected"
              title="Download selected artifacts"
              disabled={Boolean(group.error) || selectedCount === 0 || isRunning}
              onClick={() => startDownload(group)}
            >
              <Download size={16} />
              <span>Download selected</span>
            </button>
            <button className="icon-button" title="Remove" onClick={() => removeGroup(group)}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        {isExpanded && visibleArtifacts.length > 0 && (
          <div className="artifact-table">
            {visibleArtifacts.map((artifact) => {
              const row = downloadRows[artifact.id];
              const percent = progressPercent(row?.downloaded, row?.total);
              return (
                <div className="artifact-row" key={artifact.id}>
                  <button
                    className={`check-button ${artifact.selected ? "checked" : ""}`}
                    onClick={() => toggleArtifact(group.id, artifact.id, setGroups)}
                    title={artifact.selected ? "Selected" : "Not selected"}
                  >
                    {artifact.selected && <Check size={14} />}
                  </button>
                  <div className="artifact-name">
                    <strong>{artifact.name}</strong>
                    <span>{kindLabel(artifact.kind)}</span>
                  </div>
                  <div className="size-cell">{formatBytes(artifact.size)}</div>
                  <div className="progress-cell">
                    <div className="progress-bar">
                      <div style={{ width: `${percent}%` }} />
                    </div>
                    <span title={row?.message}>
                      {row?.message
                        ? row.message
                        : row
                          ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)} • ${formatSpeed(row)}`
                          : "Ready"}
                    </span>
                  </div>
                  <span className={`pill ${row?.status || "ready"}`}>{row?.status || "ready"}</span>
                </div>
              );
            })}
          </div>
        )}
      </article>
    );
  }

  return (
    <main className="app-shell" data-theme={settings.darkMode ? "dark" : "light"}>
      <header className="topbar">
        <div className="brand">
          <img src="/quickbuild-logo.svg" alt="" />
          <span>QB Downloader</span>
        </div>
        <form className="quick-input" onSubmit={submitSearch}>
          <Download size={19} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPaste={(event) => onPaste(event.clipboardData.getData("text"))}
            placeholder="Build ID or URL"
            spellCheck={false}
          />
        </form>
        <button className="icon-button" title="Bulk entry" onClick={() => setBulkOpen(true)}>
          <RotateCcw size={18} />
        </button>
        <button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings size={18} />
        </button>
        <button
          className="icon-button"
          title={settings.darkMode ? "Light mode" : "Dark mode"}
          onClick={() => setSettings((current) => ({ ...current, darkMode: !current.darkMode }))}
        >
          {settings.darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <section className="dashboard-strip">
        <div className="metric-card builds">
          <span>Builds</span>
          <strong>{groups.length}</strong>
          <small>{selectedTotal} selected</small>
        </div>
        <div className="metric-card active">
          <span>Active</span>
          <strong>{activeCount}</strong>
          <small>{formatSpeedValue(averageSpeed)}</small>
        </div>
        <div className="metric-card done">
          <span>Done</span>
          <strong>{completedCount}</strong>
          <small>{visibleDownloadRows.length} tracked</small>
        </div>
        <div className="metric-card storage">
          <span>Total size</span>
          <strong>{formatBytes(totalSize || undefined)}</strong>
          <small title={settings.downloadTargetDir || "No folder selected"}>
            <FolderOpen size={14} />
            {settings.downloadTargetDir || "Set download folder"}
          </small>
        </div>
      </section>

      <section className="content-area">
        {groups.length === 0 && loadingInputs.size === 0 ? (
          <div className="empty-state">
            <img src="/quickbuild-logo.svg" alt="" />
            <h1>QuickBuild downloads</h1>
            <p>Paste a QB build ID or URL, press Enter, then download selected artifacts.</p>
          </div>
        ) : (
          <div className="accordion-stack">
            <details className="task-accordion" open={loadingInputs.size > 0}>
              <summary>
                <span>Current fetch</span>
                <strong>{loadingInputs.size}</strong>
              </summary>
              <div className="group-list">
                {[...loadingInputs].map((input) => (
                  <div className="build-group loading" key={`loading:${input}`}>
                    <div className="group-header">
                      <span className="spinner" />
                      <div>
                        <strong>{input}</strong>
                        <span>Fetching artifacts...</span>
                      </div>
                    </div>
                  </div>
                ))}
                {loadingInputs.size === 0 && <div className="accordion-empty">No active fetch.</div>}
              </div>
            </details>

            <details className="task-accordion" open={inProgressGroups.length > 0}>
              <summary>
                <span>In-progress downloads</span>
                <strong>{inProgressGroups.length}</strong>
              </summary>
              <div className="group-list">
                {inProgressGroups.map(renderBuildGroup)}
                {inProgressGroups.length === 0 && <div className="accordion-empty">No running downloads.</div>}
              </div>
            </details>

            <details className="task-accordion" open>
              <summary>
                <span>Fetched builds</span>
                <strong>{readyGroups.length}</strong>
              </summary>
              <div className="group-list">
                {readyGroups.map(renderBuildGroup)}
                {readyGroups.length === 0 && <div className="accordion-empty">Fetched builds will appear here.</div>}
              </div>
            </details>
          </div>
        )}
      </section>

      {settingsOpen && (
        <SettingsModal
          value={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onPickFolder={pickFolder}
        />
      )}

      {bulkOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h2>Bulk QB entry</h2>
              <button className="ghost-icon" onClick={() => setBulkOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <textarea
              autoFocus
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder="Build ID atau URL dipisahkan koma"
            />
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setBulkOpen(false)}>
                Cancel
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  setBulkOpen(false);
                  setBulkText("");
                  void fetchBulk(splitBulkInput(bulkText));
                }}
              >
                Fetch
              </button>
            </div>
          </div>
        </div>
      )}

      {progressGroup && (
        <ProgressDialog
          group={progressGroup}
          rows={downloadRows}
          onClose={() => setProgressGroupId(null)}
        />
      )}

      {completeGroup && (
        <CompleteDialog
          group={completeGroup}
          rows={downloadRows}
          onClose={() => setCompleteGroupId(null)}
          onOpenFolder={() => {
            const firstPath = firstDownloadedPath(completeGroup, downloadRows);
            if (firstPath) {
              void invoke("open_folder", { path: folderFromFilePath(firstPath) });
            }
          }}
        />
      )}
    </main>
  );
}

function StandaloneDialogWindow({ kind, storageKey }: { kind: DialogKind; storageKey: string }) {
  const [snapshot, setSnapshot] = useState<DialogSnapshot | null>(() => readDialogSnapshot(storageKey));
  const darkMode = loadSettings().darkMode;

  useEffect(() => {
    const channel = new BroadcastChannel(DIALOG_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data?.key === storageKey) {
        setSnapshot(readDialogSnapshot(storageKey));
      }
    };
    return () => channel.close();
  }, [storageKey]);

  async function closeWindow() {
    await WebviewWindow.getCurrent().close();
  }

  async function openCompletedFolder() {
    if (!snapshot) return;
    const firstPath = firstDownloadedPath(snapshot.group, snapshot.rows);
    if (firstPath) {
      await invoke("open_folder", { path: folderFromFilePath(firstPath) });
    }
  }

  if (!snapshot) {
    return (
      <main className="dialog-window" data-theme={darkMode ? "dark" : "light"}>
        <div className="empty-state compact">
          <img src="/quickbuild-logo.svg" alt="" />
          <h1>Dialog data expired</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="dialog-window" data-theme={darkMode ? "dark" : "light"}>
      {kind === "progress" ? (
        <div className="modal progress-modal">
          <ProgressDialogContent group={snapshot.group} rows={snapshot.rows} onClose={closeWindow} />
        </div>
      ) : (
        <div className="modal complete-modal">
          <CompleteDialogContent
            group={snapshot.group}
            rows={snapshot.rows}
            onClose={closeWindow}
            onOpenFolder={openCompletedFolder}
          />
        </div>
      )}
    </main>
  );
}

function ProgressDialog({
  group,
  rows,
  onClose,
}: {
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal progress-modal">
        <ProgressDialogContent group={group} rows={rows} onClose={onClose} />
      </div>
    </div>
  );
}

function ProgressDialogContent({
  group,
  rows,
  onClose,
}: {
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  onClose: () => void;
}) {
  const artifacts = selectedArtifacts(group);
  const percent = groupProgress(artifacts, rows);
  const threadSlots = buildThreadSlots(artifacts, rows);

  return (
    <>
      <div className="modal-header">
        <div>
          <h2>{group.buildId || group.input}</h2>
          <span>{percent}% overall</span>
        </div>
        <button className="ghost-icon" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="progress-overview">
        <div className="progress-bar large">
          <div style={{ width: `${percent}%` }} />
        </div>
        <div className="thread-slot-grid">
          {threadSlots.map((slot) => (
            <div className={`thread-slot ${slot.status}`} key={slot.id}>
              <strong>Thread {slot.index}</strong>
              <span>{slot.status}</span>
              <small title={slot.name}>{slot.name}</small>
              <em>{slot.detail}</em>
            </div>
          ))}
        </div>
      </div>
      <div className="progress-file-list">
        {artifacts.map((artifact) => {
          const row = rows[artifact.id];
          const itemPercent = progressPercent(row?.downloaded, row?.total);
          return (
            <div className="progress-file" key={artifact.id}>
              <div>
                <strong>{artifact.name}</strong>
                <span>
                  {row?.status || "ready"} •{" "}
                  {row?.message ||
                    (row
                      ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)} • ${formatSpeed(row)}`
                      : formatBytes(artifact.size))}
                </span>
              </div>
              <div className="progress-bar">
                <div style={{ width: `${itemPercent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CompleteDialog({
  group,
  rows,
  onClose,
  onOpenFolder,
}: {
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  onClose: () => void;
  onOpenFolder: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal complete-modal">
        <CompleteDialogContent group={group} rows={rows} onClose={onClose} onOpenFolder={onOpenFolder} />
      </div>
    </div>
  );
}

function CompleteDialogContent({
  group,
  rows,
  onClose,
  onOpenFolder,
}: {
  group: BuildArtifactGroup;
  rows: Record<string, DownloadEvent>;
  onClose: () => void;
  onOpenFolder: () => void;
}) {
  const completed = selectedArtifacts(group).filter((artifact) => rows[artifact.id]?.status === "completed").length;

  return (
    <>
      <CheckCircle2 size={42} />
      <h2>Download complete</h2>
      <p>
        {group.buildId || group.input} completed with {completed} file{completed === 1 ? "" : "s"}.
      </p>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onOpenFolder}>
          <FolderOpen size={16} />
          Open folder
        </button>
        <button className="primary-button" onClick={onClose}>
          Done
        </button>
      </div>
    </>
  );
}

function SettingsModal({
  value,
  onChange,
  onClose,
  onPickFolder,
}: {
  value: SettingsState;
  onChange: (value: SettingsState) => void;
  onClose: () => void;
  onPickFolder: () => void;
}) {
  const [testResult, setTestResult] = useState<TokenTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  function toggleType(type: string) {
    const selectedTypes = value.selectedTypes.includes(type)
      ? value.selectedTypes.filter((item) => item !== type)
      : [...value.selectedTypes, type];
    onChange({ ...value, selectedTypes });
  }

  async function testToken() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<TokenTestResult>("test_token", {
        credentials: {
          username: value.username,
          accessToken: value.accessToken,
        },
      });
      setTestResult(result);
      if (result.ok && result.selectedUsername && result.selectedUsername !== value.username) {
        onChange({ ...value, username: result.selectedUsername });
      }
    } catch (error) {
      setTestResult({
        ok: false,
        attempts: [
          {
            username: value.username,
            ok: false,
            message: String(error),
          },
        ],
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal settings-modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="ghost-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label>
          Username
          <input
            value={value.username}
            onChange={(event) => onChange({ ...value, username: event.target.value })}
            placeholder="corp\\username or username"
          />
        </label>
        <label>
          Access token
          <input
            value={value.accessToken}
            onChange={(event) => onChange({ ...value, accessToken: event.target.value })}
            placeholder="QB access token"
            type="password"
          />
        </label>
        <div className="token-test-row">
          <button
            className="secondary-button"
            disabled={testing || !value.username.trim() || !value.accessToken.trim()}
            onClick={testToken}
          >
            <KeyRound size={16} />
            {testing ? "Testing..." : "Test token"}
          </button>
          {testResult && (
            <span className={`test-summary ${testResult.ok ? "ok" : "failed"}`}>
              {testResult.ok
                ? `Token OK${testResult.selectedUsername ? ` as ${testResult.selectedUsername}` : ""}`
                : "Token test failed"}
            </span>
          )}
        </div>
        {testResult && (
          <div className="test-result-list">
            {testResult.attempts.map((attempt) => (
              <div className={attempt.ok ? "ok" : "failed"} key={attempt.username}>
                <strong>{attempt.username || "(empty username)"}</strong>
                <span>{attempt.message}</span>
              </div>
            ))}
          </div>
        )}
        <label>
          Download folder
          <div className="folder-input">
            <input value={value.downloadTargetDir} readOnly placeholder="Choose target folder" />
            <button className="secondary-button" onClick={onPickFolder}>
              Browse
            </button>
          </div>
        </label>
        <label>
          Max concurrent downloads
          <input
            type="number"
            min={1}
            max={16}
            value={value.maxConcurrent}
            onChange={(event) =>
              onChange({
                ...value,
                maxConcurrent: Math.max(1, Number(event.target.value) || 1),
              })
            }
          />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={value.showProgressDialog}
            onChange={(event) => onChange({ ...value, showProgressDialog: event.target.checked })}
          />
          Show progress dialog when download starts
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={value.showCompleteDialog}
            onChange={(event) => onChange({ ...value, showCompleteDialog: event.target.checked })}
          />
          Show complete dialog when download finishes
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={value.darkMode}
            onChange={(event) => onChange({ ...value, darkMode: event.target.checked })}
          />
          Dark mode
        </label>
        <div className="type-grid">
          {TYPE_OPTIONS.map((type) => (
            <button
              key={type}
              className={`type-chip ${value.selectedTypes.includes(type) ? "selected" : ""}`}
              onClick={() => toggleType(type)}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary-button" onClick={onClose}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function loadSettings(): SettingsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultSettings;
    const settings = { ...defaultSettings, ...JSON.parse(stored) };
    if (settings.username === "corp\\danar.kurnia") {
      settings.username = "";
    }
    return settings;
  } catch {
    return defaultSettings;
  }
}

function hasRequiredSettings(settings: SettingsState) {
  return Boolean(settings.username.trim() && settings.accessToken.trim());
}

function normalizeInputs(inputs: string[]) {
  return [...new Set(inputs.map((line) => line.trim()).filter(Boolean))];
}

function splitBulkInput(value: string) {
  return value.split(",");
}

function normalizeGroup(raw: BuildArtifactGroup | null | undefined, fallbackInput: string): BuildArtifactGroup {
  const source = raw && typeof raw === "object" ? raw : ({} as Partial<BuildArtifactGroup>);
  const input = stringOr(source.input, fallbackInput);
  const buildId = stringOr(source.buildId, "");

  return {
    id: stringOr(source.id, createId()),
    input,
    buildId: buildId || undefined,
    status: stringOr(source.status, source.error ? "failed" : "ready"),
    version: stringOr(source.version, "") || undefined,
    artifacts: groupArtifacts(source as BuildArtifactGroup).map((artifact, index) =>
      normalizeArtifact(artifact, buildId || input, index),
    ),
    error: stringOr(source.error, "") || undefined,
  };
}

function normalizeArtifact(raw: Artifact, buildId: string, index: number): Artifact {
  const source = raw && typeof raw === "object" ? raw : ({} as Partial<Artifact>);
  const name = stringOr(source.name, `artifact-${index + 1}`);
  const kind = normalizeArtifactKind(source.kind);
  const rawSize = typeof source.size === "number" ? source.size : Number(source.size);

  return {
    id: stringOr(source.id, `${buildId}:${name}:${index}`),
    buildId: stringOr(source.buildId, buildId),
    name,
    size: Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : undefined,
    url: stringOr(source.url, "") || undefined,
    kind,
    selected: Boolean(source.selected),
  };
}

function normalizeArtifactKind(kind: unknown): ArtifactKind {
  const allowed: ArtifactKind[] = ["all", "ap", "bl", "cp", "csc", "md5", "userdata", "home", "other"];
  return allowed.includes(kind as ArtifactKind) ? (kind as ArtifactKind) : "other";
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prepareGroup(group: BuildArtifactGroup, selectedTypes: string[]): BuildArtifactGroup {
  const enabled = new Set(selectedTypes);
  return {
    ...group,
    artifacts: groupArtifacts(group)
      .filter((artifact) => enabled.has(kindLabel(artifact.kind)))
      .map((artifact) => ({
        ...artifact,
        selected: false,
      })),
  };
}

function upsertGroup(groups: BuildArtifactGroup[], group: BuildArtifactGroup) {
  const key = group.buildId || group.input;
  return [group, ...groups.filter((item) => (item.buildId || item.input) !== key)];
}

function groupArtifacts(group: BuildArtifactGroup) {
  return Array.isArray(group.artifacts) ? group.artifacts : [];
}

function jobIdFromStatus(status?: string) {
  return typeof status === "string" && status.startsWith("job:") ? status.slice(4) : undefined;
}

function toggleArtifact(
  groupId: string,
  artifactId: string,
  setGroups: React.Dispatch<React.SetStateAction<BuildArtifactGroup[]>>,
) {
  setGroups((current) =>
    current.map((group) =>
      group.id === groupId
        ? {
            ...group,
            artifacts: groupArtifacts(group).map((artifact) =>
              artifact.id === artifactId ? { ...artifact, selected: !artifact.selected } : artifact,
            ),
          }
        : group,
    ),
  );
}

function kindLabel(kind: ArtifactKind) {
  const map: Record<ArtifactKind, string> = {
    all: "ALL",
    ap: "AP",
    bl: "BL",
    cp: "CP",
    csc: "CSC",
    md5: "md5",
    userdata: "USERDATA",
    home: "HOME",
    other: "Other",
  };
  return map[kind];
}

function selectedArtifacts(group: BuildArtifactGroup) {
  return groupArtifacts(group).filter((artifact) => artifact.selected);
}

function getStandaloneDialogConfig() {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("dialog");
  const storageKey = params.get("key");
  if ((kind === "progress" || kind === "complete") && storageKey) {
    return { kind: kind as DialogKind, storageKey };
  }
  return null;
}

function dialogStorageKey(kind: DialogKind, groupId: string) {
  return `qb-dialog:${kind}:${groupId}`;
}

function dialogWindowLabel(kind: DialogKind, groupId: string) {
  return `${kind}-${groupId}`.replace(/[^a-zA-Z0-9_\-:]/g, "_");
}

function writeDialogSnapshot(kind: DialogKind, group: BuildArtifactGroup, rows: Record<string, DownloadEvent>) {
  const storageKey = dialogStorageKey(kind, group.id);
  const snapshot: DialogSnapshot = { kind, group, rows };
  localStorage.setItem(storageKey, JSON.stringify(snapshot));
  try {
    const channel = new BroadcastChannel(DIALOG_CHANNEL);
    channel.postMessage({ key: storageKey });
    channel.close();
  } catch (error) {
    console.error(error);
  }
}

function readDialogSnapshot(storageKey: string) {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? (JSON.parse(value) as DialogSnapshot) : null;
  } catch {
    return null;
  }
}

function shouldSkipDownloadUpdate(payload: DownloadEvent, previous: DownloadEvent | undefined, now: number) {
  if (!previous || payload.status !== "downloading" || previous.status !== "downloading") {
    return false;
  }

  const sameTotal = payload.total === previous.total;
  const stillProgressing = payload.downloaded > previous.downloaded && payload.downloaded !== payload.total;
  return sameTotal && stillProgressing && previous.updatedAt !== undefined && now - previous.updatedAt < 750;
}

function enrichDownloadEvent(payload: DownloadEvent, previous: DownloadEvent | undefined, now: number) {
  if (payload.status !== "downloading") {
    return { ...payload, speedBps: 0, updatedAt: now, speedSamples: [] };
  }

  const previousSamples = previous?.speedSamples || [];
  const samples = [...previousSamples, { at: now, downloaded: payload.downloaded }].filter(
    (sample) => now - sample.at <= 5000,
  );
  const oldest = samples[0];
  const elapsedSeconds = oldest ? (now - oldest.at) / 1000 : 0;
  const downloadedDelta = oldest ? payload.downloaded - oldest.downloaded : 0;
  const speedBps = elapsedSeconds > 0 && downloadedDelta > 0 ? downloadedDelta / elapsedSeconds : previous?.speedBps;

  return { ...payload, speedBps, updatedAt: now, speedSamples: samples };
}

function buildThreadSlots(artifacts: Artifact[], rows: Record<string, DownloadEvent>) {
  return artifacts.map((artifact, index) => {
    const row = rows[artifact.id];
    const status = row?.status || "ready";
    const percent = progressPercent(row?.downloaded, row?.total);
    const detail = row
      ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)} • ${formatSpeed(row)}`
      : formatBytes(artifact.size);
    return {
      id: artifact.id,
      index: index + 1,
      name: artifact.name,
      status,
      percent,
      detail: status === "downloading" ? `${percent}% • ${detail}` : detail,
    };
  });
}

function omitArtifactRows(rows: Record<string, DownloadEvent>, artifactIds: string[]) {
  const remove = new Set(artifactIds);
  const next: Record<string, DownloadEvent> = {};
  for (const [artifactId, row] of Object.entries(rows)) {
    if (!remove.has(artifactId)) {
      next[artifactId] = row;
    }
  }
  return next;
}

function visibleRows(groups: BuildArtifactGroup[], rows: Record<string, DownloadEvent>) {
  const visible: DownloadEvent[] = [];
  for (const group of groups) {
    for (const artifact of groupArtifacts(group)) {
      const row = rows[artifact.id];
      if (row) {
        visible.push(row);
      }
    }
  }
  return visible;
}

function firstDownloadedPath(group: BuildArtifactGroup, rows: Record<string, DownloadEvent>) {
  return selectedArtifacts(group)
    .map((artifact) => rows[artifact.id]?.path)
    .find(Boolean);
}

function folderFromFilePath(path: string) {
  return path.replace(/[\\/][^\\/]*$/, "");
}

function progressPercent(downloaded?: number, total?: number) {
  if (!downloaded || !total) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

function groupProgress(artifacts: Artifact[], rows: Record<string, DownloadEvent>) {
  let downloaded = 0;
  let total = 0;
  for (const artifact of artifacts) {
    const row = rows[artifact.id];
    if (!row?.total) continue;
    downloaded += Math.min(row.downloaded, row.total);
    total += row.total;
  }
  return progressPercent(downloaded, total);
}

function formatBytes(value?: number) {
  if (value === undefined) return "Unknown";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatSpeed(row?: DownloadEvent) {
  if (!row) return "Ready";
  if (row.status === "downloading") {
    return row.speedBps ? `${formatBytes(row.speedBps)}/s` : "Calculating...";
  }
  if (row.status === "completed") return "Done";
  if (row.status === "paused") return "Paused";
  if (row.status === "cancelled") return "Cancelled";
  if (row.status === "failed") return "Failed";
  if (row.status === "queued") return "Queued";
  return "Ready";
}

function formatSpeedValue(value: number) {
  return value > 0 ? `${formatBytes(value)}/s` : "Idle";
}

function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}

export default App;
