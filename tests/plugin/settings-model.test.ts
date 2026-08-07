import { describe, expect, it } from "vitest";
import {
  adapterConfigFromSettings,
  adapterConfigFromSettingsForConfigDir,
  DEFAULT_SETTINGS
} from "../../src/plugin/contracts";
import {
  MAX_LENS_USAGE_EVENTS,
  formatTelemetrySchema,
  formatParaRoots,
  parseList,
  parseParaRoots,
  parseTelemetrySchema,
  sanitizePluginData,
  sanitizeSettings,
  telemetryProfilePatch,
  vaultProfilePatch,
  withRecentLens
} from "../../src/plugin/settings-model";

describe("plugin settings", () => {
  it("falls back safely from malformed persisted data", () => {
    const settings = sanitizeSettings({
      defaultLensId: "L99",
      defaultPeriod: "forever",
      maxTelemetryFiles: 999,
      maxSnapshotFiles: 999,
      exclusions: "invalid",
      paraRoots: [{ para: "projects", prefix: "1. Projects/" }, { para: "invalid", prefix: "/" }]
    });

    expect(settings.defaultLensId).toBe(DEFAULT_SETTINGS.defaultLensId);
    expect(settings.defaultPeriod).toBe(DEFAULT_SETTINGS.defaultPeriod);
    expect(settings.maxTelemetryFiles).toBe(32);
    expect(settings.maxSnapshotFiles).toBe(120);
    expect(settings.exclusions).toEqual(DEFAULT_SETTINGS.exclusions);
    expect(settings.paraRoots).toEqual([{ para: "projects", prefix: "1. Projects/" }]);
  });

  it("keeps deliberate empty source lists and canonicalizes adapter paths", () => {
    const settings = sanitizeSettings({
      telemetryPaths: [],
      telemetryArchiveFolders: [],
      exclusions: [],
      indexFileNames: ["INDEX.MD", "Nested/_INDEX.MD"],
      paraRoots: [{ para: "projects", prefix: "/Work" }]
    });
    const config = adapterConfigFromSettings(settings);

    expect(settings.telemetryPaths).toEqual([]);
    expect(settings.telemetryArchiveFolders).toEqual([]);
    expect(settings.exclusions).toEqual([]);
    expect(config.indexFileNames).toEqual(["index.md", "_index.md"]);
    expect(config.paraRoots).toEqual([{ para: "projects", prefix: "Work/" }]);
  });

  it("keeps semantic spine configuration portable and derives generated paths from the configured common root", () => {
    const settings = sanitizeSettings({
      paraRoots: [{ para: "common", prefix: "/Core" }],
      spinePaths: ["RULES.md", "Core/schema.md"]
    });
    const config = adapterConfigFromSettings(settings);

    expect(settings.spinePaths).toEqual(["RULES.md", "Core/schema.md"]);
    expect(config.generatedPathPrefixes).toEqual(["Core/reports/"]);
  });

  it("migrates legacy config paths and resolves tokens against a custom Obsidian config folder", () => {
    const settings = sanitizeSettings({
      telemetryPaths: [".obsidian/query.jsonl"],
      exclusions: [".obsidian/", "Private/"],
      snapshotRoot: ".obsidian/plugins/llm-wiki-observatory/snapshots"
    });
    const config = adapterConfigFromSettingsForConfigDir(settings, ".config");

    expect(settings.telemetryPaths).toEqual(["$CONFIG_DIR/query.jsonl"]);
    expect(settings.exclusions).toEqual(["$CONFIG_DIR/", "Private/"]);
    expect(settings.snapshotRoot).toBe("$PLUGIN_DIR/snapshots");
    expect(config.telemetryPaths).toEqual([".config/query.jsonl"]);
    expect(config.exclusions).toEqual([".config/", "Private/"]);
    expect(config.runtimePathPrefixes).toContain(".config/");
  });

  it("applies portable vault and telemetry presets while preserving an editable custom mapping", () => {
    const vaultPatch = vaultProfilePatch("standard-para");
    const telemetryPatch = telemetryProfilePatch("generic-jsonl");
    const schemaText = formatTelemetrySchema(telemetryPatch.telemetrySchema ?? DEFAULT_SETTINGS.telemetrySchema);
    const parsed = parseTelemetrySchema(schemaText);

    expect(vaultPatch).toMatchObject({
      vaultProfile: "standard-para",
      paraRoots: expect.arrayContaining([{ para: "projects", prefix: "Projects/" }]),
      indexFileNames: ["index.md", "_index.md"]
    });
    expect(telemetryPatch.telemetryProfile).toBe("generic-jsonl");
    expect(parsed?.events.queryStart).toContain("query.started");
    expect(parsed?.coreFields.operationTotalTokens).toContain("usage.total_tokens");
    expect(parseTelemetrySchema("{}")).toBeNull();
    expect(parseTelemetrySchema("{broken")).toBeNull();
  });

  it("retains only the compact privacy-safe usage schema", () => {
    const data = sanitizePluginData({
      settings: {},
      lensUsageEvents: [
        {
          id: "e1",
          observedAt: "2026-08-05T00:00:00.000Z",
          lensId: "L06",
          action: "replay",
          dwellMs: 12.4,
          prompt: "must disappear",
          noteTitle: "must disappear"
        },
        { id: "e2", observedAt: "now", lensId: "L99", action: "open" }
      ]
    });

    expect(data.lensUsageEvents).toEqual([{
      id: "e1",
      observedAt: "2026-08-05T00:00:00.000Z",
      lensId: "L06",
      action: "replay",
      dwellMs: 12
    }]);
  });

  it("bounds recents, events, and multiline list input", () => {
    let settings = DEFAULT_SETTINGS;
    for (let index = 1; index <= 12; index += 1) {
      settings = withRecentLens(settings, `L${String(index).padStart(2, "0")}`);
    }
    expect(settings.recentLensIds).toHaveLength(8);
    expect(settings.recentLensIds[0]).toBe("L12");
    expect(parseList("a, b\na\n c ")).toEqual(["a", "b", "c"]);
    const roots = parseParaRoots("projects=1. Projects/\ninvalid=nope\narchive=4. Archive/");
    expect(roots).toEqual([
      { para: "projects", prefix: "1. Projects/" },
      { para: "archive", prefix: "4. Archive/" }
    ]);
    expect(formatParaRoots(roots)).toBe("projects=1. Projects/\narchive=4. Archive/");

    const lensUsageEvents = Array.from({ length: MAX_LENS_USAGE_EVENTS + 5 }, (_, index) => ({
      id: `e${index}`,
      observedAt: "2026-08-05T00:00:00.000Z",
      lensId: "L01",
      action: "open"
    }));
    expect(sanitizePluginData({ lensUsageEvents }).lensUsageEvents).toHaveLength(MAX_LENS_USAGE_EVENTS);
  });
});
