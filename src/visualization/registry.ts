import {
  compareNullableTimestamps,
  type Confidence,
  type NormalizedLink,
  type NormalizedNote,
  type ParaCategory,
  type QueryJourney,
  type SnapshotDiff
} from "../model";
import type {
  DataCapability,
  FlowConnection,
  FlowScene,
  FlowStage,
  GraphEdge,
  GraphNode,
  GraphScene,
  InspectorModel,
  LegendItem,
  LensDefinition,
  LensFamily,
  MatrixCell,
  MatrixScene,
  MetricDatum,
  MotionContract,
  ObservatoryDataset,
  RadialScene,
  RadialSegment,
  ScatterPoint,
  ScatterScene,
  ScenePrimitive,
  TimelineScene,
  TimelineSeries,
  ViewState,
  VisualScene
} from "./types";

const PARA_ORDER: ParaCategory[] = ["common", "projects", "areas", "resources", "archive", "inbox", "unknown"];
const CORE_PARA: ParaCategory[] = ["common", "projects", "areas", "resources", "archive"];
const PARA_LABELS: Record<ParaCategory, string> = {
  common: "Common",
  projects: "Projects",
  areas: "Areas",
  resources: "Resources",
  archive: "Archive",
  inbox: "Inbox",
  unknown: "Unknown"
};

const PARA_COLORS: Record<ParaCategory, string> = {
  common: "para-common",
  projects: "para-projects",
  areas: "para-areas",
  resources: "para-resources",
  archive: "para-archive",
  inbox: "para-inbox",
  unknown: "para-unknown"
};

interface LensSpec {
  id: string;
  title: string;
  family: LensFamily;
  primitive: ScenePrimitive;
  question: string;
  requires: DataCapability[];
  motionTrigger: MotionContract["trigger"];
  motionEffect: MotionContract["keyframes"][number]["effect"];
  primaryAction: InspectorModel["actions"][number];
  description: string;
}

const SPECS: LensSpec[] = [
  spec("L01", "PARA Brain Regions", "structure", "radial", "지금 second brain의 어느 영역이 활성화되어 있는가?", ["vault-notes", "vault-links", "para"], "replay", "bloom", "open-note", "영역별 activation, note count, retrieval, link density를 방사형 영역으로 본다."),
  spec("L02", "Index Activation", "structure", "graph", "어떤 Index가 실제 진입점 역할을 하는가?", ["vault-notes", "vault-links", "indexes"], "replay", "trace", "open-note", "index hub와 1-2 hop reach, query entry를 비교한다."),
  spec("L03", "Index Coverage Halo", "structure", "radial", "Index가 자기 영역의 문서를 얼마나 덮고 있는가?", ["vault-notes", "vault-links", "indexes"], "selection", "pulse", "open-note", "index coverage arc와 uncovered satellites를 표시한다."),
  spec("L04", "Cross-PARA Knowledge Flow", "structure", "flow", "지식이 어느 영역 사이에서 이동·재사용되는가?", ["vault-notes", "vault-links", "para"], "filter", "trace", "open-note", "PARA 사이의 link와 retrieval transition 흐름을 본다."),
  spec("L05", "Structural Pressure Map", "structure", "graph", "중요하지만 과부하·고립·낡은 note는 무엇인가?", ["vault-notes", "vault-links", "file-stats"], "filter", "morph", "open-note", "retrieval, size, stale/orphan risk를 안정된 graph 위에 얹는다."),
  spec("L06", "Recall Path Replay", "recall", "graph", "이 질의는 무엇을 어떤 순서로 회상했는가?", ["query-aggregate", "query-steps", "query-paths"], "replay", "trace", "replay", "query, tool, index, content, log node를 실제 event 순서로 재생한다."),
  spec("L07", "Retrieval Funnel", "recall", "flow", "후보 탐색에서 실제 읽은 문서까지 얼마나 좁혀졌는가?", ["query-aggregate", "query-paths"], "replay", "bloom", "replay", "search, candidate, context/read, answer 단계의 축소를 본다."),
  spec("L08", "Query Constellation", "recall", "scatter", "비슷한 사용 패턴의 질의가 어떤 군집을 이루는가?", ["query-aggregate", "query-paths"], "filter", "drift", "compare", "query를 문서 overlap, PARA mix, latency, token signature로 배치한다."),
  spec("L09", "Tool & Source Flow", "recall", "flow", "어떤 도구와 source가 질의 비용을 만드는가?", ["query-aggregate", "tool-usage"], "filter", "trace", "open-source", "query에서 tool class와 source role로 비용 흐름을 분해한다."),
  spec("L10", "Recall Temperature", "recall", "matrix", "자주 회상되는 note와 특정 상황에서만 깨어나는 note는 무엇인가?", ["query-aggregate", "query-paths"], "filter", "crossfade", "open-note", "note별 retrieval frequency, recency, distinct contexts를 heat로 본다."),
  spec("L11", "Link Plasticity Diff", "evolution", "graph", "두 snapshot 사이 어떤 연결이 생기고 사라졌는가?", ["snapshots"], "compare", "morph", "compare", "added, removed, unchanged link를 diff 상태로 표시한다."),
  spec("L12", "Vault Growth Rings", "evolution", "radial", "볼트는 어느 영역에서 어떤 속도로 성장했는가?", ["snapshot-history", "para"], "compare", "bloom", "compare", "snapshot별 note, bytes, links 성장을 ring으로 보여준다."),
  spec("L13", "Orphan Drift", "evolution", "graph", "새 note가 시간이 지나며 연결되는가, 계속 떠도는가?", ["vault-notes", "vault-links"], "compare", "drift", "open-note", "inbound/outbound 없는 note와 snapshot attachment 변화를 표시한다."),
  spec("L14", "Knowledge Migration", "evolution", "flow", "PARA lifecycle에서 지식이 어떻게 환류되는가?", ["snapshot-history", "para"], "compare", "trace", "compare", "snapshot path transition과 PARA 이동 lane을 본다."),
  spec("L15", "Change Rhythm", "evolution", "timeline", "활동이 꾸준한가, 특정 날에 폭발하는가?", ["file-times"], "filter", "pulse", "open-source", "created/modified, link delta, query count를 시간 pulse로 본다."),
  spec("L16", "Project Pulse", "para", "timeline", "어떤 Project가 목표 지향적으로 활성화되고 정체되는가?", ["vault-notes", "para", "query-aggregate"], "filter", "pulse", "open-note", "project hub의 recency, retrieval, link delta, active document ratio를 본다."),
  spec("L17", "Area Sustenance", "para", "timeline", "책임 영역이 일회성이 아니라 반복 관리되고 있는가?", ["vault-notes", "para", "file-times"], "filter", "trace", "open-note", "Area별 active weeks, recurrence, distinct documents를 continuity band로 본다."),
  spec("L18", "Resource Reuse", "para", "graph", "어떤 Resource가 여러 프로젝트와 질문에서 재사용되는가?", ["vault-notes", "vault-links", "query-aggregate"], "selection", "bloom", "open-note", "resource hub와 project/query orbit으로 reuse context를 표시한다."),
  spec("L19", "Archive Dormancy & Reactivation", "para", "radial", "Archive가 조용히 보존되면서 필요할 때 정확히 깨어나는가?", ["vault-notes", "para", "query-aggregate"], "selection", "pulse", "open-note", "archive field와 선택적 reactivation flare를 분리한다."),
  spec("L20", "Common Routing Core", "para", "flow", "Common이 hub-of-hubs로 기능하는가, 병목인가?", ["vault-notes", "vault-links", "query-aggregate"], "replay", "trace", "open-note", "Common entry, route diversity, outbound spokes를 본다."),
  spec("L21", "Latency River", "efficiency", "timeline", "질의 시간이 언제, 어떤 경로에서 늘어나는가?", ["query-aggregate", "query-timing"], "filter", "bloom", "replay", "elapsed p50/p90와 outlier query band를 시간축 river로 본다."),
  spec("L22", "Token & Context Heat", "efficiency", "matrix", "어떤 질의·문서·영역이 context 비용을 만든다고 관측되는가?", ["query-aggregate", "query-tokens"], "filter", "crossfade", "open-source", "measured tokens와 estimated bytes를 분리한 heat matrix다."),
  spec("L23", "Efficiency Frontier", "efficiency", "scatter", "많은 문서를 읽는 것이 실제로 더 느리고 비싼가?", ["query-aggregate", "query-timing"], "compare", "morph", "compare", "documents read, elapsed, token size의 Pareto frontier를 본다."),
  spec("L24", "Document Burden", "efficiency", "matrix", "어떤 문서가 반복적으로 읽히면서 비용과 시간을 누적시키는가?", ["query-aggregate", "query-paths"], "replay", "bloom", "open-note", "문서별 retrieval count와 associated elapsed/token share를 누적한다.")
];

