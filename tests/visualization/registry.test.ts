import { describe, expect, it } from "vitest";
import {
  createObservatoryDataset,
  diffSnapshots,
  groupQueryJourneys,
  normalizePath,
  parseTelemetryJsonl,
  type GraphSnapshot,
  type NormalizedLink,
  type NormalizedNote,
  type ObservatoryDataset,
  type ParaCategory,
  type ViewState
} from "../../src";
import { DEFAULT_VIEW_STATE } from "../../src/visualization/types";
import { getLens, OBSERVATORY_LENSES } from "../../src/visualization/registry";

describe("observatory lens registry", () => {
  it("registers exactly the broad L01-L24 PRD catalog with family and primitive coverage", () => {
    expect(OBSERVATORY_LENSES).toHaveLength(24);
    expect(OBSERVATORY_LENSES.map((lens) => lens.id)).toEqual(
      Array.from({ length: 24 }, (_, index) => `L${String(index + 1).padStart(2, "0")}`)
    );
    expect(new Set(OBSERVATORY_LENSES.map((lens) => lens.id)).size).toBe(24);
    expect(new Set(OBSERVATORY_LENSES.map((lens) => lens.family))).toEqual(
      new Set(["structure", "recall", "evolution", "para", "efficiency"])
    );
    expect(new Set(OBSERVATORY_LENSES.map((lens) => lens.primitive))).toEqual(
      new Set(["graph", "radial", "flow", "timeline", "matrix", "scatter"])
    );
    expect(getLens("L01")?.title).toBe("PARA Brain Regions");
    expect(getLens("L01")?.family).toBe("structure");
    expect(getLens("L24")?.title).toBe("Document Burden");
  });

  it("builds deterministic scenes with inspector, legend, metrics, motion, and finite numbers", () => {
    const dataset = richDataset();
    const first = OBSERVATORY_LENSES.map((lens) => lens.buildModel(dataset, DEFAULT_VIEW_STATE));
    const second = OBSERVATORY_LENSES.map((lens) => lens.buildModel(dataset, DEFAULT_VIEW_STATE));

    expect(first).toEqual(second);
    for (const scene of first) {
      expect(scene.inspector.heading).toBe(scene.title);
      expect(scene.inspector.actions.length).toBeGreaterThan(0);
      expect(scene.legend.length).toBeGreaterThan(0);
      expect(scene.metrics.length).toBeGreaterThan(0);
      expect(scene.motion.userTriggered).toBe(true);
      expect(JSON.stringify(scene)).not.toMatch(/\bNaN\b|Infinity|-Infinity/);
      expect(JSON.stringify(scene)).not.toContain("private query text");
    }
  });

  it("returns explicit unavailable scenes instead of invented zeros when capabilities are absent", () => {
    const lens = getLens("L06");
    expect(lens).not.toBeNull();
    const scene = lens!.buildModel(
      { ...richDataset(), journeys: [], capabilities: new Set(["vault-notes", "vault-links", "para"]) },
      DEFAULT_VIEW_STATE
    );

    expect(scene.status).toBe("unavailable");
    expect(scene.missingCapabilities).toEqual(expect.arrayContaining(["query-aggregate", "query-steps", "query-paths"]));
    expect(scene.inspector.actions).toContain("capture-snapshot");
    expect(scene.summary).toContain("Requires");
    if (scene.primitive === "graph") {
      expect(scene.nodes).toEqual([]);
      expect(scene.edges).toEqual([]);
    }
  });

  it("activates recall and efficiency lenses from explicit QuerySummary and QueryComplete telemetry", () => {
    const dataset = richDataset();
    const recall = getLens("L06")!.buildModel(dataset, { ...DEFAULT_VIEW_STATE, selectedQueryId: "q1" });
    const frontier = getLens("L23")!.buildModel(dataset, DEFAULT_VIEW_STATE);

    expect(recall.status).toBe("ready");
    expect(recall.primitive).toBe("graph");
    expect(recall.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: "elapsed", value: 9_850 })]));
    expect(JSON.stringify(recall)).not.toContain("private query text");
    if (recall.primitive === "graph") {
      expect(recall.edges[0]).toEqual(expect.objectContaining({ source: "query:q1", target: "tool:0. Common/query-telemetry.jsonl:2", order: 0 }));
      expect(recall.edges[1]?.source).toBe(recall.edges[0]?.target);
      expect(recall.motion.keyframes.map((frame) => frame.markIds[0])).toEqual(recall.edges.map((edge) => edge.id));
      expect(recall.nodes.every((node) => node.x === undefined || (node.x >= 0 && node.x <= 1))).toBe(true);
    }

    expect(frontier.status).toBe("ready");
    expect(frontier.primitive).toBe("scatter");
    expect(frontier.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: "elapsed-p50", value: 9_850 })]));
  });

  it("normalizes mixed-offset recency and timeline days by timestamp instant", () => {
    const dataset = richDataset();
    const source = dataset.journeys.find((journey) => journey.queryId === "q1");
    if (!source) throw new Error("Missing q1 fixture journey.");
    const earlier = {
      ...source,
      queryId: "earlier-offset",
      startedAt: "2026-08-06T00:30:00.000+09:00",
      endedAt: "2026-08-06T00:30:05.000+09:00"
    };
    const later = {
      ...source,
      queryId: "later-utc",
      startedAt: "2026-08-05T16:00:00.000Z",
      endedAt: "2026-08-05T16:00:05.000Z"
    };
    const mixed = { ...dataset, journeys: [later, earlier] };

    const temperature = getLens("L10")!.buildModel(mixed, DEFAULT_VIEW_STATE);
    expect(temperature.primitive).toBe("matrix");
    if (temperature.primitive === "matrix") {
      expect(temperature.cells.find((cell) => cell.id === "1. Projects/demo/spec.md:recency")?.value)
        .toBe(Date.parse(later.startedAt));
    }

    const rhythm = getLens("L15")!.buildModel(mixed, DEFAULT_VIEW_STATE);
    expect(rhythm.primitive).toBe("timeline");
    if (rhythm.primitive === "timeline") {
      expect(rhythm.series.find((series) => series.id === "queries")?.points).toEqual([
        expect.objectContaining({ time: "2026-08-05", value: 2 })
      ]);
    }
  });

  it("keeps diff and history lenses unavailable when only one snapshot exists", () => {
    const oneSnapshot = { ...richDataset(), snapshots: [richDataset().current], diffs: [] };
    const diff = getLens("L11")!.buildModel(oneSnapshot, DEFAULT_VIEW_STATE);
    const growth = getLens("L12")!.buildModel(oneSnapshot, DEFAULT_VIEW_STATE);

    expect(diff.status).toBe("unavailable");
    expect(diff.missingCapabilities).toContain("snapshots");
    expect(growth.status).toBe("unavailable");
    expect(growth.missingCapabilities).toContain("snapshot-history");
  });

  it("emphasizes PARA activation and index coverage from local structure", () => {
    const dataset = richDataset();
    const para = getLens("L01")!.buildModel(dataset, DEFAULT_VIEW_STATE);
    const coverage = getLens("L03")!.buildModel(dataset, DEFAULT_VIEW_STATE);

    expect(para.primitive).toBe("radial");
    expect(JSON.stringify(para)).toContain("Projects");
    expect(JSON.stringify(para)).toContain("Common");
    expect(para.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "activation-projects", unit: "/100", confidence: "inferred" }),
        expect.objectContaining({ id: "activation-resources", unit: "/100", confidence: "inferred" })
      ])
    );
    expect(para.confidence).toBe("inferred");
    expect(getLens("L05")!.buildModel(dataset, DEFAULT_VIEW_STATE).confidence).toBe("inferred");
    expect(coverage.status).toBe("ready");
    expect(coverage.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: "coverage" })]));
  });

  it("honors selected query and PARA filters where applicable", () => {
    const dataset = richDataset();
    const state: ViewState = { ...DEFAULT_VIEW_STATE, selectedQueryId: "q2", paraScope: ["archive"] };
    const recall = getLens("L06")!.buildModel(dataset, state);
    const archive = getLens("L19")!.buildModel(dataset, state);

    expect(recall.status).toBe("ready");
    expect(JSON.stringify(recall)).toContain("archive-note.md");
    expect(archive.status).toBe("ready");
    expect(archive.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: "reactivated", value: 1 })]));
  });

  it("keeps query constellation distinct from the efficiency frontier and expands tool/source columns", () => {
    const dataset = richDataset();
    const constellation = getLens("L08")!.buildModel(dataset, DEFAULT_VIEW_STATE);
    const frontier = getLens("L23")!.buildModel(dataset, DEFAULT_VIEW_STATE);
    const toolFlow = getLens("L09")!.buildModel(dataset, DEFAULT_VIEW_STATE);

    expect(constellation.primitive).toBe("scatter");
    expect(frontier.primitive).toBe("scatter");
    if (constellation.primitive === "scatter" && frontier.primitive === "scatter") {
      expect(constellation.xLabel).toBe("Document-signature axis");
      expect(constellation.points.map(({ x, y }) => [x, y])).not.toEqual(
        frontier.points.map(({ x, y }) => [x, y])
      );
    }
    if (toolFlow.primitive === "flow") {
      expect(toolFlow.stages.map((stage) => stage.id)).toEqual(
        expect.arrayContaining(["query", "tool:Bash", "source:content"])
      );
    }
  });

  it("infers capabilities from observed evidence rather than caller guesses", () => {
    const source = richDataset();
    const inferred = createObservatoryDataset({
      current: source.current,
      snapshots: source.snapshots,
      diffs: source.diffs,
      journeys: source.journeys,
      generatedAt: source.generatedAt
    });

    expect([...inferred.capabilities]).toEqual(
      expect.arrayContaining([
        "vault-notes",
        "vault-links",
        "para",
        "indexes",
        "snapshot-history",
        "query-paths",
        "query-timing",
        "query-tokens",
        "tool-usage"
      ])
    );
  });
});

