#!/usr/bin/env node
/**
 * dev.js: Vite dev server + Electron, wired together for HMR development.
 *
 * Boots the Vite dev server on a fixed port, waits for it to answer, then
 * spawns Electron pointed at it via AURORA_RENDERER_URL. main/render_loader.js
 * reads that env var (and `!app.isPackaged`) to loadURL the dev server instead
 * of the built dist/, so editing renderer code hot-reloads in the live IDE.
 *
 * This is ADDITIVE: `npm start` loads the built dist (file://) unchanged. Only
 * `npm run dev` goes through the Vite server.
 *
 * We spawn Vite DIRECTLY under this Node process (its own bin script), NOT via
 * `npx`/a shell. On Windows the old `spawn('npx.cmd', …, { shell: true })` chain
 * (node → cmd.exe → npx → node → vite) left the real Vite server as an
 * unmanaged grandchild: it could die mid-session, at which point every lazy
 * renderer request 404→ERR_CONNECTION_REFUSED (Monaco editor workers, the
 * SystemVerilog language def, fonts, the PRISM window) and the HMR socket
 * retry-loops, and it never tore down cleanly on close (slow exit + orphaned
 * port). A direct Node child is stable and kills cleanly.
 *
 * Like scripts/launch-electron.js, we delete ELECTRON_RUN_AS_NODE before
 * spawning Electron, some parent shells (VS Code terminal, Claude Code) export
 * it, which would make Electron boot as plain Node and crash at app.getAppPath.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 5273;
const RENDERER_URL = `http://localhost:${PORT}/index.html`;
const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');

// Vite, as a direct Node child (stable + clean teardown). strictPort so the URL
// we hand Electron always matches the HMR socket.
const vite = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
});

let electron = null;
let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (electron && !electron.killed) electron.kill(); } catch (_) { /* gone */ }
  try { if (!vite.killed) vite.kill(); } catch (_) { /* gone */ }
  process.exit(code ?? 0);
}

// If Vite dies, the renderer is dead, bring Electron down too instead of
// leaving a window pointed at a gone server (the failure mode this fixes).
vite.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[dev] Vite exited (code ${code}); shutting down.`);
    shutdown(code ?? 1);
  }
});

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
