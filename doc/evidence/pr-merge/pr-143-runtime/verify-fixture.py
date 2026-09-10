"""Verify the committed translation fixture independently with Pillow."""

import hashlib
import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent
fixture = root.parent / "pr-142-alignment-fixture"
source = Image.open(fixture / "source.png").convert("RGBA")
actual = Image.open(fixture / "shifted-left-2px.png").convert("RGBA")
expected = Image.new("RGBA", source.size, (0, 0, 0, 0))
expected.paste(source.crop((2, 0, source.width, source.height)), (0, 0))
assert actual.size == source.size
assert actual.tobytes() == expected.tobytes(), "fixture is not an exact 2px shift"
report = json.loads((root / "mcp-report.json").read_text())
alignment = report["diffReport"]["alignment"]
assert alignment["translation"] == {"x": -2, "y": 0}
assert alignment["applied"] is True
assert report["status"] == "FAIL", "real layout displacement must remain blocking"
print(json.dumps({
    "oracle": "Pillow pixel translation, independent of DesignDiff decoder/alignment",
    "dimensions": list(source.size),
    "expected_rgba_sha256": hashlib.sha256(expected.tobytes()).hexdigest(),
    "actual_rgba_sha256": hashlib.sha256(actual.tobytes()).hexdigest(),
    "exact_translation_verified": True,
    "mcp_translation_matches_oracle": True,
    "layout_displacement_remains_blocking": True,
}, indent=2))
