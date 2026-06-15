# QB Downloader

Desktop download manager for Samsung Android QuickBuild artifacts, built with React, Rust, and Tauri 2.

## Features

### Fetch and artifact selection

- Fetch a build using a QuickBuild build ID or URL.
- Bulk fetch input separated by commas, spaces, tabs, or new lines.
- Artifact names are sorted ascending, case-insensitively.
- Prefix filters: `ALL_`, `AP_`, `BL_`, `CP_`, `CSC_`, `HOME_`, and `USERDATA_`.
- `md5` filtering is based on the file extension.
- Select/deselect all toggle and icon-only download actions.
- Optional setting to hide unchecked artifacts in the In-progress accordion. Fetched builds always keep unchecked artifacts and their checkboxes visible.

### Download management

- Concurrent multi-file downloads with configurable concurrency.
- Aggregate total speed calculated from all active artifact streams.
- Five-second rolling average speed per active thread and per progress-dialog slot.
- HTTP Range resume using retained `.part` files when supported by the server.
- Automatic retry after an initial failure, up to three retries with `1s`, `2s`, and `4s` backoff.
- Retry covers HTTP, network, stream, and file I/O errors. User cancellation is never retried.
- Manual retry is available after all automatic attempts fail.
- Cancelled downloads return to Fetched builds.
- Files are written directly into the selected output directory:

  ```text
  {downloadTargetDir}/{artifact_file}
  ```

  Artifact filenames are sanitized before writing. Downloads are no longer placed in a build-ID subdirectory.

### Dashboard and task organization

- Sticky dashboard header with Builds, Active, Completed, and Total Speed cards.
- Active card shows the five-second average speed per thread.
- Four task accordions:
  1. Fetched builds
  2. In-progress downloads
  3. Download completed
  4. Download failed
- One global expand/collapse toggle for all build details.
- One independent expand/collapse toggle in each accordion.
- Deleting a build removes it from dashboard counts and cancels it first when active.

### Progress UI

- Green animated progress bars in light and dark themes.
- Determinate progress when total size is known.
- Indeterminate animation while downloading when the server does not provide a total size.
- Total size priority: HTTP `Content-Range`, HTTP `Content-Length`, then artifact metadata.
- Downloading badges include the current percentage when known.
- Compact standalone progress window with one dense row per artifact slot:
  - status and retry attempt
  - downloaded and total bytes
  - five-second average slot speed
  - individual progress
- The standalone progress window automatically fits its content and remains scrollable for larger jobs.
- Optional completion dialog with an Open Folder action.

### Settings and security

- QuickBuild base URL and API suffix can be changed without rebuilding the app.
- Defaults:
  - Base URL: `https://android.qb.sec.samsung.net`
  - API suffix: the application-compatible default currently shipped with the project
- Base URLs are restricted to valid HTTP or HTTPS URLs. Trailing slashes and suffix prefixes such as `?` or `&` are normalized by the backend.
- Username, access token, and API suffix are encrypted with the official Tauri Stronghold plugin.
- A random Stronghold password is generated once and stored in the native OS credential manager under service `com.quickbuild.downloader`.
  - Windows: Credential Manager
  - Linux: Secret Service
- Legacy plaintext secrets are migrated from `localStorage` and removed only after Stronghold is saved successfully.
- There is no plaintext fallback if the OS credential manager cannot be accessed.
- Access Token and API Suffix fields include independent show/hide controls and open masked by default.
- Token testing uses the currently configured QuickBuild endpoint.
- Other preferences, including folder, theme, concurrency, filters, and dialog options, remain local preferences.

### Desktop integration

- Elegant monochrome dark mode while progress indicators remain green.
- Application, taskbar, shortcut, and system tray use the packaged QuickBuild icon.
- Closing the main window hides it to the system tray. Use the tray menu to show or quit the application.

## Server-dependent behavior

QuickBuild server capabilities can vary:

- Resume requires HTTP Range support.
- Exact percentage requires `Content-Range`, `Content-Length`, or valid artifact size metadata.
- When size is unavailable, QB Downloader shows an indeterminate progress animation and the downloaded byte count.
- Pause/resume controls are intentionally not provided. Cancellation and retained partial files are used instead.

### Test HTTP Range and multipart support

Windows users can run the included interactive PowerShell probe:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\tools\Test-QBRangeSupport.ps1
```

Enter a direct artifact download URL, username, and access token. The script contains the current default QuickBuild API suffix and appends it automatically when the URL does not already contain it. The token is requested as a masked `SecureString` and is not written to disk. The TUI validates:

- a one-byte range request
- a non-zero offset range
- two concurrent range requests
- stable `ETag` values when the server supplies them

The final verdict is:

- `SUPPORTED`: candidate for adaptive multipart
- `PARTIAL`: use single-stream resume only
- `UNSUPPORTED`: do not enable Range resume or multipart

Temporary test parts are removed automatically.

## Project structure

```text
src/
  components/       Presentational UI, dialogs, dashboard, and accordions
  hooks/            Settings, build-fetch, and download state/business logic
  App.tsx           Application composition and window wiring
src-tauri/src/
  download_manager.rs  Concurrent download, retry, cancel, and resume logic
  qb_client.rs          Dynamic QuickBuild API client
  secure_storage.rs     OS keyring bootstrap for Stronghold
```

## Development

Requirements:

- Node.js and npm
- Rust toolchain
- Tauri 2 platform prerequisites
- A working OS credential manager

Install dependencies and start the Tauri development application:

```bash
npm install
npm run tauri -- dev
```

Frontend-only preview:

```bash
npm run dev
```

Run verification:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

## Build Windows NSIS

Build the installer on Windows:

```bash
npm run tauri -- build --bundles nsis
```

The NSIS installer uses per-machine installation. GitHub Actions builds the Windows installer when a `v*` tag is pushed.

## Release

The release script can initialize the default GitHub remote, auto-commit workspace changes, sync the current branch, bump versions, create a release commit and tag, then push both.

```bash
./script.sh patch
```

Supported version arguments:

- `patch`
- `minor`
- `major`
- exact version, for example `1.2.3`

The script updates:

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

Override the automatic workspace commit message when needed:

```bash
AUTO_COMMIT_MESSAGE="feat: update downloader UI" ./script.sh patch
```

The script performs `git pull --rebase` when the current branch exists on `origin`, then pushes the branch and annotated `vX.Y.Z` tag together.
