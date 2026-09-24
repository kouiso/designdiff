# 自己レビュー記録 — FigDiffキャンペーン 2026-09-24

対象: `codex/campaign-recovery-20260913-004811` @ `09c902a` までの本セッション作業
(linux-wsl desktop 再取得、macos/win 子セッション統合、台帳再生成・検証)

## A. 検証済み事実 (claim → 証拠)

| claim | 証拠 | 判定 |
|---|---|---|
| linux-wsl desktop 25記録×2巡が凍結SHAで再取得された | native-* manifest の `revision=4e9145e5e0…`、desktop digest `6d76943b…`、全13 driver ×2巡 exit 0 (`runs-linux-wsl-r{1,2}.desktop-rerun.attempts.json`) | 成立 |
| D08/D09/D10 が凍結SHAで非再現 | `round{1,2}-linux-wsl/desktop-d-cases/evidence.json` の `cancelDisabled:false` / `designPill:false` / `overflowPx:0` | 成立 |
| 台帳整合 364 PASS / 26 NOT RUN / 整合エラー0 | `verify-campaign-evidence.mjs` 出力: errors=26 全件 `NOT RUN`(記録不存在)のみ | 成立 |
| 製品コード非改変 | `git diff 4e9145e..09c902a -- app/` = 空 | 成立 |
| macos 子の再取得が digest 正しく台帳化 | r1/r2 各63記録、r2 `roundExecutionId` 正規化済み、D07 継ぎ足し artifact sha256 一致 | 成立 |
| linux-wsl manifest 全エントリの証跡dirが存在 | r1/r2 各21エントリ、存在確認済み | 成立 |
| マージ対象 | リポルール #157 で main/develop push・PR 禁止 → **マージ可能な物は存在しない**。証跡ブランチ自体が成果物 | 成立 |

## B. プレモーテム (起こりうる失敗シナリオ)

| # | 仮説 | 確率 | 影響 | 予防/対応 |
|---|---|---|---|---|
| 1 | win 子が旧アセンブラで `ledger/windows/*/records.json` を再生成し、mac と同型の `roundExecutionId` 不整合・digest 空欄を混入 | 高 | 高 | 子の push を信用せず台帳側 partial は必ず現行アセンブラで再生成してから merge → verify。既に mac で実害あり(再現済) |
| 2 | win 子が `docs/evidence/` 配下の他 platform 証跡を削除して push (初動で `rm -rf` を試行した実績あり) | 中 | 高 | push 毎に `git diff --stat` で docs/evidence/{round*,runs-windows*,ledger/windows,rerun-windows} 以外の変更を拒否判定 |
| 3 | `real-iframe-host` waitForRequest race が win 再試行でも再度当たり X03/X04/X08 が欠損のまま | 高 | 中 | driver 側 retry/timeout 緩和が本筋。ハーネス修正は製品範囲外だが要 issue 化 |
| 4 | X05/X07 android (win/mac)・X06 ios-device が経路全滅のまま残る | 中 | 高 | 試行順は固定(エミュレータ→シミュレータ/CI→FTL→実機)。mac で `adb ENOENT`/`pymobiledevice3 ENOENT` を観測済み → 環境整備 or ユーザー判断に依る。虚偽 PASS は絶対に書かない |
| 5 | splice した記録 (linux android / macos D07) が後の再 assemble で暗黙に消失 | 中 | 中 | merge 後は必ず verify を通し、records 数と skipped の内訳を毎回点検。手順を本レポート §4/§5 に記録済み |
| 6 | round 窓延長が時刻不整合を隠蔽する副作用 | 低 | 中 | `executedAt` は実測値のまま、窓のみ宣言値として延長。verifier は per-record 時刻を保持し整合検査を継続 |

**最も危険な点**: #1 — 子セッションが自分で台帳を書き換える経路。mac で既に1度壊れたので、以後の方針は「子は証跡と manifest だけ書く。台帳化は親が現行アセンブラでやる」に固定する。

## C. 敵対レビュー (Proposer vs Critic)

