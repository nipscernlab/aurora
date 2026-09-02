// @ts-check
/**
 * spawn_hint.js: a frase que faltava quando o Windows barra um executavel.
 *
 * Relato #6 (sapho-relatos): o aluno via "spawn UNKNOWN" no terminal e, no
 * canto da tela, o aviso do Windows de que nao e possivel confirmar quem
 * publicou vvp.exe. As duas coisas sao o MESMO evento: o Smart App Control
 * (ou o SmartScreen) barra binarios sem assinatura, e o Electron so enxerga
 * um spawn que falhou com um codigo opaco. Quem le o terminal nao tem como
 * ligar uma coisa a outra, e a "solucao" que sobra e reinstalar componentes,
 * que foi exatamente o que o log daquele relato mostra o aluno tentando.
 *
 * Este helper poe a ligacao em palavras, uma vez, para todos os pontos que
 * spawnam a toolchain. Ele so opina no Windows e so nos codigos que um
 * bloqueio de fato produz; ENOENT e os demais seguem com a mensagem crua.
 */
'use strict';

const path = require('path');

/** Codigos que um executavel barrado pelo Windows produz num spawn. */
const CODIGOS_DE_BLOQUEIO = new Set(['UNKNOWN', 'EACCES', 'EPERM']);

/**
 * A mensagem do erro, acrescida da explicacao quando o formato e o de
 * bloqueio do Windows.
 *
 * @param {unknown} err  o erro do evento 'error' do child_process
 * @param {string} [exe] caminho ou nome do binario, para a frase citar
 * @param {string} [plataforma] injetavel no teste; default process.platform
 * @returns {string}
 */
function mensagemDeErroDeSpawn(err, exe, plataforma = process.platform) {
  const e = /** @type {{message?: string, code?: string}} */ (err || {});
  const base = e.message || String(err);
  if (plataforma !== 'win32' || !CODIGOS_DE_BLOQUEIO.has(String(e.code || ''))) {
    return base;
  }
  const nome = exe ? ` (${path.basename(String(exe))})` : '';
  return base
    + `. O Windows provavelmente bloqueou este executável${nome}.`
    + ' Se apareceu um aviso dizendo que não é possível confirmar quem publicou o arquivo,'
    + ' é o Smart App Control barrando os programas sem assinatura da cadeia de simulação;'
    + ' ele se desliga em Segurança do Windows, em Controle de aplicativos e navegador.'
    + ' Se o aviso não apareceu, abra as Propriedades do arquivo bloqueado e marque Desbloquear.';
}

module.exports = { mensagemDeErroDeSpawn, CODIGOS_DE_BLOQUEIO };
