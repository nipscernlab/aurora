/**
 * A citacao do manual a partir do resultado da ferramenta
 * (js/ai/manual_citation.ts).
 *
 * O que estes casos travam, e por que importa: uma citacao e o que permite a
 * pessoa conferir uma afirmacao da assistente contra o manual. Uma citacao sem
 * pagina ou sem trecho e um link morto, e um link morto faz o leitor concluir
 * que a assistente inventou a referencia.
 *
 * O caso mais importante e o das DUAS FORMAS de resultado. Ler so a primeira
 * ja quebrou uma vez: a ferramenta rodava, o chip dizia "done" e a citacao
 * nao aparecia. Tudo certo, e nada na tela.
 */

import { describe, expect, it } from 'vitest';

import {
    citacaoDeResultado,
    citacaoJaEsta,
    corpoDoResultado,
    ehFerramentaDeCitacao,
} from '../../js/ai/manual_citation.ts';

/** O que a ferramenta devolve quando acha o trecho. */
const CORPO = {
    path: 'linguagem/tipos.html',
    title: 'Tipos',
    quote: 'O tipo float do SAPHO tem largura configuravel.',
    manualVersion: '6.4.2',
};

describe('ehFerramentaDeCitacao', () => {
    it('casa pelo FIM do nome, que atende os dois caminhos', () => {
        // Pela API vem `cite_manual`; pela assinatura vem prefixado pelo MCP.
        expect(ehFerramentaDeCitacao('cite_manual')).toBe(true);
        expect(ehFerramentaDeCitacao('mcp__aurora__cite_manual')).toBe(true);
    });

    it('nao casa com outra ferramenta nem com nome ausente', () => {
        for (const n of ['read_file', 'cite_manual_x', '', null, undefined]) {
            expect(ehFerramentaDeCitacao(n), String(n)).toBe(false);
        }
    });
});

describe('corpoDoResultado: as duas formas', () => {
    it('pela API, o objeto vem inteiro em data', () => {
        expect(corpoDoResultado({ ok: true, data: CORPO })).toEqual(CORPO);
    });

    it('pela assinatura, vem serializado em content', () => {
        expect(corpoDoResultado({ ok: true, content: JSON.stringify(CORPO) })).toEqual(CORPO);
    });

    it('content pode trazer o envelope inteiro, e ai o data sai de dentro', () => {
        const texto = JSON.stringify({ ok: true, data: CORPO });
        expect(corpoDoResultado({ ok: true, content: texto })).toEqual(CORPO);
    });

    it('resultado sem envelope passa direto', () => {
        expect(corpoDoResultado(CORPO)).toEqual(CORPO);
    });

    it('ok falso devolve null, nas duas formas', () => {
        expect(corpoDoResultado({ ok: false, data: CORPO })).toBeNull();
        expect(corpoDoResultado({ ok: true, content: JSON.stringify({ ok: false }) })).toBeNull();
    });

    it('content que nao e JSON devolve null, e nao lanca', () => {
        expect(() => corpoDoResultado({ ok: true, content: 'isto nao e json' })).not.toThrow();
        expect(corpoDoResultado({ ok: true, content: 'isto nao e json' })).toBeNull();
    });

    it('nada devolve null', () => {
        for (const x of [null, undefined, 0, '']) expect(corpoDoResultado(x)).toBeNull();
    });
});

describe('citacaoDeResultado', () => {
    it('monta a citacao pelos dois caminhos, com o mesmo resultado', () => {
        const esperado = {
            pagina: 'linguagem/tipos.html',
            titulo: 'Tipos',
            trecho: CORPO.quote,
            versao: '6.4.2',
        };
        expect(citacaoDeResultado('cite_manual', { ok: true, data: CORPO })).toEqual(esperado);
        expect(citacaoDeResultado('mcp__aurora__cite_manual',
            { ok: true, content: JSON.stringify(CORPO) })).toEqual(esperado);
    });

    it('sem titulo, o caminho da pagina serve de titulo', () => {
        const { title: _title, ...semTitulo } = CORPO;
        expect(citacaoDeResultado('cite_manual', { data: semTitulo }).titulo)
            .toBe('linguagem/tipos.html');
    });

    it('a versao do manual instalado entra quando o resultado nao declara uma', () => {
        const { manualVersion: _versao, ...semVersao } = CORPO;
        expect(citacaoDeResultado('cite_manual', { data: semVersao }, '7.0.0').versao)
            .toBe('7.0.0');
        expect(citacaoDeResultado('cite_manual', { data: semVersao }).versao).toBe('');
    });

    it('a versao do proprio resultado tem precedencia sobre a instalada', () => {
        expect(citacaoDeResultado('cite_manual', { data: CORPO }, '7.0.0').versao).toBe('6.4.2');
    });

    it('recusa sem trecho ou sem pagina: seria um link morto', () => {
        const semTrecho = { ...CORPO, quote: '' };
        const semPagina = { ...CORPO, path: '' };
        expect(citacaoDeResultado('cite_manual', { data: semTrecho })).toBeNull();
        expect(citacaoDeResultado('cite_manual', { data: semPagina })).toBeNull();
    });

    it('recusa quando a ferramenta nao e a de citar', () => {
        expect(citacaoDeResultado('read_file', { data: CORPO })).toBeNull();
    });

    it('recusa resultado vazio ou nao serializavel, sem lancar', () => {
        for (const r of [null, undefined, { ok: false }, { ok: true, content: '{' }]) {
            expect(citacaoDeResultado('cite_manual', r)).toBeNull();
        }
    });
});

describe('citacaoJaEsta', () => {
    const c = { pagina: 'a.html', titulo: 'A', trecho: 'frase', versao: '1' };

    it('o mesmo trecho da mesma pagina e repeticao, nao segunda fonte', () => {
        expect(citacaoJaEsta([{ ...c, titulo: 'outro', versao: '2' }], c)).toBe(true);
    });

    it('trecho diferente da mesma pagina sao duas citacoes', () => {
        expect(citacaoJaEsta([{ ...c, trecho: 'outra frase' }], c)).toBe(false);
    });

    it('o mesmo trecho em paginas diferentes sao duas citacoes', () => {
        expect(citacaoJaEsta([{ ...c, pagina: 'b.html' }], c)).toBe(false);
    });

    it('lista vazia, ausente ou que nao e lista devolve falso', () => {
        for (const l of [[], null, undefined, {}]) expect(citacaoJaEsta(l, c)).toBe(false);
    });
});
