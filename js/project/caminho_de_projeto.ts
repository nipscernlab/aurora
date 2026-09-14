/**
 * caminho_de_projeto.js: caminho de arquivo do projeto que sobrevive a troca
 * de maquina.
 *
 * O QUE ACONTECEU. Um aluno levou um projeto de um computador para outro. O
 * projeto tinha um `.gtkw` escolhido, e ao compilar a AURORA foi abrir o
 * caminho da PRIMEIRA maquina. O arquivo estava ali, dentro da pasta do
 * projeto, junto com todo o resto que veio no pendrive; o que nao veio foi a
 * letra de unidade e o nome do usuario.
 *
 * A REGRA, e ela e simples. Arquivo que mora DENTRO da pasta do projeto, do
 * nivel do `.spf` para dentro, e gravado relativo a raiz. Arquivo que mora fora
 * fica absoluto, porque relativo a alguma coisa que nao viaja com o projeto nao
 * ajudaria ninguem. A raiz do projeto nunca e lida de dentro de um arquivo do
 * projeto: ela e a pasta onde o `.spf` esta AGORA.
 *
 * BARRA NORMAL AO GRAVAR. O Windows aceita as duas, e a `/` e a unica que
 * sobrevive a um `git diff` legivel, a um editor de texto em outro sistema e a
 * um JSON que alguem abra na mao. Ao LER, as duas passam.
 *
 * O RESGATE, que e o que salva os projetos que ja estao por ai. Um caminho
 * absoluto gravado na maquina antiga nao tem conserto automatico possivel, com
 * uma excecao que cobre justamente o caso relatado: se o caminho antigo termina
 * com uma sequencia de pastas que EXISTE dentro do projeto atual, e quase certo
 * que e o mesmo arquivo, que se mudou de lugar junto com a pasta. Entao se
 * tenta a cauda. Sem isso, a correcao valeria so para projeto criado depois
 * dela, e o aluno que trouxe o problema continuaria com o problema.
 *
 * Puro: mexe em string, nao toca disco. Quem toca disco passa um verificador.
 */

/** Separador para GRAVAR. Ao ler, as duas barras passam. */
const SEP = '/';

/**
 * Um caminho que NAO se resolve contra outra pasta.
 *
 * Tres formas, e a terceira nao e enfeite. `C:/proj` e a letra de unidade;
 * `//servidor/proj` e o caminho de rede; e `/proj`, com uma barra so, e o
 * caminho enraizado, que no Windows vale a partir da unidade corrente e em
 * qualquer outro sistema e simplesmente a raiz. Tratar essa terceira forma
 * como relativa faria `paraAbsoluto` colar a raiz do projeto na frente dela e
 * produzir `C:/proj//proj/tb.v`, que nao existe em lugar nenhum.
 */
const ABSOLUTO = /^[A-Za-z]:[\\/]|^[\\/]/;

/** Barras normalizadas e o `/` final fora, para comparar dois caminhos. */
function normalizar(p: string | null | undefined): string {
    return String(p || '').replace(/\\/g, SEP).replace(/\/+$/, '');
}

/** Este caminho e absoluto? */
export function ehAbsoluto(p: string | null | undefined): boolean {
    return ABSOLUTO.test(String(p || ''));
}

/**
 * O caminho esta dentro da raiz, no nivel dela ou mais fundo?
 *
 * A comparacao ignora caixa porque o Windows ignora, e exige o separador
 * depois da raiz: sem ele, `C:/proj2` contaria como dentro de `C:/proj`.
 */
export function dentroDaRaiz(raiz: string, p: string): boolean {
    const r = normalizar(raiz).toLowerCase();
    const c = normalizar(p).toLowerCase();
    if (!r || !c) return false;
    return c === r || c.startsWith(r + SEP);
}

/**
 * Como GRAVAR este caminho: relativo quando esta dentro do projeto, e como
 * veio quando esta fora.
 *
 * @param {string} raiz pasta do projeto (onde o .spf esta)
 * @param {string} p caminho absoluto ou ja relativo
 */
export function paraRelativo(raiz: string, p: string): string {
    const c = normalizar(p);
    if (!c) return '';
    if (!ehAbsoluto(c)) return c;                  // ja relativo, so normaliza a barra
    if (!dentroDaRaiz(raiz, c)) return c;          // fora do projeto: fica absoluto
    const r = normalizar(raiz);
    return c.slice(r.length + 1) || '.';
}

