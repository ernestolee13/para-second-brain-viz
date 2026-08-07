import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/plugin/contracts";
import {
  PARA_KB_CONFIG_PATH,
  parseParaKbConfig,
  resolveParaKbSettings
} from "../../src/plugin/paraKbConfig";
import type { ObservatoryAdapter, ObservatoryAdapterList } from "../../src/obsidian/types";

describe("PARA Knowledge Base config", () => {
  it("maps a portable config into an ephemeral Second Brain profile", async () => {
    const adapter = new MemoryAdapter({ [PARA_KB_CONFIG_PATH]: configJson() });
    const persisted = { ...DEFAULT_SETTINGS, configSource: "auto" as const };
    const resolved = await resolveParaKbSettings(adapter, persisted);

    expect(resolved.detected).toBe(true);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.settings).toMatchObject({
      configSource: "auto",
      vaultProfile: "para-kb-v1",
      telemetryProfile: "para-kb-v1",
      paraRoots: expect.arrayContaining([
        { para: "projects", prefix: "Outcomes/" },
        { para: "inbox", prefix: "Capture/" }
      ]),
      telemetryPaths: ["Core/operations.jsonl"],
      telemetryArchiveFolders: ["Core/operations-archive"]
    });
    expect(resolved.settings.exclusions).toEqual(expect.arrayContaining([".para-kb/", "$CONFIG_DIR/", "Private/"]));
    expect(persisted.vaultProfile).toBe("llm-wiki-para");
  });

  it("lets profile/manual settings opt out of config auto-detection", async () => {
    const adapter = new MemoryAdapter({ [PARA_KB_CONFIG_PATH]: configJson() });
    const persisted = { ...DEFAULT_SETTINGS, configSource: "manual" as const };
    const resolved = await resolveParaKbSettings(adapter, persisted);
    expect(resolved.detected).toBe(false);
    expect(resolved.settings).toBe(persisted);
  });

  it("warns on a future schema while applying known safe fields", () => {
    const future = JSON.parse(configJson()) as Record<string, unknown>;
    future.schema_version = 2;
    const result = parseParaKbConfig(JSON.stringify(future));
    expect(result.config?.schemaVersion).toBe(2);
    expect(result.warnings.join(" ")).toContain("newer than supported");
  });

  it("rejects absolute paths and a weakened privacy contract", () => {
    const unsafe = JSON.parse(configJson()) as Record<string, unknown>;
    (unsafe.para_roots as Record<string, unknown>).projects = "/private/projects/";
    expect(parseParaKbConfig(JSON.stringify(unsafe)).config).toBeNull();

    const weakPrivacy = JSON.parse(configJson()) as Record<string, unknown>;
    weakPrivacy.privacy = { content: "sometimes", paths: "absolute" };
    expect(parseParaKbConfig(JSON.stringify(weakPrivacy)).config).toBeNull();
  });
});

function configJson(): string {
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

class MemoryAdapter implements ObservatoryAdapter {
  constructor(private readonly files: Record<string, string>) {}

  async exists(path: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.files, path);
  }

  async read(path: string): Promise<string> {
    const value = this.files[path];
    if (value === undefined) throw new Error(`missing ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files[path] = data;
  }

  async mkdir(): Promise<void> {}

  async list(): Promise<ObservatoryAdapterList> {
    return { files: Object.keys(this.files), folders: [] };
  }
}
