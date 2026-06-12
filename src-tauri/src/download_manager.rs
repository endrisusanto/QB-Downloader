use crate::path_safety::output_path;
use crate::qb_client::{append_qb_suffix, map_status};
use crate::types::{DownloadEvent, DownloadRequest, QuickBuildConfig};
use reqwest::{header, header::HeaderMap, Client, Response, StatusCode};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Emitter;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, Semaphore};
use tokio::time::{sleep, Duration};

const MAX_ATTEMPTS: u8 = 4;
const RETRY_DELAYS_MS: [u64; 3] = [1_000, 2_000, 4_000];

#[derive(Debug, Error)]
pub enum DownloadError {
    #[error("Download job not found.")]
    NotFound,
    #[error("No artifact selected for download.")]
    EmptySelection,
    #[error("Download target folder is missing.")]
    MissingTarget,
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Network error: {0}")]
    Network(String),
    #[error("Invalid QuickBuild configuration: {0}")]
    InvalidConfig(String),
}

#[derive(Clone, Default)]
pub struct DownloadManager {
    jobs: Arc<Mutex<HashMap<String, JobControl>>>,
}

#[derive(Clone)]
struct JobControl {
    cancelled: Arc<AtomicBool>,
    request: DownloadRequest,
}

impl DownloadManager {
    pub async fn start(
        &self,
        app: tauri::AppHandle,
        mut request: DownloadRequest,
    ) -> Result<String, DownloadError> {
        if request.target_dir.trim().is_empty() {
            return Err(DownloadError::MissingTarget);
        }
        request.quick_build_config = request
            .quick_build_config
            .normalized()
            .map_err(DownloadError::InvalidConfig)?;

        let artifacts: Vec<_> = request
            .artifacts
            .iter()
            .filter(|artifact| artifact.selected)
            .cloned()
            .collect();
        if artifacts.is_empty() {
            return Err(DownloadError::EmptySelection);
        }

        let job_id = uuid::Uuid::new_v4().to_string();
        let control = JobControl {
            cancelled: Arc::new(AtomicBool::new(false)),
            request: request.clone(),
        };

        self.jobs
            .lock()
            .await
            .insert(job_id.clone(), control.clone());

        let concurrent = request.max_concurrent.max(1);
        let semaphore = Arc::new(Semaphore::new(concurrent));
        let http = Client::new();

        for artifact in artifacts {
            emit_event(
                &app,
                "download://queued",
                DownloadEvent {
                    job_id: job_id.clone(),
                    artifact_id: artifact.id.clone(),
                    build_id: request.build_id.clone(),
                    name: artifact.name.clone(),
                    status: "queued".to_string(),
                    downloaded: 0,
                    total: artifact.size,
                    path: None,
                    message: None,
                    resumable: false,
                    attempt: 0,
                    max_attempts: MAX_ATTEMPTS,
                    next_retry_ms: None,
                },
            );

            let app = app.clone();
            let job_id = job_id.clone();
            let request = request.clone();
            let control = control.clone();
            let http = http.clone();
            let semaphore = semaphore.clone();
            tokio::spawn(async move {
                let _permit = semaphore.acquire_owned().await.expect("semaphore open");
                if control.cancelled.load(Ordering::Relaxed) {
                    emit_event(
                        &app,
                        "download://cancelled",
                        event(
                            &job_id,
                            &request.build_id,
                            &artifact,
                            "cancelled",
                            0,
                            artifact.size,
                            None,
                            Some("Cancelled".to_string()),
                            false,
                            0,
                            None,
                        ),
                    );
                    return;
                }

                download_with_retry(app, http, job_id, request, control, artifact).await;
            });
        }

        Ok(job_id)
    }

    pub async fn cancel(&self, job_id: &str) -> Result<(), DownloadError> {
        let guard = self.jobs.lock().await;
        let control = guard.get(job_id).ok_or(DownloadError::NotFound)?;
        control.cancelled.store(true, Ordering::Relaxed);
        Ok(())
    }

    pub async fn retry(
        &self,
        app: tauri::AppHandle,
        job_id: &str,
    ) -> Result<String, DownloadError> {
        let request = {
            let guard = self.jobs.lock().await;
            guard
                .get(job_id)
                .ok_or(DownloadError::NotFound)?
                .request
                .clone()
        };
        self.start(app, request).await
    }
}

