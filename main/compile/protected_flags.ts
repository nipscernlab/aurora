/**
 * protected_flags.ts: per-step lists of flags that override layers
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

export interface ProtectedFlagRule {
  /** tokens that must remain present verbatim */
  literalArgs?: string[];
  /** flag names (e.g. '-o') that must remain followed by some value */
  flagWithValue?: string[];
  /** env keys that the base set and override-applied set must agree on */
  envKeys?: string[];
}

/** O pedaco de uma CommandSpec que a verificacao olha. */
export interface SpecShape {
  args: string[];
  env?: Record<string, string> | null;
}

export const RULES: Record<string, ProtectedFlagRule> = {
  // Os tres passos do processador sao o driver yanc (builders/cmm.ts,
  // cpp.ts e asm.ts). Na compilacao, o -S para no .asm, que e o que o passo
  // de montagem le, e o -o e a pasta de saida onde o resto da AURORA procura
  // o que foi gerado. Na montagem nao ha -o (o yanc o recusa com um .asm):
  // -f e -c sao o clock e a duracao do testbench, que vem do .spf.
  'cmm': {
    literalArgs: ['-S'],
    flagWithValue: ['-o'],
  },
  'cpp': {
    literalArgs: ['-S'],
    flagWithValue: ['-o'],
  },
  'asm': {
    flagWithValue: ['-f', '-c'],
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
 * Variaveis de ambiente que escolhem QUAL codigo a ferramenta carrega: o
 * executavel que um nome resolve (PATH, COMSPEC), os modulos de um interpretador
 * (PYTHON*, PERL5*, NODE_OPTIONS), as bibliotecas injetadas no processo
 * (LD_PRELOAD, GPI_EXTRA) e o compilador ou o makefile que o make do Verilator
 * chama (CXX, OBJCACHE, MAKEFILES). Um override grava as mesmas chaves que a
 * IA ou o .spf pedirem, e um .spf baixado de fora traz os overrides dele; com
 * uma destas, abrir o projeto e compilar rodaria o programa de quem escreveu o
 * .spf. Nenhum override pode criar, trocar ou apagar uma delas, em passo
 * nenhum; a spec da AURORA continua definindo as suas (o PYTHONHOME do cocotb).
 * `*` no fim casa o prefixo. A comparacao ignora a caixa, como o Windows.
 */
export const ENV_QUE_CARREGA_CODIGO: readonly string[] = [
  'PATH', 'PATHEXT', 'COMSPEC', 'SHELL', 'BASH_ENV', 'ENV',
  'PYTHON*', 'PERL5*', 'PERLLIB', 'NODE_OPTIONS', 'NODE_PATH',
  'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'MAKEFLAGS', 'MFLAGS', 'GNUMAKEFLAGS', 'MAKEFILES', 'OBJCACHE',
  'CC', 'CXX', 'CPP', 'LD', 'AR', 'LINK',
  'IVERILOG_VPI_MODULE_PATH', 'VERILATOR_ROOT', 'VERILATOR_BIN',
  'GPI_EXTRA', 'PYGPI_*', 'TCL_LIBRARY', 'TCLLIBPATH',
  'AURORA_COCOTB_*',
];

/** Se a chave de ambiente esta em {@link ENV_QUE_CARREGA_CODIGO}. */
export function carregaCodigo(chave: string): boolean {
  const k = String(chave).toUpperCase();
  return ENV_QUE_CARREGA_CODIGO.some((p) => (p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p));
}

/** O ambiente com as chaves em maiusculas, para comparar como o Windows. */
function emMaiusculas(env: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env || {})) out[k.toUpperCase()] = v;
  return out;
}

/**
 * Validate that the override-applied spec preserves the protected
 * shape of the base spec.
 */
export function check(
  step: string,
  baseSpec: SpecShape | null | undefined,
  appliedSpec: SpecShape | null | undefined,
): { ok: true } | { ok: false, error: string } {
  const baseUpper = emMaiusculas(baseSpec?.env);
  const appliedUpper = emMaiusculas(appliedSpec?.env);
  for (const key of new Set([...Object.keys(baseUpper), ...Object.keys(appliedUpper)])) {
    if (carregaCodigo(key) && baseUpper[key] !== appliedUpper[key]) {
      return {
        ok: false,
        error: `cannot set, change or unset env var ${key} on step ${step} — it decides which code the tool loads`,
      };
    }
  }

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
    const baseEnv: Record<string, string> = baseSpec?.env || {};
    const appliedEnv: Record<string, string> = appliedSpec?.env || {};
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
export function describe(step: string): {
  step: string, protectedLiteralArgs: string[], protectedFlagWithValue: string[], protectedEnv: string[],
  codeLoadingEnv: string[],
} {
  const rule = RULES[step];
  const codeLoadingEnv = [...ENV_QUE_CARREGA_CODIGO];
  if (!rule) return { step, protectedLiteralArgs: [], protectedFlagWithValue: [], protectedEnv: [], codeLoadingEnv };
  return {
    step,
    protectedLiteralArgs: rule.literalArgs || [],
    protectedFlagWithValue: rule.flagWithValue || [],
    protectedEnv: rule.envKeys || [],
    codeLoadingEnv,
  };
}
