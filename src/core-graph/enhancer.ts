import type { App, WorkspaceLeaf } from "obsidian";
import {
  resolveVaultPath,
  type ObservatoryLoadResult,
  type ObservatoryPluginSettings,
  type PeriodPreset
} from "../plugin/contracts";
import type { ObservatoryDataset } from "../visualization/types";
import { CoreGraphBridge, waitForCoreGraphBridge, type ScreenPoint } from "./bridge";
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
  INBOX_ORIGIN_PATH,
  buildStructuredGraph,
  type ConstructionHealth,
  type ConcurrentReplayTrackState,
  type ConstructionStatus,
  type GrowthReplay,
  type GrowthReplayEvent,
  type KnowledgeAudit,
  type KnowledgeAuditFocus,
  type KnowledgeAuditNode,
  type ParaRegion,
  type RegionActivity,
  type ReplaySegment,
  type ReplayTrack,
  type StructuredGraphModel,
  type StructuredNode
} from "./model";

type ActivityFocus = "all" | "low" | "high" | "growth";
type ConstructionFocus = "all" | "attention" | "unintegrated";
type GraphViewMode = "activity" | "search" | "ingest" | "health" | "audit";
type ReplayBatchPreset = "10" | "20" | "50" | "all";

interface NeuralGraphEnhancerOptions {
  loadDataset(): Promise<ObservatoryLoadResult>;
}

interface ReplayGeometry {
  source: ScreenPoint;
  control: ScreenPoint;
  target: ScreenPoint;
}

interface NeuralGraphLoadingOverlay {
  update(progress: number, label: string, detail?: string): void;
  fail(label: string): void;
  destroy(): void;
}

export interface NeuralGraphOpenResult {
  matchedNodes: number;
  totalNodes: number;
  queryTracks: number;
  constructionTracks: number;
}

const PARA_COLORS: Record<string, string> = {
  common: "#9c8fd6",
  projects: "#d9826b",
  areas: "#71a6cf",
  resources: "#65ad91",
  archive: "#8a93a6",
  inbox: "#c2a56a",
  unknown: "#7d8492"
};

const CONSTRUCTION_COLORS: Record<ConstructionStatus, string> = {
  healthy: "#54d6a3",
  attention: "#efb45f",
  unintegrated: "#ef756f"
};

const AUDIT_COLORS: Record<KnowledgeAuditFocus, string> = {
  orphan: "#ef8a78",
  unlinked: "#f06e73",
  "search-dormant": "#74a8d8",
  "ingest-dormant": "#a58be3",
  inactive: "#e4ad62",
  cold: "#d2a35f"
};

const PERIOD_WAVE_DURATION_MS = 6_800;
const SETTLED_TRACE_COLOR = "#e8c56a";
const GROWTH_COLOR = "#f0c96a";

export class NeuralGraphEnhancer {
  private readonly sessions = new Map<WorkspaceLeaf, NeuralGraphSession>();
  private opening: Promise<NeuralGraphOpenResult> | null = null;
  private destroyed = false;

  constructor(
    private readonly app: App,
    private readonly options: NeuralGraphEnhancerOptions
  ) {}

  async open(): Promise<NeuralGraphOpenResult> {
    if (this.destroyed) throw new Error("PARA Second Brain Viz enhancer has been unloaded.");
    this.prune();
    const existing = [...this.sessions.entries()][0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing[0]);
      return existing[1].summary();
    }

    if (this.opening) return this.opening;
    const opening = this.openNewSession();
    this.opening = opening;
    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = null;
    }
  }

  private async openNewSession(): Promise<NeuralGraphOpenResult> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "graph", active: true });
    await this.app.workspace.revealLeaf(leaf);
    const graphContent = (leaf.view as unknown as { contentEl?: HTMLElement }).contentEl;
    if (!graphContent) throw new Error("Core Graph content is unavailable.");
    const loading = createNeuralGraphLoadingOverlay(graphContent);
    loading.update(8, "Preparing Core Graph", "Waiting for Obsidian's native renderer");
    try {
      const bridgePromise = waitForCoreGraphBridge(leaf.view).then((result) => {
        loading.update(36, "Core Graph ready", "Native nodes, links, pan and zoom connected");
        return result;
      });
      const loadPromise = this.options.loadDataset().then((result) => {
        loading.update(58, "Vault evidence loaded", `${result.dataset.current.notes.length.toLocaleString()} notes · ${result.dataset.current.links.length.toLocaleString()} links`);
        return result;
      });
      const [bridgeResult, loadResult] = await Promise.all([bridgePromise, loadPromise]);
      if (!bridgeResult.ok) throw new Error(bridgeResult.reason);
      if (this.destroyed) {
        bridgeResult.bridge.destroy();
        throw new Error("PARA Second Brain Viz enhancer has been unloaded.");
      }
      loading.update(66, "Curating graph scope", "Applying vault exclusions and semantic rules");
      const session = new NeuralGraphSession(
        this.app,
        bridgeResult.bridge,
        loadResult.dataset,
        loadResult.settings,
        this.options.loadDataset
      );
      try {
        await session.attach((progress, label, detail) => loading.update(progress, label, detail));
      } catch (error) {
        session.destroy();
        throw error;
      }
      if (this.destroyed) {
        session.destroy();
        throw new Error("PARA Second Brain Viz enhancer has been unloaded.");
      }
      this.sessions.set(leaf, session);
      loading.update(100, "PARA Second Brain Viz ready", `${session.summary().matchedNodes.toLocaleString()} notes structured`);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      loading.destroy();
      return session.summary();
    } catch (error) {
      loading.fail(errorMessage(error));
      window.setTimeout(() => loading.destroy(), 2_200);
      throw error;
    }
  }

  prune(): void {
    const liveGraphLeaves = new Set(this.app.workspace.getLeavesOfType("graph"));
    for (const [leaf, session] of this.sessions) {
      if (!liveGraphLeaves.has(leaf) || !session.matchesView(leaf.view)) {
        session.destroy();
        this.sessions.delete(leaf);
      } else {
        session.syncVisibility();
      }
    }
  }

  async refresh(): Promise<void> {
    this.prune();
    await Promise.all([...this.sessions.values()].map((session) => session.refresh()));
  }

  hasSessions(): boolean {
    this.prune();
    return this.sessions.size > 0;
  }

  destroy(): void {
    this.destroyed = true;
    for (const session of this.sessions.values()) session.destroy();
    this.sessions.clear();
  }
}

class NeuralGraphSession {
  private settings: ObservatoryPluginSettings;
  private dataset: ObservatoryDataset;
  private model: StructuredGraphModel;
  private modelNodeByPath: Map<string, StructuredNode>;
  private activities: RegionActivity[] = [];
  private growth!: GrowthReplay;
  private tracks: ReplayTrack[] = [];
  private simulatedQueryTracks: ReplayTrack[] = [];
  private buildTracks: ReplayTrack[] = [];
  private simulatedBuildTracks: ReplayTrack[] = [];
  private periodTrack: ReplayTrack | null = null;
  private simulatedQueryPeriodTrack: ReplayTrack | null = null;
  private buildPeriodTrack: ReplayTrack | null = null;
  private simulatedBuildPeriodTrack: ReplayTrack | null = null;
  private construction!: ConstructionHealth;
  private audit!: KnowledgeAudit;
  private auditNodeByPath = new Map<string, KnowledgeAuditNode>();
  private period: PeriodPreset;
  private replayBatch: ReplayBatchPreset = "20";
  private viewMode: GraphViewMode = "activity";
  private activityFocus: ActivityFocus = "all";
  private constructionFocus: ConstructionFocus = "all";
  private auditFocus: KnowledgeAuditFocus = "cold";
  private selectedQueryTrackId = "period";
  private selectedBuildTrackId = "";
  private playbackSpeed = 1;
  private structured = true;
  private matchedNodes = 0;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private toolbar: HTMLElement | null = null;
  private readout: HTMLElement | null = null;
  private trackSelect: HTMLSelectElement | null = null;
  private trackRoot: HTMLElement | null = null;
  private focusSelect: HTMLSelectElement | null = null;
  private focusLabel: HTMLElement | null = null;
  private focusRoot: HTMLElement | null = null;
  private speedRoot: HTMLElement | null = null;
  private batchRoot: HTMLElement | null = null;
  private modeHint: HTMLElement | null = null;
  private queryInspector: HTMLElement | null = null;
  private playButton: HTMLButtonElement | null = null;
  private stepButton: HTMLButtonElement | null = null;
  private layoutButton: HTMLButtonElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private anchorSettleTimer: number | null = null;
  private reducedMotionMedia: MediaQueryList | null = null;
  private frame: number | null = null;
  private lastDrawAt = 0;
  private renderDirty = true;
  private lastVisualRevision = "";
  private running = false;
  private segmentIndex = 0;
  private segmentProgress = 0;
  private segmentStartedAt = 0;
  private periodProgress = 0;
  private periodStartedAt = 0;
  private periodCompletedCount = 0;
  private growthRevealedCount = 0;
  private inspectedQueryTrackId = "";
  private inspectedBuildTrackId = "";
  private replayCanvasCleared = false;
  private destroyed = false;
  private contentPosition = "";
  private readonly handleVisibilityChange = (): void => this.syncVisibility();
  private readonly handleReducedMotionChange = (): void => {
    if (this.isReducedMotion() && this.running) {
      const track = this.selectedTrack();
      this.running = false;
      if (this.isActivityGrowth()) {
        this.periodProgress = 1;
      } else if (this.isConcurrentPeriod()) {
        this.periodProgress = 1;
        this.periodCompletedCount = this.concurrentPeriodTracks().length;
      } else if (track && this.segmentIndex < track.segments.length) {
        this.segmentIndex = Math.min(track.segments.length, this.segmentIndex + 1);
        this.segmentProgress = 0;
      }
    }
    this.updatePlayButton();
    this.updateReadout();
    this.syncVisibility();
  };

  constructor(
    private readonly app: App,
    private readonly bridge: CoreGraphBridge,
    dataset: ObservatoryDataset,
    settings: ObservatoryPluginSettings,
    private readonly reloadDataset: () => Promise<ObservatoryLoadResult>
  ) {
    this.settings = settings;
    this.dataset = dataset;
    this.period = settings.defaultPeriod;
    this.model = buildStructuredGraph(dataset, settings);
    this.modelNodeByPath = new Map(this.model.nodes.map((node) => [node.path, node]));
    this.rebuildPeriodData();
  }

  matchesView(view: unknown): boolean {
    return !this.destroyed && view === this.bridge.view && this.bridge.view.getViewType() === "graph";
  }

