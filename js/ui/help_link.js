/**
 * O botao de ajuda dos modais: um simbolo so, e o capitulo certo do manual.
 *
 * A ideia comecou em dois modais, o de ondas e o de criar processador, cada um
 * com a sua copia do mesmo par de linhas. Espalhar isso por mais oito seria
 * espalhar tambem a decisao de para onde cair quando a copia offline nao esta
 * instalada, e essa decisao tem que ser uma so.
 *
 * COMO FUNCIONA. `docsOpenHelp` abre a pagina na janela de documentacao da
 * propria AURORA, que le a copia offline em `resources/docs`. Essa copia vem no
 * instalador e se atualiza sozinha pelo manifesto publicado em
 * nipscernlab.github.io/docs_aurora/docs-manifest.json; ela nao e um componente
 * baixavel e nao aparece em main/components/registry.js. Quando a pasta nao
 * esta la assim mesmo (instalacao mexida a mao, por exemplo), a mesma pagina
 * abre no navegador, no manual publicado. O usuario nao precisa saber qual dos
 * dois aconteceu, e e por isso que o botao e um so.
 *
 * O SIMBOLO E SEMPRE O MESMO, `ph-question`, no canto das acoes do modal, ao
 * lado do X. Isso e metade do valor da ideia: o que se aprende num modal vale
 * em todos, e um simbolo por tela seria a mesma coisa que nenhum.
 *
 * ONDE CADA UM CAI. A tabela abaixo e a lista inteira, e ela mora aqui e nao
 * espalhada nos paineis de proposito: assim da para conferir de uma olhada que
 * nenhum botao leva para uma pagina que nao existe, que e o unico jeito de
 * este recurso ficar pior do que nao ter recurso nenhum. O teste
 * tests/unit/help_link.test.js percorre a tabela inteira contra
 * `resources/docs`, pagina e ancora, para essa conferencia nao depender de
 * alguem lembrar de fazer.
 */

const BASE_ONLINE = 'https://www.nipscern.com/library/sapho/';

/**
 * Abre um capitulo do manual: offline se houver, no navegador se nao.
 * @param {string} pagina caminho relativo dentro do manual, com .html e, se for
 *   o caso, `#ancora` (o processo principal separa os dois em main/ipc/docs.js)
 */
export async function abrirAjuda(pagina) {
  const r = await window.electronAPI?.docsOpenHelp?.(pagina);
  if (!r?.ok) window.electronAPI?.openExternal?.(BASE_ONLINE + pagina);
}

/**
 * Abre o capitulo de uma entrada da tabela. E o que os lugares sem botao
 * estatico usam (a barra do PRISM, os avisos do terminal, os dialogos), para
 * que o destino continue vindo daqui e nao de uma segunda copia.
 * @param {string} chave chave em AJUDAS
 */
export function abrirAjudaDe(chave) {
  const pagina = AJUDAS[chave];
  if (pagina) return abrirAjuda(pagina);
  return Promise.resolve();
}

/**
 * Marca um erro com o capitulo que o explica.
 *
 * Quem mostra o erro (hoje o `logFatalError`, em
 * js/compilation/compilation_flow.js) le esta marca e oferece o manual junto
 * da mensagem. A marca viaja NO ERRO, e nao numa tabela que case a frase com o
 * capitulo: casar prosa traduzida quebra na primeira vez que alguem melhora um
 * texto, e quebra calado, que e o pior jeito.
 *
 * @param {Error} erro o erro, devolvido para dar `throw comAjuda(...)`
 * @param {string} chave chave em AJUDAS
 */
