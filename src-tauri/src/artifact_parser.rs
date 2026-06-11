use crate::types::{Artifact, ArtifactKind};
use regex::Regex;
use serde_json::Value;

pub fn parse_build_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let known_path = Regex::new(r"(?i)/(?:builds?|download|filelist|artifacts)/([A-Za-z0-9._-]+)")
        .expect("valid regex");
    if let Some(captures) = known_path.captures_iter(trimmed).last() {
        return captures.get(1).map(|m| m.as_str().to_string());
    }

    let generic = Regex::new(r"[A-Za-z0-9][A-Za-z0-9._-]{2,}").expect("valid regex");
    generic
        .find_iter(trimmed)
        .last()
        .map(|m| m.as_str().trim_matches('.').to_string())
}

pub fn detect_kind(name: &str) -> ArtifactKind {
    let upper = name.to_ascii_uppercase();
    if upper.contains("USERDATA") {
        ArtifactKind::Userdata
    } else if upper.contains("HOME_CSC") || upper.contains("HOME") {
        ArtifactKind::Home
    } else if upper.contains("ALL") {
        ArtifactKind::All
    } else if upper.contains("AP") {
        ArtifactKind::Ap
    } else if upper.contains("BL") {
        ArtifactKind::Bl
    } else if upper.contains("CP") {
        ArtifactKind::Cp
    } else if upper.contains("CSC") {
        ArtifactKind::Csc
    } else if upper.ends_with(".MD5") || upper.contains("MD5") {
        ArtifactKind::Md5
    } else {
        ArtifactKind::Other
    }
}

pub fn parse_version(build_response: &str) -> Option<String> {
    extract_xml_tag(build_response, "version").or_else(|| {
        serde_json::from_str::<Value>(build_response)
            .ok()
            .and_then(|json| {
                json.get("version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
    })
}

pub fn parse_artifacts(build_id: &str, response: &str) -> Vec<Artifact> {
    if let Ok(json) = serde_json::from_str::<Value>(response) {
        let mut artifacts = Vec::new();
        collect_json_artifacts(build_id, &json, &mut artifacts);
        if !artifacts.is_empty() {
            return artifacts;
        }
    }

    let mut artifacts = Vec::new();
    let url_re = Regex::new(r#"https?://[^\s"'<>]+"#).expect("valid regex");
    for url in url_re.find_iter(response) {
        let url = url.as_str().to_string();
        let name = url
            .split('/')
            .last()
            .and_then(|value| value.split('?').next())
            .filter(|value| !value.is_empty())
            .unwrap_or("artifact")
            .to_string();
        artifacts.push(make_artifact(build_id, name, None, Some(url)));
    }

    if artifacts.is_empty() {
        let file_re = Regex::new(r#"(?i)([A-Za-z0-9._-]+\.(?:tar|tar\.md5|zip|bin|img|md5|apk))"#)
            .expect("valid regex");
        for captures in file_re.captures_iter(response) {
            if let Some(name) = captures.get(1) {
                let file = name.as_str().to_string();
                artifacts.push(make_artifact(build_id, file, None, None));
            }
        }
    }

    dedupe_artifacts(artifacts)
}

fn collect_json_artifacts(build_id: &str, value: &Value, artifacts: &mut Vec<Artifact>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_json_artifacts(build_id, item, artifacts);
            }
        }
        Value::Object(map) => {
            let name = ["name", "filename", "fileName", "path", "artifactName"]
                .iter()
                .find_map(|key| map.get(*key).and_then(Value::as_str));
            if let Some(name) = name {
                let size = ["size", "fileSize", "length"]
                    .iter()
                    .find_map(|key| map.get(*key).and_then(Value::as_u64));
                let url = ["url", "downloadUrl", "href"]
                    .iter()
                    .find_map(|key| map.get(*key).and_then(Value::as_str))
                    .map(str::to_string);
                artifacts.push(make_artifact(build_id, name.to_string(), size, url));
            }
            for child in map.values() {
                collect_json_artifacts(build_id, child, artifacts);
            }
        }
        _ => {}
    }
}

fn make_artifact(build_id: &str, name: String, size: Option<u64>, url: Option<String>) -> Artifact {
    Artifact {
        id: uuid::Uuid::new_v4().to_string(),
        build_id: build_id.to_string(),
        kind: detect_kind(&name),
        selected: true,
        name,
        size,
        url,
    }
}

fn dedupe_artifacts(artifacts: Vec<Artifact>) -> Vec<Artifact> {
    let mut seen = std::collections::HashSet::new();
    artifacts
        .into_iter()
        .filter(|artifact| seen.insert(artifact.name.clone()))
        .collect()
}

fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
    let re = Regex::new(&format!(r"(?is)<{tag}>\s*(.*?)\s*</{tag}>")).ok()?;
    re.captures(text)
        .and_then(|captures| captures.get(1))
        .map(|m| m.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_and_url_build_ids() {
        assert_eq!(parse_build_id("123456").as_deref(), Some("123456"));
        assert_eq!(
            parse_build_id("https://android.qb.sec.samsung.net/builds/ABC-123?x=1").as_deref(),
            Some("ABC-123")
        );
    }

    #[test]
    fn detects_artifact_kinds() {
        assert_eq!(detect_kind("AP_TEST.tar.md5"), ArtifactKind::Ap);
        assert_eq!(detect_kind("USERDATA_x.tar.md5"), ArtifactKind::Userdata);
        assert_eq!(detect_kind("HOME_CSC_x.tar.md5"), ArtifactKind::Home);
    }
}
