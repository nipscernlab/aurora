/**
 * <aurora-canvas> — the signature ambient aurora (docs/DESIGN.md §7).
 *
 * Realistic aurora-borealis curtains hugging the bottom of the panel: big
 * ribbon-like columns that rise from the bottom edge and fade out a little past
 * the middle, green in the body and shifting to magenta / pink at the tips,
 * drifting continuously. The continuous, flowing curtain DENSITY is nimitz's
 * tri-noise march ("Auroras", ShaderToy XtGGRt, 2017) — proven to read as one
 * continuous sheet (no patchy gaps); we discard nimitz's colour and paint the
 * density ourselves by height.
 *
 *  - Drift, never pulse: motion is nimitz's time-rotated noise gradient plus a
 *    slow lateral pan; nothing scales the whole frame's brightness.
 *  - Cheap: renders at a capped device-pixel-ratio (half-res) and upscales;
 *    pauses the rAF loop off-screen / unfocused; falls back to a static CSS
 *    gradient on prefers-reduced-motion or when WebGL is unavailable.
 *
 * Self-registering vanilla custom element (works inside the Shadow DOM of
 * <aurora-welcome>). Attributes:
 *  - intensity : 0..1 overall brightness (default 0.85)
 *  - speed     : drift multiplier (default 1)
 *
 * Usage:  <aurora-canvas intensity="0.8"></aurora-canvas>
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
// Realistic aurora-borealis curtains. The continuous, drifting curtain DENSITY
// is nimitz's tri-noise march ("Auroras", ShaderToy XtGGRt, 2017) — proven to
// read as one continuous flowing sheet (no patchy gaps). We discard nimitz's
// colour and paint the density ourselves by HEIGHT: green body -> teal ->
// magenta -> pink at the tips. The curtains hug the bottom and fade out a little
// past the middle; a continuous green base fills the whole bottom edge.
// ============================================================================

mat2 mm2(in float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
const mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
float tri(in float x){ return clamp(abs(fract(x) - 0.5), 0.01, 0.49); }
vec2 tri2(in vec2 p){ return vec2(tri(p.x) + tri(p.y), tri(p.y + tri(p.x))); }
float hash21(in vec2 n){ return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }

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
// Motion is ONLY the tri-noise morph (organic, non-repeating) — no linear pan,
// which read as a predictable sliding "gif".
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
  vec2 uv = gl_FragCoord.xy / uRes.xy;            // 0..1, y-up (0 = bottom)
  vec2 p = uv - 0.5;
  p.x *= uRes.x / max(uRes.y, 1.0);               // aspect

  // Camera over a horizon at the very bottom; the curtains rise as big ribbons.
  vec3 ro = vec3(0.0, 0.0, -6.7);
  vec3 rd = normalize(vec3(p.x * 1.1, p.y * 0.48 + 0.22, 1.3));   // horizon ~uv.y 0.04

  // Slow, majestic morph — the aurora reshapes gently, it does not race.
  float dens = 0.0;
  if (rd.y > 0.0) dens = auroraDensity(ro, rd, uTime * 0.16);
  dens = smoothstep(0.0, 0.95, dens);

  // Vertical cap: cover the bottom, fade out a little past the middle. A single
  // smooth envelope (NO per-column cut) keeps the curtains CONTINUOUS.
  float cap = smoothstep(0.62, 0.16, uv.y);       // full <=0.16, gone >=0.62
  dens *= cap;

  // Continuous green base hugging the bottom so the whole width is covered —
  // no horizontal gaps; the ribbons rise out of it.
  float base = smoothstep(0.24, 0.0, uv.y);

  // Height-based emission: green body -> teal -> magenta -> PINK at the tips.
  float h = clamp(uv.y / 0.50, 0.0, 1.0);         // 0 base .. 1 near the middle
  vec3 green   = vec3(0.26, 1.00, 0.52);
  vec3 teal    = vec3(0.32, 0.95, 0.82);
  vec3 magenta = vec3(0.92, 0.34, 0.90);
  vec3 pink    = vec3(1.00, 0.58, 0.80);
  vec3 cc = mix(green, teal, smoothstep(0.00, 0.30, h));
  cc = mix(cc, magenta, smoothstep(0.40, 0.74, h));
  cc = mix(cc, pink,    smoothstep(0.68, 1.00, h));

  vec3 col = cc * dens * 1.7;
  col += green * base * 0.42;                      // continuous base fill

  // Soft bloom on the brightest ribbon cores (luminous emission).
  float lum0 = max(col.r, max(col.g, col.b));
  col += col * smoothstep(0.55, 1.30, lum0) * 0.45;

  float a = clamp(max(col.r, max(col.g, col.b)) * 1.5, 0.0, 1.0);
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

    this._onResize();
    this._play();
  }

  disconnectedCallback() {
    this._pause();
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
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
