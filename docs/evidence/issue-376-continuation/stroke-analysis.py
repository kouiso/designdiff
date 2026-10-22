import argparse
import hashlib
import json
import platform
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, __version__ as pillow_version


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def checked_path(directory, name):
    if not isinstance(name, str) or not name:
        raise ValueError("Fixture filename must not be empty")
    path = (directory / name).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise ValueError("Fixture filename escapes its pair directory")
    return path


def pixels(path):
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.int16)


def checked_roi(image, box):
    x, y, width, height = box
    if any(not isinstance(value, int) for value in box):
        raise ValueError("Pixel ROI must contain integer coordinates")
    if not (0 <= x < x + width <= image.shape[1] and 0 <= y < y + height <= image.shape[0]):
        raise ValueError("Pixel ROI must be nonempty and inside the image")
    return image[y:y + height, x:x + width]


def translation(design, screenshot, box, max_dx=5, max_dy=5):
    reference = checked_roi(design, box)
    x, y, width, height = box
    candidates = []
    for dy in range(-max_dy, max_dy + 1):
        for dx in range(-max_dx, max_dx + 1):
            shifted = [x + dx, y + dy, width, height]
            if not (0 <= shifted[0] and shifted[0] + width <= screenshot.shape[1]
                    and 0 <= shifted[1] and shifted[1] + height <= screenshot.shape[0]):
                continue
            error = np.abs(reference - checked_roi(screenshot, shifted)).mean()
            candidates.append({"dx": dx, "dy": dy, "meanAbsoluteChannelError": float(error)})
    if not candidates:
        raise ValueError("No in-bounds translation candidates")
    ordered = sorted(candidates, key=lambda entry: (
        entry["meanAbsoluteChannelError"], abs(entry["dx"]) + abs(entry["dy"])))
    return {
        "designRoi": box,
        "search": {"maxDx": max_dx, "maxDy": max_dy, "step": 1},
        "best": ordered[0],
        "nextTwo": ordered[1:3],
        "unshifted": next(entry for entry in candidates if entry["dx"] == entry["dy"] == 0),
    }


def mask_measurement(mask, origin):
    yy, xx = np.nonzero(mask)
    if len(xx) == 0:
        return {"pixelCount": 0, "bboxInclusive": None, "rowBandsInclusive": []}
    x, y = origin
    active_rows = np.flatnonzero(mask.sum(axis=1))
    bands = []
    first = previous = int(active_rows[0])
    for row in active_rows[1:]:
        if row != previous + 1:
            bands.append([first + y, previous + y])
            first = int(row)
        previous = int(row)
    bands.append([first + y, previous + y])
    return {
        "pixelCount": len(xx),
        "bboxInclusive": [int(xx.min()) + x, int(yy.min()) + y,
                          int(xx.max()) + x, int(yy.max()) + y],
        "centroid": [float(xx.mean()) + x, float(yy.mean()) + y],
        "rowBandsInclusive": bands,
    }


def dark_gray_measurement(image, box):
    region = checked_roi(image, box)
    mask = (region.max(axis=2) < 180) & (np.ptp(region, axis=2) < 5)
    return mask_measurement(mask, box[:2])


def green_mask(region):
    return (region[:, :, 0] < 100) & (region[:, :, 1] > 130) & (region[:, :, 2] < 180)


def token_measurement(design, screenshot, box):
    measurements = []
    for image in [design, screenshot]:
        region = checked_roi(image, box)
        gray = (np.ptp(region, axis=2) <= 3) & (region.max(axis=2) <= 230)
        measurements.append({
            "green": mask_measurement(green_mask(region), box[:2]),
            "grayNonbackground": mask_measurement(gray, box[:2]),
        })
    return {"roi": box, "design": measurements[0], "screenshot": measurements[1]}


def gray_ink(image, box, background, foreground):
    if not 0 <= foreground < background <= 255:
        raise ValueError("Independent gray-axis endpoints must be ordered bytes")
    region = checked_roi(image, box).astype(np.float64)
    # グレー軸への射影を独立に計算し、窓境界の墨量と計算誤りを区別する。
    alpha = np.clip((background - region.mean(axis=2)) / (background - foreground), 0, 1)
    return float(alpha.sum())


def ink_window_measurements(design, screenshot, bbox, foreground, background=255):
    x, y, width, height = bbox
    rows = []
    for halo in [2, 4, 6, 8, 12]:
        left, top = max(0, x - halo), max(0, y - halo)
        right, bottom = min(design.shape[1], x + width + halo), min(design.shape[0], y + height + halo)
        box = [left, top, right - left, bottom - top]
        a, b = (gray_ink(image, box, background, foreground) for image in [design, screenshot])
        rows.append({"halo": halo, "roi": box, "designInk": a, "screenshotInk": b,
                     "delta": abs(a - b) / max(a, b, 1e-9)})
    return {"bbox": bbox, "background": background, "foreground": foreground, "halos": rows}


