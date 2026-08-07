import type { App } from "obsidian";
import {
  adapterConfigFromSettingsForConfigDir,
  resolveVaultPath,
  type DatasetLoadReport,
  type ObservatoryLoadResult,
  type ObservatoryPluginSettings,
  type SnapshotCaptureResult,
  type TelemetryLoadReport
} from "../plugin/contracts";
import { createGraphSnapshot, type VaultFileInput } from "../adapters/generic";
import { diffSnapshots, snapshotCompatibilityError } from "../snapshots/diff";
import {
  canonicalSnapshotRoot,
  safeSnapshotScopeId,
  SnapshotRepository
} from "../snapshots/store";
import {
  type GraphSnapshot,
  type LensUiUsageEvent,
  type MetricScope,
  type QueryJourney,
  type TelemetryLineResult,
  compareNullableTimestamps,
  normalizePath
} from "../model";
import { stableHash } from "../usage/hash";
import { groupQueryJourneys, parseTelemetryJsonl } from "../usage/jsonl";
import { createObservatoryDataset } from "../visualization/dataset";
import { resolveParaKbSettings, type ParaKbConfigResolution } from "../plugin/paraKbConfig";
import { ObsidianAdapterSnapshotStorage } from "./adapter-storage";
import type { ObservatoryAppLike, ObservatoryMarkdownFile } from "./types";

export interface ObservatoryDataServiceOptions {
  getSettings: () => ObservatoryPluginSettings;
  saveSettings?: (settings: ObservatoryPluginSettings) => Promise<void>;
  getLensUsageEvents?: () => LensUiUsageEvent[];
  saveLensUsageEvents?: (events: LensUiUsageEvent[]) => Promise<void>;
  now?: () => Date;
}

interface LoadedTelemetry {
  journeys: QueryJourney[];
  report: TelemetryLoadReport;
  warnings: string[];
}

interface LoadedSnapshots {
  snapshots: GraphSnapshot[];
  warnings: string[];
}

export class ObservatoryDataService {
  constructor(
    private readonly app: ObservatoryAppLike,
    private readonly options: ObservatoryDataServiceOptions
  ) {}

  getSettings(): ObservatoryPluginSettings {
    return this.options.getSettings();
  }

  async updateSettings(patch: Partial<ObservatoryPluginSettings>): Promise<void> {
    const next = { ...this.getSettings(), ...patch };
    await this.options.saveSettings?.(next);
  }

  async recordLensUsage(event: LensUiUsageEvent): Promise<void> {
    if (!this.getSettings().recordLensUsage) return;
    const events = [...(this.options.getLensUsageEvents?.() ?? []), sanitizeLensUsageEvent(event)];
    await this.options.saveLensUsageEvents?.(events);
  }

  async openNote(path: string): Promise<void> {
    await this.app.workspace?.openLinkText?.(normalizePath(path), "", false);
  }

  async captureSnapshot(): Promise<SnapshotCaptureResult> {
    const { settings } = await this.getEffectiveSettings();
    const snapshot = this.observeSnapshot(settings, this.nowIso());
    const repository = this.createSnapshotRepository(settings);
    const path = await repository.save(snapshot);
    return { snapshot, path };
  }

  async loadDataset(): Promise<ObservatoryLoadResult> {
    const resolved = await this.getEffectiveSettings();
    const settings = resolved.settings;
    const generatedAt = this.nowIso();
    const current = this.observeSnapshot(settings, generatedAt);
    const [telemetry, stored] = await Promise.all([
      this.loadTelemetry(settings),
      this.loadStoredSnapshots(settings, current)
    ]);
    const warnings = [...resolved.warnings, ...telemetry.warnings, ...stored.warnings];
    const snapshots = uniqueSnapshots([...stored.snapshots, current]).sort(compareSnapshots);
    const diffs = compatibleConsecutiveDiffs(snapshots, warnings);
    const dataset = createObservatoryDataset({
      current,
      snapshots,
      diffs,
      journeys: telemetry.journeys,
      generatedAt
    });
    const report: DatasetLoadReport = {
      generatedAt,
      noteCount: current.notes.length,
      linkCount: current.links.length,
      indexCount: current.notes.filter((note) => note.role === "index").length,
      storedSnapshotCount: stored.snapshots.length,
      compatibleDiffCount: diffs.length,
      telemetry: telemetry.report,
      warnings
    };
    return { dataset, report, settings };
  }

  async getEffectiveSettings(): Promise<ParaKbConfigResolution> {
    return resolveParaKbSettings(this.app.vault.adapter, this.getSettings());
  }

  observeSnapshot(settings: ObservatoryPluginSettings, observedAt: string): GraphSnapshot {
    const configDir = this.configDir();
    return createGraphSnapshot(
      this.collectVaultFiles(),
      observedAt,
      scopeFromSettings(settings, configDir),
      adapterConfigFromSettingsForConfigDir(settings, configDir)
    );
  }

