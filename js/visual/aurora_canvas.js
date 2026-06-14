/**
 * <aurora-canvas> — the signature ambient aurora (docs/DESIGN.md §7).
 *
 * Realistic aurora-borealis curtains hugging the bottom of the panel: big
 * ribbon-like columns that rise from the very bottom edge to varied,
 * mountain-like heights, green in the body and shifting to magenta / pink at
 * the tips, drifting continuously. The continuous, flowing curtain DENSITY is
 * nimitz's tri-noise march ("Auroras", ShaderToy XtGGRt, 2017) — proven to read
 * as one continuous sheet; we discard nimitz's colour and paint it by height.
 *
 *  - Resolution-independent: vertical position is measured in units of WIDTH and
 *    anchored to the bottom, so resizing the panel HEIGHT (dragging the terminal)
 *    does NOT squish the aurora — it keeps its size/shape and just reveals more
 *    or less empty sky above.
 *  - Drift, never pulse: motion is only nimitz's slow tri-noise morph.
 *  - Cheap: half-res render, upscaled; rAF paused off-screen / unfocused; static
 *    CSS-gradient fallback on prefers-reduced-motion or when WebGL is missing.
 *
 * Self-registering vanilla custom element (works inside the Shadow DOM of
 * <aurora-welcome>). Attributes:
 *  - intensity : 0..1 overall brightness (default 0.85)
 *  - speed     : drift multiplier (default 1)
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform float uIntensity;

// ============================================================================
// Realistic aurora-borealis curtains. The continuous curtain DENSITY is nimitz's
// tri-noise march ("Auroras", XtGGRt, 2017); we colour it ourselves by height
// (green -> teal -> magenta -> pink tips). A smooth mountain ridge varies the
// top height; everything is measured in WIDTH units, anchored to the bottom.
// ============================================================================

mat2 mm2(in float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
const mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
float tri(in float x){ return clamp(abs(fract(x) - 0.5), 0.01, 0.49); }
vec2 tri2(in vec2 p){ return vec2(tri(p.x) + tri(p.y), tri(p.y + tri(p.x))); }
float hash21(in vec2 n){ return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }

// 1-D value-noise fbm — the smooth, low-frequency mountain ridge (varied tops).
float vn1(float x){ float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(hash21(vec2(i, 9.1)), hash21(vec2(i + 1.0, 9.1)), u); }
float fbm1(float x){ float v = 0.0, a = 0.55; for (int i = 0; i < 4; i++){ v += a * vn1(x); x = x * 2.0 + 1.3; a *= 0.5; } return v; }

// nimitz tri-noise — a continuous, time-drifting curtain field.
float triNoise2d(in vec2 p, float spd, float time){
  float z  = 1.8;
  float z2 = 2.5;
  float rz = 0.0;
  p *= mm2(p.x * 0.06);
  vec2 bp = p;
  for (int i = 0; i < 5; i++){
    vec2 dg = tri2(bp * 1.85) * 0.75;
    dg *= mm2(time * spd);          // time-rotated gradient -> continuous flow
    p -= dg / z2;
    bp *= 1.3;
    z2 *= 0.45;
    z  *= 0.42;
    p  *= 1.21 + (rz - 1.0) * 0.02;
    rz += tri(p.x + tri(p.y)) * z;
    p  *= -m2;
  }
  return clamp(1.0 / pow(rz * 29.0, 1.3), 0.0, 0.55);
}

// nimitz's curtain march, returning DENSITY only (we colour it by height).
float auroraDensity(vec3 ro, vec3 rd, float time){
  float sum = 0.0;
  float avg = 0.0;
  for (int i = 0; i < 40; i++){
    float fi = float(i);
    float of = 0.006 * hash21(gl_FragCoord.xy) * smoothstep(0.0, 15.0, fi);
    float pt = ((0.8 + pow(fi, 1.4) * 0.002) - ro.y) / (rd.y * 2.0 + 0.4);
    pt -= of;
    vec3 bpos = ro + pt * rd;
    float rzt = triNoise2d(bpos.zx, 0.06, time);
    avg = mix(avg, rzt, 0.5);
    sum += avg * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 5.0, fi);
  }
  sum *= clamp(rd.y * 15.0 + 0.4, 0.0, 1.0);
  return sum * 1.8;
}

void main(){
  float W = max(uRes.x, 1.0);
  // Width-normalized, BOTTOM-anchored coordinates. vx/vy are both in units of
  // WIDTH, so resizing the panel HEIGHT (dragging the terminal) does NOT squish
  // the aurora: it keeps its size + shape anchored to the bottom; you just see
  // more / less empty sky above it.
  float vx = (gl_FragCoord.x - 0.5 * uRes.x) / W;   // -0.5 .. 0.5
  float vy = gl_FragCoord.y / W;                    // 0 at the very bottom edge

  // Camera: horizon a touch BELOW the bottom edge so the curtains reach the very
  // bottom and close the gap onto the terminal header (no detached strip).
  vec3 ro = vec3(0.0, 0.0, -6.7);
  vec3 rd = normalize(vec3(vx * 2.1, vy * 0.95 + 0.05, 1.3));

  float dens = 0.0;
  if (rd.y > 0.0) dens = auroraDensity(ro, rd, uTime * 0.21);
  // Low edge at 0 so the faint field shows too — subtly fills the holes between
  // curtains with thin filaments (not intensely); high edge keeps bright cores.
  dens = smoothstep(0.05, 0.84, dens);

  // Mountain ridge (width-units): smooth, low-frequency, slowly drifting tops —
  // tall peaks and lower saddles. High min so it never collapses (stays coherent
  // + continuous). This is the ONLY height modulation.
  float ridge  = fbm1(vx * 2.6 - uTime * 0.012);
  float capTop = mix(0.26, 0.46, ridge);
  float cap = smoothstep(capTop, 0.05, vy);
  dens *= cap;

  // Continuous green base hugging the very bottom edge — covers the full width
  // and closes onto the terminal with no holes.
  float base = smoothstep(0.13, 0.0, vy);

  // Fuller spectrum up the height (stable, coherent bands): green body -> teal ->
  // cyan -> violet -> magenta -> pink at the tips. More colour, still an aurora.
  float h = clamp(vy / 0.42, 0.0, 1.0);
  vec3 green   = vec3(0.26, 1.00, 0.52);
  vec3 teal    = vec3(0.30, 0.96, 0.80);
  vec3 cyan    = vec3(0.28, 0.78, 1.00);
  vec3 violet  = vec3(0.60, 0.46, 1.00);
  vec3 magenta = vec3(0.95, 0.36, 0.92);
  vec3 pink    = vec3(1.00, 0.62, 0.84);
  vec3 cc = mix(green, teal,    smoothstep(0.00, 0.22, h));
  cc = mix(cc, cyan,    smoothstep(0.20, 0.42, h));
  cc = mix(cc, violet,  smoothstep(0.40, 0.60, h));
  cc = mix(cc, magenta, smoothstep(0.58, 0.80, h));
  cc = mix(cc, pink,    smoothstep(0.78, 1.00, h));

  // Dimmer + a little less volume than before (it was too bright/full).
  vec3 col = cc * dens * 1.2;
  col += green * base * 0.30;                        // continuous bottom fill

  // Soft bloom on the brightest ribbon cores (kept gentle).
  float lum0 = max(col.r, max(col.g, col.b));
  col += col * smoothstep(0.60, 1.35, lum0) * 0.28;

  float a = clamp(max(col.r, max(col.g, col.b)) * 1.35, 0.0, 1.0);
  col *= uIntensity;
  a   *= uIntensity;
  gl_FragColor = vec4(col, a);
}
`;

class AuroraCanvas extends HTMLElement {
  constructor() {
    super();
    this._raf = 0;
    this._gl = null;
    this._program = null;
    this._uniforms = null;
    this._canvas = null;
    this._start = 0;
    this._last = 0;
    this._running = false;
    this._visible = true;
    this._onResize = this._onResize.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._tick = this._tick.bind(this);
  }

  get intensity() {
    const v = parseFloat(this.getAttribute('intensity'));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.85;
  }

  get speed() {
    const v = parseFloat(this.getAttribute('speed'));
    return Number.isFinite(v) ? v : 1;
  }

  connectedCallback() {
    // Honour reduced-motion and absent WebGL by leaving the CSS fallback (a
    // static gradient set on the host via aurora_canvas.css) in place.
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { this.setAttribute('data-fallback', 'static'); return; }

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'aurora-canvas__gl';
    this.appendChild(this._canvas);

    if (!this._initGL()) {
      this.setAttribute('data-fallback', 'static');
      if (this._canvas) { this._canvas.remove(); this._canvas = null; }
      return;
    }

    this.setAttribute('data-fallback', 'none');
    this._observer = new IntersectionObserver((entries) => {
      this._visible = entries.some((e) => e.isIntersecting);
      this._visible ? this._play() : this._pause();
    }, { threshold: 0.01 });
    this._observer.observe(this);

    window.addEventListener('resize', this._onResize, { passive: true });
    window.addEventListener('blur', this._onVisibility);
    window.addEventListener('focus', this._onVisibility);
    document.addEventListener('visibilitychange', this._onVisibility);
    // The panel can change size WITHOUT a window resize (e.g. dragging the
    // terminal). Track our own box so the GL buffer follows and never squishes.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this);
    }

    this._onResize();
    this._play();
  }

  disconnectedCallback() {
    this._pause();
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onVisibility);
    window.removeEventListener('focus', this._onVisibility);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._gl) {
      const lose = this._gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    this._gl = null;
    this._program = null;
  }

  _initGL() {
    const opts = { alpha: true, antialias: false, premultipliedAlpha: false, depth: false, powerPreference: 'low-power' };
    const gl = this._canvas.getContext('webgl', opts) || this._canvas.getContext('experimental-webgl', opts);
    if (!gl) return false;
    this._gl = gl;

    const vs = this._compile(gl.VERTEX_SHADER, VERT);
    const fs = this._compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    this._program = program;
    gl.useProgram(program);

    // Full-screen triangle.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._uniforms = {
      uRes: gl.getUniformLocation(program, 'uRes'),
      uTime: gl.getUniformLocation(program, 'uTime'),
      uIntensity: gl.getUniformLocation(program, 'uIntensity'),
    };
    return true;
  }

  _compile(type, src) {
    const gl = this._gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      // Surface the reason in dev; the host keeps its CSS fallback.
      console.warn('[aurora-canvas] shader compile failed:', gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  _onResize() {
    if (!this._gl || !this._canvas) return;
    // Half-res render for cheap fill; CSS upscales. Cap DPR so a 4K panel
    // doesn't pay full-res for an ambient effect.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
    const w = Math.max(2, Math.floor(this.clientWidth * dpr));
    const h = Math.max(2, Math.floor(this.clientHeight * dpr));
    if (this._canvas.width !== w || this._canvas.height !== h) {
      this._canvas.width = w;
      this._canvas.height = h;
    }
    this._gl.viewport(0, 0, w, h);
    if (!this._running) this._renderOnce();   // keep a fresh frame while paused
  }

  _onVisibility() {
    const hidden = document.hidden || !document.hasFocus();
    (hidden || !this._visible) ? this._pause() : this._play();
  }

  _play() {
    if (this._running || !this._gl) return;
    this._running = true;
    if (!this._start) this._start = performance.now();
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  _pause() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  _tick(now) {
    if (!this._running) return;
    this._render((now - this._start) / 1000);
    this._raf = requestAnimationFrame(this._tick);
  }

  _renderOnce() {
    this._render(this._start ? (performance.now() - this._start) / 1000 : 0);
  }

  _render(timeSec) {
    const gl = this._gl;
    if (!gl || !this._program) return;
    gl.useProgram(this._program);
    gl.uniform2f(this._uniforms.uRes, this._canvas.width, this._canvas.height);
    gl.uniform1f(this._uniforms.uTime, timeSec * this.speed);
    gl.uniform1f(this._uniforms.uIntensity, this.intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

if (!customElements.get('aurora-canvas')) {
  customElements.define('aurora-canvas', AuroraCanvas);
}

export { AuroraCanvas };
