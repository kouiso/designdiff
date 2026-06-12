# Figma Credential Preflight

最終確認日: 2026-05-08

このメモは、secret 値を露出せずに FigDiff の Figma credential blocker を判定するための現状整理です。

## Credential 経路

| 対象 | credential 取得経路 | 保存先 / env | 備考 |
| --- | --- | --- | --- |
| MCP server | `createFigmaService()` が環境変数を読む | `FIGMA_TOKEN` | PAT 前提。`.env.example` は値を空にし、PAT-only / OAuth unsupported / no real token commit をコメントで明記 |
| Desktop Electron | Settings UI -> preload -> IPC `token:save` -> `safeStorage`。設定状態確認は `token:has` の boolean のみ | Electron `app.getPath("userData")/credentials.enc` の `figma-token` | packaged では OS Keychain 暗号化が必須。dev のみ plaintext fallback。renderer/store は token 値を保持しない |
| Desktop web adapter | Settings UI -> platform token adapter | `localStorage` key `figdiff:figma-token` | Web mode 用。secure storage capability は false。保存/読込時に PAT 形状を検証し、古い不正保存値は削除 |
| Chrome extension | Popup -> background -> token service | `chrome.storage.local` key `figma_token` | extension local storage。保存/読込時に PAT 形状を検証。popup の `token:get` response は token 値を返さず `hasToken` のみ。`test` script で token contract smoke を実行 |
| Figma plugin | REST credential 経路なし | なし | Figma plugin API の選択ノード export が中心 |

## OAuth / PAT 設定

- 現行コードに OAuth client 設定はない。`FIGMA_CLIENT_ID`、`FIGMA_CLIENT_SECRET`、redirect URI、refresh token の env / storage / flow は未実装。
- REST client は `package/shared/src/figma-client.ts` で `X-Figma-Token` header だけを送る。OAuth の `Authorization: Bearer` header は未対応。
- PAT の UI / shared schema は `figd_` prefix、20 文字以上、空白や制御文字を含まない printable ASCII を要求する。MCP preflight、shared `FigmaClient`、Chrome extension token storage、Desktop web adapter、Electron adapter / safeStorage、setting store も同じ判定に揃えた。
- Figma 公式 docs 上、PAT は `X-Figma-Token` header、OAuth 2 token は `Authorization: Bearer` header を使う。Figma file 読み取りには少なくとも `file_content:read` scope が必要。

参照:
- https://developers.figma.com/docs/rest-api/personal-access-tokens/
- https://developers.figma.com/docs/rest-api/oauth-apps/
- https://developers.figma.com/docs/rest-api/scopes/

## Gate 分離

| Gate | 実 credential 要否 | この gate で確認できること | この gate で確認しないこと |
| --- | --- | --- | --- |
| mock / unit / static | 不要 | PAT 形状検証、OAuth-shaped token 拒否、secret 非露出、URL parser、Figma API request 組み立て、cache path/log hygiene、guard 再混入検知 | 実 token の有効性、Figma file 権限、scope、rate limit、実画像一時 URL の download 成否 |
| browser smoke | 不要 | Desktop production web bundle の描画、白テーマ、settings dialog の accessibility、水平 overflow なし、screenshot 生成、dev server / port 依存なし | Figma REST API、OAuth flow、PAT 権限、Figma URL の frames/images/node details |
| runtime / port smoke | 不要 | MCP stdio server が短時間で落ちないこと、clean shutdown、Playwright が port 衝突時に既存 process を再利用しないこと | Figma API credential の生存確認、401/403/scope/file permission |
| real Figma PAT/API | 必要 | PAT の実有効性、file access、`list_figma_frames` / Figma URL `compare_design` / `inspect_node` / `get_design_tokens`、temporary image URL download | OAuth flow。現行コードは PAT-only |
| real Figma OAuth/API | 必要、かつ未実装 flow が必要 | OAuth bearer token path、client id/secret/redirect/refresh-token、scope consent、OAuth token refresh | 現行 `FIGMA_TOKEN` PAT route の代替としては扱わない |

## Credential なしで完了扱いにできる範囲

