use crate::figma::types::*;

/// Transform a Figma node into a NodeInspection for the frontend.
pub fn transform_node(node: &FigmaNode) -> NodeInspection {
    let bbox = node.absolute_bounding_box.as_ref();
    let layout = NodeLayout {
        x: bbox.map_or(0.0, |b| b.x),
        y: bbox.map_or(0.0, |b| b.y),
        width: bbox.map_or(0.0, |b| b.width),
        height: bbox.map_or(0.0, |b| b.height),
        padding: extract_padding(node),
        gap: node.item_spacing,
        layout_mode: node.layout_mode.clone(),
        primary_axis_align: node.primary_axis_align_items.clone(),
        counter_axis_align: node.counter_axis_align_items.clone(),
    };

    let appearance = NodeAppearance {
        fills: node
            .fills
            .iter()
            .filter(|f| f.visible.unwrap_or(true))
            .map(|f| FillInfo {
                fill_type: f.paint_type.clone(),
                color: f.color.as_ref().map(|c| figma_color_to_hex(c)),
                opacity: f.opacity.unwrap_or(1.0),
            })
            .collect(),
        strokes: node
            .strokes
            .iter()
            .filter(|s| s.visible.unwrap_or(true))
            .map(|s| StrokeInfo {
                color: s.color.as_ref().map(|c| figma_color_to_hex(c)),
                weight: node.stroke_weight.unwrap_or(0.0),
            })
            .collect(),
        border_radius: extract_border_radius(node),
        effects: node
            .effects
            .iter()
            .filter(|e| e.visible.unwrap_or(true))
            .map(|e| {
                let offset = e.offset.as_ref();
                EffectInfo {
                    effect_type: e.effect_type.clone(),
                    radius: e.radius.unwrap_or(0.0),
                    color: e.color.as_ref().map(|c| figma_color_to_hex(c)),
                    offset_x: offset.map_or(0.0, |o| o.x),
                    offset_y: offset.map_or(0.0, |o| o.y),
                    spread: e.spread.unwrap_or(0.0),
                }
            })
            .collect(),
        opacity: node.opacity.unwrap_or(1.0),
    };

    let typography = extract_typography(node);

    let children: Vec<ChildNodeSummary> = node
        .children
        .iter()
        .map(|c| ChildNodeSummary {
            id: c.id.clone(),
            name: c.name.clone(),
            node_type: c.node_type.clone(),
        })
        .collect();

    let css_suggestion = generate_css_suggestion(&layout, &appearance, &typography);

    NodeInspection {
        id: node.id.clone(),
        name: node.name.clone(),
        node_type: node.node_type.clone(),
        layout,
        appearance,
        typography,
        children,
        css_suggestion,
    }
}

fn extract_padding(node: &FigmaNode) -> Option<Padding> {
    let top = node.padding_top?;
    Some(Padding {
        top,
        right: node.padding_right.unwrap_or(0.0),
        bottom: node.padding_bottom.unwrap_or(0.0),
        left: node.padding_left.unwrap_or(0.0),
    })
}

fn extract_border_radius(node: &FigmaNode) -> Option<BorderRadiusInfo> {
    if let Some(radii) = &node.rectangle_corner_radii {
        Some(BorderRadiusInfo {
            top_left: radii[0],
            top_right: radii[1],
            bottom_right: radii[2],
            bottom_left: radii[3],
        })
    } else {
        node.corner_radius.map(|r| BorderRadiusInfo {
            top_left: r,
            top_right: r,
            bottom_right: r,
            bottom_left: r,
        })
    }
}

fn extract_typography(node: &FigmaNode) -> Option<NodeTypography> {
    let style = node.style.as_ref()?;
    Some(NodeTypography {
        font_family: style.font_family.clone().unwrap_or_default(),
        font_size: style.font_size.unwrap_or(0.0),
        font_weight: style.font_weight.unwrap_or(400.0),
        line_height: style.line_height_px,
        letter_spacing: style.letter_spacing,
        text_align: style.text_align_horizontal.clone(),
        text_content: node.characters.clone(),
    })
}

