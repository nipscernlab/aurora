// @ts-check
/**
 * surfer_config.js — a parte pura do que a AURORA escreve na configuracao do
 * Surfer: a geometria da janela, o conteudo do config.toml e a higienizacao do
 * nome de um mapping.
 *
 * Extraido de main/ipc/compile.js em 08/08/2026, sem mudanca de comportamento.
 * As funcoes de la misturavam calculo com escrita em disco e com o `screen` do
 * Electron, entao nao havia como testar o calculo. Uma delas e de seguranca: o
 * nome do mapping vem de dado do projeto e vira nome de arquivo, entao ele
 * precisa nao conseguir escapar do diretorio.
 *
 * Quem usa: main/ipc/compile.js, no lancamento do Surfer.
 */

/** Marcador que protege um config.toml escrito a mao pelo usuario. */
const MARKER = '# Managed by AURORA';

/**
 * Retangulo centrado ocupando 85% da area util, com piso de 800 por 600.
 *
 * O Surfer nao tem flag de maximizar e o arquivo de estado dele nao guarda
 * geometria, entao sem isto ele abre numa janelinha no canto superior esquerdo.
 * Nada e fixo em pixel: a area util vem do display primario real.
 *
 * @param {{x: number, y: number, width: number, height: number}} workArea
 * @returns {{w: number, h: number, x: number, y: number}}
 */
function surferWindowGeometry(workArea) {
  const w = Math.max(800, Math.round(workArea.width * 0.85));
  const h = Math.max(600, Math.round(workArea.height * 0.85));
  const x = workArea.x + Math.round((workArea.width - w) / 2);
  const y = workArea.y + Math.round((workArea.height - h) / 2);
  return { w, h, x, y };
}

/**
 * Conteudo do config.toml do Surfer para uma geometria.
 *
 * @param {{w: number, h: number, x: number, y: number}} g
 * @returns {string}
 */
function surferConfigToml(g) {
  return (
    `${MARKER} — Surfer opens centered on your screen; maximize it yourself.\n`
    + '# Delete this file (or remove the line above) to manage the window yourself.\n'
    // O auto-reload (SurferConfig.autoreload_files) NAO dispara no Windows
    // v0.7.0: o watcher nao pega a reescrita do FST. Por isso a AURORA fecha a
    // janela anterior e reabre, em vez de depender do reload automatico.
    + '[layout]\n'
    + `window_width = ${g.w}\n`
    + `window_height = ${g.h}\n`
    + `window_x_position = ${g.x}\n`
    + `window_y_position = ${g.y}\n`
  );
}

/**
 * Diz se um config.toml existente pode ser sobrescrito. So pode quando ele
 * carrega o marcador, ou seja, quando foi a propria AURORA que o escreveu.
 *
 * @param {string | null} conteudoAtual conteudo lido, ou null se nao existe
 * @returns {boolean}
 */
function podeSobrescreverConfig(conteudoAtual) {
  if (conteudoAtual === null || conteudoAtual === undefined) return true;
  return conteudoAtual.includes(MARKER);
}

/**
 * Reduz o nome de um mapping ao que pode virar nome de arquivo com seguranca.
 *
 * O nome ja chega montado por `mappingName`, mas ele deriva de dado do projeto
 * e vira caminho dentro do diretorio global de mappings do Surfer. Tudo que nao
 * for letra, numero, ponto, hifen ou sublinhado vira sublinhado, de modo que
 * separador de caminho e `..` nao consigam sair do diretorio.
 *
 * @param {any} name
 * @returns {string} vazio quando nao sobra nada utilizavel
 */
function safeMappingName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

module.exports = {
  MARKER,
  surferWindowGeometry,
  surferConfigToml,
  podeSobrescreverConfig,
  safeMappingName,
};
