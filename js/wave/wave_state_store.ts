import { electronAPI } from '../app/electron_api.js';
/**
 * wave_state_store.ts: Per-testbench wave-flow state.
 *
 * Cada testbench do projeto tem seu proprio escopo isolado pra:
 *   - lista de .gtkw registrados (com selecao ativa)
 *   - selecao Wave Configuration (waveSignals + flags wcInitialized/wcCustomized)
 *   - memoria do estado inicial: tinha `$dumpvars` hand-written na 1a visita?
 *
 * Storage: um JSON por testbench em `<project>/testbench/<tbKey>.json`.
 * Dentro do projeto pra nao misturar com outros projetos que tenham
 * testbenches com o mesmo nome de arquivo.
 *
 * `tbKey` = nome do .v sem extensao (e.g. `top_level_tb`). Vivem todos
 * juntos na pasta `testbench/` na raiz do projeto.
 *
 * API espelha `SpfStore`, `read` puro, `update` atomico via
 * promise chain serializada per-(projectPath, tbKey).
 *
 * Compilado por `tsc` (npm run build:ts) num wave_state_store.js ao lado, é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 */

/** Persisted per-testbench wave state. */
export interface WaveState {
  tbPath: string;
  tbModule: string;
  hadOriginalDumpvars: boolean;
  gtkwFiles: Array<Record<string, unknown>>;
  surferFiles: Array<Record<string, unknown>>;
  waveSignals: string[];
  wcInitialized: boolean;
  wcCustomized: boolean;
}

const STATE_DIRNAME = 'testbench';

// In-flight promise per (projectPath + tbKey). Updates para um mesmo
// testbench serializam; updates para tbs diferentes (mesmo projeto)
// rodam concorrentemente.
const writeChainByKey = new Map<string, Promise<unknown>>();

const DEFAULTS: WaveState = Object.freeze({
  // Path absoluto do .v de testbench que esse estado representa. Util
  // pra recuperar o tb mesmo se renomearem o arquivo (ainda nao tem
  // logica pra isso, mas o campo persiste).
  tbPath: '',
  // Nome do module verilog (= filename sem .v, e tambem o tbKey).
  tbModule: '',
  // Snapshot da 1a visita: o testbench original tinha $dumpfile/$dumpvars
  // hand-written? Determina se o Aurora deve instrumentar ou ceder o
  // controle. NAO muda mais depois do registro inicial, se o usuario
  // edita o testbench, a re-instrumentacao do botao wave continua
  // baseada nessa decisao original.
  hadOriginalDumpvars: false,
  // .gtkw registrados via dropdown da toolbar (gtkw_picker). Um entry
  // com `isActive: true` e o ativo, varredura pra extrair $dumpvars
  // sai dele.
  gtkwFiles: [],
  // Layouts do Surfer (.surf.ron state / .sucl comandos) registrados pelo
  // mesmo picker quando o viewer e 'surfer'. Mesma forma que gtkwFiles; o
  // entry isActive vira o -s/-c no launch do Surfer.
  surferFiles: [],
  // Selecao Wave Configuration. Paths dotted ("tb.dut.q"), validados
  // contra a hierarquia do source na hora de abrir o WC.
  waveSignals: [],
  // O usuario ja abriu o modal Wave Configuration pra esse tb pelo
  // menos uma vez? Se sim, waveSignals e canonico (mesmo se igual ao
  // default).
  wcInitialized: false,
  // O usuario alterou a selecao no modal (= a selecao salva difere
  // do default). Quando true, o WC vence a heuristica do tb com
  // $dumpvars hand-written.
  wcCustomized: false,
});

function safeKey(tbKey: string): string {
  // Defensivo contra path traversal, keys vem do filename do .v, mas
  // se algo escapar, nao queremos escrever fora do testbench/.
  return String(tbKey).replace(/[\\/]/g, '_').replace(/\.\./g, '_');
}

async function stateDirFor(projectPath: string): Promise<string> {
  return electronAPI.joinPath(projectPath, STATE_DIRNAME);
}

async function stateFilePathFor(projectPath: string, tbKey: string): Promise<string> {
  const dir = await stateDirFor(projectPath);
  return electronAPI.joinPath(dir, `${safeKey(tbKey)}.json`);
}

