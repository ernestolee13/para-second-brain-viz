import { describe, expect, it } from "vitest";
import type {
  GraphSnapshot,
  NormalizedLink,
  NormalizedNote,
  ParaCategory,
  QueryJourney,
  QueryTelemetryEvent
} from "../../src/model";
import type { ObservatoryDataset } from "../../src/visualization/types";
import {
  aggregateConstructionReplayTrack,
  aggregateReplayTrack,
  aggregateSimulatedQueryTrack,
  aggregateSimulatedPlacementTrack,
  buildConcurrentReplayParaReach,
  buildConcurrentReplayStates,
  buildConstructionHealth,
  buildConstructionReplayTracks,
  buildGrowthReplay,
  buildGrowthReplayState,
  buildKnowledgeAudit,
  buildQueryReplayTracks,
  buildReplayParaReach,
  buildRegionActivity,
  buildSimulatedQueryTracks,
  buildSimulatedPlacementTracks,
  buildStructuredGraph
} from "../../src/core-graph/model";

const OPTIONS = {
  paraRoots: [
    { para: "common" as const, prefix: "0. Common/" },
    { para: "projects" as const, prefix: "1. Projects/" },
    { para: "areas" as const, prefix: "2. Areas/" },
    { para: "resources" as const, prefix: "3. Resources/" },
    { para: "archive" as const, prefix: "4. Archive/" }
  ],
  indexFileNames: ["index.md", "_index.md"]
};

