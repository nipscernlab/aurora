/**
 * spf_store.js — Single writer pra <project>.spf (renderer-side).
 *
 * O .spf consolida todo o config canonico do projeto: lifecycle
 * metadata (escrito pelo main process em open/create-processor/
 * delete-processor) + structure (file lists, top-level, testbench
 * top, flags do iverilog). Pre-2026-05, parte disso vivia em
 * projectOriented.json — consolidado aqui pra ter um arquivo unico
 * de config per-project.
 *
 * Estado per-testbench (gtkwFiles, waveSignals, wcInitialized/
 * wcCustomized) continua fora — fica em <project>/testbench/
 * <tbKey>.json via wave_state_store.js. Granularidade per-tb
 * justifica arquivo separado.
 *
 * Race teorica com escrita do main process (open/create-processor/
 * delete-processor reescrevem o .spf): esses sao eventos UI
 * sequenciais, nao concorrem com edicoes da tree.
 *
 * API espelha o antigo ProjectConfigStore: `read` puro, `update`
 * atomico via promise chain serializada per-spfPath. O mutator
 * recebe so o `structure` — `metadata` e preservado e tem
 * `lastModified` carimbado a cada write.
 */

const writeChainByPath = new Map();

const STRUCTURE_DEFAULTS = Object.freeze({
  // Caminho absoluto do diretorio do projeto. Reconciliado pelo
  // main em open-spf-project se o .spf foi movido.
  basePath: '',
  // Subpastas registradas pela UI (criadas via "New Folder" no tree).
  folders: [],
  // Processadores SAPHO conhecidos do projeto. Cada entry e `{ name }`
  // — os parametros (nBits/nbMantissa/etc) ficam no .cmm do processador,
  // que e a fonte canonica pro pipeline. `exists` pode ser anexado
  // dinamicamente no main em open-spf-project mas nao tem leitor.
  processors: [],
  // Top do design — `-s` do iverilog no botao Verilog/PRISM
  // (modo check). Marcado via context menu na file tree.
  topLevelFile: '',
  // Testbench-topo — `-s` do botao Wave (modo simulacao).
  testbenchFile: '',
  // Arquivos .v sinteticaveis (inclui os .v dos processadores).
  // Populados pela auto-descoberta + drag-and-drop no file tree.
  synthesizableFiles: [],
  // Arquivos .v de testbench.
  testbenchFiles: [],
});

async function readRaw(spfPath) {
  const exists = await window.electronAPI.fileExists(spfPath);
  if (!exists) {
    return {
      metadata: {},
      structure: { ...STRUCTURE_DEFAULTS },
    };
  }
  try {
    const content = await window.electronAPI.readFile(spfPath);
    const parsed = JSON.parse(content);
    return {
      metadata: parsed.metadata ?? {},
      // Defaults first, on-disk values second — unknown keys
      // sobrevivem ao round trip.
      structure: { ...STRUCTURE_DEFAULTS, ...(parsed.structure ?? {}) },
    };
  } catch (err) {
    console.warn('.spf could not be parsed; falling back to defaults.', err);
    return {
      metadata: {},
      structure: { ...STRUCTURE_DEFAULTS },
    };
  }
}

async function writeRaw(spfPath, fullDoc) {
  await window.electronAPI.writeFile(spfPath, JSON.stringify(fullDoc, null, 2));
}

export const SpfStore = {
  STRUCTURE_DEFAULTS,

  /**
   * Read structure do .spf (ou STRUCTURE_DEFAULTS se missing/
   * unparseable). Read-only — nao afeta o write queue.
   */
  async read(spfPath) {
    const doc = await readRaw(spfPath);
    return doc.structure;
  },

  /**
   * Read .spf inteiro (metadata + structure). Util pra consumidores
   * que querem metadata (projectName, lastModified, appVersion).
   */
  async readFull(spfPath) {
    return readRaw(spfPath);
  },

  /**
   * Atomic read-mutate-write em structure. Mutator recebe structure
   * (com defaults aplicados); metadata e preservado e tem
   * `lastModified` carimbado.
   *
   * Updates pro mesmo spfPath serializam em ordem de chegada.
   *
   * @param {string} spfPath
   * @param {(structure: object) => void | Promise<void>} mutator
   */
  update(spfPath, mutator) {
    const prev = writeChainByPath.get(spfPath) ?? Promise.resolve();
    const next = prev.then(async () => {
      const doc = await readRaw(spfPath);
      await mutator(doc.structure);
      const updated = {
        metadata: { ...doc.metadata, lastModified: new Date().toISOString() },
        structure: doc.structure,
      };
      await writeRaw(spfPath, updated);
      return doc.structure;
    });
    writeChainByPath.set(spfPath, next.catch(() => {}));
    return next;
  },
};

if (typeof window !== 'undefined') {
  window.SpfStore = SpfStore;
}