async function readRaw(projectPath: string, tbKey: string): Promise<WaveState | null> {
  const filePath = await stateFilePathFor(projectPath, tbKey);
  const exists = await electronAPI.fileExists(filePath);
  if (!exists) return null;
  try {
    const content = await electronAPI.readFile(filePath);
    const parsed = JSON.parse(content);
    return { ...DEFAULTS, ...parsed } as WaveState;
  } catch (err) {
    console.warn(`wave state for ${tbKey} unparseable; treating as missing.`, err);
    return null;
  }
}

async function writeRaw(projectPath: string, tbKey: string, state: WaveState): Promise<void> {
  const dir = await stateDirFor(projectPath);
  await electronAPI.mkdir(dir);
  const filePath = await stateFilePathFor(projectPath, tbKey);
  await electronAPI.writeFile(filePath, JSON.stringify(state, null, 2));
}

function chainKey(projectPath: string, tbKey: string): string {
  return `${projectPath}::${safeKey(tbKey)}`;
}

export const WaveStore = {
  STATE_DIRNAME,
  DEFAULTS,

  /**
   * Returns the state for a testbench, or null if unregistered (no
   * file on disk). Read-only, does not touch the write chain.
   *
   * @param tbKey  filename do .v sem extensao
   */
  get(projectPath: string, tbKey: string): Promise<WaveState | null> {
    return readRaw(projectPath, tbKey);
  },

  /**
   * Returns the state for a testbench, applying DEFAULTS if it doesn't
   * exist yet. Does NOT persist, useful para leitura defensiva.
   */
  async read(projectPath: string, tbKey: string): Promise<WaveState> {
    const state = await readRaw(projectPath, tbKey);
    return state ?? { ...DEFAULTS, tbModule: tbKey };
  },

  /**
   * Registers a testbench if missing. Idempotent, re-registrar nao
   * sobrescreve hadOriginalDumpvars nem o resto do estado salvo.
   *
   * @param initial  campos pra setar quando o registro nao existir ainda
   *      (tbPath, tbModule, hadOriginalDumpvars, etc).
   * @returns o estado final apos garantir o registro.
   */
  async ensureRegistered(projectPath: string, tbKey: string, initial: Partial<WaveState> = {}): Promise<WaveState> {
    const existing = await readRaw(projectPath, tbKey);
    if (existing) return existing;
    return WaveStore.update(projectPath, tbKey, (cfg) => {
      Object.assign(cfg, initial);
    });
  },

  /**
   * Atomic read-mutate-write. Updates pro mesmo (projectPath, tbKey)
   * serializam; updates pra tbs distintos correm em paralelo.
   *
   * Se o arquivo nao existir, comeca a partir de DEFAULTS (cria o
   * registro). Sempre escreve, mesmo se o mutator nao alterar nada:
   * comportamento previsivel pra callers.
   *
   * @returns o estado apos a escrita.
   */
  update(projectPath: string, tbKey: string, mutator: (cfg: WaveState) => void | Promise<void>): Promise<WaveState> {
    const key = chainKey(projectPath, tbKey);
    const prev = writeChainByKey.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      const current = (await readRaw(projectPath, tbKey)) ?? { ...DEFAULTS, tbModule: tbKey };
      await mutator(current);
      await writeRaw(projectPath, tbKey, current);
      return current;
    });
    writeChainByKey.set(key, next.catch(() => {}));
    return next;
  },

  /**
   * Returns an array of `{ tbKey, state }` for every registered tb in
   * the project. Order: alfabetica por tbKey.
   */
  async list(projectPath: string): Promise<Array<{ tbKey: string; state: WaveState }>> {
    const dir = await stateDirFor(projectPath);
    const exists = await electronAPI.fileExists(dir);
    if (!exists) return [];
    const entries = await electronAPI.listFilesInDirectory(dir);
    if (!Array.isArray(entries)) return [];
    const out: Array<{ tbKey: string; state: WaveState }> = [];
    for (const name of entries.sort()) {
      if (!name.endsWith('.json')) continue;
      const tbKey = name.slice(0, -'.json'.length);
      const state = await readRaw(projectPath, tbKey);
      if (state) out.push({ tbKey, state });
    }
    return out;
  },
};

if (typeof window !== 'undefined') {
  // Exposed for non-module callers, mirroring SpfStore.
  window.WaveStore = WaveStore;
}
