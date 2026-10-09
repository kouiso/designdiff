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
  30 runs total. The output path is `argv[2]` (the original version wrote a
  fixed path, which caused the artifact mix-up corrected below).
- `band-eval2-pre-9d91d73e.json` — pre-fix run against a dist built from
  `9d91d73e` sources. sha256
  `6697b6021700347348603aae349d88482bac9fc1a4415a6d55c42f33e3cdb94e`.
  Tally: hit 6 / correct-pass 9 / MISS 14 / FALSE-ALARM 1.
  Command log (UTC): build start 18:10:11, exit 0; eval start 18:10:20,
  end 18:10:22, exit 0 (`node band-eval2.mjs band-eval2-pre-9d91d73e.json`).
- `band-eval2-post-3147f334.json` — post-fix run against a dist built from
  the `3147f334` code (HEAD `1c087af4` only adds docs on top). sha256
  `069179b42f57d44a48116c09e4ba401c73b683cc80fba426934db03899817bb7`.
  Tally: hit 20 / correct-pass 9 / MISS 0 / FALSE-ALARM 1.
  Command log (UTC): build start 18:09:48, exit 0; eval start 18:09:57,
  end 18:10:00, exit 0 (`node band-eval2.mjs band-eval2-post-3147f334.json`).
  The single FALSE-ALARM is `uniform-1.5` firing on `flat_region_color`
  (existing strict fill-color rule), not on the residual; an expectation
  mismatch recorded as-is, not relaxed.

  Correction: the first commit of this directory shipped
  `band-eval2-postfix-3147f334.json` whose bytes were identical to the
  pre-fix file — the pre-fix run's fixed-path output was copied under the
  post-fix name without re-running on the post-fix dist. Both files were
  regenerated with distinct output paths as above; the tallies match what
  was reported in the thread at measurement time.

## Real-screen replay (25 screens, same pixels both paths)

- `replay.mjs` — replays capture dumps through `buildDiffReport` with and
  without the Figma node tree; injects the same lazy AA-mask provider the
  production service uses. Exit 0 for all four runs.
- `replay-v3-windowed.json` / `replay-v2-png-windowed.json` — windowed
  residual, before AA exclusion. live-v3: genuine tree-vs-noTree parity
  25/25. png-v2: single-path (noTree) record only — the png dumps carry no
  tree, so both columns are the same configuration. Windows re-fired on
  tolerated shift outlines (4 live screens PASS->FAIL; 5 png screens
  PASS->FAIL vs the `9d91d73e` e2e verdicts).
- `replay-v3-aa.json` — live-v3 dumps after AA exclusion (`3147f334`).
  live-v3 dumps carry the real `figmaRootNode` (hasTree=true, 25/25), so
  this is a genuine tree-vs-noTree parity check on identical pixels:
  **25/25 agree**. Tally 8 pass / 17 fail on both paths, identical to the
  `9d91d73e` e2e tally (all 4 window flips restored); 9949-23513 stays
  FAIL on both paths (residual 5.03/5.04, real missing background gradient).
- `replay-v2-png-aa.json` — png-v2 dumps after AA exclusion. The png dumps
  have no `figmaRootNode` (the production PNG path never has one), so
  "tree" and "noTree" here replay the same no-tree configuration; read this
  file as a **single-path regression record** (11 pass / 14 fail), not as
  parity evidence. Parity for png pixels is the next entry.
- `replay-png-tree.mjs` / `replay-v2-png-tree.json` (sha256
  `6b0e5d22ce9e4a8073d36be1e304cb35894fb133e2bd1f06d7fc738e6f70e9f0`;
  run 18:11:45-18:14:27 UTC, exit 0) — png-v2 pixels replayed with the
  corresponding live-v3 `figmaRootNode` injected, giving a genuine
  tree-vs-noTree comparison on the PNG pixel set: **24/25 agree**.
  The one divergence is 9794-3835 (tree=fail, noTree=pass): tree section
  9797:3922 fires `delta_e_2000` 11.45 (critical) and ssim 0.25 (major) on a
  text row whose pixel difference (mean |d| 40) the no-tree path proves as
  same-token displacement (`same_token_rasterization` +
  `same_token_content_offset`) and relieves. The canonical pair for this
  screen was human-accepted PASS, and the live-vs-png design pixels in the
  box are identical (0.3% changed), so this is a tree-path over-fire on
  displacement-proven content: section-level scoring does not honor the
  displacement proofs that cluster-level scoring applies. Root cause
  identified; the fix (extending `diff_cluster_relief` semantics to
  displacement-proven sections) is deliberately NOT in this PR and is
  recorded here as an open item.

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
