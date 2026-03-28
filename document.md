# FigDiff - Figma Design Comparison Tool

## 設計書 & 開発計画 v4

---

## 1. プロダクト概要

### コンセプト
REDACTEDのエンジニアがFigmaデザインの実装ズレを「努力」ではなく「仕組み」で発見するツール。
Figma APIから取得したデザイン画像と実装スクショを機械的に比較し、AIが差分を起点にコードを修正する「Diff駆動開発」を実現する。

### 核心思想: Diff駆動 — AIが「見て直す」ワークフロー

従来のFigma MCPの問題は、AIがFigmaの詳細情報を読んで「スペックから作り上げる」スタンスを取ること。
結果として、AIが独自解釈してデザインと全く違うものを生成する「言うこと聞かない問題」が発生する。

FigDiffのアプローチ:
- **AIは最初にdiffを見る**（compare_design）→ 何がズレているか機械的に分かる
- **ズレている箇所だけ**詳細を調べる（inspect_node）→ 的を絞れる
- **コードを直す** → **もう一回diff** → 差分ゼロまでループ
- AIが「自分で比較して、自分で直して、自分で確認する」サイクルを回す

```
❌ 従来: AI → Figma全情報を読む → 独自解釈で実装 → ズレる → 人間が指摘
✅ FigDiff: AI → diff → ズレを特定 → 該当箇所だけ詳細取得 → 修正 → diff → ゼロ確認
```

### 既存ツールとの差別化

| 既存ツール | 限界 | FigDiffの優位性 |
|-----------|------|----------------|
| PerfectPixel | Chrome拡張のみ、Web専用、手動位置合わせ、比較モード少ない | デスクトップアプリ、モバイル対応、自動整列、8比較モード |
| Pixelay | Figma Edit権限必須、月額$20、無料版はデスクトップ比較不可、7比較モードだが機械的diff検出なし | APIベース、Viewer権限でOK、無料、8比較モード（7+Pixel Diff+Toggle） |
| Figma MCP (既存) | テキストデータのみ、AIが全情報から独自解釈 | 画像diff起点、AIが見て直すサイクル |
| 目視確認 | REDACTEDだと余白・微妙な色味を見落とす | 機械がピクセル単位で検出、見落としゼロ |

### ターゲットユーザー
- REDACTEDや注意力の課題を持つエンジニア
- フロントエンド / モバイル開発者
- デザインQAを効率化したいチーム
- Cursor / Claude Code / Copilot ユーザー

---

## 2. 技術スタック

| レイヤー | 技術 | バージョン目安 |
|---------|------|--------------|
| デスクトップフレームワーク | Electron + electron-vite | Electron 35.x |
| フロントエンド | React + TypeScript | React 19, TS 5.x |
| 状態管理 | Zustand | 5.x |
| スタイリング | Tailwind CSS | 4.x |
| UIコンポーネント | shadcn/ui | 最新 |
| 画像比較エンジン | pixelmatch (npm) | 6.x |
| 画像リサイズ | sharp (npm) | 0.33.x |
| デザインツール連携 | Figma REST API v1（将来: Penpot等も対応） |
| AI分析 | MCPサーバー経由（Cursor / Claude Code / Copilot等） |
| MCPサーバー | TypeScript + @modelcontextprotocol/sdk | 最新 |
| MCPサーバーランタイム | Node.js (stdio transport) | 22.x LTS |
| 秘密情報管理 | Electron safeStorage（OS標準のCredential Manager） |
| ビルド | Vite (electron-vite) | 6.x |
| パッケージマネージャー | pnpm | 9.x |
| バリデーション | Zod | 最新 |
| リンター | Biome + ESLint v9 (type-aware) | 最新 |

### なぜElectron？
- Node.js API（sharp等）をメインプロセスで直接利用可能
- WebContentsView でライブオーバーレイ（実装サイトの埋め込み表示）が容易
- エコシステムの安定性と豊富なドキュメント
- electron-vite によるHMR + 高速ビルド
- OS標準のsafeStorageで秘密情報を安全に保存

### なぜAPIキー不要の設計？
- ユーザーは既にCursor / Claude Code / GitHub Copilotなどを契約している
- そこにMCPサーバーを追加するだけでAI分析が使える
- APIキー管理の手間もセキュリティリスクもなくなる
- 必要なのはFigma Personal Access Tokenだけ（これはOS Keychainに保存）

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌───────────────────────────────────────────────────────┐
│              Electron Desktop App (electron-vite)       │
│                                                        │
│  ┌─────────────────────┐  ┌─────────────────────────┐ │
│  │   React Frontend    │  │   Electron Main Process  │ │
│  │   (Renderer)        │  │   (Node.js)              │ │
│  │                     │  │                          │ │
│  │  ┌───────────────┐  │  │  - ファイル読み書き       │ │
│  │  │ TabBar        │  │  │  - 画像リサイズ (sharp)  │ │
│  │  │ + PageSidebar │  │  │  - safeStorage連携      │ │
│  │  ├───────────────┤  │  │  - 画像キャッシュ        │ │
│  │  │ CompareView   │←─┼──│  - プロジェクト永続化    │ │
│  │  │ (Canvas描画)  │  │  │  - WebContentsView      │ │
│  │  │ + CropRegion  │  │  │    (Live Overlay)       │ │
│  │  ├───────────────┤  │  │                          │ │
│  │  │ DiffReport    │  │  └─────────────────────────┘ │
│  │  │ (差分リスト)   │  │                               │
│  │  └───────────────┘  │  ┌─────────────────────────┐ │
│  │                     │  │  Services (TS)          │ │
│  └─────────────────────┘  │                          │ │
│                           │  - Design Provider       │ │
│                           │    (Figma / 画像直接)    │ │
│                           │  - pixelmatch 比較       │ │
│                           │  - レポート生成          │ │
│                           └─────────────────────────┘ │
└───────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────┐
│              MCP Server (TypeScript / npm公開)          │
│                                                        │
│  🎯 Primary（AIが最初に使うべきツール）                  │
│  - compare_design       (diff比較 → ★起点★)           │
│                                                        │
│  🔍 Secondary（diffで見つけた箇所を深掘り）              │
│  - inspect_node         (Dev Mode的な詳細情報)          │
│  - get_design_tokens    (フレーム全体の数値データ)       │
│                                                        │
│  📋 Utility                                            │
│  - list_projects        (プロジェクト一覧取得)           │
│  - list_figma_frames    (フレーム一覧取得)              │
│  - generate_diff_report (レポート生成)                  │
│  - get_crop_region      (比較範囲取得)                  │
│  - set_crop_region      (比較範囲設定)                  │
│                                                        │
│  ← Cursor / Claude Code / Claude Desktop /             │
│     GitHub Copilot 等から stdio で接続                  │
└───────────────────────────────────────────────────────┘
```

### 3.2 Diff駆動ワークフロー（AIの行動設計）

AIがMCPサーバーを使う時、以下の順序で行動するように**ツールの説明文で誘導**する:

```
Step 1: compare_design（最初に必ずこれ）
  ↓ 一致率 + 差分箇所のリストが返る
  ↓
Step 2: 一致率が100%なら終了。そうでなければ...
  ↓
Step 3: inspect_node（差分がある箇所だけ詳細取得）
  ↓ padding, color, fontSize 等のCSS的な値が返る
  ↓
Step 4: コードを修正
  ↓
