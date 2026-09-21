/**
 * Tipos de help_link.js, para os modulos .ts abrirem a ajuda contextual sem o
 * tsc reclamar de modulo sem declaracao. Mesma razao do electron_api.d.ts ao
 * lado do electron_api.js.
 *
 * Declaracao PARCIAL: so o `abrirAjudaDe`, que e o que os .ts ja migrados
 * chamam. Apague este arquivo quando o help_link.js virar .ts.
 */

/**
 * Abre a pagina do manual associada a uma chave da tabela de ajuda. Chave
 * desconhecida resolve sem abrir nada, de proposito: um modal sem ajuda
 * cadastrada nao deve quebrar por causa disso.
 */
export function abrirAjudaDe(chave: string): Promise<unknown>;
