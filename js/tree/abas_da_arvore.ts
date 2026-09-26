/**
 * abas_da_arvore.ts: o que renomear, mover e apagar pela arvore fazem com as
 * abas abertas e com as pastas expandidas.
 *
 * Quem move um arquivo aberto espera continuar editando no mesmo lugar, com o
 * cursor onde estava; quem move uma pasta aberta espera ve-la aberta no lugar
 * novo. Saiu do standard_tree_crud.js (TODO 13.3).
 */

import { electronAPI } from '../app/electron_api.js';
import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { standardTreeRenderer } from './standard_tree_render.js';
import { normSlash, isUnder } from './fs_name_utils.js';

export function abasAbertas(): string[] {
    try { return Array.from((TabManager.tabs as Map<string, unknown> | undefined)?.keys?.() || []); } catch (_) { return []; }
}

/** Abas iguais a `path` (arquivo) ou embaixo dele (pasta). */
export function abasAfetadas(path: string, isDir: boolean): string[] {
    const target = normSlash(path).toLowerCase();
    return abasAbertas().filter((p) => {
        const n = normSlash(p).toLowerCase();
        return n === target || (isDir && isUnder(p, path));
    });
}

/** Fecha e reabre cada aba afetada no caminho novo (quem chama ja salvou os buffers). */
export async function migrarAbas(oldBase: string, newBase: string, affected: string[]): Promise<void> {
    if (!affected.length) return;
    const activeBefore = TabManager.activeTab;
    let newActive: string | null = null;
    for (const p of affected) {
        const newP = newBase + p.slice(oldBase.length);
        // Onde o cursor estava, o que estava selecionado e para onde a
        // rolagem tinha ido. Sem isto, renomear um arquivo aberto o
        // devolvia na linha 1: o mesmo texto, mas o usuario perdia o
        // lugar, que numa fonte de mil linhas e a parte que doi.
        const viewState = EditorManager.getEditorForFile?.(p)?.saveViewState?.() ?? null;
        // Buffers were saved before the rename, skip the unsaved prompt.
        TabManager.unsavedChanges?.delete?.(p);
        await TabManager.closeTab(p);
        try {
            const content = await electronAPI.readFile(newP);
            TabManager.addTab(newP, content, viewState ? { viewState } : {});
            if (activeBefore === p) newActive = newP;
        } catch (err) {
            console.error('tab migration failed for', newP, err);
        }
    }
    if (newActive) TabManager.activateTab(newActive);
}

/** As pastas expandidas embaixo de `oldBase` passam a ser as de `newBase`. */
export function remapearExpandidas(oldBase: string, newBase: string): void {
    const expanded = standardTreeRenderer._expanded;
    const oldNorm = normSlash(oldBase).toLowerCase();
    for (const p of Array.from(expanded)) {
        const n = normSlash(p).toLowerCase();
        if (n === oldNorm || isUnder(p, oldBase)) {
            expanded.delete(p);
            expanded.add(newBase + p.slice(oldBase.length));
        }
    }
}
