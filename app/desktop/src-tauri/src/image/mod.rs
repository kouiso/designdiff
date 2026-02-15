use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;

use crate::error::FigDiffError;

pub fn resize_image_to_match(
    base64_img: &str,
    target_width: u32,
    target_height: u32,
) -> Result<String, FigDiffError> {
    let img_bytes = decode_base64_image(base64_img)?;
    let img = image::load_from_memory(&img_bytes)?;
    let resized = img.resize_exact(
        target_width,
        target_height,
        image::imageops::FilterType::Lanczos3,
    );
    encode_image_to_base64(&resized)
}

pub fn get_image_dimensions(base64_img: &str) -> Result<(u32, u32), FigDiffError> {
    let img_bytes = decode_base64_image(base64_img)?;
    let img = image::load_from_memory(&img_bytes)?;
    Ok((img.width(), img.height()))
}

pub fn crop_image(
    base64_img: &str,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, FigDiffError> {
    let img_bytes = decode_base64_image(base64_img)?;
    let img = image::load_from_memory(&img_bytes)?;
    let cropped = img.crop_imm(x, y, width, height);
    encode_image_to_base64(&cropped)
}

fn decode_base64_image(base64_str: &str) -> Result<Vec<u8>, FigDiffError> {
    STANDARD
        .decode(base64_str)
        .map_err(|e| FigDiffError::ImageProcessing(e.to_string()))
}

fn encode_image_to_base64(img: &DynamicImage) -> Result<String, FigDiffError> {
    let mut buffer = Cursor::new(Vec::new());
    img.write_to(&mut buffer, ImageFormat::Png)
        .map_err(|e| FigDiffError::ImageProcessing(e.to_string()))?;
    Ok(STANDARD.encode(buffer.into_inner()))
}
