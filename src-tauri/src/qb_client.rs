use crate::artifact_parser::{parse_artifacts, parse_build_id, parse_build_status, parse_version};
use crate::types::{
    BuildArtifactGroup, Credentials, QuickBuildConfig, TokenTestAttempt, TokenTestResult,
};
use reqwest::{Client, StatusCode};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum QbError {
    #[error("Please enter username and access token in Settings.")]
    MissingCredentials,
    #[error("Invalid build ID or QB URL.")]
    InvalidBuildId,
    #[error("Please check username and access token.")]
    Unauthorized,
    #[error("You do not have permission to access this build.")]
    Forbidden,
    #[error("Can not find the build.")]
    NotFound,
    #[error("Build is still running. QB Downloader will keep checking until artifacts are ready.")]
    BuildRunning,
    #[error("Network error: {0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

#[derive(Clone)]
pub struct QbClient {
    http: Client,
    credentials: Credentials,
    config: QuickBuildConfig,
}

impl QbClient {
    pub fn new(credentials: Credentials, config: QuickBuildConfig) -> Result<Self, QbError> {
        Ok(Self {
            http: Client::new(),
            credentials,
            config: config.normalized().map_err(QbError::Other)?,
        })
    }

    pub async fn fetch_build_artifacts(&self, input: &str) -> Result<BuildArtifactGroup, QbError> {
        self.validate_credentials()?;
        let build_id = parse_build_id(input).ok_or(QbError::InvalidBuildId)?;

        if self.is_build_running(&build_id).await? {
            return Ok(running_group(input, &build_id));
        }

        let build_info = match self.send_rest(&format!("/builds/{build_id}")).await {
            Ok(text) => text,
            Err(QbError::BuildRunning) => {
                return Ok(running_group(input, &build_id));
            }
            Err(err) => return Err(err),
        };
        let version = parse_version(&build_info);
        if is_running_status(parse_build_status(&build_info).as_deref()) {
            return Ok(running_group(input, &build_id));
        }

        let mut artifact_text = String::new();
        for path in [
            format!("/ads5/filelist/{build_id}"),
            format!("/files/artifacts/{build_id}"),
        ] {
            match self.send_rest(&path).await {
                Ok(text) => {
                    artifact_text.push('\n');
                    artifact_text.push_str(&text);
                }
                Err(QbError::BuildRunning) => {
                    return Ok(running_group(input, &build_id));
                }
                Err(QbError::NotFound) => {}
                Err(err) => return Err(err),
            }
        }

        let mut artifacts = parse_artifacts(&build_id, &artifact_text);
        if artifacts.is_empty() {
            artifacts = parse_artifacts(&build_id, &build_info);
        }

        if artifacts.is_empty() {
            return Err(QbError::Other(
                "The build does not include any artifacts, or they have expired.".to_string(),
            ));
        }

        artifacts.sort_by_key(|artifact| artifact.name.to_ascii_lowercase());

        Ok(BuildArtifactGroup {
            id: uuid::Uuid::new_v4().to_string(),
            input: input.to_string(),
            build_id: Some(build_id),
            status: "ready".to_string(),
            version,
            artifacts,
            error: None,
        })
    }

    pub async fn test_token(&self) -> Result<TokenTestResult, QbError> {
        self.validate_credentials()?;

        let usernames = username_candidates(&self.credentials.username);
        let mut attempts = Vec::with_capacity(usernames.len());
        let mut selected_username = None;

        for username in usernames {
            let path = format!("/ids?user_name={username}");
            let credentials = Credentials {
                username: username.clone(),
                access_token: self.credentials.access_token.clone(),
            };
            let client = QbClient::new(credentials, self.config.clone())?;
            match client.send_rest(&path).await {
                Ok(body) => {
                    let ok = !body.trim().is_empty();
                    attempts.push(TokenTestAttempt {
                        username: username.clone(),
                        ok,
                        message: if ok {
                            "Token accepted.".to_string()
                        } else {
                            "Token accepted, but server returned an empty user id.".to_string()
                        },
                    });
                    if ok && selected_username.is_none() {
                        selected_username = Some(username);
                    }
                }
                Err(err) => attempts.push(TokenTestAttempt {
                    username,
                    ok: false,
                    message: err.to_string(),
                }),
            }
        }

        Ok(TokenTestResult {
            ok: selected_username.is_some(),
            selected_username,
            attempts,
        })
    }

    async fn send_rest(&self, path: &str) -> Result<String, QbError> {
        let url = format!(
            "{}/rest{}",
            self.config.base_url,
            append_qb_suffix(path, &self.config.api_suffix)
        );
        let response = self
            .http
            .get(url)
            .basic_auth(
                &self.credentials.username,
                Some(&self.credentials.access_token),
            )
            .send()
            .await
            .map_err(|err| QbError::Network(err.to_string()))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|err| QbError::Network(err.to_string()))?;
        map_status_with_body(status, &text)?;
        Ok(text)
    }

    async fn is_build_running(&self, build_id: &str) -> Result<bool, QbError> {
        match self.send_rest(&format!("/builds/{build_id}/status")).await {
            Ok(text) => Ok(is_running_status(parse_build_status(&text).as_deref())
                || is_running_status(Some(text.trim()))),
            Err(QbError::NotFound) => Ok(false),
            Err(QbError::BuildRunning) => Ok(true),
            Err(QbError::Unauthorized) => Err(QbError::Unauthorized),
            Err(QbError::Forbidden) => Err(QbError::Forbidden),
            Err(_) => Ok(false),
        }
    }

    fn validate_credentials(&self) -> Result<(), QbError> {
        if self.credentials.username.trim().is_empty()
            || self.credentials.access_token.trim().is_empty()
        {
            Err(QbError::MissingCredentials)
        } else {
            Ok(())
        }
    }
}

