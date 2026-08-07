import type {
  FlowScene,
  GraphScene,
  MatrixScene,
  MotionContract,
  MotionKeyframe,
  RadialScene,
  ScatterScene,
  SceneStatus,
  TimelineScene,
  VisualScene
} from "../visualization/types";
import type { Confidence } from "../model";

export interface CanvasLike {
  width: number;
  height: number;
  style?: { width?: string; height?: string };
  getContext(type: "2d"): CanvasRenderingContext2D | null;
}

export interface RenderSize {
  width: number;
  height: number;
  dpr?: number;
}

export interface RenderState {
  selectedMarkId?: string | null;
  focusedMarkId?: string | null;
  playbackProgress?: number;
}

export interface HitRegion {
  id: string;
  markId: string;
  label: string;
  primitive: VisualScene["primitive"];
  x: number;
  y: number;
  width: number;
  height: number;
  order: number;
  confidence: Confidence;
}

export interface SemanticNode {
  id: string;
  role: "scene" | "group" | "mark" | "status";
  label: string;
  value?: string;
  selected: boolean;
  disabled: boolean;
  children: SemanticNode[];
}

export interface RenderResult {
  sceneId: string;
  primitive: VisualScene["primitive"];
  status: SceneStatus;
  hitRegions: HitRegion[];
  semanticTree: SemanticNode;
}

export interface ThemeTokens {
  background: string;
  backgroundElevated: string;
  backgroundDeep: string;
  text: string;
  mutedText: string;
  grid: string;
  gridStrong: string;
  focus: string;
  selection: string;
  unavailable: string;
  measured: string;
  inferred: string;
  palette: Record<string, string>;
}

export const DEFAULT_THEME: ThemeTokens = {
  background: "#0b101c",
  backgroundElevated: "#121b2b",
  backgroundDeep: "#05070d",
  text: "#eef6ff",
  mutedText: "#91a4ba",
  grid: "rgba(151, 181, 217, 0.09)",
  gridStrong: "rgba(151, 181, 217, 0.16)",
  focus: "#ffc968",
  selection: "#8cb7ff",
  unavailable: "#56657a",
  measured: "#49dfbd",
  inferred: "#e9b968",
  palette: {
    common: "#8c79ff",
    "para-common": "#8c79ff",
    projects: "#ff765f",
    "para-projects": "#ff765f",
    areas: "#55b9ff",
    "para-areas": "#55b9ff",
    resources: "#45dfb1",
    "para-resources": "#45dfb1",
    archive: "#8290a7",
    "para-archive": "#8290a7",
    "para-inbox": "#ffb75d",
    "para-unknown": "#7c899d",
    query: "#ffc45f",
    tool: "#86a2bf",
    source: "#7f93ad",
    sequence: "#9cd8ff",
    focus: "#ffc968",
    link: "#67c9d4",
    added: "#4fe39a",
    removed: "#ff6475"
  }
};

export class CanvasSceneRenderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: CanvasLike,
    private readonly theme: ThemeTokens = DEFAULT_THEME
  ) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("CanvasSceneRenderer requires a 2d canvas context");
    }
    this.context = context;
  }

  render(scene: VisualScene, size: RenderSize, state: RenderState = {}): RenderResult {
    const width = Math.max(0, size.width);
    const height = Math.max(0, size.height);
    const dpr = Math.max(1, size.dpr ?? 1);
    resizeCanvas(this.canvas, width, height, dpr);

    const ctx = this.context;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawStageBackground(ctx, width, height, this.theme);

    const hitRegions: HitRegion[] = [];
    drawSceneHeader(ctx, scene, width, this.theme);

    if (scene.status === "unavailable" || width === 0 || height === 0) {
      drawUnavailable(ctx, scene, width, height, this.theme);
    } else {
      switch (scene.primitive) {
        case "graph":
          drawGraph(ctx, scene, width, height, state, this.theme, hitRegions);
          break;
        case "radial":
          drawRadial(ctx, scene, width, height, state, this.theme, hitRegions);
          break;
        case "flow":
          drawFlow(ctx, scene, width, height, state, this.theme, hitRegions);
          break;
        case "timeline":
          drawTimeline(ctx, scene, width, height, state, this.theme, hitRegions);
          break;
        case "matrix":
          drawMatrix(ctx, scene, width, height, state, this.theme, hitRegions);
          break;
        case "scatter":
          drawScatter(ctx, scene, width, height, state, this.theme, hitRegions);
          break;
      }
      if (scene.status === "partial") {
        drawStatusPill(ctx, "partial data", width - 108, 18, this.theme.inferred, this.theme);
      }
    }

    ctx.restore();
    hitRegions.sort((a, b) => a.order - b.order || a.markId.localeCompare(b.markId));
    return {
      sceneId: scene.id,
      primitive: scene.primitive,
      status: scene.status,
      hitRegions,
      semanticTree: buildSemanticTree(scene, hitRegions, state)
    };
  }
}

export interface FrameScheduler {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

export interface AnimationFrameState {
  progress: number;
  activeKeyframes: MotionKeyframe[];
  trigger: MotionContract["trigger"];
}

export interface PlayOptions {
  motion: MotionContract;
  reducedMotion?: boolean;
  hidden?: boolean;
  width: number;
  height: number;
  onFrame: (state: AnimationFrameState) => void;
  onComplete?: () => void;
}

export type AnimationState = "idle" | "running" | "paused" | "completed" | "cancelled";

export class UserTriggeredAnimationController {
  private stateValue: AnimationState = "idle";
  private frameId: number | null = null;
  private startTime = 0;
  private elapsedBeforePause = 0;
  private options: PlayOptions | null = null;
  private pausedByVisibility = false;

  constructor(private readonly scheduler: FrameScheduler = browserFrameScheduler()) {}

  get state(): AnimationState {
    return this.stateValue;
  }

  play(options: PlayOptions): AnimationState {
    this.cancelScheduledFrame();
    this.options = options;
    this.elapsedBeforePause = 0;
    this.pausedByVisibility = false;

    if (options.motion.trigger === "none" || options.motion.durationMs <= 0) {
      this.emit(1);
      this.stateValue = "completed";
      options.onComplete?.();
      return this.stateValue;
    }

    if (options.reducedMotion) {
      this.emit(1);
      this.stateValue = "completed";
      options.onComplete?.();
      return this.stateValue;
    }

    if (options.hidden || options.width <= 0 || options.height <= 0) {
      this.stateValue = "paused";
      this.pausedByVisibility = true;
      return this.stateValue;
    }

    this.stateValue = "running";
    this.startTime = this.scheduler.now();
    this.schedule();
    return this.stateValue;
  }

