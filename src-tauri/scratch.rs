use regex::Regex;

fn main() {
    let response = r#"
        <list>
          <file>
            <path>AP_TEST.tar.md5</path>
            <size>10737418240</size>
            <url>https://android.qb.sec.samsung.net/rest/files/artifacts/123/AP_TEST.tar.md5</url>
          </file>
          <file>
            <name>BL_TEST.tar.md5</name>
            <size>2.5 GB</size>
            <url>https://android.qb.sec.samsung.net/rest/files/artifacts/123/BL_TEST.tar.md5</url>
          </file>
        </list>
    "#;

    let file_block_re = Regex::new(r"(?is)<file>\s*(.*?)\s*</file>").unwrap();
    let size_re = Regex::new(r"(?is)<(?:size|fileSize|length)>\s*(.*?)\s*</(?:size|fileSize|length)>").unwrap();

    for captures in file_block_re.captures_iter(response) {
        if let Some(block) = captures.get(1) {
            let block_text = block.as_str();
            let size = size_re.captures(block_text).and_then(|c| c.get(1)).map(|m| m.as_str());
            println!("Parsed size: {:?}", size);
        }
    }
}
