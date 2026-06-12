import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildArtifactGroup, Credentials, DownloadEvent, QuickBuildConfig } from "../types";
import { jobIdFromStatus, selectedArtifacts } from "../utils";

type StartOptions = {
  targetDir: string;
  maxConcurrent: number;
  credentials: Credentials;
  quickBuildConfig: QuickBuildConfig;
};

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
  latestRows.current = rows;

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
        }),
      ),
    );
    return () => void unlisten.then((items) => items.forEach((item) => item()));
  }, []);

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

  const start = useCallback(
    async (group: BuildArtifactGroup, options: StartOptions) => {
      if (!group.buildId) return;
      const artifacts = selectedArtifacts(group);
      if (!artifacts.length) return;
      setRows((current) => omitRows(current, artifacts.map((artifact) => artifact.id)));
      const jobId = await invoke<string>("start_download", {
        group: {
          buildId: group.buildId,
          targetDir: options.targetDir,
          credentials: options.credentials,
          maxConcurrent: options.maxConcurrent,
          artifacts,
          quickBuildConfig: options.quickBuildConfig,
        },
      });
      setGroups((current) => current.map((item) => (item.id === group.id ? { ...item, status: `job:${jobId}` } : item)));
      return jobId;
    },
    [setGroups],
  );

  const cancel = useCallback(async (group: BuildArtifactGroup) => {
    const jobId = jobIdFromStatus(group.status);
    if (jobId) await invoke("cancel_download", { jobId });
  }, []);

  const retry = useCallback(async (group: BuildArtifactGroup) => {
    const jobId = jobIdFromStatus(group.status);
    if (!jobId) return;
    const newJobId = await invoke<string>("retry_download", { jobId });
    setGroups((current) => current.map((item) => (item.id === group.id ? { ...item, status: `job:${newJobId}` } : item)));
  }, [setGroups]);

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
