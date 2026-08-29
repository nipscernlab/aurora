/**
 * A tabela de atalhos de teclado: uma so, para os dois lados.
 *
 * O PROBLEMA que isto resolve. Havia DUAS listas de atalhos, cada uma com o seu
 * proprio conjunto de padroes, e as duas gravavam na MESMA chave do
 * localStorage. Uma era do gestor, que ouve o teclado; a outra era da tela de
 * configuracoes, que mostra e deixa regravar. Elas discordavam: a tela oferecia
 * `compileAll` e `openSettings`, que nao existiam no gestor e portanto nao
 * faziam nada, e escondia o `toggleSlang`, que existia e funcionava. Quem
 * regravasse um dos dois primeiros gravava um atalho morto e nao tinha como
 * descobrir por que nao acontecia nada.
 *
 * A saida nao e sincronizar as duas listas, que e o mesmo defeito adiado, e sim
 * ter uma so. Aqui estao a acao, o padrao de tecla, o rotulo e o que a acao
 * faz; o gestor le para ouvir, a tela le para mostrar, e um teste garante que
 * toda acao tem rotulo nos dois idiomas e que nenhum padrao colide com outro.
 *
 * COMO A ACAO E EXECUTADA. Sempre pela API publica ou por um clique no botao
 * que ja existe, nunca por logica duplicada: assim o atalho faz exatamente o
 * que o botao faz, incluindo nao fazer nada quando o botao esta desabilitado.
 * E a mesma disciplina da paleta de comandos.
 *
 * TECLAS QUE NAO SE PODE USAR. Ctrl+Shift+I e Ctrl+Shift+J abrem o DevTools no
 * Chromium e o Electron herda isso; Ctrl+Shift+K e Ctrl+Shift+P sao da paleta
 * de comandos, e Ctrl+K sozinho e do painel de IA. O Hub de processadores
 * nasceu em Ctrl+Shift+J e mudou para Ctrl+Alt+P por causa disso.
 *
 * POR QUE TECLAS DE FUNCAO PARA COMPILAR. As acoes de compilacao precisam
 * disparar com o cursor DENTRO do editor, que e onde a pessoa esta quando quer
 * compilar. Um atalho sem Ctrl e engolido em campo de texto, e o Monaco e um
 * campo de texto; F5..F10 nunca sao texto digitado, entao passam. Shift+F5
 * cancela, que e o par consagrado de F5.
 */

/** Clica um botao da barra, se existir e nao estiver desabilitado. */
function clicar(id) {
  const el = document.getElementById(id);
  if (el && !el.disabled && !el.classList.contains('disabled')) el.click();
}

/** Clica o primeiro que existir: a mesma acao tem botao diferente na Welcome. */
function clicarPrimeiro(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && !el.disabled && !el.classList.contains('disabled')) { el.click(); return; }
  }
}

const c = (key, { shift = false, alt = false } = {}) =>
  ({ ctrlKey: true, shiftKey: shift, altKey: alt, key });
const f = (key, { shift = false } = {}) =>
  ({ ctrlKey: false, shiftKey: shift, altKey: false, key });

/**
 * A tabela. A ordem e a que a tela de configuracoes mostra, agrupada por
 * assunto: arquivo, projeto, compilacao, ferramentas.
 *
 * `acao` e a chave gravada no localStorage, entao renomear uma quebra o atalho
 * que a pessoa regravou. `rotulo` e chave de i18n. `padrao` e o que vale ate
 * alguem regravar.
 */
