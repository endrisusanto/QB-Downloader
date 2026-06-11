# Rust/Tauri Rebuild Spec

This is the first implementation contract for rebuilding `QD.exe` as a Rust/Tauri app.

## Backend Commands

Recommended Tauri commands:

```rust
set_server(server: QbServer) -> Result<ServerState>
save_credentials(server_url: String, username: String, token: String) -> Result<()>
has_credentials(server_url: String) -> Result<bool>
get_user_id(server_url: String, username: String) -> Result<String>
get_latest_builds(server_url: String, username: String) -> Result<Vec<BuildSummary>>
get_build_info(server_url: String, build_id: String) -> Result<BuildInfo>
get_artifacts(server_url: String, build_id: String) -> Result<Vec<Artifact>>
download_artifacts(build_id: String, items: Vec<Artifact>, target_dir: PathBuf) -> Result<DownloadJobId>
cancel_download(job_id: DownloadJobId) -> Result<()>
list_devices() -> Result<Vec<Device>>
reboot_download_mode(serial: String) -> Result<()>
flash_with_odin(request: OdinFlashRequest) -> Result<FlashJobId>
install_apks(serial: String, apks: Vec<PathBuf>) -> Result<InstallJobId>
import_legacy_settings() -> Result<LegacyImportReport>
```

Long-running commands should emit events instead of blocking the UI.

## Events

```rust
download://started
download://progress
download://completed
download://failed
flash://started
flash://stdout
flash://stderr
flash://progress
flash://completed
flash://failed
device://changed
```

## Core Types

```rust
enum QbServerKind {
    Android,
    Cp,
    Package,
    Custom,
}

struct QbServer {
    kind: QbServerKind,
    name: String,
    url: String,
}

struct Credentials {
    username: String,
    token: String,
}

struct BuildSummary {
    id: String,
    version: Option<String>,
    status: Option<BuildStatus>,
    trigger_by: Option<String>,
    begin_date: Option<String>,
}

enum BuildStatus {
    Successful,
    Recommended,
    Failed,
    Cancelled,
    Running,
    Timeout,
    Unknown(String),
}

struct BuildInfo {
    id: String,
    version: Option<String>,
    status: BuildStatus,
    trigger_by: Option<String>,
    begin_date: Option<String>,
    duration: Option<String>,
    artifacts: Vec<Artifact>,
}

struct Artifact {
    name: String,
    size: Option<u64>,
    url: Option<String>,
    kind: ArtifactKind,
    customer: Option<String>,
}

enum ArtifactKind {
    Binary(BinaryKind),
    Apk,
    Md5,
    Other,
}

enum BinaryKind {
    All,
    Combination,
    Ap,
    Bl,
    Cp,
    Csc,
    HomeCsc,
    Home,
    Kernel,
    Efs,
    Sefs,
    Gang,
    Userdata,
    Debug,
    VtsKernel,
    VendorSystem,
    Unknown(String),
}

struct OdinFlashRequest {
    serial_or_com_port: String,
    ignore_md5: bool,
    ap: Option<PathBuf>,
    bl: Option<PathBuf>,
    cp: Option<PathBuf>,
    csc: Option<PathBuf>,
    userdata_or_extra: Option<PathBuf>,
}
```

## HTTP Client Rules

- Base URL is one of the known QB URLs or a custom URL.
- REST paths are prefixed with `/rest` except direct downloads such as `/download/...`.
- Use Basic Auth:

```text
Authorization: Basic base64("{username}:{token}")
```

- Normalize errors:
  - `401` -> invalid credential/token
  - `403` -> forbidden
  - `404` -> missing build/artifact
  - timeout/connect -> network error

## Legacy Settings Import

Importer should support:

- Multi-server token list:

```text
{server_url}|{username}|{token}||...
```

- Legacy encrypted `pw`:
  - SHA-256 key from `123456789012345678901234567890`
  - AES/Rijndael ECB
  - PKCS7
  - Base64

New storage should use OS keychain for tokens and a normal app config file for non-secret preferences.

## Odin4 CLI Builder

The old argument shape:

```text
odin4.exe [--ignore-md5] -a "{AP}" -b "{BL}" -c "{CP}" -s "{CSC}" -u "{USERDATA}" -d \\.\COM{PORT}
```

Build arguments as a vector, not a shell string, in Rust:

```rust
let mut args = Vec::new();
if ignore_md5 {
    args.push("--ignore-md5".into());
}
if let Some(ap) = ap {
    args.extend(["-a".into(), ap.display().to_string()]);
}
```

This avoids quoting bugs and spaces-in-path failures.

## Selection Rules

- Do not allow APK and binary selection in the same action.
- Warn if selected `ALL` or `BL/AP/CP/CSC` set appears to require `USERDATA`.
- Device flash is allowed only for compatible binary groups:
  - `ALL`
  - `COMBINATION`
  - `AP + BL + CP + CSC/HOME_CSC/HOME`
  - optional `USERDATA`
- APK install uses ADB, not Odin.

