use base64::Engine;
use reqwest::Client;
use std::path::PathBuf;

use crate::error::FigDiffError;
use crate::figma::types::*;

const FIGMA_API_BASE: &str = "https://api.figma.com/v1";
const CACHE_SUBDIR: &str = "cache";
const SERVICE_NAME: &str = "figdiff";
const KEYRING_USER: &str = "figma-token";

pub struct FigmaClient {
    client: Client,
    token: String,
}

impl FigmaClient {
    pub fn new(token: &str) -> Self {
        Self {
            client: Client::new(),
            token: token.to_string(),
        }
    }

    pub async fn get_file(&self, file_key: &str, depth: u8) -> Result<FigmaFileResponse, FigDiffError> {
        let url = format!("{}/files/{}?depth={}", FIGMA_API_BASE, file_key, depth);
        let resp = self
            .client
            .get(&url)
            .header("X-FIGMA-TOKEN", &self.token)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(FigDiffError::FigmaApi(format!(
                "status {}: {}",
                status, body
            )));
        }

        let data: FigmaFileResponse = resp.json().await?;
        Ok(data)
    }

    pub async fn get_image_url(
        &self,
        file_key: &str,
        node_id: &str,
        scale: u8,
    ) -> Result<String, FigDiffError> {
        let url = format!(
            "{}/images/{}?ids={}&format=png&scale={}",
            FIGMA_API_BASE, file_key, node_id, scale
        );
        let resp = self
            .client
            .get(&url)
            .header("X-FIGMA-TOKEN", &self.token)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(FigDiffError::FigmaApi(format!(
                "status {}: {}",
                status, body
            )));
        }

        let data: FigmaImagesResponse = resp.json().await?;
        let image_url = data
            .images
            .get(node_id)
            .and_then(|v| v.as_ref())
            .ok_or_else(|| FigDiffError::FigmaApi("No image URL returned".to_string()))?;

        Ok(image_url.clone())
    }

    pub async fn get_node(
        &self,
        file_key: &str,
        node_id: &str,
    ) -> Result<FigmaNode, FigDiffError> {
        let url = format!(
            "{}/files/{}/nodes?ids={}",
            FIGMA_API_BASE, file_key, node_id
        );
        let resp = self
            .client
            .get(&url)
            .header("X-FIGMA-TOKEN", &self.token)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(FigDiffError::FigmaApi(format!(
                "status {}: {}",
                status, body
            )));
        }

        let data: FigmaNodesResponse = resp.json().await?;
        let wrapper = data
            .nodes
            .into_values()
            .next()
            .flatten()
            .ok_or_else(|| FigDiffError::FigmaApi("Node not found".to_string()))?;

        Ok(wrapper.document)
    }

    pub async fn download_image_as_base64(
        &self,
        file_key: &str,
        node_id: &str,
        scale: u8,
    ) -> Result<String, FigDiffError> {
        // Check cache first
        let cache_path = get_cache_path(file_key, node_id, scale);
        if cache_path.exists() {
            let bytes = std::fs::read(&cache_path)?;
            return Ok(base64::engine::general_purpose::STANDARD.encode(&bytes));
        }

        // Fetch image URL then download
        let image_url = self.get_image_url(file_key, node_id, scale).await?;
        let resp = self.client.get(&image_url).send().await?;

        if !resp.status().is_success() {
            return Err(FigDiffError::FigmaApi(format!(
                "Failed to download image: status {}",
                resp.status()
            )));
        }

        let bytes = resp.bytes().await?.to_vec();

        // Save to cache
        if let Some(parent) = cache_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&cache_path, &bytes)?;

        Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
    }
}

/// Extract frames (FRAME nodes) from a Figma file response.
/// Recursively searches through SECTIONs to find all frames.
pub fn extract_frames(response: &FigmaFileResponse) -> Vec<Frame> {
    let mut frames = Vec::new();
    for page in &response.document.children {
        collect_frames(&page.children, &mut frames);
    }
    frames
}

fn collect_frames(nodes: &[FigmaNode], frames: &mut Vec<Frame>) {
    for node in nodes {
        if node.node_type == "FRAME" {
            if let Some(ref bbox) = node.absolute_bounding_box {
                frames.push(Frame {
                    id: node.id.clone(),
                    name: node.name.clone(),
                    width: bbox.width,
                    height: bbox.height,
                });
            }
        } else if node.node_type == "SECTION" {
            collect_frames(&node.children, frames);
        }
    }
}

// --- Token management (OS Keychain) ---

pub fn save_token(token: &str) -> Result<(), FigDiffError> {
    let entry = keyring::Entry::new(SERVICE_NAME, KEYRING_USER)?;
    entry.set_password(token)?;
    Ok(())
}

pub fn get_token() -> Result<Option<String>, FigDiffError> {
    let entry = keyring::Entry::new(SERVICE_NAME, KEYRING_USER)?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(FigDiffError::Keyring(e.to_string())),
    }
}

pub fn delete_token() -> Result<(), FigDiffError> {
    let entry = keyring::Entry::new(SERVICE_NAME, KEYRING_USER)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(FigDiffError::Keyring(e.to_string())),
    }
}

// --- Cache helpers ---

fn get_figdiff_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("figdiff")
}

fn get_cache_path(file_key: &str, node_id: &str, scale: u8) -> PathBuf {
    let safe_node_id = node_id.replace(':', "_");
    get_figdiff_dir()
        .join(CACHE_SUBDIR)
        .join(format!("{}_{}_{}x.png", file_key, safe_node_id, scale))
}

// --- Local image reading ---