Step 5: スクショを再取得（ブラウザリロード等）
  ↓
Step 6: compare_design（再比較）→ Step 2 に戻る
```

**なぜこの順序になるか（ツール設計の工夫）:**
- `compare_design` のdescriptionに「実装修正時は必ずこのツールから開始してください」と明記
- `inspect_node` のdescriptionに「compare_designで差分が見つかった箇所の詳細を取得するツール」と明記
- `get_design_tokens` のdescriptionに「フレーム全体のトークンが必要な場合のみ使用」と明記
- `compare_design` の返り値に `diff_regions`（差分がある領域の座標リスト）を含め、inspect_nodeの入力にそのまま使えるようにする
- `compare_design` の返り値に `next_action` フィールドで「inspect_nodeで詳細を確認してください」と誘導メッセージを含める

### 3.3 URL/パス入力の統一設計

全てのMCPツールで、FigmaのURLでもローカルパスでも直接指定できるようにする。

```typescript
// 入力の種類と自動判定
type DesignInput =
  | string  // 以下のいずれかを自動判定:
  //
  // Figma URL（フレーム指定あり）:
  //   "https://www.figma.com/design/ABC123/FileName?node-id=1-23"
  //   → file_key: "ABC123", node_id: "1:23" を自動パース
  //
  // Figma URL（ファイルのみ）:
  //   "https://www.figma.com/design/ABC123/FileName"
  //   → file_key: "ABC123", フレーム選択が必要
  //
  // ローカル画像パス:
  //   "/Users/kosuke/screenshots/home.png"
  //   "~/projects/app/screenshot.png"
  //   → ImageFileProvider で直接読み込み
  //
  // 相対パス（Claude Code のワーキングディレクトリ基準）:
  //   "./screenshots/home.png"
  //   "src/assets/design.png"
  //   → 相対パスとして解決

function parseDesignInput(input: string): {
  type: "figma_url" | "local_path";
  fileKey?: string;
  nodeId?: string;
  filePath?: string;
} {
  if (input.includes("figma.com")) {
    // Figma URL をパース
    const fileKey = extractFileKey(input);
    const nodeId = extractNodeId(input); // null if not specified
    return { type: "figma_url", fileKey, nodeId };
  } else {
    // ローカルパスとして扱う
    return { type: "local_path", filePath: resolvePath(input) };
  }
}
```

### 3.4 Design Provider（デザインツール抽象化）

```typescript
interface DesignProvider {
  name: string;
  
  // フレーム一覧取得
  listFrames(fileUrl: string): Promise<Frame[]>;
  
  // フレーム画像取得（レンダリング済み）
  getFrameImage(fileUrl: string, frameId: string, scale: number): Promise<Buffer>;
  
  // デザイントークン取得（フレーム全体）
  getDesignTokens(fileUrl: string, frameId: string, depth: number): Promise<DesignToken[]>;
  
  // ★ 新規: 特定ノードの詳細情報取得（Dev Mode的）
  inspectNode(fileUrl: string, nodeId: string): Promise<NodeInspection>;
}

// Figma Dev Mode 的な詳細情報
interface NodeInspection {
  node_id: string;
  node_name: string;
  node_type: string;  // "FRAME" | "TEXT" | "RECTANGLE" | "COMPONENT" etc.
  
  // レイアウト
  layout: {
    x: number;
    y: number;
    width: number;
    height: number;
    layout_mode?: "HORIZONTAL" | "VERTICAL" | "NONE";
    padding_top?: number;
    padding_right?: number;
    padding_bottom?: number;
    padding_left?: number;
    item_spacing?: number;       // Auto Layout の gap
    primary_axis_align?: string; // justify-content 相当
    counter_axis_align?: string; // align-items 相当
  };
  
  // 見た目
  appearance: {
    fills: Array<{
      type: "SOLID" | "GRADIENT_LINEAR" | "IMAGE";
      color?: string;     // "#FF5733" 形式
      opacity?: number;
    }>;
    strokes: Array<{
      color: string;
      weight: number;
      align: "INSIDE" | "OUTSIDE" | "CENTER";
    }>;
    border_radius: {
      top_left: number;
      top_right: number;
      bottom_right: number;
      bottom_left: number;
    };
    opacity: number;
    blend_mode: string;
    effects: Array<{
      type: "DROP_SHADOW" | "INNER_SHADOW" | "BLUR";
      color?: string;
      offset?: { x: number; y: number };
      radius: number;
      spread?: number;
    }>;
  };
  
  // テキスト（TEXT ノードの場合）
  typography?: {
    font_family: string;
    font_weight: number;     // 400, 700 etc.
    font_size: number;
    line_height: number | "AUTO";
    letter_spacing: number;
    text_align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
    text_decoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
    text_content: string;    // 実際のテキスト
  };
  
  // CSS変換（参考値）
  css_suggestion: string;    // "padding: 16px 24px; gap: 8px; ..."
  
  // 子ノード（1階層のみ）
  children_summary: Array<{
    node_id: string;
    node_name: string;
    node_type: string;
    width: number;
    height: number;
  }>;
}
```

**現時点で実装するProvider:**
- `FigmaProvider` — Figma REST API経由（inspectNode含む）
- `ImageFileProvider` — 画像ファイルを直接入力（inspectNodeは非対応、画像比較のみ）

---

## 4. 画面設計

### 4.0 UXフロー概要（実装URL起点）

```
1. ホーム画面
   ├── 保存済みプロジェクト一覧（カード形式、永続化）
   └── [+ 新規プロジェクト] ボタン

2. 新規プロジェクト作成ダイアログ
   ├── プロジェクト名を入力（例: "コーポレートサイト"）
   └── 実装URL（例: http://localhost:3000）を入力 → 作成

3. プロジェクトが開く（タブとして）
   ├── 左: ページ一覧サイドバー + [+ ページ追加]
   │   └── ページ名とパスを入力（例: "ホーム", "/home"）
   └── 右: 選択中ページのデザインソース管理
       ├── [+ Figma URLを追加] [+ ローカル画像を追加]
       ├── デザインソース一覧（PC版、SP版、等）
       └── 各ソースで [比較実行] → Compare画面へ

4. Compare画面
   └── 既存の8モード比較ビュー（後述）
