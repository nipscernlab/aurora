import { electronAPI } from '../app/electron_api.js';
import { paraRelativo, candidatos } from '../project/caminho_de_projeto.js';
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

/**
 * Onde o estado de onda mora.
 *
 * ERA `testbench/`, e no Windows isso colidia com a pasta `Testbench/` que
 * muitos projetos tem para os `.v` de testbench: o sistema nao distingue a
 * caixa, entao o estado da IDE era escrito no meio do codigo-fonte do usuario
 * e ia junto para o git dele. Nos exemplos do repositorio da para ver os dois
 * lados na mesma pasta: `tb_dirac.v` ao lado de `tb_dirac.json`.
 *
 * Config de ferramenta pertence a `.aurora/`, que e a pasta que a AURORA ja
 * usa para o que e dela (execucoes, historico, temporarios).
 */
const STATE_DIRNAME = '.aurora/testbench';

/**
 * O lugar antigo, so para LER.
 *
 * Todo projeto que existe hoje tem o estado ali, e perde-lo significaria o
 * `.gtkw` escolhido, a selecao do Wave Configuration e a decisao sobre
 * `$dumpvars` voltarem ao zero sem ninguem pedir. A leitura cai aqui quando o
 * arquivo novo nao existe, e a proxima escrita ja grava no lugar novo: o
 * projeto se muda sozinho, sem etapa de migracao e sem apagar nada.
 */
const STATE_DIRNAME_LEGADO = 'testbench';

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

/** O caminho no lugar ANTIGO, para a leitura de projeto que ainda nao migrou. */
async function legacyStateFilePathFor(projectPath: string, tbKey: string): Promise<string> {
  const dir = await electronAPI.joinPath(projectPath, STATE_DIRNAME_LEGADO);
  return electronAPI.joinPath(dir, `${safeKey(tbKey)}.json`);
}

/**
 * O arquivo de estado a LER: o novo quando existe, senao o antigo.
 *
 * Devolve null quando nenhum dos dois existe, que e o caso do testbench ainda
 * nao registrado.
 */
async function arquivoDeEstadoParaLer(projectPath: string, tbKey: string): Promise<string | null> {
  const novo = await stateFilePathFor(projectPath, tbKey);
  if (await electronAPI.fileExists(novo)) return novo;
  const antigo = await legacyStateFilePathFor(projectPath, tbKey);
  if (await electronAPI.fileExists(antigo)) return antigo;
  return null;
}

/**
 * ESTE ARQUIVO VIAJA COM O PROJETO, e por isso nao pode guardar caminho
 * absoluto.
 *
 * Ele mora em `<projeto>/testbench/<tb>.json`, entao vai no pendrive junto com
 * o resto. Guardava `tbPath` e o caminho de cada `.gtkw` e de cada layout do
 * Surfer em ABSOLUTO, e foi assim que um aluno levou um projeto para outro
 * computador e a AURORA foi abrir o `.gtkw` pelo caminho da maquina de origem:
 * o arquivo estava ali, mas a letra de unidade e o nome do usuario nao viajaram.
 *
 * POR QUE SO AQUI, e nao no .spf tambem. O .spf ja guarda os arquivos em
 * caminho relativo, e o main ainda o RELOCALIZA ao abrir: `deepRemapPaths`
 * troca o prefixo da raiz antiga pela nova (main/ipc/project.js). So que aquele
 * remap percorre `projectData.structure` e nada mais, entao nunca chegou a
 * `<projeto>/testbench/*.json`. Era a unica lacuna, e era exatamente onde o
 * `.gtkw` morava.
 *
 * Agora GRAVA relativo quando o arquivo esta dentro do projeto, e ao LER
 * resolve contra a raiz de hoje. Caminho de fora do projeto continua absoluto,
 * porque relativo a algo que nao viaja com o projeto nao ajudaria ninguem.
 *
 * O RESGATE cobre o que ja esta gravado nos projetos por ai. Um absoluto que
 * nao existe mais pode ser o mesmo arquivo em outro lugar: tenta-se a cauda
 * dele dentro do projeto de hoje (js/project/caminho_de_projeto.ts). No caminho
 * comum custa um unico teste de existencia; as caudas so entram quando o
 * primeiro falha.
 *
 * NAO SE REGRAVA NO MEIO DA LEITURA, de proposito: `readRaw` roda dentro da
 * cadeia de escrita do `update`, e escrever dali seria reentrar nela. O arquivo
 * se conserta sozinho na proxima escrita, que e quando `writeRaw` relativiza.
 */

