/**
 * jank_overlay.js — Development performance HUD (§4.4 / G7).
 *
 * Measures and displays in real-time:
 *  • FPS (instantaneous, last frame)
 *  • p99 frame time over a 300-frame rolling window
 *  • Jank rate: % of frames that exceed 2× the 165Hz budget (~12ms)
 *  • Longtask count (PerformanceObserver, tasks > 50ms)
 *  • TTI approximation (domInteractive from the navigation entry)
 *
 * Zero cost when inactive — rAF loop + PerformanceObserver only run while
 * the overlay is visible. Toggle via Command Palette: "Toggle Jank Overlay".
 * Dynamic import in the command prevents any boot cost.
 */

const BUDGET_MS = 1000 / 165; // ~6.06 ms at 165 Hz
const RING      = 300;         // ~5 s of history at 60 fps

class JankOverlay {
  constructor() {
    this._el        = null;
    this._running   = false;
    this._buf       = new Float32Array(RING);
    this._head      = 0;
    this._count     = 0;
    this._longtasks = 0;
    this._raf       = 0;
    this._lastTs    = 0;
    this._obs       = null;
  }

  toggle() { this._running ? this._hide() : this._show(); }

  _show() {
    if (this._running) return;
    this._running = true;
    this._count = 0; this._head = 0; this._longtasks = 0; this._lastTs = 0;
    this._build();
    this._startObs();
    const tick = (ts) => {
      if (!this._running) return;
      if (this._lastTs) {
        this._buf[this._head] = ts - this._lastTs;
        this._head  = (this._head + 1) % RING;
        this._count = Math.min(this._count + 1, RING);
      }
      this._lastTs = ts;
      this._render();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _hide() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this._obs?.disconnect();
    this._el?.remove();
    this._el = null;
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'aurora-jank-overlay';
    Object.assign(el.style, {
      position: 'fixed', top: '8px', right: '8px', zIndex: '99999',
      background: 'rgba(10,13,20,0.93)', border: '1px solid rgba(95,224,176,0.25)',
      borderRadius: '8px', padding: '8px 12px',
      fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', lineHeight: '1.65',
      color: '#9CA1AE', minWidth: '190px',
      backdropFilter: 'blur(6px)', userSelect: 'none', pointerEvents: 'none',
    });
    document.body.appendChild(el);
    this._el = el;
  }

  _startObs() {
    try {
      this._obs = new PerformanceObserver((list) => {
        this._longtasks += list.getEntries().length;
      });
      this._obs.observe({ type: 'longtask', buffered: true });
    } catch (_) { /* not supported */ }
  }

  _p99() {
    if (this._count < 2) return 0;
    const slice = this._buf.slice(0, this._count).sort();
    return slice[Math.floor(slice.length * 0.99)] ?? 0;
  }

  _jankRate() {
    if (!this._count) return 0;
    let j = 0;
    for (let i = 0; i < this._count; i++) if (this._buf[i] > BUDGET_MS * 2) j++;
    return Math.round((j / this._count) * 100);
  }

  _tti() {
    // aurora-interactive mark (set at the end of DOMContentLoaded in main init)
    const mark = performance.getEntriesByName('aurora-interactive')[0];
    if (mark) return Math.round(mark.startTime);
    // Fallback: domInteractive from the navigation entry
    const nav = performance.getEntriesByType?.('navigation')[0];
    return nav ? Math.round(nav.domInteractive) : null;
  }

  _color(val, warn, bad, okColor = '#5DE0A8') {
    return val >= bad ? '#E26C6C' : val >= warn ? '#E8B86C' : okColor;
  }

  _render() {
    if (!this._el) return;
    const p99  = this._p99();
    const last = this._buf[(this._head - 1 + RING) % RING];
    const fps  = last > 0 ? Math.min(999, Math.round(1000 / last)) : 0;
    const jr   = this._jankRate();
    const tti  = this._tti();
    const b    = BUDGET_MS.toFixed(1);

    this._el.innerHTML = `
<span style="color:#5FE0B0;font-weight:700;letter-spacing:.02em">⬡ Jank Overlay</span>
<div style="margin-top:3px;border-top:1px solid rgba(95,224,176,.15);padding-top:3px">
  <div>FPS &nbsp;&nbsp;&nbsp;&nbsp;<span style="color:${this._color(fps,55,30,'#5DE0A8')};font-weight:600">${fps}</span></div>
  <div>p99 frame <span style="color:${this._color(p99, BUDGET_MS, BUDGET_MS * 2)};font-weight:600">${p99.toFixed(1)} ms</span> <span style="opacity:.55">(${b} budget)</span></div>
  <div>Jank rate <span style="color:${this._color(jr,3,10)};font-weight:600">${jr}%</span></div>
  <div>Longtasks <span style="color:${this._color(this._longtasks,1,5)};font-weight:600">${this._longtasks}</span></div>
  <div>TTI &nbsp;&nbsp;&nbsp;&nbsp;<span style="color:#9CA1AE">${tti != null ? tti + ' ms' : '—'}</span></div>
</div>`;
  }
}

const _overlay = new JankOverlay();

export function toggleJankOverlay() { _overlay.toggle(); }