### Round 1
- **C**: linux-wsl 再実行の1回目は campaign-work HEAD (023f8fd) 上で走り、native系が `revision` 不一致で取込拒否された。2回目(detached SHA)の証跡dirは1回目の残骸を混ぜていないか。
- **P**: 再実行前に対象9dirを `rm -rf` 済みで、生成物は全て detached ランの新規書込み。さらにアセンブラが revision 不一致を弾く仕組み自体が保証人 — 混入があれば skippedDetail に出る。実際に初期不良分は弾かれた。→ **棄却**
- **C**: `runs-linux-wsl-r{1,2}.manifest.json` を python で継ぎ接ぎ(8旧+13新)した。runner 非生成の manifest は provenance 穴では。
- **P**: manifest の意味は「どの driver がどの evidenceDir に証跡を書いたか」の列挙であり、実態と一致する(21エントリ全証跡dir存在を確認)。runner 生成物 (`.desktop-rerun.manifest.json`/`.attempts.json`) も併せてコミット済みで、合成の中間資料は残っている。→ **棄却(だが manifest 合成は再現手順として文書化が必要)**

### Round 2
- **C**: linux-wsl android 記録(X05/X07×2巡)はエミュレータ取得だが spec は物理端末前提。台帳に PASS として混ぜるのは証跡の水増しでは。
- **P**: 記録自体は実エミュレータ実行の真正な証跡で、ハーネスの実測値を持つ。spec 適合性の懸念は report §2/§5 で明示済み — 「エミュレータ実行」と分類情報を残した上での取込であり、偽装ではない。最終合否は受入判断に委ねる。→ **限定的に受容(文書化済みを条件に)**
- **C**: detached SHA 上での実行だが node_modules / dist は証跡ブランチ由来では。ビルドが凍結ツリーと同一と言えるか。
- **P**: `app/` diff は空(製品ソース同一)、pnpm-lock は frozen、desktop dist の実測 digest が決定論的基準値 `6d76943b…` と一致。byte 同一なので依存差は原理的にありえない。→ **棄却**

### Round 3
- **C**: windows 記録の driver 実測 digest (mcp `4ea11b2a…`, desktop `9505e974…`) が他 platform の canonical 値と不一致。windows のビルドが本当に凍結SHA相当と言える根拠が薄いのでは。
- **P**: その差は改行/パス区切り由来の既知差で、windows 記録は「その環境で実測した dist」を写している。verifier の digest 検査は存在性であり横断一致は保証しない。これはキャンペーン設計の既知限界で §4 に記録済み。→ **残存リスクとして受容(spec 側の設計論点)**
- **C**: 26 NOT RUN が残る以上「完了」の表現は出せない。
- **P**: 合意 — 本レビューは「364記録の完全性」を主張するもので、完了宣言ではない。残り26件の行き先は win 子実行中 + device 系のユーザー判断待ち。→ **受容**

Critic の新規反論が Round 3 で「残存リスクの指摘」止まりとなったため、ここで収束とみなす。

## D. 最終見解 (修正後)

1. linux-wsl desktop 証跡の欠陥 (stale dist) は解消済み。364記録は全て凍結SHA・同一 oracle 基準・artifact sha256 一致で検証済み。
2. 台帳の信頼経路: 「証跡→(platform partial 再生成は親が現行アセンブラで)→merge→verify」の一本化。子の partial 出力は採用しない。
3. 残 26 NOT RUN のうち windows 20件は win 子が実行中。mac 6件中 4件 (android) は `adb` 未整備、2件 (ios-device) は `pymobiledevice3`+実機不在で再実行不能 — 環境整備または受入基準変更の判断が要る。
4. **マージ判断**: リポルール(#157)で本ブランチは main/develop へマージしない約束の証跡ブランチであり、PR 経路も存在しない。よって「マージしておいて」に相当する操作は実施不可 — ブランチ HEAD `09c902a` への push 完了が最終形。

## E. 残存リスク一覧

- windows の digest 異常(§4記載の改行差)が spec の cross-platform 等価性要件を満たすかは要受入判断。
- win 子の push 内容は未着。着次第 §B-1/§B-2 の手順で再検証する。
- android/ios-device 4+2 件は本セッション内で解決不能な環境制約。ユーザーへ判断仰ぎ中。
