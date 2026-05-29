/**
 * builders/cocotb.js — CommandSpec for the cocotb Python runner.
 *
 * Aurora owns the runner script and passes all project-specific data via
 * environment variables. The user's Python file contains only cocotb tests;
 * no Makefile or runner boilerplate is required in the project.
 */

/**
 * @typedef {Object} CocotbRunBuilderCtx
 * @property {string} pythonPath
 * @property {string} runnerScript
 * @property {string} cwd
 * @property {Object.<string,string>} env
 * @property {string[]} [prependPath]
 */

/** @param {CocotbRunBuilderCtx} ctx */
export function buildCocotbRunSpec(ctx) {
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
