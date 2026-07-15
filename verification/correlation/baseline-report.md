# L7 Baseline Correlation Report

## Summary
- Verdict accuracy: 100.0% (12/12)
- Pairs tested: 4
- Variants tested: 12
- Issue kind recall: 91.7% (11/12)
- Issue kind precision: 61.1% (11/18)
- Snapshot timestamp: 2026-06-28T10:50:38+09:00

## Data Table
| Fixture | Variant | Human Severity | Expected Verdict | Computed Verdict | Match | Expected Kinds | Computed Kinds | Recall | Precision | Weighted Structure | Weighted Color | Worst Section | Worst Section Score |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| pair-01-simple-static-lp | color-off | 0.0 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.985561 | 3.057725 | whole-frame | 0.985561 |
| pair-01-simple-static-lp | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | whole-frame | 1.000000 |
| pair-01-simple-static-lp | layout-off | 0.0 | fail | fail | yes | position, size, structure | color, position, size | 0.667 | 0.667 | 0.885683 | 9.324988 | whole-frame | 0.885683 |
| pair-02-multi-section-lp | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | section-body | 1.000000 |
| pair-02-multi-section-lp | multi-section-drift | 0.0 | fail | fail | yes | position, size | color, position, size | 1.000 | 0.667 | 0.839675 | 13.080491 | section-header | 0.635797 |
| pair-02-multi-section-lp | single-section-regression | 0.5 | fail | fail | yes | position, size | color, position, size | 1.000 | 0.667 | 0.920419 | 22.299401 | section-footer | 0.890345 |
| pair-03-typography-layout | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | typography-body-block-1 | 1.000000 |
| pair-03-typography-layout | font-size-off | 0.0 | fail | fail | yes | size | color, position, size | 1.000 | 0.333 | 0.941684 | 1.681212 | typography-body-block-3 | 0.857761 |
| pair-03-typography-layout | line-height-off | 0.5 | fail | fail | yes | position | color, position, size | 1.000 | 0.333 | 0.977827 | 2.809494 | typography-body-block-4 | 0.882627 |
| pair-04-color-system | all-buttons-wrong-color | 0.0 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.968913 | 11.467875 | color-button-primary | 0.786944 |
| pair-04-color-system | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | color-button-primary | 1.000000 |
| pair-04-color-system | single-button-wrong-color | 0.5 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.977135 | 4.866668 | color-button-tertiary | 0.972581 |

## Correlation Analysis
- Structure Pearson r: 0.655076
- Color Pearson r: -0.474715
- Human severity mapping: correct=1.0, borderline=0.5, broken=0.0

## False Classifications
- None

## Baseline Signals In Effect
- Active: P1 issue typing and verdict logic, P2 multi-region SSIM weighting
- Not active yet: P3 Hausdorff, P4 texture

## Next Measurement Trigger
- Re-run `pnpm node verification/script/measure-correlation.mjs` after P3 and P4 merge to `develop`.
