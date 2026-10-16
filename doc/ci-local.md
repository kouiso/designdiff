# 共通の CI 入口

`task ci:fast` は従来の五つの検査を保持する。
`task ci` は Linux CI と同じ品質、型、unit、coverage、stdio、
独立 oracle、Playwright、Figma iframe、Electron IPC、拡張機能の検査を行う。
全実行の build は一度だけである。各フェーズも `node script/ci.mjs <phase>` で呼べる。
Node と pnpm は既存の `.mise.toml` と lockfile に従う。
ブラウザと Electron の依存は既存のセットアップ手順で準備する。
Linux の画面検査では xvfb を使う。macOS では直接起動する。
配布、署名、外部公開はこのローカル入口に含めない。

CI は同じ workflow の Linux producer が作る dist と Turbo cache を使う。
成果物名に commit SHA と run attempt を含める。
同一 SHA、実行、attempt、Node、OS、architecture、lock、tool、Turbo 設定を検査する。
全 build task の hash と cache HIT が一致しない場合は失敗する。
古い成果物や別の実行からの取得、再ビルドへの切り替えは行わない。
暗黙の `^build` も同じ cache に当たることを検査する。
Web、macOS、Windows、配布用の variant build は独立して保持する。

確認コマンド:

```bash
node --test script/ci.test.mjs script/ci-build-cache.test.mjs
```

CLI 契約検査は外部コマンドの代替を使う。
これを実アプリやブラウザ検査の成功とは扱わない。
