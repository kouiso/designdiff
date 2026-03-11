mod error;
mod figma;
mod screenshot;

use error::FigDiffError;
use figma::client;
use figma::transform;
use figma::types::{Frame, NodeInspection};

#[tauri::command]
async fn get_figma_frames(file_key: String) -> Result<Vec<Frame>, FigDiffError> {
    let token = client::get_token()?.ok_or(FigDiffError::TokenNotFound)?;
    let figma_client = client::FigmaClient::new(&token);
    let response = figma_client.get_file(&file_key, 3).await?;
    Ok(client::extract_frames(&response))
}

#[tauri::command]
async fn get_figma_frame_image(
    file_key: String,
    node_id: String,
    scale: u8,
) -> Result<String, FigDiffError> {
    let token = client::get_token()?.ok_or(FigDiffError::TokenNotFound)?;
    let figma_client = client::FigmaClient::new(&token);
    figma_client
        .download_image_as_base64(&file_key, &node_id, scale)
        .await
}

#[tauri::command]
async fn get_figma_node_detail(
    file_key: String,
    node_id: String,
    _depth: u8,
) -> Result<NodeInspection, FigDiffError> {
    let token = client::get_token()?.ok_or(FigDiffError::TokenNotFound)?;
    let figma_client = client::FigmaClient::new(&token);
    let node = figma_client.get_node(&file_key, &node_id).await?;
    Ok(transform::transform_node(&node))
}

#[tauri::command]
async fn save_figma_token(token: String) -> Result<(), FigDiffError> {
    client::save_token(&token)
}

#[tauri::command]
async fn get_figma_token() -> Result<Option<String>, FigDiffError> {
    client::get_token()
}

#[tauri::command]
async fn delete_figma_token() -> Result<(), FigDiffError> {
    client::delete_token()
}

#[tauri::command]
async fn read_local_image(path: String) -> Result<String, FigDiffError> {
    client::read_local_image_as_base64(&path)
}

#[tauri::command]
async fn capture_url_screenshot(
    url: String,
    width: u32,
    height: u32,
) -> Result<String, FigDiffError> {
    screenshot::capture(&url, width, height).await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_figma_frames,
            get_figma_frame_image,
            get_figma_node_detail,
            save_figma_token,
            get_figma_token,
            delete_figma_token,
            read_local_image,
            capture_url_screenshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
