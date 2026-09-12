/**
 * compilation_helpers.ts: funções PURAS de apoio à compilação, sem estado e
 * sem dependência de `this`/DOM/electronAPI. Vivem fora da god class
 * CompilationModule pra (a) encolher o arquivo principal e (b) poderem ser
 * testadas isoladamente. Compartilhadas pelo compilation_module.js e por
 * qualquer mixin de etapa que venha a ser extraído dele.
 *
 * Compilado por `tsc` (npm run build:ts) num compilation_helpers.js ao lado:
 * é esse .js que o runtime carrega; os imports usam a extensão `.js`.
 */

export function basenameOfPath(filePath: string): string {
    return String(filePath || '').split(/[\\/]/).pop() ?? '';
}

export function moduleStemFromPath(filePath: string): string {
    return basenameOfPath(filePath).replace(/\.[^.]+$/i, '');
}

export function isPythonFile(filePath: string): boolean {
    return /\.py$/i.test(String(filePath || ''));
}

// Reads an optional `# aurora-toplevel: <module>` directive from a cocotb .py.
// It tells Aurora which Verilog module is the DUT (cocotb's hdl_toplevel) so a
// test can target ANY module without re-marking the project top-level in the
// .spf. Crucially it's a plain COMMENT, pytest, a Makefile or bare cocotb
// running the same .py outside Aurora ignore it entirely. Accepts ':' or '='
// and is case-insensitive; the value must be a valid identifier. Returns the
// module name, or null when the directive is absent.
export function parseCocotbToplevelDirective(pySource: string): string | null {
    const m = /^[ \t]*#[ \t]*aurora-toplevel[ \t]*[:=][ \t]*([A-Za-z_]\w*)/im.exec(String(pySource || ''));
    return m ? m[1] : null;
}

// Insere a diretiva `#TOAQUI` logo antes do `}` que fecha a funcao main()
// de um fonte C±. O #TOAQUI faz o compilador pulsar o pino `cheguei` no fim
// do programa, usado pelo harness do botao Verilator pra encerrar a sim
// assim que o programa termina. Acha o `}` casando chaves a partir de
// `main(`, ignorando `//` e `/* */`. Retorna o texto original inalterado se
// nao achar o main ou se as chaves nao fecharem (nao instrumenta as cegas).
export function insertChegueiToaqui(src: string): string {
    const s = String(src || '');
    // Definicao de main (nao uma chamada num comentario): tipo de retorno
    // explicito antes de `main(`.
    const m = /\b(?:void|int)\s+main\s*\([^)]*\)\s*\{/.exec(s);
    if (!m) return s;
    let i = m.index + m[0].length; // logo apos o `{` de abertura
    let depth = 1;
    while (i < s.length && depth > 0) {
        const c = s[i];
        const n = s[i + 1];
        if (c === '/' && n === '/') {            // comentario de linha
            const nl = s.indexOf('\n', i);
            i = nl === -1 ? s.length : nl;
            continue;
        }
        if (c === '/' && n === '*') {            // comentario de bloco
            const end = s.indexOf('*/', i + 2);
            i = end === -1 ? s.length : end + 2;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    if (depth !== 0) return s;                   // chaves desbalanceadas — desiste
    return `${s.slice(0, i)}\n    #TOAQUI\n${s.slice(i)}`;
}

export function isVerilogLikeFile(filePath: string): boolean {
    return /\.(v|sv|vh)$/i.test(String(filePath || ''));
}

export function assertPythonModuleName(filePath: string): string {
    const stem = moduleStemFromPath(filePath);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stem)) {
        throw new Error(`cocotb testbench file name must be a valid Python module name: ${basenameOfPath(filePath)}`);
    }
    return stem;
}

