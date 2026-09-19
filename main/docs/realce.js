// @ts-check
/**
 * realce.js: achar a frase citada dentro da pagina do manual e levar o leitor
 * ate ela.
 *
 * POR QUE ISTO EXISTE. A citacao no chat traz a frase, e clicar nela abre o
 * manual. Abrir no TOPO da pagina joga fora metade do que a citacao serve para
 * fazer: numa pagina de 5.550 caracteres, o leitor ainda tem de cacar a frase
 * que ele acabou de ler. O gesto so fecha quando o clique cai no ponto.
 *
 * POR QUE POR TEXTO, E NAO PELO INDICE QUE A API DEU. A citacao volta com
 * `startCharIndex`, e ele parece o caminho obvio. Nao serve, por dois motivos
 * independentes, e os dois derrubam a ideia sozinhos.
 *
 * O primeiro e de formato: aquele indice conta caracteres do TEXTO QUE NOS
 * extraimos (main/docs/busca.js, `textoDe`), com as tags fora e os espacos
 * colapsados. A janela do manual renderiza o HTML. Os dois nao tem a mesma
 * contagem e nunca vao ter.
 *
 * O segundo e de tempo, e e o que mata de vez: O MANUAL MUDA SOZINHO. Ele vive
 * em repositorio proprio e se atualiza por manifesto, sem esperar release da
 * AURORA (main/ipc/docs.js). Um indice guardado hoje aponta para o meio de
 * outra frase depois da proxima correcao de texto. Indice serve DENTRO do
 * turno; guardado, e mentira com data para vencer.
 *
 * O texto nao tem esse problema. Se a frase continua na pagina, e achada
 * mesmo que tenha andado; se nao continua, nao e achada, e "nao achei" e uma
 * resposta honesta que da para dizer ao leitor. Sumir em silencio, nao.
 *
 * REALCE SEM MEXER NO DOM. Usa a API de realce do CSS (`CSS.highlights`), que
 * pinta um Range sem inserir elemento nenhum. Envolver a frase num `<span>`
 * funcionaria e sujaria a pagina: o manual e HTML nosso, e uma marcacao
 * injetada sobrevive na volta do historico e atrapalha o Ctrl+F de quem estiver
 * lendo. Sem a API, ainda rola ate o ponto, so nao pinta.
 *
 * Puro: monta o texto do script, nao executa nada. Quem executa e o
 * docs_window, que tem o webContents.
 */

'use strict';

/**
 * O texto como o comparador enxerga: espacos colapsados, pontas aparadas.
 *
 * O lado do manual vem do HTML, com quebra de linha e recuo entre as tags; o
 * lado da citacao vem do texto ja extraido. So se encontram depois desta
 * normalizacao, e ela tem de ser a MESMA nos dois lados, senao a busca falha
 * por causa de um espaco e o leitor conclui que a assistente inventou a frase.
 * @param {unknown} texto
 */
function normalizar(texto) {
  return String(texto || '').replace(/\s+/g, ' ').trim();
}

/**
 * Quanto do trecho e usado na busca.
 *
 * Uma citacao pode vir longa, e quanto mais longa mais chance de uma unica
 * palavra ter mudado na atualizacao do manual e derrubar o casamento inteiro.
 * Um prefixo generoso ancora no lugar certo e tolera edicao no fim da frase.
 */
const MAX_BUSCA = 300;

/** Abaixo disto o trecho nao identifica lugar nenhum: casaria em dez pontos. */
const MIN_BUSCA = 12;

/**
 * O script que roda DENTRO da pagina do manual.
 *
 * Anda pelos nos de texto montando uma string normalizada e, junto, o mapa de
 * volta (que no e que posicao cada caractere veio). Com o mapa da para montar
 * um Range que atravessa varios nos, que e o caso comum: uma frase do manual
 * passa por `<code>`, por `<em>` e por quebra de linha do fonte.
 *
 * Devolve `{achou, motivo}`, nunca lanca: quem chama precisa poder dizer ao
 * leitor o que houve.
 *
 * @param {string} trecho a frase citada
 */
