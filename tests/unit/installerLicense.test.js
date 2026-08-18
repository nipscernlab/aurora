/**
 * Testes do texto que a página de licença do instalador mostra.
 *
 * Dois defeitos motivaram isto, e os dois eram invisíveis fora do instalador.
 *
 * O primeiro: o texto ia como Markdown cru, então `##`, `**` e as barras da
 * tabela apareciam na tela como pontuação solta. Ninguém percebe até rodar o
 * instalador, que é a última coisa a rodar.
 *
 * O segundo, pior: o script concatenava LICENSE e LICENSE-SAPHO.md inteiros, e
 * como os dois são "base mais o próprio anexo", a licença base aparecia DUAS
 * vezes, sem nada dizendo que era a mesma coisa.
 */

import { describe, it, expect } from 'vitest';

import gen from '../../scripts/gen-installer-license.js';

const { paraTextoPuro, extrairAnexo } = gen;

describe('conversão para texto puro', () => {
    it('tira os sinais de título e deixa o texto', () => {
        const t = paraTextoPuro('# Licença\n\n## Definições\n');
        expect(t).toContain('LICENÇA');
        expect(t).toContain('DEFINIÇÕES');
        expect(t).not.toMatch(/#/);
    });

    it('tira negrito, itálico e crase', () => {
        const t = paraTextoPuro('Isto é **forte**, isto é *ênfase* e isto é `código`.');
        expect(t).toBe('Isto é forte, isto é ênfase e isto é código.');
    });

    it('resolve itálico que atravessa a quebra de linha do fonte', () => {
        // Este era o furo: enquanto o parágrafo estava quebrado em linhas, o
        // `*...*` não casava e o asterisco vazava para a tela.
        const t = paraTextoPuro('*An English translation is\nprovided below.*');
        expect(t).not.toMatch(/\*/);
        expect(t).toContain('An English translation is provided below.');
    });

    it('mantém o endereço dos links, que numa licença é informação', () => {
        const t = paraTextoPuro('Veja [o site](https://nipscern.com).');
        expect(t).toContain('o site (https://nipscern.com)');
        expect(t).not.toContain('](');
    });

    it('junta as linhas do parágrafo antes de quebrar de novo', () => {
        // O fonte já vem quebrado em ~78 colunas. Reembrulhar linha a linha
        // produzia saída esfarrapada, com uma palavra sozinha em cada terceira
        // linha.
        const fonte = 'uma frase curta\nque continua aqui\ne termina aqui.';
        const linhas = paraTextoPuro(fonte).split('\n').filter(Boolean);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toBe('uma frase curta que continua aqui e termina aqui.');
    });

    it('nenhuma linha passa da largura da janela', () => {
        const longo = 'palavra '.repeat(80);
        for (const l of paraTextoPuro(longo).split('\n')) {
            expect(l.length).toBeLessThanOrEqual(78);
        }
    });

    it('a tabela vira lista legível, sem barras', () => {
        const md = '| Componente | Licença |\n|---|---|\n| Yosys | ISC |\n';
        const t = paraTextoPuro(md);
        expect(t).toContain('Componente: Yosys');
        expect(t).toContain('Licença: ISC');
        expect(t).not.toMatch(/\|/);
    });

    it('a continuação do item alinha com o texto, e nao com o marcador', () => {
        const md = `- ${'palavra '.repeat(30)}`;
        const linhas = paraTextoPuro(md).split('\n');
        expect(linhas[0].startsWith('- ')).toBe(true);
        expect(linhas[1].startsWith('  ')).toBe(true);
        expect(linhas[1].trimStart().startsWith('-')).toBe(false);
    });
});

describe('extração do anexo', () => {
    it('devolve do título do anexo em diante, e nada da base', () => {
        const doc = '# Licença\n\nbase aqui\n\n---\n\n# Anexo: AURORA\n\nso o anexo\n';
        const a = extrairAnexo(doc, 'teste');
        expect(a).toContain('# Anexo: AURORA');
        expect(a).toContain('so o anexo');
        expect(a).not.toContain('base aqui');
    });

    it('reclama alto quando o anexo nao existe', () => {
        // Falhar o build e melhor do que gerar um instalador com licenca
        // incompleta e ninguem notar.
        expect(() => extrairAnexo('# Licença\n\nso base\n', 'teste')).toThrow(/anexo/i);
    });
});
