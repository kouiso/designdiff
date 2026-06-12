# Step 2: top-pc large-page smoke evidence (PR-ready)

## Scope / base
- Base branch: `develop`
- Scope: documentation / evidence only（コード変更なし）
- Target smoke: `scripts/eval/top-pc-large-page-smoke.mjs`（`pnpm smoke:top-pc-large-page`）

## Exact command(s)
```bash
pnpm smoke:top-pc-large-page -- --lp-repo /path/to/sample-corporate --out /tmp/figdiff-top-pc-smoke
```

### Optional knobs (same smoke)
```bash
pnpm smoke:top-pc-large-page -- \
  --lp-repo /path/to/sample-corporate \
  --out /tmp/figdiff-top-pc-smoke \
  --baseline-timeout-ms 60000 \
  --timeout-ms 5000
```

## Expected vs Actual

### Expected（assets/token が揃っている場合）
- `capture/impl/top-pc.png` が生成される。
- `eval/baseline.json`（60s）と `eval/actual.json`（5s）が生成される。
- `top-pc-large-page-smoke-report.md` に expected vs actual（timing / diff signal）が出力される。

### Actual（この検証環境での実行結果）
- この環境には `/path/to/sample-corporate` が存在しないため、smoke は前提チェックで停止。
- 実測エラー（そのまま）:
  - `--lp-repo not found: /path/to/sample-corporate`

## Real blocker（正確な阻害要因）
1. **実 assets 不在**: `--lp-repo` が指す実 LP リポジトリ（例: sample-corporate）がローカルに無い。
2. **token 要件（real Figma ingest を含める場合）**: 追加で real API を使うフローでは `FIGMA_TOKEN` が必要（本証跡では token を保存しない）。

> Note: top-pc large-page smoke 自体は compare core の benchmark fallback を使用するため、token 必須ではない。token 必須になるのは Figma real ingest を同時に回すケース。

## Demo steps（1分）
1. `sample-corporate` をローカル配置（例: `/work/sample-corporate`）。
2. 次を実行：
   ```bash
   pnpm smoke:top-pc-large-page -- --lp-repo /work/sample-corporate --out /tmp/figdiff-top-pc-smoke
   ```
3. 結果確認：
   - `/tmp/figdiff-top-pc-smoke/capture/impl/top-pc.png`
   - `/tmp/figdiff-top-pc-smoke/eval/baseline.json`
   - `/tmp/figdiff-top-pc-smoke/eval/actual.json`
   - `/tmp/figdiff-top-pc-smoke/top-pc-large-page-smoke-report.md`
4. レポート内の `Expected vs Actual (timing)` で 5s 目標達成有無を判定。

## Validation run log（dependency-free）
```bash
node scripts/eval/top-pc-large-page-smoke.mjs --lp-repo /path/to/sample-corporate --out /tmp/figdiff-top-pc-smoke
# => --lp-repo not found: /path/to/sample-corporate
```

## Non-goals
- `error.log` の追加・更新は行わない。
