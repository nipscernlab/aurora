// @ts-check
/**
 * claude_code.js — Claude Code CLI bridge for Aurora Intelligence.
 *
 * Lets the AI panel talk to the user's Claude Pro/MAX *subscription*
 * instead of a metered API key. It does this by shelling out to the
 * locally-installed `claude` CLI in print mode:
 *
 *     claude -p --output-format stream-json --verbose --include-partial-messages
 *
 * The CLI authenticates with the subscription via its own OAuth login
 * (`claude login`); Aurora never sees or stores a token. We deliberately
 * strip `ANTHROPIC_API_KEY` from the child environment so the CLI cannot
 * silently fall back to metered API billing.
 *
 * The stream-json events the CLI emits are translated into the *same*
 * `ai:chat-event` packets that `chat.js` produces, so the renderer's
 * chat loop is transport-agnostic:
 *
 *   { type:'text-delta',  delta }
 *   { type:'tool-call',   toolName, args }
 *   { type:'tool-result', toolName, result }
 *   { type:'finish',      text, usage }
 *   { type:'aborted',     text }
 *   { type:'error',       message }
 */

'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('electron-log');

const state = require('../state');

/** sessionId → { proc } for in-flight turns. */
const sessions = new Map();
/** conversationId → claude CLI session_id, so follow-up turns `--resume`. */
const convSessions = new Map();

/** Most recent rate-limit windows, keyed by type ('five_hour' | 'weekly' | …). */
let rateLimitWindows = {};
/** Tokens / cost tallied across every Claude Code turn this app run. */
let sessionTokens = 0;
let sessionCostUsd = 0;

let cachedBin = undefined;   // undefined = not probed, null = not found, string = path

// ---------------------------------------------------------------------------
//  Binary + credential discovery
// ---------------------------------------------------------------------------

/** Locate the `claude` executable once; cache the result. */
function resolveBinary() {
  if (cachedBin !== undefined) return cachedBin;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync(finder, ['claude'], { encoding: 'utf-8' });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    cachedBin = first || null;
  } catch (_) {
    cachedBin = null;
  }
  return cachedBin;
}

/** Read the Claude Code OAuth credentials (subscription info), or null. */
function readCredentials() {
  try {
    const p = path.join(os.homedir(), '.claude', '.credentials.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return j && j.claudeAiOauth ? j.claudeAiOauth : null;
  } catch (_) {
    return null;
  }
}

function execFileText(bin, args, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Probe the local Claude Code install + subscription login. Cheap — it
 * reads the credentials file rather than spending tokens on a ping.
 *
 * @returns {Promise<{installed:boolean, path?:string, version?:string,
 *   authed?:boolean, plan?:string, rateLimitTier?:string, expiresAt?:number,
 *   expired?:boolean}>}
 */
async function detect() {
  const bin = resolveBinary();
  if (!bin) return { installed: false };

  let version = '';
  try { version = (await execFileText(bin, ['--version'])).trim(); }
  catch (_) { /* version is best-effort */ }

  const creds = readCredentials();
  const expiresAt = creds && Number(creds.expiresAt) ? Number(creds.expiresAt) : 0;
  return {
    installed: true,
    path: bin,
    version,
    authed: !!(creds && creds.accessToken),
    plan: (creds && creds.subscriptionType) || null,
    rateLimitTier: (creds && creds.rateLimitTier) || null,
    expiresAt: expiresAt || null,
    expired: expiresAt ? Date.now() > expiresAt : false,
  };
}

/** Snapshot of subscription usage for the panel's usage bars. */
function getUsage() {
  const creds = readCredentials();
  return {
    plan: (creds && creds.subscriptionType) || null,
    session: { tokens: sessionTokens, costUsd: sessionCostUsd },
    windows: Object.values(rateLimitWindows),
  };
}

// ---------------------------------------------------------------------------
//  Chat
// ---------------------------------------------------------------------------

function sendEvent(webContents, sessionId, type, data) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('ai:chat-event', { sessionId, type, ...(data || {}) });
  } catch (e) {
    log.warn('[ai.claude-code] send failed:', e?.message || e);
  }
}

