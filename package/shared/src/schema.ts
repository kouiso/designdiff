// =============================================================================
// FigDiff Zod Schemas
// Runtime validation schemas for all shared types
// =============================================================================

import { z } from "zod";

// --- Frame Schema ---

export const FrameSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

// --- Design Token Schema ---

export const DesignTokenSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  property: z.string(),
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
});

// --- Node Inspection Schemas ---

export const NodeLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  layoutMode: z.enum(["HORIZONTAL", "VERTICAL", "NONE"]).optional(),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
  itemSpacing: z.number().optional(),
  primaryAxisAlign: z.string().optional(),
  counterAxisAlign: z.string().optional(),
});

export const NodeFillSchema = z.object({
  type: z.enum([
    "SOLID",
    "GRADIENT_LINEAR",
    "GRADIENT_RADIAL",
    "GRADIENT_ANGULAR",
    "GRADIENT_DIAMOND",
    "IMAGE",
  ]),
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  gradientStops: z
    .array(
      z.object({
        position: z.number(),
        color: z.string(),
      }),
    )
    .optional(),
});

export const NodeStrokeSchema = z.object({
  color: z.string(),
  weight: z.number().nonnegative(),
  align: z.enum(["INSIDE", "OUTSIDE", "CENTER"]),
});

export const BorderRadiusSchema = z.object({
  topLeft: z.number().nonnegative(),
  topRight: z.number().nonnegative(),
  bottomRight: z.number().nonnegative(),
  bottomLeft: z.number().nonnegative(),
});

export const NodeEffectSchema = z.object({
  type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]),
  color: z.string().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  radius: z.number().nonnegative(),
  spread: z.number().optional(),
});

export const NodeAppearanceSchema = z.object({
  fills: z.array(NodeFillSchema),
  strokes: z.array(NodeStrokeSchema),
  borderRadius: BorderRadiusSchema.optional(),
  opacity: z.number().min(0).max(1),
  blendMode: z.string(),
  effects: z.array(NodeEffectSchema),
});

export const NodeTypographySchema = z.object({
  fontFamily: z.string(),
  fontWeight: z.number(),
  fontSize: z.number().positive(),
  lineHeight: z.union([z.number().positive(), z.literal("AUTO")]),
  letterSpacing: z.number(),
  textAlign: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]),
  textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]),
  textContent: z.string(),
});

export const ChildNodeSummarySchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  visible: z.boolean().optional(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const NodeInspectionSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  visible: z.boolean().optional(),
  layout: NodeLayoutSchema,
  appearance: NodeAppearanceSchema,
  typography: NodeTypographySchema.optional(),
  cssSuggestion: z.string(),
  childrenSummary: z.array(ChildNodeSummarySchema),
});

// --- Parsed Design Input Schema ---

export const ParsedDesignInputSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("figma_url"),
    fileKey: z.string().min(1),
    nodeId: z.string().optional(),
    version: z.string().optional(),
  }),
  z.object({
    type: z.literal("local_path"),
    filePath: z.string().min(1),
  }),
]);

// --- Compare Design Result Schema ---

export const DiffRegionSchema = z.object({
  id: z.number().int().nonnegative(),
  bounds: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  diffPixelCount: z.number().int().nonnegative(),
  nearbyNodeIds: z.array(z.string()),
  nearbyNodeNames: z.array(z.string()),
});

export const ClusterTelemetrySchema = z.object({
  requestedMode: z.enum(["auto", "grid", "flood"]),
  usedMode: z.enum(["grid", "flood"]),
  fallbackUsed: z.boolean(),
  fallbackReason: z
    .enum([
      "grid-empty-with-diff",
      "wall-budget-exceeded",
      "region-count-exceeded",
      "hot-cell-ratio-exceeded",
    ])
    .optional(),
  wallMs: z.number().nonnegative(),
  budgetMs: z.number().nonnegative().optional(),
  regionCount: z.number().int().nonnegative(),
});

