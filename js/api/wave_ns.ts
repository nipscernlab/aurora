/**
 * wave_ns.ts: o namespace `AuroraAPI.wave`, a selecao de sinais, o simulador,
 * o visualizador e os layouts de onda (.gtkw do GTKWave, .surf.ron/.sucl do
 * Surfer) do testbench ativo.
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), como o prism_ns e o
 * examples_ns. Duas coisas mudaram na saida, o resto e o mesmo codigo:
 *
 *   - O projeto, o .spf e o estado das ondas vem do ProjectStore, do SpfStore
 *     e do WaveStore importados, e nao de window.
 *   - Os layouts do GTKWave e do Surfer eram dois blocos de seis metodos
 *     copiados um do outro, diferentes so na extensao, no campo do WaveStore
 *     e nas mensagens. Agora e uma implementacao so, parametrizada pelo
 *     `TipoDeLayout`; as mensagens continuam as mesmas, palavra por palavra,
 *     porque a IA e os testes as leem.
 *
 * Compilado por `tsc` (npm run build:ts) num wave_ns.js ao lado, e esse .js
 * que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { WaveStore } from '../wave/wave_state_store.js';
import { resolveWaveToolchain } from '../compilation/wave_toolchain.js';
import { getSimulator as getWaveSimulator, setSimulator as setWaveSimulator } from '../wave/simulator_preference.js';
import { getViewer as getWaveViewer, setViewer as setWaveViewer } from '../wave/viewer_preference.js';
import { getSurferMultiWindow, setSurferMultiWindow } from '../wave/surfer_window_preference.js';
import { flattenSignalPaths } from '../wave/signal_parser.js';
import { buildCustomGtkw } from '../wave/gtkw_custom.js';
import { ok, err, emit } from './api_core.js';
import { listarArquivosDoProjeto } from './arvore_do_projeto.js';

/** O `unknown` do catch, normalizado sem mudar o que corre em execucao. */
function mensagemDe(e: unknown, padrao: string): string {
  return (e as Error | null)?.message || padrao;
}

/** O que o modal Wave Configuration (wave_config_manager.js) expoe. */
interface ConfigDeOnda {
  tree?: unknown;
  selected?: Set<string>;
  refresh(): Promise<unknown>;
  renderTree?(): void;
  save?(): Promise<unknown>;
  open(): Promise<unknown>;
}

/** O CompilationModule que o renderer.js poe em window, so o lancador do Surfer. */
interface ModuloDeCompilacao {
  _waveLaunchSurfer?(vcd: string, layout: string | null, tools: unknown): Promise<unknown>;
}

const configDeOnda = (): ConfigDeOnda | undefined =>
  (window as unknown as { waveConfigManager?: ConfigDeOnda }).waveConfigManager;

/* ------------------------------------------------------------------
 *  Layouts: o que muda entre GTKWave e Surfer
 * ---------------------------------------------------------------- */

interface TipoDeLayout {
  /** O campo do WaveStore onde a lista mora. */
  campo: 'gtkwFiles' | 'surferFiles';
  /** Arquivos que contam como layout deste visualizador. */
  aceita: RegExp;
  /** A extensao que sai do nome antes de comparar. */
  extensao: RegExp;
  msg: {
    soAceita: string;
    semNome: string;
    nenhum: (q: string) => string;
    ambiguo: (q: string, n: number, nomes: string) => string;
    falhaAdd: string;
    falhaAtivo: string;
    falhaRemover: string;
    naoRegistrado: (f: string) => string;
    naoNaLista: (f: string) => string;
  };
}