export const ATALHOS = Object.freeze([
  // Arquivo
  { acao: 'newFile', rotulo: 'shortcuts.newFile', padrao: c('N'), executar: () => window.AuroraAPI?.editor.newFile() },
  { acao: 'saveFile', rotulo: 'shortcuts.saveFile', padrao: c('S'), executar: () => window.AuroraAPI?.editor.save() },
  { acao: 'saveAllFiles', rotulo: 'shortcuts.saveAllFiles', padrao: c('S', { shift: true }), executar: () => window.AuroraAPI?.editor.saveAll() },
  { acao: 'closeTab', rotulo: 'shortcuts.closeTab', padrao: c('W'), executar: () => window.AuroraAPI?.editor.closeTab() },
  { acao: 'reopenTab', rotulo: 'shortcuts.reopenTab', padrao: c('T', { shift: true }), executar: () => window.AuroraAPI?.editor.reopenLastTab() },

  // Projeto
  { acao: 'newProject', rotulo: 'shortcuts.newProject', padrao: c('N', { alt: true }), executar: () => clicarPrimeiro(['newProjectBtn', 'newProjectBtnWelcome']) },
  { acao: 'openProject', rotulo: 'shortcuts.openProject', padrao: c('O', { shift: true }), executar: () => clicarPrimeiro(['openProjectBtn', 'openProjectBtnWelcome']) },
  { acao: 'backupProject', rotulo: 'shortcuts.backupProject', padrao: c('B', { alt: true }), executar: () => clicar('backup-project') },

  // Compilacao
  { acao: 'compileAll', rotulo: 'shortcuts.compileAll', padrao: f('F5'), executar: () => clicar('allcomp') },
  { acao: 'compileCmm', rotulo: 'shortcuts.compileCmm', padrao: f('F6'), executar: () => clicar('cmmcomp') },
  { acao: 'compileVerilog', rotulo: 'shortcuts.compileVerilog', padrao: f('F7'), executar: () => clicar('vericomp') },
  { acao: 'compileWave', rotulo: 'shortcuts.compileWave', padrao: f('F8'), executar: () => clicar('wavecomp') },
  { acao: 'compileFast', rotulo: 'shortcuts.compileFast', padrao: f('F9'), executar: () => clicar('fastsim') },
  { acao: 'openPrism', rotulo: 'shortcuts.openPrism', padrao: f('F10'), executar: () => clicar('prismcomp') },
  { acao: 'cancelCompilation', rotulo: 'shortcuts.cancelCompilation', padrao: f('F5', { shift: true }), executar: () => clicar('cancel-everything') },
  { acao: 'runHistory', rotulo: 'shortcuts.runHistory', padrao: c('H', { shift: true }), executar: () => clicar('run-history') },
  { acao: 'clearTerminal', rotulo: 'shortcuts.clearTerminal', padrao: c('L', { shift: true }), executar: () => clicar('clear-terminal') },

  // Ferramentas
  { acao: 'processorHub', rotulo: 'shortcuts.processorHub', padrao: c('P', { alt: true }), executar: () => clicar('processorHub') },
  { acao: 'openSettings', rotulo: 'shortcuts.openSettings', padrao: c('C', { shift: true }), executar: () => clicar('aurora-settings') },
  { acao: 'toggleSlang', rotulo: 'shortcuts.toggleSlang', padrao: c('S', { alt: true }), executar: () => window.AuroraSlang?.toggle?.() },
]);

/** Os padroes no formato que o localStorage guarda: { acao: {ctrlKey, ...} }. */
export const PADROES = Object.freeze(
  Object.fromEntries(ATALHOS.map((a) => [a.acao, a.padrao])),
);

/** As chaves de i18n por acao, para a tela de configuracoes. */
export const ROTULOS = Object.freeze(
  Object.fromEntries(ATALHOS.map((a) => [a.acao, a.rotulo])),
);

/** Roda a acao, se ela existir. Devolve se rodou. */
export function executarAcao(acao) {
  const alvo = ATALHOS.find((a) => a.acao === acao);
  if (!alvo) return false;
  alvo.executar();
  return true;
}

/** `Ctrl + Shift + S`, `F5`, `Shift + F5`. Vazio quando nao ha tecla. */
export function textoDoAtalho({ ctrlKey, shiftKey, altKey, key } = {}) {
  if (!key) return '';
  const partes = [];
  if (ctrlKey) partes.push('Ctrl');
  if (shiftKey) partes.push('Shift');
  if (altKey) partes.push('Alt');
  partes.push(key.length === 1 ? key.toUpperCase() : key);
  return partes.join(' + ');
}