/**
 * Quem e o DUT de uma corrida cocotb, e por que.
 *
 * O `dut` que o teste recebe NAO e necessariamente o topo do projeto: um
 * .py pode exercitar qualquer modulo. A ordem de resolucao e a diretiva
 * `# aurora-toplevel: <modulo>` dentro do proprio .py, que deixa o teste
 * escolher o alvo sem remarcar o topo no .spf e que e comentario inerte
 * fora da AURORA; sem ela, o topo do .spf, que precisa ser mesmo um fonte
 * Verilog.
 *
 * Decide e devolve o motivo em vez de lancar texto traduzido: a mensagem
 * na tela e do chamador, e assim a regra pode ser verificada sem i18n,
 * sem DOM e sem disco.
 *
 * @param config topo e testbench como o .spf os descreve
 * @param pySource fonte do testbench, ou vazio quando ilegivel
 */
export function decideCocotbDut(
    config: { topLevelFile?: string; testbenchFile?: string },
    pySource: string,
): { ok: true; hdlTopModule: string; hdlTopFile: string; toplevelSource: 'directive' | 'spf' }
 | { ok: false; motivo: 'cocotbRequiresPythonTb' | 'cocotbRequiresTop' } {
    const tb = config?.testbenchFile || '';
    if (!tb || !isPythonFile(tb)) return { ok: false, motivo: 'cocotbRequiresPythonTb' };

    const daDiretiva = parseCocotbToplevelDirective(pySource);
    if (daDiretiva) {
        return {
            ok: true,
            hdlTopModule: daDiretiva,
            // O arquivo do topo e opcional quando a diretiva manda: o modulo
            // dela ja vem entre as fontes compiladas.
            hdlTopFile: config.topLevelFile || '',
            toplevelSource: 'directive',
        };
    }

    const topo = config?.topLevelFile || '';
    if (!topo || !/\.(v|sv)$/i.test(topo)) return { ok: false, motivo: 'cocotbRequiresTop' };
    return {
        ok: true,
        hdlTopModule: moduleStemFromPath(topo),
        hdlTopFile: topo,
        toplevelSource: 'spf',
    };
}

export function safeNamePart(name: string): string {
    return String(name || 'cocotb')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'cocotb';
}

/** Uma entrada de arquivo do `.spf`. */
export interface EntradaDeArquivo {
  path?: string;
  name?: string;
  isTopLevel?: boolean;
}

/** A parte do `.spf` de onde sai o testbench. */
export interface FonteDeTestbench {
  testbenchFile?: string | null;
  testbenchFiles?: EntradaDeArquivo[] | null;
}

/**
 * Qual testbench a simulacao vai usar, ou null se nao ha nenhum.
 *
 * A regra: o campo escalar `testbenchFile` ganha; sem ele, vale a entrada
 * marcada como topo na lista `testbenchFiles`; sem marca, a primeira entrada
 * valida da lista.
 *
 * Esta funcao existe para que o BOTAO e o ALVO respondam a mesma pergunta. O
 * botao de onda olhava so o campo escalar, e o alvo ja aceitava a lista: um
 * projeto que guardasse o testbench apenas na forma de lista ficava com o
 * botao apagado para sempre, sem nada explicando por que, enquanto a
 * compilacao por outro caminho encontrava o arquivo sem dificuldade.
 *
 * `aoEmpatar` recebe as entradas marcadas quando ha mais de uma: quem esta
 * compilando avisa no terminal qual venceu, e quem so precisa habilitar um
 * botao nao avisa nada.
 */
export function escolherTestbench(
  fonte: FonteDeTestbench | null | undefined,
  aoEmpatar?: (marcadas: EntradaDeArquivo[]) => void,
): string | null {
  if (!fonte) return null;

  const escalar = typeof fonte.testbenchFile === 'string' ? fonte.testbenchFile.trim() : '';
  if (escalar) return fonte.testbenchFile as string;

  const lista = Array.isArray(fonte.testbenchFiles) ? fonte.testbenchFiles : [];
  const validas = lista.filter((f) => f && typeof f.path === 'string' && f.path.trim() !== '');
  if (validas.length === 0) return null;

  const marcadas = validas.filter((f) => f.isTopLevel === true);
  if (marcadas.length > 1 && aoEmpatar) aoEmpatar(marcadas);
  return (marcadas[0] || validas[0]).path as string;
}
