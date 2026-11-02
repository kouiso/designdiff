#!/usr/bin/env python3
"""Gate1 の保存結果を製品コード・sharp・NumPyなしで独立照合する。"""

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path

import PIL
from PIL import Image, ImageChops


THRESHOLDS = (0, 10, 20, 40, 80, 160)
MAX_PIXELS = 4_000_000
MAX_BYTES = 32 * 1024 * 1024
MAX_PNG_BYTES = 16 * 1024 * 1024


def require(condition, message):
    """監査条件の不成立を成功扱いせず、理由を付けて停止する。"""
    if not condition:
        raise ValueError(message)


def bounded_path(root, relative):
    """ソース照合がリポジトリ外のファイルへ逸脱するのを防ぐ。"""
    require(isinstance(relative, str), "Expected relative file path")
    candidate = (root / relative).resolve()
    require(candidate.is_relative_to(root), "Path escapes repository")
    return candidate


def digest(file):
    """照合対象の内容を識別し、過大な入力は監査前に拒否する。"""
    require(file.stat().st_size <= MAX_BYTES, "Input exceeds byte limit")
    return hashlib.sha256(file.read_bytes()).hexdigest()


def read_json(file):
    """重複キーによる宣言の隠蔽を許さず、監査資料を読み込む。"""
    require(file.stat().st_size <= MAX_BYTES, "JSON exceeds byte limit")
    def no_duplicate_properties(pairs):
        """後勝ちのJSON解釈で改変が見えなくなることを防ぐ。"""
        result = {}
        for key, value in pairs:
            require(key not in result, "Duplicate JSON property")
            result[key] = value
        return result

    return json.loads(
        file.read_text(encoding="utf-8"), object_pairs_hook=no_duplicate_properties
    )


def require_still_png(encoded):
    """Pillowが単一フレームへ縮退するAPNGも制御チャンクで拒否する。"""
    require(encoded.startswith(b"\x89PNG\r\n\x1a\n"), "Expected PNG signature")
    offset = 8
    while offset + 12 <= len(encoded):
        length = int.from_bytes(encoded[offset:offset + 4], "big")
        kind = encoded[offset + 4:offset + 8]
        end = offset + 12 + length
        require(end <= len(encoded), "Invalid or truncated PNG structure")
        require(
            offset != 8 or (kind == b"IHDR" and length == 13),
            "Invalid PNG header",
        )
        require(kind not in (b"acTL", b"fcTL", b"fdAT"), "Animated PNG is unsupported")
        if kind == b"IEND":
            require(length == 0 and end == len(encoded), "Invalid PNG end or trailing bytes")
            return
        offset = end
    raise ValueError("Invalid or truncated PNG structure")


def load_png(file):
    """先頭フレームの誤採用を防ぎ、同じ不透明PNGバイトをhash・画素照合に使う。"""
    with file.open("rb") as handle:
        encoded = handle.read(MAX_PNG_BYTES + 1)
    require(len(encoded) <= MAX_PNG_BYTES, "Input exceeds byte limit")
    require_still_png(encoded)
    sha256 = hashlib.sha256(encoded).hexdigest()
    with Image.open(BytesIO(encoded)) as image:
        require(image.format == "PNG", "Expected PNG")
        require(
            image.get_format_mimetype() != "image/apng"
            and getattr(image, "n_frames", 1) == 1
            and not getattr(image, "is_animated", False),
            "Animated PNG is unsupported",
        )
        width, height = image.size
        require(0 < width * height <= MAX_PIXELS, "Invalid image dimensions")
        rgba = image.convert("RGBA")
        require(rgba.getchannel("A").getextrema() == (255, 255), "Non-opaque PNG")
        return rgba.convert("RGB"), sha256


def unique_index(entries, key, label):
    """件数が同じでも重複により検体が欠落した監査資料を拒否する。"""
    index = {}
    for entry in entries:
        identity = key(entry)
        require(identity not in index, f"Duplicate {label}")
        index[identity] = entry
    return index


