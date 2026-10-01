/**
 * Tipos de rewind.js, para os modulos .ts que o importam sem o tsc reclamar de
 * modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * rewind.js virar .ts.
 */

/** Abre um ponto de retorno. Melhor esforco: falha vira null, sem lancar. */
export function marcarPonto(meta?: Record<string, unknown>): Promise<unknown>;

/** Um ponto de retorno gravado; `mensagemId` liga o ponto a mensagem que o marcou. */
export interface PontoDeRetorno { id: string; mensagemId?: string; [campo: string]: unknown }

/** Os pontos gravados, do mais recente para o mais antigo. Falha vira lista vazia. */
export function listarPontos(): Promise<PontoDeRetorno[]>;

/** Volta o projeto a um ponto, perguntando antes. Devolve se voltou. */
export function voltarAoPonto(id: string, ponto?: PontoDeRetorno | null): Promise<boolean>;

/** O rotulo do ponto marcado por um pedido: o comeco do texto, numa linha, cortado em `max`. */
export function rotuloDoPedido(texto: string, max?: number): string;
