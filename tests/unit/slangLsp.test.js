/**
 * main/lsp/slang_lsp: a ponte com o slang-server com o binario AUSENTE, que e
 * o caso de toda maquina que nao baixou o componente e o da CI. O modulo
 * promete ali: todo canal responde sem erro e sem disparar processo, e o
 * editor segue sem o slang. O slangIndice.test.js cobre a configuracao do
 * indice.
 *
 * O vigia de arquivos e a publicacao de diagnosticos so rodam com o servidor
 * de pe; aqui eles sao chamados direto (o modulo os exporta para teste).
 */

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cercar, pastaTemporaria } from '../helpers/cercado.js';

const pasta = pastaTemporaria('aurora-slang-');
const c = cercar({ electron: true, processos: true, paths: { componentsPath: pasta.raiz } });
const handlers = c.electron.handlers;
let slang;

beforeAll(async () => {
  const mod = await import('../../main/lsp/slang_lsp.js');
  slang = mod.default ?? mod;
  slang.register();
  await c.provar();
});

afterAll(() => {
  slang.stop?.(false);
  pasta.apagar();
});

const uri = 'file:///C:/proj/top.sv';
const pos = { line: 0, character: 1 };

describe('slang_lsp sem o binario', () => {
  it('status: nao instalado, nao pronto, ligado por padrao', () => {
    expect(handlers.get('slang:status')()).toEqual({ installed: false, ready: false, enabled: true });
  });

  it('abrir, mudar e fechar documento nao lancam nem disparam processo', async () => {
    await handlers.get('slang:did-open')({ sender: { id: 1 } }, { uri, text: 'module top; endmodule', languageId: 'systemverilog' });
    await handlers.get('slang:did-change')({ sender: { id: 1 } }, { uri, text: 'module top(); endmodule' });
    await handlers.get('slang:did-close')({}, { uri });
    expect(c.processos.execs).toEqual([]);
  });

  it('todo pedido devolve null, a resposta de servidor indisponivel', async () => {
    const pedidos = {
      'slang:completion': { uri, position: pos },
      'slang:document-highlight': { uri, position: pos },
      'slang:workspace-symbol': { query: 'top' },
      'slang:inlay-hint': { uri, range: { start: pos, end: pos } },
      'slang:document-link': { uri },
      'slang:hover': { uri, position: pos },
    };
    for (const [canal, args] of Object.entries(pedidos)) {
      expect(await handlers.get(canal)({}, args), canal).toBeNull();
    }
    expect(await handlers.get('slang:hover')({}, undefined)).toBeNull();
  });

  it('desligar e religar muda o status, e desligado nao tenta subir', async () => {
    expect(handlers.get('slang:set-enabled')({}, false)).toEqual({ enabled: false });
    expect(handlers.get('slang:set-enabled')({}, false)).toEqual({ enabled: false });
    expect(handlers.get('slang:status')().enabled).toBe(false);
    expect(await handlers.get('slang:completion')({}, { uri, position: pos })).toBeNull();
    expect(handlers.get('slang:set-enabled')({}, true)).toEqual({ enabled: true });
  });
});

describe('o que so roda com o servidor de pe', () => {
  it('o vigia sobe numa pasta e para, e sem pasta nao sobe', () => {
    const proj = path.join(pasta.raiz, 'proj');
    fs.mkdirSync(proj, { recursive: true });
    expect(() => slang.startWatcher(proj)).not.toThrow();
    expect(() => slang.stopWatcher()).not.toThrow();
    expect(() => slang.startWatcher(null)).not.toThrow();
    slang.stopWatcher();
  });

  it('diagnostico publicado, com e sem modulo desconhecido, e repassado sem lancar', () => {
    const publicar = (diagnostics) => slang.handleMessage({
      jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics },
    });
    expect(() => publicar([{ message: 'unknown module "alu"' }, null, { message: 7 }])).not.toThrow();
    expect(() => publicar([])).not.toThrow();
    expect(() => publicar('nao e lista')).not.toThrow();
    // outra notificacao do servidor: ignorada
    expect(() => slang.handleMessage({ jsonrpc: '2.0', method: 'window/logMessage', params: {} })).not.toThrow();
  });
});