  collectVaultFiles(): VaultFileInput[] {
    return this.app.vault.getMarkdownFiles().map((file): VaultFileInput => {
      const metadata = this.app.metadataCache.getFileCache(file);
      const markdownFile = file as ObservatoryMarkdownFile;
      const input: VaultFileInput = {
        path: markdownFile.path,
      };
      if (markdownFile.basename !== undefined) input.basename = markdownFile.basename;
      if (markdownFile.extension !== undefined) input.extension = markdownFile.extension;
      if (markdownFile.stat !== undefined) input.stat = markdownFile.stat;
      if (metadata?.frontmatter !== undefined) input.frontmatter = metadata.frontmatter;
      if (metadata?.links !== undefined) {
        input.links = metadata.links.map((link) => ({
          link: link.link,
          ...(link.displayText !== undefined ? { displayText: link.displayText } : {})
        }));
      }
      return input;
    });
  }

  private async loadTelemetry(settings: ObservatoryPluginSettings): Promise<LoadedTelemetry> {
    const warnings: string[] = [];
    const configDir = this.configDir();
    const selectedArchivePaths = await selectNewestArchiveFiles(
      this.app,
      settings.telemetryArchiveFolders.map((path) => resolveVaultPath(path, configDir)),
      settings.maxTelemetryFiles,
      warnings
    );
    const sources = uniquePaths([
      ...settings.telemetryPaths.map((path) => resolveVaultPath(path, configDir)),
      ...selectedArchivePaths
    ]);
    const parsedLines: TelemetryLineResult[] = [];
    const filesRead: string[] = [];
    let bytesRead = 0;

    for (const source of sources) {
      const normalized = normalizePath(source);
      try {
        if (!(await this.app.vault.adapter.exists(normalized))) {
          warnings.push(`Telemetry source missing: ${normalized}`);
          continue;
        }
        const text = await this.app.vault.adapter.read(normalized);
        filesRead.push(normalized);
        bytesRead += text.length;
        warnings.push(...telemetrySchemaWarnings(text, normalized));
        parsedLines.push(...parseTelemetryJsonl(text, normalized, settings.telemetrySchema));
      } catch (error) {
        warnings.push(`Telemetry source skipped: ${normalized}: ${errorMessage(error)}`);
      }
    }

    const journeys = groupQueryJourneys(parsedLines);
    return {
      journeys,
      report: {
        filesRead,
        bytesRead,
        parsedLines: parsedLines.filter((line) => !line.malformed).length,
        malformedLines: parsedLines.filter((line) => line.malformed).length,
        journeys: journeys.length,
        completedJourneys: journeys.filter((journey) => journey.completed).length
      },
      warnings
    };
  }

  private async loadStoredSnapshots(
    settings: ObservatoryPluginSettings,
    current: GraphSnapshot
  ): Promise<LoadedSnapshots> {
    const repository = this.createSnapshotRepository(settings);
    const warnings: string[] = [];
    const snapshots: GraphSnapshot[] = [];
    let paths: string[];
    try {
      paths = await repository.list();
    } catch (error) {
      return {
        snapshots,
        warnings: [`Snapshot list skipped: ${errorMessage(error)}`]
      };
    }

    const jsonPaths = paths.filter((item) => item.endsWith(".json"));
    const snapshotRoot = canonicalSnapshotRoot(resolveVaultPath(settings.snapshotRoot, this.configDir()));
    const scopePrefix = `${snapshotRoot}/${safeSnapshotScopeId(current.scope.id)}/`;
    const sameScopePaths = jsonPaths
      .filter((path) => normalizePath(path).startsWith(scopePrefix))
      .sort();
    const outsideScopeCount = jsonPaths.length - sameScopePaths.length;
    if (outsideScopeCount > 0) {
      warnings.push(
        `Ignored ${outsideScopeCount} stored snapshot file(s) outside the current scope; files were preserved.`
      );
    }
    const selectedPaths = sameScopePaths.slice(-settings.maxSnapshotFiles);
    if (selectedPaths.length < sameScopePaths.length) {
      warnings.push(
        `Snapshot history limited to the newest ${settings.maxSnapshotFiles} file(s); older files were preserved.`
      );
    }

    for (const path of selectedPaths) {
      try {
        const snapshot = await repository.load(path);
        if (!snapshot) continue;
        if (!isGraphSnapshot(snapshot)) {
          warnings.push(`Snapshot skipped with invalid shape: ${path}`);
          continue;
        }
        const incompatibility = snapshotCompatibilityError(snapshot, current);
        if (incompatibility) {
          warnings.push(`Snapshot skipped as incompatible: ${path}: ${incompatibility}`);
          continue;
        }
        snapshots.push(snapshot);
      } catch (error) {
        warnings.push(`Snapshot skipped: ${path}: ${errorMessage(error)}`);
      }
    }

    return { snapshots: snapshots.sort(compareSnapshots), warnings };
  }

  private createSnapshotRepository(settings: ObservatoryPluginSettings): SnapshotRepository {
    return new SnapshotRepository(new ObsidianAdapterSnapshotStorage(this.app.vault.adapter), {
      rootPath: canonicalSnapshotRoot(resolveVaultPath(settings.snapshotRoot, this.configDir()))
    });
  }

