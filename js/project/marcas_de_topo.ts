/**
 * marcas_de_topo.ts: o topo de cada categoria quando o .spf o guarda duas vezes.
 *
 * O .spf diz qual e o top level e qual e o testbench atual em dois lugares: no
 * campo escalar (topLevelFile, testbenchFile) e na marca isTopLevel da entrada
 * na lista. A compilacao segue o escalar (compilation_helpers.ts); a arvore lia
 * so a marca e, ao salvar, reescrevia o escalar a partir dela. Um .spf com o
 * escalar preenchido e a marca desligada, que a AURORA nao grava mas um .spf
 * escrito a mao ou por outra ferramenta pode ter, perdia o testbench na
 * primeira compilacao. Aqui a regra passa a ser a mesma da compilacao: o
 * escalar ganha, quando aponta para um arquivo da lista.
 */

interface ArquivoComMarca {
  path: string;
  category?: string;
  isTopLevel?: boolean;
}

/** Acerta, no lugar, a marca de topo dos arquivos de `categoria` pelo escalar. */
export function aplicarTopoDoSpf(
  arquivos: ArquivoComMarca[],
  categoria: 'synthesizable' | 'testbench',
  escalar: unknown,
  normalizar: (caminho: string) => string,
): void {
  if (typeof escalar !== 'string' || !escalar.trim()) return;
  const alvo = normalizar(escalar);
  const daCategoria = arquivos.filter((f) => f.category === categoria);
  if (!daCategoria.some((f) => normalizar(f.path) === alvo)) return;
  for (const f of daCategoria) f.isTopLevel = normalizar(f.path) === alvo;
}
