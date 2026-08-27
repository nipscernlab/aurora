/**
 * Testes de integridade do catálogo de componentes.
 *
 * O catálogo é o que decide se uma ferramenta pode ser executada, então um erro
 * aqui não aparece como erro: aparece como um recurso que deixou de funcionar
 * numa máquina onde ele está instalado, ou pior, como um recurso que tenta
 * funcionar sem o componente e falha lá adiante com uma mensagem que não ajuda
 * ninguém.
 *
 * São três amarrações, e nenhuma delas dá para conferir lendo:
 *
 * 1. Todo binário do allowlist tem dono, e o dono existe no catálogo. Sem isso,
 *    um binário novo passa direto pela porta.
 * 2. A sentinela de cada componente é a MESMA que o instalador dele usa como
 *    prova de instalação. Se as duas divergirem, a AURORA acha que o componente
 *    falta quando ele está lá, ou o contrário.
 * 3. Chave desconhecida não bloqueia. É a escolha deliberada de errar para o
 *    lado de deixar funcionar, e uma inversão acidental disso derrubaria a
 *    compilação inteira.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { RAW_ALLOWLIST, donoDoBinario } from '../../main/compile/binary_allowlist.js';
import {
  COMPONENTES, obter, estaInstalado, mensagemDeAusencia,
  diagnosticar, listar, definirRaizParaTestes,
} from '../../main/components/registry.js';
import { createRequire } from 'node:module';

const criarRequire = createRequire(import.meta.url);
const { COMPONENTS: DERIVA } = criarRequire('../../scripts/check-component-drift.js');
const { NOME_PADRAO } = criarRequire('../../components/Scripts/lib/version_stamp.js');

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('catalogo de componentes', () => {
  it('nao tem chave repetida', () => {
    const chaves = COMPONENTES.map((c) => c.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('so o YANC e essencial: e o unico que viaja no instalador', () => {
    // A cadeia de compilacao NAO e essencial de proposito. Sao 955 MB em
    // disco, mais da metade do instalador, e mante-la dentro seria nao ter
    // componentizado nada. Se alguem promover o msys a essencial de volta,
    // este teste e o lugar onde a decisao tem que ser discutida de novo.
    const essenciais = COMPONENTES.filter((c) => c.essencial).map((c) => c.chave);
    expect(essenciais).toEqual(['yanc']);
  });

  it('o que compila esta marcado, para a interface tratar como urgente', () => {
    const compilam = COMPONENTES.filter((c) => c.requerParaCompilar).map((c) => c.chave).sort();
    expect(compilam).toEqual(['msys', 'yanc']);
  });

  it('todo componente declara tamanho em disco e de download', () => {
    for (const c of COMPONENTES) {
      expect(c.tamanhoMB, c.chave).toBeGreaterThan(0);
      expect(c.downloadMB, c.chave).toBeGreaterThan(0);
      // O zip nunca e maior que o extraido; se ficar, alguem trocou os campos.
      expect(c.downloadMB, c.chave).toBeLessThanOrEqual(c.tamanhoMB);
    }
  });
});

describe('allowlist e catalogo andam juntos', () => {
  it('todo binario do allowlist tem dono declarado', () => {
    for (const [nome, , dono] of RAW_ALLOWLIST) {
      expect(dono, `${nome} sem dono`).toBeTruthy();
    }
  });

  it('todo dono existe no catalogo', () => {
    for (const [nome, , dono] of RAW_ALLOWLIST) {
      expect(obter(dono), `${nome} aponta para o componente inexistente ${dono}`).toBeDefined();
    }
  });

  it('donoDoBinario responde pelo nome do arquivo', () => {
    expect(donoDoBinario('gtkwave.exe')).toBe('gtkwave');
    expect(donoDoBinario('GTKWAVE.EXE')).toBe('gtkwave');
    expect(donoDoBinario('cmmcomp.exe')).toBe('yanc');
    expect(donoDoBinario('nao-existe.exe')).toBeNull();
  });

  it('todo componente nao essencial e dono de pelo menos um binario', () => {
    // Um componente que nao possui binario nenhum nunca seria bloqueado pelo
    // portao, e entao a ausencia dele apareceria so na hora do erro.
    const donos = new Set(RAW_ALLOWLIST.map(([, , d]) => d));
    for (const c of COMPONENTES.filter((x) => !x.essencial)) {
      expect(donos.has(c.chave), `${c.chave} nao tem binario no allowlist`).toBe(true);
    }
  });
});

describe('a sentinela e a mesma que o instalador usa', () => {
  for (const c of COMPONENTES) {
    it(`${c.chave}: ${c.sentinela}`, () => {
      const script = path.join(RAIZ, 'components', 'Scripts', c.script);
      if (!fs.existsSync(script)) {
        throw new Error(`o instalador declarado nao existe: ${c.script}`);
      }
      const fonte = fs.readFileSync(script, 'utf8');
      // O instalador monta a sentinela com path.join, entao o que da para
      // comparar e o ultimo trecho, que e o nome do arquivo, mais a pasta que o
      // contem. Basta para pegar a troca de binario ou de pasta, que e o que
      // acontece quando o upstream muda de nome.
      const partes = c.sentinela.split('/');
      const arquivo = partes[partes.length - 1];
      expect(fonte, `${c.script} nao menciona ${arquivo}`).toContain(arquivo);
    });
  }
});

describe('estaInstalado', () => {
  it('nao bloqueia o que nao esta no catalogo', () => {
    expect(estaInstalado('componente-que-nao-existe')).toBe(true);
  });
});

describe('mensagemDeAusencia', () => {
  it('diz o nome, o caminho da solucao e o tamanho', () => {
    const m = mensagemDeAusencia('gtkwave');
    expect(m).toContain('GTKWave');
    expect(m).toContain('Componentes');
    // O tamanho citado e o do download, que e o que a pessoa vai esperar.
    expect(m).toContain('30 MB');
  });

  it('nao quebra com chave desconhecida', () => {
    expect(mensagemDeAusencia('xpto')).toContain('xpto');
  });
});


describe('instalador e catalogo andam juntos', () => {
  // O que o registry diz que e opcional TEM que estar excluido do
  // extraResources, senao o instalador volta a carregar tudo; e o que e
  // essencial NAO pode estar excluido, senao a AURORA sai de fabrica quebrada.
  const build = JSON.parse(
    fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).build;
  const filtro = build.extraResources[0].filter;

  it('todo componente opcional esta fora do instalador', () => {
    for (const c of COMPONENTES.filter((x) => !x.essencial)) {
      const pasta = c.sentinela.split('/')[1];
      expect(filtro, `${c.chave} deveria estar excluido`).toContain(`!Packages/${pasta}/**`);
    }
  });

  it('nenhum componente essencial esta excluido', () => {
    for (const c of COMPONENTES.filter((x) => x.essencial)) {
      const partes = c.sentinela.split('/');
      if (partes[0] !== 'Packages') return; // yanc mora em bin/, nunca excluivel
      expect(filtro).not.toContain(`!Packages/${partes[1]}/**`);
    }
  });

  it('os instaladores continuam dentro do pacote', () => {
    // Sem components/Scripts a maquina do aluno nao teria COMO baixar nada.
    expect(filtro.some((f) => f.startsWith('!Scripts'))).toBe(false);
  });
});


describe('arquivos-chave', () => {
  // O doctor diagnostica por eles; um caminho errado aqui faria um componente
  // saudavel parecer eternamente quebrado, e o doctor re-baixaria 272 MB a
  // cada rodada.
  it('todo arquivo-chave mora numa area do proprio componente', () => {
    // O YANC e a excecao declarada: o release dele espalha quatro areas
    // (bin, HDL, Header, Macros), todas instaladas e conferidas pelo
    // download-yanc.js. Qualquer outro componente vive numa pasta so, e um
    // arquivo-chave fora dela seria o doctor diagnosticando o componente
    // errado.
    const AREAS = { yanc: ['bin/', 'HDL/', 'Header/', 'Macros/'] };
    for (const c of COMPONENTES) {
      const bases = AREAS[c.chave]
        || [c.sentinela.split('/')[0] === 'Packages'
          ? c.sentinela.split('/').slice(0, 2).join('/') + '/'
          : c.sentinela.split('/')[0] + '/'];
      for (const rel of c.arquivosChave) {
        expect(
          bases.some((b) => rel.startsWith(b)),
          `${c.chave}: ${rel} fora de ${bases.join(', ')}`,
        ).toBe(true);
      }
    }
  });

  it('os arquivos-chave do yanc sao as sentinelas do proprio instalador', () => {
    // download-yanc.js confere HDL/core.v, Header/cmath e Macros/float_sin.asm
    // como prova de instalacao completa. O catalogo tem que olhar os mesmos
    // arquivos, senao o instalador e o doctor discordam sobre o que e uma
    // instalacao inteira.
    const yanc = COMPONENTES.find((c) => c.chave === 'yanc');
    for (const rel of ['HDL/core.v', 'Header/cmath', 'Macros/float_sin.asm']) {
      expect(yanc.arquivosChave).toContain(rel);
    }
  });

  it('quem compila declara os binarios que o allowlist conhece', () => {
    const msys = COMPONENTES.find((c) => c.chave === 'msys');
    expect(msys.arquivosChave.some((a) => a.endsWith('iverilog.exe'))).toBe(true);
    const yanc = COMPONENTES.find((c) => c.chave === 'yanc');
    expect(yanc.arquivosChave.some((a) => a.endsWith('cmmcomp.exe'))).toBe(true);
  });
});


describe('versao: o catalogo e o instalador fixam a MESMA tag', () => {
  // O painel diz "atualizacao disponivel" comparando o carimbo que o
  // instalador gravou com a `versao` daqui. Se alguem subir a tag num lado so,
  // ou o painel pede atualizacao para sempre, ou nunca pede. O guarda de deriva
  // (scripts/check-component-drift.js) ja sabe ler a tag de cada script; e a
  // mesma leitura que amarra os dois lados aqui.
  const CHAVE_DA_DERIVA = { toolchain: 'msys' };

  for (const d of DERIVA) {
    const chave = CHAVE_DA_DERIVA[d.key] || d.key;
    it(`${chave}: registry.versao == tag de ${d.script}`, () => {
      const c = obter(chave);
      expect(c, `${chave} nao esta no catalogo`).toBeDefined();
      // require, e nao import(): o caminho e montado da tabela de deriva, e o
      // import dinamico com variavel nao passa pelo analisador do Vite.
      const mod = criarRequire(path.join(RAIZ, 'components', 'Scripts', d.script));
      expect(c.versao).toBe(d.tagOf(mod));
    });
  }

  it('todo componente declara versao e carimbo, e o instalador grava o mesmo carimbo', () => {
    for (const c of COMPONENTES) {
      expect(c.versao, c.chave).toBeTruthy();
      expect(c.carimbo, c.chave).toBeTruthy();
      const fonte = fs.readFileSync(path.join(RAIZ, 'components', 'Scripts', c.script), 'utf8');
      const arquivo = c.carimbo.split('/').pop();
      // Ou o nome padrao (vindo de lib/version_stamp.js) ou o nome proprio do
      // YANC; nos dois casos o script tem que escrever o carimbo.
      const mencionado = arquivo === NOME_PADRAO ? /NOME_PADRAO/.test(fonte) : fonte.includes(arquivo);
      expect(mencionado, `${c.script} nao usa o carimbo ${c.carimbo}`).toBe(true);
      expect(fonte, `${c.script} nao grava o carimbo`).toContain('escreverCarimbo(');
    }
  });
});


describe('diagnosticar le o disco e o carimbo', () => {
  let raiz;
  beforeEach(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-registro-'));
    definirRaizParaTestes(raiz);
  });
  afterEach(() => {
    definirRaizParaTestes(null);
    fs.rmSync(raiz, { recursive: true, force: true });
  });

  const gravar = (rel, conteudo = 'x') => {
    const p = path.join(raiz, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, conteudo);
  };

  it('ausente quando a sentinela nao esta la', () => {
    expect(diagnosticar('surfer')).toEqual({
      chave: 'surfer', estado: 'ausente', faltando: [obter('surfer').sentinela], versaoInstalada: null,
    });
  });

  it('ok sem carimbo: instalacao de antes do carimbo nao e desatualizada', () => {
    gravar(obter('surfer').sentinela);
    definirRaizParaTestes(raiz);
    expect(diagnosticar('surfer')).toEqual({ chave: 'surfer', estado: 'ok', faltando: [], versaoInstalada: null });
  });

  it('ok com o carimbo da versao fixada', () => {
    const c = obter('surfer');
    gravar(c.sentinela);
    gravar(c.carimbo, `${c.versao}\n`);
    definirRaizParaTestes(raiz);
    expect(diagnosticar('surfer')).toEqual({ chave: 'surfer', estado: 'ok', faltando: [], versaoInstalada: c.versao });
  });

  it('desatualizado com carimbo de outra versao, e o painel ve isso', () => {
    const c = obter('surfer');
    gravar(c.sentinela);
    gravar(c.carimbo, 'v0.7.0-nips.2');
    definirRaizParaTestes(raiz);
    expect(diagnosticar('surfer')).toEqual({
      chave: 'surfer', estado: 'desatualizado', faltando: [], versaoInstalada: 'v0.7.0-nips.2',
    });
    const surfer = listar().find((x) => x.chave === 'surfer');
    expect(surfer.instalado).toBe(true);
    expect(surfer.estado).toBe('desatualizado');
    expect(surfer.versaoInstalada).toBe('v0.7.0-nips.2');
  });

  it('incompleto vence desatualizado: sentinela la, arquivo-chave faltando', () => {
    const c = obter('msys');
    gravar(c.sentinela);
    gravar(c.carimbo, 'msys-v0');
    definirRaizParaTestes(raiz);
    const d = diagnosticar('msys');
    expect(d.estado).toBe('incompleto');
    expect(d.faltando).toEqual(c.arquivosChave);
    expect(d.versaoInstalada).toBe('msys-v0');
  });

  it('ok quando sentinela, arquivos-chave e carimbo estao todos certos', () => {
    const c = obter('msys');
    gravar(c.sentinela);
    for (const rel of c.arquivosChave) gravar(rel);
    gravar(c.carimbo, c.versao);
    definirRaizParaTestes(raiz);
    expect(diagnosticar('msys').estado).toBe('ok');
  });
});