export const OBSERVATORY_LENSES: LensDefinition[] = SPECS.map((lens) => ({
  id: lens.id,
  title: lens.title,
  family: lens.family,
  question: lens.question,
  primitive: lens.primitive,
  requires: lens.requires,
  motion: motion(lens.motionTrigger, lens.motionEffect),
  inspector: {
    description: lens.description,
    primaryAction: lens.primaryAction
  },
  buildModel: (dataset, state) => buildLens(lens, dataset, state)
}));

export function getLens(id: string): LensDefinition | null {
  return OBSERVATORY_LENSES.find((lens) => lens.id === id) ?? null;
}

function buildLens(lens: LensSpec, dataset: ObservatoryDataset, state: ViewState): VisualScene {
  const missing = missingCapabilities(dataset, lens.requires);
  if (missing.length > 0) return unavailableScene(lens, dataset, missing);
  const ctx = context(dataset, state);
  switch (lens.id) {
    case "L01": return paraBrainRegions(lens, dataset, ctx);
    case "L02": return indexActivation(lens, dataset, ctx, state.indexDepth);
    case "L03": return indexCoverageHalo(lens, dataset, ctx, state.indexDepth);
    case "L04": return crossParaFlow(lens, dataset, ctx);
    case "L05": return structuralPressure(lens, dataset, ctx);
    case "L06": return recallPath(lens, dataset, ctx);
    case "L07": return retrievalFunnel(lens, dataset, ctx);
    case "L08": return queryConstellation(lens, dataset, ctx);
    case "L09": return toolSourceFlow(lens, dataset, ctx);
    case "L10": return recallTemperature(lens, dataset, ctx);
    case "L11": return linkPlasticity(lens, dataset, ctx);
    case "L12": return growthRings(lens, dataset);
    case "L13": return orphanDrift(lens, dataset, ctx);
    case "L14": return knowledgeMigration(lens, dataset);
    case "L15": return changeRhythm(lens, dataset, ctx);
    case "L16": return projectPulse(lens, dataset, ctx);
    case "L17": return areaSustenance(lens, dataset, ctx);
    case "L18": return resourceReuse(lens, dataset, ctx);
    case "L19": return archiveReactivation(lens, dataset, ctx);
    case "L20": return commonRoutingCore(lens, dataset, ctx);
    case "L21": return latencyRiver(lens, dataset, ctx);
    case "L22": return tokenHeat(lens, dataset, ctx);
    case "L23": return efficiencyFrontier(lens, dataset, ctx);
    case "L24": return documentBurden(lens, dataset, ctx);
    default: return unavailableScene(lens, dataset, []);
  }
}

interface Context {
  notes: NormalizedNote[];
  links: NormalizedLink[];
  journeys: QueryJourney[];
  selectedJourney: QueryJourney | null;
  latestDiff: SnapshotDiff | null;
  byId: Map<string, NormalizedNote>;
  byPath: Map<string, NormalizedNote>;
  inbound: Map<string, NormalizedLink[]>;
  outbound: Map<string, NormalizedLink[]>;
  retrievals: Map<string, QueryJourney[]>;
}

function context(dataset: ObservatoryDataset, state: ViewState): Context {
  const paraScope = state.paraScope.length > 0 ? new Set(state.paraScope) : null;
  const notes = dataset.current.notes
    .filter((note) => !paraScope || paraScope.has(note.para))
    .sort(byNotePath);
  const visibleIds = new Set(notes.map((note) => note.id));
  const links = dataset.current.links
    .filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const journeys = dataset.journeys
    .filter((journey) => journey.buildSummary === null && journey.events.some((event) => event.kind === "QuerySummary"))
    .filter((journey) => inRange(journey.startedAt ?? journey.endedAt, state.from, state.to))
    .filter((journey) => state.selectedQueryId === null || journey.queryId === state.selectedQueryId)
    .sort((a, b) => compareNullableTimestamps(a.startedAt, b.startedAt) || a.queryId.localeCompare(b.queryId));
  const byId = new Map(notes.map((note) => [note.id, note]));
  const byPath = new Map(notes.map((note) => [note.path, note]));
  const inbound = groupLinks(links, "targetId");
  const outbound = groupLinks(links, "sourceId");
  const retrievals = new Map<string, QueryJourney[]>();
  for (const journey of journeys) {
    for (const path of unique(journey.documentsReadPaths.length ? journey.documentsReadPaths : journey.accessedPaths)) {
      const note = byPath.get(path);
      if (!note) continue;
      const found = retrievals.get(note.id) ?? [];
      found.push(journey);
      retrievals.set(note.id, found);
    }
  }
  return {
    notes,
    links,
    journeys,
    selectedJourney: state.selectedQueryId ? journeys[0] ?? null : journeys.at(-1) ?? null,
    latestDiff: selectDiff(dataset, state),
    byId,
    byPath,
    inbound,
    outbound,
    retrievals
  };
}

function paraBrainRegions(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): RadialScene {
  const activations = CORE_PARA.map((para) => ({ para, activation: activation(para, ctx) }));
  const segments = activations.map(({ para, activation: value }) =>
    segment(para, PARA_LABELS[para], value.score, value.confidence)
  );
  const hasUnavailableComponent = activations.some(({ activation: value }) =>
    value.components.some((component) => component.value === null)
  );
  const scene = radial(lens, dataset, hasUnavailableComponent ? "partial" : "ready", "PARA activation keeps the PRD weights fixed; unavailable components contribute no points and are never silently reweighted.", [
    ...activations.map(({ para, activation: value }) =>
      metric(
        `activation-${para}`,
        `${PARA_LABELS[para]} activation`,
        value.score,
        "/100",
        value.confidence,
        value.components.map((component) => `${component.label}=${component.value ?? "unavailable"}×${component.weight}%`).join("; ")
      )
    ),
    metric("note-count", "Visible notes", ctx.notes.length, "notes", "measured", "current snapshot", ctx.notes.length),
    metric("retrieved-notes", "Retrieved notes", ctx.retrievals.size, "notes", confidenceFor(ctx.journeys.length), "query journeys", ctx.journeys.length),
    metric("resolved-links", "Resolved links", ctx.links.filter((link) => link.resolved).length, "links", "measured", "current metadata", ctx.links.length)
  ], segments, topNotes(ctx, 15).map(nodeFromNote), [{ id: "activation", label: "Activation", value: average(segments.map((item) => item.value)), confidence: "inferred" }]);
  scene.missingCapabilities = unique([
    ...scene.missingCapabilities,
    ...(ctx.journeys.length > 0 ? [] : ["query-aggregate" as DataCapability]),
    ...(ctx.latestDiff ? [] : ["snapshot-history" as DataCapability])
  ]);
  return scene;
}

function indexActivation(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context, requestedDepth: number): GraphScene {
  const allIndexes = ctx.notes.filter((note) => note.role === "index");
  if (allIndexes.length === 0) return unavailableScene(lens, dataset, ["indexes"]) as GraphScene;
  const depth = clamp(Math.round(requestedDepth), 1, 4);
  const rankedIndexes = allIndexes
    .map((note) => ({ note, reach: reachable(ctx, note, depth, 100).length }))
    .sort((a, b) => b.reach - a.reach || byNotePath(a.note, b.note))
    .slice(0, 14);
  const indexes = rankedIndexes.map((item) => item.note);
  const indexIds = new Set(indexes.map((note) => note.id));
  const satelliteMap = new Map<string, NormalizedNote>();
  for (const index of indexes) {
    for (const child of reachable(ctx, index, depth, 5)) {
      if (!indexIds.has(child.id)) satelliteMap.set(child.id, child);
    }
  }
  const satellites = [...satelliteMap.values()]
    .sort((a, b) => stableUnit(a.id) - stableUnit(b.id) || byNotePath(a, b))
    .slice(0, 42);
  const indexNodes = rankedIndexes.map(({ note, reach }, index) => placedNode(note, index, indexes.length, 0.23, 4 + reach));
  const satelliteNodes = satellites.map((note) => {
    const angle = stableUnit(note.id) * Math.PI * 2;
    const radius = 0.39 + stableUnit(`${note.id}:orbit`) * 0.055;
    return {
      ...nodeFromNote(note),
      value: 1,
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.5 + Math.sin(angle) * radius
    };
  });
  const deduped = [...indexNodes, ...satelliteNodes];
  const visibleIds = new Set(deduped.map((node) => node.id));
  const edges = ctx.links
    .filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId) && (indexIds.has(link.sourceId) || indexIds.has(link.targetId)))
    .slice(0, 80)
    .map(edgeFromLink);
  return graph(lens, dataset, "ready", `Index hubs are sized by measured reach through ${depth} hop(s) plus query entry evidence.`, [
    ...metricsForGraph(ctx),
    metric("index-depth", "Index depth", depth, "hops", "measured", "view state"),
    metric("visible-indexes", "Active index hubs", indexes.length, "indexes", "measured", "ranked by reachable notes", allIndexes.length)
  ], deduped, edges);
}