// 差分が画面全体に広がると、領域分割は成立せず一定サイズのタイルしか作れない。
// そのタイルを差分領域として返すと「直す場所がタイルの数だけある」と読めてしまう。
// 分割できなかったという事実そのものを、別の形で返すための入れ物。
export const ClusterCollapseSchema = z.object({
  collapsed: z.literal(true),
  reason: z.enum([
    "grid-empty-with-diff",
    "wall-budget-exceeded",
    "region-count-exceeded",
    "hot-cell-ratio-exceeded",
  ]),
  // 分割を諦めた時点で作られていたタイルの数。位置の手がかりにはならない。
  coarseTileCount: z.number().int().nonnegative(),
  message: z.string(),
  // 空で返すと「分割できなかったが、確認することも無い」という読み方ができてしまう。
  checks: z.array(z.string()).min(1),
});

export const GridSummaryCellSchema = z.object({
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  diffPixels: z.number().int().nonnegative(),
  totalPixels: z.number().int().nonnegative(),
  matchRate: z.number().min(0).max(100),
});

export const GridSummarySchema = z.object({
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  cells: z.array(GridSummaryCellSchema),
});

// --- Completion Criteria Schema (v4: AI-driven PASS/FAIL structure) ---

export const CompletionCriterionSchema = z.object({
  required: z.number(),
  current: z.number(),
  // UNCERTAIN は「判定の確からしさが足りず人間レビューへ回した」状態。
  // FAIL と同じにすると、直しようのないものを直し続けろという指示になる。
  status: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  blocking: z.boolean().optional(),
  note: z.string().optional(),
});

export const CompletionCriteriaSchema = z.object({
  structuralReview: CompletionCriterionSchema,
  // 判定器が pass と言っているのに画素の大半が違う状態を検出する行。
  consistencyReview: CompletionCriterionSchema.optional(),
  // 色と文字を値そのもので突き合わせた行。使えなかったときは UNCERTAIN で残し、
  // 「見ていない」ことが読み手に伝わるようにする。
  tokenReview: CompletionCriterionSchema.optional(),
  matchRate: CompletionCriterionSchema,
  diffPixelCount: CompletionCriterionSchema,
  remainingIssues: CompletionCriterionSchema,
});

// --- FigDiff v2 Diff Report Schema (P1) ---

export const DiffBoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});

export const DiffIssueKindSchema = z.enum([
  "color",
  "position",
  "size",
  "missing",
  "extra",
  "typography",
]);

export const DiffSeveritySchema = z.enum(["critical", "major", "minor"]);

export const DiffEvidenceSchema = z.object({
  signal: z.string(),
  value: z.number(),
  threshold: z.number(),
  expected: z.unknown(),
  actual: z.unknown(),
  figmaFileKey: z.string().optional(),
  figmaNodeId: z.string().optional(),
  figmaPageName: z.string().optional(),
});

export const DiffIssueSchema = z.object({
  regionId: z.string(),
  bbox: DiffBoundingBoxSchema,
  kind: DiffIssueKindSchema,
  severity: DiffSeveritySchema,
  evidence: DiffEvidenceSchema,
  figmaNodeId: z.string().optional(),
  suggestedCssFix: z.string().optional(),
});

export const RegionScoreSchema = z.object({
  regionId: z.string(),
  bbox: DiffBoundingBoxSchema,
  figmaNodeId: z.string().optional(),
  // "root" は比較対象そのものを指す行。子の行と一緒に集計すると同じ画素を
  // 二重に数えるため、重み付けと見出しの集計からは外す。局所比較で
  // 「対象ノードが見つからない」を出さないために、行としては必ず持たせる。
  scope: z.enum(["section", "root"]).optional(),
  // まとめた際に下へ隠れた兄弟のID。直し先を辿れなくしないために残す。
  overlappingNodeIds: z.array(z.string()).optional(),
  structure: z.number().min(0).max(1),
  color: z.number().nonnegative(),
  shape: z.number().nonnegative(),
  layout: z.number().nonnegative(),
  textureScore: z.number().min(0).max(1).optional(),
  // 落とすと「なぜ critical になったか」が結果から辿れなくなる。
  flatColorMismatch: z
    .object({
      designHex: z.string(),
      screenshotHex: z.string(),
      maxChannelDelta: z.number().nonnegative(),
    })
    .optional(),
  glyphEdgeRasterization: z
    .object({
      classification: z.literal("glyph-edge-rasterization"),
      changedPixelCount: z.number().int().positive(),
      sharedCorePixelCount: z.number().int().positive(),
      backgroundHex: z.string(),
      foregroundHex: z.string(),
    })
    .optional(),
});