const GTKW: TipoDeLayout = {
  campo: 'gtkwFiles',
  aceita: /\.gtkw$/i,
  extensao: /\.gtkw$/i,
  msg: {
    soAceita: 'only .gtkw files are accepted',
    semNome: 'name required (the .gtkw file name)',
    nenhum: (q) => `no .gtkw matching "${q}" found in the project`,
    ambiguo: (q, n, nomes) => `"${q}" matches ${n} .gtkw files (${nomes}). Re-run with a more specific name, or add the exact path.`,
    falhaAdd: 'addGtkwFile failed',
    falhaAtivo: 'setActiveGtkwFile failed',
    falhaRemover: 'removeGtkwFile failed',
    naoRegistrado: (f) => `.gtkw not registered — call add_gtkw_file first: ${f}`,
    naoNaLista: (f) => `.gtkw not in list: ${f}`,
  },
};

// Surfer loads either a .surf.ron saved state (launched with -s) or a .sucl
// command file (launched with -c) the same way GTKWave loads a .gtkw. Same
// per-testbench list shape, stored separately in WaveStore.surferFiles so the
// two viewers never cross-contaminate. The toolbar picker is viewer-aware and
// shows whichever list matches the active viewer.
const SURFER: TipoDeLayout = {
  campo: 'surferFiles',
  aceita: /(\.ron|\.sucl)$/i,
  extensao: /(\.surf\.ron|\.ron|\.sucl)$/i,
  msg: {
    soAceita: 'only .surf.ron / .sucl files are accepted',
    semNome: 'name required (the Surfer layout file name)',
    nenhum: (q) => `no Surfer layout (.surf.ron/.sucl) matching "${q}" found in the project`,
    ambiguo: (q, n, nomes) => `"${q}" matches ${n} Surfer layouts (${nomes}). Re-run with a more specific name.`,
    falhaAdd: 'addSurferFile failed',
    falhaAtivo: 'setActiveSurferFile failed',
    falhaRemover: 'removeSurferFile failed',
    naoRegistrado: (f) => `Surfer layout not registered — call add_surfer_file first: ${f}`,
    naoNaLista: (f) => `Surfer layout not in list: ${f}`,
  },
};

const SEM_TB_LONGO = 'No testbench top set — mark a testbench top first';
const SEM_TB_CURTO = 'No testbench top set';

/** Um layout como o WaveStore guarda. */
interface EntradaDeLayout {
  name?: string;
  path?: string;
  isActive?: boolean;
}

/**
 * O projeto aberto e a chave do testbench ativo (o nome do arquivo, sem
 * extensao), ou o erro que o metodo deve devolver.
 */
async function testbenchAtivo(semTb: string): Promise<{ projectPath: string; tbKey: string } | ReturnType<typeof err>> {
  const projectPath = ProjectStore.getProjectPath();
  const spfPath = ProjectStore.getSpfPath();
  if (!projectPath || !spfPath) return err('No project open');
  const cfg = await SpfStore.read(spfPath);
  const tbKey = (cfg.testbenchFile || '').split(/[\\/]/).pop()!.replace(/\.[^.]+$/i, '');
  if (!tbKey) return err(semTb);
  return { projectPath, tbKey };
}

const eErro = (r: unknown): r is ReturnType<typeof err> => (r as { ok?: boolean }).ok === false;

const listaDe = (state: Record<string, unknown>, tipo: TipoDeLayout): EntradaDeLayout[] =>
  (Array.isArray(state[tipo.campo]) ? state[tipo.campo] : []) as EntradaDeLayout[];

async function listarLayouts(tipo: TipoDeLayout) {
  const ctx = await testbenchAtivo(SEM_TB_LONGO);
  if (eErro(ctx)) return ctx;
  const ws = await WaveStore.read(ctx.projectPath, ctx.tbKey);
  const files = listaDe(ws as unknown as Record<string, unknown>, tipo);
  return ok({
    testbench: ctx.tbKey,
    files: files.map((f) => ({
      name: f?.name || (f?.path || '').split(/[\\/]/).pop(),
      path: f?.path || '',
      isActive: !!f?.isActive,
    })),
  });
}

