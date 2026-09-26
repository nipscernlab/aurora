/**
 * classificacao_do_terminal.ts: o tipo de cada linha de saida, a contagem por
 * tipo e o filtro dos botoes de erro, aviso, sucesso e dica.
 *
 * Tudo sai do texto ou do DOM, sem estado: a contagem e refeita do que esta na
 * tela, que e a unica fonte honesta de "quantos de cada tipo estao visiveis".
 * Saiu do terminal_module.js (TODO 13.3).
 */

export type TipoDeMensagem = 'error' | 'warning' | 'success' | 'tips' | 'plain';
export type Filtro = 'error' | 'warning' | 'success' | 'tips';
export interface Contagem { error: number; warning: number; success: number; tips: number }

/** Uma resposta de executavel, ou o texto ja junto. */
type Saida = string | { stdout?: string | null; stderr?: string | null };

export function contagemZerada(): Contagem {
  return { error: 0, warning: 0, success: 0, tips: 0 };
}

export function tipoDaMensagem(content: Saida): TipoDeMensagem {
  const text = typeof content === 'string' ?
    content :
    (content.stdout || '') + ' ' + (content.stderr || '');

  // C-toolchain style: `<file>:<line>: error: ...` / `warning: ...`.
  // Catches lowercase iverilog / yosys / gcc-style diagnostics that
  // the older substring checks (`'ERROR'`, `'Warning'`) miss.
  // Checked first because it's the most specific (token + colon).
  if (/\berror:/i.test(text)) return 'error';
  if (/\bwarning:/i.test(text)) return 'warning';

  if (text.includes('Atenção') || text.includes('Warning')) return 'warning';
  if (text.includes('Erro') || text.includes('ERROR')) return 'error';
  if (text.includes('Sucesso') || text.includes('Success')) return 'success';
  if (text.includes('Info') || text.includes('Tip')) return 'tips';
  if (text.includes('não está sendo usada') || text.includes('Economize memória')) return 'tips';
  if (text.includes('de sintaxe') || text.includes('cadê a função')) return 'error';

  return 'plain';
}

/** Quantos de cada tipo ha no terminal: cartao agrupado conta cada mensagem, info conta como dica. */
export function contarMensagens(terminal: Element): Contagem {
  const counts = contagemZerada();
  terminal.querySelectorAll('.log-entry').forEach((entry) => {
    let type: Filtro | null = null;
    if (entry.classList.contains('error'))   type = 'error';
    else if (entry.classList.contains('warning')) type = 'warning';
    else if (entry.classList.contains('success')) type = 'success';
    else if (entry.classList.contains('tips') || entry.classList.contains('info')) type = 'tips';
    if (!type) return;

    // Grouped card: count each child message individually.
    const grouped = entry.querySelectorAll('.grouped-message');
    counts[type] += grouped.length > 0 ? grouped.length : 1;
  });
  return counts;
}

/**
 * O cartao entra no filtro? Os botoes sao erro / aviso / sucesso / dica, mas
 * o terminal pinta dois sabores de dica (`.tips`, do compilador, e `.info`,
 * das notas da AURORA), com o mesmo visual; o filtro tem de tratar os dois
 * como um, senao o contador diz 5 e o filtro mostra zero. A mesma
 * equivalencia da contagem.
 */
export function cartaoPassaNoFiltro(card: Element, filter: string): boolean {
  if (filter === 'tips') {
    return card.classList.contains('tips') || card.classList.contains('info');
  }
  return card.classList.contains(filter);
}

/** Mostra e esconde os cartoes do terminal pelos filtros ativos e pelo modo detalhado. */
export function aplicarFiltro(terminal: Element, ativos: Set<string>, detalhado: boolean): void {
  // "All four filters active" is semantically the same as "no
  // filter", every category is included. Treat it like the empty
  // set so the user gets the obvious "I clicked everything ON,
  // therefore I should see everything" behaviour.
  const activeCount = ativos.size;
  const hasActiveFilters = activeCount > 0 && activeCount < 4;

  terminal.querySelectorAll('.log-entry').forEach((c) => {
    const card = c as HTMLElement;
    const hasLineLinks = card.querySelector('.line-link') !== null;

    // Verbose-off path. Plain (unclassified) cards stay hidden unless they
    // carry a `line N` link: those are compile diagnostics the user must
    // always be able to click through to. The line-link override must not
    // bypass the TYPE filter too, or any error/warning with a line number
    // shows up under every filter.
    if (!detalhado && card.classList.contains('plain')) {
      card.style.display = hasLineLinks ? '' : 'none';
      return;
    }

    if (!hasActiveFilters) {
      card.style.display = '';
      return;
    }

    const matchesAny = [...ativos].some((t) => cartaoPassaNoFiltro(card, t));
    card.style.display = matchesAny ? '' : 'none';
  });
}

/** A saida do GTKWave sem o ruido de inicializacao. */
export function semRuidoDoGtkwave<T extends { stdout?: string | null; stderr?: string | null }>(result: T): T & { stdout: string; stderr: string } {
  const noisePrefixes = [
    'GTKWave Analyzer',
    'FSTLOAD |',
    'GTKWAVE |',
    'WM Destroy',
    '[0] start time',
    '[0] end time',
  ];

  const filterLines = (text: string | null | undefined) => {
    if (!text) return '';
    return text.split('\n')
      .filter((line) => !noisePrefixes.some((prefix) => line.trim().startsWith(prefix)))
      .join('\n');
  };

  return {
    ...result,
    stdout: filterLines(result.stdout),
    stderr: filterLines(result.stderr),
  };
}
