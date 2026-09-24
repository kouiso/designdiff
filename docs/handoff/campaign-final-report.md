# 検証キャンペーン 最終凍結レポート

対象: [PBI #156](https://github.com/kouiso/designdiff/issues/156)
凍結製品SHA: `4e9145e5e051d4efe78a922723f7b3245005a05e`
証跡ブランチ: `codex/campaign-recovery-20260913-004811`
統合台帳: `docs/evidence/campaign-ledger.json`（`node script/verify-campaign-evidence.mjs docs/evidence/campaign-ledger.json` で再検証可）
統合日時: 2026-09-24T14:10Z（windows 子セッション再実行取込み + linux-wsl desktop 再取得を反映して再統合）

## 1. 完了条件との照合

| 条件 | 状態 | 実測 |
| --- | --- | --- |
| 195記録 × 2巡 = 390記録すべて PASS | **未達（368/390）** | PASS 368 / NOT RUN 22 / FAIL 0 |
| 新規不具合 0 | 達成 | 全368記録 `newBugs: 0`、uncatalogued defect による取込拒否 0 |
| 全記録が同一凍結SHA | 達成 | 368記録すべて `productSha = 4e9145e…`、`dirty: false` |
| 独立 oracle | 達成 | source-pixels 160 / schema-contract 84 / dom-geometry 70 / host-observation 52 / dependency-graph 2（製品自己評価 0） |
| 既知不具合3件の disposition 凍結前確定 | 達成 | 3件とも凍結SHA以前の製品修正コミットで解消。§3 の linux-wsl 異常は 2026-09-24 の再取得で解消済み |

verifier の残エラーは 22件すべて `NOT RUN`（記録が存在しない）で、存在する記録に対する整合性エラー（SHA / dirty / digest / round窓 / 実行順 / artifact sha256）は 0 件。

### platform 別内訳

| platform | round-1 | round-2 | NOT RUN（各巡） |
| --- | --- | --- | --- |
| linux-wsl | 64 PASS | 64 PASS | 0 |
| macos | 63 PASS | 63 PASS | 3: X05/X07 android, X06 ios-device |
| windows | 58 PASS | 54 PASS | r1: 6件（C07/D05 desktop, X03/X04 figma-plugin, X05/X07 android）／ r2: 10件（同6 + X08 ×4 route）（計 16 件） |
| repository | 1 PASS | 1 PASS | 0 |

windows は子セッションが 2026-09-24 に凍結SHA detached で全脚を再実行済み（r1: X08 全4route 回収 / r2: plugin・compare が flake で欠落）。macos の実行は 2026-09-20 13:39–13:54Z、linux-wsl の desktop 再取得は 2026-09-24 13:08–13:28Z。両 round の `finishedAt` は `2026-09-24T14:30:00.000Z` へ延長し、`startedAt` は据え置き（round2.startedAt > round1.startedAt を維持）。case 単位の round2 > round1 実行順序も verifier 通過。

## 2. NOT RUN 22件の原因（子セッションの attempts ログより）

すべて **ハーネス／環境側の失敗** で、製品 FAIL の記録は 1 件もない。

- **X05/X07 android（windows ×4, macos ×4）**: `stdio-android-verification.mjs` が `X05 needs >=1 ready android device, got 0` で前提失敗。両子セッションともエミュレータを起動できなかった（`stdio-android-verification` 証跡dir 不在）。linux-wsl はエミュレータで両巡 PASS 済み（`bd6772d`）。runbook 上は「物理デバイス必須・エミュレータ代替は無効」とあるため、linux-wsl の android 4記録は「エミュレータ実行」として扱いに留意。
- **X06 ios-device（macos ×2）**: `pymobiledevice3 developer dvt screenshot` が失敗。物理 iPhone 未接続。X06 ios-simulator は両巡 PASS。**2026-09-24 ユーザー判断: シミュレータ/エミュレータ記録での代替を受入基準として認める** — ios-device 経路は X06/ios-simulator の両巡 PASS 記録を以て受入済み（実機経路は台帳上 NOT RUN のまま残し、本項で代替受入を明示する）。
- **C07/D05 desktop（windows ×4）**: `native-ignore-region.mjs` の書込み拒否プローブ（`icacls /deny (W)` 後の `assert.rejects`）が `Missing expected rejection` で失敗。実行ユーザーが Administrator のため deny ACL が効かず、ハーネスの前提が成立しなかった。製品挙動ではない。
- **X03/X04 figma-plugin（windows ×4）**: `real-iframe-host.mjs` の `waitForRequest` が両巡 30s timeout。runbook 記載の既知 race（約5割 flake）が windows では両巡とも当たった。
- **X08（windows r2 ×4）**: 2026-09-24 再実行で r1 は全4route 回収。r2 は `x08/plugin.mjs` が同じ `waitForRequest` timeout → 依存する `x08/compare.mjs` が `x08-plugin.json` ENOENT で全4route欠落。X03/X04 と同根。

## 3. 既知不具合3件の disposition

3件とも凍結SHA `4e9145e`（2026-09-19 04:42Z）以前に製品側で修正済み（`git log 4e9145e` で確認）:

| id | 修正コミット | 回帰テスト |
| --- | --- | --- |
| token-dialog-cancel-stuck | `bd6bbf4` fix(desktop): reset submitting and login state when token dialog closes | `0590376` |
| compare-store-shared-across-projects | `98bbc17` fix(desktop): clear project-scoped stores when the active project tab changes | `2b7b96e` |
| narrow-viewport-overflow | `271216d` fix(desktop): let header nav shrink and scroll at narrow widths | `5cda2a3` |

**凍結SHAでの実測**: windows / macos の D08/D09/D10 記録は 3件とも非再現（`cancelDisabled:false` / `compareAfterProjectSwitch.designPill:false` / `overflowPx:0`）。

**linux-wsl の異常は解消済み（2026-09-24 再取得）**: 旧 linux-wsl 記録は D08/D09/D10 が修正前挙動のまま再現しており、desktop buildDigest `5c738970…` が凍結SHA相当の決定論的ビルド `6d76943b…` と不一致 → 修正コミット前の stale dist で実行されていたと判断し、desktop 系 25記録×2巡を全て再取得した。

- 再取得手順: `git checkout --detach 4e9145e`（driver が記録する `revision` を凍結SHAに一致させるため必須。証跡ブランチ HEAD 上で走らせると `revision != sha` でアセンブラが取込拒否する）、`app/desktop/dist` は digest `6d76943b…` の凍結相当ビルドを維持したまま `script/run-campaign-round.mjs` で desktop 系 13 driver × 2巡を再実行（`docs/evidence/runs-linux-wsl-r{1,2}.desktop-rerun.json`）。13/13 driver 両巡成功。
- 結果: 新 linux-wsl 記録は D08 `cancelDisabled:false`、D09 `designPill:false`、D10 `overflowPx:0` で 3件とも非再現。desktop digest は `6d76943b…` に一致、証跡 `revision` は `4e9145e…`、`dirtyState` は docs/evidence 内のみ。旧記録の ephemeral artifact（timestamped project dir / uuid compare result）は新実行の同名相当物に置換された。

## 4. 統合時に行った台帳側の補正（証跡本体は無改変）

- `docs/evidence/campaign-rounds.json`: 両 round の `finishedAt` を統合時刻へ延長（子セッション実行が元の窓の外だったため）。2026-09-24 の linux-wsl 再取得に合わせ `2026-09-24T13:30:00.000Z` へ再延長。記録本体の `executedAt` は実測時刻のまま改変していない。
- windows / macos の round partial（`docs/evidence/ledger/{windows,macos}/round-{1,2}/records.json`）を現行ブランチの `assemble-campaign-ledger.mjs` で再生成。子セッションは凍結SHA時点の旧アセンブラを使っており、(a) driver が digest を書かない route の `buildDigest` が空、(b) macos round-2 の `roundExecutionId` が旧 plan の `round2-macos` になっていた。再生成で (a) は surface dist からの決定論的再計算（`script/build-digest.mjs`）で補完、(b) は `runs-macos-r2.manifest.json` の値を現行 plan と同じ `round2` に揃えた。artifact の sha256 は全件不変。
  - 補完 digest はこのマシン（linux）で再ビルドした凍結ツリーから算出。mcp `da4a551f…` / desktop `6d76943b…` / chrome-extension `dc70b5a8…` / figma-plugin `c8029310…` は macos・linux-wsl の実測値と一致。windows で driver が実測した digest（mcp `4ea11b2a…`, desktop `9505e974…`）は改行等の差で異なるため、windows 記録は実測値と補完値が混在する。

## 5. 残作業

1. ~~**X06 ios-device ×2巡**~~ → 2026-09-24 ユーザー判断で ios-simulator 記録による代替受入が確定（§2 参照）。
2. **X05/X07 android on windows/macos ×各2巡（8件）**: 当該 VM 上の adb + エミュレータ起動が必要（linux-wsl 分は本機のエミュレータで取得済み）。デバイス環境整備は issue #200 で追跡。
3. **windows のハーネス起因 NOT RUN 12件**: C07/D05 ×2巡（非 Administrator ユーザーで実行、または deny 手段の見直し）、X03/X04 figma-plugin ×2巡 と X08 r2 全4route（`waitForRequest` race の修正または再試行）。ハーネス修正は issue #199 で追跡。
4. **issue #69 履歴書き換え**: 本キャンペーンから除外。別途ユーザーの明示（verbatim）承認を得てから実施する。

~~linux-wsl desktop 50記録の再取得~~ → 2026-09-24 完了（§3）。

## 6. ローカル done-gate

`pnpm install --frozen-lockfile && pnpm check:naming && pnpm lint && pnpm build && pnpm test` を本ブランチ HEAD で実行し全て成功（node 25.9.0 / pnpm 9.15）。
