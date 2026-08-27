# Golden Fixtures

`verification/fixture/` は FigDiff v2 の golden fixture 置き場です。L7 の accuracy correlation 層で、人手判断と `DiffReport.aggregateVerdict` の相関を継続監視する前提で管理します。

## ディレクトリ構成

各 fixture pair は `pair-XX-.../` 配下にまとめます。

必要ファイル:

- `figma-export.png`: 参照デザイン
- `impl-*.png`: 実装バリアント
- `expected.json`: 各バリアントの期待結果

## `expected.json` スキーマ

```json
{
  "pairId": "pair-01-simple-static-lp",
  "figmaFrame": "figma-export.png",
  "variants": [
    {
      "name": "correct",
      "image": "impl-correct.png",
      "expectedVerdict": "pass",
      "expectedKinds": []
    },
    {
      "name": "color-off",
      "image": "impl-color-off.png",
      "expectedVerdict": "fail",
      "expectedKinds": ["color"]
    }
  ]
}
```

項目の意味:

- `pairId`: fixture pair の一意 ID
- `figmaFrame`: pair ディレクトリからの相対パス
- `variants[].name`: 識別用の短い名前
- `variants[].image`: pair ディレクトリからの相対パス
- `variants[].expectedVerdict`: `pass` / `fail` / `inconclusive`
- `variants[].expectedKinds`: 人手で期待する差分カテゴリ。現時点の runner は verdict を主判定に使い、この配列は将来の issue correlation 用メタデータとして保持します
- `variants[].expectedIssueKinds`: runnerが出力するIssueKindの期待値。`expectedKinds`と異なる分類体系を持つ場合に明示します
- `figmaRootNode`: 任意。P2 以降の section-aware DiffReport 用に top-level Figma section を埋め込めます
- `variants[].expectedWeightedStructureMin/Max`: 任意。weighted aggregate の期待レンジ
- `variants[].expectedRegionStructure`: 任意。`figmaNodeId` ごとの structure 期待レンジ
- `variants[].ignoreRegions`: 任意。fixture 固有の比較対象外領域
- `variants[].captureDevice`: system UI presetを使う検体の端末種別
- `variants[].viewportWidth/viewportHeight`: 結合前viewportの実px寸法
- `variants[].imageWidth/imageHeight`: 結合後の画像の幅・高さ
- `variants[].verifiedSystemUiTopInset`: 本番presetから期待するstatus bar高さ

`captureDevice`、`viewportWidth`、`viewportHeight`、`imageWidth`、`imageHeight`、`verifiedSystemUiTopInset` は同時指定が必須です。runnerは結合画像の幅・高さとは別にviewport寸法を本番presetへ渡し、期待insetと一致しない検体を拒否します。

## 追加手順

1. `pair-XX-.../` を追加する
2. `figma-export.png` と各 `impl-*.png` を配置する
3. `expected.json` に期待 verdict と差分カテゴリを書く
4. 画像がコード生成可能なら `verification/script/generate-fixtures.mjs` に生成ロジックを追加する
5. `pnpm --filter @figdiff/mcp-server test` で fixture runner を通す

## 再生成

```bash
node verification/script/generate-fixtures.mjs
```
