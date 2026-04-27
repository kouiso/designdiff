# L7 Baseline Correlation Report

## Summary
- Verdict accuracy: 100.0% (12/12)
- Pairs tested: 4
- Variants tested: 12
- Issue kind recall: 91.7% (11/12)
- Issue kind precision: 55.0% (11/20)
- Snapshot timestamp: 2026-04-18T06:09:44-07:00

## Data Table
| Fixture | Variant | Human Severity | Expected Verdict | Computed Verdict | Match | Expected Kinds | Computed Kinds | Recall | Precision | Weighted Structure | Weighted Color | Worst Section | Worst Section Score |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| pair-01-simple-static-lp | color-off | 0.0 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.985561 | 3.333333 | whole-frame | 0.985561 |
| pair-01-simple-static-lp | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | whole-frame | 1.000000 |
| pair-01-simple-static-lp | layout-off | 0.0 | fail | fail | yes | position, size, structure | color, position, size | 0.667 | 0.667 | 0.885683 | 10.222222 | whole-frame | 0.885683 |
| pair-02-multi-section-lp | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | section-body | 1.000000 |
| pair-02-multi-section-lp | multi-section-drift | 0.0 | fail | fail | yes | position, size | color, position, size | 1.000 | 0.667 | 0.837915 | 14.789925 | section-header | 0.635797 |
| pair-02-multi-section-lp | single-section-regression | 0.5 | fail | fail | yes | position, size | color, position, size | 1.000 | 0.667 | 0.920946 | 24.576177 | section-footer | 0.890345 |
| pair-03-typography-layout | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | typography-body-block-1 | 1.000000 |
| pair-03-typography-layout | font-size-off | 0.0 | fail | fail | yes | size | color, position, size | 1.000 | 0.333 | 0.942945 | 2.009033 | typography-body-block-3 | 0.857761 |
| pair-03-typography-layout | line-height-off | 0.5 | fail | fail | yes | position | color, position, size | 1.000 | 0.333 | 0.977959 | 3.534853 | typography-body-block-2 | 0.882627 |
| pair-04-color-system | all-buttons-wrong-color | 0.0 | fail | fail | yes | color | color, position, size | 1.000 | 0.333 | 0.953947 | 18.018847 | color-button-primary | 0.786944 |
| pair-04-color-system | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | color-button-end | 1.000000 |
| pair-04-color-system | single-button-wrong-color | 0.5 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.966303 | 9.147109 | color-button-tertiary | 0.955133 |

## Correlation Analysis
- Structure Pearson r: 0.682228
- Color Pearson r: -0.503544
- Human severity mapping: correct=1.0, borderline=0.5, broken=0.0

## False Classifications
- None

## Baseline Signals In Effect
- Active: P1 issue typing and verdict logic, P2 multi-region SSIM weighting
- Not active yet: P3 Hausdorff, P4 texture

## Next Measurement Trigger
- Re-run `pnpm node verification/scripts/measure-correlation.mjs` after P3 and P4 merge to `develop`.
