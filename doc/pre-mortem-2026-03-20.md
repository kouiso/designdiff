# Pre-Mortem Analysis: FigDiff Public Release

Date: 2026-03-20
Purpose: GitHub Actions無料枠の利用（publicリポジトリ化）

## Premise

publicリポジトリ化の目的はGitHub Actions無料利用。外部コントリビューターの募集やOSSコミュニティ形成は意図していない。このプロジェクトが「失敗」するとしたら、publicにしたことで問題が発生するケース。

## Risk Matrix

| Rank | Risk | Impact | Probability |
|------|------|--------|-------------|
| 1 | git-crypt対称鍵の漏洩 → 暗号化ファイル全復号 | Critical | Low |
| 2 | GitHub Actions workflow injection（PR経由） | High | Medium |
| 3 | コミット履歴の会社メールアドレス露出 | Medium | Confirmed |
| 4 | git-crypt暗号化ファイルの平文がGitHub Cache/Artifactに残る | High | Low |
| 5 | Forkからのworkflow_run悪用（マイニング等） | Medium | Low-Medium |
| 6 | 暗号化対象の漏れ（将来の機密ファイル追加忘れ） | High | Medium |
| 7 | Figma Personal Access Tokenのハードコード混入 | Critical | Low |

## Detailed Analysis

### 1. git-crypt対称鍵の漏洩 (Critical / Low)

現在 `~/.figdiff/git-crypt-key` に対称鍵を保管。この鍵が漏洩すると、暗号化ファイル8つ（persona.md, core.md, data-driven-execution.md, top5.md, CLAUDE.md, .github/instructions/3ファイル）が全て復号可能になる。

**現状の防御**: ファイルパーミッション600、.gitignore対象外（そもそもリポジトリ外）。
**脆弱点**: 鍵のバックアップ先、CI環境での鍵の取り扱い、ローカルマシンの侵害。
**Mitigation**: 鍵を1Passwordや他のシークレットマネージャに保管。CIではGitHub Secretsにbase64エンコードして格納。GPG鍵ベースへの移行を検討。

### 2. GitHub Actions Workflow Injection (High / Medium)

publicリポジトリでは誰でもPRを作成できる。`pull_request_target`トリガーや`workflow_run`を使っていると、PR作成者が任意コードを実行できる。現在のワークフローは`pull_request`トリガー（フォークのコンテキストで実行）を使っているため比較的安全だが、将来の変更で脆弱になる可能性がある。

**現状の防御**: `pull_request`トリガー使用、`concurrency`でジョブ制限。
**脆弱点**: secretsがフォークのPRに渡らないことの確認が必要。
**Mitigation**: `pull_request_target`は絶対に使わない。secrets参照のあるジョブにはenvironment protectionを設定。

### 3. コミット履歴の会社メールアドレス (Medium / Confirmed)

`kouiso@ritmo.co.jp` がgit log全体に露出済み。filter-repoで書き換え可能だが、force pushが必要。

**判断ポイント**: 会社名とGitHubアカウントの紐付けが問題になるか。
**Mitigation**: 必要なら `git filter-repo --mailmap` で noreply アドレスに一括置換。

### 4. 暗号化ファイルの平文がCI Artifactに残るリスク (High / Low)

CIでgit-crypt unlockしてビルドする場合、暗号化ファイルの平文がビルドログやartifactに含まれる可能性がある。publicリポジトリのArtifactは誰でもダウンロード可能。

**現状の防御**: 現在のCIはgit-crypt unlockを使用していない。
**Mitigation**: CIにgit-crypt unlockを追加する場合、暗号化ファイルがartifactやログに含まれないことを必ず検証。

### 5. Fork経由のワークフロー悪用 (Medium / Low-Medium)

publicリポジトリをforkしてPRを出し、CIリソースを消費する攻撃（暗号通貨マイニング等）。GitHub側である程度防御されているが、完全ではない。

**Mitigation**: `concurrency`設定済み（既存）。必要に応じてfork PRのCI実行に手動承認を設定（Settings > Actions > Fork pull request workflows > Require approval）。

### 6. 暗号化対象の漏れ (High / Medium)

今後新しい機密ファイルを追加する際、.gitattributesへの追加を忘れると平文でpushされる。一度pushされた平文はgit履歴に残り、filter-repoでの除去が必要になる。

**Mitigation**: pre-commitフックで暗号化対象パターンをチェック。機密ファイル追加手順をドキュメント化。

### 7. Figma PAT混入 (Critical / Low)

FigmaのPersonal Access Tokenがソースコードやコミットに混入すると、Figmaアカウントへの不正アクセスが可能になる。

**現状の防御**: Electron safeStorageで暗号化保存。TruffleHogでPRスキャン。.gitignoreで.env除外。
**Mitigation**: TruffleHogが正常動作していることを定期確認。

## Recommended Priority Actions

1. **Fork PRのCI実行に手動承認を設定** — Settings > Actions で即時対応可能
2. **コミットメールアドレスの判断** — `kouiso@ritmo.co.jp` を残すか noreply に置換するか決定
3. **git-crypt鍵を1Passwordに保管** — 現在のファイル保管より安全
4. **pre-commitフックで暗号化漏れ防止** — 機密パターンに一致するファイルが平文でステージされたら警告
