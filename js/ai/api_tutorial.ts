/**
 * api_tutorial.ts: o tutorial guiado da API da AURORA, com o manual por tras.
 *
 * O QUE E. Uma conversa da Aurora Intelligence que comeca com a assistente no
 * papel de instrutora: ela apresenta a API da AURORA, que sao as ferramentas
 * que ela mesma usa para agir sobre a IDE, um passo por vez, e verifica com as
 * proprias ferramentas se o passo deu certo antes de seguir. A pessoa aprende
 * a API vendo a API acontecer.
 *
 * DE ONDE VEM O CONTEUDO. Do manual do SAPHO, pelas paginas que a busca do
 * manual instalado devolve para alguns temas, lidas em tempo de execucao: o
 * manual e mantido num repositorio proprio e chega a AURORA pronto, entao nada
 * dele e copiado para ca. Sem manual instalado, o tutorial segue assim mesmo e
 * diz isso a assistente.
 *
 * O MANIFESTO DE FERRAMENTAS SAIU DAQUI, e ele era METADE do bloco. O arquivo
 * docs/aurora-intelligence-tools.md era colado inteiro, 37.424 caracteres, e
 * ele e uma TABELA das mesmas 124 ferramentas que o modelo ja recebe no campo
 * `tools` do pedido, com a mesma `description`, palavra por palavra: conferido
 * em 13/09/2026, 124 de 124 descricoes aparecem verbatim no md. O proprio
 * cabecalho do arquivo gerado diz isso ("e o mesmo texto que o modelo le ao
 * decidir se a chama").
 *
 * Era a lista inteira de ferramentas mandada DUAS VEZES no mesmo pedido, e a
 * segunda em prosa, que e a forma mais cara de dizer o que o campo proprio ja
 * diz. Sair nao tira informacao nenhuma do modelo: ele continua com as 124
 * ferramentas e com a descricao de cada uma, pelo caminho que a API tem para
 * isso.
 *
 * POR QUE INJETAR NO PROMPT, e nao so deixar as ferramentas de busca. A
 * assistente ja consegue procurar no manual quando quer. Num tutorial ela
 * precisa do chao inteiro ANTES de comecar, para desenhar a sequencia; sem
 * isso ela improvisa a ordem e descobre o conteudo aos poucos, que e o
 * contrario de ensinar. O bloco e limitado em tamanho por pagina e por total,
 * porque o manual inteiro tem 1,2 MB e nao cabe em janela nenhuma.
 *
 * DE QUE LADO DO CACHE ESTE BLOCO CAI. O painel o manda no `systemFixo` do
 * `startChat`, separado do `system` estavel e do `systemContext` que muda a
 * cada turno, e o main (main/ai/prompt_cache.js, `systemFixoDaConversa`) o poe
 * entre os dois com marca de cache propria de uma hora. Assim ele e pago uma
 * vez por conversa e lido do cache nos turnos seguintes, sem invalidar o
 * prefixo estavel quando o manual instalado muda. Ate o 568cbd74 (13/09/2026)
 * ele ia colado no `systemContext` e era reescrito inteiro a cada turno.
 */

/** O que se busca no manual, na ordem em que o tutorial vai usar. */
const TEMAS = [
    'Aurora Intelligence ferramentas permissoes',
    'projeto criar abrir',
    'compilacao C± Verilog',
    'simulacao formas de onda',
    'PRISM',
];
const MAX_POR_PAGINA = 12000;
const MAX_TOTAL = 60000;

/** Uma pagina do manual, como vai para o bloco. */
export interface PaginaDoManual { titulo: string; caminho: string; texto: string }

/** O que a leitura devolve: as paginas lidas e, quando parou, por que. */
export interface ManualDoTutorial { paginas: PaginaDoManual[]; motivo: string }

/** Os dois canais do manual (main/ipc/docs), na forma que chegam. */
export interface CanaisDoManual {
    docsBuscar?(tema: string, opts: { limite: number }): Promise<{
        ok?: boolean; erro?: string; error?: string;
        resultados?: Array<{ caminho?: string; titulo?: string } | null>;
    } | null | undefined>;
    docsLer?(caminho: string, opts: { limite: number }): Promise<{
        ok?: boolean; texto?: string; titulo?: string; caminho?: string;
    } | null | undefined>;
}

/**
 * Le do manual instalado as paginas mais proximas de cada tema.
 * Nunca lanca: o tutorial tem que comecar mesmo sem manual.
 *
 * @param api window.electronAPI (docsBuscar, docsLer)
 */
