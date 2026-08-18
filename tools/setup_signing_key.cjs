const fs = require("fs");
const path = require("path");

function setupKey() {
  const rawKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (!rawKey || !rawKey.trim()) {
    console.warn("⚠️ No TAURI_SIGNING_PRIVATE_KEY environment variable found.");
    return;
  }

  let keyContent = rawKey.trim();

  // If the secret was base64-encoded (e.g. starts with dW50cnVzdGVk which is 'untrusted')
  if (keyContent.startsWith("dW50cnVzdGVk") || (!keyContent.includes("untrusted comment") && /^[A-Za-z0-9+/=\s]+$/.test(keyContent))) {
    try {
      const decoded = Buffer.from(keyContent.replace(/\s+/g, ""), "base64").toString("utf8").trim();
      if (decoded.includes("untrusted comment") || decoded.includes("minisign")) {
        console.log("🔓 Decoded base64-encoded signing key.");
        keyContent = decoded;
      }
    } catch {
      // Keep as-is if base64 decoding fails
    }
  }

  // Extract only the base64 payload line (strip untrusted comment line)
  const lines = keyContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const base64Key =
    lines.find((l) => !l.toLowerCase().startsWith("untrusted comment") && !l.startsWith("#")) ||
    keyContent;

  const paths = [
    path.resolve(__dirname, "../src-tauri/tauri.key"),
    path.resolve(__dirname, "../tauri.key"),
  ];

  for (const p of paths) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, base64Key.trim(), "utf8");
    console.log(`✅ Wrote pure base64 signing key to ${p} (${base64Key.trim().length} chars)`);
  }

  // Export to GITHUB_ENV so Tauri CLI can also read it directly from env without file issues
  if (process.env.GITHUB_ENV && fs.existsSync(process.env.GITHUB_ENV)) {
    fs.appendFileSync(process.env.GITHUB_ENV, `TAURI_SIGNING_PRIVATE_KEY=${base64Key.trim()}\n`, "utf8");
    console.log("✅ Exported clean TAURI_SIGNING_PRIVATE_KEY to GITHUB_ENV");
  }
}

setupKey();
