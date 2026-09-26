/**
 * barra_de_progresso.ts: a barra do teste de hardware no THTEST.
 *
 * UM elemento que se atualiza no lugar: criado na primeira chamada, mutado
 * depois. NAO e um .log-entry, entao o filtro de verbose e os contadores o
 * ignoram e ele fica sempre visivel. O preenchimento anda a cada quadro, e nao
 * a cada linha de stdout, e a estimativa de tempo sai da taxa media desde a
 * primeira atualizacao. Saiu do terminal_module.js (TODO 13.3), que so decide
 * em qual terminal ela mora.
 */

/** A barra, com o estado da animacao e da estimativa pendurado no proprio no. */
export interface BarraDeProgresso extends HTMLDivElement {
  _label: HTMLElement;
  _pct: HTMLElement;
  _fill: HTMLElement;
  _meta: HTMLElement;
  /** % pintado agora (float, a origem da animacao). */
  _displayPct: number;
  /** % para onde a animacao vai. */
  _targetPct: number;
  /** Relogio na primeira atualizacao contada (estimativa). */
  _t0: number | null;
  /** Ciclos em _t0. */
  _c0: number;
  /** Relogio da atualizacao anterior. */
  _lastUpdateAt: number | null;
  /** Intervalo suavizado entre atualizacoes (duracao da animacao). */
  _emaInterval: number | null;
  _runDone?: boolean;
  _raf?: number | null;
  _hideTimer?: ReturnType<typeof setTimeout> | null;
  _removeTimer?: ReturnType<typeof setTimeout> | null;
  _animFrom?: number;
  _animT0?: number;
  _animDur?: number;
}

/** O que o teste de hardware informa a cada atualizacao. */
export interface Progresso {
  pct?: number;
  cyc?: number;
  total?: number;
  reads?: number;
  label?: string;
  done?: boolean;
}

const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * A barra deste terminal: cria se nao houver (ou se saiu do DOM), e senao a
 * move para o fim, para ela ficar colada embaixo mesmo com linhas chegando
 * entre as atualizacoes.
 */
export function barraNoTerminal(terminal: Element, atual: BarraDeProgresso | null | undefined): BarraDeProgresso {
  let el = atual;
  if (!el || !el.isConnected) {
    // Real DOM progress bar (replaces the old ASCII █░ string): a label
    // row, an aurora-gradient fill on a track, and a meta line. The fill
    // is driven frame-by-frame by animarBarra (not a CSS transition),
    // so it creeps continuously between the discrete stdout updates.
    el = document.createElement('div') as BarraDeProgresso;
    el.className = 'hw-progress';
    el.innerHTML =
      '<div class="hw-progress-head">' +
        '<span class="hw-progress-label"></span>' +
        '<span class="hw-progress-pct"></span>' +
      '</div>' +
      '<div class="hw-progress-track"><div class="hw-progress-fill"></div></div>' +
      '<div class="hw-progress-meta"></div>';
    el._label = el.querySelector('.hw-progress-label') as HTMLElement;
    el._pct = el.querySelector('.hw-progress-pct') as HTMLElement;
    el._fill = el.querySelector('.hw-progress-fill') as HTMLElement;
    el._meta = el.querySelector('.hw-progress-meta') as HTMLElement;
    el._displayPct = 0;
    el._targetPct = 0;
    el._t0 = null;
    el._c0 = 0;
    el._lastUpdateAt = null;
    el._emaInterval = null;
  }
  terminal.appendChild(el);
  return el;
}

/**
 * Aplica uma atualizacao. `aoSair` roda quando a barra terminada sai da tela
 * sozinha, para quem guarda a referencia a esquecer.
 */
