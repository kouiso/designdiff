# FigDiff Issue Reporting

## ⚠️ 公開リポジトリ注意

kouiso/designdiff は **public リポジトリ**です。

`report_issue` ツールは body をサニタイズしますが、AIとして以下を守ってください：
- 内部 Figma URL・顧客ファイルキー・ローカルパスを body に貼らない
- アクセストークン類（FIGMA_TOKEN, GITHUB_TOKEN 等）を body に含めない
- `include_design_source: true` は Figma URL が公開可能な場合のみ指定

## セットアップ

```bash
export GITHUB_TOKEN=$(gh auth token)
```

## いつ起票するか

figdiff を使っていて以下に気づいた瞬間に起票してください：
- ワークフローが 2ステップ以上必要になった
- エラーメッセージが分かりにくい
- 応答が大きすぎてアーカイブされた
- フレームが取得できなかった
- 期待通りに動かなかった

## 使い方

```
report_issue(
  title: "list_figma_frames がネストしたモーダルを取得できない",
  body: "モーダルは FRAME 内の FRAME として定義されているが include_nested なしでは取得できない。再現: Figmaファイルにモーダルを作成し list_figma_frames を実行すると取得されない。",
  category: "usability",
  include_context: true
)
```

## category 指針

| category | 使うとき |
|---|---|
| bug | 明らかな誤動作・クラッシュ |
| usability | 使いにくい・ワークフローが複雑 |
| enhancement | あったら便利な新機能 |
| docs | ドキュメント・説明不足 |

## dedup

同タイトルの open issue がある場合は `deduped: true` で既存 issue の URL を返します（重複起票しません）。
