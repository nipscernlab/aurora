import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../../main/ipc/undo_store.js');
const { runnerDe, ehAssinatura } = require('../../main/ipc/ai_routing.js');

// A area de espera que torna o Ctrl+Z da arvore possivel
// (main/ipc/undo_store.js). E o unico lugar do processo principal onde um erro
// custa ARQUIVO DO USUARIO, e nao tinha teste nenhum porque a mecanica estava
// colada no electron (app.getPath e shell.trashItem).
//
// Aqui a pasta de espera e um diretorio temporario de verdade e a Lixeira e uma
// funcao injetada, entao o que se exercita e o comportamento real de disco.

let raiz;
let trabalho;
/** Itens que "foram para a Lixeira", na ordem. */
let lixeira;
const paraLixeira = async (item) => { lixeira.push(item); await fsp.rm(item, { recursive: true, force: true }); };

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-undo-'));
  raiz = path.join(base, 'espera');
  trabalho = path.join(base, 'projeto');
  fs.mkdirSync(raiz, { recursive: true });
  fs.mkdirSync(trabalho, { recursive: true });
  lixeira = [];
});

afterEach(() => {
  try { fs.rmSync(path.dirname(raiz), { recursive: true, force: true }); } catch (_) { /* ignore */ }
});

const arquivo = (nome, conteudo = 'conteudo') => {
  const p = path.join(trabalho, nome);
  fs.writeFileSync(p, conteudo, 'utf8');
  return p;
};