describe("core Graph View semantic model", () => {
  it("seeds the vault spine and stable PARA sectors instead of treating every index equally", () => {
    const notes = [
      note("AGENTS.md", "unknown"),
      note("CLAUDE.md", "unknown"),
      note("0. Common/log.md", "common", "log"),
      note("0. Common/index.md", "common", "index"),
      note("1. Projects/_index.md", "projects", "index"),
      note("1. Projects/observatory/_index.md", "projects", "index"),
      note("1. Projects/observatory/Overview.md", "projects"),
      note("1. Projects/atlas/_index.md", "projects", "index"),
      note("1. Projects/atlas/research/Corpus.md", "projects"),
      note("2. Areas/_index.md", "areas", "index"),
      note("2. Areas/Health/Plan.md", "areas"),
      note("3. Resources/_index.md", "resources", "index"),
      note("3. Resources/Graph/Notes.md", "resources"),
      note("4. Archive/_index.md", "archive", "index"),
      note("4. Archive/Old/Decision.md", "archive"),
      note("Inbox/Capture.md", "inbox"),
      note("Loose note.md", "unknown")
    ];
    const dataset = data(notes, [
      link("0. Common/index.md", "1. Projects/_index.md"),
      link("1. Projects/_index.md", "1. Projects/observatory/_index.md"),
      link("1. Projects/observatory/_index.md", "1. Projects/observatory/Overview.md")
    ]);

    const first = buildStructuredGraph(dataset, OPTIONS);
    const second = buildStructuredGraph(dataset, OPTIONS);
    const byPath = new Map(first.nodes.map((node) => [node.path, node]));

    expect(byPath.get("AGENTS.md")?.tier).toBe("spine");
    expect(byPath.get("AGENTS.md")?.para).toBe("common");
    expect(byPath.get("CLAUDE.md")?.label).toBe("KB Guide");
    expect(byPath.get("CLAUDE.md")?.para).toBe("common");
    expect(byPath.get("0. Common/index.md")?.tier).toBe("kb-root");
    expect(byPath.get("1. Projects/_index.md")?.tier).toBe("para-root");
    expect(byPath.get("1. Projects/observatory/_index.md")?.tier).toBe("hub-index");
    expect(byPath.get("1. Projects/observatory/Overview.md")?.tier).toBe("content");

    expect(byPath.get("1. Projects/observatory/Overview.md")?.clusterId).toBe("projects:observatory");
    expect(byPath.get("1. Projects/atlas/_index.md")?.clusterId).toBe("projects:atlas");
    expect(byPath.get("1. Projects/atlas/research/Corpus.md")?.clusterId).toBe("projects:atlas");
    expect(first.clusters.find((cluster) => cluster.id === "projects:atlas")).toMatchObject({
      label: "atlas",
      memberPaths: expect.arrayContaining([
        "1. Projects/atlas/_index.md",
        "1. Projects/atlas/research/Corpus.md"
      ])
    });
    expect(byPath.get("2. Areas/Health/Plan.md")?.x).toBeGreaterThan(0);
    expect(byPath.get("2. Areas/Health/Plan.md")?.y).toBeLessThan(0);
    expect(byPath.get("1. Projects/observatory/Overview.md")?.x).toBeGreaterThan(0);
    expect(byPath.get("1. Projects/observatory/Overview.md")?.y).toBeGreaterThan(0);
    expect(byPath.get("3. Resources/Graph/Notes.md")?.x).toBeLessThan(0);
    expect(byPath.get("3. Resources/Graph/Notes.md")?.y).toBeGreaterThan(0);
    expect(byPath.get("4. Archive/Old/Decision.md")?.x).toBeLessThan(0);
    expect(byPath.get("4. Archive/Old/Decision.md")?.y).toBeLessThan(0);

    const sectorOuterRadius = first.regions.find((region) => region.para === "projects")?.outerRadius ?? 0;
    for (const path of [
      "1. Projects/_index.md",
      "2. Areas/_index.md",
      "3. Resources/_index.md",
      "4. Archive/_index.md"
    ]) {
      const node = byPath.get(path);
      const radius = Math.hypot(node?.x ?? 0, node?.y ?? 0);
      expect(radius).toBeGreaterThan(sectorOuterRadius * 0.32);
      expect(radius).toBeLessThan(sectorOuterRadius * 0.36);
      expect(Math.abs(Math.abs(node?.x ?? 0) - Math.abs(node?.y ?? 0))).toBeLessThan(sectorOuterRadius * 0.01);
    }
    for (const path of [
      "1. Projects/observatory/Overview.md",
      "2. Areas/Health/Plan.md",
      "3. Resources/Graph/Notes.md",
      "4. Archive/Old/Decision.md"
    ]) {
      const node = byPath.get(path);
      expect(node).toBeDefined();
      expect(Math.hypot(node?.x ?? 0, node?.y ?? 0)).toBeGreaterThan(sectorOuterRadius * 0.47);
    }

    const kbRoot = byPath.get("0. Common/index.md");
    const guide = byPath.get("CLAUDE.md");
    expect(Math.hypot(kbRoot?.x ?? 0, kbRoot?.y ?? 0)).toBeLessThan(sectorOuterRadius * 0.01);
    expect(Math.hypot(guide?.x ?? 0, guide?.y ?? 0)).toBeGreaterThan(0);
    expect(Math.hypot(guide?.x ?? 0, guide?.y ?? 0)).toBeLessThan(
      first.regions.find((region) => region.para === "common")?.outerRadius ?? 0
    );
    expect(byPath.get("Inbox/Capture.md")?.y).toBeLessThan(-sectorOuterRadius);
    expect(Math.abs(byPath.get("Inbox/Capture.md")?.x ?? 0)).toBeLessThan(sectorOuterRadius * 0.01);
    expect(byPath.get("Loose note.md")?.y).toBeGreaterThan(sectorOuterRadius);
    expect(Math.abs(byPath.get("Loose note.md")?.x ?? 0)).toBeLessThan(sectorOuterRadius * 0.01);
    expect(first.corePaths).toEqual([
      "0. Common/index.md",
      "AGENTS.md",
      "CLAUDE.md",
      "0. Common/log.md"
    ]);

    expect(first.nodes.map(({ path, x, y }) => ({ path, x, y }))).toEqual(
      second.nodes.map(({ path, x, y }) => ({ path, x, y }))
    );
    expect(first.hierarchyEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "CLAUDE.md", targetPath: "0. Common/index.md", kind: "spine" }),
      expect.objectContaining({ sourcePath: "0. Common/index.md", targetPath: "1. Projects/_index.md", kind: "hierarchy" }),
      expect.objectContaining({ sourcePath: "1. Projects/_index.md", targetPath: "1. Projects/observatory/_index.md", kind: "hierarchy" })
    ]));
  });

  it("derives the same graph and replay semantics from a non-numbered portable schema", () => {
    const portableOptions = {
      paraRoots: [
        { para: "common" as const, prefix: "Core/" },
        { para: "projects" as const, prefix: "Work/" },
        { para: "areas" as const, prefix: "Domains/" },
        { para: "resources" as const, prefix: "Library/" },
        { para: "archive" as const, prefix: "ColdStorage/" },
        { para: "inbox" as const, prefix: "Intake/" }
      ],
      indexFileNames: ["hub.md"],
      spinePaths: ["RULES.md", "Core/activity-log.md"]
    };
    const indexedWorkNote = note("Work/alpha/Topic 1.md", "projects");
    const notes = [
      note("RULES.md", "unknown"),
      note("Core/activity-log.md", "common", "log"),
      note("Core/hub.md", "common", "index"),
      note("Work/hub.md", "projects", "index"),
      note("Work/alpha/hub.md", "projects", "index"),
      note("Domains/hub.md", "areas", "index"),
      note("Library/hub.md", "resources", "index"),
      note("ColdStorage/hub.md", "archive", "index"),
      indexedWorkNote,
      ...Array.from({ length: 5 }, (_, index) => note(`Work/${index % 2 === 0 ? "alpha" : "beta"}/Topic ${index + 2}.md`, "projects")),
      ...Array.from({ length: 5 }, (_, index) => note(`Domains/Practice ${index + 1}.md`, "areas")),
      ...Array.from({ length: 5 }, (_, index) => note(`Library/Reference ${index + 1}.md`, "resources")),
      ...Array.from({ length: 4 }, (_, index) => note(`ColdStorage/Record ${index + 1}.md`, "archive"))
    ];
    const dataset = data(notes, [
      link("Core/hub.md", "Work/hub.md"),
      link("Work/hub.md", "Work/alpha/hub.md"),
      link("Work/alpha/hub.md", indexedWorkNote.path),
      link("Library/hub.md", "Library/Reference 1.md")
    ]);

    const model = buildStructuredGraph(dataset, portableOptions);
    const byPath = new Map(model.nodes.map((node) => [node.path, node]));
    expect(byPath.get("RULES.md")).toMatchObject({ tier: "spine", para: "common" });
    expect(byPath.get("Core/activity-log.md")?.tier).toBe("spine");
    expect(byPath.get("Core/hub.md")?.tier).toBe("kb-root");
    expect(byPath.get("Work/hub.md")?.tier).toBe("para-root");
    expect(byPath.get("Work/alpha/hub.md")?.tier).toBe("hub-index");
    expect(model.hierarchyEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "RULES.md", targetPath: "Core/hub.md", kind: "spine" }),
      expect.objectContaining({ sourcePath: "Core/hub.md", targetPath: "Work/hub.md", kind: "hierarchy" })
    ]));

    const health = buildConstructionHealth(dataset, portableOptions, null, null);
    expect(health.notes.find((item) => item.path === indexedWorkNote.path)).toMatchObject({
      expectedIndexPath: "Work/alpha/hub.md",
      indexed: true
    });

    const queryTracks = buildSimulatedQueryTracks(dataset, portableOptions, 20);
    const placementTracks = buildSimulatedPlacementTracks(dataset, portableOptions, 20);
    expect(queryTracks).toHaveLength(20);
    expect(placementTracks).toHaveLength(20);
    expect(placementTracks.some((track) => track.segments.some((segment) =>
      segment.sourcePath === "RULES.md" && segment.targetPath === "Core/hub.md"))).toBe(true);
    const replayPaths = [...queryTracks, ...placementTracks]
      .flatMap((track) => track.segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]));
    expect(replayPaths.some((path) => /^(0\. Common|1\. Projects|2\. Areas|3\. Resources|4\. Archive)|^(CLAUDE|AGENTS)\.md/.test(path))).toBe(false);
  });

  it("identifies relatively underactive PARA regions for a selected period", () => {
    const now = Date.parse("2026-08-06T00:00:00.000Z");
    const notes = [
      note("0. Common/index.md", "common", "index", now),
      note("1. Projects/_index.md", "projects", "index", now),
      note("1. Projects/A.md", "projects", "content", now),
      note("2. Areas/_index.md", "areas", "index", now - 2 * 86_400_000),
      note("3. Resources/_index.md", "resources", "index", now - 40 * 86_400_000),
      note("4. Archive/_index.md", "archive", "index", now - 400 * 86_400_000)
    ];
    const journeys = [
      journey("q1", ["1. Projects/_index.md", "1. Projects/A.md"], [], 1_000),
      journey("q2", ["1. Projects/A.md", "2. Areas/_index.md"], [], 2_000)
    ];
    const dataset = data(notes, [
      link("0. Common/index.md", "1. Projects/_index.md"),
      link("1. Projects/A.md", "3. Resources/_index.md")
    ], journeys);

    const activity = buildRegionActivity(dataset, "2026-07-07T00:00:00.000Z", "2026-08-06T23:59:59.000Z");
    const byPara = new Map(activity.map((item) => [item.para, item]));

    expect(byPara.get("projects")?.score).toBeGreaterThan(byPara.get("archive")?.score ?? 0);
    expect(byPara.get("archive")?.relative).toBe("low");
    expect(byPara.get("projects")?.queryTouches).toBe(2);
  });

  it("replays note creation time and only uses stored snapshot diffs for added edges", () => {
    const oldNote = note("1. Projects/alpha/_index.md", "projects", "index", Date.parse("2026-07-01T00:00:00.000Z"));
    const newNote = note("1. Projects/alpha/New.md", "projects", "content", Date.parse("2026-08-04T12:00:00.000Z"));
    const addedLink = link(oldNote.path, newNote.path);
    const dataset = data([oldNote, newNote], [addedLink]);
    const before: GraphSnapshot = {
      ...dataset.current,
      id: "snapshot:before",
      observedAt: "2026-08-01T00:00:00.000Z",
      notes: [oldNote],
      links: []
    };
    dataset.snapshots = [before, dataset.current];
    dataset.diffs = [{
      beforeId: before.id,
      afterId: dataset.current.id,
      addedNotes: [newNote],
      removedNotes: [],
      changedNotes: [],
      addedLinks: [addedLink],
      removedLinks: [],
      metrics: {
        noteDelta: 1,
        linkDelta: 1,
        resolvedLinkDelta: 1,
        unresolvedLinkDelta: 0
      }
    }];

    const replay = buildGrowthReplay(dataset, "2026-08-01T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
    expect(replay.noteEvents.map((event) => event.targetPath)).toEqual([newNote.path]);
    expect(replay.linkEvents).toEqual([expect.objectContaining({
      sourcePath: oldNote.path,
      targetPath: newNote.path,
      observedAt: dataset.current.observedAt
    })]);
    expect(replay.edgeHistoryAvailable).toBe(true);
    const complete = buildGrowthReplayState(replay, 1);
    expect(complete.revealedNotes).toEqual(new Set([newNote.path]));
    expect(complete.revealedLinks).toHaveLength(1);

    const withoutHistory = buildGrowthReplay(data([oldNote, newNote], [addedLink]), "2026-08-01T00:00:00.000Z", "2026-08-06T00:00:00.000Z");
    expect(withoutHistory.edgeHistoryAvailable).toBe(false);
    expect(withoutHistory.linkEvents).toHaveLength(0);
  });

  it("separates structural isolation from Search, Ingest, and mtime inactivity", () => {
    const recent = Date.parse("2026-08-05T00:00:00.000Z");
    const old = Date.parse("2025-01-01T00:00:00.000Z");
    const search = journey("audit-search", ["1. Projects/Search Active.md"]);
    const build = journey("audit-build", ["0. Common/index.md", "1. Projects/Ingest Active.md"]);
    build.buildSummary = {
      schemaVersion: 1,
      operationType: "update",
      route: "kb-ingest",
      kbIngestUsed: true,
      referencePaths: [],
      createdPaths: ["1. Projects/Ingest Active.md"],
      updatedPaths: [],
      movedFromPaths: [],
      movedToPaths: [],
      indexPaths: ["1. Projects/_index.md"],
      linkPairs: [],
      linksAdded: reading(0),
      backlinksAdded: reading(0),
      frontmatterCompleted: reading(0),
      summariesCompleted: reading(0),
      validation: "passed",
      confidence: "measured"
    };
    const dataset = data([
      note("0. Common/index.md", "common", "index", recent),
      note("1. Projects/_index.md", "projects", "index", old),
      note("1. Projects/Linked.md", "projects", "content", old),
      note("1. Projects/Orphan outgoing.md", "projects", "content", old),
      note("1. Projects/Unlinked.md", "projects", "content", old),
      note("1. Projects/Search Active.md", "projects", "content", old),
      note("1. Projects/Ingest Active.md", "projects", "content", old)
    ], [
      link("0. Common/index.md", "1. Projects/_index.md"),
      link("1. Projects/_index.md", "1. Projects/Linked.md"),
      link("1. Projects/Orphan outgoing.md", "1. Projects/Linked.md")
    ], [search, build]);

    const audit = buildKnowledgeAudit(
      dataset,
      "2026-07-07T00:00:00.000Z",
      "2026-08-06T23:59:59.000Z"
    );
    const byPath = new Map(audit.nodes.map((item) => [item.path, item]));

    expect(byPath.get("1. Projects/Orphan outgoing.md")).toMatchObject({
      orphan: true,
      unlinked: false,
      inactive: true,
      coldIsolated: true
    });
    expect(byPath.get("1. Projects/Unlinked.md")).toMatchObject({
      orphan: true,
      unlinked: true,
      coldIsolated: true
    });
    expect(byPath.get("1. Projects/Search Active.md")).toMatchObject({
      searchTouches: 1,
      searchDormant: false,
      inactive: false
    });
    expect(byPath.get("1. Projects/Ingest Active.md")).toMatchObject({
      ingestTouches: 1,
      ingestDormant: false,
      inactive: false
    });
    expect(byPath.get("0. Common/index.md")?.modifiedInPeriod).toBe(true);
    expect(audit).toMatchObject({
      queryRuns: 1,
      loggedBuilds: 1,
      searchTelemetryAvailable: true,
      ingestTelemetryAvailable: true
    });
  });

  it("replays edges while keeping graph nodes stable and compresses relative latency", () => {
    const paths = [
      "1. Projects/_index.md",
      "1. Projects/A.md",
      "3. Resources/Reference.md"
    ];
    const notes = [
      note(paths[0] as string, "projects", "index"),
      note(paths[1] as string, "projects"),
      note(paths[2] as string, "resources")
    ];
    const query = journey("q-latency", paths, [50, 5_000], 5_050);
    const dataset = data(notes, [link(paths[0] as string, paths[1] as string)], [query]);

    const tracks = buildQueryReplayTracks(dataset, null, null);
    const track = tracks[0];

    expect(track?.segments).toHaveLength(2);
    expect(track?.segments[0]).toMatchObject({ relation: "linked-pair", visualDurationMs: 240 });
    expect(track?.segments[1]).toMatchObject({ relation: "retrieval-transition", visualDurationMs: 1200 });
    expect(track?.uniquePaths).toBe(3);
    expect(track?.paraSpan).toBe(2);
    expect(track?.reachPerSecond).toBeCloseTo(3 / 5.05);

    const period = aggregateReplayTrack(tracks);
    expect(period?.segments.map((segment) => segment.targetPath)).toEqual(paths.slice(1));
    expect(period?.queryIds).toEqual(["q-latency"]);

    const model = buildStructuredGraph(dataset, OPTIONS);
    const readyReach = buildReplayParaReach(track ?? null, model.nodes, 0);
    expect(new Map(readyReach.map((item) => [item.para, item])).get("projects")).toMatchObject({ current: 0, total: 2 });
    const firstStepReach = buildReplayParaReach(track ?? null, model.nodes, 1);
    expect(new Map(firstStepReach.map((item) => [item.para, item])).get("projects")).toMatchObject({ current: 2, total: 2 });
    expect(new Map(firstStepReach.map((item) => [item.para, item])).get("resources")).toMatchObject({ current: 0, total: 1 });
  });

  it("starts period queries together while preserving relative completion time and cumulative PARA reach", () => {
    const paths = [
      "1. Projects/demo/_index.md",
      "1. Projects/demo/Decision.md",
      "3. Resources/Reference.md"
    ];
    const fast = journey("fast", paths.slice(0, 2), [100], 1_000);
    const slow = journey("slow", [paths[0] as string, paths[2] as string], [5_000], 10_000);
    const dataset = data([
      note(paths[0] as string, "projects", "index"),
      note(paths[1] as string, "projects"),
      note(paths[2] as string, "resources")
    ], [], [fast, slow]);
    const tracks = buildQueryReplayTracks(dataset, null, null);
    const model = buildStructuredGraph(dataset, OPTIONS);

    const ready = buildConcurrentReplayStates(tracks, 0);
    expect(ready).toHaveLength(2);
    expect(ready.every((state) => state.progress === 0)).toBe(true);

    const halfway = buildConcurrentReplayStates(tracks, 0.5);
    const byId = new Map(halfway.map((state) => [state.track.id, state]));
    expect(byId.get("fast")?.completed).toBe(true);
    expect(byId.get("slow")?.completed).toBe(false);
    expect(byId.get("fast")?.finishAt).toBeLessThan(byId.get("slow")?.finishAt ?? 0);

    const reach = buildConcurrentReplayParaReach(halfway, model.nodes, true);
    const byPara = new Map(reach.map((item) => [item.para, item]));
    expect(byPara.get("projects")).toMatchObject({ current: 2, total: 2 });
    expect(byPara.get("resources")).toMatchObject({ current: 1, total: 1 });
  });

  it("aggregates the complete caller-selected replay set instead of silently capping it at twenty", () => {
    const paths = ["1. Projects/demo/_index.md", "1. Projects/demo/Decision.md"];
    const dataset = data([
      note(paths[0] as string, "projects", "index"),
      note(paths[1] as string, "projects")
    ], [], Array.from({ length: 25 }, (_, index) => {
      const item = journey(`batch-${index + 1}`, paths);
      item.startedAt = new Date(Date.parse("2026-08-05T00:00:00.000Z") + index * 60_000).toISOString();
      return item;
    }));

    const selected = buildQueryReplayTracks(dataset, null, null);
    const aggregate = aggregateReplayTrack(selected);

    expect(selected).toHaveLength(25);
    expect(aggregate?.queryIds).toHaveLength(25);
    expect(aggregate?.label).toBe("Period activity · 25 queries");
  });

  it("orders replay tracks by timestamp instant across mixed ISO offsets", () => {
    const paths = ["1. Projects/_index.md", "1. Projects/A.md"];
    const earlier = journey("earlier", paths);
    earlier.startedAt = "2026-08-06T10:00:00.000+09:00";
    const later = journey("later", paths);
    later.startedAt = "2026-08-06T01:30:00.000Z";

    const tracks = buildQueryReplayTracks(
      data([note(paths[0] as string, "projects", "index"), note(paths[1] as string, "projects")], [], [later, earlier]),
      null,
      null
    );

    expect(tracks.map((track) => track.id)).toEqual(["earlier", "later"]);
  });

  it("scores current construction integration and replays logged reference, index, and link evidence", () => {
    const now = Date.parse("2026-08-06T00:00:00.000Z");
    const healthy = { ...note("1. Projects/demo/Healthy.md", "projects", "content", now), summary: "Integrated note." };
    const isolated = note("1. Projects/demo/Isolated.md", "projects", "content", now);
    const build = journey("build-1", ["0. Common/index.md", healthy.path], [2_000], 2_000);
    build.buildSummary = {
      schemaVersion: 1,
      operationType: "create",
      route: "kb-ingest",
      kbIngestUsed: true,
      referencePaths: ["CLAUDE.md"],
      createdPaths: [],
      updatedPaths: ["CLAUDE.md", "0. Common/log.md", "1. Projects/demo/_log.md"],
      movedFromPaths: ["Inbox/Healthy.md"],
      movedToPaths: [healthy.path],
      indexPaths: ["1. Projects/demo/_index.md"],
      linkPairs: [{ sourcePath: "1. Projects/demo/_index.md", targetPath: healthy.path }],
      linksAdded: reading(2),
      backlinksAdded: reading(1),
      frontmatterCompleted: reading(1),
      summariesCompleted: reading(1),
      validation: "passed",
      confidence: "measured"
    };
    build.startedAt = "2026-08-06T10:28:35+09:00";
    build.endedAt = "2026-08-06T10:29:00+09:00";
    const dataset = data([
      note("CLAUDE.md", "unknown"),
      note("0. Common/log.md", "common", "log", now),
      note("0. Common/index.md", "common", "index", now),
      note("1. Projects/_index.md", "projects", "index", now),
      note("1. Projects/demo/_index.md", "projects", "index", now),
      note("1. Projects/demo/_log.md", "projects", "log", now),
      healthy,
      isolated
    ], [
      link("1. Projects/demo/_index.md", healthy.path)
    ], [build]);

    const health = buildConstructionHealth(
      dataset,
      OPTIONS,
      "2026-07-07T00:00:00.000Z",
      "2026-08-06T01:30:00.000Z"
    );
    const byPath = new Map(health.notes.map((item) => [item.path, item]));
    expect(byPath.get(healthy.path)).toMatchObject({
      expectedIndexPath: "1. Projects/demo/_index.md",
      indexed: true,
      linked: true,
      summaryReady: true,
      status: "healthy"
    });
    expect(byPath.get(isolated.path)?.status).toBe("unintegrated");
    expect(health).toMatchObject({
      eligibleNotes: 2,
      indexedNotes: 1,
      loggedBuilds: 1,
      kbIngestBuilds: 1,
      directBuilds: 0,
      linksAdded: 2
    });

    const tracks = buildConstructionReplayTracks(
      dataset,
      "2026-08-06T01:00:00.000Z",
      "2026-08-06T01:30:00.000Z"
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      kind: "construction",
      route: "kb-ingest",
      referenceCount: 1,
      outputCount: 1,
      linksAdded: 2
    });
    expect(tracks[0]?.segments.map((segment) => segment.relation)).toEqual([
      "build-capture",
      "build-guide",
      "build-route",
      "build-reference",
      "build-compose",
      "build-index",
      "build-link"
    ]);
    expect(aggregateConstructionReplayTrack(tracks)).toMatchObject({
      id: "build-period",
      kind: "construction",
      outputCount: 1
    });
  });

  it("builds a clearly simulated placement wave from real PARA anchors with Inbox and reconsideration cases", () => {
    const notes = [
      note("CLAUDE.md", "unknown"),
      note("0. Common/index.md", "common", "index"),
      note("1. Projects/_index.md", "projects", "index"),
      note("1. Projects/alpha/_index.md", "projects", "index"),
      note("1. Projects/beta/_index.md", "projects", "index"),
      note("2. Areas/_index.md", "areas", "index"),
      note("3. Resources/_index.md", "resources", "index"),
      note("4. Archive/_index.md", "archive", "index"),
      ...Array.from({ length: 12 }, (_, index) => note(
        `1. Projects/${index % 2 === 0 ? "alpha" : "beta"}/Note ${index + 1}.md`,
        "projects"
      )),
      ...Array.from({ length: 5 }, (_, index) => note(`2. Areas/Career/Area ${index + 1}.md`, "areas")),
      ...Array.from({ length: 5 }, (_, index) => note(`3. Resources/Claude Code/Resource ${index + 1}.md`, "resources")),
      ...Array.from({ length: 3 }, (_, index) => note(`4. Archive/Old/Archive ${index + 1}.md`, "archive"))
    ];
    const dataset = data(notes, [
      link("1. Projects/alpha/_index.md", "1. Projects/alpha/Note 1.md"),
      link("3. Resources/_index.md", "3. Resources/Claude Code/Resource 1.md"),
      link("3. Resources/Claude Code/Resource 1.md", "1. Projects/alpha/Note 1.md")
    ]);

    const tracks = buildSimulatedPlacementTracks(dataset, OPTIONS, 20);
    expect(tracks).toHaveLength(20);
    expect(tracks.every((track) => track.provenance === "simulated")).toBe(true);
    expect(tracks.every((track) => (track.totalDurationMs ?? 0) >= 20_000 && (track.totalDurationMs ?? 0) <= 120_000)).toBe(true);
    expect(tracks.every((track) => (track.totalTokens ?? 0) >= 3_200 && (track.totalTokens ?? 0) <= 22_000)).toBe(true);
    expect(tracks.some((track) => track.segments.some((segment) => segment.relation === "build-capture"))).toBe(true);
    expect(tracks.some((track) => track.route?.includes("ping-pong"))).toBe(true);
    expect(tracks.some((track) => track.segments.some((segment) => segment.targetPath === "1. Projects/alpha/_index.md"))).toBe(true);
    expect(aggregateSimulatedPlacementTrack(tracks)).toMatchObject({
      id: "sim-build-period",
      provenance: "simulated",
      outputCount: 20
    });
  });

  it("builds twenty clearly separated simulated query cases with plausible unit latency and tokens", () => {
    const notes = [
      note("0. Common/index.md", "common", "index"),
      note("1. Projects/_index.md", "projects", "index"),
      note("1. Projects/alpha/_index.md", "projects", "index"),
      note("2. Areas/_index.md", "areas", "index"),
      note("3. Resources/_index.md", "resources", "index"),
      note("4. Archive/_index.md", "archive", "index"),
      ...Array.from({ length: 12 }, (_, index) => note(`1. Projects/alpha/Project ${index + 1}.md`, "projects")),
      ...Array.from({ length: 5 }, (_, index) => note(`2. Areas/Career/Area ${index + 1}.md`, "areas")),
      ...Array.from({ length: 5 }, (_, index) => note(`3. Resources/Topic/Resource ${index + 1}.md`, "resources")),
      ...Array.from({ length: 3 }, (_, index) => note(`4. Archive/Old/Archive ${index + 1}.md`, "archive"))
    ];
    const tracks = buildSimulatedQueryTracks(data(notes, [
      link("0. Common/index.md", "1. Projects/_index.md"),
      link("1. Projects/alpha/_index.md", "1. Projects/alpha/Project 1.md"),
      link("1. Projects/alpha/Project 1.md", "3. Resources/Topic/Resource 1.md")
    ]), OPTIONS, 20);

    expect(tracks).toHaveLength(20);
    expect(tracks.every((track) => track.kind === "query" && track.provenance === "simulated")).toBe(true);
    expect(tracks.every((track) => (track.totalDurationMs ?? 0) >= 8_000 && (track.totalDurationMs ?? 0) <= 30_000)).toBe(true);
    expect(tracks.every((track) => (track.totalTokens ?? 0) >= 1_800 && (track.totalTokens ?? 0) <= 9_500)).toBe(true);
    expect(tracks.some((track) => track.paraSpan > 1)).toBe(true);
    expect(aggregateSimulatedQueryTrack(tracks)).toMatchObject({
      id: "sim-query-period",
      provenance: "simulated",
      queryIds: expect.arrayContaining([tracks[0]?.id])
    });
  });
});

