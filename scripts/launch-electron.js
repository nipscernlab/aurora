#!/usr/bin/env node
/**
 * launch-electron.js: Start Electron, dropping ELECTRON_RUN_AS_NODE first.
 *
 * Some parent shells (VS Code's integrated terminal, Claude Code) export
 * ELECTRON_RUN_AS_NODE=1. Inherited by `electron .`, it makes Electron boot
 * as plain Node, `app` is undefined and the app crashes at
 * `app.getAppPath()` in main/paths.js. Just unsetting/emptying the variable
 * is not enough on every platform, so we delete it from the env we pass on.
 *
 * The e2e harness (tests/e2e/*) already strips this var before spawning
 * Electron; this makes `npm start` equally robust so launching "just works"
 * regardless of the dev's shell.
 */
delete process.env.ELECTRON_RUN_AS_NODE;

const { spawn } = require('child_process');
const electron = require('electron');

spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('close', (code) => process.exit(code ?? 0));
