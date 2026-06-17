import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOWNLOAD_HISTORY_KEY } from "../constants";
import type { Artifact, BuildArtifactGroup, Credentials, DownloadEvent, DownloadHistoryEntry, QuickBuildConfig } from "../types";
import { selectedArtifacts } from "../utils";

type StartOptions = {
  targetDir: string;
  maxConcurrent: number;
  credentials: Credentials;
  quickBuildConfig: QuickBuildConfig;
};

type QueueItem = {
  queueId: string;
  groupId: string;
  buildId: string;
  artifact: Artifact;
  options: StartOptions;
};

type ActiveJob = {
  groupId: string;
  artifactId: string;
};

const TERMINAL_STATUSES = new Set<DownloadEvent["status"]>(["completed", "failed", "cancelled"]);
const HISTORY_FLUSH_MS = 1_500;
let downloadHistoryCache: DownloadHistoryEntry[] | null = null;
let historyFlushTimer: number | null = null;

export function useDownload(groups: BuildArtifactGroup[], setGroups: React.Dispatch<React.SetStateAction<BuildArtifactGroup[]>>) {
  const [rows, setRows] = useState<Record<string, DownloadEvent>>({});
  const [totalSpeed, setTotalSpeed] = useState(0);
  const [averageThreadSpeed, setAverageThreadSpeed] = useState(0);
  const [slotSpeeds, setSlotSpeeds] = useState<Record<string, number>>({});
  const latestRows = useRef(rows);
  const rawDownloaded = useRef<Record<string, number>>({});
  const totalBytes = useRef(0);
  const byteSamples = useRef<{ at: number; bytes: number }[]>([]);
  const slotTotals = useRef<Record<string, number>>({});
  const slotSamples = useRef<Record<string, { at: number; bytes: number }[]>>({});
  const queue = useRef<QueueItem[]>([]);
  const startingJobs = useRef<Record<string, QueueItem>>({});
  const cancelledQueueIds = useRef<Set<string>>(new Set());
  const activeJobs = useRef<Record<string, ActiveJob>>({});
  const groupOptions = useRef<Record<string, StartOptions>>({});
  const maxSlots = useRef(1);
  const pumping = useRef(false);
  latestRows.current = rows;

  const refreshGroupJobStatus = useCallback((groupId: string) => {
    const jobIds = Object.entries(activeJobs.current)
      .filter(([, job]) => job.groupId === groupId)
      .map(([jobId]) => jobId);
    setGroups((current) => current.map((group) => (
      group.id === groupId ? { ...group, status: jobIds.length ? `jobs:${jobIds.join(",")}` : "ready" } : group
    )));
  }, [setGroups]);

  const pumpQueue = useCallback(() => {
    if (pumping.current) return;
    pumping.current = true;
    void (async () => {
      try {
        while (Object.keys(activeJobs.current).length < maxSlots.current && queue.current.length > 0) {
          const item = queue.current.shift();
          if (!item) continue;
          startingJobs.current[item.queueId] = item;
          try {
            const jobId = await invoke<string>("start_download", {
              group: {
                buildId: item.buildId,
                targetDir: item.options.targetDir,
                credentials: item.options.credentials,
                maxConcurrent: 1,
                artifacts: [{ ...item.artifact, selected: true }],
                quickBuildConfig: item.options.quickBuildConfig,
              },
            });
            delete startingJobs.current[item.queueId];
            if (cancelledQueueIds.current.has(item.queueId)) {
              cancelledQueueIds.current.delete(item.queueId);
              await invoke("cancel_download", { jobId });
              continue;
            }
            const currentRow = latestRows.current[item.artifact.id];
            if (currentRow?.jobId === jobId && TERMINAL_STATUSES.has(currentRow.status)) {
              pumpQueue();
            } else {
              activeJobs.current[jobId] = { groupId: item.groupId, artifactId: item.artifact.id };
              refreshGroupJobStatus(item.groupId);
            }
          } catch (error) {
            const wasCancelled = cancelledQueueIds.current.has(item.queueId);
            cancelledQueueIds.current.delete(item.queueId);
            const event = eventFromQueueItem(item, wasCancelled ? "cancelled" : "failed", wasCancelled ? "Cancelled while starting" : String(error));
            setRows((current) => ({ ...current, [item.artifact.id]: event }));
            persistDownloadHistory(event, true);
          } finally {
            delete startingJobs.current[item.queueId];
          }
        }
      } finally {
        pumping.current = false;
        if (Object.keys(activeJobs.current).length < maxSlots.current && queue.current.length > 0) {
          pumpQueue();
        }
      }
    })();
  }, [refreshGroupJobStatus]);

  useEffect(() => {
    const unlisten = Promise.all(
      ["queued", "progress", "retrying", "completed", "failed", "cancelled"].map((name) =>
        listen<DownloadEvent>(`download://${name}`, ({ payload }) => {
          if (!payload.artifactId) return;
          const now = Date.now();
          const previous = rawDownloaded.current[payload.artifactId] || 0;
          const delta = Math.max(0, payload.downloaded - previous);
          if (delta > 0) {
            totalBytes.current += delta;
            slotTotals.current[payload.artifactId] = (slotTotals.current[payload.artifactId] || 0) + delta;
          }
          rawDownloaded.current[payload.artifactId] = payload.downloaded;
          byteSamples.current.push({ at: now, bytes: totalBytes.current });
          const samples = slotSamples.current[payload.artifactId] || [];
          samples.push({ at: now, bytes: slotTotals.current[payload.artifactId] || 0 });
          slotSamples.current[payload.artifactId] = samples;
          setRows((current) => ({ ...current, [payload.artifactId]: payload }));
          persistDownloadHistory(payload, TERMINAL_STATUSES.has(payload.status));

          if (TERMINAL_STATUSES.has(payload.status)) {
            const job = activeJobs.current[payload.jobId];
            if (job) {
              delete activeJobs.current[payload.jobId];
              refreshGroupJobStatus(job.groupId);
            }
            pumpQueue();
          }
        }),
      ),
    );
    return () => void unlisten.then((items) => items.forEach((item) => item()));
  }, [pumpQueue, refreshGroupJobStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const cutoff = now - 5_000;
      const samples = byteSamples.current.filter((sample) => sample.at >= cutoff);
      byteSamples.current = samples;
      setTotalSpeed(calculateRollingSpeed(samples, now));
      const nextSlotSpeeds: Record<string, number> = {};
      for (const [artifactId, artifactSamples] of Object.entries(slotSamples.current)) {
        const recent = artifactSamples.filter((sample) => sample.at >= cutoff);
        slotSamples.current[artifactId] = recent;
        nextSlotSpeeds[artifactId] = calculateRollingSpeed(recent, now);
      }
      setSlotSpeeds(nextSlotSpeeds);
      setAverageThreadSpeed(calculateAverageThreadSpeed(nextSlotSpeeds, latestRows.current));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    window.addEventListener("beforeunload", flushDownloadHistory);
    return () => {
      window.removeEventListener("beforeunload", flushDownloadHistory);
      flushDownloadHistory();
    };
  }, []);

  const enqueue = useCallback((group: BuildArtifactGroup, artifacts: Artifact[], options: StartOptions) => {
    if (!group.buildId || artifacts.length === 0) return;
    maxSlots.current = Math.max(1, options.maxConcurrent);
    groupOptions.current[group.id] = options;
    const items = artifacts.map((artifact) => ({
      queueId: crypto.randomUUID(),
      groupId: group.id,
      buildId: group.buildId as string,
      artifact,
      options,
    }));
    queue.current.push(...items);
    setRows((current) => {
      const next = omitRows(current, artifacts.map((artifact) => artifact.id));
      for (const item of items) {
        next[item.artifact.id] = eventFromQueueItem(item, "queued");
      }
      return next;
    });
    pumpQueue();
  }, [pumpQueue]);

  const start = useCallback(
    async (group: BuildArtifactGroup, options: StartOptions) => {
      enqueue(group, selectedArtifacts(group), options);
    },
    [enqueue],
  );

  const cancel = useCallback(async (group: BuildArtifactGroup) => {
    const selectedIds = new Set(selectedArtifacts(group).map((artifact) => artifact.id));
    const cancelledQueued = queue.current.filter((item) => item.groupId === group.id && selectedIds.has(item.artifact.id));
    queue.current = queue.current.filter((item) => item.groupId !== group.id || !selectedIds.has(item.artifact.id));
    const cancelledStarting = Object.values(startingJobs.current).filter((item) => item.groupId === group.id && selectedIds.has(item.artifact.id));
    cancelledStarting.forEach((item) => cancelledQueueIds.current.add(item.queueId));
    if (cancelledQueued.length) {
      setRows((current) => {
        const next = { ...current };
        for (const item of cancelledQueued) {
          const cancelled = eventFromQueueItem(item, "cancelled", "Cancelled while queued");
          next[item.artifact.id] = cancelled;
          persistDownloadHistory(cancelled, true);
        }
        return next;
      });
    }

    await Promise.all(Object.entries(activeJobs.current)
      .filter(([, job]) => job.groupId === group.id && selectedIds.has(job.artifactId))
      .map(([jobId]) => invoke("cancel_download", { jobId })));
    pumpQueue();
  }, [pumpQueue]);

  const retry = useCallback(async (group: BuildArtifactGroup) => {
    const failedArtifacts = selectedArtifacts(group).filter((artifact) => latestRows.current[artifact.id]?.status === "failed");
    if (!failedArtifacts.length) return;
    const failedRow = latestRows.current[failedArtifacts[0].id];
    const options = groupOptions.current[group.id];
    if (!options) {
      setRows((current) => ({ ...current, [failedArtifacts[0].id]: { ...failedRow, message: "Retry requires starting the download again from the main download button." } }));
      return;
    }
    enqueue(group, failedArtifacts, options);
  }, [enqueue]);

  const categories = useMemo(() => classifyGroups(groups, rows), [groups, rows]);
  return { rows, setRows, totalSpeed, averageThreadSpeed, slotSpeeds, start, cancel, retry, categories };
}

