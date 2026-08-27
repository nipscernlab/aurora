import { electronAPI } from '../app/electron_api.js';
/**
 * spf_store.ts: Single writer pra <project>.spf (renderer-side).
 *
 * O .spf consolida todo o config canonico do projeto: lifecycle
 * metadata (escrito pelo main process em open/create-processor/
 * delete-processor) + structure (file lists, top-level, testbench
 * top, flags do iverilog). Pre-2026-05, parte disso vivia em
 * projectOriented.json: consolidado aqui pra ter um arquivo unico
 * de config per-project.
 *
 * Estado per-testbench (gtkwFiles, waveSignals, wcInitialized/
 * wcCustomized) continua fora, fica em <project>/testbench/
 * <tbKey>.json via wave_state_store.js. Granularidade per-tb
 * justifica arquivo separado.
 *
 * Race teorica com escrita do main process (open/create-processor/
 * delete-processor reescrevem o .spf): esses sao eventos UI
 * sequenciais, nao concorrem com edicoes da tree.
 *
 * API espelha o antigo ProjectConfigStore: `read` puro, `update`
 * atomico via promise chain serializada per-spfPath. O mutator
 * recebe so o `structure`, `metadata` e preservado e tem
 * `lastModified` carimbado a cada write.
 *
 * Compilado por `tsc` (npm run build:ts) num spf_store.js ao lado, é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 */

/** A file entry in synthesizableFiles/testbenchFiles. */
interface FileEntry {
  path?: string;
  [key: string]: unknown;
}
/** A processor entry, `{ name }`, params live in the .cmm. */
interface ProcessorEntry {
  name?: string;
  [key: string]: unknown;
}
/** The `structure` half of a .spf: file lists, top-level, testbench, flags. */
export interface SpfStructure {
  basePath: string;
  folders: unknown[];
  processors: ProcessorEntry[];
  topLevelFile: string;
  testbenchFile: string;
  synthesizableFiles: FileEntry[];
  testbenchFiles: FileEntry[];
  // Unknown keys survive the round trip (defaults first, on-disk second).
  [key: string]: unknown;
}
/** The `metadata` half, written by the main process lifecycle. */
interface SpfMetadata {
  projectName?: string;
  lastModified?: string;
  appVersion?: string;
  [key: string]: unknown;
}
/** A full parsed .spf document. */
export interface SpfDocument {
  metadata: SpfMetadata;
  structure: SpfStructure;
}

// ----------------------------------------------------------------------------
// Path normalization (relative-in-disk, absolute-in-memory)
// ----------------------------------------------------------------------------
// O .spf grava paths RELATIVOS ao basePath quando o arquivo esta dentro do
// projeto, e ABSOLUTOS quando esta fora. Tudo que e exposto pra fora do
// SpfStore (via read/update mutator) e SEMPRE absoluto, caller nao precisa
// saber dessa normalizacao. Backward-compat: .spf antigos com paths absolutos
// continuam lendo (isAbsolutePath bypassa o resolve); o primeiro save migra
// pros relativos automaticamente.
//
// Por que nao usar electronAPI.dirname (IPC): sync helper local evita o
// round-trip em cada read/update. Aurora ja faz dirname assim em outros
// lugares (file_mode.js, status_bar.js).

/** True pra paths Windows (C:\, \\server\) e POSIX (/). */
function isAbsolutePath(p: unknown): boolean {
    if (typeof p !== 'string' || !p) return false;
    return /^([a-zA-Z]:[\\/]|[\\/]{2}|\/)/.test(p);
}

/** dirname local, split em \ ou /, sem IPC. */
function localDirname(p: unknown): string {
    if (typeof p !== 'string') return '';
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return i === -1 ? '' : p.slice(0, i);
}

/**
 * Se `absPath` esta dentro de `baseDir`, retorna o relativo (sem `./`
 * prefixo). Senao, retorna o absoluto intacto. Case-insensitive na
 * comparacao (Windows). Preserva o casing original do path.
 */
