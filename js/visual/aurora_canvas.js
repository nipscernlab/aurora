/**
 * <aurora-canvas> — the signature ambient aurora (docs/DESIGN.md §7).
 *
 * A real aurora borealis rendered with a WebGL fragment shader: slow,
 * continuous, drifting curtains in the brand spectrum (mint → teal → cyan →
 * violet). It is the product's namesake done with restraint — used ONLY on
 * non-blocking chrome (welcome screen, splash), never behind reading text.
 *
 * Design constraints honoured here:
 *  - Drift, never pulse: a single slow noise field over `--dur-ambient` feel.
 *  - Cheap: renders at a capped device-pixel-ratio (half-res) and upscales.
 *  - Polite: pauses the rAF loop when off-screen (IntersectionObserver) or
 *    when the window loses focus; stops entirely on prefers-reduced-motion or
 *    when WebGL is unavailable, falling back to a static CSS gradient.
 *
 * Self-registering vanilla custom element — no framework dependency, so it
 * loads under the current renderer architecture. Attributes:
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

float hash(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + 11.1; a *= 0.5; }
  return v;
}

// The aurora ribbon — green-dominant like the real thing (oxygen 557nm), with
// teal/cyan mid-tones rising into nitrogen violet → magenta → pink at the tips.
vec3 ribbon(float t){
  vec3 green = vec3(0.298, 0.886, 0.560);
  vec3 teal  = vec3(0.310, 0.827, 0.761);
  vec3 cyan  = vec3(0.357, 0.722, 0.910);
  vec3 viol  = vec3(0.580, 0.470, 0.950);
  vec3 mag   = vec3(0.820, 0.420, 0.880);
  vec3 pink  = vec3(0.960, 0.500, 0.720);
  vec3 c = mix(green, teal, smoothstep(0.00, 0.26, t));
  c = mix(c, cyan, smoothstep(0.26, 0.48, t));
  c = mix(c, viol, smoothstep(0.48, 0.70, t));
  c = mix(c, mag,  smoothstep(0.70, 0.87, t));
  c = mix(c, pink, smoothstep(0.87, 1.00, t));
  return c;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  float aspect = uRes.x / uRes.y;
  // Mild horizontal stretch so the sheet spans the full width with broad
  // features (a full aspect stretch clustered everything into one side).
  float x = uv.x * aspect * 0.55;
  float t = uTime * 0.07;

  // The whole sheet sways and breathes laterally.
  float sway = fbm(vec2(x * 0.7 + t * 0.25, 0.7)) - 0.5;

  // Broad curtain density across x. High bias + gentle curve so the sheet reads
  // as a LUMINOUS green body (not a faint grey wash) while still varying —
  // and no column ever fully dies (the old "disappears from places" bug).
  float dens = fbm(vec2(x * 1.5 + sway * 1.4 + t * 0.40, uv.y * 0.45 + t * 0.06));
  dens = pow(clamp(dens + 0.34, 0.0, 1.0), 1.1);

  // Bright vertical rays/streamers — the primary aurora structure (the "comb").
  float rays = fbm(vec2(x * 7.0 + sway * 2.2 - t * 0.32, uv.y * 1.4 + t * 0.08));
  rays = pow(rays, 1.5);

  // Streamers rooted at the bottom; tongues reach higher where density is
  // strong, with soft fading tops. A full-width airglow base fills the floor.
  float reach  = 0.45 + 0.55 * dens;
  float env    = smoothstep(reach + 0.45, -0.05, uv.y);
  float ground = smoothstep(0.55, -0.15, uv.y);

  float glow = (rays * 1.0 + 0.5) * dens * env + ground * 0.55 * (0.5 + dens);

  // Hue rises green → teal/cyan → violet → magenta/pink at the tips, with sway
  // shifting the bands laterally so the colour isn't in flat horizontal stripes.
  float ct  = clamp(uv.y * 0.95 + sway * 0.34, 0.0, 1.0);
  vec3  col = ribbon(ct) * glow;

  // Magenta/pink lower fringe (nitrogen) hugging the base of the curtains —
  // the warm rim a real aurora shows where the green meets the horizon.
  float fringe = smoothstep(0.32, 0.02, uv.y) * smoothstep(0.05, 0.20, glow);
  col = mix(col, vec3(0.96, 0.45, 0.72), fringe * 0.5);

  // Brighter output overall so the curtains have real colour and life.
  float alpha = clamp(glow * 1.9, 0.0, 1.0) * uIntensity;
  gl_FragColor = vec4(col * uIntensity * 1.7, alpha);
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
