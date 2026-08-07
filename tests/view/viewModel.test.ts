import type { GraphSnapshot, QueryJourney } from "../../src/model";
import { metricReading } from "../../src/model";
import type { ObservatoryPluginSettings } from "../../src/plugin/contracts";
import { DEFAULT_SETTINGS, viewStateForPeriod } from "../../src/plugin/contracts";
import type { HitRegion, SemanticNode } from "../../src/render/canvas";
import { OBSERVATORY_LENSES } from "../../src/visualization/registry";
import type { ObservatoryDataset, ViewState } from "../../src/visualization/types";
import {
  availabilityForScene,
  buildLensRail,
  contextSummary,
  dwellBucketMs,
  kpisForScene,
  nextParaScope,
  nextQuerySelection,
  nextViewStateForPeriod,
  semanticMarkOrder,
  shouldStartPlayback
} from "../../src/view/viewModel";

describe("observatory view model", () => {
  const settings: ObservatoryPluginSettings = {
    ...DEFAULT_SETTINGS,
    favoriteLensIds: ["L23"],
    recentLensIds: ["L06"]
  };

  it("filters and groups the full lens registry with favorite and recent cues", () => {
    const groups = buildLensRail(OBSERVATORY_LENSES, "L23", dataset(), settings);
    const items = groups.flatMap((group) => group.items);
    expect(items).toHaveLength(24);
    expect(items.find((item) => item.id === "L23")?.favorite).toBe(true);
    expect(items.find((item) => item.id === "L06")?.recent).toBe(true);
    expect(items.find((item) => item.id === "L23")?.selected).toBe(true);

    const filtered = buildLensRail(OBSERVATORY_LENSES, "L08", dataset(), settings, "query").flatMap((group) => group.items);
    expect(filtered.map((item) => item.id)).toEqual(["L08"]);
  });

  it("marks unavailable lenses without removing them from the rail", () => {
    const limited = dataset(new Set(["vault-notes"]));
    const groups = buildLensRail(OBSERVATORY_LENSES, "L01", limited, settings);
    const all = groups.flatMap((group) => group.items);
    expect(all).toHaveLength(24);
    expect(all.find((item) => item.id === "L06")?.unavailable).toBe(true);
    expect(all.find((item) => item.id === "L06")?.missingCapabilities).toContain("query-aggregate");
  });

  it("updates period, PARA, and query view state without leaking query text", () => {
    const now = new Date("2026-08-05T00:00:00.000Z");
    const initial = viewStateForPeriod("30d", now);
    const period = nextViewStateForPeriod("7d", now, initial);
    const para = nextParaScope(period, "projects");
    const query = nextQuerySelection(para, "query-secret-title-1234");
    expect(query.from).toBe("2026-07-29T00:00:00.000Z");
    expect(query.paraScope).toEqual(["projects"]);
    expect(query.selectedQueryId).toBe("query-secret-title-1234");
    const summary = contextSummary(query, "7d", null, dataset());
    expect(summary.queryLabel).toBe("Query query-...1234");
    expect(summary.queryLabel).not.toContain("secret-title");
  });

  it("formats KPI and availability with confidence wording data available to the UI", () => {
    const lens = OBSERVATORY_LENSES[0];
    expect(lens).toBeDefined();
    const scene = lens!.buildModel(dataset(), state());
    const kpis = kpisForScene(scene);
    const availability = availabilityForScene(scene);
    expect(kpis[0]).toMatchObject({ id: "status", value: expect.any(String), confidence: expect.any(String) });
    expect(kpis.length).toBeGreaterThan(1);
    expect(availability[0]?.state).toMatch(/ready|partial|missing/);
  });

  it("keeps semantic mark order deterministic from renderer hit ordering", () => {
    const tree: SemanticNode = {
      id: "scene",
      role: "scene",
      label: "Scene",
      selected: false,
      disabled: false,
      children: [
        { id: "scene:status", role: "status", label: "ready", selected: false, disabled: false, children: [] },
        { id: "graph:b", role: "mark", label: "B", value: "measured", selected: false, disabled: false, children: [] },
        { id: "graph:a", role: "mark", label: "A", value: "inferred", selected: true, disabled: false, children: [] }
      ]
    };
    const hits: HitRegion[] = [
      hit("graph:b", "b", 2),
      hit("graph:a", "a", 1)
    ];
    expect(semanticMarkOrder(tree, hits).map((item) => `${item.markId}:${item.selected}`)).toEqual(["a:true", "b:false"]);
  });

  it("routes explicit visible playback to the controller, including reduced-motion snapping", () => {
    expect(shouldStartPlayback({ trigger: "replay", reducedMotion: false, hidden: false, width: 400, height: 300, userRequested: false })).toBe(false);
    expect(shouldStartPlayback({ trigger: "replay", reducedMotion: true, hidden: false, width: 400, height: 300, userRequested: true })).toBe(true);
    expect(shouldStartPlayback({ trigger: "replay", reducedMotion: false, hidden: true, width: 400, height: 300, userRequested: true })).toBe(false);
    expect(shouldStartPlayback({ trigger: "none", reducedMotion: false, hidden: false, width: 400, height: 300, userRequested: true })).toBe(false);
    expect(shouldStartPlayback({ trigger: "replay", reducedMotion: false, hidden: false, width: 400, height: 300, userRequested: true })).toBe(true);
  });

  it("records only dwell buckets instead of exact foreground dwell", () => {
    expect(dwellBucketMs(0)).toBe(0);
    expect(dwellBucketMs(10_000)).toBe(1);
    expect(dwellBucketMs(90_000)).toBe(30_000);
    expect(dwellBucketMs(400_000)).toBe(180_000);
  });
});

