import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import { NeuralGraphEnhancer } from "./core-graph/enhancer";
import type { LensUiUsageEvent } from "./model";
import { createObservatoryDataService, type ObservatoryDataService } from "./obsidian";
import {
  resolveVaultPath,
  type ObservatoryPluginData,
  type ObservatoryPluginSettings,
  type ObservatoryViewServices,
  viewStateForPeriod
} from "./plugin/contracts";
import {
  sanitizePluginData,
  sanitizeSettings,
  sanitizeUsageEvents
} from "./plugin/settings-model";
import { ObservatorySettingTab, type ObservatorySettingsHost } from "./plugin/settings-tab";
import { OBSERVATORY_LENSES } from "./visualization/registry";
import {
  OBSERVATORY_VIEW_TYPE,
  ObservatoryItemView
} from "./view/ObservatoryItemView";

export interface ObservatoryAvailabilityReport {
  generatedAt: string;
  source: {
    notes: number;
    links: number;
    indexes: number;
    journeys: number;
    completedJourneys: number;
    telemetryFiles: number;
    malformedTelemetryLines: number;
    storedSnapshots: number;
    compatibleDiffs: number;
    warnings: string[];
  };
  capabilities: string[];
  summary: Record<"ready" | "partial" | "unavailable", number>;
  lenses: Array<{
    id: string;
    title: string;
    family: string;
    primitive: string;
    status: "ready" | "partial" | "unavailable";
    confidence: "measured" | "inferred" | "unavailable";
    missingCapabilities: string[];
  }>;
}

export default class LlmWikiObservatoryPlugin extends Plugin implements ObservatorySettingsHost {
  private pluginData: ObservatoryPluginData = sanitizePluginData(null);
  private dataService!: ObservatoryDataService;
  private services!: ObservatoryViewServices;
  private graphEnhancer!: NeuralGraphEnhancer;
  private saveQueue: Promise<void> = Promise.resolve();

  get settings(): ObservatoryPluginSettings {
    return this.pluginData.settings;
  }

