// @ts-check
/**
 * aurora_mcp_server.js — local HTTP MCP server that exposes Aurora's
 * tool manifest to the Claude Code CLI (and any other MCP-aware
 * subscription bridge).
 *
 * Why this exists
 * ---------------
 * The Vercel-AI-SDK chat path (chat.js) plugs `tools.buildTools(...)`
 * into the SDK so the model gets Aurora's function-calling surface
 * (compile_all, set_top_level, select_wave_signals, …). The Claude
 * Code subscription path (claude_code.js) instead spawns the `claude`
 * CLI in print mode — and that CLI only knows about its OWN built-in
 * tools (Read/Edit/Bash/…). Without a bridge, the model falls back to
 * shelling out (PowerShell → cmmcomp.exe / iverilog / gtkwave), which
 * defeats Aurora's compilation pipeline and ignores its terminals,
 * ask-before-write flow, audit log, and waveform configuration.
 *
 * This module fixes that: it stands up a localhost HTTP MCP server
 * inside the Electron main process, registers every entry from
 * `tools.TOOL_MANIFEST` as an MCP tool, and forwards each call back
 * through `tool_bridge.runTool` to the same renderer/AuroraAPI surface
 * the SDK path uses. The Claude Code CLI is then handed an
 * `--mcp-config` file that points at this server, so Aurora's tools
 * show up to Claude Code as `mcp__aurora__<toolName>`.
 *
 * Transport
 * ---------
 * Streamable HTTP, stateless mode (`sessionIdGenerator: undefined`).
 * We spin up a fresh Server + transport per request — slightly more
 * allocation than a long-lived session would be, but the call rate
 * is human-driven (a handful per chat turn), so the overhead is
 * negligible, and stateless avoids tracking client sessions.
 *
 * Security
 * --------
 * Bound to 127.0.0.1 on a random ephemeral port. The Host header is
 * re-checked on every request so a browser fetch from a malicious
 * page (DNS rebinding) can't reach the server. No auth beyond that —
 * the loopback bind + Host check is the trust boundary, consistent
 * with how the Claude Code CLI itself trusts localhost MCP servers.
 */

'use strict';

const http = require('http');
const log = require('electron-log');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const tools = require('./tools');
const toolBridge = require('./tool_bridge');
const state = require('../state');

/** @type {http.Server | null} */
let httpServer = null;
/** @type {string | null} */
let serverUrl = null;
/** @type {Promise<string> | null} */
let starting = null;

/**
 * Resolve the renderer that should execute the tool call. Aurora keeps
 * the chat panel inside `state.mainWindow`; if the user closed it
 * mid-turn we fall back to the most-recently-focused BrowserWindow so
 * the call can still land somewhere sensible instead of dying.
 *
 * @returns {Electron.WebContents | null}
 */
function getActiveWebContents() {
  const main = state.mainWindow;
  if (main && !main.isDestroyed()) {
    const wc = main.webContents;
    if (wc && !wc.isDestroyed()) return wc;
  }
  try {
    const { BrowserWindow } = require('electron');
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && !focused.isDestroyed()) {
      const wc = focused.webContents;
      if (wc && !wc.isDestroyed()) return wc;
    }
    const all = BrowserWindow.getAllWindows();
    for (const w of all) {
      if (w && !w.isDestroyed() && w.webContents && !w.webContents.isDestroyed()) {
        return w.webContents;
      }
    }
  } catch (_) { /* electron not ready yet */ }
  return null;
}