  pause(): AnimationState {
    this.pausedByVisibility = false;
    return this.pauseInternal();
  }

  private pauseInternal(pausedByVisibility = false): AnimationState {
    if (this.stateValue !== "running") {
      return this.stateValue;
    }
    this.elapsedBeforePause += Math.max(0, this.scheduler.now() - this.startTime);
    this.cancelScheduledFrame();
    this.stateValue = "paused";
    this.pausedByVisibility = pausedByVisibility;
    return this.stateValue;
  }

  resume(): AnimationState {
    const options = this.options;
    if (!options || this.stateValue !== "paused" || options.hidden || options.width <= 0 || options.height <= 0) {
      return this.stateValue;
    }
    this.pausedByVisibility = false;
    this.stateValue = "running";
    this.startTime = this.scheduler.now();
    this.schedule();
    return this.stateValue;
  }

  step(deltaProgress: number): AnimationState {
    const options = this.options;
    if (!options) {
      return this.stateValue;
    }
    if (this.stateValue === "running") {
      this.pause();
    }
    const duration = Math.max(1, options.motion.durationMs);
    const currentProgress = this.elapsedBeforePause / duration;
    const nextProgress = clamp(currentProgress + deltaProgress, 0, 1);
    this.elapsedBeforePause = nextProgress * duration;
    this.emit(nextProgress);
    if (nextProgress >= 1) {
      this.complete();
    }
    return this.stateValue;
  }

  seek(progress: number): AnimationState {
    const options = this.options;
    if (!options) {
      return this.stateValue;
    }
    if (this.stateValue === "running") {
      this.pause();
    }
    const nextProgress = clamp(progress, 0, 1);
    this.elapsedBeforePause = nextProgress * Math.max(1, options.motion.durationMs);
    this.emit(nextProgress);
    if (nextProgress >= 1) {
      this.complete();
    }
    return this.stateValue;
  }

  setVisibility(hidden: boolean, width: number, height: number): AnimationState {
    const options = this.options;
    if (!options) {
      return this.stateValue;
    }
    this.options = { ...options, hidden, width, height };
    if (hidden || width <= 0 || height <= 0) {
      return this.stateValue === "running" ? this.pauseInternal(true) : this.stateValue;
    }
    if (this.stateValue === "paused" && this.pausedByVisibility) {
      return this.resume();
    }
    return this.stateValue;
  }

  cancel(): AnimationState {
    this.cancelScheduledFrame();
    this.options = null;
    this.elapsedBeforePause = 0;
    this.pausedByVisibility = false;
    this.stateValue = "cancelled";
    return this.stateValue;
  }

  private schedule(): void {
    this.frameId = this.scheduler.request((time) => this.onFrame(time));
  }

  private onFrame(time: number): void {
    if (this.stateValue !== "running" || !this.options) {
      return;
    }
    const elapsed = this.elapsedBeforePause + Math.max(0, time - this.startTime);
    const progress = clamp(elapsed / Math.max(1, this.options.motion.durationMs), 0, 1);
    this.emit(progress);
    if (progress >= 1) {
      this.complete();
      return;
    }
    this.schedule();
  }

  private emit(progress: number): void {
    const options = this.options;
    if (!options) {
      return;
    }
    options.onFrame({
      progress,
      activeKeyframes: options.motion.keyframes.filter((keyframe) => keyframe.at <= progress),
      trigger: options.motion.trigger
    });
  }

  private complete(): void {
    const options = this.options;
    this.cancelScheduledFrame();
    this.stateValue = "completed";
    this.pausedByVisibility = false;
    options?.onComplete?.();
  }

