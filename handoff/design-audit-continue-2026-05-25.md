# Design audit continuation — 2026-05-25

Owner: kouiso  
Scope: `sample-project-lp` sample-labo 準拠 audit + corp LP audit 横展開  
Primary repo for tooling: `~/worktrees/designdiff-lp-corp-audit`

## 目的

LP を「見た目が近いか」だけでなく、LP として売れる / 信頼できる / 速い / 公開して安全か、まで同じ run で評価する。

`designdiff` の役割は以下。

- Figma / reference screenshot / implementation screenshot を manifest で紐づける。
- 差分 artifact を page / viewport / section 単位で残す。
- AI 修正 chain が「どの section を直すべきか」を読み取れる JSON summary を残す。
- Lighthouse と header check の結果を同じ audit bundle に入れる。

## 監査 rubric

| Category | Weight | Pass condition |
|---|---:|---|
| Figma fidelity | 30 | 主要 section の layout / typography / color / image crop が reference と大きくズレない |
| LP conversion | 25 | first view で価値訴求と primary CTA が読め、CTA が page 内で自然に再登場する |
| Mobile ergonomics | 20 | 390px 幅で text overlap / CTA 押下困難 / section 間迷子が無い |
| Performance | 15 | Lighthouse mobile の LCP / CLS / TBT に P0 が無い |
| Security basics | 10 | CSP または相当する制約、HSTS、content-type protection、referrer policy を確認できる |

P0 が 1 件でもある場合は overall fail。P1 以下は修正 chain に渡してよい。

## sample-labo 準拠チェック

sample-labo 側を reference LP として扱う。比較では完全な clone を求めず、LP 品質の型を抽出する。

見る型:

- hero で誰向け / 何が得られる / 次に何をするかが明確。
- CTA が visual hierarchy の中で埋もれない。
- section heading と body copy の階層が一貫している。
- social proof、事例、利用の流れ、FAQ、問い合わせが読者の不安順に並ぶ。
- SP で 1 section が長すぎず、次の情報が少し見える。
- 画像は飾りではなく、サービス内容や利用イメージの理解に寄与する。

`sample-project-lp` はこの型に対して、Figma fidelity と conversion structure の両方で監査する。

## corp LP audit チェック

corp LP 側は `sample-corporate` で出た既存知見を踏襲する。

- large full-page diff は timeout / over-segmentation を起こしやすい。
- section-aware manifest を優先する。
- intentional deviation は ignore region / mask が未実装なら、監査メモで明示して false positive と分ける。
- page ごとの score より、P0 issue の有無と artifact path を優先する。

## Audit bundle layout

推奨保存先:

```text
/tmp/lp-audit-2026-05-25/
  manifest/
    sample-project-sample-labo.json
    corp-lp.json
  screenshots/
    sample-project/top-pc.png
    sample-project/top-sp.png
  figma/
    sample-project/top-pc.png
    sample-project/top-sp.png
  diff/
    sample-project/top-pc-summary.json
    sample-project/top-pc-overlay.png
    sample-project/top-sp-summary.json
    sample-project/top-sp-overlay.png
  lighthouse/
    sample-project-desktop.report.json
    sample-project-desktop.report.html
    sample-project-mobile.report.json
    sample-project-mobile.report.html
  headers/
    sample-project.headers.txt
    sample-project.headers.summary.txt
  report.md
```

PR には private artifact を直接含めず、再現コマンドと summary の sanitized 版を含める。

## Lighthouse 実行メモ

minimum:

```bash
TARGET_URL="https://example.com"
mkdir -p /tmp/lp-audit-2026-05-25/lighthouse
npx --yes lighthouse "$TARGET_URL" --preset=desktop --output=json --output=html --output-path=/tmp/lp-audit-2026-05-25/lighthouse/sample-project-desktop --chrome-flags="--headless=new"
npx --yes lighthouse "$TARGET_URL" --form-factor=mobile --screenEmulation.mobile=true --screenEmulation.width=390 --screenEmulation.height=844 --screenEmulation.deviceScaleFactor=3 --output=json --output=html --output-path=/tmp/lp-audit-2026-05-25/lighthouse/sample-project-mobile --chrome-flags="--headless=new"
```

summary extraction:

