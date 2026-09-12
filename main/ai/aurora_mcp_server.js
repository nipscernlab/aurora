// @ts-check
/**
 * aurora_mcp_server.js: local HTTP MCP server that exposes Aurora's
 * tool manifest to the Claude Code CLI (and any other MCP-aware
 * subscription bridge).
 *
 * Why this exists
 * ---------------
 * The Vercel-AI-SDK chat path (chat.js) plugs `tools.buildTools(...)`
 * into the SDK so the model gets Aurora's function-calling surface
 * (compile_all, set_top_level, select_wave_signals, …). The Claude
 * Code subscription path (claude_code.js) instead spawns the `claude`
 * CLI in print mode, and that CLI only knows about its OWN built-in
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
 * We spin up a fresh Server + transport per request, slightly more
 * allocation than a long-lived session would be, but the call rate
 * is human-driven (a handful per chat turn), so the overhead is
 * negligible, and stateless avoids tracking client sessions.
 *
 * Security
 * --------
 * Bound to 127.0.0.1 on a random ephemeral port. The Host header is
 * re-checked on every request so a browser fetch from a malicious
 * page (DNS rebinding) can't reach the server. On top of that (V7) a
 * 256-bit per-session token is required: it lives in the endpoint PATH
 * (`/mcp/<token>`), and is also accepted as `Authorization: Bearer`.
 * The path form works for ANY MCP client without custom-header support
 * (both the Claude Code and Codex CLIs just consume the URL we hand
 * them), while still defeating a DNS-rebinding web page, which can
 * reach loopback but cannot guess the ephemeral port AND the token.
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const log = require('electron-log');

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const tools = require('./tools');
const toolBridge = require('./tool_bridge');

/** @type {http.Server | null} */
let httpServer = null;
/** @type {string | null} */
let serverUrl = null;
/** @type {string | null} */
let sessionToken = null;
/** @type {Promise<string> | null} */
let starting = null;

/**
 * Resolve the renderer that should execute the tool call.
 *
 * `donoId` e o webContents da janela que PEDIU o turno, carimbado na URL que
 * o agente recebeu (ver ensureStarted). Sem ele, toda ferramenta de todo
 * agente rodava em `state.mainWindow`, que e a janela criada por ultimo: o
 * agente da janela A abria arquivo, compilava e escrevia no projeto da janela
 * B, porque e o renderer dela que resolve o projeto.
 *
 * A reserva existe para o turno que sobrevive ao fechamento da janela que o
 * pediu, e hoje ela so aceita JANELA PRINCIPAL: a lista de todas as janelas
 * do Electron traz tambem a de atualizacao e a do Design Lab, que nao tem
 * AuroraAPI nenhuma e responderiam com erro.
 *
 * @param {number | null} [donoId] webContents.id de quem pediu o turno
 * @returns {Electron.WebContents | null}
 */
function getActiveWebContents(donoId) {
  const janelas = require('../main_windows');
  const viva = (/** @type {any} */ w) => {
    const wc = w && w.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  };

  if (donoId != null) {
    const dona = janelas.todas().find((w) => w.webContents?.id === donoId);
    const wc = viva(dona);
    if (wc) return wc;
  }
  const wc = viva(janelas.principal());
  if (wc) return wc;
  for (const w of janelas.todas()) {
    const outra = viva(w);
    if (outra) return outra;
  }
  return null;
}

/**
 * O `?w=<id>` que `ensureStarted` carimbou na URL do agente, ou null.
 *
 * Vai na busca e nao no caminho para nao mexer na conferencia do token, que
 * compara o caminho inteiro contra `/mcp/<token>`.
 *
 * @param {string | undefined} url
 * @returns {number | null}
 */
function donoDaUrl(url) {
  const busca = String(url || '').split('?')[1];
  if (!busca) return null;
  const m = /(?:^|&)w=(\d+)(?:&|$)/.exec(busca);
  return m ? Number(m[1]) : null;
}

/**
 * Build a fresh MCP server with every Aurora tool registered.
 * @param {number | null} [donoId] janela que pediu o turno; ver getActiveWebContents
 */
function buildMcpServer(donoId) {
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
    const wc = getActiveWebContents(donoId);
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
      // renderer's tool_runner, we just relay.
      const result = await toolBridge.runTool(wc, name, args);
      const text = (() => { try { return JSON.stringify(result); } catch (_) { return String(result); } })();
      return {
        content: [{ type: 'text', text }],
        isError: !!(result && typeof result === 'object' && /** @type {any} */ (result).ok === false),
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }) }],
        isError: true,
      };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return srv;
}

/** Parse the JSON-RPC body of an MCP HTTP request. */
function readRequestBody(/** @type {any} */ req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let oversized = false;
    req.setEncoding('utf8');
    req.on('data', (/** @type {any} */ chunk) => {
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
async function handleMcpRequest(/** @type {any} */ req, /** @type {any} */ res, /** @type {number | null} */ donoId) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32700, message: `parse error: ${e instanceof Error ? e.message : e}` },
      id: null,
    }));
    return;
  }

  const mcpServer = buildMcpServer(donoId);
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
    log.warn('[ai.aurora-mcp] request handler failed:', e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: e instanceof Error ? e.message : 'internal error' },
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
 * `webContents` e a janela que pediu o turno: ela vai carimbada na URL como
 * `?w=<id>`, e e assim que uma ferramenta chamada pelo agente volta a rodar no
 * renderer certo quando ha mais de uma janela aberta.
 *
 * @param {any} [webContents] quem pediu o turno
 * @returns {Promise<string>} URL the CLI can put in `--mcp-config`
 */
function ensureStarted(webContents) {
  const carimbar = (/** @type {string} */ url) => {
    const id = webContents && !webContents.isDestroyed?.() ? webContents.id : null;
    return id == null ? url : `${url}?w=${id}`;
  };
  if (serverUrl) return Promise.resolve(carimbar(serverUrl));
  if (starting) return starting.then(carimbar);

  starting = new Promise((resolve, reject) => {
    // Per-session capability token (V7). Required on every request, either in
    // the path (/mcp/<token>) or as `Authorization: Bearer <token>`.
    sessionToken = crypto.randomBytes(32).toString('hex');
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
      const reqPath = String(req.url || '').split('?')[0];
      // V7: require the session token (path form, or Authorization: Bearer).
      const authHeader = String(req.headers['authorization'] || '');
      const tokenOk =
        reqPath === `/mcp/${sessionToken}` ||
        (reqPath === '/mcp' && authHeader === `Bearer ${sessionToken}`);
      if (!tokenOk) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('unauthorized');
        return;
      }
      // SSE-back-channel (GET) is unsupported in stateless mode, and
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
      handleMcpRequest(req, res, donoDaUrl(req.url)).catch((e) => {
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
      serverUrl = `http://127.0.0.1:${port}/mcp/${sessionToken}`;
      httpServer = srv;
      log.info('[ai.aurora-mcp] listening on', serverUrl);
      starting = null;
      resolve(serverUrl);
    });
  });

  // Carimbada tambem aqui: quem chegou primeiro espera por esta promessa, e
  // a URL sem o `?w=` mandaria as ferramentas dele para a janela errada.
  return starting.then(carimbar);
}

/** Stop the HTTP server (called from before-quit). */
async function stop() {
  if (!httpServer) return;
  const srv = httpServer;
  httpServer = null;
  serverUrl = null;
  sessionToken = null;
  await new Promise((/** @type {(value?: unknown) => void} */ resolve) => {
    try { srv.close(() => resolve()); }
    catch (_) { resolve(); }
  });
}

module.exports = { ensureStarted, stop };
