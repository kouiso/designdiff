use serde::{Deserialize, Serialize};

// --- Figma API response types ---

#[derive(Debug, Deserialize)]
pub struct FigmaFileResponse {
    pub name: String,
    pub document: FigmaNode,
}

#[derive(Debug, Deserialize)]
pub struct FigmaNode {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub node_type: String,
    #[serde(default)]
    pub children: Vec<FigmaNode>,
    #[serde(rename = "absoluteBoundingBox")]
    pub absolute_bounding_box: Option<BoundingBox>,
    #[serde(rename = "absoluteRenderBounds")]
    pub absolute_render_bounds: Option<BoundingBox>,
    #[serde(default)]
    pub fills: Vec<FigmaPaint>,
    #[serde(default)]
    pub strokes: Vec<FigmaPaint>,
    #[serde(rename = "strokeWeight")]
    pub stroke_weight: Option<f64>,
    #[serde(rename = "cornerRadius")]
    pub corner_radius: Option<f64>,
    #[serde(rename = "rectangleCornerRadii")]
    pub rectangle_corner_radii: Option<[f64; 4]>,
    #[serde(default)]
    pub effects: Vec<FigmaEffect>,
    pub opacity: Option<f64>,
    #[serde(rename = "layoutMode")]
    pub layout_mode: Option<String>,
    #[serde(rename = "primaryAxisAlignItems")]
    pub primary_axis_align_items: Option<String>,
    #[serde(rename = "counterAxisAlignItems")]
    pub counter_axis_align_items: Option<String>,
    #[serde(rename = "paddingLeft")]
    pub padding_left: Option<f64>,
    #[serde(rename = "paddingRight")]
    pub padding_right: Option<f64>,
    #[serde(rename = "paddingTop")]
    pub padding_top: Option<f64>,
    #[serde(rename = "paddingBottom")]
    pub padding_bottom: Option<f64>,
    #[serde(rename = "itemSpacing")]
    pub item_spacing: Option<f64>,
    pub style: Option<FigmaTypeStyle>,
    pub characters: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct BoundingBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FigmaPaint {
    #[serde(rename = "type")]
    pub paint_type: String,
    pub color: Option<FigmaColor>,
    pub opacity: Option<f64>,
    pub visible: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FigmaColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FigmaEffect {
    #[serde(rename = "type")]
    pub effect_type: String,
    pub visible: Option<bool>,
    pub radius: Option<f64>,
    pub color: Option<FigmaColor>,
    pub offset: Option<FigmaVector>,
    pub spread: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FigmaVector {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FigmaTypeStyle {
    #[serde(rename = "fontFamily")]
    pub font_family: Option<String>,
    #[serde(rename = "fontSize")]
    pub font_size: Option<f64>,
    #[serde(rename = "fontWeight")]
    pub font_weight: Option<f64>,
    #[serde(rename = "lineHeightPx")]
    pub line_height_px: Option<f64>,
    #[serde(rename = "letterSpacing")]
    pub letter_spacing: Option<f64>,
    #[serde(rename = "textAlignHorizontal")]
    pub text_align_horizontal: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct FigmaImagesResponse {
    pub images: std::collections::HashMap<String, Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct FigmaNodesResponse {
    pub nodes: std::collections::HashMap<String, Option<FigmaNodeWrapper>>,
}

#[derive(Debug, Deserialize)]
pub struct FigmaNodeWrapper {
    pub document: FigmaNode,
}

// --- FigDiff output types (sent to frontend) ---

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Frame {
    pub id: String,
    pub name: String,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeInspection {
    pub id: String,
    pub name: String,
    pub node_type: String,
    pub layout: NodeLayout,
    pub appearance: NodeAppearance,
    pub typography: Option<NodeTypography>,
    pub children: Vec<ChildNodeSummary>,
    pub css_suggestion: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeLayout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub padding: Option<Padding>,
    pub gap: Option<f64>,
    pub layout_mode: Option<String>,
    pub primary_axis_align: Option<String>,
    pub counter_axis_align: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Padding {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeAppearance {
    pub fills: Vec<FillInfo>,
    pub strokes: Vec<StrokeInfo>,
    pub border_radius: Option<BorderRadiusInfo>,
    pub effects: Vec<EffectInfo>,
    pub opacity: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FillInfo {
    pub fill_type: String,
    pub color: Option<String>,
    pub opacity: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StrokeInfo {
    pub color: Option<String>,
    pub weight: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BorderRadiusInfo {
    pub top_left: f64,
    pub top_right: f64,
    pub bottom_right: f64,
    pub bottom_left: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EffectInfo {
    pub effect_type: String,
    pub radius: f64,
    pub color: Option<String>,
    pub offset_x: f64,
    pub offset_y: f64,
    pub spread: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NodeTypography {
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: f64,
    pub line_height: Option<f64>,
    pub letter_spacing: Option<f64>,
    pub text_align: Option<String>,
    pub text_content: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChildNodeSummary {
    pub id: String,
    pub name: String,
    pub node_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub figma_url: Option<String>,
    pub local_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
