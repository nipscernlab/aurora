/**
 * spf_da_arvore.ts: o `.spf` acompanha o que a arvore fez com o arquivo.
 *
 * Ele guarda o topo de sintese, o topo de simulacao e as duas listas de
 * arquivos. Mexer no disco sem mexer nele deixava a referencia apontando para
 * um caminho que nao existe, e o usuario so descobria dois passos depois,
 * quando o arquivo sumia da visao Verilog ou a compilacao reclamava de um nome
 * que ele acabara de mudar.
 *
 * Melhor esforco de proposito: o arquivo ja mudou de lugar no disco, e uma
 * falha ao anotar isso nao pode desfazer o que o usuario pediu. A regra em si
 * e pura e esta em spf_paths.ts; aqui fica o disco e a memoria do que o apagar
 * tirou, que o Ctrl+Z devolve.
 *
 * Saiu do standard_tree_crud.js (TODO 13.3).
 */

import { ProjectStore } from '../project/project_store.js';
import { SpfStore } from '../project/spf_store.js';
import { renomearNoSpf, removerDoSpf, reporNoSpf, processadorEm } from '../project/spf_paths.js';
import { normSlash } from './fs_name_utils.js';

type Retirado = ReturnType<typeof removerDoSpf>;

export class SpfDaArvore {
    /** caminho apagado (normalizado) -> o que ele tinha no .spf, para o Ctrl+Z repor. */
    readonly retirado = new Map<string, Retirado>();

    async renomeou(de: string, para: string): Promise<void> {
        const spf = ProjectStore.getSpfPath?.();
        if (!spf) return;
        try { await SpfStore.update(spf, (cfg) => { renomearNoSpf(cfg, de, para); }); }
        catch (err) { console.error('spf rename bookkeeping failed:', err); }
    }

    /**
     * O que sai do `.spf` fica guardado por caminho, porque apagar pela arvore
     * e desfazivel: sem isto o Ctrl+Z traria o arquivo de volta como um
     * arquivo qualquer, sem a marca de topo que ele tinha, e ninguem veria
     * erro nenhum, so o botao Verilog deixando de achar o topo.
     */
    async removeu(caminhos: string[]): Promise<void> {
        const spf = ProjectStore.getSpfPath?.();
        if (!spf || !caminhos?.length) return;
        try {
            await SpfStore.update(spf, (cfg) => {
                for (const caminho of caminhos) {
                    const retirado = removerDoSpf(cfg, [caminho]);
                    if (retirado.total) this.retirado.set(normSlash(caminho).toLowerCase(), retirado);
                }
            });
        } catch (err) { console.error('spf delete bookkeeping failed:', err); }
    }

    /** O outro lado do Ctrl+Z: devolve ao `.spf` o que o apagar tirou. */
    async repos(caminho: string): Promise<void> {
        const spf = ProjectStore.getSpfPath?.();
        const chave = normSlash(caminho).toLowerCase();
        const retirado = this.retirado.get(chave);
        if (!spf || !retirado) return;
        this.retirado.delete(chave);
        try { await SpfStore.update(spf, (cfg) => { reporNoSpf(cfg, retirado); }); }
        catch (err) { console.error('spf restore bookkeeping failed:', err); }
    }

    /**
     * O nome do processador cuja pasta e `caminho`, ou null.
     *
     * A arvore recusa renomear e apagar essa pasta. Renomear e o primeiro de
     * cinco passos (pasta, `.cmm`, `#PRNAME`, `.spf` e artefatos), e fazer so o
     * primeiro deixa um projeto que nao compila sem dizer por que; quem faz os
     * cinco e o `renameProcessor` da API.
     */
    async processadorEm(caminho: string, raiz: string | null): Promise<string | null> {
        const spf = ProjectStore.getSpfPath?.();
        if (!spf || !raiz) return null;
        try {
            const cfg = await SpfStore.read(spf);
            return processadorEm(cfg, raiz, caminho);
        } catch (_) { return null; }
    }
}
