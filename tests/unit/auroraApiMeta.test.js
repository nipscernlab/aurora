// @vitest-environment happy-dom
//
// O _meta da AuroraAPI, pela API montada: o schema() que descreve a
// superficie inteira, com uma linha por funcao e o catalogo de eventos.
// Escrito contra o aurora_api.js antes de o catalogo sair para meta_ns.ts.
//
// A regra que este teste trava: toda funcao que a API expoe tem descricao, e
// nenhuma descricao fala de uma funcao que nao existe. O commit que criou o
// namespace git esqueceu a entrada dele, e o schema(), que se anuncia como a
// superficie INTEIRA, omitiu quatorze metodos ate alguem notar.

import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: {} }));
vi.mock('../../js/processors/processor_config_panel.js', () => ({ processorConfigPanel: {} }));
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI: {} }));

let API;

beforeAll(async () => {
  const { initAuroraAPI } = await import('../../js/api/aurora_api.js');
  API = initAuroraAPI();
});

describe('_meta.schema()', () => {
  it('descreve todos os namespaces, menos o proprio _meta', () => {
    const { namespaces } = API._meta.schema();
    expect(Object.keys(namespaces).sort()).toEqual(Object.keys(API).filter((n) => n !== '_meta').sort());
  });

  it('cada funcao exposta tem uma linha de descricao, e cada linha tem a sua funcao', () => {
    const { namespaces } = API._meta.schema();
    for (const [ns, fns] of Object.entries(API)) {
      if (ns === '_meta') continue;
      const expostas = Object.keys(fns).filter((k) => typeof fns[k] === 'function').sort();
      const descritas = Object.keys(namespaces[ns]).sort();
      expect(descritas, `namespace ${ns}`).toEqual(expostas);
      for (const f of descritas) expect(typeof namespaces[ns][f], `${ns}.${f}`).toBe('string');
    }
  });

  it('o catalogo de eventos traz os emitidos e a ponte dos eventos antigos do window', async () => {
    const { WINDOW_EVENT_BRIDGE } = await import('../../js/api/api_core.js');
    const { events } = API._meta.schema();
    expect(events.emitted).toEqual(['compile:started', 'compile:cancelled', 'editor:new-file', 'editor:saved']);
    expect(events.bridged).toEqual(WINDOW_EVENT_BRIDGE);
    expect(events.bridged).not.toBe(WINDOW_EVENT_BRIDGE);
  });

  it('o _meta e congelado e o schema e o mesmo catalogo a cada chamada', () => {
    expect(Object.isFrozen(API._meta)).toBe(true);
    expect(API._meta.schema().namespaces).toBe(API._meta.schema().namespaces);
    expect(Object.isFrozen(API._meta.schema().namespaces)).toBe(true);
  });
});