async function acharLayouts(tipo: TipoDeLayout, query = '') {
  const root = ProjectStore.getProjectPath();
  if (!root) return err('No project open');
  const treeRes = await listarArquivosDoProjeto(root);
  if (!treeRes.ok) return treeRes;
  const rel = Array.isArray(treeRes.data) ? treeRes.data : [];
  const needle = String(query || '').trim().toLowerCase().replace(tipo.extensao, '');
  const files = rel
    .filter((p) => tipo.aceita.test(p))
    .filter((p) => !needle || p.toLowerCase().includes(needle))
    .map((p) => ({
      name: p.split('/').pop() as string,
      relPath: p,
      path: `${root}\\${p.replace(/\//g, '\\')}`,
    }));
  return ok({ query: query || null, count: files.length, files });
}

async function registrarLayout(tipo: TipoDeLayout, { filePath, setActive = true }: { filePath?: string; setActive?: boolean } = {}) {
  if (!filePath) return err('filePath required');
  if (!tipo.aceita.test(filePath)) return err(tipo.msg.soAceita);
  const ctx = await testbenchAtivo(SEM_TB_LONGO);
  if (eErro(ctx)) return ctx;
  const { projectPath, tbKey } = ctx;
  // Resolve to an absolute path inside the project; verify the file exists.
  const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
  const abs = isAbs ? filePath : `${projectPath}\\${filePath.replace(/^[\\/]+/, '')}`;
  try {
    const exists = await electronAPI.fileExists(abs);
    if (!exists) return err(`file not found: ${abs}`);
  } catch (e) { return err(mensagemDe(e, 'fileExists failed')); }
  const name = abs.split(/[\\/]/).pop();
  try {
    await WaveStore.update(projectPath, tbKey, (state) => {
      const s = state as unknown as Record<string, unknown>;
      const files = listaDe(s, tipo);
      let existing = files.find((f) => f?.path === abs);
      if (!existing) {
        existing = { name, path: abs, isActive: false };
        files.push(existing);
      }
      if (setActive) {
        for (const f of files) f.isActive = (f === existing);
      }
      s[tipo.campo] = files;
    });
  } catch (e) { return err(mensagemDe(e, tipo.msg.falhaAdd)); }
  window.gtkwPickerManager?.refresh?.();
  return ok({ path: abs, isActive: !!setActive });
}

async function usarLayoutPeloNome(tipo: TipoDeLayout, name: unknown) {
  const q = String(name || '').trim();
  if (!q) return err(tipo.msg.semNome);
  const found = await acharLayouts(tipo, q);
  if (!found.ok) return found;
  const files = found.data?.files || [];
  if (!files.length) return err(tipo.msg.nenhum(q));
  // Prefer an exact basename match (e.g. "foo" or "foo.gtkw" → foo.gtkw).
  const wanted = q.toLowerCase().replace(tipo.extensao, '');
  const exact = files.filter((f) => f.name.toLowerCase().replace(tipo.extensao, '') === wanted);
  const pick = exact.length ? exact : files;
  if (pick.length > 1) {
    const names = pick.map((f) => f.relPath).join(', ');
    return err(tipo.msg.ambiguo(q, pick.length, names), 'AMBIGUOUS');
  }
  const target = pick[0];
  const reg = await registrarLayout(tipo, { filePath: target.path, setActive: true });
  if (!reg.ok) return reg;
  return ok({ name: target.name, path: target.path, relPath: target.relPath, active: true });
}

async function ativarLayout(tipo: TipoDeLayout, filePath: string | null | undefined) {
  const ctx = await testbenchAtivo(SEM_TB_CURTO);
  if (eErro(ctx)) return ctx;
  let foundEntry = !filePath;
  try {
    await WaveStore.update(ctx.projectPath, ctx.tbKey, (state) => {
      const s = state as unknown as Record<string, unknown>;
      const files = listaDe(s, tipo);
      for (const f of files) {
        const match = !!filePath && f?.path === filePath;
        if (match) foundEntry = true;
        f.isActive = match;
      }
      s[tipo.campo] = files;
    });
  } catch (e) { return err(mensagemDe(e, tipo.msg.falhaAtivo)); }
  if (filePath && !foundEntry) return err(tipo.msg.naoRegistrado(filePath));
  window.gtkwPickerManager?.refresh?.();
  return ok({ active: filePath || null });
}

