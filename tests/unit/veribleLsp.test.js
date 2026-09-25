/**
 * main/lsp/verible_lsp: a ponte com o servidor de linguagem do Verible, com o
 * binario AUSENTE. E o caso de toda maquina que ainda nao baixou o componente,
 * e o que o modulo promete nele: todo canal responde sem erro e sem disparar
 * nada, e o editor segue como se o LSP nao existisse.
 *
 * O caminho com o servidor de pe (spawn, quadros JSON-RPC, respawn) precisa do
 * binario, que nao existe na CI; fica para um teste com servidor falso.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cercar, pastaTemporaria } from '../helpers/cercado.js';

const pasta = pastaTemporaria('aurora-verible-');
const c = cercar({ electron: true, processos: true, paths: { componentsPath: pasta.raiz } });
const handlers = c.electron.handlers;

beforeAll(async () => {
  const mod = await import('../../main/lsp/verible_lsp.js');
  (mod.default ?? mod).register();
  await c.provar();
});

afterAll(() => pasta.apagar());

const uri = 'file:///C:/proj/top.v';

describe('verible_lsp sem o binario', () => {
  it('status diz que nao esta instalado nem pronto', () => {
    expect(handlers.get('lsp:status')()).toEqual({ installed: false, ready: false });
  });

  it('abrir, mudar e fechar um documento nao lancam nem disparam processo', async () => {
    await handlers.get('lsp:did-open')({ sender: { id: 1 } }, { uri, text: 'module top; endmodule', languageId: 'verilog' });
    await handlers.get('lsp:did-change')({ sender: { id: 1 } }, { uri, text: 'module top(); endmodule' });
    await handlers.get('lsp:did-close')({}, { uri });
    expect(c.processos.execs).toEqual([]);
  });

  it('todo pedido devolve null, a resposta de servidor indisponivel', async () => {
    const pos = { line: 0, character: 3 };
    const pedidos = {
      'lsp:format': { uri },
      'lsp:document-symbols': { uri },
      'lsp:hover': { uri, position: pos },
      'lsp:definition': { uri, position: pos },
      'lsp:references': { uri, position: pos },
      'lsp:rename': { uri, position: pos, newName: 'b' },
      'lsp:code-action': { uri, range: { start: pos, end: pos }, diagnostics: [] },
      'lsp:document-highlight': { uri, position: pos },
    };
    for (const [canal, args] of Object.entries(pedidos)) {
      expect(await handlers.get(canal)({}, args), canal).toBeNull();
    }
  });

  it('pedido sem argumentos nao quebra', async () => {
    expect(await handlers.get('lsp:hover')({}, undefined)).toBeNull();
    expect(await handlers.get('lsp:format')({})).toBeNull();
    expect(await handlers.get('lsp:code-action')({}, { uri, diagnostics: 'nao e lista' })).toBeNull();
  });
});
