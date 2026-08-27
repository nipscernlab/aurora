/**
 * As sugestoes da notacao de Dirac (js/editor/dirac_snippets.js).
 *
 * Elas existem porque os simbolos nao estao no teclado, entao o que precisa de
 * prova e que os simbolos oferecidos sao EXATAMENTE os que o compilador
 * aceita. Uma sugestao com o caractere errado e pior do que nenhuma: a pessoa
 * confia, escreve, e o erro aparece na compilacao, num lugar que ela nao tem
 * como relacionar com a lista de autocompletar.
 *
 * A fonte da verdade e o resources/sapho_rules.json, que o
 * scripts/sync-sapho-rules.js extrai do proprio yanc.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { SUGESTOES_DIRAC, KET_ABRE, KET_FECHA, registrarSnippetsDirac } from '../../js/editor/dirac_snippets.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGRAS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'resources', 'sapho_rules.json'), 'utf8'));

/** Os simbolos que o lexer do yanc reconhece, lidos das regras extraidas dele. */
function diracTokens() {
  const busca = (no) => {
    if (!no || typeof no !== 'object') return null;
    if (Array.isArray(no.diracTokens)) return no.diracTokens;
    for (const v of Object.values(no)) {
      const achou = busca(v);
      if (achou) return achou;
    }
    return null;
  };
  const t = busca(REGRAS);
  if (!t) throw new Error('diracTokens nao encontrado em sapho_rules.json');
  return t;
}

describe('os simbolos oferecidos sao os que o compilador aceita', () => {
  const TOKENS = diracTokens();

  it('o bra e o ket sao os caracteres Unicode do lexer, e nao os do teclado', () => {
    const simbolos = TOKENS.map((t) => t.symbol);
    expect(simbolos).toContain(KET_FECHA);
    expect(simbolos).toContain(KET_ABRE);
    // O ponto inteiro do arquivo: estes NAO sao < e > do teclado.
    expect(KET_ABRE).not.toBe('<');
    expect(KET_FECHA).not.toBe('>');
    expect(KET_ABRE.codePointAt(0)).toBe(0x27E8);
    expect(KET_FECHA.codePointAt(0)).toBe(0x27E9);
  });

  it('nenhuma sugestao insere o sinal de maior ou menor do teclado', () => {
    // Um `>` que escapasse para uma insercao viraria comparacao no lexer, e o
    // erro sairia como sintaxe invalida numa linha que parece certa na tela.
    for (const s of SUGESTOES_DIRAC) {
      const corpo = s.insercao.replace(/\$\{\d+:[^}]*\}|\$\d+/g, '');
      expect(corpo, `${s.rotulo}: ${s.insercao}`).not.toMatch(/[<>]/);
    }
  });

  it('as formas com |I| e |0> usam a grafia exata do lexer', () => {
    const simbolos = TOKENS.map((t) => t.symbol);
    const comEye = SUGESTOES_DIRAC.find((s) => s.rotulo === 'dirac-identidade');
    const comZero = SUGESTOES_DIRAC.find((s) => s.rotulo === 'dirac-zera');
    for (const [sug, simbolo] of [[comEye, '|I|'], [comZero, `|0${KET_FECHA}`]]) {
      expect(simbolos, `lexer conhece ${simbolo}`).toContain(simbolo);
      expect(sug.insercao, `${sug.rotulo} insere ${simbolo}`).toContain(simbolo);
    }
  });
});

describe('a lista', () => {
  it('cobre as quatro operacoes, os dois vetores e os dois caracteres soltos', () => {
    const rotulos = SUGESTOES_DIRAC.map((s) => s.rotulo);
    for (const esperado of [
      'ket', 'bra', 'braket',
      'dirac-matriz-vetor', 'dirac-escalar-vetor', 'dirac-produto-externo',
      'dirac-identidade', 'dirac-zera', 'dirac-entrada',
      KET_ABRE, KET_FECHA,
    ]) {
      expect(rotulos, esperado).toContain(esperado);
    }
  });

  it('toda sugestao tem detalhe, documentacao e gatilho', () => {
    for (const s of SUGESTOES_DIRAC) {
      expect(s.detalhe?.length, `${s.rotulo}: detalhe`).toBeGreaterThan(0);
      expect(s.doc?.length, `${s.rotulo}: doc`).toBeGreaterThan(20);
      expect(s.gatilhos?.length, `${s.rotulo}: gatilhos`).toBeGreaterThan(0);
    }
  });

  it('os rotulos nao se repetem', () => {
    const rotulos = SUGESTOES_DIRAC.map((s) => s.rotulo);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it('quem procura por "dirac" acha tudo', () => {
    // O gatilho comum e o que faz a lista inteira aparecer para quem sabe o
    // nome da notacao mas nao sabe o nome de nenhuma operacao.
    for (const s of SUGESTOES_DIRAC) {
      expect(s.gatilhos, s.rotulo).toContain('dirac');
    }
  });
});

describe('registrarSnippetsDirac', () => {
  const monacoFalso = () => {
    const registrar = vi.fn(() => ({ dispose: vi.fn() }));
    return {
      registrar,
      monaco: {
        languages: {
          registerCompletionItemProvider: registrar,
          CompletionItemKind: { Snippet: 27 },
          CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
        },
      },
    };
  };

  it('registra no idioma cmm e devolve as sugestoes com o intervalo da palavra', () => {
    const { monaco, registrar } = monacoFalso();
    registrarSnippetsDirac(monaco);
    expect(registrar).toHaveBeenCalledTimes(1);
    const [idioma, provedor] = registrar.mock.calls[0];
    expect(idioma).toBe('cmm');

    const model = { getWordUntilPosition: () => ({ startColumn: 3, endColumn: 6 }) };
    const r = provedor.provideCompletionItems(model, { lineNumber: 7, column: 6 });
    expect(r.suggestions.length).toBe(SUGESTOES_DIRAC.length);
    // O intervalo tem que ser o da palavra sob o cursor; errado, a insercao
    // sobrescreve o que o usuario ja tinha escrito ao lado.
    expect(r.suggestions[0].range).toEqual({
      startLineNumber: 7, endLineNumber: 7, startColumn: 3, endColumn: 6,
    });
    expect(r.suggestions[0].insertTextRules).toBe(4);
  });

  it('nao explode quando o Monaco ainda nao subiu', () => {
    expect(registrarSnippetsDirac(undefined)).toBeNull();
    expect(registrarSnippetsDirac({})).toBeNull();
  });
});