function indexCoverageHalo(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context, requestedDepth: number): RadialScene {
  const indexes = ctx.notes.filter((note) => note.role === "index");
  if (indexes.length === 0) return unavailableScene(lens, dataset, ["indexes"]) as RadialScene;
  const depth = clamp(Math.round(requestedDepth), 1, 4);
  const covered = new Set(indexes.flatMap((index) => [index.id, ...reachable(ctx, index, depth, Number.MAX_SAFE_INTEGER).map((note) => note.id)]));
  const segments = PARA_ORDER.filter((para) => ctx.notes.some((note) => note.para === para)).map((para) => {
    const paraNotes = ctx.notes.filter((note) => note.para === para);
    const ratio = paraNotes.length === 0 ? 0 : (paraNotes.filter((note) => covered.has(note.id)).length / paraNotes.length) * 100;
    return segment(para, PARA_LABELS[para], ratio, "measured");
  });
  const uncovered = ctx.notes.filter((note) => !covered.has(note.id)).slice(0, 24).map(nodeFromNote);
  return radial(lens, dataset, "ready", "Coverage halos show direct and downstream reach from index files.", [
    metric("coverage", "Covered notes", covered.size, "notes", "measured", "link graph", ctx.notes.length),
    metric("uncovered", "Uncovered notes", uncovered.length, "notes", "measured", "link graph", ctx.notes.length)
  ], segments, uncovered, [{ id: "depth", label: "Index depth", value: depth, confidence: "measured" }]);
}

function crossParaFlow(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): FlowScene {
  const stages = CORE_PARA.map((para, index) => stage(para, PARA_LABELS[para], index, ctx.notes.filter((note) => note.para === para).length, "measured"));
  const values = new Map<string, number>();
  for (const link of ctx.links) {
    const source = ctx.byId.get(link.sourceId);
    const target = ctx.byId.get(link.targetId);
    if (!source || !target || source.para === target.para) continue;
    const id = `${source.para}->${target.para}`;
    values.set(id, (values.get(id) ?? 0) + 1);
  }
  const connections = [...values.entries()].sort(byEntry).map(([id, value]) => {
    const [source, target] = id.split("->") as [string, string];
    return connection(id, source, target, value, "measured");
  });
  return flow(lens, dataset, connections.length ? "ready" : "partial", "Ribbons combine measured cross-PARA links with retrieval transitions when available.", metricsForGraph(ctx), stages, connections);
}

function structuralPressure(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): GraphScene {
  const ranked = ctx.notes.map((note) => ({ note, score: pressureScore(note, ctx) })).sort((a, b) => b.score - a.score || byNotePath(a.note, b.note)).slice(0, 80);
  const ids = new Set(ranked.map((item) => item.note.id));
  return graph(lens, dataset, "ready", "Pressure combines retrieval count, size, orphan state, and stale modified time.", [
    metric("pressure-candidates", "Pressure candidates", ranked.length, "notes", "inferred", "current metadata + query journeys", ranked.length)
  ], ranked.map((item, index) => placedNode(item.note, index, ranked.length, 0.7, item.score)), ctx.links.filter((link) => ids.has(link.sourceId) && ids.has(link.targetId)).slice(0, 120).map(edgeFromLink));
}

function recallPath(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): GraphScene {
  const journey = ctx.selectedJourney;
  if (!journey) return unavailableScene(lens, dataset, ["query-steps"]) as GraphScene;
  const queryNode: GraphNode = { id: `query:${journey.queryId}`, label: "Selected query", group: "query", role: "query", value: 1, confidence: "measured", x: 0.08, y: 0.5, colorKey: "query" };
  const stepNodes = journey.steps.flatMap((step, index) => {
    const x = 0.2 + (index / Math.max(1, journey.steps.length - 1)) * 0.68;
    const tool: GraphNode = { id: `tool:${step.eventId}`, label: step.toolName ?? "tool", group: "tool", role: "tool", value: 1, confidence: "measured", x, y: 0.32, colorKey: "tool" };
    return [
      tool,
      ...step.paths.map((path, pathIndex) =>
        nodeForPath(
          ctx,
          path,
          `path:${step.eventId}:${pathIndex}`,
          x,
          0.54 + (pathIndex / Math.max(1, step.paths.length - 1)) * 0.34
        )
      )
    ];
  });
  const orderedNodes = uniqueNodesInOrder([queryNode, ...stepNodes]);
  const edges = orderedNodes.slice(1).map((node, index) => ({ id: `seq:${index}`, source: orderedNodes[index]?.id ?? queryNode.id, target: node.id, value: index + 1, confidence: "measured" as Confidence, directed: true, order: index, state: "focus" as const, colorKey: "sequence" }));
  return graph(lens, dataset, "ready", "Recall path is ordered from sanitized telemetry event paths, without prompt text.", queryMetrics(journey), orderedNodes, edges);
}

function retrievalFunnel(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): FlowScene {
  const journey = ctx.selectedJourney;
  if (!journey) return unavailableScene(lens, dataset, ["query-paths"]) as FlowScene;
  const stepPathCount = unique(journey.steps.flatMap((step) => step.paths)).length;
  const readCount = journey.documentsReadCount.value ?? journey.documentsReadPaths.length;
  const stages = [
    stage("search", "Search", 0, Math.max(journey.searchStepCount.value ?? journey.steps.length, 0), journey.searchStepCount.confidence),
    stage("candidate", "Candidate", 1, Math.max(stepPathCount, readCount), "inferred"),
    stage("read", "Context/read", 2, readCount, journey.documentsReadCount.confidence),
    stage("answer", "Answer", 3, journey.completed ? 1 : 0, journey.completionConfidence)
  ];
  return flow(lens, dataset, "ready", "Funnel width is derived from search steps, unique path candidates, and QuerySummary read count.", queryMetrics(journey), stages, adjacentConnections(stages));
}

function queryConstellation(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): ScatterScene {
  if (ctx.journeys.length === 0) return unavailableScene(lens, dataset, ["query-aggregate"]) as ScatterScene;
  const points = ctx.journeys.map((journey, index) => {
    const position = constellationPosition(journey);
    return scatterPoint(
      `q:${journey.queryId}`,
      `Query ${index + 1}`,
      position.x,
      position.y,
      (journey.documentsReadCount.value ?? journey.documentsReadPaths.length) || 1,
      paraMix(journey, ctx),
      journey.documentsReadPaths.length > 0 ? journey.documentsReadCount.confidence : "inferred"
    );
  });
  return scatter(lens, dataset, "ready", "Queries sharing document and tool signatures occupy nearby stable coordinates; point size shows retrieval breadth rather than cost.", aggregateQueryMetrics(ctx.journeys), "Document-signature axis", "Tool/route-signature axis", points);
}

function toolSourceFlow(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): FlowScene {
  if (ctx.journeys.length === 0) return unavailableScene(lens, dataset, ["query-aggregate"]) as FlowScene;
  const toolCounts = countBy(ctx.journeys.flatMap((j) => j.tools.length ? j.tools : ["unknown"]));
  const roleCounts = countBy(ctx.journeys.flatMap((j) => j.accessedPaths.map((path) => ctx.byPath.get(path)?.role ?? "external")));
  const toolRoleCounts = new Map<string, number>();
  for (const journey of ctx.journeys) {
    const tools = journey.tools.length ? journey.tools : ["unknown"];
    const roles = unique(journey.accessedPaths.map((path) => ctx.byPath.get(path)?.role ?? "external"));
    for (const tool of tools) {
      for (const role of roles.length ? roles : ["external"]) {
        const id = `${tool}\u0000${role}`;
        toolRoleCounts.set(id, (toolRoleCounts.get(id) ?? 0) + 1);
      }
    }
  }
  const stages = [
    stage("query", "Queries", 0, ctx.journeys.length, "measured"),
    ...[...toolCounts.entries()].sort(byEntry).map(([tool, count]) => stage(`tool:${tool}`, tool, 1, count, "measured")),
    ...[...roleCounts.entries()].sort(byEntry).map(([role, count]) => stage(`source:${role}`, role, 2, count, "inferred"))
  ];
  const connections = [
    ...[...toolCounts.entries()].sort(byEntry).map(([tool, count]) =>
      connection(`query->tool:${tool}`, "query", `tool:${tool}`, count, "measured")
    ),
    ...[...toolRoleCounts.entries()].sort(byEntry).map(([pair, count]) => {
      const [tool, role] = pair.split("\u0000") as [string, string];
      return connection(`tool:${tool}->source:${role}`, `tool:${tool}`, `source:${role}`, count, "inferred");
    })
  ];
  return flow(lens, dataset, "ready", "Tool/source flow avoids raw command text and groups by tool name plus source role.", aggregateQueryMetrics(ctx.journeys), stages, connections);
}