fn figma_color_to_hex(color: &FigmaColor) -> String {
    let r = (color.r * 255.0).round() as u8;
    let g = (color.g * 255.0).round() as u8;
    let b = (color.b * 255.0).round() as u8;
    if (color.a - 1.0).abs() < f64::EPSILON {
        format!("#{:02X}{:02X}{:02X}", r, g, b)
    } else {
        let a = (color.a * 255.0).round() as u8;
        format!("#{:02X}{:02X}{:02X}{:02X}", r, g, b, a)
    }
}

pub fn generate_css_suggestion(
    layout: &NodeLayout,
    appearance: &NodeAppearance,
    typography: &Option<NodeTypography>,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Size
    parts.push(format!("width: {}px;", layout.width));
    parts.push(format!("height: {}px;", layout.height));

    // Layout mode (flex)
    if let Some(ref mode) = layout.layout_mode {
        match mode.as_str() {
            "HORIZONTAL" => parts.push("display: flex; flex-direction: row;".to_string()),
            "VERTICAL" => parts.push("display: flex; flex-direction: column;".to_string()),
            _ => {}
        }
    }

    // Padding
    if let Some(ref p) = layout.padding {
        if (p.top - p.right).abs() < 0.01
            && (p.right - p.bottom).abs() < 0.01
            && (p.bottom - p.left).abs() < 0.01
        {
            parts.push(format!("padding: {}px;", p.top));
        } else {
            parts.push(format!(
                "padding: {}px {}px {}px {}px;",
                p.top, p.right, p.bottom, p.left
            ));
        }
    }

    // Gap
    if let Some(gap) = layout.gap {
        if gap > 0.0 {
            parts.push(format!("gap: {}px;", gap));
        }
    }

    // Background
    if let Some(fill) = appearance.fills.first() {
        if let Some(ref color) = fill.color {
            parts.push(format!("background-color: {};", color));
        }
    }

    // Border
    if let Some(stroke) = appearance.strokes.first() {
        if let Some(ref color) = stroke.color {
            parts.push(format!("border: {}px solid {};", stroke.weight, color));
        }
    }

    // Border radius
    if let Some(ref br) = appearance.border_radius {
        if (br.top_left - br.top_right).abs() < 0.01
            && (br.top_right - br.bottom_right).abs() < 0.01
            && (br.bottom_right - br.bottom_left).abs() < 0.01
        {
            parts.push(format!("border-radius: {}px;", br.top_left));
        } else {
            parts.push(format!(
                "border-radius: {}px {}px {}px {}px;",
                br.top_left, br.top_right, br.bottom_right, br.bottom_left
            ));
        }
    }

    // Box shadow
    for effect in &appearance.effects {
        if effect.effect_type == "DROP_SHADOW" {
            let color = effect.color.as_deref().unwrap_or("rgba(0,0,0,0.25)");
            parts.push(format!(
                "box-shadow: {}px {}px {}px {}px {};",
                effect.offset_x, effect.offset_y, effect.radius, effect.spread, color
            ));
        }
    }

    // Opacity
    if (appearance.opacity - 1.0).abs() > 0.01 {
        parts.push(format!("opacity: {};", appearance.opacity));
    }

    // Typography
    if let Some(ref t) = typography {
        parts.push(format!("font-family: \"{}\";", t.font_family));
        parts.push(format!("font-size: {}px;", t.font_size));
        parts.push(format!("font-weight: {};", t.font_weight));
        if let Some(lh) = t.line_height {
            parts.push(format!("line-height: {}px;", lh));
        }
        if let Some(ls) = t.letter_spacing {
            if ls.abs() > 0.01 {
                parts.push(format!("letter-spacing: {}px;", ls));
            }
        }
        if let Some(ref align) = t.text_align {
            parts.push(format!("text-align: {};", align.to_lowercase()));
        }
    }

    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_figma_color_to_hex_opaque() {
        let color = FigmaColor {
            r: 1.0,
            g: 0.341,
            b: 0.2,
            a: 1.0,
        };
        assert_eq!(figma_color_to_hex(&color), "#FF5733");
    }

    #[test]
    fn test_figma_color_to_hex_with_alpha() {
        let color = FigmaColor {
            r: 0.0,
            g: 0.0,
            b: 0.0,
            a: 0.5,
        };
        assert_eq!(figma_color_to_hex(&color), "#00000080");
    }

    #[test]
    fn test_generate_css_with_padding_and_gap() {
        let layout = NodeLayout {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 100.0,
            padding: Some(Padding {
                top: 16.0,
                right: 16.0,
                bottom: 16.0,
                left: 16.0,
            }),
            gap: Some(8.0),
            layout_mode: None,
            primary_axis_align: None,
            counter_axis_align: None,
        };
        let appearance = empty_appearance();
        let css = generate_css_suggestion(&layout, &appearance, &None);
        assert!(css.contains("padding: 16px;"));
        assert!(css.contains("gap: 8px;"));
    }

    #[test]
    fn test_generate_css_with_background() {
        let layout = default_layout();
        let mut appearance = empty_appearance();
        appearance.fills.push(FillInfo {
            fill_type: "SOLID".to_string(),
            color: Some("#FF5733".to_string()),
            opacity: 1.0,
        });
        let css = generate_css_suggestion(&layout, &appearance, &None);
        assert!(css.contains("background-color: #FF5733;"));
    }

    #[test]
    fn test_generate_css_with_border_radius() {
        let layout = default_layout();
        let mut appearance = empty_appearance();
        appearance.border_radius = Some(BorderRadiusInfo {
            top_left: 8.0,
            top_right: 8.0,
            bottom_right: 8.0,
            bottom_left: 8.0,
        });
        let css = generate_css_suggestion(&layout, &appearance, &None);
        assert!(css.contains("border-radius: 8px;"));
    }

    #[test]
    fn test_generate_css_with_typography() {
        let layout = default_layout();
        let appearance = empty_appearance();
        let typography = Some(NodeTypography {
            font_family: "Inter".to_string(),
            font_size: 14.0,
            font_weight: 700.0,
            line_height: None,
            letter_spacing: None,
            text_align: None,
            text_content: None,
        });
        let css = generate_css_suggestion(&layout, &appearance, &typography);
        assert!(css.contains("font-family: \"Inter\";"));
        assert!(css.contains("font-size: 14px;"));
        assert!(css.contains("font-weight: 700;"));
    }

    #[test]
    fn test_generate_css_combined() {
        let layout = NodeLayout {
            x: 0.0,
            y: 0.0,
            width: 300.0,
            height: 200.0,
            padding: Some(Padding {
                top: 16.0,
                right: 16.0,
                bottom: 16.0,
                left: 16.0,
            }),
            gap: Some(8.0),
            layout_mode: Some("VERTICAL".to_string()),
            primary_axis_align: None,
            counter_axis_align: None,
        };
        let mut appearance = empty_appearance();
        appearance.fills.push(FillInfo {
            fill_type: "SOLID".to_string(),
            color: Some("#FFFFFF".to_string()),
            opacity: 1.0,
        });
        appearance.border_radius = Some(BorderRadiusInfo {
            top_left: 12.0,
            top_right: 12.0,
            bottom_right: 12.0,
            bottom_left: 12.0,
        });

        let css = generate_css_suggestion(&layout, &appearance, &None);
        assert!(css.contains("display: flex; flex-direction: column;"));
        assert!(css.contains("padding: 16px;"));
        assert!(css.contains("gap: 8px;"));
        assert!(css.contains("background-color: #FFFFFF;"));
        assert!(css.contains("border-radius: 12px;"));
    }

    fn default_layout() -> NodeLayout {
        NodeLayout {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 50.0,
            padding: None,
            gap: None,
            layout_mode: None,
            primary_axis_align: None,
            counter_axis_align: None,
        }
    }

    fn empty_appearance() -> NodeAppearance {
        NodeAppearance {
            fills: vec![],
            strokes: vec![],
            border_radius: None,
            effects: vec![],
            opacity: 1.0,
        }
    }
}
