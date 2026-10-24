# FigDiff

Figma のデザインと実装のスクリーンショットを比較し、見た目の差分を確認するツールです。
Desktop / Web、Figma plugin、Chrome extension、AI 向け MCP サーバーで使えます。

- 初めて参加する人: [オンボーディング](doc/onboarding.md)
- 日常の開発: [開発ガイド](doc/dev-guide.md)
- AI からの利用: [MCP の接続と比較](doc/dev-guide.md#mcp)
- 利用条件: [LICENSE](LICENSE) / [許諾書式](doc/license-grant-template.md)

<details>
<summary>MCP の最小入力例（接続・撮影条件・その他の例は開発ガイドへ）</summary>

`FILE_KEY` と node ID は実際のフレーム、画像は MCP プロセスから読める絶対パスに置き換えます。

```json
{
  "name": "compare_design",
  "arguments": {
    "design_source": "https://www.figma.com/design/FILE_KEY/Project?node-id=1-2",
    "screenshot": "/absolute/path/to/screenshot.png",
    "campaign_id": "homepage-layout-task"
  }
}
```

返された `comparisonId` で詳細を取得します。一致率だけで正しさを判断しません。

```json
{
  "name": "generate_diff_report",
  "arguments": {
    "comparison_id": "cmp-from-compare-design",
    "format": "json"
  }
}
```

</details>