/** Os campos deste estado que sao caminho de arquivo. */
const CAMPOS_DE_CAMINHO = ['tbPath'] as const;
/** As listas cujos itens tem `.path`. */
const LISTAS_DE_CAMINHO = ['gtkwFiles', 'surferFiles'] as const;

/** O caminho de hoje para um gravado antes, tentando a cauda se preciso. */
async function resolverCaminho(projectPath: string, gravado: string): Promise<string> {
  const opcoes = candidatos(projectPath, gravado);
  if (!opcoes.length) return gravado;
  for (const tentativa of opcoes) {
    try {
      if (await electronAPI.fileExists(tentativa)) return tentativa;
    } catch (_) { /* sem resposta da ponte: tenta o proximo */ }
  }
  // Nenhum existe. Devolve o primeiro, que e a leitura normal: quem for usar
  // precisa de um caminho para poder dizer QUAL arquivo faltou.
  return opcoes[0];
}

/** Estado lido do disco com os caminhos resolvidos para esta maquina. */
async function comCaminhosResolvidos(projectPath: string, estado: any): Promise<any> {
  if (!projectPath || !estado) return estado;
  for (const campo of CAMPOS_DE_CAMINHO) {
    if (estado[campo]) estado[campo] = await resolverCaminho(projectPath, estado[campo]);
  }
  for (const lista of LISTAS_DE_CAMINHO) {
    if (!Array.isArray(estado[lista])) continue;
    for (const item of estado[lista]) {
      if (item && item.path) item.path = await resolverCaminho(projectPath, item.path);
    }
  }
  return estado;
}

/** Estado pronto para gravar: dentro do projeto vira relativo. */
function comCaminhosRelativos(projectPath: string, estado: any): any {
  const fora: any = { ...estado };
  for (const campo of CAMPOS_DE_CAMINHO) {
    if (fora[campo]) fora[campo] = paraRelativo(projectPath, fora[campo]);
  }
  for (const lista of LISTAS_DE_CAMINHO) {
    if (!Array.isArray(fora[lista])) continue;
    fora[lista] = fora[lista].map((item: any) => (item && item.path
      ? { ...item, path: paraRelativo(projectPath, item.path) }
      : item));
  }
  return fora;
}

async function readRaw(projectPath: string, tbKey: string): Promise<WaveState | null> {
  const filePath = await arquivoDeEstadoParaLer(projectPath, tbKey);
  if (!filePath) return null;
  try {
    const content = await electronAPI.readFile(filePath);
    const parsed = JSON.parse(content);
    return comCaminhosResolvidos(projectPath, { ...DEFAULTS, ...parsed }) as Promise<WaveState>;
  } catch (err) {
    console.warn(`wave state for ${tbKey} unparseable; treating as missing.`, err);
    return null;
  }
}

async function writeRaw(projectPath: string, tbKey: string, state: WaveState): Promise<void> {
  const dir = await stateDirFor(projectPath);
  await electronAPI.mkdir(dir);
  const filePath = await stateFilePathFor(projectPath, tbKey);
  await electronAPI.writeFile(
    filePath,
    JSON.stringify(comCaminhosRelativos(projectPath, state), null, 2),
  );
}

function chainKey(projectPath: string, tbKey: string): string {
  return `${projectPath}::${safeKey(tbKey)}`;
}

export const WaveStore = {
  STATE_DIRNAME,
  STATE_DIRNAME_LEGADO,
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
