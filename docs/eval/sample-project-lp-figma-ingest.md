# sample-project-lp Figma ingest

`eval:ingest-figma` は sample-project-lp の実装 screenshot と Figma frame PNG を対応づける。

## 1 コマンド smoke

実 Figma URL / token がない段階では、capture と manifest の名前対応を validate-only で確認する。

```bash
pnpm eval:sample-project-lp-figma -- \
  --lp-repo /path/to/sample-project-lp \
  --figma-manifest /path/to/sample-project-lp-figma-pages.json \
  --out /tmp/sample-lp-figma-smoke \
  --skip-install
```

期待値:

- `/tmp/sample-lp-figma-smoke/capture/impl/*.png` が生成される。
- `Validated pages: 12` が出る。
- `/tmp/sample-lp-figma-smoke/summary.md` と `figma/figma-ingest-summary.md` が生成される。

実 Figma PNG を取得して eval まで実行する場合は、実 node mapping と token を渡して `--real` を付ける。

```bash
FIGMA_TOKEN=<token> pnpm eval:sample-project-lp-figma -- \
  --lp-repo /path/to/sample-project-lp \
  --figma-manifest /path/to/sample-project-lp-figma-pages.json \
  --out /tmp/sample-lp-figma-smoke \
  --real \
  --skip-install
```

期待値:

- Figma PNG が `/tmp/sample-lp-figma-smoke/figma/figma/` に保存される。
- `/tmp/sample-lp-figma-smoke/figma/figdiff-manifest.json` が生成される。
- `/tmp/sample-lp-figma-smoke/eval.md` に差分 summary が出る。

`--real` は `FIGMA_TOKEN` が未設定なら fail-loud する。token 変数名を変える場合は `--token-env FIGMA_TOKEN_FOR_LP` を使う。

## 個別ステップ

1. `verification/fixtures/sample-project-lp-figma-pages.template.json` をコピーし、各 `figma_url` の `REPLACE_*` を実 Figma file key / node-id に置き換える。
2. 実装 screenshot を取得する。

```bash
pnpm eval:capture-lp -- \
  --repo /path/to/sample-project-lp \
  --out /tmp/sample-lp-capture \
  --skip-install
```

3. mapping と実装 screenshot の名前対応を API token なしで検証する。

```bash
pnpm eval:ingest-figma -- \
  --figma-manifest /path/to/sample-project-lp-figma-pages.json \
  --out /tmp/sample-lp-figma \
  --impl-dir /tmp/sample-lp-capture/impl \
  --validate-only
```

4. Figma PNG を取得し、designdiff manifest を生成する。

```bash
FIGMA_TOKEN=<token> pnpm eval:ingest-figma -- \
  --figma-manifest /path/to/sample-project-lp-figma-pages.json \
  --out /tmp/sample-lp-figma \
  --impl-dir /tmp/sample-lp-capture/impl
```

5. 差分を評価する。

```bash
FIGDIFF_MANIFEST=/tmp/sample-lp-figma/figdiff-manifest.json \
FIGDIFF_MD_OUT=/tmp/sample-lp-figma/eval.md \
node scripts/eval/figdiff-cluster-bench.mjs
```

`FIGMA_TOKEN` は repo に保存しない。`--validate-only` は token/API なしで manifest 構造と `impl/<name>.png` の存在だけを検証する。