async fn download_with_retry(
    app: tauri::AppHandle,
    http: Client,
    job_id: String,
    request: DownloadRequest,
    control: JobControl,
    artifact: crate::types::Artifact,
) {
    for attempt in 1..=MAX_ATTEMPTS {
        let result = download_one(
            app.clone(),
            http.clone(),
            job_id.clone(),
            request.clone(),
            control.clone(),
            artifact.clone(),
            attempt,
        )
        .await;

        match result {
            Ok(()) => return,
            Err(_) if control.cancelled.load(Ordering::Relaxed) => {
                let output = output_path(&request.target_dir, &artifact.name);
                let downloaded = tokio::fs::metadata(partial_path(&output))
                    .await
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                emit_cancelled(
                    &app,
                    &job_id,
                    &request,
                    &artifact,
                    downloaded,
                    artifact.size,
                    downloaded > 0,
                    attempt,
                );
                return;
            }
            Err(err) if attempt < MAX_ATTEMPTS => {
                let delay_ms = RETRY_DELAYS_MS[(attempt - 1) as usize];
                let output = output_path(&request.target_dir, &artifact.name);
                let downloaded = tokio::fs::metadata(partial_path(&output))
                    .await
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                emit_event(
                    &app,
                    "download://retrying",
                    event(
                        &job_id,
                        &request.build_id,
                        &artifact,
                        "retrying",
                        downloaded,
                        artifact.size,
                        Some(output.display().to_string()),
                        Some(err.to_string()),
                        downloaded > 0,
                        attempt,
                        Some(delay_ms),
                    ),
                );

                if sleep_until_retry_or_cancel(&control, delay_ms).await {
                    emit_cancelled(
                        &app,
                        &job_id,
                        &request,
                        &artifact,
                        downloaded,
                        artifact.size,
                        downloaded > 0,
                        attempt,
                    );
                    return;
                }
            }
            Err(err) => {
                let output = output_path(&request.target_dir, &artifact.name);
                let downloaded = tokio::fs::metadata(partial_path(&output))
                    .await
                    .map(|metadata| metadata.len())
                    .unwrap_or(0);
                emit_event(
                    &app,
                    "download://failed",
                    event(
                        &job_id,
                        &request.build_id,
                        &artifact,
                        "failed",
                        downloaded,
                        artifact.size,
                        Some(output.display().to_string()),
                        Some(err.to_string()),
                        downloaded > 0,
                        attempt,
                        None,
                    ),
                );
                return;
            }
        }
    }
}

async fn sleep_until_retry_or_cancel(control: &JobControl, delay_ms: u64) -> bool {
    let mut elapsed = 0;
    while elapsed < delay_ms {
        if control.cancelled.load(Ordering::Relaxed) {
            return true;
        }
        let step = (delay_ms - elapsed).min(100);
        sleep(Duration::from_millis(step)).await;
        elapsed += step;
    }
    control.cancelled.load(Ordering::Relaxed)
}

async fn download_one(
    app: tauri::AppHandle,
    http: Client,
    job_id: String,
    request: DownloadRequest,
    control: JobControl,
    artifact: crate::types::Artifact,
    attempt: u8,
) -> Result<(), DownloadError> {
    let output = output_path(&request.target_dir, &artifact.name);
    let parent = output
        .parent()
        .ok_or_else(|| DownloadError::Io("Invalid output path.".to_string()))?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|err| DownloadError::Io(err.to_string()))?;

    let partial = partial_path(&output);
    let existing = tokio::fs::metadata(&partial)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    emit_event(
        &app,
        "download://progress",
        event(
            &job_id,
            &request.build_id,
            &artifact,
            "downloading",
            existing,
            artifact.size,
            Some(output.display().to_string()),
            None,
            existing > 0,
            attempt,
            None,
        ),
    );

    let response = send_download_request(
        &http,
        artifact_download_urls(&request.build_id, &artifact, &request.quick_build_config),
        &request.credentials,
        existing,
    )
    .await?;
    let status = response.status();

    let resumable = existing > 0 && status == StatusCode::PARTIAL_CONTENT;
    let mut downloaded = if existing > 0 && status == StatusCode::PARTIAL_CONTENT {
        existing
    } else {
        if existing > 0 {
            let _ = tokio::fs::remove_file(&partial).await;
        }
        0
    };

    let total = response_total(
        response.headers(),
        response.content_length(),
        downloaded,
        artifact.size,
    );

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(downloaded > 0)
        .write(true)
        .truncate(downloaded == 0)
        .open(&partial)
        .await
        .map_err(|err| DownloadError::Io(err.to_string()))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = futures_util::TryStreamExt::try_next(&mut stream)
        .await
        .map_err(|err| DownloadError::Network(err.to_string()))?
    {
        if control.cancelled.load(Ordering::Relaxed) {
            emit_event(
                &app,
                "download://cancelled",
                event(
                    &job_id,
                    &request.build_id,
                    &artifact,
                    "cancelled",
                    downloaded,
                    total,
                    Some(output.display().to_string()),
                    Some("Cancelled".to_string()),
                    resumable,
                    attempt,
                    None,
                ),
            );
            return Ok(());
        }

        file.write_all(&chunk)
            .await
            .map_err(|err| DownloadError::Io(err.to_string()))?;
        downloaded += chunk.len() as u64;

        emit_event(
            &app,
            "download://progress",
            event(
                &job_id,
                &request.build_id,
                &artifact,
                "downloading",
                downloaded,
                total,
                Some(output.display().to_string()),
                None,
                resumable,
                attempt,
                None,
            ),
        );
    }

    file.flush()
        .await
        .map_err(|err| DownloadError::Io(err.to_string()))?;
    drop(file);

    tokio::fs::rename(&partial, &output)
        .await
        .map_err(|err| DownloadError::Io(err.to_string()))?;

    emit_event(
        &app,
        "download://completed",
        event(
            &job_id,
            &request.build_id,
            &artifact,
            "completed",
            downloaded,
            total,
            Some(output.display().to_string()),
            None,
            resumable,
            attempt,
            None,
        ),
    );

    Ok(())
}