export const WeightedAggregateSchema = z.object({
  weightedStructure: z.number().min(0).max(1),
  weightedColor: z.number().nonnegative(),
  totalWeight: z.number().nonnegative(),
});

export const AlignmentSchema = z.object({
  translation: z.object({
    x: z.number(),
    y: z.number(),
  }),
  scale: z.object({
    x: z.number(),
    y: z.number(),
  }),
  rotation: z.number(),
  confidence: z.number().min(0).max(1),
  residual: z.number().nonnegative(),
});

export const DiffVerdictSchema = z.enum(["pass", "fail", "inconclusive"]);

export const DiffReportSchema = z.object({
  alignment: AlignmentSchema,
  regionScores: z.array(RegionScoreSchema),
  issues: z.array(DiffIssueSchema),
  weightedAggregate: WeightedAggregateSchema.optional(),
  aggregateVerdict: DiffVerdictSchema,
  rationale: z.string(),
  // 知覚できる差 (ΔE2000 > 2) を持つ画素の割合。pixelmatch の threshold にも
  // profile にも依存しない、判定と独立した証拠として持つ。
  perceptibleDiffRatio: z.number().min(0).max(1).optional(),
});

export const CritiqueConcernSchema = z.enum([
  "regression",
  "oscillation",
  "plateau",
  "healthy",
  "capture-changed",
]);

export const CritiqueNoteSchema = z.object({
  concern: CritiqueConcernSchema,
  worstDeltaSection: z.string().optional(),
  advice: z.string(),
});

// --- Comparison Confidence Layer (Pre-flight / Normalization / Diagnosis / Headline) ---
// 「near-100% のミスマッチはほぼ常に実装差分ではなく設定ミス」という観察に基づき、
// ツール自身が誤設定を検知・説明するためのメタ情報。計測ロジックには手を入れず、
// 既存シグナル (regionScores / 正規化結果) を集約して提示する。

export const PreflightWarningCodeSchema = z.enum([
  "width_mismatch",
  "aspect_ratio_mismatch",
  "crop_out_of_bounds",
  "crop_stale",
  "blank_frame",
  // ノードが未指定のとき前回使用したノードを自動補完したことを通知する。
  "last_used_node",
  "logical_physical_width",
  // 指定ノードが今の Figma に無く、キャッシュ画像で比較していることを通知する。
  "design_node_missing",
]);

export const PreflightSeveritySchema = z.enum(["info", "warning", "critical"]);

export const PreflightWarningSchema = z.object({
  code: PreflightWarningCodeSchema,
  severity: PreflightSeveritySchema,
  message: z.string(),
  suggestedFix: z.string().optional(),
});

export const PreflightReportSchema = z.object({
  warnings: z.array(PreflightWarningSchema),
});

export const NormalizationReportSchema = z.object({
  designNativeWidth: z.number().int().nonnegative(),
  designNativeHeight: z.number().int().nonnegative(),
  screenshotWidth: z.number().int().nonnegative(),
  screenshotHeight: z.number().int().nonnegative(),
  cropApplied: z.boolean(),
  containResized: z.boolean(),
  // contain 正規化で適用された最終スケール。1 から大きく外れると寸法ミスマッチのサイン。
  appliedScale: z.number().nonnegative(),
  // project の cropRegion 設定なしに、スクショがdesignフレーム高を超えた分を
  // ツールが自動でフレーム範囲へcropしたか。人間がcropRegionを手設定する
  // 手間を無くすための自動化 (#237系: 真の完成に向けた手動介入の自動化)。
  autoCropped: z.boolean().optional(),
});

