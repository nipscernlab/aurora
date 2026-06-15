/**
 * complex_decode.ts — pre-pass de decodificacao dos numeros complexos do SAPHO
 * pro Surfer.
 *
 * O Surfer nao tem o process-filter externo do GTKWave (`^>N <exe>`, que roda o
 * comp2gtkw.exe sobre os bits crus em tempo de render) e o "mapping translator"
 * dele e' uma tabela ESTATICA valor->string. Entao decodificar complexo no
 * Surfer e' um PRE-PASS: extraimos os valores DISTINTOS que os sinais complexos
 * assumem no dump (via fst2vcd), decodificamos cada um com o proprio
 * comp2gtkw.exe (binario canonico do GTKWave) e assamos um mapping
 * `bitpattern -> "re imi"` que o Surfer mostra direto.
 *
 * Encoding (comp2gtkw.c): os 16 primeiros bits sao auto-descritivos —
 * bits[0:8]=nbm (largura da mantissa), bits[8:16]=nbe (largura do expoente);
 * depois `re` e `im`, cada um com nbits=nbm+nbe+1 bits (total 16+2*nbits).
 * Aqui so EXTRAIMOS o bitpattern; a aritmetica do decode roda no comp2gtkw.exe.
 *
 * Este modulo e' PURO (sem fs/spawn): a orquestracao (stream do fst2vcd + IPC do
 * comp2gtkw) vive no compilation_module. Compilado por tsc -> complex_decode.js.
 */

/** Prefixos dos sinais complexos que o asmcomp emite (scalar + array). */
export const COMPLEX_PREFIXES = ['comp_me3_', 'comp_arr_me3_'];

export function isComplexName(name: string): boolean {
  return COMPLEX_PREFIXES.some((p) => name.startsWith(p));
}

/** Ha algum sinal complexo nos scopes parseados? (gate do pre-pass.) */
export function hasComplexSignals(scopes: Array<{ signals: Array<{ name: string }> }>): boolean {
  return scopes.some((s) => s.signals.some((sig) => isComplexName(sig.name)));
}

/** Zero-extend MSB-first ate `width` (o VCD pode truncar zeros a' esquerda). */
function zeroExtend(bits: string, width: number): string {
  if (bits.length >= width) return bits.slice(bits.length - width);
  return '0'.repeat(width - bits.length) + bits;
}

/**
 * Scanner INCREMENTAL do stream de texto VCD do fst2vcd. Coleta o conjunto de
 * valores DISTINTOS (zero-extended a' largura do sinal) de TODOS os sinais
 * complexos — a uniao basta, ja' que o decode depende so do bitpattern, nao do
 * sinal. Memoria limitada: so o buffer de linha + o Set de distintos (pequeno;
 * complexos sao variaveis de programa, mudam pouco). Cap defensivo via maxValues.
 */
export class ComplexVcdScanner {
  private buf = '';
  private inBody = false;
  private idWidth = new Map<string, number>(); // id VCD -> largura (so complexos)
  private values = new Set<string>();
  private capped = false;
  constructor(private readonly maxValues = 16384) {}

  feed(chunk: string): void {
    if (this.capped || !chunk) return;
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      this.line(this.buf.slice(0, i));
      this.buf = this.buf.slice(i + 1);
      if (this.capped) { this.buf = ''; return; }
    }
  }

  end(): void { if (this.buf) { this.line(this.buf); this.buf = ''; } }

  private line(raw: string): void {
    const t = raw.trim();
    if (!t) return;
    if (!this.inBody) {
      if (t.startsWith('$enddefinitions')) { this.inBody = true; return; }
      if (t.startsWith('$var')) { this.parseVar(t); }
      return;
    }
    // corpo: so interessam value-changes de vetor `b<bits> <id>`.
    const c = t.charCodeAt(0);
    if (c !== 98 && c !== 66) return; // 'b' / 'B'
    const sp = t.indexOf(' ');
    if (sp < 0) return;
    const w = this.idWidth.get(t.slice(sp + 1).trim());
    if (w === undefined) return;
    this.values.add(zeroExtend(t.slice(1, sp), w));
    if (this.values.size >= this.maxValues) this.capped = true;
  }

  private parseVar(t: string): void {
    // $var <type> <width> <id> <name> [range] $end
    const p = t.split(/\s+/);
    if (p.length < 5) return;
    const width = parseInt(p[2], 10);
    if (Number.isFinite(width) && isComplexName(p[4])) this.idWidth.set(p[3], width);
  }

  /** Valores binarios distintos (so os totalmente 0/1; x/z sao descartados). */
  distinctValues(): string[] {
    return [...this.values].filter((v) => /^[01]+$/.test(v));
  }

  wasCapped(): boolean { return this.capped; }
}

/**
 * Monta o mapping translator do Surfer pros complexos: header `Name=` (SEM
 * `Bits=` — a largura varia por formato de processador, e o match e' por valor)
 * + uma linha `0b<bits> <re imi>` por valor decodificado. Sem entradas decodadas
 * -> retorna null (nao criar mapping vazio, que o Surfer rejeita).
 */
export function buildComplexMapping(name: string, decodedByValue: Map<string, string>): { name: string; content: string } | null {
  const lines = [`Name = ${name}`];
  let n = 0;
  for (const [bits, dec] of decodedByValue) {
    if (!dec) continue;
    lines.push(`0b${bits} ${dec}`);
    n++;
  }
  return n === 0 ? null : { name, content: lines.join('\n') + '\n' };
}
