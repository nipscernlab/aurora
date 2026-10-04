/**
 * aurora_api.ts: `window.AuroraAPI`, a superficie unica, assincrona e
 * serializavel em JSON, por onde a Aurora Intelligence, os testes e as
 * ferramentas de desenvolvimento operam a IDE.
 *
 * Este arquivo so MONTA a API. Cada namespace mora no seu modulo:
 *
 *   editor    editor_ns.ts       terminal  terminal_ns.ts
 *   project   ciclo_do_projeto_ns, renomear_projeto_ns, arquivos_ns,
 *             analise_asm_ns, memorias_ns e processadores_ns, mais o
 *             getTree de arvore_do_projeto, juntados aqui
 *   compile   compile_ns.ts      wave      wave_ns.ts
 *   prism     prism_ns.ts        rules     rules_ns.ts
 *   examples  examples_ns.ts     manual    manual_ns.ts
 *   settings  settings_ns.ts     ui        ui_ns.ts
 *   ai        ai_ns.ts           git       git_ns.ts
 *   events    api_core.ts        _meta     meta_ns.ts
 *
 * Convencoes, que valem para todo namespace:
 *   - Toda funcao e assincrona e devolve `{ ok, data }` ou
 *     `{ ok: false, error: { message, code } }` (api_core.ts). O formato
 *     atravessa o IPC ate o agente sem cerimonia.
 *   - Erro RESOLVE com `ok: false`, nunca rejeita: agente de ferramentas
 *     lida melhor com dado do que com promessa rejeitada.
 *   - Os gerenciadores (abas, editor, fluxo de compilacao) sao lidos na hora
 *     da chamada, por import ou pelo window, e nao na montagem, para a API
 *     poder montar antes de tudo terminar de subir.
 *   - Toda funcao nova ganha uma linha no catalogo de meta_ns.ts no mesmo
 *     commit; tests/unit/auroraApiMeta.test.js cobra.
 *
 * Saiu de um arquivo de 3400 linhas, dividido um namespace por vez no item
 * 13.3 do TODO. tests/e2e/api-surface.test.js trava os nomes de toda a
 * superficie contra um retrato commitado.
 *
 * Compilado por `tsc` (npm run build:ts) num aurora_api.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { gitNs } from './git_ns.js';
import { prismNs } from './prism_ns.js';
import { waveNs } from './wave_ns.js';
import { memoriasDoProjeto } from './memorias_ns.js';
import { processadoresDoProjeto } from './processadores_ns.js';
import { arquivosDoProjeto } from './arquivos_ns.js';
import { cicloDoProjeto } from './ciclo_do_projeto_ns.js';
import { renomearProjeto } from './renomear_projeto_ns.js';
import { rulesNs } from './rules_ns.js';
import { analiseDoAsm } from './analise_asm_ns.js';
import { listarArquivosDoProjeto } from './arvore_do_projeto.js';
import { examplesNs } from './examples_ns.js';
import { manualNs } from './manual_ns.js';
import { uiNs } from './ui_ns.js';
import { aiNs } from './ai_ns.js';
import { settingsNs } from './settings_ns.js';
import { terminalNs } from './terminal_ns.js';
import { compileNs } from './compile_ns.js';
import { editorNs } from './editor_ns.js';
import { metaNs } from './meta_ns.js';
// O envelope de resposta e o barramento de eventos moram em api_core.ts, que
// nao importa nada: importar ESTE arquivo puxa a IDE inteira, e assim o nucleo
// continua testavel sozinho.
import { on, off, emit, WINDOW_EVENT_BRIDGE } from './api_core.js';

/**
 * A ponte dos eventos antigos. A Aurora e anterior ao barramento, e os sinais
 * que cruzam a interface ainda saem como `CustomEvent` no window. Em vez de
 * migrar todo publicador de uma vez, cada evento antigo e repetido no
 * barramento com um nome normalizado (`compile:started`, ...): quem ouve o
 * window segue funcionando, e o codigo novo e a IA tem um lugar so para ouvir,
 * o `AuroraAPI.events.on(...)`.
 */
function bridgeWindowEvents(): void {
  for (const [domEvent, busEvent] of Object.entries(WINDOW_EVENT_BRIDGE)) {
    window.addEventListener(domEvent, (e) => {
      const detalhe = (e as CustomEvent | null)?.detail;
      emit(busEvent, detalhe != null ? detalhe : null);
    });
  }
}

/** O namespace project, juntado dos modulos que dividem o projeto por assunto. */
const projectNs = {
  ...cicloDoProjeto,
  ...renomearProjeto,
  // A listagem mora em arvore_do_projeto.ts, que a busca de layouts do wave
  // tambem usa.
  getTree(rootPath?: string | null) { return listarArquivosDoProjeto(rootPath); },
  ...arquivosDoProjeto,
  ...analiseDoAsm,
  ...memoriasDoProjeto,
  ...processadoresDoProjeto,
};

/** A API inteira, congelada: um namespace por chave, na ordem do retrato. */
function montar() {
  return Object.freeze({
    editor:   Object.freeze(editorNs),
    terminal: Object.freeze(terminalNs),
    project:  Object.freeze(projectNs),
    compile:  Object.freeze(compileNs),
    wave:     Object.freeze(waveNs),
    prism:    Object.freeze(prismNs),
    rules:    Object.freeze(rulesNs),
    examples: Object.freeze(examplesNs),
    manual:   Object.freeze(manualNs),
    settings: Object.freeze(settingsNs),
    ui:       Object.freeze(uiNs),
    ai:       Object.freeze(aiNs),
    git:      Object.freeze(gitNs),
    events:   Object.freeze({ on, off, emit }),
    _meta:    metaNs,
  });
}

/** O tipo da AuroraAPI montada. */
export type AuroraAPI = ReturnType<typeof montar>;

/** Monta a API uma vez e a poe em `window.AuroraAPI`; chamadas seguintes devolvem a mesma. */
export function initAuroraAPI(): AuroraAPI {
  if (window.AuroraAPI) return window.AuroraAPI as AuroraAPI;
  // Repete os CustomEvents antigos do window no barramento, para haver um
  // lugar so de onde observar a IDE.
  bridgeWindowEvents();
  const api = montar();
  window.AuroraAPI = api;
  return api;
}