export function comAjuda(erro, chave) {
  if (erro && AJUDAS[chave]) erro.ajuda = chave;
  return erro;
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
 * As paginas E as ancoras foram conferidas contra `resources/docs` na versao
 * 6.11.0.3 do manual, que e a que vem no instalador. O `diaadia/apoio.html` e
 * literalmente "Controle de versao, Python, componentes e configuracoes": ele
 * atende quatro telas, e cada uma cai na SUA secao, porque abrir os quatro no
 * topo do mesmo capitulo obrigava a pessoa a procurar o assunto de novo (o pior
 * caso era o de PyLibs, que abria um capitulo comecando por git).
 *
 * A chave e o id do botao onde existe um botao estatico na janela principal, e
 * `ligarAjudasDaJanela` liga esses sozinho. As demais sao nomes: pertencem a
 * superficies que montam o proprio botao (a barra do PRISM, o cabecalho do
 * painel da Aurora Intelligence) ou que nao tem botao nenhum para pendurar (um
 * dialogo, uma linha de erro no terminal). Elas ficam aqui pelo mesmo motivo
 * que as outras: a lista de destinos e uma so.
 */
const AJUDAS = Object.freeze({
  /* --- botoes estaticos da janela principal (a chave e o id no index.html) --- */
  waveConfigHelp:         'verilog/ondas.html#escolher-o-que-gravar',
  processorHubHelp:       'sapho/tutorial-filtro.html#passo-2-criar-o-processador',
  newProjectHelp:         'diaadia/organizacao-projeto.html',
  gitHelp:                'diaadia/apoio.html#controle-de-versao-git-d',
  pylibsHelp:             'diaadia/apoio.html#bibliotecas-python-pylibs',
  settingsHelp:           'diaadia/apoio.html#configuracoes',
  searchHelp:             'diaadia/tour-interface.html#paleta-de-comandos-e-busca',
  // Estava ligado a parte, dentro de js/compilation/run_history.js: quem
  // auditava esta tabela contava sete botoes e nao via o oitavo.
  runHistoryHelp:         'sapho/compilacao.html#cada-clique-fica-registrado',
  // Secoes das Configuracoes. O botao do modal continua caindo em
  // #configuracoes; estes tres levam a secao do assunto de quem esta na aba.
  settingsComponentsHelp: 'diaadia/apoio.html#componentes',
  settingsShortcutsHelp:  'referencia/atalhos.html#personalizaveis',
  settingsAiHelp:         'diaadia/aurora-intelligence.html#configurar',
  // Popover da engrenagem do processador (relogio, numero de clocks).
  procConfigHelp:         'sapho/simulacao.html#os-tres-jeitos-de-rodar',

  /* --- superficies que montam o proprio botao --- */
  // Cabecalho do painel da Aurora Intelligence (js/ui/ai_assistant_manager.js).
  aiPanelHelp:            'diaadia/aurora-intelligence.html',
  // Barra do PRISM, ao lado de Recompilar. O PRISM roda em janela propria
  // (html/prism/prism.html), e e a tela onde mais gente se perde.
  prismHelp:              'sapho/prism.html',
  // Mesmo botao, com a simulacao ligada.
  prismSimHelp:           'sapho/prism.html#simular',

  /* --- avisos e erros, que nao tem chrome de modal --- */
  // Dialogo "Componente nao instalado" (js/ui/components_panel.js).
  componenteAusenteHelp:  'inicio/instalacao.html#a-cadeia-de-compilacao',
  // Dump preso por outro programa, ou onda de uma rodada anterior.
  dumpBloqueadoHelp:      'referencia/diagnostico.html#simulacao-e-ondas',
  // "Nenhum modulo top-level selecionado".
  semTopLevelHelp:        'diaadia/organizacao-projeto.html#sintetizavel-ou-testbench-quem-decide-e-o-conteudo',
});

/**
 * Os botoes que existem prontos no index.html. As outras chaves de AJUDAS sao
 * de superficies que se ligam sozinhas, e passar por elas aqui so procuraria
 * um id que esta janela nunca tem.
 */
const ESTATICOS = Object.freeze([
  'waveConfigHelp', 'processorHubHelp', 'newProjectHelp', 'gitHelp', 'pylibsHelp',
  'settingsHelp', 'searchHelp', 'runHistoryHelp', 'settingsComponentsHelp',
  'settingsShortcutsHelp', 'settingsAiHelp', 'procConfigHelp',
]);

/** Liga todos os botoes de ajuda estaticos da janela principal. */
export function ligarAjudasDaJanela() {
  for (const id of ESTATICOS) ligarAjuda(id, AJUDAS[id]);
}

export { AJUDAS, ESTATICOS };
