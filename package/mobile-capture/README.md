# @figdiff/mobile-capture

Captures a PNG screenshot from a connected Android device, booted iOS simulator, or iOS device into `~/.figdiff/cache/capture/` for `compare_design`.

Supported providers:

- `android`: `adb exec-out screencap -p`
- `ios-sim`: `xcrun simctl io booted screenshot <path>`
- `ios-device`: `pymobiledevice3 developer dvt screenshot <path>`

[deferred: macmini real-device E2E]
