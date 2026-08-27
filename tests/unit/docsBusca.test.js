/**
 * A busca dentro do manual (main/docs/busca.js).
 *
 * Ela existe para a Aurora Intelligence responder do manual em vez de
 * responder de memória, e três propriedades decidem se isso funciona.
 *
 * Acento não pode atrapalhar. O manual é em português e quem digita numa
 * conversa raramente acentua; se "notacao" não achasse "notação", a ferramenta
 * pareceria quebrada justamente para quem mais precisa dela.
 *
 * Exigir todos os termos. Uma busca por duas palavras que devolvesse páginas
 * com só uma delas faria o modelo responder ao lado da pergunta, com uma fonte
 * de aparência legítima, que é pior do que não achar nada.
 *
 * E o caminho da leitura vem do modelo, então é fronteira de segurança: sem a
 * validação, a ferramenta de ler o manual vira ferramenta de ler o disco.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const busca = require('../../main/docs/busca.js');

let dir;

/** Uma página do manual, no formato que o Sphinx produz. */
function pagina(rel, titulo, corpo) {
  const alvo = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo,
    `<!DOCTYPE html><html><head><title>${titulo} - SAPHO &amp; AURORA 6.4.2, Manual de uso</title>`
    + '<style>.x{color:red}</style></head><body>'
    + `<h1>${titulo}</h1><p>${corpo}</p>`
    + '<script>var busca = "palavra que nao deveria ser indexada";</script>'
    + '</body></html>', 'utf8');
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-manual-'));
  busca.limparCache();
  pagina('index.html', 'Manual do SAPHO', 'A porta de entrada.');
  pagina('avancado/dirac.html', 'Notação de Dirac',
    'A álgebra linear escrita como na física. O símbolo de fechamento é o ket. Dirac aparece muitas vezes: Dirac, Dirac.');
  pagina('verilog/ondas.html', 'Formas de onda',
    'O Verilator compila um binário nativo e é bem mais rápido em simulações longas.');
  pagina('_static/apoio.html', 'Apoio do tema', 'Dirac Verilator, mas isto é apoio e não conteúdo.');
});

afterEach(() => {
  busca.limparCache();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* melhor esforço */ }
});

describe('o índice', () => {
  it('pega as páginas de conteúdo e ignora as pastas de apoio', () => {
    // `_static`, `_images` e `_sources` são apoio do tema e do build. Indexá-los
    // encheria a busca de resultado sem texto útil.
    const caminhos = busca.indexar(dir).map((p) => p.caminho).sort();
    expect(caminhos).toEqual(['avancado/dirac.html', 'index.html', 'verilog/ondas.html']);
  });

  it('não indexa o conteúdo de script nem de style', () => {
    // Sem isso a busca acharia palavra dentro do código de navegação do tema.
    expect(busca.buscar(dir, 'palavra que nao deveria ser indexada')).toEqual([]);
  });

  it('tira o sufixo do tema do título', () => {
    const p = busca.indexar(dir).find((x) => x.caminho === 'avancado/dirac.html');
    expect(p.titulo).toBe('Notação de Dirac');
  });

  it('se refaz quando o manual é atualizado com o aplicativo aberto', () => {
    expect(busca.buscar(dir, 'cocotb')).toEqual([]);
    pagina('verilog/testbenches.html', 'Testbenches', 'Escrever testbench em cocotb.');
    // O carimbo do index.html é a validade do índice, e a atualização o reescreve.
    const idx = path.join(dir, 'index.html');
    fs.utimesSync(idx, new Date(), new Date(Date.now() + 5000));
    expect(busca.buscar(dir, 'cocotb').map((r) => r.caminho)).toEqual(['verilog/testbenches.html']);
  });
});

describe('procurar', () => {
  it('acha sem acento o que está escrito com acento', () => {
    const r = busca.buscar(dir, 'notacao de dirac');
    expect(r[0].caminho).toBe('avancado/dirac.html');
  });

  it('acha com acento também, e ignora maiúscula', () => {
    expect(busca.buscar(dir, 'NOTAÇÃO')[0].caminho).toBe('avancado/dirac.html');
  });

  it('exige todos os termos', () => {
    // "dirac verilator" não existe em página nenhuma; devolver a de Dirac aqui
    // faria o modelo responder sobre Dirac uma pergunta sobre Verilator.
    expect(busca.buscar(dir, 'dirac verilator')).toEqual([]);
  });

  it('põe o título acima do corpo na ordem', () => {
    // A página cujo TÍTULO casa vem antes da que só menciona no meio do texto.
    const r = busca.buscar(dir, 'onda');
    expect(r[0].caminho).toBe('verilog/ondas.html');
  });

  it('devolve um trecho com contexto em volta do termo', () => {
    const r = busca.buscar(dir, 'ket');
    expect(r[0].trecho).toContain('ket');
    expect(r[0].trecho.length).toBeGreaterThan(10);
  });

  it('respeita o limite pedido', () => {
    expect(busca.buscar(dir, 'de', { limite: 1 })).toHaveLength(1);
  });

  it('consulta vazia ou curta demais não devolve o manual inteiro', () => {
    // Um termo de uma letra casaria com quase tudo, e o modelo receberia cinco
    // páginas sem relação nenhuma com a pergunta.
    expect(busca.buscar(dir, '')).toEqual([]);
    expect(busca.buscar(dir, '   ')).toEqual([]);
    expect(busca.buscar(dir, 'a')).toEqual([]);
  });
});

describe('ler uma página', () => {
  it('devolve título e texto sem marcação', () => {
    const r = busca.ler(dir, 'avancado/dirac.html');
    expect(r.ok).toBe(true);
    expect(r.titulo).toBe('Notação de Dirac');
    expect(r.texto).toContain('álgebra linear');
    expect(r.texto).not.toContain('<h1>');
  });

  it('trunca página longa e avisa que truncou', () => {
    const r = busca.ler(dir, 'avancado/dirac.html', { limite: 20 });
    expect(r.truncado).toBe(true);
    expect(r.texto.endsWith('...')).toBe(true);
  });

  it('aceita barra invertida, que é o que o Windows devolve', () => {
    expect(busca.ler(dir, 'avancado\\dirac.html').ok).toBe(true);
  });

  it('recusa sair da pasta do manual', () => {
    // A fronteira que impede a ferramenta de ler o manual de virar ferramenta
    // de ler o disco. O `.html` no fim é de propósito: sem ele, a recusa viria
    // da checagem de extensão e esta não estaria sendo exercitada.
    for (const fora of ['../segredo.html', '../../outro/lugar.html', 'avancado/../../fora.html']) {
      const r = busca.ler(dir, fora);
      expect(r.ok, fora).toBe(false);
      expect(r.erro, fora).toMatch(/fora do manual/);
    }
  });

  it('recusa o que não é página do manual', () => {
    for (const nao of ['', 'config.json', 'script.js', 'imagem.png']) {
      expect(busca.ler(dir, nao).ok, nao).toBe(false);
    }
  });

  it('página inexistente devolve erro com o nome pedido', () => {
    const r = busca.ler(dir, 'nao/existe.html');
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('nao/existe.html');
  });
});

describe('manual ausente', () => {
  it('pasta sem index.html não quebra, só não acha nada', () => {
    const vazia = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-vazio-'));
    try {
      expect(busca.indexar(vazia)).toEqual([]);
      expect(busca.buscar(vazia, 'dirac')).toEqual([]);
      expect(busca.contar(vazia)).toBe(0);
    } finally {
      fs.rmSync(vazia, { recursive: true, force: true });
    }
  });
});
