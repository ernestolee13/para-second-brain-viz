import { describe, expect, it } from "vitest";
import {
  CanvasSceneRenderer,
  UserTriggeredAnimationController,
  type CanvasLike,
  type FrameScheduler
} from "../../src/render/canvas";
import type {
  FlowScene,
  GraphScene,
  MatrixScene,
  MotionContract,
  RadialScene,
  ScatterScene,
  TimelineScene,
  VisualScene
} from "../../src/visualization/types";

describe("CanvasSceneRenderer", () => {
  it("renders deterministic graph geometry, hit ordering, semantics, and HiDPI sizing", () => {
    const canvas = fakeCanvas();
    const renderer = new CanvasSceneRenderer(canvas);
    const scene = graphScene();

    const first = renderer.render(scene, { width: 500, height: 360, dpr: 2 }, { selectedMarkId: "beta" });
    const second = renderer.render(scene, { width: 500, height: 360, dpr: 2 }, { selectedMarkId: "beta" });

    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(720);
    expect(canvas.style).toEqual({ width: "500px", height: "360px" });
    expect(first.hitRegions).toEqual(second.hitRegions);
    expect(first.hitRegions.map((hit) => hit.markId)).toEqual(["alpha", "beta", "gamma"]);
    expect(first.semanticTree.children.map((child) => child.id)).toEqual([
      "graph-1:status",
      "graph:alpha",
      "graph:beta",
      "graph:gamma"
    ]);
    expect(first.semanticTree.children.find((child) => child.id === "graph:beta")?.selected).toBe(true);
    expect(canvas.context.calls).toContain("createLinearGradient");
    expect(canvas.context.calls).toContain("createRadialGradient");
    expect(canvas.context.calls).toContain("quadraticCurveTo");
  });

  it("maps normalized graph coordinates into the stage and clamps visually extreme values", () => {
    const scene = graphScene();
    scene.nodes[1] = { ...scene.nodes[1]!, x: 0.9, y: 0.9, value: 1_000_000 };
    const graphResult = new CanvasSceneRenderer(fakeCanvas()).render(scene, { width: 500, height: 360 });
    const beta = graphResult.hitRegions.find((hit) => hit.markId === "beta");

    expect(beta?.x).toBeGreaterThan(350);
    expect(beta?.y).toBeGreaterThan(250);
    expect(beta?.width).toBeLessThanOrEqual(60);

    const scatter = scatterScene();
    scatter.points[0] = { ...scatter.points[0]!, size: 1_000_000 };
    const scatterResult = new CanvasSceneRenderer(fakeCanvas()).render(scatter, { width: 500, height: 360 });
    expect(scatterResult.hitRegions.find((hit) => hit.markId === "q1")?.width).toBeLessThanOrEqual(44);
  });

  it("dispatches every primitive without throwing and returns semantic marks", () => {
    const scenes: VisualScene[] = [
      graphScene(),
      radialScene(),
      flowScene(),
      timelineScene(),
      matrixScene(),
      scatterScene()
    ];

    for (const scene of scenes) {
      const result = new CanvasSceneRenderer(fakeCanvas()).render(scene, { width: 420, height: 320 });
      expect(result.primitive).toBe(scene.primitive);
      expect(result.hitRegions.length).toBeGreaterThan(0);
      expect(result.semanticTree.children.some((child) => child.role === "mark")).toBe(true);
      if (scene.primitive === "radial") {
        expect(result.hitRegions.some((hit) => hit.markId === "orphan")).toBe(true);
      }
      if (scene.primitive === "timeline") {
        expect(result.hitRegions.some((hit) => hit.markId === "burst")).toBe(true);
      }
      if (scene.primitive === "flow") {
        const cache = result.hitRegions.find((hit) => hit.markId === "cache");
        const read = result.hitRegions.find((hit) => hit.markId === "read");
        expect(cache?.x).toBe(read?.x);
        expect(cache?.y).not.toBe(read?.y);
      }
    }
  });

  it("renders unavailable scenes as disabled semantic status with no fake marks", () => {
    const result = new CanvasSceneRenderer(fakeCanvas()).render(
      { ...graphScene(), status: "unavailable", missingCapabilities: ["query-paths"], nodes: [], edges: [] },
      { width: 300, height: 220 }
    );

    expect(result.status).toBe("unavailable");
    expect(result.hitRegions).toEqual([]);
    expect(result.semanticTree.disabled).toBe(true);
    expect(result.semanticTree.children[0]).toEqual(
      expect.objectContaining({ role: "status", label: "unavailable", value: "query-paths", disabled: true })
    );
  });
});