```

**フロー逆転の理由:**
- 開発者の実際のワークフローは「実装が先にあり、デザインと照合する」
- 1ページに対してPC/SP等の複数デザインソースが存在する
- プロジェクト単位で管理することで、次回以降はURLの再入力が不要

### 4.1 ホーム画面（プロジェクト一覧 + タブバー）

```
┌────────────────────────────────────────────────────┐
│ [コーポレートサイト ×] [ECサイト ×] [+]     [設定] │ ← タブバー
├────────────────────────────────────────────────────┤
│                                                    │
│  FigDiff                                           │
│                                                    │
│  📁 プロジェクト一覧                                │
│                                                    │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────┐   │
│  │ コーポレート   │ │ ECサイト     │ │    ＋    │   │
│  │ localhost:3000│ │ localhost:8080│ │  新規作成 │   │
│  │ ページ: 5     │ │ ページ: 3    │ │          │   │
│  │ 更新: 今日    │ │ 更新: 昨日   │ │          │   │
│  └──────────────┘ └──────────────┘ └──────────┘   │
│                                                    │
└────────────────────────────────────────────────────┘
```

**機能:**
- 保存済みプロジェクトをカード形式で一覧表示（~/.figdiff/に永続化）
- カードクリック → 新しいタブでプロジェクトが開く
- [+新規作成] → プロジェクト作成ダイアログ
- プロジェクトカードにはURL、ページ数、最終更新日を表示

### 4.1.1 タブバー

```
┌──────────────────────────────────────────────────────┐
│ [コーポレートサイト ×] [ECサイト ×] [+]       [設定] │
└──────────────────────────────────────────────────────┘
```

- ブラウザ風タブ（React内レンダリング、単一Electronウィンドウ）
- 各タブ = 1プロジェクト。タブ切替でプロジェクト間を移動
- [×] でタブを閉じる（プロジェクト自体は削除されない）
- [+] で新規プロジェクト作成 or ホーム画面に戻る
- 将来: タブのドラッグ&ドロップで並び替え、別ウィンドウへの分離

### 4.1.2 プロジェクトビュー（タブ内レイアウト）

```
┌────────────────────────────────────────────────────┐
│ [コーポレートサイト ×] [ECサイト ×] [+]     [設定] │
├────────────────────────────────────────────────────┤
│ FigDiff > コーポレートサイト > /home > PC版デザイン │
├──────────┬─────────────────────────────────────────┤
│ ページ一覧│  デザインソース & 比較ビュー             │
│          │                                         │
│ ▸ /home  │  🔗 PC版デザイン (Figma)    [比較]      │
│   /about │  🔗 SP版デザイン (Figma)    [比較]      │
│   /price │  📁 修正前スクショ          [比較]      │
│          │                                         │
│ [+ 追加] │  [+ デザインソースを追加]                │
└──────────┴─────────────────────────────────────────┘
```

**左サイドバー: ページ一覧**
- プロジェクト内のページ（/home, /about, /price 等）をリスト表示
- [+ 追加] でページ名 + パスを入力して新規ページ追加
- ページの実装URLは `{project.implementationUrl}{page.path}` で自動結合

**右メインエリア: デザインソース管理**
- 選択中ページに紐づくデザインソースを一覧表示
- 各ソースにラベル（PC版、SP版等）と種別（Figma / ローカル画像）を表示
- [比較] ボタンでCompare画面に遷移
- [+ デザインソースを追加] でFigma URLまたはローカル画像パスを追加

### 4.2 メイン比較画面（コア機能）

```
┌──────────────────────────────────────────────────────────┐
│  ProjectA > /home > PC版デザイン     [← →] [比較実行]     │
├────────────────────────────────┬─────────────────────────┤
│                                │                         │
│     比較ビューエリア            │   差分分析パネル         │
│                                │                         │
│  ┌──────────────────────────┐  │  📊 一致率: 94.2%       │
│  │                          │  │  差分ピクセル: 5,800    │
│  │   Figmaデザイン画像       │  │                         │
│  │      ＋                  │  │  🔴 差分領域 1          │
│  │   実装スクショ            │  │  位置: (120, 45)        │
│  │   （半透明オーバーレイ）    │  │  サイズ: 300x40px      │
│  │                          │  │  [inspect →]            │
│  │   🔴 🔴  ← 差分箇所     │  │                         │
│  │                          │  │  🔴 差分領域 2          │
│  │  ┌ ─ ─ ─ ─ ─ ─ ─ ┐     │  │  位置: (300, 200)       │
│  │  │  Crop Region   │     │  │  サイズ: 200x200px     │
│  │  └ ─ ─ ─ ─ ─ ─ ─ ┘     │  │  [inspect →]            │
│  └──────────────────────────┘  │                         │
│                                │  ✅ その他の領域: 一致   │
│  [🎨] [</>] [🔲] [◧] [◐] [✥] [🔴] [⟳] │  [レポート出力]   │
│                                │  [MCPコマンドをコピー]    │
│  透明度: ────●──── 50%        │                         │
│  範囲: [全体] [範囲指定]       │                         │
│                                │                         │
├────────────────────────────────┤                         │
│  数値差分リスト                 │                         │
│  ┌──────────────────────────┐  │                         │
│  │ 要素     | Figma | 実装  │  │                         │
│  │ header-p | 16px  | 12px ❌│  │                         │
│  │ card-rad | 8px   | 4px  ❌│  │                         │
│  │ font-sz  | 14px  | 14px ✅│  │                         │
│  └──────────────────────────┘  │                         │
└────────────────────────────────┴─────────────────────────┘
```

**表示モード（8モード — Pixelay同等 + FigDiff独自）:**

| # | モード名 | アイコン | 説明 | Pixelay対応 |
|---|---------|---------|------|------------|
| 1 | Design Only | 🎨 | Figmaデザイン画像のみ表示 | Original Design |
| 2 | Implementation | </> | 実装スクリーンショットのみ表示 | Website Build |
| 3 | Transparent Overlay | 🔲 | デザインと実装を透明度調整で重ねる（**Overlay Opacityスライダー付き**） | Transparent Overlay |
| 4 | Split Screen | ◧ | 左右分割（ドラッグで境界線を移動可能） | Split Screen |
| 5 | Blended Diff | ◐ | 差分をブレンド表示（ズレが色で浮き出る） | Blended Diff |
| 6 | Draggable Overlay | ✥ | デザイン画像をドラッグで移動しながら比較 | Draggable Overlay |
| 7 | **Pixel Diff** ★ | 🔴 | **FigDiff独自** — pixelmatchによる機械的差分検出。赤ハイライトで差分箇所表示、クリックでinspect_node詳細へ。nearby_node_ids連携 | （Pixelayにはない） |
| 8 | Toggle | ⟳ | デザインと実装を一定間隔で切替表示 | Toggle Overlay |

**共通UI:**
- Overlay Opacityスライダー（モード3, 6で使用、0-100%）
- モード切替はツールバーのアイコンクリック（Pixelayと同じUX）

**Pixelayとの差別化ポイント:**
- モード7のPixel Diffは機械的な差分検出で、目視では見落とすレベルのズレも自動検出
- 差分領域クリック → Figmaノード情報へ直接ジャンプ（inspect_node連携）
- MCP経由でAIが差分を読み取れる（人間のGUI操作不要で自動修正ループ可能）

### 4.3 設定画面

```
┌──────────────────────────────────────────┐
│  設定                                    │
├──────────────────────────────────────────┤
│                                          │
│  🔑 Figma Personal Access Token:         │
│  ┌────────────────────────────────────┐  │
│  │ ••••••••••••••••  [OS Keychainに保存]│  │
│  └────────────────────────────────────┘  │
│                                          │
│  🎨 テーマ: [ダーク ▼]                   │
│  📏 デフォルト許容差: [5] px             │
│  📁 データ保存先: ~/.figdiff/            │
│                                          │
│  [保存]                                  │
└──────────────────────────────────────────┘
```

---

## 5. MCPサーバー設計

### 5.1 概要
Cursor / Claude Code / Claude Desktop / GitHub Copilot 等から呼び出せるMCPサーバー。
**Diff駆動ワークフローの中核。**

### 5.2 ツール設計思想: AIを「仕組み」で動かす（プロンプトではなく出力構造で強制）

**核心**: AIはプロンプトの指示を無視することがあるが、**ツールの出力データは無視できない**（次の行動の判断材料だから）。
テストが赤い時にAIが直したくなるのと同じ心理を、MCP出力で再現する。

#### 原則1: 数値で強制する（PASS/FAIL構造）
- compare_designの返り値に `status: "PASS" | "FAIL"` を含める
- `completionCriteria` で各指標の目標値と現在値を構造化
- AIは「3つのFAILが残っている」→「修正しないといけない」と自然に判断する

#### 原則2: ツール説明文を「AIの行動仕様書」にする
- 「何ができるか」ではなく「いつ使うか」「完了条件は何か」で書く
- AIが読んだ瞬間に「ループしないといけない」と理解する構造

#### 原則3: ツール間の依存関係を出力で強制
```
compare_design → status: FAIL
  ↓ nextAction に "inspect_node を実行" と書いてある
