# AI 共通ルール・Skill の管理 (Issue #386)

開発 AI (Claude Code / Codex / Gemini / Copilot / Cursor / OpenCode / Devin など) を切り替えても、同じ開発ルールと再利用可能な Skill を使えるようにするための構成と運用をまとめる。
最終更新: 2026-11-27。ここに書いた「検証済み」は、この文書の作成時にコンテナ内で実際に実行して確かめたものだけ。それ以外は「公式ドキュメント上の記載 (未検証)」か「入口なし」と明記する。

## 1. 決定事項

- 同期の仕組みは `script/sync-ai-rules.sh` の 1 本だけ。別の仕組みを足さない。
- 共通ルールの正本は `AGENTS.md` (詳細ルールは `prompt/instruction/`)。生成物は手で編集しない。
- 共通 Skill の正本は `.agents/skills/<name>/`。Claude Code 向けには `.claude/skills/<name>/` へ生成コピーを置く。
- 新しいシンボリックリンクは作らない。既存の 35 本 (`.claude/rules` 7 / `.claude/agents` 18 / `.claude/contexts` 3 / `.github/instructions` 7) には触れない。
- 暗号化ファイル (git-crypt) は読まない・コピーしない・生成しない。同期スクリプトも先頭バイトが暗号文なら拒否する。
- 秘密情報・MCP 認証・AI ごとの権限設定 (`.claude/settings.json`、`.mcp.json` など) は配布対象にしない。
- `GEMINI.md` と、`AGENTS.md` の Claude 向けコピー (`.claude/rules/agents-md.md` など) は追加しない。
  - 理由: `CLAUDE.md` は暗号化されていて中身を確認できないが、PR #435 のコミット `3ccab66` のメッセージ (平文) が「point CLAUDE.md to AGENTS.md as the shared rule source」で、`AGENTS.md` を指している可能性が高い (+124 バイトの変更。中身は未確認)。コピーを足すと同じ内容を二重に読み込む。Copilot は `AGENTS.md` を直接読むうえ `GEMINI.md` も読む可能性があり、さらに増える。
  - Claude Code が `AGENTS.md` を自動で読むかどうかは、実行環境によって観測が割れた (6 章)。これを埋めるかどうかは、鍵を持つ人が `CLAUDE.md` の中身を確認してから決める (8 章)。

## 2. ファイル一覧と役割

役割: SoT = 正本 (手で編集) / GEN = 生成物 (編集禁止) / AI固有 = その AI だけが読む (共通化しない)。

| パス | ファイル数 | 役割 | 生成元・方法 | 暗号化 |
|---|---|---|---|---|
| `AGENTS.md` | 1 | SoT (共通ルールの入口) | 手書き | なし |
| `CLAUDE.md` | 1 | AI固有 (Claude) | 手書き | あり (git-crypt) |
| `prompt/instruction/*.md` | 23 | SoT (詳細ルール。必要なときだけ読む) | 手書き | `core` `persona` `data-driven-execution` の 3 ファイル |
| `prompt/skill/*.md` | 8 | SoT (SKILL.md 形式ではない旧式の Skill 文書) | 手書き | なし |
| `prompt/agent/*.md` `prompt/context/*.md` `prompt/command/*.md` | 18 / 3 / 1 | SoT (Claude 向けの元データ) | 手書き | なし |
| `.agents/skills/<name>/` | 2 ディレクトリ | SoT (共通 Skill) | 手書き | なし |
| `.claude/skills/<name>/` (`git-workflow` `verification-mandate`) | 2 ディレクトリ | GEN | `script/sync-ai-rules.sh` が `.agents/skills/` からコピー | なし |
| `.claude/skills/<その他>/` | 108 ディレクトリ (うち 91 が `origin: ECC` の外部由来) | AI固有 (Claude) | 手書き・外部由来 | なし |
| `.claude/rules/` `.claude/agents/` `.claude/contexts/` | 7 / 19 / 3 | AI固有 (Claude)。`prompt/` へのシンボリックリンク (`agents` の 1 件は実ファイル) | symlink | `rules/core.md` `rules/persona.md` のリンク先が暗号化 |
| `.claude/commands/` | 76 | AI固有 (Claude) | 手書き | `top5.md` が暗号化 |
| `.claude/settings.json` `.claude/hooks/` `.mcp.json` | - | AI固有。配布しない | 手書き | なし |
| `.github/copilot-instructions.md` | 1 | GEN | `script/sync-ai-rules.sh` が `AGENTS.md` から生成 | なし |
| `.gemini/styleguide.md` | 1 | GEN (Gemini Code Assist の PR レビュー用) | 同上 | なし |
| `.github/instructions/*.instructions.md` | 7 | AI固有 (Copilot)。`prompt/instruction/` へのシンボリックリンク | symlink | `core` `persona` のリンク先が暗号化 |
| `.github/mcp-config.json` | 1 | AI固有 (MCP 設定)。配布しない | 手書き | なし |
| `.coderabbit.yaml` | 1 | AI固有 (CodeRabbit)。`AGENTS.md` と `prompt/instruction/` を根拠として参照 | 手書き | なし |
| `.agents/skill/development/SKILL.md` `.agents/environment.yaml` | 1 / 1 | レガシー (3 章) | 手書き | なし |