// スクロール結合で撮ったときの内訳。1画面に収まらない画面を比較したとき、
// 「何枚繋いだか」「下端まで届いたか」を出さないと、途中までの画像を
// 完全な1枚として扱ってしまう。
export const ScrollCaptureReportSchema = z.object({
  captureCount: z.number().int().positive(),
  stitchedWidth: z.number().int().positive(),
  stitchedHeight: z.number().int().positive(),
  /** 繋ぐ前の1画面の寸法。向きの判定はこちらを使う。繋いだ後は必ず縦長になる。 */
  viewportWidth: z.number().int().positive(),
  viewportHeight: z.number().int().positive(),
  /** 全フレームで固定だった帯。繋いだ画像には1回だけ入っている。 */
  fixedHeaderHeight: z.number().int().nonnegative(),
  fixedFooterHeight: z.number().int().nonnegative(),
  reachedBottom: z.boolean(),
  /** 撮影上限で打ち切ったか。true のとき繋いだ画像はコンテンツの途中まで。 */
  truncatedAtCaptureLimit: z.boolean(),
  /** 1回送っても画面が変わらんかったか。1画面ぶんしか撮れとらんことを意味する。 */
  didNotScroll: z.boolean(),
  /** 撮り始める前に上端まで戻せたか。false のとき画像は画面の途中から始まる。 */
  startedAtTop: z.boolean(),
  /** 固定帯の判定を捨てた、近似で繋いだ等、結果を疑う理由になる注記。 */
  notes: z.array(z.string()),
});

export const ComparisonHeadlineSchema = z.object({
  structureMatch: z.number().min(0).max(100),
  colorOnlyRegions: z.number().int().nonnegative(),
  structuralRegions: z.number().int().nonnegative(),
  headline: z.string(),
});

export const DiagnosisVerdictSchema = z.enum(["clean", "real_diff", "likely_misconfig"]);

export const DiagnosisCauseCodeSchema = z.enum([
  "width_mismatch",
  "crop_compression",
  "aspect_mismatch",
  "global_color_shift",
  "blank_or_wrong_node",
]);

export const DiagnosisCauseSchema = z.object({
  code: DiagnosisCauseCodeSchema,
  confidence: z.number().min(0).max(1),
  message: z.string(),
  suggestedFix: z.string(),
  classification: z
    .enum(["full_page_vs_viewport", "wrong_frame_or_misconfig", "mild_aspect_mismatch"])
    .optional(),
});

export const ComparisonDiagnosisSchema = z.object({
  verdict: DiagnosisVerdictSchema,
  likelyMisconfig: z.boolean(),
  rankedCauses: z.array(DiagnosisCauseSchema),
  headline: z.string(),
});

export const LoopGuardReasonSchema = z.enum([
  "no-regression",
  "regression",
  "max-steps",
  "uncertain",
  "continue",
]);

// 自走ループの停止判定。compare_design が呼び出し履歴から反復回数と
// 収束状況を評価して続行/停止を返す。
// AI は `stop` だけを判定材料にし、`matchRate` や status を勝手に再解釈しない。
export const LoopGuardReportSchema = z.object({
  stop: z.boolean(),
  step: z.number().int().positive(),
  maxSteps: z.number().int().positive(),
  remainingSteps: z.number().int().nonnegative(),
  reason: LoopGuardReasonSchema,
  message: z.string(),
  // 既存クライアントとの互換 (非推奨)
  iteration: z.number().int().positive().optional(),
  decision: z.enum(["continue", "stop"]).optional(),
});

export const ToastBandCandidateSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  contrast: z.number().nonnegative(),
  position: z.enum(["top", "bottom"]),
});

// --- Token Diff Schemas ---
// 色・文字は画素を数えるより、実装が実際に使っている値そのものを比べるほうが正確。
// 画素経路はアンチエイリアス (文字の縁のぼかし) の影響を必ず受けるので、
// 「#FCFCFC と #FFFFFF のどちらが正しいか」のような差を安定して言い当てられない。

/** 実装側 DOM の1要素から採取した見た目の値。座標はページ左上を原点とする。 */
export const DomElementStyleSchema = z.object({
  tag: z.string(),
  text: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  fontFamily: z.string().optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
});

export const TokenMismatchSchema = z.object({
  property: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  designValue: z.string(),
  implValue: z.string(),
  severity: DiffSeveritySchema,
  /** 実装側の該当矩形 (スクリーンショット座標)。人が場所を特定するために出す。 */
  region: DiffBoundingBoxSchema.optional(),
});

