import { Cell, PlayerType } from "../../core/game/Game";
import { startYear } from "../../core/overreach/Calendar";
import type { Controller } from "../Controller";
import type { MapRenderer } from "../render/gl";
import type { TransformHandler } from "../TransformHandler";
import type { GameView } from "../view";
import { provinceLayer } from "./ProvinceLayer";

// A nation's name, drawn along a curve through its land as EU4 does (MASTERPLAN.md section 4):
// the curve is fitted to the nation's main landmass, in world tiles, and the name is laid on it
// letter by letter. OpenFront's own name boxes are switched off in these games.

interface Label {
  text: string;
  // The curve in the nation's own frame: rotated by `angle` about (x, y), v = a u² + b u.
  x: number;
  y: number;
  angle: number;
  a: number;
  b: number;
  length: number; // along u, in tiles
  height: number; // the tallest letter that fits the land, in tiles
  dark: boolean; // dark text on a light nation
}

const MIN_PX = 9;
const MAX_PX = 64;
// The names fade as you zoom in (tiles on screen px), as province names take over.
const FADE_FROM = 1.0;
const FADE_TO = 2.0;
const RECOMPUTE_MS = 1500;
const CURVE_SAMPLES = 24;

/**
 * The provinces of a nation's main landmass: provinces touching or near each other join up, and
 * the joined group holding most land wins. Colonies overseas are left out, so the name sits on
 * the homeland.
 */
export function mainland(
  points: { x: number; y: number; w: number }[],
): { x: number; y: number; w: number }[] {
  const n = points.length;
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // A province is about a circle of w tiles: two touch when their centres are a little over
  // the sum of their radii apart.
  const radius = points.map((p) => Math.sqrt(p.w / Math.PI));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const near = 1.8 * (radius[i] + radius[j]) + 30;
      if (
        Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < near
      ) {
        parent[find(i)] = find(j);
      }
    }
  }
  const weight = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    weight.set(find(i), (weight.get(find(i)) ?? 0) + points[i].w);
  }
  let best = find(0);
  for (const [root, w] of weight) if (w > weight.get(best)!) best = root;
  return points.filter((_, i) => find(i) === best);
}

/** The nation labels from the provinces each nation holds. Exported for the test. */
export function labelGeometry(
  points: { x: number; y: number; w: number }[],
): Omit<Label, "text" | "dark"> | null {
  if (points.length === 0) return null;
  const keep = mainland(points);
  let mx = 0;
  let my = 0;
  let total = 0;
  for (const p of keep) {
    total += p.w;
    mx += p.x * p.w;
    my += p.y * p.w;
  }
  mx /= total;
  my /= total;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let w = 0;
  for (const p of keep) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += p.w * dx * dx;
    syy += p.w * dy * dy;
    sxy += p.w * dx * dy;
    w += p.w;
  }
  sxx /= w;
  syy /= w;
  sxy /= w;
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy;
  const det = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  const s1 = Math.sqrt(tr / 2 + det);
  const s2 = Math.sqrt(Math.max(tr / 2 - det, 0));
  // A single province is round: write it level.
  if (keep.length < 3 || s1 < 1.3 * s2) angle = 0;
  // Keep the text reading left to right.
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // The curve: weighted least squares of v = a u² + b u + k.
  const n = [0, 0, 0, 0, 0];
  const r = [0, 0, 0];
  let umin = Infinity;
  let umax = -Infinity;
  for (const p of keep) {
    const dx = p.x - mx;
    const dy = p.y - my;
    const u = dx * c + dy * s;
    const v = -dx * s + dy * c;
    umin = Math.min(umin, u);
    umax = Math.max(umax, u);
    for (let i = 0; i < 5; i++) n[i] += p.w * u ** i;
    r[0] += p.w * v;
    r[1] += p.w * v * u;
    r[2] += p.w * v * u * u;
  }
  const [a, b] = solve(
    [
      [n[4], n[3], n[2]],
      [n[3], n[2], n[1]],
      [n[2], n[1], n[0]],
    ],
    [r[2], r[1], r[0]],
  );
  const s1Len = Math.max(s1 * 3.6, 1);
  const length = Math.min(s1Len, Math.max(umax - umin, 1) * 1.15);
  // No more than 30 degrees of bend at the ends of the text.
  const limit = Math.tan(Math.PI / 6) / length;
  return {
    x: mx,
    y: my,
    angle,
    a: Math.max(-limit, Math.min(limit, a)),
    b: Math.max(-0.4, Math.min(0.4, b)),
    length,
    height: Math.max(s2 * 2.4, 1),
  };
}

