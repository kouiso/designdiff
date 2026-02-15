mod error;
mod figma;
mod image;

use error::FigDiffError;
use figma::client;
use figma::transform;
use figma::types::{Frame, NodeInspection, Project};

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
async fn save_project(project: Project) -> Result<(), FigDiffError> {
    client::save_project(&project)
}

#[tauri::command]
async fn load_project_list() -> Result<Vec<Project>, FigDiffError> {
    client::load_project_list()
}

#[tauri::command]
async fn resize_image_to_match(
    base64_img: String,
    target_width: u32,
    target_height: u32,
) -> Result<String, FigDiffError> {
    image::resize_image_to_match(&base64_img, target_width, target_height)
}

#[tauri::command]
async fn get_image_dimensions(base64_img: String) -> Result<(u32, u32), FigDiffError> {
    image::get_image_dimensions(&base64_img)
}

#[tauri::command]
async fn crop_image(
    base64_img: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, FigDiffError> {
    image::crop_image(&base64_img, x, y, width, height)
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
            save_project,
            load_project_list,
            resize_image_to_match,
            get_image_dimensions,
            crop_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
