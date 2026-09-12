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

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isAllowed } from '../../main/compile/binary_allowlist.js';
import { componentsPath } from '../../main/paths.js';

const proj = path.resolve('C:', 'alunos', 'contador');

const ABERTOS = [proj];

describe('isAllowed: Verilator na Temp do projeto', () => {
    it('aceita V<top>.exe em <projeto>/.aurora/Temp/obj_dir_<top>/', () => {
        const exe = path.join(proj, '.aurora', 'Temp', 'obj_dir_contador_tb', 'Vcontador_tb.exe');
        expect(isAllowed(exe, ABERTOS)).toEqual({ ok: true });
    });

    it('aceita tambem o obj_dir do teste de processador', () => {
        const exe = path.join(proj, '.aurora', 'Temp', 'obj_dir_proc_ProcX', 'VProcX_tb.exe');
        expect(isAllowed(exe, ABERTOS)).toEqual({ ok: true });
    });

    it('continua aceitando a Temp compartilhada, que ficou de reserva', () => {
        const exe = path.join(componentsPath, 'Temp', 'obj_dir_tb', 'Vtb.exe');
        expect(isAllowed(exe)).toEqual({ ok: true });
    });

    it('recusa um exe qualquer dentro da .aurora/Temp que nao tenha a forma do Verilator', () => {
        expect(isAllowed(path.join(proj, '.aurora', 'Temp', 'malicioso.exe'), ABERTOS).ok).toBe(false);
        expect(isAllowed(path.join(proj, '.aurora', 'Temp', 'obj_dir_x', 'nao_e_V.exe'), ABERTOS).ok).toBe(false);
        expect(isAllowed(path.join(proj, '.aurora', 'Temp', 'pasta', 'Vtb.exe'), ABERTOS).ok).toBe(false);
    });

    it('recusa a forma certa fora de uma Temp da AURORA', () => {
        expect(isAllowed(path.join(proj, 'obj_dir_tb', 'Vtb.exe'), ABERTOS).ok).toBe(false);
        expect(isAllowed(path.join(proj, 'Temp', 'obj_dir_tb', 'Vtb.exe'), ABERTOS).ok).toBe(false);
    });

    // A primeira versao desta regra aceitava QUALQUER caminho que contivesse
    // `/.aurora/Temp/`. A pasta temporaria do sistema e area gravavel pelo
    // renderer (fs_guard), entao bastava escrever la para ter um binario
    // arbitrario aceito; e um projeto baixado de terceiro ja chegaria com a
    // pasta pronta. Agora a raiz tem que ser de um projeto ABERTO.
    it('recusa a Temp do sistema, mesmo com a forma exata do Verilator', () => {
        const exe = path.join(os.tmpdir(), '.aurora', 'Temp', 'obj_dir_x', 'Vx.exe');
        expect(isAllowed(exe, ABERTOS).ok).toBe(false);
        expect(isAllowed(exe).ok).toBe(false);
    });

    it('recusa a Temp de um projeto que nao esta aberto', () => {
        const outro = path.resolve('C:', 'baixados', 'projeto-de-terceiro');
        const exe = path.join(outro, '.aurora', 'Temp', 'obj_dir_x', 'Vx.exe');
        expect(isAllowed(exe, ABERTOS).ok).toBe(false);
        expect(isAllowed(exe, [outro]).ok).toBe(true);   // aberto de proposito: passa
    });

    it('sem lista de projetos abertos, so a Temp compartilhada vale', () => {
        const exe = path.join(proj, '.aurora', 'Temp', 'obj_dir_x', 'Vx.exe');
        expect(isAllowed(exe).ok).toBe(false);
        expect(isAllowed(exe, []).ok).toBe(false);
    });

    it('um projeto cujo caminho apenas COMECA igual ao aberto nao passa', () => {
        const vizinho = proj + '-outro';
        const exe = path.join(vizinho, '.aurora', 'Temp', 'obj_dir_x', 'Vx.exe');
        expect(isAllowed(exe, ABERTOS).ok).toBe(false);
    });
});