  private configDir(): string {
    return this.app.vault.configDir?.trim() || ".obsidian";
  }

  private nowIso(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export function createObservatoryDataService(
  app: App,
  options: ObservatoryDataServiceOptions
): ObservatoryDataService {
  return new ObservatoryDataService(app, options);
}

export function scopeFromSettings(
  settings: ObservatoryPluginSettings,
  configDir = ".obsidian"
): MetricScope {
  const config = adapterConfigFromSettingsForConfigDir(settings, configDir);
  const exclusions = [...config.exclusions].sort();
  const signature = JSON.stringify({
    schemaVersion: settings.schemaVersion,
    paraRoots: [...config.paraRoots].sort((left, right) =>
      left.para.localeCompare(right.para) || left.prefix.localeCompare(right.prefix)
    ),
    indexFileNames: [...config.indexFileNames].sort(),
    exclusions
  });
  const hash = stableHash(signature).slice(0, 10);
  return {
    id: `vault-settings-v${settings.schemaVersion}-${hash}`,
    label: `Vault settings v${settings.schemaVersion}`,
    exclusions
  };
}

async function selectNewestArchiveFiles(
  app: ObservatoryAppLike,
  folders: string[],
  maxFiles: number,
  warnings: string[]
): Promise<string[]> {
  if (maxFiles <= 0) return [];
  const candidates: Array<{ path: string; mtime: number | null }> = [];
  for (const folder of folders) {
    const normalized = normalizePath(folder);
    try {
      if (!(await app.vault.adapter.exists(normalized))) {
        warnings.push(`Telemetry archive folder missing: ${normalized}`);
        continue;
      }
      const listed = await app.vault.adapter.list(normalized);
      for (const file of listed.files.filter((path) => normalizePath(path).endsWith(".jsonl"))) {
        candidates.push({ path: normalizePath(file), mtime: await safeMtime(app, file) });
      }
    } catch (error) {
      warnings.push(`Telemetry archive folder skipped: ${normalized}: ${errorMessage(error)}`);
    }
  }

  return candidates
    .sort((left, right) => {
      if (left.mtime !== null && right.mtime !== null && left.mtime !== right.mtime) return right.mtime - left.mtime;
      if (left.mtime !== null && right.mtime === null) return -1;
      if (left.mtime === null && right.mtime !== null) return 1;
      return right.path.localeCompare(left.path);
    })
    .slice(0, maxFiles)
    .map((item) => item.path);
}

async function safeMtime(app: ObservatoryAppLike, path: string): Promise<number | null> {
  if (!app.vault.adapter.stat) return null;
  try {
    const stat = await app.vault.adapter.stat(normalizePath(path));
    return typeof stat?.mtime === "number" && Number.isFinite(stat.mtime) ? stat.mtime : null;
  } catch {
    return null;
  }
}

function compatibleConsecutiveDiffs(snapshots: GraphSnapshot[], warnings: string[]) {
  const diffs = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const before = snapshots[index - 1];
    const after = snapshots[index];
    if (!before || !after) continue;
    try {
      diffs.push(diffSnapshots(before, after));
    } catch (error) {
      warnings.push(`Snapshot diff rejected: ${before.id} -> ${after.id}: ${errorMessage(error)}`);
    }
  }
  return diffs;
}

function uniqueSnapshots(snapshots: GraphSnapshot[]): GraphSnapshot[] {
  const byId = new Map<string, GraphSnapshot>();
  for (const snapshot of snapshots) byId.set(snapshot.id, snapshot);
  return [...byId.values()];
}

function compareSnapshots(left: GraphSnapshot, right: GraphSnapshot): number {
  return compareNullableTimestamps(left.observedAt, right.observedAt) || left.id.localeCompare(right.id);
}

function isGraphSnapshot(value: unknown): value is GraphSnapshot {
  if (value === null || typeof value !== "object") return false;
  const snapshot = value as Partial<GraphSnapshot>;
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.definitionVersion === "string" &&
    typeof snapshot.observedAt === "string" &&
    snapshot.scope !== undefined &&
    Array.isArray(snapshot.notes) &&
    Array.isArray(snapshot.links) &&
    Array.isArray(snapshot.metrics)
  );
}

function sanitizeLensUsageEvent(event: LensUiUsageEvent): LensUiUsageEvent {
  return {
    id: event.id,
    observedAt: event.observedAt,
    lensId: event.lensId,
    action: event.action,
    ...(event.dwellMs !== undefined ? { dwellMs: event.dwellMs } : {})
  };
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function telemetrySchemaWarnings(text: string, source: string): string[] {
  const versions = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      if (
        record.schema === "para-kb.telemetry" &&
        typeof record.schema_version === "number" &&
        Number.isInteger(record.schema_version) &&
        record.schema_version > 1
      ) {
        versions.add(record.schema_version);
      }
    } catch {
      // The normal parser reports malformed lines; do not duplicate that warning here.
    }
  }
  return [...versions]
    .sort((left, right) => left - right)
    .map((version) => `${source} uses newer PARA KB telemetry schema v${version}; known fields were parsed with v1 compatibility.`);
}
