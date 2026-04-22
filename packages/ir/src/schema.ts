import { z } from 'zod';

/**
 * IR schema version. Bump on breaking changes; add fields additively otherwise.
 */
export const IR_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** RGBA color with channels normalized to 0..1. */
export const ColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
  a: z.number().min(0).max(1).default(1),
});
export type Color = z.infer<typeof ColorSchema>;

/** Solid fill. Gradient and image paints arrive in later milestones. */
export const SolidPaintSchema = z.object({
  type: z.literal('SOLID'),
  color: ColorSchema,
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
});
export type SolidPaint = z.infer<typeof SolidPaintSchema>;

/** Image paint placeholder — referenced by CLI M2+, sourced from the image manifest. */
export const ImagePaintSchema = z.object({
  type: z.literal('IMAGE'),
  imageRef: z.string().min(1),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).default('FILL'),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
});
export type ImagePaint = z.infer<typeof ImagePaintSchema>;

/**
 * Figma gradient stops. Position is normalized to the gradient line
 * (0 = start, 1 = end). At least two stops are required for a valid
 * gradient paint.
 */
export const GradientStopSchema = z.object({
  position: z.number().min(0).max(1),
  color: ColorSchema,
});
export type GradientStop = z.infer<typeof GradientStopSchema>;

/**
 * 2×3 affine transform mapping the gradient's canonical unit line
 * (from (0,0) to (1,0), with (0,1) as the perpendicular) into paint-
 * local coordinates where (0,0) is the top-left of the paint and
 * (1,1) is the bottom-right.
 */
export const GradientTransformSchema = z.tuple([
  z.tuple([z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number()]),
]);
export type GradientTransform = z.infer<typeof GradientTransformSchema>;

const GradientPaintBase = {
  gradientTransform: GradientTransformSchema,
  gradientStops: z.array(GradientStopSchema).min(2),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
};

export const LinearGradientPaintSchema = z.object({
  type: z.literal('GRADIENT_LINEAR'),
  ...GradientPaintBase,
});
export type LinearGradientPaint = z.infer<typeof LinearGradientPaintSchema>;

export const RadialGradientPaintSchema = z.object({
  type: z.literal('GRADIENT_RADIAL'),
  ...GradientPaintBase,
});
export type RadialGradientPaint = z.infer<typeof RadialGradientPaintSchema>;

export const PaintSchema = z.discriminatedUnion('type', [
  SolidPaintSchema,
  ImagePaintSchema,
  LinearGradientPaintSchema,
  RadialGradientPaintSchema,
]);
export type Paint = z.infer<typeof PaintSchema>;

export const StrokeAlignSchema = z.enum(['INSIDE', 'OUTSIDE', 'CENTER']);

/** Stroke = a paint + weight + alignment. */
export const StrokeSchema = z.object({
  paint: PaintSchema,
  weight: z.number().min(0).default(1),
  align: StrokeAlignSchema.default('INSIDE'),
});
export type Stroke = z.infer<typeof StrokeSchema>;

export const ShadowEffectSchema = z.object({
  type: z.enum(['DROP_SHADOW', 'INNER_SHADOW']),
  color: ColorSchema,
  offset: z.object({ x: z.number(), y: z.number() }),
  radius: z.number().min(0),
  spread: z.number().default(0),
  visible: z.boolean().default(true),
});
export type ShadowEffect = z.infer<typeof ShadowEffectSchema>;

export const BlurEffectSchema = z.object({
  type: z.enum(['LAYER_BLUR', 'BACKGROUND_BLUR']),
  radius: z.number().min(0),
  visible: z.boolean().default(true),
});
export type BlurEffect = z.infer<typeof BlurEffectSchema>;

