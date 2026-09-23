/**
 * tool_chip_text.ts: o texto de um chip de ferramenta no painel de IA.
 *
 * Um chip e a pastilha que aparece enquanto o modelo chama uma ferramenta da
 * AURORA. Ele mostra o nome, e ao passar o mouse mostra os argumentos e uma
 * previa do resultado. Nada disso e tela: e transformar dado em texto curto.
 *
 * Saiu do js/ui/ai_assistant_manager.js, que e uma classe de 4119 linhas com
 * 128 metodos. Estes quatro nao tocam em DOM, e enterrados la nao tinham como
 * ser testados sem subir o painel inteiro. Continua a abertura do arquivo que
 * o tests/unit/aiTurnFlow.test.js preparou: a rede por fora primeiro, o
 * codigo saindo por dentro depois.
 *
 * Compilado por `tsc` (npm run build:ts) num tool_chip_text.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Quanto do JSON dos argumentos cabe no `title` de um chip. */
const LIMITE_DOS_ARGUMENTOS = 800;
/** Quanto de cada linha cabe na dica de passar o mouse. */
const LIMITE_DA_DICA = 400;
/** Quanto de um resultado vale a pena guardar junto da conversa. */
const LIMITE_DO_RESULTADO = 4000;

/** `get_terminal_output` vira `get terminal output`. */
export function prettyToolName(name: unknown): string {
  return String(name || 'tool').replace(/_/g, ' ');
}

/**
 * Os argumentos como JSON indentado, cortado no limite.
 *
 * Parecido com o `previewArgs` do js/ai/tool_permission.js, mas NAO igual, e
 * a diferenca e de proposito onde importa: ali um objeto vazio vira texto
 * vazio, porque o dialogo de permissao nao mostra uma chave vazia; aqui vira
 * `{}`, porque o `title` do chip esta descrevendo uma chamada que de fato
 * aconteceu sem argumento. O que nao da para serializar vira texto vazio.
 */
export function formatArgsForTitle(args: unknown): string {
  try {
    const s = JSON.stringify(args, null, 2);
    return s.length > LIMITE_DOS_ARGUMENTOS ? `${s.slice(0, LIMITE_DOS_ARGUMENTOS)}…` : s;
  } catch (_) { return ''; }
}

/**
 * Reduz o resultado de uma ferramenta a um resumo pequeno e serializavel, que
 * e o que fica guardado junto da conversa.
 *
 * Conhece as duas formas que chegam: `{ ok, data }` da AuroraAPI e
 * `{ ok, content }` do Claude Code.
 *
 * DEFEITO CONHECIDO, preservado nesta extracao de proposito: quando o
 * `data` passa do limite, o corte e feito no TEXTO do JSON e o pedaco e
 * reparseado, o que praticamente sempre falha, porque cortar JSON no meio
 * produz JSON invalido. O resultado e `data: '[unserialisable]'` em vez de um
 * dado truncado. Vale para todo resultado grande. Consertar muda o que fica
 * gravado nas conversas, entao fica separado deste commit; o caso de teste
 * abaixo trava o comportamento de hoje e aponta para esta nota.
 */
export function summariseResult(result: unknown): any {
  if (result == null) return null;
  if (typeof result === 'string') return result.slice(0, LIMITE_DO_RESULTADO);
  if (typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if ('ok' in r) out.ok = !!r.ok;
  if ('error' in r && r.error) out.error = String(r.error).slice(0, 800);
  if ('content' in r && typeof r.content === 'string') {
    out.content = r.content.length > LIMITE_DO_RESULTADO
      ? r.content.slice(0, LIMITE_DO_RESULTADO) + '…'
      : r.content;
  }
  if ('data' in r) {
    try {
      const s = JSON.stringify(r.data);
      out.data = s.length > LIMITE_DO_RESULTADO ? JSON.parse(s.slice(0, LIMITE_DO_RESULTADO)) : r.data;
    } catch (_) { out.data = '[unserialisable]'; }
  }
  return out;
}

/** Corta um texto no limite e marca o corte. */
function cortar(texto: string, limite: number): string {
  return texto.length > limite ? texto.slice(0, limite) + '…' : texto;
}

/**
 * A dica de passar o mouse: os argumentos e uma previa do resultado, uma
 * linha cada. Linha que nao tem o que dizer nao aparece.
 */
export function formatToolTooltip(args: unknown, result: unknown): string {
  const lines: string[] = [];
  if (args && Object.keys(args as object).length) {
    const a = formatArgsForTitle(args);
    if (a) lines.push(`args: ${a}`);
  }
  if (result) {
    const r = summariseResult(result);
    if (typeof r === 'string') {
      lines.push(`result: ${cortar(r, LIMITE_DA_DICA)}`);
    } else if (r != null) {
      try {
        lines.push(`result: ${cortar(JSON.stringify(r), LIMITE_DA_DICA)}`);
      } catch (_) { /* ignore */ }
    }
  }
  return lines.join('\n');
}
