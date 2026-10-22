# #376 のNode26統合検証

最新develop `083cf600754be070366b964e9295f2143efc437f` を、独立したローカルブランチ `codex/issue-376-node26-integration-20261022` へ取り込んだ。統合commitは `d32e48270d649a0a4d5afa7d3719a010cb7cdc42`、両親は#376修正 `cd4f6ffed9ecb22d0469d8f76c34c3b994280bd9` とdevelop。競合はなく、継承した差分は `.mise.toml` と `package.json` のNode26.12.1指定だけである。Node更新の再実装、PRのmerge、本流へのpushは行わない。

[統合情報](integration.json)と[検証台帳](validation.json)へ対象commit、source/test/dist/lockfileのSHA256、実行コマンド・終了値・ログを保存する。#376の17ファイルはNode25検証時からバイト一致し、mobile-captureとlockfileは不変。UI変更がないためUI前後画像は対象外で、比較用PNGの入力ハッシュを以前の検証と照合する。

## 実行環境と検査

公式配布のNode26.12.1 Linux x64をHTTPSで取得し、同じ配布元のSHASUMS256.txtとSHA256 `6170b2d474e1c626f43cff3adc118df9fe3b573258a4fc3d850c8dbc6b079bbd` を照合した。実行時のNodeは26.12.1、pnpmは9.15.0。

`TURBO_CACHE_DIR=/tmp/designdiff-node26-cache-cd4f6ff` は実行前に存在しない専用ディレクトリを使用した。型検査は10/10 taskを実行し、全7パッケージのtest taskもcache missで実行した。buildの一部は同じNode26実行内で作成したcacheを再利用しており、Node25の結果をNode26の合格へ流用していない。

- `pnpm typecheck`、shared/MCPの追加テストを対象にした明示的`tsc --noEmit`、`pnpm lint:eslint`が成功。ESLintは0 error・既存2 warning。
- `python3 docs/evidence/issue-376-cloud/reap-children.py task ci:fast` が成功。shared699、MCP950を含む全3067ユニットテスト、root Node59成功／0失敗／Windows専用1skip。
- supervisorは既存containerの子プロセス回収だけを補い、フック・テスト内容・チェック項目を維持する。実ログと元ログのSHA256を台帳へ保存する。

## 実プロセスの対照と33検体

[元4対照](stroke-runtime.json)は5→7px／7→9px × PNG／sectionの全件がFAILとなり、全件にcritical `opaque_stroke_width_change` がある。以前のRED入力と同一raw/PNGハッシュ・同一section情報で検証した。PNG2件は公開MCPと保存レポート取得、section2件は別Nodeプロセスのbuilt `compareImages` APIであり、実Figma host/API検証とは区別する。

[既存8対照](reflow-runtime.json)も全件期待どおり。不透明coreを保つAA差と1px移動のPASS、2px／56px、欠落、太線化、色変更、opt-inなしのFAILを維持する。

[33検体](inventory.json)は元の画像SHA256と期待ラベルを維持して実行する。既存PASS宣言との不一致12件、宣言上の誤PASS0件を維持し、[独立分類](../issue-376-continuation/README.md)の実差11件と原因未確定pair-18を分ける。#375の誤FAILゼロや#376全体完了とは扱わない。

## 維持する不足と未検証範囲

[pair-18の不足入力](../issue-376-stroke-guard/pair-18-inputs.md)は継続する。元画像へhashで対応する撮影commit／receipt、使用TTFと実際のweight・fallback、対応するFigma text subtree、engine・baseline等の実測がない。親からの追加調査でもGitHubにhashで結び付くreceiptは見つからず、元Devinリンクはログイン境界だったという報告を受けた。今回その認証境界を越える操作はしていない。現在のFigmaを過去撮影の根拠にはしない。

macOS実Desktop、Retina、実フォント描画、実Figma host/APIは未検証。実画像の新規コピー・アップロード、認証・通信・本番設定の変更、追加契約、外部連絡、手動CI実行、draft解除、force pushは行わない。