pub fn append_qb_suffix(path_or_url: &str, suffix: &str) -> String {
    let suffix = suffix.trim().trim_start_matches(['?', '&']);
    if suffix.is_empty() || path_or_url.contains(suffix) {
        return path_or_url.to_string();
    }
    let separator = if path_or_url.contains('?') { '&' } else { '?' };
    format!("{path_or_url}{separator}{suffix}")
}

fn username_candidates(username: &str) -> Vec<String> {
    let trimmed = username.trim();
    let mut candidates = vec![trimmed.to_string()];

    if let Some((_, short)) = trimmed.split_once('\\') {
        if !short.trim().is_empty() {
            candidates.push(short.trim().to_string());
        }
    }

    candidates.dedup();
    candidates
}

pub fn map_status(status: StatusCode) -> Result<(), QbError> {
    map_status_with_body(status, "")
}

fn map_status_with_body(status: StatusCode, body: &str) -> Result<(), QbError> {
    match status {
        StatusCode::OK | StatusCode::PARTIAL_CONTENT => Ok(()),
        StatusCode::UNAUTHORIZED => Err(QbError::Unauthorized),
        StatusCode::FORBIDDEN => Err(QbError::Forbidden),
        StatusCode::NOT_FOUND => Err(QbError::NotFound),
        StatusCode::INTERNAL_SERVER_ERROR if is_build_running_response(body) => {
            Err(QbError::BuildRunning)
        }
        other => Err(QbError::Other(format!(
            "QuickBuild server returned HTTP {other}."
        ))),
    }
}

fn is_build_running_response(body: &str) -> bool {
    let normalized = body.to_ascii_lowercase();
    if is_running_status(parse_build_status(body).as_deref()) {
        return true;
    }
    normalized.contains("build is running")
        || normalized.contains("build still running")
        || normalized.contains("build is still running")
        || normalized.trim() == "running"
}

fn is_running_status(status: Option<&str>) -> bool {
    matches!(
        status.map(|value| value.trim().to_ascii_uppercase()),
        Some(value) if value == "RUNNING" || value == "BUILDING" || value == "QUEUED"
    )
}

fn running_group(input: &str, build_id: &str) -> BuildArtifactGroup {
    BuildArtifactGroup {
        id: uuid::Uuid::new_v4().to_string(),
        input: input.to_string(),
        build_id: Some(build_id.to_string()),
        status: "watching".to_string(),
        version: None,
        artifacts: Vec::new(),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_username_candidates() {
        assert_eq!(username_candidates("endri.s"), vec!["endri.s".to_string()]);
        assert_eq!(
            username_candidates("corp\\endri.s"),
            vec!["corp\\endri.s".to_string(), "endri.s".to_string()]
        );
    }

    #[test]
    fn appends_original_qd_suffix_like_qd_exe() {
        assert_eq!(
            append_qb_suffix("/builds/123", "token"),
            "/builds/123?token"
        );
        assert_eq!(
            append_qb_suffix("/ids?user_name=endri.s", "?token"),
            "/ids?user_name=endri.s&token"
        );
        assert_eq!(append_qb_suffix("/builds/123", ""), "/builds/123");
    }

    #[test]
    fn treats_running_build_500_as_watchable_state() {
        assert!(matches!(
            map_status(StatusCode::INTERNAL_SERVER_ERROR),
            Err(QbError::Other(_))
        ));
        assert!(matches!(
            map_status_with_body(
                StatusCode::INTERNAL_SERVER_ERROR,
                "The build is running. Please try later."
            ),
            Err(QbError::BuildRunning)
        ));
    }

    #[test]
    fn recognizes_running_status_values_from_qd_flow() {
        assert!(is_running_status(Some("RUNNING")));
        assert!(is_running_status(Some(" building ")));
        assert!(!is_running_status(Some("SUCCESSFUL")));
        assert!(!is_running_status(None));
    }
}
