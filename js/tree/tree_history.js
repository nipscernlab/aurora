/**
 * tree_history.js — a pilha de desfazer e refazer da árvore de arquivos.
 *
 * Ctrl+Z e Ctrl+Shift+Z valem para o que a árvore fez com os arquivos: criar,
 * renomear, mover, copiar e deletar. Só isso: o Ctrl+Z do editor continua sendo
 * do Monaco, e as duas pilhas nunca se misturam porque esta só escuta quando a
 * árvore tem o foco.
 *
 * TUDO SE REDUZ A DUAS FORMAS
 * ---------------------------
 * Qualquer operação da árvore é uma destas duas, e é por isso que a pilha é
 * pequena:
 *
 *   move      um caminho virou outro. Desfazer é renomear de volta. Renomear,
 *             mover, arrastar e recortar-e-colar são todos isto.
 *   existence um caminho passou a existir, ou deixou de existir. Criar e colar
 *             são o primeiro caso; deletar é o segundo.
 *
 * O `existence` só funciona porque deletar não vai direto para a Lixeira: passa
 * pela área de espera de main/ipc/tree_undo.js, de onde dá para voltar. O mesmo
 * mecanismo desfaz uma criação sem apagar o que o usuário já escreveu no
 * arquivo novo.
 *
 * O LIMITE, E POR QUE ELE EXISTE
 * ------------------------------
 * A pilha guarda no máximo LIMITE operações. O que cai fora não é só esquecido:
 * se segurava algo na espera, aquilo vai para a Lixeira. Sem esse descarte a
 * pasta de espera cresceria por toda a sessão, segurando arquivos que o usuário
 * acha que já deletou.
 */

const LIMITE = 30;

/**
 * A pilha, sem nenhum acesso a disco: quem executa é o dono (o CRUD da árvore),
 * que passa os executores em `aplicar`. Assim isto é testável sozinho.
 */
export class TreeHistory {
    /**
     * @param {{
     *   mover: (de: string, para: string) => Promise<boolean>,
     *   guardar: (caminho: string) => Promise<string|null>,
     *   restaurar: (token: string, caminho: string) => Promise<boolean>,
     *   descartar: (token: string) => Promise<void>,
     * }} exec
     */
    constructor(exec) {
        this.exec = exec;
        /** @type {Array<object>} operações já aplicadas, da mais antiga para a mais nova */
        this.feito = [];
        /** @type {Array<object>} operações desfeitas, prontas para refazer */
        this.desfeito = [];
        /** Enquanto desfazemos, o CRUD não deve gravar a operação inversa. */
        this.aplicando = false;
    }

    /** Grava uma operação recém-concluída. Refazer deixa de fazer sentido. */
    registrar(op) {
        if (this.aplicando) return;
        this.feito.push(op);
        // O ramo de refazer morre a cada ação nova, como em qualquer editor.
        for (const antiga of this.desfeito) this._soltar(antiga);
        this.desfeito = [];
        while (this.feito.length > LIMITE) this._soltar(this.feito.shift());
    }

    /** Uma operação saiu do alcance: o que ela segurava na espera vai embora. */
    _soltar(op) {
        if (op?.token) this.exec.descartar(op.token).catch(() => { /* best-effort */ });
    }

    podeDesfazer() { return this.feito.length > 0; }
    podeRefazer() { return this.desfeito.length > 0; }

    /**
     * Desfaz a última operação.
     * @returns {Promise<{ok: boolean, foco?: string, erro?: string}>}
     *   `foco` é o caminho que a árvore deve selecionar depois.
     */
    async desfazer() {
        const op = this.feito.pop();
        if (!op) return { ok: false };
        const r = await this._executar(op, true);
        if (!r.ok) { this.feito.push(op); return r; }
        this.desfeito.push(r.op);
        return { ok: true, foco: r.foco };
    }

    /** Refaz a última operação desfeita. */
    async refazer() {
        const op = this.desfeito.pop();
        if (!op) return { ok: false };
        const r = await this._executar(op, false);
        if (!r.ok) { this.desfeito.push(op); return r; }
        this.feito.push(r.op);
        return { ok: true, foco: r.foco };
    }

    /**
     * Aplica uma operação numa direção. Devolve a operação atualizada, porque
     * um `existence` troca de token a cada volta.
     */
    async _executar(op, desfazendo) {
        this.aplicando = true;
        try {
            if (op.kind === 'move') {
                const de = desfazendo ? op.para : op.de;
                const para = desfazendo ? op.de : op.para;
                const ok = await this.exec.mover(de, para);
                if (!ok) return { ok: false, erro: 'nao foi possivel mover de volta' };
                return { ok: true, op, foco: para };
            }

            if (op.kind === 'existence') {
                // `presente` diz se o caminho existe DEPOIS da operação. Desfazer
                // inverte: o que passou a existir sai, o que saiu volta.
                const deveExistir = desfazendo ? !op.presente : op.presente;
                if (deveExistir) {
                    if (!op.token) return { ok: false, erro: 'nada guardado para restaurar' };
                    const ok = await this.exec.restaurar(op.token, op.caminho);
                    if (!ok) return { ok: false, erro: 'nao foi possivel restaurar' };
                    return { ok: true, op: { ...op, presente: true, token: null }, foco: op.caminho };
                }
                const token = await this.exec.guardar(op.caminho);
                if (!token) return { ok: false, erro: 'nao foi possivel remover' };
                return { ok: true, op: { ...op, presente: false, token }, foco: op.caminho };
            }

            return { ok: false, erro: `operacao desconhecida: ${op.kind}` };
        } finally {
            this.aplicando = false;
        }
    }

    /**
     * Esquece tudo, devolvendo à Lixeira o que estava na espera. Chamado ao
     * trocar de projeto: desfazer não pode atravessar projetos, senão o
     * caminho a restaurar aponta para fora do que está aberto.
     */
    limpar() {
        for (const op of [...this.feito, ...this.desfeito]) this._soltar(op);
        this.feito = [];
        this.desfeito = [];
    }
}

/** Fábricas das duas formas, para o CRUD não montar o objeto na mão. */
export const Op = {
    /** Um caminho virou outro: renomear, mover, arrastar, recortar e colar. */
    move: (de, para) => ({ kind: 'move', de, para }),
    /** Passou a existir: criar, copiar e colar. */
    criado: (caminho) => ({ kind: 'existence', caminho, presente: true, token: null }),
    /** Deixou de existir, e `token` é onde está esperando. */
    removido: (caminho, token) => ({ kind: 'existence', caminho, presente: false, token }),
};

export { LIMITE };
