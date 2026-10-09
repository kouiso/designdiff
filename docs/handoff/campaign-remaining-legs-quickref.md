# 残り16レグ 実行クイックリファレンス（windows 12 + macos 実機 4）

対象: [PBI #156](https://github.com/kouiso/designdiff/issues/156) 残 NOT RUN 16記録。
実行手順の正本は `campaign-remaining-platforms.md`。こちらは「必要な driver だけを入れた manifest を用意済み」の差分版。

- 凍結製品SHA: `4e9145e5e051d4efe78a922723f7b3245005a05e`
- `git checkout --detach 4e9145e5... && pnpm install --frozen-lockfile && pnpm build` 後に実行
- **製品コードは一切編集しない**（`dirty: false` 必須）
- 実行時刻は executedAt に正直に刻む。round 窓の finishedAt 延長は台帳取り込み側で扱う（後述）

## Windows機（12記録: C07/D05/X03/X04 r1+r2, X08 r2）

manifest 2本（driver を必要分だけに絞ったもの）:

```powershell
node script/run-campaign-round.mjs --manifest docs/evidence/runs-windows-r1-remaining.json
node script/run-campaign-round.mjs --manifest docs/evidence/runs-windows-r2-remaining.json
```

対象 driver:
- r1/r2 共通: `app/desktop/e2e/native-ignore-region.mjs` (C07+D05), `app/desktop/e2e/native-figma-node-fix.mjs` (D05), `app/figma-plugin/e2e/real-iframe-host.mjs` (X03+X04)
- r2 のみ: `app/mcp-server/script/x08/{mcp,desktop,extension,plugin,compare}.mjs` (X08 全4 route)

## macmini（4記録: X07 android r1+r2, X06 ios-device r1+r2）

manifest 2本:

```bash
node script/run-campaign-round.mjs --manifest docs/evidence/runs-macos-r1-device.json
node script/run-campaign-round.mjs --manifest docs/evidence/runs-macos-r2-device.json
```

対象 driver:
- `stdio-android-verification.mjs` (X07; X05 も同時に再採される)
- `stdio-ios-device-verification.mjs` (X06 実機)

前提: `adb devices` に実シリアル（emulator- でない）表示・pymobiledevice3 導入済み・iPhone 接続。エミュレータ代替は無効。

### Android 側の環境 prep（実測で要検証済み・必須）

新規 AVD / 初回起動の Chrome は First Run Experience (FRE) のウェルカム画面と
通知許可モーダルで実ページを塞ぎ、scroll 撮影が1枚で止まる（Linux 実機で
再現・回避確認済み 2026-10-09）。manifest 実行の前に1度だけ:

```bash
adb shell 'echo "chrome --no-first-run --disable-fre" > /data/local/tmp/chrome-command-line'
adb shell am force-stop com.android.chrome
adb shell am start -a android.intent.action.VIEW -d http://example.com
sleep 5
adb shell input keyevent 4   # 通知モーダルを Back で閉じる
adb shell am force-stop com.android.chrome
```

driver 側は force-stop → URL起動 → 描画待ち → 実 swipe の順で走るので、
FRE を事前消費しておけば以後の実行はクリーン（driver 自体は実機で
10枚・12086px 結合・下端到達まで確認済み）。

## 台帳取り込み（実行後）

1. `docs/evidence/campaign-rounds.json` の該当 round `finishedAt` を最終実行時刻以降へ更新（round は全195記録が揃うまで open。executedAt の改ざんは禁止）
2. 各 platform/round で `assemble-campaign-ledger.mjs` → `--merge` で `campaign-ledger.json` 統合
3. `node script/verify-campaign-evidence.mjs` が PASS すること
4. 証跡は `docs/evidence/` 配下のみ conventional commit で PR 化（本ブランチへ）
