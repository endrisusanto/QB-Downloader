# QD.exe Reverse Engineering Notes

Scope: static analysis of `QD.exe` in this folder. The binary was not executed.

## Binary Summary

- File: `QD.exe`
- SHA-256: `6b654fcb5a3988f462d2155c283adf60770f9711531e1aa93d4fdca212100da2`
- MD5: `2583e636ddc7fc517f11b6bc180c90d3`
- Format: PE32 Windows GUI, i386, .NET/Mono assembly
- Build timestamp in PE header: `2026-04-06 00:34:50`
- PDB path: `c:\ba\workspace\ba-VM03\QD\QD\obj\Release\QD.pdb`
- Main namespace: `QD`
- Embedded dependencies/resources include:
  - `QD.Newtonsoft.Json.dll`
  - `QD.Microsoft.WindowsAPICodePack.dll`
  - `QD.Microsoft.WindowsAPICodePack.Shell.dll`
  - `QD.odin4.exe`

## Main Classes

- `QD.buildResource`: low-level QuickBuild REST client and artifact downloader.
- `QD.Server`: wrapper around the currently selected QB server.
- `QD.QD`: main WinForms orchestrator, settings, UI state, download, flash.
- `QD.QuickDownload`: quick-select dialog for binary types/actions.
- `QD.selectBinary`: binary type selection and device-download rules.
- `QD.LoadOdinDLL`: legacy Odin DLL update/download path.
- `QD.version`: application version check and self-update path.
- `QD.CryptorEngine`: legacy credential encryption/decryption.

## Server Defaults

Static initializer values:

- Android: `https://android.qb.sec.samsung.net`
- CP: `https://cp.qb.sec.samsung.net`
- Package: `https://package.qb.sec.samsung.net`
- Support: `https://mobilerndhub.sec.samsung.net/hub/support/service/qb/QNA`
- Guide: `https://confluence-mx.sec.samsung.net/display/QUICKBUILDG/USER+GUIDE`

## REST Endpoints Found

All normal QB REST calls are built under a `/rest` prefix in `buildResource.sendRest`.

- `GET /rest/ids?user_name={username}`
  - Used by `getUserId`.
- `GET /rest/builds?count=5&user_id={user_id}`
  - Used by `getMyLatestBuildId`.
  - Parses repeated `<id>...</id>` entries from response text.
- `GET /rest/builds/{build_id}`
  - Used by `getBuildInfos`.
- `GET /rest/ads5/filelist/{build_id}`
  - Used by `getADSinfo`.
- `GET /rest/files/artifacts/{build_id}`
  - Used by `getArtifactsInfo`.
- `GET /rest/ads5/download/{build_id}?filename={filename}&...`
  - One artifact download path in `copyArtifact`.
- `GET /download/{build_id}/{artifact_or_filename}?...`
  - Alternate direct download path in `copyArtifact`.
- `GET /rest/version/QD`
  - App version check.
- `GET /download/QD`
  - App self-update download.
- `GET /rest/version/QD/dll`
  - Odin DLL version check.
- `GET /download/dll`
  - Odin DLL download.

## Authentication

`buildResource.sendRest` and `buildResource.copyArtifact` set:

```text
Authorization: Basic base64("{username}:{access_token}")
```

Observed error handling:

- `401`: "Please check ID and access token."
- `403`: "You don't have permission."
- `404` with `builds`: "Can not find the build.."
- Missing/expired `artifacts`: "The build does not include any artifacts, or they have expired."
- Fallback: "Network error."

## Legacy Credential Storage

Token settings are stored under `accessTokens` as joined text:

```text
{server_url}|{username}|{token}||{server_url}|{username}|{token}
```

Older single-server settings also exist:

- `id`
- `pw`
- `buildId`
- `path`
- `apqb`
- `cpqb`
- `packageqb`
- `disableUserDataWarning`
- `skipCheckMD5`
- `useOdin4CLI`

Legacy `pw` is encrypted by `QD.CryptorEngine`:

- Algorithm family: `RijndaelManaged` / AES-compatible
- Key material: `SHA256("123456789012345678901234567890")`
- Cipher mode: `ECB`
- Padding: `PKCS7`
- Encoding: UTF-8 plaintext, Base64 ciphertext

