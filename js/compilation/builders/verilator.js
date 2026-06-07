/**
 * builders/verilator.ts — CommandSpec builders for the Verilator
 * pipeline (build + 2-pass run).
 *
 * The verilator script is Perl; we always invoke it as
 *   perl.exe verilator <args>
 * with the bundle's mingw64/bin + usr/bin prepended onto PATH so
 * perl, g++, make, and the verilated.mk's bash/coreutils all
 * resolve. PATH manipulation rides through CommandSpec.prependPath
 * (the executor in main builds the child env from it) — no more
 * `cmd.exe && set "PATH=..."` shell trickery.
 *
 * The generated V<top>.exe is allowed by binary_allowlist's
 * Verilator-generated prefix rule (it lives under components/Temp/
 * obj_dir_* directories, which the allowlist accepts).
 *
 * Compilado por `tsc` (npm run build:ts) num verilator.js ao lado — é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */
// ── Verilator perf knobs (one place to tune; safe defaults) ─────────────────
// Build parallelism for BOTH Verilator's own work and the g++ model compile.
// '0' = one job per CPU core ("use everything"). This is the build-speed lever.
const VERILATOR_BUILD_JOBS = '0';
// g++ optimization level for the generated model. -O3 builds slower but the
// .exe runs faster — the right trade for long SAPHO processor sims. Drop to
// '-O2' here for quicker builds at some runtime cost.
const VERILATOR_OPT_LEVEL = '-O3';
// Multithreaded SIMULATION (NOT the build). 0 = single-thread. SAPHO processor
// sims are mostly sequential, so N>1 usually loses to thread-sync overhead and
// is left OFF by default. Set to a small N (2–4) only for large, parallelizable
// designs — and measure, because it can be slower. Wired, ready, opt-in.
const VERILATOR_SIM_THREADS = 0;
/** `['--threads', N]` when multithreaded sim is enabled, else `[]`. */
const verilatorThreadsArgs = () => VERILATOR_SIM_THREADS > 0 ? ['--threads', String(VERILATOR_SIM_THREADS)] : [];
export function buildVerilatorBuildSpec(ctx) {
    const warnings = ctx.extraWarnings || [
        '-Wno-fatal',
        '-Wno-TIMESCALEMOD',
        '-Wno-DECLFILENAME',
        '-Wno-STMTDLY',
    ];
    // Trace ligado por padrao (fluxo Wave -> FST). O Fast Sim passa false: sem
    // --trace-fst o runtime nao instrumenta dump nenhum (o maior custo de I/O da
    // sim some) e --no-trace-top vira irrelevante. --timing FICA — o testbench
    // original dirige o clock por #delay.
    const trace = ctx.trace !== false;
    // -CFLAGS takes ONE token per occurrence — wrapping "-O3 -fstrict-
    // aliasing" in quotes is lost by cmd.exe and Verilator misreads
    // -fstrict-aliasing as its own flag. So we pass two -CFLAGS pairs.
    const args = [
        ctx.verilatorScript,
        '--binary',
        '--main',
        ...(trace ? ['--trace-fst'] : []),
        '-j', VERILATOR_BUILD_JOBS,
        // Compile the C++ WITHOUT ccache. The bundled MSYS ccache can fail to
        // exec the compiler ("The system cannot find the path specified." → make
        // error 127), which aborts the whole Verilator build. `-MAKEFLAGS
        // OBJCACHE=` passes `OBJCACHE=` to the generated Makefile's make call,
        // overriding Verilator's configured OBJCACHE default (possibly `ccache`)
        // so the recipe runs `g++ …` directly instead of `ccache g++ …`.
        '-MAKEFLAGS', 'OBJCACHE=',
        ...warnings,
        '--timing',
        '--x-assign', 'fast',
        ...verilatorThreadsArgs(),
        ...(trace ? ['--no-trace-top'] : []),
        // YANC v4.3: liga o bloco de sim-visibility do harness (variaveis/arrays,
        // PC->C± line table, opcode tap, I/O mirrors) sob Verilator. O guard do
        // <proc>.v gerado e `ifdef YANC_SIM_VIS`, ativado por __ICARUS__ (Icarus)
        // OU por este define. Cada decl mirrored e /* verilator public_flat */,
        // entao proc.valr10 resolve hierarquicamente e o $finish de fim-de-programa
        // funciona — e por isso o strip workaround foi removido. Verilator-only:
        // o fluxo Icarus NAO recebe (ja liga via __ICARUS__ predefinido).
        '+define+YANC_TRACE',
        // Build runtime-first: as sims SAPHO sao de processador embarcado e podem
        // rodar muito tempo, entao priorizamos a velocidade do .exe mesmo as custas
        // de build mais lento. -O3 + -march=native (compila pras instrucoes EXATAS
        // da CPU host — seguro porque o Aurora compila e executa o binario na MESMA
        // maquina, host == target, e nunca o redistribui; o obj_dir fica em cache so
        // pra build incremental local). NAO usamos -ffast-math/-Ofast: alteram
        // semantica de ponto flutuante, e o SAPHO tem float.
        '-CFLAGS', VERILATOR_OPT_LEVEL,
        '-CFLAGS', '-march=native',
        '-CFLAGS', '-fstrict-aliasing',
        // -pipe: g++ passa os estagios da compilacao por pipes em vez de arquivos
        // temporarios em disco. Em Windows (I/O de arquivo caro) economiza alguns
        // round-trips de temp por unidade de traducao. Seguro, sem efeito no codigo.
        '-CFLAGS', '-pipe',
        // Silencia o ruido de g++ vindo dos headers DPI do proprio Verilator
        // (vltstd/svdpi.h, verilated_dpi.cpp): eles declaram as funcoes svDpi*
        // com __declspec(dllimport) (forma MSVC), e o g++/MinGW do bundle as
        // compila estatico -> dezenas de "'dllimport' attribute ignored
        // [-Wattributes]". Benigno (link estatico funciona); nao ha codigo de
        // projeto pra corrigir, entao silenciamos no compilador C++.
        '-CFLAGS', '-Wno-attributes',
        '--top-module', ctx.simTopModule,
        '-Mdir', ctx.objDir,
        '-y', ctx.hdlPath,
        ...ctx.sourceFiles,
    ];
    return {
        step: 'verilator-build',
        binary: ctx.perlExe,
        args,
        cwd: ctx.cwd,
        prependPath: [ctx.mingwBin, ctx.usrBin],
        // LC_ALL=C silencia o "perl: warning: Setting locale failed" do perl
        // MSYS2 (LANG/LC_* do Windows nao resolvem) — e os mesmos avisos de
        // make/bash/g++. Locale C nao afeta a compilacao.
        env: { LC_ALL: 'C' },
        label: `verilator build --top-module ${ctx.simTopModule}`,
    };
}
/**
 * Single full-simulation run. The VCD header is pulled from the finished FST
 * (_extractFstHeaderVcd) rather than from a separate header-only pass.
 */
