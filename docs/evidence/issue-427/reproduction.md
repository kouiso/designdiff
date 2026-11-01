# #427 のローカル再現と独立監査

この手順は #427 の測定用 script の検証に限る。製品全体の `pnpm test` / CI 成功、撮影条件、画像の意味的正解を認定するものではない。画像転送、Figma API、実機、DB、deploy は不要。原 PNG と fixture の宣言は変更しない。

## 入力と環境

- 元検体の起点: develop `184eb7131ed3d0941b9d1a0fee5b0647c469f774`。変更対象の script と保存測定はこの作業ブランチを使う。
- Node は `.mise.toml` の **26.12.1** を使う。初回の24.19.0での検証は `review/validation-before-review.json` に分け、現在の `validation.json` と区別する。`node --version` が異なる場合は対応版での再現と呼ばない。
- Python の既存検証環境は **3.12.14 / Pillow 12.3.0**。独立監査は NumPy、sharp、製品モジュールを利用しない。
- Node 検証依存の正確な版と推移依存は `toolchain/package.json` と `toolchain/package-lock.json` に保存する。これらが無い版からは以前の一時環境を完全再構成できない。lockfile を無視した最新版の導入で同一環境と見なさない。
- `measurement.json` は66比較行、うち63行が同寸法の数値比較、3行が寸法不一致の null。独立計算する率は **63 × 6 = 378個**であり、66行すべてに数値差分率があるわけではない。

Node 26.12.1が無い場合は、保存した runtime 用 lockfile から別の一時ディレクトリに導入できる。この runtime パッケージだけは、OS/CPUに対応する Node バイナリを得る install script が必要なので `--ignore-scripts` を付けない。インストールはローカルであり、製品のCIやdeployを起動するものではない。

```sh
set -eu
mkdir -p /tmp/gate1-review-runtime
cp docs/evidence/issue-427/toolchain/runtime/package.json /tmp/gate1-review-runtime/package.json
cp docs/evidence/issue-427/toolchain/runtime/package-lock.json /tmp/gate1-review-runtime/package-lock.json
npm_config_cache=/tmp/gate1-runtime-npm-cache npm ci --prefix /tmp/gate1-review-runtime --no-audit --no-fund
export PATH="/tmp/gate1-review-runtime/node_modules/.bin:$PATH"
test "$(node --version)" = "v26.12.1"
```

既存の通常 workspace 依存が入っていれば、そのまま検証してよい。ただし依存版と Node 版を記録する。保存済みの小さい検証環境だけを再構成する場合は、以下をリポジトリ直下から実行する。`node_modules` が既にある場合は上書き・削除せず、このセットアップを止める。

```sh
set -eu
test "$(node --version)" = "v26.12.1"
test ! -e node_modules
test ! -L node_modules
mkdir -p /tmp/gate1-review-tools
cp docs/evidence/issue-427/toolchain/package.json /tmp/gate1-review-tools/package.json
cp docs/evidence/issue-427/toolchain/package-lock.json /tmp/gate1-review-tools/package-lock.json
npm ci --prefix /tmp/gate1-review-tools --cache /tmp/gate1-review-npm-cache --ignore-scripts --no-audit --no-fund
ln -s /tmp/gate1-review-tools/node_modules node_modules
```

この symlink を作った場合だけ、検証後に `unlink node_modules` で外す。既存のユーザー依存フォルダを消さない。セットアップ手順を複数回使う場合も、前の検証出力を上書きする代わりに新しい出力ディレクトリを作る。

Python 監査を新しい仮想環境で動かすには次を使う。すでに同じ版が入っている場合はその Python を使える。

```sh
python3 -m venv /tmp/gate1-pillow-venv
/tmp/gate1-pillow-venv/bin/python -m pip install --no-deps Pillow==12.3.0
```

## 測定用 script の検証

全コマンドは失敗時に止める shell から一つずつ実行する。`timeout` は Linux の coreutils を前提とする。測定scriptの出力先は `wx` なので既存ファイルへの追記・上書きはしない。

```sh
set -eu
out_dir=$(mktemp -d /tmp/gate1-reproduction.XXXXXX)
timeout 60 node --test verification/script/gate1-fixture.test.mjs verification/script/measure-gate1-oracle.test.mjs verification/script/probe-gate1-overlap.test.mjs
timeout 60 node_modules/.bin/biome check verification/script/gate1-fixture.mjs verification/script/gate1-fixture.test.mjs verification/script/measure-gate1-oracle.mjs verification/script/measure-gate1-oracle.test.mjs verification/script/probe-gate1-overlap.mjs verification/script/probe-gate1-overlap.test.mjs verification/fixture/gate1-independent-oracle.json
timeout 60 node_modules/.bin/eslint verification/script/gate1-fixture.mjs verification/script/gate1-fixture.test.mjs verification/script/measure-gate1-oracle.mjs verification/script/measure-gate1-oracle.test.mjs verification/script/probe-gate1-overlap.mjs verification/script/probe-gate1-overlap.test.mjs
timeout 60 node_modules/.bin/tsc --allowJs --checkJs --strict --noEmit --module nodenext --target es2022 --skipLibCheck verification/script/gate1-fixture.mjs verification/script/gate1-fixture.test.mjs verification/script/measure-gate1-oracle.mjs verification/script/measure-gate1-oracle.test.mjs verification/script/probe-gate1-overlap.mjs verification/script/probe-gate1-overlap.test.mjs
timeout 60 node verification/script/generate-fixtures.mjs --check
timeout 60 node verification/script/measure-gate1-oracle.mjs "$out_dir/measurement.json"
timeout 60 node verification/script/probe-gate1-overlap.mjs "$out_dir/probe.json"
cmp "$out_dir/measurement.json" docs/evidence/issue-427/measurement.json
cmp "$out_dir/probe.json" docs/evidence/issue-427/overlap-probe.json
```

Node の3テストファイルは通常の `pnpm run test:gate1-oracle` からも動き、root の `pnpm test` に組み込まれている。上記の直接コマンドは小さい検証環境向けであり、製品全体のテストを実行するものではない。

## 別実装による監査

```sh
PYTHONDONTWRITEBYTECODE=1 timeout 60 /tmp/gate1-pillow-venv/bin/python verification/script/audit-gate1-pillow.py
PYTHONDONTWRITEBYTECODE=1 timeout 60 /tmp/gate1-pillow-venv/bin/python verification/script/audit-gate1-pillow.test.py
```

監査は元PNGを Pillow で独立にデコードし、`ImageChops.difference` と3チャンネルの最大値ヒストグラムから6閾値を再計算する。18ペア・33 variant・66比較の集合、重複/欠落、画像/expected.json/ソースのSHA256、寸法、既知REDの宣言、256-binヒストグラム、378個の率、6つの生画素率群サマリーを照合する。3件の寸法不一致は数値計算せず null と代用値1の区別を確認する。空の source hash 表や重複JSONプロパティも拒否する。

テストは最初に無改変の保存原本が監査に通ることを確認してから、`/tmp` のJSONコピーだけに重複行・欠落行・誤率・非null寸法差・誤画像hash・誤fixture hash・誤サマリー・誤source hash・必須module hashの欠落を作り、理由別に拒否されることを確認する。PNGは複製・変更しない。別の保存結果は両方のコマンドで `--measurement FILE --validation FILE` を指定して照合できる。

この監査は局所集中度・近傍残差・行プローブの探索指標を別実装で再認定しない。元ラベルの妥当性、撮影機材・撮影時刻・system UI inset、画像権利や共有権限の証明にもならない。履歴マニフェストとPNGのhashが一致しない場合、その撮影条件を引き継いではいけない。
