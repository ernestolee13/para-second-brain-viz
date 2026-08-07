import type { ParaRootRule } from "../adapters/generic";
import {
  compareNullableTimestamps,
  normalizePath,
  type Confidence,
  type NormalizedNote,
  type ParaCategory,
  type QueryJourney
} from "../model";
import type { ObservatoryDataset } from "../visualization/types";

export type SemanticTier =
  | "spine"
  | "kb-root"
  | "para-root"
  | "hub-index"
  | "local-index"
  | "content";

export interface StructuredNode {
  path: string;
  label: string;
  para: ParaCategory;
  tier: SemanticTier;
  clusterId: string;
  clusterLabel: string;
  x: number;
  y: number;
}

export interface ParaRegion {
  para: ParaCategory;
  label: string;
  kind: "core" | "sector" | "satellite";
  startAngle: number;
  endAngle: number;
  innerRadius: number;
  outerRadius: number;
}

export interface FolderCluster {
  id: string;
  label: string;
  para: ParaCategory;
  memberPaths: string[];
}

export interface HierarchyEdge {
  id: string;
  sourcePath: string;
  targetPath: string;
  confidence: Confidence;
  kind: "spine" | "hierarchy";
}

export interface StructuredGraphModel {
  nodes: StructuredNode[];
  regions: ParaRegion[];
  clusters: FolderCluster[];
  hierarchyEdges: HierarchyEdge[];
  corePaths: string[];
  worldRadius: number;
}

export interface RegionActivity {
  para: ParaCategory;
  label: string;
  score: number;
  relative: "low" | "typical" | "high";
  queryTouches: number;
  modifiedNotes: number;
  crossLinks: number;
  confidence: Confidence;
}

export type ConstructionStatus = "healthy" | "attention" | "unintegrated";

export interface NoteConstructionHealth {
  path: string;
  para: ParaCategory;
  expectedIndexPath: string | null;
  indexed: boolean;
  linked: boolean;
  summaryReady: boolean;
  status: ConstructionStatus;
}

export interface ConstructionHealth {
  notes: NoteConstructionHealth[];
  eligibleNotes: number;
  indexedNotes: number;
  linkedNotes: number;
  summarizedNotes: number;
  attentionNotes: number;
  unintegratedNotes: number;
  loggedBuilds: number;
  kbIngestBuilds: number;
  directBuilds: number;
  durationP50Ms: number | null;
  tokensP50: number | null;
  referencesPerBuild: number | null;
  linksAdded: number | null;
  confidence: Confidence;
}

export type KnowledgeAuditFocus =
  | "orphan"
  | "unlinked"
  | "search-dormant"
  | "ingest-dormant"
  | "inactive"
  | "cold";

export interface KnowledgeAuditNode {
  path: string;
  para: ParaCategory;
  incomingLinks: number;
  outgoingLinks: number;
  searchTouches: number;
  ingestTouches: number;
  modifiedInPeriod: boolean;
  orphan: boolean;
  unlinked: boolean;
  searchDormant: boolean;
  ingestDormant: boolean;
  inactive: boolean;
  coldIsolated: boolean;
}

export interface KnowledgeAudit {
  nodes: KnowledgeAuditNode[];
  queryRuns: number;
  loggedBuilds: number;
  searchTelemetryAvailable: boolean;
  ingestTelemetryAvailable: boolean;
  confidence: Confidence;
}

export interface ReplaySegment {
  id: string;
  queryId: string;
  sourcePath: string;
  targetPath: string;
  relation:
    | "linked-pair"
    | "retrieval-transition"
    | "build-capture"
    | "build-guide"
    | "build-route"
    | "build-reference"
    | "build-compose"
    | "build-index"
    | "build-link";
  realDurationMs: number | null;
  visualDurationMs: number;
  order: number;
}

export interface ReplayTrack {
  id: string;
  kind: "query" | "construction";
  provenance: "logged" | "simulated";
  label: string;
  queryIds: string[];
  segments: ReplaySegment[];
  startedAt: string | null;
  totalDurationMs: number | null;
  uniquePaths: number;
  paraSpan: number;
  maxGraphHops: number | null;
  reachPerSecond: number | null;
  totalTokens: number | null;
  referenceCount: number;
  outputCount: number;
  linksAdded: number | null;
  route: string | null;
  kbIngestUsed: boolean | null;
  confidence: Confidence;
}

export interface ReplayParaReach {
  para: ParaCategory;
  current: number;
  total: number;
}

export interface ConcurrentReplayTrackState {
  track: ReplayTrack;
  finishAt: number;
  progress: number;
  segmentIndex: number;
  segmentProgress: number;
  completed: boolean;
}

export interface GrowthReplayEvent {
  id: string;
  kind: "note" | "link";
  observedAt: string;
  timestamp: number;
  path: string | null;
  sourcePath: string | null;
  targetPath: string;
  confidence: Confidence;
}

export interface GrowthReplay {
  events: GrowthReplayEvent[];
  noteEvents: GrowthReplayEvent[];
  linkEvents: GrowthReplayEvent[];
  fromMs: number;
  toMs: number;
  snapshotObservations: number;
  edgeHistoryAvailable: boolean;
}

export interface GrowthReplayState {
  cursorMs: number;
  revealedNotes: Set<string>;
  revealedLinks: GrowthReplayEvent[];
  recentEvents: GrowthReplayEvent[];
}

export interface StructuredGraphOptions {
  paraRoots: readonly ParaRootRule[];
  indexFileNames: readonly string[];
  spinePaths?: readonly string[];
}

const CORE_PARA: ParaCategory[] = ["common", "projects", "areas", "resources", "archive"];
const REPLAY_PARA: ParaCategory[] = [...CORE_PARA, "inbox", "unknown"];
export const INBOX_ORIGIN_PATH = "__llmwo__/inbox-origin";
const PARA_LABELS: Record<ParaCategory, string> = {
  common: "Common",
  projects: "Projects",
  areas: "Areas",
  resources: "Resources",
  archive: "Archive",
  inbox: "Inbox",
  unknown: "Unclassified"
};
const OUTER_SECTORS: Array<{ para: ParaCategory; startAngle: number; endAngle: number }> = [
  { para: "areas", startAngle: -Math.PI / 2, endAngle: 0 },
  { para: "projects", startAngle: 0, endAngle: Math.PI / 2 },
  { para: "resources", startAngle: Math.PI / 2, endAngle: Math.PI },
  { para: "archive", startAngle: Math.PI, endAngle: Math.PI * 1.5 }
];
const INBOX_ANGLE = -Math.PI / 2;
const UNKNOWN_ANGLE = Math.PI / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function buildStructuredGraph(
  dataset: ObservatoryDataset,
  options: StructuredGraphOptions
): StructuredGraphModel {
  const notes = [...dataset.current.notes].sort((a, b) => a.path.localeCompare(b.path));
  const indexNames = new Set(options.indexFileNames.map((name) => basename(normalizePath(name)).toLowerCase()));
  const rootByPara = new Map(options.paraRoots.map((root) => [root.para, trimSlash(normalizePath(root.prefix))]));
  const configuredSpines = configuredSpinePaths(options);
  const worldRadius = clamp(Math.sqrt(Math.max(1, notes.length)) * 78, 2_200, 4_600);
  const innerRadius = worldRadius * 0.23;
  const regions: ParaRegion[] = [
    {
      para: "common",
      label: PARA_LABELS.common,
      kind: "core",
      startAngle: 0,
      endAngle: Math.PI * 2,
      innerRadius: 0,
      outerRadius: innerRadius
    },
    ...OUTER_SECTORS.map((sector): ParaRegion => ({
      ...sector,
      label: PARA_LABELS[sector.para],
      kind: "sector",
      innerRadius: innerRadius + worldRadius * 0.035,
      outerRadius: worldRadius
    })),
    {
      para: "inbox",
      label: PARA_LABELS.inbox,
      kind: "satellite",
      startAngle: INBOX_ANGLE - 0.16,
      endAngle: INBOX_ANGLE + 0.16,
      innerRadius: worldRadius * 1.04,
      outerRadius: worldRadius * 1.18
    },
    {
      para: "unknown",
      label: PARA_LABELS.unknown,
      kind: "satellite",
      startAngle: UNKNOWN_ANGLE - 0.16,
      endAngle: UNKNOWN_ANGLE + 0.16,
      innerRadius: worldRadius * 1.04,
      outerRadius: worldRadius * 1.18
    }
  ];

  const classified = notes.map((note) => ({
    note,
    tier: classifyTier(note, rootByPara, indexNames, configuredSpines),
    cluster: clusterFor(note, rootByPara, configuredSpines)
  }));
  const groups = groupBy(classified, (item) => item.cluster.id);
  const positioned = new Map<string, { x: number; y: number }>();

  positionCommon(groups, positioned, innerRadius);
  for (const sector of OUTER_SECTORS) {
    positionSector(groups, positioned, sector.para, sector.startAngle, sector.endAngle, innerRadius, worldRadius);
  }
  positionSatellite(groups, positioned, "inbox", INBOX_ANGLE, worldRadius);
  positionSatellite(groups, positioned, "unknown", UNKNOWN_ANGLE, worldRadius);
  const corePaths = positionKnowledgeCore(classified, positioned, innerRadius);

  const nodes = classified.map(({ note, tier, cluster }): StructuredNode => {
    const point = positioned.get(note.path) ?? fallbackPosition(note.path, worldRadius * 1.12);
    return {
      path: note.path,
      label: semanticLabel(note.path, note.title, tier),
      para: semanticPara(note, tier),
      tier,
      clusterId: cluster.id,
      clusterLabel: cluster.label,
      x: nonZero(point.x),
      y: nonZero(point.y)
    };
  });
  const clusters = [...groups.entries()]
    .map(([id, members]): FolderCluster => ({
      id,
      label: members[0]?.cluster.label ?? id,
      para: members[0] ? semanticPara(members[0].note, members[0].tier) : "unknown",
      memberPaths: members.map((item) => item.note.path)
    }))
    .sort((a, b) => a.para.localeCompare(b.para) || a.id.localeCompare(b.id));

  return {
    nodes,
    regions,
    clusters,
    hierarchyEdges: hierarchyEdges(nodes),
    corePaths,
    worldRadius: worldRadius * 1.32
  };
}

