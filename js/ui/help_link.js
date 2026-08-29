/**
 * O botao de ajuda dos modais: um simbolo so, e o capitulo certo do manual.
 *
 * A ideia comecou em dois modais, o de ondas e o de criar processador, cada um
 * com a sua copia do mesmo par de linhas. Espalhar isso por mais oito seria
 * espalhar tambem a decisao de para onde cair quando a copia offline nao esta
 * instalada, e essa decisao tem que ser uma so.
 *
 * COMO FUNCIONA. `docsOpenHelp` abre a pagina na janela de documentacao da
 * propria AURORA, que le a copia offline em `resources/docs`. Quando ela nao
 * esta instalada (o pacote de documentacao e um componente baixavel), a mesma
 * pagina abre no navegador, no manual publicado. O usuario nao precisa saber
 * qual dos dois aconteceu, e e por isso que o botao e um so.
 *
 * O SIMBOLO E SEMPRE O MESMO, `ph-question`, no canto das acoes do modal, ao
 * lado do X. Isso e metade do valor da ideia: o que se aprende num modal vale
 * em todos, e um simbolo por tela seria a mesma coisa que nenhum.
 *
 * ONDE CADA UM CAI. A tabela abaixo e a lista inteira, e ela mora aqui e nao
 * espalhada nos paineis de proposito: assim da para conferir de uma olhada que
 * nenhum botao leva para uma pagina que nao existe, que e o unico jeito de
 * este recurso ficar pior do que nao ter recurso nenhum.
 */

const BASE_ONLINE = 'https://www.nipscern.com/library/sapho/';

/**
 * Abre um capitulo do manual: offline se houver, no navegador se nao.
 * @param {string} pagina caminho relativo dentro do manual, com .html
 */
export async function abrirAjuda(pagina) {
  const r = await window.electronAPI?.docsOpenHelp?.(pagina);
  if (!r?.ok) window.electronAPI?.openExternal?.(BASE_ONLINE + pagina);
}

/**
 * Liga um botao ja existente no HTML ao capitulo dele.
 * @param {string} id id do botao
 * @param {string} pagina caminho da pagina no manual
 */
export function ligarAjuda(id, pagina) {
  document.getElementById(id)?.addEventListener('click', () => abrirAjuda(pagina));
}

/**
 * Onde cada botao de ajuda cai.
 *
 * As paginas foram conferidas contra `resources/docs` em 29/08/2026: o
 * `diaadia/apoio.html` e literalmente "Controle de versao, Python, componentes
 * e configuracoes", e por isso ele atende os tres paineis que tratam disso.
 */
const AJUDAS = Object.freeze({
  waveConfigHelp:    'verilog/ondas.html',
  processorHubHelp:  'sapho/tutorial-filtro.html',
  newProjectHelp:    'diaadia/organizacao-projeto.html',
  gitHelp:           'diaadia/apoio.html',
  pylibsHelp:        'diaadia/apoio.html',
  settingsHelp:      'diaadia/apoio.html',
  searchHelp:        'diaadia/tour-interface.html',
});

/** Liga todos os botoes de ajuda estaticos da janela principal. */
export function ligarAjudasDaJanela() {
  for (const [id, pagina] of Object.entries(AJUDAS)) ligarAjuda(id, pagina);
}

export { AJUDAS };
