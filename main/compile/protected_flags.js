// @ts-check
/**
 * protected_flags.js: per-step lists of flags that override layers
 * cannot remove or replace.
 *
 * Aurora Intelligence's command-override surface lets the AI add/
 * remove/inject flags into the structured CommandSpec for any step.
 * Some flags, however, are pipeline invariants: removing `-o
 * <vvpFile>` from iverilog-build breaks the Wave pipeline because no
 * .vvp lands at the path the next step reads from.
 *
 * We don't disallow ADDING flags, that's the whole point of the AI
 * having override power. We just refuse to let the AI REMOVE or
 * STOMP what Aurora's own pipeline depends on.
 *
 * The check fires AFTER the override is applied: it compares the
 * resulting args to the protected list. If a protected token from
 * the base spec disappeared, reject. If a protected env var was
 * unset or rebound to a different value, reject.
 *
 * Flag matching is exact-token. For flag-and-value pairs (-o file,
 * -y dir, -s tb), we check the FLAG NAME only, the value can move
 * (Aurora regenerates these per-run anyway). For standalone tokens
 * (--binary, --main, -fst), we check the literal.
 */

'use strict';

/**
 * @typedef {Object} ProtectedFlagRule
 * @property {string[]} [literalArgs]   tokens that must remain present verbatim
 * @property {string[]} [flagWithValue] flag names (e.g. '-o') that must remain followed by some value
 * @property {string[]} [envKeys]       env keys that the base set and override-applied set must agree on
 */

/** @type {Object.<string, ProtectedFlagRule>} */
const RULES = {
  'cmm': {
    flagWithValue: ['-i', '-n', '-p', '-m', '-t'],
  },
  'asm-pre': {
    flagWithValue: ['-i', '-t'],
  },
  'asm': {
    flagWithValue: ['-i', '-p', '-d', '-m', '-t', '-f', '-c'],
  },
  'iverilog-check': {
    literalArgs: ['-tnull'],
    flagWithValue: ['-s', '-y'],
  },
  'iverilog-build': {
    literalArgs: [],
    flagWithValue: ['-s', '-y', '-o'],
  },
  'vvp-run': {
    literalArgs: ['-fst'],
  },
  'cocotb-run': {
    envKeys: [
      'AURORA_COCOTB_SOURCES_JSON',
      'AURORA_COCOTB_TOP',
      'AURORA_COCOTB_TEST_MODULE',
      'AURORA_COCOTB_BUILD_DIR',
      // Entrou na lista quando o painel de bibliotecas passou a instalar codigo
      // em components/PyLibs/site e esse diretorio virou parte do PYTHONPATH: a
      // variavel deixou de ser "onde achar o testbench" e virou um caminho de
      // CARREGAMENTO DE CODIGO. Um override que a reescrevesse escolheria de
      // onde o Python importa modulo, o que e execucao arbitraria disfarcada de
      // ajuste de flag.
      'AURORA_COCOTB_PYTHONPATH',
    ],
  },
  'verilator-build': {
    literalArgs: ['--binary', '--main', '--trace-fst'],
    flagWithValue: ['-Mdir', '--top-module', '-y'],
  },
  'verilator-run': {
    literalArgs: [],
  },
  'verilator-json': {
    literalArgs: ['--json-only'],
    flagWithValue: ['--top-module', '-Mdir', '-y'],
  },
  'verilator-tb-build': {
    literalArgs: ['--cc', '--exe', '--build'],
    flagWithValue: ['--top-module', '-Mdir', '-y'],
  },
  'verilator-tb-run': {
    literalArgs: [],
  },
  'fst2vcd': {
    flagWithValue: ['-f', '-o'],
  },
  'gtkwave': {
    literalArgs: [],
  },
  'yosys-hierarchy': {
    flagWithValue: ['-s'],
  },
  'prism-yosys': {
    flagWithValue: ['-s'],
  },
};

/**
 * Validate that the override-applied spec preserves the protected
 * shape of the base spec.
 *
 * @param {string} step
 * @param {{args:string[], env?:object}} baseSpec
 * @param {{args:string[], env?:object}} appliedSpec
 * @returns {{ok:true} | {ok:false, error:string}}
 */
function check(step, baseSpec, appliedSpec) {
  const rule = RULES[step];
  if (!rule) return { ok: true };

  const baseArgs = baseSpec?.args || [];
  const appliedArgs = appliedSpec?.args || [];

  if (Array.isArray(rule.literalArgs)) {
    for (const tok of rule.literalArgs) {
      if (baseArgs.includes(tok) && !appliedArgs.includes(tok)) {
        return {
          ok: false,
          error: `cannot remove protected flag ${tok} from step ${step} — it is required by the Aurora pipeline`,
        };
      }
    }
  }

  if (Array.isArray(rule.flagWithValue)) {
    for (const flag of rule.flagWithValue) {
      const inBase = baseArgs.includes(flag);
      if (!inBase) continue;
      const idx = appliedArgs.indexOf(flag);
      if (idx === -1) {
        return {
          ok: false,
          error: `cannot remove protected flag ${flag} from step ${step} — Aurora needs to control its value`,
        };
      }
      const next = appliedArgs[idx + 1];
      if (next === undefined || next.startsWith('-')) {
        return {
          ok: false,
          error: `protected flag ${flag} in step ${step} must remain followed by a value`,
        };
      }
    }
  }

  if (Array.isArray(rule.envKeys)) {
    const baseEnv = /** @type {Record<string, any>} */ (baseSpec?.env || {});
    const appliedEnv = /** @type {Record<string, any>} */ (appliedSpec?.env || {});
    for (const key of rule.envKeys) {
      if (key in baseEnv && baseEnv[key] !== appliedEnv[key]) {
        return {
          ok: false,
          error: `cannot change protected env var ${key} on step ${step}`,
        };
      }
    }
  }

  return { ok: true };
}

/** Snapshot for the AI's `list_allowed_flags` introspection tool. */
function describe(/** @type {string} */ step) {
  const rule = RULES[step];
  if (!rule) return { step, protectedLiteralArgs: [], protectedFlagWithValue: [], protectedEnv: [] };
  return {
    step,
    protectedLiteralArgs: rule.literalArgs || [],
    protectedFlagWithValue: rule.flagWithValue || [],
    protectedEnv: rule.envKeys || [],
  };
}

module.exports = { check, describe, RULES };
