class SimpleLayoutManager {
  constructor() {
    this.isDragMode = false;
    this.dragging = null;
    this.dragOffset = { x: 0, y: 0 };
    this.containers = [];
    this.dropZones = [];
  }

  init() {
    this.createToggleButton();
    this.setupContainers();
    this.setupEventListeners();
    console.log('Simple Layout Manager initialized');
  }

  createToggleButton() {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'layout-drag-toggle';
    toggleBtn.className = 'toolbar-button';
    toggleBtn.innerHTML = '<i class="fa-solid fa-arrows-alt"></i> <span>Layout Mode</span>';
    toggleBtn.title = 'Toggle layout editing mode';
    
    toggleBtn.addEventListener('click', () => {
      this.toggleDragMode();
    });

    const toolbarRight = document.querySelector('.toolbar-right');
    if (toolbarRight) {
      toolbarRight.insertBefore(toggleBtn, toolbarRight.firstChild);
    }
  }

  setupContainers() {
    const containers = [
      { selector: '.file-tree-container', title: 'File Explorer', id: 'file-tree' },
      { selector: '.editor-container', title: 'Code Editor', id: 'editor' },
      { selector: '#terminal-container', title: 'Terminal', id: 'terminal' }
    ];

    containers.forEach(config => {
      const element = document.querySelector(config.selector);
      if (element) {
        this.setupContainer(element, config);
      }
    });
  }

  setupContainer(element, config) {
    // Adicionar handle de drag
    const handle = document.createElement('div');
    handle.className = 'drag-handle';
    handle.dataset.containerId = config.id;
    handle.innerHTML = `
      <div class="drag-handle-content">
        <i class="fa-solid fa-grip-vertical"></i>
        <span>${config.title}</span>
        <i class="fa-solid fa-arrows-alt"></i>
      </div>
    `;

    element.style.position = 'relative';
    element.insertBefore(handle, element.firstChild);

    // Adicionar container info
    this.containers.push({
      element,
      handle,
      config,
      originalParent: element.parentNode,
      originalPosition: Array.from(element.parentNode.children).indexOf(element)
    });
  }

