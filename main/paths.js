// @ts-check
/**
 * Static paths used across the main process.
 *
 * `app.getAppPath()` is the project root in dev and `resources/app.asar` (or
 * `resources/app`) in a packaged build.
 *
 * ONDE OS COMPONENTES MORAM, E POR QUE NAO E AO LADO DO EXECUTAVEL
 * ---------------------------------------------------------------
 * Eles ficavam em `<pasta do exe>/components`, o que funcionava enquanto tudo
 * vinha dentro do instalador. Deixou de funcionar quando passaram a ser
 * baixados: numa ATUALIZACAO, o desinstalador do electron-builder faz
 * `RMDir /r $INSTDIR` antes de o novo instalador rodar (veja
 * app-builder-lib/templates/nsis/uninstaller.nsh). Quem tivesse baixado a
 * cadeia de compilacao perderia 955 MB a cada release, e o gancho de mescla no
 * installer.nsh nem chegaria a ser executado, porque a pasta ja teria sido
 * apagada.
 *
 * Entao a pasta sai do diretorio de instalacao e vai para o LOCALAPPDATA, que
 * o desinstalador nao toca. O instalador copia para la o que ele traz
 * (Scripts, bin, HDL), e o que o usuario baixou continua onde estava.
 *
 * LOCAL, e nao roaming: `app.getPath('userData')` cairia em `%APPDATA%`, que
 * em maquina de universidade com perfil roaming sincroniza pela rede a cada
 * login. Um gigabyte de toolchain ali dentro seria um problema serio para o
 * laboratorio, e nao apenas espaco gasto.
 */

const path = require('path');
const { app } = require('electron');

const isDev = process.env.NODE_ENV === 'development';

/**
 * Fora do Electron nao existe `app`, e este modulo e requerido por quase tudo
 * em main/. Sem a reserva, qualquer teste que encostasse num modulo do processo
 * principal morria no import, e o efeito pratico era que a parte da AURORA com
 * mais consequencia era justamente a menos testavel. A reserva usa a raiz do
 * repositorio, que e onde `components/` fica em desenvolvimento. Dentro do
 * Electron nada muda: `app` existe e responde primeiro.
 */
const temApp = !!(app && typeof app.getAppPath === 'function');
const appRoot = temApp ? app.getAppPath() : path.join(__dirname, '..');

/**
 * A pasta persistente dos componentes, na instalacao empacotada.
 *
 * Exportada para o teste poder conferir a regra sem subir o Electron: o que
 * nao pode acontecer, nunca, e este caminho voltar para dentro da pasta de
 * instalacao.
 *
 * @param {string} exePath caminho do executavel.
 * @param {string|undefined} localAppData `%LOCALAPPDATA%`.
 * @param {string|undefined} userData reserva quando LOCALAPPDATA nao existe.
 */
function componentesPersistentes(exePath, localAppData, userData) {
  const base = localAppData || userData;
  // Sem nenhuma das duas, o lado do exe e melhor do que nao ter caminho: o
  // aplicativo continua funcionando e so perde a sobrevivencia a atualizacao.
  if (!base) return path.join(path.dirname(exePath), 'components');
  return path.join(base, 'SAPHO', 'components');
}

/**
 * A pasta persistente vale so para a instalacao EMPACOTADA.
 *
 * O sinal e `app.isPackaged`, e nao `isDev`. Nada no projeto define
 * NODE_ENV=development, entao `isDev` e falso durante o `npm start` tambem, e
 * usa-lo aqui mandou o desenvolvimento procurar componentes no LOCALAPPDATA,
 * onde nunca houve nada: a AURORA subia com tudo marcado como ausente. Antes
 * isso passava despercebido porque o caminho de producao caia em
 * `node_modules/electron/dist/components`, que e uma juncao para a pasta do
 * repositorio; o acerto era por acidente.
 */
const empacotado = temApp && app.isPackaged;
const componentsPath = empacotado
  ? componentesPersistentes(
    app.getPath('exe'), process.env.LOCALAPPDATA, app.getPath('userData'))
  : path.join(appRoot, 'components');

const rootPath = path.join(appRoot, '..', '..');

module.exports = {
  isDev,
  appRoot,
  componentsPath,
  componentesPersistentes,
  rootPath,
};
