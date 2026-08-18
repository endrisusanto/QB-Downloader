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

  // Extract payload lines (skip existing untrusted comment headers)
  const lines = keyContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const payloadLines = lines.filter(
    (l) => !l.toLowerCase().startsWith("untrusted comment") && !l.startsWith("#")
  );
  const payload = payloadLines.join("\n");

  // Construct canonical 2-line Minisign key text
  const canonicalMinisign = `untrusted comment: minisign encrypted secret key\n${payload}\n`;

  // Tauri CLI expects TAURI_SIGNING_PRIVATE_KEY env var to be the Base64 of the Minisign key file
  const base64ForTauri = Buffer.from(canonicalMinisign, "utf8").toString("base64");

  // Export to GITHUB_ENV so Tauri CLI can read it directly from env
  if (process.env.GITHUB_ENV && fs.existsSync(process.env.GITHUB_ENV)) {
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `TAURI_SIGNING_PRIVATE_KEY=${base64ForTauri.trim()}\n`,
      "utf8"
    );
    console.log(`✅ Exported clean TAURI_SIGNING_PRIVATE_KEY Base64 to GITHUB_ENV (${base64ForTauri.length} chars)`);
  }
}

setupKey();