  async attach(onProgress: (progress: number, label: string, detail?: string) => void = () => undefined): Promise<void> {
    this.canvas = this.bridge.createOverlayCanvas();
    this.context = this.canvas.getContext("2d");
    if (!this.context) throw new Error("PARA Second Brain Viz overlay requires a 2d canvas context.");
    const document = this.canvas.ownerDocument;
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.reducedMotionMedia = document.defaultView?.matchMedia("(prefers-reduced-motion: reduce)") ?? null;
    this.reducedMotionMedia?.addEventListener("change", this.handleReducedMotionChange);
    const exclusions = this.configuredExclusions();
    this.bridge.applyCuratedScope(exclusions);
    onProgress(72, "Curating graph scope", "Waiting for the filtered native graph to settle");
    const scope = await this.bridge.waitForCuratedScope(exclusions);
    if (!scope.ok) {
      const detail = scope.remainingExclusions.length > 0
        ? ` Excluded paths still visible: ${scope.remainingExclusions.join(", ")}.`
        : " Core Graph filtering did not settle before the safety timeout.";
      throw new Error(`PARA Second Brain Viz stopped before layout to preserve its curated scope.${detail}`);
    }
    if (this.destroyed) return;
    onProgress(84, "Building semantic layout", `${this.model.nodes.length.toLocaleString()} notes · PARA and first-folder territories`);
    this.matchedNodes = this.bridge.applyStructuredLayout(this.model);
    this.scheduleAnchorStabilization();
    onProgress(94, "Rendering PARA Second Brain Viz layers", `${this.matchedNodes.toLocaleString()}/${this.model.nodes.length.toLocaleString()} native nodes matched`);
    this.buildToolbar();
    this.buildQueryInspector();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.bridge.resizeOverlay();
        this.syncVisibility();
      });
      this.resizeObserver.observe(this.bridge.renderer.interactiveEl);
    }
    this.syncVisibility();
    onProgress(98, "Finalizing controls", "Activity, replay, audit and evidence inspector attached");
  }

  summary(): NeuralGraphOpenResult {
    return {
      matchedNodes: this.matchedNodes,
      totalNodes: this.model.nodes.length,
      queryTracks: this.tracks.length,
      constructionTracks: this.buildTracks.length
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopFrame();
    this.canvas?.ownerDocument.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.reducedMotionMedia?.removeEventListener("change", this.handleReducedMotionChange);
    this.reducedMotionMedia = null;
    if (this.anchorSettleTimer !== null) {
      this.canvas?.ownerDocument.defaultView?.clearTimeout(this.anchorSettleTimer);
      this.anchorSettleTimer = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.toolbar?.remove();
    this.toolbar = null;
    this.queryInspector?.remove();
    this.queryInspector = null;
    this.bridge.view.contentEl.style.position = this.contentPosition;
    this.bridge.destroy();
  }

  private buildToolbar(): void {
    const document = this.bridge.view.contentEl.ownerDocument;
    const content = this.bridge.view.contentEl;
    this.contentPosition = content.style.position;
    const computed = document.defaultView?.getComputedStyle(content);
    if (!computed || computed.position === "static") content.style.position = "relative";

    const toolbar = document.createElement("section");
    toolbar.className = "llmwo-graph-toolbar";
    toolbar.setAttribute("aria-label", "PARA Second Brain Viz controls");
    const brand = document.createElement("div");
    brand.className = "llmwo-graph-brand";
    brand.textContent = "PARA Second Brain Viz";

    const mode = selectControl(document, "View", [
      ["activity", "Activity map"],
      ["search", "Search replay"],
      ["ingest", "Ingest replay"],
      ["health", "Build health"],
      ["audit", "Knowledge audit"]
    ], this.viewMode);
    mode.root.classList.add("llmwo-graph-control--mode");
    mode.select.addEventListener("change", () => {
      this.viewMode = mode.select.value as GraphViewMode;
      this.replayCanvasCleared = false;
      this.resetPlayback();
      this.renderFocusOptions();
      this.renderTrackOptions();
      this.updateControlVisibility();
      this.updatePlayButton();
      this.updateReadout();
      this.renderQueryInspector();
    });

    const period = selectControl(document, "Period", [
      ["7d", "7 days"],
      ["30d", "30 days"],
      ["90d", "90 days"],
      ["all", "All"]
    ], this.period);
    period.select.addEventListener("change", () => {
      this.period = period.select.value as PeriodPreset;
      this.replayCanvasCleared = false;
      this.rebuildPeriodData();
      this.resetPlayback();
      this.renderTrackOptions();
      this.updateReadout();
      this.renderQueryInspector();
    });

    const batch = selectControl(document, "Replay set", [
      ["10", "Latest 10"],
      ["20", "Latest 20"],
      ["50", "Latest 50"],
      ["all", "All in period"]
    ], this.replayBatch);
    batch.root.classList.add("llmwo-graph-control--batch");
    this.batchRoot = batch.root;
    batch.select.addEventListener("change", () => {
      this.replayBatch = batch.select.value as ReplayBatchPreset;
      this.replayCanvasCleared = false;
      this.rebuildReplayAggregates();
      this.reconcileReplaySelection();
      this.resetPlayback();
      this.renderTrackOptions();
      this.updatePlayButton();
      this.updateReadout();
      this.renderQueryInspector();
    });

    const focus = selectControl(document, "Activity", [
      ["all", "All regions"],
      ["low", "Underactive"],
      ["high", "Highly active"],
      ["growth", "Growth replay"]
    ], this.activityFocus);
    this.focusSelect = focus.select;
    this.focusLabel = focus.label;
    this.focusRoot = focus.root;
    focus.select.addEventListener("change", () => {
      if (this.viewMode === "activity") {
        this.activityFocus = focus.select.value as ActivityFocus;
      } else if (this.viewMode === "health") {
        this.constructionFocus = focus.select.value as ConstructionFocus;
      } else if (this.viewMode === "audit") {
        this.auditFocus = focus.select.value as KnowledgeAuditFocus;
      }
      this.resetPlayback();
      this.updateControlVisibility();
      this.updatePlayButton();
      this.invalidate();
      this.updateReadout();
    });

    const track = selectControl(document, "Search run", [], this.selectedQueryTrackId);
    track.root.classList.add("llmwo-graph-control--replay");
    this.trackSelect = track.select;
    this.trackRoot = track.root;
    track.select.addEventListener("change", () => {
      if (this.viewMode === "search") {
        this.selectedQueryTrackId = track.select.value;
        this.inspectedQueryTrackId = ["period", "sim-query-period"].includes(track.select.value)
          ? ""
          : track.select.value;
      }
      if (this.viewMode === "ingest") {
        this.selectedBuildTrackId = track.select.value;
        this.inspectedBuildTrackId = ["build-period", "sim-build-period"].includes(track.select.value)
          ? ""
          : track.select.value;
      }
      this.replayCanvasCleared = false;
      this.resetPlayback();
      this.updatePlayButton();
      this.updateReadout();
      this.renderQueryInspector();
    });

    const speed = selectControl(document, "Speed", [
      ["0.5", "0.5×"],
      ["1", "1×"],
      ["2", "2×"],
      ["4", "4×"]
    ], String(this.playbackSpeed));
    this.speedRoot = speed.root;
    speed.select.addEventListener("change", () => {
      this.playbackSpeed = Number(speed.select.value) || 1;
      const selected = this.selectedTrack();
      if (this.running && (this.isConcurrentPeriod() || this.isActivityGrowth())) {
        this.periodStartedAt = performance.now() - this.periodProgress * this.periodWaveDuration();
      } else if (this.running && selected) {
        this.segmentStartedAt = performance.now() - this.segmentProgress * this.currentSegmentDuration(selected);
      }
      this.invalidate();
      this.updateReadout();
    });

    const play = button(document, "Play", () => this.togglePlayback());
    play.title = "Replay notes created during the selected period in chronological order";
    const step = button(document, "Next edge", () => this.stepPlayback());
    const layout = button(document, "Free layout", () => this.toggleLayout());
    const refresh = button(document, "Refresh", () => void this.refresh());
    this.playButton = play;
    this.stepButton = step;
    this.layoutButton = layout;

    const hint = document.createElement("div");
    hint.className = "llmwo-graph-hint";
    this.modeHint = hint;

    const readout = document.createElement("div");
    readout.className = "llmwo-graph-readout";
    readout.setAttribute("aria-live", "polite");
    this.readout = readout;

    const status = document.createElement("div");
    status.className = "llmwo-graph-status";
    status.append(hint, readout);

    toolbar.append(brand, mode.root, period.root, batch.root, focus.root, track.root, speed.root, play, step, layout, refresh, status);
    content.appendChild(toolbar);
    this.toolbar = toolbar;
    this.renderFocusOptions();
    this.renderTrackOptions();
    this.updateControlVisibility();
    this.updatePlayButton();
    this.updateReadout();
  }

  private buildQueryInspector(): void {
    const document = this.bridge.view.contentEl.ownerDocument;
    const inspector = document.createElement("aside");
    inspector.className = "llmwo-query-inspector";
    inspector.setAttribute("aria-label", "Search and construction evidence inspector");
    this.bridge.view.contentEl.appendChild(inspector);
    this.queryInspector = inspector;
    this.renderQueryInspector();
  }

  private renderQueryInspector(): void {
    const inspector = this.queryInspector;
    if (!inspector) return;
    const searchMode = this.viewMode === "search";
    const ingestMode = this.viewMode === "ingest";
    inspector.hidden = !searchMode && !ingestMode;
    if (inspector.hidden) return;
    const document = inspector.ownerDocument;
    const loggedQuerySamples = this.periodSampleTracks();
    const simulatedQuerySamples = this.simulatedQueryBatchTracks();
    const loggedBuildSamples = this.periodBuildTracks();
    const simulatedSamples = this.simulatedBatchTracks();
    const sampleTracks = searchMode
      ? [...loggedQuerySamples].reverse().concat(simulatedQuerySamples)
      : [...loggedBuildSamples].reverse().concat(simulatedSamples);
    const inspectedId = searchMode ? this.inspectedQueryTrackId : this.inspectedBuildTrackId;
    const inspected = sampleTracks.find((track) => track.id === inspectedId) ?? null;
    inspector.replaceChildren();

    const header = document.createElement("header");
    const eyebrow = document.createElement("span");
    eyebrow.className = "llmwo-query-inspector-eyebrow";
    eyebrow.textContent = searchMode ? "SEARCH REPLAY" : "INGEST REPLAY";
    const title = document.createElement("strong");
    title.textContent = `${sampleTracks.length} runs in range`;
    const note = document.createElement("small");
    note.textContent = searchMode
      ? "QuerySummary/Complete telemetry · whole-turn Stop time excluded · timing normalized per query."
      : "BuildSummary/Complete telemetry · reference, output, link and route fields.";
    header.append(eyebrow, title, note);
    inspector.appendChild(header);

    if (sampleTracks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "llmwo-query-inspector-empty";
      empty.textContent = searchMode ? "No query telemetry in this period." : "No construction evidence or scenarios available.";
      inspector.appendChild(empty);
      return;
    }

    const statsTracks = inspected
      ? [inspected]
      : searchMode
        ? this.selectedQueryTrackId === "sim-query-period"
          ? simulatedQuerySamples
          : loggedQuerySamples
        : this.selectedBuildTrackId === "sim-build-period"
          ? simulatedSamples
          : loggedBuildSamples;
    const selectionStats = this.buildReplaySelectionStats(document, statsTracks, searchMode);
    inspector.appendChild(selectionStats);

    const list = document.createElement("div");
    list.className = "llmwo-query-sample-list";
    list.setAttribute("role", "list");
    const selectAggregate = (trackId: string): void => {
      if (searchMode) {
        this.selectedQueryTrackId = trackId;
        this.inspectedQueryTrackId = "";
      } else {
        this.selectedBuildTrackId = trackId;
        this.inspectedBuildTrackId = "";
      }
      if (this.trackSelect) this.trackSelect.value = trackId;
      this.replayCanvasCleared = false;
      this.resetPlayback();
      this.updatePlayButton();
      this.updateReadout();
      this.renderQueryInspector();
    };
    const appendAggregate = (label: string, meta: string, trackId: string, active: boolean): void => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "llmwo-query-sample is-all";
      item.classList.toggle("is-selected", active);
      item.setAttribute("aria-pressed", String(active));
      const itemLabel = document.createElement("strong");
      itemLabel.textContent = label;
      const itemMeta = document.createElement("span");
      itemMeta.textContent = meta;
      item.append(itemLabel, itemMeta);
      item.addEventListener("click", () => selectAggregate(trackId));
      list.appendChild(item);
    };
    let previousProvenance: ReplayTrack["provenance"] | null = null;
    for (const track of sampleTracks) {
      if (track.provenance !== previousProvenance) {
        const groupLabel = document.createElement("span");
        groupLabel.className = "llmwo-query-sample-group";
        groupLabel.textContent = searchMode
          ? track.provenance === "logged" ? "RECORDED QUERIES" : "QUERY REPLAY SET"
          : track.provenance === "logged" ? "RECORDED BUILDS" : "PLACEMENT REPLAY SET";
        list.appendChild(groupLabel);
        const aggregate = searchMode
          ? track.provenance === "logged" ? this.periodTrack : this.simulatedQueryPeriodTrack
          : track.provenance === "logged" ? this.buildPeriodTrack : this.simulatedBuildPeriodTrack;
        const count = searchMode
          ? track.provenance === "logged" ? loggedQuerySamples.length : simulatedQuerySamples.length
          : track.provenance === "logged" ? loggedBuildSamples.length : simulatedSamples.length;
        if (aggregate) {
          appendAggregate(
            searchMode
              ? track.provenance === "logged" ? "ALL RECORDED QUERIES" : "ALL REPLAY QUERIES"
              : track.provenance === "logged" ? "ALL RECORDED BUILDS" : "ALL REPLAY PLACEMENTS",
            `${count} ${searchMode ? "queries" : "operations"} · aggregate paths visible`,
            aggregate.id,
            inspected === null && (searchMode
              ? this.selectedQueryTrackId === aggregate.id
              : this.selectedBuildTrackId === aggregate.id)
          );
        }
        previousProvenance = track.provenance;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "llmwo-query-sample";
      item.dataset.provenance = track.provenance;
      item.classList.toggle("is-selected", track.id === inspected?.id);
      item.setAttribute("aria-pressed", String(track.id === inspected?.id));
      const when = document.createElement("strong");
      when.textContent = searchMode
        ? track.provenance === "logged"
          ? formatQueryTimestamp(track.startedAt)
          : track.label.replace(/^SIM · /, "")
        : track.label.replace(/^SIM · /, "");
      const meta = document.createElement("span");
      meta.textContent = searchMode
        ? `${this.trackTimingLabel(track)} · ${track.uniquePaths} docs · ${track.paraSpan} PARA`
        : `${this.trackTimingLabel(track)} · ${track.outputCount} outputs · ${track.referenceCount} refs`;
      item.append(when, meta);
      item.addEventListener("click", () => {
        const clear = track.id === inspected?.id;
        if (searchMode) {
          this.inspectedQueryTrackId = clear ? "" : track.id;
          this.selectedQueryTrackId = clear
            ? track.provenance === "logged"
              ? this.periodTrack?.id ?? ""
              : this.simulatedQueryPeriodTrack?.id ?? ""
            : track.id;
        } else {
          this.inspectedBuildTrackId = clear ? "" : track.id;
          this.selectedBuildTrackId = clear
            ? track.provenance === "logged"
              ? this.buildPeriodTrack?.id ?? ""
              : this.simulatedBuildPeriodTrack?.id ?? ""
            : track.id;
        }
        if (this.trackSelect) {
          this.trackSelect.value = searchMode ? this.selectedQueryTrackId : this.selectedBuildTrackId;
        }
        this.replayCanvasCleared = false;
        this.resetPlayback();
        this.updatePlayButton();
        this.updateReadout();
        this.renderQueryInspector();
      });
      list.appendChild(item);
    }
    inspector.appendChild(list);
    if (!inspected) {
      const overview = document.createElement("section");
      overview.className = "llmwo-query-detail is-all";
      const overviewTitle = document.createElement("strong");
      overviewTitle.textContent = this.replayCanvasCleared
        ? "Replay canvas cleared"
        : searchMode
          ? this.selectedQueryTrackId === "sim-query-period"
            ? "All replay query traces visible"
            : "All recorded query traces visible"
        : this.selectedBuildTrackId === "sim-build-period"
          ? "All replay placement traces visible"
          : "All recorded build traces visible";
      const overviewNote = document.createElement("p");
      overviewNote.textContent = this.replayCanvasCleared
        ? "Refresh removed every replay trace. Press Play, choose an aggregate, or click a sample to draw evidence again."
        : "The aggregate snapshot is visible now. Play rebuilds it by timing; click one sample to isolate its path, then click again to restore all.";
      overview.append(overviewTitle, overviewNote);
      inspector.appendChild(overview);
      return;
    }

    const detail = document.createElement("section");
    detail.className = "llmwo-query-detail";
    const detailHead = document.createElement("div");
    detailHead.className = "llmwo-query-detail-head";
    const detailTitle = document.createElement("strong");
    detailTitle.textContent = searchMode ? "Selected query" : "Selected operation";
    const replay = document.createElement("button");
    replay.type = "button";
    replay.textContent = searchMode ? "Replay this query" : "Replay this operation";
    replay.addEventListener("click", () => {
      if (searchMode) this.selectedQueryTrackId = inspected.id;
      else this.selectedBuildTrackId = inspected.id;
      if (this.trackSelect) this.trackSelect.value = inspected.id;
      this.replayCanvasCleared = false;
      this.resetPlayback();
      this.updatePlayButton();
      this.updateReadout();
      this.renderQueryInspector();
    });
    detailHead.append(detailTitle, replay);
    const queryId = document.createElement("code");
    queryId.textContent = inspected.id;
    const stats = document.createElement("div");
    stats.className = "llmwo-query-detail-stats";
    const detailStats: Array<[string, string]> = searchMode
      ? [
          ["Query time", this.trackTimingLabel(inspected)],
          ["Documents", String(inspected.uniquePaths)],
          ["Max hops", inspected.maxGraphHops === null ? "n/a" : String(inspected.maxGraphHops)],
          ["Tokens", this.trackTokenLabel(inspected)]
        ]
      : [
          ["Build time", this.trackTimingLabel(inspected)],
          ["Outputs", String(inspected.outputCount)],
          ["References", String(inspected.referenceCount)],
          [inspected.provenance === "simulated" ? "Proposed links" : "Links added", inspected.linksAdded === null ? "n/a" : String(inspected.linksAdded)],
          ["Tokens", this.trackTokenLabel(inspected)]
        ];
    for (const [label, value] of detailStats) {
      const cell = document.createElement("span");
      const key = document.createElement("small");
      key.textContent = label;
      const valueElement = document.createElement("strong");
      valueElement.textContent = value;
      cell.append(key, valueElement);
      stats.appendChild(cell);
    }
    const paths = [...new Set(inspected.segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]))];
    const pathList = document.createElement("div");
    pathList.className = "llmwo-query-path-list";
    const pathLabel = document.createElement("small");
    pathLabel.textContent = `${searchMode ? "Retrieved" : "Evidence"} paths · ${paths.length}`;
    pathList.appendChild(pathLabel);
    for (const path of paths) {
      if (path === INBOX_ORIGIN_PATH) {
        const origin = document.createElement("span");
        origin.className = "llmwo-query-path-synthetic";
        origin.textContent = inspected.provenance === "logged" ? "Inbox/ (recorded origin folder)" : "Inbox/ (replay origin)";
        pathList.appendChild(origin);
        continue;
      }
      const pathButton = document.createElement("button");
      pathButton.type = "button";
      pathButton.textContent = path;
      pathButton.title = `Open ${path}`;
      pathButton.addEventListener("click", () => void this.app.workspace.openLinkText(path, "", false));
      pathList.appendChild(pathButton);
    }
    detail.append(detailHead, queryId, stats, pathList);
    inspector.appendChild(detail);
  }

  private buildReplaySelectionStats(
    document: Document,
    tracks: readonly ReplayTrack[],
    searchMode: boolean
  ): HTMLElement {
    const panel = document.createElement("section");
    panel.className = "llmwo-query-stats";
    panel.setAttribute("aria-label", "Selected replay statistics");
    const head = document.createElement("header");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = "SELECTION STATISTICS";
    const scope = document.createElement("strong");
    scope.textContent = tracks.length === 1 ? "1 selected run" : `${tracks.length} selected runs`;
    head.append(eyebrow, scope);

    const durations = tracks.flatMap((track) => track.totalDurationMs === null ? [] : [track.totalDurationMs]);
    const tokens = tracks.flatMap((track) => track.totalTokens === null ? [] : [track.totalTokens]);
    const finalized = tracks.filter((track) => this.trackFinalized(track)).length;
    const averageDuration = mean(durations);
    const averageTokens = mean(tokens);
    const uniquePaths = new Set(tracks.flatMap((track) => track.segments.flatMap((segment) => [segment.sourcePath, segment.targetPath]))).size;
    const simulated = tracks.length > 0 && tracks.every((track) => track.provenance === "simulated");
    const values: Array<[string, string]> = searchMode
      ? [
          ["Runs", String(tracks.length)],
          [simulated ? "Timed" : "Finalized", simulated ? `${durations.length}/${tracks.length}` : `${finalized}/${tracks.length}`],
          ["Avg query", averageDuration === null ? "not captured" : formatDuration(averageDuration)],
          ["Avg docs", formatAverage(tracks.map((track) => track.uniquePaths))],
          ["Avg tokens", averageTokens === null ? "not captured" : formatTokens(averageTokens)],
          ["Avg PARA", formatAverage(tracks.map((track) => track.paraSpan))],
          ["Unique docs", String(uniquePaths)],
          ["Max hops", String(Math.max(0, ...tracks.map((track) => track.maxGraphHops ?? 0)))]
        ]
      : [
          ["Operations", String(tracks.length)],
          [simulated ? "Timed" : "Finalized", simulated ? `${durations.length}/${tracks.length}` : `${finalized}/${tracks.length}`],
          ["Avg build", averageDuration === null ? "not captured" : formatDuration(averageDuration)],
          ["Avg refs", formatAverage(tracks.map((track) => track.referenceCount))],
          ["Avg tokens", averageTokens === null ? "not captured" : formatTokens(averageTokens)],
          ["Outputs", String(tracks.reduce((sum, track) => sum + track.outputCount, 0))],
          [simulated ? "Proposed links" : "Links added", formatOptionalSum(tracks.map((track) => track.linksAdded))],
          ["Inbox origins", String(tracks.filter((track) => track.segments.some((segment) => segment.sourcePath === INBOX_ORIGIN_PATH)).length)]
        ];
    const grid = document.createElement("div");
    for (const [label, value] of values) {
      const cell = document.createElement("span");
      const key = document.createElement("small");
      key.textContent = label;
      const metric = document.createElement("strong");
      metric.textContent = value;
      cell.append(key, metric);
      grid.appendChild(cell);
    }
    const coverage = document.createElement("small");
    coverage.className = "llmwo-query-stats-coverage";
    coverage.textContent = simulated
      ? "Replay-set metrics · paths · timing · tokens"
      : `Available log fields only · timed ${durations.length}/${tracks.length} · tokenized ${tokens.length}/${tracks.length}`;
    panel.append(head, grid, coverage);
    return panel;
  }

  async refresh(): Promise<void> {
    this.running = false;
    this.updatePlayButton();
    const next = await this.reloadDataset();
    this.settings = next.settings;
    const exclusions = this.configuredExclusions();
    this.bridge.applyCuratedScope(exclusions);
    const scope = await this.bridge.waitForCuratedScope(exclusions);
    if (!scope.ok) {
      const detail = scope.remainingExclusions.length > 0
        ? ` Excluded paths still visible: ${scope.remainingExclusions.join(", ")}.`
        : " Core Graph filtering did not settle before the safety timeout.";
      throw new Error(`PARA Second Brain Viz refresh stopped before layout.${detail}`);
    }
    this.dataset = next.dataset;
    this.model = buildStructuredGraph(next.dataset, this.settings);
    this.modelNodeByPath = new Map(this.model.nodes.map((node) => [node.path, node]));
    this.rebuildPeriodData();
    this.inspectedQueryTrackId = "";
    this.inspectedBuildTrackId = "";
    this.replayCanvasCleared = true;
    this.resetPlayback();
    if (this.structured) {
      this.matchedNodes = this.bridge.applyStructuredLayout(this.model);
      this.scheduleAnchorStabilization();
    }
    this.renderTrackOptions();
    this.updateControlVisibility();
    this.updateReadout();
    this.renderQueryInspector();
  }

  private configuredExclusions(): string[] {
    const configDir = this.app.vault.configDir?.trim() || ".obsidian";
    return this.settings.exclusions.map((path) => resolveVaultPath(path, configDir));
  }

  private toggleLayout(): void {
    this.structured = !this.structured;
    if (this.structured) {
      this.matchedNodes = this.bridge.applyStructuredLayout(this.model);
      this.scheduleAnchorStabilization();
    } else {
      if (this.anchorSettleTimer !== null) {
        this.canvas?.ownerDocument.defaultView?.clearTimeout(this.anchorSettleTimer);
        this.anchorSettleTimer = null;
      }
      this.bridge.releaseStructuredLayout();
    }
    if (this.layoutButton) this.layoutButton.textContent = this.structured ? "Free layout" : "Structure layout";
    this.invalidate();
  }

  private scheduleAnchorStabilization(): void {
    const window = this.canvas?.ownerDocument.defaultView;
    if (!window) return;
    if (this.anchorSettleTimer !== null) window.clearTimeout(this.anchorSettleTimer);
    this.anchorSettleTimer = window.setTimeout(() => {
      this.anchorSettleTimer = null;
      if (this.destroyed || !this.structured) return;
      this.bridge.stabilizeStructuredAnchors(this.model);
      this.invalidate();
      this.ensureFrame();
    }, 900);
  }

  private rebuildPeriodData(): void {
    const range = periodRange(this.period);
    this.activities = buildRegionActivity(this.dataset, range.from, range.to);
    this.growth = buildGrowthReplay(this.dataset, range.from, range.to);
    this.construction = buildConstructionHealth(this.dataset, this.settings, range.from, range.to);
    this.audit = buildKnowledgeAudit(this.dataset, range.from, range.to);
    this.auditNodeByPath = new Map(this.audit.nodes.map((note) => [note.path, note]));
    this.tracks = buildQueryReplayTracks(this.dataset, range.from, range.to);
    this.simulatedQueryTracks = buildSimulatedQueryTracks(this.dataset, this.settings, 20);
    this.buildTracks = buildConstructionReplayTracks(this.dataset, range.from, range.to, this.settings);
    this.simulatedBuildTracks = buildSimulatedPlacementTracks(this.dataset, this.settings, 20);
    this.rebuildReplayAggregates();
    this.reconcileReplaySelection();
  }

  private rebuildReplayAggregates(): void {
    this.periodTrack = aggregateReplayTrack(this.periodSampleTracks());
    this.simulatedQueryPeriodTrack = aggregateSimulatedQueryTrack(this.simulatedQueryBatchTracks());
    this.buildPeriodTrack = aggregateConstructionReplayTrack(this.periodBuildTracks());
    this.simulatedBuildPeriodTrack = aggregateSimulatedPlacementTrack(this.simulatedBatchTracks());
  }

  private reconcileReplaySelection(): void {
    const querySamples = this.periodSampleTracks();
    const simulatedQuerySamples = this.simulatedQueryBatchTracks();
    const buildSamples = this.periodBuildTracks();
    const simulatedSamples = this.simulatedBatchTracks();
    const queryIds = new Set([
      ...(this.periodTrack ? [this.periodTrack.id] : []),
      ...querySamples.map((track) => track.id),
      ...(this.simulatedQueryPeriodTrack ? [this.simulatedQueryPeriodTrack.id] : []),
      ...simulatedQuerySamples.map((track) => track.id)
    ]);
    if (!queryIds.has(this.selectedQueryTrackId)) {
      this.selectedQueryTrackId = this.periodTrack?.id
        ?? this.simulatedQueryPeriodTrack?.id
        ?? querySamples.at(-1)?.id
        ?? simulatedQuerySamples.at(-1)?.id
        ?? "";
    }
    const inspectedIds = new Set([...querySamples, ...simulatedQuerySamples].map((track) => track.id));
    if (!inspectedIds.has(this.inspectedQueryTrackId)) this.inspectedQueryTrackId = "";
    const buildIds = new Set([
      ...(this.buildPeriodTrack ? [this.buildPeriodTrack.id] : []),
      ...buildSamples.map((track) => track.id),
      ...(this.simulatedBuildPeriodTrack ? [this.simulatedBuildPeriodTrack.id] : []),
      ...simulatedSamples.map((track) => track.id)
    ]);
    if (!buildIds.has(this.selectedBuildTrackId)) {
      this.selectedBuildTrackId = this.buildPeriodTrack?.id
        ?? this.simulatedBuildPeriodTrack?.id
        ?? buildSamples.at(-1)?.id
        ?? simulatedSamples.at(-1)?.id
        ?? "";
    }
    const inspectedBuildIds = new Set([...buildSamples, ...simulatedSamples].map((track) => track.id));
    if (!inspectedBuildIds.has(this.inspectedBuildTrackId)) {
      this.inspectedBuildTrackId = "";
    }
  }

  private renderFocusOptions(): void {
    const select = this.focusSelect;
    if (!select) return;
    select.replaceChildren();
    const options: Array<[string, string]> = this.viewMode === "activity"
      ? [["all", "All regions"], ["low", "Underactive"], ["high", "Highly active"], ["growth", "Growth replay"]]
      : this.viewMode === "health"
        ? [["all", "All new notes"], ["attention", "Needs integration"], ["unintegrated", "Unintegrated"]]
        : [
            ["orphan", "Orphans"],
            ["unlinked", "Unlinked"],
            ["search-dormant", "Search dormant"],
            ["ingest-dormant", "Ingest dormant"],
            ["inactive", "Operationally inactive"],
            ["cold", "Cold isolated"]
          ];
    for (const [value, label] of options) select.appendChild(option(select.ownerDocument, value, label));
    select.value = this.viewMode === "activity"
      ? this.activityFocus
      : this.viewMode === "health"
        ? this.constructionFocus
        : this.auditFocus;
    if (this.focusLabel) {
      this.focusLabel.textContent = this.viewMode === "activity"
        ? "Activity"
        : this.viewMode === "health"
          ? "Build health"
          : "Audit";
    }
  }

  private renderTrackOptions(): void {
    const select = this.trackSelect;
    if (!select) return;
    select.replaceChildren();
    if (this.viewMode === "search") {
      appendTrackGroup(select, "Logged kb-query retrieval", this.periodTrack, this.periodSampleTracks());
      appendTrackGroup(select, "Query replay set", this.simulatedQueryPeriodTrack, this.simulatedQueryBatchTracks());
      select.value = this.selectedQueryTrackId;
    } else if (this.viewMode === "ingest") {
      appendTrackGroup(select, "Logged knowledge construction", this.buildPeriodTrack, this.periodBuildTracks());
      appendTrackGroup(select, "Placement replay set", this.simulatedBuildPeriodTrack, this.simulatedBatchTracks());
      select.value = this.selectedBuildTrackId;
    }
    select.disabled = select.options.length === 0;
  }

  private selectedTrack(): ReplayTrack | null {
    if (this.viewMode === "search") {
      if (this.selectedQueryTrackId === "period") return this.periodTrack;
      if (this.selectedQueryTrackId === "sim-query-period") return this.simulatedQueryPeriodTrack;
      return [...this.tracks, ...this.simulatedQueryTracks]
        .find((track) => track.id === this.selectedQueryTrackId) ?? null;
    }
    if (this.viewMode === "ingest") {
      if (this.selectedBuildTrackId === "build-period") return this.buildPeriodTrack;
      if (this.selectedBuildTrackId === "sim-build-period") return this.simulatedBuildPeriodTrack;
      return [...this.buildTracks, ...this.simulatedBuildTracks]
        .find((track) => track.id === this.selectedBuildTrackId) ?? null;
    }
    return null;
  }

  private periodSampleTracks(): ReplayTrack[] {
    return this.recentBatch(this.tracks);
  }

  private periodBuildTracks(): ReplayTrack[] {
    return this.recentBatch(this.buildTracks);
  }

  private simulatedBatchTracks(): ReplayTrack[] {
    const limit = this.replayBatchLimit();
    if (limit === null || limit >= this.simulatedBuildTracks.length) return [...this.simulatedBuildTracks];
    if (limit <= 1) return this.simulatedBuildTracks.slice(-limit);
    const selected: ReplayTrack[] = [];
    const lastIndex = this.simulatedBuildTracks.length - 1;
    for (let index = 0; index < limit; index += 1) {
      const sampleIndex = Math.round((index * lastIndex) / (limit - 1));
      const track = this.simulatedBuildTracks[sampleIndex];
      if (track && !selected.includes(track)) selected.push(track);
    }
    return selected;
  }

  private simulatedQueryBatchTracks(): ReplayTrack[] {
    return this.diverseBatch(this.simulatedQueryTracks);
  }

  private diverseBatch(tracks: readonly ReplayTrack[]): ReplayTrack[] {
    const limit = this.replayBatchLimit();
    if (limit === null || limit >= tracks.length) return [...tracks];
    if (limit <= 1) return tracks.slice(-limit);
    const selected: ReplayTrack[] = [];
    const lastIndex = tracks.length - 1;
    for (let index = 0; index < limit; index += 1) {
      const sampleIndex = Math.round((index * lastIndex) / (limit - 1));
      const track = tracks[sampleIndex];
      if (track && !selected.includes(track)) selected.push(track);
    }
    return selected;
  }

  private recentBatch(tracks: readonly ReplayTrack[]): ReplayTrack[] {
    const limit = this.replayBatchLimit();
    return limit === null ? [...tracks] : tracks.slice(-limit);
  }

  private replayBatchLimit(): number | null {
    return this.replayBatch === "all" ? null : Number(this.replayBatch);
  }

  private isConcurrentSearchPeriod(): boolean {
    return this.viewMode === "search"
      && ((this.selectedQueryTrackId === "period" && this.periodTrack !== null)
        || (this.selectedQueryTrackId === "sim-query-period" && this.simulatedQueryPeriodTrack !== null));
  }

  private isConcurrentBuildPeriod(): boolean {
    return this.viewMode === "ingest"
      && ((this.selectedBuildTrackId === "build-period" && this.buildPeriodTrack !== null)
        || (this.selectedBuildTrackId === "sim-build-period" && this.simulatedBuildPeriodTrack !== null));
  }

  private isConcurrentPeriod(): boolean {
    return this.isConcurrentSearchPeriod() || this.isConcurrentBuildPeriod();
  }

  private concurrentPeriodTracks(): ReplayTrack[] {
    if (this.viewMode === "search" && this.selectedQueryTrackId === "period") return this.periodSampleTracks();
    if (this.viewMode === "search" && this.selectedQueryTrackId === "sim-query-period") return this.simulatedQueryBatchTracks();
    if (this.viewMode === "ingest" && this.selectedBuildTrackId === "build-period") return this.periodBuildTracks();
    if (this.viewMode === "ingest" && this.selectedBuildTrackId === "sim-build-period") return this.simulatedBatchTracks();
    return [];
  }

  private concurrentPeriodStates(): ConcurrentReplayTrackState[] {
    return buildConcurrentReplayStates(this.concurrentPeriodTracks(), this.periodProgress);
  }

  private periodWaveDuration(): number {
    return PERIOD_WAVE_DURATION_MS / this.playbackSpeed;
  }

  private isActivityGrowth(): boolean {
    return this.viewMode === "activity" && this.activityFocus === "growth";
  }

  private updateControlVisibility(): void {
    const replayMode = this.viewMode === "search" || this.viewMode === "ingest";
    const activityMode = this.viewMode === "activity";
    const growthMode = this.isActivityGrowth();
    if (this.focusRoot) this.focusRoot.hidden = !["activity", "health", "audit"].includes(this.viewMode);
    if (this.batchRoot) this.batchRoot.hidden = !replayMode;
    if (this.trackRoot) this.trackRoot.hidden = !replayMode;
    if (this.speedRoot) this.speedRoot.hidden = !replayMode && !growthMode;
    if (this.playButton) {
      this.playButton.hidden = !replayMode && !activityMode;
      this.playButton.classList.toggle("llmwo-graph-button--growth", activityMode);
    }
    if (this.stepButton) this.stepButton.hidden = !replayMode && !growthMode;
    this.bridge.setNativeGraphDimmed(growthMode);
    const trackLabel = this.trackRoot?.querySelector("span");
    if (trackLabel) trackLabel.textContent = this.viewMode === "ingest" ? "Ingest run" : "Search run";
    if (this.modeHint) this.modeHint.textContent = growthMode
      ? "Creation-time replay · the native graph becomes context, then notes bloom in chronological order; added edges require stored snapshot diffs."
      : modeHint(this.viewMode);
    if (this.queryInspector) this.queryInspector.hidden = !["search", "ingest"].includes(this.viewMode);
    this.invalidate();
  }

  private togglePlayback(): void {
    if (this.viewMode === "activity" && !this.isActivityGrowth()) {
      this.activityFocus = "growth";
      if (this.focusSelect) this.focusSelect.value = "growth";
      this.resetPlayback();
      this.updateControlVisibility();
    }
    if (this.isActivityGrowth()) {
      if (this.growth.events.length === 0) return;
      if (this.isReducedMotion()) {
        this.running = false;
        this.periodProgress = this.periodProgress < 1 ? 1 : 0;
      } else if (this.running) {
        this.running = false;
      } else {
        if (this.periodProgress >= 1) this.resetPlayback();
        this.running = true;
        this.periodStartedAt = performance.now() - this.periodProgress * this.periodWaveDuration();
      }
      this.updatePlayButton();
      this.invalidate();
      this.updateReadout();
      return;
    }
    const track = this.selectedTrack();
    if (!track || track.segments.length === 0) return;
    this.replayCanvasCleared = false;
    this.renderQueryInspector();
    if (this.isReducedMotion()) {
      this.running = false;
      if (this.isConcurrentPeriod() && this.periodProgress < 1) {
        this.periodProgress = 1;
      } else if (this.isConcurrentPeriod()) {
        this.resetPlayback();
      } else if (this.segmentIndex >= track.segments.length) {
        this.resetPlayback();
      } else {
        this.segmentIndex = track.segments.length;
        this.segmentProgress = 1;
        this.segmentStartedAt = 0;
      }
      this.updatePlayButton();
      this.invalidate();
      this.updateReadout();
      return;
    }
    if (this.running) {
      this.running = false;
    } else {
      if (this.isConcurrentPeriod()) {
        if (this.periodProgress >= 1) this.resetPlayback();
        this.running = true;
        this.periodStartedAt = performance.now() - this.periodProgress * this.periodWaveDuration();
      } else {
        if (this.segmentIndex >= track.segments.length) this.resetPlayback();
        this.running = true;
        this.segmentStartedAt = performance.now() - this.segmentProgress * this.currentSegmentDuration(track);
      }
    }
    this.updatePlayButton();
    this.invalidate();
    this.updateReadout();
  }

  private stepPlayback(): void {
    if (this.isActivityGrowth()) {
      if (this.growth.events.length === 0) return;
      this.running = false;
      const nextProgress = this.periodProgress + 0.1;
      this.periodProgress = this.periodProgress >= 1 ? 0 : nextProgress >= 0.999 ? 1 : clamp(nextProgress, 0, 1);
      this.updatePlayButton();
      this.invalidate();
      this.updateReadout();
      return;
    }
    const track = this.selectedTrack();
    if (!track || track.segments.length === 0) return;
    this.replayCanvasCleared = false;
    this.renderQueryInspector();
    this.running = false;
    if (this.isConcurrentPeriod()) {
      const nextProgress = this.periodProgress + 0.1;
      this.periodProgress = this.periodProgress >= 1 ? 0 : nextProgress >= 0.999 ? 1 : clamp(nextProgress, 0, 1);
      this.periodCompletedCount = this.concurrentPeriodStates().filter((state) => state.completed).length;
    } else if (this.segmentIndex >= track.segments.length) {
      this.segmentIndex = 0;
    } else {
      this.segmentIndex += 1;
    }
    this.segmentProgress = 0;
    this.updatePlayButton();
    this.invalidate();
    this.updateReadout();
  }

  private resetPlayback(): void {
    this.running = false;
    this.segmentIndex = 0;
    this.segmentProgress = 0;
    this.segmentStartedAt = 0;
    this.periodProgress = 0;
    this.periodStartedAt = 0;
    this.periodCompletedCount = 0;
    this.growthRevealedCount = 0;
    this.updatePlayButton();
    this.invalidate();
  }

  private currentSegmentDuration(track: ReplayTrack): number {
    return (track.segments[this.segmentIndex]?.visualDurationMs ?? 420) / this.playbackSpeed;
  }

  private updatePlayButton(): void {
    if (!this.playButton) return;
    if (this.viewMode === "activity" && !this.isActivityGrowth()) {
      const available = this.growth.events.length > 0;
      this.playButton.disabled = !available;
      this.playButton.textContent = "▶ Growth replay";
      if (this.stepButton) this.stepButton.disabled = !available;
      return;
    }
    if (this.isActivityGrowth()) {
      const available = this.growth.events.length > 0;
      this.playButton.disabled = !available;
      if (this.stepButton) {
        this.stepButton.disabled = !available;
        this.stepButton.textContent = "Advance time";
      }
      if (this.isReducedMotion()) {
        this.playButton.textContent = this.periodProgress >= 1 ? "Reset growth" : "Show growth";
      } else {
        this.playButton.textContent = this.running
          ? "Pause growth"
          : this.periodProgress >= 1 ? "Replay growth" : this.periodProgress > 0 ? "Resume growth" : "▶ Growth replay";
      }
      return;
    }
    const track = this.selectedTrack();
    const replayLabel = this.viewMode === "ingest" ? "ingest" : "search";
    this.playButton.disabled = !track || track.segments.length === 0;
    if (this.stepButton) this.stepButton.disabled = !track || track.segments.length === 0;
    if (this.stepButton) this.stepButton.textContent = this.isConcurrentPeriod() ? "Advance wave" : "Next edge";
    if (this.isReducedMotion()) {
      const complete = this.isConcurrentPeriod()
        ? this.periodProgress >= 1
        : Boolean(track && this.segmentIndex >= track.segments.length);
      this.playButton.textContent = complete
        ? "Reset path"
        : this.isConcurrentPeriod() ? `Show ${replayLabel} wave` : `Show ${replayLabel} path`;
      return;
    }
    this.playButton.textContent = this.running
      ? "Pause"
      : this.isConcurrentPeriod() ? `Play ${replayLabel} wave` : `Play ${replayLabel}`;
  }

  private tick(time: number): void {
    this.frame = null;
    if (this.destroyed) return;
    if (!this.bridge.view.contentEl.isConnected) {
      this.pauseForVisibility();
      this.stopFrame();
      return;
    }
    if (!this.canRender()) {
      this.pauseForVisibility();
      return;
    }
    const wasRunning = this.running;
    this.advancePlayback(time);
    const visualRevision = this.bridge.visualRevision();
    const shouldDraw = wasRunning || this.renderDirty || visualRevision !== this.lastVisualRevision;
    if (shouldDraw && time - this.lastDrawAt >= 1000 / 45) {
      this.lastDrawAt = time;
      this.draw();
      this.renderDirty = false;
      this.lastVisualRevision = visualRevision;
    }
    this.ensureFrame();
  }

  private invalidate(): void {
    this.renderDirty = true;
  }

  syncVisibility(): void {
    if (this.destroyed) return;
    if (!this.canRender()) {
      this.pauseForVisibility();
      this.stopFrame();
      return;
    }
    this.invalidate();
    this.ensureFrame();
  }

  private canRender(): boolean {
    const canvas = this.bridge.renderer.interactiveEl;
    if (!canvas.isConnected || canvas.ownerDocument.hidden || canvas.width <= 0 || canvas.height <= 0) return false;
    const bounds = canvas.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0;
  }

  private ensureFrame(): void {
    if (this.frame === null && this.canRender()) {
      this.frame = requestAnimationFrame((time) => this.tick(time));
    }
  }

  private stopFrame(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private pauseForVisibility(): void {
    if (!this.running) return;
    this.running = false;
    this.updatePlayButton();
    this.updateReadout();
  }

  private isReducedMotion(): boolean {
    return shouldReduceNeuralGraphMotion(
      this.settings.reducedMotion,
      this.reducedMotionMedia?.matches ?? false
    );
  }

  private advancePlayback(time: number): void {
    if (!this.running) return;
    if (this.isActivityGrowth()) {
      if (this.periodStartedAt === 0) this.periodStartedAt = time;
      this.periodProgress = clamp((time - this.periodStartedAt) / Math.max(1, this.periodWaveDuration()), 0, 1);
      const revealed = buildGrowthReplayState(this.growth, this.periodProgress);
      const revealedCount = revealed.revealedNotes.size + revealed.revealedLinks.length;
      if (revealedCount !== this.growthRevealedCount) {
        this.growthRevealedCount = revealedCount;
        this.updateReadout();
      }
      if (this.periodProgress >= 1) {
        this.running = false;
        this.updatePlayButton();
        this.updateReadout();
      }
      return;
    }
    const track = this.selectedTrack();
    if (!track) {
      this.running = false;
      this.updatePlayButton();
      return;
    }
    if (this.isConcurrentPeriod()) {
      if (this.periodStartedAt === 0) this.periodStartedAt = time;
      this.periodProgress = clamp((time - this.periodStartedAt) / Math.max(1, this.periodWaveDuration()), 0, 1);
      const completed = this.concurrentPeriodStates().filter((state) => state.completed).length;
      if (completed !== this.periodCompletedCount) {
        this.periodCompletedCount = completed;
        this.updateReadout();
      }
      if (this.periodProgress >= 1) {
        this.running = false;
        this.updatePlayButton();
        this.updateReadout();
      }
      return;
    }
    if (this.segmentStartedAt === 0) this.segmentStartedAt = time;
    const previousSegmentIndex = this.segmentIndex;
    let duration = this.currentSegmentDuration(track);
    let elapsed = time - this.segmentStartedAt;
    while (elapsed >= duration && this.segmentIndex < track.segments.length) {
      this.segmentIndex += 1;
      elapsed -= duration;
      this.segmentStartedAt = time - elapsed;
      duration = this.currentSegmentDuration(track);
    }
    if (this.segmentIndex >= track.segments.length) {
      this.segmentProgress = 1;
      this.running = false;
      this.updatePlayButton();
      this.updateReadout();
      return;
    }
    this.segmentProgress = clamp(elapsed / Math.max(1, duration), 0, 1);
    if (this.segmentIndex !== previousSegmentIndex) this.updateReadout();
  }

  private draw(): void {
    const canvas = this.canvas;
    const context = this.context;
    if (!canvas || !context) return;
    this.bridge.resizeOverlay();
    if (canvas.width <= 0 || canvas.height <= 0) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    this.drawRegions(context);
    this.drawQuadrantGuides(context);
    this.drawKnowledgeCore(context);
    this.drawClusters(context);
    this.drawHierarchy(context);
    this.drawSemanticNodes(context);
    if (this.isActivityGrowth()) this.drawActivityGrowth(context);
    this.drawInboxOriginAnchor(context);
    if (this.viewMode === "health") {
      this.drawConstructionGaps(context);
      this.drawConstructionNodes(context);
    }
    if (this.viewMode === "audit") this.drawAuditNodes(context);
    this.drawReplay(context);
    context.restore();
  }

  private searchReachByPara(): Map<string, { current: number; total: number }> {
    if (this.viewMode !== "search") return new Map();
    if (this.isConcurrentSearchPeriod()) {
      const started = this.running || this.periodProgress > 0;
      return new Map(buildConcurrentReplayParaReach(
        this.concurrentPeriodStates(),
        this.model.nodes,
        started
      ).map((reach) => [reach.para, reach]));
    }
    const track = this.selectedTrack();
    if (!track || track.kind !== "query") return new Map();
    const started = this.running || this.segmentIndex > 0 || this.segmentProgress > 0;
    const visibleCount = started
      ? this.segmentIndex >= track.segments.length
        ? track.segments.length
        : this.segmentIndex + 1
      : 0;
    return new Map(buildReplayParaReach(track, this.model.nodes, visibleCount).map((reach) => [reach.para, reach]));
  }

  private searchPathState(): { current: Set<string>; total: Set<string> } {
    const current = new Set<string>();
    const total = new Set<string>();
    if (this.viewMode !== "search") return { current, total };
    if (this.isConcurrentSearchPeriod()) {
      const started = this.running || this.periodProgress > 0;
      for (const state of this.concurrentPeriodStates()) {
        for (const segment of state.track.segments) {
          total.add(segment.sourcePath);
          total.add(segment.targetPath);
        }
        if (!started) continue;
        const visibleCount = state.completed
          ? state.track.segments.length
          : state.progress > 0 ? state.segmentIndex + 1 : 0;
        for (const segment of state.track.segments.slice(0, visibleCount)) {
          current.add(segment.sourcePath);
          current.add(segment.targetPath);
        }
      }
      return { current, total };
    }
    const track = this.selectedTrack();
    if (!track || track.kind !== "query") return { current, total };
    for (const segment of track.segments) {
      total.add(segment.sourcePath);
      total.add(segment.targetPath);
    }
    const started = this.running || this.segmentIndex > 0 || this.segmentProgress > 0;
    const visibleCount = !started
      ? 0
      : this.segmentIndex >= track.segments.length ? track.segments.length : this.segmentIndex + 1;
    for (const segment of track.segments.slice(0, visibleCount)) {
      current.add(segment.sourcePath);
      current.add(segment.targetPath);
    }
    return { current, total };
  }

  private ingestPlacementState(): { current: Set<string>; total: Set<string> } {
    const current = new Set<string>();
    const total = new Set<string>();
    if (this.viewMode !== "ingest") return { current, total };
    if (this.isConcurrentBuildPeriod()) {
      const started = this.running || this.periodProgress > 0;
      for (const state of this.concurrentPeriodStates()) {
        const outputs = state.track.segments.filter((segment) => segment.relation === "build-index");
        for (const segment of outputs) total.add(segment.targetPath);
        if (!started) continue;
        const visibleCount = state.completed
          ? state.track.segments.length
          : state.progress > 0 ? state.segmentIndex + 1 : 0;
        for (const segment of state.track.segments.slice(0, visibleCount)) {
          if (segment.relation === "build-index") current.add(segment.targetPath);
        }
      }
      return { current, total };
    }
    const track = this.selectedTrack();
    if (!track || track.kind !== "construction") return { current, total };
    for (const segment of track.segments) {
      if (segment.relation === "build-index") total.add(segment.targetPath);
    }
    const started = this.running || this.segmentIndex > 0 || this.segmentProgress > 0;
    const visibleCount = !started
      ? 0
      : this.segmentIndex >= track.segments.length ? track.segments.length : this.segmentIndex + 1;
    for (const segment of track.segments.slice(0, visibleCount)) {
      if (segment.relation === "build-index") current.add(segment.targetPath);
    }
    return { current, total };
  }

  private growthPathState(): { current: Set<string>; total: Set<string> } {
    const total = new Set(this.growth.noteEvents.map((event) => event.targetPath));
    if (!this.isActivityGrowth()) return { current: new Set<string>(), total };
    return {
      current: buildGrowthReplayState(this.growth, this.periodProgress).revealedNotes,
      total
    };
  }

  private growthReachByPara(): Map<string, { current: number; total: number }> {
    if (!this.isActivityGrowth()) return new Map();
    const state = this.growthPathState();
    const reach = new Map<string, { current: number; total: number }>();
    for (const path of state.total) {
      const para = this.modelNodeByPath.get(path)?.para;
      if (!para) continue;
      const value = reach.get(para) ?? { current: 0, total: 0 };
      value.total += 1;
      if (state.current.has(path)) value.current += 1;
      reach.set(para, value);
    }
    return reach;
  }

  private drawRegions(context: CanvasRenderingContext2D): void {
    const center = this.bridge.worldPoint(0, 0);
    const activityByPara = new Map(this.activities.map((activity) => [activity.para, activity]));
    const buildHealthMode = this.viewMode === "health";
    const auditMode = this.viewMode === "audit";
    const searchMode = this.viewMode === "search";
    const ingestMode = this.viewMode === "ingest";
    const activityFilterMode = this.viewMode === "activity" && !this.isActivityGrowth();
    const growthMode = this.isActivityGrowth();
    const searchReachByPara = this.searchReachByPara();
    const growthReachByPara = this.growthReachByPara();
    const ingestPlacement = this.ingestPlacementState();
    for (const region of this.model.regions) {
      const activity = activityByPara.get(region.para);
      const searchReach = searchReachByPara.get(region.para);
      const growthReach = growthReachByPara.get(region.para);
      const currentReach = searchReach?.current ?? 0;
      const totalReach = searchReach?.total ?? 0;
      const currentGrowth = growthReach?.current ?? 0;
      const totalGrowth = growthReach?.total ?? 0;
      const currentPlaced = [...ingestPlacement.current].filter((path) => this.modelNodeByPath.get(path)?.para === region.para).length;
      const totalPlaced = [...ingestPlacement.total].filter((path) => this.modelNodeByPath.get(path)?.para === region.para).length;
      const buildNotes = this.construction.notes.filter((note) => note.para === region.para);
      const buildStatus = dominantConstructionStatus(buildNotes.map((note) => note.status));
      const auditNotes = this.audit.nodes.filter((note) => note.para === region.para && this.bridge.hasNode(note.path));
      const auditHits = auditNotes.filter((note) => auditMatches(note, this.auditFocus));
      const matches = growthMode
        ? totalGrowth > 0
        : searchMode
        ? totalReach > 0
        : ingestMode
          ? totalPlaced > 0
        : auditMode
        ? auditHits.length > 0
        : buildHealthMode
          ? this.constructionFocus === "all" || buildNotes.some((note) => note.status === this.constructionFocus)
          : !activityFilterMode || this.activityFocus === "all" || activity?.relative === this.activityFocus;
      const focused = growthMode
        ? currentGrowth > 0
        : searchMode
        ? currentReach > 0
        : ingestMode
          ? currentPlaced > 0
        : auditMode
        ? matches
        : buildHealthMode
          ? this.constructionFocus !== "all" && matches
          : activityFilterMode && this.activityFocus !== "all" && matches;
      const color = buildHealthMode
          ? buildStatus ? CONSTRUCTION_COLORS[buildStatus] : PARA_COLORS[region.para] ?? "#7d8492"
          : PARA_COLORS[region.para] ?? PARA_COLORS.unknown ?? "#7d8492";
      const score = growthMode
        ? percentage(currentGrowth, totalGrowth)
        : searchMode
        ? percentage(currentReach, totalReach)
        : ingestMode
          ? percentage(currentPlaced, totalPlaced)
        : auditMode
        ? percentage(auditHits.length, auditNotes.length)
        : buildHealthMode
          ? percentage(buildNotes.filter((note) => note.status === "healthy").length, buildNotes.length)
          : activity?.score ?? 0;
      context.save();
      context.beginPath();
      regionPath(context, center, region, this.bridge);
      const filtering = auditMode || (buildHealthMode
        ? this.constructionFocus !== "all"
        : activityFilterMode && this.activityFocus !== "all");
      context.fillStyle = filtering && !matches
        ? "rgba(0, 0, 0, 0.29)"
        : searchMode || ingestMode
          ? alpha(color, focused ? 0.055 + score * 0.0005 : matches ? 0.014 : 0.006)
          : alpha(color, focused ? 0.07 + score * 0.00045 : matches ? 0.022 + score * 0.00055 : 0.008);
      context.fill();
      if (focused) {
        context.shadowColor = alpha(color, 0.48);
        context.shadowBlur = 15;
      }
      context.lineWidth = focused ? 2.3 : matches ? 1.35 : 0.7;
      context.strokeStyle = alpha(color, focused ? 0.82 : matches ? 0.42 : 0.12);
      context.stroke();
      context.restore();
      const suffix = growthMode
        ? totalGrowth > 0 ? `${currentGrowth}/${totalGrowth} added` : null
        : searchMode
        ? totalReach > 0 ? `${currentReach}/${totalReach} docs` : null
        : ingestMode
          ? totalPlaced > 0 ? `${currentPlaced}/${totalPlaced} placed` : null
        : auditMode
          ? `${auditHits.length} ${auditRegionTerm(this.auditFocus)}`
          : buildHealthMode
          ? buildNotes.length > 0 ? `${score}% integrated` : null
          : activityFilterMode && activity ? `${activity.score}` : null;
      this.drawRegionLabel(context, region, suffix, matches, color);
    }
  }

  private drawRegionLabel(
    context: CanvasRenderingContext2D,
    region: ParaRegion,
    suffix: string | null,
    matches: boolean,
    color: string
  ): void {
    if (region.kind === "core") return;
    const angle = midpointAngle(region.startAngle, region.endAngle);
    const radius = region.kind === "sector" ? region.outerRadius * 1.055 : region.outerRadius * 1.04;
    const point = this.bridge.worldPoint(Math.cos(angle) * radius, Math.sin(angle) * radius);
    context.save();
    context.font = region.kind === "sector" ? "700 12px system-ui, sans-serif" : "600 10px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const text = `${region.label}${suffix ? ` ${suffix}` : ""}`;
    const width = context.measureText(text).width;
    context.fillStyle = "rgba(7, 10, 17, 0.68)";
    roundRect(context, point.x - width / 2 - 7, point.y - 10, width + 14, 20, 7);
    context.fill();
    context.fillStyle = alpha(color, matches ? 0.92 : 0.35);
    context.fillText(text, point.x, point.y);
    context.restore();
  }

  private drawQuadrantGuides(context: CanvasRenderingContext2D): void {
    const sector = this.model.regions.find((region) => region.kind === "sector");
    if (!sector) return;
    const center = this.bridge.worldPoint(0, 0);
    const outer = this.bridge.worldRadiusToScreen(sector.outerRadius);
    const inner = this.bridge.worldRadiusToScreen(sector.innerRadius);
    context.save();
    context.setLineDash([2, 8]);
    context.lineWidth = 0.8;
    context.strokeStyle = "rgba(185, 198, 220, 0.2)";
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const start = this.bridge.worldPoint(Math.cos(angle) * sector.innerRadius, Math.sin(angle) * sector.innerRadius);
      const end = this.bridge.worldPoint(Math.cos(angle) * sector.outerRadius, Math.sin(angle) * sector.outerRadius);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    context.setLineDash([]);
    for (const [radius, opacity, width] of [
      [outer, 0.25, 1.1],
      [outer - 5, 0.1, 0.7],
      [inner, 0.18, 0.8]
    ] as const) {
      context.beginPath();
      context.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2);
      context.lineWidth = width;
      context.strokeStyle = `rgba(194, 204, 224, ${opacity})`;
      context.stroke();
    }
    context.restore();
  }

  private drawClusters(context: CanvasRenderingContext2D): void {
    const searchPaths = this.searchPathState();
    const ingestPlacement = this.ingestPlacementState();
    const growthPaths = this.growthPathState();
    for (const cluster of this.model.clusters) {
      if (cluster.id.endsWith(":root") || cluster.id === "spine") continue;
      const points = cluster.memberPaths
        .map((path) => this.bridge.screenPoint(path))
        .filter((point): point is ScreenPoint => point !== null);
      if (points.length === 0) continue;
      const buildNotes = cluster.memberPaths
        .map((path) => this.construction.notes.find((note) => note.path === path))
        .filter((note): note is ConstructionHealth["notes"][number] => note !== undefined);
      const buildStatus = dominantConstructionStatus(buildNotes.map((note) => note.status));
      const buildMatches = this.constructionFocus === "all"
        || buildNotes.some((note) => note.status === this.constructionFocus);
      const auditHits = cluster.memberPaths
        .map((path) => this.auditNodeByPath.get(path))
        .filter((note): note is KnowledgeAuditNode => note !== undefined
          && this.bridge.hasNode(note.path)
          && auditMatches(note, this.auditFocus));
      const auditMode = this.viewMode === "audit";
      const searchMode = this.viewMode === "search";
      const ingestMode = this.viewMode === "ingest";
      const growthMode = this.isActivityGrowth();
      const searchTotalHits = cluster.memberPaths.filter((path) => searchPaths.total.has(path)).length;
      const searchCurrentHits = cluster.memberPaths.filter((path) => searchPaths.current.has(path)).length;
      const ingestTotalHits = cluster.memberPaths.filter((path) => ingestPlacement.total.has(path)).length;
      const ingestCurrentHits = cluster.memberPaths.filter((path) => ingestPlacement.current.has(path)).length;
      const growthTotalHits = cluster.memberPaths.filter((path) => growthPaths.total.has(path)).length;
      const growthCurrentHits = cluster.memberPaths.filter((path) => growthPaths.current.has(path)).length;
      const color = this.viewMode === "health" && buildStatus
          ? CONSTRUCTION_COLORS[buildStatus]
          : PARA_COLORS[cluster.para] ?? PARA_COLORS.unknown ?? "#7d8492";
      const outline = lumpyOutline(points, cluster.id);
      context.save();
      context.beginPath();
      smoothClosedPath(context, outline);
      context.setLineDash([4, 7]);
      context.lineWidth = (growthMode && growthCurrentHits > 0) || (searchMode && searchCurrentHits > 0) || (ingestMode && ingestCurrentHits > 0)
        ? 1.55
        : auditMode && auditHits.length > 0 ? 1.3 : this.viewMode === "health" && buildStatus ? 1.25 : 1.05;
      context.strokeStyle = alpha(color, growthMode
        ? growthCurrentHits > 0 ? 0.72 : growthTotalHits > 0 ? 0.34 : 0.19
        : searchMode
        ? searchCurrentHits > 0 ? 0.72 : searchTotalHits > 0 ? 0.34 : 0.19
        : ingestMode
          ? ingestCurrentHits > 0 ? 0.72 : ingestTotalHits > 0 ? 0.34 : 0.19
        : auditMode
        ? auditHits.length > 0 ? 0.52 : 0.14
        : this.viewMode === "health" && !buildMatches ? 0.08 : 0.3);
      context.stroke();
      context.fillStyle = alpha(color, (growthMode && growthCurrentHits > 0) || (searchMode && searchCurrentHits > 0) || (ingestMode && ingestCurrentHits > 0)
        ? 0.038
        : auditMode && auditHits.length > 0
        ? 0.025
        : this.viewMode === "health" && buildStatus ? 0.025 : 0.012);
      context.fill();
      const integrated = percentage(buildNotes.filter((note) => note.status === "healthy").length, buildNotes.length);
      const label = growthMode && growthTotalHits > 0
        ? `${cluster.label} · ${growthCurrentHits}/${growthTotalHits} added`
        : searchMode && searchTotalHits > 0
        ? `${cluster.label} · ${searchCurrentHits}/${searchTotalHits} docs`
        : ingestMode && ingestTotalHits > 0
          ? `${cluster.label} · ${ingestCurrentHits}/${ingestTotalHits} placed`
        : auditMode && auditHits.length > 0
          ? `${cluster.label} · ${auditHits.length} ${auditRegionTerm(this.auditFocus)}`
          : this.viewMode === "health" && buildNotes.length > 0
            ? `${cluster.label} · ${integrated}%`
            : cluster.label;
      drawClusterLabel(context, outline, label, color);
      context.restore();
    }
  }

  private drawKnowledgeCore(context: CanvasRenderingContext2D): void {
    const region = this.model.regions.find((candidate) => candidate.kind === "core");
    if (!region) return;
    const center = this.bridge.worldPoint(0, 0);
    const radius = this.bridge.worldRadiusToScreen(region.outerRadius);
    const points = this.model.corePaths
      .map((path) => ({ path, point: this.pointForPath(path) }))
      .filter((item): item is { path: string; point: ScreenPoint } => item.point !== null);
    context.save();
    const glow = context.createRadialGradient(
      center.x - radius * 0.16,
      center.y - radius * 0.18,
      radius * 0.04,
      center.x,
      center.y,
      radius
    );
    glow.addColorStop(0, "rgba(173, 160, 231, 0.14)");
    glow.addColorStop(0.46, "rgba(100, 122, 174, 0.07)");
    glow.addColorStop(1, "rgba(27, 35, 55, 0.015)");
    context.beginPath();
    context.arc(center.x, center.y, radius * 0.96, 0, Math.PI * 2);
    context.fillStyle = glow;
    context.fill();
    for (const [ring, opacity, width] of [
      [0.96, 0.38, 1.15],
      [0.72, 0.16, 0.8],
      [0.43, 0.24, 0.75]
    ] as const) {
      context.beginPath();
      context.arc(center.x, center.y, radius * ring, 0, Math.PI * 2);
      context.strokeStyle = `rgba(203, 207, 233, ${opacity})`;
      context.lineWidth = width;
      if (ring === 0.43) context.setLineDash([2, 6]);
      context.stroke();
      context.setLineDash([]);
    }
    context.font = "700 9px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(225, 229, 244, 0.88)";
    context.fillText("KNOWLEDGE CORE", center.x, center.y - radius * 0.8);
    context.font = "500 7px system-ui, sans-serif";
    context.fillStyle = "rgba(177, 187, 211, 0.62)";
    context.fillText("ROOT · RULES · SCHEMA · GUIDE · MEMORY", center.x, center.y - radius * 0.68);
    context.fillText("SOLID NOTE · DASHED FALLBACK", center.x, center.y + radius * 0.8);

    const root = points.find((item) => this.modelNodeByPath.get(item.path)?.tier === "kb-root");
    if (root) {
      for (const item of points.filter((candidate) => candidate.path !== root.path)) {
        const gradient = context.createLinearGradient(item.point.x, item.point.y, root.point.x, root.point.y);
        gradient.addColorStop(0, "rgba(171, 157, 224, 0.1)");
        gradient.addColorStop(1, "rgba(221, 227, 240, 0.36)");
        context.beginPath();
        context.moveTo(item.point.x, item.point.y);
        context.lineTo(root.point.x, root.point.y);
        context.setLineDash([2, 7]);
        context.lineWidth = 0.8;
        context.strokeStyle = gradient;
        context.stroke();
      }
    }
    context.restore();
  }

  private drawHierarchy(context: CanvasRenderingContext2D): void {
    context.save();
    context.setLineDash([4, 6]);
    for (const edge of this.model.hierarchyEdges) {
      const source = this.bridge.screenPoint(edge.sourcePath);
      const target = this.pointForPath(edge.targetPath);
      const resolvedSource = source ?? this.pointForPath(edge.sourcePath);
      if (!resolvedSource || !target) continue;
      context.beginPath();
      context.moveTo(resolvedSource.x, resolvedSource.y);
      const controlX = (resolvedSource.x + target.x) / 2 + (target.y - resolvedSource.y) * 0.06;
      const controlY = (resolvedSource.y + target.y) / 2 - (target.x - resolvedSource.x) * 0.06;
      context.quadraticCurveTo(controlX, controlY, target.x, target.y);
      context.lineWidth = edge.kind === "spine" ? 1.55 : 0.8;
      if (edge.kind === "spine") {
        const gradient = context.createLinearGradient(resolvedSource.x, resolvedSource.y, target.x, target.y);
        gradient.addColorStop(0, "rgba(166, 151, 221, 0.34)");
        gradient.addColorStop(1, "rgba(221, 228, 241, 0.64)");
        context.strokeStyle = gradient;
      } else {
        context.strokeStyle = "rgba(190, 200, 220, 0.23)";
      }
      context.stroke();
    }
    context.restore();
  }

  private drawSemanticNodes(context: CanvasRenderingContext2D): void {
    const growth = this.growthPathState();
    for (const node of this.model.nodes) {
      if (node.tier === "content") continue;
      if (this.isActivityGrowth() && growth.total.has(node.path) && !growth.current.has(node.path)) continue;
      const point = this.pointForPath(node.path);
      if (!point) continue;
      const color = node.tier === "spine" || node.tier === "kb-root"
        ? "#d9e1f0"
        : PARA_COLORS[node.para] ?? "#aab2c2";
      const rings = tierRings(node);
      context.save();
      if (node.tier === "spine" || node.tier === "kb-root" || node.tier === "para-root") {
        const backing = node.tier === "kb-root" ? 10 : 7;
        context.beginPath();
        context.arc(point.x, point.y, backing, 0, Math.PI * 2);
        context.fillStyle = "rgba(7, 10, 18, 0.74)";
        context.fill();
        context.shadowColor = alpha(color, node.tier === "kb-root" ? 0.5 : 0.28);
        context.shadowBlur = node.tier === "kb-root" ? 12 : 7;
      }
      context.strokeStyle = alpha(color, node.tier === "local-index" ? 0.44 : 0.8);
      context.lineWidth = node.tier === "kb-root" ? 1.7 : 1.15;
      if (node.tier === "local-index") context.setLineDash([2, 3]);
      if (!this.bridge.hasNode(node.path)) {
        context.fillStyle = alpha(color, 0.48);
        context.beginPath();
        context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
        context.fill();
        context.setLineDash([3, 3]);
      }
      for (const radius of rings) {
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.stroke();
      }
      if (node.tier === "spine" || node.tier === "kb-root" || node.tier === "para-root") {
        drawNodeLabel(context, point, node, color);
      }
      context.restore();
    }
  }

  private drawActivityGrowth(context: CanvasRenderingContext2D): void {
    if (this.periodProgress <= 0 || this.growth.events.length === 0) return;
    const state = buildGrowthReplayState(this.growth, this.periodProgress);
    const recentIds = new Set(state.recentEvents.map((event) => event.id));
    const recentWindow = Math.max(1, (this.growth.toMs - this.growth.fromMs) * 0.035);

    for (const event of state.revealedLinks) {
      const geometry = this.growthGeometry(event);
      if (!geometry) continue;
      const recent = this.running && recentIds.has(event.id);
      context.save();
      traceReplayPath(context, geometry);
      context.lineWidth = recent ? 4.6 : 2.5;
      context.strokeStyle = alpha(GROWTH_COLOR, recent ? 0.18 : 0.08);
      context.stroke();
      traceReplayPath(context, geometry);
      context.lineWidth = recent ? 1.9 : 1.15;
      context.strokeStyle = alpha(GROWTH_COLOR, recent ? 0.96 : 0.52);
      context.stroke();
      if (recent) {
        const age = Math.max(0, state.cursorMs - event.timestamp);
        const localProgress = clamp(age / recentWindow, 0, 1);
        const bead = quadraticPoint(geometry.source, geometry.control, geometry.target, easeInOut(localProgress));
        const glow = context.createRadialGradient(bead.x, bead.y, 1, bead.x, bead.y, 11);
        glow.addColorStop(0, alpha(GROWTH_COLOR, 1));
        glow.addColorStop(0.34, alpha(GROWTH_COLOR, 0.72));
        glow.addColorStop(1, alpha(GROWTH_COLOR, 0));
        context.fillStyle = glow;
        context.beginPath();
        context.arc(bead.x, bead.y, 11, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    for (const event of this.growth.noteEvents) {
      if (!state.revealedNotes.has(event.targetPath)) continue;
      const point = this.pointForPath(event.targetPath);
      if (!point) continue;
      const recent = this.running && recentIds.has(event.id);
      const age = Math.max(0, state.cursorMs - event.timestamp);
      const localProgress = clamp(age / recentWindow, 0, 1);
      const node = this.modelNodeByPath.get(event.targetPath);
      const regionColor = node ? PARA_COLORS[node.para] ?? GROWTH_COLOR : GROWTH_COLOR;
      const nodeRadius = recent ? 3.4 + easeInOut(localProgress) * 2.2 : 4.4;
      context.save();
      if (recent) {
        context.shadowColor = alpha(GROWTH_COLOR, 0.82);
        context.shadowBlur = 13;
      }
      context.beginPath();
      context.arc(point.x, point.y, nodeRadius + 1.5, 0, Math.PI * 2);
      context.fillStyle = "rgba(7, 10, 18, 0.9)";
      context.fill();
      context.beginPath();
      context.arc(point.x, point.y, nodeRadius, 0, Math.PI * 2);
      context.fillStyle = alpha(regionColor, recent ? 0.96 : 0.82);
      context.fill();
      context.beginPath();
      context.arc(point.x, point.y, recent ? 6 + localProgress * 9 : 5.5, 0, Math.PI * 2);
      context.lineWidth = recent ? 1.8 : 1.05;
      context.strokeStyle = alpha(GROWTH_COLOR, recent ? 0.96 * (1 - localProgress * 0.42) : 0.48);
      context.stroke();
      context.beginPath();
      context.arc(point.x, point.y, 1.65, 0, Math.PI * 2);
      context.fillStyle = alpha("#fff7d6", recent ? 0.98 : 0.72);
      context.fill();
      context.restore();
    }
  }

  private growthGeometry(event: GrowthReplayEvent): ReplayGeometry | null {
    if (!event.sourcePath) return null;
    const source = this.pointForPath(event.sourcePath);
    const target = this.pointForPath(event.targetPath);
    if (!source || !target) return null;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const direction = stableUnit(`growth-bend:${event.id}`) >= 0.5 ? 1 : -1;
    const bend = Math.min(34, distance * 0.07) * direction;
    return {
      source,
      target,
      control: {
        x: (source.x + target.x) / 2 + (-dy / distance) * bend,
        y: (source.y + target.y) / 2 + (dx / distance) * bend
      }
    };
  }

  private drawAuditNodes(context: CanvasRenderingContext2D): void {
    const color = AUDIT_COLORS[this.auditFocus];
    for (const note of this.audit.nodes) {
      if (!this.bridge.hasNode(note.path) || !auditMatches(note, this.auditFocus)) continue;
      const point = this.pointForPath(note.path);
      if (!point) continue;
      const rings = auditRings(this.auditFocus);
      context.save();
      if (["search-dormant", "ingest-dormant"].includes(this.auditFocus)) context.setLineDash([2, 4]);
      if (this.auditFocus === "cold" || this.auditFocus === "unlinked") {
        context.shadowColor = alpha(color, 0.62);
        context.shadowBlur = this.auditFocus === "cold" ? 10 : 7;
      }
      context.strokeStyle = alpha(color, this.auditFocus === "search-dormant" || this.auditFocus === "ingest-dormant" ? 0.58 : 0.88);
      context.lineWidth = this.auditFocus === "cold" || this.auditFocus === "unlinked" ? 1.5 : 1.05;
      for (const radius of rings) {
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    }
  }

  private drawConstructionGaps(context: CanvasRenderingContext2D): void {
    const candidates = this.construction.notes
      .filter((note) => note.status !== "healthy" && note.expectedIndexPath !== null)
      .filter((note) => this.constructionFocus === "all" || note.status === this.constructionFocus)
      .slice(0, 120);
    context.save();
    context.setLineDash([2, 7]);
    for (const note of candidates) {
      const source = note.expectedIndexPath ? this.pointForPath(note.expectedIndexPath) : null;
      const target = this.pointForPath(note.path);
      if (!source || !target) continue;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.lineWidth = note.status === "unintegrated" ? 1.05 : 0.75;
      context.strokeStyle = alpha(CONSTRUCTION_COLORS[note.status], note.status === "unintegrated" ? 0.36 : 0.22);
      context.stroke();
    }
    context.restore();
  }

  private drawConstructionNodes(context: CanvasRenderingContext2D): void {
    for (const note of this.construction.notes) {
      if (this.constructionFocus !== "all" && note.status !== this.constructionFocus) continue;
      const point = this.pointForPath(note.path);
      if (!point) continue;
      const color = CONSTRUCTION_COLORS[note.status];
      const radius = note.status === "unintegrated" ? 8 : note.status === "attention" ? 6 : 4;
      context.save();
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.lineWidth = note.status === "healthy" ? 0.9 : 1.45;
      context.strokeStyle = alpha(color, note.status === "healthy" ? 0.38 : 0.9);
      if (note.status === "attention") context.setLineDash([2, 3]);
      if (note.status === "unintegrated") {
        context.shadowColor = alpha(color, 0.7);
        context.shadowBlur = 9;
      }
      context.stroke();
      context.restore();
    }
  }

  private drawReplay(context: CanvasRenderingContext2D): void {
    const track = this.selectedTrack();
    if (!track) return;
    const started = this.running || this.segmentIndex > 0 || this.segmentProgress > 0 || this.periodProgress > 0;
    if (this.replayCanvasCleared && !started) return;
    if (this.isConcurrentPeriod()) {
      this.drawConcurrentPeriodReplay(context);
      return;
    }

    const inspectedSnapshot = track.kind === "query"
      ? this.inspectedQueryTrackId === track.id
      : this.inspectedBuildTrackId === track.id;
    if (!started && inspectedSnapshot) {
      for (const segment of track.segments) this.drawReplaySegment(context, segment, 1, false);
      this.drawSettledOutputs(context, track, true);
      return;
    }

    const isPeriod = track.id === "period" || track.id === "build-period";
    const previewEnd = isPeriod
      ? Math.min(track.segments.length, this.segmentIndex + 24)
      : track.segments.length;
    for (let index = this.segmentIndex; index < previewEnd; index += 1) {
      const segment = track.segments[index];
      if (segment) this.drawReplayPreview(context, segment, isPeriod ? 0.1 : 0.15);
    }

    if (!started) return;
    const visibleCount = Math.min(track.segments.length, this.segmentIndex + 1);
    for (let index = 0; index < visibleCount; index += 1) {
      const segment = track.segments[index];
      if (!segment) continue;
      const isCurrent = index === this.segmentIndex && this.segmentIndex < track.segments.length;
      const progress = isCurrent ? this.segmentProgress : 1;
      this.drawReplaySegment(context, segment, progress, isCurrent);
    }
    this.drawSettledOutputs(context, track);
  }

  private drawConcurrentPeriodReplay(context: CanvasRenderingContext2D): void {
    const states = this.concurrentPeriodStates();
    const started = this.running || this.periodProgress > 0;
    if (this.replayCanvasCleared && !started) return;
    if (!started) {
      let drawn = 0;
      for (const state of states) {
        for (const segment of state.track.segments) {
          if (drawn >= 900) return;
          this.drawReplaySegment(context, segment, 1, false, true);
          drawn += 1;
        }
      }
      return;
    }
    let previewed = 0;
    for (const state of states) {
      for (const segment of state.track.segments) {
        if (previewed >= 180) break;
        this.drawReplayPreview(context, segment, 0.035);
        previewed += 1;
      }
    }
    for (const state of states) {
      const visibleCount = state.completed
        ? state.track.segments.length
        : state.progress > 0 ? Math.min(state.track.segments.length, state.segmentIndex + 1) : 0;
      for (let index = 0; index < visibleCount; index += 1) {
        const segment = state.track.segments[index];
        if (!segment) continue;
        const current = !state.completed && index === state.segmentIndex;
        this.drawReplaySegment(context, segment, current ? state.segmentProgress : 1, current, true);
      }
    }
    this.drawConcurrentSettledOutputs(context, states);
  }

  private drawReplayPreview(
    context: CanvasRenderingContext2D,
    segment: ReplaySegment,
    opacity: number
  ): void {
    const geometry = this.replayGeometry(segment);
    if (!geometry) return;
    const color = replayColor(segment, this.modelNodeByPath.get(segment.targetPath));
    context.save();
    if (isInferredReplayRelation(segment.relation)) {
      context.setLineDash([2, 7]);
    }
    traceReplayPath(context, geometry);
    context.lineWidth = 0.9;
    context.strokeStyle = alpha(color, opacity);
    context.stroke();
    context.restore();
  }

  private drawReplaySegment(
    context: CanvasRenderingContext2D,
    segment: ReplaySegment,
    progress: number,
    current: boolean,
    periodWave = false
  ): void {
    const geometry = this.replayGeometry(segment);
    if (!geometry) return;
    const { source, control, target } = geometry;
    const color = replayColor(segment, this.modelNodeByPath.get(segment.targetPath));
    const strokeColor = current ? color : SETTLED_TRACE_COLOR;
    context.save();
    if (isInferredReplayRelation(segment.relation)) {
      context.setLineDash([3, 5]);
    }
    traceReplayPath(context, geometry);
    context.lineWidth = periodWave ? current ? 6.2 : 2.8 : current ? 9 : 5.4;
    context.strokeStyle = alpha(strokeColor, periodWave ? current ? 0.24 : 0.1 : current ? 0.27 : 0.2);
    context.stroke();
    traceReplayPath(context, geometry);
    context.lineWidth = periodWave ? current ? 2.2 : 1.3 : current ? 3.1 : 2;
    context.strokeStyle = alpha(strokeColor, periodWave ? current ? 0.92 : 0.46 : current ? 1 : 0.88);
    context.stroke();
    if (current) {
      const eased = easeInOut(progress);
      const point = quadraticPoint(source, control, target, eased);
      context.setLineDash([]);
      const glowRadius = periodWave ? 12 : 16;
      const glow = context.createRadialGradient(point.x, point.y, 1, point.x, point.y, glowRadius);
      glow.addColorStop(0, alpha(color, 1));
      glow.addColorStop(0.3, alpha(color, 0.78));
      glow.addColorStop(1, alpha(color, 0));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = alpha(color, 0.82 * progress);
      context.lineWidth = periodWave ? 1.05 : 1.5;
      context.beginPath();
      context.arc(target.x, target.y, (periodWave ? 6 : 8) + progress * (periodWave ? 8 : 11), 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  private drawSettledOutputs(context: CanvasRenderingContext2D, track: ReplayTrack, showAll = false): void {
    if (track.kind !== "construction") return;
    const completedCount = showAll
      ? track.segments.length
      : this.segmentIndex >= track.segments.length
      ? track.segments.length
      : this.segmentIndex;
    const settledPaths = [...new Set(track.segments
      .slice(0, completedCount)
      .filter((segment) => segment.relation === "build-index")
      .map((segment) => segment.targetPath))];
    this.drawSettledOutputPaths(context, settledPaths, false);
  }

  private drawConcurrentSettledOutputs(
    context: CanvasRenderingContext2D,
    states: readonly ConcurrentReplayTrackState[]
  ): void {
    const settledPaths = new Set<string>();
    for (const state of states) {
      if (state.track.kind !== "construction" || state.progress <= 0) continue;
      const completedCount = state.completed ? state.track.segments.length : state.segmentIndex;
      for (const segment of state.track.segments.slice(0, completedCount)) {
        if (segment.relation === "build-index") settledPaths.add(segment.targetPath);
      }
    }
    this.drawSettledOutputPaths(context, [...settledPaths], true);
  }

  private drawSettledOutputPaths(
    context: CanvasRenderingContext2D,
    settledPaths: readonly string[],
    compact: boolean
  ): void {
    for (const [index, path] of settledPaths.entries()) {
      const point = this.pointForPath(path);
      if (!point) continue;
      context.save();
      context.shadowColor = alpha(CONSTRUCTION_COLORS.healthy, 0.72);
      context.shadowBlur = compact ? 8 : 13;
      context.strokeStyle = alpha(CONSTRUCTION_COLORS.healthy, 0.94);
      context.lineWidth = compact ? 1.15 : 1.8;
      for (const radius of compact ? [8, 12] : [11, 16]) {
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.stroke();
      }
      context.shadowBlur = 0;
      if (index === settledPaths.length - 1) {
        context.font = "700 8px system-ui, sans-serif";
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.fillStyle = alpha(CONSTRUCTION_COLORS.healthy, 0.95);
        context.fillText(compact ? `${settledPaths.length} SETTLED` : "OUTPUT SETTLED", point.x + (compact ? 15 : 21), point.y);
      }
      context.restore();
    }
  }

  private replayGeometry(segment: ReplaySegment): ReplayGeometry | null {
    const source = this.pointForPath(segment.sourcePath);
    const target = this.pointForPath(segment.targetPath);
    if (!source || !target) return null;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const direction = stableUnit(`replay-bend:${segment.id}`) >= 0.5 ? 1 : -1;
    const bend = Math.min(42, distance * 0.085) * direction;
    return {
      source,
      target,
      control: {
        x: (source.x + target.x) / 2 + (-dy / distance) * bend,
        y: (source.y + target.y) / 2 + (dx / distance) * bend
      }
    };
  }

  private pointForPath(path: string): ScreenPoint | null {
    if (path === INBOX_ORIGIN_PATH) {
      const region = this.model.regions.find((candidate) => candidate.para === "inbox");
      if (!region) return null;
      const angle = midpointAngle(region.startAngle, region.endAngle);
      const radius = (region.innerRadius + region.outerRadius) / 2;
      return this.bridge.worldPoint(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    const core = this.bridge.screenPoint(path);
    if (core) return core;
    const semantic = this.modelNodeByPath.get(path);
    return semantic ? this.bridge.worldPoint(semantic.x, semantic.y) : null;
  }

  private drawInboxOriginAnchor(context: CanvasRenderingContext2D): void {
    const track = this.selectedTrack();
    if (this.viewMode !== "ingest" || !track) return;
    const includesInbox = this.isConcurrentBuildPeriod()
      ? this.concurrentPeriodTracks().some((candidate) => candidate.segments.some((segment) => segment.sourcePath === INBOX_ORIGIN_PATH))
      : track.segments.some((segment) => segment.sourcePath === INBOX_ORIGIN_PATH);
    if (!includesInbox) return;
    const point = this.pointForPath(INBOX_ORIGIN_PATH);
    if (!point) return;
    const color = PARA_COLORS.inbox ?? "#c2a56a";
    context.save();
    context.translate(point.x, point.y);
    context.rotate(Math.PI / 4);
    context.beginPath();
    context.rect(-5, -5, 10, 10);
    context.fillStyle = "rgba(7, 10, 18, 0.82)";
    context.fill();
    context.lineWidth = 1.35;
    context.strokeStyle = alpha(color, 0.92);
    context.stroke();
    context.restore();
    context.save();
    context.font = "700 8px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const label = track.provenance === "logged" ? "RECORDED INBOX ORIGIN" : "REPLAY INBOX ORIGIN";
    const width = context.measureText(label).width;
    context.fillStyle = "rgba(7, 10, 18, 0.78)";
    roundRect(context, point.x - width / 2 - 6, point.y - 25, width + 12, 15, 5);
    context.fill();
    context.fillStyle = alpha(color, 0.94);
    context.fillText(label, point.x, point.y - 17.5);
    context.restore();
  }

  private trackFinalized(track: ReplayTrack): boolean {
    if (track.provenance === "simulated") return true;
    const journeyById = new Map(this.dataset.journeys.map((journey) => [journey.queryId, journey]));
    return track.queryIds.length > 0
      && track.queryIds.every((queryId) => journeyById.get(queryId)?.completed === true);
  }

  private trackTimingLabel(track: ReplayTrack): string {
    if (track.provenance === "simulated") {
      return track.totalDurationMs === null ? "not set" : formatDuration(track.totalDurationMs);
    }
    if (track.totalDurationMs !== null) return formatDuration(track.totalDurationMs);
    return this.trackFinalized(track) ? "not captured" : "not finalized";
  }

  private trackTokenLabel(track: ReplayTrack): string {
    if (track.provenance === "simulated") {
      return track.totalTokens === null ? "not set" : formatTokens(track.totalTokens);
    }
    if (track.totalTokens !== null) return formatTokens(track.totalTokens);
    return this.trackFinalized(track) ? "not captured" : "not finalized";
  }

  private updateReadout(): void {
    const readout = this.readout;
    if (!readout) return;
    const parts: string[] = [modeLabel(this.viewMode)];
    if (this.viewMode === "activity") {
      if (this.isActivityGrowth()) {
        parts.push(this.growthSummary());
      } else {
        const activity = this.focusedActivitySummary();
        parts.push(activity ?? `${this.activities.length} PARA regions · filter relative activation`);
      }
    }
    if (this.viewMode === "health") parts.push(this.constructionSummary());
    if (this.viewMode === "audit") parts.push(this.auditSummary());
    const track = this.selectedTrack();
    if (track) {
      if (track.kind === "construction") {
        const duration = this.trackTimingLabel(track);
        const tokens = `${this.trackTokenLabel(track)}${track.totalTokens === null ? "" : " tokens"}`;
        const ingest = track.kbIngestUsed === null ? "route mixed" : track.kbIngestUsed ? "kb-ingest" : "direct write";
        if (track.id === "sim-build-period") {
          parts.push(`${this.simulatedBatchTracks().length} simultaneous replay placements · ${track.outputCount} outputs · ${track.referenceCount} refs · ${track.linksAdded ?? 0} proposed links · ${duration} · ${tokens}`);
        } else if (track.id === "build-period") {
          parts.push(`${this.periodBuildTracks().length} simultaneous logged builds · ${track.outputCount} outputs · ${track.referenceCount} refs · ${track.linksAdded ?? "n/a"} links · ${duration} · ${tokens}`);
        } else if (track.provenance === "simulated") {
          parts.push(`${track.outputCount} outputs · ${track.referenceCount} refs · ${track.linksAdded ?? 0} proposed links · ${track.route ?? "scenario"} · ${duration} · ${tokens}`);
        } else {
          parts.push(`LOGGED · ${track.outputCount} outputs · ${track.referenceCount} refs · ${track.linksAdded ?? "n/a"} links · ${ingest} · ${duration} · ${tokens}`);
        }
      } else if (track.id === "period" || track.id === "sim-query-period") {
        const simulated = track.id === "sim-query-period";
        const samples = simulated ? this.simulatedQueryBatchTracks() : this.periodSampleTracks();
        const durations = samples
          .map((sample) => sample.totalDurationMs)
          .filter((value): value is number => value !== null)
          .sort((a, b) => a - b);
        const p50 = median(durations);
        const averageReach = samples.length > 0
          ? samples.reduce((sum, sample) => sum + sample.uniquePaths, 0) / samples.length
          : 0;
        const reach = [...this.searchReachByPara().entries()]
          .filter(([para]) => ["common", "projects", "areas", "resources", "archive"].includes(para))
          .map(([para, value]) => ({ para, total: value.total }))
          .sort((a, b) => b.total - a.total);
        const top = reach[0];
        const unused = reach.filter((item) => item.total === 0).map((item) => paraDisplayLabel(item.para));
        const distribution = top
          ? ` · top ${paraDisplayLabel(top.para)} ${top.total}${unused.length > 0 ? ` · unused ${unused.join("/")}` : ""}`
          : "";
        const timingCoverage = `${durations.length}/${samples.length} timed`;
        const p50Label = p50 === null
          ? samples.some((sample) => !this.trackFinalized(sample)) ? "not finalized" : "not captured"
          : formatDuration(p50);
        parts.push(`${simulated ? "Replay set" : "Recorded"} · ${samples.length} concurrent queries · ${track.uniquePaths} unique notes · max ${track.maxGraphHops ?? "n/a"} hops · ${averageReach.toFixed(1)} notes/query · p50 ${p50Label} (${timingCoverage})${distribution}`);
      } else {
        const duration = this.trackTimingLabel(track);
        const hops = track.maxGraphHops === null ? "hop n/a" : `max ${track.maxGraphHops} hops`;
        const reach = track.reachPerSecond === null ? "reach/s n/a" : `${track.reachPerSecond.toFixed(1)} notes/s`;
        parts.push(`${track.uniquePaths} notes · ${track.paraSpan} PARA · ${hops} · ${reach} · ${duration} · ${this.trackTokenLabel(track)}`);
      }
      if (this.replayCanvasCleared) parts.push("replay canvas cleared");
      const playback = this.playbackSummary(track);
      if (playback) parts.push(playback);
      readout.textContent = parts.join(" · ");
      return;
    }
    if (this.viewMode === "search") parts.push("No search paths in this period");
    if (this.viewMode === "ingest") parts.push("No construction paths or replay placements available");
    readout.textContent = parts.join(" · ");
  }

  private focusedActivitySummary(): string | null {
    if (this.activityFocus === "all" || this.activityFocus === "growth") return null;
    const label = this.activityFocus === "low" ? "Underactive" : "Highly active";
    const focused = this.activities
      .filter((activity) => activity.relative === this.activityFocus)
      .sort((a, b) => a.score - b.score)
      .map((activity) => `${activity.label} ${activity.score}`)
      .join(", ");
    return `${label}: ${focused || "none"}`;
  }

  private growthSummary(): string {
    if (this.growth.events.length === 0) {
      return `No note creation events in period · ${this.growth.edgeHistoryAvailable ? "no added links observed" : "edge history unavailable"}`;
    }
    const state = buildGrowthReplayState(this.growth, this.periodProgress);
    const status = this.running ? "playing" : this.periodProgress <= 0 ? "ready" : this.periodProgress >= 1 ? "complete" : "paused";
    const edge = this.growth.edgeHistoryAvailable
      ? `${state.revealedLinks.length}/${this.growth.linkEvents.length} edges observed`
      : `edge history unavailable · ${this.growth.snapshotObservations} stored snapshot`;
    return `${status} ${Math.round(this.periodProgress * 100)}% · ${formatGrowthDate(state.cursorMs)} · ${state.revealedNotes.size}/${this.growth.noteEvents.length} nodes added · ${edge}`;
  }

  private constructionSummary(): string {
    const health = this.construction;
    if (health.eligibleNotes === 0) return "Build health: no new knowledge notes in period";
    const indexed = percentage(health.indexedNotes, health.eligibleNotes);
    const linked = percentage(health.linkedNotes, health.eligibleNotes);
    const summarized = percentage(health.summarizedNotes, health.eligibleNotes);
    const focus = this.constructionFocus === "all"
      ? ""
      : this.constructionFocus === "attention"
        ? ` · attention ${health.attentionNotes}`
        : ` · unintegrated ${health.unintegratedNotes}`;
    const logged = health.loggedBuilds > 0
      ? ` · ${health.loggedBuilds} logged (${health.kbIngestBuilds} ingest/${health.directBuilds} direct)`
      : " · build telemetry pending";
    return `Build ${health.eligibleNotes} notes · indexed ${indexed}% · linked ${linked}% · summary ${summarized}%${focus}${logged}`;
  }

  private auditSummary(): string {
    const visible = this.audit.nodes.filter((note) => this.bridge.hasNode(note.path));
    const total = visible.length;
    const matches = visible.filter((note) => auditMatches(note, this.auditFocus)).length;
    const telemetry = this.auditFocus === "ingest-dormant"
      ? this.audit.ingestTelemetryAvailable
        ? `${this.audit.loggedBuilds} logged builds · logged-only coverage`
        : "build telemetry unavailable"
      : this.auditFocus === "search-dormant"
        ? this.audit.searchTelemetryAvailable
          ? `${this.audit.queryRuns} search runs`
          : "search telemetry unavailable"
        : `${this.audit.queryRuns} searches · ${this.audit.loggedBuilds} logged builds`;
    return `${auditFocusLabel(this.auditFocus)} ${matches}/${total} · ${auditDefinition(this.auditFocus)} · ${telemetry}`;
  }

  private playbackSummary(track: ReplayTrack): string | null {
    if (track.segments.length === 0) return null;
    if (this.isConcurrentPeriod()) {
      const states = this.concurrentPeriodStates();
      const completed = states.filter((state) => state.completed).length;
      const state = this.running ? "playing" : this.periodProgress <= 0 ? "ready" : this.periodProgress >= 1 ? "complete" : "paused";
      const noun = track.kind === "query" ? "queries" : "operations";
      return `${state} wave ${Math.round(this.periodProgress * 100)}% · ${completed}/${states.length} ${noun} finished · simultaneous start`;
    }
    if (this.segmentIndex >= track.segments.length) return `complete ${track.segments.length}/${track.segments.length}`;
    const segment = track.segments[this.segmentIndex];
    if (!segment) return null;
    const state = this.running
      ? "playing"
      : this.segmentIndex === 0 && this.segmentProgress === 0
        ? "ready"
        : "paused";
    const relation = replayRelationLabel(segment.relation);
    const real = segment.realDurationMs === null ? "timing n/a" : formatDuration(segment.realDurationMs);
    const visual = formatDuration(segment.visualDurationMs / this.playbackSpeed);
    return `${state} ${this.segmentIndex + 1}/${track.segments.length} · ${relation} · ${real}→${visual}`;
  }
}

function regionPath(
  context: CanvasRenderingContext2D,
  center: ScreenPoint,
  region: ParaRegion,
  bridge: CoreGraphBridge
): void {
  const outer = bridge.worldRadiusToScreen(region.outerRadius);
  if (region.kind === "core") {
    context.arc(center.x, center.y, outer, 0, Math.PI * 2);
    return;
  }
  const inner = bridge.worldRadiusToScreen(region.innerRadius);
  context.arc(center.x, center.y, outer, region.startAngle, region.endAngle);
  context.arc(center.x, center.y, inner, region.endAngle, region.startAngle, true);
  context.closePath();
}

function lumpyOutline(points: readonly ScreenPoint[], seed: string): ScreenPoint[] {
  if (points.length === 1) {
    const point = points[0];
    if (!point) return [];
    return Array.from({ length: 10 }, (_, index) => {
      const angle = (index / 10) * Math.PI * 2;
      const wobble = 15 + stableUnit(`${seed}:${index}`) * 7;
      return { x: point.x + Math.cos(angle) * wobble, y: point.y + Math.sin(angle) * wobble };
    });
  }
  const hull = convexHull(points);
  if (hull.length <= 2) {
    const first = hull[0];
    const second = hull[1] ?? first;
    return first && second ? capsuleOutline(first, second, seed) : [];
  }
  const center = centroid(hull);
  return hull.map((point, index) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const padding = 13 + stableUnit(`${seed}:${index}`) * 8;
    return { x: point.x + (dx / length) * padding, y: point.y + (dy / length) * padding };
  });
}

function capsuleOutline(source: ScreenPoint, target: ScreenPoint, seed: string): ScreenPoint[] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) {
    return Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2;
      const radius = 17 + stableUnit(`${seed}:capsule:${index}`) * 5;
      return { x: source.x + Math.cos(angle) * radius, y: source.y + Math.sin(angle) * radius };
    });
  }
  const angle = Math.atan2(dy, dx);
  const points: ScreenPoint[] = [];
  const steps = 6;
  for (let index = 0; index <= steps; index += 1) {
    const theta = angle - Math.PI / 2 + (index / steps) * Math.PI;
    const radius = 16 + stableUnit(`${seed}:target:${index}`) * 6;
    points.push({ x: target.x + Math.cos(theta) * radius, y: target.y + Math.sin(theta) * radius });
  }
  for (let index = 0; index <= steps; index += 1) {
    const theta = angle + Math.PI / 2 + (index / steps) * Math.PI;
    const radius = 16 + stableUnit(`${seed}:source:${index}`) * 6;
    points.push({ x: source.x + Math.cos(theta) * radius, y: source.y + Math.sin(theta) * radius });
  }
  return points;
}

function convexHull(points: readonly ScreenPoint[]): ScreenPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const lower: ScreenPoint[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2) as ScreenPoint, lower.at(-1) as ScreenPoint, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: ScreenPoint[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2) as ScreenPoint, upper.at(-1) as ScreenPoint, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function smoothClosedPath(context: CanvasRenderingContext2D, points: readonly ScreenPoint[]): void {
  if (points.length === 0) return;
  if (points.length === 1) {
    const point = points[0];
    if (point) context.arc(point.x, point.y, 18, 0, Math.PI * 2);
    return;
  }
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return;
  context.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    if (!point || !next) continue;
    context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
  }
  context.closePath();
}

function drawClusterLabel(
  context: CanvasRenderingContext2D,
  outline: readonly ScreenPoint[],
  label: string,
  color: string
): void {
  if (outline.length === 0) return;
  const minX = Math.min(...outline.map((point) => point.x));
  const maxX = Math.max(...outline.map((point) => point.x));
  const minY = Math.min(...outline.map((point) => point.y));
  const point = { x: (minX + maxX) / 2, y: minY - 10 };
  context.font = "600 8.5px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const width = context.measureText(label).width;
  context.fillStyle = "rgba(6, 9, 16, 0.82)";
  roundRect(context, point.x - width / 2 - 6, point.y - 7, width + 12, 14, 5);
  context.fill();
  context.lineWidth = 0.7;
  context.strokeStyle = alpha(color, 0.35);
  context.stroke();
  context.fillStyle = alpha(color, 0.9);
  context.fillText(label, point.x, point.y);
}

function drawNodeLabel(
  context: CanvasRenderingContext2D,
  point: ScreenPoint,
  node: StructuredNode,
  color: string
): void {
  context.font = node.tier === "kb-root" ? "650 11px system-ui, sans-serif" : "600 9px system-ui, sans-serif";
  context.textBaseline = "middle";
  let align: CanvasTextAlign = "left";
  let x = point.x + 14;
  let y = point.y;
  if (node.tier === "kb-root") {
    align = "center";
    x = point.x;
    y = point.y + 22;
  } else if (node.tier === "spine") {
    const vertical = Math.abs(node.x) < Math.abs(node.y) * 0.45;
    if (vertical) {
      align = "center";
      x = point.x;
      y = point.y + Math.sign(node.y || 1) * 16;
    } else if (node.x < 0) {
      align = "right";
      x = point.x - 14;
    }
  }
  context.textAlign = align;
  const metrics = context.measureText(node.label);
  const left = align === "center" ? x - metrics.width / 2 - 4 : align === "right" ? x - metrics.width - 4 : x - 4;
  context.fillStyle = "rgba(8, 11, 18, 0.72)";
  roundRect(context, left, y - 8, metrics.width + 8, 16, 5);
  context.fill();
  context.fillStyle = alpha(color, 0.94);
  context.fillText(node.label, x, y);
}

function tierRings(node: StructuredNode): number[] {
  if (node.tier === "kb-root") return [9, 14, 19];
  if (node.tier === "spine") return [8, 13];
  if (node.tier === "para-root") return [8, 13];
  if (node.tier === "hub-index") return [9];
  return [7];
}

function selectControl(
  document: Document,
  label: string,
  options: Array<[string, string]>,
  value: string
): { root: HTMLLabelElement; label: HTMLSpanElement; select: HTMLSelectElement } {
  const root = document.createElement("label");
  root.className = "llmwo-graph-control";
  const text = document.createElement("span");
  text.textContent = label;
  const select = document.createElement("select");
  for (const [optionValue, optionLabel] of options) select.appendChild(option(document, optionValue, optionLabel));
  select.value = value;
  root.append(text, select);
  return { root, label: text, select };
}

function appendTrackGroup(
  select: HTMLSelectElement,
  label: string,
  periodTrack: ReplayTrack | null,
  tracks: readonly ReplayTrack[]
): void {
  if (!periodTrack && tracks.length === 0) return;
  const group = select.ownerDocument.createElement("optgroup");
  group.label = label;
  if (periodTrack) group.appendChild(option(select.ownerDocument, periodTrack.id, periodTrack.label));
  for (const track of [...tracks].reverse().slice(0, 60)) {
    group.appendChild(option(select.ownerDocument, track.id, track.label));
  }
  select.appendChild(group);
}

function option(document: Document, value: string, label: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  return element;
}

function button(document: Document, label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "llmwo-graph-button";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

function createNeuralGraphLoadingOverlay(content: HTMLElement): NeuralGraphLoadingOverlay {
  const document = content.ownerDocument;
  const computed = document.defaultView?.getComputedStyle(content);
  if (!computed || computed.position === "static") content.style.position = "relative";
  const overlay = document.createElement("div");
  overlay.className = "llmwo-neural-loading";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-valuemin", "0");
  overlay.setAttribute("aria-valuemax", "100");
  const plate = document.createElement("section");
  const eyebrow = document.createElement("span");
  eyebrow.textContent = "OBSIDIAN · PARA GRAPH";
  const title = document.createElement("strong");
  title.textContent = "Building PARA Second Brain Viz";
  const label = document.createElement("p");
  const track = document.createElement("div");
  const bar = document.createElement("i");
  track.appendChild(bar);
  const footer = document.createElement("div");
  const detail = document.createElement("small");
  const value = document.createElement("b");
  footer.append(detail, value);
  plate.append(eyebrow, title, label, track, footer);
  overlay.appendChild(plate);
  content.appendChild(overlay);
  let current = 0;
  return {
    update(progress, nextLabel, nextDetail = "") {
      const normalized = Math.round(clamp(progress, 0, 100));
      if (normalized < current) return;
      current = normalized;
      overlay.setAttribute("aria-valuenow", String(normalized));
      label.textContent = nextLabel;
      detail.textContent = nextDetail;
      value.textContent = `${normalized}%`;
      bar.style.width = `${normalized}%`;
    },
    fail(nextLabel) {
      overlay.classList.add("is-error");
      title.textContent = "PARA Second Brain Viz unavailable";
      label.textContent = nextLabel;
      detail.textContent = "The native Graph View remains available.";
      value.textContent = "Stopped";
      bar.style.width = "100%";
    },
    destroy() {
      overlay.remove();
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function periodRange(period: PeriodPreset): { from: string | null; to: string } {
  const now = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : null;
  return {
    from: days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString(),
    to: now.toISOString()
  };
}

function midpointAngle(start: number, end: number): number {
  return start + (end - start) / 2;
}

function centroid(points: readonly ScreenPoint[]): ScreenPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };
}

function cross(origin: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function dominantConstructionStatus(statuses: readonly ConstructionStatus[]): ConstructionStatus | null {
  if (statuses.length === 0) return null;
  const unintegrated = statuses.filter((status) => status === "unintegrated").length;
  if (unintegrated / statuses.length >= 0.25) return "unintegrated";
  if (statuses.some((status) => status !== "healthy")) return "attention";
  return "healthy";
}

function percentage(value: number, total: number): number {
  return total <= 0 ? 0 : Math.round((value / total) * 100);
}

function replayColor(segment: ReplaySegment, node: StructuredNode | undefined): string {
  if (segment.relation === "build-capture") return PARA_COLORS.inbox ?? "#c2a56a";
  if (segment.relation === "build-guide") return "#c5b8ff";
  if (segment.relation === "build-route") return "#9f8fe8";
  if (segment.relation === "build-index") return CONSTRUCTION_COLORS.healthy;
  if (segment.relation === "build-reference") return CONSTRUCTION_COLORS.attention;
  if (segment.relation === "build-compose") return "#f3ca7a";
  if (segment.relation === "build-link") return "#6fd8f2";
  return PARA_COLORS[node?.para ?? "unknown"] ?? "#8fc8ff";
}

function replayRelationLabel(relation: ReplaySegment["relation"]): string {
  if (relation === "linked-pair") return "linked";
  if (relation === "retrieval-transition") return "retrieval";
  if (relation === "build-capture") return "Inbox→guide";
  if (relation === "build-guide") return "guide→KB root";
  if (relation === "build-route") return "KB root→target index";
  if (relation === "build-reference") return "index→reference";
  if (relation === "build-compose") return "reference→output";
  if (relation === "build-index") return "index→output";
  return "link added";
}

function isInferredReplayRelation(relation: ReplaySegment["relation"]): boolean {
  return relation === "retrieval-transition"
    || relation === "build-capture"
    || relation === "build-guide"
    || relation === "build-route"
    || relation === "build-reference"
    || relation === "build-compose";
}

function modeLabel(mode: GraphViewMode): string {
  if (mode === "activity") return "Activity map";
  if (mode === "search") return "Search replay";
  if (mode === "ingest") return "Ingest replay";
  if (mode === "health") return "Build health";
  return "Knowledge audit";
}

function modeHint(mode: GraphViewMode): string {
  if (mode === "activity") return "Nodes stay fixed · Activity filters relative activation; Growth replay blooms note creation and uses snapshot diffs only for added edges.";
  if (mode === "search") return "Period sets the time window; Replay set selects latest 10/20/50/all inside it · concurrent queries finish by measured duration · solid wikilink, dashed retrieval jump.";
  if (mode === "ingest") return "Period + Replay set scopes recorded builds · waves start together and settle by duration · replay routes reuse real vault anchors · Inbox appears only when captured.";
  if (mode === "health") return "Teal = integrated · amber = needs attention · red = unintegrated · filter to inspect structural gaps.";
  return "Structural isolation and actual Search/Ingest use are separate signals · dormant ingest reflects logged BuildSummary only.";
}

function formatGrowthDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "time unavailable";
  return new Date(timestamp).toISOString().slice(0, 10);
}

function auditMatches(note: KnowledgeAuditNode, focus: KnowledgeAuditFocus): boolean {
  if (focus === "orphan") return note.orphan;
  if (focus === "unlinked") return note.unlinked;
  if (focus === "search-dormant") return note.searchDormant;
  if (focus === "ingest-dormant") return note.ingestDormant;
  if (focus === "inactive") return note.inactive;
  return note.coldIsolated;
}

function auditFocusLabel(focus: KnowledgeAuditFocus): string {
  if (focus === "orphan") return "Orphans";
  if (focus === "unlinked") return "Unlinked";
  if (focus === "search-dormant") return "Search dormant";
  if (focus === "ingest-dormant") return "Ingest dormant";
  if (focus === "inactive") return "Operationally inactive";
  return "Cold isolated";
}

function auditRegionTerm(focus: KnowledgeAuditFocus): string {
  if (focus === "orphan") return "orphan";
  if (focus === "unlinked") return "unlinked";
  if (focus === "search-dormant") return "no search";
  if (focus === "ingest-dormant") return "no ingest";
  if (focus === "inactive") return "inactive";
  return "cold";
}

function paraDisplayLabel(para: string): string {
  if (para === "common") return "Common";
  if (para === "projects") return "Projects";
  if (para === "areas") return "Areas";
  if (para === "resources") return "Resources";
  if (para === "archive") return "Archive";
  if (para === "inbox") return "Inbox";
  return "Unclassified";
}

function formatQueryTimestamp(value: string | null): string {
  if (!value) return "Undated query";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function auditDefinition(focus: KnowledgeAuditFocus): string {
  if (focus === "orphan") return "incoming links = 0";
  if (focus === "unlinked") return "resolved degree = 0";
  if (focus === "search-dormant") return "query touches = 0 in period";
  if (focus === "ingest-dormant") return "BuildSummary touches = 0 in period";
  if (focus === "inactive") return "query/build/mtime = 0 in period";
  return "inactive and resolved degree ≤ 1";
}

function auditRings(focus: KnowledgeAuditFocus): number[] {
  if (focus === "unlinked") return [7, 11];
  if (focus === "cold") return [8, 13];
  if (focus === "inactive") return [8];
  if (focus === "ingest-dormant") return [8];
  return [7];
}

function alpha(color: string, opacity: number): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return color;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`;
}

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function easeInOut(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

function traceReplayPath(context: CanvasRenderingContext2D, geometry: ReplayGeometry): void {
  context.beginPath();
  context.moveTo(geometry.source.x, geometry.source.y);
  context.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.target.x, geometry.target.y);
}

function quadraticPoint(
  source: ScreenPoint,
  control: ScreenPoint,
  target: ScreenPoint,
  progress: number
): ScreenPoint {
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * source.x + 2 * inverse * progress * control.x + progress * progress * target.x,
    y: inverse * inverse * source.y + 2 * inverse * progress * control.y + progress * progress * target.y
  };
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return `${Math.round(tokens)}`;
  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatAverage(values: readonly number[]): string {
  const value = mean(values);
  return value === null ? "not captured" : value.toFixed(value < 10 && !Number.isInteger(value) ? 1 : 0);
}

function formatOptionalSum(values: readonly (number | null)[]): string {
  const captured = values.filter((value): value is number => value !== null);
  return captured.length === 0 ? "not captured" : String(captured.reduce((sum, value) => sum + value, 0));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  const value = values[middle];
  if (value === undefined) return null;
  if (values.length % 2 === 1) return value;
  return ((values[middle - 1] ?? value) + value) / 2;
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function shouldReduceNeuralGraphMotion(settingEnabled: boolean, mediaMatches: boolean): boolean {
  return settingEnabled || mediaMatches;
}