function script(trecho) {
  const alvo = normalizar(trecho).slice(0, MAX_BUSCA);
  if (alvo.length < MIN_BUSCA) {
    return `(() => ({ achou: false, motivo: 'trecho-curto' }))()`;
  }
  return `(() => {
  try {
    const alvo = ${JSON.stringify(alvo)};
    const raiz = document.querySelector('#furo-main-content') || document.body;
    if (!raiz) return { achou: false, motivo: 'sem-conteudo' };

    // Um no de texto por vez, montando o texto normalizado e o mapa de volta.
    // O mapa guarda, para cada caractere do texto montado, de que no ele veio
    // e em que posicao DENTRO daquele no: e o que permite o Range atravessar
    // as tags que cortam a frase no meio.
    const nos = [];
    const mapa = [];
    let texto = '';
    let espacoPendente = false;
    const passeio = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const pai = n.parentElement;
        if (!pai) return NodeFilter.FILTER_REJECT;
        // Script, estilo e a barra lateral de navegacao nao sao o texto da
        // pagina: casar ali levaria o leitor para o indice, e nao para a frase.
        if (pai.closest('script, style, nav, .toc-drawer, .sidebar-drawer')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let no;
    while ((no = passeio.nextNode())) {
      nos.push(no);
      const bruto = no.nodeValue || '';
      for (let i = 0; i < bruto.length; i++) {
        const c = bruto[i];
        if (/\\s/.test(c)) { espacoPendente = texto.length > 0; continue; }
        if (espacoPendente) { texto += ' '; mapa.push({ no, pos: i }); espacoPendente = false; }
        texto += c;
        mapa.push({ no, pos: i });
      }
    }

    const em = texto.indexOf(alvo);
    if (em < 0) return { achou: false, motivo: 'trecho-ausente' };

    const inicio = mapa[em];
    const fim = mapa[Math.min(em + alvo.length - 1, mapa.length - 1)];
    if (!inicio || !fim) return { achou: false, motivo: 'trecho-ausente' };

    const faixa = document.createRange();
    faixa.setStart(inicio.no, inicio.pos);
    faixa.setEnd(fim.no, fim.pos + 1);

    // Realce sem inserir elemento: a pagina do manual continua como veio.
    if (window.CSS && CSS.highlights) {
      let estilo = document.getElementById('aurora-realce-estilo');
      if (!estilo) {
        estilo = document.createElement('style');
        estilo.id = 'aurora-realce-estilo';
        // Cor do acento da AURORA, com transparencia: precisa ler sobre o tema
        // claro e o escuro do Furo, que a pessoa pode ter trocado na barra.
        estilo.textContent = '::highlight(aurora-citacao){background:rgba(142,131,232,.32);}';
        document.head.appendChild(estilo);
      }
      CSS.highlights.set('aurora-citacao', new Highlight(faixa));
    }

    // Rola pelo elemento que CONTEM a frase: um Range nao tem scrollIntoView, e
    // o elemento pai posiciona com a margem do texto em volta, que e o que faz
    // a frase aparecer lida e nao colada no topo da janela.
    const alvoVisual = (inicio.no.parentElement || raiz);
    alvoVisual.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return { achou: true, motivo: '' };
  } catch (e) {
    return { achou: false, motivo: 'erro: ' + (e && e.message) };
  }
})()`;
}

/** O script que apaga o realce, para a proxima citacao nao somar a anterior. */
function scriptLimpar() {
  return `(() => {
  try { if (window.CSS && CSS.highlights) CSS.highlights.delete('aurora-citacao'); } catch (_) {}
})()`;
}

module.exports = { normalizar, script, scriptLimpar, MAX_BUSCA, MIN_BUSCA };