  private cancelScheduledFrame(): void {
    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
  }
}

function resizeCanvas(canvas: CanvasLike, width: number, height: number, dpr: number): void {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  if (canvas.style) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
}

function drawStageBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: ThemeTokens
): void {
  const field = ctx.createLinearGradient(0, 0, width, height);
  field.addColorStop(0, theme.backgroundDeep);
  field.addColorStop(0.48, theme.background);
  field.addColorStop(1, theme.backgroundElevated);
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, width, height);

  const activation = ctx.createRadialGradient(
    width * 0.58,
    height * 0.52,
    0,
    width * 0.58,
    height * 0.52,
    Math.max(width, height) * 0.62
  );
  activation.addColorStop(0, "rgba(83, 126, 201, 0.16)");
  activation.addColorStop(0.35, "rgba(84, 69, 161, 0.07)");
  activation.addColorStop(1, "rgba(3, 5, 10, 0)");
  ctx.fillStyle = activation;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.fillStyle = theme.grid;
  for (let x = 18; x < width; x += 28) {
    for (let y = 70; y < height; y += 28) {
      const major = ((x - 18) / 28 + (y - 70) / 28) % 4 === 0;
      ctx.globalAlpha = major ? 0.9 : 0.48;
      ctx.beginPath();
      ctx.arc(x, y, major ? 1.05 : 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  const centerX = width * 0.56;
  const centerY = height * 0.55;
  for (const radius of [0.18, 0.34, 0.5]) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.min(width, height) * radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.52,
    Math.min(width, height) * 0.22,
    width * 0.5,
    height * 0.52,
    Math.max(width, height) * 0.74
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.68, "rgba(0, 0, 0, 0.08)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function drawSceneHeader(
  ctx: CanvasRenderingContext2D,
  scene: VisualScene,
  width: number,
  theme: ThemeTokens
): void {
  const eyebrow = `${scene.lensId}  /  ${scene.primitive.toUpperCase()}  /  ${scene.confidence.toUpperCase()}`;
  ctx.fillStyle = colorWithAlpha(theme.selection, 0.9);
  ctx.font = "600 9px system-ui, sans-serif";
  ctx.fillText(eyebrow, 20, 18, Math.max(20, width - 40));
  ctx.fillStyle = theme.text;
  ctx.font = "650 17px system-ui, sans-serif";
  ctx.shadowColor = "rgba(106, 170, 255, 0.28)";
  ctx.shadowBlur = 12;
  ctx.fillText(scene.title, 20, 39, Math.max(20, width - 40));
  ctx.shadowBlur = 0;
  ctx.fillStyle = theme.mutedText;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(scene.summary, 20, 56, Math.max(20, width - 40));

  const line = ctx.createLinearGradient(20, 0, width - 20, 0);
  line.addColorStop(0, colorWithAlpha(theme.selection, 0.52));
  line.addColorStop(0.45, colorWithAlpha(theme.selection, 0.1));
  line.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = line;
  ctx.fillRect(20, 66, Math.max(0, width - 40), 1);
}

function drawUnavailable(
  ctx: CanvasRenderingContext2D,
  scene: VisualScene,
  width: number,
  height: number,
  theme: ThemeTokens
): void {
  const boxWidth = Math.max(140, Math.min(width - 36, 420));
  const boxHeight = 72;
  const x = (width - boxWidth) / 2;
  const y = Math.max(70, (height - boxHeight) / 2);
  ctx.strokeStyle = theme.unavailable;
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(x, y, boxWidth, boxHeight);
  ctx.setLineDash([]);
  ctx.fillStyle = theme.mutedText;
  ctx.font = "13px system-ui, sans-serif";
  const missing = scene.missingCapabilities.length > 0 ? scene.missingCapabilities.join(", ") : "no drawable data";
  ctx.fillText(missing, x + 14, y + 41, boxWidth - 28);
}

function drawStatusPill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  color: string,
  theme: ThemeTokens
): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 90, 22);
  ctx.fillStyle = theme.background;
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText(label, x + 10, y + 15, 72);
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  width: number,
  height: number,
  state: RenderState,
  theme: ThemeTokens,
  hitRegions: HitRegion[]
): void {
  const positions = new Map<string, { x: number; y: number }>();
  const centerX = width / 2;
  const centerY = Math.max(98, height / 2 + 18);
  const radius = Math.max(42, Math.min(width * 0.42, (height - 86) * 0.42));
  scene.nodes.forEach((node, index) => {
    const angle = hashUnit(node.id) * Math.PI * 2;
    const distance = radius * (0.35 + hashUnit(`${node.id}:r`) * 0.65);
    positions.set(node.id, {
      x: node.x === undefined ? centerX + Math.cos(angle) * distance : sceneCoordinate(node.x, 46, width - 46),
      y: node.y === undefined ? centerY + Math.sin(angle) * distance : sceneCoordinate(node.y, 88, height - 42)
    });
    if (index === 0 && node.x === undefined && node.y === undefined) {
      positions.set(node.id, { x: centerX, y: centerY });
    }
  });

  const orderedEdgeMaximum = Math.max(-1, ...scene.edges.map((edge) => edge.order ?? -1));
  scene.edges.forEach((edge, edgeIndex) => {
    const reveal = edgeRevealProgress(
      state.playbackProgress,
      edge.order ?? edgeIndex,
      orderedEdgeMaximum >= 0 ? orderedEdgeMaximum + 1 : scene.edges.length
    );
    if (reveal <= 0) {
      return;
    }
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      return;
    }
    const stateColorKey = edge.state === "added" || edge.state === "removed" || edge.state === "focus"
      ? edge.state
      : "link";
    const color = colorFor(edge.colorKey ?? stateColorKey, edge.confidence, theme);
    const emphasized = state.selectedMarkId === edge.source || state.selectedMarkId === edge.target;
    const dimmed = Boolean(state.selectedMarkId) && !emphasized;
    drawCurvedSignal(ctx, source, target, edge.id, color, edge.value, edge.confidence, reveal, emphasized, edge.directed ?? false, dimmed);
  });
  ctx.setLineDash([]);

  const labelIds = new Set(
    [...scene.nodes]
      .sort((a, b) => Number(b.role === "index") - Number(a.role === "index") || b.value - a.value || a.id.localeCompare(b.id))
      .slice(0, Math.min(8, scene.nodes.length))
      .map((node) => node.id)
  );

  scene.nodes.forEach((node, index) => {
    const point = positions.get(node.id);
    if (!point) {
      return;
    }
    const baseSize = 5.5 + Math.log1p(Math.max(0, node.value)) * 2.8;
    const size = node.role === "index" ? clamp(baseSize + 4.5, 12, 28) : clamp(baseSize, 6, 19);
    drawFocusRing(ctx, point.x, point.y, size + 5, state, node.id, theme);
    drawGraphNode(ctx, node.role, point.x, point.y, size, colorFor(node.colorKey ?? node.group, node.confidence, theme), node.confidence, theme);
    const hitRadius = node.role === "index" ? size * 1.65 : size * 1.2;
    const hitWidth = node.role === "tool" ? hitRadius * 2.25 : hitRadius * 2;
    addHit(hitRegions, scene.primitive, node.id, node.label, point.x - hitWidth / 2, point.y - hitRadius, hitWidth, hitRadius * 2, index, node.confidence);
  });

  scene.nodes.forEach((node) => {
    if (!labelIds.has(node.id) && state.selectedMarkId !== node.id && state.focusedMarkId !== node.id) {
      return;
    }
    const point = positions.get(node.id);
    if (!point) return;
    const baseSize = 5.5 + Math.log1p(Math.max(0, node.value)) * 2.8;
    const size = node.role === "index" ? clamp(baseSize + 4.5, 12, 28) : clamp(baseSize, 6, 19);
    drawMarkLabel(ctx, node.label, point.x, point.y, size, colorFor(node.colorKey ?? node.group, node.confidence, theme), width, height, theme);
  });
}

function edgeRevealProgress(progress: number | undefined, order: number, count: number): number {
  if (progress === undefined) return 1;
  const normalized = clamp(progress, 0, 1);
  const safeCount = Math.max(1, count);
  const start = (order / safeCount) * 0.82;
  const duration = Math.min(0.28, Math.max(0.08, 1.2 / safeCount));
  return clamp((normalized - start) / duration, 0, 1);
}

