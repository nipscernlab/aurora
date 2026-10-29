/**
 * main/ai/claude_agent: o motor do Agent SDK da Aurora Intelligence. Aqui so a
 * contencao do turno, que e o que o SDK recebe nas opcoes do query(): o modo
 * de permissao, o que vai pre-aprovado, as configuracoes do disco e as pastas.
 *
 * O SDK e trocado por um falso que anota as opcoes e nao lanca processo
 * nenhum; a ponte MCP tambem e falsa, para nao abrir porta.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const sdk = vi.hoisted(() => ({ chamadas: [], antes: [] }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(({ options }) => {
    sdk.chamadas.push(options);
    return (async function* () {
      yield* sdk.antes;
      yield { type: 'result', subtype: 'success', result: 'pronto', usage: {}, total_cost_usd: 0, session_id: 'sess-1' };
    })();
  }),
}));
const ponte = vi.hoisted(() => ({ falha: null }));
vi.mock('../../main/ai/aurora_mcp_server.js', () => ({
  default: {
    ensureStarted: vi.fn(async () => { if (ponte.falha) throw ponte.falha; return 'http://127.0.0.1:5999/mcp/7'; }),
  },
}));
vi.mock('electron-log', () => ({ default: { info() {}, warn() {}, error() {}, debug() {} } }));

import { tryStart } from '../../main/ai/claude_agent.ts';

const janela = { id: 7, isDestroyed: () => false, send: () => {} };
const host = () => ({
  sendEvent: vi.fn(),
  convSessions: new Map(),
  sessions: new Map(),
  addUsage: vi.fn(),
  setRateLimit: vi.fn(),
  workspaceDir: () => 'C:\\proj',
});
const turno = () => ({
  sessionId: `s-${Math.random()}`,
  messages: [{ role: 'user', content: 'oi' }],
  bin: { exe: 'C:\\fake\\claude.exe', viaShim: false },
});

beforeEach(() => { sdk.chamadas.length = 0; sdk.antes = []; ponte.falha = null; });

describe('claude_agent: resultado de ferramenta', () => {
  it('o envelope MCP vira o texto do chip, so com os blocos de texto', async () => {
    sdk.antes = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__aurora__compile_all', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [
        { type: 'text', text: 'compilou' }, { type: 'image' }, null, { type: 'text', text: 'sem erro' },
      ] }] } },
    ];
    const h = host();
    await tryStart(turno(), janela, h);
    const resultado = h.sendEvent.mock.calls.find((c) => c[2] === 'tool-result');
    expect(resultado[3].result).toEqual({ ok: true, content: 'compilou\nsem erro' });
  });
});

describe('claude_agent: contencao do turno', () => {
  it('dontAsk, so o pre-aprovado, sem configuracao do disco e sem bypass', async () => {
    expect(await tryStart(turno(), janela, host())).toBe(true);
    const [o] = sdk.chamadas;
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.allowedTools).toEqual(['WebFetch', 'WebSearch', 'TodoWrite', 'ToolSearch', 'mcp__aurora']);
    expect(o.settingSources).toEqual([]);
    expect(o.allowDangerouslySkipPermissions).toBeUndefined();
    expect(o.tools).toEqual(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'ToolSearch']);
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
    // As pastas onde Read, Glob e Grep valem: o projeto e os anexos.
    expect(o.additionalDirectories[0]).toBe('C:\\proj');
    expect(o.mcpServers).toEqual({ aurora: { type: 'http', url: 'http://127.0.0.1:5999/mcp/7' } });
  });

  it('sem a ponte MCP, a mesma contencao, so sem o servidor', async () => {
    ponte.falha = new Error('porta ocupada');
    expect(await tryStart(turno(), janela, host())).toBe(true);
    const [o] = sdk.chamadas;
    expect(o.mcpServers).toEqual({});
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.tools).not.toContain('Bash');
  });
});
