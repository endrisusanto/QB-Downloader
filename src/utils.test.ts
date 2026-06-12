import { describe, expect, it } from "vitest";
import { classifyGroups, calculateRollingSpeed } from "./hooks/useDownload";
import type { BuildArtifactGroup, DownloadEvent } from "./types";
import { migrateFilters, normalizeGroup, sanitizePreferences, splitBulkInput } from "./utils";

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
  });

  it("sorts artifacts by name case-insensitively", () => {
    expect(normalizeGroup(group, "1").artifacts.map((artifact) => artifact.name)).toEqual(["ALL_z.zip", "AP_a.zip"]);
  });
});

describe("download state", () => {
  it("classifies mixed results as failed and cancelled as fetched", () => {
    expect(classifyGroups([group], { a: row("a", "completed"), b: row("b", "failed") }).failed).toHaveLength(1);
    expect(classifyGroups([group], { a: row("a", "cancelled"), b: row("b", "cancelled") }).fetched).toHaveLength(1);
  });

  it("aggregates raw bytes over five seconds and becomes idle", () => {
    const samples = [{ at: 1_000, bytes: 0 }, { at: 3_000, bytes: 4_000 }, { at: 5_000, bytes: 8_000 }];
    expect(calculateRollingSpeed(samples, 5_000)).toBe(2_000);
    expect(calculateRollingSpeed(samples, 10_000)).toBe(0);
  });
});
