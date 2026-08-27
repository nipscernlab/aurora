/**
 * spf_paths.js: o que acontece com o `.spf` quando a árvore mexe num arquivo.
 *
 * O `.spf` guarda caminhos em quatro lugares: `topLevelFile` e `testbenchFile`
 * (o topo de síntese e o topo de simulação) e as listas `synthesizableFiles` e
 * `testbenchFiles`. Renomear, mover ou apagar um desses arquivos pela visão
 * Pastas mexia só no disco, e o `.spf` seguia apontando para um caminho que
 * não existe mais.
 *
 * O sintoma não era um erro: era o arquivo sumir da visão Verilog na próxima
 * abertura, ou a compilação reclamar de um arquivo ausente com o nome antigo,
 * dois passos depois de a renomeação ter parecido funcionar. Por isso a
 * correção mora aqui e não numa mensagem: quem move o arquivo arruma a
 * referência no mesmo gesto.
 *
 * Regras que valem para os quatro campos:
 *   - comparação sem distinguir barra nem maiúscula, porque é Windows e o
 *     mesmo arquivo aparece como `C:\p\a.v` e `c:/p/a.v`;
 *   - renomear uma PASTA arrasta tudo que estava embaixo dela;
 *   - apagar limpa a referência: sai das listas, e se era o topo, o topo fica
 *     vazio, que é como o `.spf` diz "não escolhido".
 *
 * Puro: recebe e muta a `structure` (a mesma forma que o mutator do SpfStore
 * entrega), devolve quantas referências mudaram. Sem disco e sem electron,
 * para ter teste.
 */

