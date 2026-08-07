import type { StructuredGraphModel } from "./model";

interface CoreGraphNodeLike {
  id: string;
  x: number;
  y: number;
  fx: number | null;
  fy: number | null;
  weight: number;
  rendered: boolean;
}

interface CoreGraphRendererLike {
  interactiveEl: HTMLCanvasElement;
  nodes: CoreGraphNodeLike[];
  nodeLookup: Record<string, CoreGraphNodeLike>;
  worker: { postMessage(message: unknown): void };
  width: number;
  height: number;
  scale: number;
  targetScale: number;
  panX: number;
  panY: number;
  changed(): void;
  resetPan(): void;
  zoomTo(scale: number, center?: { x: number; y: number }): void;
}

interface CoreGraphDataEngineLike {
  getOptions(): Record<string, unknown>;
  setOptions(options: Record<string, unknown>): void;
}

interface CoreGraphViewLike {
  contentEl: HTMLElement;
  renderer: CoreGraphRendererLike;
  dataEngine?: CoreGraphDataEngineLike;
  getViewType(): string;
}

interface OriginalNodeState {
  node: CoreGraphNodeLike;
  x: number;
  y: number;
  fx: number | null;
  fy: number | null;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export type CoreGraphBridgeResult =
  | { ok: true; bridge: CoreGraphBridge }
  | { ok: false; reason: string };

export type CuratedScopeWaitResult =
  | { ok: true }
  | {
      ok: false;
      reason: "excluded-paths-remain" | "scope-did-not-settle";
      remainingExclusions: string[];
    };

export class CoreGraphBridge {
  readonly view: CoreGraphViewLike;
  readonly renderer: CoreGraphRendererLike;
  private readonly originals = new Map<string, OriginalNodeState>();
  private parentPosition = "";
  private overlayCanvas: HTMLCanvasElement | null = null;
  private originalGraphOptions: Record<string, unknown> | null = null;
  private originalCanvasOpacity: string | null = null;
  private originalCanvasTransition: string | null = null;

  private constructor(view: CoreGraphViewLike) {
    this.view = view;
    this.renderer = view.renderer;
  }

  static connect(rawView: unknown): CoreGraphBridgeResult {
    if (!rawView || typeof rawView !== "object") return { ok: false, reason: "Graph view is unavailable." };
    const view = rawView as Partial<CoreGraphViewLike>;
    if (typeof view.getViewType !== "function" || view.getViewType() !== "graph") {
      return { ok: false, reason: "The target leaf is not a core Graph View." };
    }
    const renderer = view.renderer as Partial<CoreGraphRendererLike> | undefined;
    if (!renderer) return { ok: false, reason: "Core graph renderer has not loaded yet." };
    if (
      !renderer.interactiveEl
      || renderer.interactiveEl.tagName !== "CANVAS"
      || typeof renderer.interactiveEl.getContext !== "function"
    ) {
      return { ok: false, reason: "Core graph canvas is not available in this Obsidian build." };
    }
    if (
      !Array.isArray(renderer.nodes)
      || !renderer.nodeLookup
      || !renderer.worker
      || typeof renderer.worker.postMessage !== "function"
    ) {
      return { ok: false, reason: "Core graph node bridge is incompatible with this Obsidian build." };
    }
    if (
      typeof renderer.changed !== "function"
      || typeof renderer.resetPan !== "function"
      || typeof renderer.zoomTo !== "function"
    ) {
      return { ok: false, reason: "Core graph transform bridge is incompatible with this Obsidian build." };
    }
    if (!view.contentEl || typeof view.contentEl.appendChild !== "function") {
      return { ok: false, reason: "Core graph content element is unavailable." };
    }
    return { ok: true, bridge: new CoreGraphBridge(view as CoreGraphViewLike) };
  }