```bash
node -e '
const fs = require("node:fs");
for (const file of process.argv.slice(1)) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const audits = r.audits;
  console.log(JSON.stringify({
    file,
    performance: r.categories.performance?.score,
    accessibility: r.categories.accessibility?.score,
    bestPractices: r.categories["best-practices"]?.score,
    seo: r.categories.seo?.score,
    lcp: audits["largest-contentful-paint"]?.numericValue,
    cls: audits["cumulative-layout-shift"]?.numericValue,
    tbt: audits["total-blocking-time"]?.numericValue
  }, null, 2));
}
' /tmp/lp-audit-2026-05-25/lighthouse/*.report.json
```

## Figma audit script 方針

1. `FIGMA_TOKEN` を local env に置く。ファイルには書かない。
2. Figma node id は manifest に dash notation で置き、runner 側で colon notation に正規化する。
3. Figma export と implementation screenshot は同じ viewport width / DPR に揃える。
4. diff artifact は overlay だけでなく JSON summary を必ず保存する。
5. timeout は失敗として保存し、黙って skip しない。

runner 探索:

```bash
rg -n "manifest|artifact|compare_design|compareImages|screenshot" verification scripts app package.json
```

検証:

```bash
pnpm build
pnpm test
```

期待する PR 追記:

- 正確な runner command
- manifest sample
- artifact naming
- timeout / skip policy

## Security header check 方針

最低確認:

- `content-security-policy` または hosting 側で同等の制限
- `strict-transport-security`
- `x-content-type-options: nosniff`
- `referrer-policy`
- `x-frame-options` または CSP `frame-ancestors`
- 不要に広い `permissions-policy` が無いこと

script:

```bash
TARGET_URL="https://example.com"
mkdir -p /tmp/lp-audit-2026-05-25/headers
curl -sS -D /tmp/lp-audit-2026-05-25/headers/sample-project.headers.txt -o /dev/null "$TARGET_URL"
node -e '
const fs = require("node:fs");
const path = "/tmp/lp-audit-2026-05-25/headers/sample-project.headers.txt";
const text = fs.readFileSync(path, "utf8");
const lower = text.toLowerCase();
const checks = {
  csp: lower.includes("content-security-policy:"),
  hsts: lower.includes("strict-transport-security:"),
  nosniff: lower.includes("x-content-type-options:") && lower.includes("nosniff"),
  referrerPolicy: lower.includes("referrer-policy:"),
  frameProtection: lower.includes("x-frame-options:") || lower.includes("frame-ancestors")
};
for (const [k, v] of Object.entries(checks)) console.log(`${k}: ${v ? "ok" : "missing"}`);
fs.writeFileSync("/tmp/lp-audit-2026-05-25/headers/sample-project.headers.summary.txt", JSON.stringify(checks, null, 2));
'
```

## Report template

```md
# sample-project-lp sample-labo audit

Date:
Target URL:
Reference:
Figma:

## Verdict

- Overall:
- P0:
- P1:
- P2:

## Evidence

| Area | Viewport | Result | Artifact |
|---|---|---|---|
| hero | SP 390 | fail/pass | diff/... |

## Lighthouse

| Viewport | Perf | LCP | CLS | TBT |
|---|---:|---:|---:|---:|

## Headers

| Header | Status |
|---|---|

## Next fix chain

1. Fix P0 first-view / mobile overlap.
2. Re-run manifest audit.
3. Fix Lighthouse P0.
4. Re-run header check after deploy.
```

## chain next 推奨

推奨投入文:

```text
cwd: ~/worktrees/designdiff-lp-corp-audit
handoff/lp-corp-audit-continue-2026-05-25.md と handoff/design-audit-continue-2026-05-25.md を読んで、sample-project-lp sample-labo 準拠 + corp LP audit の PR を作ってください。
優先順位:
1. 既存 manifest audit runner の実コマンド特定
2. sample manifest と artifact 保存規約の追記
3. Lighthouse / Figma / security header check の再現手順検証
4. sanitized report template 追加
5. cloud submit で PR 化
注意: Figma token / private URL / raw private artifact はコミットしない。
```

## 完了条件

- `handoff/` の 2 ファイルが commit 対象に入る。
- runner / Lighthouse / header check の再現手順が doc から追える。
- 次 chain が URL / Figma node を受け取れば audit bundle を作れる。
- cloud task id が handoff か最終返答に残る。