function note(
  path: string,
  para: ParaCategory,
  role: NormalizedNote["role"] = "content",
  modifiedTime = Date.parse("2026-08-05T00:00:00.000Z")
): NormalizedNote {
  return {
    id: `note:${path}`,
    path,
    title: path.split("/").at(-1)?.replace(/\.md$/, "") ?? path,
    para,
    role,
    tags: [],
    aliases: [],
    summary: null,
    sizeBytes: 100,
    createdTime: modifiedTime,
    modifiedTime,
    confidence: "measured"
  };
}

function link(sourcePath: string, targetPath: string): NormalizedLink {
  return {
    id: `link:${sourcePath}->${targetPath}`,
    sourceId: `note:${sourcePath}`,
    targetId: `note:${targetPath}`,
    sourcePath,
    targetPath,
    resolved: true,
    confidence: "measured"
  };
}

function journey(
  queryId: string,
  paths: string[],
  stepDurations: number[] = [],
  totalDuration = 1_000
): QueryJourney {
  const groupedPaths = paths.map((path, index) => index === 0 && paths[1]
    ? [path, paths[1]]
    : index === 1
      ? []
      : [path]
  ).filter((group) => group.length > 0);
  const events = groupedPaths.map((stepPaths, index) => event(queryId, index, stepPaths, stepDurations[index] ?? null));
  const semanticEvents = [
    semanticEvent(queryId, "QueryStart", 0),
    ...events,
    semanticEvent(queryId, "QuerySummary", events.length + 1),
    semanticEvent(queryId, "QueryComplete", events.length + 2)
  ];
  return {
    queryId,
    requestId: `request:${queryId}`,
    sessionId: null,
    startedAt: "2026-08-05T10:00:00.000Z",
    endedAt: "2026-08-05T10:00:05.000Z",
    durationMs: reading(totalDuration),
    inputTokens: reading(null),
    outputTokens: reading(null),
    totalTokens: reading(null),
    documentsReadCount: reading(paths.length),
    searchStepCount: reading(groupedPaths.length),
    completed: true,
    completionConfidence: "measured",
    tools: ["read"],
    accessedPaths: paths,
    documentsReadPaths: paths,
    entrypoints: paths[0] ? [paths[0]] : [],
    buildSummary: null,
    steps: groupedPaths.map((stepPaths, index) => ({
      index,
      eventId: events[index]?.id ?? `event:${index}`,
      observedAt: "2026-08-05T10:00:00.000Z",
      toolName: "read",
      paths: stepPaths
    })),
    events: semanticEvents
  };
}

