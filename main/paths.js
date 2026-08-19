// @ts-check
/**
 * Static paths used across the main process.
 *
 * `app.getAppPath()` is the project root in dev and `resources/app.asar` (or
 * `resources/app`) in a packaged build. Components are bundled outside the
 * asar so they live next to the executable in production.
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
const componentsPath = (isDev || !temApp)
  ? path.join(appRoot, 'components')
  : path.join(path.dirname(app.getPath('exe')), 'components');

const rootPath = path.join(appRoot, '..', '..');

module.exports = {
  isDev,
  appRoot,
  componentsPath,
  rootPath,
};