def audit(root, measurement_file, validation_file):
    """独立定義を固定点に、保存測定と原PNGの同一性・網羅性・生差分を照合する。"""
    measurement = read_json(measurement_file)
    validation = read_json(validation_file)
    definition_file = root / "verification/fixture/gate1-independent-oracle.json"
    definition = read_json(definition_file)
    require(measurement["definitionSha256"] == digest(definition_file), "Definition SHA256 mismatch")
    pass_pairs = definition["passPairs"]
    fail_pairs = definition["failPairs"]
    require(len(pass_pairs) == len(set(pass_pairs)) == 9, "Invalid pass coverage")
    require(len(fail_pairs) == len(set(fail_pairs)) == 9, "Invalid fail coverage")
    require(set(pass_pairs).isdisjoint(fail_pairs), "Overlapping declared groups")
    require(set(pass_pairs) | set(fail_pairs) == set(range(7, 25)), "Unexpected pair numbers")

    expected_inputs = unique_index(measurement["inputs"], lambda row: row["pairId"], "input")
    rows = unique_index(
        measurement["rows"],
        lambda row: (row["pairId"], row["variant"], row["against"]),
        "measurement row",
    )
    require(len(expected_inputs) == 18 and len(rows) == 66, "Incomplete input/row coverage")
    sources = validation["sourceSha256"]
    required_sources = {
        "verification/script/measure-gate1-oracle.mjs",
        "verification/script/measure-gate1-oracle.test.mjs",
        "verification/script/probe-gate1-overlap.mjs",
        "verification/script/probe-gate1-overlap.test.mjs",
        "verification/script/gate1-fixture.mjs",
        "verification/script/gate1-fixture.test.mjs",
        "verification/script/audit-gate1-pillow.py",
        "verification/script/audit-gate1-pillow.test.py",
        "verification/fixture/gate1-independent-oracle.json",
    }
    require(required_sources.issubset(sources), "Missing source hashes")
    for name, sha256 in sources.items():
        require(digest(bounded_path(root, name)) == sha256, "Validation source SHA256 mismatch")

    fixture_root = root / "verification/fixture"
    folders = sorted(fixture_root.glob("pair-*-hm-gate1-*"))
    require(len(folders) == 18, "Expected 18 fixture folders")
    require(
        set(definition["fixtures"]) == {folder.name for folder in folders},
        "Independent fixture definition coverage mismatch",
    )
    seen_numbers = set()
    expected_keys = set()
    expected_folder_names = set()
    null_pairs = []
    numerical_rows = 0
    ratio_checks = 0
    baseline_ratios = {"pass": [], "fail": []}
    for folder in folders:
        pair = folder.name
        expected_folder_names.add(pair)
        number = int(pair.split("-")[1])
        require(number not in seen_numbers, "Duplicate fixture pair number")
        seen_numbers.add(number)
        expected_file = folder / "expected.json"
        expected = read_json(expected_file)
        require(expected["pairId"] == pair, "Fixture pairId differs from folder")
        require(pair in expected_inputs, "Missing fixture input hash")
        expected_sha256 = digest(expected_file)
        require(
            definition["fixtures"][pair]["expectedSha256"] == expected_sha256,
            "Independent fixture definition SHA256 mismatch",
        )
        require(expected_inputs[pair]["expectedSha256"] == expected_sha256, "Fixture SHA256 mismatch")
        group = "pass" if number in pass_pairs else "fail"
        variants = unique_index(expected["variants"], lambda variant: variant["name"], "variant")
        require("correct" in variants, "Missing correct variant")
        require(variants["correct"]["expectedVerdict"] == group, "Correct label differs from group")
        require(variants["correct"]["image"] == "impl-correct.png", "Unexpected correct image")
        image_names = [variant["image"] for variant in variants.values()]
        require(len(image_names) == len(set(image_names)), "Duplicate variant image")
        require(set(image_names) | {expected["figmaFrame"]} == {file.name for file in folder.glob("*.png")}, "Undeclared or missing PNG")
        images = {}
        for name in set(image_names) | {expected["figmaFrame"]}:
            require(Path(name).name == name, "Fixture image must be a basename")
            images[name] = load_png(folder / name)
        for variant in variants.values():
            for against in ("figma", "correct"):
                identity = (pair, variant["name"], against)
                expected_keys.add(identity)
                require(identity in rows, "Missing measurement row")
                row = rows[identity]
                require(row["group"] == group, "Measurement group mismatch")
                require(row["expectedVerdict"] == variant["expectedVerdict"], "Variant verdict mismatch")
                require(row["knownRedIssue"] == variant.get("knownRedIssue"), "Known RED mismatch")
                left, left_sha256 = images[variant["image"]]
                reference_name = expected["figmaFrame"] if against == "figma" else "impl-correct.png"
                right, right_sha256 = images[reference_name]
                require(row["image"] == {"file": variant["image"], "width": left.width, "height": left.height, "sha256": left_sha256}, "Image metadata/hash mismatch")
                require(row["reference"] == {"width": right.width, "height": right.height, "sha256": right_sha256}, "Reference metadata/hash mismatch")
                same_size = left.size == right.size
                require(row["dimensionsMatch"] is same_size, "Dimension flag mismatch")
                if not same_size:
                    require(row["metrics"] is None and row["legacyRunnerRatio"] == 1, "Dimension mismatch must have null metrics")
                    null_pairs.append(pair)
                    continue
                red, green, blue = ImageChops.difference(left, right).split()
                histogram = ImageChops.lighter(ImageChops.lighter(red, green), blue).histogram()
                metrics = row["metrics"]
                require(metrics is not None, "Same-size row has null metrics")
                count = left.width * left.height
                require(metrics["pixelCount"] == count, "Pixel count mismatch")
                require(metrics["deltaHistogram"] == histogram, "Delta histogram mismatch")
                require(set(metrics["ratios"]) == {str(t) for t in THRESHOLDS}, "Threshold coverage mismatch")
                for threshold in THRESHOLDS:
                    ratio = sum(histogram[threshold + 1:]) / count
                    require(metrics["ratios"][str(threshold)] == ratio, "Pixel ratio mismatch")
                    ratio_checks += 1
                require(row["legacyRunnerRatio"] == metrics["ratios"]["40"], "Legacy ratio mismatch")
                if variant["name"] == "correct" and against == "figma":
                    baseline_ratios[group].append(metrics["ratios"])
                numerical_rows += 1
    require(seen_numbers == set(range(7, 25)), "Fixture number coverage mismatch")
    require(set(expected_inputs) == expected_folder_names, "Input coverage mismatch")
    require(set(rows) == expected_keys, "Unexpected measurement rows")
    require(sorted(measurement["dimensionMismatches"]) == sorted(null_pairs), "Dimension summary mismatch")
    for threshold in THRESHOLDS:
        name = "exactNonzero" if threshold == 0 else f"rawAbove{threshold}"
        summary = {}
        for group in ("pass", "fail"):
            values = [row[str(threshold)] for row in baseline_ratios[group]]
            require(bool(values), "Empty baseline group")
            summary[group] = {
                "min": min(values), "max": max(values), "comparableCount": len(values)
            }
        gap = summary["fail"]["min"] - summary["pass"]["max"]
        summary.update(gap=gap, separated=gap > 0)
        require(measurement["summaries"][name] == summary, "Scalar summary mismatch")
    return {
        "status": "passed",
        "pillow": PIL.__version__,
        "comparisonRows": len(rows),
        "numericalRows": numerical_rows,
        "nullDimensionRows": len(null_pairs),
        "ratioChecks": ratio_checks,
        "sourceHashChecks": len(sources),
        "scalarSummaryChecks": len(THRESHOLDS),
        "scope": "PNG hashes, fixture/source hashes, coverage, dimensions, max-channel delta histograms and six ratios; exploratory spatial metrics and semantic labels are not independently recertified",
    }


def main():
    """対象を明示できるCLIから独立監査を実行し、検証範囲付きで結果を返す。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--measurement", type=Path)
    parser.add_argument("--validation", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    measurement = args.measurement or root / "docs/evidence/issue-427/measurement.json"
    validation = args.validation or root / "docs/evidence/issue-427/validation.json"
    print(json.dumps(audit(root, measurement, validation), sort_keys=True))


if __name__ == "__main__":
    main()