fn partial_path(path: &PathBuf) -> PathBuf {
    let mut partial = path.clone();
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    partial.set_file_name(format!("{file_name}.part"));
    partial
}

fn response_total(
    headers: &HeaderMap,
    content_length: Option<u64>,
    downloaded: u64,
    artifact_size: Option<u64>,
) -> Option<u64> {
    content_range_total(headers)
        .or_else(|| content_length.map(|length| length.saturating_add(downloaded)))
        .or(artifact_size)
}

fn content_range_total(headers: &HeaderMap) -> Option<u64> {
    let value = headers.get(header::CONTENT_RANGE)?.to_str().ok()?;
    let (_, total) = value.rsplit_once('/')?;
    if total == "*" {
        None
    } else {
        total.parse().ok()
    }
}

fn direct_download_url(build_id: &str, name: &str, config: &QuickBuildConfig) -> String {
    append_qb_suffix(
        &format!(
            "{}/download/{}/{}",
            config.base_url,
            urlencoding::encode(build_id),
            urlencoding::encode(name)
        ),
        &config.api_suffix,
    )
}

fn ads5_download_url(build_id: &str, name: &str, config: &QuickBuildConfig) -> String {
    append_qb_suffix(
        &format!(
            "{}/rest/ads5/download/{}?filename={}",
            config.base_url,
            urlencoding::encode(build_id),
            urlencoding::encode(name)
        ),
        &config.api_suffix,
    )
}

fn artifact_download_urls(
    build_id: &str,
    artifact: &crate::types::Artifact,
    config: &QuickBuildConfig,
) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(url) = artifact.url.as_deref() {
        urls.push(with_qb_suffix(url, &config.api_suffix));
    }
    urls.push(ads5_download_url(build_id, &artifact.name, config));
    urls.push(direct_download_url(build_id, &artifact.name, config));
    urls.dedup();
    urls
}

fn with_qb_suffix(url: &str, suffix: &str) -> String {
    append_qb_suffix(url, suffix)
}

async fn send_download_request(
    http: &Client,
    urls: Vec<String>,
    credentials: &crate::types::Credentials,
    existing: u64,
) -> Result<Response, DownloadError> {
    let mut last_error = None;

    for url in urls {
        let mut req = http
            .get(&url)
            .basic_auth(&credentials.username, Some(&credentials.access_token));
        if existing > 0 {
            req = req.header(header::RANGE, format!("bytes={existing}-"));
        }

        let response = match req.send().await {
            Ok(response) => response,
            Err(err) => {
                last_error = Some(err.to_string());
                continue;
            }
        };

        let status = response.status();
        if map_status(status).is_ok() {
            return Ok(response);
        }

        let message = map_status(status)
            .map(|_| "Download request failed.".to_string())
            .unwrap_or_else(|err| err.to_string());
        last_error = Some(message.clone());

        if !matches!(
            status,
            StatusCode::NOT_FOUND | StatusCode::BAD_REQUEST | StatusCode::METHOD_NOT_ALLOWED
        ) {
            return Err(DownloadError::Network(message));
        }
    }

    Err(DownloadError::Network(
        last_error.unwrap_or_else(|| "Download request failed.".to_string()),
    ))
}

fn event(
    job_id: &str,
    build_id: &str,
    artifact: &crate::types::Artifact,
    status: &str,
    downloaded: u64,
    total: Option<u64>,
    path: Option<String>,
    message: Option<String>,
    resumable: bool,
    attempt: u8,
    next_retry_ms: Option<u64>,
) -> DownloadEvent {
    DownloadEvent {
        job_id: job_id.to_string(),
        artifact_id: artifact.id.clone(),
        build_id: build_id.to_string(),
        name: artifact.name.clone(),
        status: status.to_string(),
        downloaded,
        total,
        path,
        message,
        resumable,
        attempt,
        max_attempts: MAX_ATTEMPTS,
        next_retry_ms,
    }
}