export const EffectSchema = z.union([ShadowEffectSchema, BlurEffectSchema]);
export type Effect = z.infer<typeof EffectSchema>;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export const LineHeightSchema = z.union([
  z.object({ unit: z.literal('PIXELS'), value: z.number().positive() }),
  z.object({ unit: z.literal('PERCENT'), value: z.number().positive() }),
  z.object({ unit: z.literal('AUTO') }),
]);
export type LineHeight = z.infer<typeof LineHeightSchema>;

export const LetterSpacingSchema = z.object({
  unit: z.enum(['PIXELS', 'PERCENT']),
  value: z.number(),
});
export type LetterSpacing = z.infer<typeof LetterSpacingSchema>;

/** Text style — what we translate into a Figma TextStyle or apply inline on a TextNode. */
export const TextStyleSchema = z.object({
  fontFamily: z.string().min(1),
  /** Figma font-style name: "Regular", "Bold", "Italic", "Medium", etc. */
  fontStyle: z.string().min(1).default('Regular'),
  fontSize: z.number().positive(),
  lineHeight: LineHeightSchema.default({ unit: 'AUTO' }),
  letterSpacing: LetterSpacingSchema.default({ unit: 'PIXELS', value: 0 }),
  textAlign: z.enum(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']).default('LEFT'),
  textDecoration: z.enum(['NONE', 'UNDERLINE', 'STRIKETHROUGH']).default('NONE'),
  textCase: z.enum(['ORIGINAL', 'UPPER', 'LOWER', 'TITLE']).default('ORIGINAL'),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

// ---------------------------------------------------------------------------
// Geometry + layout
// ---------------------------------------------------------------------------

/** Explicit absolute-positioned box. Parents without auto-layout use this on children. */
export const GeometrySchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
});
export type Geometry = z.infer<typeof GeometrySchema>;

export const LayoutModeSchema = z.enum(['NONE', 'HORIZONTAL', 'VERTICAL']);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const PrimaryAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']);
export const CounterAxisAlignSchema = z.enum(['MIN', 'CENTER', 'MAX', 'BASELINE']);

/** Frame-level auto-layout props. Maps directly onto Figma Plugin API fields of the same name. */
export const LayoutPropsSchema = z.object({
  layoutMode: LayoutModeSchema.default('NONE'),
  itemSpacing: z.number().default(0),
  counterAxisSpacing: z.number().default(0),
  paddingTop: z.number().default(0),
  paddingRight: z.number().default(0),
  paddingBottom: z.number().default(0),
  paddingLeft: z.number().default(0),
  primaryAxisAlignItems: PrimaryAxisAlignSchema.default('MIN'),
  counterAxisAlignItems: CounterAxisAlignSchema.default('MIN'),
  layoutWrap: z.enum(['NO_WRAP', 'WRAP']).default('NO_WRAP'),
  primaryAxisSizingMode: z.enum(['FIXED', 'AUTO']).default('FIXED'),
  counterAxisSizingMode: z.enum(['FIXED', 'AUTO']).default('FIXED'),
  clipsContent: z.boolean().default(false),
});
export type LayoutProps = z.infer<typeof LayoutPropsSchema>;

/** Per-child layout behavior inside an auto-layout parent. */
export const ChildLayoutSchema = z.object({
  layoutPositioning: z.enum(['AUTO', 'ABSOLUTE']).default('AUTO'),
  /** 0 = hug, 1 = fill along primary axis. */
  layoutGrow: z.number().min(0).default(0),
  layoutAlign: z.enum(['INHERIT', 'STRETCH']).default('INHERIT'),
});
export type ChildLayout = z.infer<typeof ChildLayoutSchema>;

// ---------------------------------------------------------------------------
// Nodes — discriminated union on `type`
// ---------------------------------------------------------------------------

/** Fields shared by every node. */
const BaseNodeShape = {
  /** Stable ID, referenced by instances and layout. */
  id: z.string().min(1),
  /** Display name shown in the Figma layers panel. */
  name: z.string().default(''),
  /** Absolute box. Required for nodes outside an auto-layout parent. */
  geometry: GeometrySchema.optional(),
  /** Behavior when this node is a child of an auto-layout frame. */
  childLayout: ChildLayoutSchema.optional(),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  /**
   * CSS `transform: rotate(Ndeg)` in degrees, CSS convention
   * (positive = clockwise). Applied in the plugin via `node.rotation`.
   * Only rotation is modeled today — `translate`, `scale`, and
   * `matrix` transforms are ignored.
   */
  rotation: z.number().optional(),
} as const;

// --- TS types (declared before schemas so z.lazy can close over them) -------

export interface FrameNode {
  type: 'FRAME';
  id: string;
  name: string;
  geometry?: Geometry;
  childLayout?: ChildLayout;
  opacity: number;
  visible: boolean;
  rotation?: number;
  layout?: LayoutProps;
  fills: Paint[];
  fillStyleId?: string;
  strokes: Stroke[];
  /**
   * Reference to a PaintStyle in `styles.paints` whose paints should be
   * applied as the stroke fill. Weight + align stay on `strokes[0]`
   * (Figma's PaintStyle API doesn't carry them).
   */
  strokeStyleId?: string;
  effects: Effect[];
  effectStyleId?: string;
  cornerRadius?: number;
  children: IRNode[];
}

export interface TextNode {
  type: 'TEXT';
  id: string;
  name: string;
  geometry?: Geometry;
  childLayout?: ChildLayout;
  opacity: number;
  visible: boolean;
  rotation?: number;
  characters: string;
  textStyle: TextStyle;
  textStyleId?: string;
  fills: Paint[];
  fillStyleId?: string;
}

export interface ImageNode {
  type: 'IMAGE';
  id: string;
  name: string;
  geometry?: Geometry;
  childLayout?: ChildLayout;
  opacity: number;
  visible: boolean;
  rotation?: number;
  imageRef: string;
  scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE';
  cornerRadius?: number;
  fills: Paint[];
}

export interface VectorNode {
  type: 'VECTOR';
  id: string;
  name: string;
  geometry?: Geometry;
  childLayout?: ChildLayout;
  opacity: number;
  visible: boolean;
  rotation?: number;
  /** SVG path 'd' attribute. */
  path: string;
  fills: Paint[];
  fillStyleId?: string;
  strokes: Stroke[];
  strokeStyleId?: string;
}

export interface InstanceNode {
  type: 'INSTANCE';
  id: string;
  name: string;
  geometry?: Geometry;
  childLayout?: ChildLayout;
  opacity: number;
  visible: boolean;
  rotation?: number;
  /** ID of the component definition in the registry. */
  componentId: string;
  /** Optional per-instance text overrides keyed by node id within the component tree. */
  overrides?: Record<string, { characters?: string }>;
}

export type IRNode = FrameNode | TextNode | ImageNode | VectorNode | InstanceNode;

// --- Schemas ---------------------------------------------------------------

export const IRNodeSchema: z.ZodType<IRNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    FrameNodeSchema,
    TextNodeSchema,
    ImageNodeSchema,
    VectorNodeSchema,
    InstanceNodeSchema,
  ]),
);

