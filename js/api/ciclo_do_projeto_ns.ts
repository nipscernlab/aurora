/**
 * ciclo_do_projeto_ns.ts: o ciclo do projeto, parte do namespace
 * `AuroraAPI.project` (fechar, o projeto atual, criar, abrir, recentes,
 * backup, e marcar o topo de sintese e o de simulacao).
 *
 * Saiu do js/api/aurora_api.js (item 13.3 do TODO). O projeto e o .spf vem
 * do ProjectStore e do SpfStore importados, e nao de window. `setTopLevel` e
 * `setTestbenchTop` eram espelhos um do outro, trocando so qual lista e qual
 * ponteiro do .spf; agora e uma implementacao so (`marcarTopo`).
 *
 * Compilado por `tsc` (npm run build:ts) num ciclo_do_projeto_ns.js ao lado,
 * e esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { ok, err, emit } from './api_core.js';

/** Qual topo: a lista que ele entra, a que ele sai, e os dois ponteiros. */
interface TipoDeTopo {
  lista: 'synthesizableFiles' | 'testbenchFiles';
  outraLista: 'synthesizableFiles' | 'testbenchFiles';
  ponteiro: 'topLevelFile' | 'testbenchFile';
  outroPonteiro: 'topLevelFile' | 'testbenchFile';
  falha: string;
}

const TOPO_DE_SINTESE: TipoDeTopo = {
  lista: 'synthesizableFiles', outraLista: 'testbenchFiles',
  ponteiro: 'topLevelFile', outroPonteiro: 'testbenchFile',
  falha: 'setTopLevel failed',
};
const TOPO_DE_SIMULACAO: TipoDeTopo = {
  lista: 'testbenchFiles', outraLista: 'synthesizableFiles',
  ponteiro: 'testbenchFile', outroPonteiro: 'topLevelFile',
  falha: 'setTestbenchTop failed',
};

type Entrada = { name?: string; path?: string; isTopLevel?: boolean };

/**
 * Marca o arquivo como o topo do tipo pedido. Ele sai da outra lista (e o
 * ponteiro dela se apaga, se apontava para ele), entra na lista do tipo se
 * ainda nao estava, e fica sendo o unico marcado nela. A arvore se redesenha
 * pelo aurora:spf-changed.
 */
