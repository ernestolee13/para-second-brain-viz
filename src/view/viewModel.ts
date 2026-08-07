import type { Confidence, ParaCategory } from "../model";
import type { PeriodPreset, ObservatoryPluginSettings } from "../plugin/contracts";
import type { HitRegion, SemanticNode } from "../render/canvas";
import type {
  EvidenceRef,
  InspectorModel,
  LensDefinition,
  LensFamily,
  MetricDatum,
  ObservatoryDataset,
  ViewState,
  VisualScene
} from "../visualization/types";
import { OBSERVATORY_LENSES } from "../visualization/registry";

export const FAMILY_LABELS: Record<LensFamily, string> = {
  structure: "Structure",
  recall: "Recall",
  evolution: "Evolution",
  para: "PARA",
  efficiency: "Efficiency"
};

export const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" }
];

export interface LensRailItem {
  id: string;
  title: string;
  family: LensFamily;
  question: string;
  primitive: string;
  favorite: boolean;
  recent: boolean;
  selected: boolean;
  unavailable: boolean;
  missingCapabilities: string[];
}

export interface LensRailGroup {
  family: LensFamily;
  label: string;
  items: LensRailItem[];
}

export interface ContextSummary {
  period: PeriodPreset;
  paraLabel: string;
  queryLabel: string;
  indexDepthLabel: string;
  confidenceLabel: string;
  sourceLabel: string;
}

export interface KpiItem {
  id: string;
  label: string;
  value: string;
  confidence: Confidence;
  source: string;
}

export interface AvailabilityItem {
  id: string;
  label: string;
  state: "ready" | "partial" | "missing";
}

export interface SemanticMarkItem {
  id: string;
  markId: string;
  label: string;
  confidence: Confidence;
  disabled: boolean;
  selected: boolean;
}

export interface MarkEvidence {
  id: string;
  label: string;
  confidence: Confidence;
  path: string | null;
  detail: string | null;
}

export interface PlaybackPolicyInput {
  trigger: VisualScene["motion"]["trigger"];
  reducedMotion: boolean;
  hidden: boolean;
  width: number;
  height: number;
  userRequested: boolean;
}

export function buildLensRail(
  lenses: LensDefinition[],
  selectedLensId: string,
  dataset: ObservatoryDataset | null,
  settings: Pick<ObservatoryPluginSettings, "favoriteLensIds" | "recentLensIds">,
  search = ""
): LensRailGroup[] {
  const query = search.trim().toLowerCase();
  const favorites = new Set(settings.favoriteLensIds);
  const recent = new Set(settings.recentLensIds);
  const groups = new Map<LensFamily, LensRailItem[]>();

  for (const lens of lenses) {
    if (
      query &&
      !`${lens.id} ${lens.title} ${lens.question} ${FAMILY_LABELS[lens.family]}`.toLowerCase().includes(query)
    ) {
      continue;
    }
    const missingCapabilities = dataset ? missingCapabilitiesFor(lens, dataset) : [];
    const item: LensRailItem = {
      id: lens.id,
      title: lens.title,
      family: lens.family,
      question: lens.question,
      primitive: lens.primitive,
      favorite: favorites.has(lens.id),
      recent: recent.has(lens.id),
      selected: lens.id === selectedLensId,
      unavailable: dataset !== null && missingCapabilities.length > 0,
      missingCapabilities
    };
    groups.set(lens.family, [...(groups.get(lens.family) ?? []), item]);
  }

  return (Object.keys(FAMILY_LABELS) as LensFamily[])
    .map((family) => ({
      family,
      label: FAMILY_LABELS[family],
      items: (groups.get(family) ?? []).sort(compareRailItems)
    }))
    .filter((group) => group.items.length > 0);
}

export function nextViewStateForPeriod(period: PeriodPreset, now: Date, current: ViewState): ViewState {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
  return {
    ...current,
    from: days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
    playbackProgress: 1
  };
}

export function nextParaScope(current: ViewState, para: ParaCategory | "all"): ViewState {
  return {
    ...current,
    paraScope: para === "all" ? [] : [para],
    playbackProgress: 1
  };
}

export function nextQuerySelection(current: ViewState, queryId: string | "all"): ViewState {
  return {
    ...current,
    selectedQueryId: queryId === "all" ? null : queryId,
    selectedMarkId: null,
    playbackProgress: 1
  };
}

export function contextSummary(
  state: ViewState,
  period: PeriodPreset,
  scene: VisualScene | null,
  dataset: ObservatoryDataset | null
): ContextSummary {
  return {
    period,
    paraLabel: state.paraScope.length === 0 ? "All PARA" : state.paraScope.map(titleCase).join(", "),
    queryLabel: state.selectedQueryId ? `Query ${compactId(state.selectedQueryId)}` : "All queries",
    indexDepthLabel: `${state.indexDepth} hop${state.indexDepth === 1 ? "" : "s"}`,
    confidenceLabel: scene ? confidenceText(scene.confidence) : "Not measured yet",
    sourceLabel: dataset
      ? `${dataset.current.notes.length} notes / ${dataset.current.links.length} links / ${dataset.journeys.length} journeys`
      : "No dataset loaded"
  };
}

