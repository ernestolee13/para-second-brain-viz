import type { ParaRootRule } from "../adapters/generic";
import type { LensUiUsageEvent, ParaCategory } from "../model";
import { OBSERVATORY_LENSES } from "../visualization/registry";
import {
  DEFAULT_SETTINGS,
  type ObservatoryPluginData,
  type ObservatoryPluginSettings,
  type PeriodPreset,
  type ConfigSource,
  type TelemetryProfileId,
  type TelemetrySchemaMapping,
  type VaultProfileId
} from "./contracts";
import {
  cloneTelemetrySchema,
  TELEMETRY_PROFILES,
  VAULT_PROFILES
} from "./profiles";

const PERIODS = new Set<PeriodPreset>(["7d", "30d", "90d", "all"]);
const PARA_CATEGORIES = new Set<ParaCategory>([
  "common",
  "projects",
  "areas",
  "resources",
  "archive",
  "inbox",
  "unknown"
]);
const LENS_IDS = new Set(OBSERVATORY_LENSES.map((lens) => lens.id));
const CONFIG_SOURCES = new Set<ConfigSource>(["auto", "profile", "manual"]);
const VAULT_PROFILE_IDS = new Set<VaultProfileId>(["para-kb-v1", "llm-wiki-para", "standard-para", "custom"]);
const TELEMETRY_PROFILE_IDS = new Set<TelemetryProfileId>(["para-kb-v1", "llm-wiki-jsonl", "generic-jsonl", "custom"]);
const USAGE_ACTIONS = new Set<LensUiUsageEvent["action"]>([
  "open",
  "foreground",
  "replay",
  "compare",
  "filter",
  "drilldown",
  "unavailable"
]);

export const MAX_LENS_USAGE_EVENTS = 1_000;

export function sanitizePluginData(raw: unknown): ObservatoryPluginData {
  const record = asRecord(raw);
  return {
    settings: sanitizeSettings(record?.settings ?? raw),
    lensUsageEvents: sanitizeUsageEvents(record?.lensUsageEvents)
  };
}

export function sanitizeSettings(raw: unknown): ObservatoryPluginSettings {
  const record = asRecord(raw);
  const roots = sanitizeParaRoots(record?.paraRoots);
  const defaultLensId = stringValue(record?.defaultLensId);
  const defaultPeriod = stringValue(record?.defaultPeriod);
  const vaultProfile = enumValue(record?.vaultProfile, VAULT_PROFILE_IDS, DEFAULT_SETTINGS.vaultProfile);
  const telemetryProfile = enumValue(
    record?.telemetryProfile,
    TELEMETRY_PROFILE_IDS,
    DEFAULT_SETTINGS.telemetryProfile
  );
  const telemetryFallback = telemetryProfile === "custom"
    ? DEFAULT_SETTINGS.telemetrySchema
    : TELEMETRY_PROFILES[telemetryProfile].schema;

  return {
    schemaVersion: 1,
    configSource: enumValue(record?.configSource, CONFIG_SOURCES, DEFAULT_SETTINGS.configSource),
    vaultProfile,
    telemetryProfile,
    defaultLensId: defaultLensId && LENS_IDS.has(defaultLensId)
      ? defaultLensId
      : DEFAULT_SETTINGS.defaultLensId,
    defaultPeriod: defaultPeriod && PERIODS.has(defaultPeriod as PeriodPreset)
      ? defaultPeriod as PeriodPreset
      : DEFAULT_SETTINGS.defaultPeriod,
    reducedMotion: booleanValue(record?.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
    favoriteLensIds: lensIds(record?.favoriteLensIds, DEFAULT_SETTINGS.favoriteLensIds),
    recentLensIds: lensIds(record?.recentLensIds, DEFAULT_SETTINGS.recentLensIds).slice(0, 8),
    paraRoots: roots.length > 0 ? roots : cloneParaRoots(DEFAULT_SETTINGS.paraRoots),
    indexFileNames: stringArray(record?.indexFileNames, DEFAULT_SETTINGS.indexFileNames),
    spinePaths: stringArray(record?.spinePaths, DEFAULT_SETTINGS.spinePaths),
    telemetryPaths: stringArray(record?.telemetryPaths, DEFAULT_SETTINGS.telemetryPaths).map(migrateConfigPath),
    telemetryArchiveFolders: stringArray(
      record?.telemetryArchiveFolders,
      DEFAULT_SETTINGS.telemetryArchiveFolders
    ).map(migrateConfigPath),
    telemetrySchema: sanitizeTelemetrySchema(record?.telemetrySchema, telemetryFallback),
    maxTelemetryFiles: integerValue(record?.maxTelemetryFiles, 1, 32, DEFAULT_SETTINGS.maxTelemetryFiles),
    maxSnapshotFiles: integerValue(record?.maxSnapshotFiles, 1, 120, DEFAULT_SETTINGS.maxSnapshotFiles),
    exclusions: stringArray(record?.exclusions, DEFAULT_SETTINGS.exclusions).map(migrateConfigPath),
    snapshotRoot: migrateSnapshotRoot(stringValue(record?.snapshotRoot) ?? DEFAULT_SETTINGS.snapshotRoot),
    recordLensUsage: booleanValue(record?.recordLensUsage, DEFAULT_SETTINGS.recordLensUsage)
  };
}

export function sanitizeUsageEvents(raw: unknown): LensUiUsageEvent[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((value): LensUiUsageEvent[] => {
    const event = asRecord(value);
    const id = stringValue(event?.id);
    const observedAt = stringValue(event?.observedAt);
    const lensId = stringValue(event?.lensId);
    const action = stringValue(event?.action);
    if (
      !id ||
      !observedAt ||
      !lensId ||
      !LENS_IDS.has(lensId) ||
      !action ||
      !USAGE_ACTIONS.has(action as LensUiUsageEvent["action"])
    ) {
      return [];
    }

    const dwellMs = finiteNumber(event?.dwellMs);
    return [{
      id,
      observedAt,
      lensId,
      action: action as LensUiUsageEvent["action"],
      ...(dwellMs === null ? {} : { dwellMs: Math.max(0, Math.round(dwellMs)) })
    }];
  }).slice(-MAX_LENS_USAGE_EVENTS);
}

export function withRecentLens(
  settings: ObservatoryPluginSettings,
  lensId: string
): ObservatoryPluginSettings {
  if (!LENS_IDS.has(lensId)) return settings;
  return {
    ...settings,
    recentLensIds: [lensId, ...settings.recentLensIds.filter((id) => id !== lensId)].slice(0, 8)
  };
}

export function parseList(value: string): string[] {
  return uniqueStrings(value.split(/[\n,]/));
}

export function formatList(values: readonly string[]): string {
  return values.join("\n");
}

export function parseParaRoots(value: string): ParaRootRule[] {
  return value.split("\n").flatMap((line): ParaRootRule[] => {
    const separator = line.indexOf("=");
    if (separator < 1) return [];
    const para = line.slice(0, separator).trim();
    const prefix = line.slice(separator + 1).trim();
    if (!PARA_CATEGORIES.has(para as ParaCategory) || !prefix) return [];
    return [{ para: para as ParaCategory, prefix }];
  });
}

export function formatParaRoots(roots: readonly ParaRootRule[]): string {
  return roots.map((root) => `${root.para}=${root.prefix}`).join("\n");
}

export function vaultProfilePatch(profileId: VaultProfileId): Partial<ObservatoryPluginSettings> {
  if (profileId === "custom") return { vaultProfile: "custom" };
  const profile = VAULT_PROFILES[profileId];
  return {
    vaultProfile: profileId,
    paraRoots: cloneParaRoots(profile.paraRoots),
    indexFileNames: [...profile.indexFileNames],
    spinePaths: [...profile.spinePaths],
    telemetryPaths: [...profile.telemetryPaths],
    telemetryArchiveFolders: [...profile.telemetryArchiveFolders],
    exclusions: [...profile.exclusions]
  };
}

export function telemetryProfilePatch(profileId: TelemetryProfileId): Partial<ObservatoryPluginSettings> {
  if (profileId === "custom") return { telemetryProfile: "custom" };
  return {
    telemetryProfile: profileId,
    telemetrySchema: cloneTelemetrySchema(TELEMETRY_PROFILES[profileId].schema)
  };
}

export function formatTelemetrySchema(schema: TelemetrySchemaMapping): string {
  return JSON.stringify(schema, null, 2);
}

export function parseTelemetrySchema(value: string): TelemetrySchemaMapping | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    const record = asRecord(parsed);
    if (!record || !asRecord(record.events) || !asRecord(record.coreFields) || !asRecord(record.buildFields)) {
      return null;
    }
    return sanitizeTelemetrySchema(parsed, DEFAULT_SETTINGS.telemetrySchema);
  } catch {
    return null;
  }
}

