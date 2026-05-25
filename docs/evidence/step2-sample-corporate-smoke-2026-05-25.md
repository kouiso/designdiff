# Step 2 Smoke: sample-corporate 向け 1-minute real diff route（2026-05-25）

## 目的
sample-corporate 向けに、`compare_design` まで最短で到達する再現手順を 1 分以内で確認する。
同時に、**実データ実行の阻害要因（real blocker）** と **モックで通る証拠（mock evidence）** を分離する。

---

## 1) リポジトリ内で見つかった参照（Figma / 実装）

### Figma 参照
- `doc/evaluation-2026-05-18-vs-sample-corporate-v02.md`
  - Figma file key: `FIGMAFILEKEYSAMPLECORP1`
- `doc/evaluation-2026-05-16-vs-sample-corporate.md`
  - sample-corporate 比較対象ページの記述（top/about/service/recruit/news/contact の pc/sp）

### 実装スクリーンショット参照
- 同ドキュメントに、実装スクリーンショットの保存元として以下の記載あり:
  - `~/ghq/example-org/sample-corporate/test/screenshots/astro/<page>.png`
  - `~/ghq/example-org/sample-corporate/test/screenshots/figma/<page>.png`

> 重要: 上記パスは本リポジトリ管理外（別リポジトリ/別作業環境）であり、designdiff 単独 checkout には存在しない。

---

## 2) 1-minute smoke path（mock evidence）

### 実行コマンド（そのまま再現可能）

```bash
# 0) 準備
cd <designdiff repo root>

# 1) 再現用フォルダ作成
mkdir -p /tmp/designdiff-step2-smoke

# 2) 「実装 screenshot」を fixture から複製（再現性担保）
cp verification/fixtures/pair-01-simple-static-lp/figma-export.png \
  /tmp/designdiff-step2-smoke/sample-route-home-impl.png

# 3) compare_design 相当の最短スモーク（既存公式 fixture テスト）
pnpm --filter @figdiff/mcp-server exec vitest run src/e2e-compare-design.test.ts
```

### 期待値 vs 実測

#### Command 2: `cp ... sample-route-home-impl.png`
- 期待値: 再現可能な screenshot ファイルが `/tmp/designdiff-step2-smoke/` に作られる。
- 実測: 成功。ファイル作成を確認。
- 出力パス: `/tmp/designdiff-step2-smoke/sample-route-home-impl.png`

#### Command 3: `pnpm --filter @figdiff/mcp-server exec vitest run src/e2e-compare-design.test.ts`
- 期待値: compare path（image load -> diff -> result shape）が通る。
- 実測: cloud worker では 6 tests passed。ローカル確認環境では disk 95% のため `node_modules` install を避けており、同コマンドは `vitest: command not found` で未実行。
- 出力: テスト標準出力（コンソール）。生成物は fixture 駆動のため固定（本手順では追加ファイル出力なし）。

---

## 3) real blocker（sample-corporate 実データで 1-minute route が未完了な理由）

### Blocker A: 実装 screenshot 実体がこの環境にない
- 期待値: `~/ghq/example-org/sample-corporate/test/screenshots/astro/*.png` が利用可能。
- 実測: この環境では該当パスは存在しない（designdiff 単独 checkout）。
- 影響: `compare_design` に渡す実装 screenshot を「sample-corporate 実体」で用意できない。

### Blocker B: Figma API 実行条件（トークン）が未提供
- 期待値: `FIGMA_TOKEN` が設定され、`design_source` に Figma URL（node-id 指定）を与えて実行可能。
- 実測: この smoke ではトークン未注入のため、Figma 実 fetch を伴う route は未実行。
- 影響: sample-corporate の real Figma frame を使った end-to-end compare は未実施。

---

## 4) すぐ実行可能な next step（real 実施手順）

以下 2 条件が揃えば、同じ 1-minute ルートを real に置換できる。

1. 実装 screenshot の配置（例）
   - `/tmp/designdiff-step2-smoke/sample-top-pc-impl.png`
2. `FIGMA_TOKEN` の設定

実行テンプレート:

```bash
FIGMA_TOKEN=<token> node app/mcp-server/dist/index.js
# MCP クライアントから compare_design:
# design_source=https://www.figma.com/design/FIGMAFILEKEYSAMPLECORP1/...?...node-id=...
# screenshot=/tmp/designdiff-step2-smoke/sample-top-pc-impl.png
```