function recallTemperature(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): MatrixScene {
  const hot = [...ctx.retrievals.entries()].map(([id, journeys]) => ({ note: ctx.byId.get(id), journeys })).filter((item): item is { note: NormalizedNote; journeys: QueryJourney[] } => Boolean(item.note)).sort((a, b) => b.journeys.length - a.journeys.length || byNotePath(a.note, b.note)).slice(0, 20);
  if (hot.length === 0) return unavailableScene(lens, dataset, ["query-paths"]) as MatrixScene;
  const columns = ["frequency", "recency", "contexts"].map((id) => ({ id, label: id }));
  const cells = hot.flatMap((item) => columns.map((column) => cell(item.note.id, column.id, temperatureValue(column.id, item.journeys), "measured", evidenceId(item.note.path))));
  return matrix(lens, dataset, "ready", "Recall heat separates frequent, recent, and context-diverse notes.", [metric("hot-notes", "Retrieved notes", hot.length, "notes", "measured", "query paths", ctx.journeys.length)], hot.map((item) => ({ id: item.note.id, label: item.note.title })), columns, cells);
}

function linkPlasticity(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): GraphScene {
  if (!ctx.latestDiff) return unavailableScene(lens, dataset, ["snapshots"]) as GraphScene;
  const diff = ctx.latestDiff;
  const changedLinks = [...diff.addedLinks, ...diff.removedLinks].slice(0, 120);
  const changedIds = new Set(changedLinks.flatMap((link) => [link.sourceId, link.targetId]));
  const nodes = dataset.current.notes.filter((note) => changedIds.has(note.id)).map(nodeFromNote);
  const edges = changedLinks.map((link) => ({ ...edgeFromLink(link), state: diff.addedLinks.includes(link) ? "added" as const : "removed" as const }));
  return graph(lens, dataset, "ready", "Diff states are only shown for compatible snapshots.", diffMetrics(diff), nodes, edges);
}

function growthRings(lens: LensSpec, dataset: ObservatoryDataset): RadialScene {
  if (dataset.snapshots.length < 2) return unavailableScene(lens, dataset, ["snapshot-history"]) as RadialScene;
  const latest = dataset.snapshots.at(-1) ?? dataset.current;
  const previous = dataset.snapshots.at(-2) ?? dataset.snapshots[0] ?? latest;
  const segments = CORE_PARA.map((para) => segment(para, PARA_LABELS[para], latest.notes.filter((note) => note.para === para).length, "measured", previous.notes.filter((note) => note.para === para).length));
  return radial(lens, dataset, "ready", "Growth rings compare the latest compatible snapshots without reconstructing unsupported history.", snapshotMetrics(dataset), segments, [], dataset.snapshots.map((snap) => ({ id: snap.id, label: snap.observedAt, value: snap.notes.length, confidence: "measured" })));
}

function orphanDrift(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): GraphScene {
  const orphanNotes = ctx.notes.filter((note) => (ctx.inbound.get(note.id)?.length ?? 0) === 0 && (ctx.outbound.get(note.id)?.length ?? 0) === 0).slice(0, 80);
  return graph(lens, dataset, orphanNotes.length ? "ready" : "partial", "Orphan drift marks isolated notes now and can animate attachment when snapshot history exists.", [
    metric("orphans", "Orphan notes", orphanNotes.length, "notes", "measured", "current links", ctx.notes.length)
  ], orphanNotes.map((note, index) => placedNode(note, index, orphanNotes.length, 0.85)), []);
}

function knowledgeMigration(lens: LensSpec, dataset: ObservatoryDataset): FlowScene {
  if (dataset.snapshots.length < 2) return unavailableScene(lens, dataset, ["snapshot-history"]) as FlowScene;
  const values = new Map<string, number>();
  for (const diff of dataset.diffs) {
    for (const change of diff.changedNotes) {
      if (change.before.para === change.after.para) continue;
      const id = `${change.before.para}->${change.after.para}`;
      values.set(id, (values.get(id) ?? 0) + 1);
    }
  }
  const stages = CORE_PARA.map((para, index) => stage(para, PARA_LABELS[para], index, 1, "measured"));
  const connections = [...values.entries()].sort(byEntry).map(([id, value]) => {
    const [source, target] = id.split("->") as [string, string];
    return connection(id, source, target, value, "measured");
  });
  return flow(lens, dataset, connections.length ? "ready" : "partial", "Migration uses measured snapshot path/PARA changes only.", snapshotMetrics(dataset), stages, connections);
}

function changeRhythm(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): TimelineScene {
  const created = series("created", "Created notes", "created", bucketNotes(ctx.notes, "createdTime"));
  const modified = series("modified", "Modified notes", "modified", bucketNotes(ctx.notes, "modifiedTime"));
  const queries = series("queries", "Queries", "query", bucketJourneys(ctx.journeys));
  return timeline(lens, dataset, "ready", "Rhythm uses file timestamps and query timestamps; link history requires snapshots.", metricsForGraph(ctx), [created, modified, queries]);
}

function projectPulse(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): TimelineScene {
  const projects = ctx.notes.filter((note) => note.para === "projects");
  return timeline(lens, dataset, projects.length ? "ready" : "partial", "Project pulse highlights recent project modification and retrieval bursts.", [
    metric("projects", "Project notes", projects.length, "notes", "measured", "current metadata", projects.length)
  ], [series("project-modified", "Project activity", "para-projects", bucketNotes(projects, "modifiedTime")), series("project-retrieval", "Project retrieval", "retrieval", bucketJourneysForPara(ctx.journeys, ctx, "projects"))]);
}

function areaSustenance(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): TimelineScene {
  const areas = ctx.notes.filter((note) => note.para === "areas");
  return timeline(lens, dataset, areas.length ? "ready" : "partial", "Area sustenance rewards recurring weeks rather than one-off bursts.", [
    metric("areas", "Area notes", areas.length, "notes", "measured", "current metadata", areas.length)
  ], [series("area-modified", "Area continuity", "para-areas", bucketNotes(areas, "modifiedTime")), series("area-query", "Area query reuse", "query", bucketJourneysForPara(ctx.journeys, ctx, "areas"))]);
}

function resourceReuse(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): GraphScene {
  const resources = topNotes({ ...ctx, notes: ctx.notes.filter((note) => note.para === "resources") }, 40);
  return graph(lens, dataset, resources.length ? "ready" : "partial", "Resource reuse combines cross-project links and query retrieval count.", [
    metric("resources", "Resource candidates", resources.length, "notes", confidenceFor(resources.length), "links + query journeys", resources.length)
  ], resources.map(nodeFromNote), ctx.links.filter((link) => resources.some((note) => note.id === link.sourceId || note.id === link.targetId)).slice(0, 80).map(edgeFromLink));
}

function archiveReactivation(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): RadialScene {
  const archive = ctx.notes.filter((note) => note.para === "archive");
  const reactivated = archive.filter((note) => ctx.retrievals.has(note.id));
  return radial(lens, dataset, archive.length ? "ready" : "partial", "Archive stays dim unless measured retrieval events reactivate notes.", [
    metric("archive-notes", "Archive notes", archive.length, "notes", "measured", "current metadata", archive.length),
    metric("reactivated", "Reactivated", reactivated.length, "notes", confidenceFor(ctx.journeys.length), "query journeys", ctx.journeys.length)
  ], [segment("archive", "Dormant archive", archive.length - reactivated.length, "measured"), segment("reactivated", "Reactivated", reactivated.length, confidenceFor(ctx.journeys.length))], reactivated.map(nodeFromNote), []);
}

function commonRoutingCore(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): FlowScene {
  const commonEntries = ctx.journeys.filter((journey) => journey.entrypoints.some((path) => ctx.byPath.get(path)?.para === "common"));
  const stages = [stage("common", "Common", 0, commonEntries.length, confidenceFor(ctx.journeys.length)), ...CORE_PARA.filter((para) => para !== "common").map((para, index) => stage(para, PARA_LABELS[para], index + 1, ctx.notes.filter((note) => note.para === para).length, "measured"))];
  const connections = CORE_PARA.filter((para) => para !== "common").map((para) => connection(`common->${para}`, "common", para, ctx.links.filter((link) => ctx.byId.get(link.sourceId)?.para === "common" && ctx.byId.get(link.targetId)?.para === para).length, "measured"));
  return flow(lens, dataset, "ready", "Routing core compares Common entry frequency with outbound PARA spokes.", [
    metric("common-entry", "Common entry queries", commonEntries.length, "queries", confidenceFor(ctx.journeys.length), "query entrypoints", ctx.journeys.length)
  ], stages, connections);
}

