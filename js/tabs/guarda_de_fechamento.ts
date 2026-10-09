/**
 * guarda_de_fechamento.ts: fechar a janela nao perde o que nao foi salvo.
 *
 * Achado em 09/10/2026: o x da janela mandava `window:close` direto ao main,
 * que fechava, e nada perguntava ao editor. O documento sem nome (Untitled-N)
 * vive so na memoria (o mapa untitledDocuments e o modelo do Monaco), e a
 * edicao nao salva de um arquivo com nome tambem; os dois sumiam sem aviso.
 *
 * Como funciona: o Electron cancela o fechamento da janela quando o
 * beforeunload da pagina o cancela. A guarda cancela so quando ha algo nao
 * salvo, pergunta (salvar tudo, descartar, cancelar) e, decidido fechar,
 * fecha pelo canal de sempre (electronAPI.windowClose), desta vez deixando
 * passar. Cobre o x, o Alt+F4 e o fechar pela barra de tarefas, sem mexer no
 * main nem na ponte.
 *
 * Nao cobre o encerramento que o proprio app inicia com app.exit (instalar
 * atualizacao, reiniciar), que nao passa pelo beforeunload: ver TODO 13b.
 */

/** O que a guarda le do TabManager. */
export interface AbasParaGuarda {
    tabs: Map<string, unknown>;
    unsavedChanges: Set<string>;
    isUntitledPath(caminho: string): boolean;
    isBinaryFile(caminho: string): boolean;
    getDisplayName(caminho: string): string;
    saveFile(caminho: string): Promise<boolean>;
}

/** O dialogo padrao do app (js/ui/dialog_manager.js, window.AuroraUI.dialog). */
export type Dialogo = (opcoes: {
    title: string;
    message: string;
    variant: string;
    buttons: Array<{ label: string; action: string; type: string }>;
}) => Promise<unknown>;

export interface NaoSalvo {
    caminho: string;
    nome: string;
}

/** Quantos nomes o dialogo mostra antes de so contar o resto. */
const MOSTRADOS = 8;

const tr = (chave: string, reserva: string, p?: Record<string, unknown>) => {
    const v = window.t?.(chave, p);
    return v && v !== chave ? v : reserva;
};

function escapar(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/** Sujo, pela mesma regra do "Salvar tudo" (salvar_abas.ts). */
function estaSujo(tm: AbasParaGuarda, caminho: string): boolean {
    const sujoNoModelo = !!window.SharedModelRegistry?.isDirty?.(caminho);
    // Sem nome: conta se tem texto (o registro marca sujo, ou o TabManager
    // anotou a mudanca). Aba sem nome vazia nao e trabalho a perder.
    if (tm.isUntitledPath(caminho)) return sujoNoModelo || tm.unsavedChanges.has(caminho);
    return sujoNoModelo;
}

/**
 * O que se perderia fechando agora: as abas da janela principal e as que so
 * os paineis divididos tem, na ordem em que aparecem.
 */
export function arquivosNaoSalvos(tm: AbasParaGuarda): NaoSalvo[] {
    const caminhos = new Set(tm.tabs.keys());
    const split = window.SplitEditorManager;
    for (const painel of split?.panes || []) {
        painel?.tabs?.forEach?.((_info: unknown, p: string) => caminhos.add(p));
    }
    const lista: NaoSalvo[] = [];
    for (const caminho of caminhos) {
        if (tm.isBinaryFile(caminho) || !estaSujo(tm, caminho)) continue;
        lista.push({ caminho, nome: tm.getDisplayName(caminho) });
    }
    return lista;
}

/**
 * Pergunta e resolve. 'fechar' quando nao ha o que perder, quando a pessoa
 * descarta, ou quando salvou tudo; 'ficar' quando cancela ou quando algum
 * arquivo nao foi salvo (o dialogo de salvar de um sem nome cancelado, uma
 * falha de escrita).
 */
export async function decidirFechamento(tm: AbasParaGuarda, dialogo: Dialogo): Promise<'fechar' | 'ficar'> {
    const lista = arquivosNaoSalvos(tm);
    if (lista.length === 0) return 'fechar';

    const nomes = lista.slice(0, MOSTRADOS).map((a) => `<li>${escapar(a.nome)}</li>`).join('');
    const resto = lista.length > MOSTRADOS ? `<li>+${lista.length - MOSTRADOS}</li>` : '';
    const resposta = await dialogo({
        title: tr('dialog.closeWindow.title', 'Unsaved changes'),
        message: tr('dialog.closeWindow.message', 'These files have changes that are not saved. Closing now loses them:', { count: lista.length })
            + `<ul>${nomes}${resto}</ul>`,
        variant: 'warning',
        buttons: [
            { label: tr('dialog.common.cancel', 'Cancel'), action: 'cancel', type: 'cancel' },
            { label: tr('dialog.closeWindow.discard', 'Close without saving'), action: 'discard', type: 'danger' },
            { label: tr('dialog.closeWindow.saveAll', 'Save all and close'), action: 'save-all', type: 'primary' },
        ],
    });

    if (resposta === 'discard') return 'fechar';
    if (resposta !== 'save-all') return 'ficar';
    for (const { caminho } of lista) {
        try {
            if (!(await tm.saveFile(caminho))) return 'ficar';
        } catch (erro) {
            console.error('[guarda de fechamento] falha ao salvar', caminho, erro);
            return 'ficar';
        }
    }
    // Salvar pode voltar sem erro e o arquivo continuar sujo (o .spf de um
    // processador, uma escrita recusada que so avisou): confere antes de fechar.
    return arquivosNaoSalvos(tm).length === 0 ? 'fechar' : 'ficar';
}

/**
 * Arma a guarda na janela. Devolve a funcao que a tira (para os testes).
 *
 * @param api o electronAPI; so o windowClose e usado
 * @param dialogo o dialogo padrao; recebido de fora para ser trocado no teste
 */
export function instalarGuarda(
    tm: AbasParaGuarda,
    api: { windowClose?: () => void } | null | undefined,
    dialogo: Dialogo,
): () => void {
    let liberado = false;
    let decidindo = false;
    const aoSair = (e: Event) => {
        if (liberado || arquivosNaoSalvos(tm).length === 0) return;
        // Cancela o fechamento (o Electron honra os dois jeitos).
        e.preventDefault();
        (e as BeforeUnloadEvent).returnValue = false as unknown as string;
        if (decidindo) return;
        decidindo = true;
        decidirFechamento(tm, dialogo)
            .then((r) => {
                if (r !== 'fechar') return;
                liberado = true;
                api?.windowClose?.();
            })
            .catch((erro) => console.error('[guarda de fechamento] dialogo falhou:', erro))
            .finally(() => { decidindo = false; });
    };
    window.addEventListener('beforeunload', aoSair);
    return () => window.removeEventListener('beforeunload', aoSair);
}

/**
 * O dialogo padrao, procurado na hora da pergunta (o dialog_manager pode
 * carregar depois do editor). Sem ele, o confirm do navegador: aceitar e
 * fechar sem salvar, recusar e ficar.
 */
export const dialogoPadrao: Dialogo = (opcoes) => {
    const dialogo = window.AuroraUI?.dialog;
    if (typeof dialogo === 'function') return (dialogo as Dialogo)(opcoes);
    const texto = tr('dialog.closeWindow.fallback', 'There are unsaved changes. Close without saving?');
    return Promise.resolve(window.confirm(texto) ? 'discard' : 'cancel');
};
