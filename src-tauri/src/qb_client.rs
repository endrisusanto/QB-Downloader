use crate::artifact_parser::{parse_artifacts, parse_build_id, parse_version};
use crate::types::{BuildArtifactGroup, Credentials, ANDROID_QB_URL};
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
    #[error("Network error: {0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

#[derive(Clone)]
pub struct QbClient {
    http: Client,
    credentials: Credentials,
}

impl QbClient {
    pub fn new(credentials: Credentials) -> Self {
        Self {
            http: Client::new(),
            credentials,
        }
    }

    pub async fn fetch_build_artifacts(&self, input: &str) -> Result<BuildArtifactGroup, QbError> {
        self.validate_credentials()?;
        let build_id = parse_build_id(input).ok_or(QbError::InvalidBuildId)?;

        let build_info = self.send_rest(&format!("/builds/{build_id}")).await?;
        let version = parse_version(&build_info);

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

    async fn send_rest(&self, path: &str) -> Result<String, QbError> {
        let url = format!("{ANDROID_QB_URL}/rest{path}");
        let response = self
            .http
            .get(url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.access_token))
            .send()
            .await
            .map_err(|err| QbError::Network(err.to_string()))?;

        map_status(response.status())?;
        response
            .text()
            .await
            .map_err(|err| QbError::Network(err.to_string()))
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

pub fn map_status(status: StatusCode) -> Result<(), QbError> {
    match status {
        StatusCode::OK | StatusCode::PARTIAL_CONTENT => Ok(()),
        StatusCode::UNAUTHORIZED => Err(QbError::Unauthorized),
        StatusCode::FORBIDDEN => Err(QbError::Forbidden),
        StatusCode::NOT_FOUND => Err(QbError::NotFound),
        other => Err(QbError::Other(format!(
            "QuickBuild server returned HTTP {other}."
        ))),
    }
}