  createOverlayCanvas(): HTMLCanvasElement {
    if (this.overlayCanvas) return this.overlayCanvas;
    const coreCanvas = this.renderer.interactiveEl;
    const parent = coreCanvas.parentElement;
    if (!parent) throw new Error("Core graph canvas parent is unavailable.");
    const document = coreCanvas.ownerDocument;
    const overlay = document.createElement("canvas");
    overlay.className = "llmwo-core-graph-overlay";
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "4",
      pointerEvents: "none"
    });
    this.parentPosition = parent.style.position;
    const computed = document.defaultView?.getComputedStyle(parent);
    if (!computed || computed.position === "static") parent.style.position = "relative";
    parent.appendChild(overlay);
    this.overlayCanvas = overlay;
    this.resizeOverlay();
    return overlay;
  }

  resizeOverlay(): boolean {
    const overlay = this.overlayCanvas;
    if (!overlay) return false;
    const coreCanvas = this.renderer.interactiveEl;
    const width = coreCanvas.width;
    const height = coreCanvas.height;
    if (width <= 0 || height <= 0) return false;
    const changed = overlay.width !== width || overlay.height !== height;
    if (changed) {
      overlay.width = width;
      overlay.height = height;
    }
    return changed;
  }

  applyStructuredLayout(model: StructuredGraphModel): number {
    let matched = 0;
    for (const semantic of model.nodes) {
      const node = this.renderer.nodeLookup[semantic.path];
      if (!node) continue;
      if (!this.originals.has(semantic.path)) {
        this.originals.set(semantic.path, {
          node,
          x: node.x,
          y: node.y,
          fx: node.fx,
          fy: node.fy
        });
      }
      node.x = semantic.x;
      node.y = semantic.y;
      node.fx = semantic.x;
      node.fy = semantic.y;
      this.renderer.worker.postMessage({
        alpha: 0,
        alphaTarget: 0,
        run: false,
        forceNode: { id: node.id, x: semantic.x, y: semantic.y }
      });
      matched += 1;
    }
    this.renderer.worker.postMessage({ alpha: 0, alphaTarget: 0, run: false });
    this.fit(model.worldRadius);
    this.renderer.changed();
    return matched;
  }

  stabilizeStructuredAnchors(model: StructuredGraphModel): number {
    let matched = 0;
    for (const semantic of model.nodes) {
      const node = this.renderer.nodeLookup[semantic.path];
      if (!node) continue;
      node.x = semantic.x;
      node.y = semantic.y;
      node.fx = semantic.x;
      node.fy = semantic.y;
      this.renderer.worker.postMessage({
        alpha: 0,
        alphaTarget: 0,
        run: false,
        forceNode: { id: node.id, x: semantic.x, y: semantic.y }
      });
      matched += 1;
    }
    this.renderer.worker.postMessage({ alpha: 0, alphaTarget: 0, run: false });
    if (matched > 0) this.renderer.changed();
    return matched;
  }

  applyCuratedScope(exclusions: readonly string[] = []): void {
    const dataEngine = this.view.dataEngine;
    if (!dataEngine || typeof dataEngine.getOptions !== "function" || typeof dataEngine.setOptions !== "function") return;
    const current = dataEngine.getOptions();
    if (!this.originalGraphOptions) this.originalGraphOptions = { ...current };
    const search = mergeGraphSearch(current.search, exclusions);
    dataEngine.setOptions({
      ...current,
      search,
      showTags: false,
      showAttachments: false,
      hideUnresolved: true,
      showOrphans: false,
      showArrow: false,
      close: true
    });
  }

  async waitForCuratedScope(
    exclusions: readonly string[] = [],
    timeoutMs = 8_000
  ): Promise<CuratedScopeWaitResult> {
    const started = Date.now();
    let lastFingerprint = "";
    let stableChecks = 0;
    while (Date.now() - started < timeoutMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const remainingExclusions = this.remainingExcludedPaths(exclusions);
      const fingerprint = Object.keys(this.renderer.nodeLookup).sort().join("\u001f");
      stableChecks = fingerprint === lastFingerprint ? stableChecks + 1 : 0;
      lastFingerprint = fingerprint;
      if (remainingExclusions.length === 0 && Date.now() - started >= 150 && stableChecks >= 2) {
        return { ok: true };
      }
    }
    const remainingExclusions = this.remainingExcludedPaths(exclusions);
    return {
      ok: false,
      reason: remainingExclusions.length > 0 ? "excluded-paths-remain" : "scope-did-not-settle",
      remainingExclusions
    };
  }

  releaseStructuredLayout(): void {
    for (const original of this.originals.values()) {
      original.node.fx = null;
      original.node.fy = null;
      this.renderer.worker.postMessage({
        alpha: 0.35,
        alphaTarget: 0,
        run: true,
        forceNode: { id: original.node.id, x: null, y: null }
      });
    }
    this.renderer.changed();
  }

  restore(): void {
    for (const original of this.originals.values()) {
      original.node.x = original.x;
      original.node.y = original.y;
      original.node.fx = original.fx;
      original.node.fy = original.fy;
      this.renderer.worker.postMessage({
        alpha: 0,
        alphaTarget: 0,
        run: false,
        forceNode: { id: original.node.id, x: original.x, y: original.y }
      });
      this.renderer.worker.postMessage({
        alpha: 0.3,
        alphaTarget: 0,
        run: original.fx === null || original.fy === null,
        forceNode: { id: original.node.id, x: original.fx, y: original.fy }
      });
    }
    this.originals.clear();
    this.renderer.changed();
  }

  fit(worldRadius: number): void {
    const width = this.renderer.interactiveEl.width;
    const height = this.renderer.interactiveEl.height;
    if (width <= 0 || height <= 0 || worldRadius <= 0) return;
    const targetScale = clamp(Math.min(width, height) / (worldRadius * 2), 1 / 128, 8) * 0.88;
    this.renderer.resetPan();
    this.renderer.zoomTo(targetScale);
    this.renderer.changed();
  }

  screenPoint(path: string): ScreenPoint | null {
    const node = this.renderer.nodeLookup[path];
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
    return this.worldPoint(node.x, node.y);
  }

  worldPoint(x: number, y: number): ScreenPoint {
    return {
      x: x * this.renderer.scale + this.renderer.panX,
      y: y * this.renderer.scale + this.renderer.panY
    };
  }

  worldRadiusToScreen(radius: number): number {
    return Math.abs(radius * this.renderer.scale);
  }

  visualRevision(): string {
    let positionA = 0;
    let positionB = 0;
    for (let index = 0; index < this.renderer.nodes.length; index += 1) {
      const node = this.renderer.nodes[index];
      if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const weightA = (index % 97) + 1;
      const weightB = (index % 89) + 1;
      positionA += node.x * weightA + node.y * weightB;
      positionB += node.x * weightB - node.y * weightA;
    }
    return [
      this.renderer.width,
      this.renderer.height,
      this.renderer.scale,
      this.renderer.panX,
      this.renderer.panY,
      positionA,
      positionB
    ].map((value) => Number.isFinite(value) ? value.toFixed(3) : "nan").join(":");
  }

  hasNode(path: string): boolean {
    return this.renderer.nodeLookup[path] !== undefined;
  }

  setNativeGraphDimmed(dimmed: boolean): void {
    const style = this.renderer.interactiveEl.style;
    if (!style) return;
    if (dimmed) {
      if (this.originalCanvasOpacity === null) this.originalCanvasOpacity = style.opacity;
      if (this.originalCanvasTransition === null) this.originalCanvasTransition = style.transition;
      style.opacity = "0.22";
      style.transition = "opacity 180ms ease";
      return;
    }
    if (this.originalCanvasOpacity !== null) style.opacity = this.originalCanvasOpacity;
    if (this.originalCanvasTransition !== null) style.transition = this.originalCanvasTransition;
    this.originalCanvasOpacity = null;
    this.originalCanvasTransition = null;
  }

  private hasExcludedNode(rawPath: string): boolean {
    const path = normalizeExclusionPath(rawPath);
    if (!path) return false;
    if (path.endsWith("/")) {
      return this.renderer.nodes.some((node) => node.id.startsWith(path));
    }
    return this.renderer.nodeLookup[path] !== undefined || this.renderer.nodes.some((node) => node.id === path);
  }

  private remainingExcludedPaths(exclusions: readonly string[]): string[] {
    return exclusions
      .map(normalizeExclusionPath)
      .filter((path): path is string => path !== null)
      .filter((path) => this.hasExcludedNode(path));
  }

  destroy(): void {
    this.setNativeGraphDimmed(false);
    this.restore();
    if (this.originalGraphOptions && this.view.dataEngine) {
      this.view.dataEngine.setOptions(this.originalGraphOptions);
      this.originalGraphOptions = null;
    }
    const overlay = this.overlayCanvas;
    if (overlay) {
      const parent = overlay.parentElement;
      overlay.remove();
      if (parent) parent.style.position = this.parentPosition;
    }
    this.overlayCanvas = null;
  }
}

export async function waitForCoreGraphBridge(
  view: unknown,
  timeoutMs = 5_000
): Promise<CoreGraphBridgeResult> {
  const started = Date.now();
  let latest: CoreGraphBridgeResult = { ok: false, reason: "Core graph renderer has not loaded yet." };
  while (Date.now() - started < timeoutMs) {
    latest = CoreGraphBridge.connect(view);
    if (latest.ok) return latest;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return latest;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mergeGraphSearch(current: unknown, exclusions: readonly string[]): string {
  const base = typeof current === "string" ? current.trim() : "";
  const terms = exclusions
    .map(normalizeExclusionPath)
    .filter((path): path is string => path !== null)
    .map((path) => `-path:"${path.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .filter((term) => !base.includes(term));
  return [base, ...terms].filter(Boolean).join(" ");
}

function normalizeExclusionPath(value: string): string | null {
  const path = value.trim().replace(/^\.\//, "");
  if (!path || path.includes("\n") || path.includes("\r")) return null;
  return path;
}
