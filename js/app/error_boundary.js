import { electronAPI } from './electron_api.js';
/**
 * error_boundary.js — the renderer's last line of defence.
 *
 * Aurora's renderer is a graph of ES modules with an implicit load order
 * (ARCHITECTURE.md §1) and managers that do I/O in their constructors. Before
 * this module there was no window.onerror / unhandledrejection handler at all,
 * so a throw in any init silently dropped part of the IDE with nothing in the
 * console flow and no recovery. This catches both, logs them with a clear
 * prefix, forwards to the main process log when the bridge is available, and
 * surfaces a single quiet toast so the user knows something failed rather than
 * staring at a half-dead UI.
 *
 * Loaded FIRST among the module scripts so it is armed before the rest of the
 * graph evaluates. Intentionally dependency-free and defensive — it must never
 * be the thing that throws.
 */

const PREFIX = '[aurora]';
let _toastShown = false;

function describe(err) {
  if (!err) return 'unknown error';
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try { return String(err); } catch { return 'unstringifiable error'; }
}

function forwardToMain(kind, message, stack) {
  // Best-effort: the preload may expose a logging channel; never assume it does.
  try {
    const api = electronAPI;
    if (api && typeof api.logRendererError === 'function') {
      api.logRendererError({ kind, message, stack: stack || null });
    }
  } catch { /* logging must not throw */ }
}

function showToastOnce(message) {
  // Surface ONE unobtrusive toast — repeated errors shouldn't spam the user.
  if (_toastShown) return;
  _toastShown = true;
  try {
    if (typeof window.showNotification === 'function') {
      window.showNotification(`Something went wrong: ${message}`, 'error');
      return;
    }
  } catch { /* fall through to the DOM fallback */ }
  try {
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:9999',
      'max-width:360px', 'padding:10px 14px',
      'font:12px/1.5 system-ui,sans-serif', 'color:#E8ECF3',
      'background:#1B2130', 'border:1px solid rgba(226,108,108,.45)',
      'border-radius:8px', 'box-shadow:0 8px 24px rgba(0,0,0,.5)',
      'pointer-events:none',
    ].join(';');
    el.textContent = `Something went wrong — see the console. (${message})`;
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 6000);
  } catch { /* if even this fails, the console log below is the floor */ }
}

function handle(kind, err, stack) {
  const message = describe(err);
  console.error(`${PREFIX} ${kind}:`, err);
  forwardToMain(kind, message, stack);
  showToastOnce(message);
}

/**
 * Monaco/VS Code routinely reject their in-flight async work (tokenization,
 * hovers, model/link resolution) with a benign "Canceled" CancellationError when
 * an editor or model is DISPOSED — e.g. when Aurora closes every tab and reopens
 * the project during a rename. That is normal teardown, NOT a crash, so it must
 * not raise the error overlay (VS Code itself swallows these). Let it pass.
 */
function isBenignCancellation(err) {
  if (!err) return false;
  const name = err.name;
  const message = typeof err === 'string' ? err : (err && err.message);
  return name === 'Canceled' || name === 'CancellationError'
    || message === 'Canceled' || message === 'Cancelled';
}

window.addEventListener('error', (event) => {
  const err = event.error || event.message;
  if (isBenignCancellation(err)) { try { event.preventDefault(); } catch { /* noop */ } return; }
  handle('uncaught error', err, event.error && event.error.stack);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  if (isBenignCancellation(reason)) { try { event.preventDefault(); } catch { /* noop */ } return; }
  handle('unhandled promise rejection', reason, reason && reason.stack);
});
