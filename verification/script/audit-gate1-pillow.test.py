#!/usr/bin/env python3
"""原PNGを書き換えず、保存済みJSONの破損を監査が拒否することを確認する。"""

import copy
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


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
    @classmethod
    def setUpClass(cls):
        evidence = ROOT / "docs/evidence/issue-427"
        cls.measurement = OPTIONS.measurement or evidence / "measurement.json"
        cls.validation = OPTIONS.validation or evidence / "validation.json"
        cls.baseline = json.loads(cls.measurement.read_text(encoding="utf-8"))
        cls.validation_baseline = json.loads(cls.validation.read_text(encoding="utf-8"))
        # もともと壊れた原本で全変異が同じ理由で落ちる偽陽性を防ぐ。
        cls.original_result = AUDIT.audit(ROOT, cls.measurement, cls.validation)

    def test_original(self):
        self.assertEqual(self.original_result["comparisonRows"], 66)
        self.assertEqual(self.original_result["numericalRows"], 63)
        self.assertEqual(self.original_result["nullDimensionRows"], 3)
        self.assertEqual(self.original_result["ratioChecks"], 378)

    def test_corrupt_measurements_are_rejected(self):
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
        value = copy.deepcopy(self.validation_baseline)
        value["sourceSha256"][next(iter(value["sourceSha256"]))] = "0" * 64
        with tempfile.TemporaryDirectory(prefix="gate1-source-mutation-") as folder:
            file = Path(folder) / "validation.json"
            file.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Validation source SHA256 mismatch"):
                AUDIT.audit(ROOT, self.measurement, file)

    def test_missing_runtime_source_hash_is_rejected(self):
        value = copy.deepcopy(self.validation_baseline)
        del value["sourceSha256"]["verification/script/gate1-fixture.mjs"]
        with tempfile.TemporaryDirectory(prefix="gate1-source-omission-") as folder:
            file = Path(folder) / "validation.json"
            file.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Missing source hashes"):
                AUDIT.audit(ROOT, self.measurement, file)


if __name__ == "__main__":
    unittest.main(argv=[str(Path(__file__)), *UNITTEST_ARGUMENTS], verbosity=2)
