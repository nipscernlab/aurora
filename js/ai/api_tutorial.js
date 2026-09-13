/**
 * api_tutorial.js: o tutorial guiado da API da AURORA, com o manual por tras.
 *
 * O QUE E. Uma conversa da Aurora Intelligence que comeca com a assistente no
 * papel de instrutora: ela apresenta a API da AURORA, que sao as ferramentas
 * que ela mesma usa para agir sobre a IDE, um passo por vez, e verifica com as
 * proprias ferramentas se o passo deu certo antes de seguir. A pessoa aprende
 * a API vendo a API acontecer.
 *
 * DE ONDE VEM O CONTEUDO. De dois lugares, e de nenhum outro. O manifesto das
 * ferramentas, gerado do proprio codigo (docs/aurora-intelligence-tools.md),
 * entra inteiro: e a lista do que existe, com a descricao que o modelo ja le.
 * O manual do SAPHO entra pelas paginas que a busca do manual instalado
 * devolve para alguns temas, lidas em tempo de execucao: o manual e mantido
 * num repositorio proprio e chega a AURORA pronto, entao nada dele e copiado
 * para ca. Sem manual instalado, o tutorial segue so com o manifesto e diz
 * isso a assistente.
 *
 * POR QUE INJETAR NO PROMPT, e nao so deixar as ferramentas de busca. A
 * assistente ja consegue procurar no manual quando quer. Num tutorial ela
 * precisa do chao inteiro ANTES de comecar, para desenhar a sequencia; sem
 * isso ela improvisa a ordem e descobre o conteudo aos poucos, que e o
 * contrario de ensinar. O bloco e limitado em tamanho por pagina e por total,
 * porque o manual inteiro tem 1,2 MB e nao cabe em janela nenhuma.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DE QUE LADO DO CACHE ESTE BLOCO CAI: DO VARIAVEL. E E CARO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Registrado em 13/09/2026, ao ligar as citacoes, como PROXIMA FRENTE e nao
 * como conserto desta. Quem mexer aqui precisa saber disto antes de mexer.
 *
 * O system prompt da AURORA vai em duas partes (main/ai/prompt_cache.js): a
 * ESTAVEL, com 37.378 caracteres, que leva marca de cache de uma hora, e a
 * VARIAVEL, que e relida a cada turno e nao leva marca nenhuma. O bloco
 * montado aqui e concatenado no `systemContext` pelo painel
 * (js/ui/ai_assistant_manager.js, `+ (this.tutorialBlock || '')`), e o
 * `systemContext` E a parte variavel.
 *
 * Quer dizer que este bloco, de ate 60.000 caracteres, uns 16 mil tokens, e
 * REESCRITO INTEIRO A CADA TURNO da conversa de tutorial, sem cache. Ele e
 * quatro vezes maior que o bloco fixo que a separacao do cache foi feita para
 * proteger. Numa conversa de tutorial de dez turnos isso e 160 mil tokens de
 * entrada paga, e quem paga e quem usa a AURORA, com a propria credencial.
 *
 * O lado bom da escolha errada: estando no variavel, ele ao menos nao INVALIDA
 * o prefixo estavel. Se estivesse do lado estavel seria pior, porque os cinco
 * temas buscados variam com o manual instalado e com o que a busca devolve,
 * entao cada mudanca de conteudo derrubaria os 10,4 mil tokens fixos junto.
 *
 * O CONSERTO, quando for a hora, nao e mudar de lado: e o bloco de tutorial
 * virar tambem documento com marca de cache propria, como as paginas citaveis
 * de main/ai/citacoes.js, mas essas cabem sem cache e esta nao cabe. Isso
 * esbarra na mesma questao de ordem descrita no fim de prompt_cache.js, e por
 * isso e frente propria e nao um remendo.
 */

import manifesto from '../../docs/aurora-intelligence-tools.md?raw';

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

/**
 * Le do manual instalado as paginas mais proximas de cada tema.
 * Nunca lanca: o tutorial tem que comecar mesmo sem manual.
 *
 * @param {object} api window.electronAPI (docsBuscar, docsLer)
 * @returns {Promise<{ paginas: Array<{titulo:string, caminho:string, texto:string}>, motivo: string }>}
 */
export async function lerPaginasDoManual(api) {
    const paginas = [];
    const vistos = new Set();
    let total = 0;
    if (!api?.docsBuscar || !api?.docsLer) return { paginas, motivo: 'a busca no manual nao esta disponivel nesta janela' };
    for (const tema of TEMAS) {
        let r;
        try { r = await api.docsBuscar(tema, { limite: 2 }); } catch (e) { return { paginas, motivo: `busca no manual falhou: ${e?.message || e}` }; }
        if (!r?.ok) return { paginas, motivo: r?.erro || r?.error || 'busca no manual respondeu sem dizer o erro' };
        const primeiro = (r.resultados || []).find((x) => x && x.caminho && !vistos.has(x.caminho));
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
 * @param {'pt'|'en'} locale
 * @param {{ paginas: Array<{titulo:string, caminho:string, texto:string}>, motivo: string }} manual
 */
export function montarBlocoTutorial(locale, manual) {
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
    partes.push('\n\n--- THE TOOL MANIFEST (generated from main/ai/tools.js) ---\n');
    partes.push(String(manifesto || ''));
    if (manual.paginas.length) {
        partes.push('\n\n--- PAGES FROM THE INSTALLED SAPHO MANUAL (read at tutorial start) ---\n');
        for (const p of manual.paginas) {
            partes.push(`\n### ${p.titulo} (${p.caminho})\n${p.texto}\n`);
        }
    } else {
        partes.push(pt
            ? `\n\n(O manual do SAPHO nao pode ser lido nesta maquina: ${manual.motivo || 'motivo desconhecido'}. Avise a pessoa no comeco e ensine so pelo manifesto.)`
            : `\n\n(The SAPHO manual could not be read on this machine: ${manual.motivo || 'unknown reason'}. Tell the person at the start and teach from the manifest only.)`);
    }
    partes.push('\n=== END OF TUTORIAL MODE ===\n');
    return partes.join('');
}

/** A primeira mensagem, que a pessoa nao precisa escrever. */
export function aberturaDoTutorial(locale) {
    return locale === 'pt'
        ? 'Quero um tutorial guiado da API da AURORA. Comece.'
        : 'I want a guided tutorial of the AURORA API. Begin.';
}