// Solve a 3 by 3 system by Cramer's rule; a singular one gives a straight line.
function solve(m: number[][], y: number[]): [number, number, number] {
  const d = (q: number[][]) =>
    q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) -
    q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) +
    q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
  const det = d(m);
  if (Math.abs(det) < 1e-9) return [0, 0, 0];
  const col = (i: number) =>
    m.map((row, k) => row.map((v, j) => (j === i ? y[k] : v)));
  return [d(col(0)) / det, d(col(1)) / det, d(col(2)) / det];
}

export class CountryNames implements Controller {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private labels: Label[] = [];
  private version = -1;
  private computedAt = 0;
  private frame = 0;
  private last = "";

  constructor(
    private game: GameView,
    private transform: TransformHandler,
    private view: MapRenderer,
  ) {
    const s = this.canvas.style;
    s.position = "fixed";
    s.inset = "0";
    s.pointerEvents = "none";
    s.zIndex = "50";
    document.body.appendChild(this.canvas);
  }

  init() {
    this.loop();
  }

  getTickIntervalMs() {
    return 500;
  }

  tick() {
    // The renderer may not exist yet when the game starts, so keep asking it.
    this.view.setHideNationNames(true);
    const layer = provinceLayer;
    if (layer === null) return;
    const now = performance.now();
    if (
      layer.version === this.version ||
      now - this.computedAt < RECOMPUTE_MS
    ) {
      return;
    }
    this.version = layer.version;
    this.computedAt = now;
    this.compute();
    this.last = "";
  }

  private compute() {
    const layer = provinceLayer!;
    const byOwner = new Map<number, { x: number; y: number; w: number }[]>();
    layer.records.forEach((rec, id) => {
      const w = layer.count[id];
      if (!rec || rec.owner === 0 || !w) return;
      let list = byOwner.get(rec.owner);
      if (!list) byOwner.set(rec.owner, (list = []));
      list.push({ x: layer.cx[id] / w, y: layer.cy[id] / w, w });
    });
    const labels: Label[] = [];
    for (const [owner, points] of byOwner) {
      const p = this.game.playerBySmallID(owner);
      if (!p.isPlayer() || !p.isAlive() || p.type() === PlayerType.Bot)
        continue;
      const g = labelGeometry(points);
      if (g === null) continue;
      const colour = p.territoryColor();
      labels.push({
        ...g,
        text: p.displayName().toUpperCase(),
        dark: colour.brightness() > 0.62,
      });
    }
    this.labels = labels;
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const th = this.transform;
    const dpr = window.devicePixelRatio || 1;
    const key = `${th.scale}|${th.offsetX}|${th.offsetY}|${innerWidth}|${innerHeight}|${dpr}`;
    if (key === this.last) return;
    this.last = key;
    this.draw(dpr);
  };

