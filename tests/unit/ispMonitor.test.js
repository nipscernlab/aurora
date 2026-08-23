/**
 * O monitor da pilha de instrução, contra o HDL de verdade do SAPHO.
 *
 * Os testes de generate_blocks.test.js provam as peças com fonte sintético.
 * Este prova a junta com `components/HDL`, que é onde a coisa realmente
 * acontece, e fixa as duas metades da decisão:
 *
 *   com CAL != 0  o escopo `isp_blk.isp` existe e o monitor sai
 *   com CAL == 0  o escopo não existe e o monitor NÃO sai
 *
 * A segunda metade é a que protege: um espelho apontando para escopo
 * inexistente é erro de elaboração no Icarus, e foi por isso que a primeira
 * tentativa de trazer o isp foi revertida. O valor de CAL atravessa dois
 * níveis, do `<proc>.v` para o `processor`, que repassa `.CAL(CAL)` ao `core`.
 *
 * Pula sozinho quando `components/HDL` não está na máquina (clone novo, sem
 * `npm run bootstrap`), como o resto da suíte faz com a toolchain.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseVerilogModules, buildHierarchyTree, deriveMonitorScopes } from '../../js/wave/signal_parser.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HDL = path.join(RAIZ, 'components', 'HDL');
const temHdl = fs.existsSync(path.join(HDL, 'core.v'));

/** A árvore de um testbench que instancia o processador com um dado CAL. */
function arvoreCom(cal) {
    const fontes = fs.readdirSync(HDL)
        .filter((n) => n.endsWith('.v') && !n.includes('_tb'))
        .map((n) => ({ path: path.join(HDL, n), content: fs.readFileSync(path.join(HDL, n), 'utf8') }));
    fontes.push({
        path: 'tb.v',
        content: `module tb; processor#(.NUBITS(16), .CAL(${cal})) proc (clk); endmodule`,
    });
    const { modules } = parseVerilogModules(fontes);
    return buildHierarchyTree(modules, 'tb');
}

function acharEscopo(node, sufixo) {
    if (!node) return null;
    if (String(node.scopePath).endsWith(sufixo)) return node;
    for (const filho of node.children || []) {
        const achado = acharEscopo(filho, sufixo);
        if (achado) return achado;
    }
    return null;
}

describe.skipIf(!temHdl)('monitor do isp contra o HDL do SAPHO', () => {
    it('com CAL ligado, a pilha de instrução existe na hierarquia', () => {
        const isp = acharEscopo(arvoreCom(1), '.isp_blk.isp');
        expect(isp).not.toBeNull();
        // É uma `stack`, e é dela que saem os três sinais monitorados.
        expect(isp.name).toBe('stack');
        const nomes = new Set(isp.signals.map((s) => s.name));
        for (const v of ['pointeri', 'fl_max', 'fl_full']) expect(nomes.has(v), v).toBe(true);
    });

    it('com CAL desligado, ela NÃO existe, e é isso que protege a elaboração', () => {
        expect(acharEscopo(arvoreCom(0), '.isp_blk.isp')).toBeNull();
    });

    it('o monitor do isp entra com CAL ligado, junto com os da pilha e da ULA', () => {
        const refs = deriveMonitorScopes(arvoreCom(1)).map((m) => m.ref);
        expect(refs).toContain('proc.core.instr_fetch.isp_blk.isp.pointeri');
        expect(refs).toContain('proc.core.instr_fetch.isp_blk.isp.fl_max');
        expect(refs).toContain('proc.core.instr_fetch.isp_blk.isp.fl_full');
        // Os que já existiam continuam.
        expect(refs).toContain('proc.core.sp.pointeri');
        expect(refs).toContain('proc.core.ula.delta_int');
    });

    it('com CAL desligado, nenhum monitor de isp é emitido', () => {
        const refs = deriveMonitorScopes(arvoreCom(0)).map((m) => m.ref);
        expect(refs.some((r) => r.includes('isp'))).toBe(false);
        // E os outros seguem, para o programa sem função não perder nada.
        expect(refs).toContain('proc.core.sp.pointeri');
        expect(refs).toContain('proc.core.ula.delta_float');
    });

    it('o nome do espelho não colide entre a pilha de dados e a de instrução', () => {
        // As duas são `stack` e têm os mesmos três sinais; se o nome do
        // espelho saísse só do sinal, uma sobrescreveria a outra no testbench.
        const monitores = deriveMonitorScopes(arvoreCom(1));
        const espelhos = monitores.map((m) => m.mirror);
        expect(new Set(espelhos).size).toBe(espelhos.length);
    });
});
