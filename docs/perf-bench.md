# パフォーマンスベンチ (Issue #251)

`compareImages()` の壁時計を SP / PC / 縦長フレームで測定する。

## 計測方法

```bash
pnpm --filter @figdiff/mcp-server build
node script/eval/figdiff-perf-bench.mjs
```

- 合成検体 (決定的な色セルグリッド + 注入差分) をプロファイルごとに生成し、各 20 反復で `compareImages` を計測 (ウォームアップ 1 回を除く)。
- 実 Figma API の fetch は意図的に対象外 — ネットワーク揺れを性能値に混ぜないため。デザイン画像の取得側コストは `designLoad` (file read + base64 化) で代理記録する。
- 結果は `docs/evidence/perf-bench.json` に出力。

## 閾値 (p95) — 決定事項

| プロファイル | サイズ | p95 目標 | 実測 p95 (Apple Silicon, 2026-10-01) |
|---|---|---|---|
| sp | 375×812 | 5,000ms | ~450–495ms |
| pc | 1440×900 | 5,000ms | ~1,920–2,040ms |
| tall | 1440×4000 | 15,000ms (暫定) | ~9,800–10,700ms |

- **sp/pc の 5,000ms**: `docs/comprehensive-audit-2026-05-18.md` P0 の「ユーザー許容 <5s/ページ」に由来。
- **tall の 15,000ms は暫定**: 縦長ページのクラスタリングが CPU-bound で 5s に収まらないことが実測で確定した (過去の sample-corporate 評価でも top-pc 級の大画像で >20s を記録)。暫定値には実測 p95 への ~40% ヘッドルームを持たせ、クラスタ adaptive fallback (early-exit / region cap) が着き次第 5,000ms を目標に下げる。
- 閾値超過時の対処: まず `clusterMode` を `grid`→`flood` (または逆) で切替えて再測。それでも超える場合は領域 cap / 分割比較を検討する。

## CI ゲートとして使う場合

```bash
FIGDIFF_PERF_P95_MS=5000 FIGDIFF_PERF_P95_MS_TALL=15000 \
  node script/eval/figdiff-perf-bench.mjs   # 超過プロファイルがあれば exit 1
```

- グローバル閾値: `FIGDIFF_PERF_P95_MS`
- プロファイル別上書き: `FIGDIFF_PERF_P95_MS_SP` / `FIGDIFF_PERF_P95_MS_PC` / `FIGDIFF_PERF_P95_MS_TALL`
- per-PR CI への常設は未導入 — 計測はマシン性能依存で flake しやすいため、まず手動/定期実行で運用し、傾向が安定したら nightly ワークフに載せる判断をする。
