# PR visual evidence readiness checker

compare_design 実行前に、PR 本文または証跡ファイルに画像・Figma・レビュー URL が存在するかをローカルで検査するためのメモです。

## 目的
- テスト成功だけでなく、UI 比較に必要な証跡（画像ペア / Figma / review URL）の不足を fail-loud で検知する。
- `sample-media-app #303` や `sample-project-native #730` のように、テストは通っているが画像ペア不足の監査漏れを防ぐ。

## 使い方

```bash
npm run eval:pr-visual-evidence -- --text "PR 本文"
npm run eval:pr-visual-evidence -- --file docs/evidence/step2-sample-corporate-smoke-2026-05-25.md
```

## 判定
- pass (`exit 0`): Markdown 画像 / 画像 URL / Figma URL / review URL のいずれかを 1 つ以上検出。
- fail (`exit 1`): 上記が 0 件。`expected vs actual` と readiness guidance を出力。
- usage error (`exit 2`): `--text` と `--file` の未指定など。
