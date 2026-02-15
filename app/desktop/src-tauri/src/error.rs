use thiserror::Error;

#[derive(Debug, Error)]
pub enum FigDiffError {
    #[error("Figma API error: {0}")]
    FigmaApi(String),

    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Image processing error: {0}")]
    Image(#[from] image::ImageError),

    #[error("Image processing error: {0}")]
    ImageProcessing(String),

    #[error("Keyring error: {0}")]
    Keyring(String),

    #[error("Token not found. Please set your Figma token in Settings.")]
    TokenNotFound,

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}

impl From<keyring::Error> for FigDiffError {
    fn from(e: keyring::Error) -> Self {
        FigDiffError::Keyring(e.to_string())
    }
}

impl serde::Serialize for FigDiffError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
