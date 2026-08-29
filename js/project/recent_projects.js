import { electronAPI } from '../app/electron_api.js';
import { showAlert } from '../ui/dialog_manager.js';
import { showCardNotification } from '../ui/notification.js';
import { ProjectStore } from './project_store.js';
import '../components/aurora-welcome.js';
import { motivoDe } from '../app/api_reply.js';

// ADDED: Export the class to make it importable
export class RecentProjectsManager {
  constructor(loadProjectCallback, showErrorDialogCallback) {
    // openProject = injected function that actually opens a .spf in the IDE.
    // Kept under a distinct name so it does not shadow loadFromStorage().
    this.openProject = loadProjectCallback;
    // O segundo parametro e opcional, e o unico chamador (renderer.js) nunca
    // o passou: showErrorDialog ficava undefined e explodia com "is not a
    // function" exatamente na hora de AVISAR o usuario, clicar num recente
    // cuja pasta foi apagada. A reserva e o dialogo padrao do aplicativo.
    this.showErrorDialog = typeof showErrorDialogCallback === 'function'
      ? showErrorDialogCallback
      : (title, message) => showAlert(message, 'warning', title);

    this.projects = [];
    this.maxProjects = 10;
    this.storageKey = 'aurora-recent-projects';
    // View: the <aurora-welcome> Lit component renders the Start/Recent stage.
    // We drive its `.projects` and react to the events it emits (a row opened /
    // its × clicked). The New/Open buttons delegate to the toolbar themselves.
    this.welcomeEl = document.querySelector('aurora-welcome');
    if (this.welcomeEl) {
      this.welcomeEl.addEventListener('project-open', (e) => this._handleOpenByPath(e.detail));
      this.welcomeEl.addEventListener('project-remove', (e) => this.removeProject(e.detail));
      this.welcomeEl.addEventListener('recent-forget-missing', () => {
        const n = this.forgetMissing();
        if (n) this._enrichProcessors();
      });
      // Localizar no disco: um projeto, ou todos os ausentes de uma vez. A
      // varredura e uma so no main; pedir mais um projeto com ela viva so
      // acrescenta alvo.
      this.welcomeEl.addEventListener('project-locate', (e) => this.locate([e.detail]));
      this.welcomeEl.addEventListener('recent-locate-missing', () => {
        this.locate(this.projects.filter((p) => p._missing).map((p) => p.path));
      });
      this.welcomeEl.addEventListener('recent-locate-cancel', () => this.cancelLocate());
    }

    this.loadFromStorage();
    this.render();
    this._enrichProcessors(); // async: read each .spf's processor list for the hover preview

    // A Welcome reaparece quando o projeto fecha, e a lista pode ter
    // envelhecido desde o arranque (pendrive removido, pasta apagada com o
    // app aberto). Conferir a existencia a cada volta e barato (um stat por
    // entrada) e e o que mantem o risco de "clicar num morto" no minimo. A
    // conferencia so MARCA; quem remove e sempre o usuario.
    try {
      ProjectStore.subscribe(() => {
        if (!ProjectStore.getProjectPath()) this._checkExistence();
      });
    } catch (_) { /* sem store (teste isolado), a checagem do arranque vale */ }
    this._checkExistence();   // async: risca os que sumiram do disco
  }

