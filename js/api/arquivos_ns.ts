/**
 * arquivos_ns.ts: os arquivos do projeto, parte do namespace
 * `AuroraAPI.project` (ler, criar, apagar, renomear, importar para o .spf,
 * os arquivos que sumiram do disco, repintar a arvore e trocar de vista).
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO), como o memorias_ns.ts e o
 * processadores_ns.ts. O projeto e o .spf vem do ProjectStore e do SpfStore
 * importados, e nao de window.
 *
 * Compilado por `tsc` (npm run build:ts) num arquivos_ns.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { SharedModelRegistry } from '../editor/shared_models.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { ok, err, emit } from './api_core.js';
import { atualizarArvore } from './abas_e_arvore.js';
import { acharArquivoNoProjeto } from './arvore_do_projeto.js';
import { activeEditor, magicWandReveal } from './editor_ativo.js';

/** A arvore de projeto (js/project/file_mode.js) que o renderer poe em window. */
interface ArvoreDoProjeto {
  missingFiles?: Array<{ name: string; path: string; category?: string | null }>;
  dismissMissingFiles?(): Promise<number>;
  refreshTree?(): Promise<unknown>;
}

/** O controlador das duas vistas da arvore (js/tree/file_tree_view_controller.js). */
interface ControladorDaVista {
  showFileMode(): void;
  showHierarchyMode(): boolean;
  getActiveView?(): string;
  getHierarchyData?(): unknown;
}

const arvore = (): ArvoreDoProjeto | undefined =>
  (window as unknown as { projectTreeManager?: ArvoreDoProjeto }).projectTreeManager;
const controlador = (): ControladorDaVista | undefined =>
  (window as unknown as { fileTreeViewController?: ControladorDaVista }).fileTreeViewController;