export function buildRegionActivity(
  dataset: ObservatoryDataset,
  from: string | null,
  to: string | null
): RegionActivity[] {
  const journeys = dataset.journeys.filter(
    (journey) => isExplicitQueryJourney(journey) && inRange(journey.startedAt ?? journey.endedAt, from, to)
  );
  const noteByPath = new Map(dataset.current.notes.map((note) => [note.path, note]));
  const notesByPara = groupBy(dataset.current.notes, (note) => semanticPara(note));
  const queryTouches = new Map<ParaCategory, number>();
  for (const journey of journeys) {
    const touched = new Set(
      [...journey.accessedPaths, ...journey.documentsReadPaths, ...journey.entrypoints]
        .map((path) => resolvePath(path, noteByPath))
        .map((path) => {
          const note = path ? noteByPath.get(path) : undefined;
          return note ? semanticPara(note) : undefined;
        })
        .filter((para): para is ParaCategory => para !== undefined)
    );
    for (const para of touched) queryTouches.set(para, (queryTouches.get(para) ?? 0) + 1);
  }

  const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  const modified = new Map<ParaCategory, number>();
  for (const note of dataset.current.notes) {
    if (note.modifiedTime !== null && note.modifiedTime >= fromMs && note.modifiedTime <= toMs) {
      const para = semanticPara(note);
      modified.set(para, (modified.get(para) ?? 0) + 1);
    }
  }
  const crossLinks = new Map<ParaCategory, number>();
  const noteById = new Map(dataset.current.notes.map((note) => [note.id, note]));
  for (const link of dataset.current.links) {
    const sourceNote = noteById.get(link.sourceId);
    const targetNote = noteById.get(link.targetId);
    const source = sourceNote ? semanticPara(sourceNote) : undefined;
    const target = targetNote ? semanticPara(targetNote) : undefined;
    if (!source || !target || source === target) continue;
    crossLinks.set(source, (crossLinks.get(source) ?? 0) + 1);
    crossLinks.set(target, (crossLinks.get(target) ?? 0) + 1);
  }

  const raw = CORE_PARA.map((para) => {
    const noteCount = notesByPara.get(para)?.length ?? 0;
    return {
      para,
      queryTouches: queryTouches.get(para) ?? 0,
      modifiedNotes: modified.get(para) ?? 0,
      modifiedShare: noteCount > 0 ? (modified.get(para) ?? 0) / noteCount : 0,
      crossLinks: crossLinks.get(para) ?? 0
    };
  });
  const maxTouches = Math.max(1, ...raw.map((item) => item.queryTouches));
  const maxModifiedShare = Math.max(0.0001, ...raw.map((item) => item.modifiedShare));
  const maxCrossLinks = Math.max(1, ...raw.map((item) => item.crossLinks));
  const scores = raw.map((item) => Math.round(clamp(
    (item.queryTouches / maxTouches) * 55
      + (item.modifiedShare / maxModifiedShare) * 25
      + (item.crossLinks / maxCrossLinks) * 20,
    0,
    100
  )));
  const mean = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);

  return raw.map((item, index): RegionActivity => {
    const score = scores[index] ?? 0;
    return {
      para: item.para,
      label: PARA_LABELS[item.para],
      score,
      relative: score < mean * 0.78 ? "low" : score > mean * 1.22 ? "high" : "typical",
      queryTouches: item.queryTouches,
      modifiedNotes: item.modifiedNotes,
      crossLinks: item.crossLinks,
      confidence: journeys.length > 0 ? "inferred" : "unavailable"
    };
  });
}

export function buildGrowthReplay(
  dataset: ObservatoryDataset,
  from: string | null,
  to: string | null
): GrowthReplay {
  const noteEvents = dataset.current.notes
    .filter((note) => timeInRange(note.createdTime, from, to))
    .filter((note): note is NormalizedNote & { createdTime: number } => note.createdTime !== null)
    .map((note): GrowthReplayEvent => ({
      id: `growth:note:${note.path}:${note.createdTime}`,
      kind: "note",
      observedAt: new Date(note.createdTime).toISOString(),
      timestamp: note.createdTime,
      path: note.path,
      sourcePath: null,
      targetPath: note.path,
      confidence: note.confidence
    }));

  const snapshots = uniqueBy([...dataset.snapshots, dataset.current], (snapshot) => snapshot.id);
  const observedAtBySnapshot = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.observedAt]));
  const linkEvents = dataset.diffs.flatMap((diff) => {
    const observedAt = observedAtBySnapshot.get(diff.afterId) ?? null;
    const timestamp = observedAt ? Date.parse(observedAt) : Number.NaN;
    if (!observedAt || !Number.isFinite(timestamp) || !timeInRange(timestamp, from, to)) return [];
    return diff.addedLinks.map((link): GrowthReplayEvent => ({
      id: `growth:link:${diff.afterId}:${link.id}`,
      kind: "link",
      observedAt,
      timestamp,
      path: null,
      sourcePath: link.sourcePath,
      targetPath: link.targetPath,
      confidence: link.confidence
    }));
  });
  const events = uniqueBy([...noteEvents, ...linkEvents], (event) => event.id)
    .sort((a, b) => a.timestamp - b.timestamp || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const explicitFrom = from ? Date.parse(from) : Number.NaN;
  const explicitTo = to ? Date.parse(to) : Number.NaN;
  const eventStart = events[0]?.timestamp ?? Date.now();
  const eventEnd = events.at(-1)?.timestamp ?? eventStart;
  const fromMs = Number.isFinite(explicitFrom) ? explicitFrom : eventStart;
  const toMs = Math.max(fromMs + 1, Number.isFinite(explicitTo) ? explicitTo : eventEnd);
  return {
    events,
    noteEvents,
    linkEvents,
    fromMs,
    toMs,
    snapshotObservations: snapshots.length,
    edgeHistoryAvailable: linkEvents.length > 0 || dataset.diffs.some((diff) => observedAtBySnapshot.has(diff.afterId))
  };
}

export function buildGrowthReplayState(replay: GrowthReplay, progress: number): GrowthReplayState {
  const normalized = clamp(progress, 0, 1);
  const cursorMs = replay.fromMs + (replay.toMs - replay.fromMs) * normalized;
  const revealed = replay.events.filter((event) => event.timestamp <= cursorMs);
  const recentWindow = Math.max(1, (replay.toMs - replay.fromMs) * 0.035);
  return {
    cursorMs,
    revealedNotes: new Set(revealed.filter((event) => event.kind === "note").map((event) => event.targetPath)),
    revealedLinks: revealed.filter((event) => event.kind === "link"),
    recentEvents: revealed.filter((event) => cursorMs - event.timestamp <= recentWindow)
  };
}

export function buildConstructionHealth(
  dataset: ObservatoryDataset,
  options: StructuredGraphOptions,
  from: string | null,
  to: string | null
): ConstructionHealth {
  const noteByPath = new Map(dataset.current.notes.map((note) => [note.path, note]));
  const rootByPara = new Map(options.paraRoots.map((root) => [root.para, trimSlash(normalizePath(root.prefix))]));
  const indexNames = new Set(options.indexFileNames.map((name) => basename(normalizePath(name)).toLowerCase()));
  const incomingIndexPaths = new Map<string, Set<string>>();
  const degree = new Map<string, number>();
  for (const link of dataset.current.links.filter((candidate) => candidate.resolved)) {
    degree.set(link.sourcePath, (degree.get(link.sourcePath) ?? 0) + 1);
    degree.set(link.targetPath, (degree.get(link.targetPath) ?? 0) + 1);
    const sourceNote = noteByPath.get(link.sourcePath);
    if (!sourceNote || !isIndexNote(sourceNote, indexNames)) continue;
    const sources = incomingIndexPaths.get(link.targetPath) ?? new Set<string>();
    sources.add(link.sourcePath);
    incomingIndexPaths.set(link.targetPath, sources);
  }

  const summaryRequired = from !== null;
  const notes = dataset.current.notes
    .filter(isConstructionContent)
    .filter((note) => timeInRange(note.createdTime, from, to))
    .map((note): NoteConstructionHealth => {
      const expectedIndexPath = expectedIndexFor(note, rootByPara, noteByPath, indexNames);
      const indexSources = incomingIndexPaths.get(note.path) ?? new Set<string>();
      const indexed = expectedIndexPath ? indexSources.has(expectedIndexPath) : indexSources.size > 0;
      const linked = (degree.get(note.path) ?? 0) > 0;
      const summaryReady = Boolean(note.summary?.trim());
      const indexRequired = note.para !== "archive";
      const healthy = linked && (!indexRequired || indexed) && (!summaryRequired || summaryReady);
      const status: ConstructionStatus = healthy
        ? "healthy"
        : !linked && !indexed
          ? "unintegrated"
          : "attention";
      return {
        path: note.path,
        para: note.para,
        expectedIndexPath,
        indexed,
        linked,
        summaryReady,
        status
      };
    });

  const builds = dataset.journeys.filter(
    (journey) => journey.buildSummary !== null && inRange(journey.startedAt ?? journey.endedAt, from, to)
  );
  const durations = builds.flatMap((journey) => journey.durationMs.value === null ? [] : [journey.durationMs.value]);
  const tokens = builds.flatMap((journey) => journey.totalTokens.value === null ? [] : [journey.totalTokens.value]);
  const referenceCounts = builds.map((journey) => journey.buildSummary?.referencePaths.length ?? 0);
  const links = builds.flatMap((journey) => {
    const value = journey.buildSummary?.linksAdded.value;
    return value === null || value === undefined ? [] : [value];
  });

  return {
    notes,
    eligibleNotes: notes.length,
    indexedNotes: notes.filter((note) => note.indexed).length,
    linkedNotes: notes.filter((note) => note.linked).length,
    summarizedNotes: notes.filter((note) => note.summaryReady).length,
    attentionNotes: notes.filter((note) => note.status === "attention").length,
    unintegratedNotes: notes.filter((note) => note.status === "unintegrated").length,
    loggedBuilds: builds.length,
    kbIngestBuilds: builds.filter((journey) => journey.buildSummary?.kbIngestUsed === true).length,
    directBuilds: builds.filter((journey) => journey.buildSummary?.kbIngestUsed === false).length,
    durationP50Ms: median(durations),
    tokensP50: median(tokens),
    referencesPerBuild: referenceCounts.length > 0
      ? referenceCounts.reduce((sum, count) => sum + count, 0) / referenceCounts.length
      : null,
    linksAdded: links.length > 0 ? links.reduce((sum, count) => sum + count, 0) : null,
    confidence: notes.length > 0 || builds.length > 0 ? "inferred" : "unavailable"
  };
}

