/**
 * texto_do_terminal.ts: o texto traduzido dos terminais e o tamanho em bytes
 * legivel. Saiu do terminal_module.js (TODO 13.3).
 */

/**
 * O texto traduzido, ou a reserva em ingles.
 *
 * Estes rotulos estavam fixos em ingles: quem usa a AURORA em portugues via
 * ingles no meio da tela.
 */
export function tr(chave: string, reserva: string): string {
  const f = typeof window !== 'undefined' ? window.t : null;
  if (typeof f !== 'function') return reserva;
  const v = f(chave);
  return (v && v !== chave) ? v : reserva;
}

/** 1234567 -> "1.2 MB": o pill do dump atualiza varias vezes por segundo. */
export function formatarBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