export function buildVerilatorRunSpec(ctx) {
    return {
        step: 'verilator-run',
        binary: ctx.exePath,
        args: [],
        cwd: ctx.cwd,
        prependPath: [ctx.mingwBin, ctx.usrBin],
        label: 'V<top>.exe (full FST)',
    };
}
// =====================================================================
// Top-level harness pipeline (botao "Verilator (top-level)").
//
// Diferente do fluxo Wave (--binary --main): aqui rodamos o Verilator
// em 3 passos —
//   1. --json-only   dumpa V<top>.tree.json (portas do top-level)
//   2. --cc --exe --build  compila NOSSO testbench C++ (gerado em
//      verilator_tb.js) junto com as fontes → V<top>.exe nativo
//   3. roda o V<top>.exe, que faz o loop de clock + I/O por arquivo
// =====================================================================
const TL_WARNINGS = Object.freeze([
    '-Wno-fatal',
    '-Wno-TIMESCALEMOD',
    '-Wno-DECLFILENAME',
    '-Wno-STMTDLY',
    '-Wno-WIDTHTRUNC',
    '-Wno-WIDTHEXPAND',
]);
/**
 * Passo 1 — dumpa o AST (portas do top-level) com --json-only. Nenhum
 * C++ e gerado; so V<top>.tree.json no objDir. parseVerilatorPorts
 * (verilator_tb.js) consome esse arquivo.
 */
