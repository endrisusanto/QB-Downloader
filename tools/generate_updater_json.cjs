const fs = require("fs");
const path = require("path");

function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }
  return arrayOfFiles;
}

function generateUpdaterJson() {
  const tauriConfPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  const version = tauriConf.version || "0.1.0";
  const tag = process.env.GITHUB_REF_NAME || `v${version}`;
  const repo = process.env.GITHUB_REPOSITORY || "endrisusanto/QB-Downloader";

  const bundleDir = path.resolve(__dirname, "../src-tauri/target/release/bundle");
  const allFiles = getAllFiles(bundleDir);
  console.log(`Scanned ${allFiles.length} files in bundle directory:`, allFiles.map((f) => path.relative(bundleDir, f)));

  // Check if Tauri already generated a latest.json
  const existingLatest = allFiles.find((f) => path.basename(f) === "latest.json");
  if (existingLatest) {
    console.log(`Found Tauri's generated latest.json at ${existingLatest}`);
    const out = path.join(bundleDir, "latest.json");
    if (existingLatest !== out) {
      fs.copyFileSync(existingLatest, out);
    }
    return;
  }

  // Prefer .zip if available, otherwise .exe
  let targetAsset = allFiles.find((f) => f.endsWith(".zip") && !f.endsWith(".sig")) ||
                    allFiles.find((f) => f.endsWith(".exe") && !f.endsWith(".sig")) ||
                    allFiles.find((f) => f.endsWith(".msi") && !f.endsWith(".sig"));

  let sigFile = allFiles.find((f) => f.endsWith(".sig"));
  if (targetAsset) {
    const matchingSig = `${targetAsset}.sig`;
    if (fs.existsSync(matchingSig)) {
      sigFile = matchingSig;
    }
  }

  let signature = "";
  if (sigFile && fs.existsSync(sigFile)) {
    signature = fs.readFileSync(sigFile, "utf8").trim();
    console.log(`Found signature file: ${sigFile}`);
  } else {
    console.warn("⚠️ No .sig signature file found. Ensure TAURI_SIGNING_PRIVATE_KEY is configured.");
  }

  const rawBasename = targetAsset ? path.basename(targetAsset) : `QuickBuild Download Manager_${version}_x64-setup.exe`;
  // softprops/action-gh-release normalizes spaces to dots in uploaded release filenames
  const releaseAssetBasename = rawBasename.replace(/\s+/g, ".");
  const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${releaseAssetBasename}`;

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
  console.log(`✅ Generated latest.json at ${outputPath}:`, JSON.stringify(manifest, null, 2));
}

generateUpdaterJson();
