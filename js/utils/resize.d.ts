/**
 * Tipos de resize.js, para os modulos .ts que o importam sem o tsc reclamar de
 * modulo sem declaracao. Mesma razao do tab_manager.d.ts e do rewind.d.ts.
 *
 * Cobre as cinco exportacoes do resize.js. Apague o arquivo quando o resize.js
 * virar .ts.
 */

/** A largura da arvore de arquivos, passada pela regra de tamanho dos paineis. */
export function constrainFileTreeWidth(w: number): number;

/** A altura do terminal, passada pela mesma regra no eixo vertical. */
export function constrainTerminalHeight(h: number): number;

/** Guarda a altura do terminal, e so quando ela e utilizavel (nao grava o colapso). */
export function persistTerminalHeight(h: number): void;

/** A largura util para os paineis laterais: a da faixa principal menos os trilhos de borda. */
export function faixaDosPaineis(): number;

/** Aplica um tamanho sem a transicao do CSS (o arranque nao tem o que animar). */
export function semAnimar(el: HTMLElement | null, aplicar: () => void): void;
