# QB Downloader

Rust/Tauri desktop download manager for QuickBuild artifacts.

## Features

- Android QuickBuild server only.
- Paste a QB build ID or URL and fetch artifacts.
- Bulk entry from multiline paste or modal.
- Quick artifact filters: `ALL`, `AP`, `BL`, `CP`, `CSC`, `md5`, `USERDATA`, `HOME`.
- Multi-file concurrent downloads.
- Resumable downloads with `.part` files when the server supports HTTP Range.
- Output folder format: `{downloadTargetDir}/{qb_id}/{artifact_file}`.
- QuickBuild logo is used for the app UI, shortcut icon, and system tray icon.
- Closing the main window hides the app to the system tray; use the tray menu to show or quit.

## Development

```bash
npm install
npm run tauri -- dev
```

Frontend-only preview:

```bash
npm run dev
```

## Build Windows NSIS

Local Windows build:

```bash
npm run tauri -- build --bundles nsis
```

GitHub Actions builds the Windows NSIS installer when a `v*` tag is pushed.

## Release

Initialize the repository remote once:

```bash
git remote add origin https://github.com/endrisusanto/QB-Downloader.git
```

Bump version, auto-commit workspace changes, sync, tag, and push:

```bash
./script.sh patch
```

Supported bump arguments:

- `patch`
- `minor`
- `major`
- exact version, for example `1.2.3`

The script updates:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

Before releasing, the script commits all tracked and untracked workspace changes, fetches
`origin`, and rebases the current branch on its remote branch. It then creates commit
`chore(release): vX.Y.Z`, tag `vX.Y.Z`, and pushes the branch plus tag together.

The automatic workspace commit message defaults to `chore: auto commit before release`.
Override it when needed:

```bash
AUTO_COMMIT_MESSAGE="feat: update downloader UI" ./script.sh patch
```
