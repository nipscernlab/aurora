// @ts-check
/**
 * version_stamp.js: o carimbo de versao que cada instalador deixa no disco.
 *
 * A sentinela de um componente (o binario principal) responde "a instalacao
 * terminou?". Ela nao responde "terminou NA VERSAO que esta AURORA espera?",
 * porque o mesmo binario existe em todas as versoes. Sem o carimbo, subir a
 * tag fixada num download-*.js nao chega a ninguem que ja tinha a versao
 * anterior: o instalador ve a sentinela e vai embora, e o painel de
 * componentes diz "instalado" para um Surfer tres versoes atras.
 *
 * O carimbo e um arquivo de texto com a tag, escrito DEPOIS de a sentinela
 * ser conferida, nunca antes: um download truncado nao pode deixar no disco
 * uma promessa de versao que nao esta la. Quem le sao o proprio instalador
 * (para decidir se re-baixa) e o catalogo do main (main/components/registry.js,
 * para o painel mostrar "atualizacao disponivel"), sempre pelo mesmo caminho
 * declarado nos dois lados e amarrado por teste.
 *
 * Carimbo ausente NAO e versao errada. Toda instalacao feita antes deste
 * arquivo existir esta sem carimbo, e trata-la como desatualizada obrigaria
 * meia duzia de laboratorios a re-baixar 272 MB por nada. Ausente e "versao
 * desconhecida": o instalador pula como sempre pulou, e o proximo download
 * (por --force, pelo doctor, ou por uma tag realmente diferente) carimba.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** O nome do carimbo, igual em todo componente que nao tenha um proprio. */
const NOME_PADRAO = '.aurora-version';

/**
 * A tag gravada, ou null quando nao ha carimbo (ou ele esta vazio).
 *
 * @param {string} arquivo
 * @returns {string|null}
 */
function lerCarimbo(arquivo) {
  try {
    return fs.readFileSync(arquivo, 'utf8').trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Grava a tag. Cria a pasta se preciso; so deve ser chamada depois de a
 * sentinela ter sido conferida.
 *
 * @param {string} arquivo
 * @param {string} tag
 */
function escreverCarimbo(arquivo, tag) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, `${tag}\n`, 'utf8');
}

/**
 * O instalador pode pular o download?
 *
 * Sim quando a sentinela esta la e o carimbo, SE existir, e o da tag fixada.
 * Carimbo de outra tag e a unica coisa que forca o re-download sem --force;
 * carimbo ausente pula, pelo motivo explicado no cabecalho.
 *
 * @param {{ instalado: boolean, carimbo: string, tag: string }} p
 * @returns {{ pular: boolean, motivo: 'ausente'|'em-dia'|'sem-carimbo'|'outra-versao', gravada: string|null }}
 */
function decidir({ instalado, carimbo, tag }) {
  if (!instalado) return { pular: false, motivo: 'ausente', gravada: null };
  const gravada = lerCarimbo(carimbo);
  if (gravada === null) return { pular: true, motivo: 'sem-carimbo', gravada };
  if (gravada === tag) return { pular: true, motivo: 'em-dia', gravada };
  return { pular: false, motivo: 'outra-versao', gravada };
}

module.exports = { NOME_PADRAO, lerCarimbo, escreverCarimbo, decidir };