/** AURORA permission mode → `claude --permission-mode` value. */
function permissionFlag(mode) {
  if (mode === 'allow')  return 'bypassPermissions';
  if (mode === 'writes') return 'acceptEdits';
  return 'default';                       // 'ask' — writes/bash auto-denied in -p
}

/** Directory the CLI should treat as the workspace (the open project). */
function workspaceDir() {
  const spf = state.currentOpenProjectPath || global.currentProjectPath;
  if (spf) {
    try {
      const stat = fs.statSync(spf);
      return stat.isDirectory() ? spf : path.dirname(spf);
    } catch (_) { /* fall through */ }
  }
  return os.homedir();
}

/**
 * Run one chat turn through the Claude Code CLI.
 *
 * @param {object} payload
 * @param {string} payload.sessionId           per-turn id (renderer-generated)
 * @param {string} [payload.conversationId]    stable id → enables --resume
 * @param {{role:string,content:string}[]} payload.messages
 * @param {string} [payload.system]
 * @param {string} [payload.modelId]           'default' | 'sonnet' | 'opus' | …
 * @param {string} [payload.effort]            low | medium | high | xhigh | max
 * @param {string} [payload.permission]        ask | writes | allow
 * @param {Electron.WebContents} webContents
 */
async function start(payload, webContents) {
  const {
    sessionId, conversationId, messages,
    system, modelId, effort, permission,
  } = payload || {};

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('sessionId is required');
  }
  if (sessions.has(sessionId)) {
    throw new Error(`session already active: ${sessionId}`);
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }

  const bin = resolveBinary();
  if (!bin) {
    sendEvent(webContents, sessionId, 'error', {
      message: 'Claude Code CLI not found. Install it, then reopen this panel.',
    });
    return;
  }
  if (!readCredentials()) {
    sendEvent(webContents, sessionId, 'error', {
      message: 'Claude Code is not signed in. Run `claude login` in a terminal, then reconnect.',
    });
    return;
  }

  // Resume the CLI-side conversation when we already have its id; that
  // keeps prompt-cache hits and means we only send the new user turn.
  const resumeId = conversationId ? convSessions.get(conversationId) : null;
  const last = messages[messages.length - 1];
  let prompt = (last && last.content) || '';

  // No CLI session to resume but the renderer handed us history (user
  // switched to Claude Code mid-thread, or the app restarted): fold the
  // prior turns into the prompt so context isn't lost.
  if (!resumeId && messages.length > 1) {
    const transcript = messages.slice(0, -1)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');
    prompt = `<conversation_context>\n${transcript}\n</conversation_context>\n\n${prompt}`;
  }

  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionFlag(permission),
  ];
  if (modelId && modelId !== 'default') args.push('--model', modelId);
  if (effort) args.push('--effort', effort);
  if (system) args.push('--append-system-prompt', system);
  if (resumeId) args.push('--resume', resumeId);

  const cwd = workspaceDir();
  args.push('--add-dir', cwd);

  // Strip API-key env vars so the CLI authenticates with the *subscription*
  // (OAuth) and never silently falls back to metered API billing.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  let proc;
  try {
    proc = spawn(bin, args, { cwd, env, windowsHide: true });
  } catch (e) {
    sendEvent(webContents, sessionId, 'error', { message: `Failed to launch Claude Code: ${e?.message || e}` });
    return;
  }

  let stdoutBuf = '';
  let stderrBuf = '';
  let fullText = '';
  let finished = false;
  let aborted = false;
  const seenToolCalls = new Set();

  sessions.set(sessionId, { proc, markAborted: () => { aborted = true; } });

  try { proc.stdin.write(prompt); proc.stdin.end(); }
  catch (_) { /* the CLI may have exited already; close path handles it */ }

  const handleObject = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init' && obj.session_id && conversationId) {
          convSessions.set(conversationId, obj.session_id);
        }
        break;

      case 'rate_limit_event': {
        const info = obj.rate_limit_info;
        if (info && info.rateLimitType) rateLimitWindows[info.rateLimitType] = info;
        break;
      }

      case 'stream_event': {
        const ev = obj.event || {};
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'text_delta' && ev.delta.text) {
            fullText += ev.delta.text;
            sendEvent(webContents, sessionId, 'text-delta', { delta: ev.delta.text });
          }
        }
        break;
      }

      case 'assistant': {
        // Tool calls (Claude Code's own Read/Edit/Bash/… tools). Text is
        // already streamed via stream_event deltas, so only chips here.
        const blocks = (obj.message && obj.message.content) || [];
        for (const b of blocks) {
          if (b && b.type === 'tool_use' && !seenToolCalls.has(b.id)) {
            seenToolCalls.add(b.id);
            sendEvent(webContents, sessionId, 'tool-call', {
              toolName: b.name || 'tool',
              args: b.input || {},
            });
          }
        }
        break;
      }

      case 'user': {
        // Results of the CLI's own tool runs.
        const blocks = (obj.message && obj.message.content) || [];
        for (const b of blocks) {
          if (b && b.type === 'tool_result') {
            sendEvent(webContents, sessionId, 'tool-result', {
              toolName: 'tool',
              result: { ok: !b.is_error },
            });
          }
        }
        break;
      }

      case 'result': {
        finished = true;
        const text = typeof obj.result === 'string' && obj.result ? obj.result : fullText;
        const u = obj.usage || {};
        const totalTokens =
          (u.input_tokens || 0) + (u.output_tokens || 0) +
          (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        sessionTokens += totalTokens;
        sessionCostUsd += Number(obj.total_cost_usd) || 0;
        if (obj.is_error) {
          // A failed --resume usually means the CLI-side session is gone;
          // drop the mapping so the next turn starts a fresh conversation.
          if (resumeId && conversationId) convSessions.delete(conversationId);
          sendEvent(webContents, sessionId, 'error', {
            message: text || obj.api_error_status || 'Claude Code reported an error.',
          });
        } else {
          sendEvent(webContents, sessionId, 'finish', {
            text,
            usage: { totalTokens },
          });
        }
        break;
      }

      default:
        break;
    }
  };

  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      try { handleObject(JSON.parse(line)); }
      catch (_) { /* non-JSON noise — ignore */ }
    }
  });

  proc.stderr.on('data', (chunk) => { stderrBuf += chunk.toString(); });

  proc.on('error', (err) => {
    sessions.delete(sessionId);
    if (!finished) {
      sendEvent(webContents, sessionId, 'error', { message: `Claude Code failed to start: ${err?.message || err}` });
    }
  });

  proc.on('close', (code) => {
    sessions.delete(sessionId);
    if (aborted) {
      sendEvent(webContents, sessionId, 'aborted', { text: fullText });
      return;
    }
    if (finished) return;          // a `result` event already closed the turn
    if (fullText) {
      sendEvent(webContents, sessionId, 'finish', { text: fullText, usage: null });
    } else {
      // Crash before any output — a stale --resume target is the usual
      // cause; clear it so a retry starts clean.
      if (resumeId && conversationId) convSessions.delete(conversationId);
      const msg = stderrBuf.trim() || `Claude Code exited (code ${code}) without a response.`;
      sendEvent(webContents, sessionId, 'error', { message: msg });
    }
  });
}

/** Abort an in-flight turn. Returns true if a process was killed. */
function abort(sessionId) {
  const s = sessions.get(sessionId);
  if (!s || !s.proc) return false;
  if (s.markAborted) s.markAborted();
  try {
    if (process.platform === 'win32' && s.proc.pid) {
      spawn('taskkill', ['/pid', String(s.proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      s.proc.kill('SIGTERM');
    }
  } catch (_) { /* the close handler still fires */ }
  return true;
}

/** Drop the cached CLI-side session for a conversation (e.g. on "new chat"). */
function forgetConversation(conversationId) {
  if (conversationId) convSessions.delete(conversationId);
}

module.exports = { detect, getUsage, start, abort, forgetConversation };