export const FrameNodeSchema = z.object({
  type: z.literal('FRAME'),
  ...BaseNodeShape,
  layout: LayoutPropsSchema.optional(),
  fills: z.array(PaintSchema).default([]),
  fillStyleId: z.string().optional(),
  strokes: z.array(StrokeSchema).default([]),
  strokeStyleId: z.string().optional(),
  effects: z.array(EffectSchema).default([]),
  effectStyleId: z.string().optional(),
  cornerRadius: z.number().min(0).optional(),
  children: z.array(IRNodeSchema).default([]),
});

export const TextNodeSchema = z.object({
  type: z.literal('TEXT'),
  ...BaseNodeShape,
  characters: z.string(),
  textStyle: TextStyleSchema,
  textStyleId: z.string().optional(),
  fills: z.array(PaintSchema).default([]),
  fillStyleId: z.string().optional(),
});

export const ImageNodeSchema = z.object({
  type: z.literal('IMAGE'),
  ...BaseNodeShape,
  imageRef: z.string().min(1),
  scaleMode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).default('FILL'),
  cornerRadius: z.number().min(0).optional(),
  fills: z.array(PaintSchema).default([]),
});

export const VectorNodeSchema = z.object({
  type: z.literal('VECTOR'),
  ...BaseNodeShape,
  path: z.string(),
  fills: z.array(PaintSchema).default([]),
  fillStyleId: z.string().optional(),
  strokes: z.array(StrokeSchema).default([]),
  strokeStyleId: z.string().optional(),
});

