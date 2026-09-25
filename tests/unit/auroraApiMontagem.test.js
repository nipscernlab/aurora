// @vitest-environment happy-dom
//
// A montagem da AuroraAPI (js/api/aurora_api.js) num teste de unidade. O
// arquivo importa o Monaco, as abas, os modelos compartilhados e o painel de
// processador, que sobem a interface; com esses quatro simulados ele carrega,
// e o que dele saiu para modulos proprios pode ser conferido ligado.

import { describe, it, expect, beforeAll, vi } from 'vitest';

import pkg from '../../main/ai/tools.js';

const { TOOL_MANIFEST } = pkg;

vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));

const pastas = new Map([
  ['C:\\p', [{ path: 'C:\\p\\top.v' }, { path: 'C:\\p\\sim', isDirectory: true }]],
  ['C:\\p\\sim', [{ path: 'C:\\p\\sim\\tb.v' }]],
]);
const electronAPI = { getFolderFiles: vi.fn(async (d) => pastas.get(d) || []) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

let API;
let ProjectStore;
let waveNs;

beforeAll(async () => {
  ({ ProjectStore } = await import('../../js/project/project_store.js'));
  ({ waveNs } = await import('../../js/api/wave_ns.js'));
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
});

describe('montagem da AuroraAPI', () => {
  it('monta uma vez, congelada, com todos os namespaces', async () => {
    const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
    expect(initAuroraAPI()).toBe(API);
    expect(window.AuroraAPI).toBe(API);
    expect(Object.isFrozen(API)).toBe(true);
    expect(Object.keys(API)).toEqual([
      'editor', 'terminal', 'project', 'compile', 'wave', 'prism', 'rules',
      'examples', 'manual', 'settings', 'ui', 'ai', 'git', 'events', '_meta',
    ]);
  });

  it('o wave e o do wave_ns.ts', () => {
    expect(Object.keys(API.wave).sort()).toEqual(Object.keys(waveNs).sort());
    expect(API.wave.listGtkwFiles).toBe(waveNs.listGtkwFiles);
  });

  it('project.getTree lista o projeto aberto pela arvore_do_projeto, ou recusa sem projeto', async () => {
    ProjectStore.clearProject();
    expect((await API.project.getTree()).error.message).toBe('No project open');
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    expect((await API.project.getTree()).data).toEqual(['top.v', 'sim/tb.v']);
    expect((await API.project.getTree('C:\\p\\sim')).data).toEqual(['tb.v']);
  });
});

// O manifesto das ferramentas da IA (main/ai/tools.js) e a API sao ligados por
// convencao, e nao por tipo: um `api: [ns, fn]` sem par do outro lado vira uma
// ferramenta anunciada ao modelo que so falha quando alguem a usa. A conferencia
// lia os fontes como texto, porque a API nao carregava fora do aplicativo; com
// ela montada aqui, e contra o objeto de verdade, e um namespace montado de
// varias partes continua conferido.
describe('o manifesto de ferramentas contra a AuroraAPI montada', () => {
  it('toda ferramenta aponta para uma funcao que existe', () => {
    const faltando = TOOL_MANIFEST
      .filter((def) => typeof API[def.api[0]]?.[def.api[1]] !== 'function')
      .map((def) => `${def.name} -> ${def.api.join('.')}`);
    expect(faltando).toEqual([]);
  });
});
