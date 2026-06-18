use std::path::{Component, Path, PathBuf};

pub fn safe_component(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('.').trim_matches('_').to_string();
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed
    }
}

pub fn output_path(target_dir: &str, filename: &str) -> PathBuf {
    let base = Path::new(target_dir);
    let file = Path::new(filename)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str().map(safe_component),
            _ => None,
        })
        .last()
        .unwrap_or_else(|| safe_component(filename));
    base.join(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_output_path() {
        let path = output_path("/tmp/base", "../AP test.tar.md5");
        assert_eq!(path, Path::new("/tmp/base").join("AP_test.tar.md5"));
    }
}
