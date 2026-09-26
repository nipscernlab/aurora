/**
 * texto_da_arvore.ts: o texto traduzido das operacoes da arvore, com reserva
 * em ingles.
 *
 * O menu e os avisos funcionam antes de as traducoes subirem, e as chaves sao
 * opcionais: sem traducao, vale o ingles, com os {campos} preenchidos tambem.
 */

export function tr(k: string, fb: string, p?: Record<string, unknown>): string {
    const v = window.t ? window.t(k, p) : null;
    if (v && v !== k) return v;
    // Interpolate {placeholders} into the English fallback too.
    return String(fb).replace(/\{(\w+)\}/g, (m, key: string) => (p && key in p ? String(p[key]) : m));
}

/** A mensagem de cada regra de nome de fs_name_utils.validateEntryName. */
export const MENSAGENS_DE_NOME: Record<string, () => string> = {
    empty:        () => tr('fileTree.crud.errEmpty', 'A file or folder name must be provided.'),
    whitespace:   () => tr('fileTree.crud.errWhitespace', 'Leading or trailing whitespace detected in the name.'),
    separators:   () => tr('fileTree.crud.errSeparators', 'The name contains invalid path separators.'),
    invalidChars: () => tr('fileTree.crud.errInvalidChars', 'The name contains characters that are not allowed (< > : " | ? *).'),
    reserved:     () => tr('fileTree.crud.errReserved', 'This name is reserved by the operating system.'),
    dots:         () => tr('fileTree.crud.errDots', '"." and ".." are not valid names.'),
    endsBad:      () => tr('fileTree.crud.errEndsBad', 'Names cannot end with a dot or a space.'),
    exists:       () => tr('fileTree.crud.errExists', 'A file or folder with this name already exists here.'),
};
