/**
 * As flags que um override da IA nao pode tirar (main/compile/protected_flags.ts).
 *
 * O override pode ACRESCENTAR o que quiser; nao pode remover nem esvaziar o
 * que o pipeline da AURORA depende para o passo seguinte achar o arquivo. O
 * modulo nao tinha teste; este fixa a verificacao nos tres tipos de regra e
 * o retrato que o list_allowed_flags mostra, e cobre os passos do processador.
 */

import { describe, expect, it } from 'vitest';

import {
    ENV_QUE_CARREGA_CODIGO, RULES, carregaCodigo, check, describe as descrever,
} from '../../main/compile/protected_flags.ts';

const spec = (args, env) => ({ args, ...(env ? { env } : {}) });

describe('check: flagWithValue', () => {
    const base = spec(['-S', '-o', '/p/a/a', '--lang=pt', '/p/a/a.cmm']);

    it('aceita a spec intacta e a que so acrescenta', () => {
        expect(check('cmm', base, base)).toEqual({ ok: true });
        expect(check('cmm', base, spec([...base.args, '--wave-arrays']))).toEqual({ ok: true });
    });

    it('aceita trocar o VALOR de uma flag protegida: a AURORA regenera por corrida', () => {
        expect(check('cmm', base, spec(['-S', '-o', '/outra', '--lang=pt', '/p/a/a.cmm']))).toEqual({ ok: true });
    });

    it('recusa remover a flag', () => {
        const r = check('cmm', base, spec(['-S', '--lang=pt', '/p/a/a.cmm']));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/cannot remove protected flag -o/);
    });

    it('recusa deixar a flag sem valor (no fim, ou seguida de outra flag)', () => {
        expect(check('cmm', base, spec(['-S', '--lang=pt', '/p/a/a.cmm', '-o'])).ok).toBe(false);
        expect(check('cmm', base, spec(['-S', '-o', '--lang=pt', '/p/a/a.cmm'])).ok).toBe(false);
    });

    it('so protege flag que a base tinha: a base sem -f nao obriga -f', () => {
        expect(check('asm', spec(['--lang=pt', 'x.asm']), spec(['--lang=pt', 'x.asm']))).toEqual({ ok: true });
    });
});

describe('check: literalArgs e envKeys', () => {
    it('recusa remover um token literal que a base tinha', () => {
        const base = spec(['-tnull', '-s', 'tb', 'a.v']);
        expect(check('iverilog-check', base, spec(['-s', 'tb', 'a.v'])).ok).toBe(false);
        expect(check('iverilog-check', base, base)).toEqual({ ok: true });
    });

    it('recusa mudar ou apagar uma variavel de ambiente protegida', () => {
        const base = spec([], { AURORA_COCOTB_TOP: 'top', OUTRA: '1' });
        expect(check('cocotb-run', base, spec([], { AURORA_COCOTB_TOP: 'top', OUTRA: '2' }))).toEqual({ ok: true });
        expect(check('cocotb-run', base, spec([], { AURORA_COCOTB_TOP: 'x' })).ok).toBe(false);
        expect(check('cocotb-run', base, spec([], {})).ok).toBe(false);
    });

    it('passo sem regra passa, e specs ausentes nao lancam', () => {
        expect(check('inexistente', spec([], { OUTRA: '1' }), spec([], { OUTRA: '2' }))).toEqual({ ok: true });
        expect(check('inexistente', spec(['-x']), spec([]))).toEqual({ ok: true });
        expect(check('cmm', null, undefined)).toEqual({ ok: true });
    });
});

