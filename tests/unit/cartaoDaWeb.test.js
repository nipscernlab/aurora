/**
 * main/ai/cartao_da_web: o gancho PreToolUse que faz o WebFetch e o WebSearch
 * nativos do Claude passarem pelo cartao de permissao do painel. Antes eram
 * pre-aprovados sem cartao, e ler um arquivo e manda-lo pela web era mudo.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-log', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }));
// O painel nao entra aqui: so a constante do tool_runner importa.
vi.mock('../../js/ui/ai_assistant_manager.js', () => ({ aiAssistantManager: {} }));

import { ganchoDaWeb, ganchosDaWeb, PEDIDO_DA_WEB, WEB_COM_CARTAO } from '../../main/ai/cartao_da_web.ts';
import { PEDIDO_DA_WEB as PEDIDO_NO_PAINEL } from '../../js/ai/tool_runner.ts';

const janela = { id: 3 };
const decisao = (r) => r.hookSpecificOutput?.permissionDecision;

describe('cartao_da_web', () => {
  it('o main e o painel usam o mesmo nome de pedido', () => {
    expect(PEDIDO_DA_WEB).toBe(PEDIDO_NO_PAINEL);
    expect(WEB_COM_CARTAO).toEqual(['WebFetch', 'WebSearch']);
  });

  it('pergunta ao painel da janela com os argumentos, e permite so com um sim explicito', async () => {
    const levar = vi.fn(async () => ({ ok: true, data: { allowed: true } }));
    const r = await ganchoDaWeb(janela, levar)({ tool_name: 'WebFetch', tool_input: { url: 'https://x.org', prompt: 'p' } });
    expect(levar).toHaveBeenCalledWith(janela, PEDIDO_DA_WEB, { tool: 'WebFetch', url: 'https://x.org', prompt: 'p' });
    expect(decisao(r)).toBe('allow');
    expect(r.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  });

  it('nega na duvida: recusa, painel ausente, erro, resposta estranha', async () => {
    for (const resposta of [
      { ok: true, data: { allowed: false } },
      { ok: false, error: 'renderer is not available' },
      { ok: true, data: null },
      { ok: true, data: { allowed: 'sim' } },
      null,
      'texto',
    ]) {
      const r = await ganchoDaWeb(janela, async () => resposta)({ tool_name: 'WebSearch', tool_input: { query: 'q' } });
      expect(decisao(r), JSON.stringify(resposta)).toBe('deny');
      expect(r.hookSpecificOutput.permissionDecisionReason).toBe('The user denied this action.');
    }
    const lanca = await ganchoDaWeb(janela, async () => { throw new Error('x'); })({ tool_name: 'WebFetch' });
    expect(decisao(lanca)).toBe('deny');
  });

  it('entrada sem objeto vai sem argumentos; o que nao e web passa sem decisao', async () => {
    const levar = vi.fn(async () => ({ ok: true, data: { allowed: true } }));
    await ganchoDaWeb(janela, levar)({ tool_name: 'WebSearch', tool_input: 'q' });
    expect(levar).toHaveBeenCalledWith(janela, PEDIDO_DA_WEB, { tool: 'WebSearch' });
    levar.mockClear();
    expect(await ganchoDaWeb(janela, levar)({ tool_name: 'Read', tool_input: {} })).toEqual({});
    expect(await ganchoDaWeb(janela, levar)({})).toEqual({});
    expect(levar).not.toHaveBeenCalled();
  });

  it('os hooks do SDK: so a web, com prazo acima do tool_bridge', () => {
    const h = ganchosDaWeb(janela, async () => null);
    expect(h.PreToolUse).toHaveLength(1);
    expect(h.PreToolUse[0].matcher).toBe('WebFetch|WebSearch');
    expect(h.PreToolUse[0].timeout).toBe(130);
  });
});
