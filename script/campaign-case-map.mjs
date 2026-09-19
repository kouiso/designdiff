// 49ケースの静的記述。docs/test-specification.md の表を写した定数であり、
// ledger record の input/steps/oracle を供給する。実測値は driver 証跡が担い、
// ここは「何を検証したか」の宣言だけを持つ。FigDiff の自己評価は oracle に使わない。

const px = "source-pixels";
const dom = "dom-geometry";
const host = "host-observation";
const schema = "schema-contract";
const dep = "dependency-graph";

export const caseDescriptions = {
  C01: {
    input: "不透明な同一画像2枚",
    steps: "比較・詳細表示・出力を実施",
    oracle: { kind: px, description: "元画素の一致を独立計算し、存在しない欠陥が報告されないことを確認" },
  },
  C02: {
    input: "内容を左右上下に1px・2px移動した画像群",
    steps: "各方向を補正あり・なしで比較",
    oracle: { kind: px, description: "元の移動量を原座標で追跡でき、補正で配置不良を隠さない" },
  },
  C03: {
    input: "移動画像に既知の局所矩形欠陥を追加",
    steps: "比較後に欠陥領域を表示",
    oracle: { kind: px, description: "bboxが実際の欠陥と同じ座標を指す" },
  },
  C04: {
    input: "DPR 1/2/3・同じ論理寸法の画像",
    steps: "各画像を比較",
    oracle: { kind: px, description: "論理pxと物理pxの変換を再構成できる" },
  },
  C05: {
    input: "同じ内容で余白・高さ・縦横比の異なる画像",
    steps: "比較・重ね合わせ表示",
    oracle: { kind: px, description: "引き伸ばしで形状差を消さず、比較条件が分かる" },
  },
  C06: {
    input: "正常crop・画像外crop・片側のみ適用可能なcrop",
    steps: "指定・保存・再読込み・比較",
    oracle: { kind: px, description: "適用範囲が両画像で対応し、無効条件を黙って変えない" },
  },
  C07: {
    input: "既知の欠陥2個と片方を覆うmask",
    steps: "追加・編集・削除後に再比較",
    oracle: { kind: px, description: "指定外の欠陥を保持し、crop後もmask座標が一致する" },
  },
  C08: {
    input: "透明背景と不透明背景・Figmaノード情報",
    steps: "書出し条件を変えて比較",
    oracle: { kind: px, description: "意図した透明と背景欠落を区別し、書出し条件を記録する" },
  },
  C09: {
    input: "非表示フレームと対応する可視フレーム",
    steps: "実Figmaから取得・比較",
    oracle: { kind: host, description: "空白書出しを実装不良と断定せず、原因と次の操作を示す" },
  },
  C10: {
    input: "13×11px文字差分・日本語本文・ボタン",
    steps: "balancedで比較・候補表示",
    oracle: { kind: px, description: "局所差分と全体評価を区別し、文字を写真と断定しない" },
  },
  C11: {
    input: "長い画面・固定ヘッダー・動的領域",
    steps: "分割撮影・結合・比較",
    oracle: { kind: dom, description: "二重ヘッダーや欠落がないことを原撮影とDOM矩形で確認" },
  },
  C12: {
    input: "1px画像・破損画像・不正寸法・巨大画像",
    steps: "各入力で比較",
    oracle: { kind: schema, description: "クラッシュやゼロ除算がなく、失敗理由と復旧方法が分かる" },
  },
  C13: {
    input: "サイズの異なる画像と既知のマーカー",
    steps: "全比較表示・zoom・pan",
    oracle: { kind: dom, description: "プレビューの位置と採点座標が同じ領域を示す" },
  },
  M01: {
    input: "個人スキルなしのAIへリポジトリURLのみ",
    steps: "導入・接続・listTools・スキーマ適合呼出し",
    oracle: { kind: schema, description: "必要情報を探索し公開スキーマに適合した呼出しができる" },
  },
  M02: {
    input: "create_project/list_projects/delete_project 正常・既存・無効ファイル",
    steps: "作成・再起動・一覧・無効データ・削除",
    oracle: { kind: schema, description: "保存と一覧が一致し、無効データを診断でき別案件を変更しない" },
  },
  M03: {
    input: "set_figma_token 有効・無効認証",
    steps: "保存・再起動",
    oracle: { kind: schema, description: "秘密値を応答やログへ漏らさず、接続可否と復旧方法が分かる" },
  },
  M04: {
    input: "list_figma_frames 複数ページ・大量フレーム・node指定・不正URL",
    steps: "各入力で一覧取得",
    oracle: { kind: schema, description: "正しい対象を探索でき、ページングで欠落しない" },
  },
  M05: {
    input: "compare_design Figma URL・PNG・Web URL・モバイル撮影",
    steps: "各経路で比較実行",
    oracle: { kind: px, description: "各経路が実行でき、画像・比較条件・診断を取得できる" },
  },
  M06: {
    input: "inspect_node/get_design_tokens TEXT・FRAME・影・透明度・不存在node",
    steps: "実ノード情報取得",
    oracle: { kind: schema, description: "実ノード情報と一致し、背景色と文字色を取り違えない" },
  },
  M07: {
    input: "get_crop_region/set_crop_region 正常・画像外・未登録矩形",
    steps: "保存・取得・比較",
    oracle: { kind: schema, description: "同じ範囲を使用し、無効値を診断する" },
  },
  M08: {
    input: "get/set/delete_ignore_regions 複数領域・編集・不存在ID",
    steps: "領域設定・再起動後の確認",
    oracle: { kind: schema, description: "正しい領域だけが適用・削除される" },
  },
  M09: {
    input: "generate_diff_report 比較ID・6回以上再比較後の旧ID・再起動後の旧ID",
    steps: "JSON・PNG・領域情報を再取得",
    oracle: { kind: schema, description: "旧IDでもJSON・PNG・領域情報を再取得できる" },
  },
  M10: {
    input: "verify_fix 改善・悪化・無変化・別案件の比較",
    steps: "各組合せで検証",
    oracle: { kind: px, description: "対象と副作用を区別し、誤った比較の組合せを拒否する" },
  },
  M11: {
    input: "compare_animation 既知フレーム列・順序差・欠落・読込み失敗",
    steps: "時間・フレーム対応を検証",
    oracle: { kind: px, description: "時間とフレームの対応を検証できる" },
  },
  M12: {
    input: "report_issue 既存課題照合・確認済み新規課題投稿",
    steps: "重複照合・投稿",
    oracle: { kind: host, description: "重複を避け、秘密情報を除いた再現・期待・実際を保存する" },
  },
  M13: {
    input: "エラー契約 書込み不可保存先・無効入力・通信失敗",
    steps: "各エラー経路をSDK経由で呼出し",
    oracle: { kind: schema, description: "元のエラーと復旧手順を取得し、成功スキーマ違反で隠れない" },
  },
  M14: {
    input: "比較ループ 同一対象反復・別campaign開始・プロセス再起動",
    steps: "継続・新規・再起動の各経路",
    oracle: { kind: schema, description: "新規作業が過去の停止履歴に巻き込まれず、同一作業は履歴を維持" },
  },
  M15: {
    input: "撮影幅 推奨幅を適用して3回撮影",
    steps: "推奨幅で3回撮影",
    oracle: { kind: px, description: "幅が発散せず、画像寸法と案内が一致する" },
  },
  M16: {
    input: "自律利用 対象探索→撮影→比較→根拠確認→修正→再比較→レポート",
    steps: "個人スキルなしのAIへ実対象を完走させる",
    oracle: { kind: host, description: "手順補足なしで適切に進み、停止理由を説明できる。実行会話と画像を残す" },
  },
  D01: {
    input: "初回起動→認証→案件作成→フレーム選択",
    steps: "画面の表示だけを根拠に進行",
    oracle: { kind: dom, description: "次の操作が画面から分かる。実Figmaの選択と取得が一致" },
  },
  D02: {
    input: "未実行案件・未実行ページ・比較前画面",
    steps: "各画面を開く",
    oracle: { kind: dom, description: "0点・赤い不合格ではなく未計測を表示する" },
  },
  D03: {
    input: "ファイル選択・D&D・Web撮影・端末撮影",
    steps: "各入力経路と失敗後の状態",
    oracle: { kind: dom, description: "入力画像を確認でき、失敗後も入力と選択を失わない" },
  },
  D04: {
    input: "比較→全表示モード→zoom・pan・crop",
    steps: "表示モード切替・拡縮・移動・crop",
    oracle: { kind: dom, description: "実際の入力・差分と表示が一致。例外とconsole errorがない" },
  },
  D05: {
    input: "ノード詳細・トークン表示・除外領域編集",
    steps: "画面から到達・選択対象へ適用",
    oracle: { kind: dom, description: "画面から到達でき、人間が選択した対象だけに適用する" },
  },
  D06: {
    input: "修正前後比較・アニメーション比較",
    steps: "過去と現在・時間方向の違いを表示",
    oracle: { kind: px, description: "過去と現在の違い、時間方向の違いを説明できる" },
  },
  D07: {
    input: "レポート保存・問題報告",
    steps: "実ファイル保存・報告内容確認",
    oracle: { kind: host, description: "実ファイルが読め、報告対象・内容を確認して送れる" },
  },
  D08: {
    input: "保存→終了→再起動・案件切替・タブ切替",
    steps: "永続化・再起動・切替",
    oracle: { kind: dom, description: "設定・履歴を復元し、別案件へ状態が混ざらない" },
  },
  D09: {
    input: "401/403/429/5xx・オフライン・失敗後の再試行",
    steps: "各エラー注入と復旧操作",
    oracle: { kind: host, description: "失敗理由と復旧操作を表示し、操作不能状態に残らない" },
  },
  D10: {
    input: "キーボード操作・狭いウィンドウ・日本語ファイル名",
    steps: "キーボード到達・430px viewport・日本語名",
    oracle: { kind: dom, description: "操作対象へ到達でき、表示切れや文字化けで操作が失われない" },
  },
  X01: {
    input: "実Chrome拡張を分離プロファイルへ読み込み",
    steps: "popup→撮影→比較→overlay",
    oracle: { kind: host, description: "popup→background→contentの実通信と実画面を確認。再現DOM注入で代用しない" },
  },
  X02: {
    input: "overlayの移動・スクロール・透明度・ページ遷移・閉じる",
    steps: "overlay操作と閉じた後の状態",
    oracle: { kind: dom, description: "正しい画面へ追従し、閉じた後に操作を妨げない" },
  },
  X03: {
    input: "実Figmaへ開発pluginを読み込み",
    steps: "選択・export・compare・inspect",
    oracle: { kind: host, description: "sandboxとiframe間の実通信と生成画像が一致" },
  },
  X04: {
    input: "pluginで未選択・非表示node・不正画像・通信失敗",
    steps: "各エラー注入と復旧",
    oracle: { kind: host, description: "操作可能なエラー表示から復旧できる" },
  },
  X05: {
    input: "Android2台接続・対象端末指定・切断・未認証端末",
    steps: "指定端末の撮影と誤切替確認",
    oracle: { kind: host, description: "指定端末を撮影し、誤端末へ黙って切り替わらない" },
  },
  X06: {
    input: "iOS Simulatorと対応実機から撮影",
    steps: "各経路で撮影",
    oracle: { kind: px, description: "画像の向き・倍率・システムUI領域が正しい" },
  },
  X07: {
    input: "モバイルの長い画面・system UI mask・トースト",
    steps: "分割撮影・結合・除外",
    oracle: { kind: px, description: "正規UIを隠さず、結合・除外の根拠を追跡できる" },
  },
  X08: {
    input: "同じ検体をMCP・desktop・拡張・pluginで比較",
    steps: "同一検体の横断比較",
    oracle: { kind: px, description: "共通条件では同じ領域・差分規則。意図した機能差は明記" },
  },
  X09: {
    input: "保存形式の旧データ・MCPとdesktopの相互読込み",
    steps: "旧データ読込み・相互作成読込み",
    oracle: { kind: schema, description: "互換性を維持し、旧データを黙って削除しない" },
  },
  X10: {
    input: "本番依存グラフと全7パッケージ",
    steps: "依存グラフの照合",
    oracle: { kind: dep, description: "共通処理を複製せず、UIとAIの都合をコアへ持ち込まない" },
  },
};

