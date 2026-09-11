/**
 * O V<top>.exe do Verilator na Temp do projeto (main/compile/binary_allowlist.js).
 *
 * O executor so roda binario que o allowlist aceita. O V<top>.exe e gerado, nao
 * embarcado, entao a regra dele e por forma e lugar: pasta obj_dir*, nome
 * V<algo>, e dentro de uma Temp da AURORA. Com os intermediarios por projeto
 * (js/project/project_temp.js), esse lugar passou a ser <projeto>/.aurora/Temp,
 * e sem esta regra o botao Verilator morreria com "binary not allowed" no
 * primeiro projeto que tentasse.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isAllowed } from '../../main/compile/binary_allowlist.js';
import { componentsPath } from '../../main/paths.js';

const proj = path.resolve('C:', 'alunos', 'contador');

describe('isAllowed: Verilator na Temp do projeto', () => {
    it('aceita V<top>.exe em <projeto>/.aurora/Temp/obj_dir_<top>/', () => {
        const exe = path.join(proj, '.aurora', 'Temp', 'obj_dir_contador_tb', 'Vcontador_tb.exe');
        expect(isAllowed(exe)).toEqual({ ok: true });
    });

    it('aceita tambem o obj_dir do teste de processador', () => {
        const exe = path.join(proj, '.aurora', 'Temp', 'obj_dir_proc_ProcX', 'VProcX_tb.exe');
        expect(isAllowed(exe)).toEqual({ ok: true });
    });

    it('continua aceitando a Temp compartilhada, que ficou de reserva', () => {
        const exe = path.join(componentsPath, 'Temp', 'obj_dir_tb', 'Vtb.exe');
        expect(isAllowed(exe)).toEqual({ ok: true });
    });

    it('recusa um exe qualquer dentro da .aurora/Temp que nao tenha a forma do Verilator', () => {
        expect(isAllowed(path.join(proj, '.aurora', 'Temp', 'malicioso.exe')).ok).toBe(false);
        expect(isAllowed(path.join(proj, '.aurora', 'Temp', 'obj_dir_x', 'nao_e_V.exe')).ok).toBe(false);
        expect(isAllowed(path.join(proj, '.aurora', 'Temp', 'pasta', 'Vtb.exe')).ok).toBe(false);
    });

    it('recusa a forma certa fora de uma Temp da AURORA', () => {
        expect(isAllowed(path.join(proj, 'obj_dir_tb', 'Vtb.exe')).ok).toBe(false);
        expect(isAllowed(path.join(proj, 'Temp', 'obj_dir_tb', 'Vtb.exe')).ok).toBe(false);
    });
});