存在しないもの: `.cursor/` `.codex/` `.opencode/` `.devin/` `.agent/` `GEMINI.md` `.gemini/settings.json` `.github/skills/`。
`.gitattributes` に `.github/instructions/data-driven-execution.instructions.md` が書かれているが、実ファイルは存在しない。

### レガシー扱いのもの

`.agents/skill/development/SKILL.md` (単数形の `skill`) と `.agents/environment.yaml` は、利用している AI・ツールが分からないため触らない。どちらも npm 前提で、リポジトリの実際の運用 (pnpm) と食い違っている (8 章)。移行するなら `.agents/skills/development/` に pnpm のコマンドで作り直す。オーナーの承認が必要。

## 3. 優先順位

どの AI でも、ツール・システム側のポリシーと、そのセッションでのユーザーの指示が最優先。以下は、その下でプロジェクトのファイルがどう効くか。

| 順位 | Claude Code | それ以外の AI (Codex / Gemini / Copilot / Cursor / OpenCode / Devin) |
|---|---|---|
| 1 | セッション内のユーザー指示 | セッション内のユーザー指示 |
| 2 | `CLAUDE.md` (暗号化。鍵がない環境では暗号文のまま入る) | `AGENTS.md`、または AI 固有の生成ファイル (`.github/copilot-instructions.md` `.gemini/styleguide.md`) |
| 3 | `.claude/rules/*` (= `prompt/instruction/` の symlink。常時読込) | `prompt/instruction/*.md` (`AGENTS.md` が参照。必要なときだけ読む。`core` `persona` は暗号化で読めない) |
| 4 | `AGENTS.md` は自動では届かない (検証済み)。`CLAUDE.md` が import していれば効く (未確認) | Skill (必要になったときだけ読み込む) |
| 5 | Skill (呼び出したときだけ読み込む) | - |

矛盾したときの扱い:

- 上位が下位に優先する。
- 同じ順位の中で矛盾が見つかったら、AI は黙って片方を選ばず、PR で人間が解消する。現在見つかっている矛盾は 8 章。
- Skill は手順の置き場であって、ルールの正本ではない。`prompt/instruction/` や `AGENTS.md` と食い違う内容を Skill に足さない。

## 4. 正本から生成物へのマップ

一方向のみ。生成物から正本へは戻さない (循環参照・二重読込を防ぐ)。

| 正本 | 生成物 | 内容 |
|---|---|---|
| `AGENTS.md` | `.gemini/styleguide.md` | 固定ヘッダ (レビューは日本語、PR 要約の書式) + `AGENTS.md` 全文 |
| `AGENTS.md` | `.github/copilot-instructions.md` | 生成マーカー + `AGENTS.md` 全文 |
| `.agents/skills/<name>/` の全ファイル | `.claude/skills/<name>/` | バイト単位のコピー。`SKILL.md` だけ、frontmatter を閉じる `---` の直後に 1 行の HTML コメントのマーカーを挿入 |

コマンド:

```bash
pnpm sync:ai-rules    # = bash script/sync-ai-rules.sh          生成物を書き出す。元が消えた生成物は削除する
pnpm check:ai-rules   # = bash script/sync-ai-rules.sh --check  何も書かず、ずれがあれば exit 1
```

どちらも bash が必要。Windows では Git Bash か WSL から実行する。bash が無い環境では `script/sync-ai-rules.test.mjs` は全テストをスキップする (`pnpm test` は通る)。

`--check` が失敗する条件: 期待する出力が無い / 内容が違う / 元が消えた生成物が残っている (孤児)。未追跡ファイルの欠落も検出する (旧 CI は `git diff` だったので検出できなかった)。

スクリプトの安全装置:

- 衝突ガード: `.claude/skills/<name>/SKILL.md` がマーカー無しで既に存在するときは失敗し、何も書かない。手書きの Skill や外部由来の Skill を上書きしない。
- 孤児削除: マーカーを持つ `.claude/skills/<name>/` で、`.agents/skills/<name>/` が無くなったものは、書き出しモードで削除する。生成された Skill ディレクトリの中で、元に無い補助ファイルも削除する。
- 暗号化拒否: 元ファイルの先頭が git-crypt の暗号文なら失敗する。
- シンボリックリンクの健全性: `.claude/rules` `.claude/agents` `.claude/contexts` `.github/instructions` のリンク切れは警告のみ。`git config core.symlinks` が false のときは検査しない。
- 出力はロケールや時刻に依存しない。bash 3.2 (macOS 標準) で動く書き方に限定し、`readlink -f` と `sed -i` は使わない。
- `.gitattributes` の末尾に、`AGENTS.md`・生成物・スクリプトと、Skill ツリーの `*.md` (`.agents/skills/**/*.md` と `.claude/skills/**/*.md`) の `text eol=lf` を追記してある。正本と生成物の両方に同じ変換が掛かるので、Windows の autocrlf 環境でも `--check` が揺れない。Skill 内のバイナリ等は変換せずそのままコピーする。新しい Skill を足すときに `.gitattributes` を触る必要はない。マーカー判定は行末の CR を無視する。
- 生成物と見なす条件は「frontmatter を閉じる `---` の直後の 1 行が、そのディレクトリ名のマーカーと完全一致する」こと。本文に引用されたマーカーや別名のマーカーでは生成物扱いにならず、手書きの Skill は削除されない。出力先ディレクトリが存在し、生成された `SKILL.md` を持たず、生成物以外のファイルがある場合も失敗する。
- `--check` はファイル内容に加えて実行ビットの違いも検出する。

実行される場所:

- `.github/workflows/sync-ai-rules.yml`: すべての PR (パスフィルタなし) と手動実行で `bash script/sync-ai-rules.sh --check`。
- `script/ci.mjs fast` (pre-push の `task ci:fast`): `pnpm check:ai-rules`。
- テスト: `script/sync-ai-rules.test.mjs` (`pnpm test` に組み込み済み)。冪等性、`--check` の合格・失敗 (手編集 / 欠落 / 孤児)、孤児の削除、衝突ガード、旧 2 ファイルとのバイト一致 (ゴールデン) を、一時コピー上で確認する。旧スクリプトの原本は `script/fixture/legacy-sync-ai-rules.sh`。

## 5. Skill の追加と変更

1. 共通 Skill は `.agents/skills/<name>/SKILL.md` に書く。先頭に frontmatter (`name` と `description`) を置く。本文に別の `---` ブロックがあってもよい。
2. `pnpm sync:ai-rules` を実行し、`.agents/skills/` と `.claude/skills/` の両方をコミットする。
3. `.claude/skills/<name>/` の生成物は編集しない。必ず `.agents/skills/` 側を直す。
4. Claude 専用の Skill は、従来どおり `.claude/skills/<name>/` に直接置く。`.agents/skills/` と同じ名前にすると衝突ガードで失敗する。
5. 既存の Skill を共通化するときは `git mv` で `.agents/skills/` へ移す (履歴が残る)。`name:` を変えない限り、Claude からの呼び出し名は変わらない。

今回移したのは `git-workflow` (`designdiff-git-workflow`) と `verification-mandate` (`designdiff-verification-mandate`) の 2 つ。本文は変更していない。外部由来の 91 個と、その他の Claude 専用 Skill は移していない (移動の差分が大きく、このIssueの範囲外)。

`prompt/skill/*.md` (8 ファイル) は `SKILL.md` 形式ではないので、まだ共通 Skill にしていない。変換には `prompt/prompt.md` からのリンクの扱いを含めてオーナーの判断が要る。Issue の「共通 Skill を複製管理せずに呼び出せる」は、今回の 2 つについてだけ満たしている。

## 6. AI 別の入口と検証状況

状態の意味:

- verified: この文書の作成時にコンテナ内で実際に実行して確かめた。
- per-docs-unverified: ベンダーの公式ドキュメントにそう書いてあるという認識。実行して確かめていない。ドキュメントとバージョンを再確認してから使う。
- unsupported: このリポジトリには入口を用意していない (または仕様が未確認)。

