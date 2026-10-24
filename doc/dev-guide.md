# 開発ガイド

初回の準備は [オンボーディング](onboarding.md) を参照してください。
コマンドは特記がなければリポジトリのルートで実行します。

## コマンドの役割

`package.json` が日常のコマンドの入口で、Turbo が各 workspace の処理を実行します。
`pnpm --filter <workspace名> <script名>` で対象を絞れます。
[Taskfile.yml](../Taskfile.yml) はローカル CI の入口です。コンテナ用のコマンド分けはありません。

| コマンド | 用途 |
| --- | --- |
| `pnpm dev` | 全 workspace の開発監視。端末の出力を `.logs/dev-<timestamp>.log` にも保存 |
| `pnpm dev:raw` | 同じ開発監視をログ保存なしで実行 |
| `pnpm --filter @figdiff/desktop dev:web` | Web 表示を起動（既定ポート 5174） |
| `pnpm build` | 共通パッケージから依存順に全体をビルド |
| `pnpm test` | 各 workspace のテストとルートの Node.js テスト |
| `pnpm typecheck` | 全 workspace の型検査と shared の追加テスト型検査 |
| `pnpm lint` | MCP の新規関数宣言の検査と各 workspace の Biome 検査 |
| `pnpm lint:arrow` | MCP ソースの追加行の関数宣言を検査 |
| `pnpm lint:eslint` | 型情報を使う ESLint 検査。`pnpm lint` とは別に実行 |
| `pnpm check` | リポジトリ全体の Biome 検査（整形と lint） |
| `pnpm check:naming` | 追跡済みパスの命名検査。意味や役割の妥当性は人も確認する |
| `pnpm logs:digest --since 2h` | 直近2時間の警告・エラーを集約 |
| `pnpm format` / `pnpm lint:fix` | 整形 / 自動修正。実行後は対象外の変更がないか差分を確認 |

ローカルで CI と同じ処理を実行する入口は [ci-local.md](ci-local.md) にあります。
`task ci:fast` は導入・命名・lint・build・test、`task ci` はブラウザなども含む全検査です。
Task を使わない場合は `node script/ci.mjs <phase>` を使えます。
Linux の画面検査は xvfb とブラウザの OS 依存ライブラリが必要です。

## パッケージ管理

pnpm と `pnpm-lock.yaml` を使います。通常の取得は `pnpm install --frozen-lockfile` です。
追加・削除は、その依存を使う workspace を指定します。

```bash
pnpm --filter @figdiff/desktop add <package-name>
pnpm --filter @figdiff/desktop add -D <package-name>
pnpm --filter @figdiff/desktop remove <package-name>
```

ルートで使う開発ツールだけを追加する場合は `pnpm add -Dw <package-name>` を使います。
対象の `package.json` と lockfile を一緒に確認し、build・型・lint・テストを実行します。
Node.js は `.mise.toml` と `engines`、pnpm は `packageManager` の指定を基準にします。

## デバッグ

- 起動や import のエラー: `node --version` と `pnpm --version` を確認し、`pnpm build` で共通パッケージを更新する。
- ログ: `pnpm dev` の `.logs/`、Electron の `main.log`、MCP の `~/.figdiff/logs/` を `pnpm logs:digest` で確認する。
- Electron main: `pnpm --filter @figdiff/desktop dev:debug` で起動し、Node.js デバッガーをポート `5858` に接続する。
- Renderer: 開発時に開く DevTools の Console / Network / ブレークポイントで確認する。CDP ポートは `9236`。`FIGDIFF_DEVTOOLS=0` で自動表示を止められる。
- 詳細ログ: `FIGDIFF_LOG_LEVEL=debug pnpm dev` を使う。共有前に認証情報などを確認する。
- macOS のネイティブ画面確認: debug 起動後、別端末で `pnpm verify:native` を実行する。スクリプトは macOS 専用で、画面収録などの OS 権限が必要。

MCP の stdout は JSON-RPC の通信路です。診断ログは stderr（`console.warn` / `console.error`）へ出します。
WSL や sandbox では、サーバーから見た `localhost` がホストの開発サーバーに届くとは限りません。
既存 Chrome を使う場合の `FIGDIFF_CDP_ENDPOINT` も、MCP プロセスから接続できる URL にします。
未指定なら Chromium を起動します。必要に応じて `node script/ci.mjs browser` で Playwright のブラウザを準備します。

## コーディング規約

[AGENTS.md](../AGENTS.md) と実際の Biome / ESLint 設定を確認します。
コメントは日本語で理由を書き、コミットは英語の Conventional Commits にします。
`any`、`@ts-ignore`、根拠のない型アサーションや lint の無効化で問題を隠しません。
React のコンポーネントと型は PascalCase、関数と変数は camelCase など、言語の規約に従います。
MCP の新規・変更する処理は `const` に代入するアロー関数にします。
利用者に影響する動作変更には [CHANGELOG.md](../CHANGELOG.md) も更新します。

