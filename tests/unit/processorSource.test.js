/**
 * O unico lugar que responde qual e o fonte de um processador e em que
 * linguagem ele esta (js/compilation/processor_source.ts).
 *
 * O teste que mais importa aqui e o de invariancia: antes deste modulo, nove
 * lugares calculavam `cmmFile || `${name}.cmm`` e o mesmo sem o `.cmm`, cada
 * um por conta propria. Se a funcao nova divergir em qualquer entrada que
 * exista hoje, um `.asm` passa a ser procurado com o nome errado e a
 * compilacao morre longe da causa. O primeiro describe compara as duas
 * formulas sobre um corpus; os outros fixam o comportamento novo.
 */

import { describe, expect, it } from 'vitest';

import {
  LINGUAGEM_PADRAO,
  extensionForLanguage,
  isProcessorSourcePath,
  languageFromFileName,
  resolveProcessorLanguage,
  resolveProcessorSource,
  sourceExtensions,
  stripSourceExtension,
} from '../../js/compilation/processor_source.ts';

/** A formula que estava espalhada, copiada aqui como estava. */
function legado(proc) {
    const arquivo = proc.cmmFile || `${proc.name}.cmm`;
    return { sourceFile: arquivo, baseName: arquivo.replace(/\.cmm$/i, '') };
}

/** Entradas de `.spf` que existem hoje, ou que um projeto antigo pode ter. */
const ENTRADAS_DE_HOJE = [
    { name: 'proc' },
    { name: 'ProcX' },
    { name: 'media_movel' },
    { name: 'p1', cmmFile: 'p1.cmm' },
    { name: 'p1', cmmFile: 'outro.cmm' },
    { name: 'DTW', cmmFile: 'DTW.CMM' },
    { name: 'DTW', cmmFile: 'DTW.Cmm' },
    { name: 'proc', cmmFile: 'com espaco.cmm' },
    { name: 'proc', cmmFile: 'dois.pontos.cmm' },
    { name: 'acentuado', cmmFile: 'coracao.cmm' },
    { name: 'proc', clk: 100, numClocks: 2000, showArrays: true },
    { name: 'proc', cmmFile: 'p.cmm', clk: 50 },
];

describe('invariancia: o resolvedor concorda com a formula que ele substitui', () => {
    it.each(ENTRADAS_DE_HOJE)('mesma resposta para %j', (entrada) => {
        const velho = legado(entrada);
        const novo = resolveProcessorSource(entrada);
        expect(novo.sourceFile).toBe(velho.sourceFile);
        expect(novo.baseName).toBe(velho.baseName);
    });

    it('e todas essas entradas continuam sendo C±', () => {
        for (const entrada of ENTRADAS_DE_HOJE) {
            expect(resolveProcessorSource(entrada).language).toBe('cmm');
        }
    });

    it('um nome sem extensao de linguagem sai intacto, como no replace antigo', () => {
        // `'proc.txt'.replace(/\.cmm$/i, '')` devolvia 'proc.txt'. Uma remocao
        // generica de extensao devolveria 'proc', e essa diferenca calada e
        // justamente o que este caso trava.
        expect(resolveProcessorSource({ name: 'p', cmmFile: 'proc.txt' })).toEqual({
            language: 'cmm', sourceFile: 'proc.txt', baseName: 'proc.txt',
        });
        expect(stripSourceExtension('proc.txt')).toBe('proc.txt');
        expect(stripSourceExtension('sem_ponto')).toBe('sem_ponto');
    });
});

describe('linguagem pela extensao', () => {
    it('reconhece as duas linguagens, em qualquer caixa', () => {
        expect(languageFromFileName('a.cmm')).toBe('cmm');
        expect(languageFromFileName('a.CMM')).toBe('cmm');
        expect(languageFromFileName('a.cpp')).toBe('cpp');
        expect(languageFromFileName('a.CPP')).toBe('cpp');
        expect(languageFromFileName('C:\\proj\\p\\Software\\p.cpp')).toBe('cpp');
    });

    it('o .asm nao e fonte: e gerado pelas duas linguagens', () => {
        expect(languageFromFileName('p.asm')).toBeNull();
        expect(isProcessorSourcePath('p.asm')).toBe(false);
    });

    it('nao confunde outras extensoes nem entrada invalida', () => {
        for (const x of ['p.v', 'p.sv', 'p.py', 'p.c', 'p.h', 'p.hpp', 'cmm', 'cpp', '', null, undefined, 42, {}]) {
            expect(languageFromFileName(x)).toBeNull();
            expect(isProcessorSourcePath(x)).toBe(false);
        }
    });

    it('a extensao de cada linguagem sai com o ponto', () => {
        expect(extensionForLanguage('cmm')).toBe('.cmm');
        expect(extensionForLanguage('cpp')).toBe('.cpp');
        expect(sourceExtensions().sort()).toEqual(['.cmm', '.cpp']);
        expect(LINGUAGEM_PADRAO).toBe('cmm');
    });
});

describe('precedencia ao resolver a entrada do .spf', () => {
    it('sem campo nenhum, C± com o nome do processador', () => {
        expect(resolveProcessorSource({ name: 'proc' })).toEqual({
            language: 'cmm', sourceFile: 'proc.cmm', baseName: 'proc',
        });
    });

    it('language declarada manda, e decide a extensao do nome montado', () => {
        expect(resolveProcessorSource({ name: 'proc', language: 'cpp' })).toEqual({
            language: 'cpp', sourceFile: 'proc.cpp', baseName: 'proc',
        });
        expect(resolveProcessorSource({ name: 'proc', language: 'CPP' }).language).toBe('cpp');
    });

    it('sem language, a extensao do arquivo declarado decide', () => {
        expect(resolveProcessorSource({ name: 'proc', sourceFile: 'proc.cpp' })).toEqual({
            language: 'cpp', sourceFile: 'proc.cpp', baseName: 'proc',
        });
        expect(resolveProcessorSource({ name: 'proc', cmmFile: 'proc.cpp' }).language).toBe('cpp');
    });

    it('sourceFile tem precedencia sobre o cmmFile legado', () => {
        expect(resolveProcessorSource({ name: 'p', sourceFile: 'novo.cpp', cmmFile: 'velho.cmm' })).toEqual({
            language: 'cpp', sourceFile: 'novo.cpp', baseName: 'novo',
        });
    });

    it('language desconhecida nao vale: cai na extensao, senao no padrao', () => {
        expect(resolveProcessorLanguage({ name: 'p', language: 'rust' })).toBe('cmm');
        expect(resolveProcessorLanguage({ name: 'p', language: 'rust', cmmFile: 'p.cpp' })).toBe('cpp');
        expect(resolveProcessorLanguage({ name: 'p', language: '' })).toBe('cmm');
    });

    it('entrada vazia ou ausente nao lanca', () => {
        expect(resolveProcessorSource(null).language).toBe('cmm');
        expect(resolveProcessorSource(undefined).sourceFile).toBe('.cmm');
        expect(resolveProcessorLanguage(null)).toBe('cmm');
    });

    it('campo em branco conta como ausente, nao como nome de arquivo', () => {
        expect(resolveProcessorSource({ name: 'p', cmmFile: '   ' }).sourceFile).toBe('p.cmm');
        expect(resolveProcessorSource({ name: 'p', sourceFile: '' }).sourceFile).toBe('p.cmm');
    });
});