export function buildKnowledgeAudit(
  dataset: ObservatoryDataset,
  from: string | null,
  to: string | null
): KnowledgeAudit {
  const noteByPath = new Map(dataset.current.notes.map((note) => [note.path, note]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const link of dataset.current.links.filter((candidate) => candidate.resolved)) {
    outgoing.set(link.sourcePath, (outgoing.get(link.sourcePath) ?? 0) + 1);
    incoming.set(link.targetPath, (incoming.get(link.targetPath) ?? 0) + 1);
  }

  const queryJourneys = dataset.journeys.filter(
    (journey) => isExplicitQueryJourney(journey) && inRange(journey.startedAt ?? journey.endedAt, from, to)
  );
  const buildJourneys = dataset.journeys.filter(
    (journey) => journey.buildSummary !== null && inRange(journey.startedAt ?? journey.endedAt, from, to)
  );
  const searchTouches = new Map<string, number>();
  const ingestTouches = new Map<string, number>();

  for (const journey of queryJourneys) {
    const touched = new Set(
      [...journey.entrypoints, ...journey.accessedPaths, ...journey.documentsReadPaths]
        .map((path) => resolvePath(path, noteByPath))
        .filter((path): path is string => path !== null)
    );
    for (const path of touched) searchTouches.set(path, (searchTouches.get(path) ?? 0) + 1);
  }

  for (const journey of buildJourneys) {
    const summary = journey.buildSummary;
    if (!summary) continue;
    const touched = new Set([
      ...summary.referencePaths,
      ...summary.createdPaths,
      ...summary.updatedPaths,
      ...summary.movedFromPaths,
      ...summary.movedToPaths,
      ...summary.indexPaths,
      ...summary.linkPairs.flatMap((pair) => [pair.sourcePath, pair.targetPath])
    ].map((path) => resolvePath(path, noteByPath)).filter((path): path is string => path !== null));
    for (const path of touched) ingestTouches.set(path, (ingestTouches.get(path) ?? 0) + 1);
  }

  const nodes = dataset.current.notes.map((note): KnowledgeAuditNode => {
    const incomingLinks = incoming.get(note.path) ?? 0;
    const outgoingLinks = outgoing.get(note.path) ?? 0;
    const searchTouchCount = searchTouches.get(note.path) ?? 0;
    const ingestTouchCount = ingestTouches.get(note.path) ?? 0;
    const modifiedInPeriod = timeInRange(note.modifiedTime, from, to);
    const orphan = incomingLinks === 0;
    const unlinked = incomingLinks + outgoingLinks === 0;
    const searchDormant = searchTouchCount === 0;
    const ingestDormant = ingestTouchCount === 0;
    const inactive = searchDormant && ingestDormant && !modifiedInPeriod;
    return {
      path: note.path,
      para: semanticPara(note),
      incomingLinks,
      outgoingLinks,
      searchTouches: searchTouchCount,
      ingestTouches: ingestTouchCount,
      modifiedInPeriod,
      orphan,
      unlinked,
      searchDormant,
      ingestDormant,
      inactive,
      coldIsolated: inactive && incomingLinks + outgoingLinks <= 1
    };
  });

  return {
    nodes,
    queryRuns: queryJourneys.length,
    loggedBuilds: buildJourneys.length,
    searchTelemetryAvailable: queryJourneys.length > 0,
    ingestTelemetryAvailable: buildJourneys.length > 0,
    confidence: nodes.length > 0 ? "inferred" : "unavailable"
  };
}

export function buildQueryReplayTracks(
  dataset: ObservatoryDataset,
  from: string | null,
  to: string | null
): ReplayTrack[] {
  const noteByPath = new Map(dataset.current.notes.map((note) => [note.path, note]));
  const adjacency = buildAdjacency(dataset);
  const linkPairs = new Set<string>();
  for (const link of dataset.current.links) {
    linkPairs.add(pairKey(link.sourcePath, link.targetPath));
    linkPairs.add(pairKey(link.targetPath, link.sourcePath));
  }
  return dataset.journeys
    .filter(isExplicitQueryJourney)
    .filter((journey) => inRange(journey.startedAt ?? journey.endedAt, from, to))
    .sort((a, b) => compareNullableTimestamps(a.startedAt, b.startedAt) || a.queryId.localeCompare(b.queryId))
    .map((journey) => replayTrack(journey, noteByPath, adjacency, linkPairs))
    .filter((track) => track.segments.length > 0);
}

export function aggregateReplayTrack(tracks: readonly ReplayTrack[]): ReplayTrack | null {
  const selected = [...tracks];
  if (selected.length === 0) return null;
  let order = 0;
  const segments = selected.flatMap((track) => track.segments.map((segment): ReplaySegment => ({
    ...segment,
    id: `period:${segment.id}`,
    order: order++
  })));
  const totalDurationValues = selected
    .map((track) => track.totalDurationMs)
    .filter((value): value is number => value !== null);
  const totalDurationMs = totalDurationValues.length > 0
    ? totalDurationValues.reduce((sum, value) => sum + value, 0)
    : null;
  const uniquePaths = new Set(segments.flatMap((segment) => [segment.sourcePath, segment.targetPath])).size;
  const maxGraphHops = maxNullable(selected.map((track) => track.maxGraphHops));
  return {
    id: "period",
    kind: "query",
    provenance: "logged",
    label: `Period activity · ${selected.length} queries`,
    queryIds: selected.flatMap((track) => track.queryIds),
    segments,
    startedAt: selected[0]?.startedAt ?? null,
    totalDurationMs,
    uniquePaths,
    paraSpan: Math.max(...selected.map((track) => track.paraSpan)),
    maxGraphHops,
    reachPerSecond: totalDurationMs && totalDurationMs > 0 ? uniquePaths / (totalDurationMs / 1_000) : null,
    totalTokens: nullableSum(selected.map((track) => track.totalTokens)),
    referenceCount: 0,
    outputCount: 0,
    linksAdded: null,
    route: null,
    kbIngestUsed: null,
    confidence: selected.every((track) => track.confidence === "measured") ? "measured" : "inferred"
  };
}

export function buildSimulatedQueryTracks(
  dataset: ObservatoryDataset,
  options: StructuredGraphOptions,
  limit = 20
): ReplayTrack[] {
  const model = buildStructuredGraph(dataset, options);
  const nodeByPath = new Map(model.nodes.map((node) => [node.path, node]));
  const kbRoot = model.nodes.find((node) => node.tier === "kb-root")?.path
    ?? model.nodes.find((node) => node.tier === "para-root")?.path
    ?? model.nodes.find((node) => node.tier === "spine")?.path
    ?? null;
  const roots = new Map(model.nodes
    .filter((node) => node.tier === "para-root")
    .map((node) => [node.para, node.path]));
  const hubs = new Map(model.nodes
    .filter((node) => node.tier === "hub-index")
    .map((node) => [node.clusterId, node.path]));
  if (!kbRoot) return [];

  const candidates = model.nodes.filter((node) => node.tier === "content"
    && ["projects", "areas", "resources", "archive"].includes(node.para));
  const targets = takeBalancedParaCandidates(candidates, Math.max(0, limit), "sim-query");
  const linkPairs = new Set<string>();
  const neighbors = new Map<string, Set<string>>();
  for (const link of dataset.current.links.filter((link) => link.resolved)) {
    linkPairs.add(pairKey(link.sourcePath, link.targetPath));
    linkPairs.add(pairKey(link.targetPath, link.sourcePath));
    const source = neighbors.get(link.sourcePath) ?? new Set<string>();
    source.add(link.targetPath);
    neighbors.set(link.sourcePath, source);
    const target = neighbors.get(link.targetPath) ?? new Set<string>();
    target.add(link.sourcePath);
    neighbors.set(link.targetPath, target);
  }
  const fallbackReferences = [...candidates]
    .sort((a, b) => stableUnit(`sim-query-reference:${a.path}`) - stableUnit(`sim-query-reference:${b.path}`));
  const durations = [8_400, 9_200, 10_100, 11_200, 12_400, 13_700, 14_900, 16_200, 17_600, 18_900,
    20_300, 21_800, 23_200, 24_700, 26_300, 27_900, 29_500, 11_600, 15_400, 22_600];
  const tokenCounts = [1_850, 2_200, 2_650, 3_100, 3_450, 3_900, 4_350, 4_900, 5_300, 5_850,
    6_250, 6_800, 7_250, 7_800, 8_300, 8_850, 9_400, 3_650, 5_100, 7_050];
  const generatedAt = Date.parse(dataset.generatedAt);
  const endTime = Number.isFinite(generatedAt) ? generatedAt : Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1_000;

  return targets.map((target, index): ReplayTrack => {
    const archetype = index % 5;
    const root = roots.get(target.para) ?? kbRoot;
    const hub = hubs.get(target.clusterId) ?? root;
    const actualReferences = [...(neighbors.get(target.path) ?? [])]
      .map((path) => nodeByPath.get(path))
      .filter((node): node is StructuredNode => node !== undefined && node.tier === "content" && node.path !== target.path)
      .sort((a, b) => Number(b.para !== target.para) - Number(a.para !== target.para)
        || stableUnit(`sim-query-neighbor:${a.path}`) - stableUnit(`sim-query-neighbor:${b.path}`));
    const referenceCount = archetype === 0 ? 0 : archetype <= 2 ? 1 : 2;
    const references = uniqueBy([
      ...actualReferences,
      ...fallbackReferences.filter((node) => node.path !== target.path && (archetype < 2 || node.para !== target.para))
    ], (node) => node.path).slice(0, referenceCount);
    const pathSequence = unique([kbRoot, root, hub, target.path, ...references.map((node) => node.path)]);
    const queryId = `sim-query:${index + 1}:${target.path}`;
    const totalDurationMs = durations[index % durations.length] ?? 12_000;
    const segmentDurations = distributeDuration(totalDurationMs, Math.max(0, pathSequence.length - 1));
    const visualDurations = compressedDurations(segmentDurations);
    const segments: ReplaySegment[] = [];
    for (let segmentIndex = 1; segmentIndex < pathSequence.length; segmentIndex += 1) {
      const sourcePath = pathSequence[segmentIndex - 1];
      const targetPath = pathSequence[segmentIndex];
      if (!sourcePath || !targetPath || sourcePath === targetPath) continue;
      segments.push({
        id: `${queryId}:${segmentIndex - 1}:${sourcePath}->${targetPath}`,
        queryId,
        sourcePath,
        targetPath,
        relation: linkPairs.has(pairKey(sourcePath, targetPath)) ? "linked-pair" : "retrieval-transition",
        realDurationMs: segmentDurations[segmentIndex - 1] ?? null,
        visualDurationMs: visualDurations[segmentIndex - 1] ?? 420,
        order: segmentIndex - 1
      });
    }
    const pathSet = new Set(segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]));
    const scenario = ["direct index lookup", "project hub recall", "linked-note expansion", "cross-PARA synthesis", "deep recall path"][archetype]
      ?? "structured recall";
    return {
      id: queryId,
      kind: "query",
      provenance: "simulated",
      label: `${scenario} · ${target.clusterLabel}`,
      queryIds: [queryId],
      segments,
      startedAt: new Date(endTime - weekMs + (weekMs * (index + 1)) / Math.max(1, targets.length)).toISOString(),
      totalDurationMs,
      uniquePaths: pathSet.size,
      paraSpan: new Set([...pathSet].map((path) => nodeByPath.get(path)?.para).filter(Boolean)).size,
      maxGraphHops: segments.length,
      reachPerSecond: totalDurationMs > 0 ? pathSet.size / (totalDurationMs / 1_000) : null,
      totalTokens: tokenCounts[index % tokenCounts.length] ?? 3_000,
      referenceCount: 0,
      outputCount: 0,
      linksAdded: null,
      route: scenario,
      kbIngestUsed: null,
      confidence: "inferred"
    };
  });
}