function latencyRiver(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): TimelineScene {
  if (ctx.journeys.length === 0) return unavailableScene(lens, dataset, ["query-timing"]) as TimelineScene;
  return timeline(lens, dataset, "ready", "Latency river uses explicit kb-query operation elapsed time and never relabels whole-turn Stop time as search latency.", aggregateQueryMetrics(ctx.journeys), [series("latency", "Query ms", "latency", bucketJourneyReading(ctx.journeys, "durationMs")), series("documents", "Documents read", "documents", bucketJourneyReading(ctx.journeys, "documentsReadCount"))]);
}

function tokenHeat(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): MatrixScene {
  const withTokens = ctx.journeys.filter((journey) => journey.totalTokens.value !== null);
  if (withTokens.length === 0) return unavailableScene(lens, dataset, ["query-tokens"]) as MatrixScene;
  const rows = withTokens.slice(0, 12).map((journey, index) => ({ id: journey.queryId, label: `Query ${index + 1}` }));
  const columns = CORE_PARA.map((para) => ({ id: para, label: PARA_LABELS[para] }));
  const cells = rows.flatMap((row) => {
    const journey = withTokens.find((item) => item.queryId === row.id);
    const touchedParas = unique(
      (journey?.accessedPaths ?? [])
        .map((path) => ctx.byPath.get(path)?.para)
        .filter((para): para is ParaCategory => para !== undefined && CORE_PARA.includes(para))
    );
    const allocated = (journey?.totalTokens.value ?? 0) / Math.max(1, touchedParas.length);
    return columns.map((column) => {
      const touched = touchedParas.includes(column.id as ParaCategory);
      return cell(row.id, column.id, touched ? allocated : null, touched ? "inferred" : "unavailable", row.id);
    });
  });
  return matrix(lens, dataset, "ready", "Token totals are measured at query level; PARA cells are explicitly inferred equal allocations across touched regions, never direct attribution.", aggregateQueryMetrics(withTokens), rows, columns, cells);
}

function efficiencyFrontier(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): ScatterScene {
  if (ctx.journeys.length === 0) return unavailableScene(lens, dataset, ["query-timing"]) as ScatterScene;
  const points = ctx.journeys.map((journey, index) => scatterPoint(journey.queryId, `Query ${index + 1}`, journey.documentsReadCount.value ?? journey.documentsReadPaths.length, journey.durationMs.value ?? 0, journey.totalTokens.value ?? 1, paraMix(journey, ctx), confidenceForReading(journey.durationMs.confidence, journey.documentsReadCount.confidence)));
  return scatter(lens, dataset, "ready", "The frontier marks queries that dominate lower document count and lower elapsed time.", aggregateQueryMetrics(ctx.journeys), "Documents read", "Elapsed ms", points);
}

function documentBurden(lens: LensSpec, dataset: ObservatoryDataset, ctx: Context): MatrixScene {
  const rows = [...ctx.retrievals.entries()].map(([id, journeys]) => ({ note: ctx.byId.get(id), journeys })).filter((item): item is { note: NormalizedNote; journeys: QueryJourney[] } => Boolean(item.note)).sort((a, b) => b.journeys.length - a.journeys.length || byNotePath(a.note, b.note)).slice(0, 20);
  if (rows.length === 0) return unavailableScene(lens, dataset, ["query-paths"]) as MatrixScene;
  const columns = ["reads", "elapsedShare", "tokenShare", "bytes"].map((id) => ({ id, label: id }));
  const cells = rows.flatMap((row) => columns.map((column) =>
    cell(
      row.note.id,
      column.id,
      burdenValue(column.id, row.note, row.journeys),
      burdenConfidence(column.id, row.journeys),
      row.note.path
    )
  ));
  return matrix(lens, dataset, "ready", "Document burden accumulates retrieval count, associated elapsed/token share, and note bytes.", [
    metric("burdened-documents", "Burdened documents", rows.length, "notes", "measured", "query paths", ctx.journeys.length)
  ], rows.map((row) => ({ id: row.note.id, label: row.note.title })), columns, cells);
}

function unavailableScene(lens: LensSpec, dataset: ObservatoryDataset, missing: DataCapability[]): VisualScene {
  const absent = missing.length ? missing : lens.requires;
  const baseMetrics = [
    metric("available-capabilities", "Available capabilities", dataset.capabilities.size, "capabilities", "measured", "dataset"),
    metric("required-capabilities", "Required capabilities", lens.requires.length, "capabilities", "measured", "lens registry")
  ];
  const summary = `Requires ${absent.join(", ")}. Capture or configure these sources to activate this lens.`;
  if (lens.primitive === "graph") return graph(lens, dataset, "unavailable", summary, baseMetrics, [], []);
  if (lens.primitive === "radial") return radial(lens, dataset, "unavailable", summary, baseMetrics, [], [], []);
  if (lens.primitive === "flow") return flow(lens, dataset, "unavailable", summary, baseMetrics, [], []);
  if (lens.primitive === "timeline") return timeline(lens, dataset, "unavailable", summary, baseMetrics, []);
  if (lens.primitive === "matrix") return matrix(lens, dataset, "unavailable", summary, baseMetrics, [], [], []);
  return scatter(lens, dataset, "unavailable", summary, baseMetrics, "Required", "Available", []);
}

function graph(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[], nodes: GraphNode[], edges: GraphEdge[]): GraphScene {
  const sceneBase = base(lens, dataset, status, summary, metrics);
  const safeNodeList = safeNodes(nodes);
  const safeEdgeList = safeEdges(edges);
  const orderedMarks = safeEdgeList.some((edge) => edge.order !== undefined)
    ? [...safeEdgeList].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)).map((edge) => edge.id)
    : safeNodeList.map((node) => node.id);
  return { ...sceneBase, motion: motionForMarks(sceneBase.motion, orderedMarks), primitive: "graph", nodes: safeNodeList, edges: safeEdgeList };
}

function radial(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[], segments: RadialSegment[], satellites: GraphNode[], rings: RadialScene["rings"]): RadialScene {
  const sceneBase = base(lens, dataset, status, summary, metrics);
  const safeSegments = segments.map(safeSegment);
  const safeSatellites = safeNodes(satellites);
  return { ...sceneBase, motion: motionForMarks(sceneBase.motion, [...safeSegments.map((item) => item.id), ...safeSatellites.map((item) => item.id)]), primitive: "radial", segments: safeSegments, satellites: safeSatellites, rings: rings.map((ring) => ({ ...ring, value: finite(ring.value) })) };
}

function flow(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[], stages: FlowStage[], connections: FlowConnection[]): FlowScene {
  const sceneBase = base(lens, dataset, status, summary, metrics);
  const safeStages = stages.map((item) => ({ ...item, value: finite(item.value) }));
  const safeConnections = connections.map((item) => ({ ...item, value: finite(item.value) }));
  const marks = safeConnections.length > 0 ? safeConnections.map((item) => item.id) : safeStages.map((item) => item.id);
  return { ...sceneBase, motion: motionForMarks(sceneBase.motion, marks), primitive: "flow", stages: safeStages, connections: safeConnections };
}

function timeline(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[], seriesList: TimelineSeries[]): TimelineScene {
  const sceneBase = base(lens, dataset, status, summary, metrics);
  const safeSeries = seriesList.map((item) => ({ ...item, points: item.points.map((point) => ({ ...point, value: finite(point.value) })) }));
  const marks = safeSeries
    .flatMap((item) => item.points)
    .sort((a, b) => compareNullableTimestamps(a.time, b.time) || a.id.localeCompare(b.id))
    .map((item) => item.id);
  return { ...sceneBase, motion: motionForMarks(sceneBase.motion, marks), primitive: "timeline", series: safeSeries, bands: [] };
}

function matrix(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[], rows: MatrixScene["rows"], columns: MatrixScene["columns"], cells: MatrixCell[]): MatrixScene {
  const sceneBase = base(lens, dataset, status, summary, metrics);
  const safeCells = cells.map((item) => ({ ...item, value: item.value === null ? null : finite(item.value) }));
  return { ...sceneBase, motion: motionForMarks(sceneBase.motion, safeCells.filter((item) => item.value !== null).map((item) => item.id)), primitive: "matrix", rows, columns, cells: safeCells };
}

function scatter(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[], xLabel: string, yLabel: string, points: ScatterPoint[]): ScatterScene {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const sceneBase = base(lens, dataset, status, summary, metrics);
  const safePoints = sorted.map((point) => ({ ...point, x: finite(point.x), y: finite(point.y), size: finite(point.size) }));
  return { ...sceneBase, motion: motionForMarks(sceneBase.motion, safePoints.map((item) => item.id)), primitive: "scatter", xLabel, yLabel, points: safePoints, frontier: frontier(safePoints) };
}

