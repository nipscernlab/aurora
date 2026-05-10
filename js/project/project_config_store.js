/**
 * project_config_store.js — Single writer for projectOriented.json.
 *
 * Two managers used to do their own read-mutate-write cycles on
 * projectOriented.json independently:
 *
 *   - VerilogModeManager.saveConfiguration: rewrote synthesizableFiles,
 *     testbenchFiles, topLevelFile, testbenchFile based on the picker
 *     state.
 *   - ProjectOrientedManager.saveConfiguration: rewrote the entire config
 *     from the Project Settings modal form, OVERWRITING anything the
 *     verilog manager had just written.
 *
 * Two open issues fell out of that:
 *   1. Race: if both wrote concurrently, the later writer's "current
 *      config" snapshot was stale, so it clobbered the earlier write's
 *      changes — even on disjoint fields.
 *   2. The project modal wholesale-overwrote, so any field a future
 *      writer might add (or that someone edited via another path)
 *      vanished on save.
 *
 * This store fixes (1) by serializing all updates per project-path
 * through a promise chain. It fixes (2) by exposing only an
 * `update(projectPath, mutator)` API: callers mutate the fields they own
 * on the in-memory object, and untouched fields survive the round trip.
 *
 * Defaults are merged on read, so a fresh config (file missing or
 * partial) lands at a known shape — no `undefined`/`NaN` leakage into
 * downstream consumers that didn't think about that case.
 */

const CONFIG_FILENAME = 'projectOriented.json';

// In-flight promise per project path. Updates are queued onto this so
// concurrent calls serialize cleanly. Cleared by .catch() so a failed
// write doesn't poison subsequent calls.
const writeChainByPath = new Map();

const DEFAULTS = Object.freeze({
  topLevelFile: '',
  testbenchFile: '',
  gtkwaveFile: '',
  synthesizableFiles: [],
  testbenchFiles: [],
  gtkwFiles: [],
  processors: [],
  iverilogFlags: '',
  simuDelay: '200000',
  showArraysInGtkwave: 0,
  // Wave Configuration picker — list of dotted scope paths
  // ("tb_counter.dut.q") that should land in $dumpvars and the
  // auto-generated .gtkw. Empty = use the default of "everything at
  // the testbench module scope".
  waveSignals: [],
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
  // Exposed for non-module callers (mainly the legacy global
  // `window.verilogTreeManager` and `window.processorConfigManager`
  // wirings used elsewhere). New code should import.
  window.ProjectConfigStore = ProjectConfigStore;
}
