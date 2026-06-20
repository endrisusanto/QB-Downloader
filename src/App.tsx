import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Download, FolderOpen, Moon, RotateCcw, Settings, Sun, Wifi, WifiOff } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { BulkEntryModal } from "./components/BulkEntryModal";
import { CompleteDialog } from "./components/CompleteDialog";
import { Dashboard } from "./components/Dashboard";
import { FilterSelectionModal } from "./components/FilterSelectionModal";
import { ProgressDialog } from "./components/ProgressDialog";
import { SettingsModal } from "./components/SettingsModal";
import { TaskAccordions } from "./components/TaskAccordions";
import { DIALOG_CHANNEL, STORAGE_KEY } from "./constants";
import { dialogStorageKey, dialogWindowLabel, readDialogSnapshot, scheduleDialogSnapshot, standaloneDialogConfig, writeDialogSnapshot } from "./dialogStore";
import { countSelected, useBuilds } from "./hooks/useBuilds";
import { useDownload } from "./hooks/useDownload";
import { useServerSync } from "./hooks/useServerSync";
import { useSettings } from "./hooks/useSettings";
import type { Artifact, BuildArtifactGroup, DialogKind, SectionKey } from "./types";
import { areAllBuildsExpanded, folderFromFilePath, normalizeGroup, prepareGroup, selectedArtifacts } from "./utils";

