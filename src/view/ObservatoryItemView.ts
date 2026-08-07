import { ItemView, WorkspaceLeaf } from "obsidian";
import type { LensUiUsageEvent, ParaCategory } from "../model";
import type { PeriodPreset, ObservatoryLoadResult, ObservatoryViewServices } from "../plugin/contracts";
import { PARA_OPTIONS, viewStateForPeriod } from "../plugin/contracts";
import { CanvasSceneRenderer, UserTriggeredAnimationController, type RenderResult } from "../render/canvas";
import { getLens, OBSERVATORY_LENSES } from "../visualization/registry";
import type { ObservatoryDataset, ViewState, VisualScene } from "../visualization/types";
import {
  PERIOD_OPTIONS,
  availabilityForScene,
  buildLensRail,
  contextSummary,
  defaultLensId,
  dwellBucketMs,
  findMarkEvidence,
  formatInspectorSummary,
  kpisForScene,
  nextParaScope,
  nextQuerySelection,
  nextViewStateForPeriod,
  semanticMarkOrder,
  shouldStartPlayback
} from "./viewModel";

export const OBSERVATORY_VIEW_TYPE = "llm-wiki-observatory-view";

type ViewStatus = "loading" | "ready" | "error";

interface RuntimeState {
  status: ViewStatus;
  error: string | null;
  period: PeriodPreset;
  lensId: string;
  search: string;
  playbackSpeed: number;
  dataset: ObservatoryDataset | null;
  scene: VisualScene | null;
  loadReport: ObservatoryLoadResult["report"] | null;
  renderResult: RenderResult | null;
  viewState: ViewState;
}

export class ObservatoryItemView extends ItemView {
  private readonly services: ObservatoryViewServices;
  private readonly animation = new UserTriggeredAnimationController();
  private resizeObserver: ResizeObserver | null = null;
  private renderer: CanvasSceneRenderer | null = null;
  private railEl: HTMLElement | null = null;
  private contextEl: HTMLElement | null = null;
  private kpiEl: HTMLElement | null = null;
  private stageWrapEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private controlsEl: HTMLElement | null = null;
  private semanticEl: HTMLElement | null = null;
  private inspectorEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private openedAt = Date.now();
  private visible = true;
  private hoveredMarkId: string | null = null;
  private state: RuntimeState;

  constructor(leaf: WorkspaceLeaf, services: ObservatoryViewServices) {
    super(leaf);
    this.services = services;
    const settings = services.getSettings();
    const period = settings.defaultPeriod;
    this.state = {
      status: "loading",
      error: null,
      period,
      lensId: defaultLensId(settings),
      search: "",
      playbackSpeed: 1,
      dataset: null,
      scene: null,
      loadReport: null,
      renderResult: null,
      viewState: viewStateForPeriod(period, new Date(), {
        reducedMotion: settings.reducedMotion || prefersReducedMotion()
      })
    };
  }

  getViewType(): string {
    return OBSERVATORY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Second Brain Metrics Lab";
  }