function drawCurvedSignal(
  ctx: CanvasRenderingContext2D,
  source: { x: number; y: number },
  target: { x: number; y: number },
  id: string,
  color: string,
  value: number,
  confidence: Confidence,
  reveal: number,
  emphasized: boolean,
  directed: boolean,
  dimmed = false
): void {
  const control = curveControl(source, target, id);
  const width = clamp(0.75 + Math.log1p(Math.max(0, value)) * 0.78, 0.9, 5.5);
  const dash = confidence === "inferred" ? [6, 6] : confidence === "unavailable" ? [2, 7] : [];
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(dash);
  ctx.globalAlpha = dimmed ? 0.12 : 0.16 + reveal * (emphasized ? 0.84 : 0.4);
  ctx.strokeStyle = colorWithAlpha(color, emphasized ? 0.7 : 0.34);
  ctx.shadowColor = color;
  ctx.shadowBlur = emphasized ? 18 : 10;
  ctx.lineWidth = width + (emphasized ? 4 : 2.5);
  traceQuadratic(ctx, source, control, target);
  ctx.stroke();

  const gradient = ctx.createLinearGradient(source.x, source.y, target.x, target.y);
  gradient.addColorStop(0, colorWithAlpha(color, emphasized ? 0.95 : 0.66));
  gradient.addColorStop(0.62, colorWithAlpha(color, emphasized ? 0.84 : 0.48));
  gradient.addColorStop(1, colorWithAlpha(color, 0.16));
  ctx.globalAlpha = dimmed ? 0.17 : emphasized ? 0.72 + reveal * 0.28 : 0.46 + reveal * 0.36;
  ctx.strokeStyle = gradient;
  ctx.shadowBlur = 0;
  ctx.lineWidth = width;
  traceQuadratic(ctx, source, control, target);
  ctx.stroke();

  if (reveal < 1) {
    const bead = quadraticPoint(source, control, target, reveal);
    const aura = ctx.createRadialGradient(bead.x, bead.y, 0, bead.x, bead.y, emphasized ? 13 : 9);
    aura.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    aura.addColorStop(0.24, colorWithAlpha(color, 0.95));
    aura.addColorStop(1, colorWithAlpha(color, 0));
    ctx.globalAlpha = 1;
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(bead.x, bead.y, emphasized ? 13 : 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (directed) {
    drawSignalArrow(ctx, quadraticPoint(source, control, target, 0.86), quadraticPoint(source, control, target, 0.84), color, width);
  }
  ctx.restore();
}

function curveControl(
  source: { x: number; y: number },
  target: { x: number; y: number },
  id: string
): { x: number; y: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const direction = hashUnit(`${id}:curve`) > 0.5 ? 1 : -1;
  const bend = Math.min(58, distance * (0.09 + hashUnit(`${id}:bend`) * 0.11)) * direction;
  return {
    x: (source.x + target.x) / 2 - (dy / distance) * bend,
    y: (source.y + target.y) / 2 + (dx / distance) * bend
  };
}

function traceQuadratic(
  ctx: CanvasRenderingContext2D,
  source: { x: number; y: number },
  control: { x: number; y: number },
  target: { x: number; y: number }
): void {
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  ctx.quadraticCurveTo(control.x, control.y, target.x, target.y);
}

function quadraticPoint(
  source: { x: number; y: number },
  control: { x: number; y: number },
  target: { x: number; y: number },
  progress: number
): { x: number; y: number } {
  const t = clamp(progress, 0, 1);
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * source.x + 2 * oneMinusT * t * control.x + t * t * target.x,
    y: oneMinusT * oneMinusT * source.y + 2 * oneMinusT * t * control.y + t * t * target.y
  };
}

function drawSignalArrow(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  previous: { x: number; y: number },
  color: string,
  width: number
): void {
  const angle = Math.atan2(point.y - previous.y, point.x - previous.x);
  const size = clamp(3 + width, 4, 8);
  ctx.fillStyle = colorWithAlpha(color, 0.72);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x - Math.cos(angle - 0.52) * size, point.y - Math.sin(angle - 0.52) * size);
  ctx.lineTo(point.x - Math.cos(angle + 0.52) * size, point.y - Math.sin(angle + 0.52) * size);
  ctx.closePath();
  ctx.fill();
}

function drawRadial(
  ctx: CanvasRenderingContext2D,
  scene: RadialScene,
  width: number,
  height: number,
  state: RenderState,
  theme: ThemeTokens,
  hitRegions: HitRegion[]
): void {
  const centerX = width / 2;
  const centerY = height / 2 + 24;
  const radius = Math.max(44, Math.min(width, height - 70) * 0.28);
  const innerRadius = radius * 0.43;
  const total = scene.segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0) || 1;
  let angle = -Math.PI / 2;
  scene.rings.forEach((ring, index) => {
    const ringColor = colorFor("link", ring.confidence, theme);
    ctx.save();
    ctx.strokeStyle = colorWithAlpha(ringColor, 0.22 + index * 0.04);
    ctx.lineWidth = index === scene.rings.length - 1 ? 1.5 : 1;
    ctx.setLineDash(index % 2 === 0 ? [] : [3, 7]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 18 + index * 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });
  scene.segments.forEach((segment, index) => {
    const span = (Math.max(0, segment.value) / total) * Math.PI * 2;
    const color = colorFor(segment.colorKey ?? segment.group, segment.confidence, theme);
    const segmentGradient = ctx.createRadialGradient(centerX, centerY, innerRadius, centerX, centerY, radius);
    segmentGradient.addColorStop(0, colorWithAlpha(color, 0.42));
    segmentGradient.addColorStop(0.72, colorWithAlpha(color, 0.9));
    segmentGradient.addColorStop(1, colorWithAlpha(color, 0.58));
    ctx.save();
    ctx.fillStyle = segmentGradient;
    ctx.strokeStyle = colorWithAlpha(color, 0.92);
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, angle + 0.012, angle + span - 0.012);
    ctx.arc(centerX, centerY, innerRadius, angle + span - 0.012, angle + 0.012, true);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    const mid = angle + span / 2;
    const x = centerX + Math.cos(mid) * radius * 0.72;
    const y = centerY + Math.sin(mid) * radius * 0.72;
    if (span >= 0.22) {
      ctx.fillStyle = theme.text;
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 5;
      ctx.fillText(segment.label, x - 26, y + 3, 52);
      ctx.shadowBlur = 0;
    }
    drawFocusRing(ctx, x, y, 12, state, segment.id, theme);
    addHit(hitRegions, scene.primitive, segment.id, segment.label, x - 12, y - 12, 24, 24, index, segment.confidence);
    angle += span;
  });

  const core = ctx.createRadialGradient(centerX - 8, centerY - 10, 0, centerX, centerY, innerRadius);
  core.addColorStop(0, "rgba(255, 255, 255, 0.18)");
  core.addColorStop(0.34, "rgba(98, 128, 189, 0.14)");
  core.addColorStop(1, "rgba(5, 9, 16, 0.94)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.text;
  ctx.font = "650 12px system-ui, sans-serif";
  ctx.fillText("ACTIVATION", centerX - 38, centerY - 2, 76);
  ctx.fillStyle = theme.mutedText;
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText(`${scene.segments.length} regions`, centerX - 28, centerY + 15, 56);

  scene.satellites.forEach((satellite, index) => {
    const satelliteAngle = hashUnit(satellite.id) * Math.PI * 2;
    const orbit = radius + 28 + hashUnit(`${satellite.id}:orbit`) * Math.max(18, radius * 0.32);
    const x = centerX + Math.cos(satelliteAngle) * orbit;
    const y = centerY + Math.sin(satelliteAngle) * orbit;
    const size = 5 + Math.sqrt(Math.max(0, satellite.value));
    drawFocusRing(ctx, x, y, size + 4, state, satellite.id, theme);
    drawGraphNode(
      ctx,
      satellite.role,
      x,
      y,
      clamp(size, 5, 13),
      colorFor(satellite.colorKey ?? satellite.group, satellite.confidence, theme),
      satellite.confidence,
      theme
    );
    addHit(
      hitRegions,
      scene.primitive,
      satellite.id,
      satellite.label,
      x - size,
      y - size,
      size * 2,
      size * 2,
      scene.segments.length + index,
      satellite.confidence
    );
  });
}

