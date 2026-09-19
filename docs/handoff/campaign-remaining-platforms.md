# 検証キャンペーン 残作業ハンドオフ（windows / macos / android / ios）

対象: [PBI #156](https://github.com/kouiso/designdiff/issues/156) 完了条件の未充足分。

## 凍結状態

- 凍結製品SHA: `4e9145e5e051d4efe78a922723f7b3245005a05e`（製品修正3件＋M12分離修正込み）
- 証跡ブランチ: `codex/campaign-recovery-20260913-004811`（HEAD `4f9e94c`）
- 実行済み: linux-wsl 62記録×2巡、repository 1記録×2巡、M12 linux-wsl（起票issue #166, #167）
- 未実行（264記録）: windows/macos の全driver、android実機分（X05/X07）、ios-device分（X06実機）、M12 windows/macos

## 各マシンでの手順

前提: リポジトリを同期し、凍結SHAでdetached checkoutする。証跡の dirtyState 判定で disqualify されないよう、実行中はコードを一切編集しない（docs/evidence 配下の変化のみ許容）。

```bash
git fetch origin
git checkout --detach 4e9145e5e051d4efe78a922723f7b3245005a05e
pnpm install --frozen-lockfile && pnpm build
```

### Windows機（platform: windows）

```bash
rm -rf docs/evidence/round1-windows docs/evidence/round2-windows   # append-only log残留を除去
node script/run-campaign-round.mjs --manifest docs/evidence/runs-windows-r1.json
node script/run-campaign-round.mjs --manifest docs/evidence/runs-windows-r2.json
```

### macmini（platform: macos）

D07（実保存ダイアログ）は AX 権限が必要。システム設定で実行端末（Terminal/iTerm）へアクセシビリティ許可を付与してから実行。

```bash
rm -rf docs/evidence/round1-macos docs/evidence/round2-macos
node script/run-campaign-round.mjs --manifest docs/evidence/runs-macos-r1.json
node script/run-campaign-round.mjs --manifest docs/evidence/runs-macos-r2.json
```

X06 ios-simulator は同じ plan に含まれる。X06 ios-device は実 iPhone の接続が前提。

### Android実機（X05/X07 を含む各platform run）

物理デバイス必須。`adb devices` で実シリアル（emulator- ではないもの）が見える状態で実行すること。エミュレータ代替は記録として無効。

## 実行後の台帳取り込み（どのマシンでも可）

```bash
# 例: windows round-1
node script/assemble-campaign-ledger.mjs \
  --sha 4e9145e5e051d4efe78a922723f7b3245005a05e \
  --round 1 --platform windows \
  --runs docs/evidence/runs-windows-r1.manifest.json \
  --known-defects docs/evidence/known-defects.json \
  --out docs/evidence/ledger/windows/round-1

# 全platform揃ったら統合（--out はファイル名のみ。ledgerRoot配下に置かれる）
node script/assemble-campaign-ledger.mjs \
  --merge docs/evidence/ledger --sha 4e9145e5e051d4efe78a922723f7b3245005a05e \
  --rounds docs/evidence/campaign-rounds.json \
  --out campaign-ledger.json

node script/verify-campaign-evidence.mjs --ledger docs/evidence/campaign-ledger.json
```

注意:
- `--known-defects` は必須。既知不具合3件を観測した記録を uncatalogued で捨てないため。
- driver が build digest を書かない経路は surface の dist/identity から決定論的に再計算される（凍結buildと同一なら一致）。
- roundExecutionId は plan 内で round1/round2 固定済み。verifier は case 単位で round2 > round1 の実行順序を検査する。

## ハーネス側で判明した既知の注意点

- 一部native driverの ipc/http ログは append-only で、再実行前に証跡dirを消さないと記録が肥大する。
- `real-iframe-host` の waitForRequest に既知の race あり（約5割で flake。再試行で通る）。
- native 系 driver の evidenceFile は `manifest.json`、native-unmeasured-score は `after-native.json` を指すこと。