inspect_node → cssSuggestion に具体的な修正値
  ↓ "この値をCSSに適用してから再度 compare_design を実行"
compare_design → status: PASS ← ここで初めて完了
```

#### 原則4: 従来の設計も維持
1. **compare_design を「入口」にする** — descriptionに「まずこのツールで差分を確認してください」と書く
2. **inspect_node を「差分の深掘り」に位置づける** — descriptionに「compare_designで見つかった差分箇所の詳細を取得するツール」と書く
3. **get_design_tokens は「フレーム全体のスペック」** — descriptionに「初回設計時のみ。修正時はcompare_design + inspect_nodeを使ってください」と書く
4. **compare_design の返り値で次のアクションを示唆** — `nextAction` フィールドで具体的に誘導
5. **inspect_node の返り値にCSS提案を含める** — AIがすぐコード修正できるように

### 5.3 Tools定義（8個 — 7個 + list_projects）

```typescript
// ============================================================
// 🎯 PRIMARY: AIが最初に使うべきツール
// ============================================================

// Tool 1: デザインと実装のDiff比較（★起点★）
{
  name: "compare_design",
  description: `Figmaデザインと実装スクリーンショットのピクセル差分を検出します。

**実装の修正時は、必ずこのツールから開始してください。**
このツールが返す差分画像と差分領域を確認し、ズレがある箇所だけを inspect_node で深掘りしてください。
修正後は再度このツールで比較し、一致率100%を目指してください。

入力:
- design_source: Figma URL（node-id付きなら自動でそのフレーム） or ローカル画像パス
- screenshot: 実装スクリーンショットのローカルパス
- threshold: 許容差（デフォルト0.1）

Figma URLの例:
  "https://www.figma.com/design/ABC123/File?node-id=1-23"  → フレーム指定あり
  "https://www.figma.com/design/ABC123/File"               → フレーム一覧から選択

ローカルパスの例:
  "/path/to/design.png"
  "./screenshots/home.png"`,
  inputSchema: {
    type: "object",
    properties: {
      design_source: {
        type: "string",
        description: "FigmaのURL（node-id付き推奨）またはデザイン画像のローカルパス"
      },
      screenshot: {
        type: "string",
        description: "実装スクリーンショットのローカルパス"
      },
      frame_name: {
        type: "string",
        description: "Figma URLにnode-idが含まれない場合のフレーム名（省略可）"
      },
      threshold: {
        type: "number",
        description: "色差の許容閾値（0-1）。デフォルト0.1",
        default: 0.1
      }
    },
    required: ["design_source", "screenshot"]
  }
  // 返り値の構造は 5.4 参照
}

// ============================================================
// 🔍 SECONDARY: diffで見つけた箇所を深掘りするツール
// ============================================================

// Tool 2: 特定ノードのDev Mode的詳細情報（差分箇所の深掘り用）
{
  name: "inspect_node",
  description: `compare_designで差分が見つかったFigmaノードの詳細情報を取得します。
Figma Dev Modeで見られるような、CSS的なプロパティ（padding, gap, color, font等）を返します。

**このツールはcompare_designの後に、差分がある箇所に対して使ってください。**
compare_designの返り値に含まれるnearby_node_idsをそのまま渡すと、
差分に関連するノードの詳細情報を効率よく取得できます。

フレーム全体のスペックが必要な場合は get_design_tokens を使ってください。`,
  inputSchema: {
    type: "object",
    properties: {
      figma_url: {
        type: "string",
        description: "FigmaのURL（ファイルURL or node-id付きURL）"
      },
      node_id: {
        type: "string",
        description: "検査するノードのID（例: '1:23'）。compare_designの返り値のnearby_node_idsから取得推奨"
      },
      node_ids: {
        type: "array",
        items: { type: "string" },
        description: "複数ノードを一括取得する場合。最大10個"
      }
    },
    required: ["figma_url"]
    // node_id か node_ids のどちらかが必要
  }
  // 返り値: NodeInspection（3.4のインターフェース参照）
  // + css_suggestion フィールドでCSS提案
}

// Tool 3: フレーム全体のデザイントークン
{
  name: "get_design_tokens",
  description: `Figmaフレーム全体のデザイントークン（padding, color, fontSize等の数値データ）を取得します。

**注意: 実装の修正時はこのツールではなく、compare_design → inspect_node のフローを推奨します。**
このツールは、新規ページの初回実装時や、フレーム全体の概要を把握したい場合に使用してください。
修正作業では、差分がある箇所だけを inspect_node で取得するほうが効率的です。`,
  inputSchema: {
    type: "object",
    properties: {
      figma_url: {
        type: "string",
        description: "FigmaのURL（node-id付きなら自動でそのフレーム）"
      },
      frame_name: {
        type: "string",
        description: "対象フレーム名（URLにnode-idがない場合）"
      },
      depth: {
        type: "number",
        description: "ノード探索の深さ（デフォルト: 2、最大: 5）。深いほど詳細だがデータ量が増加",
        default: 2
      }
    },
    required: ["figma_url"]
  }
}

// ============================================================
// 📋 UTILITY: 補助ツール
// ============================================================

// Tool 4: フレーム一覧取得
{
  name: "list_figma_frames",
  description: "Figmaファイル内のフレーム一覧を取得します。各フレームのID, 名前, サイズを返します。",
  inputSchema: {
    type: "object",
    properties: {
      figma_url: {
        type: "string",
        description: "FigmaファイルのURL"
      }
    },
    required: ["figma_url"]
  }
}

// Tool 5: 差分レポート生成
{
  name: "generate_diff_report",
  description: "compare_designの結果をMarkdownレポートとして生成します。",
  inputSchema: {
    type: "object",
    properties: {
      comparison_id: {
        type: "string",
        description: "compare_designの返り値に含まれるcomparison_id"
      },
      format: {
        type: "string",
        enum: ["markdown", "json"],
        default: "markdown"
      }
    },
    required: ["comparison_id"]
  }
}

// Tool 6: 比較範囲の取得
{
  name: "get_crop_region",
  description: "プロジェクトに設定された比較範囲を取得します。モバイルのステータスバー除外等に使用。",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "プロジェクトID"
      },
      frame_name: {
        type: "string",
        description: "フレーム名（省略時は全フレームの範囲を返す）"
      }
    },
    required: ["project_id"]
  }
}

