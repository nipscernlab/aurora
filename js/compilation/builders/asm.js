/**
 * builders/asm.ts — CommandSpec builders for the two ASM steps:
 * appcomp (macro preprocessor) and asmcomp (final compiler).
 *
 * Mirror the call sites in compilation_module.js asmCompilation().
 * Lang flag (-pt/-en) goes first; the rest are named options
 * (APP/Sources/args.c and ASM/Sources/args.c).
 *
 * Compilado por `tsc` (npm run build:ts) num asm.js ao lado — é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */
export function buildAsmPreSpec(ctx) {
    const args = [
        `-${ctx.lang}`,
        '-i', ctx.asmFile,
        '-t', ctx.tempPath,
    ];
    return {
        step: 'asm-pre',
        binary: ctx.appCompPath,
        args,
        cwd: ctx.tempPath,
        processorName: ctx.processorName,
        label: `asm-pre: ${ctx.processorName}`,
    };
}
export function buildAsmSpec(ctx) {
    const args = [
        `-${ctx.lang}`,
        '-i', ctx.asmFile,
        '-p', ctx.projectPath,
        '-d', ctx.hdlPath,
        '-m', ctx.macrosPath,
        '-t', ctx.tempPath,
        '-f', String(ctx.freq),
        '-c', String(ctx.clocks),
    ];
    return {
        step: 'asm',
        binary: ctx.asmCompPath,
        args,
        cwd: ctx.tempPath,
        processorName: ctx.processorName,
        label: `asm: ${ctx.processorName}`,
    };
}