function drawFlow(
  ctx: CanvasRenderingContext2D,
  scene: FlowScene,
  width: number,
  height: number,
  state: RenderState,
  theme: ThemeTokens,
  hitRegions: HitRegion[]
): void {
  const stages = [...scene.stages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const orders = [...new Set(stages.map((stage) => stage.order))].sort((a, b) => a - b);
  const left = 36;
  const top = 76;
  const columnGap = 28;
  const rowGap = 10;
  const stageWidth = Math.max(
    76,
    (width - left * 2 - columnGap * Math.max(0, orders.length - 1)) / Math.max(1, orders.length)
  );
  const centers = new Map<string, { x: number; y: number }>();
  const boxes = new Map<string, { x: number; y: number; width: number; height: number; order: number }>();
  orders.forEach((order, columnIndex) => {
    const columnStages = stages.filter((stage) => stage.order === order);
    const availableHeight = Math.max(32, height - top - 28);
    const rowHeight = clamp(
      (availableHeight - rowGap * Math.max(0, columnStages.length - 1)) / Math.max(1, columnStages.length),
      24,
      46
    );
    const blockHeight = columnStages.length * rowHeight + Math.max(0, columnStages.length - 1) * rowGap;
    const startY = top + Math.max(0, (availableHeight - blockHeight) / 2);
    const laneX = left + columnIndex * (stageWidth + columnGap) - 8;
    ctx.fillStyle = columnIndex % 2 === 0 ? "rgba(117, 158, 214, 0.035)" : "rgba(117, 158, 214, 0.018)";
    roundedRectPath(ctx, laneX, top - 12, stageWidth + 16, availableHeight + 24, 12);
    ctx.fill();
    columnStages.forEach((stage, rowIndex) => {
      const x = left + columnIndex * (stageWidth + columnGap);
      const y = startY + rowIndex * (rowHeight + rowGap);
      centers.set(stage.id, { x: x + stageWidth / 2, y: y + rowHeight / 2 });
      boxes.set(stage.id, { x, y, width: stageWidth, height: rowHeight, order: columnIndex * 1000 + rowIndex });
    });
  });

  const visibleConnections =
    state.playbackProgress === undefined
      ? scene.connections
      : scene.connections.slice(0, Math.ceil(clamp(state.playbackProgress, 0, 1) * scene.connections.length));
  visibleConnections.forEach((connection, index) => {
    const source = centers.get(connection.source);
    const target = centers.get(connection.target);
    if (!source || !target) {
      return;
    }
    const reveal = edgeRevealProgress(state.playbackProgress, index, scene.connections.length);
    drawCurvedSignal(
      ctx,
      source,
      target,
      connection.id,
      colorFor(connection.colorKey ?? "link", connection.confidence, theme),
      Math.max(1, connection.value),
      connection.confidence,
      reveal,
      false,
      true
    );
  });

  for (const stage of stages) {
    const box = boxes.get(stage.id);
    if (!box) {
      continue;
    }
    const color = colorFor(stage.colorKey ?? stage.id, stage.confidence, theme);
    const card = ctx.createLinearGradient(box.x, box.y, box.x + box.width, box.y + box.height);
    card.addColorStop(0, colorWithAlpha(color, 0.72));
    card.addColorStop(0.045, "rgba(17, 27, 43, 0.96)");
    card.addColorStop(1, "rgba(8, 14, 24, 0.94)");
    ctx.save();
    ctx.fillStyle = card;
    ctx.strokeStyle = colorWithAlpha(color, 0.52);
    ctx.shadowColor = colorWithAlpha(color, 0.65);
    ctx.shadowBlur = 10;
    roundedRectPath(ctx, box.x, box.y, box.width, box.height, 8);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
    drawFocusRect(ctx, box.x, box.y, box.width, box.height, state, stage.id, theme);
    ctx.fillStyle = theme.text;
    ctx.font = "550 11px system-ui, sans-serif";
    ctx.fillText(stage.label, box.x + 7, box.y + box.height / 2 + 4, Math.max(10, box.width - 14));
    if (box.width >= 96) {
      ctx.fillStyle = color;
      ctx.font = "650 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(formatCompactValue(stage.value), box.x + box.width - 32, box.y + 14, 25);
    }
    addHit(
      hitRegions,
      scene.primitive,
      stage.id,
      stage.label,
      box.x,
      box.y,
      box.width,
      box.height,
      box.order,
      stage.confidence
    );
  }
}

function drawTimeline(
  ctx: CanvasRenderingContext2D,
  scene: TimelineScene,
  width: number,
  height: number,
  state: RenderState,
  theme: ThemeTokens,
  hitRegions: HitRegion[]
): void {
  const points = scene.series.flatMap((series) => series.points.map((point) => ({ series, point })));
  const bandTimes = scene.bands.flatMap((band) => [Date.parse(band.from), Date.parse(band.to)]);
  const times = [...points.map(({ point }) => Date.parse(point.time)), ...bandTimes].filter(Number.isFinite);
  const values = points.map(({ point }) => point.value);
  const minTime = times.length > 0 ? Math.min(...times) : 0;
  const maxTime = Math.max(...times, minTime + 1);
  const maxValue = Math.max(...values, 1);
  const left = 42;
  const top = 76;
  const chartWidth = Math.max(10, width - 72);
  const chartHeight = Math.max(10, height - 112);
  drawGrid(ctx, left, top, chartWidth, chartHeight, theme);
  scene.bands.forEach((band, index) => {
    const from = Date.parse(band.from);
    const to = Date.parse(band.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      return;
    }
    const x1 = left + ((Math.min(from, to) - minTime) / Math.max(1, maxTime - minTime)) * chartWidth;
    const x2 = left + ((Math.max(from, to) - minTime) / Math.max(1, maxTime - minTime)) * chartWidth;
    const bandWidth = Math.max(3, x2 - x1);
    const bandColor = colorFor(band.colorKey, "inferred", theme);
    const bandGradient = ctx.createLinearGradient(0, top, 0, top + chartHeight);
    bandGradient.addColorStop(0, colorWithAlpha(bandColor, 0.22));
    bandGradient.addColorStop(1, colorWithAlpha(bandColor, 0.035));
    ctx.fillStyle = bandGradient;
    roundedRectPath(ctx, x1, top, bandWidth, chartHeight, Math.min(6, bandWidth / 2));
    ctx.fill();
    addHit(
      hitRegions,
      scene.primitive,
      band.id,
      band.label,
      x1,
      top,
      bandWidth,
      chartHeight,
      index,
      "inferred"
    );
  });
  scene.series.forEach((series, seriesIndex) => {
    const ordered = [...series.points].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const color = colorFor(series.colorKey, "measured", theme);
    const coordinates = ordered.map((point) => ({
      point,
      x: left + ((Date.parse(point.time) - minTime) / Math.max(1, maxTime - minTime)) * chartWidth,
      y: top + chartHeight - (point.value / maxValue) * chartHeight
    }));
    if (coordinates.length > 1) {
      const area = ctx.createLinearGradient(0, top, 0, top + chartHeight);
      area.addColorStop(0, colorWithAlpha(color, 0.28));
      area.addColorStop(1, colorWithAlpha(color, 0));
      ctx.fillStyle = area;
      ctx.beginPath();
      ctx.moveTo(coordinates[0]?.x ?? left, top + chartHeight);
      coordinates.forEach(({ x, y }, pointIndex) => {
        if (pointIndex === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineTo(coordinates.at(-1)?.x ?? left, top + chartHeight);
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.strokeStyle = colorWithAlpha(color, 0.34);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 5;
    ctx.beginPath();
    coordinates.forEach(({ x, y }, pointIndex) => {
      if (pointIndex === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    coordinates.forEach(({ point, x, y }, pointIndex) => {
      const pointColor = colorFor(point.colorKey ?? series.colorKey, point.confidence, theme);
      drawGraphNode(ctx, "note", x, y, 5.5, pointColor, point.confidence, theme);
      drawFocusRing(ctx, x, y, 9, state, point.id, theme);
      addHit(
        hitRegions,
        scene.primitive,
        point.id,
        point.label ?? series.label,
        x - 6,
        y - 6,
        12,
        12,
        scene.bands.length + seriesIndex * 1000 + pointIndex,
        point.confidence
      );
    });
  });
}

function drawMatrix(
  ctx: CanvasRenderingContext2D,
  scene: MatrixScene,
  width: number,
  height: number,
  state: RenderState,
  theme: ThemeTokens,
  hitRegions: HitRegion[]
): void {
  const left = 104;
  const top = 96;
  const cellWidth = Math.max(20, (width - left - 20) / Math.max(1, scene.columns.length));
  const cellHeight = Math.max(20, (height - top - 20) / Math.max(1, scene.rows.length));
  const max = Math.max(...scene.cells.map((cell) => cell.value ?? 0), 1);
  const rowIndex = new Map(scene.rows.map((row, index) => [row.id, index]));
  const columnIndex = new Map(scene.columns.map((column, index) => [column.id, index]));
  ctx.fillStyle = theme.mutedText;
  ctx.font = "10px system-ui, sans-serif";
  scene.columns.forEach((column, index) => {
    ctx.fillText(column.label, left + index * cellWidth + 3, top - 10, Math.max(12, cellWidth - 6));
  });
  scene.rows.forEach((row, index) => {
    ctx.fillText(row.label, 10, top + index * cellHeight + Math.min(16, cellHeight / 2 + 4), left - 18);
  });
  scene.cells.forEach((cell, index) => {
    const row = rowIndex.get(cell.row);
    const column = columnIndex.get(cell.column);
    if (row === undefined || column === undefined) {
      return;
    }
    const x = left + column * cellWidth;
    const y = top + row * cellHeight;
    const color = colorFor(cell.colorKey ?? cell.column, cell.confidence, theme);
    const alpha = cell.value === null ? 0.12 : 0.18 + ((cell.value ?? 0) / max) * 0.78;
    const inset = Math.min(4, Math.max(2, cellWidth * 0.035));
    const drawWidth = Math.max(2, cellWidth - inset * 2);
    const drawHeight = Math.max(2, cellHeight - inset * 2);
    const cellGradient = ctx.createLinearGradient(x, y, x + drawWidth, y + drawHeight);
    cellGradient.addColorStop(0, colorWithAlpha(color, alpha));
    cellGradient.addColorStop(1, colorWithAlpha(color, alpha * 0.46));
    ctx.save();
    ctx.fillStyle = cellGradient;
    ctx.strokeStyle = colorWithAlpha(color, Math.min(0.72, alpha));
    ctx.shadowColor = color;
    ctx.shadowBlur = cell.value === null ? 0 : 3 + alpha * 9;
    roundedRectPath(ctx, x + inset, y + inset, drawWidth, drawHeight, Math.min(6, drawHeight * 0.18));
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
    drawFocusRect(ctx, x + inset, y + inset, drawWidth, drawHeight, state, cell.id, theme);
    addHit(hitRegions, scene.primitive, cell.id, `${cell.row} / ${cell.column}`, x + inset, y + inset, drawWidth, drawHeight, index, cell.confidence);
  });
}

function drawScatter(
  ctx: CanvasRenderingContext2D,
  scene: ScatterScene,
  width: number,
  height: number,
  state: RenderState,
  theme: ThemeTokens,
  hitRegions: HitRegion[]
): void {
  const left = 48;
  const top = 72;
  const chartWidth = Math.max(10, width - 86);
  const chartHeight = Math.max(10, height - 112);
  const maxX = Math.max(...scene.points.map((point) => point.x), ...scene.frontier.map((point) => point.x), 1);
  const maxY = Math.max(...scene.points.map((point) => point.y), ...scene.frontier.map((point) => point.y), 1);
  drawGrid(ctx, left, top, chartWidth, chartHeight, theme);
  ctx.fillStyle = theme.mutedText;
  ctx.font = "10px system-ui, sans-serif";
  ctx.fillText(scene.xLabel, left + chartWidth / 2 - 36, top + chartHeight + 24, 100);
  ctx.fillText(scene.yLabel, left, top - 10, Math.max(40, chartWidth * 0.45));
  ctx.save();
  ctx.strokeStyle = colorWithAlpha(theme.focus, 0.26);
  ctx.shadowColor = theme.focus;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 5;
  ctx.beginPath();
  scene.frontier.forEach((point, index) => {
    const x = left + (point.x / maxX) * chartWidth;
    const y = top + chartHeight - (point.y / maxY) * chartHeight;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorWithAlpha(theme.focus, 0.84);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
  const labelIds = new Set(
    [...scene.points]
      .sort((a, b) => b.size - a.size || a.id.localeCompare(b.id))
      .slice(0, 6)
      .map((point) => point.id)
  );
  scene.points.forEach((point, index) => {
    const x = left + (point.x / maxX) * chartWidth;
    const y = top + chartHeight - (point.y / maxY) * chartHeight;
    const radius = clamp(4 + Math.log1p(Math.max(1, point.size)) * 1.8, 4, 22);
    drawFocusRing(ctx, x, y, radius + 4, state, point.id, theme);
    const color = colorFor(point.colorKey ?? point.group, point.confidence, theme);
    drawGraphNode(ctx, "note", x, y, radius, color, point.confidence, theme);
    addHit(hitRegions, scene.primitive, point.id, point.label, x - radius, y - radius, radius * 2, radius * 2, index, point.confidence);
    if (labelIds.has(point.id) || state.selectedMarkId === point.id || state.focusedMarkId === point.id) {
      drawMarkLabel(ctx, point.label, x, y, radius, color, width, height, theme);
    }
  });
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  theme: ThemeTokens
): void {
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const gx = x + (width * i) / 4;
    const gy = y + (height * i) / 4;
    ctx.strokeStyle = i === 0 || i === 4 ? theme.gridStrong : theme.grid;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFocusRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  state: RenderState,
  markId: string,
  theme: ThemeTokens
): void {
  if (state.selectedMarkId !== markId && state.focusedMarkId !== markId) {
    return;
  }
  const color = state.selectedMarkId === markId ? theme.selection : theme.focus;
  const animationProgress = state.playbackProgress ?? 1;
  const bloom = animationProgress < 1 ? Math.sin(animationProgress * Math.PI) : 0;
  ctx.save();
  ctx.strokeStyle = colorWithAlpha(color, 0.9);
  ctx.shadowColor = color;
  ctx.shadowBlur = 14 + bloom * 14;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius + bloom * 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = colorWithAlpha(color, 0.34);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, radius + 5 + bloom * 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFocusRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  state: RenderState,
  markId: string,
  theme: ThemeTokens
): void {
  if (state.selectedMarkId !== markId && state.focusedMarkId !== markId) {
    return;
  }
  const color = state.selectedMarkId === markId ? theme.selection : theme.focus;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 2;
  roundedRectPath(ctx, x - 3, y - 3, width + 6, height + 6, 7);
  ctx.stroke();
  ctx.restore();
}

function drawGraphNode(
  ctx: CanvasRenderingContext2D,
  role: GraphScene["nodes"][number]["role"],
  x: number,
  y: number,
  size: number,
  color: string,
  confidence: Confidence,
  theme: ThemeTokens
): void {
  ctx.save();
  const auraSize = role === "index" ? size * 2.55 : size * 2.05;
  const aura = ctx.createRadialGradient(x, y, Math.max(1, size * 0.25), x, y, auraSize);
  aura.addColorStop(0, colorWithAlpha(color, role === "index" ? 0.42 : 0.28));
  aura.addColorStop(0.42, colorWithAlpha(color, role === "index" ? 0.18 : 0.1));
  aura.addColorStop(1, colorWithAlpha(color, 0));
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(x, y, auraSize, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = color;
  ctx.shadowBlur = role === "index" ? 18 : 9;
  if (role === "tool") {
    const boxGradient = ctx.createLinearGradient(x - size, y - size, x + size, y + size);
    boxGradient.addColorStop(0, colorWithAlpha(color, 0.98));
    boxGradient.addColorStop(1, colorWithAlpha(color, 0.46));
    ctx.fillStyle = boxGradient;
    roundedRectPath(ctx, x - size * 1.28, y - size * 0.72, size * 2.56, size * 1.44, Math.max(3, size * 0.34));
    ctx.fill();
  } else if (role === "query") {
    const queryGradient = ctx.createRadialGradient(x - size * 0.24, y - size * 0.34, 0, x, y, size * 1.45);
    queryGradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    queryGradient.addColorStop(0.26, colorWithAlpha(color, 0.98));
    queryGradient.addColorStop(1, colorWithAlpha(color, 0.48));
    ctx.fillStyle = queryGradient;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
  } else {
    const orb = ctx.createRadialGradient(
      x - size * 0.3,
      y - size * 0.36,
      Math.max(0.5, size * 0.05),
      x,
      y,
      size * 1.08
    );
    orb.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    orb.addColorStop(role === "index" ? 0.17 : 0.24, colorWithAlpha(color, 0.98));
    orb.addColorStop(1, colorWithAlpha(color, role === "index" ? 0.62 : 0.5));
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    if (role === "index") {
      ctx.shadowBlur = 0;
      ctx.fillStyle = theme.background;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, size * 0.43), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(244, 250, 255, 0.96)";
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.7, size * 0.12), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = colorWithAlpha(color, 0.66);
      ctx.lineWidth = 1;
      for (const scale of [1.28, 1.58]) {
        ctx.beginPath();
        ctx.arc(x, y, size * scale, -Math.PI * 0.72, Math.PI * (0.42 + scale * 0.08));
        ctx.stroke();
      }
    }
  }

  ctx.shadowBlur = 0;
  if (confidence !== "measured") {
    ctx.strokeStyle = confidence === "unavailable" ? theme.unavailable : theme.inferred;
    ctx.lineWidth = 2;
    ctx.setLineDash(confidence === "unavailable" ? [2, 4] : [5, 3]);
    if (role === "tool") {
      ctx.strokeRect(x - size * 1.25, y - size * 0.72, size * 2.5, size * 1.44);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size + 1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function drawMarkLabel(
  ctx: CanvasRenderingContext2D,
  rawLabel: string,
  nodeX: number,
  nodeY: number,
  nodeRadius: number,
  color: string,
  stageWidth: number,
  stageHeight: number,
  theme: ThemeTokens
): void {
  const label = rawLabel.length > 28 ? `${rawLabel.slice(0, 27)}…` : rawLabel;
  const labelWidth = clamp(label.length * 6.25 + 22, 64, 188);
  const labelHeight = 23;
  const shouldPlaceAbove = nodeY + nodeRadius + labelHeight + 18 > stageHeight;
  const y = shouldPlaceAbove ? nodeY - nodeRadius - labelHeight - 9 : nodeY + nodeRadius + 9;
  const x = clamp(nodeX - labelWidth / 2, 10, Math.max(10, stageWidth - labelWidth - 10));
  ctx.save();
  ctx.fillStyle = "rgba(8, 13, 23, 0.86)";
  ctx.strokeStyle = colorWithAlpha(color, 0.5);
  ctx.lineWidth = 1;
  ctx.shadowColor = "rgba(0, 0, 0, 0.72)";
  ctx.shadowBlur = 10;
  roundedRectPath(ctx, x, y, labelWidth, labelHeight, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.fillStyle = color;
  roundedRectPath(ctx, x + 5, y + 6, 3, labelHeight - 12, 1.5);
  ctx.fill();
  ctx.fillStyle = theme.text;
  ctx.font = "500 10px system-ui, sans-serif";
  ctx.fillText(label, x + 13, y + 15.5, labelWidth - 18);
  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function addHit(
  hitRegions: HitRegion[],
  primitive: VisualScene["primitive"],
  markId: string,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  order: number,
  confidence: Confidence
): void {
  hitRegions.push({ id: `${primitive}:${markId}`, markId, label, primitive, x, y, width, height, order, confidence });
}

function buildSemanticTree(scene: VisualScene, hitRegions: HitRegion[], state: RenderState): SemanticNode {
  const statusNode: SemanticNode = {
    id: `${scene.id}:status`,
    role: "status",
    label: scene.status,
    value: scene.missingCapabilities.join(", "),
    selected: false,
    disabled: scene.status === "unavailable",
    children: []
  };
  return {
    id: scene.id,
    role: "scene",
    label: scene.title,
    value: scene.summary,
    selected: false,
    disabled: scene.status === "unavailable",
    children: [
      statusNode,
      ...hitRegions.map((hit) => ({
        id: hit.id,
        role: "mark" as const,
        label: hit.label,
        value: hit.confidence,
        selected: state.selectedMarkId === hit.markId,
        disabled: hit.confidence === "unavailable",
        children: []
      }))
    ]
  };
}

function colorFor(key: string, confidence: Confidence, theme: ThemeTokens): string {
  if (confidence === "unavailable") {
    return theme.unavailable;
  }
  if (confidence === "inferred" && !theme.palette[key]) {
    return theme.inferred;
  }
  return theme.palette[key] ?? (confidence === "measured" ? theme.measured : theme.inferred);
}

function colorWithAlpha(color: string, alpha: number): string {
  const clampedAlpha = clamp(alpha, 0, 1);
  const shortHex = /^#([\da-f])([\da-f])([\da-f])$/i.exec(color);
  if (shortHex) {
    const [, red = "0", green = "0", blue = "0"] = shortHex;
    return `rgba(${parseInt(red + red, 16)}, ${parseInt(green + green, 16)}, ${parseInt(blue + blue, 16)}, ${clampedAlpha})`;
  }
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (hex) {
    return `rgba(${parseInt(hex[1] ?? "0", 16)}, ${parseInt(hex[2] ?? "0", 16)}, ${parseInt(hex[3] ?? "0", 16)}, ${clampedAlpha})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const channels = (rgb[1] ?? "").split(",").slice(0, 3).map((channel) => channel.trim());
    if (channels.length === 3) return `rgba(${channels.join(", ")}, ${clampedAlpha})`;
  }
  return color;
}

function formatCompactValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sceneCoordinate(value: number, start: number, end: number): number {
  return start + clamp(value, 0, 1) * Math.max(0, end - start);
}

function browserFrameScheduler(): FrameScheduler {
  const maybeWindow = globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    performance?: { now(): number };
  };
  return {
    now: () => maybeWindow.performance?.now() ?? Date.now(),
    request: (callback) => {
      if (maybeWindow.requestAnimationFrame) {
        return maybeWindow.requestAnimationFrame(callback);
      }
      return setTimeout(() => callback(Date.now()), 16) as unknown as number;
    },
    cancel: (id) => {
      if (maybeWindow.cancelAnimationFrame) {
        maybeWindow.cancelAnimationFrame(id);
        return;
      }
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    }
  };
}
