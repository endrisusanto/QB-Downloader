#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BUMP="${1:-patch}"
REMOTE_URL="https://github.com/endrisusanto/QB-Downloader.git"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "This folder is not a git repository. Run: git init"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit or stash them before releasing."
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$REMOTE_URL"
fi

NEW_VERSION="$(node - "$BUMP" <<'NODE'
const fs = require("fs");
const bump = process.argv[2];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const current = String(pkg.version || "0.0.0");
const match = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!match) {
  throw new Error(`Unsupported current version: ${current}`);
}

let [major, minor, patch] = match.slice(1).map(Number);
if (/^\d+\.\d+\.\d+$/.test(bump)) {
  console.log(bump);
  process.exit(0);
}

switch (bump) {
  case "major":
    major += 1;
    minor = 0;
    patch = 0;
    break;
  case "minor":
    minor += 1;
    patch = 0;
    break;
  case "patch":
    patch += 1;
    break;
  default:
    throw new Error(`Use patch, minor, major, or an exact x.y.z version. Got: ${bump}`);
}

console.log(`${major}.${minor}.${patch}`);
NODE
)"

TAG="v${NEW_VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists locally."
  exit 1
fi

if git ls-remote --tags origin "$TAG" | grep -q "$TAG"; then
  echo "Tag $TAG already exists on origin."
  exit 1
fi

node - "$NEW_VERSION" <<'NODE'
const fs = require("fs");
const version = process.argv[2];

function writeJson(path, value) {
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
pkg.version = version;
writeJson("package.json", pkg);

const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
conf.version = version;
writeJson("src-tauri/tauri.conf.json", conf);

const cargoPath = "src-tauri/Cargo.toml";
const cargo = fs.readFileSync(cargoPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${version}"`
);
fs.writeFileSync(cargoPath, cargo);
NODE

npm install --package-lock-only
cargo check --manifest-path src-tauri/Cargo.toml

git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore(release): ${TAG}"
git tag -a "$TAG" -m "$TAG"
git push origin HEAD
git push origin "$TAG"

echo "Released $TAG"