- `compare_design` の `design_source` がローカル画像パスの場合の pixel diff。
- `generate_diff_report`、`get_crop_region`、`set_crop_region` など Figma API に触らない MCP tool。
- URL parser、image compare、crop region、report generation、credential preflight の unit test / typecheck / lint。
- Desktop の token 入力 UI、保存 IPC の mock test、theme/local gate。実 credential の保存値は表示しない。
- Desktop white-theme の real browser visual smoke は `pnpm --filter @figdiff/desktop build:web` 後に `pnpm --filter @figdiff/desktop smoke:white-theme` で確認する。これは production web bundle を headless Chromium に読み込ませ、desktop と mobile 幅で白背景、dark foreground token、stale `.dark` なし、テーマ toggle の accessible state と初期 light state、settings dialog が1つだけ存在すること、`aria-modal=true`、`aria-labelledby` / `aria-describedby` と参照先テキスト、close button の accessible label、theme radiogroup の accessible label と light/dark checked state、theme radio の `aria-checked` が全て `true` / `false` のいずれかで checked option がちょうど1つであること、settings dialog の四辺が viewport 内に収まること、version 表示、console/page error なし、水平 overflow なしを検証する。home と settings dialog の screenshot をそれぞれ残し、screenshot byte size、PNG signature、viewport 幅一致、viewport 以上の高さも確認する。dev server を開かず route interception で bundle を配信し、bundle route は `dist/web` 外の path を 404 にするため、port 衝突や外部 path 混入を smoke 成功と混同しない。
- Success path の fake token / mock token は `figd_` prefix かつ 20 文字以上の syntactic fake PAT に限定する。OAuth 風 token は negative path でだけ使う。
- Chrome extension の token / background error contract は `pnpm --filter @figdiff/chrome-extension test` で検証する。既存の `esbuild` で token service / background を一時 bundle し、mock `chrome.storage.local` 上で trim 保存、OAuth-shaped token 拒否、古い invalid storage 削除、secret 非露出、background の unknown error 固定文言化、upstream redacted Figma API error のみ allowlist されることを確認する。
- Chrome extension popup は初期表示に token 値を必要としないため、background の `token:get` は `{ hasToken: boolean }` のみを返す。保存済み token 値は Figma API 呼び出し直前の background service 内に閉じる。
- Chrome extension background は `token:get` / `token:clear` の storage failure でも response を返し、unknown exception message や token-shaped text を popup へ渡さない。popup も clear failure を成功扱いせず、固定文言を表示して token configured state を維持する。
- Chrome extension background は Figma frames/image request 前の token read でも storage failure を固定文言で `sendResponse` し、unhandled rejection や response timeout にしない。この gate は storage mock failure で `readFigmaRequestToken` を通す contract smoke で確認する。
- Chrome extension background は `token:set` / Figma request の unknown failure を popup へ返すとき、未知例外や `String(error)` をそのまま返さない。invalid token など既知の secret-safe message だけを allowlist し、それ以外は固定文言へ落とす。
- Chrome extension popup は frame fetch 前と frame image fetch 前に shared parser の結果が `figma_url` であることを確認する。local path / lookalike domain / stale URL state は background の Figma API path へ送らない。
- Desktop Electron renderer も初期表示に token 値を必要としないため、preload/IPC は `token:has` の boolean status のみを公開する。Figma API 呼び出し時の token 読み取りは main process の Figma IPC handler 内に閉じる。
- Desktop token 設定 UI は、保存/削除失敗時に adapter や storage 由来の unknown exception message を画面へそのまま出さない。入力検証は fixed invalid-token message / 翻訳済み validation text で扱い、保存失敗は固定文言だけを表示する。
- Desktop Electron token IPC は、`token:save` の unknown exception message をログや renderer 側 error へそのまま渡さない。secret-safe な既知固定文言だけを allowlist し、それ以外は固定の保存失敗文言へ落とす。
- Desktop Electron token IPC の fixed-error contract は `app/desktop/electron/ipc/token.test.ts` で回帰確認し、通常の `pnpm --filter @figdiff/desktop test` に含める。
- Desktop Electron Figma IPC は、`figma:get-frames` / `figma:get-frame-image` / `figma:get-node-detail` の unknown exception message を renderer 側 error へそのまま渡さない。shared Figma client の既知 secret-safe message だけを allowlist し、それ以外は固定の Figma request 失敗文言へ落とす。この fixed-error contract は `app/desktop/electron/ipc/figma.test.ts` で回帰確認し、通常の `pnpm --filter @figdiff/desktop test` に含める。
- Desktop renderer の project store は、Figma frames/image 取得失敗時に unknown exception を `String(error)` でそのまま UI state へ入れない。secret-like な error text は固定の load failure 文言へ落とし、known credential/API errors だけ token dialog 判定へ使う。この contract は `app/desktop/src/store/project-store.test.ts` で回帰確認する。
- Desktop Electron safeStorage は資格情報ファイル parse/decrypt failure の例外オブジェクトをログへ出さず、secret-safe な固定文言だけを記録する。
- Desktop Electron の Figma 画像 cache は file key / node id を filesystem-safe 文字へ正規化してから path を組み立てる。cache read failure も例外オブジェクトや stack をログへ出さず、固定文言だけを記録する。
- Repo-level credential guard は `pnpm guard:figma-credentials` で実行する。`app/`、`package/`、`doc/`、`prompt/` と root の `.env.example` / `document.md` / `README.md` / `CLAUDE.md` / `package.json` を走査し、Desktop token-value getter、unsafe safeStorage / cache logs、old header/env/mock patterns、URL echo error、Chrome `token:get` secret response、token validation の raw `FigmaTokenSchema.parse()` 再混入、Desktop cache node id sanitizer の欠落、root script への旧 runtime env 再混入を検出する。
- Guard 自体の契約は `pnpm guard:figma-credentials:selftest` で確認する。clean fixture が通り、intentional bad fixture が各 credential check で失敗することを検証する。
- MCP runtime は build 後に `pnpm --filter @figdiff/mcp-server smoke:runtime` で短時間終了しないことを確認できる。既定は 5 秒。直近に runtime/test failure がある場合や監察向け証跡には `pnpm --filter @figdiff/mcp-server smoke:runtime:stable` を使い、30 秒存続と clean shutdown を確認する。短すぎる probe/shutdown 設定の拒否は `pnpm --filter @figdiff/mcp-server smoke:runtime:selftest` で固定する。
- MCP tool の error response は `app/mcp-server/src/tool/error.ts` の allowlist formatter を通す。Figma credential / URL / request validation など既知の secret-safe message だけを返し、unknown error や `String(error)` は固定文言へ落とす。
- MCP package の通常 `test` script は shared build、unit tests、runtime smoke self-test を実行する。Chrome extension / Desktop の通常 `test` script も shared build を先に実行し、direct filtered test が古い shared dist を参照する stale-build 条件を避ける。root/turbo test 経由でも `^build` で依存 build を要求する。
- Desktop/E2E dev servers は `127.0.0.1` + fixed port + `strictPort` で起動し、port 衝突時に別プロセスへ接続しない。