function toRelativeIfInside(absPath: string, baseDir: string): string {
    if (!absPath || !baseDir || !isAbsolutePath(absPath)) return absPath;
    // Normaliza separadores e compara case-insensitive (idioma Windows).
    const normalizedAbs = absPath.replace(/\//g, '\\');
    const normalizedBase = baseDir.replace(/\//g, '\\').replace(/\\+$/, '');
    const baseWithSep = (normalizedBase + '\\').toLowerCase();
    if (!normalizedAbs.toLowerCase().startsWith(baseWithSep)) return absPath;
    return normalizedAbs.slice(normalizedBase.length + 1);
}

/**
 * Se `maybeRel` ja e absoluto, retorna como esta. Se for relativo,
 * junta com `baseDir`. Sem baseDir, retorna o input inalterado
 * (so vai acontecer em .spf orfaos sem basePath e sem dir do .spf).
 */
function toAbsoluteFromBase(maybeRel: string, baseDir: string): string {
    if (!maybeRel || isAbsolutePath(maybeRel)) return maybeRel;
    if (!baseDir) return maybeRel;
    const cleanBase = baseDir.replace(/[\\/]+$/, '');
    const sep = cleanBase.includes('\\') ? '\\' : '/';
    return cleanBase + sep + maybeRel.replace(/^[\\/]+/, '');
}

const PATH_FIELDS_SCALAR = ['topLevelFile', 'testbenchFile'] as const;
const PATH_FIELDS_ARRAY  = ['synthesizableFiles', 'testbenchFiles'] as const;

/** In-place: converte paths relativos do structure pra absolutos. */
function expandStructurePaths(structure: SpfStructure | null | undefined, baseDir: string): void {
    if (!structure || !baseDir) return;
    for (const k of PATH_FIELDS_SCALAR) {
        if (structure[k]) structure[k] = toAbsoluteFromBase(structure[k], baseDir);
    }
    for (const k of PATH_FIELDS_ARRAY) {
        const arr = structure[k];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
            if (entry && entry.path) entry.path = toAbsoluteFromBase(entry.path, baseDir);
        }
    }
}

/** Retorna copia profunda do structure com paths absolutos dentro de baseDir convertidos pra relativos. */
function contractStructurePaths(structure: SpfStructure, baseDir: string): SpfStructure {
    const cloned: SpfStructure = JSON.parse(JSON.stringify(structure));
    if (!baseDir) return cloned;
    for (const k of PATH_FIELDS_SCALAR) {
        if (cloned[k]) cloned[k] = toRelativeIfInside(cloned[k], baseDir);
    }
    for (const k of PATH_FIELDS_ARRAY) {
        const arr = cloned[k];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
            if (entry && entry.path) entry.path = toRelativeIfInside(entry.path, baseDir);
        }
    }
    return cloned;
}

/** basePath do structure ou dir do .spf (fallback). */
function resolveBaseDir(structure: SpfStructure | null | undefined, spfPath: string): string {
    return structure?.basePath || localDirname(spfPath) || '';
}

const writeChainByPath = new Map<string, Promise<unknown>>();
// Read coalescing: se varias chamadas read(spfPath) chegam no mesmo
// tick, todas compartilham a mesma promise em vez de cada uma rodar
// readFile independente. Map e limpa quando a promise settled, entao
// o proximo tick le do disco de novo (sem cache atravessando ticks,
// nada de mtime stale). Soluciona o cenario "evento dispara 6
// consumidores que cada um chama SpfStore.read", varia de 6 disk
// reads pra 1.
const inFlightReads = new Map<string, Promise<SpfDocument>>();

const STRUCTURE_DEFAULTS: SpfStructure = Object.freeze({
  // Caminho absoluto do diretorio do projeto. Reconciliado pelo
  // main em open-spf-project se o .spf foi movido.
  basePath: '',
  // Subpastas registradas pela UI (criadas via "New Folder" no tree).
  folders: [],
  // Processadores SAPHO conhecidos do projeto. Cada entry e `{ name }`
  //, os parametros (nBits/nbMantissa/etc) ficam no .cmm do processador,
  // que e a fonte canonica pro pipeline. `exists` pode ser anexado
  // dinamicamente no main em open-spf-project mas nao tem leitor.
  processors: [],
  // Top do design, `-s` do iverilog no botao Verilog/PRISM
  // (modo check). Marcado via context menu na file tree.
  topLevelFile: '',
  // Testbench-topo, `-s` do botao Wave (modo simulacao).
  testbenchFile: '',
  // Arquivos .v sinteticaveis (inclui os .v dos processadores).
  // Populados pela auto-descoberta + drag-and-drop no file tree.
  synthesizableFiles: [],
  // Arquivos .v de testbench.
  testbenchFiles: [],
});