function state(): ViewState {
  return viewStateForPeriod("30d", new Date("2026-08-05T00:00:00.000Z"));
}

function dataset(capabilities = new Set([
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
] as const)): ObservatoryDataset {
  const snapshot: GraphSnapshot = {
    id: "snap-1",
    definitionVersion: "test",
    observedAt: "2026-08-05T00:00:00.000Z",
    scope: { id: "vault", label: "Vault" },
    notes: [
      note("0. Common/_index.md", "common", "index"),
      note("1. Projects/project.md", "projects", "content"),
      note("3. Resources/source.md", "resources", "content")
    ],
    links: [
      {
        id: "0. Common/_index.md->1. Projects/project.md",
        sourceId: "0. Common/_index.md",
        targetId: "1. Projects/project.md",
        sourcePath: "0. Common/_index.md",
        targetPath: "1. Projects/project.md",
        resolved: true,
        confidence: "measured"
      }
    ],
    metrics: []
  };
  return {
    current: snapshot,
    snapshots: [snapshot],
    diffs: [],
    journeys: [journey()],
    capabilities,
    generatedAt: "2026-08-05T00:00:00.000Z"
  };
}

function note(path: string, para: GraphSnapshot["notes"][number]["para"], role: GraphSnapshot["notes"][number]["role"]): GraphSnapshot["notes"][number] {
  return {
    id: path,
    path,
    title: path.split("/").at(-1) ?? path,
    para,
    role,
    tags: [],
    aliases: [],
    summary: null,
    sizeBytes: 100,
    createdTime: Date.parse("2026-08-01T00:00:00.000Z"),
    modifiedTime: Date.parse("2026-08-04T00:00:00.000Z"),
    confidence: "measured"
  };
}

function journey(): QueryJourney {
  return {
    queryId: "query-1",
    requestId: "request-1",
    sessionId: null,
    startedAt: "2026-08-04T00:00:00.000Z",
    endedAt: "2026-08-04T00:00:02.000Z",
    durationMs: metricReading(2000, "measured", "test"),
    inputTokens: metricReading(100, "measured", "test"),
    outputTokens: metricReading(50, "measured", "test"),
    totalTokens: metricReading(150, "measured", "test"),
    documentsReadCount: metricReading(2, "measured", "test"),
    searchStepCount: metricReading(1, "measured", "test"),
    completed: true,
    completionConfidence: "measured",
    tools: ["Read"],
    accessedPaths: ["1. Projects/project.md"],
    documentsReadPaths: ["1. Projects/project.md"],
    entrypoints: ["0. Common/_index.md"],
    buildSummary: null,
    steps: [],
    events: []
  };
}

function hit(id: string, markId: string, order: number): HitRegion {
  return {
    id,
    markId,
    label: markId,
    primitive: "graph",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    order,
    confidence: "measured"
  };
}
