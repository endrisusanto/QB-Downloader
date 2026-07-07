import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildArtifactGroup, Credentials, QuickBuildConfig } from "../types";
import { normalizeGroup, prepareGroup, selectedArtifacts, splitBulkInput } from "../utils";

const WATCH_POLL_MS = 60_000;

export function useBuilds(
  credentials: Credentials,
  quickBuildConfig: QuickBuildConfig,
  selectedTypes: string[],
  autoCheck: boolean,
) {
  const [groups, setGroups] = useState<BuildArtifactGroup[]>(() => {
    try {
      const saved = localStorage.getItem("quickbuild-download-manager-groups");
      const parsed: BuildArtifactGroup[] = saved ? JSON.parse(saved) : [];
      // ponytail: drop stale groups where NO artifact has size (fetched before size parsing existed)
      // so user gets a fresh fetch instead of perpetually seeing no size badges
      const migrated = parsed.filter((group) =>
        group.artifacts.length === 0 || group.artifacts.some((a) => a.size != null)
      );
      return migrated.map((group) => normalizeGroup(group, group.input));
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("quickbuild-download-manager-groups", JSON.stringify(groups));
  }, [groups]);
  const [loadingInputs, setLoadingInputs] = useState<Set<string>>(new Set());
  const [readyAutoDownloads, setReadyAutoDownloads] = useState<Set<string>>(new Set());
  const pollingInputs = useRef<Set<string>>(new Set());

  const fetchInputs = useCallback(
    async (raw: string) => {
      const inputs = splitBulkInput(raw);
      if (!inputs.length) return;
      setLoadingInputs((current) => new Set([...current, ...inputs]));
      try {
        const results =
          inputs.length === 1
            ? [
                await invoke<BuildArtifactGroup>("fetch_build_artifacts", {
                  input: inputs[0],
                  credentials,
                  quickBuildConfig,
                }),
              ]
            : await invoke<BuildArtifactGroup[]>("fetch_bulk_build_artifacts", {
                inputs,
                credentials,
                quickBuildConfig,
              });
        const prepared = results.map((group, index) => prepareFetchedGroup(group, inputs[index] || "bulk", selectedTypes, autoCheck));
        setGroups((current) => prepared.reduce(upsertGroup, current));
      } catch (error) {
        setGroups((current) => [
          {
            id: crypto.randomUUID(),
            input: inputs.join(", "),
            status: "failed",
            artifacts: [],
            error: String(error),
          },
          ...current,
        ]);
      } finally {
        setLoadingInputs((current) => {
          const next = new Set(current);
          inputs.forEach((input) => next.delete(input));
          return next;
        });
      }
    },
    [credentials, quickBuildConfig, selectedTypes, autoCheck],
  );

  const refreshWatchingBuild = useCallback(async (group: BuildArtifactGroup) => {
    const input = group.buildId || group.input;
    if (!input || pollingInputs.current.has(input)) return;
    pollingInputs.current.add(input);
    try {
      const result = await invoke<BuildArtifactGroup>("fetch_build_artifacts", {
        input,
        credentials,
        quickBuildConfig,
      });
      const prepared = prepareFetchedGroup(result, input, group.customFilters || selectedTypes, autoCheck);
      const now = new Date().toISOString();
      setGroups((current) => {
        const existing = current.find((item) => sameIdentity(item, group));
        const stableId = existing?.id || prepared.id;
        const nextGroup = {
          ...prepared,
          id: stableId,
          customFilters: group.customFilters,
          lastCheckedAt: now,
          nextCheckAt: prepared.status === "watching" ? new Date(Date.now() + WATCH_POLL_MS).toISOString() : undefined,
        };
        if (existing?.status === "watching" && nextGroup.status !== "watching" && selectedArtifacts(nextGroup).length > 0) {
          setReadyAutoDownloads((ids) => new Set([...ids, stableId]));
        }
        return upsertGroup(current, nextGroup);
      });
    } catch (error) {
      const now = new Date().toISOString();
      setGroups((current) => current.map((item) => sameIdentity(item, group)
        ? {
            ...item,
            lastCheckedAt: now,
            nextCheckAt: new Date(Date.now() + WATCH_POLL_MS).toISOString(),
            status: "watching",
            error: undefined,
          }
        : item,
      ));
    } finally {
      pollingInputs.current.delete(input);
    }
  }, [credentials, quickBuildConfig, selectedTypes, autoCheck]);

  useEffect(() => {
    const tick = () => {
      groups
        .filter((group) => group.status === "watching")
        .forEach((group) => {
          const next = group.nextCheckAt ? new Date(group.nextCheckAt).getTime() : 0;
          if (!next || Date.now() >= next) void refreshWatchingBuild(group);
        });
    };
    tick();
    const timer = window.setInterval(tick, 5_000);
    return () => window.clearInterval(timer);
  }, [groups, refreshWatchingBuild]);

  const consumeReadyAutoDownload = useCallback((groupId: string) => {
    setReadyAutoDownloads((current) => {
      const next = new Set(current);
      next.delete(groupId);
      return next;
    });
  }, []);

  const setGroupSelection = useCallback((groupId: string, selected: boolean) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? { ...group, artifacts: group.artifacts.map((artifact) => ({ ...artifact, selected })) }
          : group,
      ),
    );
  }, []);

  const toggleArtifact = useCallback((groupId: string, artifactId: string) => {
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
  }, []);

  const setArtifactSelection = useCallback((groupId: string, artifactId: string, selected: boolean) => {
    setGroups((current) => current.map((group) => group.id === groupId
      ? { ...group, artifacts: group.artifacts.map((artifact) => artifact.id === artifactId ? { ...artifact, selected } : artifact) }
      : group));
  }, []);

  const setGroupsSelection = useCallback((targets: BuildArtifactGroup[], selected: boolean) => {
    const ids = new Set(targets.map((group) => group.id));
    setGroups((current) =>
      current.map((group) =>
        ids.has(group.id)
          ? { ...group, artifacts: group.artifacts.map((artifact) => ({ ...artifact, selected })) }
          : group,
      ),
    );
  }, []);

  const setCustomFilters = useCallback((groupId: string, customFilters: string[]) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? { ...group, customFilters }
          : group,
      ),
    );
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setGroups((current) => current.filter((group) => group.id !== groupId));
  }, []);

  const removeArtifact = useCallback((groupId: string, artifactId: string) => {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              artifacts: group.artifacts.filter((artifact) => artifact.id !== artifactId),
            }
          : group,
      ),
    );
  }, []);

  return {
    groups,
    setGroups,
    loadingInputs,
    readyAutoDownloads,
    fetchInputs,
    consumeReadyAutoDownload,
    setGroupSelection,
    setGroupsSelection,
    toggleArtifact,
    setArtifactSelection,
    removeGroup,
    removeArtifact,
    setCustomFilters,
  };
}

function upsertGroup(groups: BuildArtifactGroup[], group: BuildArtifactGroup) {
  const identity = group.buildId || group.input;
  const existing = groups.findIndex((item) => (item.buildId || item.input) === identity);
  if (existing < 0) return [group, ...groups];
  return groups.map((item, index) => (index === existing ? { ...group, id: item.id } : item));
}

function prepareFetchedGroup(group: BuildArtifactGroup, fallbackInput: string, selectedTypes: string[], autoCheck: boolean) {
  const prepared = prepareGroup(normalizeGroup(group, fallbackInput), selectedTypes, autoCheck);
  if (prepared.status !== "watching") return prepared;
  return {
    ...prepared,
    lastCheckedAt: new Date().toISOString(),
    nextCheckAt: new Date(Date.now() + WATCH_POLL_MS).toISOString(),
  };
}

function sameIdentity(left: BuildArtifactGroup, right: BuildArtifactGroup) {
  return (left.buildId || left.input) === (right.buildId || right.input);
}

export function countSelected(groups: BuildArtifactGroup[]) {
  return groups.reduce((sum, group) => sum + selectedArtifacts(group).length, 0);
}