export function sanitizeTelemetrySchema(
  raw: unknown,
  fallback: TelemetrySchemaMapping = DEFAULT_SETTINGS.telemetrySchema
): TelemetrySchemaMapping {
  const record = asRecord(raw);
  return {
    events: sanitizeAliasRecord(record?.events, fallback.events),
    coreFields: sanitizeAliasRecord(record?.coreFields, fallback.coreFields),
    buildFields: sanitizeAliasRecord(record?.buildFields, fallback.buildFields)
  };
}

function sanitizeParaRoots(raw: unknown): ParaRootRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const roots: ParaRootRule[] = [];
  for (const value of raw) {
    const record = asRecord(value);
    const para = stringValue(record?.para);
    const prefix = stringValue(record?.prefix);
    if (!para || !PARA_CATEGORIES.has(para as ParaCategory) || !prefix) continue;
    const key = `${para}:${prefix}`;
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ para: para as ParaCategory, prefix });
  }
  return roots;
}

function cloneParaRoots(roots: readonly ParaRootRule[]): ParaRootRule[] {
  return roots.map((root) => ({ ...root }));
}

function sanitizeAliasRecord<T extends object>(raw: unknown, fallback: T): T {
  const record = asRecord(raw);
  return Object.fromEntries(
    Object.entries(fallback).map(([key, fallbackAliases]) => [
      key,
      stringArray(record?.[key], fallbackAliases as string[])
    ])
  ) as T;
}

function lensIds(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  return uniqueStrings(raw).filter((id) => LENS_IDS.has(id));
}

function stringArray(raw: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback];
  return uniqueStrings(raw);
}

function uniqueStrings(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    const normalized = stringValue(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function integerValue(raw: unknown, min: number, max: number, fallback: number): number {
  const value = finiteNumber(raw);
  return value === null ? fallback : Math.min(max, Math.max(min, Math.round(value)));
}

function finiteNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function booleanValue(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function enumValue<T extends string>(raw: unknown, values: ReadonlySet<T>, fallback: T): T {
  const value = stringValue(raw);
  return value && values.has(value as T) ? value as T : fallback;
}

function migrateConfigPath(path: string): string {
  return path.replace(/^\.obsidian(?=\/|$)/, "$CONFIG_DIR");
}

function migrateSnapshotRoot(path: string): string {
  const migrated = migrateConfigPath(path);
  return migrated.replace(/^\$CONFIG_DIR\/plugins\/llm-wiki-observatory(?=\/|$)/, "$PLUGIN_DIR");
}

function stringValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}
