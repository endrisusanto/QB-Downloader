import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { BuildArtifactGroup, Credentials, QuickBuildConfig } from "../types";
import { normalizeGroup, prepareGroup, selectedArtifacts, splitBulkInput } from "../utils";

export function useBuilds(
  credentials: Credentials,
  quickBuildConfig: QuickBuildConfig,
  selectedTypes: string[],
) {
  const [groups, setGroups] = useState<BuildArtifactGroup[]>(() => {
    try {
      const saved = localStorage.getItem("quickbuild-download-manager-groups");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("quickbuild-download-manager-groups", JSON.stringify(groups));
  }, [groups]);
  const [loadingInputs, setLoadingInputs] = useState<Set<string>>(new Set());

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
        const prepared = results.map((group, index) =>
          prepareGroup(normalizeGroup(group, inputs[index] || "bulk"), selectedTypes),
        );
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
    [credentials, quickBuildConfig, selectedTypes],
  );

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

  const removeGroup = useCallback((groupId: string) => {
    setGroups((current) => current.filter((group) => group.id !== groupId));
  }, []);

  return {
    groups,
    setGroups,
    loadingInputs,
    fetchInputs,
    setGroupSelection,
    setGroupsSelection,
    toggleArtifact,
    removeGroup,
  };
}

function upsertGroup(groups: BuildArtifactGroup[], group: BuildArtifactGroup) {
  const identity = group.buildId || group.input;
  const existing = groups.findIndex((item) => (item.buildId || item.input) === identity);
  if (existing < 0) return [group, ...groups];
  return groups.map((item, index) => (index === existing ? group : item));
}

export function countSelected(groups: BuildArtifactGroup[]) {
  return groups.reduce((sum, group) => sum + selectedArtifacts(group).length, 0);
}
