/**
 * builders/yosys.ts — CommandSpec builders for the two Yosys uses:
 * `yosys-hierarchy` (write_json for the renderer's hierarchy panel)
 * and `prism-yosys` (synthesis for the PRISM schematic).
 *
 * Both wrap `yosys.exe -s <script>`; the difference is which script
 * file the caller emits to disk first. The builder is unaware of the
 * script's contents — only of the path.
 *
 * Compilado por `tsc` (npm run build:ts) num yosys.js ao lado — é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface YosysHierarchyCtx {
  yosysPath: string;
  scriptPath: string;
  cwd: string;
}

export function buildYosysHierarchySpec(ctx: YosysHierarchyCtx): CommandSpec {
  return {
    step: 'yosys-hierarchy',
    binary: ctx.yosysPath,
    args: ['-s', ctx.scriptPath],
    cwd: ctx.cwd,
    label: 'yosys -s (hierarchy)',
  };
}

export interface PrismYosysCtx {
  yosysPath: string;
  scriptPath: string;
  cwd: string;
}

export function buildPrismYosysSpec(ctx: PrismYosysCtx): CommandSpec {
  return {
    step: 'prism-yosys',
    binary: ctx.yosysPath,
    args: ['-s', ctx.scriptPath],
    cwd: ctx.cwd,
    label: 'yosys -s (PRISM synth)',
  };
}
