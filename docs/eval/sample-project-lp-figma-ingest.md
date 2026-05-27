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

Figma API/download 経路だけを token なしで通す場合は `--mock-figma-api` を使う。capture した `impl/` と mock Figma PNG を結合し、`figdiff-manifest.json` 生成まで確認する。

```bash
pnpm eval:sample-project-lp-figma -- \
  --lp-repo /path/to/sample-project-lp \
  --figma-manifest /path/to/sample-project-lp-figma-pages.json \
  --out /tmp/sample-lp-figma-smoke \
  --mock-figma-api \
  --skip-install
```

期待値:

- `/tmp/sample-lp-figma-smoke/figma/figma/*.png` が mock API 経由で保存される。
- `/tmp/sample-lp-figma-smoke/figma/figdiff-manifest.json` が生成される。
- `/tmp/sample-lp-figma-smoke/summary.md` の mode が `mock-figma-api` になる。

先に readiness を確認する。

```bash
pnpm eval:sample-project-lp-figma:ready -- \
  --lp-repo /path/to/sample-project-lp \
  --figma-manifest /path/to/sample-project-lp-figma-pages.json \
  --out /tmp/sample-lp-figma-readiness.md \
  --html-out /tmp/sample-lp-figma-readiness.html
```

期待値:

- 実 Figma manifest と token が揃っていれば `Ready: yes`。
- template の `REPLACE_*` が残っている場合は exit 2 で、未置換 page が report に出る。
- `/tmp/sample-lp-figma-readiness.html` で、比較を始める前に足りないものを日本語の画面として確認できる。
- JSON evidence の `semanticAnchors` で、page ごとの `expected_texts` 件数と合計件数を確認できる。

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

## mock API smoke

実 Figma token / node mapping がなくても、Figma images API 境界と PNG download、`figdiff-manifest.json` 生成は mock server で検証できる。

```bash
pnpm eval:ingest-figma:mock -- --out /tmp/sample-lp-figma-mock
```

期待値:

- mock images API から 2 page 分の download URL が返る。
- Figma PNG が `/tmp/sample-lp-figma-mock/figma-ingest/figma/` に保存される。
- `/tmp/sample-lp-figma-mock/figma-ingest/figdiff-manifest.json` に `figma` / `impl` / `meta` の対応が出る。
- `/tmp/sample-lp-figma-mock/summary.md` に evidence summary が出る。

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

## top-pc large-page smoke（Step 2）

top-pc の performance blocker 再現と改善確認を、実装 screenshot 取得込みで 1 コマンド化する。

```bash
pnpm smoke:top-pc-large-page -- --lp-repo /path/to/sample-corporate --out /tmp/figdiff-top-pc-smoke
```

- `capture/impl/top-pc.png`（実装スクショ）が生成される。
- `eval/baseline.json`（60s timeout）と `eval/actual.json`（既定 5s timeout）で compare_design 相当の結果を取得する。
- `top-pc-large-page-smoke-report.md` に expected vs actual の timing / diff signal を出力する。
- compare_design 直接実行が困難な環境では、同一コアロジックを使う `figdiff-cluster-bench.mjs` を benchmark fallback として利用する。
- PR 用の実行証跡テンプレートと blocker 記録は `docs/evidence/s2-top-pc-large-page-smoke.md` を参照。