async function removerLayout(tipo: TipoDeLayout, filePath: string | null | undefined) {
  if (!filePath) return err('filePath required');
  const ctx = await testbenchAtivo(SEM_TB_CURTO);
  if (eErro(ctx)) return ctx;
  let removed = 0;
  try {
    await WaveStore.update(ctx.projectPath, ctx.tbKey, (state) => {
      const s = state as unknown as Record<string, unknown>;
      const files = listaDe(s, tipo);
      const depois = files.filter((f) => f?.path !== filePath);
      removed = files.length - depois.length;
      s[tipo.campo] = depois;
    });
  } catch (e) { return err(mensagemDe(e, tipo.msg.falhaRemover)); }
  if (!removed) return err(tipo.msg.naoNaLista(filePath));
  window.gtkwPickerManager?.refresh?.();
  return ok({ removed });
}

/* ------------------------------------------------------------------
 *  O namespace
 * ---------------------------------------------------------------- */

export const waveNs = {
  /**
   * Every signal discovered for the current testbench, plus which are
   * currently ticked to be dumped into GTKWave.
   */
  async listSignals() {
    const wc = configDeOnda();
    if (!wc) return err('Wave Configuration is not available');
    if (!wc.tree) { try { await wc.refresh(); } catch (_) { /* handled below */ } }
    if (!wc.tree) return ok({ all: [], selected: [] });
    const all: string[] = [];
    flattenSignalPaths(wc.tree as Parameters<typeof flattenSignalPaths>[0], all);
    return ok({ all: all.sort(), selected: [...(wc.selected || [])].sort() });
  },

  /**
   * Replace the GTKWave signal selection with exactly `paths` and
   * persist it, the same effect as ticking boxes in the Wave
   * Configuration modal and pressing Save. Paths not present in the
   * discovered signal tree are ignored (returned under `ignored`).
   */
  async setSignals(paths: unknown) {
    const wc = configDeOnda();
    if (!wc) return err('Wave Configuration is not available');
    if (!wc.tree) {
      try { await wc.refresh(); }
      catch (e) { return err(mensagemDe(e, 'could not load signals')); }
    }
    if (!wc.tree) return err('no signals discovered — open a project with a testbench');
    const valid: string[] = [];
    flattenSignalPaths(wc.tree as Parameters<typeof flattenSignalPaths>[0], valid);
    const validSet = new Set(valid);
    const list: string[] = Array.isArray(paths) ? paths : [];
    const selected = list.filter((p) => validSet.has(p));
    const ignored = list.filter((p) => !validSet.has(p));
    wc.selected = new Set(selected);
    if (typeof wc.renderTree === 'function') wc.renderTree();
    if (typeof wc.save === 'function') await wc.save();
    emit('wave:signals-changed', { selected });
    return ok({ selected: selected.sort(), ignored });
  },

  /** Open the Wave Configuration modal for the user. */
  async openConfig() {
    const wc = configDeOnda();
    if (!wc) return err('Wave Configuration is not available');
    try { await wc.open(); return ok(); }
    catch (e) { return err(mensagemDe(e, 'could not open Wave Configuration')); }
  },

  /**
   * Read which Verilog simulator the Wave button runs. One of:
   *   - 'iverilog' , vvp/iverilog (bundled, default). Preserves every
   *                   internal SAPHO signal, slower on long testbenches.
   *   - 'verilator', Verilator (bundled, opt-in). Transpiles to C++ and
   *                   builds a native .exe, 5–10× faster on long runs,
   *                   but aggressively elides internal SAPHO signals
   *                   (only top-level testbench signals are visible).
   * The choice persists per-user (localStorage `aurora.waveSimulator`).
   */
  async getSimulator() {
    return ok({ simulator: getWaveSimulator() });
  },

  /**
   * Choose which simulator the Wave button runs. Accepts 'iverilog' or
   * 'verilator'; any other value is refused. Persisted across app restarts.
   * Re-running Wave after this picks up the new choice without further action.
   */
  async setSimulator({ simulator }: { simulator?: string } = {}) {
    if (simulator !== 'iverilog' && simulator !== 'verilator') {
      return err('simulator must be "iverilog" or "verilator"');
    }
    const applied = setWaveSimulator(simulator);
    emit('wave:simulator-changed', { simulator: applied });
    // Nudge the toolbar simulator toggle (and any other DOM listener) so
    // its icon/tooltip refresh to the new choice without further action.
    try {
      window.dispatchEvent(new CustomEvent('aurora:wave-simulator-changed', { detail: { simulator: applied } }));
    } catch (_) { /* best-effort UI nudge */ }
    return ok({ simulator: applied });
  },

  /**
   * Which waveform viewer the Wave button opens. 'gtkwave' = the bundled
   * GTKWave (external window, the default); 'surfer' = the embedded Surfer
   * viewer (waves inside the IDE). Persists per-user (localStorage
   * `aurora.waveViewer`).
   */
  async getViewer() {
    return ok({ viewer: getWaveViewer() });
  },

  /**
   * Choose which waveform viewer the Wave button opens. Accepts 'gtkwave'
   * or 'surfer'; any other value is refused. Persisted across app restarts.
   */
  async setViewer({ viewer }: { viewer?: string } = {}) {
    if (viewer !== 'gtkwave' && viewer !== 'surfer') {
      return err('viewer must be "gtkwave" or "surfer"');
    }
    const applied = setWaveViewer(viewer);
    emit('wave:viewer-changed', { viewer: applied });
    // Nudge the toolbar viewer toggle (and any other DOM listener) so its
    // highlight/tooltip refresh to the new choice without further action.
    try {
      window.dispatchEvent(new CustomEvent('aurora:wave-viewer-changed', { detail: { viewer: applied } }));
    } catch (_) { /* best-effort UI nudge */ }
    return ok({ viewer: applied });
  },

  /**
   * Whether the Surfer viewer keeps multiple windows open. false (default) =
   * one window (AURORA closes the previous Surfer before each launch); true =
   * keep windows open so you can compare different simulation runs side by
   * side. Persists per-user (localStorage `aurora.surferMultiWindow`).
   * Surfer-only, GTKWave has its own window lifecycle.
   */
  async getSurferMultiWindow() {
    return ok({ multiWindow: getSurferMultiWindow() });
  },

  /**
   * Enable/disable multiple Surfer windows. Accepts a boolean `enabled`.
   * Persisted across restarts; the next Wave picks it up. Mirrors the
   * checkbox in the Wave Configuration modal.
   */
  async setSurferMultiWindow({ enabled }: { enabled?: unknown } = {}) {
    if (typeof enabled !== 'boolean') {
      return err('enabled must be a boolean (true = multiple windows, false = single)');
    }
    const applied = setSurferMultiWindow(enabled);
    // Sync the modal checkbox if it's currently in the DOM.
    try {
      const cb = document.getElementById('waveConfigSurferMultiWindow') as HTMLInputElement | null;
      if (cb) cb.checked = applied;
    } catch (_) { /* best-effort UI nudge */ }
    return ok({ multiWindow: applied });
  },

  /**
   * List every .gtkw file currently registered for the active testbench
   * (one list per tb). Includes the active flag and absolute paths.
   */
  listGtkwFiles() { return listarLayouts(GTKW); },

  /**
   * Find every .gtkw save file inside the open project folder, optionally
   * filtered by a name fragment. The user only has to say the file's name:
   * this resolves the absolute path for them (and for the AI). Returns each
   * match with both project-relative and absolute paths.
   */
  findGtkwFiles(query = '') { return acharLayouts(GTKW, query); },

  /**
   * One-shot: the user names a .gtkw (with or without the extension, or a
   * path fragment) and Aurora locates it in the project, registers it for the
   * active testbench, and marks it active, so the next Wave run loads it.
   * If the name is ambiguous (several .gtkw match) the candidates are reported
   * instead of guessing.
   */
  useGtkwByName(name: unknown) { return usarLayoutPeloNome(GTKW, name); },

  /**
   * Register a .gtkw file from anywhere in the project tree as available
   * for the active testbench. The file must exist on disk and end in
   * .gtkw. If `setActive:true` (default) it is also marked active.
   */
  addGtkwFile(args?: { filePath?: string; setActive?: boolean }) { return registrarLayout(GTKW, args); },

  /**
   * Escreve um .gtkw com os sinais pedidos e registra para o testbench ativo.
   *
   * O irmao do `createSurferLayout`, do lado do GTKWave. Ate aqui dava para
   * registrar um .gtkw que ja existisse no disco (`addGtkwFile`), nunca para
   * criar um: quem quisesse um layout proprio tinha que abrir o GTKWave,
   * montar a vista na mao e salvar. O layout AUTOMATICO continua sendo outra
   * coisa, e continua sendo o padrao (ver ARCHITECTURE secao 9): este caminho
   * e o do pedido explicito, quando ja se sabe quais sinais olhar.
   *
   * O formato fica no `gtkw_custom.ts`, que e puro e testado; aqui so se
   * resolve o caminho, escreve e registra.
   */
  async createGtkwLayout({ name, signals, setActive = true }: { name?: string; signals?: NonNullable<Parameters<typeof buildCustomGtkw>[0]>['signals']; setActive?: boolean } = {}) {
    if (!name) return err('name required');
    const projectPath = ProjectStore.getProjectPath();
    if (!projectPath) return err('No project open');

    const { conteudo, sinais, ignorados } = buildCustomGtkw({ signals });
    if (!sinais) {
      return err('signals required — one signal path per entry, e.g. "tb.dut.acc"');
    }

    const base = String(name).replace(/[^\w.-]+/g, '_').replace(/\.gtkw$/i, '');
    const alvo = await electronAPI.joinPath(projectPath, `${base}.gtkw`);
    try { await electronAPI.writeFile(alvo, conteudo); }
    catch (e) { return err(`Could not write ${alvo}: ${(e as Error | null)?.message || e}`); }

    const add = await registrarLayout(GTKW, { filePath: alvo, setActive });
    if (!add?.ok) return add;
    return ok({ filePath: alvo, signals: sinais, ignored: ignorados, isActive: !!setActive });
  },

  /**
   * Mark one of the registered .gtkw files as active (the one that
   * GTKWave will open). Pass `null` / no path to revert to the default
   * (Aurora auto-generates a layout).
   */
  setActiveGtkwFile(filePath?: string | null) { return ativarLayout(GTKW, filePath); },

  /** Drop one .gtkw entry from the active testbench's list. */
  removeGtkwFile(filePath?: string | null) { return removerLayout(GTKW, filePath); },

  /**
   * Open the Surfer waveform viewer directly on a .vcd/.fst file (Aurora
   * Intelligence `open_surfer` tool). Reuses the compilation module's launcher,
   * so it inherits Surfer's process tracking, the terminal status messages, and
   * the automatic fall-back to GTKWave when surfer-aurora.exe isn't installed. Pass an
   * absolute file path (from get_project_tree); `layout` optionally loads a
   * .surf.ron saved state (via -s) or a .sucl command file (via -c).
   */
  async openSurfer({ file, layout }: { file?: string; layout?: string | null } = {}) {
    const vcd = String(file || '').trim();
    if (!vcd) return err('file is required — pass a .vcd/.fst path (see get_project_tree)');
    const cm = (window as unknown as { compilationModule?: ModuloDeCompilacao }).compilationModule;
    if (!cm || typeof cm._waveLaunchSurfer !== 'function') return err('compilation module unavailable');
    try {
      const componentsPath = await electronAPI.getComponentsPath();
      const tools = await resolveWaveToolchain(componentsPath, ProjectStore.getProjectPath());
      await cm._waveLaunchSurfer(vcd, layout || null, tools);
      return ok({ opened: vcd, layout: layout || null });
    } catch (e) {
      return err(mensagemDe(e, 'surfer launch failed'));
    }
  },

  /** List every Surfer layout (.surf.ron/.sucl) registered for the active testbench. */
  listSurferFiles() { return listarLayouts(SURFER); },

  /** Find every Surfer layout file (.surf.ron/.sucl) in the project, optional name filter. */
  findSurferFiles(query = '') { return acharLayouts(SURFER, query); },

  /** One-shot: name a Surfer layout → locate, register, activate for the active tb. */
  useSurferByName(name: unknown) { return usarLayoutPeloNome(SURFER, name); },

  /** Register a Surfer layout (.surf.ron/.sucl) for the active testbench. */
  addSurferFile(args?: { filePath?: string; setActive?: boolean }) { return registrarLayout(SURFER, args); },

  /** Mark one registered Surfer layout active (or null to clear → raw VCD). */
  setActiveSurferFile(filePath?: string | null) { return ativarLayout(SURFER, filePath); },

  /**
   * Cria um arquivo de comandos do Surfer e, se pedido, abre o Surfer com ele.
   *
   * Sobre o formato, que e a decisao que importa aqui: a IA escreve um `.sucl`,
   * e nao um `.surf.ron`. O `.surf.ron` e a serializacao RON do estado interno
   * do Surfer, feita pelo serde, e nao tem esquema publicado: escrever um a mao
   * e apostar na forma privada de uma struct que muda entre versoes. O `.sucl` e
   * o oposto, e documentado (docs/commands do surfer-aurora), e feito para ser
   * escrito a mao e faz a mesma coisa do ponto de vista de quem usa: monta a
   * visao. Por isso o caminho de criacao passa por ele.
   *
   * O arquivo entra na lista de layouts do testbench ativo, entao aparece no
   * seletor junto com os que ja existiam.
   *
   * Ate 25/09/2026 o registro e a abertura eram conferidos por `.success`, um
   * campo que o envelope da API nao tem (`ok()` devolve `{ ok, data }`): toda
   * chamada voltava logo depois de registrar, com o envelope do registro no
   * lugar do resultado, e o `open` nunca rodava.
   */
  async createSurferLayout({ name, commands, open = false, setActive = true }: { name?: string; commands?: string[] | string; open?: boolean; setActive?: boolean } = {}) {
    if (!name) return err('name required');
    const projectPath = ProjectStore.getProjectPath();
    if (!projectPath) return err('No project open');

    const linhas = Array.isArray(commands) ? commands : String(commands || '').split('\n');
    const corpo = linhas.map((l) => String(l).trim()).filter(Boolean);
    if (!corpo.length) return err('commands required — one Surfer command per line');

    const base = String(name).replace(/[^\w.-]+/g, '_').replace(/\.sucl$/i, '');
    const alvo = await electronAPI.joinPath(projectPath, `${base}.sucl`);
    const texto = [
      '# Gerado pela Aurora Intelligence.',
      '# Arquivo de comandos do Surfer (.sucl): um comando por linha.',
      ...corpo,
      '',
    ].join('\n');

    try { await electronAPI.writeFile(alvo, texto); }
    catch (e) { return err(`Could not write ${alvo}: ${(e as Error | null)?.message || e}`); }

    const add = await registrarLayout(SURFER, { filePath: alvo, setActive });
    if (!add.ok) return add;
    if (open) {
      // O Surfer abre sobre um dump, e este metodo so conhece o layout: sem
      // .vcd/.fst a abertura recusa, e a recusa volta em `openError`.
      const r = await waveNs.openSurfer({ file: undefined, layout: alvo });
      if (!r.ok) return ok({ filePath: alvo, opened: false, openError: r.error });
    }
    return ok({ filePath: alvo, opened: !!open, commands: corpo.length });
  },

  /** Drop one Surfer layout entry from the active testbench's list. */
  removeSurferFile(filePath?: string | null) { return removerLayout(SURFER, filePath); },
};