function base(lens: LensSpec, dataset: ObservatoryDataset, status: VisualScene["status"], summary: string, metrics: MetricDatum[]) {
  const missing = missingCapabilities(dataset, lens.requires);
  return {
    id: `${lens.id}:${dataset.current.id}`,
    lensId: lens.id,
    status,
    title: lens.title,
    question: lens.question,
    summary,
    confidence: status === "unavailable"
      ? "unavailable" as Confidence
      : aggregateConfidence(metrics.map((item) => item.confidence)),
    missingCapabilities: status === "unavailable" ? missing.length ? missing : lens.requires : missing,
    metrics: metrics.map(safeMetric),
    legend: legendFor(lens),
    inspector: inspectorFor(lens, summary, metrics),
    motion: lens.motionTrigger === "none" ? motion("none", lens.motionEffect) : motion(lens.motionTrigger, lens.motionEffect)
  };
}

function inspectorFor(lens: LensSpec, summary: string, metrics: MetricDatum[]): InspectorModel {
  const actions: InspectorModel["actions"] = [lens.primaryAction];
  if (!actions.includes("capture-snapshot")) actions.push("capture-snapshot");
  return {
    heading: lens.title,
    summary,
    metrics: metrics.map(safeMetric),
    evidence: metrics.slice(0, 4).map((item) => ({ id: item.id, label: item.label, kind: "metric", detail: item.source, confidence: item.confidence })),
    actions
  };
}

function spec(id: string, title: string, family: LensFamily, primitive: ScenePrimitive, question: string, requires: DataCapability[], motionTrigger: MotionContract["trigger"], motionEffect: MotionContract["keyframes"][number]["effect"], primaryAction: InspectorModel["actions"][number], description: string): LensSpec {
  return { id, title, family, primitive, question, requires, motionTrigger, motionEffect, primaryAction, description };
}

function motion(trigger: MotionContract["trigger"], effect: MotionContract["keyframes"][number]["effect"]): MotionContract {
  return { trigger, durationMs: trigger === "none" ? 0 : 640, stepDurationMs: trigger === "replay" ? 320 : 220, userTriggered: true, keyframes: trigger === "none" ? [] : [{ at: 0, markIds: [], effect }, { at: 1, markIds: [], effect }] };
}

function motionForMarks(contract: MotionContract, markIds: string[]): MotionContract {
  if (contract.trigger === "none" || markIds.length === 0) return { ...contract, keyframes: [] };
  const effect = contract.keyframes[0]?.effect ?? "pulse";
  const uniqueMarks = unique(markIds);
  return {
    ...contract,
    durationMs: contract.trigger === "replay"
      ? clamp((contract.stepDurationMs ?? 320) * uniqueMarks.length, 320, 12_000)
      : contract.durationMs,
    keyframes: uniqueMarks.map((markId, index) => ({
      at: (index + 1) / uniqueMarks.length,
      markIds: [markId],
      effect
    }))
  };
}

function metric(id: string, label: string, value: number | null, unit: string, confidence: Confidence, source: string, sampleSize?: number): MetricDatum {
  const datum: MetricDatum = { id, label, value: value === null ? null : finite(value), unit, confidence, source };
  if (sampleSize !== undefined) datum.sampleSize = sampleSize;
  return datum;
}

function segment(id: string, label: string, value: number, confidence: Confidence, secondaryValue?: number): RadialSegment {
  const para = id as ParaCategory;
  const result: RadialSegment = { id, label, group: id, value: finite(value), confidence, colorKey: PARA_COLORS[para] ?? id };
  if (secondaryValue !== undefined) result.secondaryValue = finite(secondaryValue);
  return result;
}

function stage(id: string, label: string, order: number, value: number, confidence: Confidence): FlowStage {
  return { id, label, order, value: finite(value), confidence, colorKey: PARA_COLORS[id as ParaCategory] ?? id };
}

function connection(id: string, source: string, target: string, value: number, confidence: Confidence): FlowConnection {
  return { id, source, target, value: finite(value), confidence, colorKey: PARA_COLORS[source as ParaCategory] ?? "flow" };
}

function cell(row: string, column: string, value: number | null, confidence: Confidence, evidenceId: string): MatrixCell {
  return { id: `${row}:${column}`, row, column, value: value === null ? null : finite(value), confidence, colorKey: column, evidenceId };
}

function series(id: string, label: string, colorKey: string, points: TimelineSeries["points"]): TimelineSeries {
  return {
    id,
    label,
    colorKey,
    points: points.sort((a, b) => compareNullableTimestamps(a.time, b.time) || a.id.localeCompare(b.id))
  };
}

function scatterPoint(id: string, label: string, x: number, y: number, size: number, group: string, confidence: Confidence): ScatterPoint {
  return { id, label, x: finite(x), y: finite(y), size: Math.max(1, finite(size)), group, confidence, colorKey: PARA_COLORS[group as ParaCategory] ?? group, evidenceId: id };
}

function nodeFromNote(note: NormalizedNote): GraphNode {
  return { id: note.id, label: note.title, group: note.para, role: note.role === "index" ? "index" : "note", value: 1, confidence: note.confidence, colorKey: PARA_COLORS[note.para], path: note.path, meta: { para: note.para, role: note.role } };
}

function placedNode(note: NormalizedNote, index: number, total: number, radius: number, value = 1): GraphNode {
  const angle = (Math.PI * 2 * index) / Math.max(total, 1);
  return { ...nodeFromNote(note), value: finite(value), x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius };
}

function nodeForPath(ctx: Context, path: string, fallbackId: string, x: number, y: number): GraphNode {
  const note = ctx.byPath.get(path);
  if (note) {
    const normalized = nodeFromNote(note);
    return {
      ...normalized,
      id: fallbackId,
      x,
      y,
      value: 1,
      meta: { ...normalized.meta, noteId: note.id }
    };
  }
  return { id: fallbackId, label: path.split("/").at(-1) ?? "source", group: "source", role: "placeholder", value: 1, confidence: "inferred", x, y, colorKey: "source", path };
}

function edgeFromLink(link: NormalizedLink): GraphEdge {
  return { id: link.id, source: link.sourceId, target: link.targetId, value: 1, confidence: link.confidence, directed: true, state: link.resolved ? "normal" : "focus" };
}

function adjacentConnections(stages: FlowStage[]): FlowConnection[] {
  return stages.slice(1).map((item, index) => connection(`${stages[index]?.id}->${item.id}`, stages[index]?.id ?? item.id, item.id, Math.min(stages[index]?.value ?? 0, item.value), confidenceForReading(stages[index]?.confidence ?? "unavailable", item.confidence)));
}

interface ActivationComponent {
  label: string;
  value: number | null;
  weight: number;
}

interface ActivationResult {
  score: number;
  confidence: Confidence;
  components: ActivationComponent[];
}

function activation(para: ParaCategory, ctx: Context): ActivationResult {
  const paraNotes = ctx.notes.filter((note) => note.para === para);
  const touchedQueries = ctx.journeys.filter((journey) =>
    journey.accessedPaths.some((path) => ctx.byPath.get(path)?.para === para)
  );
  const retrievalShare = ctx.journeys.length > 0 ? norm(touchedQueries.length, ctx.journeys.length) : null;
  const recent = paraNotes.filter((note) => note.modifiedTime !== null && note.modifiedTime > maxModified(ctx.notes) - 1000 * 60 * 60 * 24 * 30).length;
  const recentShare = paraNotes.length > 0 ? norm(recent, paraNotes.length) : null;
  let components: ActivationComponent[];

  if (para === "common") {
    const routed = ctx.journeys.filter((journey) =>
      [...journey.accessedPaths, ...journey.entrypoints].some((path) => ctx.byPath.get(path)?.para === "common")
    ).length;
    const commonEntries = ctx.journeys.filter((journey) =>
      journey.entrypoints.some((path) => ctx.byPath.get(path)?.para === "common")
    ).length;
    const crossPara = ctx.links.filter((link) => {
      const source = ctx.byId.get(link.sourceId)?.para;
      const target = ctx.byId.get(link.targetId)?.para;
      return source !== undefined && target !== undefined && source !== target;
    });
    const commonCrossPara = crossPara.filter((link) =>
      ctx.byId.get(link.sourceId)?.para === "common" || ctx.byId.get(link.targetId)?.para === "common"
    ).length;
    components = [
      { label: "route frequency", value: ctx.journeys.length ? norm(routed, ctx.journeys.length) : null, weight: 45 },
      { label: "entry centrality", value: crossPara.length ? norm(commonCrossPara, crossPara.length) : null, weight: 35 },
      { label: "query entry share", value: ctx.journeys.length ? norm(commonEntries, ctx.journeys.length) : null, weight: 20 }
    ];
  } else if (para === "projects") {
    components = [
      { label: "recent activity", value: recentShare, weight: 45 },
      { label: "retrieval share", value: retrievalShare, weight: 35 },
      { label: "link delta", value: linkDeltaShare(ctx, para, false), weight: 20 }
    ];
  } else if (para === "areas") {
    components = [
      { label: "active-week recurrence", value: activeWeekRecurrence(paraNotes), weight: 45 },
      { label: "retrieval share", value: retrievalShare, weight: 35 },
      { label: "inbound delta", value: linkDeltaShare(ctx, para, true), weight: 20 }
    ];
  } else if (para === "resources") {
    const resourceLinks = ctx.links.filter((link) =>
      ctx.byId.get(link.sourceId)?.para === "resources" || ctx.byId.get(link.targetId)?.para === "resources"
    );
    const projectResourceLinks = resourceLinks.filter((link) => {
      const source = ctx.byId.get(link.sourceId)?.para;
      const target = ctx.byId.get(link.targetId)?.para;
      return (source === "projects" && target === "resources") || (source === "resources" && target === "projects");
    }).length;
    components = [
      { label: "distinct contexts", value: distinctResourceContextShare(touchedQueries, ctx), weight: 50 },
      { label: "retrieval share", value: retrievalShare, weight: 30 },
      { label: "cross-project links", value: resourceLinks.length ? norm(projectResourceLinks, resourceLinks.length) : null, weight: 20 }
    ];
  } else if (para === "archive") {
    const reactivatedNotes = paraNotes.filter((note) => ctx.retrievals.has(note.id)).length;
    components = [
      { label: "explicit reactivation", value: paraNotes.length ? norm(reactivatedNotes, paraNotes.length) : null, weight: 70 },
      { label: "retrieval share", value: retrievalShare, weight: 30 }
    ];
  } else {
    components = [{ label: "recent activity", value: recentShare, weight: 100 }];
  }

  const score = components.reduce((total, component) => total + ((component.value ?? 0) * component.weight) / 100, 0);
  return {
    score: clamp(score, 0, 100),
    confidence: components.every((component) => component.value === null) ? "unavailable" : "inferred",
    components
  };
}