export function kpisForScene(scene: VisualScene | null): KpiItem[] {
  if (!scene) {
    return [
      { id: "loading", label: "State", value: "Loading", confidence: "unavailable", source: "view" }
    ];
  }
  const primary = scene.metrics.slice(0, 4).map(formatMetric);
  return [
    {
      id: "status",
      label: "Lens state",
      value: scene.status,
      confidence: scene.confidence,
      source: scene.missingCapabilities.length ? `missing ${scene.missingCapabilities.join(", ")}` : "scene"
    },
    ...primary
  ];
}

export function availabilityForScene(scene: VisualScene | null): AvailabilityItem[] {
  if (!scene) {
    return [{ id: "dataset", label: "dataset", state: "missing" }];
  }
  if (scene.missingCapabilities.length === 0) {
    return [{ id: "ready", label: "required data present", state: scene.status === "partial" ? "partial" : "ready" }];
  }
  return scene.missingCapabilities.map((capability) => ({
    id: capability,
    label: capability,
    state: "missing"
  }));
}

export function semanticMarkOrder(tree: SemanticNode | null, hitRegions: HitRegion[]): SemanticMarkItem[] {
  if (!tree) return [];
  const hitById = new Map(hitRegions.map((hit) => [hit.id, hit]));
  return tree.children
    .filter((node) => node.role === "mark")
    .map((node) => {
      const hit = hitById.get(node.id);
      return {
        id: node.id,
        markId: hit?.markId ?? node.id,
        label: node.label,
        confidence: confidenceFromText(node.value),
        disabled: node.disabled,
        selected: node.selected
      };
    })
    .sort((left, right) => {
      const leftOrder = hitById.get(left.id)?.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = hitById.get(right.id)?.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.label.localeCompare(right.label);
    });
}

export function findMarkEvidence(scene: VisualScene | null, markId: string | null): MarkEvidence | null {
  if (!scene || !markId) return null;
  const evidence = scene.inspector.evidence.find((item) => item.id === markId || item.queryId === markId);
  if (evidence) return evidenceToMark(evidence);

  if (scene.primitive === "graph") {
    const node = scene.nodes.find((item) => item.id === markId);
    if (node) {
      return {
        id: node.id,
        label: node.label,
        confidence: node.confidence,
        path: node.path ?? null,
        detail: node.meta ? Object.entries(node.meta).map(([key, value]) => `${key}: ${String(value)}`).join("; ") : null
      };
    }
  }
  if (scene.primitive === "radial") {
    const segment = scene.segments.find((item) => item.id === markId);
    if (segment) {
      return {
        id: segment.id,
        label: segment.label,
        confidence: segment.confidence,
        path: segment.path ?? null,
        detail: `value ${formatNumber(segment.value)}`
      };
    }
    const satellite = scene.satellites.find((item) => item.id === markId);
    if (satellite) {
      return {
        id: satellite.id,
        label: satellite.label,
        confidence: satellite.confidence,
        path: satellite.path ?? null,
        detail: `value ${formatNumber(satellite.value)}`
      };
    }
  }
  return null;
}

export function shouldStartPlayback(input: PlaybackPolicyInput): boolean {
  return (
    input.userRequested &&
    input.trigger !== "none" &&
    !input.hidden &&
    input.width > 0 &&
    input.height > 0
  );
}

export function dwellBucketMs(ms: number): number {
  if (ms <= 0) return 0;
  if (ms < 30_000) return 1;
  if (ms < 180_000) return 30_000;
  return 180_000;
}

export function defaultLensId(settings: ObservatoryPluginSettings): string {
  return OBSERVATORY_LENSES.some((lens) => lens.id === settings.defaultLensId)
    ? settings.defaultLensId
    : OBSERVATORY_LENSES[0]?.id ?? "L01";
}

export function formatInspectorSummary(inspector: InspectorModel): string {
  const metrics = inspector.metrics.length;
  const evidence = inspector.evidence.length;
  return `${metrics} metrics, ${evidence} evidence references`;
}

function formatMetric(metric: MetricDatum): KpiItem {
  return {
    id: metric.id,
    label: metric.label,
    value: metric.value === null ? "unavailable" : `${formatNumber(metric.value)} ${metric.unit}`.trim(),
    confidence: metric.confidence,
    source: metric.sampleSize === undefined ? metric.source : `${metric.source}; n=${metric.sampleSize}`
  };
}

function compareRailItems(left: LensRailItem, right: LensRailItem): number {
  if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
  if (left.recent !== right.recent) return left.recent ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function missingCapabilitiesFor(lens: LensDefinition, dataset: ObservatoryDataset): string[] {
  return lens.requires.filter((capability) => !dataset.capabilities.has(capability));
}

function confidenceText(confidence: Confidence): string {
  if (confidence === "measured") return "Measured";
  if (confidence === "inferred") return "Inferred";
  return "Unavailable";
}

function confidenceFromText(value: string | undefined): Confidence {
  if (value === "measured" || value === "inferred" || value === "unavailable") return value;
  return "unavailable";
}

function evidenceToMark(evidence: EvidenceRef): MarkEvidence {
  return {
    id: evidence.id,
    label: evidence.label,
    confidence: evidence.confidence,
    path: evidence.path ?? null,
    detail: evidence.detail ?? null
  };
}

function compactId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}...${id.slice(-4)}`;
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}
