# 不透明ストローク幅の見逃し修正（#376）

左右へ広がった太線の各縁は、差分クラスタごとには別々の1px移動として扱えた。中心と概形も保たれるため、same-token・reflow・局所移動・section救済を通り、既知の5→7px／7→9pxの太線化がPASSしていた。既存のPASS／FAIL契約で、この実幅差をFAILへ戻す。

基点は `6f5f45ebca8074edf24094fe50b2debf26077e1c`。[検証台帳](validation.json)は製品・テストのSHA256、基点との差分ハッシュ、実行コマンド、終了値、ログを結び付ける。UI変更はないため、UIの同条件前後画像は対象外。比較入力の生RGBA／PNGハッシュを前後で一致検査し、実画像はコピー・アップロードしない。

## 判定変更

最大12pxの既存haloで両端を見渡し、同一色の不透明coreが包含関係を保ったまま増減し、純背景から純前景へ変わった完全なランを検査する。両端の背景アンカー、連続3行以上の同じ幅、変更10画素以上、元bbox内の変更を要求する。縦横両方向と逆の細線化も扱う。マスク・透明画素・中間AA・画像端で切れたランを完全幅の証拠にしない。同幅の平行移動では反対側のcoreが失われるため、この幅変化証拠を発行しない。

確定した候補はsame-tokenとreflowの救済対象から除き、MCPでは独立したcritical `opaque_stroke_width_change` を生成する。sectionや局所移動の救済後も、実寸法の差がFAILへ反映される。CSS/font-weightが原因とまでは断定せず、実画素幅の証拠として報告する。墨量の0.25／0.35／reflow0.30境界は維持する。

旧「35%を許す」テストの画素は51→73個の不透明列追加だったため、同じ入力を負例へ修正した。正の境界検証には、不透明coreを固定した中間alphaの差を追加した。独立算術の墨量差は2/7で、強形状時の0.35で受理し、弱形状時の0.25では拒否する。ガードを緩めて合格させていない。

## 実行証跡

| 対象 | 修正前 | 修正後 |
|---|---|---|
| 元の5→7px、7→9px × PNG/sectionの4対照 | 全4件が誤PASS | 全4件がFAIL、全件critical幅変化あり |
| 新規MCP回帰26件 | 18失敗・8成功（16件が誤PASS、片側拡張2件は既存FAILだが幅signal欠落） | 関連4ファイル139件成功 |
| 旧不透明列追加の負例＋AA境界正例 | 旧入力の負例が1件失敗、新AA正例は成功 | 幅検出・glyph・reflowの3ファイル78件成功 |
| 別プロセスの既存MCP 8対照 | 前commitの合格記録 | 今回も8/8。AA／1pxはPASS、2/56px・欠落・太線化・色変更・opt-inなしはFAIL |

元4対照は [修正前](runtime-before.json)／[修正後](runtime-after.json)に、同一raw/PNGハッシュ・既知の255→357／357→459画素・102変更画素・生座標を保存する。PNGの2件は公開MCP `compare_design` と保存レポート取得、synthetic sectionの2件は別Nodeプロセスのbuilt `compareImages` APIで実行した。sectionを公開MCPや実Figma連携の合格とは呼ばない。

RED実行中のsourceは未buildの作業途中だったため、実行対象を固定旧distとして明記し、sourceの前後snapshotを別々に保存した。旧distは基点で検証済みのハッシュと一致し、実行中不変。GREENではsource・distとも不変を確認する。ログは末尾空白だけを正規化し、元バイト列と保存後のハッシュを台帳に残す。

Node25.6.1／pnpm9.15.0で `pnpm typecheck`、追加テストの明示的な`tsc --noEmit`、`pnpm lint:eslint`、`python3 docs/evidence/issue-376-cloud/reap-children.py task ci:fast` を再実行した。shared699／MCP950を含む全3067ユニットテスト成功、root Nodeは59成功／0失敗／Windows専用1skip。ESLintは0 error・既存2 warning。Turbo local cache使用箇所はログへ明示する。containerの子プロセス回収だけを補う既存supervisorを使用し、フックとテスト内容は維持する。

[最新developとの差分照合](develop-comparison.json)では、共通基点から `083cf600754be070366b964e9295f2143efc437f` までの変更は `.mise.toml` と `package.json` のNode更新のみで、今回の最終source/testと重複0。既存handoff基点とdevelopのGit衝突プレビューも終了0。参照・index・作業ツリーのマージは行わない。developのNode26.12.1更新は再実装せず、作業ブランチの25.6.1要件での検証と、未実行のNode26.12.1統合実行を区別する。

## 実検体と残件

[33検体の最新実行](inventory.json)は元のラベルと入力SHA256を維持する。[12件の独立分類](../issue-376-continuation/README.md)にある11件の実配置・寸法・内容差と、原因未確定pair-18を分ける。pair-22等の56px実差はFAILを維持する。既存PASS宣言との不一致12件を、検証済みの誤FAIL12件とは呼ばず、#375の誤FAILゼロ・#376全体完了を主張しない。

前commitの仕様回答待ち表記は過去の記録であり、今回は現行FAIL／PASS契約で元4件の実装と回帰検証を完了した。

[pair-18の具体的な不足入力](pair-18-inputs.md)と[ファイル・値・取得元・ハッシュ台帳](pair-18-inputs.json)を追加した。Flutterの候補capture test、DPR1、390×692、locale、layout、typography、pubspecは読める。一方、今回のPNGへ対応する撮影commit／実行receipt、元Figma text subtree、実際にロードされたTTFの版・hash・weight／fallback／合成太字、engineと実測baseline・TextPainter・FittedBox値は結び付いていない。宣言とtest用FontLoaderの登録weightの差は調査手掛かりであり、実行時不具合の確定ではない。過去監査画像は今回とハッシュが異なる。

幅検出は完全な硬い輪郭を持つ局所候補に限定する。同じ窓にcoreの喪失と追加が混在する場合、AA境界、12px外、12万画素を超す窓は、この追加信号だけで幅を断定しない。これらや実フォント全般の分類まで解決したとは扱わない。macOS実Desktop／Retina／実フォント／実Figma host/APIは未検証。

`mobile-capture`、本番・認証・通信設定、workflow、PR #387は変更していない。PR作成、外部連絡、merge、draft解除、force push、フック回避は行わない。
