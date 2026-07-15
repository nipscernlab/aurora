// ai_metadata.js — Aurora Intelligence provider/model/permission metadata +
// pure formatters (extracted from ai_assistant_manager.js, A2 god-file
// decomposition). Static config tables (PROVIDER_META, SUB_META, model/effort
// lists, permission modes, token-window sizes) and stateless helpers
// (isSubProvider, shortModelName, formatTokens, untilTime, usageRowHTML,
// readPermissionMode, relativeTime). No instance state, no DOM.

export const PROVIDER_META = {
  // Subscription-backed: runs through the Claude Code / Claude Agent SDK,
  // billed against the user's Pro/MAX plan — no per-token API key.
  'claude-code': {
    label: 'Claude Code', icon: './assets/icons/ai_claude.svg',
    subscription: true, tagline: 'Pro / MAX plan — no API key',
  },
  // Subscription-backed: runs through the OpenAI Codex CLI, billed
  // against the user's ChatGPT plan — no per-token API key.
  'chatgpt': {
    label: 'ChatGPT', icon: './assets/icons/ai_codex.svg',
    subscription: true, tagline: 'ChatGPT plan — no API key',
  },
  openai:    { label: 'ChatGPT',  icon: './assets/icons/ai_chatgpt.svg'  },
  anthropic: { label: 'Claude',   icon: './assets/icons/ai_claude.svg'   },
  google:    { label: 'Gemini',   icon: './assets/icons/ai_gemini.webp'  },
  deepseek:  { label: 'DeepSeek', icon: './assets/icons/ai_deepseek.svg' },
  groq:      { label: 'Groq',     icon: './assets/icons/ai_groq.svg'     },
  ollama:    { label: 'Ollama',   icon: './assets/icons/ai_ollama.svg'   },
};

// Synthetic provider entry for Claude Code — it is not returned by the
// backend `listProviders()` (no API key), so the panel injects it.
export const CLAUDE_CODE_PROVIDER = { name: 'claude-code', model: 'default', defaultModel: 'default' };

// Claude Code model aliases + effort levels — surfaced as segmented
// controls in the model popover. `effort: ''` means "let the CLI decide".
//
// ALIASES on purpose (not dated ids): the CLI resolves each alias to the
// newest model of that family, so this list never rots when Anthropic ships
// a new snapshot. Current resolution (07/2026, code.claude.com/docs/model-config):
//   default → Opus 4.8 (Max/Enterprise) or Sonnet 5 (Pro/Team)
//   fable   → Claude Fable 5 (frontier; pick explicitly, never a default)
//   opus    → Opus 4.8 · sonnet → Sonnet 5 · haiku → Haiku 4.5
//   opus[1m]→ Opus 4.8 with the 1M-token context window
// (Sonnet 5 is already 1M-native on the Anthropic API — no suffix needed.)
const CLAUDE_CODE_MODELS = [
  { id: 'default',  label: 'Default'   },
  { id: 'fable',    label: 'Fable 5'   },
  { id: 'opus',     label: 'Opus'      },
  { id: 'sonnet',   label: 'Sonnet'    },
  { id: 'haiku',    label: 'Haiku'     },
  { id: 'opus[1m]', label: 'Opus 1M'   },
];
// Effort levels — shared by BOTH CLI bridges. Verified current (07/2026):
// Claude Code `--effort low|medium|high|xhigh|max` (default high on
// Fable 5 / Sonnet 5 / Opus 4.8); Codex `model_reasoning_effort` accepts
// low|medium|high|xhigh (+ max on the GPT-5.6 family, its default lineup).
// '' = Auto: omit the flag and let the CLI's per-model default win.
export const CLAUDE_CODE_EFFORT = [
  { id: '',       label: 'Auto'  },
  { id: 'low',    label: 'Low'   },
  { id: 'medium', label: 'Medium'},
  { id: 'high',   label: 'High'  },
  { id: 'xhigh',  label: 'xHigh' },
  { id: 'max',    label: 'Max'   },
];

// Synthetic provider entry for ChatGPT (Codex CLI) — like Claude Code it
// is subscription-authed, so the backend `listProviders()` never returns
// it and the panel injects it.
export const CHATGPT_PROVIDER = { name: 'chatgpt', model: 'default', defaultModel: 'default' };

// Codex model presets surfaced as a segmented control. Current lineup
// (07/2026, learn.chatgpt.com/docs/models): the GPT-5.6 family — Sol
// (complex work, the CLI default), Terra (balanced) and Luna (fast) — is
// available on ChatGPT Plus AND Pro; Codex Spark (gpt-5.3-codex-spark,
// real-time iteration) is Pro-only. gpt-5.2 / gpt-5.3-codex are deprecated
// (and the OLD gpt-5 / gpt-5-codex ids are rejected outright on ChatGPT
// auth). "default" omits `-m` and lets the signed-in plan pick — always
// safe; explicit picks that the plan doesn't cover fail with a friendly
// "model not supported" turn error that names the fix.
export const CHATGPT_MODELS = [
  { id: 'default',            label: 'Default' },
  { id: 'gpt-5.6-sol',        label: 'Sol'     },
  { id: 'gpt-5.6-terra',      label: 'Terra'   },
  { id: 'gpt-5.6-luna',       label: 'Luna'    },
  { id: 'gpt-5.3-codex-spark', label: 'Spark (Pro)' },
];

