/**
 * Os dois CommandSpec do front end C++ (js/compilation/builders/cpp.ts).
 *
 * A referencia e Scripts/single_proc_cpp.bat do yanc v5.4, que e o unico
 * lugar onde a linha de comando dos dois binarios esta escrita por quem os
 * fez:
 *
 *   cpppp.exe   -i <SOFT_DIR>\<fonte>.cpp -o <TMP>\pp.cpp -I <INC_DIR> -I <SOFT_DIR>
 *   cppcomp.exe -i <TMP>\pp.cpp -p <PROC_DIR> -n <PROC> -t <TMP>
 *
 * O que estes testes travam, e que nao se adivinha lendo o cmm.ts ao lado: o
 * cppcomp nao leva `-m`, nenhum dos dois leva `-pt`/`-en`, e o que o cppcomp
 * compila e o pp.cpp da Temp, nao o arquivo da pessoa.
 */

import { describe, expect, it } from 'vitest';

import {
    ARQUIVO_PRE_PROCESSADO,
    buildCppPpSpec,
    buildCppSpec,
    caminhoPreProcessado,
} from '../../js/compilation/builders/cpp.ts';
import { STEP_IDS, validateShape } from '../../js/compilation/command_spec.ts';

const CTX_PP = {
    cppPpPath: 'C:\\comp\\bin\\cpppp.exe',
    inputFile: 'C:\\proj\\ProcX\\Software\\ProcX.cpp',
    tempPath: 'C:\\proj\\.aurora\\Temp\\ProcX',
    headerPath: 'C:\\comp\\Header',
    softwarePath: 'C:\\proj\\ProcX\\Software',
    processorName: 'ProcX',
};

const CTX_CPP = {
    cppCompPath: 'C:\\comp\\bin\\cppcomp.exe',
    tempPath: 'C:\\proj\\.aurora\\Temp\\ProcX',
    projectPath: 'C:\\proj\\ProcX',
    baseName: 'ProcX',
    processorName: 'ProcX',
};

describe('buildCppPpSpec (cpppp, o pre-processador)', () => {
    it('monta a linha do single_proc_cpp: -i fonte -o pp.cpp -I header -I software', () => {
        expect(buildCppPpSpec(CTX_PP)).toEqual({
            step: 'cpp-pp',
            binary: 'C:\\comp\\bin\\cpppp.exe',
            args: [
                '-i', 'C:\\proj\\ProcX\\Software\\ProcX.cpp',
                '-o', 'C:\\proj\\.aurora\\Temp\\ProcX\\pp.cpp',
                '-I', 'C:\\comp\\Header',
                '-I', 'C:\\proj\\ProcX\\Software',
            ],
            cwd: 'C:\\proj\\.aurora\\Temp\\ProcX',
            processorName: 'ProcX',
            label: 'cpp-pp: ProcX',
        });
    });

    it('recebe o fonte por caminho absoluto, nao so pelo nome', () => {
        // Ao contrario do cmmcomp, que resolve o -i contra o -p, o cpppp abre
        // o caminho como veio. Passar so "ProcX.cpp" daria "cannot open".
        const args = buildCppPpSpec(CTX_PP).args;
        const fonte = args[args.indexOf('-i') + 1];
        expect(fonte).toBe(CTX_PP.inputFile);
        expect(fonte).toMatch(/^[A-Za-z]:\\/);
    });

    it('os dois -I vem na ordem: cabecalhos do yanc, depois a pasta do fonte', () => {
        const args = buildCppPpSpec(CTX_PP).args;
        const incs = args.reduce((acc, a, i) => (a === '-I' ? [...acc, args[i + 1]] : acc), []);
        expect(incs).toEqual([CTX_PP.headerPath, CTX_PP.softwarePath]);
    });

    it('nao leva bandeira de lingua: o cpppp nao tem parse_lang_flag', () => {
        const args = buildCppPpSpec(CTX_PP).args;
        expect(args).not.toContain('-pt');
        expect(args).not.toContain('-en');
    });
});

describe('buildCppSpec (cppcomp, o compilador)', () => {
    it('monta a linha do single_proc_cpp: -i pp.cpp -p procDir -n base -t temp', () => {
        expect(buildCppSpec(CTX_CPP)).toEqual({
            step: 'cpp',
            binary: 'C:\\comp\\bin\\cppcomp.exe',
            args: [
                '-i', 'C:\\proj\\.aurora\\Temp\\ProcX\\pp.cpp',
                '-p', 'C:\\proj\\ProcX',
                '-n', 'ProcX',
                '-t', 'C:\\proj\\.aurora\\Temp\\ProcX',
            ],
            cwd: 'C:\\proj\\ProcX',
            processorName: 'ProcX',
            label: 'cpp: ProcX',
        });
    });

    it('compila o pp.cpp da Temp, e nao o .cpp da pessoa', () => {
        // E por isso que os erros do cppcomp apontam para o pp.cpp. O que o
        // cpppp escreveu e o que o cppcomp le: o mesmo caminho, dos dois lados.
        const entrada = buildCppSpec(CTX_CPP).args[1];
        expect(entrada).toBe(buildCppPpSpec(CTX_PP).args[3]);
        expect(entrada.endsWith(ARQUIVO_PRE_PROCESSADO)).toBe(true);
    });

    it('NAO leva -m: os macros sao do cmmcomp e do asmcomp, nao do lado C++', () => {
        expect(buildCppSpec(CTX_CPP).args).not.toContain('-m');
    });

    it('nao leva bandeira de lingua nem -A', () => {
        const args = buildCppSpec(CTX_CPP).args;
        for (const bandeira of ['-pt', '-en', '-A']) expect(args).not.toContain(bandeira);
    });

    it('o -n vira o nome do .asm, entao segue a base do fonte', () => {
        const spec = buildCppSpec({ ...CTX_CPP, baseName: 'outro_nome' });
        expect(spec.args[spec.args.indexOf('-n') + 1]).toBe('outro_nome');
    });
});

describe('os dois passos no resto da maquinaria', () => {
    it('cpp-pp e cpp sao passos conhecidos, senao o executor recusa a spec', () => {
        expect(STEP_IDS).toContain('cpp-pp');
        expect(STEP_IDS).toContain('cpp');
        expect(validateShape(buildCppPpSpec(CTX_PP))).toEqual({ ok: true });
        expect(validateShape(buildCppSpec(CTX_CPP))).toEqual({ ok: true });
    });

    it('um so lugar decide o nome do arquivo intermediario', () => {
        expect(caminhoPreProcessado('C:\\t')).toBe('C:\\t\\pp.cpp');
        expect(caminhoPreProcessado('/tmp/x', '/')).toBe('/tmp/x/pp.cpp');
    });
});
