/**
 * "Qual processador esta ativo?" (js/project/active_processor.ts).
 *
 * O processador ativo e o cruzamento do arquivo em foco no editor com a lista
 * de processadores do projeto. A status bar mostra o resultado e os botoes
 * C+- / Verilator-processador decidem por ele, entao um erro aqui e um botao
 * morto com a barra dizendo "No active processor" sem motivo visivel.
 *
 * O arquivo em foco vem do TabManager, que e mockado; a lista de processadores
 * e passada direto, como a status bar faz quando acabou de ler o .spf.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { getEditingFilePath: vi.fn() } }));

import { TabManager } from '../../js/tabs/tab_manager.js';
import { getActiveProcessorName } from '../../js/project/active_processor.ts';

const PROCS = ['ProcX', 'soma'];
const foco = (p) => TabManager.getEditingFilePath.mockReturnValue(p);

beforeEach(() => TabManager.getEditingFilePath.mockReset());

describe('getActiveProcessorName', () => {
    it('acha o processador pela pasta Software/, que e robusta a rename do fonte', () => {
        foco('C:\\proj\\ProcX\\Software\\qualquer.cmm');
        expect(getActiveProcessorName(PROCS)).toBe('ProcX');
        foco('/proj/soma/Software/outro.cmm');
        expect(getActiveProcessorName(PROCS)).toBe('soma');
    });

    it('a pasta e comparada sem caixa, o nome do processador com caixa', () => {
        foco('C:\\proj\\ProcX\\SOFTWARE\\x.cmm');
        expect(getActiveProcessorName(PROCS)).toBe('ProcX');
        foco('C:\\proj\\procx\\Software\\x.cmm');
        // 'procx' nao esta na lista; cai no basename, que tambem nao esta
        expect(getActiveProcessorName(PROCS)).toBeNull();
    });

    it('cai no basename quando a pasta nao casa', () => {
        foco('C:\\solto\\soma.cmm');
        expect(getActiveProcessorName(PROCS)).toBe('soma');
        foco('C:\\solto\\ninguem.cmm');
        expect(getActiveProcessorName(PROCS)).toBeNull();
    });

    it('sem arquivo em foco, ou sem lista, nao ha processador ativo', () => {
        foco('');
        expect(getActiveProcessorName(PROCS)).toBeNull();
        foco(undefined);
        expect(getActiveProcessorName(PROCS)).toBeNull();
        foco('C:\\proj\\ProcX\\Software\\ProcX.cmm');
        expect(getActiveProcessorName([])).toBeNull();
    });

    it('um .v ou .asm dentro de Software/ NAO ativa o processador: so fonte ativa', () => {
        foco('C:\\proj\\ProcX\\Software\\ProcX.asm');
        expect(getActiveProcessorName(PROCS)).toBeNull();
        foco('C:\\proj\\ProcX\\Hardware\\ProcX.v');
        expect(getActiveProcessorName(PROCS)).toBeNull();
    });

    it('um .cpp em Software/ ativa o processador igual a um .cmm', () => {
        // Ate o despacho por linguagem este caso esperava null: era o
        // portao mais duro que a varredura do C++ achou. Quem diz o que e
        // fonte de processador agora e o processor_source.ts.
        foco('C:\\proj\\ProcX\\Software\\ProcX.cpp');
        expect(getActiveProcessorName(PROCS)).toBe('ProcX');
        foco('C:\\solto\\soma.cpp');
        expect(getActiveProcessorName(PROCS)).toBe('soma');
    });
});