describe("UserTriggeredAnimationController", () => {
  it("does not schedule frames before explicit play and completes after scheduled frames", () => {
    const scheduler = fakeScheduler();
    const frames: number[] = [];
    let completed = false;
    const controller = new UserTriggeredAnimationController(scheduler);

    expect(scheduler.scheduledCount()).toBe(0);
    expect(controller.state).toBe("idle");

    expect(
      controller.play({
        motion: motion(),
        width: 300,
        height: 200,
        onFrame: (frame) => frames.push(frame.progress),
        onComplete: () => {
          completed = true;
        }
      })
    ).toBe("running");
    expect(scheduler.scheduledCount()).toBe(1);

    scheduler.tick(50);
    scheduler.tick(100);

    expect(frames).toEqual([0.5, 1]);
    expect(controller.state).toBe("completed");
    expect(completed).toBe(true);
  });

  it("pauses when hidden or zero-sized and resumes when visible", () => {
    const scheduler = fakeScheduler();
    const controller = new UserTriggeredAnimationController(scheduler);
    const frames: number[] = [];

    controller.play({ motion: motion(), width: 300, height: 200, onFrame: (frame) => frames.push(frame.progress) });
    expect(controller.setVisibility(true, 300, 200)).toBe("paused");
    expect(scheduler.scheduledCount()).toBe(0);
    scheduler.tick(80);
    expect(frames).toEqual([]);

    expect(controller.setVisibility(false, 300, 200)).toBe("running");
    scheduler.tick(180);
    expect(frames).toEqual([1]);

    controller.play({ motion: motion(), width: 0, height: 200, onFrame: (frame) => frames.push(frame.progress) });
    expect(controller.state).toBe("paused");
    expect(scheduler.scheduledCount()).toBe(0);
  });

  it("supports cancel, seek, step, and reduced-motion snapping", () => {
    const scheduler = fakeScheduler();
    const controller = new UserTriggeredAnimationController(scheduler);
    const frames: number[] = [];

    controller.play({ motion: motion(), width: 300, height: 200, onFrame: (frame) => frames.push(frame.progress) });
    expect(controller.cancel()).toBe("cancelled");
    expect(scheduler.scheduledCount()).toBe(0);

    controller.play({ motion: motion(), width: 300, height: 200, onFrame: (frame) => frames.push(frame.progress) });
    controller.step(0.25);
    expect(controller.state).toBe("paused");
    expect(scheduler.scheduledCount()).toBe(0);
    expect(controller.setVisibility(false, 300, 200)).toBe("paused");
    expect(scheduler.scheduledCount()).toBe(0);
    controller.seek(0.75);
    expect(frames.slice(-2)).toEqual([0.25, 0.75]);

    controller.play({
      motion: motion(),
      reducedMotion: true,
      width: 300,
      height: 200,
      onFrame: (frame) => frames.push(frame.progress)
    });
    expect(controller.state).toBe("completed");
    expect(frames.at(-1)).toBe(1);
    expect(scheduler.scheduledCount()).toBe(0);
  });
});

function fakeCanvas(): CanvasLike & { context: FakeCanvasContext } {
  const context = new FakeCanvasContext();
  return {
    width: 0,
    height: 0,
    style: {},
    context,
    getContext: () => context as unknown as CanvasRenderingContext2D
  };
}

class FakeCanvasContext {
  fillStyle = "";
  strokeStyle = "";
  shadowColor = "";
  font = "";
  lineWidth = 1;
  shadowBlur = 0;
  lineDashOffset = 0;
  lineCap = "butt";
  lineJoin = "miter";
  globalAlpha = 1;
  readonly calls: string[] = [];

  save(): void {
    this.calls.push("save");
  }
  restore(): void {
    this.calls.push("restore");
  }
  setTransform(): void {
    this.calls.push("setTransform");
  }
  clearRect(): void {
    this.calls.push("clearRect");
  }
  fillRect(): void {
    this.calls.push("fillRect");
  }
  strokeRect(): void {
    this.calls.push("strokeRect");
  }
  fillText(): void {
    this.calls.push("fillText");
  }
  createLinearGradient(): CanvasGradient {
    this.calls.push("createLinearGradient");
    return new FakeCanvasGradient() as unknown as CanvasGradient;
  }
  createRadialGradient(): CanvasGradient {
    this.calls.push("createRadialGradient");
    return new FakeCanvasGradient() as unknown as CanvasGradient;
  }
  setLineDash(): void {
    this.calls.push("setLineDash");
  }
  beginPath(): void {
    this.calls.push("beginPath");
  }
  moveTo(): void {
    this.calls.push("moveTo");
  }
  lineTo(): void {
    this.calls.push("lineTo");
  }
  quadraticCurveTo(): void {
    this.calls.push("quadraticCurveTo");
  }
  stroke(): void {
    this.calls.push("stroke");
  }
  arc(): void {
    this.calls.push("arc");
  }
  closePath(): void {
    this.calls.push("closePath");
  }
  fill(): void {
    this.calls.push("fill");
  }
}

