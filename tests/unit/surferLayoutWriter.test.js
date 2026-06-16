import { describe, it, expect } from 'vitest';
import { buildSurferState, buildSurferLayout, convertTradToSurferMapping } from '../../js/wave/surfer_layout_writer.ts';

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
        expect(content).toContain('name: "Top-level"'); // Top-level = Group (name String, sem Some)
        expect(content).toContain('name: "bus"');
    });

    it('emite banner do proc + secoes I/O / Instructions / Variables / Flags (todas Groups)', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        // Banner do proc E cada secao agora sao Groups colapsaveis (name String, sem Some).
        expect(content).toContain('name: "proc"');
        expect(content).toContain('name: "I/O"');
        expect(content).toContain('name: "Instructions"');
        expect(content).toContain('name: "Variables"');
        expect(content).toContain('name: "Flags"');
        expect(content).toContain('name: "Stack"');
        expect(content).toContain('name: "ULA"');
    });

    it('aplica os aliases e cores da curadoria SAPHO', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(content).toContain('manual_name: Some("req_in 0")');
        expect(content).toContain('manual_name: Some("input  0")'); // DOIS espacos (igual ao writer .gtkw)
        expect(content).toContain('manual_name: Some("Assembly (proc)")'); // label por nome do processador
        expect(content).toContain('manual_name: Some("C+- (proc)")');
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

    it('floats (me2_) saem como analog Step/Global; clk/rst em meia-altura', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        // O float "acc" tem analog com escala Global (curva de osciloscopio p/ DSP).
        expect(content).toMatch(/manual_name: Some\("float acc in soma\(\)"\)[\s\S]*?render_style: Step,\s*y_axis_scale: Global/);
        // clk com meia-altura (height_scaling_factor: Some(0.5)).
        expect(content).toContain('height_scaling_factor: Some(0.5)');
    });

    it('TODOS os grupos curados saem coloridos (vermelho) pra destacar', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        // Cada secao virou um Group com color: Some("Red") (header destacado).
        expect(content).toMatch(/Group\(\(\s*name: "Instructions",\s*color: Some\("Red"\)/);
        expect(content).toMatch(/Group\(\(\s*name: "Top-level",\s*color: Some\("Red"\)/);
        // Nenhum grupo curado fica sem cor.
        expect(content).not.toMatch(/Group\(\(\s*name: "[^"]*",\s*color: None/);
    });

    it('folding curado: secoes viram Groups aninhados; Flags fecha por padrao', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        // I/O / Instructions / Variables / Flags / Top-level sao Groups (nao dividers).
        expect(content).toMatch(/Group\(\(\s*name: "I\/O",/);
        expect(content).toMatch(/Group\(\(\s*name: "Variables",/);
        // Flags fecha por padrao (is_open: false) — debug secundario.
        expect(content).toMatch(/Group\(\(\s*name: "Flags",\s*color: Some\("Red"\),\s*background_color: None,\s*content: \[\],\s*is_open: false/);
        // Aninhamento profundo: proc(level 1) -> secao(level 2) -> sinal(level 3).
        expect(content).toMatch(/level: 2,/);
        expect(content).toMatch(/level: 3,/);
    });

    it('sem processador (nenhum scope com valr2+linetabs): nao emite Instructions/Assembly/C+-', () => {
        const plain = [
            scope('tb', [{ name: 'clk' }, { name: 'bus', width: 8, range: '7:0' }]),
            scope('tb.dut', [{ name: 'state', range: '1:0' }]),
        ];
        const { content, processorCount } = buildSurferLayout({ vcdPath: 'x.vcd', scopes: plain, tbModule: 'tb' });
        expect(processorCount).toBe(0);
        expect(content).not.toContain('Instructions');
        expect(content).not.toContain('Assembly');
        expect(content).not.toContain('C+-');
    });

    it('o filtro de selecao vale pros sinais comuns', () => {
        const { content } = buildSurferLayout({
            vcdPath: 'x.vcd', scopes, tbModule: 'tb',
            selectedSignals: ['tb.proc.valr2'], // 'bus' (top-level) fica de fora
        });
        expect(content).not.toContain('name: "bus"');
    });

    it('tracks de instrucao (Assembly/C+-) SEMPRE aparecem, fora do filtro do picker', () => {
        // O usuario quer que "sempre que ha processadores eles aparecem": os
        // tracks curados valr2/linetabs nao passam pelo filtro de selecao.
        const { content } = buildSurferLayout({
            vcdPath: 'x.vcd', scopes, tbModule: 'tb',
            selectedSignals: ['tb.clk'], // nem valr2 nem linetabs selecionados
        });
        expect(content).toContain('name: "valr2"');
        expect(content).toContain('name: "linetabs"');
    });

    it('content null quando scopes vazio', () => {
        expect(buildSurferLayout({ vcdPath: 'x.vcd', scopes: [] }).content).toBeNull();
    });

    it('cada processador vira um Group colapsavel (name String, content vazio, is_open) com filhos em level 1', () => {
        const { content } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        // Group nativo do Surfer: name String (sem Some), content SEMPRE [], is_open true.
        expect(content).toMatch(/Group\(\(\s*name: "proc",\s*color: Some\("Red"\),\s*background_color: None,\s*content: \[\],\s*is_open: true,/);
        // O no do grupo (level 0) e seguido por filhos em level 1 no items_tree.
        expect(content).toMatch(/level: 1,/);
        // O Top-level tambem e um Group (name String, sem Some) — tudo dobravel.
        expect(content).toContain('name: "Top-level"');
    });
});

describe('buildSurferLayout — grupos por processador (multi-proc)', () => {
    const scopes = [
        scope('tb', [{ name: 'clk' }]),
        scope('tb.p1', [
            { name: 'valr2', range: '31:0' }, { name: 'linetabs', range: '19:0' },
        ]),
        scope('tb.p2', [
            { name: 'valr2', range: '31:0' }, { name: 'linetabs', range: '19:0' },
        ]),
    ];

    it('dois processadores → dois Groups distintos, cada um com seus tracks', () => {
        const { content, processorCount } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(processorCount).toBe(2);
        expect(content).toMatch(/Group\(\(\s*name: "p1",/);
        expect(content).toMatch(/Group\(\(\s*name: "p2",/);
        // Cada proc rotula o Assembly com o seu nome (procType = instanceName aqui).
        expect(content).toContain('manual_name: Some("Assembly (p1)")');
        expect(content).toContain('manual_name: Some("Assembly (p2)")');
    });
});

describe('convertTradToSurferMapping (trad → mapping translator do Surfer)', () => {
    it('emite header Name/Bits e mapeia chave decimal → texto verbatim', () => {
        const out = convertTradToSurferMapping('aurora_asm_x', 32, '0 NOP \n5 JMP main\n');
        expect(out).toContain('Name = aurora_asm_x');
        expect(out).toContain('Bits = 32');
        expect(out).toContain('0 NOP\n');     // trailing space do trad e aparado
        expect(out).toContain('5 JMP main');
    });

    it('PULA linhas de texto vazio (Surfer rejeita "Missing mapping" e da panic)', () => {
        const out = convertTradToSurferMapping('m', 20, '10 \n11 foo\n');
        expect(out).not.toMatch(/^10 *$/m);
        expect(out).toContain('11 foo');
    });

    it('converte chaves NEGATIVAS para o padrao de bits unsigned na largura', () => {
        const out = convertTradToSurferMapping('m', 20, '-1 INTERNAL\n-2 void main();\n-3 END\n');
        expect(out).toContain('0xFFFFF INTERNAL');
        expect(out).toContain('0xFFFFE void main();');
        expect(out).toContain('0xFFFFD END');
        expect(out).not.toContain('-1 INTERNAL');
    });

    it('preserva # no texto (nao e comentario inline no Surfer) e multi-palavra', () => {
        const out = convertTradToSurferMapping('m', 20, '1 #PRNAME cnn\n14 float w[160] "w.txt";\n');
        expect(out).toContain('1 #PRNAME cnn');
        expect(out).toContain('14 float w[160] "w.txt";');
    });

    it('sem largura (bits=0): omite Bits e pula chave negativa (nao mapeavel)', () => {
        const out = convertTradToSurferMapping('m', 0, '5 OK\n-1 NOPE\n');
        expect(out).not.toContain('Bits =');
        expect(out).toContain('5 OK');
        expect(out).not.toContain('NOPE');
    });
});

describe('buildSurferLayout — mapping translators (decode Assembly/C+-)', () => {
    const scopes = [
        scope('tb', [{ name: 'clk' }]),
        scope('tb.proc', [
            { name: 'valr2', range: '31:0' },
            { name: 'linetabs', range: '19:0' },
        ]),
    ];

    it('sem trad files: fallback decimal cru + mappings vazio', () => {
        const { content, mappings } = buildSurferLayout({ vcdPath: 'x.vcd', scopes, tbModule: 'tb' });
        expect(mappings).toEqual([]);
        expect(content).toContain('manual_name: Some("Assembly (proc)")');
        expect(content).toContain('format: Some("Unsigned")');
        expect(content).toContain('format: Some("Signed")');
    });

    it('com trad files: o format aponta pro mapping e os mappings sao retornados', () => {
        const { content, mappings } = buildSurferLayout({
            vcdPath: 'x.vcd', scopes, tbModule: 'tb',
            mappingNamespace: 'tb',
            tradByProcType: {
                proc: { opcode: '0 NOP \n5 JMP main\n', cmm: '-1 INTERNAL\n3 x = 1;\n' },
            },
        });
        expect(mappings.map((m) => m.name).sort())
            .toEqual(['aurora_asm_tb_proc', 'aurora_src_tb_proc']);
        expect(content).toContain('format: Some("aurora_asm_tb_proc")');
        expect(content).toContain('format: Some("aurora_src_tb_proc")');
        const src = mappings.find((m) => m.name === 'aurora_src_tb_proc');
        expect(src.content).toContain('Bits = 20');         // largura do linetabs [19:0]
        expect(src.content).toContain('0xFFFFF INTERNAL');  // negativo convertido
    });
});