export const TokenDiffReportSchema = z.object({
  /** 突合を試みた Figma ノード数。 */
  comparedNodeCount: z.number().int().nonnegative(),
  matchedNodeCount: z.number().int().nonnegative(),
  unmatchedNodeCount: z.number().int().nonnegative(),
  /** 対応付けできなかった割合。高いほどこの経路の判定は当てにならない。 */
  unmatchedRatio: z.number().min(0).max(1),
  checkedPropertyCount: z.number().int().nonnegative(),
  mismatches: z.array(TokenMismatchSchema),
  /** unmatchedRatio が閾値以下で、合否の根拠として使える状態か。 */
  reliable: z.boolean(),
  /** 使えない場合に、なぜ画素経路へ落としたかを人の言葉で残す。 */
  demotionReason: z.string().optional(),
});

// --- Measure Diff (寸法・余白を数値で突き合わせる経路) ---

/**
 * DOM の実測1件。文字も背景も持たない「間隔だけを担う箱」も落とさずに拾う。
 *
 * 色と文字だけを見る DomElementStyle は、採取の時点で透明なコンテナを捨てる。
 * 捨てた箱の gap や padding は、あとから突合をどう工夫しても復元できない。
 */
export const DomLayoutBoxSchema = z.object({
  /** 走査順の通し番号。親子を辿るための鍵。 */
  ref: z.number().int().nonnegative(),
  parentRef: z.number().int().nonnegative().optional(),
  depth: z.number().int().nonnegative(),
  tag: z.string(),
  text: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  paddingTop: z.number(),
  paddingRight: z.number(),
  paddingBottom: z.number(),
  paddingLeft: z.number(),
  /**
   * 外側の余白。Figma には margin の概念が無いので直接は比べられないが、
   * 積み上げの検算では実装側の勘定に必ず入る。落とすと残差の説明がつかない。
   */
  marginTop: z.number(),
  marginRight: z.number(),
  marginBottom: z.number(),
  marginLeft: z.number(),
  rowGap: z.number().optional(),
  columnGap: z.number().optional(),
  borderRadius: z.number().optional(),
  display: z.string().optional(),
  flexDirection: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  lineHeight: z.number().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  /** 外側へ落ちる影。実体のある影だけがここに入る。 */
  outerShadow: z.string().optional(),
  /**
   * 縁として描かれた内側の box-shadow。ユーティリティCSSの ring 指定がこれになる。
   * 影の比較からは外すが、外した事実を残さないと誤検知の説明ができない。
   */
  ringShadow: z.string().optional(),
});

/** 寸法・余白の食い違い1件。デザイン側の値と実装側の値を px で並べる。 */
export const MeasureMismatchSchema = z.object({
  property: z.string(),
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  /** デザイン側の値 (px)。スクリーンショット倍率を掛けた後の値。 */
  designPx: z.number(),
  implPx: z.number(),
  /** implPx - designPx。並べ替えて大きいものから直せるように符号付きで持つ。 */
  deltaPx: z.number(),
  severity: DiffSeveritySchema,
  /** 実装側の該当要素。人がコードの行を探すための手掛かり。 */
  implRef: z.number().int().nonnegative(),
  implTag: z.string(),
  implRect: DiffBoundingBoxSchema,
});

/**
 * 対応付けできなかったデザインノード。件数ではなく1件ずつ名前で出す。
 * 数だけを出すと、中身を隠したまま「全部見た」と言えてしまう。
 */
export const UnmatchedDesignNodeSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  nodeType: z.string(),
  rect: DiffBoundingBoxSchema,
  reason: z.string(),
  /**
   * unmatched = 対応する実装側の要素を見つけられなかった (道具の負け、または実装漏れ)。
   * not-compared = 構造として実装側に相手が存在しない (アイコン部品の中身など)。
   * 混ぜると、未照合率がアイコンの内部で水増しされて信頼度の判定が壊れる。
   */
  category: z.enum(["unmatched", "not-compared"]),
});

/**
 * 積み上げの検算。
 * 親の寸法 = 開始余白 + 子の寸法の和 + 間隔×(個数-1) + 終了余白 が
 * デザイン側・実装側の両方で成り立つかを見る。片側だけ残差が出る親は、
 * 勘定に入っていない要素をその中に持っている。
 */
