// @ts-check
/**
 * binary_allowlist.js: the closed set of executables Aurora's
 * structured-spec executor will spawn.
 *
 * Why: the new `exec-spec` IPC lets the renderer (and through it,
 * Aurora Intelligence) pick {binary, args[]} for a toolchain step. The
 * AI's surface for editing command lines deliberately does NOT expose
 * a way to swap the binary, but a buggy or compromised renderer
 * could still send anything. This allowlist is the trust boundary:
 * any spec whose `binary` is not in the table is rejected with a clear
 * error, regardless of what the args say.
 *
 * The table is keyed by the BASENAME of the binary; each entry lists
 * the legal directories the binary must come from (resolved relative
 * to components/<componentsPath>). A spec's `binary` must therefore
 * end with one of the listed names AND live in one of the listed
 * directories under componentsPath.
 *
 * Adding a new toolchain binary: add it here. That's the whole gate for WHICH
 * executable may start. It is not the whole gate for what it does: perl,
 * python, g++ and make take free-form args, and for an interpreter the args
 * ARE the program. The executor closes that for perl and python through
 * main/compile/interpreter_guard.js (no `-e`, `-c`, `-m` or stdin program in
 * the interpreter's own option prefix). g++ and make stay as they are: their
 * args are compiler flags and targets, and the damage they can do is bounded
 * by the cwd the spec names, which the executor already confines.
 */

'use strict';

const path = require('path');
const { componentsPath } = require('../paths');
const {
  getBundledPythonPath,
  isBundledPythonPath,
} = require('./python_locator');
const componentes = require('../components/registry');

/**
 * Each entry: [basename, [allowed-subdirs-under-components], componentKey].
 *
 * A terceira coluna diz de qual componente o binario faz parte. Ela existe
 * porque o instalador deixou de carregar tudo: um binario pode estar no lugar
 * certo e mesmo assim nao existir na maquina, e este e o unico ponto por onde
 * todos os caminhos de execucao passam antes de nascer um processo. Ver
 * main/components/registry.js.
 */
/** @type {Array<[string, string[], string]>} */
const RAW_ALLOWLIST = [
  ['cmmcomp.exe',   ['bin'], 'yanc'],
  ['appcomp.exe',   ['bin'], 'yanc'],
  ['asmcomp.exe',   ['bin'], 'yanc'],

  // Unified mingw bundle: iverilog, vvp, verilator, perl, g++, make, yosys
  // (+ python, handled by the python branch in isAllowed) all live in
  // Packages/msys/mingw64/bin.
  ['iverilog.exe',  ['Packages/msys/mingw64/bin'], 'msys'],
  ['vvp.exe',       ['Packages/msys/mingw64/bin'], 'msys'],
  ['verilator',     ['Packages/msys/mingw64/bin'], 'msys'],
  ['verilator.exe', ['Packages/msys/mingw64/bin'], 'msys'],
  ['perl.exe',      ['Packages/msys/mingw64/bin'], 'msys'],
  ['g++.exe',       ['Packages/msys/mingw64/bin'], 'msys'],
  ['make.exe',      ['Packages/msys/mingw64/bin'], 'msys'],
  ['yosys.exe',     ['Packages/msys/mingw64/bin'], 'msys'],

  // fst2vcd (and the display GTKWave) ship in the gtkwave-nipscern fork.
  ['gtkwave.exe',   ['Packages/gtkwave-nipscern'], 'gtkwave'],
  ['fst2vcd.exe',   ['Packages/gtkwave-nipscern'], 'gtkwave'],

  // Surfer, the opt-in embedded waveform viewer (launch-surfer). NIPS-CERN
  // fork build (surfer-aurora.exe) from gitlab.com/nips-cern/surfer-aurora.
  ['surfer-aurora.exe', ['Packages/surfer'], 'surfer'],
  // Verible language server, the Verilog LSP backend (O2). Long-lived
  // stdio process spawned by main/lsp/verible_lsp.js for diagnostics,
  // formatting, outline, hover and definition/references in Monaco.
  ['verible-verilog-ls.exe', ['Packages/verible/bin'], 'verible'],
  // clang-format, the C/C++/CMM formatter (Shift+Alt+F). One-shot stdin->
  // stdout process spawned by main/format/clang_format.js.
  ['clang-format.exe', ['Packages/clang-format/bin'], 'clang-format'],
  // slang-server, the SystemVerilog SEMANTIC language server (O11).
  // Long-lived stdio process spawned by main/lsp/slang_lsp.js for
  // elaboration diagnostics + completion in Monaco (complements Verible).
  ['slang-server.exe', ['Packages/slang-server/bin'], 'slang'],
  // comp2gtkw, the complex-number decoder pre-pass (decode-complex). Ships
  // with the YANC compilers in components/bin.
  ['comp2gtkw.exe', ['bin'], 'yanc'],
  // (netlistsvg is no longer a bundled .exe, it runs in-process from
  //  @silimate/netlistsvg, so it needs no allowlist entry.)
];