export function calculateRollingSpeed(samples: { at: number; bytes: number }[], now: number) {
  if (samples.length < 2 || now - samples[samples.length - 1].at >= 5_000) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsed = Math.max(1, last.at - first.at) / 1000;
  return Math.max(0, (last.bytes - first.bytes) / elapsed);
}

export function calculateAverageThreadSpeed(
  slotSpeeds: Record<string, number>,
  rows: Record<string, Pick<DownloadEvent, "status">>,
) {
  const active = Object.entries(slotSpeeds)
    .filter(([artifactId, speed]) => speed > 0 && rows[artifactId]?.status === "downloading")
    .map(([, speed]) => speed);
  return active.length ? active.reduce((sum, speed) => sum + speed, 0) / active.length : 0;
}

export function classifyGroups(groups: BuildArtifactGroup[], rows: Record<string, DownloadEvent>) {
  const fetched: BuildArtifactGroup[] = [];
  const progress: BuildArtifactGroup[] = [];
  const completed: BuildArtifactGroup[] = [];
  const failed: BuildArtifactGroup[] = [];
  for (const group of groups) {
    const selected = selectedArtifacts(group);
    const statuses = selected.map((artifact) => rows[artifact.id]?.status).filter(Boolean);
    if (statuses.includes("failed")) failed.push(group);
    else if (statuses.some((status) => status === "queued" || status === "downloading" || status === "retrying")) progress.push(group);
    else if (selected.length > 0 && statuses.length === selected.length && statuses.every((status) => status === "completed")) completed.push(group);
    else fetched.push(group);
  }
  return { fetched, progress, completed, failed };
}

