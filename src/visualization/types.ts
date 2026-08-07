import type {
  Confidence,
  GraphSnapshot,
  ParaCategory,
  QueryJourney,
  SnapshotDiff
} from "../model";

export type LensFamily = "structure" | "recall" | "evolution" | "para" | "efficiency";
export type ScenePrimitive = "graph" | "radial" | "flow" | "timeline" | "matrix" | "scatter";
export type SceneStatus = "ready" | "partial" | "unavailable";

export type DataCapability =
  | "vault-notes"
  | "vault-links"
  | "para"
  | "indexes"
  | "file-stats"
  | "file-times"
  | "snapshots"
  | "snapshot-history"
  | "query-aggregate"
  | "query-paths"
  | "query-steps"
  | "query-timing"
  | "query-tokens"
  | "tool-usage"
  | "tool-timing";

export interface ObservatoryDataset {
  current: GraphSnapshot;
  snapshots: GraphSnapshot[];
  diffs: SnapshotDiff[];
  journeys: QueryJourney[];
  capabilities: ReadonlySet<DataCapability>;
  generatedAt: string;
}

export interface ViewState {
  from: string | null;
  to: string | null;
  paraScope: ParaCategory[];
  selectedQueryId: string | null;
  selectedMarkId: string | null;
  selectedMetric: string | null;
  beforeSnapshotId: string | null;
  afterSnapshotId: string | null;
  indexDepth: number;
  playbackProgress: number;
  reducedMotion: boolean;
}

export interface MetricDatum {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  confidence: Confidence;
  source: string;
  sampleSize?: number;
}

export interface LegendItem {
  id: string;
  label: string;
  colorKey: string;
  stroke?: "solid" | "dashed" | "dotted";
  shape?: "circle" | "ring" | "diamond" | "rect" | "line";
}

export interface EvidenceRef {
  id: string;
  label: string;
  kind: "note" | "query" | "snapshot" | "metric" | "source";
  path?: string;
  queryId?: string;
  detail?: string;
  confidence: Confidence;
}

export interface InspectorModel {
  heading: string;
  summary: string;
  metrics: MetricDatum[];
  evidence: EvidenceRef[];
  actions: Array<"open-note" | "open-source" | "compare" | "replay" | "capture-snapshot">;
}

export interface MotionKeyframe {
  at: number;
  markIds: string[];
  effect: "pulse" | "trace" | "bloom" | "fade" | "morph" | "crossfade" | "drift";
}

export interface MotionContract {
  trigger: "none" | "replay" | "compare" | "filter" | "selection";
  durationMs: number;
  stepDurationMs?: number;
  userTriggered: true;
  keyframes: MotionKeyframe[];
}

export interface SceneBase {
  id: string;
  lensId: string;
  primitive: ScenePrimitive;
  status: SceneStatus;
  title: string;
  question: string;
  summary: string;
  confidence: Confidence;
  missingCapabilities: DataCapability[];
  metrics: MetricDatum[];
  legend: LegendItem[];
  inspector: InspectorModel;
  motion: MotionContract;
}

export interface GraphNode {
  id: string;
  label: string;
  group: string;
  role: "index" | "note" | "query" | "tool" | "region" | "placeholder";
  value: number;
  confidence: Confidence;
  /** Stable normalized stage coordinate in the inclusive 0..1 range. */
  x?: number;
  /** Stable normalized stage coordinate in the inclusive 0..1 range. */
  y?: number;
  colorKey?: string;
  path?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  value: number;
  confidence: Confidence;
  state?: "normal" | "added" | "removed" | "focus";
  directed?: boolean;
  order?: number;
  colorKey?: string;
}

export interface GraphScene extends SceneBase {
  primitive: "graph";
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RadialSegment {
  id: string;
  label: string;
  group: string;
  value: number;
  secondaryValue?: number;
  confidence: Confidence;
  colorKey?: string;
  path?: string;
}

export interface RadialScene extends SceneBase {
  primitive: "radial";
  segments: RadialSegment[];
  satellites: GraphNode[];
  rings: Array<{ id: string; label: string; value: number; confidence: Confidence }>;
}

export interface FlowStage {
  id: string;
  label: string;
  order: number;
  value: number;
  confidence: Confidence;
  colorKey?: string;
}

export interface FlowConnection {
  id: string;
  source: string;
  target: string;
  value: number;
  confidence: Confidence;
  order?: number;
  colorKey?: string;
  evidenceIds?: string[];
}

export interface FlowScene extends SceneBase {
  primitive: "flow";
  stages: FlowStage[];
  connections: FlowConnection[];
}

export interface TimelinePoint {
  id: string;
  time: string;
  value: number;
  confidence: Confidence;
  label?: string;
  colorKey?: string;
  evidenceId?: string;
}

export interface TimelineSeries {
  id: string;
  label: string;
  colorKey: string;
  points: TimelinePoint[];
}

export interface TimelineScene extends SceneBase {
  primitive: "timeline";
  series: TimelineSeries[];
  bands: Array<{ id: string; label: string; from: string; to: string; value: number; colorKey: string }>;
}

export interface MatrixCell {
  id: string;
  row: string;
  column: string;
  value: number | null;
  confidence: Confidence;
  colorKey?: string;
  evidenceId?: string;
}

export interface MatrixScene extends SceneBase {
  primitive: "matrix";
  rows: Array<{ id: string; label: string }>;
  columns: Array<{ id: string; label: string }>;
  cells: MatrixCell[];
}

export interface ScatterPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  group: string;
  confidence: Confidence;
  colorKey?: string;
  evidenceId?: string;
}

export interface ScatterScene extends SceneBase {
  primitive: "scatter";
  xLabel: string;
  yLabel: string;
  points: ScatterPoint[];
  frontier: Array<{ x: number; y: number }>;
}

export type VisualScene = GraphScene | RadialScene | FlowScene | TimelineScene | MatrixScene | ScatterScene;

export interface LensDefinition {
  id: string;
  title: string;
  family: LensFamily;
  question: string;
  primitive: ScenePrimitive;
  requires: DataCapability[];
  motion: MotionContract;
  inspector: {
    description: string;
    primaryAction: InspectorModel["actions"][number];
  };
  buildModel(dataset: ObservatoryDataset, state: ViewState): VisualScene;
}

export const DEFAULT_VIEW_STATE: ViewState = {
  from: null,
  to: null,
  paraScope: [],
  selectedQueryId: null,
  selectedMarkId: null,
  selectedMetric: null,
  beforeSnapshotId: null,
  afterSnapshotId: null,
  indexDepth: 2,
  playbackProgress: 0,
  reducedMotion: false
};
