# PR #431 初回ボットレビューへの対応

対象はCodeRabbitのhead d55a3f1レビュー (2026-11-01)。レビュー結果を正解とせず、実コード・保存資料・反例を照合し、独立レビュアーにも修正版を再読・再実行してもらった。元PNG・expected.json・ラベル・閾値・known REDには変更がない。

| 指摘 | 修正前の確認と対応 |
|---|---|
| PillowがAPNGの先頭フレームだけを受け入れる ([thread](https://github.com/kouiso/designdiff/pull/431#discussion_r4436002533)) | 合成した正当な1フレームAPNG(n_frames=1/is_animated=false/MIME=apng)と2フレームAPNGが旧loaderを通ることを再現。制御チャンク・MIME・フレーム数を変換前に拒否する。hashとデコードに同じ上限付きバイト列を使用し、PNGの16MiB上限も測定側と揃えた。変換/デコードが呼ばれたら失敗する回帰テストを追加。 |
| 独立定義のfixture SHAに照合していない ([thread](https://github.com/kouiso/designdiff/pull/431#discussion_r4436002535)) | expected.jsonとmeasurementの入力SHA・drift-2px判定を一緒に変えると旧auditがpassを返すことを再現。新auditは実expected SHAをdefinition.fixtures[pair].expectedSha256とmeasurement.inputsの両方に照合し、定義のfixture集合も固定する。原本を変更せず、対象JSONだけ一時JSONへ読み替える協調改変テストを追加。 |
| 通常testからPNG証跡の陳腐化を検知できない | 既存test:gate1-oracleに含まれるgate1-fixture.test.mjsへ、全51PNGのSHAをcommitted measurement.jsonと照合するテストを追加。PNGは既存の上限・形式検査付きloaderで読み、原本は変更しない。 |
| reportの配送状況が現在のPRと矛盾する | reportの該当見出しに「PR #431作成前の記録」と明記。followup/self-reviewも履歴の時点を示し、過去の未配送記録を現在の状態と混同しない。 |
| Docstring Coverage警告 | 2Pythonファイルの全21関数・メソッドに、日本語で監査条件の目的を記述。ASTで21/21を確認し、設定やcoverage閾値は変えない。 |

## 最終コード版の確認

- Node26.12.1: 13テスト成功 (全51PNG照合を含む)。Biome・ESLint・strict checkJs成功。
- Pillow12.3.0: 保存原本の監査成功。66比較のうち63数値比較・3寸法null、378率、6サマリー、10ソースSHAが整合。
- Python: 7テスト成功。原本監査が通ることを前提に、従来9件に加えて1/2フレームAPNG・過大PNG・協調改変の拒否を確認。
- 派生PNG15件の生成照合成功。測定JSONと行プローブJSONは再実行してcommitted原本とbyte一致。
- 独立レビュアーが現行10ソースSHAを再計算し、default auditとPython7テストを別途実行して成功。修正範囲に残るブロッカーはないと判断した。

正確なコマンド・ツール版・exit code・source SHAは現在のvalidation.json、生ログはbot-review/。直前版validationも同ディレクトリに保管する。原画像のコピー・アップロード、外部CIやdeploy、ワークフロー設定の変更は行っていない。PR用コミットは[skip ci]を維持し、依頼されたローカルCI結果を使う。

この対応は監査の入力条件と固定点を強化したもので、群の分離や実際の撮影条件を証明していない。#427/#243の受入未達という見解は維持する。ボットへの返信・合意・resolveの状態はPR #431の各スレッドを正本とする。
