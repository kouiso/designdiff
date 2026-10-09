# #359 fix verification — 25 screens before/after (2026-10-09)

- Before: PR #369 previous HEAD 44e8edee, end-to-end runs (live: new-live.json, png: new-png.json)
- After: commit 9d91d73e, fresh end-to-end re-captures (live: v3-live.json / dumps live-v3, png: v2-png.json / dumps png-v2)
- Parity: same-pixels replay through buildDiffReport with and without the Figma node tree (replay-v3-live-banded.json)
- Note: an earlier live capture (live-v2) had its last node options.json truncated when the capturing process was interrupted; it was rebuilt from the pre-fix capture metadata (node id / tree / dimensions only, pixels were the fresh capture) and used only for interim analysis. All numbers below come from the clean, complete live-v3 re-capture; resolvedAlignment was recomputed in-process on replay (dump JSON cannot hold the aligned pixel buffer).

| node | live before | live after | png before | png after | tree/noTree parity (live) |
|---|---|---|---|---|---|
| 9704-5734 | PASS | PASS | PASS | PASS | agree |
| 9705-6069 | PASS | PASS | PASS | PASS | agree |
| 9721-6204 | FAIL | FAIL | FAIL | FAIL | agree |
| 9776-6456 | FAIL | FAIL | FAIL | FAIL | agree |
| 9776-6584 | FAIL | FAIL | FAIL | FAIL | agree |
| 9776-6698 | FAIL | FAIL | FAIL | FAIL | agree |
| 9776-6791 | FAIL | FAIL | FAIL | FAIL | agree |
| 9787-3365 | FAIL | FAIL | PASS | PASS | agree |
| 9788-3540 | FAIL | FAIL | PASS | PASS | agree |
| 9789-3641 | FAIL | FAIL | PASS | PASS | agree |
| 9791-3766 | PASS | PASS | PASS | PASS | agree |
| 9794-3835 | FAIL | FAIL | PASS | PASS | agree |
| 9797-3950 | PASS | PASS | PASS | PASS | agree |
| 9799-4024 | FAIL | FAIL | FAIL | FAIL | agree |
| 9804-4204 | PASS | PASS | PASS | PASS | agree |
| 9804-4285 | FAIL | FAIL | FAIL | FAIL | agree |
| 9804-4369 | FAIL | FAIL | FAIL | FAIL | agree |
| 9810-3055 | PASS | PASS | PASS | PASS | agree |
| 9810-3193 | FAIL | FAIL | FAIL | FAIL | agree |
| 9810-3312 | FAIL | FAIL | FAIL | FAIL | agree |
| 9878-6665 | FAIL | FAIL | FAIL | FAIL | agree |
| 9883-7836 | PASS | PASS | PASS | PASS | agree |
| 9892-8063 | PASS | PASS | PASS | PASS | agree |
| 9949-23460 | FAIL | FAIL | PASS | PASS | agree |
| 9949-23513 | FAIL | FAIL | PASS | FAIL | agree |

Tallies: live {"PASS":8,"FAIL":17} -> {"PASS":8,"FAIL":17}; png {"PASS":14,"FAIL":11} -> {"PASS":13,"FAIL":12}.