function semanticEvent(queryId: string, kind: string, index: number): QueryTelemetryEvent {
  return {
    ...event(queryId, index, [], null),
    id: `semantic:${queryId}:${kind}`,
    kind,
    completed: kind === "QueryComplete" ? true : null
  };
}

function event(queryId: string, index: number, paths: string[], duration: number | null): QueryTelemetryEvent {
  return {
    id: `event:${queryId}:${index}`,
    observedAt: "2026-08-05T10:00:00.000Z",
    kind: "tool",
    queryId,
    requestId: `request:${queryId}`,
    sessionId: null,
    durationMs: reading(duration),
    inputTokens: reading(null),
    outputTokens: reading(null),
    totalTokens: reading(null),
    toolName: "read",
    accessedPaths: paths,
    stepPaths: paths,
    documentsReadPaths: paths,
    documentsReadCount: reading(paths.length),
    entrypoints: index === 0 && paths[0] ? [paths[0]] : [],
    searchStepCount: reading(1),
    completed: index > 0,
    buildSummary: null,
    source: "fixture.jsonl",
    line: index + 1
  };
}

function reading(value: number | null) {
  return { value, confidence: value === null ? "unavailable" as const : "measured" as const, source: "fixture" };
}

function data(
  notes: NormalizedNote[],
  links: NormalizedLink[] = [],
  journeys: QueryJourney[] = []
): ObservatoryDataset {
  const current: GraphSnapshot = {
    id: "snapshot:now",
    definitionVersion: "fixture-v1",
    scope: { id: "fixture", label: "Fixture" },
    observedAt: "2026-08-06T00:00:00.000Z",
    notes,
    links,
    metrics: []
  };
  return {
    current,
    snapshots: [current],
    diffs: [],
    journeys,
    capabilities: new Set(),
    generatedAt: current.observedAt
  };
}
