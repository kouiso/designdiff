# L7 Baseline Correlation Report

## Summary

- Verdict accuracy: 100.0% (15/15)
- Pairs tested: 6
- Variants tested: 15
- Issue kind recall: 92.3% (12/13)
- Issue kind precision: 63.2% (12/19)
- Snapshot timestamp: 2026-08-07T13:08:58.839Z

## Data Table

| Fixture | Variant | Human Severity | Expected Verdict | Computed Verdict | Match | Expected Kinds | Computed Kinds | Recall | Precision | Weighted Structure | Weighted Color | Worst Section | Worst Section Score |
| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | ---: |
| pair-01-simple-static-lp | color-off | 0.0 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.918716 | 18.346351 | diff-cluster-100-100-200-100 | 0.918716 |
| pair-01-simple-static-lp | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | whole-frame | 1.000000 |
| pair-01-simple-static-lp | layout-off | 0.0 | fail | fail | yes | position, size, structure | color, position, size | 0.667 | 0.667 | 0.727615 | 27.768456 | diff-cluster-100-100-200-100 | 0.723942 |
| pair-02-multi-section-lp | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | frame-root | 1.000000 |
| pair-02-multi-section-lp | multi-section-drift | 0.0 | fail | fail | yes | position, size | color, position, size | 1.000 | 0.667 | 0.839675 | 13.080491 | section-header | 0.635797 |
| pair-02-multi-section-lp | single-section-regression | 0.5 | fail | fail | yes | position, size | color, position, size | 1.000 | 0.667 | 0.920470 | 22.299401 | section-footer | 0.890414 |
| pair-03-typography-layout | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | typography-body-block-1 | 1.000000 |
| pair-03-typography-layout | font-size-off | 0.0 | fail | fail | yes | size | color, position, size | 1.000 | 0.333 | 0.941684 | 1.681212 | typography-body-block-3 | 0.857761 |
| pair-03-typography-layout | line-height-off | 0.5 | fail | fail | yes | position | color, position, size | 1.000 | 0.333 | 0.977827 | 2.809494 | typography-body-block-4 | 0.882627 |
| pair-04-color-system | all-buttons-wrong-color | 0.0 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.967845 | 11.467875 | color-button-primary | 0.779053 |
| pair-04-color-system | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | color-button-primary | 1.000000 |
| pair-04-color-system | single-button-wrong-color | 0.5 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.976482 | 4.866668 | color-button-tertiary | 0.971798 |
| pair-05-localized-diff | correct | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | whole-frame | 1.000000 |
| pair-05-localized-diff | localized-diff | 0.0 | fail | fail | yes | color | color | 1.000 | 1.000 | 0.165611 | 88.385829 | diff-cluster-180-130-40-40 | 0.165611 |
| pair-06-system-ui-alignment | stitched-system-ui | 1.0 | pass | pass | yes | - | - | n/a | n/a | 1.000000 | 0.000000 | whole-frame | 1.000000 |

## Correlation Analysis

- Structure Pearson r: 0.514628
- Color Pearson r (raw): -0.541966
- Color Pearson r (severity-aligned, = -raw): 0.541966
- Human severity mapping: correct=1.0, borderline=0.5, broken=0.0
- Note: weightedColor is a defect magnitude (bigger = worse) while human severity is
  bigger = better, so the raw color Pearson r is expected to be negative when the
  signal works correctly. colorAligned is a diagnostic value with the sign flipped for
  readability. The design doc's actual 0.95 acceptance bar
  (docs/design/figdiff-v2-final-design.md) is defined as `verdict=pass` correlating
  >=0.95 with human QA judgment, tracked separately above as Verdict accuracy
  (not the same as this Pearson r on the continuous structure/color scores).

## False Classifications

- None

## Baseline Signals In Effect

- Active: P1 issue typing and verdict logic, P2 multi-region SSIM weighting, P4 texture-adjusted weighting
- Computed but not wired into weightedStructure/weightedColor yet: P3 Hausdorff (shape field on RegionScore)

## Next Measurement Trigger

- Re-run after P3 is wired into weightedStructure/weightedColor (`pnpm node verification/script/measure-correlation.mjs`).