/** Caminho comparável: barras iguais, sem barra final, minúsculo. */
function chave(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** `caminho` é o próprio `base` ou está dentro dele. */
function souOuDentro(caminho, base) {
    const c = chave(caminho);
    const b = chave(base);
    return !!b && !!c && (c === b || c.startsWith(b + '/'));
}

/**
 * `caminho` reescrito para o novo lugar, preservando o separador do destino.
 * Só o prefixo `de` muda; o resto do caminho vem inteiro.
 */
function reescrever(caminho, de, para) {
    const c = String(caminho || '');
    const resto = c.slice(String(de).length);
    return para + resto.replace(/[\\/]/g, para.includes('\\') ? '\\' : '/');
}

/** Os dois campos de caminho único do `.spf`. */
const CAMPOS_TOPO = ['topLevelFile', 'testbenchFile'];
/** As duas listas de arquivos do `.spf`. */
const CAMPOS_LISTA = ['synthesizableFiles', 'testbenchFiles'];

/** Último segmento, para manter o `name` das listas coerente com o `path`. */
function nomeDe(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
}

/**
 * Um caminho virou outro: renomear, mover, arrastar, recortar e colar.
 *
 * @param {Record<string, any>} structure a `structure` do `.spf`, mutada
 * @param {string} de caminho antigo (arquivo ou pasta)
 * @param {string} para caminho novo
 * @returns {number} quantas referências foram reescritas
 */
export function renomearNoSpf(structure, de, para) {
    if (!structure || !de || !para) return 0;
    let mudou = 0;

    for (const campo of CAMPOS_TOPO) {
        const atual = structure[campo];
        if (typeof atual === 'string' && souOuDentro(atual, de)) {
            structure[campo] = reescrever(atual, de, para);
            mudou++;
        }
    }

    for (const campo of CAMPOS_LISTA) {
        const lista = Array.isArray(structure[campo]) ? structure[campo] : null;
        if (!lista) continue;
        for (const entrada of lista) {
            if (!entrada || typeof entrada.path !== 'string') continue;
            if (!souOuDentro(entrada.path, de)) continue;
            entrada.path = reescrever(entrada.path, de, para);
            // O `name` existe para a interface não ter que derivar do caminho;
            // deixá-lo velho mostraria o nome antigo numa linha que já aponta
            // para o arquivo novo.
            if (typeof entrada.name === 'string') entrada.name = nomeDe(entrada.path);
            mudou++;
        }
    }

    return mudou;
}

/**
 * Um ou mais caminhos deixaram de existir: apagar.
 *
 * Devolve o que foi tirado, e não só quantos, porque apagar pela árvore é
 * desfazível: o Ctrl+Z traz o arquivo de volta, e sem isto ele voltaria como
 * um arquivo qualquer, sem a marca de topo de síntese que tinha antes. O
 * usuário não veria erro nenhum, só o botão Verilog deixando de achar o topo.
 *
 * @param {Record<string, any>} structure a `structure` do `.spf`, mutada
 * @param {string[]} caminhos arquivos ou pastas apagados
 * @returns {{ total: number, topo: Record<string, string>, listas: Record<string, any[]> }}
 *   o que sair daqui volta em `reporNoSpf`
 */
export function removerDoSpf(structure, caminhos) {
    const alvos = (Array.isArray(caminhos) ? caminhos : [caminhos]).filter(Boolean);
    const retirado = { total: 0, topo: {}, listas: {} };
    if (!structure || !alvos.length) return retirado;
    const atingido = (p) => alvos.some((alvo) => souOuDentro(p, alvo));

    for (const campo of CAMPOS_TOPO) {
        const atual = structure[campo];
        if (typeof atual === 'string' && atual && atingido(atual)) {
            // Vazio é como o `.spf` diz "nenhum escolhido"; apontar para um
            // arquivo que não existe faria a compilação falhar mais tarde,
            // longe do gesto que causou.
            retirado.topo[campo] = atual;
            structure[campo] = '';
            retirado.total++;
        }
    }

    for (const campo of CAMPOS_LISTA) {
        const lista = Array.isArray(structure[campo]) ? structure[campo] : null;
        if (!lista) continue;
        const saiu = [];
        const restante = lista.filter((entrada) => {
            const fora = entrada && typeof entrada.path === 'string' && atingido(entrada.path);
            if (fora) { saiu.push(entrada); retirado.total++; }
            return !fora;
        });
        if (saiu.length) {
            retirado.listas[campo] = saiu;
            structure[campo] = restante;
        }
    }

    return retirado;
}

/**
 * Devolve ao `.spf` o que `removerDoSpf` tirou: o outro lado do Ctrl+Z.
 *
 * O topo só volta se ainda estiver vazio. Se o usuário escolheu outro topo
 * entre o apagar e o desfazer, a escolha dele é mais recente que a nossa
 * anotação e ganha.
 *
 * @param {Record<string, any>} structure
 * @param {{ topo?: Record<string, string>, listas?: Record<string, any[]> }} retirado
 * @returns {number} quantas referências voltaram
 */
export function reporNoSpf(structure, retirado) {
    if (!structure || !retirado) return 0;
    let voltou = 0;

    for (const [campo, valor] of Object.entries(retirado.topo || {})) {
        if (!structure[campo]) { structure[campo] = valor; voltou++; }
    }

    for (const [campo, entradas] of Object.entries(retirado.listas || {})) {
        const lista = Array.isArray(structure[campo]) ? structure[campo] : [];
        const jaTem = new Set(lista.map((e) => chave(e?.path)));
        for (const entrada of entradas || []) {
            // Um recarregamento do projeto entre o apagar e o desfazer pode ter
            // reclassificado o arquivo sozinho; repor de novo o duplicaria.
            if (jaTem.has(chave(entrada?.path))) continue;
            lista.push(entrada);
            voltou++;
        }
        structure[campo] = lista;
    }

    return voltou;
}

/**
 * O nome do processador cuja pasta é `caminho`, ou null.
 *
 * Serve para a árvore RECUSAR renomear ou apagar a pasta de um processador
 * pela visão Pastas. Renomear a pasta é só o primeiro dos cinco passos que um
 * processador exige (pasta, `.cmm`, `#PRNAME`, `.spf` e artefatos), e fazer só
 * o primeiro deixa o projeto num estado que não compila e não avisa. Quem faz
 * os cinco é o `renameProcessor`.
 *
 * @param {Record<string, any>} structure
 * @param {string} raiz pasta do projeto
 * @param {string} caminho pasta candidata
 * @returns {string|null}
 */
export function processadorEm(structure, raiz, caminho) {
    const lista = Array.isArray(structure?.processors) ? structure.processors : [];
    const alvo = chave(caminho);
    for (const proc of lista) {
        const nome = proc && typeof proc.name === 'string' ? proc.name : null;
        if (!nome) continue;
        if (chave(`${raiz}/${nome}`) === alvo) return nome;
    }
    return null;
}
