# Device legs: independent oracle status (PR #370)

| Leg | Independent check | Status |
|---|---|---|
| X07 Android scroll stitch | `app/mcp-server/script/lib/stripe-stitch-oracle.mjs` reads the stitched PNG's pixels (8 known colours, order, no duplicate/missing section, inner section heights) without using FigDiff's `scrollCapture` report. Wired into `stdio-android-verification.mjs` (skipped when `ANDROID_PAGE_URL` is user-supplied). | Oracle logic unit-tested on Linux with synthetic PNGs (5 cases: pass, missing, duplicated, reordered, stretched). **Not yet run against a real emulator capture** — the colour distance (60) and inner-height tolerance (20%) are unmeasured on real Chrome rendering. |
| X06 iOS Simulator capture | Compare the captured PNG against the direct `simctl io screenshot` pixels and validate the system-UI mask geometry independently. | **Pending macOS measurement.** Needs a macOS runner to decide the tolerance for regions that change between captures (status-bar clock). Only width/height equality is asserted today. |

Until the emulator run confirms the X07 thresholds and the macOS run defines the X06 comparison, these legs record that capture *works*; they are not proof that stitching or iOS pixels are correct.
