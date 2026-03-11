use std::path::PathBuf;

use base64::Engine;

use crate::error::FigDiffError;

fn find_chrome() -> Result<String, FigDiffError> {
    if let Ok(path) = std::env::var("CHROME_PATH") {
        if std::path::Path::new(&path).exists() {
            return Ok(path);
        }
    }

    let candidates: Vec<String> = if cfg!(target_os = "macos") {
        vec![
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into(),
            "/Applications/Chromium.app/Contents/MacOS/Chromium".into(),
            "/opt/homebrew/bin/chromium".into(),
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            format!(
                "{}\\Google\\Chrome\\Application\\chrome.exe",
                std::env::var("PROGRAMFILES").unwrap_or_default()
            ),
            format!(
                "{}\\Google\\Chrome\\Application\\chrome.exe",
                std::env::var("PROGRAMFILES(X86)").unwrap_or_default()
            ),
            format!(
                "{}\\Google\\Chrome\\Application\\chrome.exe",
                std::env::var("LOCALAPPDATA").unwrap_or_default()
            ),
            format!(
                "{}\\Microsoft\\Edge\\Application\\msedge.exe",
                std::env::var("PROGRAMFILES(X86)").unwrap_or_default()
            ),
        ]
    } else {
        vec![
            "/usr/bin/google-chrome".into(),
            "/usr/bin/google-chrome-stable".into(),
            "/usr/bin/chromium-browser".into(),
            "/usr/bin/chromium".into(),
            "/snap/bin/chromium".into(),
        ]
    };

    for candidate in &candidates {
        if std::path::Path::new(candidate.as_str()).exists() {
            return Ok(candidate.clone());
        }
    }

    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };
    let names = if cfg!(target_os = "windows") {
        vec!["chrome.exe", "msedge.exe"]
    } else {
        vec!["google-chrome", "chromium-browser", "chromium"]
    };

    for name in names {
        if let Ok(output) = std::process::Command::new(which_cmd).arg(name).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(path);
                }
            }
        }
    }

    Err(FigDiffError::ScreenshotCapture(
        "Chrome or Chromium not found. Install Chrome or set CHROME_PATH environment variable."
            .into(),
    ))
}

pub async fn capture(url: &str, width: u32, height: u32) -> Result<String, FigDiffError> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(FigDiffError::InvalidInput(
            "URL must start with http:// or https://".into(),
        ));
    }

    let chrome = find_chrome()?;

    let temp_path: PathBuf = std::env::temp_dir().join(format!(
        "figdiff-capture-{}.png",
        chrono::Utc::now().timestamp_millis()
    ));

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        tokio::process::Command::new(&chrome)
            .args([
                "--headless=new",
                &format!("--screenshot={}", temp_path.display()),
                &format!("--window-size={},{}", width, height),
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-device-scale-factor=1",
                "--run-all-compositor-stages-before-draw",
                "--virtual-time-budget=10000",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                url,
            ])
            .output(),
    )
    .await
    .map_err(|_| FigDiffError::ScreenshotCapture("Chrome process timed out (30s)".into()))?
    .map_err(|e| FigDiffError::ScreenshotCapture(format!("Failed to launch Chrome: {}", e)))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(FigDiffError::ScreenshotCapture(format!(
            "Chrome exited with error: {}",
            stderr.trim()
        )));
    }

    if !tokio::fs::try_exists(&temp_path).await.unwrap_or(false) {
        return Err(FigDiffError::ScreenshotCapture(
            "Screenshot file was not created by Chrome".into(),
        ));
    }

    let bytes = tokio::fs::read(&temp_path).await?;
    let _ = tokio::fs::remove_file(&temp_path).await;

    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_chrome() {
        let result = find_chrome();
        assert!(result.is_ok(), "Chrome should be detected: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_capture_returns_valid_base64_png() {
        let result = capture("https://example.com", 1440, 900).await;
        assert!(result.is_ok(), "Capture failed: {:?}", result.err());
        let base64_str = result.unwrap();

        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&base64_str)
            .expect("Invalid base64");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n", "Not a valid PNG");

        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        assert_eq!(width, 1440);
        assert_eq!(height, 900);
    }

    #[tokio::test]
    async fn test_capture_rejects_invalid_url() {
        let result = capture("file:///etc/passwd", 800, 600).await;
        assert!(result.is_err());
    }
}