fn emit_cancelled(
    app: &tauri::AppHandle,
    job_id: &str,
    request: &DownloadRequest,
    artifact: &crate::types::Artifact,
    downloaded: u64,
    total: Option<u64>,
    resumable: bool,
    attempt: u8,
) {
    let output = output_path(&request.target_dir, &artifact.name);
    emit_event(
        app,
        "download://cancelled",
        event(
            job_id,
            &request.build_id,
            artifact,
            "cancelled",
            downloaded,
            total,
            Some(output.display().to_string()),
            Some("Cancelled".to_string()),
            resumable,
            attempt,
            None,
        ),
    );
}

fn emit_event(app: &tauri::AppHandle, name: &str, payload: DownloadEvent) {
    let _ = app.emit(name, payload);
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn direct_download_url_encodes_parts() {
        let config = QuickBuildConfig::default();
        assert_eq!(
            direct_download_url("QB 1", "AP file.tar.md5", &config),
            "https://android.qb.sec.samsung.net/download/QB%201/AP%20file.tar.md5?QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
        );
    }

    #[test]
    fn ads5_download_url_encodes_filename_query() {
        let config = QuickBuildConfig::default();
        assert_eq!(
            ads5_download_url("QB 1", "AP file.tar.md5", &config),
            "https://android.qb.sec.samsung.net/rest/ads5/download/QB%201?filename=AP%20file.tar.md5&QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
        );
    }

    #[test]
    fn artifact_download_urls_adds_qd_suffix_to_existing_url() {
        let artifact = crate::types::Artifact {
            id: "1".to_string(),
            build_id: "110".to_string(),
            name: "ALL.tar.md5".to_string(),
            size: Some(10),
            url: Some("https://android.qb.sec.samsung.net/download/110/ALL.tar.md5".to_string()),
            kind: crate::types::ArtifactKind::All,
            selected: true,
        };

        assert_eq!(
            artifact_download_urls("110", &artifact, &QuickBuildConfig::default())[0],
            "https://android.qb.sec.samsung.net/download/110/ALL.tar.md5?QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
        );
    }

    #[test]
    fn artifact_download_urls_keeps_existing_qd_suffix() {
        let artifact = crate::types::Artifact {
            id: "1".to_string(),
            build_id: "110".to_string(),
            name: "ALL.tar.md5".to_string(),
            size: Some(10),
            url: Some(
                "https://android.qb.sec.samsung.net/download/110/ALL.tar.md5?QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
                    .to_string(),
            ),
            kind: crate::types::ArtifactKind::All,
            selected: true,
        };

        assert_eq!(
            artifact_download_urls("110", &artifact, &QuickBuildConfig::default())[0],
            "https://android.qb.sec.samsung.net/download/110/ALL.tar.md5?QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
        );
    }

    #[test]
    fn download_urls_use_job_configuration() {
        let config = QuickBuildConfig {
            base_url: "https://quickbuild.example.test".to_string(),
            api_suffix: "secret=1".to_string(),
        };
        assert_eq!(
            direct_download_url("12", "ALL_file.zip", &config),
            "https://quickbuild.example.test/download/12/ALL_file.zip?secret=1"
        );
    }

    #[test]
    fn retry_schedule_has_three_exponential_delays() {
        assert_eq!(RETRY_DELAYS_MS, [1_000, 2_000, 4_000]);
        assert_eq!(MAX_ATTEMPTS, 4);
    }

    #[test]
    fn response_total_prefers_content_range() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_static("bytes 100-199/1000"),
        );
        assert_eq!(
            response_total(&headers, Some(100), 100, Some(900)),
            Some(1000)
        );
    }

    #[test]
    fn response_total_uses_content_length_then_artifact_metadata() {
        let headers = HeaderMap::new();
        assert_eq!(
            response_total(&headers, Some(250), 100, Some(900)),
            Some(350)
        );
        assert_eq!(response_total(&headers, None, 0, Some(900)), Some(900));
        assert_eq!(response_total(&headers, None, 0, None), None);
    }

    #[test]
    fn response_total_ignores_unknown_or_malformed_content_range() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_RANGE, HeaderValue::from_static("bytes */*"));
        assert_eq!(response_total(&headers, Some(250), 0, None), Some(250));
        headers.insert(header::CONTENT_RANGE, HeaderValue::from_static("invalid"));
        assert_eq!(response_total(&headers, None, 0, Some(900)), Some(900));
    }
}