describe('check: ambiente que escolhe o codigo carregado', () => {
    it('reconhece as chaves exatas e os prefixos, sem diferenca de caixa', () => {
        for (const k of ['PATH', 'Path', 'ComSpec', 'PYTHONPATH', 'pythonstartup', 'PERL5OPT', 'NODE_OPTIONS',
            'CXX', 'OBJCACHE', 'MAKEFILES', 'GPI_EXTRA', 'PYGPI_PYTHON_BIN', 'AURORA_COCOTB_TOP']) {
            expect(carregaCodigo(k)).toBe(true);
        }
        for (const k of ['LC_ALL', 'OMP_NUM_THREADS', 'COCOTB_LOG_LEVEL', 'PATHS', 'CXXFLAGSX', 'XPATH']) {
            expect(carregaCodigo(k)).toBe(false);
        }
        expect(ENV_QUE_CARREGA_CODIGO).toContain('PYTHON*');
    });

    it('em qualquer passo, mesmo sem regra, recusa criar uma delas', () => {
        const r = check('iverilog-build', spec(['a.v']), spec(['a.v'], { PERL5OPT: '-Mevil' }));
        expect(r).toEqual({
            ok: false,
            error: 'cannot set, change or unset env var PERL5OPT on step iverilog-build — it decides which code the tool loads',
        });
        expect(check('inexistente', spec([]), spec([], { Path: 'C:/de/fora' })).ok).toBe(false);
    });

    it('recusa trocar ou apagar a que a propria AURORA definiu, e deixa as outras', () => {
        const base = spec([], { PYTHONHOME: 'C:/bundle/mingw64', PYTHONIOENCODING: 'utf-8', COCOTB_LOG_LEVEL: 'INFO' });
        expect(check('cocotb-run', base, base)).toEqual({ ok: true });
        expect(check('cocotb-run', base, spec([], { ...base.env, COCOTB_LOG_LEVEL: 'DEBUG' }))).toEqual({ ok: true });
        expect(check('cocotb-run', base, spec([], { ...base.env, PYTHONHOME: 'C:/outro' })).ok).toBe(false);
        const { PYTHONHOME: _sai, ...semHome } = base.env;
        expect(check('cocotb-run', base, spec([], semHome)).ok).toBe(false);
    });

    it('a mesma chave com outra caixa e a mesma chave', () => {
        expect(check('cocotb-run', spec([], { PYTHONHOME: 'h' }), spec([], { PythonHome: 'h' }))).toEqual({ ok: true });
    });
});

describe('os passos do processador, pelo driver yanc', () => {
    it('cmm e cpp protegem o -S e o -o; asm protege -f e -c', () => {
        expect(RULES['cmm']).toEqual({ literalArgs: ['-S'], flagWithValue: ['-o'] });
        expect(RULES['cpp']).toEqual({ literalArgs: ['-S'], flagWithValue: ['-o'] });
        expect(RULES['asm']).toEqual({ flagWithValue: ['-f', '-c'] });
        expect(RULES['cpp-pp']).toBeUndefined();
        expect(RULES['asm-pre']).toBeUndefined();
    });

    it('um override que tira o -S faria o yanc montar no passo de compilacao: recusado', () => {
        const base = spec(['-S', '-o', '/p/a/a', '--lang=en', '/p/a/a.cpp']);
        expect(check('cpp', base, spec(['-o', '/p/a/a', '--lang=en', '/p/a/a.cpp'])).ok).toBe(false);
        expect(check('cpp', base, spec([...base.args, '-I', '/inc'])).ok).toBe(true);
    });

    it('a montagem nao deixa sumir o clock do testbench', () => {
        const base = spec(['-f', '100', '-c', '1000', '--lang=pt', '/p/a/a/a.asm']);
        expect(check('asm', base, spec(['-c', '1000', '--lang=pt', '/p/a/a/a.asm'])).ok).toBe(false);
        expect(check('asm', base, spec(['-f', '50', '-c', '1000', '--lang=pt', '/p/a/a/a.asm'])).ok).toBe(true);
    });
});

describe('describe: o retrato para list_allowed_flags', () => {
    it('devolve as tres listas, vazias quando a regra nao tem, e o ambiente vetado em todo passo', () => {
        const codeLoadingEnv = [...ENV_QUE_CARREGA_CODIGO];
        expect(descrever('asm')).toEqual({
            step: 'asm', protectedLiteralArgs: [], protectedFlagWithValue: ['-f', '-c'], protectedEnv: [], codeLoadingEnv,
        });
        expect(descrever('nada')).toEqual({
            step: 'nada', protectedLiteralArgs: [], protectedFlagWithValue: [], protectedEnv: [], codeLoadingEnv,
        });
    });
});
