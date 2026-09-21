/**
 * examples_ns.ts: o namespace `AuroraAPI.examples`.
 *
 * Extraido VERBATIM do js/api/aurora_api.js (item 4 do roadmap: dividir aquele
 * arquivo em um modulo por namespace), pela mesma razao do git_ns.js: aqui
 * dentro nao entra a cadeia de imports do editor, entao o modulo carrega num
 * teste sem subir a IDE inteira. O aurora_api.js importa `examplesNs` daqui e o
 * expoe como `AuroraAPI.examples`.
 *
 * Compilado por `tsc` (npm run build:ts) num examples_ns.js ao lado, e esse .js
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
 *  Projetos de exemplo
 *
 *  Os cinco projetos prontos que o botao da tela inicial cria. A IA precisa
 *  deles por dois motivos. Primeiro, para responder "o que eu posso estudar
 *  aqui?" sem inventar: a lista sai do catalogo, com o que cada um ensina e
 *  qual processador traz. Segundo, para levar o aluno do assunto ate o codigo
 *  rodando, que hoje exige achar um botao que ele talvez nao saiba que existe.
 *
 *  `install` NAO recebe caminho de proposito. Ela chama o mesmo canal do botao,
 *  que abre o seletor de pasta do sistema, entao quem decide onde os arquivos
 *  nascem continua sendo a pessoa. Uma ferramenta de IA que escrevesse cinco
 *  projetos num caminho escolhido pelo modelo seria uma escrita em disco sem
 *  dono, e o ganho de conveniencia nao paga isso.
 * ========================================================== */
export const examplesNs = {
  /**
   * O catalogo dos exemplos: chave, nome, resumo, linguagem, e os
   * processadores que cada um traz.
   */
  async list() {
    try {
      const r = await electronAPI.exemplosListar?.();
      if (!r?.ok) return err(motivoDe(r, 'Could not read the example catalogue'));
      return ok({ examples: r.exemplos || [] });
    } catch (e) { return err(mensagemDe(e) || 'list examples failed'); }
  },

  /**
   * Cria os cinco numa pasta que o usuario escolhe, e devolve o caminho do
   * `.spf` de cada um, que e o que `project.openProject` precisa em seguida.
   *
   * Cancelar o seletor nao e erro: devolve `cancelled: true`.
   */
  async install() {
    try {
      const r = await electronAPI.exemplosInstalar?.();
      if (!r?.ok) return err(motivoDe(r, 'Could not create the example projects'));
      if (r.cancelado) return ok({ cancelled: true, created: [], skipped: [] });
      return ok({
        cancelled: false,
        folder: r.pasta,
        created: r.criados || [],
        skipped: r.pulados || [],
      });
    } catch (e) { return err(mensagemDe(e) || 'install examples failed'); }
  },
};