  private draw(dpr: number) {
    const { canvas, ctx } = this;
    const w = Math.round(innerWidth * dpr);
    const h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (startYear(this.game.config().gameConfig()) === null) return;
    const p0 = this.transform.worldToScreenCoordinates(new Cell(0, 0));
    const p1 = this.transform.worldToScreenCoordinates(new Cell(1, 1));
    const zoom = p1.x - p0.x;
    if (zoom <= 0) return;
    const toScreen = (x: number, y: number) => ({
      x: p0.x + x * zoom,
      y: p0.y + y * (p1.y - p0.y),
    });
    const fade = Math.min(
      1,
      Math.max(0, (FADE_TO - zoom) / (FADE_TO - FADE_FROM)),
    );
    if (fade <= 0.02) return;
    ctx.globalAlpha = fade;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const l of this.labels) this.drawLabel(l, zoom, toScreen);
    ctx.globalAlpha = 1;
  }

  private drawLabel(
    l: Label,
    zoom: number,
    toScreen: (x: number, y: number) => { x: number; y: number },
  ) {
    const ctx = this.ctx;
    const n = l.text.length;
    const lengthPx = l.length * zoom;
    const c = toScreen(l.x, l.y);
    if (
      c.x + lengthPx < 0 ||
      c.x - lengthPx > innerWidth ||
      c.y + lengthPx < 0 ||
      c.y - lengthPx > innerHeight
    ) {
      return;
    }
    // The biggest letters that fit the land's width, then shrunk until the name fits its length.
    let size = Math.min(l.height * zoom, (lengthPx / n) * 1.5, MAX_PX);
    if (size < MIN_PX) return;
    const font = (px: number) =>
      `600 ${px}px Georgia, "Times New Roman", serif`;
    ctx.font = font(size);
    const widths = [...l.text].map((ch) => ctx.measureText(ch).width);
    const natural = widths.reduce((a, b) => a + b, 0);
    if (natural > lengthPx) {
      size *= lengthPx / natural;
      if (size < MIN_PX) return;
      ctx.font = font(size);
      for (let i = 0; i < n; i++) widths[i] *= lengthPx / natural;
    }
    const used = widths.reduce((a, b) => a + b, 0);
    const gap = n > 1 ? Math.min((lengthPx - used) / (n - 1), size * 0.9) : 0;
    const total = used + gap * (n - 1);

    // The curve in screen pixels: u along the text, v = a u² + b u, rotated by the angle.
    const cos = Math.cos(l.angle);
    const sin = Math.sin(l.angle);
    const pt = (u: number) => {
      const v = l.a * u * u + l.b * u;
      return { wx: l.x + u * cos - v * sin, wy: l.y + u * sin + v * cos };
    };
    // Sample it, with its running arc length, so letters sit at even spacing along it.
    const half = l.length / 2;
    const samples: { x: number; y: number; s: number }[] = [];
    let run = 0;
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const u = -half + (l.length * i) / CURVE_SAMPLES;
      const { wx, wy } = pt(u);
      const q = toScreen(wx, wy);
      if (i > 0)
        run += Math.hypot(q.x - samples[i - 1].x, q.y - samples[i - 1].y);
      samples.push({ x: q.x, y: q.y, s: run });
    }
    const arc = samples[samples.length - 1].s;
    if (arc <= 0) return;
    const at = (s: number) => {
      const t = Math.max(0, Math.min(arc, s));
      let i = 1;
      while (i < samples.length - 1 && samples[i].s < t) i++;
      const a = samples[i - 1];
      const b = samples[i];
      const f = b.s === a.s ? 0 : (t - a.s) / (b.s - a.s);
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    };

    const fill = l.dark ? "rgba(36, 26, 16, 0.9)" : "rgba(247, 240, 222, 0.95)";
    const halo = l.dark ? "rgba(255, 248, 228, 0.55)" : "rgba(20, 14, 8, 0.6)";
    ctx.lineWidth = Math.max(2, size / 7);
    ctx.strokeStyle = halo;
    ctx.fillStyle = fill;
    let s = (arc - total) / 2;
    for (let i = 0; i < n; i++) {
      const mid = at(s + widths[i] / 2);
      ctx.save();
      ctx.translate(mid.x, mid.y);
      ctx.rotate(mid.angle);
      ctx.strokeText(l.text[i], -widths[i] / 2, 0);
      ctx.fillText(l.text[i], -widths[i] / 2, 0);
      ctx.restore();
      s += widths[i] + gap;
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.canvas.remove();
  }
}

export function createCountryNames(
  game: GameView,
  transform: TransformHandler,
  view: MapRenderer,
): Controller | null {
  const gc = game.config().gameConfig();
  if (startYear(gc) === null || gc.sandbox === true) return null;
  return new CountryNames(game, transform, view);
}
