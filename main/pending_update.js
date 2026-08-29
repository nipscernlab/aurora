// @ts-check
/**
 * A decisao de instalar no arranque, separada de tudo que precisa do Electron.
 *
 * O `autoInstallOnAppQuit` do electron-updater saiu de cena: instalar no
 * fechamento e instalar no pior momento possivel, porque no laboratorio
 * "fechar a AURORA" e "desligar o computador" acontecem com segundos de
 * diferenca, e um NSIS interrompido deixa a pasta pela metade. A instalacao
 * passou para a abertura seguinte, e quem decide se ela acontece e esta
 * funcao.
 *
 * Ela mora fora do `updater.js` por um motivo pratico: o updater arrasta o
 * `app`, o `autoUpdater` e a janela, e nada disso e necessario para responder
 * "existe atualizacao pendente e ela ainda faz sentido?". Aqui e uma funcao
 * pura, com teste, e la fica so o efeito.
 */

/**
 * @param {{versao?:string, em?:number}|null} pendente  o que ficou gravado no
 *   disco quando o download terminou
 * @param {string} versaoAtual  a versao que esta rodando agora
 * @param {number} [agora]  relogio injetavel, para o teste
 * @returns {'instalar'|'limpar'|'nada'}
 */
function decidirPendente(pendente, versaoAtual, agora = Date.now()) {
  if (!pendente || typeof pendente.versao !== 'string' || !pendente.versao) return 'nada';

  // Ja e esta versao: a instalacao aconteceu, e o registro sobreviveu a ela.
  // Sem este caso o arranque tentaria instalar a versao que ja esta rodando,
  // toda vez, para sempre.
  if (pendente.versao === versaoAtual) return 'limpar';

  // Registro velho demais. Trinta dias nao e prazo de validade da
  // atualizacao, e sim do CACHE: se o arquivo baixado sumiu do disco (limpeza
  // de temporarios, outro perfil, uma reinstalacao), insistir todo boot custa
  // uma verificacao de rede que nunca vai dar em nada. Quando o registro cai,
  // a verificacao silenciosa normal reencontra a atualizacao e baixa de novo.
  const TRINTA_DIAS = 30 * 24 * 60 * 60 * 1000;
  if (typeof pendente.em === 'number' && agora - pendente.em > TRINTA_DIAS) return 'limpar';

  return 'instalar';
}

module.exports = { decidirPendente };
