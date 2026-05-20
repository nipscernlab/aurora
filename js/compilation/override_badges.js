/**
 * override_badges.js — toolbar UX for active command overrides.
 *
 * Adds a small "✱" marker to compile-toolbar buttons (cmmcomp,
 * vericomp, wavecomp, prismcomp) whenever the corresponding pipeline
 * step has an active override (ephemeral or persisted). Hover shows
 * the human-readable diff; right-click on the badge clears the
 * override without going through the AI.
 *
 * Subscribes to:
 *   - aurora:spf-changed   (override persisted/cleared in .spf)
 *   - aurora-api  compile:override-set / compile:override-cleared
 * and re-paints on each.
 */

import { listOverrides, clearOverride } from './command_overrides.js';

const BUTTON_TO_STEPS = {
  cmmcomp:   ['cmm', 'asm-pre', 'asm'],
  vericomp:  ['iverilog-check', 'iverilog-build'],
  wavecomp:  [
    'iverilog-build',
    'vvp-header', 'vvp-run',
    'verilator-build', 'verilator-header', 'verilator-run',
    'fst2vcd', 'gtkwave',
  ],
  prismcomp: ['iverilog-check', 'prism-yosys', 'yosys-hierarchy'],
};

function ensureStyle() {
  if (document.getElementById('aurora-override-badge-style')) return;
  const style = document.createElement('style');
  style.id = 'aurora-override-badge-style';
  style.textContent = `
    .toolbar-button.has-ai-override {
      position: relative;
    }
    .toolbar-button.has-ai-override::after {
      content: '✱';
      position: absolute;
      top: 1px;
      right: 2px;
      font-size: 10px;
      color: #ff9b3d;
      font-weight: bold;
      pointer-events: none;
      text-shadow: 0 0 2px rgba(0,0,0,0.6);
    }
  `;
  document.head.appendChild(style);
}

function formatTooltip(items) {
  const lines = items.map((it) => {
    const ov = it.override || {};
    const parts = [];
    if (ov.appendArgs?.length)  parts.push(`+${ov.appendArgs.join(' ')}`);
    if (ov.prependArgs?.length) parts.push(`prepend ${ov.prependArgs.join(' ')}`);
    if (ov.removeArgs?.length)  parts.push(`-${ov.removeArgs.join(' ')}`);
    const envParts = [];
    if (ov.envSet)   for (const [k, v] of Object.entries(ov.envSet)) envParts.push(`${k}=${v}`);
    if (ov.envUnset) for (const k of ov.envUnset) envParts.push(`unset ${k}`);
    if (envParts.length) parts.push(`env: ${envParts.join(', ')}`);
    const note = ov.note ? ` — ${ov.note}` : '';
    return `[${it.scope}] ${it.step}${it.processorName ? ':' + it.processorName : ''}: ${parts.join('; ') || '(no-op)'}${note}`;
  });
  return `AI command override active\n${lines.join('\n')}\nRight-click badge to clear.`;
}

async function repaint() {
  ensureStyle();
  let items;
  try { items = await listOverrides(); } catch (_) { items = []; }
  for (const [btnId, steps] of Object.entries(BUTTON_TO_STEPS)) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;
    const matching = items.filter((it) => steps.includes(it.step));
    if (matching.length) {
      btn.classList.add('has-ai-override');
      btn.title = formatTooltip(matching);
      btn.dataset.aiOverrideKeys = matching.map((m) => m.key + '|' + m.scope).join(',');
    } else {
      btn.classList.remove('has-ai-override');
      // Preserve the original tooltip — toolbar bootstrap sets data-tooltip
      // (and i18n re-applies). We only restored when we last set one.
      if (btn.dataset.aiOverrideKeys) {
        btn.title = '';
        delete btn.dataset.aiOverrideKeys;
      }
    }
  }
}

function attachClearHandler() {
  // Single delegated handler — buttons may be re-mounted by other
  // managers; document-level delegation survives re-renders.
  document.addEventListener('contextmenu', async (ev) => {
    const btn = ev.target?.closest?.('.toolbar-button.has-ai-override');
    if (!btn) return;
    const keys = btn.dataset.aiOverrideKeys;
    if (!keys) return;
    // Only intercept when the right-click landed near the badge —
    // upper-right corner. Otherwise let the user keep the normal
    // context menu (if any).
    const rect = btn.getBoundingClientRect();
    const nearBadge = ev.clientX > rect.right - 18 && ev.clientY < rect.top + 18;
    if (!nearBadge) return;
    ev.preventDefault();
    for (const entry of keys.split(',')) {
      const [key, scope] = entry.split('|');
      const colonAt = key.indexOf(':');
      const step = colonAt === -1 ? key : key.slice(0, colonAt);
      const processorName = colonAt === -1 ? null : key.slice(colonAt + 1);
      try { await clearOverride({ step, processorName, scope }); }
      catch (_) { /* ignore — repaint will reflect actual state */ }
    }
    await repaint();
  });
}

export function initOverrideBadges() {
  ensureStyle();
  attachClearHandler();
  repaint();

  // Re-paint on every event that can change override state.
  window.addEventListener('aurora:spf-changed', repaint);
  window.AuroraAPI?.subscribe?.('compile:override-set', repaint);
  window.AuroraAPI?.subscribe?.('compile:override-cleared', repaint);
  // Aurora's spf-changed event also fires on project open/close;
  // re-painting then clears badges from stale state.
}

if (typeof window !== 'undefined') {
  window.initOverrideBadges = initOverrideBadges;
}
