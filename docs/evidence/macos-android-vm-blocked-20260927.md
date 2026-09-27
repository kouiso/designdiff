# macOS android 検証レグ — Devin macOS VM では実現不可（2026-09-27）

issue #200 の macOS × android ルート（X05/X07 × 2巡 = 4記録）について、
Devin macOS VM（VMAPPLE, arm64）上での実測を試みたが、プラットフォーム制約により
`sys.boot_completed=1` に到達できなかった。結果は失敗だが、原因と再現条件を記録する。

## 環境

- `uname -a`: Darwin arm64（VMAPPLE VM）
- `kern.hv_support` = 0 → **ネスト仮想化なし。HVF 不可、TCG（ソフトウェアエミュレーション）のみ**
- イメージ: `system-images;android-34;google_apis;arm64-v8a`、AVD `pixel_7_pro`
- セットアップ完了済: repo @ `4e9145e5`、node 25.6.1 + pnpm 9.15.0、`pnpm build` 成功、
  `app/mcp-server/dist/index.js` 生成、SDK + AVD 作成済

## ブート試行: 約15回の emulator 起動・再起動（約2時間）。`sys.boot_completed=1` はゼロ。

## 原因チェーン（実測証跡あり）

1. **apexd のダイスロール（解決済）**: 非wipeブートでは ~24/44 の decompressed APEX 活性化に失敗。
   TCG タイミング下で `apexd` が dm-verity デバイスノードを待てず、boot classpath jar が欠けて
   zygote が crash loop。`-wipe-data` ブートのみ apexd 0 失敗を安定して出せる。
2. **watchdog の壁（未解決）**: apexd がクリーンでも、system_server がデフォルト実行時権限の
   付与処理 `PackageManagerService.systemReady → grantDefaultPermissions →
   DefaultPermissionGrantPolicy → CompletableFuture.get()` で watchdog 管理スレッドを
   60秒超ブロック → SIGKILL → init が zygote を再起動。223パッケージのスキャンが
   TCG 速度では 60秒 window に収まらず、`mPermissionUpgradeNeeded` がクリアされないため収束しない。

## 試した緩和策

- `-feature -HVF -accel off`（起動自体に必須。`-accel off` 単独では `-enable-hvf` が注入される）
- `-gpu off`（Windows での修正法）→ この環境では apexd 失敗経路を悪化。デフォルトGPUへ戻す
- AVD 形状: 720×1280 @320dpi、4コア、4GB RAM
- `-wipe-data` 毎回、`-no-snapshot`、`-no-metrics`、`-no-boot-anim`
- `config.disable_noncore` — **API-34 ビルドに存在しないprop**（確認済）
- `-writable-system` + `adb remount` で `/system/build.prop` への書き込み
- `runtime-permissions.xml` へ fingerprint 注入（`isPermissionUpgradeNeeded` を false にして
  ブロッキング付与を両コードパスでスキップさせる根 adb 機構。Settings.java 参照で検証済）
  — 実行したが watchdog window 内に PM スキャンが終わらず不発

## 結論

Devin macOS VM ではネスト仮想化が提供されないため、Android エミュレータは TCG のみで動かざるを得ず、
API-34 システムイメージの初回ブート（権限付与フェーズ）が watchdog 60秒を必ず超過する。
**この経路は VM では実現不可能**。実機 macOS（macmini 等、HVF が使える物理機）であれば
同手順は標準的な Android 開発環境として成立する。

## 代替経路

- ユーザーの macmini（`docs/handoff/campaign-remaining-platforms.md` 記載の経路）で
  `stdio-android-verification.mjs` を実行し、成果物を本ブランチへ追加する
- または issue #200 記載の「spec の受入基準(物理端末必須)の見直し」判断により、
  macos × android 4記録を環境不可として正式に除外する
