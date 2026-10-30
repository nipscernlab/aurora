/**
 * escapar_html.ts: texto qualquer pronto para entrar num innerHTML.
 *
 * Nome de arquivo, nome de pasta e o que a pessoa digita chegam a telas montadas
 * como HTML (a aba, o caminho acima do editor, o dialogo de alteracao nao salva).
 * O Windows nao aceita < > nem " em nome de arquivo, mas aceita & e ', e um
 * projeto clonado de outro sistema ou um caminho digitado nao passam por essa
 * regra. Escapar os cinco caracteres serve tanto para o texto entre tags quanto
 * para o valor de um atributo entre aspas, simples ou duplas (#276).
 */

export function escaparHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