async function marcarTopo(tipo: TipoDeTopo, filePath: string | null | undefined) {
  const spfPath = ProjectStore.getSpfPath();
  if (!spfPath) return err('No project open');
  const root = ProjectStore.getProjectPath();
  if (!root) return err('No project open');
  if (!filePath) return err('filePath required');
  const isAbs = /^[a-zA-Z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\');
  const absPath = isAbs ? filePath : `${root}\\${filePath.replace(/^[\\/]+/, '')}`;
  const norm = (p: string | undefined) => (p || '').replace(/\\/g, '/').toLowerCase();
  const targetKey = norm(absPath);
  const name = absPath.split(/[\\/]/).pop();
  try {
    await SpfStore.update(spfPath, (cfg) => {
      const c = cfg as unknown as Record<string, unknown>;
      const outra = (Array.isArray(c[tipo.outraLista]) ? c[tipo.outraLista] : []) as Entrada[];
      const semEle = outra.filter((f) => norm(f.path) !== targetKey);
      if (semEle.length !== outra.length) {
        c[tipo.outraLista] = semEle;
        if (norm((c[tipo.outroPonteiro] as string) || '') === targetKey) c[tipo.outroPonteiro] = '';
      }
      const arr = (Array.isArray(c[tipo.lista]) ? c[tipo.lista] : []) as Entrada[];
      let entry = arr.find((f) => norm(f.path) === targetKey);
      if (!entry) { entry = { name, path: absPath, isTopLevel: false }; arr.push(entry); }
      for (const f of arr) f.isTopLevel = (f === entry);
      c[tipo.lista] = arr;
      c[tipo.ponteiro] = absPath;
    });
    return ok({ filePath: absPath });
  } catch (e) { return err((e as Error | null)?.message || tipo.falha); }
}

export const cicloDoProjeto = {
  /**
   * Fecha o projeto aberto, devolvendo a IDE ao estado sem projeto.
   *
   * Passa pelo botao da interface de proposito, e nao por uma rotina paralela:
   * o fechamento pergunta sobre arquivos nao salvos, limpa a arvore, o terminal
   * e o estado de compilacao, e duplicar isso aqui seria duplicar a chance de
   * esquecer um passo. O dialogo de confirmacao continua aparecendo, entao o
   * usuario segue com a ultima palavra.
   */
  async close() {
    if (!ProjectStore.getProjectPath()) return err('No project open');
    const botao = document.querySelector<HTMLElement>('#close-button');
    if (!botao) return err('Close-project control not available');
    botao.click();
    return ok({ requested: true, message: 'Close requested; the user confirms in the dialog.' });
  },

  async getCurrent() {
    const path = ProjectStore.getProjectPath();
    if (!path) return ok(null);
    try {
      const info = await electronAPI?.getProjectInfo?.(path);
      return ok({ path, info: info || null });
    } catch (e) {
      return ok({ path, info: null, infoError: (e as Error | null)?.message || String(e) });
    }
  },

  /**
   * Create a new SAPHO project at `location\name` and open it.
   * `name` must be free of spaces/symbols (project convention).
   */
  async createProject({ name, location }: { name?: string; location?: string } = {}) {
    if (!name || !location) return err('name and location required');
    if (/[^A-Za-z0-9_-]/.test(name)) {
      return err('project name may only contain letters, numbers, _ and -');
    }
    try {
      const projectPath = `${location}\\${name}`;
      const spfPath = `${projectPath}\\${name}.spf`;
      const r = await electronAPI.createProjectStructure(projectPath, spfPath, name);
      if (!r || !r.success) return err((r && r.message) || 'createProject failed');
      if (window.projectManager?.loadProject) {
        await window.projectManager.loadProject(spfPath);
      }
      emit('project:created', { name, spfPath });
      return ok({ name, projectPath, spfPath });
    } catch (e) { return err((e as Error | null)?.message || 'createProject failed'); }
  },

  /** Open an existing project by its .spf file. */
  async openProject(spfPath: string | null | undefined) {
    if (!spfPath) return err('spfPath required');
    try {
      if (window.projectManager?.loadProject) {
        await window.projectManager.loadProject(spfPath);
      } else {
        await electronAPI.openProject(spfPath);
      }
      return ok({ spfPath });
    } catch (e) { return err((e as Error | null)?.message || 'openProject failed'); }
  },

  /**
   * Recently-opened projects. Pulls from main's `recents.js` store
   * (prune-on-read, so stale paths whose .spf has been deleted drop
   * out). Returns an array of `{ spfPath, name }` ordered most-recent-first.
   */
  async listRecents() {
    try {
      if (typeof electronAPI?.listRecentProjects === 'function') {
        const paths = await electronAPI.listRecentProjects();
        const list = (paths || []).map((p: string) => {
          const base = String(p).split(/[\\/]/).pop() || p;
          const name = base.replace(/\.spf$/i, '');
          return { spfPath: p, name };
        });
        return ok(list);
      }
      // Fallback: the welcome screen also persists recents in localStorage.
      const cached = JSON.parse(localStorage.getItem('aurora-recent-projects') || '[]');
      const list = (Array.isArray(cached) ? cached : []).map((p) => ({
        spfPath: p,
        name: String(p).split(/[\\/]/).pop()!.replace(/\.spf$/i, ''),
      }));
      return ok(list);
    } catch (e) {
      return err((e as Error | null)?.message || 'listRecents failed');
    }
  },

  /**
   * Create a timestamped backup of the currently open project. Drives
   * the existing `create-backup` IPC (PowerShell Compress-Archive) so
   * the zip ends up in `<projectRoot>/Backup/`. Returns the resolved
   * archive path parsed out of the IPC's success message.
   */
  async backup() {
    const projectRoot = ProjectStore.getProjectPath();
    if (!projectRoot) return err('No project is open');
    if (typeof electronAPI?.createBackup !== 'function') {
      return err('Backup IPC unavailable');
    }
    try {
      const r = await electronAPI.createBackup(projectRoot);
      if (!r || r.success === false) {
        return err(r?.message || 'backup failed');
      }
      // The IPC tucks the absolute archive path inside `message`:
      // "Backup created at: <abs path>". Pull it back out so the AI
      // and any UI surface can show it without re-parsing the string.
      const m = String(r.message || '').match(/Backup created at:\s*(.+)$/);
      return ok({ archivePath: m ? m[1] : null, message: r.message || '' });
    } catch (e) {
      return err((e as Error | null)?.message || 'createBackup failed');
    }
  },

  /**
   * Mark a synthesizable Verilog file as the project's Top Level module.
   * Adds the file to synthesizableFiles if not yet tracked. The flag is
   * exclusive, any previous top-level loses the mark automatically.
   */
  setTopLevel(filePath: string | null | undefined) { return marcarTopo(TOPO_DE_SINTESE, filePath); },

  /**
   * Mark a Verilog file as the project's Testbench Top module.
   * Adds the file to testbenchFiles if not yet tracked. The mark is
   * exclusive within testbenchFiles.
   */
  setTestbenchTop(filePath: string | null | undefined) { return marcarTopo(TOPO_DE_SIMULACAO, filePath); },

};
