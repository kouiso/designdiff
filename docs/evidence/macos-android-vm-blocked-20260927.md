# macOS android 検証レグ — X05 実測PASS済・X07 は TCG 決定的限界（2026-09-28 更新）

issue #200 の macOS × android ルート（X05/X07 × 2巡 = 4記録）の最終結果:

- **X05 × 2巡: PASS** — Devin macOS VM（VMAPPLE arm64, `kern.hv_support=0` = TCG のみ）上で
  `stdio-android-verification.mjs` を実走し、台帳に取込済み
  （`docs/evidence/round{1,2}-macos/`、record `X05/{1,2}/macos/android`）。
- **X07 × 2巡: FAIL（実測）** — 台帳は FAIL 実行をレコード化しない設計のため
  NOT RUN のまま残る。実測証跡は `docs/evidence/round{1,2}-macos/stdio-android-verification/evidence.json`
  に残置（`X07_android_scroll.status="FAIL"`, `textHead` にタイムアウト実ログ）。

## 環境

- `uname -a`: Darwin arm64（VMAPPLE VM）、`kern.hv_support` = 0（HVF 不可、TCG のみ）
- 最終イメージ: `system-images;android-30;google_apis;arm64-v8a`（API-34 より軽量）、
  AVD `pixel_7_pro` 6GB/6コア、`-feature -HVF -no-accel` + swiftshader_indirect
- 表示 360×780（ドライバの固定 60s adb タイムアウトに収めるため縮小）

## 起動を成立させた2つの鍵（前回「不可」とした結論の訂正）

1. **watchdog 抑制**: 最小限の JDWP クライアントを system_server にアタッチし続けると
   AOSP Watchdog は「debugger attached」として強制終了を抑止する
   （logcat `Debugger connected: Watchdog is *not* killing` で確認）。
   jdb そのものは JDWP イベントスレッドで SIGABRT を誘発するため、
   ハンドシェイクのみの自前クライアントで保持。
2. **権限付与デッドロック解消**: `runtime-permissions.xml` の fingerprint に
   `?pc_version=300900706` を注入し `isPermissionUpgradeNeeded` を false にして
   `grantOrUpgradeDefaultRuntimePermissionsIfNeeded` の `AndroidFuture.get()`
   メインスレッド待ちを解除。初回ブート完了まで約4.5時間（TCG 実時間）。

## X07 が決定的に FAIL する根拠

- 裸 `adb shell input swipe 180 624 180 156 600` がアイドル時で **4m50s**。
  ドライバ側の `ADB_TIMEOUT_MS=60_000`（product 凍結 SHA で変更不可）の約5倍。
- ANR ストームが TCG 下で永続化: `/data/anr/` が45分以上2分おきに更新
  （com.android.se / networkstack / system_server×3 / gms.persistent）。
  `pm disable` での churn 停止でも networkstack・system_server の ANR は継続。
- SurfaceFlinger が2度 wedge して screencap が 0 バイト化（kill で一度回復）。
- Chrome の cold start が `am start` からプロセス spawn まで 13 分。
  `pageRenderWait.rendered=false` は構造的（「System UI isn't responding」
  ANR ダイアログで前面占有）。
- qemu が常時 ~297% CPU。TCG では API-30 google_apis でも Android の
  10s/60s broadcast+service タイムアウト予算内に収まらない。

## 結論

- **macOS × android の X05（端末選択・撮影系）: VM で完遂可能**（実測 PASS、取込済）。
- **X07（スクロール撮影系）: VM では不可能** — `input swipe` がタイムアウトの5倍を要し、
  ANR ストームが恒常化するため。解消には HVF 対応ホスト（`kern.hv_support=1` の Mac）
  または物理端末が必要。物理端末前提の受入基準をどう扱うかは issue #200 のスコープ判断。

## 残課題の扱い

- `X07/{1,2}/macos/android`: 台帳上 NOT RUN のまま。HVF 付き Mac 実機で
  `stdio-android-verification.mjs` を実行すれば同手順で採取可能。
- `X06/{1,2}/macos/ios-device`: 物理 iPhone 必須のため対象外（従来どおり）。
