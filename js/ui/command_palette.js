/**
 * command_palette.js: Aurora command palette (Ctrl+Shift+K / Ctrl+Shift+P).
 *
 * A single, keyboard-first surface for the actions scattered across the toolbar
 * and menus. The VIEW is the <aurora-command-palette> Lit component (Shadow DOM
 * + semantic tokens); this module owns the registry (plain data), the fuzzy
 * scoring, the global open/nav keyboard handling, and the run logic, it drives
 * the component via .items/.selected/.open and reacts to its cmdk-* events.
 *
 * Commands prefer the public API (window.AuroraAPI / the file-tree view
 * controller) and otherwise click the existing toolbar button by id, so a
 * command does exactly what the button does (including being a no-op when the
 * button is disabled), with no duplicated logic.
 *
 * Shortcuts: Ctrl/Cmd+Shift+K (primary) or Ctrl/Cmd+Shift+P open it. Plain
 * Ctrl+K is reserved for the AI panel, so we don't bind it. Esc closes; ↑/↓
 * move; Enter runs.
 */

import { electronAPI } from '../app/electron_api.js';
import '../components/aurora-command-palette.js';
import { PADROES, textoDoAtalho } from '../utils/shortcut_table.js';

/**
 * A tecla de cada comando, lida da MESMA tabela que o gestor de atalhos usa e
 * respeitando o que a pessoa regravou. Mostrar a tecla aqui e o que faz alguem
 * parar de precisar da paleta para aquela funcao: a paleta ensina o atalho e
 * depois sai do caminho.
 */
function atalhoDe(acao) {
  if (!acao) return '';
  let gravados = {};
  try { gravados = JSON.parse(localStorage.getItem('aurora-shortcuts') || '{}'); } catch (_) { /* sem nada gravado */ }
  return textoDoAtalho(gravados[acao] || PADROES[acao]);
}

/** Click a toolbar button by id if it exists and isn't disabled. */
function clickById(id) {
  const el = document.getElementById(id);
  if (el && !el.disabled && !el.classList.contains('disabled')) el.click();
}
/** Click the first existing/enabled button from a list of candidate ids. */
function clickFirst(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.disabled && !el.classList.contains('disabled')) { el.click(); return; }
  }
}

