import { describe, it, expect } from 'vitest';
import { buildSurferState, buildSurferLayout } from '../../js/wave/surfer_layout_writer.js';

/** Scope shape igual ao que o vcd_parser entrega (espelha o teste do gtkw). */
function scope(path, signals) {
    return {
        name: path.split('.').pop(),
        path,
        signals: signals.map((s) => ({
            name: s.name,
            width: s.width ?? 1,
            range: s.range ?? null,
            type: s.type ?? 'wire',
        })),
    };
}

describe('buildSurferState (camada de formato)', () => {
    const out = buildSurferState({
        vcdPath: 'C:\\tmp\\dump.vcd',
        items: [
            { kind: 'divider', name: 'Sec A' },
            {
                kind: 'variable', scope: ['tb', 'dut'], name: 'clk',
                format: 'Binary', color: 'Red', backgroundColor: 'Pink',
                manualName: 'CLK', heightScale: 2,
                analog: { renderStyle: 'Step', yAxisScale: 'Viewport' },
            },
            { kind: 'variable', scope: ['tb'], name: 'plain' },
        ],
    });

    it('emite um state RON com a casca waves + displayed_items', () => {
        expect(out).toContain('waves: Some((');
        expect(out).toContain('displayed_items: {');
        expect(out).toMatch(/items_tree: \(\s*items: \[/);
        expect(out.trim().endsWith(')')).toBe(true);
    });

    it('NAO emite header de .gtkw', () => {
        expect(out).not.toContain('[dumpfile]');
        expect(out).not.toContain('[savefile]');
    });

    it('escapa backslashes do path do VCD', () => {
        expect(out).toContain('source: File("C:\\\\tmp\\\\dump.vcd")');
    });

    it('serializa cor, background, formato, rename, altura e analog', () => {
        expect(out).toContain('color: Some("Red")');
        expect(out).toContain('background_color: Some("Pink")');
        expect(out).toContain('format: Some("Binary")');
        expect(out).toContain('manual_name: Some("CLK")');
        expect(out).toContain('height_scaling_factor: Some(2.0)');
        expect(out).toContain('render_style: Step');
        expect(out).toContain('y_axis_scale: Viewport');
    });

    it('um sinal sem opcoes vira tudo None', () => {
        expect(out).toContain('name: "plain"');
        // o item "plain" tem color/format/analog None (defaults)
        expect(out).toContain('format: None');
        expect(out).toContain('analog: None');
    });

    it('quebra o scope em path.strs e mantem o name separado', () => {
        expect(out).toContain('"tb",');
        expect(out).toContain('"dut",');
        expect(out).toContain('name: "clk"');
    });

    it('divider vira Divider com name Some', () => {
        expect(out).toContain('Divider((');
        expect(out).toContain('name: Some("Sec A")');
    });
});

describe('buildSurferLayout (camada de curadoria)', () => {
    const scopes = [
        scope('tb', [{ name: 'clk' }, { name: 'bus', width: 8, range: '7:0' }]),
        scope('tb.proc', [
            { name: 'valr2', range: '31:0' },
            { name: 'linetabs', range: '15:0' },
            { name: 'req_in_sim_0' },
            { name: 'in_sim_0', range: '31:0' },
            { name: 'me1_f_global_v_cont_e_', range: '31:0' },
            { name: 'me2_f_soma_v_acc_e_', range: '31:0' },
        ]),
        scope('tb.proc.sp', [{ name: 'pointeri', range: '7:0' }, { name: 'fl_full' }]),
        scope('tb.proc.ula', [{ name: 'delta_int', range: '31:0' }]),
    ];

    it('detecta 1 processador e retorna content nao-nulo', () => {
        const { content, processorCount } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(processorCount).toBe(1);
        expect(typeof content).toBe('string');
    });

    it('emite secao Top-level com Binary (1-bit) e Unsigned (barramento)', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(content).toContain('name: Some("Top-level")');
        expect(content).toContain('name: "bus"');
    });

    it('emite banner do proc + secoes I/O / Instructions / Variables / Flags', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(content).toContain('name: Some("proc")');
        expect(content).toContain('name: Some("I/O")');
        expect(content).toContain('name: Some("Instructions")');
        expect(content).toContain('name: Some("Variables")');
        expect(content).toContain('name: Some("Flags")');
        expect(content).toContain('name: Some("Stack")');
        expect(content).toContain('name: Some("ULA")');
    });

    it('aplica os aliases e cores da curadoria SAPHO', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(content).toContain('manual_name: Some("req_in 0")');
        expect(content).toContain('manual_name: Some("input  0")'); // DOIS espacos (igual ao writer .gtkw)
        expect(content).toContain('manual_name: Some("Assembly")');
        expect(content).toContain('manual_name: Some("C+-")');
        expect(content).toContain('manual_name: Some("int cont in global")');
        expect(content).toContain('manual_name: Some("float acc in soma()")');
        expect(content).toContain('manual_name: Some("Data Stack Pointer")');
        expect(content).toContain('manual_name: Some("Rounding Error (int)")');
        expect(content).toContain('color: Some("Yellow")');  // I/O
        expect(content).toContain('color: Some("Violet")');  // Instructions
        expect(content).toContain('color: Some("Orange")');  // Variables
    });

    it('recupera o analogico nos stack pointers / ULA (que o .sucl perdia)', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(content).toContain('render_style: Step');
    });

    it('respeita o filtro de selecao (so emite os escolhidos)', () => {
        const { content } = buildSurferLayout({
            vcdPath: 'x.vcd', scopes, tbModule: 'tb',
            selectedSignals: ['tb.proc.valr2'],
        });
        expect(content).toContain('name: "valr2"');
        expect(content).not.toContain('name: "linetabs"');
    });

    it('content null quando scopes vazio', () => {
        expect(buildSurferLayout({ vcdPath: 'x.vcd', scopes: [] }).content).toBeNull();
    });
});
