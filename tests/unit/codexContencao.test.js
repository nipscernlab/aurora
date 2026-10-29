/**
 * A contencao dos turnos do Codex (o provedor ChatGPT), nos dois motores:
 * main/ai/codex_agent (o SDK) e main/ai/codex_cli (a CLI direto). O shell do
 * Codex roda num sandbox read-only, sem rede, com o sandbox do Windows ligado
 * pela propria AURORA, e o servidor MCP dela aprovado para rodar sem
 * pergunta. Antes de 29/10/2026 era --dangerously-bypass-approvals-and-sandbox.
 *
 * Nenhum processo de verdade nasce: o SDK e o child_process sao falsos, e o
 * spawn falso so anota o pedido. O teste nunca mata processo (o taskkill do
 * modulo cai no mesmo spawn falso).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ construidos: [], threads: [] }));
vi.mock('@openai/codex-sdk', () => ({
  Codex: class {
    constructor(opcoes) { sdk.construidos.push(opcoes); }
    startThread(opcoes) { return this.thread('start', opcoes); }
    resumeThread(id, opcoes) { return this.thread('resume', opcoes, id); }
    thread(como, opcoes, id) {
      sdk.threads.push({ como, opcoes, id });
      return {
        id: 'th-1',
        runStreamed: async () => ({
          events: (async function* () {
            yield { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
          })(),
        }),
      };
    }
  },
}));

const filhos = vi.hoisted(() => []);
vi.mock('node:child_process', async () => {
  const { EventEmitter: Emissor } = await import('node:events');
  const spawn = vi.fn((cmd, args, opcoes) => {
    const p = new Emissor();
    p.stdout = new Emissor();
    p.stderr = new Emissor();
    p.stdin = { write() {}, end() {} };
    p.pid = 4242;
    p.kill = vi.fn();
    filhos.push({ cmd, args, opcoes, p });
    return p;
  });
  const execFile = vi.fn((_c, _a, _o, cb) => { setImmediate(() => cb(null, 'codex-cli 0.163.0\n')); return new Emissor(); });
  return { default: { spawn, execFile }, spawn, execFile };
});

const ponte = vi.hoisted(() => ({ falha: null }));
vi.mock('../../main/ai/aurora_mcp_server.js', () => ({
  default: {
    ensureStarted: vi.fn(async () => { if (ponte.falha) throw ponte.falha; return 'http://127.0.0.1:5999/mcp/7'; }),
  },
}));
vi.mock('electron-log', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }));
const motor = vi.hoisted(() => ({ usarSdk: false }));
vi.mock('../../main/ai/cli_locator.js', () => ({
  default: { locateCodex: () => ({ exe: 'C:\\fake\\codex.exe', rgDir: null, viaShim: false }), invalidate() {} },
}));
vi.mock('../../main/ai/cli_downloader.js', () => ({ default: { isDownloadable: () => false, ensureCli: vi.fn() } }));

// Login falso: o modulo so confere que o auth.json existe e e JSON.
const casaDoCodex = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-codex-home-'));
fs.writeFileSync(path.join(casaDoCodex, 'auth.json'), '{}');
const codexHomeOriginal = process.env.CODEX_HOME;
process.env.CODEX_HOME = casaDoCodex;
afterAll(() => {
  if (codexHomeOriginal === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexHomeOriginal;
  fs.rmSync(casaDoCodex, { recursive: true, force: true });
});

const agente = await import('../../main/ai/codex_agent.ts');
const tryStartReal = agente.tryStart;
vi.spyOn(agente, 'tryStart').mockImplementation((...a) => (motor.usarSdk ? tryStartReal(...a) : Promise.resolve(false)));
const cli = await import('../../main/ai/codex_cli.ts');

const janela = { id: 7, isDestroyed: () => false, send: () => {} };
const turno = (extra = {}) => ({ sessionId: `s-${Math.random()}`, messages: [{ role: 'user', content: 'oi' }], ...extra });

beforeEach(() => {
  sdk.construidos.length = 0;
  sdk.threads.length = 0;
  filhos.length = 0;
  ponte.falha = null;
  motor.usarSdk = false;
});

/** Os pares `-c valor` de uma linha de argumentos. */
const configs = (args) => args.flatMap((a, i) => (a === '-c' ? [args[i + 1]] : []));