export const StackCheckSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  axis: z.enum(["horizontal", "vertical"]),
  designChildCount: z.number().int().nonnegative(),
  implChildCount: z.number().int().nonnegative(),
  designResidualPx: z.number(),
  implResidualPx: z.number(),
  verified: z.boolean(),
  note: z.string().optional(),
});

export const MeasureDiffReportSchema = z.object({
  designNodeCount: z.number().int().nonnegative(),
  matchedNodeCount: z.number().int().nonnegative(),
  unmatchedNodeCount: z.number().int().nonnegative(),
  /** 構造として実装側に相手が無いノード数。未照合率の分母から外す。 */
  notComparedNodeCount: z.number().int().nonnegative(),
  unmatchedRatio: z.number().min(0).max(1),
  checkedPropertyCount: z.number().int().nonnegative(),
  /** スクリーンショット幅 ÷ デザインフレーム幅。1 から離れると文字の比較は行わない。 */
  scale: z.number().positive(),
  mismatches: z.array(MeasureMismatchSchema),
  unmatchedDesignNodes: z.array(UnmatchedDesignNodeSchema),
  stackChecks: z.array(StackCheckSchema),
  reliable: z.boolean(),
  demotionReason: z.string().optional(),
  /** 比較を行わなかった項目とその理由。黙って落とさないために残す。 */
  skipped: z.array(z.string()),
});

/** どの経路が最終的な合否を決めたか。無言で劣化させないために必ず載せる。 */
export const VerdictRouteSchema = z.enum(["token-diff", "pixel"]);

export const CompareDesignResultSchema = z
  .object({
    // UNCERTAIN: 判定の確からしさを損なう条件 (設定ミス疑い / 構造判定 inconclusive)
    // が検出された状態。PASS でも FAIL でもなく「人間のレビューが必要」を意味する。
    status: z.enum(["PASS", "FAIL", "UNCERTAIN"]).optional(),
    comparisonId: z.string(),
    matchRate: z.number().min(0).max(100),
    diffPixelCount: z.number().int().nonnegative(),
    // ignoreRegions が画像全体を覆うケースでは 0 が正当。
    totalPixelCount: z.number().int().nonnegative(),
    remainingIssues: z.number().int().nonnegative().optional(),
    diffRegions: z.array(DiffRegionSchema),
    totalRegionCount: z.number().int().nonnegative().optional(),
    returnedRegionCount: z.number().int().nonnegative().optional(),
    regionsTruncated: z.boolean().optional(),
    regionsDetailPath: z.string().optional(),
    completionCriteria: CompletionCriteriaSchema.optional(),
    nextAction: z.string().optional(),
    suggestion: z.string(),
    clusterTelemetry: ClusterTelemetrySchema.optional(),
    clusterCollapse: ClusterCollapseSchema.optional(),
    gridSummary: GridSummarySchema.optional(),
    diffReport: DiffReportSchema.optional(),
    critique: CritiqueNoteSchema.optional(),
    preflight: PreflightReportSchema.optional(),
    normalization: NormalizationReportSchema.optional(),
    // capture_scroll でスクロール結合したときだけ入る。
    scrollCapture: ScrollCaptureReportSchema.optional(),
    diagnosis: ComparisonDiagnosisSchema.optional(),
    comparisonHeadline: ComparisonHeadlineSchema.optional(),
    loopGuard: LoopGuardReportSchema.optional(),
    // 実機スクショに写り込む帯 (開発時のトースト等) のマスク候補。
    // 自動では適用しない。画素だけではトーストと正しい暗色帯を区別できないため。
    toastBandCandidates: z.array(ToastBandCandidateSchema).optional(),
    tokenDiff: TokenDiffReportSchema.optional(),
    /** 合否を決めた経路。token-diff が働いたときだけ "token-diff"。 */
    verdictRoute: VerdictRouteSchema.optional(),
    diffImagePath: z.string().optional(),
    diffImageBase64: z.string().optional(),
  })
  .superRefine((result, ctx) => {
    // 分割できなかったと言いながら領域も返すと、受け取る側はどちらを信じてよいか
    // 分からなくなる。両立しない組み合わせは、作られた時点で弾く。
    if (result.clusterCollapse && result.diffRegions.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["diffRegions"],
        message: "clusterCollapse がある結果では diffRegions を空にしてください",
      });
    }
  });

