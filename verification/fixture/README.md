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
- `variants[].expectedIssueKinds`: `fail` / `inconclusive` 期待の検体で、runnerが出力するIssueKindの期待値。`expectedVerdict` が `pass` の検体には書けません (0 issue 必須と矛盾するため schema が拒否します)
- `variants[].rasterizationTolerance`: 任意。`true` で、別レンダラ同士 (Figma正本 vs Flutter/Skia キャプチャ) のラスタライズ差を verdict から外す。strict のままだと同一内容の `correct` も fail するため、`fail` 期待の対照検体 (drift / linewidth) にも同じ値を付ける。付けないと、tolerance が本物のずれまで吸収するように壊れても対照が緑のままになる
- `variants[].knownRedIssue`: 任意。`expectedVerdict` は `pass` (あるべき姿) のまま、推定器が未修正で `fail` を返している既知 RED に、原因 Issue を書く。runner はこの検体だけ `fail` を明示的に assert する。推定器が直ると落ちるので、このフィールドを外して通常の `pass` 検体に戻す
- `variants[].knownRedIssueKinds`: 任意。`knownRedIssue` の検体が現在発火している IssueKind を宣言し、既知 RED の失敗モードを固定する。`expectedIssueKinds` を pass 検体に書くと矛盾するため別フィールドに分離している。推定器修正時に `knownRedIssue` と一緒に外す
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

`pair-*-hm-gate1-*` の `impl-drift-2px.png` / `impl-drift-1px.png` / `impl-linewidth.png` は、同じ pair の `impl-correct.png` から派生させています (`impl-correct.png` と `figma-export.png` は実機キャプチャなので再生成できません)。

- `impl-drift-Npx.png`: 右へ N px 平行移動。左端は端の列を複製し、透明帯を作らない (透明帯だと位置ずれではなく欠落として検出され、対照にならない)
- `impl-linewidth.png`: インク画素 (3ch 合計が 600 未満) はそのまま残し、8 近傍にインクがある非インク画素だけを最も暗い近傍インクの色で 1px 膨張させる。全画素に最暗近傍を掛けると背景まで書き換わり線幅差ではなく背景差の検体になるため、変更はインク周辺のリングに限定する。同一グリフの被覆差ではなく線幅差として扱い、`fail` を期待する (designdiff#243 は線幅差の検出漏れを許さない)

```bash
node verification/script/generate-fixtures.mjs          # 書き出し
node verification/script/generate-fixtures.mjs --check  # 既存 PNG と画素一致するか検証
```