  getIcon(): string {
    return "scan-eye";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.buildShell();
    await this.refresh();
    await this.recordUsage("open");
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  async onClose(): Promise<void> {
    this.flushForegroundUsage();
    this.animation.cancel();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.contentEl.empty();
  }

  onResize(): void {
    this.renderStage();
  }

  async refresh(): Promise<void> {
    this.setStatus("loading", null);
    try {
      const result = await this.services.loadDataset();
      this.state = {
        ...this.state,
        status: "ready",
        error: null,
        dataset: result.dataset,
        loadReport: result.report
      };
      this.rebuildScene(false);
      this.setStatus(
        "ready",
        `Loaded ${result.report.noteCount} notes, ${result.report.linkCount} links, and ${result.report.telemetry.journeys} query journeys.`
      );
    } catch (error) {
      this.setStatus("error", error instanceof Error ? error.message : String(error));
    }
  }

  async captureSnapshot(): Promise<boolean> {
    try {
      const result = await this.services.captureSnapshot();
      this.setStatus("ready", `Captured ${result.snapshot.id} -> ${result.path}`);
      await this.refresh();
      return true;
    } catch (error) {
      this.setStatus("error", error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  private buildShell(): void {
    const root = create("div", "llmwo-root");
    this.contentEl.appendChild(root);

    const rail = create("aside", "llmwo-rail");
    const main = create("main", "llmwo-main");
    const inspector = create("aside", "llmwo-inspector");
    this.railEl = rail;
    this.inspectorEl = inspector;

    this.contextEl = create("section", "llmwo-context");
    this.kpiEl = create("section", "llmwo-kpis");
    this.stageWrapEl = create("section", "llmwo-stage-wrap");
    this.controlsEl = create("section", "llmwo-controls");
    this.semanticEl = create("section", "llmwo-semantic");
    this.statusEl = create("div", "llmwo-status");

    const canvas = document.createElement("canvas");
    canvas.className = "llmwo-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Second Brain Metrics Lab visual stage");
    canvas.addEventListener("click", (event) => this.onCanvasClick(event));
    canvas.addEventListener("mousemove", (event) => this.onCanvasMove(event));
    canvas.addEventListener("mouseleave", () => this.onCanvasLeave());
    canvas.addEventListener("keydown", (event) => this.onCanvasKeydown(event));
    this.canvasEl = canvas;
    this.renderer = new CanvasSceneRenderer(canvas);
    this.stageWrapEl.appendChild(canvas);

    main.append(this.contextEl, this.kpiEl, this.stageWrapEl, this.controlsEl, this.semanticEl, this.statusEl);
    root.append(rail, main, inspector);

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.renderStage());
      this.resizeObserver.observe(this.stageWrapEl);
    }
  }

  private rebuildScene(userTriggered: boolean): void {
    const dataset = this.state.dataset;
    const lens = getLens(this.state.lensId) ?? OBSERVATORY_LENSES[0];
    if (!dataset || !lens) {
      this.renderAll();
      return;
    }
    const scene = lens.buildModel(dataset, this.state.viewState);
    this.state = { ...this.state, scene };
    if (scene.status === "unavailable") {
      void this.recordUsage("unavailable");
    }
    this.renderAll();
    if (userTriggered) this.tryStartPlayback(scene.motion.trigger);
  }

  private renderAll(): void {
    this.renderRail();
    this.renderContext();
    this.renderKpis();
    this.renderStage();
    this.renderControls();
    this.renderSemanticMarks();
    this.renderInspector();
  }

  private renderRail(): void {
    if (!this.railEl) return;
    this.railEl.replaceChildren();
    const heading = create("div", "llmwo-rail-heading");
    heading.append(
      textEl("h2", "Metrics Lab"),
      textEl("p", "Secondary samples · growth, link change, latency, tokens, and efficiency."),
      this.renderSearch()
    );
    this.railEl.appendChild(heading);

    const groups = buildLensRail(
      OBSERVATORY_LENSES,
      this.state.lensId,
      this.state.dataset,
      this.services.getSettings(),
      this.state.search
    );
    for (const group of groups) {
      const section = create("section", "llmwo-lens-family");
      section.appendChild(textEl("h3", group.label));
      for (const item of group.items) {
        const button = buttonEl(
          `${item.id} ${item.title}`,
          item.question,
          `llmwo-lens ${item.selected ? "is-selected" : ""} ${item.unavailable ? "is-unavailable" : ""}`
        );
        button.type = "button";
        button.setAttribute("aria-pressed", String(item.selected));
        button.addEventListener("click", () => this.selectLens(item.id));
        const meta = create("span", "llmwo-lens-meta");
        meta.textContent = [
          item.favorite ? "favorite" : "",
          item.recent ? "recent" : "",
          item.unavailable ? `missing ${item.missingCapabilities.length}` : item.primitive
        ].filter(Boolean).join(" / ");
        button.appendChild(meta);
        section.appendChild(button);
      }
      this.railEl.appendChild(section);
    }
  }

  private renderSearch(): HTMLElement {
    const label = create("label", "llmwo-search");
    const span = create("span", "llmwo-sr-only");
    span.textContent = "Search lenses";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search";
    input.value = this.state.search;
    input.addEventListener("input", () => {
      this.state = { ...this.state, search: input.value };
      this.renderRail();
    });
    label.append(span, input);
    return label;
  }

  private renderContext(): void {
    if (!this.contextEl) return;
    this.contextEl.replaceChildren();
    const scene = this.state.scene;
    const summary = contextSummary(this.state.viewState, this.state.period, scene, this.state.dataset);
    this.contextEl.append(
      this.selectControl("Period", PERIOD_OPTIONS, this.state.period, (value) => this.setPeriod(value as PeriodPreset)),
      this.selectControl("PARA", PARA_OPTIONS, this.state.viewState.paraScope[0] ?? "all", (value) =>
        this.setPara(value as ParaCategory | "all")
      ),
      this.queryControl(),
      this.indexDepthControl(),
      contextPill("Confidence", summary.confidenceLabel),
      contextPill("Source", summary.sourceLabel)
    );
  }

  private renderKpis(): void {
    if (!this.kpiEl) return;
    this.kpiEl.replaceChildren();
    const availability = create("div", "llmwo-availability");
    for (const item of availabilityForScene(this.state.scene)) {
      const chip = create("span", `llmwo-availability-chip is-${item.state}`);
      chip.textContent = `${item.label}: ${item.state}`;
      availability.appendChild(chip);
    }
    this.kpiEl.appendChild(availability);
    for (const kpi of kpisForScene(this.state.scene)) {
      const item = create("article", `llmwo-kpi is-${kpi.confidence}`);
      const provenance = textEl("small", `${confidenceWord(kpi.confidence)} / ${kpi.source}`);
      provenance.title = kpi.source;
      item.append(textEl("span", kpi.label), textEl("strong", kpi.value), provenance);
      this.kpiEl.appendChild(item);
    }
  }

  private renderStage(): void {
    const canvas = this.canvasEl;
    const wrap = this.stageWrapEl;
    const renderer = this.renderer;
    const scene = this.state.scene;
    if (!canvas || !wrap || !renderer || !scene) return;
    const rect = wrap.getBoundingClientRect();
    const width = Math.floor(rect.width);
    const height = Math.floor(rect.height);
    this.animation.setVisibility(!this.visible || document.hidden, width, height);
    const result = renderer.render(scene, { width, height, dpr: window.devicePixelRatio || 1 }, {
      selectedMarkId: this.state.viewState.selectedMarkId,
      focusedMarkId: this.hoveredMarkId,
      playbackProgress: this.state.viewState.playbackProgress
    });
    this.state = { ...this.state, renderResult: result };
  }

  private renderControls(): void {
    if (!this.controlsEl) return;
    this.controlsEl.replaceChildren();
    this.controlsEl.append(
      buttonEl("Play", "Replay this lens animation", "llmwo-icon-button", () => this.play()),
      buttonEl("Pause", "Pause replay", "llmwo-icon-button", () => this.animation.pause()),
      buttonEl("Step", "Step replay forward", "llmwo-icon-button", () => this.stepPlayback()),
      buttonEl("Restart", "Restart replay", "llmwo-icon-button", () => this.restartPlayback()),
      this.selectControl("Speed", [
        { value: "0.5", label: "0.5x" },
        { value: "1", label: "1x" },
        { value: "1.5", label: "1.5x" },
        { value: "2", label: "2x" }
      ], String(this.state.playbackSpeed), (value) => {
        this.state = { ...this.state, playbackSpeed: Number(value) || 1 };
      }),
      buttonEl("Compare", "Compare snapshots", "llmwo-command", () => this.compareSnapshots()),
      buttonEl("Capture", "Capture current snapshot", "llmwo-command", () => {
        void this.captureSnapshot();
      }),
      buttonEl("Refresh", "Reload observatory data", "llmwo-command", () => {
        void this.refresh();
      })
    );
  }

  private renderSemanticMarks(): void {
    if (!this.semanticEl) return;
    this.semanticEl.replaceChildren();
    const heading = textEl("h3", "Marks");
    const list = create("div", "llmwo-mark-list");
    list.setAttribute("role", "listbox");
    const marks = semanticMarkOrder(this.state.renderResult?.semanticTree ?? null, this.state.renderResult?.hitRegions ?? []);
    for (const mark of marks.slice(0, 80)) {
      const button = buttonEl(mark.label, `${mark.label}, ${confidenceWord(mark.confidence)}`, `llmwo-mark ${mark.selected ? "is-selected" : ""}`);
      button.type = "button";
      button.disabled = mark.disabled;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(mark.selected));
      button.addEventListener("click", () => this.selectMark(mark.markId));
      list.appendChild(button);
    }
    this.semanticEl.append(heading, list);
  }