/**
 * Verilator generates per-design native executables under
 * <componentsPath>/Temp/obj_dir_<simTop>/V<simTop>.exe. These aren't
 * shipped with Aurora, but the wave-flow's pass-1/pass-2 spawns them
 * directly. They're allowed only when they live under components/Temp.
 *
 * We special-case via prefix match in `isAllowed` below.
 */
const VERILATOR_GENERATED_PREFIX = path.posix.join(toPosix(componentsPath), 'Temp/');

function toPosix(/** @type {string} */ p) {
  return String(p || '').replace(/\\/g, '/');
}

/**
 * @param {string} binaryPath  absolute path to the candidate binary
 * @returns {{ok:true} | {ok:false, error:string}}
 */
function isAllowed(binaryPath) {
  if (typeof binaryPath !== 'string' || !binaryPath) {
    return { ok: false, error: 'binary path must be a non-empty string' };
  }
  if (!path.isAbsolute(binaryPath)) {
    return { ok: false, error: `binary path must be absolute: ${binaryPath}` };
  }

  const normalized = toPosix(path.normalize(binaryPath));
  const baseName = path.basename(normalized);
  const dir = path.posix.dirname(normalized);

  if (/^python(3)?(\.exe)?$/i.test(baseName) || /^py(\.exe)?$/i.test(baseName)) {
    // The single bundled Python (components/Packages/msys) serves both cocotb
    // flows (Icarus + Verilator).
    if (isBundledPythonPath(binaryPath)) return { ok: true };
    return {
      ok: false,
      error: `python interpreter must be Aurora's bundled runtime: ${binaryPath}`,
    };
  }

  // Verilator-generated V<top>.exe under components/Temp/obj_dir_*/.
  if (
    normalized.startsWith(VERILATOR_GENERATED_PREFIX) &&
    /\/obj_dir[^/]*\/V[^/]+(\.exe)?$/.test(normalized)
  ) {
    return { ok: true };
  }

  // Static allowlist.
  for (const [allowedName, allowedDirs, dono] of RAW_ALLOWLIST) {
    if (baseName.toLowerCase() !== allowedName.toLowerCase()) continue;
    for (const sub of allowedDirs) {
      const expected = path.posix.join(toPosix(componentsPath), sub);
      // Case-insensitive on Windows, paths from electronAPI.joinPath
      // can vary in drive-letter casing depending on how the user
      // launched the app.
      if (dir.toLowerCase() === expected.toLowerCase()) {
        // O binario esta onde deveria. Falta saber se ele existe: desde que os
        // componentes passaram a ser baixados sob demanda, estar no lugar certo
        // e nao estar instalado sao coisas diferentes. Este e o unico ponto por
        // onde botao, API, IA e servidor de linguagem passam, entao barrar aqui
        // barra em todos, inclusive nos caminhos que ainda nao existem.
        if (!componentes.estaInstalado(dono)) {
          const mensagem = componentes.mensagemDeAusencia(dono);
          // Avisa a janela do MESMO ponto que barrou. Quem chamou continua
          // recebendo o erro abaixo; sao coisas diferentes, e as duas precisam
          // acontecer. Ver main/components/notify.js.
          require('../components/notify').anunciarAusencia(dono, mensagem);
          return {
            ok: false,
            motivo: 'componente-ausente',
            componente: dono,
            error: mensagem,
          };
        }
        return { ok: true };
      }
    }
    return {
      ok: false,
      error: `binary ${baseName} not in allowed directories (${allowedDirs.join(', ')}): ${binaryPath}`,
    };
  }

  return {
    ok: false,
    error: `binary not on toolchain allowlist: ${baseName} (${binaryPath})`,
  };
}

/** Read-only snapshot for diagnostics + AI listing tool. */
function listAllowedBinaries() {
  const staticRows = RAW_ALLOWLIST.map(([name, dirs]) => ({
    binary: name,
    allowedDirs: dirs.map((d) => path.posix.join(toPosix(componentsPath), d)),
  }));
  const bundledPython = getBundledPythonPath();
  const pythonRows = [{
    binary: path.basename(bundledPython),
    allowedDirs: [path.dirname(bundledPython)],
  }];
  return staticRows.concat(pythonRows);
}

/** O componente dono de um binario, pelo nome do arquivo. */
function donoDoBinario(baseName) {
  const alvo = String(baseName || '').toLowerCase();
  const achado = RAW_ALLOWLIST.find(([nome]) => nome.toLowerCase() === alvo);
  return achado ? achado[2] : null;
}

module.exports = { isAllowed, listAllowedBinaries, donoDoBinario, RAW_ALLOWLIST };