### 命名規約

- 自分たちで決める TypeScript のパスは、英語・小文字・単数形の kebab-case を基本にする。単複の判断を減らし、探す場所と表記をそろえるため。
- 関連するファイルはドメインごとに浅くまとめる。例: `horse/horse.ts`、`horse/horse.icon.tsx`、`horse/horse.test.ts`。同じドメインの実装・表示・検査を近くに置く。
- 役割が分かりやすくなる場合は `horse.icon.tsx` のような接尾辞を使う。複数の拡張子を避けるためだけに `Icon/index.ts` のような階層を増やさない。全ファイルへ機械的に接尾辞を付ける必要はない。
- 変数・型・関数・コンポーネント名を kebab-case にしない。MCP のツール名や JSON のキーなど、公開 API も別の契約として扱う。
- `README.md`、`AGENTS.md`、`Taskfile.yml`、`tsconfig.json`、`vite.web.config.ts`、`*.test.ts`、`*.d.ts` は慣習やツールの役割を保つ。
- package の `index.ts` は `main` / `exports` / `bin` の入口として使われている。機械的に改名しない。`__mock__` や `.github/workflows` なども、利用ツールと設定の参照を確認する。
- 生成物・外部コード・フレームワークの予約名は、その契約を優先する。例外は対象と理由を記録する。一般の自作ファイルを例外扱いして回避しない。