export function buildVerilatorJsonSpec(ctx) {
    const warnings = ctx.extraWarnings || TL_WARNINGS;
    return {
        step: 'verilator-json',
        binary: ctx.perlExe,
        args: [
            ctx.verilatorScript,
            '--json-only',
            ...warnings,
            '--top-module', ctx.topModule,
            '-Mdir', ctx.objDir,
            '-y', ctx.hdlPath,
            ...ctx.sourceFiles,
        ],
        cwd: ctx.cwd,
        prependPath: [ctx.mingwBin, ctx.usrBin],
        env: { LC_ALL: 'C' }, // silencia warning de locale do perl MSYS2
        label: `verilator --json-only --top-module ${ctx.topModule}`,
    };
}
/**
 * Passo 2 — compila o harness C++ manual (incluido em sourceFiles)
 * junto com as fontes. SEM --main / --binary: o main e o nosso .cpp.
 * `--cc --exe --build` faz o Verilator gerar C++, escrever o Makefile e
 * invocar o make → V<top>.exe.
 */
export function buildVerilatorTbBuildSpec(ctx) {
    const warnings = ctx.extraWarnings || TL_WARNINGS;
    return {
        step: 'verilator-tb-build',
        binary: ctx.perlExe,
        args: [
            ctx.verilatorScript,
            '--cc',
            '--exe',
            '--build',
            '-j', VERILATOR_BUILD_JOBS,
            // Compile WITHOUT ccache — the bundled MSYS ccache can fail to exec the
            // compiler (make error 127), aborting the build. See the note in
            // buildVerilatorBuildSpec; `-MAKEFLAGS OBJCACHE=` forces `g++ …` direct.
            '-MAKEFLAGS', 'OBJCACHE=',
            ...warnings,
            // SEM --timing aqui (diferente do fluxo Wave). O clock e dirigido a
            // mao pelo harness C++ e o que compilamos — <proc>.v + libs HDL — e
            // RTL 100% sintetizavel (zero #delay/wait/fork). Pedir --timing so faz
            // o Verilator gerar o escalonador de timing (corrotinas) que nunca
            // roda: peso morto no build e em cada eval(). O fluxo Wave mantem
            // --timing porque la o testbench .v usa #delays pra gerar o clock.
            '--x-assign', 'fast',
            ...verilatorThreadsArgs(),
            // Runtime-first, igual ao fluxo Wave (sims de processador sao longas):
            // -O3 + -march=native pra maximizar a velocidade do .exe. Subiu de -O2.
            '-CFLAGS', VERILATOR_OPT_LEVEL,
            '-CFLAGS', '-march=native',
            // -pipe: estagios do g++ por pipe em vez de temporarios em disco (ver
            // buildVerilatorBuildSpec). Ganho de I/O em Windows, sem efeito no codigo.
            '-CFLAGS', '-pipe',
            // Mesma supressao do fluxo Wave: os headers DPI do Verilator usam
            // __declspec(dllimport) e o g++/MinGW (link estatico) ignora ->
            // ruido -Wattributes inofensivo. Ver buildVerilatorBuildSpec.
            '-CFLAGS', '-Wno-attributes',
            '--top-module', ctx.topModule,
            '-Mdir', ctx.objDir,
            '-y', ctx.hdlPath,
            ...ctx.sourceFiles,
        ],
        cwd: ctx.cwd,
        prependPath: [ctx.mingwBin, ctx.usrBin],
        env: { LC_ALL: 'C' }, // silencia warning de locale do perl/make MSYS2
        label: `verilator --cc --exe --build --top-module ${ctx.topModule}`,
    };
}
/**
 * Passo 3 — roda o V<top>.exe no diretorio de I/O. cwd e o dir onde os
 * <pino>.in vivem e onde os <pino>.out serao escritos. A simulacao
 * termina quando a 1a entrada se esgota; +cycles=N e so o teto.
 */
export function buildVerilatorTbRunSpec(ctx) {
    const args = [];
    if (Number.isFinite(ctx.cycles))
        args.push(`+cycles=${ctx.cycles}`);
    return {
        step: 'verilator-tb-run',
        binary: ctx.exePath,
        args,
        cwd: ctx.cwd,
        prependPath: [ctx.mingwBin, ctx.usrBin],
        label: 'V<top>.exe (top-level harness run)',
    };
}