/**
 * Como USAR este caminho: absoluto, resolvido contra a raiz de AGORA.
 *
 * @param {string} raiz
 * @param {string} p
 */
export function paraAbsoluto(raiz: string, p: string): string {
    const c = normalizar(p);
    if (!c) return '';
    if (ehAbsoluto(c)) return c;
    const r = normalizar(raiz);
    if (!r) return c;
    return `${r}${SEP}${c}`;
}

/**
 * A cauda de um caminho absoluto que ainda pode ser achada no projeto de hoje.
 *
 * Tenta os sufixos do caminho antigo, do mais longo para o mais curto: para
 * `C:/velho/proj/Testbench/tb.v` tenta `velho/proj/Testbench/tb.v`,
 * `proj/Testbench/tb.v`, `Testbench/tb.v`, `tb.v`. O primeiro que existir na
 * raiz de hoje ganha.
 *
 * Do mais longo para o mais curto de proposito: quanto mais pastas casam,
 * menor a chance de acertar um homonimo. Cair no nome do arquivo sozinho e o
 * ultimo recurso, e ainda assim e melhor do que um caminho que nao existe.
 *
 * @param {string} raiz
 * @param {string} antigo o caminho absoluto gravado na outra maquina
 * @param {(p: string) => boolean} existe testa se um caminho existe
 * @returns {string|null} o caminho de hoje, ou null quando nao ha palpite
 */
export function resgatarPelaCauda(raiz: string, antigo: string, existe: (p: string) => boolean): string | null {
    const partes = normalizar(antigo).split(SEP).filter(Boolean);
    const r = normalizar(raiz);
    if (!r || partes.length < 2) return null;
    // Comeca em 1 para nunca tentar a cauda inteira com a letra de unidade.
    for (let i = 1; i < partes.length; i++) {
        const tentativa = `${r}${SEP}${partes.slice(i).join(SEP)}`;
        if (existe(tentativa)) return tentativa;
    }
    return null;
}

/**
 * Os caminhos a tentar, na ordem, para algo gravado antes.
 *
 * Existe porque quem testa existencia de arquivo aqui trabalha por IPC e e
 * assincrono, e a ORDEM de tentativa e a parte que merece teste. Esta funcao
 * fica pura e devolve a lista; quem chama percorre com `await` e para no
 * primeiro que existir.
 *
 * O primeiro da lista e a leitura normal (relativo resolvido contra a raiz de
 * hoje, ou o absoluto como esta). Os seguintes sao as caudas, so quando o que
 * foi gravado era absoluto: da mais longa para a mais curta.
 *
 * @param {string} raiz
 * @param {string} gravado
 * @returns {string[]}
 */
export function candidatos(raiz: string, gravado: string): string[] {
    const c = normalizar(gravado);
    if (!c) return [];
    const lista = [paraAbsoluto(raiz, c)];
    if (!ehAbsoluto(c)) return lista;
    const r = normalizar(raiz);
    const partes = c.split(SEP).filter(Boolean);
    if (!r) return lista;
    for (let i = 1; i < partes.length; i++) {
        const tentativa = `${r}${SEP}${partes.slice(i).join(SEP)}`;
        if (!lista.includes(tentativa)) lista.push(tentativa);
    }
    return lista;
}

/**
 * O caminho de hoje para algo gravado antes: usa como esta se existir,
 * resolve relativo contra a raiz, e resgata pela cauda quando o absoluto
 * gravado aponta para uma maquina que nao e esta.
 *
 * @param {string} raiz
 * @param {string} gravado
 * @param {(p: string) => boolean} existe
 * @returns {{caminho: string, resgatado: boolean}|null}
 */
export function resolverGravado(raiz: string, gravado: string, existe: (p: string) => boolean): { caminho: string; resgatado: boolean } | null {
    const c = normalizar(gravado);
    if (!c) return null;
    const alvo = paraAbsoluto(raiz, c);
    if (existe(alvo)) return { caminho: alvo, resgatado: false };
    // Nao existe. Se era absoluto, pode ser de outra maquina: tenta a cauda.
    if (ehAbsoluto(c)) {
        const salvo = resgatarPelaCauda(raiz, c, existe);
        if (salvo) return { caminho: salvo, resgatado: true };
    }
    return { caminho: alvo, resgatado: false };
}