| AI | 試験したバージョン | ルールの入口 | Skill の入口 | 状態 |
|---|---|---|---|---|
| Claude Code | 2.1.332 | `CLAUDE.md` + `.claude/rules/*`。`AGENTS.md` を自動で読むかは環境により観測が割れた (下記) | `.claude/skills/<name>/` (生成コピー)。`.agents/skills/` は読まない | verified (下記) |
| Codex CLI | 未導入 | `AGENTS.md` | `.agents/skills/` | per-docs-unverified |
| Gemini CLI | 未導入 | 入口なし (`GEMINI.md` を置かない決定。既定では `AGENTS.md` を読まないと認識。代替案は 8 章) | `.agents/skills/` を読む版があるという認識 | ルール: unsupported / Skill: per-docs-unverified |
| Gemini Code Assist (GitHub の PR レビュー) | 実行不可 | `.gemini/styleguide.md` (生成。内容の同期は `--check` で検証済み。取り込み側は未検証) | なし | per-docs-unverified |
| GitHub Copilot | 未導入 | `.github/copilot-instructions.md` (生成) + `.github/instructions/*.instructions.md`。coding agent は `AGENTS.md` も読むという認識 | `.github/skills` `.claude/skills` `.agents/skills` を読むという認識 | per-docs-unverified |
| Cursor | 未導入 | `AGENTS.md` | 不明 | per-docs-unverified |
| OpenCode | 未導入 | `AGENTS.md` | `.claude/skills` `.agents/skills` を読むという認識 | per-docs-unverified |
| Devin | 実行不可 (SaaS) | `AGENTS.md` | Skill 対応は未確認 | per-docs-unverified |
| Antigravity | 実行不可 (GUI) | 入口なし (仕様が未確認) | 入口なし | unsupported |

同じ内容の Skill が `.claude/skills/` と `.agents/skills/` の両方に存在するので、両方を読む AI (OpenCode / Copilot など) が重複をどう扱うか (警告 / エラー / 先勝ち) は未確認。

### Claude Code 2.1.332 の検証 (verified)

リポジトリ本体は使わず、暗号化ファイルを含まない一時ディレクトリで `claude -p --setting-sources project` を非対話実行した (`CLAUDE.md` は置いていない)。モデル自身の自己申告に頼らないよう、合言葉 (canary) を入れたファイルを置き、「コンテキストに `CANARY:` で始まる行があればその合言葉を出力、なければ `NO-CANARY`」と、ツールを使わずに答えさせた。質問文には合言葉そのものを書かない。Skill は「名前に `designdiff` を含む使える Skill を列挙、なければ `NONE`」と聞いた。

| 一時ディレクトリの中身 | 結果 |
|---|---|
| `.agents/skills/` (git-workflow / verification-mandate) だけ | `NONE` (= Claude Code は `.agents/skills/` を読まない。アダプターが必要) |
| 生成された `.claude/skills/` (同 2 つ) だけ | `designdiff-git-workflow` `designdiff-verification-mandate` の 2 つが列挙された |
| `AGENTS.md` (canary 入り) | 合言葉が出力された (このコンテナでは 3 回とも読まれた) |
| `OTHER.md` (canary 入り) / ファイルなし | `NO-CANARY` |

追加の確認: 生成コピーのディレクトリで `designdiff-git-workflow` を Skill ツールで呼び出し、本文中のマーカー行が読み込まれたことを確認した。frontmatter を先頭に保っているので `name` / `description` は Claude Code に解釈される。

注意: このコンテナ (クラウドセッション) では `AGENTS.md` が読まれた。この文書の初版の検証と、独立したレビューの再現 (別環境) では `AGENTS.md` は読まれなかった。どの条件 (バージョン・実行環境・設定) で分かれるかは未特定なので、「Claude Code は `AGENTS.md` を自動で読む」とも「読まない」とも断定しない。ローカル実行で再確認してから、Claude へ `AGENTS.md` を届ける手段を決める。

未確認: 実リポジトリの暗号化された `CLAUDE.md` が `AGENTS.md` を import しているか。鍵がないと確認できない。

## 7. 対象外

- すべての Markdown を常時読み込ませること。詳細ルールは必要なときだけ参照させる。
- Hooks・権限・MCP・サブエージェント・commands の共通化 (AI ごとに仕様が違う)。
- 全リポジトリを対象にした中央同期。

## 8. オーナーの判断が必要な既知の問題

このPRでは変更していない。どれも既存の指示を無断で消さない・書き換えない方針のため、判断を待つ。

