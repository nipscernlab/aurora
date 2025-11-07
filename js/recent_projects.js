// ADDED: Export the class to make it importable
export class RecentProjectsManager {
  // MODIFIED: The constructor now accepts the functions it needs
  constructor(loadProjectCallback, showErrorDialogCallback) {
    // These functions are now stored as properties of the class instance
    this.loadProject = loadProjectCallback;
    this.showErrorDialog = showErrorDialogCallback;

    this.projects = [];
    this.maxProjects = 10;
    this.storageKey = 'aurora-recent-projects';
    this.listElement = document.getElementById('recent-projects-list');
    this.countElement = document.getElementById('projects-count');
    this.emptyState = document.getElementById('empty-state');
    
    // MODIFIED: The method name was incorrect in your original code (loadProject vs loadProject)
    this.loadProject(); 
    this.render();
  }

  // Load projects from localStorage
  // RENAMED: from loadProject to loadProject to be clearer
  loadProject() {
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
      if (window.electronAPI && window.electronAPI.checkFileExists) {
        const exists = await window.electronAPI.checkFileExists(project.path);
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

      // MODIFIED: Use the injected function
      await this.loadProject(project.path);
      
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
    
    item.innerHTML = `
      <div class="project-icon">
        <i class="fa-solid fa-up-right-from-square"></i>
      </div>
      <div class="project-details">
        <div class="project-name">${this.escapeHtml(project.name)}</div>
        <div class="project-path">${this.escapeHtml(this.truncatePath(project.path))}</div>
      </div>
      <div class="project-date">${this.formatDate(project.lastOpened)}</div>
      <button class="project-remove" title="Remove from recent projects">
        <i class="fa-solid fa-times"></i>
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

  // Truncate path for display
  truncatePath(path) {
    const maxLength = 50;
    if (path.length <= maxLength) return path;
    
    const parts = path.split(/[/\\]/);
    if (parts.length > 3) {
      return `.../${parts.slice(-2).join('/')}`;
    }
    
    return path.substring(0, maxLength - 3) + '...';
  }

  // Render the projects list
  render() {
    if (!this.listElement || !this.countElement) {
      return;
    }

    this.countElement.textContent = `${this.projects.length} project${this.projects.length !== 1 ? 's' : ''}`;
    this.listElement.innerHTML = '';

    if (this.projects.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.innerHTML = `
        <i class="fa-solid fa-folder-open empty-state-icon"></i>
        <p class="empty-state-text">No recent projects</p>
        <p class="empty-state-subtext">Open a project to see it appear here</p>
      `;
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
      section.style.display = visible ? 'flex' : 'none';
    }
  }
}
