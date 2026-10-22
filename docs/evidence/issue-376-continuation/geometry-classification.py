import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
from PIL import Image, __version__ as pillow_version


FIXTURE_COMMIT = "ea13c68354412868f46b808a5069b707481293a4"


def read_image(path):
    with Image.open(path) as image:
        rgba = np.array(image.convert("RGBA"))
    if not np.all(rgba[:, :, 3] == 255):
        raise ValueError(f"Opaque input required: {path}")
    return rgba


def mask_for(pixels, detector):
    rgb = pixels[:, :, :3].astype(np.int16)
    if detector["kind"] == "exact-rgb":
        return np.all(rgb == detector["rgb"], axis=2)
    if detector["kind"] == "green-chroma":
        return (
            (rgb[:, :, 0] < detector["redLessThan"])
            & (rgb[:, :, 1] > detector["greenGreaterThan"])
            & (rgb[:, :, 2] < detector["blueLessThan"])
        )
    raise ValueError("Unknown detector")


def bbox(pixels, roi, detector):
    left, top, right, bottom = roi
    if not (0 <= left < right <= pixels.shape[1] and 0 <= top < bottom <= pixels.shape[0]):
        raise ValueError("ROI must remain inside native image")
    mask = mask_for(pixels, detector)[top:bottom, left:right]
    y, x = np.where(mask)
    if len(x) == 0:
        raise ValueError("Detector found no landmark pixels")
    result = {
        "left": int(x.min() + left),
        "top": int(y.min() + top),
        "rightExclusive": int(x.max() + left + 1),
        "bottomExclusive": int(y.max() + top + 1),
        "selectedPixels": len(x),
    }
    result["centerX"] = (result["left"] + result["rightExclusive"]) / 2
    result["centerY"] = (result["top"] + result["bottomExclusive"]) / 2
    result["width"] = result["rightExclusive"] - result["left"]
    result["height"] = result["bottomExclusive"] - result["top"]
    return result


def compare_landmark(design, screenshot, name, roi, detector, interpretation):
    reference = bbox(design, roi, detector)
    actual = bbox(screenshot, roi, detector)
    return {
        "name": name,
        "roi": roi,
        "detector": detector,
        "design": reference,
        "screenshot": actual,
        "delta": {
            key: actual[key] - reference[key]
            for key in ["left", "top", "rightExclusive", "bottomExclusive", "centerX", "centerY", "width", "height"]
        },
        "interpretation": interpretation,
    }


def card_dividers(pixels):
    rgb = pixels[:, :, :3]
    neutral = (
        (rgb[:, :, 0] == rgb[:, :, 1])
        & (rgb[:, :, 1] == rgb[:, :, 2])
        & (rgb[:, :, 0] >= 230)
        & (rgb[:, :, 0] <= 245)
    )
    return [
        {"y": y, "selectedPixels": int(neutral[y, 60:355].sum())}
        for y in range(210, 503)
        if neutral[y, 60:355].sum() > 250
    ]


def dominant_icon_core(pixels):
    rgb = pixels[315:380, 20:100, :3].astype(np.int16)
    green = (rgb[:, :, 1] - rgb[:, :, 0] > 30) & (rgb[:, :, 1] - rgb[:, :, 2] > 20)
    color, count = Counter(map(tuple, rgb[green])).most_common(1)[0]
    return {"rgb": [int(value) for value in color], "selectedPixels": count}