// Command registry. group orders the list; keywords widen fuzzy matches.
const COMMANDS = [
  // Compilation
  { id: 'compile.cmm', acao: 'compileCmm',     group: 'Compile', icon: 'ph ph-play-circle',   title: 'Compile C±',                    keywords: 'cmm build asm assemble', run: () => clickById('cmmcomp') },
  { id: 'compile.verilog', acao: 'compileVerilog', group: 'Compile', icon: 'ph ph-cpu',           title: 'Synthesize Verilog',            keywords: 'veri synth hardware',    run: () => clickById('vericomp') },
  { id: 'compile.wave', acao: 'compileWave',    group: 'Compile', icon: 'ph ph-waveform',      title: 'Analyse Verilog (waveform)',    keywords: 'wave gtkwave simulate',  run: () => clickById('wavecomp') },
  { id: 'compile.fast', acao: 'compileFast',    group: 'Compile', icon: 'ph ph-lightning',     title: 'Fast run (Verilator)',          keywords: 'fast verilator simulate no waveform', run: () => clickById('fastsim') },
  { id: 'compile.proc',    group: 'Compile', icon: 'ph ph-circuitry',     title: 'Synthesized processor test',    keywords: 'verilator proc io',      run: () => clickById('verilatorproc') },
  { id: 'compile.all', acao: 'compileAll',     group: 'Compile', icon: 'ph ph-hammer',        title: 'Full build',                    keywords: 'all everything build run', run: () => clickById('allcomp') },
  { id: 'compile.prism', acao: 'openPrism',   group: 'Compile', icon: 'ph ph-graph',         title: 'Open PRISM',                    keywords: 'prism netlist schematic diagram', run: () => clickById('prismcomp') },
  { id: 'compile.cancel', acao: 'cancelCompilation',  group: 'Compile', icon: 'ph ph-x-circle',      title: 'Cancel compilation',            keywords: 'stop abort kill',        run: () => clickById('cancel-everything') },

  // Project
  { id: 'project.new', acao: 'newProject',     group: 'Project', icon: 'ph ph-folder-simple-plus', title: 'New Project…',            keywords: 'create',                 run: () => clickFirst(['newProjectBtn', 'newProjectBtnWelcome']) },
  { id: 'project.open', acao: 'openProject',    group: 'Project', icon: 'ph ph-folder-open',   title: 'Open Project…',                 keywords: 'load',                   run: () => clickFirst(['openProjectBtn', 'openProjectBtnWelcome']) },
  { id: 'project.newFile', acao: 'newFile', group: 'Project', icon: 'ph ph-file-plus',     title: 'New File',                      keywords: 'create add',             run: () => clickById('new-file') },
  { id: 'project.backup', acao: 'backupProject',  group: 'Project', icon: 'ph ph-archive',       title: 'Backup Project',                keywords: 'save zip export',        run: () => clickById('backup-project') },

  // View
  { id: 'view.files',      group: 'View',    icon: 'ph ph-list-bullets',  title: 'Show Files tree',               keywords: 'verilog picker sidebar', run: () => window.fileTreeViewController?.showFileMode?.() },
  { id: 'view.hierarchy',  group: 'View',    icon: 'ph ph-tree-structure', title: 'Show Hierarchy tree',          keywords: 'modules netlist sidebar', run: () => window.fileTreeViewController?.showHierarchyMode?.() },
  { id: 'view.folders',    group: 'View',    icon: 'ph ph-folders',       title: 'Show Folders tree',             keywords: 'filesystem standard explorer sidebar', run: () => window.fileTreeViewController?.showStandardMode?.() },
  { id: 'view.clearTerm', acao: 'clearTerminal',  group: 'View',    icon: 'ph ph-broom',         title: 'Clear terminal',                keywords: 'clean console output',   run: () => clickById('clear-terminal') },
  // O painel recolhido nao tinha caminho de volta, e a paleta so oferecia
  // limpar o terminal, que exige um painel aberto para servir de alguma coisa.
  { id: 'view.toggleTerm', group: 'View',   icon: 'ph ph-caret-up-down', title: 'Toggle terminal panel',         keywords: 'terminal panel show hide collapse expand open console', run: () => window.toggleTerminal?.() },

  // Tools
  { id: 'tools.hub', acao: 'processorHub',       group: 'Tools',   icon: 'ph ph-graph',         title: 'Processor Hub',                 keywords: 'generate processor create', run: () => clickById('processorHub') },
  { id: 'tools.procCfg',   group: 'Tools',   icon: 'ph ph-gear-six',      title: 'Processor simulation settings', keywords: 'clock clocks config',    run: () => clickById('procConfigToggle') },
  { id: 'tools.markPoint', group: 'Tools',   icon: 'ph ph-bookmark-simple', title: 'Mark restore point',      keywords: 'checkpoint snapshot save state rewind', run: () => window.auroraRewind?.marcar?.() },
  { id: 'tools.rewind',    group: 'Tools',   icon: 'ph ph-arrow-counter-clockwise', title: 'Rewind code to a restore point…', keywords: 'undo revert checkpoint snapshot back', run: () => window.auroraRewind?.escolher?.() },
  { id: 'tools.settings', acao: 'openSettings',  group: 'Tools',   icon: 'ph ph-gear',          title: 'Aurora settings',               keywords: 'preferences options config', run: () => clickById('aurora-settings') },
  { id: 'tools.designLab', group: 'Tools',   icon: 'ph ph-flask',         title: 'Open Design Lab',               keywords: 'components gallery design lab dev showcase lit', run: () => electronAPI?.openDesignLab?.() },
  { id: 'tools.slang', acao: 'toggleSlang',     group: 'Tools',   icon: 'ph ph-brackets-angle', title: 'Toggle slang — SystemVerilog semantic analysis (Ctrl+Alt+S)', keywords: 'slang systemverilog verilog semantic lsp lint diagnostics elaboration toggle ctrl alt s', run: () => window.AuroraSlang?.toggle?.() },

  // Dev
  { id: 'dev.jankOverlay', group: 'Dev',   icon: 'ph ph-chart-line',    title: 'Toggle Jank Overlay',           keywords: 'performance fps jank perf debug dev p99 rAF TTI', run: () => import('../dev/jank_overlay.js').then(m => m.toggleJankOverlay()) },
];

const GROUP_ORDER = ['Compile', 'Project', 'View', 'Tools', 'Dev'];

/** Subsequence score: every query term must appear in the haystack. Higher is
 *  better; title hits beat keyword hits, prefix beats mid-string. -1 = no match. */
function scoreCommand(cmd, query) {
  const title = cmd.title.toLowerCase();
  const hay = `${title} ${cmd.keywords} ${cmd.group}`.toLowerCase();
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 0;
  let score = 0;
  for (const t of terms) {
    const inTitle = title.indexOf(t);
    if (inTitle === 0) { score += 100; continue; }            // title prefix
    if (inTitle > 0)   { score += 60 - Math.min(inTitle, 30); continue; } // title contains
    const inHay = hay.indexOf(t);
    if (inHay >= 0)    { score += 20; continue; }             // keyword/group
    return -1;                                                // term missing → drop
  }
  return score;
}

