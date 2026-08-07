import type { App } from "obsidian";
import type { AdapterConfig, ParaRootRule } from "../adapters/generic";
import { normalizePath, type GraphSnapshot, type LensUiUsageEvent, type ParaCategory } from "../model";
import type { ObservatoryDataset, ViewState } from "../visualization/types";
import {
  LLM_WIKI_TELEMETRY_SCHEMA,
  LLM_WIKI_VAULT_PROFILE
} from "./profiles";

export type PeriodPreset = "7d" | "30d" | "90d" | "all";
export type ConfigSource = "auto" | "profile" | "manual";
export type VaultProfileId = "para-kb-v1" | "llm-wiki-para" | "standard-para" | "custom";
export type TelemetryProfileId = "para-kb-v1" | "llm-wiki-jsonl" | "generic-jsonl" | "custom";

export interface TelemetryEventAliases {
  stop: string[];
  queryStart: string[];
  operationStep: string[];
  querySummary: string[];
  queryComplete: string[];
  autoPathSummary: string[];
  buildStart: string[];
  buildSummary: string[];
  buildComplete: string[];
}

export interface TelemetryCoreFieldAliases {
  eventKind: string[];
  observedAt: string[];
  operationId: string[];
  parentQueryId: string[];
  requestId: string[];
  sessionId: string[];
  operationDurationMs: string[];
  turnDurationMs: string[];
  eventDurationMs: string[];
  inputTokens: string[];
  outputTokens: string[];
  operationTotalTokens: string[];
  eventTotalTokens: string[];
  operationTokenDelta: string[];
  requestTokenDelta: string[];
  tokenReliability: string[];
  toolName: string[];
  stepPaths: string[];
  documentsReadPaths: string[];
  autoDocumentsReadPaths: string[];
  documentsReadCount: string[];
  autoDocumentsReadCount: string[];
  entrypoints: string[];
  autoEntrypoints: string[];
  searchStepCount: string[];
  autoSearchStepCount: string[];
  confidence: string[];
}

export interface TelemetryBuildFieldAliases {
  schemaVersion: string[];
  operationType: string[];
  route: string[];
  kbIngestUsed: string[];
  referencePaths: string[];
  createdPaths: string[];
  updatedPaths: string[];
  movedFromPaths: string[];
  movedToPaths: string[];
  indexPaths: string[];
  linkPairs: string[];
  linksAdded: string[];
  backlinksAdded: string[];
  frontmatterCompleted: string[];
  summariesCompleted: string[];
  validation: string[];
}

export interface TelemetrySchemaMapping {
  events: TelemetryEventAliases;
  coreFields: TelemetryCoreFieldAliases;
  buildFields: TelemetryBuildFieldAliases;
}

export interface ObservatoryPluginSettings {
  schemaVersion: 1;
  configSource: ConfigSource;
  vaultProfile: VaultProfileId;
  telemetryProfile: TelemetryProfileId;
  defaultLensId: string;
  defaultPeriod: PeriodPreset;
  reducedMotion: boolean;
  favoriteLensIds: string[];
  recentLensIds: string[];
  paraRoots: ParaRootRule[];
  indexFileNames: string[];
  spinePaths: string[];
  telemetryPaths: string[];
  telemetryArchiveFolders: string[];
  telemetrySchema: TelemetrySchemaMapping;
  maxTelemetryFiles: number;
  maxSnapshotFiles: number;
  exclusions: string[];
  snapshotRoot: string;
  recordLensUsage: boolean;
}

export interface ObservatoryPluginData {
  settings: ObservatoryPluginSettings;
  lensUsageEvents: LensUiUsageEvent[];
}

export interface TelemetryLoadReport {
  filesRead: string[];
  bytesRead: number;
  parsedLines: number;
  malformedLines: number;
  journeys: number;
  completedJourneys: number;
}

export interface DatasetLoadReport {
  generatedAt: string;
  noteCount: number;
  linkCount: number;
  indexCount: number;
  storedSnapshotCount: number;
  compatibleDiffCount: number;
  telemetry: TelemetryLoadReport;
  warnings: string[];
}

export interface ObservatoryLoadResult {
  dataset: ObservatoryDataset;
  report: DatasetLoadReport;
  settings: ObservatoryPluginSettings;
}

export interface SnapshotCaptureResult {
  snapshot: GraphSnapshot;
  path: string;
}

export interface ObservatoryViewServices {
  app: App;
  loadDataset(): Promise<ObservatoryLoadResult>;
  captureSnapshot(): Promise<SnapshotCaptureResult>;
  openNote(path: string): Promise<void>;
  getSettings(): ObservatoryPluginSettings;
  updateSettings(patch: Partial<ObservatoryPluginSettings>): Promise<void>;
  recordLensUsage(event: LensUiUsageEvent): Promise<void>;
}