class FakeCanvasGradient {
  addColorStop(): void {}
}

function fakeScheduler(): FrameScheduler & { tick(time: number): void; scheduledCount(): number } {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map<number, (time: number) => void>();
  return {
    now: () => now,
    request: (callback) => {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
    tick: (time) => {
      now = time;
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of entries) {
        callback(time);
      }
    },
    scheduledCount: () => callbacks.size
  };
}

function baseScene(primitive: VisualScene["primitive"]) {
  return {
    id: `${primitive}-1`,
    lensId: "test-lens",
    primitive,
    status: "ready" as const,
    title: `${primitive} scene`,
    question: "What is visible?",
    summary: "A deterministic test scene",
    confidence: "measured" as const,
    missingCapabilities: [],
    metrics: [],
    legend: [],
    inspector: {
      heading: "Inspector",
      summary: "Details",
      metrics: [],
      evidence: [],
      actions: []
    },
    motion: motion()
  };
}

function graphScene(): GraphScene {
  return {
    ...baseScene("graph"),
    primitive: "graph",
    nodes: [
      { id: "alpha", label: "Alpha", group: "common", role: "index", value: 10, confidence: "measured" },
      { id: "beta", label: "Beta", group: "projects", role: "note", value: 4, confidence: "inferred" },
      { id: "gamma", label: "Gamma", group: "archive", role: "note", value: 1, confidence: "unavailable" }
    ],
    edges: [
      { id: "a-b", source: "alpha", target: "beta", value: 2, confidence: "measured" },
      { id: "b-g", source: "beta", target: "gamma", value: 1, confidence: "inferred" }
    ]
  };
}

function radialScene(): RadialScene {
  return {
    ...baseScene("radial"),
    primitive: "radial",
    segments: [
      { id: "common", label: "Common", group: "common", value: 20, confidence: "measured" },
      { id: "projects", label: "Projects", group: "projects", value: 12, confidence: "inferred" }
    ],
    satellites: [
      { id: "orphan", label: "Uncovered note", group: "resources", role: "note", value: 2, confidence: "inferred" }
    ],
    rings: [{ id: "ring", label: "Activity", value: 10, confidence: "measured" }]
  };
}

function flowScene(): FlowScene {
  return {
    ...baseScene("flow"),
    primitive: "flow",
    stages: [
      { id: "prompt", label: "Prompt", order: 0, value: 1, confidence: "measured" },
      { id: "cache", label: "Cache", order: 1, value: 2, confidence: "inferred" },
      { id: "read", label: "Read", order: 1, value: 4, confidence: "measured" }
    ],
    connections: [
      { id: "prompt-cache", source: "prompt", target: "cache", value: 1, confidence: "inferred" },
      { id: "prompt-read", source: "prompt", target: "read", value: 2, confidence: "measured" }
    ]
  };
}

function timelineScene(): TimelineScene {
  return {
    ...baseScene("timeline"),
    primitive: "timeline",
    series: [
      {
        id: "vault",
        label: "Vault",
        colorKey: "projects",
        points: [
          { id: "t1", time: "2026-08-01T00:00:00.000Z", value: 1, confidence: "measured" },
          { id: "t2", time: "2026-08-02T00:00:00.000Z", value: 3, confidence: "measured" }
        ]
      }
    ],
    bands: [
      {
        id: "burst",
        label: "Activity burst",
        from: "2026-08-01T06:00:00.000Z",
        to: "2026-08-01T18:00:00.000Z",
        value: 2,
        colorKey: "projects"
      }
    ]
  };
}

function matrixScene(): MatrixScene {
  return {
    ...baseScene("matrix"),
    primitive: "matrix",
    rows: [
      { id: "projects", label: "Projects" },
      { id: "areas", label: "Areas" }
    ],
    columns: [
      { id: "common", label: "Common" },
      { id: "resources", label: "Resources" }
    ],
    cells: [
      { id: "p-c", row: "projects", column: "common", value: 3, confidence: "measured" },
      { id: "a-r", row: "areas", column: "resources", value: null, confidence: "unavailable" }
    ]
  };
}

function scatterScene(): ScatterScene {
  return {
    ...baseScene("scatter"),
    primitive: "scatter",
    xLabel: "Latency",
    yLabel: "Documents",
    points: [
      { id: "q1", label: "Q1", x: 20, y: 4, size: 120, group: "query", confidence: "measured" },
      { id: "q2", label: "Q2", x: 50, y: 2, size: 80, group: "query", confidence: "inferred" }
    ],
    frontier: [
      { x: 10, y: 1 },
      { x: 60, y: 5 }
    ]
  };
}

function motion(): MotionContract {
  return {
    trigger: "replay",
    durationMs: 100,
    userTriggered: true,
    keyframes: [{ at: 0.5, markIds: ["alpha"], effect: "pulse" }]
  };
}
