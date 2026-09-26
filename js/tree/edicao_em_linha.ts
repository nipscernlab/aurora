/**
 * edicao_em_linha.ts: o campo que a arvore abre no lugar de uma linha para
 * criar ou renomear.
 *
 * Um .file-item de mentira com um <input> e a caixa de erro. Valida enquanto
 * se digita, grava com Enter, cancela com Escape, e ao sair do campo grava se
 * o nome e valido e cancela se nao e (como no VS Code). O icone acompanha o
 * nome digitado. Saiu do standard_tree_crud.js (TODO 13.3).
 */

import { iconUrlForFile, iconUrlForFolder } from './material_icons.js';
import { applyGlyphToIcon, glyphClasses } from '../ui/language_glyph.js';
import { baseName } from './fs_name_utils.js';
import { MENSAGENS_DE_NOME } from './texto_da_arvore.js';

export interface OpcoesDaEdicao {
    mountEl: Element;
    before?: Node | null;
    depth: number;
    kind: 'file' | 'folder';
    initial?: string;
    selectRange?: [number, number];
    validate: (valor: string) => { ok: boolean; error?: string };
    commit: (valor: string) => unknown;
    onClose?: () => void;
}

/** Monta o campo e devolve o input e quem o fecha. */
export function montarEdicaoEmLinha(opts: OpcoesDaEdicao): { input: HTMLInputElement; fechar: () => void } {
    const { mountEl, before, depth, kind, initial, selectRange, validate, commit, onClose } = opts;

    const wrapper = document.createElement('div');
    wrapper.className = 'file-tree-item tree-inline-edit';
    wrapper.style.setProperty('--depth', String(depth));
    wrapper.innerHTML = `
            <div class="file-item">
                <div class="file-item-row">
                    <span class="folder-toggle-spacer"></span>
                    <span class="file-item-icon"></span>
                    <input class="tree-inline-input" type="text" spellcheck="false" />
                </div>
            </div>
            <div class="tree-inline-error hidden"></div>
        `;
    const input = wrapper.querySelector('input') as HTMLInputElement;
    const errorBox = wrapper.querySelector('.tree-inline-error') as HTMLElement;
    const iconEl = wrapper.querySelector('.file-item-icon') as HTMLElement;

    // O icone acompanha o que esta sendo digitado, em vez de esperar o
    // arquivo existir. Assim da para ver, ainda durante a digitacao, que
    // "main.py" vai virar um Python e "main.v" um Verilog, e um erro de
    // extensao aparece antes de criar o arquivo e nao depois.
    const pintarIcone = () => {
        const nome = baseName(input.value.trim()) || (kind === 'folder' ? 'nova-pasta' : 'novo-arquivo');
        iconEl.style.backgroundImage = '';
        for (const classe of glyphClasses()) iconEl.classList.remove(classe);
        if (kind === 'folder') {
            iconEl.style.backgroundImage = `url("${iconUrlForFolder(nome)}")`;
            return;
        }
        // Fonte de processador (.cmm ou .cpp) nao tem equivalente no tema
        // Material e mantem o glifo proprio da AURORA, como nas abas e no
        // resto da arvore.
        if (applyGlyphToIcon(iconEl, nome)) return;
        iconEl.style.backgroundImage = `url("${iconUrlForFile(nome)}")`;
    };
    pintarIcone();

    if (before) mountEl.insertBefore(wrapper, before);
    else mountEl.prepend(wrapper);

    input.value = initial || '';

    let done = false;
    const fechar = () => {
        if (done) return;
        done = true;
        wrapper.remove();
        onClose?.();
    };

    const showError = (msg: string | null) => {
        errorBox.textContent = msg || '';
        errorBox.classList.toggle('hidden', !msg);
        input.classList.toggle('invalid', !!msg);
    };

    const currentError = (): string | null => {
        const res = validate(input.value);
        return res.ok ? null : MENSAGENS_DE_NOME[res.error as string]?.() || (res.error as string);
    };

    input.addEventListener('input', () => { showError(currentError()); pintarIcone(); });

    const tryCommit = async () => {
        const err = currentError();
        if (err) { showError(err); return; }
        const value = input.value;
        fechar();
        await commit(value);
    };

    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); tryCommit(); }
        else if (e.key === 'Escape') { e.preventDefault(); fechar(); }
    });
    // VS Code semantics: blur commits when valid, cancels otherwise.
    input.addEventListener('blur', () => {
        if (done) return;
        if (!input.value.trim() || currentError()) fechar();
        else tryCommit();
    });

    wrapper.scrollIntoView({ block: 'nearest' });
    input.focus();
    if (selectRange) input.setSelectionRange(selectRange[0], selectRange[1]);
    else input.select();
    return { input, fechar };
}
