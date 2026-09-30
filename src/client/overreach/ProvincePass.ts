import type { Config } from "../../core/configuration/Config";
import {
  type AttackTroopLabel,
  WorldTextPass,
} from "../render/gl/passes/WorldTextPass";
import type { RenderSettings } from "../render/gl/RenderSettings";
import overlayVertSrc from "../render/gl/shaders/map-overlay/overlay.vert.glsl?raw";
import { renderDpr } from "../render/gl/utils/Dpr";
import { createMapQuad, createProgram } from "../render/gl/utils/GlUtils";
import {
  paintsProvinces,
  palette,
  PALETTE_WIDTH,
  paletteState,
} from "./MapMode";
import { provinceLayer, type ProvinceLayer } from "./ProvinceLayer";

// Province borders and place names (Overreach, SANDBOX.md F4 and F5), drawn
// from provinceLayer: thin dark lines between provinces, fading in as you
// zoom, under the national borders; and names. A province with a town is
// named at its town, one without at its centre, and other named cities where
// they stand. Smaller places show as you zoom in.

const borderFragSrc = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 vWorldPos;
uniform usampler2D uProv;
uniform vec2 uMapSize;
uniform float uLine;
uniform float uAlpha;
out vec4 outColor;

bool inside(ivec2 t) {
  return t.x >= 0 && t.y >= 0 && t.x < int(uMapSize.x) && t.y < int(uMapSize.y);
}

// Another province (not water) next door.
bool differs(ivec2 t, uint p) {
  if (!inside(t)) return false;
  uint q = texelFetch(uProv, t, 0).r;
  return q != 0u && q != p;
}

void main() {
  ivec2 t = ivec2(floor(vWorldPos));
  if (!inside(t)) discard;
  uint p = texelFetch(uProv, t, 0).r;
  if (p == 0u) discard;
  vec2 f = fract(vWorldPos);
  bool edge =
    (f.x < uLine && differs(t + ivec2(-1, 0), p)) ||
    (f.x > 1.0 - uLine && differs(t + ivec2(1, 0), p)) ||
    (f.y < uLine && differs(t + ivec2(0, -1), p)) ||
    (f.y > 1.0 - uLine && differs(t + ivec2(0, 1), p));
  if (!edge) discard;
  outColor = vec4(0.06, 0.06, 0.06, uAlpha);
}
`;

// A map mode paints each province from a palette (MapMode.ts): its id picks a colour.
const modeFragSrc = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

in vec2 vWorldPos;
uniform usampler2D uProv;
uniform sampler2D uPalette;
uniform vec2 uMapSize;
out vec4 outColor;

void main() {
  ivec2 t = ivec2(floor(vWorldPos));
  if (t.x < 0 || t.y < 0 || t.x >= int(uMapSize.x) || t.y >= int(uMapSize.y)) discard;
  uint p = texelFetch(uProv, t, 0).r;
  if (p == 0u) discard;
  vec4 c = texelFetch(uPalette, ivec2(int(p & 255u), int(p >> 8)), 0);
  if (c.a == 0.0) discard;
  outColor = c;
}
`;

// Borders show from this zoom (device pixels per tile), fully by FULL_ZOOM.
const MIN_ZOOM = 1.5;
const FULL_ZOOM = 4;
const BORDER_ALPHA = 0.5;
// A town shows once its population is at least TOWN_POP / zoom² (zoom in
// CSS pixels per tile): 1.25M at 2, 78k at 8 (1836 people, on a 2000-wide map). A province
// without a town counts TILE_PEOPLE per tile, so it shows once it's about
// 70 px across. Nation names (CountryNames.ts) fade out as these come in.
// Both are for a 2000-wide map; a wider one has smaller tiles, so they scale
// by (2000 / its width)² and the same stretch of the world shows the same names.
const TOWN_POP = 5_000_000;
const TILE_PEOPLE = 1_000;
const REF_MAP_WIDTH = 2000;
const MAX_NAMES = 300;

