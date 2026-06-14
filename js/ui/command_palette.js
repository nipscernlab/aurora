/**
 * command_palette.js — Aurora command palette (Ctrl+Shift+K / Ctrl+Shift+P).
 *
 * A single, keyboard-first surface for the actions scattered across the toolbar
 * and menus. The VIEW is the <aurora-command-palette> Lit component (Shadow DOM
 * + semantic tokens); this module owns the registry (plain data), the fuzzy
 * scoring, the global open/nav keyboard handling, and the run logic — it drives
 * the component via .items/.selected/.open and reacts to its cmdk-* events.
 *
 * Commands prefer the public API (window.AuroraAPI / the file-tree view
 * controller) and otherwise click the existing toolbar button by id — so a
 * command does exactly what the button does (including being a no-op when the
 * button is disabled), with no duplicated logic.
 *
 * Shortcuts: Ctrl/Cmd+Shift+K (primary) or Ctrl/Cmd+Shift+P open it. Plain
 * Ctrl+K is reserved for the AI panel, so we don't bind it. Esc closes; ↑/↓
 * move; Enter runs.
 */

import '../components/aurora-command-palette.js';

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
  { id: 'compile.cmm',     group: 'Compile', icon: 'ph ph-play-circle',   title: 'Compile C±',                    keywords: 'cmm build asm assemble', run: () => clickById('cmmcomp') },
  { id: 'compile.verilog', group: 'Compile', icon: 'ph ph-cpu',           title: 'Synthesize Verilog',            keywords: 'veri synth hardware',    run: () => clickById('vericomp') },
  { id: 'compile.wave',    group: 'Compile', icon: 'ph ph-waveform',      title: 'Analyse Verilog (waveform)',    keywords: 'wave gtkwave simulate',  run: () => clickById('wavecomp') },
  { id: 'compile.fast',    group: 'Compile', icon: 'ph ph-lightning',     title: 'Fast run (Verilator)',          keywords: 'fast verilator simulate no waveform', run: () => clickById('fastsim') },
  { id: 'compile.proc',    group: 'Compile', icon: 'ph ph-circuitry',     title: 'Synthesized processor test',    keywords: 'verilator proc io',      run: () => clickById('verilatorproc') },
  { id: 'compile.all',     group: 'Compile', icon: 'ph ph-hammer',        title: 'Full build',                    keywords: 'all everything build run', run: () => clickById('allcomp') },
  { id: 'compile.prism',   group: 'Compile', icon: 'ph ph-graph',         title: 'Open PRISM',                    keywords: 'prism netlist schematic diagram', run: () => clickById('prismcomp') },
  { id: 'compile.cancel',  group: 'Compile', icon: 'ph ph-x-circle',      title: 'Cancel compilation',            keywords: 'stop abort kill',        run: () => clickById('cancel-everything') },

  // Project
  { id: 'project.new',     group: 'Project', icon: 'ph ph-folder-simple-plus', title: 'New Project…',            keywords: 'create',                 run: () => clickFirst(['newProjectBtn', 'newProjectBtnWelcome']) },
  { id: 'project.open',    group: 'Project', icon: 'ph ph-folder-open',   title: 'Open Project…',                 keywords: 'load',                   run: () => clickFirst(['openProjectBtn', 'openProjectBtnWelcome']) },
  { id: 'project.newFile', group: 'Project', icon: 'ph ph-file-plus',     title: 'New File',                      keywords: 'create add',             run: () => clickById('new-file') },
  { id: 'project.backup',  group: 'Project', icon: 'ph ph-archive',       title: 'Backup Project',                keywords: 'save zip export',        run: () => clickById('backup-project') },

  // View
  { id: 'view.files',      group: 'View',    icon: 'ph ph-list-bullets',  title: 'Show Files tree',               keywords: 'verilog picker sidebar', run: () => window.fileTreeViewController?.showFileMode?.() },
  { id: 'view.hierarchy',  group: 'View',    icon: 'ph ph-tree-structure', title: 'Show Hierarchy tree',          keywords: 'modules netlist sidebar', run: () => window.fileTreeViewController?.showHierarchyMode?.() },
  { id: 'view.folders',    group: 'View',    icon: 'ph ph-folders',       title: 'Show Folders tree',             keywords: 'filesystem standard explorer sidebar', run: () => window.fileTreeViewController?.showStandardMode?.() },
  { id: 'view.clearTerm',  group: 'View',    icon: 'ph ph-broom',         title: 'Clear terminal',                keywords: 'clean console output',   run: () => clickById('clear-terminal') },

  // Tools
  { id: 'tools.hub',       group: 'Tools',   icon: 'ph ph-graph',         title: 'Processor Hub',                 keywords: 'generate processor create', run: () => clickById('processorHub') },
  { id: 'tools.procCfg',   group: 'Tools',   icon: 'ph ph-gear-six',      title: 'Processor simulation settings', keywords: 'clock clocks config',    run: () => clickById('procConfigToggle') },
  { id: 'tools.settings',  group: 'Tools',   icon: 'ph ph-gear',          title: 'Aurora settings',               keywords: 'preferences options config', run: () => clickById('aurora-settings') },
  { id: 'tools.designLab', group: 'Tools',   icon: 'ph ph-flask',         title: 'Open Design Lab',               keywords: 'components gallery design lab dev showcase lit', run: () => window.electronAPI?.openDesignLab?.() },
];

const GROUP_ORDER = ['Compile', 'Project', 'View', 'Tools'];

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

class CommandPalette {
  constructor() {
    this._open = false;
    this._items = [];        // current filtered [{cmd, score}]
    this._sel = 0;
    this._el = null;         // the <aurora-command-palette> view
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

  open() {
    this._build();
    // Force the closed (opacity:0) state to paint before flipping `open`, so the
    // fade/scale-in transition actually runs on the first open too.
    void this._el.offsetWidth;
    this._open = true;
    this._el.open = true;     // the component focuses + clears its input
    this._refilter('');
  }

  close() {
    if (!this._el) return;
    this._open = false;
    this._el.open = false;
  }

  _refilter(query) {
    const q = query || '';
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

  /** Push the current filtered list + selection to the view. */
  _sync() {
    if (!this._el) return;
    this._el.items = this._items.map((s) => s.cmd);
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