export function aggregateSimulatedQueryTrack(tracks: readonly ReplayTrack[]): ReplayTrack | null {
  const aggregate = aggregateReplayTrack(tracks);
  if (!aggregate) return null;
  return {
    ...aggregate,
    id: "sim-query-period",
    provenance: "simulated",
    label: `Query wave · ${tracks.length} queries`,
    route: "query replay set",
    confidence: "inferred"
  };
}

export function buildReplayParaReach(
  track: ReplayTrack | null,
  nodes: readonly StructuredNode[],
  visibleSegmentCount: number
): ReplayParaReach[] {
  if (!track) return [];
  const paraByPath = new Map(nodes.map((node) => [node.path, node.para]));
  const totalPaths = new Map<ParaCategory, Set<string>>();
  const currentPaths = new Map<ParaCategory, Set<string>>();
  const addPath = (target: Map<ParaCategory, Set<string>>, path: string): void => {
    const para = paraByPath.get(path);
    if (!para) return;
    const paths = target.get(para) ?? new Set<string>();
    paths.add(path);
    target.set(para, paths);
  };
  for (const segment of track.segments) {
    addPath(totalPaths, segment.sourcePath);
    addPath(totalPaths, segment.targetPath);
  }
  const visible = Math.min(track.segments.length, Math.max(0, Math.floor(visibleSegmentCount)));
  for (const segment of track.segments.slice(0, visible)) {
    addPath(currentPaths, segment.sourcePath);
    addPath(currentPaths, segment.targetPath);
  }
  return REPLAY_PARA.map((para) => ({
    para,
    current: currentPaths.get(para)?.size ?? 0,
    total: totalPaths.get(para)?.size ?? 0
  }));
}

export function buildConcurrentReplayStates(
  tracks: readonly ReplayTrack[],
  periodProgress: number
): ConcurrentReplayTrackState[] {
  const durations = tracks
    .map((track) => track.totalDurationMs)
    .filter((duration): duration is number => duration !== null && duration > 0);
  const logDurations = durations.map((duration) => Math.log1p(duration));
  const minLog = logDurations.length > 0 ? Math.min(...logDurations) : 0;
  const maxLog = logDurations.length > 0 ? Math.max(...logDurations) : 0;
  const fallbackDuration = median(durations) ?? null;
  const globalProgress = clamp(periodProgress, 0, 1);

  return tracks.map((track): ConcurrentReplayTrackState => {
    const duration = track.totalDurationMs && track.totalDurationMs > 0
      ? track.totalDurationMs
      : fallbackDuration;
    const durationPosition = duration === null || maxLog === minLog
      ? 1
      : (Math.log1p(duration) - minLog) / (maxLog - minLog);
    const finishAt = clamp(0.34 + durationPosition * 0.66, 0.34, 1);
    const progress = clamp(globalProgress / finishAt, 0, 1);
    if (track.segments.length === 0 || progress >= 1) {
      return {
        track,
        finishAt,
        progress: 1,
        segmentIndex: track.segments.length,
        segmentProgress: 1,
        completed: true
      };
    }

    const weights = track.segments.map((segment) => segment.realDurationMs && segment.realDurationMs > 0
      ? segment.realDurationMs
      : Math.max(1, segment.visualDurationMs));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let elapsed = progress * totalWeight;
    let segmentIndex = 0;
    while (segmentIndex < weights.length - 1 && elapsed >= (weights[segmentIndex] ?? 0)) {
      elapsed -= weights[segmentIndex] ?? 0;
      segmentIndex += 1;
    }
    const segmentWeight = Math.max(1, weights[segmentIndex] ?? 1);
    return {
      track,
      finishAt,
      progress,
      segmentIndex,
      segmentProgress: clamp(elapsed / segmentWeight, 0, 1),
      completed: false
    };
  });
}

export function buildConcurrentReplayParaReach(
  states: readonly ConcurrentReplayTrackState[],
  nodes: readonly StructuredNode[],
  started: boolean
): ReplayParaReach[] {
  const paraByPath = new Map(nodes.map((node) => [node.path, node.para]));
  const totalPaths = new Map<ParaCategory, Set<string>>();
  const currentPaths = new Map<ParaCategory, Set<string>>();
  const addPath = (target: Map<ParaCategory, Set<string>>, path: string): void => {
    const para = paraByPath.get(path);
    if (!para) return;
    const paths = target.get(para) ?? new Set<string>();
    paths.add(path);
    target.set(para, paths);
  };
  for (const state of states) {
    for (const segment of state.track.segments) {
      addPath(totalPaths, segment.sourcePath);
      addPath(totalPaths, segment.targetPath);
    }
    if (!started) continue;
    const visibleCount = state.completed
      ? state.track.segments.length
      : state.progress > 0
        ? Math.min(state.track.segments.length, state.segmentIndex + 1)
        : 0;
    for (const segment of state.track.segments.slice(0, visibleCount)) {
      addPath(currentPaths, segment.sourcePath);
      addPath(currentPaths, segment.targetPath);
    }
  }
  return REPLAY_PARA.map((para) => ({
    para,
    current: currentPaths.get(para)?.size ?? 0,
    total: totalPaths.get(para)?.size ?? 0
  }));
}

export function buildConstructionReplayTracks(
  dataset: ObservatoryDataset,
  from: string | null,
  to: string | null,
  options?: StructuredGraphOptions
): ReplayTrack[] {
  const noteByPath = new Map(dataset.current.notes.map((note) => [note.path, note]));
  const adjacency = buildAdjacency(dataset);
  return dataset.journeys
    .filter((journey) => journey.buildSummary !== null)
    .filter((journey) => inRange(journey.startedAt ?? journey.endedAt, from, to))
    .sort((a, b) => compareNullableTimestamps(a.startedAt, b.startedAt) || a.queryId.localeCompare(b.queryId))
    .map((journey) => constructionReplayTrack(journey, noteByPath, adjacency, options))
    .filter((track): track is ReplayTrack => track !== null);
}

export function aggregateConstructionReplayTrack(tracks: readonly ReplayTrack[]): ReplayTrack | null {
  const selected = [...tracks];
  if (selected.length === 0) return null;
  let order = 0;
  const segments = selected.flatMap((track) => track.segments.map((segment): ReplaySegment => ({
    ...segment,
    id: `build-period:${segment.id}`,
    order: order++
  })));
  const duration = nullableSum(selected.map((track) => track.totalDurationMs));
  const uniquePaths = new Set(segments.flatMap((segment) => [segment.sourcePath, segment.targetPath])).size;
  return {
    id: "build-period",
    kind: "construction",
    provenance: "logged",
    label: `Period builds · ${selected.length} operations`,
    queryIds: selected.flatMap((track) => track.queryIds),
    segments,
    startedAt: selected[0]?.startedAt ?? null,
    totalDurationMs: duration,
    uniquePaths,
    paraSpan: Math.max(...selected.map((track) => track.paraSpan)),
    maxGraphHops: maxNullable(selected.map((track) => track.maxGraphHops)),
    reachPerSecond: duration && duration > 0 ? uniquePaths / (duration / 1_000) : null,
    totalTokens: nullableSum(selected.map((track) => track.totalTokens)),
    referenceCount: selected.reduce((sum, track) => sum + track.referenceCount, 0),
    outputCount: selected.reduce((sum, track) => sum + track.outputCount, 0),
    linksAdded: nullableSum(selected.map((track) => track.linksAdded)),
    route: null,
    kbIngestUsed: selected.every((track) => track.kbIngestUsed === true)
      ? true
      : selected.some((track) => track.kbIngestUsed === false)
        ? false
        : null,
    confidence: selected.every((track) => track.confidence === "measured") ? "measured" : "inferred"
  };
}

