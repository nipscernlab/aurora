/**
 * builders/index.ts, single import point for every CommandSpec
 * builder. Each builder is pure: it takes a context object (paths,
 * config, derived values) and returns a CommandSpec with no side
 * effects, no I/O, no console writes. That makes them trivial to unit
 * test and easy to feed to the AI's `inspect_compile_command` /
 * `preview_compile_command` tools.
 *
 * Compilado por `tsc` (npm run build:ts) num index.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

export * from './cmm.js';
export * from './asm.js';
export * from './iverilog.js';
export * from './vvp.js';
export * from './cocotb.js';
export * from './verilator.js';
export * from './wave_tools.js';
export * from './yosys.js';
