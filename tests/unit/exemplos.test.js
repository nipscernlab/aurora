/**
 * Os projetos de exemplo (main/exemplos/instalar.js e resources/exemplos).
 *
 * O que precisa de prova aqui e diferente do resto da base. Um exemplo
 * quebrado nao derruba nada: ele abre, parece um projeto, e falha na primeira
 * compilacao, na frente de quem esta aprendendo a ferramenta e nao tem como
 * saber se o erro e do exemplo ou dele. Entao o catalogo e conferido contra o
 * disco, arquivo por arquivo, e o `.spf` gerado e conferido contra o que a
 * AURORA espera ler.
 *
 * O que este teste NAO faz e compilar. Isso e trabalho do teste de toolchain,
 * que roda os binarios de verdade; os quatro exemplos em C± foram compilados e
 * simulados no Icarus antes de entrarem no repositorio.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = path.join(RAIZ, 'resources', 'exemplos');

const { lerCatalogo, lerDocumento, listar, instalar, montarSpf } = require('../../main/exemplos/instalar.js');

const CATALOGO = lerCatalogo(BASE);
const PASTA = lerDocumento(BASE).pasta;

describe('catalogo', () => {
  it('tem os cinco exemplos, com chave unica e sem campo vazio', () => {
    expect(CATALOGO.length).toBe(5);
    const chaves = CATALOGO.map((e) => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const e of CATALOGO) {
      expect(e.chave, 'chave').toMatch(/^[a-z0-9-]+$/);
      expect(e.nome?.length, `${e.chave}: nome`).toBeGreaterThan(0);
      expect(e.resumo?.length, `${e.chave}: resumo`).toBeGreaterThan(20);
      expect(['verilog', 'cmm'], `${e.chave}: linguagem`).toContain(e.linguagem);
    }
  });

  it('cobre os dois caminhos: Verilog puro e processador C±', () => {
    const porLinguagem = CATALOGO.reduce((acc, e) => {
      acc[e.linguagem] = (acc[e.linguagem] || 0) + 1;
      return acc;
    }, {});
    expect(porLinguagem.verilog).toBeGreaterThanOrEqual(1);
    expect(porLinguagem.cmm).toBeGreaterThanOrEqual(1);
  });

  it('todo arquivo que o catalogo cita existe no disco', () => {
    for (const e of CATALOGO) {
      const pasta = path.join(BASE, e.chave);
      expect(fs.existsSync(pasta), `${e.chave}: pasta`).toBe(true);
      for (const rel of [e.testbench, e.topLevel].filter(Boolean)) {
        const alvo = path.join(pasta, ...rel.split('/'));
        expect(fs.existsSync(alvo), `${e.chave}: ${rel}`).toBe(true);
      }
      for (const proc of e.processadores || []) {
        // A convencao da AURORA: <projeto>/<proc>/Software/<proc>.cmm. Fora
        // dela o processador nao e descoberto e o botao C± nao acha o fonte.
        const cmm = path.join(pasta, proc, 'Software', `${proc}.cmm`);
        expect(fs.existsSync(cmm), `${e.chave}: ${proc}/Software/${proc}.cmm`).toBe(true);
      }
    }
  });

  it('o #PRNAME de cada .cmm bate com o nome do processador', () => {
    // Divergindo, o compilador gera um modulo com um nome e o testbench
    // instancia outro, e a falha so aparece na elaboracao.
    for (const e of CATALOGO) {
      for (const proc of e.processadores || []) {
        const cmm = fs.readFileSync(path.join(BASE, e.chave, proc, 'Software', `${proc}.cmm`), 'utf8');
        expect(cmm, `${e.chave}/${proc}`).toMatch(new RegExp(`^#PRNAME\\s+${proc}\\s*$`, 'm'));
      }
    }
  });

  it('cada testbench declara o modulo com o nome do proprio arquivo', () => {
    // O botao Wave elabora com `-s <nome do modulo>` derivado do arquivo.
    for (const e of CATALOGO) {
      const rel = e.testbench;
      const nome = path.basename(rel, '.v');
      const texto = fs.readFileSync(path.join(BASE, e.chave, ...rel.split('/')), 'utf8');
      expect(texto, `${e.chave}: ${rel}`).toMatch(new RegExp(`^\\s*module\\s+${nome}\\b`, 'm'));
    }
  });

  it('cada testbench instancia os processadores do exemplo e escreve um dump', () => {
    for (const e of CATALOGO) {
      const texto = fs.readFileSync(path.join(BASE, e.chave, ...e.testbench.split('/')), 'utf8');
      expect(texto, `${e.chave}: $dumpfile`).toMatch(/\$dumpfile/);
      expect(texto, `${e.chave}: $finish`).toMatch(/\$finish/);
      for (const proc of e.processadores || []) {
        expect(texto, `${e.chave}: instancia de ${proc}`).toMatch(new RegExp(`\\b${proc}\\s+\\w+\\s*\\(`));
      }
    }
  });

  it('listar devolve o que a interface mostra, sem caminho de disco', () => {
    const lista = listar(BASE);
    expect(lista.length).toBe(CATALOGO.length);
    for (const item of lista) {
      expect(Object.keys(item).sort()).toEqual(['chave', 'linguagem', 'nome', 'processadores', 'resumo']);
    }
  });
});

describe('montarSpf', () => {
  it('escreve caminhos absolutos, que e como a AURORA le o .spf', () => {
    const exemplo = CATALOGO.find((e) => e.linguagem === 'cmm');
    const doc = montarSpf(path.join('C:', 'destino', exemplo.chave), exemplo);
    expect(path.isAbsolute(doc.structure.testbenchFile)).toBe(true);
    expect(doc.structure.processors).toEqual(exemplo.processadores.map((name) => ({ name })));
  });

  it('projeto com processador NAO registra Verilog que ainda nao existe', () => {
    // O .v do processador nasce na compilacao. Registra-lo aqui faria o
    // projeto abrir acusando arquivo faltante logo na primeira vez.
    for (const e of CATALOGO.filter((x) => x.linguagem === 'cmm')) {
      const doc = montarSpf(path.join('C:', 'destino', e.chave), e);
      expect(doc.structure.synthesizableFiles, e.chave).toEqual([]);
      expect(doc.structure.topLevelFile, e.chave).toBe('');
    }
  });

  it('projeto de Verilog puro ja nasce com o topo marcado', () => {
    const e = CATALOGO.find((x) => x.linguagem === 'verilog');
    const doc = montarSpf(path.join('C:', 'destino', e.chave), e);
    expect(doc.structure.synthesizableFiles).toHaveLength(1);
    expect(doc.structure.synthesizableFiles[0].isTopLevel).toBe(true);
    expect(doc.structure.topLevelFile).toContain('contador.v');
  });
});

describe('instalar', () => {
  let destino;
  beforeEach(() => { destino = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-ex-')); });
  afterEach(() => { fs.rmSync(destino, { recursive: true, force: true }); });

  it('poe tudo dentro de UMA pasta, e nao solto no destino escolhido', () => {
    // O destino costuma ser Documentos ou a area de trabalho, onde a pessoa ja
    // tem coisas. Cinco pastas soltas ali sao cinco coisas para limpar depois.
    const r = instalar(destino, { base: BASE });
    expect(r.pasta).toBe(path.join(destino, PASTA));
    expect(fs.readdirSync(destino)).toEqual([PASTA]);
    expect(fs.readdirSync(r.pasta).sort()).toEqual(CATALOGO.map((e) => e.chave).sort());
  });

  it('o nome da pasta-mae nao tem espaco', () => {
    // O caminho do projeto entra na linha de comando do Verilator, que constroi
    // por make e perl do MSYS, e espaco em caminho e como essa cadeia quebra.
    expect(PASTA).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('cria uma pasta por exemplo, cada uma com o seu .spf', () => {
    const r = instalar(destino, { base: BASE });
    expect(r.criados.length).toBe(CATALOGO.length);
    expect(r.pulados).toEqual([]);
    for (const e of CATALOGO) {
      const spf = path.join(r.pasta, e.chave, `${e.chave}.spf`);
      expect(fs.existsSync(spf), e.chave).toBe(true);
      const doc = JSON.parse(fs.readFileSync(spf, 'utf8'));
      // As duas metades que a AURORA le, e o basePath apontando para onde o
      // projeto de fato ficou.
      expect(doc.metadata.projectName).toBe(e.chave);
      expect(doc.structure.basePath).toBe(path.join(r.pasta, e.chave));
      expect(fs.existsSync(doc.structure.testbenchFile), `${e.chave}: testbench`).toBe(true);
    }
  });

  it('devolve o .spf de cada exemplo, que e o que vai para os recentes', () => {
    // A interface e o processo principal percorrem esta lista para decorar os
    // recentes; um caminho errado aqui poria na tela inicial uma entrada que
    // nao abre.
    const r = instalar(destino, { base: BASE });
    expect(r.criados.map((c) => c.chave)).toEqual(CATALOGO.map((e) => e.chave));
    for (const c of r.criados) {
      expect(c.spf.endsWith(`${c.chave}.spf`), c.chave).toBe(true);
      expect(fs.existsSync(c.spf), c.chave).toBe(true);
    }
  });

  it('instalar de novo na mesma pasta nao sobrescreve o que o aluno mexeu', () => {
    const primeira = instalar(destino, { base: BASE });
    const alvo = path.join(primeira.pasta, 'media-movel', 'mediamovel', 'Software', 'mediamovel.cmm');
    fs.writeFileSync(alvo, '// editado pelo aluno\n');

    const r = instalar(destino, { base: BASE });
    expect(r.criados).toEqual([]);
    expect(r.pulados.map((p) => p.chave).sort()).toEqual(CATALOGO.map((e) => e.chave).sort());
    expect(fs.readFileSync(alvo, 'utf8')).toBe('// editado pelo aluno\n');
  });

  it('um exemplo com problema nao impede os outros', () => {
    // Catalogo apontando para uma pasta que nao existe, ao lado dos validos.
    const baseFalsa = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-exbase-'));
    try {
      fs.cpSync(BASE, baseFalsa, { recursive: true });
      const doc = JSON.parse(fs.readFileSync(path.join(baseFalsa, 'catalogo.json'), 'utf8'));
      doc.exemplos.push({
        chave: 'fantasma', nome: 'Fantasma', resumo: 'Aponta para uma pasta que nao existe.',
        linguagem: 'verilog', processadores: [], topLevel: null, testbench: null,
      });
      fs.writeFileSync(path.join(baseFalsa, 'catalogo.json'), JSON.stringify(doc));

      const r = instalar(destino, { base: baseFalsa });
      expect(r.criados.length).toBe(CATALOGO.length);
      expect(r.pulados.map((p) => p.chave)).toEqual(['fantasma']);
    } finally {
      fs.rmSync(baseFalsa, { recursive: true, force: true });
    }
  });

  it('recusa destino vazio em vez de escrever em lugar nenhum', () => {
    expect(() => instalar('', { base: BASE })).toThrow(/destino/);
  });
});
