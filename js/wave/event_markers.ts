/**
 * event_markers.ts — pre-pass que acha os TEMPOS dos eventos de I/O do SAPHO no
 * dump (via fst2vcd) pra cravar MARCADORES automaticos no Surfer e medir a
 * LATENCIA entrada->saida.
 *
 * Marca o primeiro `req_in_sim_*` em alta (a entrada chegou) e o primeiro
 * `out_en_sim_*` em alta (a saida ficou pronta). Com os dois markers + a janela
 * de delta do Surfer (show_cursor_window), o usuario le Y-X = latencia direto,
 * sem caçar os eventos a mao num trace de milhoes de ciclos.
 *
 * Modulo PURO (sem fs/spawn): a orquestracao (stream do fst2vcd) vive no
 * compilation_module, igual ao complex_decode. Para CEDO (done()) assim que acha
 * os dois eventos, entao normalmente le so o comeco do dump. Compilado por tsc.
 */

export interface EventMarker { time: number; label: 'input' | 'output' }

/** Ha sinais de I/O (req_in_sim_/out_en_sim_) pra marcar? (gate do pre-pass.) */
export function hasIoEventSignals(scopes: Array<{ signals: Array<{ name: string }> }>): boolean {
  return scopes.some((s) => s.signals.some((sig) =>
    /^req_in_sim_?\d+$/.test(sig.name) || /^out_en_sim_?\d+$/.test(sig.name)));
}

type Kind = 'input' | 'output';

/**
 * Scanner INCREMENTAL do stream de texto do fst2vcd. Acha o tempo do PRIMEIRO
 * `req_in_sim_*`=1 e do PRIMEIRO `out_en_sim_*`=1. O tempo e' o `#N` cru do VCD
 * (mesma unidade que o marker do Surfer usa). done() vira true quando os dois
 * foram achados — a orquestracao mata o fst2vcd cedo.
 */
export class EventScanner {
  private buf = '';
  private inBody = false;
  private time = 0;
  private idKind = new Map<string, Kind>(); // id VCD -> input/output (so req_in/out_en)
  private inputTime: number | null = null;
  private outputTime: number | null = null;
  private linesSeen = 0;
  constructor(private readonly maxLines = 2_000_000) {}

  feed(chunk: string): void {
    if (this.done() || this.capped() || !chunk) return;
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      this.lineOf(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + 1);
      if (this.done() || this.capped()) { this.buf = ''; return; }
    }
  }

  end(): void { if (this.buf) { this.lineOf(this.buf); this.buf = ''; } }

  private lineOf(raw: string): void {
    const t = raw.trim();
    if (!t) return;
    if (!this.inBody) {
      if (t.startsWith('$enddefinitions')) { this.inBody = true; return; }
      if (t.startsWith('$var')) this.parseVar(t);
      return;
    }
    this.linesSeen++;
    const c = t.charCodeAt(0);
    if (c === 35) { // '#': novo timestamp
      const n = parseInt(t.slice(1), 10);
      if (Number.isFinite(n)) this.time = n;
      return;
    }
    if (c === 49) { // '1<id>': sinal 1-bit em ALTA (req_in/out_en sao 1-bit)
      const k = this.idKind.get(t.slice(1));
      if (k === 'input') { if (this.inputTime === null) this.inputTime = this.time; }
      else if (k === 'output') { if (this.outputTime === null) this.outputTime = this.time; }
    }
  }

  private parseVar(t: string): void {
    const p = t.split(/\s+/); // $var <type> <width> <id> <name> [range] $end
    if (p.length < 5) return;
    const name = p[4];
    if (/^req_in_sim_?\d+$/.test(name)) this.idKind.set(p[3], 'input');
    else if (/^out_en_sim_?\d+$/.test(name)) this.idKind.set(p[3], 'output');
  }

  done(): boolean { return this.inputTime !== null && this.outputTime !== null; }
  capped(): boolean { return this.linesSeen >= this.maxLines; }

  /** Markers achados, em ordem (input primeiro). Vazio se nada encontrado. */
  markers(): EventMarker[] {
    const out: EventMarker[] = [];
    if (this.inputTime !== null) out.push({ time: this.inputTime, label: 'input' });
    if (this.outputTime !== null) out.push({ time: this.outputTime, label: 'output' });
    return out;
  }
}
