# #359 residual parity — verification evidence (PR #369)

Independent verification artifacts for the residual-measurement fixes on
`fix/residual-rule-parity-359`. Everything here is re-obtainable from this PR;
scripts reference absolute paths from the measuring machine
(`/home/factory-user/dd-figma-path` checkout, `/tmp/dd-dump/{live-v3,png-v2}`
capture dumps, horsemanager canonical originals at
`/home/factory-user/horsemanager/doc/evidence/pixel-perfect/canonical`).

## Commits

- `9d91d73e` — first fix round (per-pixel diffMask, tree-path frame residual,
  cluster verdict merge, 8-band frame residual). CI green.
- `3147f334` — second fix round: residual measured even with zero diff
  clusters; frame residual generalized to row/column strips at 1/8, 1/16,
  1/32 plus an 8x8 cell grid; anti-aliased pixels excluded via
  `buildAntiAliasedMask` (lazy); residual issue regionId renamed
  `whole-frame` -> `frame-residual`.

## Synthetic evaluation (band-eval)

- `band-eval.mjs` / `band-eval.json` — v1. RETRACTED: expectations were
  defined by the banded-mean formula under test (self-oracle), and one
  expectation (local 40x40 block) was "corrected" toward that formula.
  Kept for provenance only; do not use its tally.
- `band-eval-expectations.md` — v2 expectations, registered before observing
  implementation output. Expectations are perceptibility-based (ΔE2000 of the
  real 9949-23513 color pair measured independently; allowable renderer
  difference vs real design difference), not implementation formulas.
- `band-eval2.mjs` — v2 harness. Entry point is `compareImages` (real
  pipeline), each case run with and without an unrelated explained diff,
  30 runs total. Exit 0 on both runs below.
- `band-eval2-prefix-9d91d73e.json` — pre-fix run against dist built from
  `9d91d73e` sources (rebuilt and re-run on 2026-10-09 to regenerate the JSON;
  tally identical to the originally reported run):
  hit 6 / correct-pass 9 / MISS 14 / FALSE-ALARM 1.
- `band-eval2-postfix-3147f334.json` — post-fix run against `3147f334`:
  hit 20 / correct-pass 9 / MISS 0 / FALSE-ALARM 1.
  The single FALSE-ALARM is `uniform-1.5` firing on `flat_region_color`
  (existing strict fill-color rule), not on the residual; an expectation
  mismatch recorded as-is, not relaxed.

## Real-screen replay (25 screens, same pixels both paths)

- `replay.mjs` — replays capture dumps through `buildDiffReport` with and
  without the Figma node tree; injects the same lazy AA-mask provider the
  production service uses. Exit 0 for all four runs.
- `replay-v3-windowed.json` / `replay-v2-png-windowed.json` — windowed
  residual, before AA exclusion. Parity 25/25 on both sets, but windows
  re-fired on tolerated shift outlines (4 live screens PASS->FAIL; 5 png
  screens PASS->FAIL vs the `9d91d73e` e2e verdicts).
- `replay-v3-aa.json` / `replay-v2-png-aa.json` — after AA exclusion
  (`3147f334`). Parity 25/25 on both sets. live: 8 pass / 17 fail, identical
  to the `9d91d73e` e2e tally (all 4 flips restored). png: 11 pass / 14 fail;
  9705-6069, 9892-8063, 9788-3540, 9804-4204 restored to PASS;
  9949-23513 stays FAIL on both paths (residual 5.03/5.04, real missing
  background gradient).

## Flip classification (real screens vs canonical ground truth)

Canonical = human-accepted 2026-10-01 original/capture pair per screen.
A/B = dump vs canonical identity, C = canonical design-vs-capture gap,
D = dump design-vs-shot gap.

- `classify-flip.mjs`, `logs/classify-flip.log` (exit 0) — 4 live flips:
  dumps byte-identical to canonical inside firing windows; canonical pair
  carries the identical gap (C≈D), so the gap predates this PR and was
  human-accepted.
- `shift-signature.mjs`, `logs/shift-signature.log` (exit 0) — 73-100% of
  big-diff pixels in the firing windows are explainable by a ±2px
  displacement (shift outlines, already tolerated).
- `probe-aa.mjs` — pixelmatch 7.2.0 re-run on the dump pixels: window
  big-diff pixels are AA-classified (anti-aliasing), which pixelmatch itself
  never counts. Conclusion: 4/4 false alarms -> fixed by AA exclusion, not
  by threshold changes.
- `classify-9810-png.mjs` / `classify-9810-glyph.mjs`,
  `classify-9789-png.mjs` / `classify-9789-glyph.mjs` + logs (all exit 0) —
  the two png screens that remain FAIL after AA exclusion
  (9810-3055 residual 2.004, 9789-3641 residual 2.434, threshold 2).

## Undetermined (not silently accepted)

9810-3055 and 9789-3641 (png path): the firing windows are text/tint bands
whose design-vs-implementation tonal difference exists identically in the
human-accepted canonical pair (dumps byte-identical to canonical), but the
difference is NOT AA-shaped and only 28.9% / 42.6% shift-explainable, so the
AA exclusion does not cover it and no rule-based exclusion is justified
without threshold tuning. Both fire on both paths (parity holds); the
verdict change vs `9d91d73e` is recorded here as undetermined pending a
product decision, with the pixel evidence in the logs above. The live path
for 9810-3055 passes because the current Figma design has drifted slightly
from the canonical original (measured: 1.2% changed, mean |d| 0.69).
