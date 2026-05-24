# LP / corp audit handoff — 2026-05-25

Owner: kouiso  
Repo: `designdiff`  
Worktree: `~/worktrees/designdiff-lp-corp-audit`  
Branch at handoff start: `feat/lp-corp-eval-manifest`  
Latest observed commits:

```text
35d5026 feat(eval): write diff artifacts for manifest audits
098e822 feat(eval): support manifest-driven screenshot audits
2bf676e Merge pull request #67 from kouiso/feat/top-pc-timeout
3a2b9b7 perf: bound hausdorff for full-page diffs
b7d1d47 Merge pull request #66 from kouiso/feat/lp-grid-summary
```

## 真の目的

`sample-project-lp` を `sample-labo` 準拠の LP 品質へ寄せる。その評価作業を `designdiff` 側の manifest audit / artifact 出力で再現可能にし、corp LP audit の横展開に使える形で PR 化する。

今回の handoff はコード実装そのものではなく、次 chain が迷わず走れる監査設計と投入指示を残すためのもの。

## 現在地

- `designdiff` 側は manifest-driven screenshot audit と diff artifact 出力が直近で入っている。
- 既存評価は `sample-corporate` 対象の `doc/evaluation-2026-05-16-vs-sample-corporate.md` / `doc/evaluation-2026-05-18-vs-sample-corporate-v02.md` が土台。
- v0.2 評価では「全体 1 region 問題」は解消済み。ただし、large page では clusterer wall-time と allowlist / mask 未対応がまだ P0。
- `sample-project-lp` / `sample-labo` / corp LP は、この repo 内の実装対象ではなく外部対象として扱う。`designdiff` は監査 runner と artifact の基盤。

## LP / corp 比較軸

### sample-project-lp → sample-labo 準拠

見るべき差分:

| 領域 | sample-labo 準拠で確認すること | sample-project-lp 側の監査観点 |
|---|---|---|
| First view | ブランド / 価値訴求 / CTA が初期表示で即読める | hero の視線誘導、CTA の contrast、SP で次 section の見え方 |
| Section rhythm | 余白、見出し階層、画像比率が一貫している | PC / SP の section 高さ差、カード間隔、途中の密度落ち |
| Conversion path | CTA が複数 section で自然に再登場する | CTA の文言差分、フォーム誘導、tel / LINE / contact の優先度 |
| Trust proof | 実績、導入事例、運営者情報が早い段階で出る | social proof の位置、ロゴ/数値/説明の視認性 |
| Visual fidelity | Figma / reference LP に対して色、文字、配置が崩れていない | designdiff manifest で page / viewport ごとの差分 artifact を残す |
| Performance | LP として LCP / CLS / TBT が許容内 | Lighthouse mobile / desktop を同条件で計測 |
| Security headers | 公開 LP として最低限の header がある | CSP, HSTS, X-Frame-Options または frame-ancestors, X-Content-Type-Options |

### corp LP audit 横展開

corp LP 側は `sample-corporate` 評価の知見を再利用する。

- full-page diff だけでは意図差分とノイズが混ざるため、section manifest を優先する。
- Figma reference がある page は Figma export と browser screenshot を artifact 化する。
- Figma reference が無い page は Lighthouse / header / visual smoke のみ対象にする。
- 差分結果は単一 score ではなく、page、viewport、section、artifact path を残す。

## 推奨 manifest 形

次 chain では、外部 repo に監査対象 manifest を置くか、`/tmp` に一時 manifest を生成して `designdiff` の runner に渡す。

```json
{
  "project": "sample-project-lp-sample-labo-audit",
  "targets": [
    {
      "id": "top-pc",
      "url": "https://example.local/",
      "viewport": { "width": 1440, "height": 1200 },
      "figma": {
        "fileKey": "<FIGMA_FILE_KEY>",
        "nodeId": "<TOP_PC_NODE_ID>"
      },
      "sections": [
        { "id": "hero", "bbox": { "x": 0, "y": 0, "width": 1440, "height": 760 } },
        { "id": "proof", "bbox": { "x": 0, "y": 760, "width": 1440, "height": 620 } },
        { "id": "cta", "bbox": { "x": 0, "y": 1380, "width": 1440, "height": 520 } }
      ]
    },
    {
      "id": "top-sp",
      "url": "https://example.local/",
      "viewport": { "width": 390, "height": 844 },
      "figma": {
        "fileKey": "<FIGMA_FILE_KEY>",
        "nodeId": "<TOP_SP_NODE_ID>"
      }
    }
  ]
}
```