def inspect_case(directory, variant_name, historical_cases):
    manifest_path = directory / "expected.json"
    manifest = json.loads(manifest_path.read_text())
    variant = next(entry for entry in manifest["variants"] if entry["name"] == variant_name)
    design_path = directory / manifest["figmaFrame"]
    screenshot_path = directory / variant["image"]
    design = read_image(design_path)
    screenshot = read_image(screenshot_path)
    if design.shape != screenshot.shape:
        raise ValueError("Native dimensions differ; this script does not resize")
    input_hashes = {
        "design": hashlib.sha256(design_path.read_bytes()).hexdigest(),
        "screenshot": hashlib.sha256(screenshot_path.read_bytes()).hexdigest(),
    }
    historical = next(
        entry for entry in historical_cases
        if entry["pair"] == directory.name and entry["variant"] == variant_name
    )
    if input_hashes != historical["inputHashes"]:
        raise ValueError("Source bytes differ from the historical PR375 fixture hashes")
    pair_number = directory.name.split("-")[1]
    observations = []
    pale = {"kind": "exact-rgb", "rgb": [235, 248, 240]}
    green = {"kind": "green-chroma", "redLessThan": 100, "greenGreaterThan": 150, "blueLessThan": 180}
    notes = []
    if pair_number == "07":
        for index, roi in enumerate([[20, 315, 100, 380], [20, 390, 100, 450], [20, 465, 100, 520]]):
            observations.append(compare_landmark(
                design, screenshot, f"row-{index + 1}-icon-background", roi, pale,
                "Large nonfont icon-background displacement. Exact-color boundary AA may move one edge by about 1 px; it cannot explain the measured several-pixel horizontal shifts.",
            ))
        observations.append(compare_landmark(
            design, screenshot, "primary-button-center-row", [0, 581, 390, 582], green,
            "At the same middle row, both 350 px-wide button spans differ by several pixels horizontally. This is a fill-boundary position difference, independent of label glyphs.",
        ))
        notes.append({"kind": "flat-icon-core-color-difference", "roi": [20, 315, 100, 380],
                      "design": dominant_icon_core(design), "screenshot": dominant_icon_core(screenshot),
                      "interpretation": "Large runs of solid green icon pixels use different RGB values. Rasterizer/color-management/token intent cannot be certified from two PNGs."})
    elif pair_number == "08":
        observations.append(compare_landmark(
            design, screenshot, "loading-bubble-white-interior", [55, 475, 290, 535],
            {"kind": "exact-rgb", "rgb": [255, 255, 255]},
            "The white bubble right edge expands 14 px while its left edge stays fixed. About 1 px edge-AA uncertainty cannot explain the width difference. Its top/bottom differ 1/3 px; shadows and AA limit exact vertical-boundary attribution.",
        ))
    elif pair_number == "09":
        observations.append(compare_landmark(
            design, screenshot, "new-chat-pale-fill", [0, 55, 310, 170], pale,
            "Same nonfont filled component moves upward 56 px with unchanged height/width; drift1 also adds 1 px horizontally.",
        ))
        observations.append(compare_landmark(
            design, screenshot, "selected-history-item-fill", [0, 140, 310, 260],
            {"kind": "exact-rgb", "rgb": [232, 245, 238]},
            "A separate nonfont filled component independently moves upward 56 px. This is not a glyph-stroke explanation.",
        ))
        observations.append(compare_landmark(
            design, screenshot, "drawer-white-span-at-row 600", [0, 600, 313, 601],
            {"kind": "exact-rgb", "rgb": [255, 255, 255]},
            "The drawer shell remains at the native row 600 while content components shift upward 56 px. Measurements establish literal PNG placement; intended status-bar/capture semantics require separate evidence.",
        ))
    elif pair_number == "11":
        observations.append(compare_landmark(
            design, screenshot, "toast-green-status-circle", [100, 495, 150, 530],
            {"kind": "green-chroma", "redLessThan": 50, "greenGreaterThan": 150, "blueLessThan": 150},
            "The nonfont green circle center moves 4.5 px left; width differs 1 px due to shape/AA/color. Every sampled interior circle row corroborates a 4–5 px horizontal move.",
        ))
        observations.append(compare_landmark(
            design, screenshot, "toast-dark-capsule", [80, 493, 305, 535],
            {"kind": "exact-rgb", "rgb": [51, 51, 51]},
            "The enclosing capsule changes its right edge by 1 px, center by 0.5 px. Circle movement relative to this capsule is 4 px and cannot be explained by a whole-toast translation.",
        ))
        reference_rows = card_dividers(design)
        actual_rows = card_dividers(screenshot)
        if len(reference_rows) != 4 or len(actual_rows) != 4:
            raise ValueError("Expected card top edge and three interior dividers")
        notes.append({"kind": "card-divider-rows", "roi": [60, 210, 355, 503],
                      "detector": "neutralRGB230..245; more than 250 selected pixels per row",
                      "design": reference_rows, "screenshot": actual_rows,
                      "verticalShifts": [actual["y"] - reference["y"] for reference, actual in zip(reference_rows, actual_rows)],
                      "interpretation": "These lines differ by at most 1 px. This measurement alone cannot establish a greater-than 1 px card-layout defect; per-edge AA and rounding remain plausible."})
    else:
        raise ValueError("Specimen outside assigned scope")
    derived_control = None
    if variant_name == "drift-1px":
        correct_variant = next(entry for entry in manifest["variants"] if entry["name"] == "correct")
        correct_path = directory / correct_variant["image"]
        correct = read_image(correct_path)
        exact_shift = bool(np.array_equal(correct[:, :-1], screenshot[:, 1:]))
        exact_edge = bool(np.array_equal(correct[:, 0], screenshot[:, 0]))
        if not (exact_shift and exact_edge):
            raise ValueError("Declared drift1 is not the exact right 1 px edge-replicated control")
        derived_control = {
            "correctScreenshotSha256": hashlib.sha256(correct_path.read_bytes()).hexdigest(),
            "exactRgbaRightShiftPx": 1,
            "allInteriorRgbaBytesMatch": exact_shift,
            "leftEdgeReplicationMatches": exact_edge,
            "interpretation": "This adds exactly 1 px to the already mismatched correct image; larger geometry differences remain present.",
        }
    if not any(
        abs(entry["delta"][key]) > 1
        for entry in observations for key in ["centerX", "centerY", "width", "height"]
    ):
        raise ValueError("No greater-than-1-px nonfont geometry difference established")
    return {
        "pair": directory.name, "variant": variant_name,
        "fixtureSourceCommit": FIXTURE_COMMIT,
        "declaredExpectedVerdict": variant["expectedVerdict"],
        "nativeDimensions": {"width": design.shape[1], "height": design.shape[0]},
        "inputHashes": input_hashes,
        "manifestSha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "classification": {"actualPlacementDifference": "proven by nonfont landmarks",
                           "strokeOrRenderingDifference": "visible raster/shape/color differences; same-glyph AA versus weight/font/token substitution is not certified",
                           "insufficientEvidence": ["Paired source font files, actual implementation layout metrics and renderer settings are unavailable; nominal design styles alone cannot establish the cause.",
                                                    "Developer intent and the historical PASS label are not independent correctness evidence."],
                           "confidence": "high for greater-than 1 px nonfont placement/size differences; limited for glyph/AA cause"},
        "landmarks": observations, "additionalPixelEvidence": notes,
        "derivedControl": derived_control,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fixture_root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assigned = [("07", "correct"), ("07", "drift-1px"), ("08", "correct"),
                ("09", "correct"), ("09", "drift-1px"), ("11", "correct")]
    baseline = Path(__file__).resolve().parent.parent / "issue-376-baseline" / "summary.json"
    historical_cases = json.loads(baseline.read_text())["cases"]
    cases = []
    for number, variant in assigned:
        directories = list(args.fixture_root.glob(f"pair-{number}-hm-gate1-*"))
        if len(directories) != 1:
            raise ValueError(f"Expected exactly one raw fixture for pair{number}")
        cases.append(inspect_case(directories[0], variant, historical_cases))
    result = {
        "scope": "Six assigned historical declared-PASS cases. Independent native opaque RGB/RGBA measurements; no product score/status/classifier used. No real image copies or uploads, no resize, no PASS relabeling.",
        "coordinateConvention": "Native pixels, zero based; right/bottom exclusive. ROIs isolate known nonfont landmarks. Color thresholds select feature pixels and are not product acceptance tolerances.",
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "pillow": pillow_version},
        "cases": cases,
        "remainingAcceptanceQuestion": "These cases contain measured geometry differences despite historical PASS labels. Decide capture/viewport and geometry intent separately; none should become PASS merely by increasing stroke tolerance.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"cases": len(cases), "independentGeometryEvidence": True}))


if __name__ == "__main__":
    main()