export class ProvincePass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tex: WebGLTexture;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uLine: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private layer: ProvinceLayer | null = null;
  private modeProgram: WebGLProgram;
  private modeCamera: WebGLUniformLocation;
  private modeMapSize: WebGLUniformLocation;
  private paletteTex: WebGLTexture;
  private paletteSeen = -1;
  private names: WorldTextPass;

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    settings: RenderSettings,
    config: Config,
  ) {
    this.program = createProgram(gl, overlayVertSrc, borderFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uLine = gl.getUniformLocation(this.program, "uLine")!;
    this.uAlpha = gl.getUniformLocation(this.program, "uAlpha")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uProv"), 0);
    this.vao = createMapQuad(gl, mapW, mapH);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16UI, mapW, mapH);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    }
    this.modeProgram = createProgram(gl, overlayVertSrc, modeFragSrc);
    this.modeCamera = gl.getUniformLocation(this.modeProgram, "uCamera")!;
    this.modeMapSize = gl.getUniformLocation(this.modeProgram, "uMapSize")!;
    gl.useProgram(this.modeProgram);
    gl.uniform1i(gl.getUniformLocation(this.modeProgram, "uProv"), 0);
    gl.uniform1i(gl.getUniformLocation(this.modeProgram, "uPalette"), 1);
    this.paletteTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, PALETTE_WIDTH, PALETTE_WIDTH);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) {
      gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    }
    gl.activeTexture(gl.TEXTURE0);
    this.names = new WorldTextPass(gl, settings, config);
    this.names.setMapWidth(mapW);
  }

  drawBorders(cameraMatrix: Float32Array, zoom: number): void {
    const layer = provinceLayer;
    if (layer === null || layer.width !== this.mapW || zoom < MIN_ZOOM) {
      return;
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    this.upload(layer);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uLine, Math.min(0.35, Math.max(0.04, 1 / zoom)));
    const fade = Math.min(1, (zoom - MIN_ZOOM) / (FULL_ZOOM - MIN_ZOOM));
    gl.uniform1f(this.uAlpha, BORDER_ALPHA * fade);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // The province colours of the current map mode, over the territory (the renderer calls this
  // right after it).
  drawMode(cameraMatrix: Float32Array): void {
    const layer = provinceLayer;
    if (layer === null || layer.width !== this.mapW || !paintsProvinces()) {
      return;
    }
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    this.upload(layer);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    if (this.paletteSeen !== paletteState.version) {
      this.paletteSeen = paletteState.version;
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        PALETTE_WIDTH,
        PALETTE_WIDTH,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        palette,
      );
    }
    gl.useProgram(this.modeProgram);
    gl.uniformMatrix3fv(this.modeCamera, false, cameraMatrix);
    gl.uniform2f(this.modeMapSize, this.mapW, this.mapH);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  drawNames(cameraMatrix: Float32Array, zoom: number): void {
    const layer = provinceLayer;
    if (layer === null || layer.width !== this.mapW) return;
    this.names.setAttackTroopLabels(this.labels(layer, cameraMatrix, zoom));
    this.names.tick(zoom);
    this.names.draw(cameraMatrix, zoom);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.modeProgram);
    this.gl.deleteTexture(this.paletteTex);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteTexture(this.tex);
    this.names.dispose();
  }

  // Uploads the rows that changed (all of them for a new layer).
  private upload(layer: ProvinceLayer): void {
    if (this.layer !== layer) {
      this.layer = layer;
      layer.dirtyFrom = 0;
      layer.dirtyTo = this.mapH - 1;
    }
    if (layer.dirtyFrom > layer.dirtyTo) return;
    const gl = this.gl;
    const [from, to] = [layer.dirtyFrom, layer.dirtyTo];
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      from,
      this.mapW,
      to - from + 1,
      gl.RED_INTEGER,
      gl.UNSIGNED_SHORT,
      layer.prov.subarray(from * this.mapW, (to + 1) * this.mapW),
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    layer.dirtyFrom = 1;
    layer.dirtyTo = 0;
  }

  private labels(
    layer: ProvinceLayer,
    m: Float32Array,
    zoom: number,
  ): AttackTroopLabel[] {
    const css = zoom / renderDpr();
    const scale = (REF_MAP_WIDTH / this.mapW) ** 2;
    const minPop = (TOWN_POP * scale) / (css * css);
    // The visible world: clip space [-1, 1] back through the camera.
    const xs = [(-1 - m[6]) / m[0], (1 - m[6]) / m[0]];
    const ys = [(-1 - m[7]) / m[4], (1 - m[7]) / m[4]];
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const shown: { n: number; label: AttackTroopLabel }[] = [];
    const add = (x: number, y: number, text: string, n: number) => {
      if (n < minPop || x < x0 || x > x1 || y < y0 || y > y1) return;
      const label = { x, y, text, colorR: 0.93, colorG: 0.92, colorB: 0.86 };
      shown.push({ n, label });
    };
    const w = this.mapW;
    for (let id = 1; id < layer.count.length; id++) {
      const rec = layer.records[id];
      const tiles = layer.count[id];
      if (!rec || tiles === 0) continue;
      const people = tiles * TILE_PEOPLE * scale;
      if (rec.capital === null) {
        add(layer.cx[id] / tiles, layer.cy[id] / tiles, rec.name, people);
      } else {
        const x = (rec.capital % w) + 0.5;
        const y = Math.floor(rec.capital / w) + 0.5;
        add(x, y, rec.name, rec.population || people);
      }
    }
    for (const c of layer.cities.values()) {
      if (layer.records[layer.province(c.tile)]?.capital === c.tile) continue;
      add(
        (c.tile % w) + 0.5,
        Math.floor(c.tile / w) + 0.5,
        c.name,
        c.population,
      );
    }
    // Biggest first; a name that would overlap one already placed is skipped.
    // Boxes are estimated (WorldTextPass centres attack labels at 17 px).
    shown.sort((a, b) => b.n - a.n);
    const em = (17 * renderDpr()) / zoom;
    const placed: number[][] = [];
    const out: AttackTroopLabel[] = [];
    for (const { label } of shown) {
      const w = label.text.length * em * 0.3 + em * 0.3;
      const h = em * 0.6;
      const box = [label.x - w, label.y - h, label.x + w, label.y + h];
      const hit = placed.some(
        (b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3],
      );
      if (hit) continue;
      placed.push(box);
      out.push(label);
      if (out.length === MAX_NAMES) break;
    }
    return out;
  }
}