export function adapterConfigFromSettings(settings: ObservatoryPluginSettings): AdapterConfig {
  return adapterConfigFromSettingsForConfigDir(settings, ".obsidian");
}

export function adapterConfigFromSettingsForConfigDir(
  settings: ObservatoryPluginSettings,
  configDir: string
): AdapterConfig {
  const normalizedConfigDir = normalizePath(configDir).replace(/\/$/, "");
  const paraRoots = settings.paraRoots.map((root) => ({
    para: root.para,
    prefix: `${resolveVaultPath(root.prefix, configDir).replace(/\/$/, "")}/`
  }));
  const commonRoot = paraRoots.find((root) => root.para === "common")?.prefix ?? null;
  return {
    definitionVersion: `llm-wiki-observatory-adapter-v${settings.schemaVersion}`,
    paraRoots,
    indexFileNames: unique(settings.indexFileNames.map((name) =>
      normalizePath(name).split("/").at(-1)?.toLowerCase() ?? ""
    ).filter(Boolean)),
    telemetryPaths: unique(settings.telemetryPaths.map((path) => resolveVaultPath(path, configDir))),
    generatedPathPrefixes: commonRoot ? [`${commonRoot}reports/`] : [],
    runtimePathPrefixes: [".omx/", `${normalizedConfigDir}/`],
    exclusions: unique(settings.exclusions.map((path) => resolveVaultPath(path, configDir)))
  };
}

export function resolveVaultPath(path: string, configDir: string): string {
  const resolved = path
    .replace(/^\$CONFIG_DIR(?=\/|$)/, normalizePath(configDir).replace(/\/$/, ""))
    .replace(/^\$PLUGIN_DIR(?=\/|$)/, `${normalizePath(configDir).replace(/\/$/, "")}/plugins/llm-wiki-observatory`);
  return normalizePath(resolved);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function viewStateForPeriod(
  preset: PeriodPreset,
  now: Date,
  patch: Partial<ViewState> = {}
): ViewState {
  const milliseconds = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : null;
  return {
    from: milliseconds === null ? null : new Date(now.getTime() - milliseconds * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
    paraScope: [],
    selectedQueryId: null,
    selectedMarkId: null,
    selectedMetric: null,
    beforeSnapshotId: null,
    afterSnapshotId: null,
    indexDepth: 2,
    playbackProgress: 1,
    reducedMotion: false,
    ...patch
  };
}

export const DEFAULT_SETTINGS: ObservatoryPluginSettings = {
  schemaVersion: 1,
  configSource: "auto",
  vaultProfile: "llm-wiki-para",
  telemetryProfile: "llm-wiki-jsonl",
  defaultLensId: "L01",
  defaultPeriod: "30d",
  reducedMotion: false,
  favoriteLensIds: ["L01", "L06", "L11", "L21", "L23"],
  recentLensIds: [],
  paraRoots: LLM_WIKI_VAULT_PROFILE.paraRoots.map((root) => ({ ...root })),
  indexFileNames: [...LLM_WIKI_VAULT_PROFILE.indexFileNames],
  spinePaths: [...LLM_WIKI_VAULT_PROFILE.spinePaths],
  telemetryPaths: [...LLM_WIKI_VAULT_PROFILE.telemetryPaths],
  telemetryArchiveFolders: [...LLM_WIKI_VAULT_PROFILE.telemetryArchiveFolders],
  telemetrySchema: {
    events: cloneAliasRecord(LLM_WIKI_TELEMETRY_SCHEMA.events),
    coreFields: cloneAliasRecord(LLM_WIKI_TELEMETRY_SCHEMA.coreFields),
    buildFields: cloneAliasRecord(LLM_WIKI_TELEMETRY_SCHEMA.buildFields)
  },
  maxTelemetryFiles: 4,
  maxSnapshotFiles: 24,
  exclusions: [
    "$CONFIG_DIR/",
    ".omx/",
    ".trash/",
    "_resource/"
  ],
  snapshotRoot: "$PLUGIN_DIR/snapshots",
  recordLensUsage: true
};

function cloneAliasRecord<T extends object>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).map(([key, aliases]) => [key, [...aliases as string[]]])
  ) as T;
}

export const PARA_OPTIONS: Array<{ value: ParaCategory | "all"; label: string }> = [
  { value: "all", label: "All PARA" },
  { value: "common", label: "Common" },
  { value: "projects", label: "Projects" },
  { value: "areas", label: "Areas" },
  { value: "resources", label: "Resources" },
  { value: "archive", label: "Archive" },
  { value: "inbox", label: "Inbox" }
];