def symmetric_stem_counterexample():
    thin = np.zeros((64, 64), dtype=np.uint8)
    thick = np.zeros_like(thin)
    thin[20:40, 30:33] = 1
    thick[20:40, 29:34] = 1

    def centers(mask):
        result = []
        for y in range(20, 40):
            xs = np.flatnonzero(mask[y])
            result.append((float(xs.mean()), y))
        return result

    thin_centers, thick_centers = centers(thin), centers(thick)
    assert thin_centers == thick_centers == [(31.0, y) for y in range(20, 40)]
    assert int(thin.sum()) == 60 and int(thick.sum()) == 100
    assert all(thick[y, int(x)] for x, y in thin_centers)
    assert all(thin[y, int(x)] for x, y in thick_centers)
    return {
        "construction": "Centered opaque stems: 3x20 versus 5x20 pixels; no image/font/API used.",
        "inkPixels": [int(thin.sum()), int(thick.sum())],
        "relativeInkDelta": 0.4,
        "horizontalMedialRidgeX": [31, 31],
        "rowCenterAgreement": True,
        "bidirectionalSkeletonContainment": True,
        "conclusion": "Symmetric thickening preserves stem centers and medial ridges. Skeleton agreement or containment alone cannot certify that a weight change did not occur. Keep existing ink/weight guards.",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[3]
    historical_path = repo / "docs/evidence/issue-376-baseline/summary.json"
    diagnostics_path = repo / "docs/evidence/issue-376-cloud/stroke-diagnostics.json"
    historical = json.loads(historical_path.read_text())
    diagnostics = json.loads(diagnostics_path.read_text())
    selections = [entry for entry in historical["cases"]
                  if int(entry["pair"].split("-")[1]) in {15, 18, 19, 22, 23}
                  and (entry["variant"] == "correct" or
                       (entry["pair"].startswith("pair-15-") and entry["variant"] == "drift-1px"))]
    assert len(selections) == 6
    cases = []
    for entry in selections:
        directory = args.fixtures / entry["pair"]
        manifest_path = directory / "expected.json"
        manifest = json.loads(manifest_path.read_text())
        variant = next(item for item in manifest["variants"] if item["name"] == entry["variant"])
        design_path = checked_path(directory, manifest["figmaFrame"])
        screenshot_path = checked_path(directory, variant["image"])
        hashes = {"design": sha256(design_path.read_bytes()), "screenshot": sha256(screenshot_path.read_bytes())}
        assert hashes == entry["inputHashes"], "Historical pixels changed"
        assert variant["expectedVerdict"] == entry["declaredExpectedVerdict"], "Fixture label changed"
        design, screenshot = pixels(design_path), pixels(screenshot_path)
        assert design.shape == screenshot.shape == (692, 390, 3)
        prior = next(item for item in diagnostics["cases"]
                     if item["pair"] == entry["pair"] and item["variant"] == entry["variant"])
        assert hashes == prior["inputHashes"]
        number = int(entry["pair"].split("-")[1])
        result = {
            "pair": entry["pair"], "variant": entry["variant"],
            "declaredExpectedVerdict": variant["expectedVerdict"], "inputHashes": hashes,
            "manifestSha256": sha256(manifest_path.read_bytes()),
            "nativeDimensions": {"width": 390, "height": 692},
            "priorClassifierStages": prior["summary"]["finalStages"],
        }
        if number in {15, 23}:
            result["headerAvatar"] = translation(design, screenshot, [316, 56, 40, 40], 2, 60)
            result["navigation"] = translation(design, screenshot, [10, 620, 370, 60], 2, 20)
            assert result["headerAvatar"]["best"]["dy"] == -56
            result["classification"] = "Canonical pixel placement differs: header upward56px, navigation approximately fixed. Placeholder ink difference is measured correctly but cannot establish font weight versus rasterizer cause."
            box = [151, 574, 5, 4] if entry["variant"] == "drift-1px" else [134 if number == 15 else 137, 569, 8, 8]
            result["placeholderInk"] = ink_window_measurements(design, screenshot, box, 177)
        elif number == 18:
            regions = {
                "logo": [115, 170, 160, 190],
                "title": [65, 425, 260, 45],
                "body": [50, 475, 290, 57],
                "explanation": [82, 550, 268, 40],
            }
            result["regions"] = {name: {
                "translation": translation(design, screenshot, box),
                "designDarkGray": dark_gray_measurement(design, box),
                "screenshotDarkGray": dark_gray_measurement(screenshot, box),
            } for name, box in regions.items()}
            assert result["regions"]["logo"]["translation"]["best"]["dy"] == 0
            assert result["regions"]["title"]["translation"]["best"]["dy"] == 2
            result["explanationFragmentInk"] = ink_window_measurements(design, screenshot, [137, 573, 20, 11], 136)
            result["fullExplanationInk"] = ink_window_measurements(design, screenshot, [85, 554, 264, 35], 136)
            result["classification"] = "Mixed pixel rendering/placement: logo stays at0px, title best at+2px; explanation has+2/+3 row shifts and changed line widths. Font metrics, source layout and rasterizer responsibility cannot be inferred from these PNGs alone. Ink mass is window dependent; no calculation error or safe weight classifier follows."
        elif number == 19:
            result["searchIcon"] = token_measurement(design, screenshot, [32, 115, 30, 40])
            result["fourthRowIcon"] = token_measurement(design, screenshot, [35, 350, 36, 50])
            first_glyph = checked_roi(screenshot, [49, 192, 7, 14])
            fourth_glyph = checked_roi(screenshot, [49, 366, 7, 14])
            assert np.array_equal(first_glyph, fourth_glyph)
            assert result["searchIcon"]["design"]["green"]["pixelCount"] == 0
            assert result["searchIcon"]["screenshot"]["green"]["pixelCount"] > 100
            assert result["fourthRowIcon"]["design"]["green"]["pixelCount"] == 0
            assert result["fourthRowIcon"]["screenshot"]["green"]["pixelCount"] == 59
            result["fourthRowSymbolCorroboration"] = {
                "visualInspection": "Design fourth row has a gray outlined speech bubble; screenshot fourth row has a green horse emblem like the first row.",
                "screenshotFirstGlyphRoi": [49, 192, 7, 14],
                "screenshotFourthGlyphRoi": [49, 366, 7, 14],
                "exactRgbArrayEquality": True,
                "firstGlyphRgbSha256": sha256(first_glyph.astype(np.uint8).tobytes()),
                "fourthGlyphRgbSha256": sha256(fourth_glyph.astype(np.uint8).tobytes()),
            }
            result["classification"] = "Genuine canonical content/token differences: search icon gray-to-green and fourth row symbol replacement. A same-stem rasterization classifier must not explain these away."
        else:
            reference = repo / "docs/evidence/issue-376-cloud/pair-22-geometry.json"
            reference_data = json.loads(reference.read_text())
            assert reference_data["inputHashes"] == hashes
            result["existingIndependentEvidence"] = {
                "path": str(reference.relative_to(repo)), "sha256": sha256(reference.read_bytes()),
                "inputBorderVerticalShifts": reference_data["inputBorderVerticalShifts"],
                "keyboardBestTranslation": reference_data["keyboardRoiTranslation"]["best"],
            }
            result["classification"] = "Genuine canonical placement difference: top input borders move upward56px while keyboard remains fixed; label needs specification review."
        for measurement in list(result.values()):
            if not isinstance(measurement, dict) or "halos" not in measurement:
                continue
            previous = next((sample for sample in prior["finalStageExamples"].get("ink", [])
                             if [sample["bbox"][key] for key in ["x", "y", "w", "h"]]
                             == measurement["bbox"]), None)
            if previous is not None:
                independent = measurement["halos"][-1]
                observed = previous["ink"]
                errors = {
                    "designInk": abs(independent["designInk"] - observed["design"]),
                    "screenshotInk": abs(independent["screenshotInk"] - observed["screenshot"]),
                    "delta": abs(independent["delta"] - observed["delta"]),
                }
                assert max(errors.values()) < 1e-9, "Independent gray arithmetic disagrees with trace"
                measurement["priorClassifierFinalInk"] = observed
                measurement["independentArithmeticAbsoluteError"] = errors
        cases.append(result)
    document = {
        "scope": "Independent native RGB/gray-mask arithmetic and constructed stem counterexample; FigDiff status is never the correctness oracle. No actual images are copied or written. Pixel samples stay in memory.",
        "sourceCommit": subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip(),
        "scriptSha256AtExecution": sha256(Path(__file__).read_bytes()),
        "inputs": {"historicalInventorySha256": sha256(historical_path.read_bytes()),
                   "previousClassifierDiagnosticsSha256": sha256(diagnostics_path.read_bytes())},
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "pillow": pillow_version},
        "grayMaskDefinition": {"maximumChannelExclusive": 180, "channelSpanExclusive": 5},
        "greenMaskDefinition": {"redExclusiveMaximum": 100, "greenExclusiveMinimum": 130, "blueExclusiveMaximum": 180},
        "interpretationLimits": [
            "Different canonical pixel positions establish a visual mismatch; they do not identify whether source layout, font metrics or rendering caused it.",
            "Local ink mass varies with window clipping, glyph advance and neighboring text. No threshold is changed and no additional tolerance is inferred here.",
            "Sampled gray-axis endpoints come from prior diagnostic estimates. Independent sum agreement checks arithmetic only, not whether the font weight or rendering difference should be accepted.",
            "Issue376 was read at2026-10-22 and remains its originalOct10 text: it proposes stem-center displacement as a weight discriminator. Symmetric thickening is a counterexample to that premise.",
        ],
        "issueReference": {"url": "https://github.com/kouiso/designdiff/issues/376",
                           "updatedAt": "2026-10-10T04:38:31Z"},
        "symmetricStemCounterexample": symmetric_stem_counterexample(),
        "cases": cases,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, indent=2) + "\n")
    print(json.dumps({"cases": len(cases), "output": str(args.output), "productEdits": False}))


if __name__ == "__main__":
    main()
