/**
 * <aurora-canvas>, the signature ambient aurora (TODO.md, design principles).
 *
 * Sky-spanning aurora-borealis curtains seen in perspective: a volumetric ray
 * march whose depth reads as 3D sheets receding into the night sky, coloured by
 * march depth (green base -> teal -> cyan -> violet -> magenta tips). A few
 * overlapping bands merge into one connected, sinuous ribbon; a lower vertical
 * FILAMENT fringe hangs from the curtains; the shape morphs slowly IN PLACE (no
 * lateral translation) while extra bands fade in and out on an irregular period.
 * The march is nimitz's "Auroras" (ShaderToy XtGGRt, 2017); we discard nimitz's
 * colour and paint by depth. The look was tuned live in a prototype and the
 * approved constants (SOFT/FIL/BANDS/CONN/…) are baked into FRAG below.
 *
 *  - Drift, never pulse: motion is nimitz's slow in-place tri-noise morph plus a
 *    slow per-band appear/vanish envelope. No translation.
 *  - Full quality or nothing: the effect always renders at full resolution. The
 *    per-pixel march is heavy, so a capability gate watches the frame pacing and
 *    REMOVES the aurora on a GPU that can't sustain it (leaving just the SAPHO
 *    wordmark), it never shows a downscaled/soft version. The loop is capped at
 *    ~30fps (the drift is slow enough that this is imperceptible, not a quality
 *    change) and the rAF pauses off-screen / unfocused. Static CSS-gradient
 *    fallback on prefers-reduced-motion or missing WebGL.
 *
 * Self-registering vanilla custom element (works inside the Shadow DOM of
 * <aurora-welcome>). Attributes:
 *  - intensity : 0..1 overall brightness (default 0.85)
 *  - speed     : time multiplier for the morph (default 1)
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
// Aurora borealis, sky-spanning perspective curtains. The volumetric march is
// nimitz's "Auroras" (XtGGRt, 2017): a layered ray-march whose DEPTH reads as a
// 3D curtain receding into the sky. We colour it by march depth, stack a few
// OVERLAPPING bands into one connected ribbon, add a lower vertical FILAMENT
// fringe, and let the shape morph slowly IN PLACE. The constants below are the
// settings approved while tuning the effect live in the prototype.
// ============================================================================

const float SOFT   = 0.79;   // contrast / softness of the sheet
const float FIL    = 0.35;   // vertical-ray filament fringe
const float BANDS  = 0.94;   // strength of the extra overlapping bands
const float CONN   = 0.51;   // connective tissue that bridges the clusters
const float SWEEP  = 0.76;   // hue-sweep amplitude
const float HSPEED = 0.49;   // hue-sweep speed
const float SPREAD = 0.88;   // spatial hue spread across the width
const float SAT    = 1.10;   // saturation
const float HEIGHT = 0.64;   // horizon height — where the curtains sit

mat2 mm2(in float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
const mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
float tri(in float x){ return clamp(abs(fract(x) - 0.5), 0.01, 0.49); }
vec2 tri2(in vec2 p){ return vec2(tri(p.x) + tri(p.y), tri(p.y + tri(p.x))); }
float hash21(in vec2 n){ return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }

// 1-D value-noise fbm, smooth low-frequency detail for the filament striation.
float vn1(float x){ float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(hash21(vec2(i, 9.1)), hash21(vec2(i + 1.0, 9.1)), u); }
float fbm1(float x){ float v = 0.0, a = 0.55; for (int i = 0; i < 4; i++){ v += a * vn1(x); x = x * 2.0 + 1.3; a *= 0.5; } return v; }

// nimitz tri-noise, a continuous field whose gradient rotates over time, so the
// curtain shape morphs IN PLACE (no translation).
float triNoise2d(in vec2 p, float spd, float time){
  float z  = 1.8;
  float z2 = 2.5;
  float rz = 0.0;
  p *= mm2(p.x * 0.06);
  vec2 bp = p;
  for (int i = 0; i < 5; i++){
    vec2 dg = tri2(bp * 1.85) * 0.75;
    dg *= mm2(time * spd);          // time-rotated gradient -> in-place morph
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

// Cheap RGB hue rotation about the luma axis (radians), the slow colour sweep.
vec3 hueShift(vec3 col, float a){
  const vec3 k = vec3(0.57735);
  float c = cos(a), s = sin(a);
  return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
}

// Aurora palette as a 0..1 ramp: green base -> teal -> cyan -> violet -> magenta
// -> pink tips. Driven by march DEPTH, so the curtain gradients along its length.
vec3 auroraRamp(float h){
  h = clamp(h, 0.0, 1.0);
  vec3 green   = vec3(0.26, 1.00, 0.52);
  vec3 teal    = vec3(0.30, 0.96, 0.80);
  vec3 cyan    = vec3(0.28, 0.78, 1.00);
  vec3 violet  = vec3(0.60, 0.46, 1.00);
  vec3 magenta = vec3(0.95, 0.36, 0.92);
  vec3 pink    = vec3(1.00, 0.62, 0.84);
  vec3 c = mix(green, teal,    smoothstep(0.00, 0.22, h));
  c = mix(c, cyan,    smoothstep(0.20, 0.42, h));
  c = mix(c, violet,  smoothstep(0.40, 0.60, h));
  c = mix(c, magenta, smoothstep(0.58, 0.80, h));
  c = mix(c, pink,    smoothstep(0.78, 1.00, h));
  return c;
}

// nimitz's perspective aurora march (rgb + alpha). The layered march over rising
// height gives DEPTH: near samples read as the bright lower fringe, far samples
// recede up the curtain. baseH sets the altitude of this sheet; phase decorrelates
// stacked bands. A high-freq striation near the lower edge adds the ray filaments.
vec4 aurora3D(vec3 ro, vec3 rd, float time, float baseH, float phase){
  vec4 col = vec4(0.0);
  vec4 avg = vec4(0.0);
  for (int i = 0; i < 40; i++){
    float fi = float(i);
    float of = 0.006 * hash21(gl_FragCoord.xy) * smoothstep(0.0, 15.0, fi);
    float pt = ((baseH + pow(fi, 1.4) * 0.002) - ro.y) / (rd.y * 2.0 + 0.4);
    pt -= of;
    vec3 bpos = ro + pt * rd;
    float rzt = triNoise2d(bpos.zx + vec2(phase), 0.06, time);
    // Vertical filament fringe, strongest near the hanging lower edge (small fi).
    // Kept moderate frequency + gentle carve so it doesn't alias/crawl at low res.
    float edge = smoothstep(22.0, 2.0, fi);
    float st = fbm1(bpos.z * (6.0 + FIL * 18.0) + bpos.x * 2.2 + time * 0.08);
    rzt *= mix(1.0, mix(0.55, 1.20, smoothstep(0.30, 0.72, st)), FIL * edge);
    vec3 c = auroraRamp(fi / 39.0);
    vec4 col2 = vec4(c * rzt, rzt);
    avg = mix(avg, col2, 0.5);
    col += avg * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 5.0, fi);
  }
  col *= clamp(rd.y * 15.0 + 0.4, 0.0, 1.0);
  return col * 1.8;
}

// Per-band time envelope: two incommensurate sines, so a band waxes and wanes on
// an irregular period -> aurorae that appear and vanish, never a clean loop.
float bandEnv(float t, float s){
  return clamp(0.40 + 0.60 * (sin(t * 0.055 + s) * 0.6 + sin(t * 0.023 + s * 2.3) * 0.4), 0.0, 1.0);
}

void main(){
  // Centred, aspect-correct camera so the curtains span the sky in perspective.
  float aspect = uRes.x / max(uRes.y, 1.0);
  vec2 uvc = vec2((gl_FragCoord.x / uRes.x - 0.5) * aspect, gl_FragCoord.y / uRes.y - 0.5);
  uvc.y += (HEIGHT - 0.5);                 // horizon height: where the curtains sit
  vec3 ro = vec3(0.0, 0.0, -6.7);
  vec3 rd = normalize(vec3(uvc, 1.3));
  float time = uTime * 0.12;               // slow, in-place shape morph

  // Base band: always present (continuity), only its shape morphs + gently breathes.
  vec4 aur = aurora3D(ro, rd, time, 0.80, 0.0)
           * mix(0.82, 1.0, 0.5 + 0.5 * sin(uTime * 0.030));
  // Extra bands at close altitudes so they OVERLAP into one connected ribbon; each
  // slowly appears and vanishes in place (a change of form, not of location).
  aur += aurora3D(ro, rd, time, 1.02,  9.3) * (BANDS * bandEnv(uTime, 1.7));
  aur += aurora3D(ro, rd, time, 1.24, 18.7) * (BANDS * 0.85 * bandEnv(uTime, 4.9));

  // Connect the clusters: lift faint connective density (gamma < 1) and lower the
  // visibility threshold so a continuous sheet bridges the bright cores.
  aur = pow(max(aur, vec4(0.0)), vec4(mix(1.0, 0.55, CONN)));
  float hi = mix(1.1, 1.7, SOFT) * mix(1.0, 0.68, CONN);
  aur = smoothstep(vec4(0.0), vec4(hi), aur);

  // Slow hue sweep + spatial spread across the width, then saturation.
  float drift = sin(uTime * HSPEED + uvc.x * 3.14159 * SPREAD) * SWEEP * 1.1;
  aur.rgb = hueShift(aur.rgb, drift);
  float l = dot(aur.rgb, vec3(0.299, 0.587, 0.114));
  aur.rgb = mix(vec3(l), aur.rgb, SAT);

  vec3 col = aur.rgb;
  // Faint green horizon glow at the very bottom, like a real skyline.
  float hb = smoothstep(-0.30, -0.5, uvc.y);
  col += vec3(0.26, 1.0, 0.52) * hb * 0.14;
  float a = max(clamp(aur.a * 1.5, 0.0, 1.0), hb * 0.14);

  // Soft bloom on the brightest ribbon cores.
  float lum = max(col.r, max(col.g, col.b));
  col += col * smoothstep(0.6, 1.35, lum) * 0.28;

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
    // Cap the ambient effect at ~30fps. The march is heavy per pixel and the
    // curtain morph is deliberately slow, so 30fps looks identical to 60/120
    // while cutting shader invocations 2-4x, the biggest lever against the
    // welcome-screen stall on integrated GPUs.
    this._minFrameMs = 1000 / 30;
    // Capability gate, NEVER degrades quality. The shader runs at full quality
    // or not at all. On hardware too weak to sustain it (integrated-only PCs,
    // where force_high_performance_gpu has no discrete GPU to switch to), watch
    // the achieved frame pacing and, if it can't keep up, REMOVE the aurora
    // entirely, leaving the plain welcome + SAPHO wordmark. No reduced-quality
    // tier, no soft fallback.
    this._lastRenderAt = 0;   // wall clock of the previous rendered frame
    this._avgFrameMs = 0;     // rolling avg of the rendered-frame interval
    this._renderCount = 0;    // rendered frames since play began (gate warmup)
    this._gated = false;      // once true, the gate removed the effect (decide once)
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
    // high-performance: on a machine with a discrete GPU, run this heavy
    // per-pixel march there instead of the integrated GPU. The old 'low-power'
    // hint pinned it to the iGPU, which stalled even on strong desktops (the
    // dGPU sat idle while the iGPU choked). With the fps + resolution caps above
    // bounding the work, letting the real GPU take it is the right trade.
    const opts = { alpha: true, antialias: false, premultipliedAlpha: false, depth: false, powerPreference: 'high-performance' };
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
    // Full-quality render at native resolution (capped at 1.5x so a 4K/retina
    // panel doesn't allocate an absurd buffer, but no cost-driven downscale). We
    // never render a soft version to keep up: a GPU that can't sustain full
    // quality gets the effect REMOVED by the capability gate instead.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
    // Back-date _last by one interval so the first tick renders immediately
    // instead of being throttled away.
    this._last = performance.now() - this._minFrameMs;
    // Don't count the paused gap as one giant frame in the capability gate.
    this._lastRenderAt = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  _pause() {
    this._running = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }

  _tick(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick);
    // Throttle to ~30fps. Advancing _last by whole frame intervals keeps a
    // stable cadence instead of drifting with rAF jitter.
    const dt = now - this._last;
    if (dt < this._minFrameMs) return;
    this._last = now - (dt % this._minFrameMs);
    this._render((now - this._start) / 1000);
    this._sampleAndGate(now);
  }

  // Capability gate: watch the achieved rendered-frame interval and, if this GPU
  // can't sustain the full-quality effect after a short warmup, remove it. Never
  // downscales, full quality or none. Capable GPUs sit near the 33ms target and
  // never trip the threshold.
  _sampleAndGate(now) {
    if (this._gated) return;
    const rt = this._lastRenderAt ? (now - this._lastRenderAt) : this._minFrameMs;
    this._lastRenderAt = now;
    this._renderCount++;
    if (this._renderCount <= 12) return;   // warmup: shader compile + first draws jank
    this._avgFrameMs = this._avgFrameMs ? this._avgFrameMs * 0.85 + rt * 0.15 : rt;
    // >70ms sustained (~<14fps) once we have enough samples: this GPU can't run
    // the effect. Remove it. The 70ms line sits far above a healthy 33ms, so a
    // capable GPU (or a brief hitch) never triggers a false removal.
    if (this._renderCount >= 30 && this._avgFrameMs > 70) this._gate();
  }

  // Not enough GPU for the full-quality aurora: tear the effect down entirely and
  // leave the plain welcome (just the SAPHO wordmark). No degraded fallback.
  _gate() {
    if (this._gated) return;
    this._gated = true;
    this._pause();
    this.style.display = 'none';   // hide the whole host -> aurora gone, SAPHO stays
    if (this._observer) { this._observer.disconnect(); this._observer = null; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('blur', this._onVisibility);
    window.removeEventListener('focus', this._onVisibility);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._canvas) { this._canvas.remove(); this._canvas = null; }
    if (this._gl) {
      const lose = this._gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      this._gl = null;
    }
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
