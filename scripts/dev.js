#!/usr/bin/env node
/**
 * dev.js — Vite dev server + Electron, wired together for HMR development.
 *
 * Boots the Vite dev server on a fixed port, waits for it to answer, then
 * spawns Electron pointed at it via AURORA_RENDERER_URL. main/windows.js reads
 * that env var (and `!app.isPackaged`) to loadURL the dev server instead of the
 * built dist/index.html — so editing renderer code hot-reloads in the live IDE.
 *
 * This is ADDITIVE: `npm start` still runs the raw-ESM path unchanged. Only
 * `npm run dev` goes through Vite.
 *
 * Like scripts/launch-electron.js, we delete ELECTRON_RUN_AS_NODE before
 * spawning Electron — some parent shells (VS Code terminal, Claude Code) export
 * it, which would make Electron boot as plain Node and crash at app.getAppPath.
 */
const { spawn } = require('child_process');
const http = require('http');

const PORT = 5273;
const RENDERER_URL = `http://localhost:${PORT}/index.html`;
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Start Vite (strictPort so the URL we hand Electron matches the HMR socket).
const vite = spawn(npxCmd, ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32', // npx.cmd needs a shell on Windows
});

let electron = null;
function shutdown(code) {
  try { vite.kill(); } catch (_) { /* already gone */ }
  process.exit(code ?? 0);
}

// Poll the dev server until it answers, then launch Electron.
(function waitForServer(attempt = 0) {
  const req = http.get({ host: 'localhost', port: PORT, path: '/' }, (res) => {
    res.resume();
    launchElectron();
  });
  req.on('error', () => {
    if (attempt > 150) { // ~30 s
      console.error('[dev] Vite did not become ready in time.');
      shutdown(1);
      return;
    }
    setTimeout(() => waitForServer(attempt + 1), 200);
  });
})();

function launchElectron() {
  const env = { ...process.env, AURORA_RENDERER_URL: RENDERER_URL };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronBin = require('electron');
  electron = spawn(electronBin, ['.'], { stdio: 'inherit', env });
  electron.on('close', (code) => shutdown(code ?? 0));
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