## Credential なしでは完了扱いにしない範囲

- Figma URL を使う `compare_design` の画像取得。
- `list_figma_frames`、`inspect_node`、`get_design_tokens`。
- 実 Figma file 権限、scope、rate limit、画像一時 URL download の確認。
- OAuth flow の確認。現行実装には OAuth flow がないため、OAuth token を `FIGMA_TOKEN` に入れてもサポート対象外。
- PAT の実有効性、Figma file 共有権限、組織 policy による 401/403 は実 credential 環境でしか確認できない。
- Desktop/E2E の実ブラウザ操作は別途 Playwright 実行が必要。port 衝突時は fail-fast にしたため、既存プロセスの再利用は完了証跡にしない。
- `smoke:white-theme` は Figma API を呼ばないため、Figma URL の frames/images/node details、credential validity、file permission、scope、temporary image URL download の代替証跡にはしない。browser rendering PASS と real Figma OAuth/API PASS は別 gate として記録する。

## Preflight 方針

- MCP は `FIGMA_TOKEN` の未設定 / 不正形状をネットワークアクセス前に判定する。
- エラー文は env 名、PAT 要件、credential なしで使える local image path を案内し、設定値は含めない。
- Shared `FigmaClient` でも PAT 形状を判定し、MCP 以外の consumer から OAuth 風 token が API へ流れる抜けを塞ぐ。
- Shared `FigmaClient` は PAT-shaped でも内部改行や空白を含む値を network 前に拒否する。header 値へ渡る前に止め、エラー文に設定値を含めない。
- Shared `FigmaClient` は Figma API error body に設定済み token と同じ文字列、URL-encoded variant、JSON-escaped variant が反射された場合、例外 message へ入れる前に `[REDACTED_FIGMA_TOKEN]` へ置換する。さらに設定 token と一致しない token-shaped text も同じ固定 redaction に落とし、client 単体の error message からも secret-like text を出さない。
- Shared `FigmaClient` は Figma images API が返す temporary image URL を HTTPS に限定し、download fetch の reject / non-OK error では temporary image URL や statusText を echo しない。
- Shared `FigmaClient` は Figma REST request の numeric parameter も network/cache 前に検証する。`depth` は 1 以上の safe integer、image `scale` は finite positive number だけを許可する。
- Shared Figma URL parser は invalid URL の例外 message に入力文字列を含めない。誤入力 URL の query に secret が混ざっても UI / log へ出さない。
- Shared Figma URL parser は HTTPS かつ `figma.com` / `*.figma.com` hostname を構造的に検証する。`evilfigma.com` などの lookalike domain、non-HTTPS URL、local path 中の `figma.com` は Figma URL 扱いせず、credential preflight / Figma API path へ進めない。
- Shared Figma URL parser と `FigmaClient` は file key / node id を構造検証する。unsafe `node-id` は Figma API path へ送らず、node id は `URLSearchParams` 経由で request URL に入れる。cache path も未検証 node id を raw path segment として扱わない。
- Desktop setting store と web adapter は、保存時に前後空白を除去して PAT 形状を検証する。読込時に不正な保存値を見つけた場合は configured 扱いにせず削除する。
- Runtime smoke は stdin を開いたまま MCP stdio server を起動し、既定 5 秒以内に落ちた場合を failure とする。`FIGDIFF_RUNTIME_SMOKE_MS` は 1500ms 未満、`FIGDIFF_RUNTIME_SHUTDOWN_MS` は 500ms 未満を拒否する。`smoke:runtime:selftest` はこの下限拒否を実行証跡として固定する。`smoke:runtime:stable` は `FIGDIFF_RUNTIME_SMOKE_MS=30000` / `FIGDIFF_RUNTIME_SHUTDOWN_MS=3000` で、短時間 runtime 扱いを避けるための安定確認用 gate。
- preflight は secret の生存確認をしない。実 API の 401 / 403 / scope / file permission は、private credential を持つ環境で Figma URL tool を実行した場合だけ判定できる。
