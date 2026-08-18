/**
 * builders/cocotb.ts, CommandSpec for the cocotb Python runner.
 *
 * Aurora owns the runner script and passes all project-specific data via
 * environment variables. The user's Python file contains only cocotb tests;
 * no Makefile or runner boilerplate is required in the project.
 *
 * Compilado por `tsc` (npm run build:ts) num cocotb.js ao lado, é esse .js que o
 * runtime carrega; os imports usam a extensão `.js`.
 */

import type { CommandSpec } from '../command_spec.js';

export interface CocotbRunBuilderCtx {
  pythonPath: string;
  runnerScript: string;
  cwd: string;
  env: Record<string, string>;
  prependPath?: string[];
}

export function buildCocotbRunSpec(ctx: CocotbRunBuilderCtx): CommandSpec {
  return {
    step: 'cocotb-run',
    binary: ctx.pythonPath,
    args: [ctx.runnerScript],
    cwd: ctx.cwd,
    env: ctx.env,
    prependPath: ctx.prependPath || [],
    label: 'python aurora_cocotb_runner.py',
  };
}
