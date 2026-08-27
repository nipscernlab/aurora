/**
 * terminal_excerpt.js: o recorte do terminal que acompanha um relato.
 *
 * POR QUE UM RECORTE, E NAO O LOG INTEIRO
 * --------------------------------------
 * Quase todo relato vai ser sobre uma compilacao que falhou, e o que explica
 * uma compilacao que falhou esta no terminal, nao no `main.log`, que fala do
 * aplicativo. So que o terminal de uma sessao longa passa de centenas de
 * kilobytes, e mandar tudo estoura o limite do envio e some com o que
 * interessa no meio do que nao interessa.
 *
 * O QUE O RECORTE GUARDA
 * ----------------------
 * As linhas de erro e aviso, e a vizinhanca delas. A vizinhanca importa tanto
 * quanto a linha do erro: `iverilog` diz em que arquivo falhou uma linha antes
 * de dizer o que falhou, e um erro sem contexto vira adivinhacao para quem
 * recebe. Quando nao ha erro nenhum, vale o fim do terminal, que e onde a
 * sessao parou.
 *
 * NADA DAQUI VAI SEM O USUARIO VER
 * --------------------------------
 * O painel de relato mostra este mesmo texto, vindo desta mesma funcao, antes
 * de enviar. Coletar e exibir pelo mesmo caminho e o que impede a tela de
 * mentir sobre o envio.
 */

/** Quantas linhas antes e depois de cada erro entram junto. */
const VIZINHANCA = 3;

/** Teto do recorte, para o envio caber e o essencial nao se perder. */
const LIMITE_LINHAS = 120;

/** Sem erro nenhum, vale este tanto do fim. */
const CAUDA_SEM_ERRO = 25;

const TIPOS = [
  ['error', 'ERRO'],
  ['warning', 'AVISO'],
  ['success', 'OK'],
  ['info', 'INFO'],
  ['tips', 'DICA'],
];

/** O tipo de uma entrada de log, pela classe que o terminal aplicou. */
function tipoDa(entrada) {
  const achado = TIPOS.find(([classe]) => entrada.classList.contains(classe));
  return achado ? achado[1] : '';
}

/**
 * As linhas de um terminal, ja normalizadas.
 *
 * Uma entrada pode conter varias mensagens agrupadas (o terminal junta
 * repeticoes num cartao so), e cada uma vira uma linha.
 *
 * @param {Element} terminal
 * @returns {Array<{tipo: string, texto: string}>}
 */
function linhasDoTerminal(terminal) {
  if (!terminal) return [];
  const linhas = [];
  terminal.querySelectorAll('.log-entry').forEach((entrada) => {
    const tipo = tipoDa(entrada);
    const marcaDeHora = entrada.querySelector(':scope > .timestamp');
    const agrupadas = entrada.querySelectorAll('.grouped-message');

    const empurrar = (texto) => {
      const limpo = String(texto || '').replace(/\s+/g, ' ').trim();
      if (limpo) linhas.push({ tipo, texto: limpo });
    };

    if (agrupadas.length > 0) {
      agrupadas.forEach((g) => empurrar(g.textContent));
      return;
    }
    const corpo = entrada.querySelector('.message-content');
    if (corpo) { empurrar(corpo.textContent); return; }
    // Sem corpo proprio, o texto da entrada carrega a marca de hora junto.
    const cru = marcaDeHora
      ? entrada.textContent.replace(marcaDeHora.textContent, '')
      : entrada.textContent;
    empurrar(cru);
  });
  return linhas;
}

/**
 * Escolhe quais linhas ficam.
 *
 * Erros e avisos puxam a vizinhanca junto. As faixas que se encostam viram uma
 * so, para o resultado nao ficar picotado com marcas de corte entre linhas
 * consecutivas.
 *
 * Exportada para poder ser testada sem DOM: e aqui que mora a decisao, e uma
 * regra que descarte o erro em vez de guarda-lo torna o relato inutil.
 *
 * @param {Array<{tipo: string, texto: string}>} linhas
 * @returns {{linhas: Array<{tipo: string, texto: string}>, cortadas: number}}
 */
export function recortar(linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0) return { linhas: [], cortadas: 0 };

  const interessa = (l) => l.tipo === 'ERRO' || l.tipo === 'AVISO';
  const temErro = linhas.some(interessa);

  // Sem erro, o que vale e onde a sessao parou.
  if (!temErro) {
    const cauda = linhas.slice(-CAUDA_SEM_ERRO);
    return { linhas: cauda, cortadas: linhas.length - cauda.length };
  }

  const manter = new Set();
  linhas.forEach((l, i) => {
    if (!interessa(l)) return;
    for (let k = Math.max(0, i - VIZINHANCA); k <= Math.min(linhas.length - 1, i + VIZINHANCA); k++) {
      manter.add(k);
    }
  });

  // Do fim para o comeco: com muitos erros, o teto tem que preservar os
  // ULTIMOS, que sao os que descrevem a falha que derrubou a compilacao.
  const indices = [...manter].sort((a, b) => a - b);
  const escolhidos = indices.slice(-LIMITE_LINHAS);

  const saida = [];
  let anterior = -1;
  for (const i of escolhidos) {
    if (anterior >= 0 && i > anterior + 1) {
      saida.push({ tipo: '', texto: `... ${i - anterior - 1} linhas omitidas ...` });
    }
    saida.push(linhas[i]);
    anterior = i;
  }
  return { linhas: saida, cortadas: linhas.length - escolhidos.length };
}

/**
 * Os terminais da AURORA, na ordem em que aparecem.
 *
 * O id fica no contêiner (`#terminal-tveri`) e o conteúdo no `.terminal-body`
 * de dentro, então o nome vem de um e as linhas do outro.
 */
const TERMINAIS = ['tcmm', 'tasm', 'tveri', 'twave', 'thtest', 'tcmd'];

/** O recorte como texto, pronto para o relato. */
export function recorteEmTexto() {
  if (typeof document === 'undefined') return '';
  const partes = [];

  TERMINAIS.forEach((id) => {
    const terminal = document.querySelector(`#terminal-${id} .terminal-body`);
    if (!terminal) return;
    const linhas = linhasDoTerminal(terminal);
    if (linhas.length === 0) return;
    const { linhas: recorte, cortadas } = recortar(linhas);
    if (recorte.length === 0) return;

    const nome = id.toUpperCase();
    const cabecalho = cortadas > 0
      ? `===== ${nome} (${recorte.length} de ${linhas.length} linhas) =====`
      : `===== ${nome} =====`;
    partes.push([
      cabecalho,
      ...recorte.map((l) => (l.tipo ? `[${l.tipo}] ${l.texto}` : l.texto)),
    ].join('\n'));
  });

  return partes.join('\n\n');
}

export { VIZINHANCA, LIMITE_LINHAS, CAUDA_SEM_ERRO };