// Tool 7: 比較範囲の設定
{
  name: "set_crop_region",
  description: "比較範囲を設定します。モバイルスクショのステータスバー除外等に使用。",
  inputSchema: {
    type: "object",
    properties: {
      project_id: {
        type: "string",
        description: "プロジェクトID"
      },
      frame_name: {
        type: "string",
        description: "フレーム名"
      },
      region: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" }
        },
        required: ["x", "y", "width", "height"]
      },
      note: {
        type: "string",
        description: "メモ（例: iOSステータスバー除外）"
      }
    },
    required: ["project_id", "frame_name", "region"]
  }
}
```

### 5.4 compare_design の返り値設計（AIを仕組みで動かす）

```typescript
// compare_design が返すデータ — テスト結果のようにPASS/FAILで強制
interface CompareDesignResult {
  // ★ PASS/FAIL — AIはFAILを放置できない
  status: "PASS" | "FAIL";

  comparison_id: string;
  match_rate: number;             // 94.2（%）
  diff_pixel_count: number;       // 5800
  total_pixel_count: number;      // 100000
  remaining_issues: number;       // 差分領域の数（0でないとタスク完了できない）

  // ★ 差分がある領域のリスト（AIがinspect_nodeに渡せる）
  diff_regions: Array<{
    id: number;
    bounds: { x: number; y: number; width: number; height: number };
    diff_pixel_count: number;
    // ★ この差分領域に近いFigmaノードのID（inspect_nodeにそのまま渡せる）
    nearby_node_ids: string[];
    nearby_node_names: string[];
  }>;

  // ★ 完了条件を構造化データとして返す（AIが機械的に判断できる）
  completion_criteria: {
    match_rate: { required: 100; current: number; status: "PASS" | "FAIL" };
    diff_pixel_count: { required: 0; current: number; status: "PASS" | "FAIL" };
    remaining_issues: { required: 0; current: number; status: "PASS" | "FAIL" };
  };

  // ★ AIへの次のアクション（具体的な行動指示）
  next_action: string;
  // 例:
  // status === "PASS" → "一致率100%です。差分はありません。タスク完了です。"
  // status === "FAIL" → "inspect_node を使って diffRegions の詳細を確認し、修正してください。"

  // ★ 後方互換: 従来のsuggestionも維持
  suggestion: string;
}

// MCP content として返す形式
content: [
  {
    type: "image",
    data: base64_diff_image,  // 差分画像（赤ハイライト）
    mimeType: "image/png"
  },
  {
    type: "text",
    text: JSON.stringify(compareDesignResult)
  }
]
```

**nearby_node_ids の仕組み:**
差分画像の赤い領域の座標と、Figmaのノードツリーの各ノードの座標（absoluteBoundingBox）をマッチングし、差分領域に重なるノードを特定する。これにより、AIは「どのFigmaノードがズレているか」をすぐ知れる。

### 5.5 MCPサーバー利用例

**例1: Diff駆動の修正サイクル（コアユースケース）**
```
ユーザー: 「このページのFigmaデザインとの差分を直して」

AI: [compare_design(
      design_source: "https://figma.com/design/ABC/File?node-id=1-23",
      screenshot: "./screenshots/home.png"
    )]
    → 一致率 94.2%、差分3箇所、nearby_node_ids取得

AI: [inspect_node(
      figma_url: "https://figma.com/design/ABC/File",
      node_ids: ["1:45", "1:67"]  // compare_designの結果から
    )]
    → padding: 16px, border-radius: 8px, color: #F5F5F5 等

AI: 「3箇所のズレを特定しました。修正します。」
    → コードを修正

AI: 「スクショを再取得して確認します。」
    [compare_design(同じ引数)]
    → 一致率 99.8%、残り差分1箇所

AI: [inspect_node で残り1箇所を確認]
    → 再修正

AI: [compare_design]
    → 一致率 100%
AI: 「デザインとの差分がゼロになりました！ ✅」
```

**例2: ローカル画像同士の比較**
```
ユーザー: 「このデザインカンプとスクショを比較して」

AI: [compare_design(
      design_source: "./design/home-v2.png",
      screenshot: "./screenshots/home.png"
    )]
    → ローカル画像同士のpixelmatch比較
    → Figma情報はないのでinspect_nodeは使えないが、差分画像は得られる
```

**例3: Figma URL指定でフレーム選択**
```
ユーザー: 「https://figma.com/design/ABC/File のLoginページとの差分を見て」

AI: [list_figma_frames(figma_url: "https://figma.com/design/ABC/File")]
    → [Home, Login, Dashboard, ...] 一覧取得

AI: [compare_design(
      design_source: "https://figma.com/design/ABC/File",
      screenshot: "./screenshots/login.png",
      frame_name: "Login"
    )]
```

**例4: モバイルのステータスバー除外**
```
ユーザー: 「Flutterのスクショ、ステータスバー抜いて比較して」

AI: [set_crop_region(project_id: "app", frame_name: "Home",
      region: {x: 0, y: 44, width: 375, height: 768},
      note: "iOSステータスバー除外")]

AI: [compare_design(...)]
    → Crop Region適用済みで比較
```

### 5.6 プロジェクトデータモデル（v4 新設計）

```typescript
// DesignSource — 各ページに紐づくデザインソース（Figma URL or ローカル画像）
const DesignSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("figma"),
    id: z.string(),
    label: z.string(),                     // "PC版デザイン", "SP版デザイン"
    figmaUrl: z.string(),
    fileKey: z.string(),
    nodeId: z.string().optional(),
    frameName: z.string().optional(),
  }),
  z.object({
    type: z.literal("local_image"),
    id: z.string(),
    label: z.string(),                     // "修正前スクショ"
    filePath: z.string(),
  }),
]);

// ProjectPage — 実装の1ページ（/home, /about 等）
const ProjectPageSchema = z.object({
  id: z.string(),
  name: z.string(),                        // "ホーム"
  path: z.string(),                        // "/home"
  designSources: z.array(DesignSourceSchema),
});

