import { describe, expect, it, vi } from "vitest";
import { CoreGraphBridge } from "../../src/core-graph/bridge";
import {
  NeuralGraphEnhancer,
  shouldReduceNeuralGraphMotion,
  type NeuralGraphOpenResult
} from "../../src/core-graph/enhancer";
import type { StructuredGraphModel } from "../../src/core-graph/model";

function graphFixture(worker: { postMessage?: unknown }) {
  const node = {
    id: "1. Projects/_index.md",
    x: 12,
    y: 24,
    fx: null,
    fy: null,
    weight: 3,
    rendered: true
  };
  const renderer = {
    interactiveEl: {
      tagName: "CANVAS",
      width: 1_000,
      height: 800,
      style: { opacity: "", transition: "" },
      getContext: vi.fn()
    },
    nodes: [node],
    nodeLookup: { [node.id]: node },
    worker,
    width: 1_000,
    height: 800,
    scale: 1,
    targetScale: 1,
    panX: 500,
    panY: 400,
    changed: vi.fn(),
    resetPan: vi.fn(),
    zoomTo: vi.fn()
  };
  return {
    node,
    renderer,
    view: {
      contentEl: { appendChild: vi.fn() },
      renderer,
      getViewType: () => "graph"
    }
  };
}

const MODEL: StructuredGraphModel = {
  nodes: [{
    path: "1. Projects/_index.md",
    label: "Projects Index",
    para: "projects",
    tier: "para-root",
    clusterId: "projects:root",
    clusterLabel: "Projects",
    x: 120,
    y: 240
  }],
  regions: [],
  clusters: [],
  hierarchyEdges: [],
  corePaths: [],
  worldRadius: 500
};

describe("CoreGraphBridge", () => {
  it("honors either the plugin setting or the OS reduced-motion preference", () => {
    expect(shouldReduceNeuralGraphMotion(false, false)).toBe(false);
    expect(shouldReduceNeuralGraphMotion(true, false)).toBe(true);
    expect(shouldReduceNeuralGraphMotion(false, true)).toBe(true);
  });

  it("rejects a private worker shape without postMessage", () => {
    const fixture = graphFixture({ postMessage: "not-a-function" });

    const result = CoreGraphBridge.connect(fixture.view);

    expect(result).toEqual({
      ok: false,
      reason: "Core graph node bridge is incompatible with this Obsidian build."
    });
  });

  it("restores an unfixed node in the worker before releasing it", () => {
    const postMessage = vi.fn();
    const fixture = graphFixture({ postMessage });
    const result = CoreGraphBridge.connect(fixture.view);
    if (!result.ok) throw new Error(result.reason);
    result.bridge.applyStructuredLayout(MODEL);
    postMessage.mockClear();

    result.bridge.destroy();

    expect(fixture.node).toMatchObject({ x: 12, y: 24, fx: null, fy: null });
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      alpha: 0,
      alphaTarget: 0,
      run: false,
      forceNode: { id: "1. Projects/_index.md", x: 12, y: 24 }
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      alpha: 0.3,
      alphaTarget: 0,
      run: true,
      forceNode: { id: "1. Projects/_index.md", x: null, y: null }
    });
  });

  it("restores every structured anchor after native graph updates settle", () => {
    const fixture = graphFixture({ postMessage: vi.fn() });
    const result = CoreGraphBridge.connect(fixture.view);
    if (!result.ok) throw new Error(result.reason);
    result.bridge.applyStructuredLayout(MODEL);
    Object.assign(fixture.node, { x: 900, y: -400, fx: null, fy: null });

    expect(result.bridge.stabilizeStructuredAnchors(MODEL)).toBe(1);
    expect(fixture.node).toMatchObject({ x: 120, y: 240, fx: 120, fy: 240 });
    expect(fixture.renderer.changed).toHaveBeenCalled();
  });

  it("dims the native graph only while chronological growth is rendered and restores its styles", () => {
    const fixture = graphFixture({ postMessage: vi.fn() });
    const result = CoreGraphBridge.connect(fixture.view);
    if (!result.ok) throw new Error(result.reason);

    result.bridge.setNativeGraphDimmed(true);
    expect(fixture.renderer.interactiveEl.style).toMatchObject({ opacity: "0.22", transition: "opacity 180ms ease" });
    result.bridge.setNativeGraphDimmed(false);
    expect(fixture.renderer.interactiveEl.style).toMatchObject({ opacity: "", transition: "" });
  });

  it("adds configured vault exclusions to the dedicated core graph search", () => {
    const fixture = graphFixture({ postMessage: vi.fn() });
    const setOptions = vi.fn();
    Object.assign(fixture.view, {
      dataEngine: {
        getOptions: () => ({ search: "tag:#keep", showTags: true, showOrphans: true }),
        setOptions
      }
    });
    const result = CoreGraphBridge.connect(fixture.view);
    if (!result.ok) throw new Error(result.reason);

    result.bridge.applyCuratedScope(["Private/secret.md", "Journal/"]);

    expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({
      search: 'tag:#keep -path:"Private/secret.md" -path:"Journal/"',
      showTags: false,
      showOrphans: false
    }));
  });

  it("fails closed when an excluded node remains after the curated-scope timeout", async () => {
    const fixture = graphFixture({ postMessage: vi.fn() });
    fixture.node.id = "Private/secret.md";
    fixture.renderer.nodeLookup = { [fixture.node.id]: fixture.node };
    const result = CoreGraphBridge.connect(fixture.view);
    if (!result.ok) throw new Error(result.reason);

    await expect(result.bridge.waitForCuratedScope(["Private/secret.md"], 0)).resolves.toEqual({
      ok: false,
      reason: "excluded-paths-remain",
      remainingExclusions: ["Private/secret.md"]
    });
  });

  it("deduplicates concurrent PARA Second Brain opens while scope attachment is pending", async () => {
    const enhancer = new NeuralGraphEnhancer({
      workspace: { getLeavesOfType: () => [] }
    } as never, {
      loadDataset: vi.fn()
    });
    let resolveOpen!: (result: NeuralGraphOpenResult) => void;
    const pending = new Promise<NeuralGraphOpenResult>((resolve) => {
      resolveOpen = resolve;
    });
    const openNewSession = vi
      .spyOn(enhancer as unknown as { openNewSession(): Promise<NeuralGraphOpenResult> }, "openNewSession")
      .mockReturnValue(pending);

    const first = enhancer.open();
    const second = enhancer.open();
    expect(openNewSession).toHaveBeenCalledTimes(1);
    resolveOpen({ matchedNodes: 1, totalNodes: 1, queryTracks: 0, constructionTracks: 0 });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { matchedNodes: 1, totalNodes: 1, queryTracks: 0, constructionTracks: 0 },
      { matchedNodes: 1, totalNodes: 1, queryTracks: 0, constructionTracks: 0 }
    ]);
  });
});
