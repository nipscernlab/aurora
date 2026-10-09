/**
 * lista_do_spf.ts: gravar uma lista de arquivos do .spf sem reordenar.
 *
 * A ordem das listas do .spf e a ordem em que o iverilog e o Yosys leem os
 * arquivos, e ela importa: um arquivo so de `` `define `` tem de vir antes dos
 * que usam as macros. O hits (08/10/2026) depende disso com o simulacao.v. A
 * arvore exibe em ordem alfabetica, mas gravava a lista na mesma ordem, e o
 * simulacao.v ia do primeiro lugar para o ultimo sem erro nenhum: as macros
 * simplesmente deixavam de valer.
 *
 * Regra: quem ja estava na lista gravada fica onde estava (com os dados novos,
 * como a marca de topo); quem chegou vai para o fim, na ordem em que chegou;
 * quem saiu some do lugar. A Aurora nunca reordena (TODO 13b).
 */

interface ComCaminho {
    path?: string;
}

/**
 * @param gravada  a lista como esta no .spf agora (qualquer coisa: o .spf vem
 *                 do disco e pode estar estranho)
 * @param desejada as entradas que a lista deve ter, ja com os dados certos
 * @param chave    normaliza o caminho para comparar (barra e caixa)
 */
export function manterOrdem<T extends ComCaminho>(
    gravada: unknown,
    desejada: T[],
    chave: (caminho: string) => string,
): T[] {
    const porChave = new Map<string, T>();
    for (const entrada of desejada) {
        if (entrada.path) porChave.set(chave(entrada.path), entrada);
    }
    const resultado: T[] = [];
    const usados = new Set<string>();
    if (Array.isArray(gravada)) {
        for (const antiga of gravada as Array<ComCaminho | null>) {
            if (!antiga || typeof antiga.path !== 'string') continue;
            const k = chave(antiga.path);
            const nova = porChave.get(k);
            if (!nova || usados.has(k)) continue;
            resultado.push(nova);
            usados.add(k);
        }
    }
    for (const entrada of desejada) {
        const k = entrada.path ? chave(entrada.path) : '';
        if (usados.has(k)) continue;
        resultado.push(entrada);
        usados.add(k);
    }
    return resultado;
}
