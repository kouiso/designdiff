# sample-project-lp Figma ingest

`eval:ingest-figma` は sample-project-lp の実装 screenshot と Figma frame PNG を対応づける。

1. `verification/fixtures/sample-project-lp-figma-pages.template.json` をコピーし、各 `figma_url` の `REPLACE_*` を実 Figma file key / node-id に置き換える。
2. 実装 screenshot を取得する。

```bash
pnpm eval:capture-lp -- \
  --repo /Users/kouiso/ghq/github.com/example-org/sample-project-lp \
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
