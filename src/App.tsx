import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  KeyRound,
  Pause,
  Play,
  RefreshCcw,
  RotateCcw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from "react";

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
};

const STORAGE_KEY = "quickbuild-download-manager-settings";
const DEFAULT_TYPES = ["ALL", "AP", "BL", "CP", "CSC", "md5", "USERDATA", "HOME"];
const TYPE_OPTIONS = ["ALL", "AP", "BL", "CP", "CSC", "md5", "USERDATA", "HOME"];

const defaultSettings: SettingsState = {
  username: "",
  accessToken: "",
  downloadTargetDir: "",
  maxConcurrent: 3,
  selectedTypes: DEFAULT_TYPES,
};

function App() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings);
  const [groups, setGroups] = useState<BuildArtifactGroup[]>([]);
  const [downloadRows, setDownloadRows] = useState<Record<string, DownloadEvent>>({});
  const [query, setQuery] = useState("");
  const [loadingInputs, setLoadingInputs] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(!hasRequiredSettings(loadSettings()));
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      ].map((eventName) =>
        listen<DownloadEvent>(eventName, (event) => {
          const payload = event.payload;
          if (!payload.artifactId) return;
          setDownloadRows((current) => ({
            ...current,
            [payload.artifactId]: payload,
          }));
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
      const prepared = prepareGroup(group, settings.selectedTypes);
      setGroups((current) => upsertGroup(current, prepared));
      setExpanded((current) => ({ ...current, [prepared.id]: true }));
    } catch (error) {
      const failed: BuildArtifactGroup = {
        id: crypto.randomUUID(),
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
      const prepared = results.map((group) => prepareGroup(group, settings.selectedTypes));
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

    const selected = group.artifacts.filter((artifact) => artifact.selected);
    if (!selected.length) return;

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
    const inputs = normalizeInputs(query.split(/\r?\n/));
    setQuery("");
    if (inputs.length > 1) {
      void fetchBulk(inputs);
    } else if (inputs[0]) {
      void fetchOne(inputs[0]);
    }
  }

  function onPaste(text: string) {
    const inputs = normalizeInputs(text.split(/\r?\n/));
    if (inputs.length > 1) {
      setQuery("");
      void fetchBulk(inputs);
    }
  }

  const activeCount = Object.values(downloadRows).filter((row) => row.status === "downloading").length;
  const completedCount = Object.values(downloadRows).filter((row) => row.status === "completed").length;

  return (
    <main className="app-shell">
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
      </header>

      <section className="status-strip">
        <div>
          <strong>{groups.length}</strong>
          <span>builds</span>
        </div>
        <div>
          <strong>{activeCount}</strong>
          <span>active</span>
        </div>
        <div>
          <strong>{completedCount}</strong>
          <span>done</span>
        </div>
        <div className="target-path" title={settings.downloadTargetDir || "No folder selected"}>
          <FolderOpen size={16} />
          <span>{settings.downloadTargetDir || "Set download folder"}</span>
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

            {groups.map((group) => {
              const isExpanded = expanded[group.id] ?? true;
              const selectedCount = group.artifacts.filter((artifact) => artifact.selected).length;
              const jobId = group.status.startsWith("job:") ? group.status.slice(4) : undefined;
              const groupRows = group.artifacts.map((artifact) => downloadRows[artifact.id]);
              const isRunning = groupRows.some((row) => row?.status === "downloading");
              const hasPaused = groupRows.some((row) => row?.status === "paused");
              const cardPercent = groupProgress(group.artifacts, downloadRows);

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
                          : `${selectedCount}/${group.artifacts.length} selected${
                              group.version ? ` • ${group.version}` : ""
                            }`}
                      </span>
                    </div>
                    <div className="group-actions">
                      {jobId && (
                        <>
                          <button
                            className="icon-button"
                            title={hasPaused ? "Resume" : "Pause"}
                            onClick={() => controlDownload(hasPaused ? "resume_download" : "pause_download", jobId)}
                          >
                            {hasPaused ? <Play size={16} /> : <Pause size={16} />}
                          </button>
                          <button
                            className="icon-button"
                            title="Retry"
                            onClick={() => controlDownload("retry_download", jobId)}
                          >
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
                        className="primary-button icon-only"
                        title="Download selected artifacts"
                        disabled={Boolean(group.error) || selectedCount === 0 || isRunning}
                        onClick={() => startDownload(group)}
                      >
                        <Download size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="Remove"
                        onClick={() => setGroups((current) => current.filter((item) => item.id !== group.id))}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && group.artifacts.length > 0 && (
                    <div className="artifact-table">
                      {group.artifacts.map((artifact) => {
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
                              <span>{kindLabel(artifact.kind)} • {formatBytes(artifact.size)}</span>
                            </div>
                            <div className="progress-cell">
                              <div className="progress-bar">
                                <div style={{ width: `${percent}%` }} />
                              </div>
                              <span>{row ? `${formatBytes(row.downloaded)} / ${formatBytes(row.total)}` : "Ready"}</span>
                            </div>
                            <span className={`pill ${row?.status || "ready"}`}>
                              {row?.status || "ready"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </article>
              );
            })}
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
              placeholder="One build ID or URL per line"
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
                  void fetchBulk(bulkText.split(/\r?\n/));
                }}
              >
                Fetch
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
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
    return { ...defaultSettings, ...JSON.parse(stored) };
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

function prepareGroup(group: BuildArtifactGroup, selectedTypes: string[]): BuildArtifactGroup {
  return {
    ...group,
    artifacts: group.artifacts.map((artifact) => ({
      ...artifact,
      selected: selectedTypes.includes(kindLabel(artifact.kind)),
    })),
  };
}

function upsertGroup(groups: BuildArtifactGroup[], group: BuildArtifactGroup) {
  const key = group.buildId || group.input;
  return [group, ...groups.filter((item) => (item.buildId || item.input) !== key)];
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
            artifacts: group.artifacts.map((artifact) =>
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
  if (!value) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default App;