export function buildSimulatedPlacementTracks(
  dataset: ObservatoryDataset,
  options: StructuredGraphOptions,
  limit = 20
): ReplayTrack[] {
  const model = buildStructuredGraph(dataset, options);
  const nodeByPath = new Map(model.nodes.map((node) => [node.path, node]));
  const noteByPath = new Map(dataset.current.notes.map((note) => [note.path, note]));
  const roots = new Map(model.nodes
    .filter((node) => node.tier === "para-root")
    .map((node) => [node.para, node.path]));
  const hubByCluster = new Map(model.nodes
    .filter((node) => node.tier === "hub-index")
    .map((node) => [node.clusterId, node.path]));
  const kbRoot = model.nodes.find((node) => node.tier === "kb-root")?.path
    ?? model.nodes.find((node) => node.tier === "para-root")?.path
    ?? null;
  const guide = selectGuidePath(noteByPath, options, model) ?? kbRoot;
  if (!guide || !kbRoot) return [];

  const candidates = model.nodes.filter((node) => node.tier === "content"
    && ["projects", "areas", "resources", "archive"].includes(node.para));
  const targets = takeBalancedParaCandidates(candidates, Math.max(0, limit), "placement");

  const neighbors = new Map<string, Set<string>>();
  for (const link of dataset.current.links.filter((link) => link.resolved)) {
    const source = neighbors.get(link.sourcePath) ?? new Set<string>();
    source.add(link.targetPath);
    neighbors.set(link.sourcePath, source);
    const target = neighbors.get(link.targetPath) ?? new Set<string>();
    target.add(link.sourcePath);
    neighbors.set(link.targetPath, target);
  }
  const fallbackReferences = [...candidates]
    .sort((a, b) => stableUnit(`reference:${a.path}`) - stableUnit(`reference:${b.path}`));
  const generatedAt = Date.parse(dataset.generatedAt);
  const endTime = Number.isFinite(generatedAt) ? generatedAt : Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1_000;

  return targets.map((target, index): ReplayTrack => {
    const archetype = index % 5;
    const finalRoot = roots.get(target.para) ?? kbRoot;
    const finalIndex = hubByCluster.get(target.clusterId) ?? finalRoot;
    const actualReferences = [...(neighbors.get(target.path) ?? [])]
      .map((path) => nodeByPath.get(path))
      .filter((node): node is StructuredNode => node !== undefined
        && node.path !== finalIndex
        && node.tier === "content")
      .sort((a, b) => Number(b.para !== target.para) - Number(a.para !== target.para)
        || stableUnit(`neighbor:${a.path}`) - stableUnit(`neighbor:${b.path}`));
    const referenceCount = archetype === 0 ? 0 : archetype === 1 || archetype === 3 ? 1 : 2;
    const references = uniqueBy([
      ...actualReferences,
      ...fallbackReferences.filter((node) => node.path !== target.path && node.path !== finalIndex)
    ], (node) => node.path).slice(0, referenceCount);
    const alternateCount = archetype === 3 ? 1 : archetype === 4 ? 2 : 0;
    const preferredAlternateParas = references
      .map((node) => node.para)
      .filter((para) => para !== target.para && roots.has(para));
    const remainingAlternateParas = (["projects", "areas", "resources", "archive"] as ParaCategory[])
      .filter((para) => para !== target.para && roots.has(para))
      .sort((a, b) => stableUnit(`${target.path}:${a}`) - stableUnit(`${target.path}:${b}`));
    const alternateRoots = unique([...preferredAlternateParas, ...remainingAlternateParas])
      .slice(0, alternateCount)
      .map((para) => roots.get(para))
      .filter((path): path is string => path !== undefined);
    const raw: Array<{ sourcePath: string; targetPath: string; relation: ReplaySegment["relation"] }> = [];
    const push = (sourcePath: string, targetPath: string, relation: ReplaySegment["relation"]): void => {
      if (sourcePath !== targetPath) raw.push({ sourcePath, targetPath, relation });
    };
    if (index % 3 === 1 || archetype === 4) push(INBOX_ORIGIN_PATH, guide, "build-capture");
    push(guide, kbRoot, "build-guide");
    let routeCursor = kbRoot;
    for (const alternateRoot of alternateRoots) {
      push(routeCursor, alternateRoot, "build-route");
      routeCursor = alternateRoot;
    }
    push(routeCursor, finalRoot, "build-route");
    if (finalIndex !== finalRoot) push(finalRoot, finalIndex, "build-route");
    for (const reference of references) {
      push(finalIndex, reference.path, "build-reference");
      push(reference.path, target.path, "build-compose");
    }
    push(finalIndex, target.path, "build-index");
    push(finalIndex, target.path, "build-link");

    const uniqueRaw = uniqueBy(raw, (segment) => `${segment.relation}:${segment.sourcePath}->${segment.targetPath}`);
    const visualDurations = uniqueRaw.map((segment) => {
      if (segment.relation === "build-capture") return 440;
      if (segment.relation === "build-route") return alternateRoots.length > 0 ? 620 : 330;
      if (segment.relation === "build-reference") return 460;
      if (segment.relation === "build-compose") return 720;
      if (segment.relation === "build-index") return 560;
      if (segment.relation === "build-link") return 380;
      return 280;
    });
    const queryId = `sim-build:${index + 1}:${target.path}`;
    const segments = uniqueRaw.map((segment, segmentIndex): ReplaySegment => ({
      id: `${queryId}:${segmentIndex}:${segment.sourcePath}->${segment.targetPath}`,
      queryId,
      sourcePath: segment.sourcePath,
      targetPath: segment.targetPath,
      relation: segment.relation,
      realDurationMs: null,
      visualDurationMs: visualDurations[segmentIndex] ?? 420,
      order: segmentIndex
    }));
    const pathSet = new Set(segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]));
    const scenario = archetype === 0
      ? "fast settle"
      : archetype === 1
        ? "reference assisted"
        : archetype === 2
          ? "cross-PARA synthesis"
          : archetype === 3
            ? "reconsider once"
            : "ping-pong then settle";
    const startedAt = new Date(endTime - weekMs + (weekMs * (index + 1)) / Math.max(1, targets.length)).toISOString();
    const simulatedDuration = Math.round(20_000 + stableUnit(`ingest-duration:${target.path}`) * 100_000);
    const realDurations = distributeWeightedDuration(simulatedDuration, visualDurations);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      if (segment) segment.realDurationMs = realDurations[segmentIndex] ?? null;
    }
    const simulatedTokens = Math.round(3_200 + stableUnit(`ingest-tokens:${target.path}`) * 18_800);
    return {
      id: queryId,
      kind: "construction",
      provenance: "simulated",
      label: `${scenario} · ${target.clusterLabel}`,
      queryIds: [queryId],
      segments,
      startedAt,
      totalDurationMs: simulatedDuration,
      uniquePaths: pathSet.size,
      paraSpan: new Set([...pathSet].map((path) => nodeByPath.get(path)?.para).filter(Boolean)).size,
      maxGraphHops: segments.length,
      reachPerSecond: simulatedDuration > 0 ? pathSet.size / (simulatedDuration / 1_000) : null,
      totalTokens: simulatedTokens,
      referenceCount: references.length,
      outputCount: 1,
      linksAdded: 1,
      route: scenario,
      kbIngestUsed: true,
      confidence: "inferred"
    };
  });
}

export function aggregateSimulatedPlacementTrack(tracks: readonly ReplayTrack[]): ReplayTrack | null {
  const aggregate = aggregateConstructionReplayTrack(tracks);
  if (!aggregate) return null;
  return {
    ...aggregate,
    id: "sim-build-period",
    provenance: "simulated",
    label: `Placement wave · ${tracks.length} notes`,
    route: "placement replay set",
    kbIngestUsed: true,
    confidence: "inferred"
  };
}

function replayTrack(
  journey: QueryJourney,
  noteByPath: Map<string, NormalizedNote>,
  adjacency: Map<string, Set<string>>,
  linkPairs: Set<string>
): ReplayTrack {
  const eventById = new Map(journey.events.map((event) => [event.id, event]));
  const raw: Array<{
    sourcePath: string;
    targetPath: string;
    durationMs: number | null;
  }> = [];
  let previous: string | null = null;
  const fallbackDuration = journey.durationMs.value !== null && journey.steps.length > 0
    ? journey.durationMs.value / journey.steps.length
    : null;
  const hasExplicitStart = journey.events.some((event) => event.kind === "QueryStart");
  const stepGroups = hasExplicitStart && journey.steps.length > 0
    ? journey.steps.map((step) => ({
        paths: step.paths,
        durationMs: eventById.get(step.eventId)?.durationMs.value ?? fallbackDuration
      }))
    : [{
        paths: [...journey.entrypoints, ...journey.accessedPaths, ...journey.documentsReadPaths],
        durationMs: journey.durationMs.value
      }];

  for (const group of stepGroups) {
    const paths = unique(group.paths.map((path) => resolvePath(path, noteByPath)).filter((path): path is string => path !== null));
    const transitionDuration = group.durationMs !== null && paths.length > 0
      ? group.durationMs / Math.max(1, paths.length)
      : null;
    for (const path of paths) {
      if (previous && previous !== path) raw.push({ sourcePath: previous, targetPath: path, durationMs: transitionDuration });
      previous = path;
    }
  }

  if (raw.length === 0) {
    const paths = unique(
      [...journey.entrypoints, ...journey.accessedPaths, ...journey.documentsReadPaths]
        .map((path) => resolvePath(path, noteByPath))
        .filter((path): path is string => path !== null)
    );
    for (let index = 1; index < paths.length; index += 1) {
      const sourcePath = paths[index - 1];
      const targetPath = paths[index];
      if (!sourcePath || !targetPath) continue;
      raw.push({
        sourcePath,
        targetPath,
        durationMs: journey.durationMs.value === null ? null : journey.durationMs.value / Math.max(1, paths.length - 1)
      });
    }
  }

  const visualDurations = compressedDurations(raw.map((segment) => segment.durationMs));
  const segments = raw.map((segment, index): ReplaySegment => ({
    id: `${journey.queryId}:${index}:${segment.sourcePath}->${segment.targetPath}`,
    queryId: journey.queryId,
    sourcePath: segment.sourcePath,
    targetPath: segment.targetPath,
    relation: linkPairs.has(pairKey(segment.sourcePath, segment.targetPath)) ? "linked-pair" : "retrieval-transition",
    realDurationMs: segment.durationMs,
    visualDurationMs: visualDurations[index] ?? 420,
    order: index
  }));
  const pathSet = new Set(segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]));
  const paraSpan = new Set([...pathSet].map((path) => {
    const note = noteByPath.get(path);
    return note ? semanticPara(note) : undefined;
  }).filter(Boolean)).size;
  const entry = resolvePath(journey.entrypoints[0] ?? segments[0]?.sourcePath ?? "", noteByPath);
  const maxGraphHops = entry ? maxReachHops(entry, pathSet, adjacency) : null;
  const duration = journey.durationMs.value;
  return {
    id: journey.queryId,
    kind: "query",
    provenance: "logged",
    label: queryLabel(journey),
    queryIds: [journey.queryId],
    segments,
    startedAt: journey.startedAt,
    totalDurationMs: duration,
    uniquePaths: pathSet.size,
    paraSpan,
    maxGraphHops,
    reachPerSecond: duration !== null && duration > 0 ? pathSet.size / (duration / 1_000) : null,
    totalTokens: journey.totalTokens.value,
    referenceCount: 0,
    outputCount: 0,
    linksAdded: null,
    route: null,
    kbIngestUsed: null,
    confidence: journey.durationMs.confidence === "measured" && segments.every((segment) => segment.realDurationMs !== null)
      ? "measured"
      : "inferred"
  };
}

