/**
 * active_processor.ts, "qual processador esta ativo?"
 *
 * Dominio, nao UI: o processador ATIVO e o cruzamento do arquivo em
 * foco no editor (.cmm) com a lista de processadores do projeto. A
 * status bar exibe esse resultado; o pipeline de compilacao (gating e
 * alvo dos botoes C± / Verilator-processador) decide por ele.
 *
 * Antes a logica morava na status bar e os consumidores de dominio
 * (compilation_flow / compilation_module) importavam o widget de UI:
 * dependencia de cabeca pra baixo, alem de uma copia byte-a-byte do
 * matcher em processor_config_panel. Extraida pra ca em 2026-06.
 *
 * Donos consultados (sempre lazy, em call time, nada e cacheado aqui):
 *   - TabManager.getEditingFilePath(), arquivo em foco; ja resolve
 *     main vs split pane (single source of truth do foco).
 *   - getAvailableProcessors(), lista sincrona de nomes, semeada do
 *     .spf (processor_list). Consumidores com uma lista mais fresca em
 *     maos (ex: status bar acabou de ler o .spf) podem passa-la.
 *
 * Compilado por `tsc` (npm run build:ts) num active_processor.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { TabManager } from '../tabs/tab_manager.js';
import { getAvailableProcessors } from './processor_list.js';
import { isProcessorSourcePath, stripSourceExtension } from '../compilation/processor_source.js';

/**
 * Determina o processador "ativo" a partir do fonte em foco (.cmm ou
 * .cpp; quem sabe quais extensoes sao fonte e o processor_source.ts).
 * Aceita o caminho convencional `<projectDir>/<procName>/Software/<x>`
 * (prioriza o segmento de pasta, robusto a renames do fonte) e cai
 * pro basename como fallback. Retorna null se o arquivo em foco
 * nao for fonte de processador ou nao casar com nenhum processador.
 */
function matchProcessorFromPath(filePath: string, processors: readonly string[]): string | null {
    if (!isProcessorSourcePath(filePath)) return null;
    const parts = filePath.split(/[\\/]/);
    const swIdx = parts.findIndex((p) => p.toLowerCase() === 'software');
    if (swIdx > 0) {
        const candidate = parts[swIdx - 1];
        if (processors.includes(candidate)) return candidate;
    }
    const base = stripSourceExtension(parts[parts.length - 1]);
    if (processors.includes(base)) return base;
    return null;
}

/**
 * Nome do processador ATIVO, exatamente o que a status bar mostra.
 * Recalcula a cada chamada a partir do arquivo em foco atual
 * (sincrono). Retorna null quando nao ha processador ativo (nenhum
 * fonte de processador em foco).
 *
 * @param processors lista de nomes; default e a lista sincrona do
 *   processor_list (mesmo conjunto que o .spf semeia).
 */
export function getActiveProcessorName(processors: readonly string[] = getAvailableProcessors()): string | null {
    const editingPath = TabManager.getEditingFilePath?.() || '';
    return matchProcessorFromPath(editingPath, processors);
}
