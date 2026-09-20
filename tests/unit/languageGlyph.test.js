// @vitest-environment happy-dom
/**
 * O glifo da linguagem de processador (js/ui/language_glyph.ts).
 *
 * Antes deste modulo, QUATRO lugares respondiam sozinhos "este arquivo usa o
 * glifo da AURORA?", cada um com o seu endsWith('.cmm'). Acrescentar o C++ em
 * quatro lugares e esquecer um daria um arquivo com o icone errado numa
 * arvore e certo na outra. Estes casos travam a resposta unica.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
    applyGlyphToIcon,
    glyphClassForFile,
    glyphClasses,
    languageLabel,
    setDrawnGlyphLanguage,
} from '../../js/ui/language_glyph.ts';

describe('glyphClassForFile', () => {
    it('da o glifo de cada linguagem, em qualquer caixa e com caminho inteiro', () => {
        expect(glyphClassForFile('proc.cmm')).toBe('aurora-icon-cmm');
        expect(glyphClassForFile('proc.CMM')).toBe('aurora-icon-cmm');
        expect(glyphClassForFile('C:\\proj\\P\\Software\\P.cpp')).toBe('aurora-icon-cpp');
    });

    it('devolve null para o que nao e fonte de processador', () => {
        // Estes tem icone no tema Material e devem continuar com ele.
        for (const nome of ['top.v', 'tb.sv', 'x.asm', 'y.py', 'z.txt', 'a.c', 'b.hpp', '', null, 42]) {
            expect(glyphClassForFile(nome), String(nome)).toBeNull();
        }
    });

    it('as duas classes estao listadas, para quem precisa limpar antes de pintar', () => {
        expect(glyphClasses().sort()).toEqual(['aurora-icon-cmm', 'aurora-icon-cpp']);
    });
});

describe('applyGlyphToIcon', () => {
    let icone;
    beforeEach(() => { icone = document.createElement('span'); });

    it('pinta o glifo certo e avisa que pintou', () => {
        expect(applyGlyphToIcon(icone, 'p.cpp')).toBe(true);
        expect(icone.classList.contains('aurora-icon-cpp')).toBe(true);
        expect(icone.classList.contains('aurora-icon-cmm')).toBe(false);
    });

    it('deixa so uma classe ligada ao trocar de linguagem', () => {
        applyGlyphToIcon(icone, 'p.cmm');
        expect(icone.classList.contains('aurora-icon-cmm')).toBe(true);
        applyGlyphToIcon(icone, 'p.cpp');
        expect(icone.classList.contains('aurora-icon-cmm')).toBe(false);
        expect(icone.classList.contains('aurora-icon-cpp')).toBe(true);
    });

    it('limpa o glifo e devolve false quando o arquivo nao e fonte', () => {
        applyGlyphToIcon(icone, 'p.cmm');
        expect(applyGlyphToIcon(icone, 'top.v')).toBe(false);
        expect(icone.className).toBe('');
    });

    it('nao lanca sem elemento', () => {
        expect(applyGlyphToIcon(null, 'p.cmm')).toBe(false);
    });
});

describe('setDrawnGlyphLanguage: o simbolo desenhado no botao e na aba', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <span class="glyph glyph-cpm"><svg>
              <path class="cpm-pm cpm-minus"></path>
              <path class="cpm-pm cpm-plus2"></path>
            </svg></span>
            <span class="glyph glyph-cpm"><svg></svg></span>`;
    });

    const comCpp = () => [...document.querySelectorAll('.glyph-cpm')]
        .map((g) => g.classList.contains('is-cpp'));

    it('acende a variante C++ em TODOS os glifos desenhados da pagina', () => {
        // Sao dois: o do botao de compilar e o da aba do terminal.
        setDrawnGlyphLanguage(document, 'cpp');
        expect(comCpp()).toEqual([true, true]);
    });

    it('e apaga ao voltar para C+-', () => {
        setDrawnGlyphLanguage(document, 'cpp');
        setDrawnGlyphLanguage(document, 'cmm');
        expect(comCpp()).toEqual([false, false]);
    });

    it('nao lanca sem raiz', () => {
        expect(() => setDrawnGlyphLanguage(null, 'cpp')).not.toThrow();
    });
});

describe('languageLabel', () => {
    it('e o nome proprio de cada linguagem, igual nas duas linguas', () => {
        expect(languageLabel('cmm')).toBe('C\u00b1');
        expect(languageLabel('cpp')).toBe('C++');
    });
});