// ── modo simbolo: `#` procura modulo no PROJETO ────────────────────────

/**
 * `#` liga a busca por modulo, como no VS Code. O Ctrl+T abre a paleta ja com
 * ele digitado, entao quem sabe o atalho nunca ve o prefixo e quem nao sabe
 * descobre o recurso digitando.
 *
 * Os textos daqui ficam em ingles como todo o resto da paleta, que nao passa
 * pelo i18n: os titulos dos comandos tambem sao fixos. Traduzir so estas tres
 * linhas deixaria a lista falando duas linguas ao mesmo tempo.
 */
const PREFIXO_SIMBOLO = '#';

/** So o slang indexa o projeto; o Verible responde "method not found". */
function slangDisponivel() {
  try {
    return !!(window.slangAPI
      && typeof window.slangAPI.workspaceSymbol === 'function'
      && window.AuroraSlang
      && typeof window.AuroraSlang.isEnabled === 'function'
      && window.AuroraSlang.isEnabled());
  } catch {
    return false;
  }
}

/** O ultimo pedaco de um caminho, com separador de qualquer um dos dois mundos. */
function nomeDoArquivo(caminho) {
  const partes = String(caminho || '').split(/[/\\]/);
  return partes[partes.length - 1] || '';
}

/** Abre o arquivo do simbolo e leva o cursor ate ele. */
async function irParaSimbolo(sym) {
  const loc = sym && sym.location;
  if (!loc || !loc.uri) return;
  let fsPath;
  try { fsPath = window.monaco.Uri.parse(loc.uri).fsPath; } catch { return; }

  try {
    const conteudo = await electronAPI.readFile(fsPath, { encoding: 'utf8' });
    if (typeof conteudo !== 'string') return;
    window.TabManager?.addTab?.(fsPath, conteudo);
  } catch (e) {
    console.warn('[cmdk] nao consegui abrir', fsPath, e);
    return;
  }

  // A aba cria o editor de forma assincrona (addTab espera EditorManager.ready),
  // entao a ida ate a linha tenta algumas vezes em vez de supor que ja esta la.
  const linha = (loc.range && loc.range.start && loc.range.start.line + 1) || 1;
  for (let i = 0; i < 40; i += 1) {
    const ed = window.EditorManager?.getEditorForFile?.(fsPath);
    if (ed) {
      ed.setPosition({ lineNumber: linha, column: 1 });
      ed.revealLineInCenter(linha);
      ed.focus();
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Um simbolo do LSP vira uma linha da paleta. */
function simboloComoItem(sym) {
  let arquivo = '';
  try { arquivo = nomeDoArquivo(window.monaco.Uri.parse(sym.location.uri).fsPath); }
  catch { arquivo = ''; }
  return {
    id: `sym:${sym.name}:${arquivo}`,
    group: 'Modules',
    icon: 'ph ph-cpu',
    title: sym.name,
    detalhe: arquivo,
    keywords: '',
    run: () => { irParaSimbolo(sym); },
  };
}

/** Uma linha que so explica, sem acao util. Usada quando nao ha o que listar. */
function recado(texto, run) {
  return {
    id: 'recado',
    group: 'Modules',
    icon: 'ph ph-info',
    title: texto,
    keywords: '',
    run: run || (() => {}),
  };
}

class CommandPalette {
  constructor() {
    this._open = false;
    this._items = [];        // current filtered [{cmd, score}]
    this._sel = 0;
    this._el = null;         // the <aurora-command-palette> view
    // Cada busca por simbolo carrega um numero. A resposta que chega com
    // numero velho e descartada: digitar rapido dispara varias, e sem isso a
    // lista pisca resultado de consulta que a pessoa ja abandonou.
    this._buscaAtual = 0;
    this._onKeydown = this._onKeydown.bind(this);
    window.addEventListener('keydown', this._onKeydown, true);
  }

  _build() {
    if (this._el) return;
    const el = document.createElement('aurora-command-palette');
    document.body.appendChild(el);
    el.addEventListener('cmdk-input', (e) => this._refilter(e.detail));
    el.addEventListener('cmdk-run',   (e) => this._run(e.detail));
    el.addEventListener('cmdk-hover', (e) => this._select(e.detail));
    el.addEventListener('cmdk-close', () => this.close());
    this._el = el;
  }

  toggle() { this._open ? this.close() : this.open(); }

  open(textoInicial = '') {
    this._build();
    // Force the closed (opacity:0) state to paint before flipping `open`, so the
    // fade/scale-in transition actually runs on the first open too.
    void this._el.offsetWidth;
    this._open = true;
    this._el.textoInicial = textoInicial;
    this._el.open = true;     // the component focuses + seeds its input
    this._refilter(textoInicial);
  }

  close() {
    if (!this._el) return;
    this._open = false;
    this._el.open = false;
  }

  _refilter(query) {
    const q = query || '';
    if (q.startsWith(PREFIXO_SIMBOLO)) {
      this._buscarSimbolos(q.slice(PREFIXO_SIMBOLO.length).trim());
      return;
    }
    // Voltar para os comandos invalida a busca que ainda estiver no ar.
    this._buscaAtual += 1;
    let scored;
    if (!q.trim()) {
      scored = COMMANDS.map((cmd) => ({ cmd, score: 0 }));
      scored.sort((a, b) => {
        const g = GROUP_ORDER.indexOf(a.cmd.group) - GROUP_ORDER.indexOf(b.cmd.group);
        return g !== 0 ? g : a.cmd.title.localeCompare(b.cmd.title);
      });
    } else {
      scored = COMMANDS
        .map((cmd) => ({ cmd, score: scoreCommand(cmd, q) }))
        .filter((s) => s.score >= 0)
        .sort((a, b) => b.score - a.score);
    }
    this._items = scored;
    this._sel = 0;
    this._sync();
  }

  /**
   * Procura modulo no projeto. Assincrona, entao o resultado so entra na lista
   * se a consulta ainda for a mais recente.
   */
  async _buscarSimbolos(consulta) {
    const meu = (this._buscaAtual += 1);
    const mostrar = (itens) => {
      if (meu !== this._buscaAtual || !this._open) return;
      this._items = itens.map((cmd) => ({ cmd, score: 0 }));
      this._sel = 0;
      this._sync();
    };

    if (!slangDisponivel()) {
      // Recado COM acao: ligar o slang daqui e mais util do que mandar a
      // pessoa procurar o comando que liga.
      mostrar([recado(
        'Module search needs slang. Press Enter to turn it on.',
        () => { try { window.AuroraSlang?.toggle?.(); } catch { /* sem slang, sem acao */ } },
      )]);
      return;
    }

    let simbolos = null;
    try { simbolos = await window.slangAPI.workspaceSymbol(consulta); }
    catch { simbolos = null; }

    if (!Array.isArray(simbolos) || !simbolos.length) {
      // O slang indexa MODULO, nao sinal. Dizer isso evita que a pessoa
      // conclua que digitou errado ao procurar pelo nome de um sinal.
      mostrar([recado(consulta
        ? 'No module with that name. Only modules are indexed, not signals.'
        : 'No module indexed yet.')]);
      return;
    }

    mostrar(simbolos.filter((s) => s && s.name && s.location).map(simboloComoItem));
  }

  /** Push the current filtered list + selection to the view. */
  _sync() {
    if (!this._el) return;
    this._el.items = this._items.map((s) => ({ ...s.cmd, atalho: atalhoDe(s.cmd.acao) }));
    this._el.selected = this._sel;
  }

  _select(idx) {
    if (idx < 0 || idx >= this._items.length || idx === this._sel) return;
    this._sel = idx;
    if (this._el) this._el.selected = idx;
  }

  _move(delta) {
    if (!this._items.length) return;
    const n = this._items.length;
    this._select((this._sel + delta + n) % n);
  }

  _run(idx) {
    const entry = this._items[idx];
    this.close();
    if (entry) { try { entry.cmd.run(); } catch (e) { console.warn('[cmdk] command failed:', e); } }
  }

  _onKeydown(e) {
    // Open shortcuts (global). Ctrl/Cmd+Shift+K (primary) or +P. Ctrl+K alone is
    // reserved for the AI panel, so it's intentionally not bound here.
    if (!this._open) {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      // Ctrl+T: a paleta ja no modo simbolo, mesmo atalho do VS Code.
      if (mod && !e.shiftKey && k === 't') {
        e.preventDefault();
        e.stopPropagation();
        this.open(PREFIXO_SIMBOLO);
        return;
      }
      if (mod && e.shiftKey && (k === 'k' || k === 'p')) {
        // Capture-phase + stopPropagation so it opens even over a focused
        // Monaco editor (which binds Ctrl+Shift+K to delete-line) without also
        // firing that command.
        e.preventDefault();
        e.stopPropagation();
        this.open();
      }
      return;
    }
    // While open.
    switch (e.key) {
      case 'Escape':    e.preventDefault(); this.close(); break;
      case 'ArrowDown': e.preventDefault(); this._move(1); break;
      case 'ArrowUp':   e.preventDefault(); this._move(-1); break;
      case 'Enter':     e.preventDefault(); this._run(this._sel); break;
      default: break;
    }
  }
}

const commandPalette = new CommandPalette();
if (typeof window !== 'undefined') window.commandPalette = commandPalette;

export { commandPalette, CommandPalette };
