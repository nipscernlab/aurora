/**
 * manual_citation.ts: transformar o resultado da ferramenta `cite_manual` numa
 * citacao do manual do SAPHO.
 *
 * Uma citacao e o que permite a pessoa conferir uma afirmacao da assistente
 * contra o manual, clicando e caindo no trecho. Por isso o que NAO vira
 * citacao importa tanto quanto o que vira: uma citacao sem trecho ou sem
 * pagina e um link morto, e um link morto faz o leitor concluir que a
 * assistente inventou a referencia, que e o oposto do que ela existe para
 * fazer.
 *
 * O NOME DA FERRAMENTA CHEGA DE DOIS JEITOS. Pela API vem `cite_manual`; pela
 * assinatura vem `mcp__aurora__cite_manual`, porque o servidor MCP prefixa
 * tudo. Casar pelo fim do nome atende os dois sem uma tabela de traducao que
 * ia divergir.
 *
 * E O RESULTADO TAMBEM CHEGA DE DOIS JEITOS, que e o que quebrou na primeira
 * tentativa. Pela API o objeto vem inteiro em `result.data`. Pela assinatura
 * ele passa pelo servidor MCP, que o serializa com `JSON.stringify`
 * (main/ai/aurora_mcp_server.js), e a ponte entrega `{ ok, content: '<json>' }`
 * (main/ai/claude_code.js). Ler so o primeiro formato fazia a ferramenta
 * rodar, o chip dizer "done" e a citacao nao aparecer: tudo certo, e nada na
 * tela.
 *
 * Saiu do js/ui/ai_assistant_manager.js, a classe de 4058 linhas. Esta parte
 * nao tem tela nenhuma, e era justamente a que tinha as duas formas de
 * entrada para acertar.
 *
 * Compilado por `tsc` (npm run build:ts) num manual_citation.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Uma citacao pronta para entrar na conversa. */
export interface CitacaoDoManual {
  /** Caminho da pagina dentro do manual. */
  pagina: string;
  titulo: string;
  /** A frase citada, que e o que o clique vai procurar e realcar. */
  trecho: string;
  /**
   * A versao do manual na hora da citacao. Nao serve para hoje: serve para
   * daqui a um mes, quando alguem reabrir a conversa e a frase nao estiver
   * mais la. Sem ela aquilo e um link morto; com ela, e "esta citacao e do
   * manual 6.4.2".
   */
  versao: string;
}

/** O nome e da ferramenta de citar, com ou sem o prefixo do servidor MCP. */
export function ehFerramentaDeCitacao(toolName: unknown): boolean {
  return String(toolName || '').endsWith('cite_manual');
}

/**
 * O corpo de um resultado de ferramenta, venha ele por qual caminho vier.
 *
 * Nunca lanca: um resultado que nao for JSON simplesmente nao vira citacao.
 */
export function corpoDoResultado(resultado: any): any {
  if (!resultado || resultado.ok === false) return null;
  if (resultado.data) return resultado.data;
  if (typeof resultado.content === 'string') {
    try {
      const j = JSON.parse(resultado.content);
      if (j && j.ok === false) return null;
      return (j && j.data) || j;
    } catch (_) { return null; }
  }
  return resultado;
}

/**
 * A citacao que um resultado de ferramenta produz, ou `null`.
 *
 * `null` quando a ferramenta nao e a de citar, quando o resultado nao traz
 * corpo, ou quando falta a pagina ou o trecho. Recusar em silencio aqui e de
 * proposito: quem fica sabendo da recusa e o modelo, pelo resultado da
 * ferramenta, e nao a pessoa, por um aviso que ela nao pode resolver.
 *
 * @param versaoPadrao a versao do manual instalado, usada quando o proprio
 *   resultado nao declara uma
 */
export function citacaoDeResultado(
  toolName: unknown,
  resultado: any,
  versaoPadrao: string = '',
): CitacaoDoManual | null {
  if (!ehFerramentaDeCitacao(toolName)) return null;
  const d = corpoDoResultado(resultado);
  if (!d || !d.quote || !d.path) return null;
  return {
    pagina: d.path,
    titulo: d.title || d.path,
    trecho: d.quote,
    versao: d.manualVersion || versaoPadrao || '',
  };
}

/**
 * A citacao ja esta na lista do turno?
 *
 * Pagina mais trecho identificam: o mesmo trecho da mesma pagina citado duas
 * vezes no mesmo turno e uma repeticao, nao duas fontes.
 */
export function citacaoJaEsta(
  lista: readonly CitacaoDoManual[] | null | undefined,
  citacao: CitacaoDoManual,
): boolean {
  if (!Array.isArray(lista)) return false;
  return lista.some((c) => c.pagina === citacao.pagina && c.trecho === citacao.trecho);
}
