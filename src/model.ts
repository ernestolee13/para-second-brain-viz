export type Confidence = "measured" | "inferred" | "unavailable";

export type ParaCategory =
  | "common"
  | "projects"
  | "areas"
  | "resources"
  | "archive"
  | "inbox"
  | "unknown";

export type NoteRole =
  | "index"
  | "content"
  | "log"
  | "telemetry"
  | "generated"
  | "runtime"
  | "data";

export interface MetricScope {
  id: string;
  label: string;
  para?: ParaCategory;
  pathPrefix?: string;
  exclusions?: string[];
}

export interface MetricValue {
  id: string;
  definitionVersion: string;
  scope: MetricScope;
  value: number | null;
  unit: string;
  source: string;
  confidence: Confidence;
  observedAt: string;
}

export interface NormalizedNote {
  id: string;
  path: string;
  title: string;
  para: ParaCategory;
  role: NoteRole;
  tags: string[];
  aliases: string[];
  summary: string | null;
  sizeBytes: number | null;
  createdTime: number | null;
  modifiedTime: number | null;
  confidence: Confidence;
}

export interface NormalizedLink {
  id: string;
  sourceId: string;
  targetId: string;
  sourcePath: string;
  targetPath: string;
  resolved: boolean;
  confidence: Confidence;
  displayText?: string;
}

export interface GraphSnapshot {
  id: string;
  definitionVersion: string;
  scope: MetricScope;
  observedAt: string;
  notes: NormalizedNote[];
  links: NormalizedLink[];
  metrics: MetricValue[];
}

export interface SnapshotDiff {
  beforeId: string;
  afterId: string;
  addedNotes: NormalizedNote[];
  removedNotes: NormalizedNote[];
  changedNotes: Array<{
    before: NormalizedNote;
    after: NormalizedNote;
    changedFields: Array<keyof NormalizedNote>;
  }>;
  addedLinks: NormalizedLink[];
  removedLinks: NormalizedLink[];
  metrics: {
    noteDelta: number;
    linkDelta: number;
    resolvedLinkDelta: number;
    unresolvedLinkDelta: number;
  };
}

export interface QueryTelemetryEvent {
  id: string;
  observedAt: string | null;
  kind: string;
  queryId: string;
  requestId: string;
  sessionId: string | null;
  durationMs: MetricReading;
  inputTokens: MetricReading;
  outputTokens: MetricReading;
  totalTokens: MetricReading;
  toolName: string | null;
  accessedPaths: string[];
  stepPaths: string[];
  documentsReadPaths: string[];
  documentsReadCount: MetricReading;
  entrypoints: string[];
  searchStepCount: MetricReading;
  completed: boolean | null;
  buildSummary: ConstructionSummary | null;
  source: string;
  line: number;
  malformed?: false;
}

export interface ConstructionLinkPair {
  sourcePath: string;
  targetPath: string;
}

export interface ConstructionSummary {
  schemaVersion: number;
  operationType: string;
  route: string;
  kbIngestUsed: boolean | null;
  referencePaths: string[];
  createdPaths: string[];
  updatedPaths: string[];
  movedFromPaths: string[];
  movedToPaths: string[];
  indexPaths: string[];
  linkPairs: ConstructionLinkPair[];
  linksAdded: MetricReading;
  backlinksAdded: MetricReading;
  frontmatterCompleted: MetricReading;
  summariesCompleted: MetricReading;
  validation: "passed" | "partial" | "failed" | "unknown";
  confidence: Confidence;
}

export interface MalformedTelemetryLine {
  id: string;
  source: string;
  line: number;
  rawLength: number;
  error: string;
  malformed: true;
}

export type TelemetryLineResult = QueryTelemetryEvent | MalformedTelemetryLine;

export interface MetricReading {
  value: number | null;
  confidence: Confidence;
  source: string;
}

export interface QueryStep {
  index: number;
  eventId: string;
  observedAt: string | null;
  toolName: string | null;
  paths: string[];
}

export interface QueryJourney {
  queryId: string;
  requestId: string;
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: MetricReading;
  inputTokens: MetricReading;
  outputTokens: MetricReading;
  totalTokens: MetricReading;
  documentsReadCount: MetricReading;
  searchStepCount: MetricReading;
  completed: boolean;
  completionConfidence: Confidence;
  tools: string[];
  accessedPaths: string[];
  documentsReadPaths: string[];
  entrypoints: string[];
  buildSummary: ConstructionSummary | null;
  steps: QueryStep[];
  events: QueryTelemetryEvent[];
}

export interface LensUsageBucket {
  lensId: string;
  para: ParaCategory;
  role: NoteRole | "mixed";
  queryCount: number;
  accessCount: number;
  uniquePathRefs: string[];
  durationP50Ms: number | null;
  durationP90Ms: number | null;
  tokensP50: number | null;
  tokensP90: number | null;
  confidence: Confidence;
}

export interface LensUsageSummary {
  generatedAt: string;
  privacy: {
    hashedPathRefs: boolean;
    rawPromptRetained: false;
  };
  buckets: LensUsageBucket[];
  skippedMalformedLines: number;
}

export interface LensUiUsageEvent {
  id: string;
  observedAt: string;
  lensId: string;
  action:
    | "open"
    | "foreground"
    | "replay"
    | "compare"
    | "filter"
    | "drilldown"
    | "unavailable";
  dwellMs?: number | null;
}

export interface LensUiUsageBucket {
  lensId: string;
  openCount: number;
  foregroundDwellBucket: "none" | "short" | "medium" | "long";
  replayUsed: boolean;
  compareUsed: boolean;
  filterUsed: boolean;
  drilldownUsed: boolean;
  unavailableCount: number;
}

export interface LensUiUsageSummary {
  generatedAt: string;
  privacy: {
    notePayloadRetained: false;
    queryPayloadRetained: false;
    titlePayloadRetained: false;
  };
  buckets: LensUiUsageBucket[];
}

export function metricReading(value: number | null, confidence: Confidence, source: string): MetricReading {
  return { value, confidence, source };
}

export function noteId(path: string): string {
  return normalizePath(path);
}

export function linkId(sourcePath: string, targetPath: string): string {
  return `${normalizePath(sourcePath)}->${normalizePath(targetPath)}`;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

export function compareNullableTimestamps(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  if (Number.isFinite(leftTime)) return -1;
  if (Number.isFinite(rightTime)) return 1;
  return left.localeCompare(right);
}