export const InstanceNodeSchema = z.object({
  type: z.literal('INSTANCE'),
  ...BaseNodeShape,
  componentId: z.string().min(1),
  overrides: z.record(z.object({ characters: z.string().optional() })).optional(),
});

// ---------------------------------------------------------------------------
// Registries + document root
// ---------------------------------------------------------------------------

/** Named paint style that nodes can reference via fillStyleId / strokeStyleId. */
export const PaintStyleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  paints: z.array(PaintSchema).min(1),
  description: z.string().optional(),
});
export type PaintStyleDef = z.infer<typeof PaintStyleSchema>;

/** Named text style that TextNodes can reference via textStyleId. */
export const TextStyleDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  style: TextStyleSchema,
  description: z.string().optional(),
});
export type TextStyleDef = z.infer<typeof TextStyleDefSchema>;

/**
 * Named effect style. Wraps a list of Effects — a single Figma EffectStyle
 * can stack multiple shadows / blurs, matching `box-shadow: a, b, c` in CSS.
 * Referenced by FRAME nodes via `effectStyleId`.
 */
export const EffectStyleDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  effects: z.array(EffectSchema).min(1),
  description: z.string().optional(),
});
export type EffectStyleDef = z.infer<typeof EffectStyleDefSchema>;

export const StylesRegistrySchema = z.object({
  paints: z.array(PaintStyleSchema).default([]),
  texts: z.array(TextStyleDefSchema).default([]),
  effects: z.array(EffectStyleDefSchema).default([]),
});
export type StylesRegistry = z.infer<typeof StylesRegistrySchema>;

/** A reusable subtree. Instances reference it by id. */
export interface ComponentDef {
  id: string;
  name: string;
  root: IRNode;
  description?: string;
}

export const ComponentDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  root: IRNodeSchema,
  description: z.string().optional(),
}) satisfies z.ZodType<ComponentDef, z.ZodTypeDef, unknown>;

/** Fonts we need loaded before building text nodes. */
export const FontManifestEntrySchema = z.object({
  family: z.string().min(1),
  style: z.string().min(1).default('Regular'),
});
export type FontManifestEntry = z.infer<typeof FontManifestEntrySchema>;

export const ImageManifestEntrySchema = z.object({
  ref: z.string().min(1),
  /** Inline base64 data URL, or path relative to the IR file. */
  source: z.string().min(1),
  mimeType: z.string().optional(),
});
export type ImageManifestEntry = z.infer<typeof ImageManifestEntrySchema>;

export const IRDocumentSchema = z.object({
  version: z.literal(IR_VERSION),
  name: z.string().default('Untitled'),
  root: IRNodeSchema,
  styles: StylesRegistrySchema.default({ paints: [], texts: [], effects: [] }),
  components: z.array(ComponentDefSchema).default([]),
  fonts: z.array(FontManifestEntrySchema).default([]),
  images: z.array(ImageManifestEntrySchema).default([]),
  metadata: z
    .object({
      source: z.string().optional(),
      generator: z.string().optional(),
      generatedAt: z.string().optional(),
    })
    .default({}),
});
export type IRDocument = z.infer<typeof IRDocumentSchema>;
