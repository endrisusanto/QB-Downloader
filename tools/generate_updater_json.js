const fs = require("fs");
const path = require("path");

function generateUpdaterJson() {
  const tauriConfPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  const version = tauriConf.version || "0.1.0";
  const tag = process.env.GITHUB_REF_NAME || `v${version}`;
  const repo = process.env.GITHUB_REPOSITORY || "endrisusanto/QB-Downloader";

  const bundleDir = path.resolve(__dirname, "../src-tauri/target/release/bundle");
  const nsisDir = path.join(bundleDir, "nsis");
  const msiDir = path.join(bundleDir, "msi");
  const updaterDir = path.join(bundleDir, "updater");

  // Check if Tauri already generated an updater json
  const existingJsonPaths = [
    path.join(updaterDir, "latest.json"),
    path.join(bundleDir, "latest.json"),
  ];

  for (const p of existingJsonPaths) {
    if (fs.existsSync(p)) {
      console.log(`Found existing updater JSON at ${p}`);
      const out = path.join(bundleDir, "latest.json");
      if (p !== out) fs.copyFileSync(p, out);
      return;
    }
  }

  // Find .zip and .sig in nsis or bundle dir
  let zipFile = null;
  let sigFile = null;

  const searchDirs = [nsisDir, msiDir, bundleDir];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith(".zip") && !f.endsWith(".sig")) {
        zipFile = path.join(dir, f);
      }
      if (f.endsWith(".sig")) {
        sigFile = path.join(dir, f);
      }
    }
    if (zipFile && sigFile) break;
  }

  if (!sigFile) {
    console.warn("⚠️ No .sig signature file found in bundle directories. Ensure TAURI_SIGNING_PRIVATE_KEY is configured.");
  }

  let signature = "";
  if (sigFile && fs.existsSync(sigFile)) {
    signature = fs.readFileSync(sigFile, "utf8").trim();
  }

  const zipBasename = zipFile ? path.basename(zipFile) : `QuickBuild.Download.Manager_${version}_x64-setup.nsis.zip`;
  const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${zipBasename}`;

  const manifest = {
    version: version.startsWith("v") ? version : `v${version}`,
    notes: `QB Downloader ${tag}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: downloadUrl,
      },
    },
  };

  const outputPath = path.join(bundleDir, "latest.json");
  if (!fs.existsSync(bundleDir)) fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✅ Generated latest.json at ${outputPath}:`, manifest);
}

generateUpdaterJson();
