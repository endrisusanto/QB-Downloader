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

  // Normalize newlines to standard UNIX \n and trim trailing whitespace
  const normalizedKey = keyContent
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  const paths = [
    path.resolve(__dirname, "../src-tauri/tauri.key"),
    path.resolve(__dirname, "../tauri.key"),
  ];

  for (const p of paths) {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, normalizedKey + "\n", "utf8");
    console.log(`✅ Wrote normalized signing key to ${p} (${normalizedKey.length} bytes)`);
  }
}

setupKey();