  async onload(): Promise<void> {
    this.pluginData = sanitizePluginData(await this.loadData());
    this.dataService = createObservatoryDataService(this.app, {
      getSettings: () => this.settings,
      saveSettings: async (settings) => this.replaceSettings(settings),
      getLensUsageEvents: () => this.pluginData.lensUsageEvents,
      saveLensUsageEvents: async (events) => this.replaceLensUsageEvents(events)
    });
    this.services = {
      app: this.app,
      loadDataset: () => this.dataService.loadDataset(),
      captureSnapshot: () => this.dataService.captureSnapshot(),
      openNote: (path) => this.dataService.openNote(path),
      getSettings: () => this.settings,
      updateSettings: (patch) => this.updateSettings(patch),
      recordLensUsage: (event) => this.dataService.recordLensUsage(event)
    };
    this.graphEnhancer = new NeuralGraphEnhancer(this.app, {
      loadDataset: () => this.dataService.loadDataset()
    });

    this.registerView(
      OBSERVATORY_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new ObservatoryItemView(leaf, this.services)
    );

    this.addRibbonIcon("network", "Open PARA Second Brain", () => {
      void this.openNeuralGraph();
    });
    this.addCommand({
      id: "open-neural-graph",
      name: "Open PARA Second Brain graph",
      callback: () => {
        void this.openNeuralGraph();
      }
    });
    this.addCommand({
      id: "open",
      name: "Open PARA Second Brain metrics lab",
      callback: () => {
        void this.openObservatory();
      }
    });
    this.addCommand({
      id: "refresh",
      name: "Refresh PARA Second Brain data",
      callback: () => {
        void this.refreshObservatoryViews(true);
      }
    });
    this.addCommand({
      id: "capture-snapshot",
      name: "Capture vault snapshot",
      callback: () => {
        void this.captureSnapshot();
      }
    });
    this.addCommand({
      id: "validate-vault-profile",
      name: "Validate vault profile",
      callback: () => {
        void this.validateProfile();
      }
    });
    this.addCommand({
      id: "log-availability-report",
      name: "Log lens availability report",
      callback: () => {
        void this.logAvailabilityReport();
      }
    });
    const syncGraphVisibility = (): void => {
      this.graphEnhancer.prune();
      requestAnimationFrame(() => this.graphEnhancer.prune());
      window.setTimeout(() => this.graphEnhancer.prune(), 50);
    };
    this.registerEvent(this.app.workspace.on("layout-change", syncGraphVisibility));
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncGraphVisibility));
    this.addSettingTab(new ObservatorySettingTab(this.app, this));
  }

  onunload(): void {
    this.graphEnhancer.destroy();
    this.app.workspace.detachLeavesOfType(OBSERVATORY_VIEW_TYPE);
  }

  async updateSettings(patch: Partial<ObservatoryPluginSettings>): Promise<void> {
    await this.replaceSettings({ ...this.settings, ...patch });
  }

  async refreshObservatoryViews(openWhenMissing = false): Promise<void> {
    const views = this.getObservatoryViews();
    const hasGraph = this.graphEnhancer.hasSessions();
    try {
      await Promise.all([
        this.graphEnhancer.refresh(),
        ...views.map((view) => view.refresh())
      ]);
      if (views.length === 0 && !hasGraph && openWhenMissing) await this.openObservatory();
    } catch (error) {
      console.error("PARA Second Brain refresh failed", error);
      new Notice(`PARA Second Brain refresh failed: ${errorMessage(error)}`);
    }
  }

  async validateProfile(): Promise<void> {
    const resolved = await this.dataService.getEffectiveSettings();
    const settings = resolved.settings;
    const configDir = this.app.vault.configDir?.trim() || ".obsidian";
    const files = this.app.vault.getMarkdownFiles();
    const indexNames = new Set(settings.indexFileNames.map((name) => name.split("/").at(-1)?.toLocaleLowerCase()));
    const roots = settings.paraRoots.map((root) => ({
      para: root.para,
      path: `${resolveVaultPath(root.prefix, configDir).replace(/\/$/, "")}/`
    }));
    const rootChecks = await Promise.all(roots.map(async (root) => ({
      ...root,
      exists: await this.app.vault.adapter.exists(root.path.replace(/\/$/, "")),
      indexCount: files.filter((file) =>
        file.path.startsWith(root.path) && indexNames.has(file.name.toLocaleLowerCase())
      ).length
    })));
    const spineChecks = await Promise.all(settings.spinePaths.map(async (path) => ({
      path: resolveVaultPath(path, configDir),
      exists: await this.app.vault.adapter.exists(resolveVaultPath(path, configDir))
    })));
    const telemetryChecks = await Promise.all(settings.telemetryPaths.map(async (path) => ({
      path: resolveVaultPath(path, configDir),
      exists: await this.app.vault.adapter.exists(resolveVaultPath(path, configDir))
    })));
    const archiveChecks = await Promise.all(settings.telemetryArchiveFolders.map(async (path) => ({
      path: resolveVaultPath(path, configDir),
      exists: await this.app.vault.adapter.exists(resolveVaultPath(path, configDir))
    })));
    const missingRoots = rootChecks.filter((root) => !root.exists);
    const unindexedRoots = rootChecks.filter((root) =>
      root.exists && root.para !== "inbox" && root.para !== "unknown" && root.indexCount === 0
    );
    const missingSpines = spineChecks.filter((item) => !item.exists);
    const missingTelemetry = telemetryChecks.filter((item) => !item.exists);
    const missingArchives = archiveChecks.filter((item) => !item.exists);
    const issueCount = missingRoots.length + unindexedRoots.length + missingSpines.length + missingTelemetry.length + resolved.warnings.length;
    const report = {
      configurationSource: resolved.detected ? ".para-kb/config.json" : settings.configSource,
      profile: settings.vaultProfile,
      telemetryProfile: settings.telemetryProfile,
      roots: rootChecks,
      spineNotes: spineChecks,
      telemetrySources: telemetryChecks,
      telemetryArchives: archiveChecks,
      warnings: {
        configuration: resolved.warnings,
        missingRoots: missingRoots.map((item) => item.path),
        rootsWithoutIndexes: unindexedRoots.map((item) => item.path),
        missingSpineNotes: missingSpines.map((item) => item.path),
        missingTelemetrySources: missingTelemetry.map((item) => item.path),
        missingTelemetryArchives: missingArchives.map((item) => item.path)
      }
    };
    console.info("PARA Second Brain profile validation", report);
    if (issueCount === 0 && resolved.warnings.length === 0) {
      new Notice(
        `PARA Second Brain profile ready: ${rootChecks.length} roots, ${rootChecks.reduce((sum, root) => sum + root.indexCount, 0)} indexes, ${spineChecks.length} spine notes, ${telemetryChecks.length} active telemetry source(s).`,
        8_000
      );
      return;
    }
    new Notice(
      `PARA Second Brain profile needs attention: ${missingRoots.length} missing root(s), ${unindexedRoots.length} root(s) without an index, ${missingSpines.length} missing spine note(s), ${missingTelemetry.length} missing telemetry source(s). See developer console.`,
      10_000
    );
  }

  async getAvailabilityReport(): Promise<ObservatoryAvailabilityReport> {
    const { dataset, report } = await this.dataService.loadDataset();
    const state = viewStateForPeriod(this.settings.defaultPeriod, new Date(), {
      reducedMotion: true
    });
    const lenses = OBSERVATORY_LENSES.map((lens) => {
      const scene = lens.buildModel(dataset, state);
      return {
        id: lens.id,
        title: lens.title,
        family: lens.family,
        primitive: lens.primitive,
        status: scene.status,
        confidence: scene.confidence,
        missingCapabilities: [...scene.missingCapabilities]
      };
    });
    const summary: ObservatoryAvailabilityReport["summary"] = {
      ready: 0,
      partial: 0,
      unavailable: 0
    };
    for (const lens of lenses) summary[lens.status] += 1;

    return {
      generatedAt: report.generatedAt,
      source: {
        notes: report.noteCount,
        links: report.linkCount,
        indexes: report.indexCount,
        journeys: report.telemetry.journeys,
        completedJourneys: report.telemetry.completedJourneys,
        telemetryFiles: report.telemetry.filesRead.length,
        malformedTelemetryLines: report.telemetry.malformedLines,
        storedSnapshots: report.storedSnapshotCount,
        compatibleDiffs: report.compatibleDiffCount,
        warnings: [...report.warnings]
      },
      capabilities: [...dataset.capabilities].sort(),
      summary,
      lenses
    };
  }

  private async openObservatory(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(OBSERVATORY_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: OBSERVATORY_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openNeuralGraph(): Promise<void> {
    try {
      const result = await this.graphEnhancer.open();
      new Notice(
        `PARA Second Brain ready: ${result.matchedNodes}/${result.totalNodes} notes structured, ${result.queryTracks} query and ${result.constructionTracks} build paths.`
      );
    } catch (error) {
      new Notice(`PARA Second Brain unavailable: ${errorMessage(error)}`);
    }
  }

  private getObservatoryViews(): ObservatoryItemView[] {
    return this.app.workspace
      .getLeavesOfType(OBSERVATORY_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is ObservatoryItemView => view instanceof ObservatoryItemView);
  }

  private async captureSnapshot(): Promise<void> {
    const views = this.getObservatoryViews();
    if (views[0]) {
      const captured = await views[0].captureSnapshot();
      new Notice(captured
        ? "PARA Second Brain snapshot captured."
        : "PARA Second Brain snapshot capture failed. See the view status for details.");
      return;
    }

    try {
      const result = await this.dataService.captureSnapshot();
      new Notice(`PARA Second Brain snapshot captured: ${result.path}`);
    } catch (error) {
      new Notice(`Snapshot capture failed: ${errorMessage(error)}`);
    }
  }

  private async logAvailabilityReport(): Promise<void> {
    try {
      const report = await this.getAvailabilityReport();
      console.info("PARA Second Brain availability", report);
      new Notice(
        `Lens availability: ${report.summary.ready} ready, ${report.summary.partial} partial, ${report.summary.unavailable} unavailable. See developer console.`
      );
    } catch (error) {
      new Notice(`Availability report failed: ${errorMessage(error)}`);
    }
  }

  private async replaceSettings(settings: ObservatoryPluginSettings): Promise<void> {
    this.pluginData = {
      ...this.pluginData,
      settings: sanitizeSettings(settings)
    };
    await this.persistData();
  }

  private async replaceLensUsageEvents(events: LensUiUsageEvent[]): Promise<void> {
    this.pluginData = {
      ...this.pluginData,
      lensUsageEvents: sanitizeUsageEvents(events)
    };
    await this.persistData();
  }

  private persistData(): Promise<void> {
    const data = this.pluginData;
    const pending = this.saveQueue.then(async () => this.saveData(data));
    // The caller receives this failure; only the internal queue tail recovers so later saves can retry.
    this.saveQueue = pending.catch(() => undefined);
    return pending;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
