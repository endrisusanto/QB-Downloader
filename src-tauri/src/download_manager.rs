use crate::path_safety::output_path;
use crate::qb_client::{append_qb_suffix, map_status};
use crate::types::{DownloadEvent, DownloadRequest, ANDROID_QB_URL, QB_SUFFIX};
use reqwest::{header, Client, Response, StatusCode};
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
}

#[derive(Clone, Default)]
pub struct DownloadManager {
    jobs: Arc<Mutex<HashMap<String, JobControl>>>,
}

#[derive(Clone)]
struct JobControl {
    paused: Arc<AtomicBool>,
    cancelled: Arc<AtomicBool>,
    request: DownloadRequest,
}

impl DownloadManager {
    pub async fn start(
        &self,
        app: tauri::AppHandle,
        request: DownloadRequest,
    ) -> Result<String, DownloadError> {
        if request.target_dir.trim().is_empty() {
            return Err(DownloadError::MissingTarget);
        }

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
            paused: Arc::new(AtomicBool::new(false)),
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
                },
            );

            let app = app.clone();
            let job_id = job_id.clone();
            let request = request.clone();
            let control = control.clone();
            let http = http.clone();
            let semaphore = semaphore.clone();
            let failure_artifact = artifact.clone();
            let failure_build_id = request.build_id.clone();

            tokio::spawn(async move {
                let _permit = semaphore.acquire_owned().await.expect("semaphore open");
                if let Err(err) = download_one(
                    app.clone(),
                    http,
                    job_id.clone(),
                    request,
                    control,
                    artifact,
                )
                .await
                {
                    emit_event(
                        &app,
                        "download://failed",
                        DownloadEvent {
                            job_id,
                            artifact_id: failure_artifact.id,
                            build_id: failure_build_id,
                            name: failure_artifact.name,
                            status: "failed".to_string(),
                            downloaded: 0,
                            total: failure_artifact.size,
                            path: None,
                            message: Some(err.to_string()),
                            resumable: false,
                        },
                    );
                }
            });
        }

        Ok(job_id)
    }

    pub async fn pause(&self, job_id: &str) -> Result<(), DownloadError> {
        let guard = self.jobs.lock().await;
        let control = guard.get(job_id).ok_or(DownloadError::NotFound)?;
        control.paused.store(true, Ordering::Relaxed);
        Ok(())
    }

    pub async fn resume(&self, job_id: &str) -> Result<(), DownloadError> {
        let guard = self.jobs.lock().await;
        let control = guard.get(job_id).ok_or(DownloadError::NotFound)?;
        control.paused.store(false, Ordering::Relaxed);
        Ok(())
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

async fn download_one(
    app: tauri::AppHandle,
    http: Client,
    job_id: String,
    request: DownloadRequest,
    control: JobControl,
    artifact: crate::types::Artifact,
) -> Result<(), DownloadError> {
    let output = output_path(&request.target_dir, &request.build_id, &artifact.name);
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
        ),
    );

    let response = send_download_request(
        &http,
        artifact_download_urls(&request.build_id, &artifact),
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

    let total = response
        .content_length()
        .map(|length| length + downloaded)
        .or(artifact.size);

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
                "download://failed",
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
                ),
            );
            return Ok(());
        }

        while control.paused.load(Ordering::Relaxed) {
            emit_event(
                &app,
                "download://paused",
                event(
                    &job_id,
                    &request.build_id,
                    &artifact,
                    "paused",
                    downloaded,
                    total,
                    Some(output.display().to_string()),
                    None,
                    resumable,
                ),
            );
            sleep(Duration::from_millis(250)).await;
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

fn direct_download_url(build_id: &str, name: &str) -> String {
    append_qb_suffix(&format!(
        "{ANDROID_QB_URL}/download/{}/{}",
        urlencoding::encode(build_id),
        urlencoding::encode(name)
    ))
}

fn ads5_download_url(build_id: &str, name: &str) -> String {
    append_qb_suffix(&format!(
        "{ANDROID_QB_URL}/rest/ads5/download/{}?filename={}",
        urlencoding::encode(build_id),
        urlencoding::encode(name)
    ))
}

fn artifact_download_urls(build_id: &str, artifact: &crate::types::Artifact) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(url) = artifact.url.as_deref() {
        urls.push(with_qb_suffix(url));
    }
    urls.push(ads5_download_url(build_id, &artifact.name));
    urls.push(direct_download_url(build_id, &artifact.name));
    urls.dedup();
    urls
}

fn with_qb_suffix(url: &str) -> String {
    if url.contains(QB_SUFFIX) {
        url.to_string()
    } else {
        append_qb_suffix(url)
    }
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
    }
}

fn emit_event(app: &tauri::AppHandle, name: &str, payload: DownloadEvent) {
    let _ = app.emit(name, payload);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_download_url_encodes_parts() {
        assert_eq!(
            direct_download_url("QB 1", "AP file.tar.md5"),
            "https://android.qb.sec.samsung.net/download/QB%201/AP%20file.tar.md5?QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
        );
    }

    #[test]
    fn ads5_download_url_encodes_filename_query() {
        assert_eq!(
            ads5_download_url("QB 1", "AP file.tar.md5"),
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
            artifact_download_urls("110", &artifact)[0],
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
            artifact_download_urls("110", &artifact)[0],
            "https://android.qb.sec.samsung.net/download/110/ALL.tar.md5?QDgil8FjqA27El7lpOaC3YACGlCzhR9yq4FV1gnyZC"
        );
    }
}
