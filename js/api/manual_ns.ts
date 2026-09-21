/**
 * manual_ns.ts: o namespace `AuroraAPI.manual`.
 *
 * Extraido VERBATIM do js/api/aurora_api.js (item 4 do roadmap: dividir aquele
 * arquivo em um modulo por namespace), pela mesma razao do git_ns.js: aqui
 * dentro nao entra a cadeia de imports do editor, entao o modulo carrega num
 * teste sem subir a IDE inteira. O aurora_api.js importa `manualNs` daqui e o
 * expoe como `AuroraAPI.manual`.
 *
 * Compilado por `tsc` (npm run build:ts) num manual_ns.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ok, err } from './api_core.js';
import { motivoDe } from '../app/api_reply.js';

/** O `unknown` do catch, normalizado sem mudar o que corre em execucao. */
function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}


/* ============================================================
 *  O manual do SAPHO
 *
 *  O manual responde boa parte do que um aluno pergunta, e ate agora a IA nao
 *  sabia que ele existia. Despejar o conteudo no prompt nao e opcao: sao 1,2 MB
 *  de texto, mais do que a janela de varios modelos e caro em todos. Entao ela
 *  usa o mesmo caminho de uma pessoa, procurar e ler so a pagina que interessa.
 *
 *  Nenhuma das duas recebe pasta. O processo principal decide onde o manual
 *  esta, entre a copia atualizada e a que veio no instalador, e o modelo
 *  escolhe apenas o que procurar e qual pagina abrir.
 * ========================================================== */
export const manualNs = {
  /**
   * Procura no manual e devolve as paginas mais proximas, com um trecho de
   * cada uma. Acento na consulta e opcional.
   */
  async search(query: string, options?: Record<string, unknown>) {
    try {
      const r = await electronAPI.docsBuscar?.(query, options || {});
      if (!r?.ok) return err(motivoDe(r, 'Manual search failed'));
      return ok({ results: r.resultados || [], online: r.online });
    } catch (e) { return err(mensagemDe(e) || 'manual search failed'); }
  },

  /** O texto de uma pagina do manual, pelo caminho que a busca devolveu. */
  async read(pagePath: string, options?: Record<string, unknown>) {
    try {
      const r = await electronAPI.docsLer?.(pagePath, options || {});
      if (!r?.ok) return err(motivoDe(r, 'Manual page not found'));
      return ok({ path: r.caminho, title: r.titulo, text: r.texto, truncated: r.truncado });
    } catch (e) { return err(mensagemDe(e) || 'manual read failed'); }
  },

  /**
   * Confere uma citacao do manual contra o arquivo em disco.
   *
   * O modelo manda a pagina e o COMECO da frase; o que volta e o trecho inteiro
   * lido do arquivo. Recusa quando o localizador nao existe na pagina, e a
   * recusa e resposta legitima: sem ela, "verificar" seria so repetir o que o
   * modelo digitou.
   */
  async cite(pagePath: string, locator: string) {
    try {
      const r = await electronAPI.docsCitar?.(pagePath, locator);
      if (!r?.ok) return err(r?.erro || r?.error || 'citation could not be verified');
      return ok({ path: r.pagina, title: r.titulo, quote: r.trecho, manualVersion: r.versao });
    } catch (e) { return err(mensagemDe(e) || 'manual cite failed'); }
  },

  /** O manual esta instalado nesta maquina, e em que versao. */
  async status() {
    try {
      const r = await electronAPI.docsStatus?.();
      return ok(r || null);
    } catch (e) { return err(mensagemDe(e) || 'manual status failed'); }
  },
};

