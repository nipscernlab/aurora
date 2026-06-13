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

// Continuous flowing aurora — adapted from nimitz's "Auroras" (ShaderToy
// XtGGRt). A tri-noise field is marched in depth and accumulated, so the
// curtains read as ONE continuous, drifting sheet rather than discrete bands.
mat2 mm2(in float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
const mat2 m2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
float tri(in float x){ return clamp(abs(fract(x) - 0.5), 0.01, 0.49); }
vec2 tri2(in vec2 p){ return vec2(tri(p.x) + tri(p.y), tri(p.y + tri(p.x))); }
float hash21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }

float triNoise2d(in vec2 p, float spd, float time){
  float z = 1.8, z2 = 2.5, rz = 0.0;
  p *= mm2(p.x * 0.06);
  vec2 bp = p;
  for (int i = 0; i < 5; i++){
    vec2 dg = tri2(bp * 1.85) * 0.75;
    dg *= mm2(time * spd);
    p -= dg / z2;
    bp *= 1.3; z2 *= 0.45; z *= 0.42;
    p *= 1.21 + (rz - 1.0) * 0.02;
    rz += tri(p.x + tri(p.y)) * z;
    p *= -m2;
  }
  return clamp(1.0 / pow(rz * 29.0, 1.3), 0.0, 0.55);
}

vec4 aurora(vec3 ro, vec3 rd, float time){
  vec4 col = vec4(0.0);
  vec4 avgCol = vec4(0.0);
  for (int i = 0; i < 36; i++){
    float fi = float(i);
    float of = 0.006 * hash21(gl_FragCoord.xy) * smoothstep(0.0, 15.0, fi);
    float pt = ((0.8 + pow(fi, 1.4) * 0.002) - ro.y) / (rd.y * 2.0 + 0.4);
    pt -= of;
    vec3 bpos = ro + pt * rd;
    vec2 p = bpos.zx;
    float rzt = triNoise2d(p, 0.06, time);
    vec4 col2 = vec4(0.0, 0.0, 0.0, rzt);
    // Continuous green → cyan → violet → magenta sweep along the march.
    col2.rgb = (sin(1.0 - vec3(2.15, -0.5, 1.2) + fi * 0.043) * 0.5 + 0.5) * rzt;
    avgCol = mix(avgCol, col2, 0.5);
    col += avgCol * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 5.0, fi);
  }
  col *= clamp(rd.y * 15.0 + 0.4, 0.0, 1.0);
  return col * 1.8;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;          // 0..1, y up
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes.xy) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, -6.7);
  // Flip Y: the bright body of the aurora now sits at the BOTTOM of the panel
  // and the loop's own rd.y gate fades it toward the top — so it rises from the
  // bottom AND stays bright, instead of being masked away (which nearly erased
  // it). Curtains reach UP into the content area, faded.
  vec3 rd = normalize(vec3(p.x, -p.y * 0.80 + 0.18, 1.0));

  vec3 col = aurora(ro, rd, uTime * 0.5).rgb;

  // Richer palette: tint the visible (lower) curtains toward violet → magenta →
  // pink so they carry warm colour alongside the oxygen green.
  float warm = smoothstep(0.62, 0.06, uv.y);    // strongest low, where it's bright
  col = mix(col, col * vec3(1.5, 0.72, 1.7) + vec3(0.08, 0.0, 0.16) * length(col), warm * 0.5);

  // Soft green airglow hugging the very bottom edge.
  col += vec3(0.10, 0.32, 0.22) * smoothstep(0.26, -0.05, uv.y) * 0.16;

  float lum = max(col.r, max(col.g, col.b));
  float alpha = clamp(lum * 1.8, 0.0, 1.0) * uIntensity;
  gl_FragColor = vec4(col * uIntensity * 1.85, alpha);
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
