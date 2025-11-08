// tree_view_state_module.js

class TreeViewStateManager {
    constructor() {
        this.isHierarchical = false;
        this.compilationModule = null;
        this.hierarchyData = null;
        this.isToggleEnabled = false;
        this.toggleButton = document.getElementById('hierarchy-tree-toggle');
    }

    setCompilationModule(moduleInstance) {
        this.compilationModule = moduleInstance;
    }

    setHierarchical(isHierarchical) {
        this.isHierarchical = isHierarchical;
        this.updateToggleButton();
    }

    enableToggle() {
        if (!this.toggleButton) return;
        this.isToggleEnabled = true;
        this.toggleButton.classList.remove('disabled');
        this.toggleButton.disabled = false;
        this.toggleButton.title = 'Alternar entre visão hierárquica e padrão';
    }

    disableToggle() {
        if (!this.toggleButton) return;
        this.isToggleEnabled = false;
        this.toggleButton.classList.add('disabled');
        this.toggleButton.disabled = true;
        this.toggleButton.title = 'Compile o projeto Verilog para habilitar a visão hierárquica';
    }

    updateToggleButton() {
        if (!this.toggleButton) return;

        const icon = this.toggleButton.querySelector('i');
        const text = this.toggleButton.querySelector('.toggle-text');
        if (!icon || !text) return;

        if (this.isHierarchical) {
            // Mostrando visão hierárquica - o botão alterna para a padrão
            icon.className = 'fa-solid fa-list-ul';
            text.textContent = 'Standard';
            this.toggleButton.classList.add('active');
            this.toggleButton.title = 'Mudar para a árvore de arquivos padrão';
        } else {
            // Mostrando visão padrão - o botão alterna para a hierárquica
            icon.className = 'fa-solid fa-sitemap';
            text.textContent = 'Hierarchical';
            this.toggleButton.classList.remove('active');
            this.toggleButton.title = 'Mudar para a visão hierárquica de módulos';
        }
    }
}

// Criamos uma única instância (singleton) e a exportamos.
// Assim, toda parte do código que importar 'TreeViewState' usará este mesmo objeto.
const TreeViewState = new TreeViewStateManager();

export { TreeViewState };