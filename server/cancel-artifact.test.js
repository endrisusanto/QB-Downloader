import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("per-artifact cancel uses the PIN-protected command", () => {
  const dashboard = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const relay = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  expect(dashboard).toContain('"remote_cancel_artifact"');
  expect(dashboard).not.toContain('onclick="remoteDeleteArtifact(\'${pc.pcId}\', \'${g.id}\', \'${a.id}\')">Cancel');
  expect(relay).toContain('type: "cancel_artifact"');
});