function constructionReplayTrack(
  journey: QueryJourney,
  noteByPath: Map<string, NormalizedNote>,
  adjacency: Map<string, Set<string>>,
  options?: StructuredGraphOptions
): ReplayTrack | null {
  const summary = journey.buildSummary;
  if (!summary) return null;
  const rawOutputs = unique([
    ...summary.createdPaths,
    ...summary.updatedPaths,
    ...summary.movedToPaths
  ].map((path) => resolvePath(path, noteByPath)).filter((path): path is string => path !== null));
  const references = unique(summary.referencePaths
    .map((path) => resolvePath(path, noteByPath))
    .filter((path): path is string => path !== null));
  const indexes = unique(summary.indexPaths
    .map((path) => resolvePath(path, noteByPath))
    .filter((path): path is string => path !== null));
  const knowledgeOutputs = rawOutputs.filter((path) =>
    !indexes.includes(path) && !isConstructionSupportPath(path, noteByPath, options));
  const outputs = knowledgeOutputs.length > 0 ? knowledgeOutputs : rawOutputs;
  const raw: Array<{ sourcePath: string; targetPath: string; relation: ReplaySegment["relation"] }> = [];

  const guide = selectGuidePath(noteByPath, options);
  const kbRoot = selectKnowledgeRootPath(noteByPath, options);
  const movedFromInbox = summary.movedFromPaths.some((path) => isInboxOrigin(path, options));
  const intakeTarget = guide ?? kbRoot;
  if (movedFromInbox && intakeTarget) {
    raw.push({ sourcePath: INBOX_ORIGIN_PATH, targetPath: intakeTarget, relation: "build-capture" });
  }
  if (summary.kbIngestUsed === true && guide && kbRoot && guide !== kbRoot) {
    raw.push({ sourcePath: guide, targetPath: kbRoot, relation: "build-guide" });
  }
  if (kbRoot) {
    for (const indexPath of indexes) {
      if (indexPath !== kbRoot) raw.push({ sourcePath: kbRoot, targetPath: indexPath, relation: "build-route" });
    }
  }

  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index];
    if (!output) continue;
    const indexPath = indexes[index % Math.max(1, indexes.length)];
    const rotatedReferences = references.map((_, offset) => references[(index + 1 + offset) % references.length]);
    const reference = rotatedReferences.find((path) => path !== output && path !== indexPath)
      ?? rotatedReferences.find((path) => path !== output);
    if (reference && reference !== output) {
      if (indexPath && indexPath !== reference) {
        raw.push({ sourcePath: indexPath, targetPath: reference, relation: "build-reference" });
      }
      raw.push({ sourcePath: reference, targetPath: output, relation: "build-compose" });
    }
    if (indexPath && indexPath !== output) raw.push({ sourcePath: indexPath, targetPath: output, relation: "build-index" });
  }
  for (const pair of summary.linkPairs) {
    const sourcePath = resolvePath(pair.sourcePath, noteByPath);
    const targetPath = resolvePath(pair.targetPath, noteByPath);
    if (sourcePath && targetPath && sourcePath !== targetPath) {
      raw.push({ sourcePath, targetPath, relation: "build-link" });
    }
  }

  const uniqueRaw = uniqueBy(raw, (segment) => `${segment.relation}:${segment.sourcePath}->${segment.targetPath}`).slice(0, 80);
  if (uniqueRaw.length === 0) return null;
  const perSegmentDuration = journey.durationMs.value === null
    ? null
    : journey.durationMs.value / uniqueRaw.length;
  const visualDurations = compressedDurations(uniqueRaw.map(() => perSegmentDuration));
  const segments = uniqueRaw.map((segment, index): ReplaySegment => ({
    id: `build:${journey.queryId}:${index}:${segment.sourcePath}->${segment.targetPath}`,
    queryId: journey.queryId,
    sourcePath: segment.sourcePath,
    targetPath: segment.targetPath,
    relation: segment.relation,
    realDurationMs: perSegmentDuration,
    visualDurationMs: visualDurations[index] ?? 420,
    order: index
  }));
  const pathSet = new Set(segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]));
  const entry = guide ?? kbRoot ?? indexes[0] ?? references[0] ?? outputs[0] ?? null;
  const duration = journey.durationMs.value;
  return {
    id: `build:${journey.queryId}`,
    kind: "construction",
    provenance: "logged",
    label: `Build · ${summary.route} · ${outputs.length} outputs`,
    queryIds: [journey.queryId],
    segments,
    startedAt: journey.startedAt,
    totalDurationMs: duration,
    uniquePaths: pathSet.size,
    paraSpan: new Set([...pathSet].map((path) => {
      const note = noteByPath.get(path);
      return note ? semanticPara(note) : undefined;
    }).filter(Boolean)).size,
    maxGraphHops: entry ? maxReachHops(entry, pathSet, adjacency) : null,
    reachPerSecond: duration !== null && duration > 0 ? pathSet.size / (duration / 1_000) : null,
    totalTokens: journey.totalTokens.value,
    referenceCount: references.length,
    outputCount: outputs.length,
    linksAdded: summary.linksAdded.value,
    route: summary.route,
    kbIngestUsed: summary.kbIngestUsed,
    confidence: summary.confidence
  };
}

function classifyTier(
  note: NormalizedNote,
  rootByPara: Map<ParaCategory, string>,
  indexNames: Set<string>,
  configuredSpines: Set<string>
): SemanticTier {
  const path = note.path;
  if (isSpineNote(note, rootByPara, configuredSpines)) return "spine";
  const root = rootByPara.get(note.para);
  if (!root) return "content";
  const relative = relativePath(path, root);
  const parts = relative.split("/").filter(Boolean);
  const isIndex = isIndexNote(note, indexNames);
  if (note.para === "common" && isIndex && parts.length === 1) return "kb-root";
  if (isIndex && parts.length === 1) return "para-root";
  if (isIndex && parts.length === 2) return "hub-index";
  if (isIndex) return "local-index";
  return "content";
}

function configuredSpinePaths(options?: StructuredGraphOptions): Set<string> {
  return new Set((options?.spinePaths ?? []).map((path) => normalizePath(path).toLowerCase()));
}

function isSpineNote(
  note: NormalizedNote,
  rootByPara: Map<ParaCategory, string>,
  configuredSpines: Set<string>
): boolean {
  const normalized = normalizePath(note.path);
  if (configuredSpines.has(normalized.toLowerCase())) return true;
  const kind = inferredSpineKind(note.path, note.role);
  if (kind === null) return false;
  if (!normalized.includes("/")) return true;
  const commonRoot = rootByPara.get("common");
  if (!commonRoot || note.para !== "common") return false;
  return relativePath(normalized, commonRoot).split("/").filter(Boolean).length <= 1;
}

function semanticPara(note: NormalizedNote, tier?: SemanticTier): ParaCategory {
  const topLevelSpine = !normalizePath(note.path).includes("/") && inferredSpineKind(note.path, note.role) !== null;
  return tier === "spine" || topLevelSpine ? "common" : note.para;
}

function isConstructionSupportPath(
  path: string,
  noteByPath: Map<string, NormalizedNote>,
  options?: StructuredGraphOptions
): boolean {
  const note = noteByPath.get(path);
  const indexNames = new Set((options?.indexFileNames ?? []).map((name) => basename(normalizePath(name)).toLowerCase()));
  if (note && (isIndexNote(note, indexNames)
    || ["log", "telemetry", "generated", "runtime"].includes(note.role))) return true;
  if (configuredSpinePaths(options).has(normalizePath(path).toLowerCase())) return true;
  if (!note) return !normalizePath(path).includes("/") && inferredSpineKind(path) !== null;
  const roots = new Map((options?.paraRoots ?? []).map((root) => [root.para, trimSlash(normalizePath(root.prefix))]));
  return isSpineNote(note, roots, configuredSpinePaths(options));
}

function clusterFor(
  note: NormalizedNote,
  rootByPara: Map<ParaCategory, string>,
  configuredSpines: Set<string>
): { id: string; label: string } {
  if (isSpineNote(note, rootByPara, configuredSpines)) {
    return { id: "spine", label: "Semantic spine" };
  }
  const root = rootByPara.get(note.para);
  if (!root) return { id: `${note.para}:root`, label: PARA_LABELS[note.para] };
  const parts = relativePath(note.path, root).split("/").filter(Boolean);
  if (parts.length <= 1) return { id: `${note.para}:root`, label: PARA_LABELS[note.para] };
  // The first folder below a PARA root is the only dynamic territory boundary.
  // Deeper paths stay inside that folder/project group, including its hub index.
  return { id: `${note.para}:${parts[0]}`, label: parts[0] ?? PARA_LABELS[note.para] };
}

function positionCommon(
  groups: Map<string, Array<{ note: NormalizedNote; tier: SemanticTier; cluster: { id: string; label: string } }>>,
  positioned: Map<string, { x: number; y: number }>,
  innerRadius: number
): void {
  const commonGroups = [...groups.values()]
    .filter((members) => members[0]?.note.para === "common" && members[0]?.cluster.id !== "spine")
    .sort(byClusterPriority);
  const root = commonGroups.find((members) => members[0]?.cluster.id === "common:root");
  if (root) positionCluster(root, positioned, 0, 0, Math.max(90, innerRadius * 0.13));
  const rest = commonGroups.filter((members) => members !== root);
  for (let index = 0; index < rest.length; index += 1) {
    const group = rest[index];
    if (!group) continue;
    const unit = (index + 1) / Math.max(1, rest.length);
    const radius = innerRadius * (0.27 + 0.58 * Math.sqrt(unit));
    const angle = index * GOLDEN_ANGLE - Math.PI / 2;
    const capacity = Math.max(48, innerRadius * 0.14);
    positionCluster(group, positioned, Math.cos(angle) * radius, Math.sin(angle) * radius, capacity);
  }
}

