// @ts-check
/**
 * shell.js — the embedded interactive shell behind the TCMD terminal tab.
 *
 * Backed by a real pseudo-terminal (@lydell/node-pty — a ConPTY-only, prebuilt
 * fork, so there is NO native compilation in dev or when packaging). A true PTY
 * gives the renderer's xterm.js everything a terminal has: inline editing, the
 * shell's own Tab autocomplete, colours, cursor, and resize. `cd`/env persist;
 * python detects a TTY and streams live (PYTHONUNBUFFERED is set as a belt).
 *
 * SECURITY: this runs ARBITRARY commands the human types, so it is a separate,
 * human-only channel — deliberately NOT the toolchain `exec-spec` path and NOT
 * reachable from the AI tool bridge / MCP. The AI never gets a handle to it.
 *
 * Lifecycle: one PTY per session id; killed (which tears down its child tree,
 * e.g. a running `python long.py`, via ConPTY) when the renderer reloads/closes,
 * on restart, and on explicit kill.
 */

'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { ipcMain } = require('electron');
const log = require('electron-log');

// Themed prompt for the TCMD shell (see main/shell/aurora-prompt.ps1) plus a tiny
// JSON file the prompt reads for the app's active-processor segment. The renderer
// keeps the file current via the `shell:context` IPC below.
const PROMPT_SCRIPT = path.join(__dirname, '..', 'shell', 'aurora-prompt.ps1');
const CONTEXT_FILE = path.join(os.tmpdir(), 'aurora-shell', 'context.json');

function ensureContextFile() {
  try {
    fs.mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    if (!fs.existsSync(CONTEXT_FILE)) fs.writeFileSync(CONTEXT_FILE, '{}', 'utf8');
  } catch (err) {
    log.warn('[shell] context file init failed:', err instanceof Error ? err.message : err);
  }
}

/** @type {import('@lydell/node-pty') | null} */
let pty = null;
try {
  pty = require('@lydell/node-pty');
} catch (err) {
  log.error('[shell] node-pty unavailable:', err instanceof Error ? err.message : err);
}

/** @type {Map<string, { proc: any, dispose: () => void }>} */
const sessions = new Map();

/**
 * Trecho de PowerShell que ensina a sessao a alcancar o Python da AURORA.
 *
 * O PROBLEMA QUE ELE RESOLVE SEM CRIAR OUTRO
 * ------------------------------------------
 * O TCMD e um shell de verdade: `python` ali significa o Python que o usuario
 * instalou na maquina, com os pacotes que ele instalou por pip. Isso e desejavel
 * e nao pode ser tomado dele.
 *
 * A tentacao seria exportar PYTHONPATH apontando para o nosso PyLibs. Seria
 * errado: essa variavel e lida por QUALQUER python que rode no terminal,
 * inclusive o do usuario, e as nossas bibliotecas passariam a se misturar com as
 * dele. E exatamente a colisao a evitar.
 *
 * Aqui nao se toca em PATH nem em PYTHONPATH. Define-se:
 *
 *   apython           — invoca SEMPRE o interpretador embarcado. As bibliotecas
 *                       do painel chegam nele por um arquivo `.pth` dentro do
 *                       proprio site-packages dele (ver pylib_paths.js), nunca
 *                       por variavel de ambiente.
 *   Use-Python aurora — faz `python` significar o nosso NESTA sessao, definindo
 *                       uma funcao com esse nome (funcao tem precedencia sobre
 *                       executavel do PATH em PowerShell).
 *   Use-Python system — apaga essa funcao, e `python` volta a ser o do usuario.
 *   Use-Python        — mostra qual esta valendo.
 *
 * O padrao e `system`: o terminal comeca sendo o shell que o usuario espera, e a
 * troca e um ato explicito dele.
 *
 * @param {string} exe caminho do python.exe embarcado ('' se o bundle nao existe)
 */
