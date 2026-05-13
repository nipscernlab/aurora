// ADDED: Export the class to make it importable
export class RecentProjectsManager {
  constructor(loadProjectCallback, showErrorDialogCallback) {
    // openProject = injected function that actually opens a .spf in the IDE.
    // Kept under a distinct name so it does not shadow loadFromStorage().
    this.openProject = loadProjectCallback;
    this.showErrorDialog = showErrorDialogCallback;

    this.projects = [];
    this.maxProjects = 10;
    this.storageKey = 'aurora-recent-projects';
    this.listElement = document.getElementById('recent-projects-list');
    this.countElement = document.getElementById('projects-count');
    this.emptyState = document.getElementById('empty-state');

    this.loadFromStorage();
    this.render();
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
  async checkProjectExists(project) {
    try {
      // electronAPI expõe `fileExists` / `pathExists` (não `checkFileExists`).
      const probe = window.electronAPI?.fileExists ?? window.electronAPI?.pathExists;
      if (probe) {
        const exists = await probe(project.path);
        if (!exists) {
          this.removeProject(project.path);
          return false;
        }
      }
      return true;
    } catch (error) {
      console.error('Error checking project existence:', error);
      this.removeProject(project.path);
      return false;
    }
  }

  // Handle project click
  async handleProjectClick(project) {
    try {
      const exists = await this.checkProjectExists(project);
      if (!exists) {
        // MODIFIED: Use the injected function
        this.showErrorDialog('Project Not Found', `The project file "${project.name}" could not be found and has been removed from recent projects.`);
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
      // MODIFIED: Use the injected function
      this.showErrorDialog('Error Opening Project', error.message);
      this.removeProject(project.path);
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

  // Create project item element
  createProjectItem(project) {
    const item = document.createElement('div');
    item.className = 'project-item';
    item.title = project.path;

    // VS Code-style: project name as primary link text, full path muted to
    // its right. Date and icon dropped; the path itself is enough context.
    item.innerHTML = `
      <span class="project-name">${this.escapeHtml(project.name)}</span>
      <span class="project-path">${this.escapeHtml(this.truncatePath(project.path))}</span>
      <button class="project-remove" title="Remove from recent projects" aria-label="Remove from recent projects">
        <i class="ph ph-x"></i>
      </button>
    `;

    item.addEventListener('click', (e) => {
      if (!e.target.closest('.project-remove')) {
        this.handleProjectClick(project);
      }
    });

    const removeBtn = item.querySelector('.project-remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      item.classList.add('removing');
      setTimeout(() => {
        this.removeProject(project.path);
      }, 200);
    });

    return item;
  }

  // Escape HTML to prevent XSS
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Truncate path for display. Returns the parent directory of the .spf,
  // collapsing the home directory to ~ on Unix. Visual overflow is also
  // handled by CSS (text-overflow: ellipsis), so this keeps the textual
  // form readable but doesn't have to be ultra-short.
  truncatePath(path) {
    if (!path) return '';
    // Drop the .spf filename — VS Code shows the parent folder, not the file.
    let display = path.replace(/[\\/][^\\/]+\.spf$/i, '');
    // Collapse the user's home dir to ~ for compactness.
    const home = (typeof window !== 'undefined' && window.electronAPI?.homePath) || null;
    if (home && display.startsWith(home)) {
      display = '~' + display.slice(home.length);
    }
    return display;
  }

  // Render the projects list
  render() {
    if (!this.listElement || !this.countElement) {
      return;
    }

    this.countElement.textContent = this.projects.length > 0 ? this.projects.length : '';
    this.listElement.innerHTML = '';

    if (this.projects.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      // data-i18n on the inner <p> so a locale flip retranslates the
      // string without re-rendering the whole recent list.
      const tr = (k) => (window.t ? window.t(k) : k);
      emptyState.innerHTML = `<p data-i18n="welcome.noRecent">${tr('welcome.noRecent')}</p>`;
      this.listElement.appendChild(emptyState);
    } else {
      this.projects.forEach((project, index) => {
        const item = this.createProjectItem(project);
        this.listElement.appendChild(item);
        setTimeout(() => {
          item.classList.add('new-item');
        }, index * 50);
      });
    }
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