// Per-subscription-provider specifics. The panel's subscription UI
// (status row, usage bars, model presets) is driven entirely off this
// table so Claude Code and ChatGPT share one code path.
export const SUB_META = {
  'claude-code': {
    models: CLAUDE_CODE_MODELS,
    hasEffort: true,
    statusApi: 'getClaudeCodeStatus',
    usageApi: 'getClaudeCodeUsage',
    modelStoreKey: 'aurora-ai-claude-code-model',
    cliName: 'Claude Code',
    notInstalled: 'Claude Code not installed',
    installHint: 'Reinstall Aurora, or run: npm i -g @anthropic-ai/claude-code',
    loginCmd: 'claude login',
  },
  'chatgpt': {
    models: CHATGPT_MODELS,
    // Reasoning effort IS wired for Codex now: the bridge maps the shared
    // effort selection to `-c model_reasoning_effort=…` (codex_cli.js).
    hasEffort: true,
    statusApi: 'getCodexStatus',
    usageApi: 'getCodexUsage',
    modelStoreKey: 'aurora-ai-chatgpt-model',
    cliName: 'Codex',
    notInstalled: 'Codex CLI not installed',
    installHint: 'Reinstall Aurora, or run: npm i -g @openai/codex',
    loginCmd: 'codex login',
  },
};

/** True when `name` is a subscription-backed CLI provider. */
export function isSubProvider(name) {
  return !!SUB_META[name];
}

// Anti-freeze watchdog: if a streaming turn goes this long with NO chat event
// AND nothing pending (no in-flight tool, no open ask/confirm card), it's
// treated as wedged and the UI self-heals back to idle. Generous so a slow
// model or a long single tool never trips it falsely.
export const STREAM_STALL_MS = 180000;

// Hard ceiling for the watchdog. A running tool chip normally blocks the stall
// recovery (a real tool can run for minutes), but a chip can get STUCK (a
// tool-result that never matched it) and would then suppress the rescue
// forever. No legitimate tool runs longer than the tool_bridge backstops
// (≤10 min), so past this ceiling we reap regardless of running chips.
export const STREAM_STALL_HARD_MS = 12 * 60 * 1000;

/** Strip vendor prefixes / date suffixes so a model id fits on the chip. */
export function shortModelName(model) {
  if (!model) return '';
  return String(model)
    .replace(/^(claude-|gpt-|gemini-|models\/|deepseek-)/i, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

/** Compact a token count: 1234 → "1.2k", 12 → "12". */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

// Rate-limit window display metadata, keyed by the CLI's `rateLimitType`.
export const WINDOW_META = {
  five_hour: { label: '5-hour window', icon: 'ph-hourglass-medium' },
  weekly:    { label: 'This week',     icon: 'ph-calendar-dots'    },
};

/** Compact "in 2h 14m" / "in 3d" countdown from a unix-seconds timestamp. */
export function untilTime(unixSeconds) {
  const ms = Number(unixSeconds) * 1000 - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 60)   return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * One row in the Claude Code usage panel: a label, a value, and a thin
 * bar. `state` colours the fill (ok / mid / high / count); `pct` is the
 * fill width (0–100).
 */
export function usageRowHTML(label, icon, valText, state, pct) {
  return `
    <div class="ai-usage" data-state="${state}">
      <div class="ai-usage-top">
        <span class="ai-usage-label"><i class="ph ${icon}" aria-hidden="true"></i>${label}</span>
        <span class="ai-usage-val">${valText || ''}</span>
      </div>
      <div class="ai-usage-track"><div class="ai-usage-fill" style="width:${pct || 0}%"></div></div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

/* ============================================================
 *  Tool permission modes
 *
 *  Persisted in localStorage; chosen from the chat's gear popover.
 *    ask    — every tool call needs an inline OK (read and write)
 *    writes — reads run freely, writes need an inline OK (default)
 *    allow  — nothing is prompted; the assistant is fully autonomous
 * ========================================================== */

export const PERMISSION_STORE_KEY = 'aurora-ai-permission';
export const PERMISSION_MODES = [
  { id: 'ask',    label: 'Ask every time',     hint: 'Confirm every action' },
  { id: 'writes', label: 'Ask before changes', hint: 'Reads run freely; changes ask first' },
  { id: 'allow',  label: 'Allow all',          hint: 'Full autonomy — no prompts' },
];

export function readPermissionMode() {
  try {
    const v = localStorage.getItem(PERMISSION_STORE_KEY);
    if (PERMISSION_MODES.some((m) => m.id === v)) return v;
  } catch (_) { /* fall through to default */ }
  return 'writes';
}

/** Compact "2 min ago" / "3 d ago" / locale date stamp. */
export function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  try { return new Date(Number(ts)).toLocaleDateString(); }
  catch (_) { return ''; }
}