function omitRows(rows: Record<string, DownloadEvent>, ids: string[]) {
  const next = { ...rows };
  ids.forEach((id) => delete next[id]);
  return next;
}

function eventFromQueueItem(item: QueueItem, status: DownloadEvent["status"], message?: string): DownloadEvent {
  return {
    jobId: item.queueId,
    artifactId: item.artifact.id,
    buildId: item.buildId,
    name: item.artifact.name,
    status,
    downloaded: 0,
    total: item.artifact.size,
    message,
    resumable: false,
    attempt: 0,
    maxAttempts: 4,
  };
}

function persistDownloadHistory(event: DownloadEvent, immediate = false) {
  if (typeof localStorage === "undefined") return;
  const now = new Date().toISOString();
  const id = `${event.jobId}:${event.artifactId}`;
  const current = getDownloadHistoryCache();
  const existingIndex = current.findIndex((item) => item.id === id);
  const existing = existingIndex >= 0 ? current[existingIndex] : undefined;
  const entry: DownloadHistoryEntry = {
    id,
    artifactId: event.artifactId,
    buildId: event.buildId,
    name: event.name,
    status: event.status,
    downloaded: event.downloaded,
    total: event.total,
    path: event.path,
    message: event.message,
    jobId: event.jobId,
    startedAt: existing?.startedAt || now,
    updatedAt: now,
  };
  const next = existingIndex >= 0
    ? current.map((item, index) => (index === existingIndex ? entry : item))
    : [entry, ...current];
  downloadHistoryCache = next.slice(0, 1000);
  scheduleHistoryFlush(immediate);
}

function getDownloadHistoryCache() {
  if (!downloadHistoryCache) downloadHistoryCache = readDownloadHistory();
  return downloadHistoryCache;
}

function scheduleHistoryFlush(immediate: boolean) {
  if (historyFlushTimer != null) {
    window.clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
  }
  if (immediate) {
    flushDownloadHistory();
  } else {
    historyFlushTimer = window.setTimeout(flushDownloadHistory, HISTORY_FLUSH_MS);
  }
}

function flushDownloadHistory() {
  if (historyFlushTimer != null) {
    window.clearTimeout(historyFlushTimer);
    historyFlushTimer = null;
  }
  if (downloadHistoryCache) {
    localStorage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(downloadHistoryCache));
  }
}

function readDownloadHistory(): DownloadHistoryEntry[] {
  try {
    const value = JSON.parse(localStorage.getItem(DOWNLOAD_HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