function positionSector(
  groups: Map<string, Array<{ note: NormalizedNote; tier: SemanticTier; cluster: { id: string; label: string } }>>,
  positioned: Map<string, { x: number; y: number }>,
  para: ParaCategory,
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number
): void {
  const paraGroups = [...groups.values()]
    .filter((members) => members[0]?.note.para === para)
    .sort(byClusterPriority);
  if (paraGroups.length === 0) return;
  const rootGroup = paraGroups.find((members) => members.some((member) => member.tier === "para-root"));
  if (rootGroup) {
    const gateAngle = (startAngle + endAngle) / 2;
    const gateRadius = Math.max(innerRadius + outerRadius * 0.075, outerRadius * 0.34);
    positionCluster(
      rootGroup,
      positioned,
      Math.cos(gateAngle) * gateRadius,
      Math.sin(gateAngle) * gateRadius,
      Math.max(44, outerRadius * 0.025)
    );
  }
  const folderGroups = paraGroups.filter((members) => members !== rootGroup);
  if (folderGroups.length === 0) return;
  const columns = Math.max(1, Math.ceil(Math.sqrt(folderGroups.length * 1.15)));
  const rows = Math.max(1, Math.ceil(folderGroups.length / columns));
  const angleMargin = 0.11;
  const usableAngle = Math.max(0.2, endAngle - startAngle - angleMargin * 2);
  // Keep PARA clusters in a readable outer band. The center remains a quiet
  // Common/core area while every quadrant still has room for local clusters.
  const radialStart = Math.max(innerRadius + outerRadius * 0.08, outerRadius * 0.49);
  const radialSpan = outerRadius * 0.39;
  const radialStep = radialSpan / rows;
  const angularStep = usableAngle / columns;

  for (let index = 0; index < folderGroups.length; index += 1) {
    const group = folderGroups[index];
    if (!group) continue;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const angle = startAngle + angleMargin + angularStep * (column + 0.5) + (row % 2 === 0 ? angularStep * 0.08 : -angularStep * 0.08);
    const radius = radialStart + radialStep * (row + 0.5);
    const arcCapacity = Math.max(52, radius * angularStep * 0.38);
    const radialCapacity = Math.max(52, radialStep * 0.38);
    positionCluster(
      group,
      positioned,
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      Math.min(arcCapacity, radialCapacity)
    );
  }
}

function positionSatellite(
  groups: Map<string, Array<{ note: NormalizedNote; tier: SemanticTier; cluster: { id: string; label: string } }>>,
  positioned: Map<string, { x: number; y: number }>,
  para: ParaCategory,
  angle: number,
  worldRadius: number
): void {
  const members = [...groups.values()].flat().filter((item) => item.note.para === para && item.tier !== "spine");
  if (members.length === 0) return;
  positionCluster(
    members,
    positioned,
    Math.cos(angle) * worldRadius * 1.1,
    Math.sin(angle) * worldRadius * 1.1,
    Math.max(70, worldRadius * 0.08)
  );
}

function positionKnowledgeCore(
  classified: Array<{ note: NormalizedNote; tier: SemanticTier }>,
  positioned: Map<string, { x: number; y: number }>,
  innerRadius: number
): string[] {
  const root = classified.find((item) => item.tier === "kb-root");
  const spine = classified
    .filter((item) => item.tier === "spine")
    .sort((a, b) => spineOrder(a.note.path) - spineOrder(b.note.path) || a.note.path.localeCompare(b.note.path));
  const corePaths: string[] = [];
  if (root) {
    positioned.set(root.note.path, { x: nonZero(0), y: nonZero(0) });
    corePaths.push(root.note.path);
  }
  const orbitRadius = Math.max(180, innerRadius * 0.56);
  for (let index = 0; index < spine.length; index += 1) {
    const item = spine[index];
    if (!item) continue;
    const angle = -Math.PI * 5 / 6 + (index / Math.max(1, spine.length)) * Math.PI * 2;
    positioned.set(item.note.path, {
      x: nonZero(Math.cos(angle) * orbitRadius),
      y: nonZero(Math.sin(angle) * orbitRadius)
    });
    corePaths.push(item.note.path);
  }
  return corePaths;
}

function positionCluster(
  members: Array<{ note: NormalizedNote; tier: SemanticTier }>,
  positioned: Map<string, { x: number; y: number }>,
  centerX: number,
  centerY: number,
  capacity: number
): void {
  const ordered = [...members].sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier) || a.note.path.localeCompare(b.note.path));
  const anchor = ordered[0];
  if (anchor) positioned.set(anchor.note.path, { x: nonZero(centerX), y: nonZero(centerY) });
  const maxRadius = Math.max(24, capacity);
  for (let index = 1; index < ordered.length; index += 1) {
    const item = ordered[index];
    if (!item) continue;
    const fraction = Math.sqrt(index / Math.max(1, ordered.length - 1));
    const radius = maxRadius * (0.16 + fraction * 0.84);
    const angle = index * GOLDEN_ANGLE + stableUnit(item.note.path) * 0.42;
    positioned.set(item.note.path, {
      x: nonZero(centerX + Math.cos(angle) * radius),
      y: nonZero(centerY + Math.sin(angle) * radius)
    });
  }
}

function hierarchyEdges(nodes: readonly StructuredNode[]): HierarchyEdge[] {
  const edges: HierarchyEdge[] = [];
  const root = nodes.find((node) => node.tier === "kb-root");
  const spineNodes = nodes
    .filter((node) => node.tier === "spine")
    .sort((a, b) => spineOrder(a.path) - spineOrder(b.path) || a.path.localeCompare(b.path));
  const memoryNodes = spineNodes.filter((node) => inferredSpineKind(node.path) === "memory");
  const routingNodes = spineNodes.filter((node) => inferredSpineKind(node.path) !== "memory");
  for (let index = 1; index < routingNodes.length; index += 1) {
    const source = routingNodes[index - 1];
    const target = routingNodes[index];
    if (source && target) edges.push(edge(source.path, target.path, "spine"));
  }
  const routeAnchor = routingNodes.at(-1);
  if (routeAnchor && root) edges.push(edge(routeAnchor.path, root.path, "spine"));
  if (root) {
    for (const memory of memoryNodes) edges.push(edge(memory.path, root.path, "spine"));
  }

  const paraRoots = nodes.filter((node) => node.tier === "para-root");
  if (root) {
    for (const paraRoot of paraRoots) edges.push(edge(root.path, paraRoot.path, "hierarchy"));
  }
  for (const node of nodes.filter((item) => item.tier === "hub-index" || item.tier === "local-index")) {
    const candidates = nodes
      .filter((candidate) => candidate.path !== node.path && isIndexTier(candidate.tier) && node.path.startsWith(parentDirectory(candidate.path)))
      .sort((a, b) => b.path.length - a.path.length);
    const parent = candidates[0] ?? paraRoots.find((candidate) => candidate.para === node.para) ?? root;
    if (parent) edges.push(edge(parent.path, node.path, "hierarchy"));
  }
  return uniqueBy(edges, (item) => item.id);
}

function edge(sourcePath: string, targetPath: string, kind: HierarchyEdge["kind"]): HierarchyEdge {
  return {
    id: `${kind}:${sourcePath}->${targetPath}`,
    sourcePath,
    targetPath,
    confidence: "inferred",
    kind
  };
}

function buildAdjacency(dataset: ObservatoryDataset): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const link of dataset.current.links) {
    const source = adjacency.get(link.sourcePath) ?? new Set<string>();
    source.add(link.targetPath);
    adjacency.set(link.sourcePath, source);
    const target = adjacency.get(link.targetPath) ?? new Set<string>();
    target.add(link.sourcePath);
    adjacency.set(link.targetPath, target);
  }
  return adjacency;
}

function maxReachHops(entry: string, targets: Set<string>, adjacency: Map<string, Set<string>>): number | null {
  const queue: Array<{ path: string; hops: number }> = [{ path: entry, hops: 0 }];
  const visited = new Set([entry]);
  let max = targets.has(entry) ? 0 : null;
  while (queue.length > 0 && visited.size <= 5_000) {
    const current = queue.shift();
    if (!current || current.hops >= 12) continue;
    for (const next of adjacency.get(current.path) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      const hops = current.hops + 1;
      if (targets.has(next)) max = Math.max(max ?? 0, hops);
      queue.push({ path: next, hops });
    }
  }
  return max;
}

function compressedDurations(values: Array<number | null>): number[] {
  const logs = values.filter((value): value is number => value !== null && value >= 0).map((value) => Math.log1p(value));
  if (logs.length === 0) return values.map(() => 420);
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  if (max - min < 0.001) return values.map((value) => value === null ? 420 : 520);
  return values.map((value) => {
    if (value === null) return 420;
    const normalized = (Math.log1p(Math.max(0, value)) - min) / (max - min);
    return Math.round(240 + normalized * 960);
  });
}

function selectGuidePath(
  noteByPath: Map<string, NormalizedNote>,
  options?: StructuredGraphOptions,
  model?: StructuredGraphModel
): string | null {
  for (const configured of options?.spinePaths ?? []) {
    const resolved = resolvePath(configured, noteByPath);
    if (resolved) return resolved;
  }
  const rootByPara = new Map((options?.paraRoots ?? []).map((root) => [root.para, trimSlash(normalizePath(root.prefix))]));
  const configured = configuredSpinePaths(options);
  const modeledSpines = new Set((model?.nodes ?? [])
    .filter((node) => node.tier === "spine")
    .map((node) => node.path));
  return [...noteByPath.values()]
    .filter((note) => modeledSpines.has(note.path) || isSpineNote(note, rootByPara, configured))
    .sort((a, b) => guidePriority(a.path) - guidePriority(b.path) || a.path.localeCompare(b.path))[0]?.path
    ?? null;
}