/** Build a fresh MCP server with every Aurora tool registered. */
function buildMcpServer() {
  const srv = new Server(
    { name: 'aurora', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.TOOL_MANIFEST.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  srv.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const name = req?.params?.name;
    const args = req?.params?.arguments || {};
    const def = tools.TOOL_MANIFEST.find((t) => t.name === name);
    if (!def) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `unknown tool: ${name}` }) }],
        isError: true,
      };
    }
    const wc = getActiveWebContents();
    if (!wc) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Aurora window is not available' }) }],
        isError: true,
      };
    }

    // Keep-alive heartbeat. Some tools block on a deliberate human answer
    // (ask_user_question's inline card) for minutes; the CLI's MCP client
    // would otherwise time the request out and the answer would never get
    // back, which is why ask_user_question "always failed". If the client
    // attached a progressToken, drip `notifications/progress` every ~10s so
    // it resets its read timeout until the tool actually resolves.
    const progressToken = req?.params?._meta?.progressToken;
    let heartbeat = null;
    if (progressToken != null && extra && typeof extra.sendNotification === 'function') {
      let ticks = 0;
      heartbeat = setInterval(() => {
        extra.sendNotification({
          method: 'notifications/progress',
          params: { progressToken, progress: ++ticks, message: `Aurora: ${name} still running…` },
        }).catch(() => { /* client went away; the close handler tears down */ });
      }, 10_000);
    }

    try {
      // Same one-way trip the SDK chat loop uses: ask-before-write,
      // audit logging, and final AuroraAPI dispatch all live in the
      // renderer's tool_runner — we just relay.
      const result = await toolBridge.runTool(wc, name, args);
      const text = (() => { try { return JSON.stringify(result); } catch (_) { return String(result); } })();
      return {
        content: [{ type: 'text', text }],
        isError: !!(result && typeof result === 'object' && result.ok === false),
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e?.message || String(e) }) }],
        isError: true,
      };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return srv;
}

/** Parse the JSON-RPC body of an MCP HTTP request. */
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let oversized = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (oversized) return;
      buf += chunk;
      if (buf.length > 4_000_000) {
        oversized = true;
        reject(new Error('request body too large (>4MB)'));
        try { req.destroy(); } catch (_) { /* ignore */ }
      }
    });
    req.on('end', () => {
      if (oversized) return;
      if (!buf) return resolve(undefined);
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** Serve one POST /mcp call. */
async function handleMcpRequest(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32700, message: `parse error: ${e?.message || e}` },
      id: null,
    }));
    return;
  }

  const mcpServer = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  // Tear down the per-request server+transport whichever way the
  // response ends (client hang-up, normal close, error).
  const teardown = () => {
    Promise.resolve().then(() => transport.close()).catch(() => {});
    Promise.resolve().then(() => mcpServer.close()).catch(() => {});
  };
  res.on('close', teardown);

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    log.warn('[ai.aurora-mcp] request handler failed:', e?.message || e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: e?.message || 'internal error' },
        id: body?.id ?? null,
      }));
    }
  }
}

/**
 * Lazily start the HTTP server. Idempotent: returns the cached URL on
 * subsequent calls, and dedupes concurrent calls during startup so we
 * don't bind two ports.
 *
 * @returns {Promise<string>} URL the CLI can put in `--mcp-config`
 */
function ensureStarted() {
  if (serverUrl) return Promise.resolve(serverUrl);
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      // Loopback-only. The bind to 127.0.0.1 already restricts the
      // socket, but the Host header check defends against DNS
      // rebinding (a browser tab on this machine resolving an
      // attacker-controlled hostname back to 127.0.0.1).
      const host = String(req.headers.host || '').split(':')[0].toLowerCase();
      if (host !== '127.0.0.1' && host !== 'localhost') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('forbidden');
        return;
      }
      const url = String(req.url || '').split('?')[0];
      if (url !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      // SSE-back-channel (GET) is unsupported in stateless mode — and
      // we don't push notifications anyway. Same for DELETE (session
      // termination). 405 with the Allow header is the polite reply.
      if (req.method && req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'method not allowed' },
          id: null,
        }));
        return;
      }
      handleMcpRequest(req, res).catch((e) => {
        log.warn('[ai.aurora-mcp] request crashed:', e?.message || e);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });

    srv.on('error', (err) => {
      starting = null;
      log.error('[ai.aurora-mcp] failed to bind:', err?.message || err);
      reject(err);
    });

    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      if (!port) {
        starting = null;
        reject(new Error('MCP server failed to obtain a port'));
        return;
      }
      serverUrl = `http://127.0.0.1:${port}/mcp`;
      httpServer = srv;
      log.info('[ai.aurora-mcp] listening on', serverUrl);
      starting = null;
      resolve(serverUrl);
    });
  });

  return starting;
}

/** Stop the HTTP server (called from before-quit). */
async function stop() {
  if (!httpServer) return;
  const srv = httpServer;
  httpServer = null;
  serverUrl = null;
  await new Promise((resolve) => {
    try { srv.close(() => resolve()); }
    catch (_) { resolve(); }
  });
}

/** Current URL, or null if the server has not been started yet. */
function getUrl() { return serverUrl; }

module.exports = { ensureStarted, stop, getUrl };