  setupEventListeners() {
    document.addEventListener('mousedown', (e) => {
      if (!this.isDragMode) return;
      
      const handle = e.target.closest('.drag-handle');
      if (handle) {
        this.startDrag(e, handle);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.dragging) {
        this.onDrag(e);
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (this.dragging) {
        this.endDrag(e);
      }
    });
  }

  toggleDragMode() {
    this.isDragMode = !this.isDragMode;
    const toggleBtn = document.getElementById('layout-drag-toggle');
    
    if (this.isDragMode) {
      this.enterDragMode();
      toggleBtn.innerHTML = '<i class="fa-solid fa-times"></i> <span>Exit Layout</span>';
      toggleBtn.classList.add('active');
    } else {
      this.exitDragMode();
      toggleBtn.innerHTML = '<i class="fa-solid fa-arrows-alt"></i> <span>Layout Mode</span>';
      toggleBtn.classList.remove('active');
    }
  }

  enterDragMode() {
    document.body.classList.add('drag-mode-active');
    this.createDropZones();
    this.showInstructions();
  }

  exitDragMode() {
    document.body.classList.remove('drag-mode-active');
    this.removeDropZones();
    this.hideInstructions();
  }

  createDropZones() {
    const mainContainer = document.querySelector('.main-container');
    if (!mainContainer) return;

    // Criar zonas de drop
    const zones = [
      { id: 'drop-left', position: 'left', label: 'Drop Left' },
      { id: 'drop-right', position: 'right', label: 'Drop Right' },
      { id: 'drop-top', position: 'top', label: 'Drop Top' },
      { id: 'drop-bottom', position: 'bottom', label: 'Drop Bottom' },
      { id: 'drop-center', position: 'center', label: 'Drop Center' }
    ];

    zones.forEach(zone => {
      const dropZone = document.createElement('div');
      dropZone.className = 'drop-zone';
      dropZone.id = zone.id;
      dropZone.dataset.position = zone.position;
      dropZone.innerHTML = `<span>${zone.label}</span>`;
      
      mainContainer.appendChild(dropZone);
      this.dropZones.push(dropZone);
    });
  }

  removeDropZones() {
    this.dropZones.forEach(zone => {
      if (zone.parentNode) {
        zone.parentNode.removeChild(zone);
      }
    });
    this.dropZones = [];
  }

  startDrag(e, handle) {
    e.preventDefault();
    
    const containerId = handle.dataset.containerId;
    const container = this.containers.find(c => c.config.id === containerId);
    
    if (!container) return;

    this.dragging = container;
    
    // Calcular offset
    const rect = container.element.getBoundingClientRect();
    this.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    // Criar ghost element
    this.createGhost(container.element, e);
    
    // Adicionar classe de dragging
    container.element.classList.add('dragging');
    document.body.classList.add('dragging-active');
  }

  createGhost(element, e) {
    const ghost = element.cloneNode(true);
    ghost.className += ' drag-ghost';
    ghost.style.cssText = `
      position: fixed;
      top: ${e.clientY - this.dragOffset.y}px;
      left: ${e.clientX - this.dragOffset.x}px;
      width: ${element.offsetWidth}px;
      height: ${element.offsetHeight}px;
      z-index: 1000;
      opacity: 0.8;
      pointer-events: none;
      transform: rotate(2deg);
      box-shadow: 0 8px 16px rgba(0,0,0,0.3);
    `;
    
    document.body.appendChild(ghost);
    this.dragGhost = ghost;
  }

  onDrag(e) {
    if (!this.dragging || !this.dragGhost) return;

    // Atualizar posição do ghost
    this.dragGhost.style.left = `${e.clientX - this.dragOffset.x}px`;
    this.dragGhost.style.top = `${e.clientY - this.dragOffset.y}px`;

    // Highlight drop zones
    this.highlightDropZones(e);
  }

  highlightDropZones(e) {
    this.dropZones.forEach(zone => {
      const rect = zone.getBoundingClientRect();
      const isOver = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top && e.clientY <= rect.bottom;
      
      zone.classList.toggle('highlight', isOver);
    });
  }

  endDrag(e) {
    if (!this.dragging) return;

    // Encontrar zona de drop ativa
    const activeZone = this.dropZones.find(zone => zone.classList.contains('highlight'));
    
    if (activeZone) {
      this.dropContainer(this.dragging, activeZone.dataset.position);
    }

    // Cleanup
    if (this.dragGhost) {
      this.dragGhost.remove();
      this.dragGhost = null;
    }

    this.dragging.element.classList.remove('dragging');
    document.body.classList.remove('dragging-active');
    
    // Remover highlight das drop zones
    this.dropZones.forEach(zone => zone.classList.remove('highlight'));

    this.dragging = null;
  }

  dropContainer(container, position) {
    const mainContainer = document.querySelector('.main-container');
    if (!mainContainer) return;

    // Remover do local atual
    container.element.remove();

    // Criar novo wrapper se necessário
    let targetContainer = mainContainer;
    
    switch (position) {
      case 'left':
        this.insertLeft(container.element, mainContainer);
        break;
      case 'right':
        this.insertRight(container.element, mainContainer);
        break;
      case 'top':
        this.insertTop(container.element, mainContainer);
        break;
      case 'bottom':
        this.insertBottom(container.element, mainContainer);
        break;
      case 'center':
        this.insertCenter(container.element, mainContainer);
        break;
    }

    // Trigger resize events
    this.triggerResize();
  }

  insertLeft(element, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'layout-row';
    wrapper.style.cssText = 'display: flex; height: 100%;';
    
    const leftPanel = document.createElement('div');
    leftPanel.className = 'layout-panel';
    leftPanel.style.cssText = 'width: 300px; min-width: 200px; resize: horizontal; overflow: auto;';
    leftPanel.appendChild(element);
    
    const rightPanel = document.createElement('div');
    rightPanel.className = 'layout-panel';
    rightPanel.style.cssText = 'flex: 1; overflow: auto;';
    
    // Mover conteúdo existente para o painel direito
    while (container.firstChild && !container.firstChild.classList?.contains('drop-zone')) {
      rightPanel.appendChild(container.firstChild);
    }
    
    wrapper.appendChild(leftPanel);
    wrapper.appendChild(rightPanel);
    container.insertBefore(wrapper, container.firstChild);
  }

  insertRight(element, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'layout-row';
    wrapper.style.cssText = 'display: flex; height: 100%;';
    
    const leftPanel = document.createElement('div');
    leftPanel.className = 'layout-panel';
    leftPanel.style.cssText = 'flex: 1; overflow: auto;';
    
    const rightPanel = document.createElement('div');
    rightPanel.className = 'layout-panel';
    rightPanel.style.cssText = 'width: 300px; min-width: 200px; resize: horizontal; overflow: auto;';
    rightPanel.appendChild(element);
    
    // Mover conteúdo existente para o painel esquerdo
    while (container.firstChild && !container.firstChild.classList?.contains('drop-zone')) {
      leftPanel.appendChild(container.firstChild);
    }
    
    wrapper.appendChild(leftPanel);
    wrapper.appendChild(rightPanel);
    container.insertBefore(wrapper, container.firstChild);
  }

  insertTop(element, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'layout-column';
    wrapper.style.cssText = 'display: flex; flex-direction: column; height: 100%;';
    
    const topPanel = document.createElement('div');
    topPanel.className = 'layout-panel';
    topPanel.style.cssText = 'height: 200px; min-height: 100px; resize: vertical; overflow: auto;';
    topPanel.appendChild(element);
    
    const bottomPanel = document.createElement('div');
    bottomPanel.className = 'layout-panel';
    bottomPanel.style.cssText = 'flex: 1; overflow: auto;';
    
    // Mover conteúdo existente para o painel inferior
    while (container.firstChild && !container.firstChild.classList?.contains('drop-zone')) {
      bottomPanel.appendChild(container.firstChild);
    }
    
    wrapper.appendChild(topPanel);
    wrapper.appendChild(bottomPanel);
    container.insertBefore(wrapper, container.firstChild);
  }

  insertBottom(element, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'layout-column';
    wrapper.style.cssText = 'display: flex; flex-direction: column; height: 100%;';
    
    const topPanel = document.createElement('div');
    topPanel.className = 'layout-panel';
    topPanel.style.cssText = 'flex: 1; overflow: auto;';
    
    const bottomPanel = document.createElement('div');
    bottomPanel.className = 'layout-panel';
    bottomPanel.style.cssText = 'height: 200px; min-height: 100px; resize: vertical; overflow: auto;';
    bottomPanel.appendChild(element);
    
    // Mover conteúdo existente para o painel superior
    while (container.firstChild && !container.firstChild.classList?.contains('drop-zone')) {
      topPanel.appendChild(container.firstChild);
    }
    
    wrapper.appendChild(topPanel);
    wrapper.appendChild(bottomPanel);
    container.insertBefore(wrapper, container.firstChild);
  }

  insertCenter(element, container) {
    // Inserir no centro (substituir conteúdo principal)
    container.insertBefore(element, container.firstChild);
  }

  triggerResize() {
    // Trigger Monaco Editor resize
    setTimeout(() => {
      if (window.monacoEditor) {
        try {
          window.monacoEditor.layout();
        } catch (e) {
          console.warn('Monaco resize error:', e);
        }
      }
      
      // Trigger window resize event
      window.dispatchEvent(new Event('resize'));
    }, 100);
  }

  showInstructions() {
    const instructions = document.createElement('div');
    instructions.id = 'layout-instructions';
    instructions.innerHTML = `
      <div class="layout-instructions-content">
        <h3><i class="fa-solid fa-info-circle"></i> Layout Mode</h3>
        <p>• <strong>Drag handles</strong> to move panels</p>
        <p>• <strong>Drop on zones</strong> to position</p>
        <p>• <strong>Left/Right:</strong> side panels</p>
        <p>• <strong>Top/Bottom:</strong> stack panels</p>
        <p>• <strong>Center:</strong> main area</p>
      </div>
    `;
    document.body.appendChild(instructions);
  }

  hideInstructions() {
    const instructions = document.getElementById('layout-instructions');
    if (instructions) {
      instructions.remove();
    }
  }
}

// Initialize
let layoutManager;

function initializeLayoutManager() {
  layoutManager = new SimpleLayoutManager();
  layoutManager.init();
  window.layoutManager = layoutManager; // Global access
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLayoutManager);
} else {
  initializeLayoutManager();
}