import { describe, expect, it } from "vitest";
import { calculateAverageThreadSpeed, classifyGroups, calculateRollingSpeed } from "./hooks/useDownload";
import type { BuildArtifactGroup, DownloadEvent } from "./types";
import { areAllBuildsExpanded, migrateFilters, normalizeGroup, progressState, rowsForGroupArtifacts, sanitizePreferences, splitBulkInput, statusLabel, visibleArtifacts } from "./utils";

const group: BuildArtifactGroup = {
  id: "g1",
  input: "1",
  buildId: "1",
  status: "ready",
  artifacts: [
    { id: "a", buildId: "1", name: "ALL_z.zip", kind: "all", selected: true },
    { id: "b", buildId: "1", name: "AP_a.zip", kind: "ap", selected: true },
  ],
};

function row(artifactId: string, status: DownloadEvent["status"]): DownloadEvent {
  return { jobId: "j", artifactId, buildId: "1", name: artifactId, status, downloaded: 1, total: 2, resumable: false, attempt: 1, maxAttempts: 4 };
}

describe("input and settings migration", () => {
  it("splits commas, spaces, tabs, and newlines", () => {
    expect(splitBulkInput("1,2  3\t4\n5, 1")).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("migrates legacy filters and strips secrets from preferences", () => {
    expect(migrateFilters(["ALL", "AP", "md5"])).toEqual(["ALL_", "AP_", "md5"]);
    expect(sanitizePreferences({ username: "secret", accessToken: "token" })).not.toHaveProperty("username");
    expect(sanitizePreferences({}).hideUncheckedArtifacts).toBe(false);
    expect(sanitizePreferences({}).showCompleteDialog).toBe(false);
    expect(sanitizePreferences({ showCompleteDialog: true }).showCompleteDialog).toBe(true);
  });

  it("sorts artifacts by name case-insensitively", () => {
    expect(normalizeGroup(group, "1").artifacts.map((artifact) => artifact.name)).toEqual(["ALL_z.zip", "AP_a.zip"]);
  });

  it("keeps only rows referenced by current groups", () => {
    expect(Object.keys(rowsForGroupArtifacts([group], { a: row("a", "completed"), old: row("old", "failed") }))).toEqual(["a"]);
  });
});

describe("download state", () => {
  it("classifies mixed results as failed and cancelled as fetched", () => {
    expect(classifyGroups([group], { a: row("a", "completed"), b: row("b", "failed") }).failed).toHaveLength(1);
    expect(classifyGroups([group], { a: row("a", "cancelled"), b: row("b", "cancelled") }).fetched).toHaveLength(1);
  });

  it("splits a single group with mixed statuses into separate categories", () => {
    const categories = classifyGroups([group], {
      a: row("a", "completed"),
      b: row("b", "failed"),
    });
    expect(categories.failed).toHaveLength(1);
    expect(categories.failed[0].artifacts).toHaveLength(1);
    expect(categories.failed[0].artifacts[0].id).toBe("b");

    expect(categories.completed).toHaveLength(1);
    expect(categories.completed[0].artifacts).toHaveLength(1);
    expect(categories.completed[0].artifacts[0].id).toBe("a");

    expect(categories.fetched).toHaveLength(0);
  });

  it("keeps an unchecked active artifact in progress", () => {
    const unchecked = { ...group, artifacts: [{ ...group.artifacts[0], selected: false }] };
    expect(classifyGroups([unchecked], { a: row("a", "downloading") }).progress[0].artifacts[0].id).toBe("a");
  });

  it("aggregates raw bytes over five seconds and becomes idle", () => {
    const samples = [{ at: 1_000, bytes: 0 }, { at: 3_000, bytes: 4_000 }, { at: 5_000, bytes: 8_000 }];
    expect(calculateRollingSpeed(samples, 5_000)).toBe(2_000);
    expect(calculateRollingSpeed(samples, 10_000)).toBe(0);
  });

  it("averages only downloading slots that are receiving bytes", () => {
    expect(calculateAverageThreadSpeed(
      { a: 1_000, b: 3_000, c: 9_000 },
      { a: row("a", "downloading"), b: row("b", "downloading"), c: row("c", "retrying") },
    )).toBe(2_000);
  });
});

describe("progress and visibility", () => {
  it("uses indeterminate mode only for active unknown-size downloads", () => {
    expect(progressState({ status: "downloading", downloaded: 10 })).toEqual({ mode: "indeterminate", percent: 0 });
    expect(progressState({ status: "retrying", downloaded: 10 })).toEqual({ mode: "determinate", percent: 0 });
    expect(progressState({ status: "completed", downloaded: 10 })).toEqual({ mode: "completed", percent: 100 });
  });

  it("clamps determinate progress to zero through one hundred", () => {
    expect(progressState({ status: "downloading", downloaded: 25, total: 100 }).percent).toBe(25);
    expect(progressState({ status: "downloading", downloaded: 150, total: 100 }).percent).toBe(100);
  });

  it("adds determinate percentage to the downloading badge", () => {
    expect(statusLabel({ status: "downloading", downloaded: 25, total: 100 })).toBe("downloading 25%");
    expect(statusLabel({ status: "downloading", downloaded: 25 })).toBe("downloading");
  });

  it("filters visible artifacts based on active filters", () => {
    expect(visibleArtifacts(group, ["ALL_", "AP_"]).map((artifact) => artifact.id)).toEqual(["a", "b"]);
    expect(visibleArtifacts(group, ["ALL_"]).map((artifact) => artifact.id)).toEqual(["a"]);
  });

  it("treats mixed accordion state as expand next", () => {
    expect(areAllBuildsExpanded(["a", "b"], { a: true, b: false })).toBe(false);
    expect(areAllBuildsExpanded(["a", "b"], { a: true, b: true })).toBe(true);
  });
});