// Project — 1つの実装サーバーURL + N個のページ
const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),                        // "コーポレートサイト"
  implementationUrl: z.string(),           // "http://localhost:3000"
  pages: z.array(ProjectPageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

**構造のポイント:**
- Project = 1つの実装サーバーURL（起点）
- Page = 実装URLの1ページ（`implementationUrl + page.path` でフルURL）
- DesignSource = 各ページに紐づくデザインソース（複数可。PC版Figma、SP版Figma、ローカル画像等）

### 5.7 Crop Region データ共有 & プロジェクト永続化

```
共有データディレクトリ: ~/.figdiff/

~/.figdiff/
├── settings.json              # グローバル設定
├── projects/
│   ├── {project-id}/
│   │   ├── project.json       # ProjectSchema 全体（ページ・デザインソース含む）
│   │   ├── crop-regions.json
│   │   ├── cache/             # Figma画像キャッシュ
│   │   └── comparisons/       # 比較結果履歴
│   └── ...
└── ...
```

### 5.8 MCPサーバーのディレクトリ構造

```
app/mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── server.ts
│   ├── tools/
│   │   ├── compare-design.ts       # 🎯 Primary
│   │   ├── inspect-node.ts         # 🔍 Secondary
│   │   ├── get-design-tokens.ts    # 🔍 Secondary
│   │   ├── list-frames.ts          # 📋 Utility
│   │   ├── generate-report.ts      # 📋 Utility
│   │   ├── get-crop-region.ts      # 📋 Utility
│   │   └── set-crop-region.ts      # 📋 Utility
│   ├── services/
│   │   ├── design-input-parser.ts  # URL/パス自動判定
│   │   ├── node-matcher.ts         # 差分領域→Figmaノード マッチング
│   │   ├── crop-region-store.ts
│   │   └── report-generator.ts
│   └── types/
│       └── index.ts
└── README.md
```

---

## 6. Figma API 主要エンドポイント

### 使用するエンドポイント

```typescript
// 1. ファイル構造取得（フレーム一覧）
GET https://api.figma.com/v1/files/:file_key?depth=1
// → document.children[].children[] から type === "FRAME" を抽出

// 2. フレーム画像取得（レンダリング済みPNG）
GET https://api.figma.com/v1/images/:file_key
    ?ids=:node_id&format=png&scale=2
// → 一時URL、ダウンロードしてキャッシュ

// 3. ノード詳細取得（数値データ / Dev Mode情報）
GET https://api.figma.com/v1/files/:file_key/nodes
    ?ids=:node_id&depth=<指定値>
// → absoluteBoundingBox, paddingLeft/Right/Top/Bottom,
//   itemSpacing, layoutMode, fills, strokes, effects,
//   style (fontSize, fontFamily, fontWeight, lineHeight, letterSpacing),
//   cornerRadius, ...

// 4. コンポーネント情報
GET https://api.figma.com/v1/files/:file_key/components
```

### Figma URLのパース

```typescript
// 対応するURL形式:
// https://www.figma.com/design/FILE_KEY/Title?node-id=NODE_ID
// https://www.figma.com/file/FILE_KEY/Title?node-id=NODE_ID   (旧形式)
// https://www.figma.com/design/FILE_KEY/Title                  (node-idなし)

function extractFileKey(url: string): string {
  // /design/ or /file/ の後のパスセグメントを抽出
  const match = url.match(/\/(design|file)\/([a-zA-Z0-9]+)/);
  return match?.[2] ?? "";
}

function extractNodeId(url: string): string | null {
  const params = new URL(url).searchParams;
  const nodeId = params.get("node-id");
  return nodeId ? nodeId.replace("-", ":") : null;
  // Figma URLでは "1-23" だがAPIでは "1:23"
}
```

### 認証
```
Headers: { "X-FIGMA-TOKEN": "personal-access-token" }
```
デスクトップアプリ → OS Keychain、MCPサーバー → 環境変数 `FIGMA_TOKEN`

---

## 7. 主要処理フロー

### 7.1 画像リサイズ整合

```
Figmaフレーム画像 (例: 2880 x 1800)  ← scale=2 で取得
実装スクショ      (例: 1440 x 900)

→ Figma画像を実装スクショに合わせてリサイズ
   sharp(figmaImage).resize(screenshotWidth, screenshotHeight).toBuffer()

→ Crop Region 設定済みなら、両画像をクロップ後にリサイズ

→ 同じサイズの2枚をpixelmatchに渡す
```

### 7.2 差分領域 → Figmaノードのマッチング（node-matcher.ts）

compare_designの返り値にnearby_node_idsを含めるため、差分画像の赤い領域とFigmaノードの座標をマッチングする。

```
1. pixelmatch → 差分画像（赤ピクセル）
2. 赤ピクセルをクラスタリング → 差分領域のバウンディングボックス
   - 隣接ピクセル結合（8近傍）
   - 小さすぎるクラスタ（< 10px）は除外
3. Figma API → フレームの子ノード一覧（absoluteBoundingBox付き）
4. 各差分領域に対して、重なるFigmaノードを特定
   - 差分領域の中心座標がノードのBBox内にあるか
   - 複数候補がある場合、最も面積の小さいノード（=最も具体的）を優先
5. nearby_node_ids + nearby_node_names として返す
```

### 7.3 Diff駆動AIサイクル全体フロー

```
[ユーザー: 「Figmaデザインに合わせて」]
  │
  ├── ① AI: compare_design(figma_url, screenshot)
  │     → 差分画像 + diff_regions + nearby_node_ids
  │
  ├── ② AI: match_rate チェック
  │     → 100% なら完了
  │     → < 100% なら続行
  │
  ├── ③ AI: inspect_node(nearby_node_ids)
  │     → CSS的な詳細情報 + css_suggestion
  │
  ├── ④ AI: コード修正（css_suggestionを参考に）
  │
  ├── ⑤ AI: スクショ再取得
  │     （ブラウザリロード / flutter screenshot 等）
  │
  └── ⑥ AI: compare_design（再比較）→ ② に戻る
```

---

## 8. ディレクトリ構造

```
designdiff/
├── app/
│   ├── desktop/                    # Electron デスクトップアプリ
│   │   ├── electron/
│   │   │   ├── main.ts
│   │   │   ├── preload.ts
│   │   │   └── ipc/
│   │   │       ├── figma.ts
│   │   │       ├── file.ts
│   │   │       ├── token.ts
│   │   │       └── overlay.ts
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   └── Header.tsx
│   │   │   │   ├── compare/
│   │   │   │   │   ├── CompareCanvas.tsx
│   │   │   │   │   ├── CropRegionSelector.tsx
│   │   │   │   │   ├── ImageResizer.tsx
│   │   │   │   │   ├── OverlayControls.tsx
│   │   │   │   │   ├── DiffMarker.tsx
│   │   │   │   │   └── ViewModeToggle.tsx
│   │   │   │   ├── inspect/
│   │   │   │   │   └── NodeInspector.tsx      # Dev Mode風詳細表示
│   │   │   │   ├── diff/
│   │   │   │   │   ├── DiffTable.tsx
│   │   │   │   │   ├── DiffReport.tsx
│   │   │   │   │   └── McpCommandCopy.tsx
│   │   │   │   ├── project/
│   │   │   │   │   ├── ProjectList.tsx
│   │   │   │   │   ├── ProjectSetup.tsx
│   │   │   │   │   └── FrameSelector.tsx
│   │   │   │   └── settings/
│   │   │   │       └── SettingsForm.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useDesignProvider.ts
│   │   │   │   ├── useImageCompare.ts
│   │   │   │   ├── useCropRegion.ts
│   │   │   │   └── useKeychain.ts
│   │   │   ├── services/
│   │   │   │   ├── design-providers/
│   │   │   │   │   ├── interface.ts
│   │   │   │   │   ├── figma-provider.ts
│   │   │   │   │   └── image-file-provider.ts
│   │   │   │   ├── design-input-parser.ts    # URL/パス自動判定
│   │   │   │   ├── image-compare.ts
│   │   │   │   ├── image-resizer.ts
│   │   │   │   └── storage.ts
│   │   │   ├── stores/
│   │   │   │   ├── project-store.ts
│   │   │   │   ├── compare-store.ts
│   │   │   │   └── settings-store.ts
│   │   │   ├── types/
│   │   │   │   ├── design-provider.ts
│   │   │   │   ├── compare.ts
│   │   │   │   ├── node-inspection.ts
│   │   │   │   └── crop-region.ts
│   │   │   └── styles/
│   │   │       └── globals.css
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tailwind.config.ts
│   │   └── vite.config.ts
│   │
│   └── mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── server.ts
│       │   ├── tools/
│       │   │   ├── compare-design.ts
│       │   │   ├── inspect-node.ts
│       │   │   ├── get-design-tokens.ts
│       │   │   ├── list-frames.ts
│       │   │   ├── generate-report.ts
│       │   │   ├── get-crop-region.ts
│       │   │   └── set-crop-region.ts
│       │   ├── services/
│       │   │   ├── design-input-parser.ts
│       │   │   ├── node-matcher.ts
│       │   │   ├── crop-region-store.ts
│       │   │   └── report-generator.ts
│       │   └── types/
│       │       └── index.ts
│       └── README.md
│
├── package/
│   └── shared/
│       ├── package.json
│       ├── src/
│       │   ├── design-providers/
│       │   │   ├── interface.ts
│       │   │   ├── figma-provider.ts
│       │   │   └── image-file-provider.ts
│       │   ├── figma-api.ts
│       │   ├── figma-url-parser.ts       # URL→fileKey+nodeId パース
│       │   ├── image-diff.ts
│       │   ├── node-matcher.ts           # 差分領域→ノード マッチング
│       │   └── types.ts
│       └── tsconfig.json
│
├── pnpm-workspace.yaml
├── package.json
├── turbo.json
├── .env.example                    # FIGMA_TOKEN=
├── README.md
└── LICENSE
```

---

## 9. 開発計画（MVP → フル機能）

### Phase 0: 環境構築（1日）

**やること:**
- pnpmワークスペース + Turborepo セットアップ
- Electron + electron-vite + React + TypeScript 初期化
- Tailwind CSS + Biome 設定
- GitHub リポジトリ作成

**完了条件:** `pnpm dev` でElectronの空ウィンドウが起動する

---

### Phase 1: Figma API連携 + Design Provider + URL パース（3-4日）

**やること:**
- Design Provider インターフェース定義
- FigmaProvider 実装
  - ファイル構造取得 → トップレベルFRAMEノード抽出
  - フレーム画像取得 → ローカルキャッシュ
  - ノード詳細取得（inspectNode）→ Dev Mode的データ変換
  - depth制御
- ImageFileProvider 実装（画像直接読み込み）
- Figma URLパーサー（file_key + node_id 自動抽出）
- ローカルパス判定ロジック
- Figma Token → OS Keychain 保存
- フレーム画像表示

**完了条件:**
- Figma URLを入力 → フレーム一覧が出る → 画像表示
- node-id付きURL → 直接そのフレームが開く
- ローカル画像パス → 直接表示

---

### Phase 2: 画像比較コア + Crop Region（6-7日）

**やること:**
- スクショのドラッグ&ドロップ + パス直接入力
- 画像リサイズ整合（sharp）
- Crop Region（矩形ドラッグ指定、JSON自動保存）
- Canvas 2画像描画 + 8表示モード（Pixelay同等 + Pixel Diff + Toggle）
- Overlay Opacityスライダー + Pixel Ruler
- pixelmatch 差分画像生成 + 一致率表示
- 差分領域クラスタリング（赤ピクセル結合 → バウンディングボックス）
- 差分領域 → Figmaノードマッチング（node-matcher）

**完了条件:**
- 2枚の画像（サイズ違いでも）の差分が赤く表示される
- 差分領域ごとに対応するFigmaノードが特定される
- Crop Regionでモバイルスクショも正しく比較できる

---

### Phase 3: inspect_node + 数値差分 + レポート（4-5日）

**やること:**
- inspect_node 実装（Figma API→NodeInspection変換）
- css_suggestion 生成ロジック（Figmaデータ→CSS文字列）
- デスクトップアプリのNodeInspectorコンポーネント
- 数値差分テーブル（Figma値 vs 実装値）
- レポート出力（Markdown）
- 「MCPコマンドをコピー」ボタン

**完了条件:**
- 差分箇所クリック → Figmaの詳細情報（CSS的プロパティ）が表示される
- レポートがMarkdownで出力できる

---

### Phase 4: MCPサーバー（5-6日）

**やること:**
- @modelcontextprotocol/sdk でサーバー構築
- 7つのToolを実装 + list_projectsを追加（計8ツール、description含む）
  - compare_design（★Primary、suggestion付き返り値）
  - inspect_node（Dev Mode詳細 + css_suggestion）
  - get_design_tokens（description で「修正時は使わない」と明記）
  - list_figma_frames
  - generate_diff_report
  - get_crop_region / set_crop_region
- URL/パス自動判定（design-input-parser）
- diff_regions + nearby_node_ids の返り値実装
- suggestion フィールドの動的生成
- stdio transport
- README（Diff駆動ワークフローの説明、セットアップ手順）
- npm publish 準備

**完了条件:**
- Cursorから compare_design → 差分画像 + nearby_node_ids が返る
- inspect_node → CSS的プロパティ + css_suggestion が返る
- AIが自然に compare → inspect → fix → compare のサイクルを回せる

---

### Phase 5: 仕上げ（3-4日）✅ 完了

**やったこと:**
- ダークテーマ
- エラーハンドリング、ローディングUI
- オフライン対応（キャッシュ済み画像ならpixelmatch可能）
- Figma APIレート制限対策
- i18n（日本語/英語）
- README / ポートフォリオ用ドキュメント

---

### Phase A: データモデル + 永続化レイヤー（v4 新設計）

**やること:**
- ProjectSchema, ProjectPageSchema, DesignSourceSchema のZod定義（§5.6参照）
- Electron IPC経由の永続化レイヤー（~/.figdiff/projects/）
- project:list / project:load / project:save / project:delete ハンドラー
- PlatformAdapter への ProjectAdapter インターフェース追加
- 新Zodスキーマのテスト（TDD: テストファースト）

**完了条件:**
- プロジェクトの作成・読込・保存・削除がElectron IPC経由で動作する
- テストカバレッジ ≥ 80%

---

### Phase B: フロー逆転（実装URL起点 → デザインソース追加）

**やること:**
- ホーム画面をプロジェクト一覧に変更（§4.1参照）
- 新規プロジェクト作成ダイアログ（名前 + 実装URL入力）
- プロジェクトビュー（§4.1.2参照）: ページ一覧サイドバー + デザインソース管理
- ページ追加/編集UI（名前 + パス入力）
- デザインソース追加UI（Figma URL or ローカル画像パス + ラベル入力）
- 既存の Compare/LiveOverlay 画面への遷移を新フローに接続
- コンポーネントテスト

**完了条件:**
- 実装URLを先に入力 → ページ追加 → デザインソース追加 → 比較 のフローが動作
- プロジェクトが~/.figdiff/に永続化される

---

### Phase C: タブUI（React内タブバー + Store スコープ化）

**やること:**
- useTabStore の実装（タブの開閉・切替・順序管理）
- App.tsx にタブバーコンポーネント追加
- 既存Zustand storeのスコープ化（projectIdでインスタンス分離）
  - useProjectStore → useDesignSourceStore(projectId)
  - useCompareStore → useCompareStore(projectId, sourceId)
  - useOverlayStore → useOverlayStore(projectId)
- タブごとにページ状態を独立管理
- タブバーのテスト

**完了条件:**
- 複数プロジェクトを同時にタブで開き、切替できる
- 各タブの状態が独立している

---

### Phase D: MCP出力構造の強化

**やること:**
- CompareDesignResult に status, completion_criteria, next_action フィールド追加（§5.4参照）
- 各ツールのdescriptionを「いつ使うか」「完了条件は何か」形式に書き換え
- 新ツール list_projects の追加
- compare_design に project_id + page_path パラメータ追加（後方互換維持）
- MCPツールのテスト更新

**完了条件:**
- compare_design が status: "FAIL" / "PASS" を返す
- AIが出力を見て自律的にループを回す構造になっている
- 既存のパラメータなしでの利用も動作する（後方互換）

---

### Phase E: テストカバレッジ網羅

**やること:**
- 全パッケージのテストカバレッジを ≥ 80% に引き上げ
- 新機能（Phase A-D）のテストはTDDで各フェーズに含める
- 既存の不足分を補完
- E2Eテスト（主要フロー: プロジェクト作成 → ページ追加 → 比較 → 結果確認）

**完了条件:**
- `pnpm test --coverage` で全パッケージ ≥ 80%
- CI（lint + typecheck + test）が全てパス

---

### Phase F: Chrome拡張 + Figmaプラグイン仕上げ

**やること:**
- Chrome拡張: 統合テスト、UI仕上げ、manifest v3対応確認
- Figmaプラグイン: UI完成、フレームエクスポート、比較機能接続
- 両方のテストカバレッジ確保

**完了条件:**
- Chrome拡張が正常に動作する
- FigmaプラグインがFigma内から比較を実行できる

---

### 将来の追加機能

- Slack/Discord通知
- GitHub PR コメント自動投稿
- Figma Webhook で自動比較
- チーム共有機能
- Figma Variables 連携
- PenpotProvider 追加
- Web版（Electron不要のブラウザ版）
- タブのドラッグ&ドロップで別ウィンドウに分離

---

## 10. 開発期間サマリー

| Phase | 内容 | 期間 | 状態 |
|-------|------|------|------|
| 0 | 環境構築 | 1日 | ✅ 完了 |
| 1 | Figma API + Provider + URLパース | 3-4日 | ✅ 完了 |
| 2 | 画像比較コア + Crop Region + ノードマッチ | 6-7日 | ✅ 完了 |
| 3 | inspect_node + 数値差分 + レポート | 4-5日 | ✅ 完了 |
| 4 | MCPサーバー（8 tools + Diff駆動設計） | 5-6日 | ✅ 完了 |
| 5 | 仕上げ | 3-4日 | ✅ 完了 |
| **A** | **データモデル + 永続化レイヤー** | 2-3日 | 🔧 次 |
| **B** | **フロー逆転（実装URL起点）** | 3-4日 | 📋 計画中 |
| **C** | **タブUI + Store スコープ化** | 3-4日 | 📋 計画中 |
| **D** | **MCP出力構造の強化** | 2-3日 | 📋 計画中 |
| **E** | **テストカバレッジ ≥ 80%** | 2-3日 | 📋 計画中 |
| **F** | **Chrome拡張 + Figmaプラグイン仕上げ** | 3-4日 | 📋 計画中 |

**Phase 0-5（コア機能）: ✅ 完了**
**Phase A-F（UX進化 + 品質強化）: 約16-21日**

---

## 11. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| Figma APIレート制限 | 連続比較で429 | 画像キャッシュ、ETag、リトライ |
| 画像サイズ不一致 | pixelmatch動作不可 | sharp自動リサイズ |
| Figma画像URLの有効期限 | 期限切れ | 即ダウンロード、ローカル保存 |
| Figma APIの巨大JSON | メモリ圧迫 | depth制御、必要ノードのみ取得 |
| ノードマッチングの精度 | nearby_node_ids が不正確 | 候補を複数返す、AIが判断 |
| AIがdiffループを止めない | 無限ループ | suggestion に「5回以上比較してもズレが残る場合は人間に確認を」と含める |
| AIがget_design_tokensから始める | Diff駆動にならない | description で強く誘導 + compare_designの返り値で次のアクションを提示 |
| Electron バンドルサイズ | 150MB+ | electron-builder でプラットフォーム別最適化 |
| Figma API仕様変更 | エンドポイント廃止 | DesignProviderに隔離 |
| プロジェクトデータ破損 | 永続化ファイル破損 | JSONバリデーション（Zod）、バックアップ |
| タブ間の状態リーク | Store分離不備 | projectIdスコープの厳密テスト |
| Crop Region JSON競合 | 同時書き込み | updated_atで最新判定 |
| Figma Token漏洩 | 不正アクセス | OS Keychain保存、平文禁止 |

---

## 12. ビジネスモデル

### 基本戦略: MCPは無料、アプリは有料（Freemium）

**競合価格対比:**
- Pixelay Pro: $20/月（年払い$16/月）— 7比較モード、デスクトップ比較はPro限定
- Applitools: エンタープライズ向け高額
- FigDiff MCP: **無料**（8比較モード + AI自動修正ループ）
- FigDiff デスクトップ: **買い切り $29**（Pixelay 2ヶ月分以下）

```
┌─────────────────────────────────────┐
│          無料（OSS / npm公開）         │
│                                      │
│  MCPサーバー（8 tools）               │
│  - Cursor / Claude Code / Copilot    │
│  - Diff駆動ワークフロー              │
│  - compare → inspect → fix サイクル  │
│  - Crop Region管理                   │
│                                      │
│  → 認知拡大 & コミュニティ形成        │
└──────────────┬──────────────────────┘
               │ 「GUIで楽にやりたい」
               ↓
┌─────────────────────────────────────┐
│          有料（デスクトップアプリ）     │
│                                      │
│  Free（0円）                         │
│  - 1プロジェクト                     │
│  - 基本比較 + 差分画像               │
│                                      │
│  Pro（買い切り $29 / ¥4,500）        │
│  - 無制限プロジェクト                │
│  - Crop Region GUI                  │
│  - NodeInspector（Dev Mode風）       │
│  - 数値差分テーブル                  │
│  - レポート出力                      │
│  - 比較履歴                          │
│  - 将来のアップデート無料             │
│                                      │
│  Team（将来）                         │
│  - URL共有 / Slack/GitHub連携        │
└─────────────────────────────────────┘
```

### 収益シミュレーション

| MCP利用者数 | アプリ購入率 | 単価 | 売上（累計） |
|------------|------------|------|-------------|
| 1,000人 | 3% = 30人 | ¥4,500 | ¥135,000 |
| 5,000人 | 3% = 150人 | ¥4,500 | ¥675,000 |
| 10,000人 | 3% = 300人 | ¥4,500 | ¥1,350,000 |

サーバーコストゼロ（BYOKモデル）。

---

## 13. ポートフォリオとしての見せ方

### READMEに書くストーリー

> REDACTEDのフロントエンドエンジニアとして、Figmaデザインの実装確認で
> 余白やピクセル単位の差異を見落とすことが課題でした。
> 既存のFigma MCPでは、AIがスペックを読んで独自解釈する「言うこと聞かない問題」も発生していました。
>
> FigDiffは「Diff駆動」でこれを解決します。
> AIはまずpixelmatchで機械的な差分を確認し、ズレがある箇所だけをFigmaの
> Dev Mode的なデータで深掘りし、コードを修正、再比較、一致率100%まで自動ループ。
> 「注意力」ではなく「仕組み」でデザイン再現度を担保するツールです。

### アピールポイント
- 自分の課題を技術で解決した実例
- **Diff駆動のAI行動設計** — ツールのdescriptionでAIの行動を制御する設計思想
- Electron + React + TypeScript のモダンスタック
- Figma API / MCP / Design Provider パターン
- APIキー不要の設計（既存AIツールとの連携）
- REDACTEDフレンドリーなUX設計
- monorepo構成（Turborepo + pnpm workspace）
- デスクトップアプリ + MCPサーバーの二面展開
- 買い切りFreemiumモデル
- セキュリティ（OS Keychain、平文保存禁止）