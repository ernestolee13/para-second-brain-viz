import { describe, expect, it } from "vitest";
import {
  adapterConfigFromSettings,
  DEFAULT_SETTINGS,
  resolveVaultPath,
  type ObservatoryPluginSettings
} from "../../src/plugin/contracts";
import { ObservatoryDataService, scopeFromSettings } from "../../src/obsidian/service";
import type { GraphSnapshot, LensUiUsageEvent } from "../../src/model";
import type {
  ObservatoryAdapter,
  ObservatoryAdapterList,
  ObservatoryAppLike,
  ObservatoryFileCache,
  ObservatoryFileStat,
  ObservatoryMarkdownFile
} from "../../src/obsidian/types";

describe("Obsidian data service", () => {
  it("collects markdown files, metadata links, exclusions, and settings-scoped snapshots", async () => {
    const files = [
      md("0. Common/index.md", { size: 20 }),
      md("1. Projects/demo/_index.md", { size: 30 }),
      md(".trash/private.md", { size: 40 })
    ];
    const app = fakeApp({
      files,
      cache: {
        "0. Common/index.md": {
          frontmatter: { summary: "Hub", tags: ["hub"] },
          links: [{ link: "1. Projects/demo/_index", displayText: "Demo" }]
        }
      }
    });
    const service = serviceFor(app, { now: "2026-08-05T00:00:00.000Z" });

    const result = await service.loadDataset();

    expect(result.dataset.current.notes.map((note) => note.path)).toEqual([
      "0. Common/index.md",
      "1. Projects/demo/_index.md"
    ]);
    expect(result.dataset.current.links).toEqual([
      expect.objectContaining({
        sourcePath: "0. Common/index.md",
        targetPath: "1. Projects/demo/_index.md",
        resolved: true,
        displayText: "Demo"
      })
    ]);
    expect(result.dataset.current.scope).toMatchObject({
      id: expect.stringMatching(/^vault-settings-v1-/),
      exclusions: adapterConfigFromSettings(DEFAULT_SETTINGS).exclusions.slice().sort()
    });
    expect(result.report).toMatchObject({ noteCount: 2, linkCount: 1, indexCount: 2 });
  });

  it("auto-applies .para-kb config without mutating persisted settings and warns on future telemetry", async () => {
    const telemetry = [
      JSON.stringify({
        schema: "para-kb.telemetry",
        schema_version: 2,
        event: "QueryStart",
        operation_id: "query-config-1",
        operation_kind: "query",
        request_id: "request-config-1",
        timestamp: "2026-08-05T01:00:00.000Z"
      }),
      JSON.stringify({
        schema: "para-kb.telemetry",
        schema_version: 2,
        event: "QuerySummary",
        operation_id: "query-config-1",
        operation_kind: "query",
        request_id: "request-config-1",
        timestamp: "2026-08-05T01:00:01.000Z",
        documents_read_count: 1,
        documents_read_paths: ["Outcomes/demo/_index.md"],
        entrypoints: ["Outcomes/demo/_index.md"],
        search_step_count: 1,
        confidence: "high"
      }),
      JSON.stringify({
        schema: "para-kb.telemetry",
        schema_version: 2,
        event: "QueryComplete",
        operation_id: "query-config-1",
        operation_kind: "query",
        request_id: "request-config-1",
        timestamp: "2026-08-05T01:00:02.000Z",
        operation_elapsed_ms: 2_000,
        token_total_for_analysis: null,
        token_is_operation_delta: false,
        token_reliability: "none"
      })
    ].join("\n");
    const app = fakeApp({
      files: [md("Outcomes/demo/_index.md"), md("Private/secret.md")],
      adapterFiles: {
        ".para-kb/config.json": paraConfigJson(),
        "Core/operations.jsonl": telemetry
      }
    });
    const persisted = withSettings();
    const service = new ObservatoryDataService(app, {
      getSettings: () => persisted,
      now: () => new Date("2026-08-05T02:00:00.000Z")
    });

    const effective = await service.getEffectiveSettings();
    const result = await service.loadDataset();

    expect(effective.detected).toBe(true);
    expect(effective.settings.vaultProfile).toBe("para-kb-v1");
    expect(persisted.vaultProfile).toBe("llm-wiki-para");
    expect(result.settings).toMatchObject({
      vaultProfile: "para-kb-v1",
      spinePaths: ["RULES.md", "Core/index.md"]
    });
    expect(result.dataset.current.notes.map((note) => note.path)).toEqual(["Outcomes/demo/_index.md"]);
    expect(result.dataset.journeys[0]).toMatchObject({
      queryId: "query-config-1",
      requestId: "request-config-1",
      completed: true
    });
    expect(result.report.warnings.join("\n")).toContain("newer PARA KB telemetry schema v2");
  });

  it("loads active telemetry plus newest archives, isolates malformed and missing sources, and retains no prompt/query text", async () => {
    const app = fakeApp({
      files: [],
      adapterFiles: {
        "0. Common/query-telemetry.jsonl": [
          JSON.stringify({
            event: "QuerySummary",
            query_id: "q-active",
            timestamp: "2026-08-05T01:00:00.000Z",
            documents_read_count: 1,
            documents_read_paths: ["1. Projects/demo/_index.md"],
            search_step_count: 1,
            confidence: "high",
            query: "PRIVATE QUERY"
          }),
          "{broken"
        ].join("\n"),
        "0. Common/telemetry-archive/old.jsonl": eventJsonl("q-old", "2026-08-01T01:00:00.000Z"),
        "0. Common/telemetry-archive/newer.jsonl": eventJsonl("q-newer", "2026-08-03T01:00:00.000Z"),
        "0. Common/telemetry-archive/newest.jsonl": eventJsonl("q-newest", "2026-08-04T01:00:00.000Z")
      },
      stats: {
        "0. Common/telemetry-archive/old.jsonl": { mtime: 1 },
        "0. Common/telemetry-archive/newer.jsonl": { mtime: 2 },
        "0. Common/telemetry-archive/newest.jsonl": { mtime: 3 }
      }
    });
    const service = serviceFor(app, {
      now: "2026-08-05T02:00:00.000Z",
      settings: {
        telemetryPaths: ["0. Common/query-telemetry.jsonl", "0. Common/missing.jsonl"],
        maxTelemetryFiles: 2
      }
    });

    const result = await service.loadDataset();

    expect(result.report.telemetry.filesRead).toEqual([
      "0. Common/query-telemetry.jsonl",
      "0. Common/telemetry-archive/newest.jsonl",
      "0. Common/telemetry-archive/newer.jsonl"
    ]);
    expect(result.dataset.journeys.map((journey) => journey.queryId)).toEqual([
      "q-newer",
      "q-newest",
      "q-active"
    ]);
    expect(result.report.telemetry.malformedLines).toBe(1);
    expect(result.report.warnings).toEqual(expect.arrayContaining(["Telemetry source missing: 0. Common/missing.jsonl"]));
    expect(JSON.stringify(result)).not.toContain("PRIVATE QUERY");
    expect(JSON.stringify(result)).not.toContain("query text");
  });

  it("captures snapshots through vault.adapter mkdir/write and diffs compatible stored snapshot against current", async () => {
    const app = fakeApp({ files: [md("1. Projects/demo/_index.md", { size: 10 })] });
    const service = serviceFor(app, { now: ["2026-08-05T00:00:00.000Z", "2026-08-06T00:00:00.000Z"] });

    const captured = await service.captureSnapshot();
    app.vault.getMarkdownFiles = () => [
      md("1. Projects/demo/_index.md", { size: 10 }),
      md("1. Projects/demo/spec.md", { size: 20 })
    ];
    const result = await service.loadDataset();

    expect(captured.path).toMatch(
      /^\.obsidian\/plugins\/llm-wiki-observatory\/snapshots\/vault-settings-v1-.+\/2026-08-05T00-00-00.000Z.json$/
    );
    expect((app.vault.adapter as FakeAdapter).madeDirs).toEqual(
      expect.arrayContaining([
        ".obsidian",
        ".obsidian/plugins",
        ".obsidian/plugins/llm-wiki-observatory",
        ".obsidian/plugins/llm-wiki-observatory/snapshots"
      ])
    );
    expect(result.report.storedSnapshotCount).toBe(1);
    expect(result.report.compatibleDiffCount).toBe(1);
    expect(result.dataset.diffs[0]?.metrics.noteDelta).toBe(1);
    expect(result.dataset.capabilities.has("snapshot-history")).toBe(true);
  });

  it("canonicalizes a trailing slash in the configured snapshot root", async () => {
    const settings = withSettings({ snapshotRoot: `${DEFAULT_SETTINGS.snapshotRoot}/` });
    const app = fakeApp({ files: [md("1. Projects/demo/_index.md", { size: 10 })] });
    const service = serviceFor(app, {
      now: ["2026-08-05T00:00:00.000Z", "2026-08-06T00:00:00.000Z"],
      settings
    });

    const captured = await service.captureSnapshot();
    const result = await service.loadDataset();

    expect(captured.path).not.toContain("snapshots//");
    expect(result.report.storedSnapshotCount).toBe(1);
    expect(result.report.compatibleDiffCount).toBe(1);
  });

  it("uses the vault config directory instead of assuming .obsidian", async () => {
    const app = fakeApp({
      files: [md("Projects/demo/index.md", { size: 10 })],
      configDir: ".config"
    });
    const settings = withSettings({
      paraRoots: [{ para: "projects", prefix: "Projects/" }],
      exclusions: ["$CONFIG_DIR/"],
      telemetryPaths: [],
      telemetryArchiveFolders: []
    });
    const service = serviceFor(app, { now: "2026-08-05T00:00:00.000Z", settings });

    const captured = await service.captureSnapshot();
    const result = await service.loadDataset();

    expect(captured.path).toMatch(/^\.config\/plugins\/llm-wiki-observatory\/snapshots\//);
    expect(result.dataset.current.scope.exclusions).toEqual([".config/"]);
  });

  it("warns on invalid or incompatible snapshots without exposing them to lenses", async () => {
    const settings = withSettings();
    const scope = scopeFromSettings(settings);
    const scopeFolder = `${resolveVaultPath(settings.snapshotRoot, ".obsidian")}/${scope.id}`;
    const app = fakeApp({
      files: [md("1. Projects/demo/_index.md", { size: 10 })],
      adapterFiles: {
        [`${scopeFolder}/bad.json`]: "{bad",
        [`${scopeFolder}/incompatible.json`]: JSON.stringify({
          id: "old",
          definitionVersion: "other",
          observedAt: "2026-08-04T00:00:00.000Z",
          scope: { id: "other", label: "Other" },
          notes: [],
          links: [],
          metrics: []
        })
      }
    });
    const service = serviceFor(app, { now: "2026-08-05T00:00:00.000Z", settings });

    const result = await service.loadDataset();

    expect(result.report.storedSnapshotCount).toBe(0);
    expect(result.report.compatibleDiffCount).toBe(0);
    expect(result.dataset.snapshots).toHaveLength(1);
    expect(result.report.warnings.join("\n")).toContain("Snapshot skipped");
    expect(result.report.warnings.join("\n")).toContain("incompatible");
  });

  it("keeps a valid same-scope history contiguous when another scope is stored between observations", async () => {
    const settings = withSettings();
    const scope = scopeFromSettings(settings);
    const compatible = storedSnapshot("compatible", "2026-08-03T00:00:00.000Z", scope);
    const incompatible = storedSnapshot(
      "incompatible",
      "2026-08-04T00:00:00.000Z",
      { id: "legacy-scope", label: "Legacy scope" }
    );
    const app = fakeApp({
      files: [md("1. Projects/demo/_index.md", { size: 10 })],
      adapterFiles: {
        [`${resolveVaultPath(settings.snapshotRoot, ".obsidian")}/${scope.id}/2026-08-03.json`]: JSON.stringify(compatible),
        [`${resolveVaultPath(settings.snapshotRoot, ".obsidian")}/legacy-scope/2026-08-04.json`]: JSON.stringify(incompatible)
      }
    });
    const service = serviceFor(app, { now: "2026-08-05T00:00:00.000Z", settings });

    const result = await service.loadDataset();

    expect(result.report.storedSnapshotCount).toBe(1);
    expect(result.report.compatibleDiffCount).toBe(1);
    expect(result.dataset.snapshots.map((snapshot) => snapshot.id)).toContain("compatible");
    expect(result.dataset.snapshots.map((snapshot) => snapshot.id)).not.toContain("incompatible");
    expect(result.report.warnings.join("\n")).toContain("outside the current scope");
  });

  it("loads only the configured number of newest same-scope snapshots", async () => {
    const settings = withSettings({ maxSnapshotFiles: 1 });
    const scope = scopeFromSettings(settings);
    const app = fakeApp({
      files: [],
      adapterFiles: {
        [`${resolveVaultPath(settings.snapshotRoot, ".obsidian")}/${scope.id}/2026-08-01.json`]: JSON.stringify(
          storedSnapshot("older", "2026-08-01T00:00:00.000Z", scope)
        ),
        [`${resolveVaultPath(settings.snapshotRoot, ".obsidian")}/${scope.id}/2026-08-02.json`]: JSON.stringify(
          storedSnapshot("newer", "2026-08-02T00:00:00.000Z", scope)
        )
      }
    });
    const service = serviceFor(app, { now: "2026-08-05T00:00:00.000Z", settings });

    const result = await service.loadDataset();

    expect(result.report.storedSnapshotCount).toBe(1);
    expect(result.dataset.snapshots.map((snapshot) => snapshot.id)).toContain("newer");
    expect(result.dataset.snapshots.map((snapshot) => snapshot.id)).not.toContain("older");
    expect(result.report.warnings.join("\n")).toContain("newest 1");
  });

  it("records only sanitized lens UI usage when enabled", async () => {
    const app = fakeApp({ files: [] });
    const saved: unknown[] = [];
    const service = serviceFor(app, {
      now: "2026-08-05T00:00:00.000Z",
      saveLensUsageEvents: (events) => {
        saved.push(events);
      }
    });

    await service.recordLensUsage({
      id: "u1",
      observedAt: "2026-08-05T00:00:00.000Z",
      lensId: "L06",
      action: "foreground",
      dwellMs: 42_000
    });

    expect(saved).toEqual([
      [
        {
          id: "u1",
          observedAt: "2026-08-05T00:00:00.000Z",
          lensId: "L06",
          action: "foreground",
          dwellMs: 42_000
        }
      ]
    ]);
  });

  it("changes snapshot scope when graph classification semantics change", () => {
    const baseline = scopeFromSettings(withSettings());
    const paraChanged = scopeFromSettings(withSettings({
      paraRoots: [{ para: "projects", prefix: "Work/" }]
    }));
    const indexChanged = scopeFromSettings(withSettings({ indexFileNames: ["hub.md"] }));
    const telemetryOnly = scopeFromSettings(withSettings({ telemetryPaths: ["another.jsonl"] }));

    expect(paraChanged.id).not.toBe(baseline.id);
    expect(indexChanged.id).not.toBe(baseline.id);
    expect(telemetryOnly.id).toBe(baseline.id);
  });
});

function serviceFor(
  app: ObservatoryAppLike,
  options: {
    now: string | string[];
    settings?: Partial<ObservatoryPluginSettings>;
    saveLensUsageEvents?: (events: LensUiUsageEvent[]) => void;
  }
): ObservatoryDataService {
  const settings = withSettings(options.settings);
  const times = Array.isArray(options.now) ? [...options.now] : [options.now];
  return new ObservatoryDataService(app, {
    getSettings: () => settings,
    getLensUsageEvents: () => [],
    saveLensUsageEvents: async (events) => options.saveLensUsageEvents?.(events),
    now: () => new Date(times.shift() ?? times[0] ?? "2026-08-05T00:00:00.000Z")
  });
}

function withSettings(patch: Partial<ObservatoryPluginSettings> = {}): ObservatoryPluginSettings {
  return { ...DEFAULT_SETTINGS, ...patch };
}

function storedSnapshot(
  id: string,
  observedAt: string,
  scope: GraphSnapshot["scope"]
): GraphSnapshot {
  return {
    id,
    definitionVersion: "llm-wiki-observatory-adapter-v1",
    observedAt,
    scope,
    notes: [],
    links: [],
    metrics: []
  };
}

function md(path: string, stat: ObservatoryFileStat = {}): ObservatoryMarkdownFile {
  const basename = path.split("/").at(-1)?.replace(/\.md$/, "");
  return {
    path,
    ...(basename !== undefined ? { basename } : {}),
    extension: "md",
    stat
  };
}

function eventJsonl(queryId: string, timestamp: string): string {
  return JSON.stringify({
    event: "QuerySummary",
    query_id: queryId,
    timestamp,
    documents_read_count: 1,
    documents_read_paths: ["1. Projects/demo/_index.md"],
    search_step_count: 1,
    confidence: "high",
    query: "query text"
  });
}

function paraConfigJson(): string {
  return JSON.stringify({
    schema_version: 1,
    para_roots: {
      common: "Core/",
      projects: "Outcomes/",
      areas: "Responsibilities/",
      resources: "Library/",
      archive: "Cold/",
      inbox: "Capture/"
    },
    index_file_names: ["index.md", "_index.md"],
    spine_paths: ["RULES.md", "Core/index.md"],
    telemetry: {
      enabled: true,
      active_path: "Core/operations.jsonl",
      archive_dir: "Core/operations-archive",
      max_bytes: 5242880,
      max_archives: 4
    },
    privacy: { content: "never", paths: "vault-relative" },
    exclusions: ["$CONFIG_DIR/", "Private/"],
    consumer_profile: "para-kb-v1"
  });
}

function fakeApp(input: {
  files: ObservatoryMarkdownFile[];
  configDir?: string;
  cache?: Record<string, ObservatoryFileCache>;
  adapterFiles?: Record<string, string>;
  stats?: Record<string, ObservatoryFileStat>;
}): ObservatoryAppLike {
  const adapter = new FakeAdapter(input.adapterFiles ?? {}, input.stats ?? {});
  return {
    vault: {
      adapter,
      ...(input.configDir === undefined ? {} : { configDir: input.configDir }),
      getMarkdownFiles: () => input.files
    },
    metadataCache: {
      getFileCache: (file) => input.cache?.[file.path] ?? null
    },
    workspace: {
      openLinkText: async () => {}
    }
  };
}

class FakeAdapter implements ObservatoryAdapter {
  readonly madeDirs: string[] = [];
  private readonly files = new Map<string, string>();
  private readonly stats = new Map<string, ObservatoryFileStat>();
  private readonly dirs = new Set<string>();

  constructor(files: Record<string, string>, stats: Record<string, ObservatoryFileStat>) {
    this.dirs.add("");
    for (const [path, text] of Object.entries(files)) this.put(path, text);
    for (const [path, stat] of Object.entries(stats)) this.stats.set(path, stat);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path) || [...this.files.keys()].some((file) => file.startsWith(`${path}/`));
  }

  async read(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  }

  async write(path: string, data: string): Promise<void> {
    this.put(path, data);
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
    this.madeDirs.push(path);
  }

  async list(path: string): Promise<ObservatoryAdapterList> {
    if (!(await this.exists(path))) throw new Error(`missing folder ${path}`);
    const prefix = path.length === 0 ? "" : `${path}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      if (rest.length === 0) continue;
      const slash = rest.indexOf("/");
      if (slash === -1) files.push(file);
      else folders.add(`${prefix}${rest.slice(0, slash)}`);
    }
    return { files: files.sort(), folders: [...folders].sort() };
  }

  async stat(path: string): Promise<ObservatoryFileStat | null> {
    return this.stats.get(path) ?? null;
  }

  private put(path: string, text: string): void {
    this.files.set(path, text);
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current.length === 0 ? part : `${current}/${part}`;
      this.dirs.add(current);
    }
  }
}
