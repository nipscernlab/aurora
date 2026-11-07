// @vitest-environment happy-dom
// O tool_runner (js/ai/tool_runner): recebe do main cada pedido de ferramenta
// da Aurora Intelligence, passa pelo cartao de permissao do painel e chama o
// metodo do AuroraAPI. Nao tinha teste; este fixa o caminho inteiro.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const confirmToolCall = vi.fn(async () => true);
vi.mock('../../js/ui/ai_assistant_manager.js', () => ({ aiAssistantManager: { confirmToolCall } }));

const MANIFESTO = [
  { name: 'ler', access: 'read', api: ['proj', 'ler'], argStyle: 'positional', argNames: ['a', 'b'] },
  { name: 'obj', access: 'write', api: ['proj', 'obj'], argStyle: 'object' },
  { name: 'nada', access: 'read', api: ['proj', 'nada'], argStyle: 'none' },
  { name: 'some', access: 'read', api: ['proj', 'naoExiste'], argStyle: 'none' },
  { name: 'semApi', access: 'read' },
  { name: 'ask_user_question', access: 'read', api: ['ui', 'perguntar'], argStyle: 'object' },
];

let ouvinte;
let respostas;
let proj;

async function iniciar() {
  vi.resetModules();
  const { initToolRunner } = await import('../../js/ai/tool_runner.js');
  await initToolRunner();
}

async function pedir(toolName, args) {
  const antes = respostas.length;
  ouvinte({ requestId: `r${antes}`, toolName, args });
  await vi.waitFor(() => expect(respostas.length).toBe(antes + 1));
  return respostas.at(-1);
}

beforeEach(() => {
  confirmToolCall.mockReset();
  confirmToolCall.mockResolvedValue(true);
  respostas = [];
  ouvinte = null;
  proj = {
    ler: vi.fn(async (a, b) => ({ ok: true, data: [a, b] })),
    obj: vi.fn(async (o) => ({ ok: true, data: o })),
    nada: vi.fn(async () => undefined),
  };
  window.AuroraAPI = { proj, ui: { perguntar: vi.fn(async () => ({ ok: true, data: 'sim' })) } };
  window.aiAPI = {
    getToolManifest: vi.fn(async () => ({ tools: MANIFESTO })),
    onToolExec: vi.fn((cb) => { ouvinte = cb; return vi.fn(); }),
    sendToolResult: vi.fn((id, r) => respostas.push(r)),
  };
});

describe('tool_runner', () => {
  it('sem aiAPI nao faz nada', async () => {
    delete window.aiAPI;
    await iniciar();
    expect(ouvinte).toBe(null);
  });

  it('chama o AuroraAPI com os argumentos no estilo do manifesto', async () => {
    await iniciar();
    expect(await pedir('ler', { a: 1, b: 2, c: 3 })).toEqual({ ok: true, data: [1, 2] });
    expect(await pedir('ler', null)).toEqual({ ok: true, data: [undefined, undefined] });
    expect(await pedir('obj', { x: 1 })).toEqual({ ok: true, data: { x: 1 } });
    expect(await pedir('obj')).toEqual({ ok: true, data: {} });
    expect(await pedir('nada', { x: 1 })).toEqual({ ok: true });
    expect(proj.nada).toHaveBeenCalledWith();
  });

  it('ferramenta desconhecida, metodo que nao existe e excecao viram ok:false', async () => {
    await iniciar();
    expect(await pedir('xyz', {})).toEqual({ ok: false, error: 'unknown tool: xyz' });
    expect(await pedir('some', {})).toEqual({ ok: false, error: 'AuroraAPI.proj.naoExiste is unavailable' });
    expect(await pedir('semApi', {})).toEqual({ ok: false, error: 'AuroraAPI. is unavailable' });
    proj.obj.mockRejectedValueOnce(new Error('quebrou'));
    expect(await pedir('obj', {})).toEqual({ ok: false, error: 'quebrou' });
    proj.obj.mockRejectedValueOnce('texto');
    expect(await pedir('obj', {})).toEqual({ ok: false, error: 'texto' });
  });

  it('o cartao decide; negar ou falhar o cartao nega; a pergunta nao passa por ele', async () => {
    await iniciar();
    confirmToolCall.mockResolvedValueOnce(false);
    expect(await pedir('obj', {})).toEqual({ ok: false, error: 'The user denied this action.' });
    confirmToolCall.mockRejectedValueOnce(new Error('x'));
    expect(await pedir('obj', {})).toEqual({ ok: false, error: 'The user denied this action.' });
    expect(proj.obj).not.toHaveBeenCalled();
    confirmToolCall.mockClear();
    expect(await pedir('ask_user_question', { q: 1 })).toEqual({ ok: true, data: 'sim' });
    expect(confirmToolCall).not.toHaveBeenCalled();
  });

  it('manifesto que falha fica vazio; iniciar de novo troca a assinatura', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.aiAPI.getToolManifest.mockRejectedValueOnce(new Error('sem main'));
    await iniciar();
    expect(await pedir('ler', {})).toEqual({ ok: false, error: 'unknown tool: ler' });
    window.aiAPI.getToolManifest.mockResolvedValueOnce(null);
    const { initToolRunner } = await import('../../js/ai/tool_runner.js');
    await initToolRunner();
    const primeira = window.aiAPI.onToolExec.mock.results[0].value;
    await initToolRunner();
    expect(primeira).toHaveBeenCalled();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});
