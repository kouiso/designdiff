# Pair-18 の入力・来歴監査

`pair-18-hm-gate1-9892-10228` には原本・実装・2px移動対照の PNG と `expected.json` がある。各ファイルを PR375 の固定 commit `ea13c68354412868f46b808a5069b707481293a4` の Git blob とバイト一致で確認した。全 path、SHA256、Git blob SHA1、寸法は [pair-18-inputs.json](pair-18-inputs.json) に記録した。実画像のコピー・アップロード、Figma API 呼び出し、Flutter/device 実行は行っていない。

ローカルの manifest は `pairId` / `figmaFrame` / `variants` だけで、Figma node tree、テキスト style、撮影 commit、実際のフォント・レンダラ情報を持たない。`correct` の PASS と「AA/ストローク被覆差のみ」という記載は既存の期待値であり、原因を証明する記録ではない。

## 存在を確認できた情報

GitHub の読み取りで horsemanager の固定 revision `eb004836e7f03a4412a6ab2fbd56763d22c929cc` を調査した。ソースを読めることと、そのソースが既存 PNG を生成したことは分けて扱う。

| 記録 | 確認できた値 | この検体への適用限界 |
|---|---|---|
| [Figma frame fingerprint](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/doc/evidence/figma/frame-fingerprint-20261022.json) | node `9892:10228`、390×692、file version `2413034871333583555`、subtree digest `bd71bc23a118252e` | 2026-10-22 の digest と画面対応表。raw subtree や resolved font は含まず、PR375 の PNG に結び付く export receipt もない |
| [過去の完了画面監査](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/doc/evidence/pixel-perfect/onboard-completion-9892-10228/README.md) | 2026-08-27、390×692 / DPR1、logo `(123,177,144,182.76)`、content `(26,433,338,227)`、banner `(26,544,338,51)`、button `(54,611,282,49)`、Figma request IDs と画像 hash | 記載された Figma / implementation SHA256 は両方とも pair-18 と異なる。過去資料を今回の撮影来歴として流用できない |
| [formal capture test](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/test/formal_onboarding_capture_test.dart) | 390×692 / DPR1、locale `ja`、`lightTheme()`、`GoldenTestHelper.setUp`、`RepaintBoundary.toImage()`、対象を `implementation-9892-10228-390x692.png` に出力 | 対象画面の再現候補。ただしこの test revision と fixture SHA256 を結ぶ実行 receipt がない |
| [intro page](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/lib/src/screen/onboarding/widget/onboarding_intro_page.dart) / [style test](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/test/screen/onboarding/onboarding_screen_figma_style_test.dart) | title 上端433 / 本文478 / banner544、幅338、banner text幅256、icon20 / gap16、`FittedBox.scaleDown` | ソース上の geometry は存在する。元撮影時の適用 scale、widget bounds、baseline 実測は未取得 |
| [typography](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/lib/src/constant/typography.dart) | `Inter` → `Noto Sans JP` → `BIZ UDPGothic`。title24px / 行高29.045 / weight900・和文span700、body15px / 行高25 / weight500・和文span400、banner11px / 行高16 / weight600、leadingはeven | 宣言値であり、実際に選択された CJK font/weight、合成太字、フォント版を証明しない |

## フォント解決に関する具体的な確認点

[pubspec.yaml](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/pubspec.yaml) は Inter / Noto Sans JP の Regular〜Black を宣言している。一方、[flutter_test_config.dart](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/test/flutter_test_config.dart) と [GoldenTestHelper](https://github.com/ritmo-inc/horsemanager/blob/eb004836e7f03a4412a6ab2fbd56763d22c929cc/native/test/golden/golden_test_helper.dart) の明示的な test 用登録は、Inter family に Regular / Medium / SemiBold / Bold、Noto Sans JP family に Regular を読み込む。前者では runtime font fetching を無効にしている。

これは title の Inter900・和文700、banner の和文600との間に、**実際の解決結果を確認すべき差**があるという観測である。pubspec の他 weight が実際に使われたか、代替・合成太字へ進んだかは未確認であり、ソース記述だけで不具合とも正常とも認定しない。font name が同じでも TTF の版・OS/2 weight・variation・fallback と実際の描画結果は一致するとは限らない。

## 足りない具体的な入力

1. **元の撮影 receipt**：`impl-correct.png` の SHA256 から、horsemanager commit、test target / command、Flutter・engine・Dart revision、host OS、撮影時刻、出力 hash へ辿れる記録。現在見つかった source は再現候補であり、元撮影 revision としての対応は未証明。
2. **元の Figma text subtree**：`figma-export.png` に対応する file version / export時刻と、title `9892:10233`、body `9892:10235`、banner `9892:10252` の text/style/font size/weight/line height/letter spacing、box/wrap/auto-resize 設定。現在の fingerprint は subtree 本体を保持しない。
3. **使用した font と解決記録**：`native/asset/font/Inter-{Regular,Medium,SemiBold,Black}.ttf`、`NotoSansJP-{Regular,SemiBold,Bold}.ttf`、`BIZUDPGothic-{Regular,Bold}.ttf` の必要分の hash・version と、各 Latin/CJK run で実際に選択された family/weight/variation、FontLoader 成功、fallback・synthetic emboldening の記録。ローカルには TTF がない。remote の宣言や配置候補があることは、元撮影のロード証明ではない。
4. **文字配置・描画の実測**：title/body/banner の TextPainter line metrics・baseline・ink bounds、実際の TextSpan、textScaler / locale / strut / textHeightBehavior、FittedBox の適用 scale、DPR / viewport / inset、crop/resize 履歴、Skia/Impeller・hinting等の情報。

既存の独立画素実測は logo の最良移動0、title の最良縦移動+2、説明文の行帯+2/+3と幅差を記録している。これらは差の存在を示すが、source layout・fallback metrics・weight置換・AAのどれが原因かまでは分離しない。今回の監査を理由に PASS へ変更したり、stroke 許容値を緩めたりはしない。

`doc/evidence/pr-merge/pr-2812-onboarding-completion-banner/evidence.md` は monorepo inventory に名前があるものの、上記 revision での取得は404だった。また exact PNG hash の GitHub code search は結果0件だった。これは対象 ref の索引検索の範囲であり、全履歴や外部 capture host に存在しないことの証明ではない。