For the Rust/Tauri rebuild, keep an importer for this format, then migrate new tokens to OS keychain storage.

## Build And Artifact Flow

Expected high-level flow:

1. Select server: Android, CP, or Package.
2. Load credentials for selected server.
3. Resolve user ID with `/rest/ids?user_name=...`.
4. Fetch latest builds with `/rest/builds?count=5&user_id=...`, or fetch one build by ID.
5. Read build status/version/trigger/date/duration from `/rest/builds/{id}`.
6. If running, monitor status until complete.
7. Fetch artifact data with:
   - `/rest/ads5/filelist/{build_id}`
   - `/rest/files/artifacts/{build_id}`
8. Populate selectable binary tree.
9. Download selected items to PC.
10. Optionally flash selected device(s) via Odin4 CLI or legacy DLL.

Status strings found:

- `SUCCESSFUL`
- `RECOMMENDED`
- `FAILED`
- `CANCELLED`
- `RUNNING`
- `TIMEOUT`

## Binary Selection Rules

Supported binary/action labels found:

- `ALL`
- `COMBINATION`
- `AP`
- `BL`
- `CP`
- `CSC`
- `HOME_CSC`
- `HOME`
- `KERNEL`
- `EFS`
- `SEFS`
- `GANG`
- `md5`
- `USERDATA`
- `DEBUG`
- `VTS_KERNEL`
- `Vendor/System`

The UI warns when USERDATA appears required but missing:

- `ALL` should include matching `USERDATA`.
- `BL/AP/CP/CSC` should include matching `USERDATA`.

The app prevents mixing binary and APK selection in one operation:

```text
Can not select binary and apk file at the same time.
```

APK install path exists separately:

- `install -t "{apk_path}"`
- Status: `[PC->Device] Installing APK to device...`

## Odin4 Integration

The original app has two flashing paths:

1. Embedded `odin4.exe` CLI, preferred when `useOdin4CLI` is enabled.
2. Legacy `SS_DL_latest.dll` P/Invoke path:
   - `Odin_Create`
   - `Odin_Init`
   - `Odin_SetBinaryPath`
   - `Odin_SetExtraBinaryPath`
   - `Odin_StartMultiDownload`

CLI arguments built by `QD.BuildCLIArguments`:

```text
 --ignore-md5
 -a "{AP_PATH}"
 -b "{BL_PATH}"
 -c "{CP_PATH}"
 -s "{CSC_PATH}"
 -u "{USERDATA_OR_EXTRA_PATH}"
 -d \\.\COM{port}
```

Important: the rebuild should model Odin execution as a backend command with streamed stdout/stderr events to the UI.

## Device Operations

ADB-related features found:

- Detect device/build type: `shell getprop ro.build.type`
- Reboot/download mode actions.
- Restart devices.
- Run shell.
- Get device log:
  - `kernel.log`
  - main log
  - radio log

Windows serial device discovery uses:

```text
HARDWARE\DEVICEMAP\SERIALCOMM
```

## Rust/Tauri Target Architecture

Recommended backend modules:

- `qb_client`: authenticated HTTP client, server selection, REST error mapping.
- `legacy_settings`: import old WinForms settings and decrypt legacy token.
- `settings`: new app config plus OS keychain token storage.
- `artifact`: parse build/artifact responses into typed structs.
- `download`: resumable/streamed downloads with progress events.
- `selection`: binary/APK selection rules.
- `odin`: extract/run Odin4 CLI and stream progress.
- `adb`: device list, reboot/download mode, apk install, logs.
- `commands`: Tauri command layer.

Recommended frontend views:

- Server/token settings.
- Build lookup/latest builds.
- Artifact selection tree.
- Download queue.
- Device/flash panel.
- Logs.

## First Implementation Milestones

1. Build a Rust CLI proof-of-concept for:
   - credentials
   - `get_user_id`
   - `get_latest_builds`
   - `get_build_info`
   - `list_artifacts`
2. Add streaming download with progress callbacks.
3. Add Tauri UI shell and command bindings.
4. Add Odin4 CLI execution only after PC download is stable.
5. Add legacy settings importer and token migration.

