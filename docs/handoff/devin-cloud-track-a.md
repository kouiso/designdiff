# Devin Cloud 引き継ぎ（track-a1-a2-p3-baseline）

## 現在の状況

- `develop`（00a542e）には Track 0（`track-0/c1-c2-loop-instructions`）がマージ済み
- Track 0 では `loopGuard` v2 schema と MCP 指示・skill プロンプトの停止条件を整理した
- PR #64 / PBI #62 / SBI #63 で追跡
- 次は `feat/track-a1-a2-p3-baseline` を `develop` にマージするのが目標

## 次のブランチ

`feat/track-a1-a2-p3-baseline` には以下のコミットが積まれている

- `820f6ee` P3 Hausdorff shape を `effectiveStructure` に配線・baseline 再計測
- `8f9935a` `measure-correlation` baseline expectation を整列
- `03ea625` oracle カバレッジ拡張
- `1698a9b` A-1 oracle fixture カバー
- `281af38` compare-design runner の dynamic auto-mask path カバー
- `2d293de` `measure-correlation` helper 公開と A-1 カバレッジ拡張

このブランチは `develop` より遅れている。マージすると以下のファイルで競合が出ることを確認済み

- `app/mcp-server/src/service/measure-correlation.test.ts`
- `package/shared/src/type.ts`
- `verification/correlation/baseline-report.json`
- `verification/correlation/baseline-report.md`
- `verification/script/measure-correlation.mjs`

`app/mcp-server/src/service/compare-design-runner.test.ts` は自動マージできる

## P3 配線の要点

`package/shared/src/type.ts` の `effectiveStructure` で `shape`（Hausdorff 距離）を `structure` から引いている
`scope === "root"` のときは元の `structure` を使う
`weightedStructure` にも反映済み
fixture `verification/fixture/pair-06-shape-edge/` で確認できる

## 作業手順

1. `feat/track-a1-a2-p3-baseline` を checkout する
2. `develop` をマージする
3. 競合ファイルを解決する（原則は両方の変更を残す。P3 配線と loopGuard v2 export は独立）
4. `pnpm typecheck` を実行する
5. `pnpm test` を実行する
6. `pnpm lint` と `pnpm lint:eslint` を実行する
7. 通ったら push して PR を作る
8. CI が緑になったらマージする

## 競合解決のヒント

- `package/shared/src/type.ts` には P3 配線（`shape` の引き算）と `LoopGuardReason` 型 export の両方が必要
- `measure-correlation.test.ts` は両ブランチでテスト追加・修正が入っている
  Test helper の重複を避け、同じ helper を共有する形に整えてよい
- `baseline-report.json` / `baseline-report.md` は Track 0 と P3 配線後の値が混在する
  `verification/script/measure-correlation.mjs` を再実行して最新値を作り直すのが確実

## マージ後の次のターゲット

`feat/track-a1-a2-p3-baseline` が入ったら、Track A-1（`flat-region-color.ts` の配線）に進む
その次は Track B（multi-axial 判定）、Track C（`measure-correlation` 相関 0.95）の順

## トラブル時の確認ポイント

- `mcp-server` のテストで `loopGuard` 関連の型エラーが出たら `LoopGuardReason` / `LoopGuardReport` の import を確認
- `measure-correlation.mjs` を再実行した後、baseline report の値が 0.95 未満なら P3 配線後の再計測が必要
- 競合解決で P3 配線が巻き戻っていないか `package/shared/src/type.ts` を重点的に確認
