// Funções auxiliares fora do DOMContentLoaded
function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  
  function showCopyToast() {
    let toast = document.querySelector('.copy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'copy-toast';
      toast.innerHTML = '<i class="fa-solid fa-check"></i> Código copiado!';
      document.body.appendChild(toast);
    }
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        if (document.body.contains(toast)) document.body.removeChild(toast);
      }, 300);
    }, 2000);
  }
  
  function addSyntaxHighlighting() {
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/styles/atom-one-dark.min.css';
    document.head.appendChild(linkElement);
    
    const scriptElement = document.createElement('script');
    scriptElement.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.7.0/highlight.min.js';
    scriptElement.onload = () => {
      if (typeof hljs !== 'undefined') hljs.highlightAll();
    };
    document.body.appendChild(scriptElement);
  }
  
  // Evento principal
  document.addEventListener('DOMContentLoaded', function() {
    // Elementos comuns
    const verilogBlockBtn = document.getElementById('verilog-block');
    const modal = document.getElementById('verilog-modal');
    const closeModalBtn = document.getElementById('close-modal');
    const modalCancelBtn = document.getElementById('modal-cancel');
    const moduleSearch = document.getElementById('module-search');
    const categoryItems = document.querySelectorAll('.category-item');
    const moduleCards = document.querySelectorAll('.module-card');
    const noModulesMessage = document.getElementById('no-modules-message');
    const modulesCount = document.getElementById('modules-count');
    
    const codeModal = document.getElementById('verilog-code-modal');
    const closeCodeModalBtn = document.getElementById('close-code-modal');
    const closeCodeModalBtnFooter = document.getElementById('code-modal-close');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const codeContent = document.getElementById('verilog-code-content');
    const codeModalTitle = document.getElementById('code-modal-title');
  
    const VERILOG_PATH = './saphoComponents/Packages/modules/verilog/';
  
    // Modal de seleção de módulos
    function openModal() {
      modal.classList.remove('hidden');
      setTimeout(() => moduleSearch.focus(), 100);
    }
    
    function closeModal() {
      modal.classList.add('hidden');
    }
    
    verilogBlockBtn?.addEventListener('click', openModal);
    closeModalBtn?.addEventListener('click', closeModal);
    modalCancelBtn?.addEventListener('click', closeModal);
    
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  
    // Filtrar módulos
    function filterModules() {
      const searchTerm = moduleSearch.value.toLowerCase();
      const activeCategory = document.querySelector('.category-item.active');
      const selectedCategory = activeCategory ? activeCategory.getAttribute('data-category') : 'all';
      
      let visibleCount = 0;
  
      moduleCards.forEach(card => {
        const moduleCategory = card.getAttribute('data-category');
        const moduleName = card.querySelector('h4').textContent.toLowerCase();
        const moduleDescription = card.querySelector('.module-description').textContent.toLowerCase();
        
        const matchesCategory = selectedCategory === 'all' || moduleCategory === selectedCategory;
        const matchesSearch = moduleName.includes(searchTerm) || moduleDescription.includes(searchTerm);
  
        if (matchesCategory && matchesSearch) {
          card.classList.remove('filtered-out');
          visibleCount++;
        } else {
          card.classList.add('filtered-out');
        }
      });
  
      noModulesMessage.classList.toggle('hidden', visibleCount !== 0);
      modulesCount.textContent = `${visibleCount} ${visibleCount === 1 ? 'módulo encontrado' : 'módulos encontrados'}`;
    }
  
    categoryItems.forEach(item => {
      item.addEventListener('click', function() {
        categoryItems.forEach(cat => cat.classList.remove('active'));
        this.classList.add('active');
        filterModules();
      });
    });
  
    moduleSearch?.addEventListener('input', filterModules);
  
    modulesCount.textContent = `${moduleCards.length} módulos encontrados`;
  
    // Selecionar módulo
    const selectButtons = document.querySelectorAll('.module-select-btn');
    selectButtons.forEach(btn => {
      btn.addEventListener('click', function() {
        const moduleCard = this.closest('.module-card');
        const moduleName = moduleCard.querySelector('h4').textContent;
        console.log(`Selected module: ${moduleName}`);
        
        this.innerHTML = '<i class="fa-solid fa-check"></i> Selecionado';
        this.style.backgroundColor = 'var(--success)';
        setTimeout(() => {
          this.innerHTML = '<i class="fa-solid fa-plus"></i> Selecionar';
          this.style.backgroundColor = '';
        }, 1500);
      });
    });
  
    // Modal de código Verilog
    function showCodeModal(moduleName) {
      codeModalTitle.textContent = `${moduleName}.v`;
      codeModal.classList.remove('hidden');
      setTimeout(() => codeModal.classList.add('visible'), 10);
      document.body.style.overflow = 'hidden';
    }
  
    function hideCodeModal() {
      codeModal.classList.remove('visible');
      setTimeout(() => {
        codeModal.classList.add('hidden');
        document.body.style.overflow = '';
      }, 300);
    }
  
    async function loadVerilogFile(moduleName) {
        try {
          const response = await window.verilogAPI.loadVerilogFile(moduleName);
          if (response.success) {
            console.log('Conteúdo do arquivo Verilog:', response.content);
          } else {
            console.error('Erro ao carregar o arquivo:', response.error);
          }
        } catch (error) {
          console.error('Erro inesperado:', error);
        }
      }
      
  
    function copyCodeToClipboard() {
      const codeText = codeContent.textContent;
      navigator.clipboard.writeText(codeText)
        .then(() => showCopyToast())
        .catch(err => console.error('Erro ao copiar texto: ', err));
    }
  
    closeCodeModalBtn?.addEventListener('click', hideCodeModal);
    closeCodeModalBtnFooter?.addEventListener('click', hideCodeModal);
    copyCodeBtn?.addEventListener('click', copyCodeToClipboard);
  
    codeModal?.addEventListener('click', (event) => {
      if (event.target === codeModal) hideCodeModal();
    });
  
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !codeModal.classList.contains('hidden')) {
        hideCodeModal();
      }
    });
  
    // Botões "info" para ver o Verilog
    document.querySelectorAll('.module-info-btn').forEach(button => {
      button.addEventListener('click', () => {
        const moduleName = button.getAttribute('data-module');
        if (moduleName) loadVerilogFile(moduleName);
      });
    });
  
    // Iniciar syntax highlighting
    addSyntaxHighlighting();
  });
  