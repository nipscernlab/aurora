/**
 * fopen_paths.ts: os arquivos que um testbench abre com `$fopen`, quando dá
 * para saber antes de simular.
 *
 * O caso que motivou isto: um testbench com
 *
 *     `define PROJ "C:/Users/.../pasta_antiga"
 *     fin = $fopen({`PROJ, "/test_input.txt"}, "r");
 *
 * depois de o projeto mudar de pasta. O `$fopen` devolve 0, o `$fscanf` passa
 * a reclamar A CADA CICLO DE CLOCK, e a simulação inteira roda lendo entrada
 * vazia: noventa segundos de erro repetido no terminal e um resultado com cara
 * de certo, constante, no fim. O usuário achou que a compilação tinha entrado
 * em loop.
 *
 * O simulador não tem como avisar antes, mas a AURORA tem: os caminhos desse
 * tipo de `$fopen` são literais (direto ou via `define), então dá para
 * resolvê-los lendo o fonte e conferir se o arquivo existe ANTES de rodar.
 *
 * Só entra o que resolve por completo para texto literal. Caminho montado com
 * variável de runtime fica de fora, porque um aviso errado ensinaria o usuário
 * a ignorar o aviso certo. E só interessa modo de LEITURA: abrir para escrita
 * cria o arquivo, não há o que conferir.
 *
 * Puro: entra o fonte, sai a lista. Sem disco; quem confere existência é o
 * chamador, que tem o IPC.
 */

/** Um `$fopen` de leitura cujo caminho resolvemos. */
export interface FopenDeLeitura { path: string; mode: string }

/** As `define de texto do fonte: NOME -> literal, sem as aspas. */
function definesDeTexto(src: string): Map<string, string> {
    const out = new Map<string, string>();
    const re = /`define\s+([A-Za-z_][\w$]*)\s+"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (!out.has(m[1])) out.set(m[1], m[2]);
    }
    return out;
}

/**
 * Resolve um argumento de `$fopen` para texto literal, ou null.
 *
 * Formas aceitas, que são as que aparecem em testbench de aluno:
 *   "texto"                     literal direto
 *   `NOME                       define de texto
 *   {`NOME, "/x", "y"}          concatenação de literais e defines
 */
function resolverArgumento(arg: string, defines: Map<string, string>): string | null {
    const s = String(arg || '').trim();
    if (!s) return null;

    const umTermo = (termo: string): string | null => {
        const t = termo.trim();
        const lit = /^"((?:[^"\\]|\\.)*)"$/.exec(t);
        if (lit) return lit[1];
        const def = /^`([A-Za-z_][\w$]*)$/.exec(t);
        if (def) return defines.has(def[1]) ? defines.get(def[1]) as string : null;
        return null;
    };

    const concat = /^\{([\s\S]*)\}$/.exec(s);
    if (!concat) return umTermo(s);

    let junto = '';
    for (const termo of concat[1].split(',')) {
        const parte = umTermo(termo);
        if (parte === null) return null;   // um pedaço de runtime invalida o todo
        junto += parte;
    }
    return junto;
}

/**
 * Os `$fopen` de LEITURA do fonte cujo caminho dá para resolver.
 *
 * `$fopen` com um argumento só fica de fora: naquela forma o Verilog abre
 * para escrita (canal MCD), e escrita cria o arquivo.
 *
 * @param source fonte Verilog do testbench (com comentários ou sem)
 */
export function extractFopenReads(source: string): FopenDeLeitura[] {
    const src = String(source || '')
        // Comentários fora, senão um $fopen comentado gera aviso fantasma.
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n]*/g, ' ');
    const defines = definesDeTexto(src);
    const out: FopenDeLeitura[] = [];

    const re = /\$fopen\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        // Anda até o parêntese que fecha, contando aninhamento, porque o
        // primeiro argumento pode ser uma concatenação com vírgulas dentro.
        let nivel = 0;
        let fim = -1;
        for (let i = m.index + m[0].length - 1; i < src.length; i++) {
            if (src[i] === '(') nivel++;
            else if (src[i] === ')') { nivel--; if (nivel === 0) { fim = i; break; } }
        }
        if (fim < 0) continue;
        const dentro = src.slice(m.index + m[0].length, fim);

        // Divide no primeiro nível: {a,b} conta como um argumento só.
        const args: string[] = [];
        let atual = '';
        let chaves = 0;
        for (const c of dentro) {
            if (c === '{') chaves++;
            else if (c === '}') chaves--;
            if (c === ',' && chaves === 0) { args.push(atual); atual = ''; continue; }
            atual += c;
        }
        if (atual.trim()) args.push(atual);
        if (args.length < 2) continue;                 // um argumento: escrita

        const modo = /^"([^"]*)"$/.exec(args[1].trim());
        if (!modo || !modo[1].startsWith('r')) continue; // só leitura interessa

        const caminho = resolverArgumento(args[0], defines);
        if (caminho) out.push({ path: caminho, mode: modo[1] });
    }
    return out;
}