function AppContent() {
  const standalone = standaloneDialogConfig();
  if (standalone) return <StandaloneDialog kind={standalone.kind} storageKey={standalone.storageKey} />;

  const { settings, patchSettings, saveSettings, loading: settingsLoading, error: settingsError } = useSettings();
  const credentials = useMemo(() => ({ username: settings.username, accessToken: settings.accessToken }), [settings.username, settings.accessToken]);
  const config = useMemo(() => ({ baseUrl: settings.quickBuildUrl, apiSuffix: settings.apiSuffix }), [settings.quickBuildUrl, settings.apiSuffix]);
  const builds = useBuilds(credentials, config, settings.selectedTypes, settings.hideUncheckedArtifacts);
  const downloads = useDownload(builds.groups, builds.setGroups);

  const handleRemoteDownload = useCallback(
    async (qbId: string, artifactTypes: string[], autoStart: boolean = true) => {
      if (!settings.username || !settings.accessToken || settingsError) return;
      try {
        const result = await invoke<BuildArtifactGroup>("fetch_build_artifacts", {
          input: qbId,
          credentials,
          quickBuildConfig: config,
        });

        const filters = artifactTypes.length > 0 ? artifactTypes : settings.selectedTypes;
        const normalized = normalizeGroup(result, qbId);
        const prepared = prepareGroup(normalized, filters, true);

        let finalGroup = prepared;
        builds.setGroups((current) => {
          const identity = prepared.buildId || prepared.input;
          const existing = current.find((item) => (item.buildId || item.input) === identity);
          if (existing) {
            finalGroup = { ...prepared, id: existing.id };
            return current.map((item) => (item.id === existing.id ? finalGroup : item));
          } else {
            return [prepared, ...current];
          }
        });

        if (!autoStart) return;

        if (!settings.downloadTargetDir) return;
        await downloads.start(finalGroup, {
          targetDir: settings.downloadTargetDir,
          maxConcurrent: settings.maxConcurrent,
          credentials,
          quickBuildConfig: config,
        });
        if (settings.showProgressDialog) {
          void openDialogWindow("progress", finalGroup, downloads.rows, downloads.slotSpeeds).then((opened) => {
            if (!opened) setProgressGroup(finalGroup);
          });
        }
      } catch (err) {
        console.error("Remote download failed:", err);
      }
    },
    [credentials, config, settings, settingsError, builds, downloads],
  );

  const handleRemoteDeleteGroup = useCallback((groupId: string) => {
    const group = builds.groups.find((g) => g.id === groupId);
    if (group) {
      void remove(group);
    }
  }, [builds.groups, remove]);

  const handleRemoteDeleteArtifact = useCallback((groupId: string, artifactId: string) => {
    void removeArtifact(groupId, artifactId);
  }, [removeArtifact]);

  const handleRemoteRestartArtifact = useCallback((groupId: string, artifactId: string) => {
    const group = builds.groups.find((g) => g.id === groupId);
    if (!group) return;
    const artifact = group.artifacts.find((a) => a.id === artifactId);
    if (artifact) {
      void startSingle(group, artifact);
    }
  }, [builds.groups, startSingle]);

  const handleRemoteStartGroup = useCallback((groupId: string) => {
    const group = builds.groups.find((g) => g.id === groupId);
    if (group) {
      void start(group);
    }
  }, [builds.groups, start]);

  const { status: syncStatus } = useServerSync(
    settings.serverUrl,
    settings.pcName,
    settings.downloadTargetDir,
    settings.selectedTypes,
    builds.groups,
    downloads.rows,
    downloads.totalSpeed,
    handleRemoteDownload,
    handleRemoteDeleteGroup,
    handleRemoteDeleteArtifact,
    handleRemoteRestartArtifact,
    handleRemoteStartGroup,
  );
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>({ fetched: true, progress: true, completed: true, failed: true });
  const [buildExpanded, setBuildExpanded] = useState<Record<string, boolean>>({});
  const [globalExpanded, setGlobalExpanded] = useState(true);
  const [progressGroup, setProgressGroup] = useState<BuildArtifactGroup | null>(null);
  const [completeGroup, setCompleteGroup] = useState<BuildArtifactGroup | null>(null);
  const [filterGroup, setFilterGroup] = useState<BuildArtifactGroup | null>(null);
  const notified = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);
  const activeSubscriptionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!settingsLoading && (!settings.username || !settings.accessToken || settingsError)) setSettingsOpen(true);
  }, [settingsLoading, settings.username, settings.accessToken, settingsError]);
  
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const channel = new BroadcastChannel(DIALOG_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data?.type === "subscribe") {
        activeSubscriptionsRef.current.add(event.data.key);
      } else if (event.data?.type === "unsubscribe") {
        activeSubscriptionsRef.current.delete(event.data.key);
      } else if (event.data?.type === "cancel") {
        const target = builds.groups.find((g) => g.id === event.data.groupId);
        if (target) void downloads.cancel(target);
      }
    };
    return () => channel.close();
  }, [builds.groups, downloads]);

  useEffect(() => {
    for (const group of builds.groups) {
      if (buildExpanded[group.id] === undefined) setBuildExpanded((current) => ({ ...current, [group.id]: globalExpanded }));
      
      const progressKey = dialogStorageKey("progress", group.id);
      if (activeSubscriptionsRef.current.has(progressKey)) {
        scheduleDialogSnapshot("progress", group, downloads.rows, downloads.slotSpeeds);
      }
      
      const completeKey = dialogStorageKey("complete", group.id);
      if (activeSubscriptionsRef.current.has(completeKey)) {
        scheduleDialogSnapshot("complete", group, downloads.rows, downloads.slotSpeeds);
      }

      const selected = selectedArtifacts(group);
      if (settings.showCompleteDialog && selected.length && selected.every((artifact) => downloads.rows[artifact.id]?.status === "completed") && !notified.current.has(group.id)) {
        notified.current.add(group.id);
        void openDialogWindow("complete", group, downloads.rows, downloads.slotSpeeds).then((opened) => { if (!opened) setCompleteGroup(group); });
      }
    }
  }, [buildExpanded, builds.groups, downloads.rows, downloads.slotSpeeds, globalExpanded, settings.showCompleteDialog]);

  useEffect(() => {
    const waitingGroup = builds.groups.find((g) => g.status === "watching" && g.customFilters === undefined);
    if (waitingGroup) {
      builds.setCustomFilters(waitingGroup.id, settings.selectedTypes);
      setFilterGroup(waitingGroup);
    }
  }, [builds.groups, settings.selectedTypes]);

  useEffect(() => {
    if (builds.readyAutoDownloads.size === 0) return;
    if (!settings.downloadTargetDir) {
      setSettingsOpen(true);
      return;
    }
    for (const groupId of builds.readyAutoDownloads) {
      const group = builds.groups.find((item) => item.id === groupId);
      if (!group || group.status === "watching" || selectedArtifacts(group).length === 0) continue;
      builds.consumeReadyAutoDownload(groupId);
      void start(group);
    }
  }, [builds, credentials, config, downloads, settings.downloadTargetDir, settings.maxConcurrent]);

  if (settingsLoading) return <main className="app-shell"><div className="empty-state"><span className="spinner" /><h1>Unlocking secure settings</h1></div></main>;

  async function submit(value: string) {
    if (!settings.username || !settings.accessToken || settingsError) { setSettingsOpen(true); return; }
    await builds.fetchInputs(value);
  }
  async function start(group: BuildArtifactGroup) {
    if (!settings.downloadTargetDir) { setSettingsOpen(true); return; }
    await downloads.start(group, { targetDir: settings.downloadTargetDir, maxConcurrent: settings.maxConcurrent, credentials, quickBuildConfig: config });
    if (settings.showProgressDialog) void openDialogWindow("progress", group, downloads.rows, downloads.slotSpeeds).then((opened) => { if (!opened) setProgressGroup(group); });
  }
  async function startSingle(group: BuildArtifactGroup, artifact: Artifact) {
    if (!settings.downloadTargetDir) { setSettingsOpen(true); return; }
    await downloads.startSingle(group, artifact, { targetDir: settings.downloadTargetDir, maxConcurrent: settings.maxConcurrent, credentials, quickBuildConfig: config });
    if (settings.showProgressDialog) void openDialogWindow("progress", group, downloads.rows, downloads.slotSpeeds).then((opened) => { if (!opened) setProgressGroup(group); });
  }
  async function remove(group: BuildArtifactGroup) {
    if (downloads.categories.progress.some((item) => item.id === group.id)) await downloads.cancel(group);
    builds.removeGroup(group.id);
    notified.current.delete(group.id);
  }
  async function removeArtifact(groupId: string, artifactId: string) {
    const row = downloads.rows[artifactId];
    let filePath = row?.path;
    if (!filePath && settings.downloadTargetDir && row?.name) {
      filePath = `${settings.downloadTargetDir}/${row.name}`;
    }
    if (filePath) {
      try {
        await invoke("delete_file", { path: filePath });
      } catch (err) {
        console.error("Failed to delete file on disk:", err);
      }
    }
    downloads.removeRow(artifactId);
    builds.removeArtifact(groupId, artifactId);
  }
  const categoryRecord = downloads.categories;
  function toggleAllBuilds() {
    const allExpanded = areAllBuildsExpanded(builds.groups.map((group) => group.id), buildExpanded);
    const next = !allExpanded;
    setGlobalExpanded(next);
    setBuildExpanded(Object.fromEntries(builds.groups.map((group) => [group.id, next])));
  }
  function toggleCategoryBuilds(key: SectionKey) {
    const groups = categoryRecord[key];
    const allExpanded = areAllBuildsExpanded(groups.map((group) => group.id), buildExpanded);
    const next = !allExpanded;
    setBuildExpanded((current) => ({ ...current, ...Object.fromEntries(groups.map((group) => [group.id, next])) }));
  }
  return (
    <main className="app-shell" data-theme={settings.darkMode ? "dark" : "light"}>
      <header className="topbar"><div className="brand"><img src="/quickbuild-logo.svg" alt="" /><span>QB Downloader</span></div><form className="quick-input" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(query); setQuery(""); }}><Download size={19} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onPaste={(event) => { const text = event.clipboardData.getData("text"); if (/[,\s].*\S/.test(text)) { event.preventDefault(); void submit(text); } }} placeholder="Build ID or URL" spellCheck={false} /></form><button className="icon-button" title="Bulk entry" onClick={() => setBulkOpen(true)}><RotateCcw size={18} /></button><button className="icon-button" title="Open output folder" disabled={!settings.downloadTargetDir} onClick={() => { if (settings.downloadTargetDir) void invoke("open_folder", { path: settings.downloadTargetDir }); }}><FolderOpen size={18} /></button><button className="icon-button" title="Settings" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button><button className="icon-button" title={settings.darkMode ? "Light mode" : "Dark mode"} onClick={() => { const next = { ...settings, darkMode: !settings.darkMode }; patchSettings({ darkMode: next.darkMode }); void saveSettings(next); }}>{settings.darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>{settings.serverUrl && <div className={`server-badge server-badge-${syncStatus}`} title={`Dashboard: ${syncStatus}`}>{syncStatus === "connected" ? <Wifi size={13} /> : <WifiOff size={13} />}<span>{syncStatus === "connected" ? "Online" : syncStatus === "connecting" ? "Sync…" : "Offline"}</span></div>}</header>
      <Dashboard builds={builds.groups.length} selected={countSelected(builds.groups)} active={categoryRecord.progress.length} completed={categoryRecord.completed.length} failed={categoryRecord.failed.length} totalSpeed={downloads.totalSpeed} averageThreadSpeed={downloads.averageThreadSpeed} folder={settings.downloadTargetDir} />
      <section className="content-area">{builds.groups.length === 0 && builds.loadingInputs.size === 0 ? <div className="empty-state"><img src="/quickbuild-logo.svg" alt="" /><h1>QuickBuild downloads</h1><p>Paste a build ID or URL to fetch artifacts.</p></div> : <TaskAccordions categories={categoryRecord} loadingInputs={builds.loadingInputs} rows={downloads.rows} sections={sections} buildExpanded={buildExpanded} filters={settings.selectedTypes} onSection={(key) => setSections((current) => ({ ...current, [key]: !current[key] }))} onToggleAllBuilds={toggleAllBuilds} onToggleCategoryBuilds={toggleCategoryBuilds} onBuildExpanded={(id) => setBuildExpanded((current) => ({ ...current, [id]: !(current[id] ?? globalExpanded) }))} onToggleArtifact={builds.toggleArtifact} onToggleGroup={builds.setGroupSelection} onToggleFetched={(selected) => builds.setGroupsSelection(categoryRecord.fetched, selected)} onDownload={(group) => void start(group)} onDownloadFetched={() => void Promise.all(categoryRecord.fetched.filter((group) => selectedArtifacts(group).length).map(start))} onCancel={(group) => void downloads.cancel(group)} onRetry={(group) => void downloads.retry(group)} onRemove={(group) => void remove(group)} onProgress={(group) => void openDialogWindow("progress", group, downloads.rows, downloads.slotSpeeds).then((opened) => { if (!opened) setProgressGroup(group); })} onConfigureFilters={(group) => setFilterGroup(group)} onDownloadArtifact={(group, artifact) => void startSingle(group, artifact)} onRemoveArtifact={removeArtifact} />}</section>
      {settingsOpen && <SettingsModal value={settings} secureError={settingsError} onSave={saveSettings} onClose={() => setSettingsOpen(false)} onPickFolder={() => invoke<string | null>("pick_download_dir")} />}
      {bulkOpen && <BulkEntryModal onClose={() => setBulkOpen(false)} onSubmit={(value) => void submit(value)} />}
      {progressGroup && <ProgressDialog group={progressGroup} rows={downloads.rows} slotSpeeds={downloads.slotSpeeds} onClose={() => setProgressGroup(null)} onCancel={() => void downloads.cancel(progressGroup)} />}
      {completeGroup && <CompleteDialog group={completeGroup} rows={downloads.rows} onClose={() => setCompleteGroup(null)} onOpenFolder={() => openCompletedFolder(completeGroup, downloads.rows)} />}
      {filterGroup && <FilterSelectionModal buildId={filterGroup.buildId || filterGroup.input} initialFilters={filterGroup.customFilters || settings.selectedTypes} onSave={(filters) => builds.setCustomFilters(filterGroup.id, filters)} onClose={() => setFilterGroup(null)} />}
    </main>
  );
}