export const arquivosDoProjeto = {
  /**
   * Read the full text of any file inside the open project folder, at
   * any nesting depth. `filePath` may be absolute or relative to the
   * project root. Reads are scoped to the project folder, paths
   * outside it (or containing "..") are refused. Very large files are
   * returned truncated with `truncated: true`.
   */
  async readFile(filePath: string | null | undefined) {
    if (!filePath) return err('filePath required');
    const root = ProjectStore.getProjectPath();
    if (!root) return err('No project open');

    let target = String(filePath).trim();
    if (target.includes('..')) return err('path must not contain ".."');

    // A bare relative path resolves against the project root.
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('\\\\');
    if (!isAbsolute) {
      target = `${root}\\${target.replace(/^[\\/]+/, '')}`;
    }

    // Stay inside the project folder. The trailing-separator check
    // stops a sibling like "MyProject2" matching "MyProject".
    const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const r = norm(root);
    const t = norm(target);
    if (t !== r && !t.startsWith(r + '\\')) {
      return err('file is outside the open project folder');
    }

    // If the file is open in any Monaco pane, return its in-memory content
    // so the AI sees the latest unsaved edits, not the stale on-disk version.
    const liveModel = SharedModelRegistry.getModel(target);
    if (liveModel) {
      const text = liveModel.getValue();
      const MAX = 256 * 1024;
      if (text.length > MAX) {
        return ok({ filePath: target, content: text.slice(0, MAX), length: text.length, truncated: true, fromEditor: true });
      }
      return ok({ filePath: target, content: text, length: text.length, truncated: false, fromEditor: true });
    }

    const MAX = 256 * 1024;
    const readAt = async (abs: string) => {
      const text = String(await electronAPI.readFile(abs) ?? '');
      return text.length > MAX
        ? ok({ filePath: abs, content: text.slice(0, MAX), length: text.length, truncated: true })
        : ok({ filePath: abs, content: text, length: text.length, truncated: false });
    };
    try {
      return await readAt(target);
    } catch (e) {
      // Literal path missed, search the whole project by name / partial path
      // / casing before giving up, so a file in a nested folder still opens.
      const found = await acharArquivoNoProjeto(filePath, root);
      if (found && found.toLowerCase() !== target.toLowerCase()) {
        try { return await readAt(found); } catch (_) { /* fall through */ }
      }
      return err(`File not found: "${filePath}" anywhere in the project. Use get_project_tree to list all available paths.`);
    }
  },

  /** Create (or overwrite) a file with `content`, then refresh the tree.
   *  .v/.sv/.vh files are auto-registered in synthesizableFiles so they
   *  appear in the file tree immediately without a manual import step. */
  async createFile(filePath: string | null | undefined, content: unknown = '') {
    if (!filePath) return err('filePath required');
    try {
      await electronAPI.writeFile(filePath, String(content ?? ''));

      // Magic-wand sweep across the editor when the AI rewrites a file
      // the user has open. We call setActiveText through the underlying
      // model so the editor view reflects the new content AND triggers
      // the purple sweep, without this, the file on disk changed but
      // Monaco still shows the previous buffer until the user re-opens it.
      try {
        const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
        const ed = activeEditor();
        const model = ed?.getModel?.();
        const uri = model?.uri?.fsPath || model?.uri?.path || '';
        if (model && uri && uri.replace(/\\/g, '/').toLowerCase() === norm) {
          model.setValue(String(content ?? ''));
          magicWandReveal(ed);
        }
      } catch (_) { /* wand is cosmetic — never let it block the write */ }

      // Auto-register Verilog files in the SPF so they show up in the tree.
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      if (['v', 'sv', 'vh'].includes(ext)) {
        const spfPath = ProjectStore.getSpfPath();
        if (spfPath) {
          const name = filePath.split(/[\\/]/).pop();
          const normPath = filePath.replace(/\\/g, '/').toLowerCase();
          await SpfStore.update(spfPath, (cfg) => {
            const synth = Array.isArray(cfg.synthesizableFiles) ? cfg.synthesizableFiles : [];
            const tb   = Array.isArray(cfg.testbenchFiles)     ? cfg.testbenchFiles     : [];
            const alreadyIn =
              synth.some((f) => (f.path || '').replace(/\\/g, '/').toLowerCase() === normPath) ||
              tb.some((f)   => (f.path || '').replace(/\\/g, '/').toLowerCase() === normPath);
            if (!alreadyIn) {
              synth.push({ name, path: filePath, isTopLevel: false });
              cfg.synthesizableFiles = synth;
            }
          });
          // SpfStore.update fires aurora:spf-changed → file tree re-renders.
          return ok({ filePath });
        }
      }

      await atualizarArvore();
      emit('project:file-created', { filePath });
      return ok({ filePath });
    } catch (e) { return err((e as Error | null)?.message || 'createFile failed'); }
  },

  async createFolder(dirPath: string | null | undefined) {
    if (!dirPath) return err('dirPath required');
    try {
      await electronAPI.mkdir(dirPath);
      await atualizarArvore();
      return ok({ dirPath });
    } catch (e) { return err((e as Error | null)?.message || 'createFolder failed'); }
  },

  /** Delete a file or directory, then refresh the tree. */
  async deleteFile(filePath: string | null | undefined) {
    if (!filePath) return err('filePath required');
    try {
      await electronAPI.deleteFileOrDirectory(filePath);
      await atualizarArvore();
      emit('project:file-deleted', { filePath });
      return ok({ filePath });
    } catch (e) { return err((e as Error | null)?.message || 'deleteFile failed'); }
  },

  /** Rename/move a file (copy to the new path, drop the old one). */
  async renameFile(fromPath: string | null | undefined, toPath: string | null | undefined) {
    if (!fromPath || !toPath) return err('fromPath and toPath required');
    try {
      await electronAPI.copyFile(fromPath, toPath);
      await electronAPI.deleteFileOrDirectory(fromPath);
      await atualizarArvore();
      emit('project:file-renamed', { fromPath, toPath });
      return ok({ fromPath, toPath });
    } catch (e) { return err((e as Error | null)?.message || 'renameFile failed'); }
  },

  /**
   * The project's MISSING files, paths the .spf still references but that no
   * longer exist on disk (moved, renamed, or deleted outside Aurora). This is
   * the same list the file tree surfaces in its "missing files" warning, kept
   * current by every project load / .spf change / disk-watch refresh. Returns
   * { count, files:[{name, path, category}] }; empty when nothing is missing
   * or no project is open.
   */
  async getMissingFiles() {
    const mgr = arvore();
    const missing = Array.isArray(mgr?.missingFiles) ? mgr.missingFiles : [];
    return ok({
      count: missing.length,
      files: missing.map((f) => ({
        name: f.name,
        path: f.path,
        category: f.category || null,
      })),
    });
  },

  /**
   * Dismiss the missing-files warning by pruning every dangling reference
   * from the .spf (the synthesizable / testbench lists, and the top-level /
   * testbench pointers if they point at a missing file). The on-disk files are
   * already gone, this only cleans up the project's references. No
   * confirmation: the caller (the AI, on the user's explicit request) owns
   * that decision. Returns { removed }, how many references were pruned.
   */
  async dismissMissingFiles() {
    const mgr = arvore();
    if (!mgr || typeof mgr.dismissMissingFiles !== 'function') {
      return err('project tree not available');
    }
    try {
      const removed = await mgr.dismissMissingFiles();
      emit('project:missing-files-dismissed', { removed });
      return ok({ removed });
    } catch (e) {
      return err((e as Error | null)?.message || 'dismissMissingFiles failed');
    }
  },

  /**
   * Import an existing Verilog/cocotb file (.v / .sv / .vh / .py) into the open
   * project: copies it to the project root if it lives elsewhere and
   * registers it in the SPF (synthesizable / testbench list).
   */
  async importFile({ filePath, kind = null }: { filePath?: string; kind?: string | null } = {}) {
    if (!filePath) return err('filePath required');
    const spfPath = ProjectStore.getSpfPath();
    if (!spfPath) return err('No project open');
    const projectRoot = ProjectStore.getProjectPath();
    if (!projectRoot) return err('Project root unavailable');
    const nameHint = filePath.split(/[\\/]/).pop() || '';
    const normalizedKind = kind || (/\.py$/i.test(nameHint) ? 'testbench' : 'synthesizable');
    const targetList = normalizedKind === 'testbench' ? 'testbenchFiles' : 'synthesizableFiles';
    try {
      // Copy into the project if the source lives outside the project root.
      const sep = projectRoot.includes('\\') ? '\\' : '/';
      const normRoot = projectRoot.replace(/\\/g, '/').toLowerCase();
      const normSrc  = filePath.replace(/\\/g, '/').toLowerCase();
      let finalPath = filePath;
      if (!normSrc.startsWith(normRoot + '/')) {
        const base = filePath.split(/[\\/]/).pop();
        finalPath = `${projectRoot}${sep}${base}`;
        await electronAPI.copyFile(filePath, finalPath);
      }
      const name = finalPath.split(/[\\/]/).pop();
      const normFinal = finalPath.replace(/\\/g, '/').toLowerCase();
      await SpfStore.update(spfPath, (cfg) => {
        const arr = Array.isArray(cfg[targetList]) ? cfg[targetList] : [];
        const already = arr.some((f) => (f.path || '').replace(/\\/g, '/').toLowerCase() === normFinal);
        if (!already) arr.push({ name, path: finalPath, isTopLevel: false });
        cfg[targetList] = arr;
      });
      await atualizarArvore();
      emit('project:file-imported', { filePath: finalPath, kind: normalizedKind });
      return ok({ filePath: finalPath, kind: normalizedKind });
    } catch (e) {
      return err((e as Error | null)?.message || 'importFile failed');
    }
  },

  /** Remove a file from the SPF lists. Optionally delete it from disk. */
  async removeImportedFile({ filePath, deleteFromDisk = false }: { filePath?: string; deleteFromDisk?: boolean } = {}) {
    if (!filePath) return err('filePath required');
    const spfPath = ProjectStore.getSpfPath();
    if (!spfPath) return err('No project open');
    try {
      const norm = filePath.replace(/\\/g, '/').toLowerCase();
      let removed = false;
      await SpfStore.update(spfPath, (cfg) => {
        for (const key of ['synthesizableFiles', 'testbenchFiles']) {
          const arr = Array.isArray(cfg[key]) ? cfg[key] : [];
          const filtered = arr.filter((f) => {
            const match = (f.path || '').replace(/\\/g, '/').toLowerCase() === norm;
            if (match) removed = true;
            return !match;
          });
          cfg[key] = filtered;
        }
      });
      if (deleteFromDisk) {
        try { await electronAPI.deleteFileOrDirectory(filePath); }
        catch (_) { /* removing from SPF still counts as success */ }
      }
      await atualizarArvore();
      emit('project:file-removed', { filePath, deletedFromDisk: !!deleteFromDisk });
      return ok({ filePath, removed, deletedFromDisk: !!deleteFromDisk });
    } catch (e) {
      return err((e as Error | null)?.message || 'removeImportedFile failed');
    }
  },

  /** Rename an imported file on disk and update its SPF entry. */
  async renameImportedFile({ fromPath, toPath }: { fromPath?: string; toPath?: string } = {}) {
    if (!fromPath || !toPath) return err('fromPath and toPath required');
    const spfPath = ProjectStore.getSpfPath();
    if (!spfPath) return err('No project open');
    try {
      const fromNorm = fromPath.replace(/\\/g, '/').toLowerCase();
      // Copy + delete (matches renameFile above, true rename can fail
      // across drives on Windows).
      await electronAPI.copyFile(fromPath, toPath);
      await electronAPI.deleteFileOrDirectory(fromPath);
      const newName = toPath.split(/[\\/]/).pop();
      await SpfStore.update(spfPath, (cfg) => {
        for (const key of ['synthesizableFiles', 'testbenchFiles']) {
          const arr = Array.isArray(cfg[key]) ? cfg[key] : [];
          for (const f of arr) {
            if ((f.path || '').replace(/\\/g, '/').toLowerCase() === fromNorm) {
              f.path = toPath;
              f.name = newName;
            }
          }
          cfg[key] = arr;
        }
      });
      await atualizarArvore();
      emit('project:file-renamed', { fromPath, toPath });
      return ok({ fromPath, toPath });
    } catch (e) {
      return err((e as Error | null)?.message || 'renameImportedFile failed');
    }
  },

  /**
   * Force a fresh repaint of the project file tree. Useful after the
   * model creates/imports a file via tools that the regular SPF events
   * didn't reach (or when the tree is suspected of being stale).
   */
  async refreshTree() {
    try {
      // Two-pronged: the main-process file watcher refresh AND the
      // renderer's ProjectTreeManager reload. Either alone covers the
      // most-common race, both together cover all of them.
      await electronAPI?.triggerFileTreeRefresh?.();
    } catch (_) { /* best-effort */ }
    try {
      await arvore()?.refreshTree?.();
    } catch (e) {
      return err((e as Error | null)?.message || 'refreshTree failed');
    }
    emit('project:tree-refreshed', null);
    return ok();
  },

  /**
   * Switch the left panel between the file tree and the post-synthesis
   * hierarchy tree. The hierarchy view is only available after a
   * successful Verilog compilation (hierarchyData is populated by the
   * compile flow); calling setView('hierarchy') before then returns an
   * error telling the model what to do.
   */
  async setView(mode: string | null | undefined) {
    const ctl = controlador();
    if (!ctl) return err('file tree controller not initialised');
    if (mode === 'file' || mode === 'verilog' || mode === 'files') {
      ctl.showFileMode();
      return ok({ view: ctl.getActiveView?.() || 'verilog' });
    }
    if (mode === 'hierarchy' || mode === 'hierarchical') {
      if (!ctl.getHierarchyData?.()) {
        return err('hierarchy view is only available after a successful Verilog compilation — call compile_step("verilog") first');
      }
      const okSwitch = ctl.showHierarchyMode();
      return okSwitch ? ok({ view: 'hierarchy' }) : err('could not switch to hierarchy view');
    }
    return err(`unknown view: ${mode} — use "file" or "hierarchy"`);
  },

  /** Report which tree view is currently active. */
  async getView() {
    const ctl = controlador();
    if (!ctl) return ok({ view: 'unknown', hierarchyAvailable: false });
    return ok({
      view: ctl.getActiveView?.() || 'verilog',
      hierarchyAvailable: !!ctl.getHierarchyData?.(),
    });
  },
};
