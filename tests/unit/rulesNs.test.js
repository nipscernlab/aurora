// O namespace AuroraAPI.rules (js/api/rules_ns): a base de conhecimento do
// yanc, lida uma vez do resources/sapho_rules.json.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REGRAS = {
  directives: { NUBITS: { desc: 'bits' }, NBMANT: { desc: 'mantissa' } },
  language: { keywords: ['if', 'while'] },
  messages: [{ code: 'MSG_X', pt: 'x', en: 'x' }],
  asm: { opcodes: [{ mnemonic: 'LOD', family: 'mem' }, { mnemonic: 'ADD', family: 'alu' }] },
};

let rules;
const msg = (r) => r.error?.message;

async function carregar(resposta) {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(resposta));
  ({ rulesNs: rules } = await import('../../js/api/rules_ns.js'));
}

afterEach(() => vi.unstubAllGlobals());

describe('com o arquivo de regras', () => {
  beforeEach(() => carregar(async () => ({ ok: true, json: async () => REGRAS })));

  it('le uma vez so, e devolve o documento inteiro', async () => {
    expect((await rules.get()).data).toBe(REGRAS);
    await rules.listOpcodes();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('./resources/sapho_rules.json');
  });

  it('diretivas: por nome com ou sem #, em qualquer caixa, e a lista', async () => {
    expect((await rules.getDirective('#nubits')).data).toEqual({ desc: 'bits' });
    expect(msg(await rules.getDirective('XYZ'))).toBe('unknown directive: XYZ');
    expect(msg(await rules.getDirective())).toBe('unknown directive: undefined');
    expect((await rules.listDirectives()).data).toEqual(['NUBITS', 'NBMANT']);
  });

  it('palavras reservadas, mensagens e opcodes', async () => {
    expect((await rules.getKeywords()).data).toEqual(['if', 'while']);
    expect((await rules.lookupMessage('MSG_X')).data.code).toBe('MSG_X');
    expect(msg(await rules.lookupMessage('MSG_Y'))).toBe('unknown message code: MSG_Y');
    expect((await rules.listOpcodes()).data).toHaveLength(2);
    expect((await rules.getOpcode('add')).data.family).toBe('alu');
    expect(msg(await rules.getOpcode('NOP'))).toBe('unknown opcode: NOP');
    expect(msg(await rules.getOpcode())).toBe('unknown opcode: undefined');
  });
});

describe('sem o arquivo de regras', () => {
  it('resposta nao ok vira null, e cada consulta responde o vazio ou o erro dela', async () => {
    await carregar(async () => ({ ok: false }));
    expect((await rules.get()).data).toBeNull();
    expect(msg(await rules.getDirective('NUBITS'))).toBe('rules not available');
    expect((await rules.listDirectives()).data).toEqual([]);
    expect((await rules.getKeywords()).data).toEqual([]);
    expect(msg(await rules.lookupMessage('MSG_X'))).toMatch(/unknown message code/);
    expect((await rules.listOpcodes()).data).toEqual([]);
    expect(msg(await rules.getOpcode('LOD'))).toBe('opcode table not available');
  });

  it('fetch que falha tambem vira null', async () => {
    await carregar(async () => { throw new Error('offline'); });
    expect((await rules.get()).data).toBeNull();
  });
});
