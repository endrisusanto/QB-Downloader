use serde::{Deserialize, Serialize};

pub const ANDROID_QB_URL: &str = "https://android.qb.sec.samsung.net";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub username: String,
    pub access_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub build_id: String,
    pub name: String,
    pub size: Option<u64>,
    pub url: Option<String>,
    pub kind: ArtifactKind,
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArtifactKind {
    All,
    Ap,
    Bl,
    Cp,
    Csc,
    Md5,
    Userdata,
    Home,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildArtifactGroup {
    pub id: String,
    pub input: String,
    pub build_id: Option<String>,
    pub status: String,
    pub version: Option<String>,
    pub artifacts: Vec<Artifact>,
    pub error: Option<String>,
}

impl BuildArtifactGroup {
    pub fn failed(input: String, error: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            input,
            build_id: None,
            status: "failed".to_string(),
            version: None,
            artifacts: Vec::new(),
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub build_id: String,
    pub target_dir: String,
    pub credentials: Credentials,
    pub max_concurrent: usize,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEvent {
    pub job_id: String,
    pub artifact_id: String,
    pub build_id: String,
    pub name: String,
    pub status: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub path: Option<String>,
    pub message: Option<String>,
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenTestAttempt {
    pub username: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenTestResult {
    pub ok: bool,
    pub selected_username: Option<String>,
    pub attempts: Vec<TokenTestAttempt>,
}