pub fn read_local_image_as_base64(path: &str) -> Result<String, FigDiffError> {
    let bytes = std::fs::read(path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_frames_filters_frame_type() {
        let response = FigmaFileResponse {
            name: "Test File".to_string(),
            document: FigmaNode {
                id: "0:0".to_string(),
                name: "Document".to_string(),
                node_type: "DOCUMENT".to_string(),
                children: vec![FigmaNode {
                    id: "0:1".to_string(),
                    name: "Page 1".to_string(),
                    node_type: "CANVAS".to_string(),
                    children: vec![
                        FigmaNode {
                            id: "1:1".to_string(),
                            name: "Home".to_string(),
                            node_type: "FRAME".to_string(),
                            absolute_bounding_box: Some(BoundingBox {
                                x: 0.0,
                                y: 0.0,
                                width: 1440.0,
                                height: 900.0,
                            }),
                            ..default_node()
                        },
                        FigmaNode {
                            id: "1:2".to_string(),
                            name: "Icon Set".to_string(),
                            node_type: "COMPONENT_SET".to_string(),
                            absolute_bounding_box: Some(BoundingBox {
                                x: 0.0,
                                y: 0.0,
                                width: 100.0,
                                height: 100.0,
                            }),
                            ..default_node()
                        },
                        FigmaNode {
                            id: "1:3".to_string(),
                            name: "Login".to_string(),
                            node_type: "FRAME".to_string(),
                            absolute_bounding_box: Some(BoundingBox {
                                x: 0.0,
                                y: 0.0,
                                width: 400.0,
                                height: 600.0,
                            }),
                            ..default_node()
                        },
                    ],
                    ..default_node()
                }],
                ..default_node()
            },
        };

        let frames = extract_frames(&response);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].name, "Home");
        assert_eq!(frames[0].width, 1440.0);
        assert_eq!(frames[0].height, 900.0);
        assert_eq!(frames[1].name, "Login");
        assert_eq!(frames[1].width, 400.0);
    }

    #[test]
    fn test_extract_frames_inside_section() {
        let response = FigmaFileResponse {
            name: "With Sections".to_string(),
            document: FigmaNode {
                id: "0:0".to_string(),
                name: "Document".to_string(),
                node_type: "DOCUMENT".to_string(),
                children: vec![FigmaNode {
                    id: "0:1".to_string(),
                    name: "Page 1".to_string(),
                    node_type: "CANVAS".to_string(),
                    children: vec![FigmaNode {
                        id: "72:2501".to_string(),
                        name: "Section 1".to_string(),
                        node_type: "SECTION".to_string(),
                        children: vec![FigmaNode {
                            id: "78:4555".to_string(),
                            name: "Home".to_string(),
                            node_type: "FRAME".to_string(),
                            absolute_bounding_box: Some(BoundingBox {
                                x: 0.0,
                                y: 0.0,
                                width: 1440.0,
                                height: 900.0,
                            }),
                            ..default_node()
                        }],
                        ..default_node()
                    }],
                    ..default_node()
                }],
                ..default_node()
            },
        };

        let frames = extract_frames(&response);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].id, "78:4555");
        assert_eq!(frames[0].name, "Home");
    }

    #[test]
    fn test_extract_frames_empty_children() {
        let response = FigmaFileResponse {
            name: "Empty".to_string(),
            document: FigmaNode {
                id: "0:0".to_string(),
                name: "Document".to_string(),
                node_type: "DOCUMENT".to_string(),
                children: vec![FigmaNode {
                    id: "0:1".to_string(),
                    name: "Page 1".to_string(),
                    node_type: "CANVAS".to_string(),
                    children: vec![],
                    ..default_node()
                }],
                ..default_node()
            },
        };

        let frames = extract_frames(&response);
        assert!(frames.is_empty());
    }

    #[tokio::test]
    #[ignore] // Run with: cargo test -- --ignored
    async fn test_real_figma_api() {
        let token = std::env::var("FIGMA_TOKEN").expect("FIGMA_TOKEN env var required");
        let client = FigmaClient::new(&token);

        // 1. Get file structure
        let file_key = "jtbb3RSgh96VaeoJqlRfTL";
        let response = client.get_file(file_key, 3).await.expect("get_file failed");
        println!("File name: {}", response.name);

        let frames = extract_frames(&response);
        println!("Found {} frames", frames.len());
        for f in &frames {
            println!("  Frame: {} (id: {}, {}x{})", f.name, f.id, f.width, f.height);
        }
        assert!(!frames.is_empty(), "Should find at least one frame");

        // 2. Get image for node 78:4555
        let base64_img = client
            .download_image_as_base64(file_key, "78:4555", 2)
            .await
            .expect("download_image failed");
        println!("Image base64 length: {}", base64_img.len());
        assert!(base64_img.len() > 1000, "Image should have substantial data");

        // 3. Get node details
        let node = client
            .get_node(file_key, "78:4555")
            .await
            .expect("get_node failed");
        println!("Node: {} (type: {})", node.name, node.node_type);

        println!("All integration tests passed!");
    }

    fn default_node() -> FigmaNode {
        FigmaNode {
            id: String::new(),
            name: String::new(),
            node_type: String::new(),
            children: vec![],
            absolute_bounding_box: None,
            absolute_render_bounds: None,
            fills: vec![],
            strokes: vec![],
            stroke_weight: None,
            corner_radius: None,
            rectangle_corner_radii: None,
            effects: vec![],
            opacity: None,
            layout_mode: None,
            primary_axis_align_items: None,
            counter_axis_align_items: None,
            padding_left: None,
            padding_right: None,
            padding_top: None,
            padding_bottom: None,
            item_spacing: None,
            style: None,
            characters: None,
        }
    }
}
