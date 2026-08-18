import { describe, it, expect } from 'vitest';
import {
    parseVcdScopes,
    parseVcdHeaderFromContent,
} from '../../js/wave/vcd_parser.ts';

describe('parseVcdScopes', () => {
    it('returns flat scope list with paths from root', () => {
        const header = `
            $date Mon $end
            $version Aurora $end
            $timescale 1ns $end
            $scope module tb_counter $end
            $var reg 1 ! clk $end
            $var reg 1 " rst $end
            $scope module dut $end
            $var wire 1 # clk $end
            $var wire 4 $ q [3:0] $end
            $upscope $end
            $upscope $end
        `;
        const scopes = parseVcdScopes(header);
        expect(scopes).toHaveLength(2);

        const tb = scopes.find((s) => s.name === 'tb_counter');
        expect(tb.path).toBe('tb_counter');
        expect(tb.signals.map((s) => s.name).sort()).toEqual(['clk', 'rst']);

        const dut = scopes.find((s) => s.name === 'dut');
        expect(dut.path).toBe('tb_counter.dut');
        expect(dut.signals.map((s) => s.name).sort()).toEqual(['clk', 'q']);

        // Bus signal carries its [msb:lsb] range.
        const q = dut.signals.find((s) => s.name === 'q');
        expect(q.range).toBe('3:0');
        expect(q.width).toBe(4);
    });

    it('skips non-module scopes ($function / $task) but keeps the brace balanced', () => {
        const header = `
            $scope module tb $end
            $var reg 1 ! a $end
            $scope task my_task $end
            $var reg 1 " local $end
            $upscope $end
            $var reg 1 # b $end
            $upscope $end
        `;
        const scopes = parseVcdScopes(header);
        expect(scopes).toHaveLength(1);
        // 'a' and 'b' belong to tb (the task didn't break tracking),
        // 'local' was dropped because tasks aren't picker scopes.
        const names = scopes[0].signals.map((s) => s.name).sort();
        expect(names).toEqual(['a', 'b']);
    });

    it('builds nested paths through three levels', () => {
        const header = `
            $scope module top $end
            $scope module mid $end
            $scope module leaf $end
            $var wire 1 ! x $end
            $upscope $end
            $upscope $end
            $upscope $end
        `;
        const scopes = parseVcdScopes(header);
        const leaf = scopes.find((s) => s.name === 'leaf');
        expect(leaf.path).toBe('top.mid.leaf');
        expect(leaf.signals[0].name).toBe('x');
    });

    it('returns an empty array on empty input', () => {
        expect(parseVcdScopes('')).toEqual([]);
        expect(parseVcdScopes('   \n\n  ')).toEqual([]);
    });

    it('merges signals across re-opened scopes with the same path', () => {
        // VCDs onde cada $var fica num bloco $scope/$upscope proprio
        // (caso comum quando o testbench dispara varios $dumpvars
        // direcionados a sub-escopos especificos, formato que o
        // asmcomp do SAPHO gera) precisam ter os sinais mergeados
        // dentro de UMA scope por path. Sem isso, lookup por path
        // so acha o primeiro.
        const header = `
            $scope module tb $end
            $var reg 1 ! clk $end
            $upscope $end
            $scope module tb $end
            $var reg 1 " rst $end
            $upscope $end
            $scope module tb $end
            $scope module dut $end
            $var reg 4 # q [3:0] $end
            $upscope $end
            $upscope $end
            $scope module tb $end
            $scope module dut $end
            $var reg 4 $ d [3:0] $end
            $upscope $end
            $upscope $end
        `;
        const scopes = parseVcdScopes(header);
        // 1 tb + 1 dut, nao 4 tbs + 2 duts.
        expect(scopes).toHaveLength(2);
        const tb = scopes.find((s) => s.path === 'tb');
        expect(tb.signals.map((s) => s.name).sort()).toEqual(['clk', 'rst']);
        const dut = scopes.find((s) => s.path === 'tb.dut');
        expect(dut.signals.map((s) => s.name).sort()).toEqual(['d', 'q']);
    });

    it('stops at $enddefinitions even if more text follows', () => {
        const text = `
            $scope module tb $end
            $var reg 1 ! a $end
            $upscope $end
            $enddefinitions $end
            #0
            0!
            #5
            1!
        `;
        // Either parseVcdScopes called on the full text or via the
        // header helper produces the same scope set. The value-change
        // section past $enddefinitions must not influence parsing.
        expect(parseVcdScopes(text)[0].signals[0].name).toBe('a');
    });
});

describe('parseVcdHeaderFromContent', () => {
    it('strips the value-change section before parsing', () => {
        const content = `
            $scope module tb $end
            $var reg 1 ! a $end
            $upscope $end
            $enddefinitions $end
            $dumpvars
            0!
            $end
            #5
            1!
        `;
        const scopes = parseVcdHeaderFromContent(content);
        expect(scopes).toHaveLength(1);
        expect(scopes[0].signals).toHaveLength(1);
        expect(scopes[0].signals[0].name).toBe('a');
    });
});

describe('parseVcdScopes — VCD identifier `[` no $var', () => {
    it('nao colapsa scopes quando ID do signal e `[`', async () => {
        const { parseVcdScopes } = await import('../../js/wave/vcd_parser.js');
        // Iverilog usa ASCII printable (`!`..`~`) como IDs. `[` e `]`
        // sao validos. Bug antigo: regex `\[[^\]]+\]` capturava do
        // `[` (ID) ate o proximo `]` no file todo, comendo $scope/
        // $upscope/etc, paths viravam tipo "tb.tb.tb.inst.foo".
        const vcd = `
            $scope module tb $end
            $var reg 1 [ out_en $end
            $upscope $end
            $scope module tb $end
            $scope module sub $end
            $var reg 1 ! sig $end
            $upscope $end
            $upscope $end
        `;
        const scopes = parseVcdScopes(vcd);
        const paths = scopes.map((s) => s.path).sort();
        expect(paths).toEqual(['tb', 'tb.sub']);
        // O scope `tb.sub` nao pode ter virado `tb.tb.sub` por causa
        // do colchete consumido fora de propósito.
        expect(paths.every((p) => !p.includes('tb.tb'))).toBe(true);
    });
});