  private renderInspector(): void {
    if (!this.inspectorEl) return;
    this.inspectorEl.replaceChildren();
    const scene = this.state.scene;
    if (!scene) {
      this.inspectorEl.append(textEl("h2", "Loading"), textEl("p", "Preparing observatory dataset."));
      return;
    }
    const selectedEvidence = findMarkEvidence(scene, this.state.viewState.selectedMarkId);
    this.inspectorEl.append(textEl("h2", scene.inspector.heading), textEl("p", scene.inspector.summary));
    const definition = create("dl", "llmwo-definition");
    addDefinition(definition, "Lens", `${scene.lensId} / ${scene.primitive} / ${scene.status}`);
    addDefinition(definition, "Definition", formatInspectorSummary(scene.inspector));
    addDefinition(definition, "Confidence", confidenceWord(scene.confidence));
    addDefinition(definition, "Missing", scene.missingCapabilities.length ? scene.missingCapabilities.join(", ") : "none");
    this.inspectorEl.appendChild(definition);

    if (selectedEvidence) {
      const selected = create("section", "llmwo-selected-evidence");
      selected.append(textEl("h3", selectedEvidence.label), textEl("p", selectedEvidence.detail ?? "Selected visual mark."));
      selected.appendChild(textEl("small", confidenceWord(selectedEvidence.confidence)));
      if (selectedEvidence.path) {
        selected.appendChild(buttonEl("Open note", `Open ${selectedEvidence.path}`, "llmwo-command", () => {
          void this.openEvidencePath(selectedEvidence.path);
        }));
      }
      this.inspectorEl.appendChild(selected);
    }

    const evidenceList = create("ul", "llmwo-evidence-list");
    for (const evidence of scene.inspector.evidence.slice(0, 12)) {
      const item = document.createElement("li");
      item.textContent = `${evidence.label} / ${confidenceWord(evidence.confidence)}${evidence.detail ? ` / ${evidence.detail}` : ""}`;
      evidenceList.appendChild(item);
    }
    this.inspectorEl.appendChild(evidenceList);

    if (scene.status === "unavailable") {
      this.inspectorEl.appendChild(textEl("p", `Needed capability: ${scene.missingCapabilities.join(", ")}`));
      this.inspectorEl.appendChild(buttonEl("Refresh sources", "Reload data sources", "llmwo-command", () => {
        void this.refresh();
      }));
    }
  }

