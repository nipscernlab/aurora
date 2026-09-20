/**
 * As flags que um override da IA nao pode tirar (main/compile/protected_flags.ts).
 *
 * O override pode ACRESCENTAR o que quiser; nao pode remover nem esvaziar o
 * que o pipeline da AURORA depende para o passo seguinte achar o arquivo. O
 * modulo nao tinha teste; este fixa a verificacao nos tres tipos de regra e
 * o retrato que o list_allowed_flags mostra, e cobre os passos do C++.
 */

import { describe, expect, it } from 'vitest';

import { RULES, check, describe as descrever } from '../../main/compile/protected_flags.ts';

const spec = (args, env) => ({ args, ...(env ? { env } : {}) });

describe('check: flagWithValue', () => {
    const base = spec(['-i', 'a.cmm', '-n', 'a', '-p', '/p', '-m', '/m', '-t', '/t']);

    it('aceita a spec intacta e a que so acrescenta', () => {
        expect(check('cmm', base, base)).toEqual({ ok: true });
        expect(check('cmm', base, spec([...base.args, '-A']))).toEqual({ ok: true });
    });

    it('aceita trocar o VALOR de uma flag protegida: a AURORA regenera por corrida', () => {
        expect(check('cmm', base, spec(['-i', 'outro.cmm', '-n', 'a', '-p', '/p', '-m', '/m', '-t', '/t']))).toEqual({ ok: true });
    });

    it('recusa remover a flag', () => {
        const r = check('cmm', base, spec(['-n', 'a', '-p', '/p', '-m', '/m', '-t', '/t']));
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/cannot remove protected flag -i/);
    });

    it('recusa deixar a flag sem valor (no fim, ou seguida de outra flag)', () => {
        expect(check('cmm', base, spec(['-n', 'a', '-p', '/p', '-m', '/m', '-t', '/t', '-i'])).ok).toBe(false);
        expect(check('cmm', base, spec(['-i', '-n', 'a', '-p', '/p', '-m', '/m', '-t', '/t'])).ok).toBe(false);
    });

    it('so protege flag que a base tinha: a base sem -A nao obriga -A', () => {
        expect(check('asm', spec(['-i', 'x.asm', '-t', '/t']), spec(['-i', 'x.asm', '-t', '/t']))).toEqual({ ok: true });
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
        expect(check('inexistente', spec(['-x']), spec([]))).toEqual({ ok: true });
        expect(check('cmm', null, undefined)).toEqual({ ok: true });
    });
});

describe('os passos do front end C++', () => {
    it('cpp-pp protege -i, -o e -I; cpp protege -i, -p, -n e -t (sem -m: nao tem)', () => {
        expect(RULES['cpp-pp']).toEqual({ flagWithValue: ['-i', '-o', '-I'] });
        expect(RULES['cpp']).toEqual({ flagWithValue: ['-i', '-p', '-n', '-t'] });
    });

    it('um override que tira o -o do cpppp deixa o cppcomp sem pp.cpp: recusado', () => {
        const base = spec(['-i', 'a.cpp', '-o', '/t/pp.cpp', '-I', '/h', '-I', '/s']);
        expect(check('cpp-pp', base, spec(['-i', 'a.cpp', '-I', '/h', '-I', '/s'])).ok).toBe(false);
        expect(check('cpp', spec(['-i', '/t/pp.cpp', '-p', '/p', '-n', 'a', '-t', '/t']), spec(['-p', '/p', '-n', 'a', '-t', '/t'])).ok).toBe(false);
    });
});

describe('describe: o retrato para list_allowed_flags', () => {
    it('devolve as tres listas, vazias quando a regra nao tem', () => {
        expect(descrever('cpp')).toEqual({
            step: 'cpp', protectedLiteralArgs: [], protectedFlagWithValue: ['-i', '-p', '-n', '-t'], protectedEnv: [],
        });
        expect(descrever('nada')).toEqual({ step: 'nada', protectedLiteralArgs: [], protectedFlagWithValue: [], protectedEnv: [] });
    });
});