function richDataset(): ObservatoryDataset {
  const current = snapshot("after", [
    note("0. Common/index.md", "common", "index", 1000, 1000),
    note("1. Projects/demo/_index.md", "projects", "index", 1200, 2000),
    note("1. Projects/demo/spec.md", "projects", "content", 2200, 3000),
    note("2. Areas/idea/_index.md", "areas", "index", 900, 4000),
    note("3. Resources/topic/Note.md", "resources", "content", 1800, 5000),
    note("4. Archive/old/archive-note.md", "archive", "content", 1400, 6000),
    note("3. Resources/topic/orphan.md", "resources", "content", 700, 7000)
  ]);
  current.links = [
    link("0. Common/index.md", "1. Projects/demo/_index.md"),
    link("0. Common/index.md", "2. Areas/idea/_index.md"),
    link("1. Projects/demo/_index.md", "1. Projects/demo/spec.md"),
    link("1. Projects/demo/spec.md", "3. Resources/topic/Note.md"),
    link("4. Archive/old/archive-note.md", "3. Resources/topic/Note.md")
  ];

  const before = snapshot("before", [
    note("0. Common/index.md", "common", "index", 1000, 1000),
    note("1. Projects/demo/_index.md", "projects", "index", 1200, 2000),
    note("1. Projects/demo/spec.md", "projects", "content", 2200, 3000),
    note("3. Resources/topic/Note.md", "resources", "content", 1800, 5000),
    note("4. Archive/old/archive-note.md", "archive", "content", 1400, 6000)
  ]);
  before.links = [
    link("0. Common/index.md", "1. Projects/demo/_index.md"),
    link("1. Projects/demo/_index.md", "1. Projects/demo/spec.md")
  ];

  const telemetry = [
    JSON.stringify({
      event: "QueryStart",
      operation_id: "q1",
      query_id: "turn-1",
      timestamp: "2026-08-05T01:00:00.000Z"
    }),
    JSON.stringify({
      event: "PostToolUse",
      query_id: "turn-1",
      operation_id: "q1",
      timestamp: "2026-08-05T01:00:01.000Z",
      tool_name: "Bash",
      vault_paths: ["0. Common/index.md"],
      command_vault_paths: ["1. Projects/demo/_index.md"],
      output_vault_paths: ["1. Projects/demo/spec.md"]
    }),
    JSON.stringify({
      event: "QuerySummary",
      query_id: "turn-1",
      operation_id: "q1",
      timestamp: "2026-08-05T01:00:02.000Z",
      documents_read_count: 2,
      documents_read_paths: ["1. Projects/demo/spec.md", "3. Resources/topic/Note.md"],
      entrypoints: ["0. Common/index.md"],
      search_step_count: 1,
      confidence: "high",
      query: "private query text"
    }),
    JSON.stringify({
      event: "QueryComplete",
      query_id: "turn-1",
      operation_id: "q1",
      timestamp: "2026-08-05T01:00:03.000Z",
      operation_elapsed_ms: 9_850,
      token_is_operation_delta: true,
      token_reliability: "high",
      token_total_for_analysis: 4_800
    }),
    JSON.stringify({
      event: "Stop",
      query_id: "turn-1",
      timestamp: "2026-08-05T01:10:00.000Z",
      turn_elapsed_ms: 600_000,
      token_is_request_delta: true,
      token_reliability: "high",
      token_total_for_analysis: 720365
    }),
    JSON.stringify({
      event: "QueryStart",
      operation_id: "q2",
      query_id: "turn-2",
      timestamp: "2026-08-05T02:00:00.000Z"
    }),
    JSON.stringify({
      event: "PostToolUse",
      query_id: "turn-2",
      operation_id: "q2",
      timestamp: "2026-08-05T02:00:01.000Z",
      tool_name: "Bash",
      vault_paths: ["4. Archive/old/archive-note.md"]
    }),
    JSON.stringify({
      event: "QuerySummary",
      query_id: "turn-2",
      operation_id: "q2",
      timestamp: "2026-08-05T02:00:02.000Z",
      documents_read_count: 1,
      documents_read_paths: ["4. Archive/old/archive-note.md"],
      entrypoints: ["4. Archive/old/archive-note.md"],
      search_step_count: 1,
      confidence: "high"
    }),
    JSON.stringify({
      event: "QueryComplete",
      query_id: "turn-2",
      operation_id: "q2",
      timestamp: "2026-08-05T02:00:03.000Z",
      operation_elapsed_ms: 22_000,
      token_is_operation_delta: true,
      token_reliability: "high",
      token_total_for_analysis: 1000
    })
  ].join("\n");

  return {
    current,
    snapshots: [before, current],
    diffs: [diffSnapshots(before, current)],
    journeys: groupQueryJourneys(parseTelemetryJsonl(telemetry, "0. Common/query-telemetry.jsonl")),
    capabilities: new Set([
      "vault-notes",
      "vault-links",
      "para",
      "indexes",
      "file-stats",
      "file-times",
      "snapshots",
      "snapshot-history",
      "query-aggregate",
      "query-paths",
      "query-steps",
      "query-timing",
      "query-tokens",
      "tool-usage",
      "tool-timing"
    ]),
    generatedAt: "2026-08-05T03:00:00.000Z"
  };
}

function snapshot(id: string, notes: NormalizedNote[]): GraphSnapshot {
  return {
    id,
    definitionVersion: "test-v1",
    scope: { id: "vault", label: "Vault" },
    observedAt: `2026-08-05T00:00:00.000Z`,
    notes,
    links: [],
    metrics: []
  };
}

function note(path: string, para: ParaCategory, role: NormalizedNote["role"], sizeBytes: number, modifiedTime: number): NormalizedNote {
  return {
    id: normalizePath(path),
    path: normalizePath(path),
    title: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
    para,
    role,
    tags: [],
    aliases: [],
    summary: null,
    sizeBytes,
    createdTime: modifiedTime - 500,
    modifiedTime,
    confidence: "measured"
  };
}

function link(sourcePath: string, targetPath: string): NormalizedLink {
  return {
    id: `${sourcePath}->${targetPath}`,
    sourceId: normalizePath(sourcePath),
    targetId: normalizePath(targetPath),
    sourcePath: normalizePath(sourcePath),
    targetPath: normalizePath(targetPath),
    resolved: true,
    confidence: "measured"
  };
}