export function atualizarBarra(el: BarraDeProgresso, p: Progresso, aoSair: () => void): void {
  // A new run reusing the same card: cancel any pending auto-hide + un-hide.
  if (el._hideTimer) { clearTimeout(el._hideTimer); el._hideTimer = null; }
  if (el._removeTimer) { clearTimeout(el._removeTimer); el._removeTimer = null; }
  el.classList.remove('hiding');

  const done = !!p.done;
  el._label.textContent = p.label || '';
  el.classList.toggle('done', done);

  // Resolve the target as a FLOAT. Callers hand us a pre-rounded integer
  // pct, but cyc/total carries the full precision, and rounding first is
  // itself a source of stepping (many updates land on the same integer,
  // then one jumps a whole point). Prefer the raw ratio when we have it.
  const total = p.total as number;
  const cyc = p.cyc as number;
  const exact = (total > 0 && p.cyc != null) ? (cyc / total) * 100 : (p.pct || 0);
  const pct = Math.max(0, Math.min(100, exact));

  // Is this a NEW run inheriting a card the last one left behind (the
  // auto-hide hasn't fired yet, or the run failed and never retired it)?
  // Two tells: the card already finished and we're moving again, or the
  // target fell well below what's painted. Both are impossible within a
  // run, progress there is monotonic, so either means "start over".
  // This matters because the rest of the card's state (the % floor, the
  // ETA baseline, the update-rate EMA) all assume a single run; carried
  // over, they would pin the bar at the old 100% and quote a nonsense ETA.
  if ((el._runDone && !done) || pct < (el._displayPct || 0) - 5) {
    if (el._raf) { cancelAnimationFrame(el._raf); el._raf = null; }
    el._displayPct = pct;
    el._targetPct = pct;
    el._t0 = null;            // ETA re-baselines off this run's first update
    el._c0 = 0;
    el._lastUpdateAt = null;  // don't smooth across the gap between runs
    el._emaInterval = null;
  }
  el._runDone = done;

  // Tween duration = the SMOOTHED gap between updates, so the fill arrives
  // at each value just as the next one lands and the motion reads as one
  // continuous creep. Using the raw last gap made this jerky: stdout arrives
  // in bursts, so a burst produced a near-zero duration (the bar leapt)
  // followed by a long silence (it sat frozen). An EMA rides through the
  // bursts and tracks the real average rate instead.
  const nowP = agora();
  if (el._lastUpdateAt != null) {
    const gap = nowP - el._lastUpdateAt;
    el._emaInterval = (el._emaInterval == null)
      ? gap
      : (el._emaInterval * 0.7 + gap * 0.3);
  }
  el._lastUpdateAt = nowP;
  const growMs = done
    ? 260                                                    // finish: settle quickly
    : Math.max(180, Math.min(el._emaInterval ?? 600, 4000));
  animarBarra(el, pct, growMs);

  // ETA from the average rate since the first counted update.
  const now = agora();
  if (el._t0 == null && cyc > 0) { el._t0 = now; el._c0 = cyc; }
  let etaTxt = '';
  if (!done && el._t0 != null && cyc > el._c0) {
    const rate = (cyc - el._c0) / (now - el._t0);   // cyc per ms
    if (rate > 0 && total > cyc) {
      etaTxt = ` · ~${formatarEta((total - cyc) / rate)} left`;
    }
  }
  // `reads` e o TOTAL de leituras de entrada (somando todos os input_<N>),
  // entao o rotulo agregado "leituras" cabe mesmo com varias entradas.
  const readsWord = (typeof window !== 'undefined' && window.t)
    ? window.t('terminal.htest.reads') : 'reads';
  const tail = (p.reads != null) ? ` · ${p.reads} ${readsWord}` : '';
  el._meta.textContent = done
    ? `${p.total}/${p.total}${tail} · done`
    : `${p.cyc}/${p.total}${tail}${etaTxt}`;

  // Hold the completed (solid-green) bar a few seconds, then retire it.
  if (done) {
    el._hideTimer = setTimeout(() => {
      el.classList.add('hiding');
      el._removeTimer = setTimeout(() => {
        try { el.remove(); } catch (_) { /* already gone */ }
        aoSair();
      }, 420);   // matches the .hiding opacity transition
    }, 3200);
  }
}

/**
 * Drive the fill AND the percentage from one rAF loop, so the two can never
 * disagree and the bar moves every frame rather than once per stdout update.
 *
 * Retargeting mid-flight is the point: each update rewrites the tween's
 * from/target/clock while the loop keeps running, so the fill bends toward
 * the new value from wherever it currently sits, no restart, no snap. That
 * is why the loop reads `el._*` on every frame instead of closing over the
 * arguments, and why a live loop is reused instead of being cancelled and
 * replaced.
 */
export function animarBarra(el: BarraDeProgresso, target: number, dur: number): void {
  // Never walk backwards: a late/out-of-order update would otherwise make
  // the bar visibly retreat. Progress is monotonic by construction.
  el._targetPct = Math.max(el._displayPct || 0, target);
  el._animFrom = el._displayPct || 0;
  el._animT0 = agora();
  el._animDur = Math.max(1, dur);

  if (el._raf) return;   // loop already live — it picks the new target up

  const step = () => {
    const k = Math.min(1, (agora() - (el._animT0 as number)) / (el._animDur as number));
    const from = el._animFrom as number;
    const val = from + (el._targetPct - from) * k;
    el._displayPct = val;
    el._fill.style.transform = `scaleX(${val / 100})`;
    el._pct.textContent = `${Math.round(val)}%`;
    el._raf = (k < 1) ? requestAnimationFrame(step) : null;
  };
  el._raf = requestAnimationFrame(step);
}

/** Tira a barra na hora, com os temporizadores e a animacao pendentes. */
export function derrubarBarra(el: BarraDeProgresso | Element | null | undefined): void {
  if (!el) return;
  const b = el as BarraDeProgresso;
  if (b._hideTimer) { clearTimeout(b._hideTimer); b._hideTimer = null; }
  if (b._removeTimer) { clearTimeout(b._removeTimer); b._removeTimer = null; }
  if (b._raf) { cancelAnimationFrame(b._raf); b._raf = null; }
  try { b.remove(); } catch (_) { /* already detached */ }
}

/** Format a millisecond ETA as a compact `Ns` / `Mm Ss` string. */
export function formatarEta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}
