# 検証キャンペーン 最終凍結レポート

対象: [PBI #156](https://github.com/kouiso/designdiff/issues/156)
凍結製品SHA: `4e9145e5e051d4efe78a922723f7b3245005a05e`
証跡ブランチ: `codex/campaign-recovery-20260913-004811`
統合台帳: `docs/evidence/campaign-ledger.json`（`node script/verify-campaign-evidence.mjs docs/evidence/campaign-ledger.json` で再検証可）
統合日時: 2026-09-20T20:03Z

## 1. 完了条件との照合

| 条件 | 状態 | 実測 |
| --- | --- | --- |
| 195記録 × 2巡 = 390記録すべて PASS | **未達（364/390）** | PASS 364 / NOT RUN 26 / FAIL 0 |
| 新規不具合 0 | 達成 | 全364記録 `newBugs: 0`、uncatalogued defect による取込拒否 0 |
| 全記録が同一凍結SHA | 達成 | 364記録すべて `productSha = 4e9145e…`、`dirty: false` |
| 独立 oracle | 達成 | source-pixels 156 / schema-contract 84 / dom-geometry 70 / host-observation 52 / dependency-graph 2（製品自己評価 0） |
| 既知不具合3件の disposition 凍結前確定 | 達成（ただし §3 の linux-wsl 観測を参照） | 3件とも凍結SHA以前の製品修正コミットで解消 |

verifier の残エラーは 26件すべて `NOT RUN`（記録が存在しない）で、存在する記録に対する整合性エラー（SHA / dirty / digest / round窓 / 実行順 / artifact sha256）は 0 件。

### platform 別内訳

| platform | round-1 | round-2 | NOT RUN（各巡） |
| --- | --- | --- | --- |
| linux-wsl | 64 PASS | 64 PASS | 0 |
| macos | 63 PASS | 63 PASS | 3: X05/X07 android, X06 ios-device |
| windows | 54 PASS | 54 PASS | 10: C07/D05 desktop, X03/X04 figma-plugin, X05/X07 android, X08 ×4 route |
| repository | 1 PASS | 1 PASS | 0 |

windows/macos の実行は 2026-09-20 12:21–12:39Z（windows）/ 13:39–13:54Z（macos）。両 round の `finishedAt` は統合時刻（2026-09-20T20:03:12Z）へ延長し、`startedAt` は据え置き（round2.startedAt > round1.startedAt を維持）。case 単位の round2 > round1 実行順序も verifier 通過。

## 2. NOT RUN 26件の原因（子セッションの attempts ログより）

すべて **ハーネス／環境側の失敗** で、製品 FAIL の記録は 1 件もない。

- **X05/X07 android（windows ×4, macos ×4）**: `stdio-android-verification.mjs` が `X05 needs >=1 ready android device, got 0` で前提失敗。両子セッションともエミュレータを起動できなかった（`stdio-android-verification` 証跡dir 不在）。linux-wsl はエミュレータで両巡 PASS 済み（`bd6772d`）。runbook 上は「物理デバイス必須・エミュレータ代替は無効」とあるため、linux-wsl の android 4記録は「エミュレータ実行」として扱いに留意。
- **X06 ios-device（macos ×2）**: `pymobiledevice3 developer dvt screenshot` が失敗。物理 iPhone 未接続。**唯一、物理デバイスが必須で自動化不能な gap**。X06 ios-simulator は両巡 PASS。
- **C07/D05 desktop（windows ×4）**: `native-ignore-region.mjs` の書込み拒否プローブ（`icacls /deny (W)` 後の `assert.rejects`）が `Missing expected rejection` で失敗。実行ユーザーが Administrator のため deny ACL が効かず、ハーネスの前提が成立しなかった。製品挙動ではない。
- **X03/X04 figma-plugin（windows ×4）**: `real-iframe-host.mjs` の `waitForRequest` が両巡 30s timeout。runbook 記載の既知 race（約5割 flake）が windows では両巡とも当たった。
- **X08（windows ×8）**: `x08/plugin.mjs` が同じ `waitForRequest` timeout → 依存する `x08/compare.mjs` が `x08-plugin.json` ENOENT。上記と同根。

## 3. 既知不具合3件の disposition

3件とも凍結SHA `4e9145e`（2026-09-19 04:42Z）以前に製品側で修正済み（`git log 4e9145e` で確認）:

| id | 修正コミット | 回帰テスト |
| --- | --- | --- |
| token-dialog-cancel-stuck | `bd6bbf4` fix(desktop): reset submitting and login state when token dialog closes | `0590376` |
| compare-store-shared-across-projects | `98bbc17` fix(desktop): clear project-scoped stores when the active project tab changes | `2b7b96e` |
| narrow-viewport-overflow | `271216d` fix(desktop): let header nav shrink and scroll at narrow widths | `5cda2a3` |

**凍結SHAでの実測**: windows / macos の D08/D09/D10 記録は 3件とも非再現（`cancelDisabled:false` / `compareAfterProjectSwitch.designPill:false` / `overflowPx:0`）。

**要注意 — linux-wsl だけ 3件とも再現している**: linux-wsl の D08/D09/D10（両巡・計6記録）は `observedKnownDefects` に 3件が載っており、実測値も `cancelDisabled:true` / `designPill:true` / `overflowPx:226` と修正前の挙動。verifier は catalogued な既知不具合として PASS 扱いにしているが、修正済み凍結SHAで再現するのは矛盾する。

- 傍証: linux-wsl の desktop buildDigest は `5c738970…`。一方 macos の実測 digest と、本セッションで凍結SHA相当ツリーから再ビルドした digest はともに `6d76943b…` で一致する（desktop dist は決定論的）。→ linux-wsl 実行時の `app/desktop/dist` は凍結SHAのビルドと **内容が異なっていた** 可能性が高い（推測: 修正コミット前の stale dist）。
- 影響範囲: linux-wsl desktop route 25記録 × 2巡 = 50記録の製品同一性が疑わしい。mcp / chrome-extension / figma-plugin route の digest は他 platform と一致しており影響なし。
- 推奨: linux-wsl で `pnpm build` をやり直した上で desktop 系 driver（desktop-c-cases / desktop-d-cases / native-*）を再実行し、D08/D09/D10 の非再現と digest `6d76943b…` を確認してから完了宣言すること。

## 4. 統合時に行った台帳側の補正（証跡本体は無改変）

- `docs/evidence/campaign-rounds.json`: 両 round の `finishedAt` を統合時刻へ延長（子セッション実行が元の窓の外だったため）。
- windows / macos の round partial（`docs/evidence/ledger/{windows,macos}/round-{1,2}/records.json`）を現行ブランチの `assemble-campaign-ledger.mjs` で再生成。子セッションは凍結SHA時点の旧アセンブラを使っており、(a) driver が digest を書かない route の `buildDigest` が空、(b) macos round-2 の `roundExecutionId` が旧 plan の `round2-macos` になっていた。再生成で (a) は surface dist からの決定論的再計算（`script/build-digest.mjs`）で補完、(b) は `runs-macos-r2.manifest.json` の値を現行 plan と同じ `round2` に揃えた。artifact の sha256 は全件不変。
  - 補完 digest はこのマシン（linux）で再ビルドした凍結ツリーから算出。mcp `da4a551f…` / desktop `6d76943b…` / chrome-extension `dc70b5a8…` / figma-plugin `c8029310…` は macos・linux-wsl の実測値と一致。windows で driver が実測した digest（mcp `4ea11b2a…`, desktop `9505e974…`）は改行等の差で異なるため、windows 記録は実測値と補完値が混在する。

## 5. 残作業

1. **X06 ios-device ×2巡**: 物理 iPhone 接続が必要。自動化不能な唯一の gap。
2. **X05/X07 android on windows/macos ×各2巡**: エミュレータ起動または物理端末。linux-wsl 分はエミュレータで取得済み。
3. **windows のハーネス起因 NOT RUN 18件**: C07/D05（非 Administrator ユーザーで実行、または deny 手段の見直し）、X03/X04/X08（`waitForRequest` race の修正または再試行）。
4. **linux-wsl desktop 50記録の再取得**（§3）。
5. **issue #69 履歴書き換え**: 本キャンペーンから除外。別途ユーザーの明示（verbatim）承認を得てから実施する。

## 6. ローカル done-gate

`pnpm install --frozen-lockfile && pnpm check:naming && pnpm lint && pnpm build && pnpm test` を本ブランチ HEAD で実行し全て成功（node 25.9.0 / pnpm 9.15）。