function pythonBridgeScript(exe) {
  if (!exe) return '';
  const q = exe.replace(/'/g, "''");
  return `
$env:AURORA_PYTHON_EXE = '${q}'
function apython { & $env:AURORA_PYTHON_EXE @args }
# A deteccao usa Get-Command -CommandType Function, e a remocao usa
# 'function:python' SEM o prefixo global: e COM -Force. Medido na pratica:
# 'Remove-Item function:global:python' nao remove nada (e Test-Path continua
# dizendo que existe), o que fazia 'Use-Python system' anunciar a troca sem
# efetua-la — o pior tipo de defeito, porque mente para o usuario.
function Test-AuroraPythonActive {
  [bool](Get-Command python -CommandType Function -ErrorAction SilentlyContinue)
}
function Use-Python {
  param([ValidateSet('aurora','system','')] [string] $Which = '')
  if ($Which -eq 'aurora') {
    Set-Item -Path function:global:python -Value { & $env:AURORA_PYTHON_EXE @args }
    Write-Host 'python -> AURORA (bibliotecas do painel disponiveis)' -ForegroundColor Cyan
  } elseif ($Which -eq 'system') {
    if (Test-AuroraPythonActive) { Remove-Item -LiteralPath 'function:python' -Force }
    Write-Host 'python -> o do sistema (suas bibliotecas do pip)' -ForegroundColor Cyan
  } else {
    if (Test-AuroraPythonActive) { Write-Host 'python -> AURORA' }
    else { Write-Host 'python -> o do sistema' }
    Write-Host 'troque com: Use-Python aurora | Use-Python system' -ForegroundColor DarkGray
    Write-Host 'ou chame o da AURORA direto com: apython script.py' -ForegroundColor DarkGray
  }
}
`.trim();
}

/** Caminho do interpretador embarcado, ou '' se o bundle nao esta instalado. */
function bundledPythonExe() {
  try {
    const { getBundledPythonPath } = require('../compile/python_locator');
    const exe = getBundledPythonPath();
    return fs.existsSync(exe) ? exe : '';
  } catch (_) {
    return '';
  }
}

function shellCommand() {
  if (process.platform === 'win32') {
    const base = ['-NoLogo'];
    // Load the aurora prompt into THIS session only. A -EncodedCommand bootstrap
    // reads the .ps1 as TEXT and dot-sources it as a scriptblock, so (a) the user's
    // global $PROFILE is untouched and (b) it sidesteps the script-file
    // ExecutionPolicy (Restricted/RemoteSigned machines still get the prompt).
    // -NoExit keeps the session interactive after the bootstrap runs.
    const parts = [];
    if (fs.existsSync(PROMPT_SCRIPT)) {
      const q = PROMPT_SCRIPT.replace(/'/g, "''");
      parts.push(`$p = '${q}'; if (Test-Path -LiteralPath $p) { . ([ScriptBlock]::Create((Get-Content -Raw -LiteralPath $p))) }`);
    }
    // A ponte para o Python entra no MESMO bootstrap, pelo mesmo motivo: vale so
    // nesta sessao e nao encosta no $PROFILE do usuario.
    const bridge = pythonBridgeScript(bundledPythonExe());
    if (bridge) parts.push(bridge);

    if (parts.length) {
      const encoded = Buffer.from(parts.join('\n'), 'utf16le').toString('base64');
      base.push('-NoExit', '-EncodedCommand', encoded);
    }
    return { file: 'powershell.exe', args: base };
  }
  return { file: process.env.SHELL || '/bin/bash', args: [] };
}

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { s.dispose(); } catch (_) { /* listeners gone */ }
  try { s.proc.kill(); } catch (_) { /* already dead */ }
}

function register() {
  ensureContextFile();

  /**
   * Start (or restart) a PTY for a session id. Streams `shell:data` { id, data }
   * and, on exit, `shell:exit` { id, code }. Payload: { id?, cwd?, cols?, rows? }.
   */
  ipcMain.handle('shell:start', (event, opts = {}) => {
    if (!pty) return { ok: false, error: 'node-pty indisponível (binário nativo não carregou)' };
    const id = String(opts.id || 'tcmd');
    killSession(id); // clean restart if one is already live

    const { file, args } = shellCommand();
    const cwd = (opts.cwd && typeof opts.cwd === 'string') ? opts.cwd : os.homedir();
    const cols = Number.isFinite(opts.cols) ? Math.max(2, opts.cols | 0) : 80;
    const rows = Number.isFinite(opts.rows) ? Math.max(2, opts.rows | 0) : 24;

    let proc;
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols, rows, cwd,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
          TERM: 'xterm-256color',
          // Where the aurora prompt reads the app's active-processor segment from.
          AURORA_SHELL_CONTEXT: CONTEXT_FILE,
        },
      });
    } catch (err) {
      log.warn('[shell] spawn failed:', err instanceof Error ? err.message : err);
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }

    const wc = event.sender;
    const onData = proc.onData((data) => { if (!wc.isDestroyed()) wc.send('shell:data', { id, data }); });
    const onExit = proc.onExit(({ exitCode }) => {
      if (sessions.get(id)?.proc === proc) sessions.delete(id);
      if (!wc.isDestroyed()) wc.send('shell:exit', { id, code: exitCode });
    });
    const dispose = () => {
      try { onData.dispose(); } catch (_) { /* noop */ }
      try { onExit.dispose(); } catch (_) { /* noop */ }
    };
    sessions.set(id, { proc, dispose });

    // Don't leak the shell (or its python children) if the renderer goes away.
    wc.once('destroyed', () => killSession(id));

    return { ok: true, id, shell: file, cwd, pid: proc.pid };
  });

  /** Feed the user's keystrokes to the PTY. Payload: { id?, data }. */
  ipcMain.handle('shell:input', (_event, payload = {}) => {
    const s = sessions.get(String(payload.id || 'tcmd'));
    if (!s) return { ok: false };
    try { s.proc.write(String(payload.data ?? '')); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err instanceof Error ? err.message : err) }; }
  });

  /** Resize the PTY to match xterm's grid. Payload: { id?, cols, rows }. */
  ipcMain.handle('shell:resize', (_event, payload = {}) => {
    const s = sessions.get(String(payload.id || 'tcmd'));
    if (!s) return { ok: false };
    const cols = Math.max(2, (payload.cols | 0) || 80);
    const rows = Math.max(2, (payload.rows | 0) || 24);
    try { s.proc.resize(cols, rows); return { ok: true }; }
    catch (_) { return { ok: false }; }
  });

  /** Explicitly kill a session. Payload: { id? }. */
  ipcMain.handle('shell:kill', (_event, payload = {}) => {
    killSession(String(payload.id || 'tcmd'));
    return { ok: true };
  });

  /**
   * Update the shell context the aurora prompt reads (currently the active
   * processor). Fire-and-forget from the renderer whenever the value changes;
   * the running prompt re-reads the file on its next render — no terminal noise,
   * no PTY writes. Payload: { processor? }.
   */
  ipcMain.handle('shell:context', (_event, payload = {}) => {
    ensureContextFile();
    const processor = typeof payload.processor === 'string' ? payload.processor : '';
    try {
      fs.writeFileSync(CONTEXT_FILE, JSON.stringify({ processor }), 'utf8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  });
}

module.exports = { register };