Only verdict change: 9949-23513 png PASS -> FAIL. Ground truth: the design root has a white-to-mint (#EFF8F2) vertical gradient; the implementation renders flat neutral gray. The drift (mean dE2000 5.2) is confined to the bottom 1/8 band and diluted to 1.69 in a frame-wide mean, so the no-tree residual (threshold 2) missed it. Banded residual (max over 8 bands) now catches it on both paths; both paths FAIL, which is the correct verdict.

Remaining live-vs-png differences (9787-3365, 9788-3540, 9789-3641, 9794-3835, 9949-23460): live Figma design differs from the 10/1 canonical PNG (design changed), not a tool issue; needs horsemanager-side canonical recapture.

## Overfit check v2 for the banded residual (band-eval2.mjs, 16 cases x variants, compareImages entry)

v1 (band-eval.mjs) is kept alongside, but its verdict is RETRACTED: its expectations were defined by the band formula under test ("band mean >= 2 fires"), which made the algorithm its own oracle, and the "0 misses" claim followed from a correction of the 40x40 expectation toward that formula. Not acceptable as acceptance evidence.

v2 method:
- Expectations pre-registered in band-eval-expectations.md BEFORE any run, decided only from "acceptable renderer difference vs real design difference": the mutation uses the real 9949-23513 colour pair (#EFF8F2 vs #F7F7F7, measured dE2000 = 5.2, ~5x JND); a uniform dE-5.2 shift over >=360px is a real design difference (expect FAIL) regardless of shape/position; per-pixel dE <= ~1.5, zero-mean dither/noise, or smooth ramp differences are renderer/encoding differences (expect PASS).
- Entry point is the real pipeline `compareImages` (pixelmatch 0.1 -> clustering -> buildDiffReport, rasterization_tolerance: true, no node tree = PNG path), not buildDiffReport directly.
- Each case runs in two variants: with and without an unrelated explained diff (a 1px dark line shifted 2px), because the residual is only measured when pixelmatch clusters exist.

Result (30 runs, observed verdict recorded separately from expectation):

| classification | count | cases |
|---|---|---|
| hit (expected FAIL, got FAIL) | 6 | band top/middle/bottom, straddle 15px, narrow-7, wide-30 — all ONLY in the +unrelated variant |
| correct pass | 9 | gradient ramp, AA dither, photo noise, uniform-1.5 (+unrelated), sanity displacement-only, sanity identical |
| MISS (expected FAIL, got PASS) | 14 | see below |
| FALSE ALARM (expected PASS, got FAIL) | 1 | uniform-1.5 without unrelated diff |
| undetermined | 0 | |

Miss breakdown:
- 10/14: EVERY drift case in the no-unrelated-diff variant. pixelmatch marks 0 pixels (pm=0, confirming dE 5.2 is below its threshold), zero clusters are built, and the residual is never measured at all (mask/residual exist only when clusters exist). Any purely sub-pixelmatch drift on an otherwise pixel-identical screen passes unscored. Pre-existing structure, not introduced by 9d91d73e, but it bounds what the banded residual can do. On the 25 real screens every pair had clusters, so this gap did not show in the real-data parity run.
- 4/14: dilution inside the banded rule even when it runs: straddle-thin (8 rows over a band boundary), narrow-3 (3 rows), block-40x40 (band mean 1.73 < 2), vstripe-8 (vertical stripe dilutes in horizontal bands). These are genuine misses against perceptibility-based expectations, NOT accepted limits.

False alarm: uniform dE~1.5 whole-frame shift FAILs via the pre-existing `flat_region_color` signal (critical when a flat region's fill differs by >=1 in any RGB channel), not via the banded residual. My expectation said PASS (below the perceptible bar of 2); the tool deliberately treats any solid-fill token mismatch as critical. Whether that rule is too strict is a product decision outside this PR; recorded here as a false alarm against my expectation.

Rationale for the constants: threshold 2 is the existing PERCEPTIBLE_DELTA_E used by all region colour scoring; 8 bands gives ~90px granularity at typical mobile heights, and max-over-bands >= frame mean so banding itself introduces no new miss relative to the frame-wide mean it replaced.

Open limitations (NOT accepted; pending owner decision):
1. Sub-pixelmatch drift with zero pixelmatch clusters is never measured (10/14 of the misses above). Candidate fix: measure the frame residual even when diffRegions is empty. Changes behaviour on clean screens; needs owner sign-off.
2. Full-width drifts thinner than ~1/16 of the height dilute below 2 when straddling a band boundary; narrow vertical stripes dilute in horizontal bands; sub-band local blocks dilute. Candidate directions: finer bands near boundaries, column bands, or a small-region residual component. All expand scope beyond this PR.

---

## 2026-10-09 second round (commit 3147f334, on top of 9d91d73e)

Scope: zero-cluster residual measurement, window generalization
(row/col strips 1/8-1/16-1/32 + 8x8 cells), AA exclusion, regionId rename.

Same-pixels replay parity (buildDiffReport tree/noTree): live-v3 25/25,
png-v2 25/25.

Verdict changes vs the 9d91d73e e2e columns above (post-AA):

| node | path | 9d91d73e | 3147f334 | classification |
|---|---|---|---|---|
| 9705-6069 | live+png | PASS (flipped FAIL by windows pre-AA) | PASS | false alarm: AA/shift outline, restored |
| 9804-4204 | live+png | PASS (flipped FAIL pre-AA) | PASS | false alarm: AA/shift outline, restored |
| 9892-8063 | live+png | PASS (flipped FAIL pre-AA) | PASS | false alarm: AA/shift outline, restored |
| 9788-3540 | png | PASS (flipped FAIL pre-AA) | PASS | false alarm: AA/shift outline, restored |
| 9949-23513 | live+png | FAIL | FAIL | true positive kept (residual 5.03/5.04) |
| 9810-3055 | png | PASS | FAIL | UNDETERMINED: canonical-accepted text/tint band, not AA, 28.9% shift-explainable, residual 2.004 |
| 9789-3641 | png | PASS | FAIL | UNDETERMINED: canonical-accepted text/tint band, not AA, 42.6% shift-explainable, residual 2.434 |

Tallies post-AA replay: live 8 pass / 17 fail (identical to 9d91d73e e2e),
png 11 pass / 14 fail. The two undetermined png screens are documented with
pixel-level evidence in logs/classify-9810-*.log and logs/classify-9789-*.log;
no threshold was moved to quiet them.

band-eval2 (independent expectations, compareImages entry, 30 runs):
pre-fix (dist @9d91d73e, regenerated) hit 6 / correct-pass 9 / MISS 14 /
FALSE-ALARM 1; post-fix (3147f334) hit 20 / correct-pass 9 / MISS 0 /
FALSE-ALARM 1 (flat_region_color on uniform-1.5, existing strict rule,
expectation mismatch recorded, not relaxed).
