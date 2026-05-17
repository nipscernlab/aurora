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
     *                            (classes synth/testbench, icone)
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

        // Empty state — dropa data rows + separadores e mostra o
        // placeholder. Os separadores de processador PRECISAM sair aqui
        // tambem: este early-return pula a fase de reconciliacao la
        // embaixo (a unica que normalmente os remove), entao sem isso
        // os separadores do projeto anterior ficam presos na DOM ao
        // abrir um projeto novo e vazio.
        if (this.verilogFiles.length === 0) {
            container
                .querySelectorAll('.verilog-file-item, .verilog-processor-separator')
                .forEach((el) => el.remove());
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
        //
        // Defensivo contra duplicatas: se um render anterior deixou
        // mais de uma row com o mesmo data-file-path (por exemplo um
        // verilogFiles bichado por bug upstream), a primeira fica no
        // Map e as extras sao removidas imediatamente. Sem essa
        // limpeza, Map.set sobrescreve sem tirar do DOM, e as
        // duplicatas sobrevivem o "cleanup" no fim deste metodo.
        const existingFileRows = new Map();
        for (const row of container.querySelectorAll('.verilog-file-item')) {
            const key = row.dataset.filePath;
            if (existingFileRows.has(key)) {
                row.remove();
            } else {
                existingFileRows.set(key, row);
            }
        }
        const existingSeparators = new Map();
        for (const sep of container.querySelectorAll('.verilog-processor-separator')) {
            const key = sep.dataset.processorName;
            if (existingSeparators.has(key)) {
                sep.remove();
            } else {
                existingSeparators.set(key, sep);
            }
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

        // Show an "IMPORTED" section header before user files only when
        // there are also processor groups — without them the label is noise.
        // If the separator is NOT placed, it stays in existingSeparators and
        // the end-of-function cleanup removes it from the DOM automatically.
        const IMPORTED_KEY = '__imported__';
        if (userFiles.length > 0 && procNames.length > 0) {
            placeSeparator(IMPORTED_KEY);
        }

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

        // Toggle legado: versoes anteriores tinham um botao de toggle
        // synth/testbench na row. A categoria agora e auto-detectada
        // ([verilog_classifier.js](verilog_classifier.js)) — remove o
        // botao se uma row antiga ainda o tiver.
        const legacyToggle = row.querySelector('.category-toggle-wrapper');
        if (legacyToggle) legacyToggle.remove();
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

        // Arquivos software (.cmm/.asm de <proc>/Software/) nao
        // aparecem com botao de delete (sao gerenciados pelo proprio
        // processador). Apenas o icone + nome. Clicar abre o arquivo,
        // igual aos demais.
        //
        // A categoria synth/testbench NAO tem mais um toggle na row —
        // e auto-detectada do conteudo ([verilog_classifier.js]
        // (verilog_classifier.js)) e comunicada visualmente pela classe
        // synthesizable/testbench da row + pelo icone.
        const actionsHtml = isSoftware
            ? ''
            : `
                <div class="verilog-file-actions">
                    <button class="verilog-icon-btn delete-btn" data-action="delete"
                            title="Remove from tree">
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
        const isImported = procName === '__imported__';
        const sep = document.createElement('div');
        sep.className = 'verilog-processor-separator';
        if (isImported) sep.classList.add('verilog-imported-separator');
        sep.dataset.processorName = procName;
        sep.innerHTML = `
            <span class="verilog-processor-separator-line"></span>
            <span class="verilog-processor-separator-label"></span>
            <span class="verilog-processor-separator-line"></span>
        `;
        sep.querySelector('.verilog-processor-separator-label').textContent =
            isImported ? 'Imported' : procName;
        return sep;
    },

    /**
     * Tooltip do icone na linha. Para arquivos "top" (synth top ou
     * testbench top) conta o papel de top; para os demais .v/.sv
     * conta a categoria auto-detectada — sem o toggle na row, o
     * tooltip do icone e a unica forma de confirmar synth vs tb.
     */
    _getIconTooltip(file) {
        if (file?.isTopLevel) {
            return file.category === 'testbench'
                ? 'This file is set as the project\'s Testbench top'
                : 'This file is set as the project\'s Top Level module';
        }
        const ext = this.getFileExtension(file?.name || '');
        if (ext === '.v' || ext === '.sv') {
            return file?.category === 'testbench'
                ? 'Detected as a testbench'
                : 'Detected as synthesizable';
        }
        return '';
    },

    /**
     * Icone FontAwesome pra uma linha, baseado em extensao + flags.
     * Tolerante a chamadores antigos que passavam so o nome (string).
     */
    getFileIcon(file) {
        const fileObj = (typeof file === 'string') ? { name: file } : (file || {});
        const ext = this.getFileExtension(fileObj.name || '');

        if (ext === '.v' || ext === '.sv') {
            const isTestbench = fileObj.category === 'testbench';
            // Arquivos marcados como "Top Level" (synth) ou "Testbench
            // top" recebem icones proprios pra serem identificaveis na
            // arvore sem precisar ler nada. Os demais recebem o icone
            // da categoria auto-detectada — microchip pra sintetizavel,
            // flask pra testbench (synth-vs-tb nao tem mais toggle).
            if (fileObj.isTopLevel) {
                return isTestbench ? 'fa-solid fa-vial' : 'fa-solid fa-flag';
            }
            return isTestbench ? 'fa-solid fa-flask' : 'fa-solid fa-microchip';
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
