// @ts-check
/**
 * fs_guard.js: a regra que decide onde o renderer pode ESCREVER e APAGAR.
 *
 * Os handlers de arquivo do files.js aceitavam caminho absoluto arbitrario, e
 * o safePath so rejeita vazio e byte nulo. As ferramentas delete_file e afins
 * da IA chegam la, e a unica barreira era o modal ask-before-write, que
 * depende de a pessoa ler o caminho. Escrita e remocao agora sao confinadas,
 * por prefixo apos path.resolve, a:
 *
 *   - o projeto aberto NA JANELA que pediu (spfDaJanela);
 *   - components/Temp, onde a compilacao escreve scripts e intermediarios;
 *   - userData (%APPDATA%/SAPHO) e a temp do sistema;
 *   - caminhos que o USUARIO escolheu por um dialogo do processo principal
 *     (abrir/salvar/importar) ou pela associacao de arquivo do Windows, que
 *     sao a via legitima do arquivo avulso fora do projeto.
 *
 * Leitura fica de fora de proposito: abrir um arquivo qualquer para ver e
 * caso de uso (importar, clonar, explorar), e o dano de leitura ja e coberto
 * pelo isolamento do renderer. O guarda existe para o gesto irreversivel.
 *
 * Limite conhecido, igual ao do resto do processo principal: a comparacao e
 * por prefixo do caminho resolvido, sem realpath, entao um link simbolico
 * DENTRO de uma area gravavel apontando para fora dela atravessa o guarda.
 * Criar esse link ja exige controle da maquina, que e mais do que o guarda
 * protege.
 */

const path = require('path');

/**
 * Normaliza um caminho para comparacao: resolvido, e em minusculas no
 * Windows, onde o sistema de arquivos nao diferencia caixa.
 * @param {string} p
 * @param {NodeJS.Platform} [plataforma]
 */
function chaveDeComparacao(p, plataforma = process.platform) {
  const r = path.resolve(String(p));
  return plataforma === 'win32' ? r.toLowerCase() : r;
}

/**
 * `alvo` e a propria `raiz` ou mora dentro dela? Prefixo com separador, para
 * `C:\proj2` nao passar por estar textualmente colado em `C:\proj`. Raiz de
 * unidade (`C:\`) ja termina em separador e funciona pela mesma regra.
 * @param {string} raiz
 * @param {string} alvo
 * @param {NodeJS.Platform} [plataforma]
 */
function dentroDe(raiz, alvo, plataforma = process.platform) {
  const r = chaveDeComparacao(raiz, plataforma);
  const a = chaveDeComparacao(alvo, plataforma);
  if (a === r) return true;
  const comSep = r.endsWith(path.sep) ? r : r + path.sep;
  return a.startsWith(comSep);
}

/**
 * Decide se `alvo` pode ser escrito/apagado dado o contexto de areas
 * permitidas. Puro: quem monta o contexto e o files.js, que conhece a janela.
 *
 * @param {string} alvo caminho ja resolvido pelo safePath.
 * @param {{
 *   raizes?: Array<string | null | undefined>,
 *   arquivos?: Iterable<string>,
 *   raizesConcedidas?: Iterable<string>,
 * }} ctx raizes fixas, arquivos avulsos concedidos e raizes concedidas.
 * @param {NodeJS.Platform} [plataforma]
 */
function escritaPermitida(alvo, ctx, plataforma = process.platform) {
  for (const raiz of ctx.raizes || []) {
    if (raiz && dentroDe(raiz, alvo, plataforma)) return true;
  }
  const a = chaveDeComparacao(alvo, plataforma);
  for (const f of ctx.arquivos || []) {
    if (chaveDeComparacao(f, plataforma) === a) return true;
  }
  for (const raiz of ctx.raizesConcedidas || []) {
    if (raiz && dentroDe(raiz, alvo, plataforma)) return true;
  }
  return false;
}

module.exports = { chaveDeComparacao, dentroDe, escritaPermitida };