// --- Crop Region Schema ---

export const CropRegionSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});

// --- Ignore Region Schema ---
// マスク用矩形。compare_design 実行時に、この矩形内のピクセルは
// 差分検出から除外し、分母 (totalPixelCount) からも引いて
// 「評価対象領域のみ」の matchRate を計算する。
// 用途: 既知の意図的差分 (WP 原文 vs Figma プレースホルダ、
// アンチエイリアス / フォントヒンティング差、Google Map 埋め込み等)
// を false-positive から除外する。
export const IgnoreRegionSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
  label: z.string().optional(),
});

export const IgnoreRegionConfigEntrySchema = IgnoreRegionSchema.extend({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  frame_name: z.string().optional(),
  note: z.string().optional(),
}).strict();

export const IgnoreRegionConfigFileSchema = z
  .object({
    version: z.literal(1),
    regions: z.array(IgnoreRegionConfigEntrySchema),
  })
  .strict();

// --- Design Source Schema (v4: Figma URL or local image per page) ---

export const DesignSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("figma"),
    id: z.string(),
    label: z.string(),
    figmaUrl: z.string(),
    fileKey: z.string(),
    nodeId: z.string().optional(),
    frameName: z.string().optional(),
  }),
  z.object({
    type: z.literal("local_image"),
    id: z.string(),
    label: z.string(),
    filePath: z.string(),
  }),
]);

// --- Project Page Schema (v4: one page = one URL path + N design sources) ---

export const ProjectPageSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  designSources: z.array(DesignSourceSchema),
});

// --- Project Schema (v4: implementation URL + pages) ---

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  implementationUrl: z.string(),
  pages: z.array(ProjectPageSchema),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

// --- Figma Token Schema ---

export const FigmaTokenSchema = z
  .string()
  .min(20)
  .regex(/^figd_/, "Figma token must start with 'figd_'");

export const ImageDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const FigmaOAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
});

export const FigmaAuthStateSchema = z.object({
  mode: z.enum(["oauth", "pat", "none"]),
  expiresAt: z.number().optional(),
});

/**
 * 時間で並んだフレーム列の比較結果。
 *
 * 1枚ごとの合否と、設計の時刻に対する実装の時刻のズレを分けて持つ。
 * ズレを測っていない場合に0を返すと、測った結果と見分けが付かんようになるので、
 * 測ったかどうかを別の項目で必ず示す。
 */
export const FrameComparisonSchema = z.object({
  atMs: z.number().int().nonnegative(),
  screenshotPath: z.string(),
  status: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  matchRate: z.number(),
  comparisonId: z.string(),
  diffImagePath: z.string().optional(),
});

export const FrameAlignmentSchema = z.object({
  designAtMs: z.number().int().nonnegative(),
  matchedAtMs: z.number().int().nullable(),
  driftMs: z.number().int().nullable(),
  mismatchRate: z.number().nullable(),
  reason: z.string().optional(),
});

export const TemporalVerdictSchema = z.object({
  status: z.enum(["PASS", "FAIL", "UNCERTAIN"]),
  rationale: z.string(),
  maxAbsDriftMs: z.number().nullable(),
  orderViolation: z.boolean(),
});

export const CompareAnimationResultSchema = z
  .object({
    frames: z.array(FrameComparisonSchema),
    alignments: z.array(FrameAlignmentSchema),
    temporal: TemporalVerdictSchema,
    driftMeasured: z.boolean(),
    driftUnmeasuredReason: z.string().optional(),
    evidencePaths: z.array(z.string()),
    frameTimeSource: z.enum(["seek", "wall-clock"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.driftMeasured && value.temporal.maxAbsDriftMs !== null) {
      ctx.addIssue({
        code: "custom",
        message: "時刻のズレを測っていないのに、ズレの値が入っています。",
        path: ["temporal", "maxAbsDriftMs"],
      });
    }
    if (!value.driftMeasured && value.driftUnmeasuredReason === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "時刻のズレを測っていない場合は、その理由が要ります。",
        path: ["driftUnmeasuredReason"],
      });
    }
  });