describe('guardar e devolver — o ciclo do desfazer', () => {
  it('tira o arquivo do lugar e o devolve com o conteudo intacto', async () => {
    const p = arquivo('main.cmm', 'int x;');
    const g = await store.guardar(raiz, p);
    expect(g.success).toBe(true);
    expect(fs.existsSync(p), 'o arquivo tem que sair do lugar').toBe(false);

    const d = await store.devolver(raiz, g.token, p);
    expect(d.success).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toBe('int x;');
  });

  it('guarda pasta inteira, e nao so arquivo', async () => {
    const pasta = path.join(trabalho, 'Software');
    fs.mkdirSync(path.join(pasta, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(pasta, 'sub', 'a.asm'), 'nop', 'utf8');

    const g = await store.guardar(raiz, pasta);
    expect(g.success).toBe(true);
    expect(fs.existsSync(pasta)).toBe(false);

    await store.devolver(raiz, g.token, pasta);
    expect(fs.readFileSync(path.join(pasta, 'sub', 'a.asm'), 'utf8')).toBe('nop');
  });

  it('dois arquivos de mesmo nome nao se cobrem na espera', async () => {
    // Cada token ganha uma caixa propria; sem isso o segundo `main.cmm` de
    // outra pasta sobrescreveria o primeiro e o desfazer devolveria o errado.
    const a = arquivo('main.cmm', 'A');
    const sub = path.join(trabalho, 'outro');
    fs.mkdirSync(sub);
    const b = path.join(sub, 'main.cmm');
    fs.writeFileSync(b, 'B', 'utf8');

    const g1 = await store.guardar(raiz, a);
    const g2 = await store.guardar(raiz, b);
    expect(g1.token).not.toBe(g2.token);

    await store.devolver(raiz, g1.token, a);
    await store.devolver(raiz, g2.token, b);
    expect(fs.readFileSync(a, 'utf8')).toBe('A');
    expect(fs.readFileSync(b, 'utf8')).toBe('B');
  });

  it('recria a pasta do destino quando ela sumiu no meio', async () => {
    const sub = path.join(trabalho, 'Software');
    fs.mkdirSync(sub);
    const p = path.join(sub, 'x.asm');
    fs.writeFileSync(p, 'nop', 'utf8');
    const g = await store.guardar(raiz, p);
    fs.rmSync(sub, { recursive: true, force: true });

    expect((await store.devolver(raiz, g.token, p)).success).toBe(true);
    expect(fs.readFileSync(p, 'utf8')).toBe('nop');
  });
});

describe('devolver — o que ele se recusa a fazer', () => {
  it('RECUSA sobrescrever o que ocupou o lugar depois da remocao', async () => {
    // Desfazer que destroi e pior que nao ter desfazer: se o usuario criou
    // outro arquivo com o mesmo nome, o Ctrl+Z nao pode apaga-lo em silencio.
    const p = arquivo('main.cmm', 'antigo');
    const g = await store.guardar(raiz, p);
    fs.writeFileSync(p, 'novo', 'utf8');

    const d = await store.devolver(raiz, g.token, p);
    expect(d.success).toBe(false);
    expect(d.error).toMatch(/ocupado/);
    expect(fs.readFileSync(p, 'utf8'), 'o que estava la nao pode ser tocado').toBe('novo');
  });

  it('responde em vez de lancar quando o token nao existe', async () => {
    const d = await store.devolver(raiz, 'token-que-nunca-existiu', path.join(trabalho, 'x'));
    expect(d.success).toBe(false);
    expect(d.error).toMatch(/nada guardado/);
  });

  it('responde em vez de lancar quando a origem some do disco', async () => {
    // Alguem esvaziou a pasta de espera por fora, com o app aberto.
    const p = arquivo('main.cmm');
    const g = await store.guardar(raiz, p);
    fs.rmSync(path.join(raiz, g.token), { recursive: true, force: true });
    expect((await store.devolver(raiz, g.token, p)).success).toBe(false);
  });
});

describe('descartar e esvaziar', () => {
  it('manda para a Lixeira o item, e nao a caixa do token', async () => {
    // O que o usuario procura na Lixeira e `main.cmm`, nao uma pasta com nome
    // de hexadecimal.
    const p = arquivo('main.cmm');
    const g = await store.guardar(raiz, p);

    expect((await store.descartar(raiz, g.token, paraLixeira)).success).toBe(true);
    expect(lixeira).toHaveLength(1);
    expect(path.basename(lixeira[0])).toBe('main.cmm');
    expect(fs.existsSync(path.join(raiz, g.token))).toBe(false);
  });

  it('apaga a caixa mesmo quando a Lixeira falha', async () => {
    // Deixar a caixa faria a espera crescer para sempre, e o conteudo ja nao e
    // mais alcancavel pelo desfazer de qualquer forma.
    const g = await store.guardar(raiz, arquivo('main.cmm'));
    const quebrada = async () => { throw new Error('trashItem indisponivel'); };

    const r = await store.descartar(raiz, g.token, quebrada);
    expect(r.success).toBe(false);
    expect(fs.existsSync(path.join(raiz, g.token)), 'a caixa tem que sumir mesmo assim').toBe(false);
  });

  it('esvazia tudo e conta o que conseguiu', async () => {
    for (const n of ['a.cmm', 'b.cmm', 'c.cmm']) await store.guardar(raiz, arquivo(n));
    const r = await store.esvaziar(raiz, paraLixeira);
    expect(r).toEqual({ descartadas: 3, falhas: 0 });
    expect(fs.readdirSync(raiz)).toEqual([]);
  });

  it('uma caixa problematica nao interrompe as outras', async () => {
    // O objetivo e ESVAZIAR. Parar na primeira falha deixaria o resto
    // acumulado para sempre, que e justamente o que a limpeza de boot evita.
    for (const n of ['a.cmm', 'b.cmm', 'c.cmm']) await store.guardar(raiz, arquivo(n));
    let vez = 0;
    const asVezes = async (item) => {
      vez += 1;
      if (vez === 2) throw new Error('essa nao');
      await paraLixeira(item);
    };
    const r = await store.esvaziar(raiz, asVezes);
    expect(r.descartadas + r.falhas).toBe(3);
    expect(r.falhas).toBe(1);
    expect(fs.readdirSync(raiz), 'nenhuma caixa pode sobrar').toEqual([]);
  });

  it('nao reclama quando a pasta de espera nem existe', async () => {
    // Primeira execucao numa maquina limpa, e todo arranque depois de um
    // encerramento que ja esvaziou.
    const r = await store.esvaziar(path.join(raiz, 'nao-existe'), paraLixeira);
    expect(r).toEqual({ descartadas: 0, falhas: 0 });
  });
});

describe('itemDe', () => {
  it('devolve vazio para token desconhecido em vez de lancar', () => {
    expect(store.itemDe(raiz, 'nada')).toBe('');
  });

  it('devolve vazio para caixa vazia', async () => {
    fs.mkdirSync(path.join(raiz, 'vazia'));
    expect(store.itemDe(raiz, 'vazia')).toBe('');
  });
});

describe('runnerDe — qual motor atende cada provedor', () => {
  it('manda cada ponte de assinatura para a CLI dela', () => {
    expect(runnerDe('claude-code')).toBe('claude-code');
    expect(runnerDe('chatgpt')).toBe('chatgpt');
  });

  it('manda todo o resto para o caminho de API', () => {
    for (const p of ['openai', 'anthropic', 'google', 'deepseek', 'groq', 'ollama']) {
      expect(runnerDe(p), p).toBe('api');
    }
  });

  it('cai no caminho de API quando o provedor e desconhecido ou ausente', () => {
    // Provedor desconhecido e quase sempre um provedor de API novo. Manda-lo
    // para uma CLI falharia com "binario nao encontrado", que nao tem nada a
    // ver com o problema.
    for (const p of [undefined, null, '', 'provedor-novo-2027', 42, {}]) {
      expect(runnerDe(p), JSON.stringify(p)).toBe('api');
    }
  });

  it('nao confunde nome parecido com o da ponte', () => {
    expect(runnerDe('claude')).toBe('api');
    expect(runnerDe('claude-code-2')).toBe('api');
    expect(runnerDe('CHATGPT')).toBe('api');
  });

  it('ehAssinatura concorda com runnerDe', () => {
    expect(ehAssinatura('claude-code')).toBe(true);
    expect(ehAssinatura('chatgpt')).toBe(true);
    expect(ehAssinatura('openai')).toBe(false);
    expect(ehAssinatura(undefined)).toBe(false);
  });
});
