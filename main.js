// @ts-check
/**
 * Electron entry point.
 *
 * All real logic lives in main/. This file just wires modules together so
 * the boot order is: lifecycle → IPC handlers (incl. updater IPC) → splash.
 * The autoUpdater itself initializes lazily, ~2 s after the main window
 * shows; only the IPC handlers are registered eagerly here.
 */

const { app, crashReporter } = require('electron');
const log = require('electron-log');

const { configureLogger } = require('./main/logger');
configureLogger(); // before anything else so all subsequent log calls use it

// Main-process safety net. There was no crashReporter and no top-level handler,
// so a throw outside an IPC callback could take the process down (or leave it
// half-dead with toolchain children orphaned) with nothing logged. Collect
// local minidumps and log anything that escapes a handler. All best-effort —
// the safety net must never be what blocks boot.
try { crashReporter.start({ uploadToServer: false }); }
catch (_) { /* minidump collection is optional */ }
process.on('uncaughtException', (err) => { log.error('[main] uncaughtException:', err); });
process.on('unhandledRejection', (reason) => { log.error('[main] unhandledRejection:', reason); });

// ── GPU / compositor tuning ────────────────────────────────────────────────
// Command-line switches MUST be appended before the app is ready (the GPU
// process reads them at launch). These target a smooth, high-refresh UI:
//
//   • gpu-rasterization + zero-copy: rasterize tiles on the GPU and upload
//     them without a CPU copy. Cheap, broadly safe, and the biggest win for
//     scroll/paint-heavy panels (terminal, editor, wave config).
//
// We deliberately do NOT set `disable-frame-rate-limit`. It removes Chromium's
// vsync pacing, which let the splash's per-frame requestAnimationFrame loops
// (the starfield canvas + the progress-bar easing in html/splash.html, both
// frame-count based) run unbounded on a transparent window — that saturated the
// GPU process and froze the splash and its handoff to the main window. Normal
// vsync already presents at the display's native refresh (120 Hz+), so we keep
// the high-refresh target without the hazard.
//
// Hardware acceleration itself is left ON (Electron's default) — we never call
// app.disableHardwareAcceleration(). backgroundThrottling also stays at its
// default so a minimized window doesn't keep the GPU busy.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// AppUserModelID must be registered as early as possible — before any
// BrowserWindow exists. Windows uses it to associate the running
// process with a stable jumplist identity, so setting it later (as we
// used to, from inside createMainWindow) meant the taskbar grouping
// was sometimes still bound to electron.exe's embedded "Electron"
// identity and the jumplist updates wouldn't land on the right
// shortcut. Moving the call here, before app.whenReady, fixes that.
if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.nipscern.sapho'); }
  catch (_) { /* setAppUserModelId is best-effort; failure here doesn't block boot */ }
}

const lifecycle = require('./main/lifecycle');
const windows = require('./main/windows');
const updater = require('./main/updater');

const filesIpc = require('./main/ipc/files');
const projectIpc = require('./main/ipc/project');
const compileIpc = require('./main/ipc/compile');
const executorIpc = require('./main/compile/executor');
const prismIpc = require('./main/ipc/prism');
const systemIpc = require('./main/ipc/system');
const aiIpc = require('./main/ipc/ai');

// Register lifecycle (single-instance lock, app events, cleanup). If we lost
// the lock, the function returns false after calling app.quit() — bail out so
// we don't keep registering handlers in a dying process.
const acquiredLock = lifecycle.register();
if (acquiredLock) {
  windows.registerWindowControls();
  filesIpc.register();
  projectIpc.register();
  compileIpc.register();
  executorIpc.register();
  prismIpc.register();
  systemIpc.register();
  aiIpc.register();
  // Updater IPC must be registered at boot, not lazily — the splash window
  // calls `getAppVersion()` before the autoUpdater itself is initialized.
  updater.registerIpc();

  app.whenReady().then(() => {
    // MSYS tools (bash/make under the Verilator build, and cocotb) resolve
    // `/tmp` to <msysRoot>/tmp. A packaged build — or a freshly-copied
    // components/ tree — may not carry that empty directory, so bash warns
    // "could not find /tmp, please create" and temp-file-using steps can
    // break. Create it once at startup; best-effort (absence only re-triggers
    // the warning, never crashes boot).
    try {
      const fs = require('fs');
      const path = require('path');
      const { componentsPath } = require('./main/paths');
      fs.mkdirSync(path.join(componentsPath, 'Packages', 'msys', 'tmp'), { recursive: true });
    } catch (_) { /* best-effort */ }

    // Render the initial jumplist before the user has a chance to
    // right-click the taskbar icon. createMainWindow used to handle
    // this, but moving it here means the list is set even during the
    // splash-screen window (when no main window exists yet) — and the
    // very first taskbar interaction already shows our entries.
    try { windows.rebuildJumpList?.(); }
    catch (_) { /* jumplist is decorative on startup; rebuildJumpList logs internally */ }
    windows.createSplashScreen(); // splash schedules createMainWindow itself
  });
}
