import argparse
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
from PIL import Image, __version__ as pillow_version


def read_rgb(path):
    with Image.open(path) as image:
        return np.array(image.convert("RGB")).astype(np.int16)


def border_rows(pixels):
    green = (
        (pixels[:, :, 1] > 130)
        & (pixels[:, :, 0] < 100)
        & (pixels[:, :, 2] < 170)
    )
    rows = []
    for y in range(min(220, pixels.shape[0])):
        columns = np.flatnonzero(green[y])
        if len(columns) > 150:
            rows.append(
                {"y": y, "greenPixels": len(columns), "left": int(columns[0]), "right": int(columns[-1])}
            )
    return rows


def measure_translation(design, screenshot, box):
    left, top, right, bottom = box
    height, width, _ = screenshot.shape
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError("Measurement ROI must lie inside both images")
    scores = []
    for dy in range(-80, 81):
        if top + dy < 0 or bottom + dy > height:
            continue
        delta = np.abs(
            design[top:bottom, left:right]
            - screenshot[top + dy:bottom + dy, left:right]
        )
        scores.append({"dx": 0, "dy": dy, "meanAbsoluteChannelError": float(delta.mean())})
    return {
        "designRoi": {"x": left, "y": top, "width": right - left, "height": bottom - top},
        "search": {"dx": 0, "minimumDy": -80, "maximumDy": 80, "step": 1},
        "best": min(scores, key=lambda entry: entry["meanAbsoluteChannelError"]),
        "unshifted": next(entry for entry in scores if entry["dy"] == 0),
        "minus56": next(entry for entry in scores if entry["dy"] == -56),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pair_directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    manifest_path = args.pair_directory / "expected.json"
    manifest = json.loads(manifest_path.read_text())
    variant = next(entry for entry in manifest["variants"] if entry["name"] == "correct")
    paths = {
        "design": args.pair_directory / manifest["figmaFrame"],
        "screenshot": args.pair_directory / variant["image"],
    }
    design, screenshot = (read_rgb(paths[key]) for key in ("design", "screenshot"))
    if design.shape != screenshot.shape:
        raise ValueError("Native image dimensions must match; no resize is permitted")
    design_rows = border_rows(design)
    screenshot_rows = border_rows(screenshot)
    if len(design_rows) != 2 or len(screenshot_rows) != 2:
        raise ValueError("Expected exactly two long green input-border rows")
    shifts = [other["y"] - reference["y"] for reference, other in zip(design_rows, screenshot_rows)]
    input_measurement = measure_translation(design, screenshot, [16, 104, 375, 216])
    keyboard_measurement = measure_translation(design, screenshot, [0, 430, 390, 610])
    # 異なる部位に共通の平行移動が無いことを、製品分類器を使わず画素だけで確かめる。
    assert shifts == [-56, -56], shifts
    assert input_measurement["best"]["dy"] == -56, input_measurement
    assert keyboard_measurement["best"]["dy"] == 0, keyboard_measurement
    result = {
        "scope": "Independent native RGB-pixel measurement. No FigDiff score/status used as an oracle. No images copied or written.",
        "specimen": args.pair_directory.name,
        "variant": "correct",
        "declaredExpectedVerdict": variant["expectedVerdict"],
        "inputHashes": {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items()},
        "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "pillow": pillow_version},
        "nativeDimensions": {"width": int(design.shape[1]), "height": int(design.shape[0])},
        "greenBorderDetector": {"greenGreaterThan": 130, "redLessThan": 100, "blueLessThan": 170, "rowPixelCountGreaterThan": 150, "rowsBelow": 220},
        "designInputBorderRows": design_rows,
        "screenshotInputBorderRows": screenshot_rows,
        "inputBorderVerticalShifts": shifts,
        "inputRoiTranslation": input_measurement,
        "keyboardRoiTranslation": keyboard_measurement,
        "conclusion": "The top input is shifted upward 56 px while the keyboard remains fixed. A whole-frame translation cannot explain both. The declared AA/stroke-only PASS requires ground-truth review; these native pixels establish a placement difference.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"specimen": result["specimen"], "inputBorderVerticalShifts": shifts, "keyboardBestDy": keyboard_measurement["best"]["dy"]}))


if __name__ == "__main__":
    main()