## 実行順

1. `sample-project-lp` と `sample-labo` の対象 URL / Figma node を確定する。
2. PC / SP の top page だけで最初の manifest を作る。
3. `designdiff` の manifest audit runner で screenshot と diff artifact を生成する。
4. Lighthouse を mobile / desktop で走らせ、JSON と HTML を保存する。
5. security header check を対象 URL ごとに保存する。
6. 監査結果を `handoff/design-audit-continue-2026-05-25.md` の判定軸でまとめる。
7. PR は audit handoff + runner 再現手順をまず出す。実 LP 修正は別 chain に分ける。

## Lighthouse script

外部 LP repo 側、または `/tmp/lp-audit-2026-05-25/` で実行する想定。

```bash
mkdir -p /tmp/lp-audit-2026-05-25/lighthouse
npx --yes lighthouse "$TARGET_URL" \
  --preset=desktop \
  --output=json \
  --output=html \
  --output-path=/tmp/lp-audit-2026-05-25/lighthouse/sample-project-desktop \
  --chrome-flags="--headless=new"
npx --yes lighthouse "$TARGET_URL" \
  --form-factor=mobile \
  --screenEmulation.mobile=true \
  --screenEmulation.width=390 \
  --screenEmulation.height=844 \
  --screenEmulation.deviceScaleFactor=3 \
  --output=json \
  --output=html \
  --output-path=/tmp/lp-audit-2026-05-25/lighthouse/sample-project-mobile \
  --chrome-flags="--headless=new"
```

## Figma / screenshot audit script

`designdiff` 側の manifest-driven audit を優先する。runner 名が次 chain で変わっている可能性があるため、最初に探す。

```bash
rg -n "manifest|artifact|screenshot|audit" verification scripts app package.json
pnpm build
pnpm test
```

期待する出力:

- `target-id` ごとの implementation screenshot
- Figma export または reference image
- diff overlay / diff mask
- JSON summary
- runner wall-time
- timeout / skipped reason

## Security header check

```bash
mkdir -p /tmp/lp-audit-2026-05-25/headers
curl -sS -D /tmp/lp-audit-2026-05-25/headers/sample-project.headers.txt -o /dev/null "$TARGET_URL"
node -e '
const fs = require("node:fs");
const text = fs.readFileSync("/tmp/lp-audit-2026-05-25/headers/sample-project.headers.txt", "utf8").toLowerCase();
const required = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy"
];
for (const h of required) console.log(`${h}: ${text.includes(h + ":") ? "ok" : "missing"}`);
console.log(`frame protection: ${text.includes("x-frame-options:") || text.includes("frame-ancestors") ? "ok" : "missing"}`);
'
```

## 判定基準

- P0: first view の崩れ、CTA 視認性不足、SP で text / CTA が重なる、LCP が明確に悪い、security header がほぼ無い。
- P1: section rhythm の揺れ、Figma と比べた余白 / typography / card サイズの一貫しない差分、CLS の兆候。
- P2: copy polish、minor color drift、画像 crop の軽微な違い。

## chain next 推奨

次の cloud chain は以下をそのまま目的にする。

```text
cwd: ~/worktrees/designdiff-lp-corp-audit
目的: sample-project-lp を sample-labo 準拠で監査できる manifest audit handoff を PR 化し、外部 LP 修正 chain に渡せる artifact 契約を固める。
やること:
1. handoff/lp-corp-audit-continue-2026-05-25.md と handoff/design-audit-continue-2026-05-25.md を確認。
2. 既存 manifest audit runner の正確なコマンドを特定し、必要なら doc に追記。
3. sample manifest を /tmp または docs/evidence に作り、runner が artifact を出す最短手順を検証。
4. Lighthouse / security header check の保存先と naming を揃える。
5. PR を作成。コード変更は最小、監査 handoff と再現手順を主成果物にする。
```

## 未解決

- `sample-project-lp` と `sample-labo` の正確な repo / URL / Figma node はこの handoff 時点では未固定。
- Figma API 実行には token が必要。PR に token や private URL を含めない。
- Lighthouse は network と Chrome 実行環境に依存するため、CI に入れる前に local artifact 保存を先に固める。
