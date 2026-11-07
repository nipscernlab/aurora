/**
 * cartao_da_web.ts: o WebFetch e o WebSearch do Claude passam pelo cartao de
 * permissao do painel.
 *
 * Os dois eram pre-aprovados (native_tools.ts) e nao tinham cartao: uma
 * instrucao escondida num arquivo do projeto, num anexo ou numa pagina lida
 * podia mandar a assistente ler um arquivo e envia-lo pela web no endereco ou
 * na consulta, e ninguem via. A web nao vira ferramenta mcp__aurora__ como as
 * outras que precisam de uma pessoa, porque a busca e do servico da Anthropic
 * e nao tem como ser refeita aqui. Entao o motor do Agent SDK registra um
 * gancho PreToolUse que pergunta ao painel pelo mesmo caminho das ferramentas
 * da AURORA (tool_bridge.runTool, `ai:tool-exec`): o tool_runner reconhece o
 * pedido PEDIDO_DA_WEB, mostra o cartao conforme o modo de permissao e
 * responde se a pessoa permitiu.
 *
 * O caminho antigo da CLI (claude_code.ts, sem o SDK) nao tem gancho; nele a
 * web simplesmente nao e pre-aprovada, e o `dontAsk` a nega.
 *
 * Compilado por `tsc` (npm run build:ts) num cartao_da_web.js ao lado.
 */

import { TOOL_DEFAULT_MS } from './timeouts.js';

/** As ferramentas nativas que passam pelo cartao. */
export const WEB_COM_CARTAO: readonly string[] = ['WebFetch', 'WebSearch'];

/**
 * O nome do pedido que vai ao renderer. Repetido em js/ai/tool_runner.ts, que
 * nao pode importar do main; o teste cartaoDaWeb.test.js confere os dois.
 */
export const PEDIDO_DA_WEB = 'native_web_access';

/** Quem leva o pedido ao renderer: o tool_bridge.runTool, ou um falso no teste. */
export type LevarAoPainel<W> = (webContents: W, nome: string, args: Record<string, unknown>) => Promise<unknown>;

/** O que o SDK passa a um gancho PreToolUse, no que importa aqui. */
interface EntradaDoGancho { tool_name?: string; tool_input?: unknown }

/** A decisao do gancho, no formato do SDK (SyncHookJSONOutput). */
export interface DecisaoDoGancho {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason: string;
  };
}

/** A resposta do painel e um sim so quando diz `{ ok: true, data: { allowed: true } }`. */
function permitiu(resposta: unknown): boolean {
  if (!resposta || typeof resposta !== 'object') return false;
  const r = resposta as { ok?: unknown; data?: { allowed?: unknown } | null };
  return r.ok === true && r.data?.allowed === true;
}

/**
 * O gancho PreToolUse de uma janela. Ferramenta que nao e da web passa sem
 * decisao (objeto vazio: o resto das regras do turno vale). Na duvida, nega:
 * painel fechado, prazo vencido ou resposta estranha contam como "nao".
 */
export function ganchoDaWeb<W>(webContents: W, levar: LevarAoPainel<W>) {
  return async (entrada: EntradaDoGancho): Promise<DecisaoDoGancho> => {
    const nome = String(entrada?.tool_name ?? '');
    if (!WEB_COM_CARTAO.includes(nome)) return {};
    const args = entrada.tool_input && typeof entrada.tool_input === 'object'
      ? (entrada.tool_input as Record<string, unknown>)
      : {};
    let resposta: unknown = null;
    try { resposta = await levar(webContents, PEDIDO_DA_WEB, { tool: nome, ...args }); }
    catch (_) { resposta = null; }
    const sim = permitiu(resposta);
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: sim ? 'allow' : 'deny',
        permissionDecisionReason: sim ? 'The user allowed this web access.' : 'The user denied this action.',
      },
    };
  };
}

/**
 * Os `hooks` das opcoes do query() do SDK. O prazo do gancho passa um pouco o
 * do tool_bridge, para que seja o tool_bridge a encerrar um cartao esquecido
 * (resposta `ok:false`, que o gancho le como "nao") e nao o SDK.
 */
export function ganchosDaWeb<W>(webContents: W, levar: LevarAoPainel<W>) {
  return {
    PreToolUse: [{
      matcher: WEB_COM_CARTAO.join('|'),
      hooks: [ganchoDaWeb(webContents, levar)],
      timeout: Math.ceil(TOOL_DEFAULT_MS / 1000) + 10,
    }],
  };
}