  // Read a project's processor names from its .spf (JSON) for the welcome hover
  // preview. Best-effort, cached on the project object so it reads only once.
  async _readProcessors(spfPath) {
    try {
      const content = await electronAPI?.readFile?.(spfPath);
      if (!content) return [];
      const procs = JSON.parse(content)?.structure?.processors;
      return Array.isArray(procs) ? procs.map((p) => p && p.name).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  async _enrichProcessors() {
    await Promise.all(this.projects.map(async (p) => {
      if (p._procs === undefined) p._procs = await this._readProcessors(p.path);
    }));
    this.render();
  }

  /**
   * Marca os projetos cujo .spf nao existe mais.
   *
   * A lista era so memoria: um projeto movido ou apagado continuava ali, com
   * cara de bom, e so ao clicar aparecia o erro. Marcar antes do clique e
   * honesto e barato, e e o que permite o "esquecer os ausentes".
   *
   * Isto NAO remove nada sozinho. Um disco de rede fora do ar, ou um pendrive
   * desconectado, deixariam o projeto ausente por um momento; apagar por conta
   * propria perderia a entrada de quem so precisava reconectar.
   */
  async _checkExistence() {
    await Promise.all(this.projects.map(async (p) => {
      try { p._missing = !(await electronAPI?.fileExists?.(p.path)); }
      catch (_) { p._missing = false; }
    }));
    this.render();
  }

  /**
   * Procura no disco os .spf das entradas ausentes em `paths`.
   *
   * O trabalho e do main (recents:locate-*): la vive UMA varredura para
   * varios alvos, porque quem perdeu uma pasta costuma ter perdido varias, e
   * varrer o disco uma vez por projeto multiplicaria o custo. Aqui fica so o
   * estado visual e a reacao aos eventos: achou -> regrava o caminho na
   * entrada; terminou -> desmarca quem sobrou e avisa.
   */
  async locate(paths) {
    const alvos = [];
    for (const caminho of paths || []) {
      const p = this.projects.find((x) => x.path === caminho);
      if (!p || !p._missing || p._locating) continue;
      p._locating = true;
      alvos.push({ key: p.path, basename: p.path.split(/[\\/]/).pop() });
    }
    if (!alvos.length) return;
    this._ensureLocateListener();
    this.render();
    try {
      const r = await electronAPI.locateRecentsStart?.(alvos);
      if (!r?.ok) throw new Error(motivoDe(r, 'locate failed'));
    } catch (e) {
      for (const a of alvos) {
        const p = this.projects.find((x) => x.path === a.key);
        if (p) p._locating = false;
      }
      this.render();
      showCardNotification(String(e?.message || e), 'error', 4000);
    }
  }

  cancelLocate() {
    try { electronAPI.locateRecentsCancel?.(); } catch (_) { /* main ja foi */ }
  }

  _ensureLocateListener() {
    if (this._locateUnsub) return;
    this._locateUnsub = electronAPI.onRecentsLocate?.((ev) => {
      if (ev.type === 'progress') {
        this._locateScanned = ev.scanned;
        if (this.welcomeEl) this.welcomeEl.locateScanned = ev.scanned;
        return;
      }
      if (ev.type === 'found') {
        const p = this.projects.find((x) => x.path === ev.key);
        if (p) {
          // O caminho novo substitui o antigo NA MESMA entrada: historico de
          // abertura e nome ficam; so o endereco muda, que e o que mudou no
          // disco.
          p.path = ev.path;
          p._missing = false;
          p._locating = false;
          p._procs = undefined;
          this.saveProjects();
          this.render();
          this._enrichProcessors();
          const tr = (k, fb, pr) => (window.t ? window.t(k, pr) : null) || fb;
          showCardNotification(
            tr('welcome.locateFound', 'Found: ' + ev.path, { path: ev.path }),
            'success', 4000,
          );
        }
        return;
      }
      if (ev.type === 'done') {
        this._locateScanned = 0;
        if (this.welcomeEl) this.welcomeEl.locateScanned = 0;
        let sobraram = 0;
        for (const chave of ev.remaining || []) {
          const p = this.projects.find((x) => x.path === chave);
          if (p && p._locating) { p._locating = false; sobraram++; }
        }
        // Cancelamento tambem desmarca quem ainda girava.
        for (const p of this.projects) if (p._locating) { p._locating = false; }
        this.render();
        if (sobraram) {
          const tr = (k, fb) => (window.t ? window.t(k) : null) || fb;
          showCardNotification(
            tr('welcome.locateNotFound', 'Some projects were not found on this machine.'),
            'info', 5000,
          );
        }
      }
    });
  }

  /** Quantos estao ausentes agora. Zero esconde o botao de esquecer. */
  countMissing() {
    return this.projects.filter((p) => p._missing).length;
  }

  /** Tira da lista todos os ausentes. So o usuario dispara isto. */
  forgetMissing() {
    const antes = this.projects.length;
    this.projects = this.projects.filter((p) => !p._missing);
    if (this.projects.length === antes) return 0;
    this.saveProjects();
    this.render();
    return antes - this.projects.length;
  }

  // Load the recent-projects list from localStorage.
  loadFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.projects = JSON.parse(stored);
        this.projects = this.projects.filter(project => 
          project && project.path && project.name && project.lastOpened
        );
      }
    } catch (error) {
      console.error('Error loading recent projects:', error);
      this.projects = [];
    }
  }

  // Save projects to localStorage
  saveProjects() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.projects));
    } catch (error) {
      console.error('Error saving recent projects:', error);
    }
  }

  // Add a new project to the recent list
  addProject(spfPath) {
    if (!spfPath || !spfPath.endsWith('.spf')) {
      return;
    }

    try {
      const projectName = this.extractProjectName(spfPath);
      const now = new Date().toISOString();
      
      this.projects = this.projects.filter(p => p.path !== spfPath);
      
      this.projects.unshift({
        name: projectName,
        path: spfPath,
        lastOpened: now
      });
      
      if (this.projects.length > this.maxProjects) {
        this.projects = this.projects.slice(0, this.maxProjects);
      }
      
      this.saveProjects();
      this.render();
      this._enrichProcessors();

      console.log('Added project to recent list:', projectName);
    } catch (error) {
      console.error('Error adding project to recent list:', error);
    }
  }

  // Extract project name from .spf file path
  extractProjectName(spfPath) {
    const fileName = spfPath.split(/[/\\]/).pop();
    return fileName.replace('.spf', '');
  }

  // Remove a project from the recent list
  removeProject(spfPath) {
    this.projects = this.projects.filter(p => p.path !== spfPath);
    this.saveProjects();
    this.render();
  }

  // Check if project file exists and remove if not
  /**
   * So responde SE o .spf existe; nunca mexe na lista. A versao antiga
   * apagava a entrada aqui dentro, entao um clique em projeto de pendrive
   * desconectado (ou uma sonda que falhou) custava o atalho inteiro.
   * Ausencia se marca com o risco (_missing); apagar e gesto do usuario.
   */
  async checkProjectExists(project) {
    try {
      // electronAPI expõe `fileExists` / `pathExists` (não `checkFileExists`).
      const probe = electronAPI?.fileExists ?? electronAPI?.pathExists;
      if (probe) return !!(await probe(project.path));
      return true;
    } catch (error) {
      console.error('Error checking project existence:', error);
      return true; // erro de sonda nao e prova de ausencia
    }
  }

  // Handle project click
  async handleProjectClick(project) {
    try {
      const exists = await this.checkProjectExists(project);
      if (!exists) {
        // Riscar, nunca apagar: a entrada fica na lista com a lupa ao lado,
        // que e o caminho para reencontrar um projeto so movido de pasta.
        project._missing = true;
        this.render();
        const tr = (k, fb) => {
          const v = window.t ? window.t(k) : null;
          return (v && v !== k) ? v : fb;
        };
        this.showErrorDialog(
          tr('welcome.clickMissingTitle', 'Project not found'),
          tr('welcome.clickMissingMessage', 'The project file "{{name}}" was not found on disk. It stays struck through in the recents list; use the magnifier button to search this computer for it.').replace('{{name}}', project.name),
        );
        return;
      }

      project.lastOpened = new Date().toISOString();
      this.saveProjects();
      this.render();

      if (typeof TabManager !== 'undefined' && TabManager.closeAllTabs) {
        await TabManager.closeAllTabs();
      }

      await this.openProject(project.path);
      
      console.log(`Opened recent project: ${project.name}`);
    } catch (error) {
      console.error('Error opening project:', error);
      this.showErrorDialog('Error Opening Project', error.message);
      // Falha de abertura tambem nao apaga a entrada: um erro transitorio
      // (disco de rede, permissao) nao pode custar o atalho. Reavalia o
      // risco na lista e a decisao fica com o usuario.
      this._checkExistence();
    }
  }

  // Format date for display
  formatDate(dateString) {
    try {
      const date = new Date(dateString);
      const now = new Date();
      const diff = now - date;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const days = Math.floor(hours / 24);

      if (hours < 1) return 'Just now';
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      
      return date.toLocaleDateString();
    } catch (error) {
      return 'Unknown';
    }
  }

  // A recent row was clicked in the <aurora-welcome> view, open that project.
  // (The view escapes its own text bindings and animates the rows; this manager
  // keeps the data + the open/remove actions.)
  _handleOpenByPath(path) {
    const project = this.projects.find((p) => p.path === path);
    if (project) this.handleProjectClick(project);
  }

  // Truncate path for display. Returns the parent directory of the .spf,
  // collapsing the home directory to ~ on Unix. Visual overflow is also
  // handled by CSS (text-overflow: ellipsis), so this keeps the textual
  // form readable but doesn't have to be ultra-short.
  truncatePath(path) {
    if (!path) return '';
    // Drop the .spf filename, VS Code shows the parent folder, not the file.
    let display = path.replace(/[\\/][^\\/]+\.spf$/i, '');
    // Collapse the user's home dir to ~ for compactness.
    const home = (typeof window !== 'undefined' && electronAPI?.homePath) || null;
    if (home && display.startsWith(home)) {
      display = '~' + display.slice(home.length);
    }
    return display;
  }

  // Drive the <aurora-welcome> view: it renders the count, the rows (with the
  // open-stagger + remove animation) and the empty state from this data. The
  // view re-renders itself on locale change, so we only push raw project data.
  render() {
    if (!this.welcomeEl) return;
    this.welcomeEl.projects = this.projects.map((p) => ({
      name: p.name,
      path: p.path,
      displayPath: this.truncatePath(p.path),
      processors: p._procs || [],
      missing: !!p._missing,
      locating: !!p._locating,
    }));
    this.welcomeEl.missingCount = this.countMissing();
    this.welcomeEl.locatingCount = this.projects.filter((p) => p._locating).length;
  }

  // Other methods (clearAll, getProjects, etc.) remain the same...
  clearAll() {
    this.projects = [];
    this.saveProjects();
    this.render();
  }

  getProjects() {
    return [...this.projects];
  }

  setVisible(visible) {
    const section = document.querySelector('.recent-projects-section');
    if (section) {
      section.classList.toggle('hidden', !visible);
    }
  }
  
}

