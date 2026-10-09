/**
 * papel_no_spf.ts: trocar o papel de um arquivo no .spf.
 *
 * O papel (sintese ou testbench) e escolhido pela pessoa no botao direito da
 * arvore (TODO 13b); nada o infere do conteudo. Trocar o papel e mudar o
 * arquivo de lista no .spf:
 *
 *   - ele sai das outras listas, inclusive a dos que ainda nao tem papel;
 *   - entra no FIM da lista nova, com o caminho na forma que o chamador deu
 *     e o nome que tinha, sem reordenar ninguem (a ordem e a do
 *     iverilog, ver lista_do_spf.ts);
 *   - perde a marca de topo, e o ponteiro que apontava para ele se apaga:
 *     topo de sintese e testbench atual sao coisas diferentes, e carregar um
 *     para o outro deixaria o projeto com um topo que ninguem escolheu.
 *
 * Usado pelo menu da arvore e pela API de topo (ciclo_do_projeto_ns), que
 * antes moviam o arquivo cada um do seu jeito.
 */

export type Papel = 'synthesizable' | 'testbench';

type Entrada = { name?: string; path?: string; isTopLevel?: boolean } | null;

const LISTA_DO_PAPEL = { synthesizable: 'synthesizableFiles', testbench: 'testbenchFiles' } as const;
const LISTAS = ['synthesizableFiles', 'testbenchFiles', 'unclassifiedFiles'] as const;
const PONTEIRO: Record<string, string> = { synthesizableFiles: 'topLevelFile', testbenchFiles: 'testbenchFile' };

/**
 * @param cfg     a `structure` do .spf, mutada
 * @param caminho caminho absoluto do arquivo
 * @param papel   o papel escolhido
 * @param chave   normaliza caminho para comparar (barra e caixa)
 * @returns se algo mudou (falso quando o arquivo ja tinha esse papel)
 */
export function marcarPapel(
    cfg: Record<string, unknown>,
    caminho: string,
    papel: Papel,
    chave: (c: string) => string,
): boolean {
    const alvo = chave(caminho);
    const ehEle = (e: Entrada) => !!e && typeof e.path === 'string' && chave(e.path) === alvo;
    const destino = LISTA_DO_PAPEL[papel];
    const listaDestino = Array.isArray(cfg[destino]) ? (cfg[destino] as Entrada[]) : [];
    if (listaDestino.some(ehEle)) return false;

    let antiga: Entrada = null;
    for (const lista of LISTAS) {
        if (lista === destino || !Array.isArray(cfg[lista])) continue;
        const atual = cfg[lista] as Entrada[];
        const restante = atual.filter((e) => {
            if (!ehEle(e)) return true;
            antiga = antiga || e;
            return false;
        });
        if (restante.length === atual.length) continue;
        cfg[lista] = restante;
        const ponteiro = PONTEIRO[lista];
        if (ponteiro && typeof cfg[ponteiro] === 'string' && chave(cfg[ponteiro] as string) === alvo) {
            cfg[ponteiro] = '';
        }
    }

    const de = antiga as Entrada;
    listaDestino.push({
        name: de?.name || caminho.split(/[\\/]/).pop(),
        path: caminho,
        isTopLevel: false,
    });
    cfg[destino] = listaDestino;
    return true;
}

/** Papel de um arquivo que acabou de entrar no projeto, ou nenhum ainda. */
export type PapelDeEntrada = Papel | 'unclassified';

const LISTA_DE_ENTRADA = { ...LISTA_DO_PAPEL, unclassified: 'unclassifiedFiles' } as const;

/**
 * O papel com que um arquivo novo entra (TODO 13b, passo 4): nenhum, a pessoa
 * escolhe no botao direito. A excecao e o .py, que so pode ser testbench
 * (cocotb nao sintetiza), entao nao ha o que perguntar.
 */
export function papelDeEntrada(nome: string): PapelDeEntrada {
    return /\.py$/i.test(nome || '') ? 'testbench' : 'unclassified';
}

/**
 * Registra um arquivo que entrou no projeto (criado, importado, arrastado,
 * salvo pela primeira vez). Se ele ja esta em QUALQUER lista do .spf, nada
 * muda: nem de papel, nem de lugar. Senao, entra no fim da lista do papel.
 *
 * @returns se registrou (falso quando ja estava listado)
 */
export function registrarArquivo(
    cfg: Record<string, unknown>,
    caminho: string,
    papel: PapelDeEntrada,
    chave: (c: string) => string,
): boolean {
    const alvo = chave(caminho);
    for (const lista of LISTAS) {
        const atual = cfg[lista];
        if (Array.isArray(atual) && (atual as Entrada[]).some((e) => !!e && typeof e.path === 'string' && chave(e.path) === alvo)) {
            return false;
        }
    }
    const destino = LISTA_DE_ENTRADA[papel];
    const lista = Array.isArray(cfg[destino]) ? (cfg[destino] as Entrada[]) : [];
    lista.push({ name: caminho.split(/[\\/]/).pop(), path: caminho, isTopLevel: false });
    cfg[destino] = lista;
    return true;
}