describe('codex_cli: a CLI direto', () => {
  async function rodar(extra) {
    await cli.start(turno(extra), janela);
    const s = filhos.findLast((f) => f.cmd !== 'taskkill');
    s.p.emit('close', 0);
    return s;
  }

  it('sandbox read-only, sandbox do Windows, aprovacao so do MCP e nada de bypass', async () => {
    const s = await rodar();
    expect(s.cmd).toBe('C:\\fake\\codex.exe');
    expect(s.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(cli.CONFIG_DE_CONTENCAO).toEqual(['sandbox_mode="read-only"', 'approval_policy="never"', 'windows.sandbox="unelevated"']);
    expect(configs(s.args)).toEqual(expect.arrayContaining([
      ...cli.CONFIG_DE_CONTENCAO,
      'mcp_servers.aurora.url="http://127.0.0.1:5999/mcp/7"',
      'mcp_servers.aurora.default_tools_approval_mode="approve"',
    ]));
  });

  it('a conversa retomada recebe a mesma contencao, por -c, que o resume aceita', async () => {
    // O primeiro turno da conversa grava o thread; o segundo o retoma.
    const primeiro = turno({ conversationId: 'c-1' });
    await cli.start(primeiro, janela);
    const a = filhos.at(-1);
    a.p.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'thread.started', thread_id: 'th-9' })}\n`));
    a.p.emit('close', 0);
    const s = await rodar({ conversationId: 'c-1' });
    expect(s.args.slice(0, 3)).toEqual(['exec', 'resume', 'th-9']);
    expect(configs(s.args)).toEqual(expect.arrayContaining(cli.CONFIG_DE_CONTENCAO));
    expect(s.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('sem a ponte MCP, a contencao fica e so o servidor sai', async () => {
    ponte.falha = new Error('porta ocupada');
    const s = await rodar();
    expect(configs(s.args)).toEqual(expect.arrayContaining(cli.CONFIG_DE_CONTENCAO));
    expect(configs(s.args).some((c) => c.startsWith('mcp_servers.'))).toBe(false);
  });
});

describe('codex_agent: o SDK', () => {
  it('thread read-only, sem aprovacao interativa; config com o sandbox do Windows e o MCP aprovado', async () => {
    motor.usarSdk = true;
    await cli.start(turno(), janela);
    expect(sdk.threads).toHaveLength(1);
    expect(sdk.threads[0].opcoes).toEqual(expect.objectContaining({ sandboxMode: 'read-only', approvalPolicy: 'never' }));
    const { config, codexPathOverride } = sdk.construidos[0];
    expect(codexPathOverride).toBe('C:\\fake\\codex.exe');
    expect(config.windows).toEqual({ sandbox: 'unelevated' });
    expect(config.mcp_servers.aurora).toEqual(expect.objectContaining({
      url: 'http://127.0.0.1:5999/mcp/7', default_tools_approval_mode: 'approve',
    }));
    expect(filhos.filter((f) => f.cmd !== 'taskkill')).toEqual([]);
  });

  it('sem a ponte MCP, o sandbox continua', async () => {
    motor.usarSdk = true;
    ponte.falha = new Error('porta ocupada');
    await cli.start(turno(), janela);
    expect(sdk.threads[0].opcoes.sandboxMode).toBe('read-only');
    expect(sdk.construidos[0].config).toEqual({ windows: { sandbox: 'unelevated' } });
  });
});

// Nenhum processo de verdade: o spawn e o falso deste arquivo.
it('o spawn usado pelo modulo e o falso', async () => {
  const cp = await import('node:child_process');
  expect(vi.isMockFunction(cp.spawn)).toBe(true);
  expect(EventEmitter).toBeTypeOf('function');
});