  private setStatus(status: ViewStatus, message: string | null): void {
    this.state = { ...this.state, status, error: status === "error" ? message : null };
    if (this.statusEl) {
      this.statusEl.textContent = message ?? status;
      this.statusEl.setAttribute("aria-live", "polite");
    }
    this.renderAll();
  }

  private selectControl(
    labelText: string,
    options: Array<{ value: string; label: string }>,
    value: string,
    onChange: (value: string) => void
  ): HTMLElement {
    const label = create("label", "llmwo-select");
    label.appendChild(textEl("span", labelText));
    const select = document.createElement("select");
    for (const option of options) {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      select.appendChild(node);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    label.appendChild(select);
    return label;
  }

  private queryControl(): HTMLElement {
    const journeys = this.state.dataset?.journeys ?? [];
    const options = [
      { value: "all", label: "All queries" },
      ...journeys.slice(-25).reverse().map((journey) => ({ value: journey.queryId, label: `Query ${journey.queryId.slice(0, 8)}` }))
    ];
    return this.selectControl("Query", options, this.state.viewState.selectedQueryId ?? "all", (value) => {
      this.state = { ...this.state, viewState: nextQuerySelection(this.state.viewState, value) };
      void this.recordUsage("filter");
      this.rebuildScene(true);
    });
  }

  private indexDepthControl(): HTMLElement {
    const label = create("label", "llmwo-depth");
    label.append(textEl("span", "Index depth"));
    const input = document.createElement("input");
    input.type = "range";
    input.min = "1";
    input.max = "4";
    input.step = "1";
    input.value = String(this.state.viewState.indexDepth);
    input.addEventListener("input", () => {
      this.state = {
        ...this.state,
        viewState: { ...this.state.viewState, indexDepth: Number(input.value), playbackProgress: 1 }
      };
      void this.recordUsage("filter");
      this.rebuildScene(true);
    });
    label.append(input, textEl("strong", String(this.state.viewState.indexDepth)));
    return label;
  }

  private selectLens(lensId: string): void {
    if (lensId === this.state.lensId) return;
    this.flushForegroundUsage();
    this.openedAt = Date.now();
    const settings = this.services.getSettings();
    const recentLensIds = [lensId, ...settings.recentLensIds.filter((id) => id !== lensId)].slice(0, 8);
    void this.services.updateSettings({ recentLensIds });
    this.state = {
      ...this.state,
      lensId,
      viewState: { ...this.state.viewState, selectedMarkId: null, playbackProgress: 1 }
    };
    void this.recordUsage("open");
    this.rebuildScene(true);
  }

  private setPeriod(period: PeriodPreset): void {
    this.state = {
      ...this.state,
      period,
      viewState: nextViewStateForPeriod(period, new Date(), this.state.viewState)
    };
    void this.recordUsage("filter");
    this.rebuildScene(true);
  }

  private setPara(para: ParaCategory | "all"): void {
    this.state = { ...this.state, viewState: nextParaScope(this.state.viewState, para) };
    void this.recordUsage("filter");
    this.rebuildScene(true);
  }

  private selectMark(markId: string): void {
    this.state = {
      ...this.state,
      viewState: { ...this.state.viewState, selectedMarkId: markId, playbackProgress: 1 }
    };
    void this.recordUsage("drilldown");
    this.tryStartPlayback("selection");
    this.renderAll();
  }

  private onCanvasClick(event: MouseEvent): void {
    const hit = this.hitAt(event);
    if (hit) this.selectMark(hit.markId);
  }

  private onCanvasMove(event: MouseEvent): void {
    const canvas = this.canvasEl;
    const nextHoveredMarkId = this.hitAt(event)?.markId ?? null;
    if (canvas) canvas.style.cursor = nextHoveredMarkId ? "pointer" : "crosshair";
    if (nextHoveredMarkId === this.hoveredMarkId) return;
    this.hoveredMarkId = nextHoveredMarkId;
    this.renderStage();
  }

  private onCanvasLeave(): void {
    if (this.canvasEl) this.canvasEl.style.cursor = "crosshair";
    if (this.hoveredMarkId === null) return;
    this.hoveredMarkId = null;
    this.renderStage();
  }

  private hitAt(event: MouseEvent): RenderResult["hitRegions"][number] | null {
    const canvas = this.canvasEl;
    const result = this.state.renderResult;
    if (!canvas || !result) return null;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return result.hitRegions.find((region) =>
      x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height
    ) ?? null;
  }

  private onCanvasKeydown(event: KeyboardEvent): void {
    const marks = semanticMarkOrder(this.state.renderResult?.semanticTree ?? null, this.state.renderResult?.hitRegions ?? []);
    if (marks.length === 0) return;
    const currentIndex = marks.findIndex((mark) => mark.markId === this.state.viewState.selectedMarkId);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = marks[currentIndex < 0 ? 0 : Math.min(marks.length - 1, currentIndex + 1)];
      if (next) this.selectMark(next.markId);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const previous = marks[currentIndex < 0 ? marks.length - 1 : Math.max(0, currentIndex - 1)];
      if (previous) this.selectMark(previous.markId);
    }
  }

