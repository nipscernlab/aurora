/**
 * project_config_store.js — Single writer pra projectOriented.json.
 *
 * Escritores hoje:
 *   - VerilogModeManager (file tree picker): synthesizableFiles,
 *     testbenchFiles, topLevelFile, testbenchFile
 *
 * Estado especifico de wave-flow (gtkwFiles, waveSignals,
 * wcInitialized/wcCustomized) NAO vive aqui — fica per-testbench no
 * WaveStore (`<project>/testbench/<tbKey>.json`). Ver
 * js/wave/wave_state_store.js.
 *
 * Historicamente cada manager fazia seu proprio ciclo
 * read-mutate-write no arquivo. Isso abriu duas classes de bug:
 *   1. Race: se dois escreviam concorrentemente, o segundo lia um
 *      snapshot stale e clobrava as mudancas do primeiro mesmo em
 *      campos disjuntos.
 *   2. Escritores que reescreviam tudo (era o caso do antigo modal
 *      Project Settings) apagavam campos novos adicionados por
 *      outros escritores.
 *
 * Este store resolve (1) serializando updates per-project-path numa
 * promise chain. Resolve (2) expondo so `update(projectPath, mutator)`
 * — callers mutam os campos que possuem na config em memoria, e
 * campos nao-tocados sobrevivem ao round trip.
 *
 * Defaults sao mergeados na leitura, entao uma config nova (arquivo
 * faltando ou parcial) sempre chega num shape conhecido — sem
 * `undefined`/`NaN` vazando pra consumidores downstream.
 */

const CONFIG_FILENAME = 'projectOriented.json';

// In-flight promise per project path. Updates are queued onto this so
// concurrent calls serialize cleanly. Cleared by .catch() so a failed
// write doesn't poison subsequent calls.
const writeChainByPath = new Map();

const DEFAULTS = Object.freeze({
  // Topo do design — marcado pelo usuario via context menu na file
  // tree. Iverilog usa como -s no botao Verilog/PRISM (modo check).
  topLevelFile: '',
  // Testbench-topo — idem, mas e o -s do botao Wave (modo simulacao).
  testbenchFile: '',
  // Arquivos .v sinteticaveis (incluindo .v dos processadores).
  // Populados pela auto-descoberta + drag-and-drop no file tree.
  synthesizableFiles: [],
  // Arquivos .v de testbench.
  testbenchFiles: [],
  // Processadores configurados. Pos-fase 4, customizacao
  // per-processador (cmmFile/clk/numClocks) saiu — esses campos
  // viraram defaults hardcoded em precompileAllProcessors. Aqui resta
  // {name, type, instance} usado por compilation_flow.collectProcessors.
  processors: [],
  // Flags adicionais pra iverilog (sem UI hoje — sempre '').
  iverilogFlags: '',
  // Delay base do testbench instrumentado (sem UI hoje).
  simuDelay: '200000',
  // Toggle pra visualizar arrays C± no GTKWave (sem UI hoje).
  showArraysInGtkwave: 0,
});

async function configPathFor(projectPath) {
  return window.electronAPI.joinPath(projectPath, CONFIG_FILENAME);
}

async function readRaw(projectPath) {
  const configPath = await configPathFor(projectPath);
  const exists = await window.electronAPI.fileExists(configPath);
  if (!exists) {
    return { ...DEFAULTS };
  }
  try {
    const content = await window.electronAPI.readFile(configPath);
    const parsed = JSON.parse(content);
    // Defaults first, then on-disk values — keeps unknown keys (a future
    // writer's field, for example) but fills in anything missing.
    return { ...DEFAULTS, ...parsed };
  } catch (err) {
    console.warn('projectOriented.json could not be parsed; falling back to defaults.', err);
    return { ...DEFAULTS };
  }
}

async function writeRaw(projectPath, config) {
  const configPath = await configPathFor(projectPath);
  await window.electronAPI.writeFile(configPath, JSON.stringify(config, null, 2));
}

export const ProjectConfigStore = {
  CONFIG_FILENAME,
  DEFAULTS,

  /**
   * Read the on-disk config (or DEFAULTS if missing/unparseable).
   * Read-only — does not affect the write queue.
   */
  read(projectPath) {
    return readRaw(projectPath);
  },

  /**
   * Atomic read-mutate-write. The mutator receives the current config
   * (as returned by `read`) and is expected to mutate it in place
   * (assigning to its fields). Returns the resulting config after write.
   *
   * Updates for the same projectPath serialize in arrival order. Updates
   * for different paths run concurrently.
   *
   * @param {string} projectPath
   * @param {(cfg: object) => void | Promise<void>} mutator
   */
  update(projectPath, mutator) {
    const prev = writeChainByPath.get(projectPath) ?? Promise.resolve();
    const next = prev.then(async () => {
      const current = await readRaw(projectPath);
      await mutator(current);
      await writeRaw(projectPath, current);
      return current;
    });
    // Keep the chain alive on failure so the next caller doesn't
    // inherit a rejected promise; the original failure already
    // propagated to its caller via the returned `next`.
    writeChainByPath.set(projectPath, next.catch(() => {}));
    return next;
  },
};

if (typeof window !== 'undefined') {
  // Exposed for non-module callers (mainly the legacy
  // `window.verilogTreeManager` wiring). New code should import.
  window.ProjectConfigStore = ProjectConfigStore;
}
