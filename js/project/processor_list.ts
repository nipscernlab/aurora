/**
 * processor_list.ts — single owner of `window.availableProcessors`.
 *
 * Pre-refactor, four sites mutated `window.availableProcessors` with
 * their own dedup logic (project_manager.loadProject e os listeners
 * onProcessorCreated/onProcessorsUpdated em file_mode). Cada um tinha
 * que lembrar de:
 *
 *   - normalizar entries do .spf (string-only vs `{name}`)
 *   - dedup case-insensitive (Windows folders sao case-insensitive)
 *   - filter de valores vazios/falsy
 *
 * Qualquer caminho novo que esquecesse uma dessas etapas reintroduzia
 * o bug das rows fantasma na file tree. Esse modulo encapsula as duas
 * operacoes que importam — set (substitui a lista inteira) e add
 * (acrescenta um nome) — pra que esse cuidado fique num lugar so.
 *
 * O array continua em `window.availableProcessors` por compatibilidade
 * com consumidores que ainda fazem read direto (file_tree_manager,
 * compilation_flow, file_mode._getProcessorForFile). Quem precisar
 * subscriber pattern no futuro, troca o backing store aqui sem
 * tocar nos call sites.
 *
 * Compilado por `tsc` (npm run build:ts) num processor_list.js ao lado — é esse
 * .js que o runtime carrega; os imports usam a extensão `.js`.
 *
 * Window.availableProcessors é declarado em js/types/aurora-globals.d.ts.
 */

/** An entry as it may arrive: a bare name, a `{name}` from the .spf, or junk. */
type ProcessorEntry = string | { name?: string | null } | null | undefined;

function normalizeName(item: ProcessorEntry): string | null | undefined {
    return typeof item === 'string' ? item : item?.name;
}

function dedup(list: ProcessorEntry[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of list) {
        const name = normalizeName(item);
        if (!name || typeof name !== 'string') continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

/**
 * Substitui `window.availableProcessors` pela lista deduplicada de
 * `list`. Aceita arrays de strings ou de `{name}` (formato do .spf).
 * Input null/undefined ou nao-array resulta em array vazio.
 */
export function setAvailableProcessors(list: unknown): void {
    window.availableProcessors = Array.isArray(list) ? dedup(list) : [];
}

/**
 * Le a lista atual de nomes. Sempre retorna array (vazio quando nada
 * foi semeado ainda). Preferir este getter ao read direto de
 * `window.availableProcessors` em codigo novo.
 */
export function getAvailableProcessors(): string[] {
    return Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
}

/**
 * Acrescenta `name` em `window.availableProcessors` se ainda nao
 * estiver presente (match case-insensitive). No-op se `name` for
 * vazio ou nao-string.
 */
export function addAvailableProcessor(name: unknown): void {
    if (!name || typeof name !== 'string') return;
    const current = Array.isArray(window.availableProcessors) ? window.availableProcessors : [];
    const target = name.toLowerCase();
    if (current.some((p) => typeof p === 'string' && p.toLowerCase() === target)) return;
    window.availableProcessors = [...current, name];
}
