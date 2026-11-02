#!/usr/bin/env python3
"""原PNGを書き換えず、保存済みJSONの破損を監査が拒否することを確認する。"""

import copy
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zlib

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
PARSER = argparse.ArgumentParser(add_help=False)
PARSER.add_argument("--measurement", type=Path)
PARSER.add_argument("--validation", type=Path)
OPTIONS, UNITTEST_ARGUMENTS = PARSER.parse_known_args()
SPEC = importlib.util.spec_from_file_location(
    "audit_gate1_pillow", Path(__file__).with_name("audit-gate1-pillow.py")
)
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class Gate1PillowAuditTest(unittest.TestCase):
    """無改変の原本を対照に、誤認証へつながる改変を検出する。"""

    @classmethod
    def setUpClass(cls):
        """原本が通ることを先に確かめ、全変異が同じ準備失敗で落ちるのを防ぐ。"""
        evidence = ROOT / "docs/evidence/issue-427"
        cls.measurement = OPTIONS.measurement or evidence / "measurement.json"
        cls.validation = OPTIONS.validation or evidence / "validation.json"
        cls.baseline = json.loads(cls.measurement.read_text(encoding="utf-8"))
        cls.validation_baseline = json.loads(cls.validation.read_text(encoding="utf-8"))
        # もともと壊れた原本で全変異が同じ理由で落ちる偽陽性を防ぐ。
        cls.original_result = AUDIT.audit(ROOT, cls.measurement, cls.validation)

    def test_original(self):
        """数値比較と寸法不一致を混同せず、全検体の監査成功を固定する。"""
        self.assertEqual(self.original_result["comparisonRows"], 66)
        self.assertEqual(self.original_result["numericalRows"], 63)
        self.assertEqual(self.original_result["nullDimensionRows"], 3)
        self.assertEqual(self.original_result["ratioChecks"], 378)

    def test_corrupt_measurements_are_rejected(self):
        """測定だけの欠落・改変が、独立した元データ照合で失敗することを確かめる。"""
        mutations = []
        value = copy.deepcopy(self.baseline)
        value["rows"][1] = copy.deepcopy(value["rows"][0])
        mutations.append(("duplicate row", value, "Duplicate measurement row"))
        value = copy.deepcopy(self.baseline)
        value["rows"].pop()
        mutations.append(("missing row", value, "Incomplete input/row coverage"))
        value = copy.deepcopy(self.baseline)
        next(row for row in value["rows"] if row["metrics"])["metrics"]["ratios"]["40"] = 0.12345
        mutations.append(("wrong ratio", value, "Pixel ratio mismatch"))
        value = copy.deepcopy(self.baseline)
        next(row for row in value["rows"] if row["metrics"] is None)["metrics"] = {}
        mutations.append(("non-null dimensions", value, "Dimension mismatch must have null metrics"))
        value = copy.deepcopy(self.baseline)
        value["rows"][0]["image"]["sha256"] = "0" * 64
        mutations.append(("wrong image hash", value, "Image metadata/hash mismatch"))
        value = copy.deepcopy(self.baseline)
        value["inputs"][0]["expectedSha256"] = "0" * 64
        mutations.append(("wrong fixture hash", value, "Fixture SHA256 mismatch"))
        value = copy.deepcopy(self.baseline)
        value["summaries"]["rawAbove40"]["gap"] = 0.5
        mutations.append(("wrong summary", value, "Scalar summary mismatch"))
        with tempfile.TemporaryDirectory(prefix="gate1-pillow-mutation-") as folder:
            file = Path(folder) / "measurement.json"
            for name, value, error in mutations:
                with self.subTest(name=name):
                    file.write_text(json.dumps(value), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, error):
                        AUDIT.audit(ROOT, file, self.validation)

    def test_source_hash_corruption_is_rejected(self):
        """別実装へのすり替えを、保存したソースhashとの照合で検知する。"""
        value = copy.deepcopy(self.validation_baseline)
        value["sourceSha256"][next(iter(value["sourceSha256"]))] = "0" * 64
        with tempfile.TemporaryDirectory(prefix="gate1-source-mutation-") as folder:
            file = Path(folder) / "validation.json"
            file.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Validation source SHA256 mismatch"):
                AUDIT.audit(ROOT, self.measurement, file)

    def test_missing_runtime_source_hash_is_rejected(self):
        """必須モジュールをhash表から消して検査を省略する操作を拒否する。"""
        value = copy.deepcopy(self.validation_baseline)
        del value["sourceSha256"]["verification/script/gate1-fixture.mjs"]
        with tempfile.TemporaryDirectory(prefix="gate1-source-omission-") as folder:
            file = Path(folder) / "validation.json"
            file.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Missing source hashes"):
                AUDIT.audit(ROOT, self.measurement, file)

    def test_one_and_two_frame_apng_are_rejected_before_conversion(self):
        """単一フレームAPNGも静止PNGと誤認せず、先頭画素だけを監査しない。"""
        def png_chunk(kind, payload):
            """実検体に触れず、正しいCRCを持つ合成APNG制御を組み立てる。"""
            checksum = zlib.crc32(kind + payload) & 0xffffffff
            return (
                len(payload).to_bytes(4, "big")
                + kind
                + payload
                + checksum.to_bytes(4, "big")
            )

        with tempfile.TemporaryDirectory(prefix="gate1-apng-mutation-") as folder:
            root = Path(folder)
            still = root / "still.png"
            Image.new("RGB", (2, 2), "white").save(still)
            rgb, _ = AUDIT.load_png(still)
            self.assertEqual(rgb.size, (2, 2))
            encoded = still.read_bytes()
            control = png_chunk(b"acTL", struct.pack(">II", 1, 0))
            frame = png_chunk(
                b"fcTL", struct.pack(">IIIIIHHBB", 0, 2, 2, 0, 0, 1, 100, 0, 0)
            )
            one = root / "one-frame.png"
            one.write_bytes(encoded[:33] + control + frame + encoded[33:])
            with Image.open(one) as image:
                self.assertEqual(image.n_frames, 1)
                self.assertFalse(image.is_animated)
                self.assertEqual(image.get_format_mimetype(), "image/apng")
            two = root / "two-frame.png"
            Image.new("RGB", (2, 2), "white").save(
                two, save_all=True,
                append_images=[Image.new("RGB", (2, 2), "black")], duration=10,
            )
            with Image.open(two) as image:
                self.assertEqual(image.n_frames, 2)
            for file in (one, two):
                with self.subTest(frames=file.name):
                    with self.assertRaisesRegex(ValueError, "Animated PNG is unsupported"):
                        with patch.object(
                            Image.Image, "convert",
                            side_effect=AssertionError("APNG pixels must not be converted"),
                        ):
                            AUDIT.load_png(file)

    def test_coordinated_fixture_and_measurement_edit_is_rejected_by_definition(self):
        """期待値と測定を同時に書き換えても、別保存の定義を固定点として拒否する。"""
        target_row = next(
            row for row in self.baseline["rows"]
            if row["variant"] == "drift-2px" and row["expectedVerdict"] == "fail"
        )
        pair = target_row["pairId"]
        canonical = ROOT / "verification/fixture" / pair / "expected.json"
        original_read = AUDIT.read_json
        original_digest = AUDIT.digest
        expected = original_read(canonical)
        target_variant = next(v for v in expected["variants"] if v["name"] == "drift-2px")
        target_variant["expectedVerdict"] = "pass"
        value = copy.deepcopy(self.baseline)
        with tempfile.TemporaryDirectory(prefix="gate1-coordinated-mutation-") as folder:
            mutated_expected = Path(folder) / "expected.json"
            mutated_expected.write_text(json.dumps(expected), encoding="utf-8")
            changed_hash = hashlib.sha256(mutated_expected.read_bytes()).hexdigest()
            next(row for row in value["inputs"] if row["pairId"] == pair)["expectedSha256"] = changed_hash
            changed_rows = [
                row for row in value["rows"]
                if row["pairId"] == pair and row["variant"] == "drift-2px"
            ]
            self.assertEqual(len(changed_rows), 2)
            for row in changed_rows:
                row["expectedVerdict"] = "pass"
            measurement = Path(folder) / "measurement.json"
            measurement.write_text(json.dumps(value), encoding="utf-8")

            def redirected_read(file):
                """原本を変更せず、対象expected.jsonだけ合成JSONへ読み替える。"""
                return original_read(
                    mutated_expected if Path(file).resolve() == canonical else file
                )

            def redirected_digest(file):
                """期待値読込と整合するhashを返し、測定との単純整合検査を通過させる。"""
                return original_digest(
                    mutated_expected if Path(file).resolve() == canonical else file
                )

            with patch.object(AUDIT, "read_json", side_effect=redirected_read), patch.object(
                AUDIT, "digest", side_effect=redirected_digest
            ):
                with self.assertRaisesRegex(
                    ValueError, "Independent fixture definition SHA256 mismatch"
                ):
                    AUDIT.audit(ROOT, measurement, self.validation)

    def test_png_byte_limit_matches_measurement_before_decoding(self):
        """測定側が拒否する大きさのPNGを別監査だけが受け入れる不整合を防ぐ。"""
        with tempfile.TemporaryDirectory(prefix="gate1-png-size-mutation-") as folder:
            oversized = Path(folder) / "oversized.png"
            with oversized.open("wb") as handle:
                handle.truncate(AUDIT.MAX_PNG_BYTES + 1)
            with patch.object(
                Image, "open", side_effect=AssertionError("Oversized PNG must not be decoded")
            ):
                with self.assertRaisesRegex(ValueError, "Input exceeds byte limit"):
                    AUDIT.load_png(oversized)


if __name__ == "__main__":
    unittest.main(argv=[str(Path(__file__)), *UNITTEST_ARGUMENTS], verbosity=2)
