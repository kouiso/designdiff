# Devin Cloud 引き継ぎ指示

このファイルを読んだら、まず `docs/handoff/devin-cloud-track-a.md` を開くこと。
そこに書いてある順番で作業を進めてくれ。

- 対象リポジトリは `kouiso/designdiff`
- 作業対象ブランチは `feat/track-a1-a2-p3-baseline`
- 目標は `develop` へのマージ
- 競合解決は `docs/handoff/devin-cloud-track-a.md` のヒントに従うこと
- 各種コマンドは `package.json` と `AGENTS.md` を参照

要点だけ先に伝える。

1. `feat/track-a1-a2-p3-baseline` を `develop` にマージ
2. `package/shared/src/type.ts` などの競合を解決
3. `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm lint:eslint` を通す
4. push して PR を作成
5. CI 緑になったらマージ

不明点があったら、`docs/handoff/devin-cloud-track-a.md` を再読してから判断すること。