export async function lerPaginasDoManual(api: CanaisDoManual | null | undefined): Promise<ManualDoTutorial> {
    const paginas: PaginaDoManual[] = [];
    const vistos = new Set<string>();
    let total = 0;
    if (!api?.docsBuscar || !api?.docsLer) return { paginas, motivo: 'a busca no manual nao esta disponivel nesta janela' };
    for (const tema of TEMAS) {
        let r;
        try { r = await api.docsBuscar(tema, { limite: 2 }); } catch (e) { return { paginas, motivo: `busca no manual falhou: ${(e as { message?: string } | null)?.message || e}` }; }
        if (!r?.ok) return { paginas, motivo: r?.erro || r?.error || 'busca no manual respondeu sem dizer o erro' };
        const primeiro = (r.resultados || []).find((x): x is { caminho: string; titulo?: string } => !!(x && x.caminho && !vistos.has(x.caminho)));
        if (!primeiro) continue;
        vistos.add(primeiro.caminho);
        let pag;
        try { pag = await api.docsLer(primeiro.caminho, { limite: MAX_POR_PAGINA }); } catch (_) { continue; }
        if (!pag?.ok || !pag.texto) continue;
        const texto = String(pag.texto).slice(0, MAX_POR_PAGINA);
        if (total + texto.length > MAX_TOTAL) break;
        total += texto.length;
        paginas.push({ titulo: pag.titulo || primeiro.titulo || primeiro.caminho, caminho: pag.caminho || primeiro.caminho, texto });
    }
    return { paginas, motivo: '' };
}

/**
 * O bloco que vai para o system prompt da conversa de tutorial.
 */
export function montarBlocoTutorial(locale: 'pt' | 'en', manual: ManualDoTutorial): string {
    const pt = locale === 'pt';
    const partes = [];
    partes.push('\n\n=== TUTORIAL MODE: THE AURORA API ===\n');
    partes.push(pt
        ? 'Nesta conversa voce e a instrutora de um tutorial guiado da API da AURORA: as ferramentas '
          + 'listadas abaixo, que sao exatamente as que voce usa para agir sobre a IDE. Ensine um passo por '
          + 'vez. Em cada passo: diga o que a ferramenta faz e para que serve no fluxo SAPHO, mostre a '
          + 'chamada, execute-a de verdade quando fizer sentido (pedindo permissao como sempre) e mostre o '
          + 'resultado. So avance quando a pessoa disser que entendeu ou pedir o proximo. Comece pelo que '
          + 'ela ja tem aberto (leia o estado do projeto antes de propor a sequencia). Cite o capitulo do '
          + 'manual de onde cada assunto vem, pelo titulo. Nao invente ferramentas: se algo nao esta na '
          + 'lista, diga que nao existe. Sem emojis, sem travessao, prosa em vez de listas decorativas.'
        : 'In this conversation you are the instructor of a guided tutorial of the AURORA API: the tools '
          + 'listed below, which are exactly the ones you use to act on the IDE. Teach one step at a time. '
          + 'In each step: say what the tool does and what it is for in the SAPHO flow, show the call, '
          + 'actually run it when it makes sense (asking permission as always) and show the result. Only '
          + 'move on when the person says they got it or asks for the next one. Start from what they '
          + 'already have open (read the project state before proposing the sequence). Cite the manual '
          + 'chapter each topic comes from, by title. Never invent tools: if something is not in the list, '
          + 'say it does not exist. No emoji, no em dash, prose instead of decorative lists.');
    // Nao vai lista de ferramenta aqui: o modelo ja recebeu as 124 no campo
    // `tools`, com a mesma descricao. O que ele precisa e saber que SAO ELAS o
    // assunto da aula, e isso cabe numa frase.
    partes.push(pt
        ? '\n\nAS FERRAMENTAS DA AULA sao exatamente as que voce recebeu neste pedido, '
          + 'com a descricao de cada uma. Nao ha lista separada, e nao precisa haver: '
          + 'consulte as suas proprias ferramentas para montar a sequencia, e ensine '
          + 'pelas que existem de verdade.\n'
        : '\n\nTHE TOOLS OF THIS LESSON are exactly the ones you were given in this '
          + 'request, each with its description. There is no separate list, and there '
          + 'need not be: look at your own tools to plan the sequence, and teach the '
          + 'ones that actually exist.\n');
    if (manual.paginas.length) {
        partes.push('\n\n--- PAGES FROM THE INSTALLED SAPHO MANUAL (read at tutorial start) ---\n');
        for (const p of manual.paginas) {
            partes.push(`\n### ${p.titulo} (${p.caminho})\n${p.texto}\n`);
        }
    } else {
        partes.push(pt
            ? `\n\n(O manual do SAPHO nao pode ser lido nesta maquina: ${manual.motivo || 'motivo desconhecido'}. Avise a pessoa no comeco e ensine so pelas ferramentas que voce tem.)`
            : `\n\n(The SAPHO manual could not be read on this machine: ${manual.motivo || 'unknown reason'}. Tell the person at the start and teach from your own tools only.)`);
    }
    partes.push('\n=== END OF TUTORIAL MODE ===\n');
    return partes.join('');
}

/** A primeira mensagem, que a pessoa nao precisa escrever. */
export function aberturaDoTutorial(locale: 'pt' | 'en'): string {
    return locale === 'pt'
        ? 'Quero um tutorial guiado da API da AURORA. Comece.'
        : 'I want a guided tutorial of the AURORA API. Begin.';
}