改名前に import、動的 import、テストの mock、ビルド入口、公開 export、ルート、生成元を調べます。
大小文字だけを変える場合も、大文字小文字を区別しない OS の衝突を確認します。
Biome の [useFilenamingConvention](https://biomejs.dev/linter/rules/use-filenaming-convention/javascript/) は JS / TS のファイル名を検査します。
既存の [命名チェッカー](../script/check-naming.mjs) は追跡済みパスの大小文字・区切りと、一覧に登録した複数形ディレクトリを検査します。
例外の対象と理由もこのファイルで管理し、`script/check-naming.test.mjs` で検証します。
機械検査だけでは英語の単数形やドメインのまとまりは判定できません。`status` / `lens` などを末尾の `s` だけで複数形と判断しません。

## プロジェクトの知識

| 場所 | 役割 |
| --- | --- |
| `app/desktop/src` | React の画面。状態管理は Zustand、Web と Electron の差は platform adapter で扱う |
| `app/desktop/electron` | main / preload / IPC と OS の機能 |
| `app/mcp-server` | AI 向け MCP サーバー。stdio で接続 |
| `app/figma-plugin` | Figma sandbox と iframe UI。`build.mjs` が別々に bundle |
| `app/chrome-extension` | Chrome の background / content / popup。`build.mjs` が bundle |
| `package/shared` | 型・Figma クライアント・画像比較・レポートの共通処理 |
| `package/credential-store` | Desktop / MCP の認証情報の解決 |
| `package/mobile-capture` | Android / iOS / Flutter のキャプチャ。追加の端末ツールが必要 |

React / TypeScript / Vite / Tailwind CSS と Electron を使います。版は各 `package.json` と lockfile が正です。
[モバイルキャプチャ](../package/mobile-capture/README.md)、[API](../docs/api/mcp-tools.md)、
[レポート仕様](../docs/api/diff-report-schema.md)、[テスト方針](../docs/test-strategy.md) も参照してください。
既存の `docs/` の仕様や検証証跡はそのまま参照し、この文書のために一括移動しません。

画素比較は `package/shared/src/pixel-compare.ts` の `comparePixels` に集約します。
直接 pixelmatch を呼ぶと半透明画素の合成条件がずれるため、独立した検証 oracle 以外では迂回しません。

### MCP

ビルド済みの `app/mcp-server/dist/index.js` を AI ツールから起動します。
次のパスを実際の絶対パスに置き換え、`FIGMA_TOKEN` は AI ツールの環境変数で渡します。
接続前に `pnpm build` を実行し、ビルド更新後は MCP サーバーを再起動します。

```json
{
  "mcpServers": {
    "figdiff": {
      "command": "node",
      "args": ["/absolute/path/to/designdiff/app/mcp-server/dist/index.js"]
    }
  }
}
```

初期化の instructions と `tools/list` に、現在のツールと入力スキーマが含まれます。
別の個人用 skill は不要です。各 AI ツールへの登録は [MCP README](../app/mcp-server/README.md#registration) を参照してください。
トークンが必要な操作では PAT と対象ファイルへの権限を用意し、認証情報やフレームを推測しません。

1. `list_projects` で保存済みの対象を確認する。新規なら `list_figma_frames` で選択し、`create_project` で保存する。
2. `compare_design` に `design_source` と、スクリーンショットの入力を1つ渡す。
3. 原画像と比較条件を確認し、`inspect_node` / `get_design_tokens` で実装を調べる。
4. 同じ修正作業では `campaign_id` を維持し、新しい作業では新しくする。再撮影して `verify_fix` で変化を確かめる。
5. `loopGuard.stop` が true なら理由を報告して止める。停止情報がない場合や `UNCERTAIN` は調査する。一致率だけで正しさを決めず、100% になるまで繰り返さない。
6. 返された `comparisonId` で `generate_diff_report` を呼び、詳細を確認する。

#### 保存済み画像の比較

画像は MCP プロセスから読めるパスを指定します。URL の `FILE_KEY` と node ID は実際に選んだフレームに置き換えます。

```json
{
  "name": "compare_design",
  "arguments": {
    "design_source": "https://www.figma.com/design/FILE_KEY/Project?node-id=1-2",
    "screenshot": "/absolute/path/to/screenshot.png",
    "campaign_id": "homepage-layout-task"
  }
}
```

`compare_design` の旧引数 `figma_url` / `screenshot_path` は使いません。
`inspect_node` などは固有の `figma_url` 引数を使うため、ツールごとにスキーマを確認します。

#### Web の撮影と端末の撮影

`screenshot` の代わりに `screenshot_url` を指定します。必要なら既知の viewport 幅も指定します。

```json
{
  "name": "compare_design",
  "arguments": {
    "design_source": "https://www.figma.com/design/FILE_KEY/Project?node-id=1-2",
    "screenshot_url": "http://localhost:5173",
    "campaign_id": "homepage-layout-task"
  }
}
```

接続済み端末では、画像パスや URL の代わりに `capture_device`（`android` / `ios-sim` / `ios-device`）を使います。
端末と専用ツールの準備が必要です。

#### 比較条件と詳細レポート

画像の寸法は viewport の寸法とは限りません。同じ 390×1839 の画像でも、
viewport の高さが 693 と 1839 なら bottom sheet の位置は変わり得ます。
位置を直す前に、既知の条件を `comparison_conditions` に渡します。
`design` / `screenshot` の各側で `viewport: {width, height}` は論理 px、
`pixelRatio` は論理 px あたりの物理 px、`origin: {x, y}` は共通の基準に対する画像左上の論理 px です。

応答は画像の実測寸法と申告条件を分け、`compatible` / `mismatch` / `unverified` を示します。
欠けた条件は未検証です。同じ値を申告しても独立した証明にはなりません。
viewport / origin が不一致なら `UNCERTAIN` として撮影条件を調べます。
この申告自体は画像を移動・crop しません。実際の補正は `normalization` と `diffReport.alignment` を確認します。

`compare_design` はコンパクトな結果と要約を返します。完全な `diffReport` / `gridSummary` は次で取得します。
例の ID は、比較時に返された正確な `comparisonId` に置き換えます。

```json
{
  "name": "generate_diff_report",
  "arguments": {
    "comparison_id": "cmp-from-compare-design",
    "format": "json"
  }
}
```

位置合わせ・領域別スコア・issue と根拠を読み、原画像と撮影条件を独立した証拠として残します。

#### 複数画面とその他の操作

画面遷移全体は `compare_design_batch` に全フレームを渡します。
入力順に比較し、各フレームの `status` / `loopGuard` / `comparisonId` と、
全体の件数・`convergence`・複数画面に共通する `recurringIssues` を返します。
1画面の実行エラーは `ERROR` となり、残りの画面は続行します。詳細は各 `comparisonId` で取得します。

```json
{
  "name": "compare_design_batch",
  "arguments": {
    "campaign_id": "checkout-flow",
    "frames": [
      { "label": "home", "design_source": "./design/home.png", "screenshot": "./screenshots/home.png" },
      { "label": "detail", "design_source": "./design/detail.png", "screenshot": "./screenshots/detail.png" }
    ]
  }
}
```

プロジェクトの削除、crop、ignore region、アニメーション比較、認証、feedback のツールは
[ツール一覧](../app/mcp-server/README.md#available-tools) と [API](../docs/api/mcp-tools.md) で確認します。
本当の配置・文字の不具合を ignore region で隠しません。マスク候補は意図的な差の証明ではありません。
issue を報告する前に、同じ再現・原因の issue / PR がないか確認します。

### 暗号化されたファイル

個人・内部設定の一部は git-crypt で暗号化されています。通常の起動に復号は不要です。
アクセス権と鍵を持つ場合だけ `git-crypt unlock /path/to/git-crypt-key` で復号します。

### ライセンス

All rights reserved です。閲覧だけでは利用権は得られません。
利用者を指定した書面の許諾が必要です。[LICENSE](../LICENSE) と [許諾書式](license-grant-template.md) を参照してください。
