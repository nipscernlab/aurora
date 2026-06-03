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

const appRoot = app.getAppPath();
const componentsPath = isDev
  ? path.join(appRoot, 'components')
  : path.join(path.dirname(app.getPath('exe')), 'components');

const rootPath = path.join(appRoot, '..', '..');

module.exports = {
  isDev,
  appRoot,
  componentsPath,
  rootPath,
};