// route ごとにどの driver がそのケースの証跡を出すか。
// driver は repo 相対パス。provides はその driver の evidence.results が
// 持つケースキー。platforms は実行可能 OS（省略時は3面）。
export const driverCoverage = [
  {
    driver: "app/mcp-server/script/stdio-campaign-verification.mjs",
    route: "mcp",
    provides: ["C04", "C05", "C06", "C07", "C08", "C11", "C12", "M02", "M03", "M05", "M07", "M08", "M10"],
  },
  {
    driver: "app/mcp-server/script/stdio-campaign-verification2.mjs",
    route: "mcp",
    provides: ["C01", "C02", "C03", "C10", "C13", "M09", "M11", "M13", "M14", "M15"],
  },
  {
    driver: "app/mcp-server/script/stdio-real-figma-verification.mjs",
    route: "mcp",
    provides: ["C09", "M04", "M06", "M16"],
    note: "実Figma認証経路。C09はhidden nodeのfigma_export_hidden_blank警告で証跡。M16は個人スキルなしの実セッション証跡と併用",
  },
  {
    driver: "app/mcp-server/script/stdio-real-figma-verification.mjs",
    route: "mcp",
    provides: ["M10"],
    optional: true,
    note: "合成経路は campaign-verification が主証跡。実Figma経路は補強",
  },
  {
    driver: "app/mcp-server/script/stdio-m01-verification.mjs",
    route: "mcp",
    provides: ["M01"],
    note: "M01 の機械的経路。実走証跡は別途 subagent 記録",
  },
  {
    driver: "app/mcp-server/script/stdio-m12-verification.mjs",
    route: "mcp",
    provides: ["M12"],
    note: "実投稿は外部write。承認なしでは dedup/sanitize 経路のみ",
  },
  {
    driver: "app/mcp-server/script/stdio-issue-verification.mjs",
    route: "mcp",
    provides: ["M09", "M11", "M14", "M15", "C01", "C02", "C03", "C10"],
    optional: true,
    note: "campaign1/2 が主証跡。issue経路の追加確認は補強として併記",
  },
  {
    driver: "app/desktop/e2e/desktop-c-cases.mjs",
    route: "desktop",
    provides: ["C01", "C02", "C03", "C04", "C05", "C06", "C08", "C09", "C10", "C11", "C12", "C13"],
    note: "C07はnative-ignore-regionが実UI編集込みで証跡",
  },
  {
    driver: "app/desktop/e2e/desktop-d-cases.mjs",
    route: "desktop",
    provides: ["D01", "D03", "D04", "D08", "D09", "D10", "X09"],
  },
  {
    driver: "app/desktop/e2e/native-unmeasured-score.mjs",
    route: "desktop",
    provides: ["D02"],
  },
  {
    driver: "app/desktop/e2e/native-ignore-region.mjs",
    route: "desktop",
    provides: ["C07", "D05"],
  },
  {
    driver: "app/desktop/e2e/native-figma-node-fix.mjs",
    route: "desktop",
    provides: ["D05", "D06"],
  },
  {
    driver: "app/desktop/e2e/native-fix-animation.mjs",
    route: "desktop",
    provides: ["D06"],
  },
  {
    driver: "app/desktop/e2e/native-issue-report.mjs",
    route: "desktop",
    provides: ["D07"],
  },
  {
    driver: "app/desktop/e2e/native-report-export.mjs",
    route: "desktop",
    provides: ["D07"],
  },
  {
    driver: "app/chrome-extension/script/real-chrome-e2e.mjs",
    route: "chrome-extension",
    provides: ["X01", "X02"],
  },
  {
    driver: "app/figma-plugin/e2e/real-iframe-host.mjs",
    route: "figma-plugin",
    provides: ["X03", "X04"],
    note: "iframe証跡は実Figma sandbox証跡に数えない。実Figma接続は別途",
  },
  {
    driver: "app/mcp-server/script/stdio-android-verification.mjs",
    route: "android",
    provides: ["X05", "X07"],
    note: "X05の複数台拒否は2台以上見える環境でのみ検証",
  },
  {
    driver: "app/mcp-server/script/stdio-ios-sim-verification.mjs",
    route: "ios-simulator",
    platforms: ["macos"],
    provides: ["X06"],
    note: "capture_scroll は ios-sim 非対応(明示拒否を検証済)。X07/ios は spec の OS固有非対応ルールで必須経路から除外済み",
  },
  {
    driver: "app/mcp-server/script/stdio-ios-device-verification.mjs",
    route: "ios-device",
    platforms: ["macos"],
    provides: ["X06"],
    note: "X07/ios-device も同様に spec の OS固有非対応ルールで必須経路から除外済み",
  },
  {
    driver: "app/mcp-server/script/x08/mcp.mjs",
    route: "mcp",
    provides: ["X08"],
    note: "x08-mcp.json に face 計測+results.X08 を吐く。runs-manifest は evidenceFile: x08-mcp.json を指定する",
  },
  {
    driver: "app/mcp-server/script/x08/compare.mjs",
    route: "mcp",
    provides: ["X08"],
    note: "4面横断verdict。全X08 routeの必須provider",
  },
  {
    driver: "app/mcp-server/script/x08/desktop.mjs",
    route: "desktop",
    provides: ["X08"],
    note: "evidenceFile: x08-desktop.json",
  },
  {
    driver: "app/mcp-server/script/x08/compare.mjs",
    route: "desktop",
    provides: ["X08"],
    note: "4面横断verdict。全X08 routeの必須provider",
  },
  {
    driver: "app/mcp-server/script/x08/extension.mjs",
    route: "chrome-extension",
    provides: ["X08"],
    note: "evidenceFile: x08-extension.json",
  },
  {
    driver: "app/mcp-server/script/x08/compare.mjs",
    route: "chrome-extension",
    provides: ["X08"],
    note: "4面横断verdict。全X08 routeの必須provider",
  },
  {
    driver: "app/mcp-server/script/x08/plugin.mjs",
    route: "figma-plugin",
    provides: ["X08"],
    note: "evidenceFile: x08-plugin.json",
  },
  {
    driver: "app/mcp-server/script/x08/compare.mjs",
    route: "figma-plugin",
    provides: ["X08"],
    note: "4面横断verdict。全X08 routeの必須provider",
  },
  {
    driver: "app/mcp-server/script/stdio-campaign-verification.mjs",
    route: "x09-mcp",
    provides: ["X09"],
    note: "X09_legacy_data: 旧形式保存データの読込み",
  },
  {
    driver: "app/mcp-server/script/stdio-campaign-verification2.mjs",
    route: "x09-mcp",
    provides: ["X09"],
    note: "X09_mcp_desktop_interop: MCP↔desktop 相互読込み",
  },
  {
    driver: "app/desktop/e2e/desktop-d-cases.mjs",
    route: "x09-desktop",
    provides: ["X09"],
    note: "MCP作成→desktop読込方向を実Electronで確認",
  },
  {
    driver: "script/x10-dependency-graph.mjs",
    route: "dependency-graph",
    platforms: ["repository"],
    provides: ["X10"],
  },
];