function linkDeltaShare(ctx: Context, para: ParaCategory, inboundOnly: boolean): number | null {
  const diff = ctx.latestDiff;
  if (!diff) return null;
  const changedLinks = [...diff.addedLinks, ...diff.removedLinks];
  if (changedLinks.length === 0) return 0;
  const historicalNotes = new Map<string, NormalizedNote>();
  for (const note of ctx.notes) historicalNotes.set(note.id, note);
  for (const note of diff.removedNotes) historicalNotes.set(note.id, note);
  for (const change of diff.changedNotes) {
    historicalNotes.set(change.before.id, change.before);
    historicalNotes.set(change.after.id, change.after);
  }
  const matching = changedLinks.filter((link) => {
    const sourcePara = historicalNotes.get(link.sourceId)?.para;
    const targetPara = historicalNotes.get(link.targetId)?.para;
    return inboundOnly ? targetPara === para : sourcePara === para || targetPara === para;
  }).length;
  return norm(matching, changedLinks.length);
}

function activeWeekRecurrence(notes: NormalizedNote[]): number | null {
  const times = notes.map((note) => note.modifiedTime).filter((value): value is number => value !== null);
  if (times.length === 0) return null;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const latest = Math.max(...times);
  const activeWeeks = new Set(
    times.map((value) => Math.floor((latest - value) / weekMs)).filter((week) => week >= 0 && week < 12)
  );
  return norm(activeWeeks.size, 12);
}

function distinctResourceContextShare(journeys: QueryJourney[], ctx: Context): number | null {
  if (ctx.journeys.length === 0) return null;
  const signatures = journeys.map((journey) => {
    const paras = unique(
      journey.accessedPaths
        .map((path) => ctx.byPath.get(path)?.para ?? "unknown")
        .filter((para) => para !== "resources")
    ).sort();
    const tools = [...journey.tools].sort();
    return `${paras.join("+") || "resource-only"}|${tools.join("+") || "no-tool"}`;
  });
  return norm(countUnique(signatures), ctx.journeys.length);
}

function reachable(ctx: Context, note: NormalizedNote, depth: number, limit: number): NormalizedNote[] {
  const found: NormalizedNote[] = [];
  const visited = new Set([note.id]);
  let frontier = [note.id];
  for (let hop = 0; hop < depth && frontier.length > 0 && found.length < limit; hop += 1) {
    const next: string[] = [];
    for (const sourceId of frontier.sort()) {
      const targets = (ctx.outbound.get(sourceId) ?? [])
        .map((link) => ctx.byId.get(link.targetId))
        .filter((item): item is NormalizedNote => Boolean(item))
        .sort(byNotePath);
      for (const target of targets) {
        if (visited.has(target.id)) continue;
        visited.add(target.id);
        found.push(target);
        next.push(target.id);
        if (found.length >= limit) break;
      }
      if (found.length >= limit) break;
    }
    frontier = next;
  }
  return found;
}

function topNotes(ctx: Pick<Context, "notes" | "retrievals" | "inbound" | "outbound">, limit: number): NormalizedNote[] {
  return [...ctx.notes].sort((a, b) => noteImportance(b, ctx) - noteImportance(a, ctx) || byNotePath(a, b)).slice(0, limit);
}

function noteImportance(note: NormalizedNote, ctx: Pick<Context, "retrievals" | "inbound" | "outbound">): number {
  return (ctx.retrievals.get(note.id)?.length ?? 0) * 4 + (ctx.inbound.get(note.id)?.length ?? 0) * 2 + (ctx.outbound.get(note.id)?.length ?? 0);
}

function pressureScore(note: NormalizedNote, ctx: Context): number {
  const orphan = (ctx.inbound.get(note.id)?.length ?? 0) + (ctx.outbound.get(note.id)?.length ?? 0) === 0 ? 20 : 0;
  return noteImportance(note, ctx) * 8 + (note.sizeBytes ?? 0) / 1000 + orphan;
}

function queryMetrics(journey: QueryJourney): MetricDatum[] {
  return [
    metric("elapsed", "Elapsed", journey.durationMs.value, "ms", journey.durationMs.confidence, journey.durationMs.source, 1),
    metric("documents-read", "Documents read", journey.documentsReadCount.value ?? journey.documentsReadPaths.length, "docs", journey.documentsReadCount.confidence, journey.documentsReadCount.source, journey.documentsReadPaths.length),
    metric("tokens", "Tokens", journey.totalTokens.value, "tokens", journey.totalTokens.confidence, journey.totalTokens.source, 1),
    metric("steps", "Steps", journey.steps.length, "steps", "measured", "PostToolUse ordered steps", journey.steps.length)
  ];
}

function aggregateQueryMetrics(journeys: QueryJourney[]): MetricDatum[] {
  return [
    metric("queries", "Queries", journeys.length, "queries", "measured", "query telemetry", journeys.length),
    metric("elapsed-p50", "Query p50", percentile(journeys.map((j) => j.durationMs.value)), "ms", confidenceFor(journeys.filter((j) => j.durationMs.value !== null).length), "QueryComplete.operation_elapsed_ms", journeys.length),
    metric("docs-p50", "Docs p50", percentile(journeys.map((j) => j.documentsReadCount.value ?? j.documentsReadPaths.length)), "docs", "inferred", "QuerySummary.documents_read_count", journeys.length),
    metric("tokens-p50", "Tokens p50", percentile(journeys.map((j) => j.totalTokens.value)), "tokens", confidenceFor(journeys.filter((j) => j.totalTokens.value !== null).length), "QueryComplete.token_total_for_analysis", journeys.length)
  ];
}

function metricsForGraph(ctx: Context): MetricDatum[] {
  return [
    metric("notes", "Notes", ctx.notes.length, "notes", "measured", "current metadata", ctx.notes.length),
    metric("links", "Links", ctx.links.length, "links", "measured", "current metadata", ctx.links.length),
    metric("queries", "Queries", ctx.journeys.length, "queries", confidenceFor(ctx.journeys.length), "query telemetry", ctx.journeys.length)
  ];
}

function snapshotMetrics(dataset: ObservatoryDataset): MetricDatum[] {
  return [
    metric("snapshots", "Snapshots", dataset.snapshots.length, "snapshots", "measured", "snapshot store", dataset.snapshots.length),
    metric("diffs", "Diffs", dataset.diffs.length, "diffs", "measured", "snapshot diff", dataset.diffs.length)
  ];
}

function diffMetrics(diff: SnapshotDiff): MetricDatum[] {
  return [
    metric("note-delta", "Note delta", diff.metrics.noteDelta, "notes", "measured", `${diff.beforeId}->${diff.afterId}`),
    metric("link-delta", "Link delta", diff.metrics.linkDelta, "links", "measured", `${diff.beforeId}->${diff.afterId}`),
    metric("added-links", "Added links", diff.addedLinks.length, "links", "measured", diff.afterId),
    metric("removed-links", "Removed links", diff.removedLinks.length, "links", "measured", diff.beforeId)
  ];
}

