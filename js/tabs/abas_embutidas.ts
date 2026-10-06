/**
 * abas_embutidas.ts: as abas que mostram uma pagina dentro do editor, sem
 * texto por tras: a onda no Surfer e o esquematico do PRISM.
 *
 * Saiu do tab_manager em 05/10/2026, no formato dos outros mixins da pasta
 * (tab_viewers, tab_drag, tab_watchers): metodos que usam `this`, instalados
 * no TabManager por Object.assign. O roteamento (isSurferView, isPrismView) e
 * consultado DENTRO do addTab, por isso abrir uma destas registra a aba no
 * mapa antes de chamar o addTab.
 */

/** O que estas abas guardam no TabManager. */
type AbaDoSurfer = { tabId: string, pageUrl: string };
type AbaDoPrism = { result: unknown };

/** O <webview> do Electron, com o envio de mensagem para a pagina. */
type Webview = HTMLElement & { send(canal: string, ...args: unknown[]): void };

/** O que este mixin le e escreve no TabManager. */
interface AnfitriaoDasEmbutidas {
    surferViews: Map<string, AbaDoSurfer>;
    prismViews: Map<string, AbaDoPrism>;
    viewerInstances: Map<string, HTMLElement>;
    PRISM_TAB: string;
    addTab(filePath: string, content?: string | null, options?: Record<string, unknown>): void;
    activateTab(filePath: string): void;
    refreshSurferViewer(filePath: string, pageUrl: string): void;
}

/** Os metodos deste mixin. */
export interface AbasEmbutidas {
    isSurferView(filePath: string): boolean;
    isPrismView(filePath: string): boolean;
    isEmbeddedView(filePath: string): boolean;
    openSurferWave(wavePath: string, pageUrl: string, tabId: string): void;
    openPrismTab(result: unknown): void;
    createPrismViewer(filePath: string): HTMLElement;
    refreshPrismViewer(filePath: string, result: unknown): void;
}

export const abasEmbutidas: AbasEmbutidas & ThisType<AnfitriaoDasEmbutidas & AbasEmbutidas> = {
    isSurferView(filePath) {
        return this.surferViews.has(filePath);
    },

    isPrismView(filePath) {
        return this.prismViews.has(filePath);
    },

    /** Aba do PRISM ou do Surfer: paginas dentro do editor, sem texto por tras. */
    isEmbeddedView(filePath) {
        return this.isSurferView(filePath) || this.isPrismView(filePath);
    },

    /**
     * Abre (ou reusa) a aba do Surfer para uma onda.
     *
     * Quem chama ja subiu o servidor via electronAPI.surferTabServe e traz a
     * pageUrl pronta; aqui e so gerencia de aba. Reuso e o caso comum: o aluno
     * recompila com a aba aberta, o main ja derrubou o servidor anterior e
     * subiu outro (porta/token novos), entao o iframe recarrega na URL nova e
     * a aba apenas volta para a frente.
     *
     * @param wavePath caminho real do .vcd/.fst (vira o titulo da aba)
     * @param pageUrl  aurora-surfer://web/index.html?load_url=...
     * @param tabId    id que amarra o servidor no main (stop ao fechar)
     */
    openSurferWave(wavePath, pageUrl, tabId) {
        if (this.surferViews.has(wavePath)) {
            this.surferViews.set(wavePath, { tabId, pageUrl });
            this.refreshSurferViewer(wavePath, pageUrl);
            this.activateTab(wavePath);
            return;
        }
        // Registrado ANTES do addTab: o roteamento (isSurferView) e consultado
        // dentro dele para pular editor de texto e file watcher.
        this.surferViews.set(wavePath, { tabId, pageUrl });
        this.addTab(wavePath);
    },

    /**
     * Abre (ou reusa) a aba do PRISM com o resultado de uma compilacao.
     *
     * O main ja sintetizou e desenhou; aqui e so gerencia de aba e entrega do
     * resultado a pagina. Reuso e o caso comum: recompilar com a aba aberta
     * manda o resultado novo para o mesmo <webview>, que redesenha, e a aba
     * so volta para a frente.
     *
     * @param result o que prism-compile-with-paths devolveu
     */
    openPrismTab(result) {
        const key = this.PRISM_TAB;
        if (this.prismViews.has(key)) {
            this.prismViews.set(key, { result });
            this.refreshPrismViewer(key, result);
            this.activateTab(key);
            return;
        }
        // Registrado ANTES do addTab: o roteamento (isPrismView) e consultado
        // dentro dele para pular editor de texto e file watcher.
        this.prismViews.set(key, { result });
        this.addTab(key);
    },

    /**
     * A pagina do PRISM dentro do editor.
     *
     * Um <webview>, e nao um iframe: a pagina precisa do preload dela (yosys,
     * leitura de SVG por IPC), e iframe nao recebe preload. A URL e o preload
     * vem do main pela MESMA regra da janela, e o main so deixa anexar esse
     * par (will-attach-webview). O resultado da compilacao vai pelo canal
     * compilation-complete, o mesmo que a janela ouve, entao a pagina nao sabe
     * se esta numa aba ou numa janela, exceto pelo `embedded=1` que esconde os
     * controles de janela.
     */
    createPrismViewer(filePath) {
        const viewer = document.createElement('div');
        viewer.className = 'prism-viewer';
        viewer.dataset.filePath = filePath;
        this.viewerInstances.set(filePath, viewer);

        const avisar = (msg: string) => {
            viewer.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'prism-viewer-erro';
            p.textContent = msg;
            viewer.appendChild(p);
        };
        const motivo = (e: unknown) => (e as Error | null)?.message || e;

        (async () => {
            let pagina;
            try {
                pagina = await window.electronAPI?.prismTabPage?.();
            } catch (e) {
                avisar(`PRISM: ${motivo(e)}`);
                return;
            }
            if (!pagina?.ok) {
                avisar(`PRISM: ${pagina?.error || 'prism-tab:page respondeu sem URL nem erro'}`);
                return;
            }
            const wv = document.createElement('webview') as Webview;
            wv.className = 'prism-frame';
            wv.setAttribute('preload', pagina.preload as string);
            wv.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes,nodeIntegration=no');
            wv.setAttribute('aria-label', 'PRISM');
            wv.setAttribute('src', pagina.url as string);
            wv.addEventListener('dom-ready', () => {
                const entry = this.prismViews.get(filePath);
                if (entry?.result) {
                    try { wv.send('compilation-complete', entry.result); } catch (e) { avisar(`PRISM: ${motivo(e)}`); }
                }
            });
            viewer.appendChild(wv);
        })();

        return viewer;
    },

    /** Entrega um resultado novo a aba ja aberta. */
    refreshPrismViewer(filePath, result) {
        const viewer = this.viewerInstances.get(filePath);
        const wv = viewer && viewer.querySelector<Webview>('webview.prism-frame');
        if (!wv) return;
        try { wv.send('compilation-complete', result); } catch (_) { /* a pagina ainda nao subiu; dom-ready entrega */ }
    },
};
