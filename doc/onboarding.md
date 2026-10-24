# オンボーディング

初めて参加した人が、FigDiff をローカルで起動するまでの手順です。
日常の操作は [開発ガイド](dev-guide.md) を参照してください。

## 1. 前提ツールを用意する

- Git
- [mise](https://mise.jdx.dev/)（インストール後、使うシェルで有効にする）
- Node.js: [`.mise.toml`](../.mise.toml) の `26.12.1`。最低条件は [package.json](../package.json) の `engines` を参照。
- pnpm: `package.json` の `packageManager` に合わせて `9.15.0`
- Desktop の起動には画面を表示できる環境が必要。Linux / WSL では GUI と Electron の OS 依存ライブラリも必要。

Docker や Task は初回起動には不要です。Task は [ローカル CI](ci-local.md) の任意の入口です。

## 2. 取得してツールを合わせる

```bash
git clone https://github.com/kouiso/designdiff.git
cd designdiff
mise trust
mise install
node --version
pnpm --version
```

`mise trust` は設定を確認してから実行します。`.mise.toml` の pnpm 指定は `9` なので、
`9.15.0` と異なる場合は、このシェルだけ指定を合わせます。

```bash
mise install pnpm@9.15.0
mise shell pnpm@9.15.0
pnpm --version
```

Corepack の署名エラーで pnpm が起動しない場合も、上の mise 管理の pnpm を使います。
別の方法で直接導入する場合は `npm install --global pnpm@9.15.0` とし、版を固定してください。

## 3. 依存を導入してビルドする

以降はリポジトリのルートで実行します。

```bash
pnpm install --frozen-lockfile
pnpm build
```

共通パッケージの `dist` を先に作ります。初回から開発サーバーだけを動かすと、
共通パッケージを読み込めない場合があります。
通常の起動に `.env` の作成や git-crypt の復号は不要です。
Figma を使うときの認証は、起動後に設定します。

## 4. 起動を確認する

```bash
pnpm dev
```

Desktop のウィンドウが開き、ホーム画面が表示されれば初回起動は完了です。
同時に Figma plugin / Chrome extension のビルド監視と MCP の TypeScript 監視も始まります。
MCP の監視だけでは MCP サーバープロセスは起動しません。
終了するときは端末で `Ctrl+C` を押します。

画面のないクラウド環境などで Web 表示を確認する場合は、別の入口を使います。

```bash
pnpm --filter @figdiff/desktop dev:web
```

表示された URL（既定は `http://localhost:5174`）を開き、ホーム画面を確認します。
これは Web の確認です。Web ではプロジェクトの保存は使えず、その制約が画面に表示されます。
Electron の IPC、OS の認証保存、ネイティブ表示の確認は含みません。

## 5. 最初の比較をする

Desktop での手順です。Figma を読むには、対象ファイルへのアクセス権と Personal Access Token が必要です。

1. Figma の設定から Personal Access Token を取得する。
2. FigDiff の設定画面でトークンを登録する。
3. プロジェクトを作り、実際に比較する Figma URL を指定する。
4. 取得した一覧から対象フレームを選ぶ。
5. 実装のスクリーンショットを選択、またはドラッグして読み込む。
6. 比較結果の原画像と差分を確認する。Overlay 表示では重ねて確認できる。

トークンは文書やコミットに含めません。AI から使う場合は [MCP の接続と比較](dev-guide.md#mcp) へ進んでください。

## 変更を始める前に

TypeScript のファイル・ディレクトリ名は、英語・小文字・単数形の kebab-case を基本にします。
関連するファイルはドメインごとに浅くまとめます。`horse.icon.tsx` のように役割を名前に含めると、
`Icon/index.ts` のように階層をたどらず内容が分かります。役割の接尾辞は必要な場合だけ付けます。
言語の識別子やツールが決めた名前は別の規約です。[命名の詳細と例外](dev-guide.md#命名規約) を読んでください。

起動できない場合は [デバッグ](dev-guide.md#デバッグ) でログと実行環境を確認します。
