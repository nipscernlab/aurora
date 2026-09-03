// @ts-check
/**
 * interpreter_guard.js: o que perl e python podem receber como argumento num
 * exec-spec vindo do renderer.
 *
 * O binary_allowlist responde "este binario pode nascer"; ele nunca olhou os
 * argumentos, e para um interpretador os argumentos SAO o programa: `perl -e`
 * e `python -c` executam qualquer texto, e um renderer comprometido (ou uma
 * ferramenta da IA induzida) teria com eles exatamente o que a allowlist
 * promete negar. A documentacao apresentava a allowlist como fronteira de
 * confianca; com este guarda ela passa a ser, para os interpretadores.
 *
 * A regra segue o proprio interpretador: as opcoes dele vem ANTES do primeiro
 * argumento que nao comeca com `-` (o script); o que vem depois pertence ao
 * script. Isso importa porque o verilator e um script perl e usa `-E` e `-cc`
 * legitimamente, depois do nome dele. So o prefixo de opcoes e inspecionado, e
 * nele sao recusadas as formas que executam codigo vindo da linha de comando ou
 * de stdin, coladas ou nao (`-eprint 1`, `-cimport os`):
 *
 *   perl:   -e, -E  codigo inline;  -  programa lido de stdin
 *   python: -c      codigo inline;  -m modulo qualquer (inclusive do site do
 *           usuario);  -  programa lido de stdin
 *
 * Opcoes que consomem o argumento SEGUINTE como valor (`-I dir` no perl, `-X`
 * e `-W` no python) sao puladas junto com o valor, senao `perl -I x -e ...`
 * esconderia o `-e` atras de um "script" chamado `x`.
 *
 * O que a cadeia usa continua passando: `perl <verilator> ...` e
 * `python <aurora_cocotb_runner.py> ...`. `python -m black` roda no main
 * (python_format.js) e nao passa por aqui.
 */

'use strict';

const path = require('path');

/** Opcoes recusadas no prefixo de opcoes do interpretador. */
const RECUSADAS = {
  perl: [/^-[eE]/, /^-$/],
  python: [/^-c/, /^-m/, /^-$/],
};

/** Opcoes cujo valor vem no argumento seguinte, para o guarda pular o valor. */
const COM_VALOR_SEPARADO = {
  perl: new Set(['-I']),
  python: new Set(['-X', '-W', '--check-hash-based-pycs']),
};

/**
 * @param {string} binary caminho ou nome do binario.
 * @returns {'perl' | 'python' | null}
 */
function tipoDeInterpretador(binary) {
  const base = path.basename(String(binary || '')).toLowerCase().replace(/\.exe$/, '');
  if (base === 'perl') return 'perl';
  if (/^python(3(\.\d+)?)?$/.test(base) || base === 'py') return 'python';
  return null;
}

/**
 * @param {string} binary
 * @param {unknown} args
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function argumentosDeInterpretadorPermitidos(binary, args) {
  const tipo = tipoDeInterpretador(binary);
  if (!tipo) return { ok: true };
  const regras = RECUSADAS[tipo];
  const comValor = COM_VALOR_SEPARADO[tipo];
  const lista = Array.isArray(args) ? args.map(String) : [];
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (a === '--') break;
    if (!a.startsWith('-')) break; // o script: dali em diante os argumentos sao dele
    for (const re of regras) {
      if (re.test(a)) {
        return {
          ok: false,
          error: `${tipo}: the option "${a}" runs code from the command line or stdin; `
            + 'the toolchain only ever runs a script file, so this spec is refused',
        };
      }
    }
    if (comValor.has(a)) i += 1;
  }
  return { ok: true };
}

module.exports = { argumentosDeInterpretadorPermitidos, tipoDeInterpretador };