function bucketNotes(notes: NormalizedNote[], field: "createdTime" | "modifiedTime") {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const value = note[field];
    if (value === null) continue;
    const day = timestampDay(value);
    if (!day) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].sort(byEntry).map(([day, value]) => ({ id: `${field}:${day}`, time: day, value, confidence: "measured" as Confidence, label: day }));
}

function bucketJourneys(journeys: QueryJourney[]) {
  const counts = new Map<string, number>();
  for (const journey of journeys) {
    if (!journey.startedAt) continue;
    const day = timestampDay(journey.startedAt);
    if (!day) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].sort(byEntry).map(([day, value]) => ({ id: `query:${day}`, time: day, value, confidence: "measured" as Confidence, label: day }));
}

function bucketJourneysForPara(journeys: QueryJourney[], ctx: Context, para: ParaCategory) {
  return bucketJourneys(journeys.filter((journey) => journey.accessedPaths.some((path) => ctx.byPath.get(path)?.para === para)));
}

function bucketJourneyReading(journeys: QueryJourney[], key: "durationMs" | "documentsReadCount") {
  return journeys.flatMap((journey, index) => {
    const reading = journey[key];
    if (!journey.startedAt || reading.value === null) return [];
    const day = timestampDay(journey.startedAt);
    if (!day) return [];
    return [{ id: `${key}:${journey.queryId}:${index}`, time: day, value: reading.value, confidence: reading.confidence, label: `Query ${index + 1}` }];
  });
}

function temperatureValue(column: string, journeys: QueryJourney[]): number {
  if (column === "frequency") return journeys.length;
  if (column === "contexts") return countUnique(journeys.map((journey) => paraMix(journey, null)));
  return journeys.reduce((latest, journey) => {
    const observed = timestampEpoch(journey.startedAt) ?? timestampEpoch(journey.endedAt);
    return observed === null ? latest : Math.max(latest, observed);
  }, 0);
}

function timestampEpoch(value: string | number | null): number | null {
  if (value === null) return null;
  const epoch = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function timestampDay(value: string | number | null): string | null {
  const epoch = timestampEpoch(value);
  return epoch === null ? null : new Date(epoch).toISOString().slice(0, 10);
}

function burdenValue(column: string, note: NormalizedNote, journeys: QueryJourney[]): number {
  if (column === "reads") return journeys.length;
  if (column === "elapsedShare") {
    return sum(journeys.map((journey) => allocateAcrossDocuments(journey.durationMs.value, journey)));
  }
  if (column === "tokenShare") {
    return sum(journeys.map((journey) => allocateAcrossDocuments(journey.totalTokens.value, journey)));
  }
  return note.sizeBytes ?? 0;
}

function burdenConfidence(column: string, journeys: QueryJourney[]): Confidence {
  if (column === "bytes") return "measured";
  if (column === "reads") {
    return aggregateConfidence(journeys.map((journey) => journey.documentsReadCount.confidence));
  }
  if (column === "elapsedShare") {
    return aggregateConfidence(journeys.map((journey) => journey.durationMs.confidence));
  }
  return aggregateConfidence(journeys.map((journey) => journey.totalTokens.confidence));
}

function allocateAcrossDocuments(value: number | null, journey: QueryJourney): number | null {
  if (value === null) return null;
  const documentCount = journey.documentsReadCount.value ?? journey.documentsReadPaths.length;
  return value / Math.max(1, documentCount);
}

function constellationPosition(journey: QueryJourney): { x: number; y: number } {
  const paths = unique(
    journey.documentsReadPaths.length > 0 ? journey.documentsReadPaths : journey.accessedPaths
  ).sort();
  const tools = [...journey.tools].sort();
  const pathAxis = paths.length > 0 ? average(paths.map((path) => stableUnit(path))) : stableUnit(journey.queryId);
  const toolAxis = tools.length > 0
    ? average(tools.map((tool) => stableUnit(`tool:${tool}`)))
    : stableUnit(`steps:${journey.steps.length}`);
  return { x: 5 + pathAxis * 90, y: 5 + toolAxis * 90 };
}

function paraMix(journey: QueryJourney, ctx: Context | null): string {
  if (!ctx) return journey.accessedPaths.length > 0 ? "mixed" : "unknown";
  const counts = countBy(journey.accessedPaths.map((path) => ctx.byPath.get(path)?.para ?? "unknown"));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "unknown";
}

function selectDiff(dataset: ObservatoryDataset, state: ViewState): SnapshotDiff | null {
  if (state.beforeSnapshotId && state.afterSnapshotId) {
    return dataset.diffs.find((diff) => diff.beforeId === state.beforeSnapshotId && diff.afterId === state.afterSnapshotId) ?? null;
  }
  return dataset.diffs.at(-1) ?? null;
}

function missingCapabilities(dataset: ObservatoryDataset, requires: DataCapability[]): DataCapability[] {
  return requires.filter((capability) => !dataset.capabilities.has(capability));
}

function groupLinks(links: NormalizedLink[], key: "sourceId" | "targetId"): Map<string, NormalizedLink[]> {
  const grouped = new Map<string, NormalizedLink[]>();
  for (const link of links) {
    const bucket = grouped.get(link[key]) ?? [];
    bucket.push(link);
    grouped.set(link[key], bucket);
  }
  return grouped;
}

function legendFor(lens: LensSpec): LegendItem[] {
  const baseLegend = CORE_PARA.map((para) => ({ id: para, label: PARA_LABELS[para], colorKey: PARA_COLORS[para], shape: lens.primitive === "flow" ? "line" as const : "circle" as const }));
  return lens.family === "evolution"
    ? [...baseLegend, { id: "added", label: "Added", colorKey: "added", stroke: "solid", shape: "line" }, { id: "removed", label: "Removed", colorKey: "removed", stroke: "dashed", shape: "line" }]
    : baseLegend;
}

function frontier(points: ScatterPoint[]): Array<{ x: number; y: number }> {
  let bestY = Number.POSITIVE_INFINITY;
  return points.filter((point) => {
    if (point.y < bestY) {
      bestY = point.y;
      return true;
    }
    return false;
  }).map((point) => ({ x: point.x, y: point.y }));
}

function safeMetric(item: MetricDatum): MetricDatum {
  return { ...item, value: item.value === null ? null : finite(item.value) };
}

function safeSegment(item: RadialSegment): RadialSegment {
  const result: RadialSegment = { ...item, value: finite(item.value) };
  if (item.secondaryValue !== undefined) result.secondaryValue = finite(item.secondaryValue);
  return result;
}

function safeNodes(nodes: GraphNode[]): GraphNode[] {
  return uniqueNodes(nodes).map((node) => {
    const safe: GraphNode = { ...node, value: finite(node.value) };
    if (node.x !== undefined) safe.x = finite(node.x);
    if (node.y !== undefined) safe.y = finite(node.y);
    return safe;
  });
}

function safeEdges(edges: GraphEdge[]): GraphEdge[] {
  return edges.map((edge) => ({ ...edge, value: finite(edge.value) }));
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  return uniqueNodesInOrder(nodes).sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueNodesInOrder(nodes: GraphNode[]): GraphNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  });
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, finite(value)));
}

function norm(value: number, denominator: number): number {
  return denominator <= 0 ? 0 : clamp(value / denominator, 0, 1) * 100;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function percentile(values: Array<number | null>): number | null {
  const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)] ?? null;
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function countUnique(values: string[]): number {
  return new Set(values).size;
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function maxModified(notes: NormalizedNote[]): number {
  return Math.max(0, ...notes.map((note) => note.modifiedTime ?? 0));
}

function confidenceFor(sampleSize: number): Confidence {
  return sampleSize > 0 ? "measured" : "unavailable";
}

function confidenceForReading(...values: Confidence[]): Confidence {
  if (values.includes("measured")) return "measured";
  if (values.includes("inferred")) return "inferred";
  return "unavailable";
}

function aggregateConfidence(values: Confidence[]): Confidence {
  const available = values.filter((value) => value !== "unavailable");
  if (available.length === 0) return "unavailable";
  return available.length === values.length && available.every((value) => value === "measured")
    ? "measured"
    : "inferred";
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function inRange(value: string | null, from: string | null, to: string | null): boolean {
  if (value === null) return from === null && to === null;
  const valueMs = Date.parse(value);
  if (!Number.isFinite(valueMs)) return false;
  const fromMs = from === null ? Number.NEGATIVE_INFINITY : Date.parse(from);
  const toMs = to === null ? Number.POSITIVE_INFINITY : Date.parse(to);
  if (Number.isFinite(fromMs) && valueMs < fromMs) return false;
  if (Number.isFinite(toMs) && valueMs > toMs) return false;
  return true;
}

function byNotePath(left: NormalizedNote, right: NormalizedNote): number {
  return left.path.localeCompare(right.path);
}

function byEntry(left: [string, unknown], right: [string, unknown]): number {
  return left[0].localeCompare(right[0]);
}

function evidenceId(path: string): string {
  return `note:${path}`;
}
