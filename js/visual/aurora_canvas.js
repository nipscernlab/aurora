/**
 * <aurora-canvas> — the signature ambient aurora (docs/DESIGN.md §7).
 *
 * A bottom-anchored aurora-borealis LANDSCAPE rendered with a WebGL fragment
 * shader: thin vertical filament curtains rising from the horizon (the lower
 * edge) in the brand spectrum (mint → teal → cyan → violet, with a violet/
 * magenta fringe at the base), drifting and swaying continuously. The light is
 * concentrated in the lower band and fades to nothing by mid-height so UI text
 * over it stays legible. It is the product's namesake done with restraint —
 * used on non-blocking chrome (the welcome screen), never behind reading text.
 *
 * Design constraints honoured here:
 *  - Drift, never pulse: motion is purely positional (lateral drift, domain
 *    warp/sway, per-thread shimmer) — nothing scales the whole frame's bright-
 *    ness, so it breathes like a real aurora over `--dur-ambient` time.
 *  - Cheap: textureless analytic value-noise + a bounded 11-filament loop, no
 *    ray-marching; renders at a capped device-pixel-ratio (half-res) and
 *    upscales. Comfortably holds the 165fps target.
 *  - Polite: pauses the rAF loop when off-screen (IntersectionObserver) or when
 *    the window loses focus; stops entirely on prefers-reduced-motion or when
 *    WebGL is unavailable, falling back to a static CSS gradient.
 *
 * Self-registering vanilla custom element — no framework dependency, so it
 * loads under the current renderer architecture (and works inside the Shadow
 * DOM of <aurora-welcome>). Attributes:
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
// AURORA — bottom-anchored filament landscape.
// Layered analytic painting: warm-green horizon airglow + an anisotropic
// (vertically-stretched) domain-warped FBM veil body + a bounded loop of
// squared-Lorentzian vertical filaments with ragged drifting tops + a violet/
// magenta base fringe + additive bloom on the brightest threads. No textures,
// no ray-marching, no derivatives. (Designed via a judged multi-approach pass.)
// ============================================================================

// -- hash + analytic value noise (no textures, no derivatives) ---------------
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// 2D value noise with quintic interpolation (smoother, premium gradients).
float vnoise(vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i + vec2(0.0, 0.0));
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave FBM, each octave gently rotated so streaks never grid-align.
// Constant bounds, fixed lacunarity/gain.
float fbm(vec2 p){
  float v = 0.0;
  float amp = 0.5;
  float tot = 0.0;
  mat2 rot = mat2(0.86, 0.50, -0.50, 0.86);
  for (int i = 0; i < 5; i++){
    v   += amp * vnoise(p);
    tot += amp;
    p    = rot * p * 2.02;
    amp *= 0.5;
  }
  return v / tot;
}

// 1-D smooth value noise used to sway / ragged-top each filament independently.
float n1(float x){
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash21(vec2(i, 7.3)), hash21(vec2(i + 1.0, 7.3)), u);
}

void main(){
  // Normalized coords, y-UP (y = 0 at the bottom / horizon).
  vec2  uv     = gl_FragCoord.xy / uRes.xy;
  float aspect = uRes.x / max(uRes.y, 1.0);
  // x scaled by aspect so filament SPACING & WIDTH are constant on wide canvases.
  float ax = (uv.x - 0.5) * aspect;
  float t  = uTime;

  // -- Vertical emission envelope (the LANDSCAPE gate) ---------------------
  // Emission in the lower ~40%, faded to nothing by ~mid-height. Master gate.
  float env  = smoothstep(0.62, 0.0, uv.y);   // 1 at horizon -> 0 by ~0.62
  env = env * env;                            // bias the energy lower
  float base = smoothstep(0.20, -0.02, uv.y); // very-bottom fringe gate

  // -- Slow domain-warp / sway ---------------------------------------------
  // A large-scale, time-drifting warp leans the whole curtain field. Pure
  // positional offset -> the sheet slides & bends, it never throbs.
  float warpA = fbm(vec2(ax * 0.9 - t * 0.045, uv.y * 0.5 + t * 0.018));
  float warpB = fbm(vec2(ax * 1.7 + 9.3 + t * 0.030, uv.y * 0.35 - t * 0.012));
  float sway  = (warpA - 0.5) * 0.55 + (warpB - 0.5) * 0.30;

  // -- (1) Warm-green airglow hugging the horizon --------------------------
  // Wide, slow lateral undulation of glow brightness (drift, not pulse).
  float glowWave = 0.5 + 0.5 * sin(ax * 1.3 + t * 0.10);
  float airglow  = smoothstep(0.34, -0.05, uv.y) * (0.55 + 0.45 * glowWave);

  // -- (2) Anisotropic FBM veil — the soft body of the curtain -------------
  // High horizontal freq, LOW vertical freq -> vertical streaks. The warp/sway
  // bends each streak; lateral drift slides the whole sheet.
  vec2  vp   = vec2((ax + sway) * 2.6 - t * 0.06, uv.y * 0.55 + t * 0.05);
  float veil = fbm(vp);
  // A finer streak layer for inner shimmer, its own drift clock.
  float fine = fbm(vec2((ax + sway) * 6.1 + t * 0.13, uv.y * 0.9 - t * 0.04));
  veil = mix(veil, veil * (0.6 + 0.8 * fine), 0.45);
  veil = smoothstep(0.34, 0.92, veil);        // crisp soft sheets toward threads
  float veilField = veil * env;

  // -- (3) Sharp vertical filaments threading through ----------------------
  // Bounded analytic accumulation: each filament is a narrow squared-Lorentzian
  // band whose x-centre DRIFTS and SWAYS with height. Per-thread amplitude is
  // steady — only position moves. Ragged noise tops + a phase-decorrelated
  // shimmer + nearest-image wrap for seamless wide canvases.
  float fil   = 0.0;   // soft filament density
  float hotF  = 0.0;   // brighter "hot" threads (bloom seeds)
  const int N = 11;
  for (int i = 0; i < N; i++){
    float fi   = float(i);
    float seed = fi * 13.17;
    float id   = n1(seed);                          // stable per-thread random

    // Even-ish spacing across the aspect-corrected field, jittered per thread.
    float lane = (fi + 0.5) / float(N);             // 0..1
    float cx   = (lane - 0.5) * aspect * 1.9;
    // Lateral drift: slow, per-thread direction & speed (positional only).
    cx += sin(t * (0.06 + 0.018 * fi) + seed) * 0.42;
    // Sway with height: the thread leans as it rises (curtain shimmer), and the
    // shared warp bends it too so neighbours move coherently, not in a comb.
    float swayT = (n1(uv.y * 3.0 + t * 0.18 + seed) - 0.5) * 0.55;
    cx += (swayT + sway * 0.6) * (0.4 + uv.y);

    // Distance to thread centre in aspect-space, WRAPPED so a thread leaving one
    // side re-enters the other — no edge gaps on wide-short canvases.
    float dx = ax - cx;
    dx -= aspect * floor(dx / aspect + 0.5);        // nearest-image wrap

    // Per-thread width breathes with height (wider near the horizon feet).
    float w    = (0.016 + 0.012 * id) + 0.010 * (1.0 - uv.y);
    // Squared Lorentzian -> thin crisp thread + cheap soft bloom shoulder.
    float band = w / (dx * dx + w * w);
    band *= band;

    // Ragged, noise-driven top height — uneven curtain edge that itself
    // shimmers slowly. Taller threads on some lanes.
    float topN  = n1(cx * 1.7 + seed + t * 0.05);
    float reach = mix(0.28, 0.56, id) + (topN - 0.5) * 0.14;  // ~0.21..0.63
    float tall  = smoothstep(reach, 0.0, uv.y);
    // Lift off the very-bottom seam so feet aren't a hard line.
    float foot  = smoothstep(0.0, 0.06, uv.y);

    // Per-thread brightness shimmer — phase-offset, stays in [0.78,1.0] so it
    // reads as twinkle/drift ALONG the curtain, never a global throb.
    float shimmer = 0.89 + 0.11 * sin(t * (0.30 + 0.22 * id) + fi * 2.1);

    float thread = band * tall * foot * shimmer;
    fil += thread;
    // ~Every third lane is a brighter hot thread (bloom seed).
    float hotMask = step(0.66, fract(fi * 0.37 + 0.5));
    hotF += thread * hotMask;
  }
  fil  *= 0.020;                                     // normalise accumulation
  hotF *= 0.020;
  float filField = fil * env;

  // -- Brand palette -------------------------------------------------------
  vec3 mint    = vec3(0.373, 0.878, 0.690);   // #5FE0B0  O2 557nm — MAIN body
  vec3 teal    = vec3(0.310, 0.827, 0.761);   // #4FD3C2
  vec3 cyan    = vec3(0.357, 0.722, 0.910);   // #5BB8E8
  vec3 violet  = vec3(0.557, 0.514, 0.910);   // #8E83E8  N2 — lower fringe
  vec3 magenta = vec3(0.886, 0.486, 0.753);   // #E27CC0  rare, at the very base

  // Vertical emission gradient: green dominates the body; violet/magenta hug
  // the base. A touch of veil noise so colour bands aren't perfectly flat.
  float h = uv.y + (veil - 0.5) * 0.06;
  vec3 grad = magenta;
  grad = mix(grad, violet, smoothstep(0.02, 0.12, h));
  grad = mix(grad, cyan,   smoothstep(0.10, 0.24, h));
  grad = mix(grad, teal,   smoothstep(0.20, 0.36, h));
  grad = mix(grad, mint,   smoothstep(0.28, 0.52, h));

  // -- Compose -------------------------------------------------------------
  vec3 col = vec3(0.0);
  col += grad * veilField * 0.85;                    // (2) soft anisotropic body
  col += grad * filField  * 1.35;                    // (3) crisp filaments
  // (1) warm-green airglow biased to mint/teal regardless of gradient.
  col += mix(mint, teal, 0.35) * airglow * env * 0.45;

  // (4) violet/magenta base fringe — only the very bottom, drifting laterally.
  float fringeWave = 0.5 + 0.5 * sin(ax * 2.1 - t * 0.08);
  vec3  fringeCol  = mix(violet, magenta, 0.45 * fringeWave);
  col += fringeCol * base * (0.20 + 0.20 * fringeWave);

  // -- Additive glow / bloom around the brightest threads ------------------
  float hot = hotF * env;
  col += mix(mint, cyan, 0.3) * hot * 0.9;           // bright core
  col += grad * hot * veil * 0.5;                    // cheap wider halo

  // Bloom lift on the brightest peaks for luminous emission.
  float lum0 = max(col.r, max(col.g, col.b));
  col += col * smoothstep(0.45, 1.1, lum0) * 0.5;

  // Gentle tone curve so bright filaments bloom without clipping harshly.
  col = col / (1.0 + col * 0.6);
  col *= 1.55;

  // -- Straight (non-premultiplied) alpha ----------------------------------
  // Alpha rises with luminance toward the bright lower filaments; the envelope
  // already drove colour to ~0 up top. A hard top cut guarantees a clean upper
  // half so UI text reads over the deep-night background.
  float lum   = max(col.r, max(col.g, col.b));
  float alpha = clamp(lum * 1.15, 0.0, 1.0);
  alpha *= smoothstep(0.66, 0.10, uv.y);             // hard guarantee: clear top

  // Master intensity multiplies BOTH rgb and alpha.
  col   *= uIntensity;
  alpha *= uIntensity;

  gl_FragColor = vec4(col, alpha);
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