function StandaloneDialog({ kind, storageKey }: { kind: DialogKind; storageKey: string }) {
  const [snapshot, setSnapshot] = useState(() => readDialogSnapshot(storageKey));
  const darkMode = (() => { try { return Boolean(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}").darkMode); } catch { return false; } })();
  
  useEffect(() => {
    const channel = new BroadcastChannel(DIALOG_CHANNEL);
    channel.postMessage({ type: "subscribe", key: storageKey });
    channel.onmessage = (event) => {
      if (event.data?.key === storageKey) setSnapshot(readDialogSnapshot(storageKey));
    };
    return () => {
      channel.postMessage({ type: "unsubscribe", key: storageKey });
      channel.close();
    };
  }, [storageKey]);
  useEffect(() => {
    if (kind !== "progress" || !snapshot) return;
    const element = document.querySelector<HTMLElement>(".compact-progress-modal");
    if (!element) return;
    const currentWindow = WebviewWindow.getCurrent();
    const resize = async () => {
      try {
        const scaleFactor = await currentWindow.scaleFactor();
        const inner = await currentWindow.innerSize();
        const outer = await currentWindow.outerSize();
        const decorationHeight = Math.max(0, Math.round((outer.height - inner.height) / scaleFactor));
        const height = Math.min(960, Math.max(440, Math.ceil(element.scrollHeight) + decorationHeight));
        void currentWindow.setSize(new LogicalSize(850, height));
      } catch (e) {
        console.error("Failed to resize window", e);
        const height = Math.min(960, Math.max(440, Math.ceil(element.scrollHeight) + 36));
        void currentWindow.setSize(new LogicalSize(850, height));
      }
    };
    void resize();
    const observer = new ResizeObserver(() => { void resize(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [kind, snapshot]);
  if (!snapshot) return <main className={`dialog-window dialog-window-${kind}`} data-theme={darkMode ? "dark" : "light"}><div className="empty-state compact"><h1>Dialog data expired</h1></div></main>;
  const close = () => WebviewWindow.getCurrent().close();
  return <main className={`dialog-window dialog-window-${kind}`} data-theme={darkMode ? "dark" : "light"}>{kind === "progress" ? <ProgressDialog group={snapshot.group} rows={snapshot.rows} slotSpeeds={snapshot.slotSpeeds || {}} onClose={close} embedded /> : <CompleteDialog group={snapshot.group} rows={snapshot.rows} onClose={close} onOpenFolder={() => openCompletedFolder(snapshot.group, snapshot.rows)} embedded />}</main>;
}

async function openDialogWindow(kind: DialogKind, group: BuildArtifactGroup, rows: ReturnType<typeof useDownload>["rows"], slotSpeeds: Record<string, number> = {}) {
  writeDialogSnapshot(kind, group, rows, slotSpeeds);
  try {
    const label = dialogWindowLabel(kind, group.id);
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) { await existing.setFocus(); return true; }
    new WebviewWindow(label, { url: `index.html?dialog=${kind}&key=${encodeURIComponent(dialogStorageKey(kind, group.id))}`, title: kind === "progress" ? `Download progress - ${group.buildId || group.input}` : `Download complete - ${group.buildId || group.input}`, width: kind === "progress" ? 850 : 460, height: 440, center: true, resizable: true, decorations: true });
    return true;
  } catch (error) { console.error(error); return false; }
}

function openCompletedFolder(group: BuildArtifactGroup, rows: ReturnType<typeof useDownload>["rows"]) {
  const path = selectedArtifacts(group).map((artifact) => rows[artifact.id]?.path).find(Boolean);
  if (path) void invoke("open_folder", { path: folderFromFilePath(path) });
}

export default function App() { return <AppErrorBoundary><AppContent /></AppErrorBoundary>; }