1. 暗号文が AI のコンテキストに入る。鍵のない環境 (クラウドエージェント・CI) では、`CLAUDE.md` と `.claude/rules/core.md` `.claude/rules/persona.md` (リンク先 `prompt/instruction/core.md` `persona.md`) が暗号文のまま Claude のコンテキストに入る。クラウドの Claude Code セッションで実際に観測した。`.github/instructions/core.instructions.md` `persona.instructions.md` も同じファイルへのリンクなので、Copilot にも暗号文が渡ると考えられる (こちらは未検証)。ルールとして効かないうえにコンテキストを消費する。対策 (暗号化の範囲の見直し、鍵の配布方法、リンクの外し方) は鍵を持つ人が決める。この構成はこれらの経路を増やしていない。
2. 鍵を持つ人による `CLAUDE.md` `core.md` `persona.md` の確認。`AGENTS.md` を import / 再掲していないか、`pnpm` 等の矛盾がないか。マージ前の確認事項とする。結果次第で、Claude へ `AGENTS.md` を届ける方法 (`CLAUDE.md` の `@AGENTS.md` など) を決める。
3. Copilot が `AGENTS.md` を二重に読む可能性。`.github/copilot-instructions.md` は `AGENTS.md` の全文コピーで、Copilot の coding agent は `AGENTS.md` も読むという認識 (未検証)。コード レビューは `copilot-instructions.md` しか読まない可能性があるため、全文コピーを残している。短い要約 + ポインタに縮めるかどうかを決める。
4. 現在見つかっている矛盾 (どちらが正かの判断が要る)。
   - パッケージマネージャ: `AGENTS.md` と `package.json` は pnpm。`.agents/environment.yaml` と `.agents/skill/development/SKILL.md` は npm。
   - Node のバージョン: `AGENTS.md` は「Node.js ≥25」、`package.json` の `engines` は `>=26.12.1`。
   - 検証手順: `prompt/instruction/verification-mandate.md` (とそれを元にした Skill) は `npm run dev` / `http://localhost:5173`。リポジトリは pnpm。
   - アプリの種類: `prompt/instruction/prohibition.md` は Tauri (`localhost:1420`、`keyring` crate) 前提。デスクトップアプリは Electron (`electron-vite`)。
5. Skill と `prompt/instruction/` の乖離。`git-workflow` Skill (100 行) は `prompt/instruction/git.md` (52 行) と本文が一致しない。`verification-mandate` Skill は `prompt/instruction/verification-mandate.md` と 19 行異なる (日本語・関西弁の禁止フレーズが英語の言い換えになっている)。どちらを正にするか決めて寄せる。
6. Claude での二重読込。`verification-mandate` は `.claude/rules/verification-mandate.md` として常時読み込まれ、さらに同じ主題の Skill がある。
7. `.coderabbit.yaml` の `path_filters` が `!.agents/skills/**` と `!.claude/skills/**` の両方を除外している。Skill の正本が `.agents/skills/` に実体を持つようになったので、レビュー対象から外すか残すかを決める。
8. `AI Rules Drift Check` を必須チェックにするのはリポジトリ設定 (ブランチ保護) の変更で、このPRでは行わない。パスフィルタを外したので、必須にしても「待機中のまま」にはならない。ジョブ名 `Bridge files in sync with AGENTS.md` は変えていない。
9. `prompt/skill/*.md` (8 ファイル) の `.agents/skills/` への変換 (5 章)。
10. シンボリックリンク 35 本は Windows で `core.symlinks=true` (開発者モード) が無いと壊れる。この構成は新しいリンクを足さないが、既存のリンクを実ファイルへ置き換えるには許可が要る。暗号化されたリンク先は生成コピーにできない。
11. 初回のPRの差分に、旧 `.github/copilot-instructions.md` の遅れ (末尾の「GitHub Project での作業管理」節が欠けていた) の修正と、これまで存在しなかった `.gemini/styleguide.md` の追加が含まれる。意図した差分。
12. Gemini CLI のルールの入口。`GEMINI.md` を置かない理由は Copilot での二重読込なので、`.gemini/settings.json` の `contextFileName` に `AGENTS.md` を指定する案には当てはまらない (新しい設定ファイルを足すだけで、内容の複製は増えない)。ただし権限や MCP の設定を同じファイルに書かない方針との兼ね合いと、実機での動作確認 (未検証) が要るので、オーナーが判断する。
13. 他の AI (Codex / Gemini CLI / OpenCode / Cursor / Copilot / Devin / Antigravity) の実機検証。npm からは入手できるが、この Issue の調査時に実行が許可されなかった。許可があれば、Skill の発見だけでもログイン不要で試せるものがある。