// Strip // and /* */ comments that sit OUTSIDE of strings, leaves string
// contents (including URLs with //) untouched.
function stripJsonComments(s: string): string {
  let out = '';
  let inStr = false;
  let strCh = '';
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (c === '\\') { out += s[i + 1] ?? ''; i++; } else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; strCh = c; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

/**
 * Parse .spf content. A .spf is JSON, but real files in the wild pick up a BOM,
 * trailing commas or stray comments (hand-edits, other tools, partial writes).
 * Strict JSON first; on failure, one lenient pass (BOM + comments + trailing
 * commas) so a RECOVERABLE file isn't silently reset to defaults. Still throws
 * if genuinely unparseable, the caller logs + falls back.
 */
function parseSpfTolerant(content: string): any {
  try {
    return JSON.parse(content);
  } catch (_strictErr) {
    const cleaned = stripJsonComments(content)
      .replace(/^\s+/, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  }
}

async function readRawUncached(spfPath: string): Promise<SpfDocument> {
  const exists = await electronAPI.fileExists(spfPath);
  if (!exists) {
    return {
      metadata: {},
      structure: { ...STRUCTURE_DEFAULTS },
    };
  }
  try {
    const content = await electronAPI.readFile(spfPath);
    const parsed = parseSpfTolerant(content);
    // Defaults first, on-disk values second, unknown keys
    // sobrevivem ao round trip.
    const structure: SpfStructure = { ...STRUCTURE_DEFAULTS, ...(parsed.structure ?? {}) };
    // Paths no disco podem ser relativos (formato novo) ou absolutos
    // (formato antigo / fora do basePath). Expande pra absoluto antes
    // de devolver, caller sempre trabalha com absoluto.
    expandStructurePaths(structure, resolveBaseDir(structure, spfPath));
    return {
      metadata: parsed.metadata ?? {},
      structure,
    };
  } catch (err) {
    console.warn('.spf could not be parsed; falling back to defaults.', err);
    return {
      metadata: {},
      structure: { ...STRUCTURE_DEFAULTS },
    };
  }
}

function readRaw(spfPath: string): Promise<SpfDocument> {
  // Coalesce reads em vooo: o segundo caller no mesmo tick recebe
  // exatamente a mesma promise, sem fanout de readFile/JSON.parse.
  // Ver comentario no `inFlightReads` la em cima.
  const inFlight = inFlightReads.get(spfPath);
  if (inFlight) return inFlight;
  const promise = readRawUncached(spfPath).finally(() => {
    if (inFlightReads.get(spfPath) === promise) {
      inFlightReads.delete(spfPath);
    }
  });
  inFlightReads.set(spfPath, promise);
  return promise;
}

async function writeRaw(spfPath: string, fullDoc: SpfDocument): Promise<void> {
  await electronAPI.writeFile(spfPath, JSON.stringify(fullDoc, null, 2));
}

export const SpfStore = {
  STRUCTURE_DEFAULTS,

  /**
   * Read structure do .spf (ou STRUCTURE_DEFAULTS se missing/
   * unparseable). Read-only, nao afeta o write queue.
   */
  async read(spfPath: string): Promise<SpfStructure> {
    const doc = await readRaw(spfPath);
    return doc.structure;
  },

  /**
   * Read .spf inteiro (metadata + structure). Util pra consumidores
   * que querem metadata (projectName, lastModified, appVersion).
   */
  async readFull(spfPath: string): Promise<SpfDocument> {
    return readRaw(spfPath);
  },

  /**
   * Atomic read-mutate-write em structure. Mutator recebe structure
   * (com defaults aplicados); metadata e preservado e tem
   * `lastModified` carimbado.
   *
   * Updates pro mesmo spfPath serializam em ordem de chegada.
   */
  update(spfPath: string, mutator: (structure: SpfStructure) => void | Promise<void>): Promise<SpfStructure> {
    const prev = writeChainByPath.get(spfPath) ?? Promise.resolve();
    const next = prev.then(async () => {
      // Update sempre le do disco (nao do cache in-flight) pra que
      // duas update() consecutivas no mesmo tick nao operem ambas
      // sobre o snapshot pre-primeira-escrita. O writeChain ja
      // serializa, entao pular o coalescing aqui nao introduz race.
      const doc = await readRawUncached(spfPath);
      // Snapshot do structure ANTES do mutator pra comparacao
      // pos-write. Sem isso, qualquer chamada de update, mesmo
      // no-op (ex: saveConfiguration interno depois de um load que
      // nao reclassificou nada), dispararia aurora:spf-changed e
      // causaria loop de refresh. Comparamos so o structure;
      // metadata.lastModified muda em toda escrita e nao queremos
      // que isso conte como mudanca semantica.
      const beforeStruct = JSON.stringify(doc.structure);
      await mutator(doc.structure);
      const afterStruct = JSON.stringify(doc.structure);
      // Grava paths relativos quando estao dentro do basePath; absolutos
      // ficam absolutos. Caller continua trabalhando com absoluto no
      // doc.structure em memoria, so o que vai pro disco e normalizado.
      const stored = contractStructurePaths(doc.structure, resolveBaseDir(doc.structure, spfPath));
      const updated: SpfDocument = {
        metadata: { ...doc.metadata, lastModified: new Date().toISOString() },
        structure: stored,
      };
      await writeRaw(spfPath, updated);
      // Notifica subscribers (status_bar, processor_config_panel,
      // file_mode, etc) que o .spf mudou, hook unificado pra que
      // futuro codigo nao precise escutar N eventos IPC diferentes
      // pra detectar "o spf foi reescrito". SO dispara quando o
      // structure realmente mudou: mutators no-op nao geram
      // refresh, eliminando a classe de loops "save → event →
      // refresh → load → save (no-op) → event → ..."
      if (beforeStruct !== afterStruct && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aurora:spf-changed', {
          detail: { spfPath, source: 'renderer' },
        }));
      }
      return doc.structure;
    });
    writeChainByPath.set(spfPath, next.catch(() => {}));
    return next;
  },
};

if (typeof window !== 'undefined') {
  window.SpfStore = SpfStore;
}