  private play(): void {
    const scene = this.state.scene;
    if (!scene) return;
    this.tryStartPlayback(scene.motion.trigger);
    void this.recordUsage(scene.motion.trigger === "compare" ? "compare" : "replay");
  }

  private stepPlayback(): void {
    const scene = this.state.scene;
    if (!scene) return;
    this.ensureAnimationOptions(scene);
    this.animation.step(0.12);
  }

  private restartPlayback(): void {
    this.state = {
      ...this.state,
      viewState: { ...this.state.viewState, playbackProgress: 0 }
    };
    this.play();
  }

  private compareSnapshots(): void {
    const dataset = this.state.dataset;
    if (!dataset || dataset.snapshots.length < 2) {
      this.setStatus("ready", "Snapshot compare needs at least two snapshots.");
      return;
    }
    const before = dataset.snapshots.at(-2);
    const after = dataset.snapshots.at(-1);
    if (!before || !after) return;
    this.state = {
      ...this.state,
      viewState: {
        ...this.state.viewState,
        beforeSnapshotId: before.id,
        afterSnapshotId: after.id,
        playbackProgress: 0
      }
    };
    void this.recordUsage("compare");
    this.rebuildScene(true);
  }

  private tryStartPlayback(trigger: VisualScene["motion"]["trigger"]): void {
    const scene = this.state.scene;
    const wrap = this.stageWrapEl;
    if (!scene || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const reducedMotion = this.services.getSettings().reducedMotion || prefersReducedMotion();
    if (!shouldStartPlayback({
      trigger,
      reducedMotion,
      hidden: !this.visible || document.hidden,
      width: rect.width,
      height: rect.height,
      userRequested: true
    })) {
      this.animation.cancel();
      this.state = {
        ...this.state,
        viewState: { ...this.state.viewState, playbackProgress: 1, reducedMotion }
      };
      this.renderStage();
      return;
    }
    this.animation.play({
      motion: { ...scene.motion, durationMs: scene.motion.durationMs / Math.max(0.25, this.state.playbackSpeed) },
      reducedMotion,
      hidden: !this.visible || document.hidden,
      width: rect.width,
      height: rect.height,
      onFrame: (frame) => {
        this.state = {
          ...this.state,
          viewState: { ...this.state.viewState, playbackProgress: frame.progress, reducedMotion }
        };
        this.renderStage();
      }
    });
  }

  private ensureAnimationOptions(scene: VisualScene): void {
    const wrap = this.stageWrapEl;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    if (this.animation.state === "idle" || this.animation.state === "cancelled") {
      this.animation.play({
        motion: scene.motion,
        reducedMotion: true,
        hidden: true,
        width: rect.width,
        height: rect.height,
        onFrame: (frame) => {
          this.state = {
            ...this.state,
            viewState: { ...this.state.viewState, playbackProgress: frame.progress }
          };
          this.renderStage();
        }
      });
    }
  }

  private async openEvidencePath(path: string | null): Promise<void> {
    if (!path) return;
    await this.recordUsage("drilldown");
    await this.services.openNote(path);
  }

  private async recordUsage(action: LensUiUsageEvent["action"], dwellMs?: number): Promise<void> {
    if (!this.services.getSettings().recordLensUsage) return;
    const event: LensUiUsageEvent = {
      id: randomId(),
      observedAt: new Date().toISOString(),
      lensId: this.state.lensId,
      action
    };
    if (dwellMs !== undefined) {
      event.dwellMs = dwellBucketMs(dwellMs);
    }
    await this.services.recordLensUsage(event);
  }

  private flushForegroundUsage(): void {
    const dwell = Date.now() - this.openedAt;
    this.openedAt = Date.now();
    void this.recordUsage("foreground", dwell);
  }

  private readonly onVisibilityChange = (): void => {
    this.visible = !document.hidden;
    if (!this.visible) this.flushForegroundUsage();
    this.renderStage();
  };
}

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function textEl<K extends keyof HTMLElementTagNameMap>(tag: K, text: string): HTMLElementTagNameMap[K] {
  const element = create(tag);
  element.textContent = text;
  return element;
}

function buttonEl(label: string, title: string, className: string, onClick?: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  if (onClick) button.addEventListener("click", onClick);
  return button;
}

function contextPill(label: string, value: string): HTMLElement {
  const pill = create("div", "llmwo-context-pill");
  pill.append(textEl("span", label), textEl("strong", value));
  return pill;
}

function addDefinition(list: HTMLElement, term: string, detail: string): void {
  list.append(textEl("dt", term), textEl("dd", detail));
}

function confidenceWord(confidence: string): string {
  if (confidence === "measured") return "measured";
  if (confidence === "inferred") return "inferred";
  return "unavailable";
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
