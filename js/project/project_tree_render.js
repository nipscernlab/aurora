/**
 * project_tree_render.js — RenderMixin do ProjectTreeManager.
 *
 * Camada de DOM/rendering: dado o state da classe (this.verilogFiles,
 * helpers de path), monta e atualiza as rows da file tree no
 * subcontainer .tree-view-verilog. Idempotente — uma key-based
 * reconciliation por path mantem rows existentes em lugar e so
 * adiciona/remove o delta.
 *
 * Mixed in via Object.assign(ProjectTreeManager.prototype, RenderMixin)
 * em file_mode.js. Cada metodo usa `this` da classe, com acesso a:
 *   - this.verilogFiles            (state mixin)
 *   - this._getProcessorForFile    (state mixin)
 *   - this.getFileExtension        (state mixin)
 *
 * NAO importa nada externo — render puro, sem IO.
 */

export const RenderMixin = {
    /**
     * Renderiza a file tree no subcontainer `.tree-view-verilog`.
     * CSS mostra so o subcontainer ativo via `#file-tree[data-active-view]`,
     * entao a standard tree e a hierarchical view (subcontainers proprios)
     * nao colidem com a gente. Ver js/tree/tree_view.js pro racional.
     *
     * KEY-BASED RECONCILER. Nunca faz `innerHTML = ''`. Compara
     * this.verilogFiles (keyed por path) contra rows existentes:
     *   - row cujo path sumiu  → removida
     *   - row ainda desejada   → atualizada in-place por _updateFileItem
     *                            (badge, classes, toggle title)
     *   - path sem row ainda   → criada via _createFileItem e
     *                            insertBefore'd na posicao certa
     *                            (DOM trata insertBefore num node ja
     *                            attached como "move", entao rows no
     *                            slot certo viram no-op).
     *
     * Idempotent: mesmo input duas vezes = zero mutacoes na 2a chamada.
     */
    renderTree() {
        // Render no subcontainer dedicado. O estado active/visible da
        // view e owned pelo file-tree view controller — NAO chame
        // setActive('verilog') aqui, isso sincronizaria o DOM sem
        // avisar o controller, deixando _activeView dele preso no
        // valor inicial. Callers externos que queiram TANTO renderizar
        // QUANTO trocar a view visivel devem ir via
        // fileTreeViewController.showFileMode() (que invoca este
        // renderer via o renderer hook registrado).
        const container = window.treeView?.getContainer('verilog');
        if (!container) return;

        // Empty state — dropa data rows + mostra o placeholder.
        if (this.verilogFiles.length === 0) {
            container.querySelectorAll('.verilog-file-item').forEach((row) => row.remove());
            container.classList.add('verilog-empty');
            if (!container.querySelector('.verilog-empty-state')) {
                const emptyState = document.createElement('div');
                emptyState.className = 'verilog-empty-state';
                emptyState.innerHTML = `
                    <i class="fa-solid fa-folder-open verilog-empty-icon"></i>
                    <div class="verilog-empty-text">
                        No synthesizable files<br>
                        <strong>Drag and drop .v files here</strong>
                    </div>
                `;
                container.appendChild(emptyState);
            }
            return;
        }

        // Tem data → garante que nao sobrou placeholder.
        container.classList.remove('verilog-empty');
        container.querySelector('.verilog-empty-state')?.remove();

        // Agrupa arquivos por processador. Arquivos "comuns" (que nao
        // moram em <proc>/{Hardware,Software,Simulation}/) ficam num
        // grupo sem nome que aparece primeiro, sem separador. Os
        // grupos por processador aparecem depois, em ordem alfabetica,
        // cada um precedido por um separador horizontal com o nome.
        const userFiles = [];
        const procGroups = new Map(); // procName -> [files]
        for (const file of this.verilogFiles) {
            const proc = this._getProcessorForFile(file);
            if (!proc) {
                userFiles.push(file);
            } else {
                if (!procGroups.has(proc)) procGroups.set(proc, []);
                procGroups.get(proc).push(file);
            }
        }
        const procNames = [...procGroups.keys()].sort((a, b) => a.localeCompare(b));

        // Indexa rows e separadores existentes pra reconciliacao
        // path-keyed: rows certas sao reutilizadas/movidas, restos
        // viram lixo no fim.
        const existingFileRows = new Map();
        for (const row of container.querySelectorAll('.verilog-file-item')) {
            existingFileRows.set(row.dataset.filePath, row);
        }
        const existingSeparators = new Map();
        for (const sep of container.querySelectorAll('.verilog-processor-separator')) {
            existingSeparators.set(sep.dataset.processorName, sep);
        }

        let prev = null;
        const placeNode = (node) => {
            const targetSibling = prev ? prev.nextSibling : container.firstChild;
            if (node !== targetSibling) container.insertBefore(node, targetSibling);
            prev = node;
        };
        const placeFile = (file) => {
            let row = existingFileRows.get(file.path);
            if (row) {
                this._updateFileItem(row, file);
                existingFileRows.delete(file.path);
            } else {
                row = this._createFileItem(file);
            }
            placeNode(row);
        };
        const placeSeparator = (procName) => {
            let sep = existingSeparators.get(procName);
            if (sep) {
                existingSeparators.delete(procName);
            } else {
                sep = this._createProcessorSeparator(procName);
            }
            placeNode(sep);
        };

        for (const file of userFiles) placeFile(file);
        for (const procName of procNames) {
            placeSeparator(procName);
            for (const file of procGroups.get(procName)) placeFile(file);
        }

        // Limpa rows / separadores que sobraram (arquivos removidos,
        // processadores que sumiram).
        for (const row of existingFileRows.values()) row.remove();
        for (const sep of existingSeparators.values()) sep.remove();
    },

    /**
     * Atualiza as partes mutaveis de uma row existente (category class,
     * badge, top-level highlight) sem recria-la. O slot estrutural
     * keyed-por-path fica em lugar — so os diferenciadores visuais
     * mudam. Pura mutacao de DOM; nao precisa re-attachar listeners
     * porque a delegacao no nivel da tree (setupEventListeners)
     * dispatcha pelo handler certo via data-file-path, nao por indice.
     */
    _updateFileItem(row, file) {
        const isTestbench = file.category === 'testbench';
        row.classList.toggle('synthesizable', !isTestbench);
        row.classList.toggle('testbench', isTestbench);
        row.classList.toggle('software', !!file.isSoftware);
        row.classList.toggle('top-level-file', !!file.isTopLevel);

        const info = row.querySelector('.verilog-file-info');
        if (!info) return;

        // Icone — recalcula porque depende de isTopLevel + category.
        // So mexe no DOM se a classe efetivamente mudou.
        const iconEl = info.querySelector('.verilog-file-icon');
        if (iconEl) {
            const desiredIcon = `${this.getFileIcon(file)} verilog-file-icon`;
            if (iconEl.className !== desiredIcon) iconEl.className = desiredIcon;
            const desiredIconTitle = this._getIconTooltip(file);
            if (desiredIconTitle) {
                if (iconEl.title !== desiredIconTitle) iconEl.title = desiredIconTitle;
            } else if (iconEl.hasAttribute('title')) {
                iconEl.removeAttribute('title');
            }
        }

        // Filename — so toca DOM se mudou (e.g. rename fora do Aurora).
        // Re-escrever o textNode a cada render flicka selecao em alguns
        // browsers.
        const nameEl = info.querySelector('.verilog-file-name');
        if (nameEl) {
            if (nameEl.textContent !== file.name) nameEl.textContent = file.name;
            const desiredTitle = file.path;
            if (nameEl.title !== desiredTitle) nameEl.title = desiredTitle;
        }

        // Badges legados: se uma versao anterior tinha desenhado um
        // .file-badge nesta linha, remove — o icone agora carrega
        // esse significado.
        const legacyBadge = info.querySelector('.file-badge');
        if (legacyBadge) legacyBadge.remove();

        // Toggle button: category class + tooltip.
        const toggleBtn = row.querySelector('.category-toggle');
        if (toggleBtn) {
            toggleBtn.classList.toggle('synthesizable', !isTestbench);
            toggleBtn.classList.toggle('testbench', isTestbench);
            const desiredTitle = isTestbench ? 'Category: Testbench' : 'Category: Synthesizable';
            if (toggleBtn.title !== desiredTitle) toggleBtn.title = desiredTitle;
        }
    },

    /**
     * Monta a DOM de uma row, sem listener per-row attachado. Todo
     * click / contextmenu e tratado pelo listener delegado em
     * setupEventListeners — esse listener acha o file por
     * `data-file-path`, entao reordenar, sortear ou updates parciais
     * nao precisam de listener bookkeeping.
     *
     * _updateFileItem espelha as partes mutaveis desse template, pra
     * que uma row criada aqui possa ser reutilizada/atualizada sem
     * recriar o HTML estrutural.
     */
    _createFileItem(file) {
        const fileItem = document.createElement('div');
        fileItem.className = 'verilog-file-item';
        fileItem.dataset.filePath = file.path;

        const isTestbench = file.category === 'testbench';
        const isSoftware = !!file.isSoftware;
        fileItem.classList.add(isTestbench ? 'testbench' : 'synthesizable');
        if (isSoftware) fileItem.classList.add('software');
        if (file.isTopLevel) fileItem.classList.add('top-level-file');

        const icon = this.getFileIcon(file);
        const iconTitle = this._getIconTooltip(file);
        const toggleTitle = isTestbench ? 'Category: Testbench' : 'Category: Synthesizable';
        const toggleClass = isTestbench ? 'testbench' : 'synthesizable';

        // Arquivos software (.cmm/.asm de <proc>/Software/) nao
        // aparecem com toggle synth/testbench (sao codigo do
        // processador, nao Verilog) nem com delete (sao gerenciados
        // pelo proprio processador). Apenas o icone + nome. Clicar
        // abre o arquivo, igual aos demais.
        const actionsHtml = isSoftware
            ? ''
            : `
                <div class="verilog-file-actions">
                    <div class="category-toggle-wrapper">
                        <button class="category-toggle ${toggleClass}" data-action="toggle-category"
                             title="${toggleTitle}">
                            <span class="toggle-slider"></span>
                        </button>
                    </div>
                    <button class="verilog-icon-btn delete-btn" data-action="delete"
                            title="Remove file">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `;

        fileItem.innerHTML = `
            <div class="verilog-file-content">
                <div class="verilog-file-info">
                    <i class="${icon} verilog-file-icon"${iconTitle ? ` title="${iconTitle}"` : ''}></i>
                    <div class="verilog-file-name" title="${file.path}">${file.name}</div>
                </div>
                ${actionsHtml}
            </div>
        `;
        return fileItem;
    },

    /**
     * Cria o separador horizontal que marca o inicio de um grupo
     * de arquivos de processador na arvore.
     */
    _createProcessorSeparator(procName) {
        const sep = document.createElement('div');
        sep.className = 'verilog-processor-separator';
        sep.dataset.processorName = procName;
        sep.innerHTML = `
            <span class="verilog-processor-separator-line"></span>
            <span class="verilog-processor-separator-label"></span>
            <span class="verilog-processor-separator-line"></span>
        `;
        sep.querySelector('.verilog-processor-separator-label').textContent = procName;
        return sep;
    },

    /**
     * Tooltip do icone na linha. So faz sentido quando o arquivo e
     * um "top" (synth top ou testbench top) — para os demais retorna
     * string vazia e o template omite o atributo title.
     */
    _getIconTooltip(file) {
        if (!file?.isTopLevel) return '';
        return file.category === 'testbench'
            ? 'This file is set as the project\'s Testbench top'
            : 'This file is set as the project\'s Top Level module';
    },

    /**
     * Icone FontAwesome pra uma linha, baseado em extensao + flags.
     * Tolerante a chamadores antigos que passavam so o nome (string).
     */
    getFileIcon(file) {
        const fileObj = (typeof file === 'string') ? { name: file } : (file || {});
        const ext = this.getFileExtension(fileObj.name || '');

        if (ext === '.v' || ext === '.sv') {
            // Arquivos marcados como "Top Level" (synth) ou "Testbench
            // top" recebem icones proprios pra serem identificaveis na
            // arvore sem precisar ler o badge.
            if (fileObj.isTopLevel) {
                return fileObj.category === 'testbench'
                    ? 'fa-solid fa-vial'
                    : 'fa-solid fa-flag';
            }
            return 'fa-solid fa-microchip';
        } else if (ext === '.cmm' || ext === '.asm') {
            return 'fa-solid fa-file-code';
        } else if (ext === '.txt') {
            return 'fa-solid fa-file-lines';
        } else if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg'].includes(ext)) {
            return 'fa-solid fa-image';
        }

        return 'fa-solid fa-file';
    },
};
