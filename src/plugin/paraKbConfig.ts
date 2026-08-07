import type { ParaRootRule } from "../adapters/generic";
import type { ObservatoryAdapter } from "../obsidian/types";
import type { ObservatoryPluginSettings } from "./contracts";
import { cloneTelemetrySchema, PARA_KB_V1_TELEMETRY_SCHEMA } from "./profiles";

export const PARA_KB_CONFIG_PATH = ".para-kb/config.json";
export const SUPPORTED_PARA_KB_CONFIG_VERSION = 1;

export interface ParaKbConfig {
  schemaVersion: number;
  paraRoots: ParaRootRule[];
  indexFileNames: string[];
  spinePaths: string[];
  telemetryEnabled: boolean;
  telemetryPath: string;
  telemetryArchiveFolder: string;
  exclusions: string[];
  consumerProfile: "para-kb-v1";
}

export interface ParaKbConfigResolution {
  settings: ObservatoryPluginSettings;
  detected: boolean;
  warnings: string[];
}

export async function resolveParaKbSettings(
  adapter: ObservatoryAdapter,
  settings: ObservatoryPluginSettings
): Promise<ParaKbConfigResolution> {
  if (settings.configSource !== "auto") return { settings, detected: false, warnings: [] };
  if (!(await adapter.exists(PARA_KB_CONFIG_PATH))) return { settings, detected: false, warnings: [] };

  try {
    const text = await adapter.read(PARA_KB_CONFIG_PATH);
    const parsed = parseParaKbConfig(text);
    if (!parsed.config) {
      return {
        settings,
        detected: false,
        warnings: parsed.warnings.map((warning) => `PARA KB config ignored: ${warning}`)
      };
    }
    const config = parsed.config;
    return {
      settings: {
        ...settings,
        vaultProfile: "para-kb-v1",
        telemetryProfile: "para-kb-v1",
        paraRoots: config.paraRoots.map((root) => ({ ...root })),
        indexFileNames: [...config.indexFileNames],
        spinePaths: [...config.spinePaths],
        telemetryPaths: config.telemetryEnabled ? [config.telemetryPath] : [],
        telemetryArchiveFolders: config.telemetryEnabled ? [config.telemetryArchiveFolder] : [],
        telemetrySchema: cloneTelemetrySchema(PARA_KB_V1_TELEMETRY_SCHEMA),
        exclusions: unique([".para-kb/", ...config.exclusions])
      },
      detected: true,
      warnings: parsed.warnings
    };
  } catch (error) {
    return {
      settings,
      detected: false,
      warnings: [`PARA KB config could not be read: ${errorMessage(error)}`]
    };
  }
}

export function parseParaKbConfig(text: string): { config: ParaKbConfig | null; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    return { config: null, warnings: [`invalid JSON: ${errorMessage(error)}`] };
  }
  const record = asRecord(raw);
  if (!record) return { config: null, warnings: ["root must be a JSON object"] };
  const warnings: string[] = [];
  const schemaVersion = finiteInteger(record.schema_version);
  if (schemaVersion === null || schemaVersion < 1) {
    return { config: null, warnings: ["schema_version must be a positive integer"] };
  }
  if (schemaVersion > SUPPORTED_PARA_KB_CONFIG_VERSION) {
    warnings.push(
      `PARA KB config schema v${schemaVersion} is newer than supported v${SUPPORTED_PARA_KB_CONFIG_VERSION}; known fields were applied.`
    );
  }

  const roots = asRecord(record.para_roots);
  if (!roots) return { config: null, warnings: ["para_roots must be an object"] };
  const paraRoots: ParaRootRule[] = [];
  for (const para of ["common", "projects", "areas", "resources", "archive", "inbox"] as const) {
    const value = relativePath(roots[para], true);
    if (value) paraRoots.push({ para, prefix: value });
    else if (para !== "inbox") return { config: null, warnings: [`para_roots.${para} is missing or unsafe`] };
  }

  const indexFileNames = stringArray(record.index_file_names)
    .map((value) => relativePath(value, false))
    .filter((value): value is string => value !== null)
    .map((value) => value.split("/").at(-1) ?? value);
  if (indexFileNames.length === 0) return { config: null, warnings: ["index_file_names must contain a safe filename"] };

  const spinePaths = safePathArray(record.spine_paths);
  const telemetry = asRecord(record.telemetry);
  if (!telemetry) return { config: null, warnings: ["telemetry must be an object"] };
  const telemetryEnabled = telemetry.enabled === true;
  const telemetryPath = relativePath(telemetry.active_path, false);
  const telemetryArchiveFolder = relativePath(telemetry.archive_dir, false);
  if (!telemetryPath || !telemetryArchiveFolder) {
    return { config: null, warnings: ["telemetry paths must be vault-relative"] };
  }
  const privacy = asRecord(record.privacy);
  if (privacy?.content !== "never" || privacy.paths !== "vault-relative") {
    return { config: null, warnings: ["privacy must be content=never and paths=vault-relative"] };
  }
  if (record.consumer_profile !== "para-kb-v1") {
    return { config: null, warnings: ["consumer_profile must be para-kb-v1"] };
  }

  return {
    config: {
      schemaVersion,
      paraRoots,
      indexFileNames: unique(indexFileNames),
      spinePaths,
      telemetryEnabled,
      telemetryPath,
      telemetryArchiveFolder,
      exclusions: safeExclusionArray(record.exclusions),
      consumerProfile: "para-kb-v1"
    },
    warnings
  };
}

function safePathArray(value: unknown): string[] {
  return unique(
    stringArray(value)
      .map((item) => relativePath(item, false))
      .filter((item): item is string => item !== null)
  );
}

function safeExclusionArray(value: unknown): string[] {
  return unique(
    stringArray(value)
      .map((item) => relativePath(item, item.trim().endsWith("/")))
      .filter((item): item is string => item !== null)
  );
}

function relativePath(value: unknown, directory: boolean): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return null;
  if (normalized.split("/").some((segment) => segment === "..")) return null;
  return directory ? `${normalized.replace(/\/+$/, "")}/` : normalized.replace(/\/+$/, "");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