function selectKnowledgeRootPath(
  noteByPath: Map<string, NormalizedNote>,
  options?: StructuredGraphOptions
): string | null {
  const indexNames = new Set((options?.indexFileNames ?? []).map((name) => basename(normalizePath(name)).toLowerCase()));
  const configuredCommonRoot = options?.paraRoots
    .find((root) => root.para === "common")?.prefix;
  const commonRoot = configuredCommonRoot ? trimSlash(normalizePath(configuredCommonRoot)) : null;
  const indexes = [...noteByPath.values()].filter((note) => isIndexNote(note, indexNames));
  const directConfigured = commonRoot
    ? indexes.filter((note) => parentDirectory(note.path) === `${commonRoot}/`)
    : [];
  const commonIndexes = indexes.filter((note) => note.para === "common");
  const candidates = directConfigured.length > 0 ? directConfigured : commonIndexes.length > 0 ? commonIndexes : indexes;
  return candidates
    .sort((a, b) => pathDepth(a.path) - pathDepth(b.path) || a.path.localeCompare(b.path))[0]?.path
    ?? null;
}

function isInboxOrigin(path: string, options?: StructuredGraphOptions): boolean {
  const normalized = normalizePath(path).replace(/^\/+/, "").toLowerCase();
  const configuredPrefixes = (options?.paraRoots ?? [])
    .filter((root) => root.para === "inbox")
    .map((root) => trimSlash(normalizePath(root.prefix)).toLowerCase());
  if (configuredPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) return true;
  const firstSegment = normalized.split("/")[0]?.replace(/[\s_-]+/g, "") ?? "";
  return ["inbox", "intake", "capture", "unsorted", "incoming"].includes(firstSegment);
}

function guidePriority(path: string): number {
  const kind = inferredSpineKind(path);
  if (kind === "guide") return 0;
  if (kind === "directive") return 1;
  if (kind === "schema") return 2;
  if (kind === "memory") return 3;
  return 4;
}

function resolvePath(path: string, noteByPath: Map<string, NormalizedNote>): string | null {
  const normalized = normalizePath(path).replace(/^\/+/, "");
  if (noteByPath.has(normalized)) return normalized;
  const withExtension = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
  if (noteByPath.has(withExtension)) return withExtension;
  const stem = basename(withExtension).replace(/\.md$/i, "").toLowerCase();
  const matches = [...noteByPath.keys()].filter((candidate) => basename(candidate).replace(/\.md$/i, "").toLowerCase() === stem);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function queryLabel(journey: QueryJourney): string {
  const when = journey.startedAt ? journey.startedAt.slice(0, 16).replace("T", " ") : "undated";
  const duration = journey.durationMs.value === null
    ? journey.completed ? "time not captured" : "not finalized"
    : `${formatDuration(journey.durationMs.value)}`;
  return `${when} · ${journey.documentsReadCount.value ?? journey.documentsReadPaths.length} docs · ${duration}`;
}

function isExplicitQueryJourney(journey: QueryJourney): boolean {
  return journey.buildSummary === null && journey.events.some((event) => event.kind === "QuerySummary");
}

function distributeDuration(total: number, count: number): number[] {
  if (count <= 0) return [];
  return distributeWeightedDuration(total, Array.from({ length: count }, (_, index) => index + 2));
}

function distributeWeightedDuration(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const safeWeights = weights.map((weight) => Math.max(1, weight));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) return Math.max(1, total - allocated);
    const value = Math.max(1, Math.round((total * weight) / weightTotal));
    allocated += value;
    return value;
  });
}

function semanticLabel(path: string, fallback: string, tier: SemanticTier): string {
  if (tier === "kb-root") return "Knowledge Base Index";
  if (tier !== "spine") return fallback;
  const stem = basename(path).replace(/\.md$/i, "").toLowerCase();
  if (stem === "agents" || stem === "agent") return "Agent Guide";
  if (stem === "claude") return "KB Guide";
  const kind = inferredSpineKind(path);
  if (kind === "memory") return "Activity Memory";
  if (kind === "schema") return "Knowledge Schema";
  if (kind === "guide") return "Knowledge Guide";
  return fallback;
}

function byClusterPriority(
  a: Array<{ note: NormalizedNote; tier: SemanticTier; cluster: { id: string } }>,
  b: Array<{ note: NormalizedNote; tier: SemanticTier; cluster: { id: string } }>
): number {
  const aRoot = a.some((item) => item.tier === "kb-root" || item.tier === "para-root") ? 0 : 1;
  const bRoot = b.some((item) => item.tier === "kb-root" || item.tier === "para-root") ? 0 : 1;
  return aRoot - bRoot || b.length - a.length || (a[0]?.cluster.id ?? "").localeCompare(b[0]?.cluster.id ?? "");
}

function takeDiverseClusters(nodes: readonly StructuredNode[], limit: number): StructuredNode[] {
  const byCluster = new Map<string, StructuredNode[]>();
  for (const node of nodes) {
    const members = byCluster.get(node.clusterId) ?? [];
    members.push(node);
    byCluster.set(node.clusterId, members);
  }
  const groups = [...byCluster.entries()]
    .sort(([a], [b]) => stableUnit(`cluster:${a}`) - stableUnit(`cluster:${b}`))
    .map(([, members]) => members.sort((a, b) => stableUnit(`member:${a.path}`) - stableUnit(`member:${b.path}`)));
  const selected: StructuredNode[] = [];
  let round = 0;
  while (selected.length < limit && groups.some((members) => round < members.length)) {
    for (const members of groups) {
      const node = members[round];
      if (node) selected.push(node);
      if (selected.length >= limit) break;
    }
    round += 1;
  }
  return selected;
}

function takeBalancedParaCandidates(
  nodes: readonly StructuredNode[],
  limit: number,
  seed: string
): StructuredNode[] {
  const paraOrder: ParaCategory[] = ["projects", "areas", "resources", "archive"];
  const groups = paraOrder
    .map((para) => {
      const diverse = takeDiverseClusters(nodes.filter((node) => node.para === para), nodes.length);
      const offset = diverse.length > 0 ? Math.floor(stableUnit(`${seed}:${para}`) * diverse.length) : 0;
      return { para, nodes: [...diverse.slice(offset), ...diverse.slice(0, offset)] };
    })
    .filter((group) => group.nodes.length > 0);
  const selected: StructuredNode[] = [];
  let round = 0;
  while (selected.length < limit && groups.some((group) => round < group.nodes.length)) {
    for (const group of groups) {
      const node = group.nodes[round];
      if (node) selected.push(node);
      if (selected.length >= limit) break;
    }
    round += 1;
  }
  return selected;
}

function tierOrder(tier: SemanticTier): number {
  return ["kb-root", "para-root", "hub-index", "local-index", "spine", "content"].indexOf(tier);
}

function isIndexTier(tier: SemanticTier): boolean {
  return tier === "kb-root" || tier === "para-root" || tier === "hub-index" || tier === "local-index";
}

function spineOrder(path: string): number {
  const kind = inferredSpineKind(path);
  if (kind === "directive") return 0;
  if (kind === "guide") return 1;
  if (kind === "schema") return 2;
  if (kind === "memory") return 3;
  return 4;
}

type InferredSpineKind = "directive" | "guide" | "schema" | "memory";

function inferredSpineKind(path: string, role?: NormalizedNote["role"]): InferredSpineKind | null {
  if (role === "log") return "memory";
  const stem = basename(normalizePath(path)).replace(/\.md$/i, "").toLowerCase();
  const words = stem.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const has = (...values: string[]): boolean => values.some((value) => words.includes(value) || stem === value);
  if (has("memory", "memories", "log", "activity") || /메모리|기억|활동.?로그/u.test(stem)) return "memory";
  if (has("schema", "ontology", "taxonomy") || /스키마|온톨로지|분류체계/u.test(stem)) return "schema";
  if (has("claude") || ((has("knowledge", "kb", "wiki")) && has("guide", "handbook"))) return "guide";
  if (has("agent", "agents", "guide", "guides", "instruction", "instructions", "rules", "readme", "handbook", "manifest")
    || /가이드|지침|규칙|안내/u.test(stem)) return "directive";
  return null;
}

function isIndexNote(note: NormalizedNote, indexNames: Set<string>): boolean {
  return note.role === "index" || indexNames.has(basename(normalizePath(note.path)).toLowerCase());
}

function relativePath(path: string, root: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function parentDirectory(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.length > 0 ? `${parts.join("/")}/` : "";
}

function fallbackPosition(id: string, radius: number): { x: number; y: number } {
  const angle = stableUnit(id) * Math.PI * 2;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function pairKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function isConstructionContent(note: NormalizedNote): boolean {
  if (note.role !== "content") return false;
  if (!["common", "projects", "areas", "resources", "archive"].includes(note.para)) return false;
  const folderTokens = normalizePath(note.path)
    .split("/")
    .slice(0, -1)
    .map((part) => part.toLowerCase().replace(/[\s-]+/g, "_"));
  return !folderTokens.some((folder) => [
    "daily",
    "dailies",
    "weekly",
    "weeklies",
    "journal",
    "journals",
    "periodic"
  ].includes(folder));
}

function expectedIndexFor(
  note: NormalizedNote,
  rootByPara: Map<ParaCategory, string>,
  noteByPath: Map<string, NormalizedNote>,
  indexNames: Set<string>
): string | null {
  const root = rootByPara.get(note.para);
  if (!root) return null;
  return [...noteByPath.values()]
    .filter((candidate) => candidate.path !== note.path
      && candidate.para === note.para
      && isIndexNote(candidate, indexNames)
      && candidate.path.startsWith(`${root}/`)
      && note.path.startsWith(parentDirectory(candidate.path)))
    .sort((a, b) => parentDirectory(b.path).length - parentDirectory(a.path).length
      || a.path.localeCompare(b.path))[0]?.path
    ?? null;
}

function pathDepth(path: string): number {
  return normalizePath(path).split("/").filter(Boolean).length;
}

function timeInRange(value: number | null, from: string | null, to: string | null): boolean {
  if (value === null) return from === null && to === null;
  const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  return value >= fromMs && value <= toMs;
}

function inRange(value: string | null, from: string | null, to: string | null): boolean {
  if (!value) return from === null && to === null;
  const valueMs = Date.parse(value);
  if (!Number.isFinite(valueMs)) return false;
  const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
  const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(fromMs) && valueMs < fromMs) return false;
  if (Number.isFinite(toMs) && valueMs > toMs) return false;
  return true;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

function maxNullable(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0 ? Math.max(...available) : null;
}

function nullableSum(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function nonZero(value: number): number {
  return Math.abs(value) < 0.001 ? 0.001 : value;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function groupBy<T, K>(values: readonly T[], keyOf: (value: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = result.get(key) ?? [];
    group.push(value);
    result.set(key, group);
  }
  return result;
}

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
