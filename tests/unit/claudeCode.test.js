/**
 * main/ai/claude_code: a ponte da Aurora Intelligence com a assinatura do
 * Claude Code. Caracterizacao escrita antes da conversao para .ts (e da
 * correcao do CLAUDE_CONFIG_DIR, #181), sobre o .js que existia.
 *
 * Rodado de verdade, o modulo lancaria a CLI do Claude, que gasta a assinatura
 * de quem roda o teste, e mataria processos com taskkill. Tres camadas, todas
 * montadas no topo, antes de o modulo carregar:
 *
 *   1. spawn e execFile do child_process trocados por falsos que so anotam o
 *      pedido. O modulo desestrutura os dois na carga, entao a troca vem antes;
 *   2. o PATH aponta para uma pasta vazia: se a troca falhar, nada e achado;
 *   3. os.homedir e os.tmpdir apontam para uma pasta temporaria, e as
 *      credenciais lidas sao as que o proprio teste escreve.
 *
 * As dependencias que o modulo desestrutura na carga (o localizador da CLI, o
 * spfDoSender) entram pelo cache do require, trocadas antes tambem.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const req = createRequire(import.meta.url);

// ── As tres camadas ──────────────────────────────────────────────────────────
const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-claude-code-'));
const casa = path.join(raiz, 'casa');
const temp = path.join(raiz, 'tmp');
const semNada = path.join(raiz, 'path-vazio');
const projeto = path.join(raiz, 'proj');
for (const d of [casa, temp, semNada, projeto]) fs.mkdirSync(d, { recursive: true });

const pathOriginal = process.env.PATH;
const homedirOriginal = os.homedir;
const tmpdirOriginal = os.tmpdir;
// Com CLAUDE_CONFIG_DIR definido (como na maquina de quem abriu o #181), o
// modulo leria o login de verdade de quem roda o teste.
const configDirOriginal = process.env.CLAUDE_CONFIG_DIR;
delete process.env.CLAUDE_CONFIG_DIR;
process.env.PATH = semNada;
os.homedir = () => casa;
os.tmpdir = () => temp;

/** Um processo filho falso: stdout e stderr que o teste alimenta, stdin anotado. */
function processoFalso() {
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.stderr = new EventEmitter();
  p.entrada = '';
  p.stdin = { write(d) { p.entrada += d; }, end() {} };
  p.pid = 4242;
  p.kill = vi.fn();
  return p;
}

const cp = req('node:child_process');
/** cada spawn: { cmd, args, opcoes, filho } */
const spawns = [];
let spawnLanca = null;
cp.spawn = (cmd, args, opcoes) => {
  if (spawnLanca) throw new Error(spawnLanca);
  const filho = processoFalso();
  spawns.push({ cmd, args, opcoes, filho });
  return filho;
};
/** cada execFile: { cmd, args } */
const execs = [];
let respostaDoExec = { stdout: '2.1.296 (Claude Code)\n' };
cp.execFile = (cmd, args, _opcoes, aoTerminar) => {
  execs.push({ cmd, args });
  setImmediate(() => aoTerminar(respostaDoExec.erro ? new Error(respostaDoExec.erro) : null, respostaDoExec.stdout || ''));
  return new EventEmitter();
};

// ── As dependencias, pelo cache do require ───────────────────────────────────
function injetar(modulo, exports) {
  const caminho = req.resolve(`../../main/${modulo}`);
  req.cache[caminho] = { id: caminho, filename: caminho, loaded: true, exports };
  return exports;
}
const silencio = { info() {}, warn() {}, error() {}, debug() {} };
req.cache[req.resolve('electron-log')] = { id: 'electron-log', loaded: true, exports: silencio };
const local = injetar('ai/cli_locator', { locateClaude: vi.fn(() => null), invalidate: vi.fn() });
const baixador = injetar('ai/cli_downloader', { isDownloadable: vi.fn(() => true), ensureCli: vi.fn() });
const agente = injetar('ai/claude_agent', { tryStart: vi.fn(async () => false) });
const mcp = injetar('ai/aurora_mcp_server', { ensureStarted: vi.fn(async () => 'http://127.0.0.1:5999/mcp/7') });
injetar('ai/attachments',{ buildPromptSuffix: vi.fn(() => ''), ATT_DIR: path.join(temp, 'anexos') });
const caminhos = injetar('ipc/project_paths', { spfDoSender: vi.fn(() => null) });
const estado = injetar('state', { currentOpenProjectPath: null });

let cc;
const eventos = [];
const janela = { id: 7, isDestroyed: () => false, send: (_canal, pkt) => eventos.push(pkt) };
const credenciais = path.join(casa, '.claude', '.credentials.json');

function logar(oauth = { accessToken: 'tok', subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x', expiresAt: Date.now() + 3_600_000 }) {
  fs.mkdirSync(path.dirname(credenciais), { recursive: true });
  fs.writeFileSync(credenciais, JSON.stringify({ claudeAiOauth: oauth }));
}
const deslogar = () => fs.rmSync(credenciais, { force: true });
const tipos = () => eventos.map((e) => e.type);
const ultimo = (tipo) => eventos.filter((e) => e.type === tipo).at(-1);
const linha = (filho, obj) => filho.stdout.emit('data', Buffer.from(`${JSON.stringify(obj)}\n`));

beforeAll(() => {
  cc = req('../../main/ai/claude_code.js');
  // O cercado esta de pe? Senao, parar antes de lancar qualquer coisa.
  if (os.homedir() !== casa || process.env.PATH !== semNada || require_spawn_nao_e_falso()) {
    throw new Error('o cercado do teste nao montou: parar antes de lancar a CLI de verdade');
  }
});
function require_spawn_nao_e_falso() { return req('node:child_process').spawn.toString().indexOf('spawnLanca') < 0; }

afterAll(() => {
  process.env.PATH = pathOriginal;
  if (configDirOriginal !== undefined) process.env.CLAUDE_CONFIG_DIR = configDirOriginal;
  os.homedir = homedirOriginal;
  os.tmpdir = tmpdirOriginal;
  fs.rmSync(raiz, { recursive: true, force: true });
});

beforeEach(() => {
  // Primeiro encerra o que o caso anterior deixou, depois zera as anotacoes.
  cc.killAll();
  vi.clearAllMocks();
  spawns.length = 0;
  execs.length = 0;
  eventos.length = 0;
  spawnLanca = null;
  respostaDoExec = { stdout: '2.1.296 (Claude Code)\n' };
  local.locateClaude.mockReturnValue(null);
  baixador.isDownloadable.mockReturnValue(true);
  agente.tryStart.mockResolvedValue(false);
  mcp.ensureStarted.mockResolvedValue('http://127.0.0.1:5999/mcp/7');
  caminhos.spfDoSender.mockReturnValue(null);
  estado.currentOpenProjectPath = null;
  deslogar();
});

const binario = { exe: 'C:\\fake\\claude.exe', viaShim: false };
const turno = (extra = {}) => ({ sessionId: `s-${Math.random()}`, messages: [{ role: 'user', content: 'oi' }], ...extra });

describe('detect', () => {
  it('sem binario: diz se baixa no primeiro uso e se ja ha login', async () => {
    logar();
    expect(await cc.detect()).toEqual({ installed: false, downloadable: true, authed: true });
    deslogar();
    baixador.isDownloadable.mockReturnValue(false);
    expect(await cc.detect()).toEqual({ installed: false, downloadable: false, authed: false });
  });

  it('com binario: versao, plano e validade do login', async () => {
    local.locateClaude.mockReturnValue(binario);
    logar({ accessToken: 't', subscriptionType: 'pro', rateLimitTier: 'r', expiresAt: 1000 });
    expect(await cc.detect()).toEqual({
      installed: true, path: binario.exe, version: '2.1.296 (Claude Code)',
      authed: true, plan: 'pro', rateLimitTier: 'r', expiresAt: 1000, expired: true,
    });
    expect(execs[0]).toEqual({ cmd: binario.exe, args: ['--version'] });
  });

  it('sem login, ou sem versao: o que der para dizer', async () => {
    local.locateClaude.mockReturnValue(binario);
    respostaDoExec = { erro: 'EINVAL' };
    expect(await cc.detect()).toMatchObject({ installed: true, version: '', authed: false, plan: null, expiresAt: null, expired: false });
  });

  it('credencial ilegivel ou sem claudeAiOauth conta como sem login', async () => {
    fs.mkdirSync(path.dirname(credenciais), { recursive: true });
    fs.writeFileSync(credenciais, '{ quebrado');
    expect((await cc.detect()).authed).toBe(false);
    fs.writeFileSync(credenciais, JSON.stringify({ outra: 1 }));
    expect((await cc.detect()).authed).toBe(false);
  });

  // #181: a CLI guarda o login na pasta do CLAUDE_CONFIG_DIR quando ele existe
  // (e no ~/.claude so quando nao existe); a Aurora olhava sempre o ~/.claude.
  it('com CLAUDE_CONFIG_DIR, o login e o de la, e nao o do ~/.claude', async () => {
    const outra = path.join(raiz, 'config-do-claude');
    fs.mkdirSync(outra, { recursive: true });
    fs.writeFileSync(path.join(outra, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'de-la' } }));
    const antes = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = outra;
      expect((await cc.detect()).authed).toBe(true);
      await cc.start(turno(), janela);
      expect(eventos.some((e) => /not signed in/.test(e.message || ''))).toBe(false);
      // O ~/.claude nao vale com a variavel definida: a CLI tambem nao o le.
      fs.rmSync(path.join(outra, '.credentials.json'));
      logar();
      expect((await cc.detect()).authed).toBe(false);
      // So brancos e o mesmo que nao ter a variavel, como na CLI.
      process.env.CLAUDE_CONFIG_DIR = '   ';
      expect((await cc.detect()).authed).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = antes;
    }
  });

  it('um .cmd roda pelo cmd.exe', async () => {
    local.locateClaude.mockReturnValue({ exe: 'C:\\npm\\claude.cmd', viaShim: true });
    await cc.detect();
    expect(execs[0]).toEqual({ cmd: 'cmd.exe', args: ['/d', '/s', '/c', 'C:\\npm\\claude.cmd', '--version'] });
  });
});

describe('start: antes de rodar', () => {
  it('recusa sem sessao, com sessao repetida e sem mensagem', async () => {
    await expect(cc.start({}, janela)).rejects.toThrow('sessionId is required');
    await expect(cc.start(undefined, janela)).rejects.toThrow('sessionId is required');
    await expect(cc.start({ sessionId: 'x', messages: [] }, janela)).rejects.toThrow('non-empty');
    logar();
    local.locateClaude.mockReturnValue(binario);
    agente.tryStart.mockImplementation(async (_p, _w, ctx) => { ctx.sessions.set('dup', { stop() {} }); return true; });
    await cc.start(turno({ sessionId: 'dup' }), janela);
    await expect(cc.start(turno({ sessionId: 'dup' }), janela)).rejects.toThrow('session already active: dup');
  });

  // #190. Sem Node nao ha `claude` no PATH: o unico executavel e o que a Aurora
  // tem. O aviso da o comando com o caminho dele, e com `auth login`, porque
  // `claude login` nao existe nesta CLI (vira uma pergunta numa sessao nova).
  it('sem login, com a CLI no disco: o comando de login com o caminho dela, sem lancar nada', async () => {
    local.locateClaude.mockReturnValue(binario);
    await cc.start(turno(), janela);
    const msg = ultimo('error').message;
    expect(msg).toMatch(/^Claude Code is not signed in\./);
    expect(msg).toContain('"C:\\fake\\claude.exe" auth login');
    expect(msg).not.toContain('claude login');
    expect(baixador.ensureCli).not.toHaveBeenCalled();
    expect(spawns).toHaveLength(0);
  });

  it('sem login e sem a CLI: baixa, para haver com o que logar, e da o comando do baixado', async () => {
    baixador.ensureCli.mockImplementation(async (_qual, { onProgress }) => { onProgress({ phase: 'download', pct: 10 }); return { exe: 'C:\\aurora\\cli\\claude.exe', viaShim: false }; });
    await cc.start(turno(), janela);
    expect(ultimo('cli-download')).toMatchObject({ pct: 10 });
    expect(local.invalidate).toHaveBeenCalled();
    expect(ultimo('error').message).toContain('"C:\\aurora\\cli\\claude.exe" auth login');
    expect(agente.tryStart).not.toHaveBeenCalled();
    expect(spawns).toHaveLength(0);
  });

  it('sem login, sem a CLI e sem como baixar: o comando generico', async () => {
    baixador.isDownloadable.mockReturnValue(false);
    await cc.start(turno(), janela);
    expect(ultimo('error').message).toContain('`claude auth login`');
  });

  it('sem binario e sem como baixar: avisa', async () => {
    logar();
    baixador.isDownloadable.mockReturnValue(false);
    await cc.start(turno(), janela);
    expect(ultimo('error').message).toMatch(/CLI not found/);
  });

  it('sem binario: baixa, repassa o progresso e segue com o baixado', async () => {
    logar();
    baixador.ensureCli.mockImplementation(async (_qual, { onProgress }) => { onProgress({ phase: 'download', pct: 50 }); return binario; });
    agente.tryStart.mockResolvedValue(true);
    await cc.start(turno(), janela);
    expect(ultimo('cli-download')).toMatchObject({ phase: 'download', pct: 50, cli: 'Claude Code' });
    expect(local.invalidate).toHaveBeenCalled();
    expect(agente.tryStart.mock.calls[0][0].bin).toBe(binario);
  });

  it('o download que falha vira erro', async () => {
    logar();
    baixador.ensureCli.mockRejectedValue(new Error('sem rede'));
    await cc.start(turno(), janela);
    expect(ultimo('error').message).toBe('Could not download Claude Code: sem rede');
  });

  it('janela fechada nao recebe evento, e um send que lanca nao derruba o turno', async () => {
    await cc.start(turno(), { isDestroyed: () => true, send: () => { throw new Error('nunca'); } });
    await cc.start(turno(), { isDestroyed: () => false, send: () => { throw new Error('fechou'); } });
    await cc.start(turno(), null);
  });
});

describe('start: pelo Agent SDK', () => {
  beforeEach(() => { logar(); local.locateClaude.mockReturnValue(binario); });

  it('o SDK recebe o system inteiro e o contexto da ponte, e a sessao ganha dono', async () => {
    let ctx;
    agente.tryStart.mockImplementation(async (_p, _w, c) => { ctx = c; c.sessions.set('a', { stop: vi.fn(), pushUserMessage: vi.fn(() => true) }); return true; });
    await cc.start(turno({ sessionId: 'a', system: 'S', systemFixo: 'F', systemContext: 'C', modelId: 'opus', effort: 'high' }), janela);
    expect(agente.tryStart.mock.calls[0][0]).toMatchObject({ sessionId: 'a', system: 'SFC', modelId: 'opus', effort: 'high' });
    expect(cc.pushUserMessage('a', 'mais')).toBe(true);
    ctx.addUsage(100, 0.5);
    ctx.setRateLimit({ rateLimitType: 'five_hour', utilization: 0.3 });
    expect(cc.getUsage()).toMatchObject({ plan: 'max', windows: [{ rateLimitType: 'five_hour', utilization: 0.3 }] });
    expect(cc.getUsage().session.tokens).toBeGreaterThanOrEqual(100);
    expect(ctx.workspaceDir(janela)).toBe(casa);
  });

  it('sessao do SDK: abort chama stop, e o push que lanca ou falta volta false', async () => {
    const stop = vi.fn();
    agente.tryStart.mockImplementation(async (_p, _w, c) => {
      c.sessions.set('b', { stop, pushUserMessage: () => { throw new Error('fechando'); } });
      c.sessions.set('c', { stop() { throw new Error('ja parou'); } });
      return true;
    });
    await cc.start(turno({ sessionId: 'b' }), janela);
    expect(cc.pushUserMessage('b', 'x')).toBe(false);
    expect(cc.pushUserMessage('c', 'x')).toBe(false);
    expect(cc.pushUserMessage('nenhuma', 'x')).toBe(false);
    expect(cc.abort('b')).toBe(true);
    expect(stop).toHaveBeenCalled();
    expect(cc.abort('c')).toBe(true);
    expect(cc.abort('nenhuma')).toBe(false);
  });

  it('killAll com dono so para as daquela janela', async () => {
    const minha = vi.fn();
    const outra = vi.fn();
    agente.tryStart.mockImplementation(async (p, _w, c) => { c.sessions.set(p.sessionId, { stop: p.sessionId === 'm' ? minha : outra }); return true; });
    await cc.start(turno({ sessionId: 'm' }), janela);
    await cc.start(turno({ sessionId: 'o' }), { ...janela, id: 9 });
    cc.killAll(7);
    expect(minha).toHaveBeenCalled();
    expect(outra).not.toHaveBeenCalled();
    cc.killAll();
    expect(outra).toHaveBeenCalled();
  });

  it('o motor que explode vira erro, sem rodar o turno de novo pela CLI', async () => {
    agente.tryStart.mockRejectedValue(new Error('import falhou'));
    await cc.start(turno(), janela);
    expect(ultimo('error').message).toBe('Claude engine error: import falhou');
    expect(spawns).toHaveLength(0);
  });
});

describe('start: a CLI direto (sem o SDK)', () => {
  beforeEach(() => { logar(); local.locateClaude.mockReturnValue(binario); });

  async function rodar(extra) {
    const p = turno(extra);
    await cc.start(p, janela);
    const s = spawns.findLast((x) => x.cmd !== 'taskkill');
    return { p, s, filho: s?.filho };
  }

  it('argumentos, ambiente sem chave de API e o prompt com as regras da ponte', async () => {
    process.env.ANTHROPIC_API_KEY = 'nao-pode';
    const { s } = await rodar({ modelId: 'sonnet', effort: 'low', system: 'curto' });
    delete process.env.ANTHROPIC_API_KEY;
    expect(s.cmd).toBe(binario.exe);
    expect(s.args.slice(0, 7)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'dontAsk']);
    // So o pre-aprovado passa, e nenhuma configuracao do disco entra.
    expect(s.args[s.args.indexOf('--allowedTools') + 1]).toBe('WebFetch,WebSearch,TodoWrite,ToolSearch,mcp__aurora');
    expect(s.args[s.args.indexOf('--setting-sources') + 1]).toBe('');
    expect(s.args).not.toContain('bypassPermissions');
    expect(s.args).toEqual(expect.arrayContaining(['--model', 'sonnet', '--effort', 'low', '--append-system-prompt', 'curto', '--strict-mcp-config', '--tools', '--disallowed-tools']));
    expect(s.opcoes.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(s.opcoes.env.MCP_TOOL_TIMEOUT).toBeTruthy();
    expect(s.opcoes.cwd).toBe(path.join(temp, 'aurora-ai-cwd'));
    expect(s.args).toEqual(expect.arrayContaining(['--add-dir', casa]));
    const cfg = s.args[s.args.indexOf('--mcp-config') + 1];
    expect(JSON.parse(fs.readFileSync(cfg, 'utf-8')).mcpServers.aurora.url).toBe('http://127.0.0.1:5999/mcp/7');
    expect(s.filho.entrada).toMatch(/^<aurora_mcp_tools>/);
    expect(s.filho.entrada.endsWith('oi')).toBe(true);
  });

  it('system grande vai no corpo do prompt; historico sem sessao vira contexto; o projeto da janela entra em --add-dir', async () => {
    caminhos.spfDoSender.mockReturnValue(path.join(projeto, 'proj.spf'));
    fs.writeFileSync(path.join(projeto, 'proj.spf'), '{}');
    const { s } = await rodar({
      system: 'x'.repeat(3000),
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }],
    });
    expect(s.args).not.toContain('--append-system-prompt');
    expect(s.filho.entrada).toContain('<aurora_system_rules>');
    expect(s.filho.entrada).toContain('<conversation_context>\nUser: a\n\nAssistant: b\n</conversation_context>');
    expect(s.args).toEqual(expect.arrayContaining(['--add-dir', projeto]));
    caminhos.spfDoSender.mockReturnValue(null);
    estado.currentOpenProjectPath = projeto;
    const r = await rodar();
    expect(r.s.args).toEqual(expect.arrayContaining(['--add-dir', projeto]));
    estado.currentOpenProjectPath = path.join(raiz, 'sumiu.spf');
    expect((await rodar()).s.args).toEqual(expect.arrayContaining(['--add-dir', casa]));
  });

  it('sem a ponte MCP, o turno segue sem ela e com as mesmas ferramentas nativas', async () => {
    mcp.ensureStarted.mockRejectedValue(new Error('porta ocupada'));
    const { s } = await rodar();
    expect(s.args).not.toContain('--mcp-config');
    expect(s.filho.entrada).toBe('oi');
    // Antes, a falha da ponte tirava --tools e --disallowed-tools, e o turno
    // ganhava Bash, Write e Edit sem card.
    expect(s.args[s.args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,WebFetch,WebSearch,TodoWrite,ToolSearch');
    expect(s.args[s.args.indexOf('--disallowed-tools') + 1].split(' ')).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write']));
    expect(s.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--permission-mode', 'dontAsk']));
  });

  it('um .cmd roda pelo cmd.exe, e o spawn que lanca vira erro', async () => {
    local.locateClaude.mockReturnValue({ exe: 'C:\\npm\\claude.cmd', viaShim: true });
    const { s } = await rodar();
    expect(s.cmd).toBe('cmd.exe');
    expect(s.args.slice(0, 4)).toEqual(['/d', '/s', '/c', 'C:\\npm\\claude.cmd']);
    spawnLanca = 'EACCES';
    await cc.start(turno(), janela);
    expect(ultimo('error').message).toBe('Failed to launch Claude Code: EACCES');
  });

  it('traduz o stream-json: texto, ferramentas, limite de uso e o fim com tokens', async () => {
    const { p, filho } = await rodar({ conversationId: 'conv' });
    linha(filho, { type: 'system', subtype: 'init', session_id: 'cli-1' });
    linha(filho, { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'weekly', utilization: 0.1 } });
    linha(filho, { type: 'rate_limit_event', rate_limit_info: {} });
    linha(filho, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Ola' } } });
    linha(filho, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta' } } });
    linha(filho, { type: 'stream_event' });
    linha(filho, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file: 'a' } }, { type: 'tool_use', id: 't1', name: 'Read' }, { type: 'tool_use', id: 't2' }] } });
    linha(filho, { type: 'assistant' });
    linha(filho, { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'conteudo' },
      { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'linha' }, { type: 'image' }], is_error: true },
      { type: 'tool_result', content: 7 },
    ] } });
    linha(filho, { type: 'user' });
    filho.stdout.emit('data', Buffer.from('ruido que nao e json\n\n'));
    linha(filho, 'texto solto');
    linha(filho, { type: 'desconhecido' });
    linha(filho, { type: 'result', result: 'Ola!', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 }, total_cost_usd: 0.01 });
    filho.emit('close', 0);
    expect(tipos()).toEqual(['text-delta', 'tool-call', 'tool-call', 'tool-result', 'tool-result', 'tool-result', 'finish']);
    expect(eventos.filter((e) => e.type === 'tool-call').map((e) => e.toolName)).toEqual(['Read', 'tool']);
    const res = eventos.filter((e) => e.type === 'tool-result');
    expect(res[0]).toMatchObject({ toolUseId: 't1', toolName: 'Read', result: { ok: true, content: 'conteudo' } });
    expect(res[1].result).toEqual({ ok: false, content: 'linha', error: 'linha' });
    expect(res[2]).toMatchObject({ toolUseId: null, toolName: 'tool', result: { ok: true, content: '' } });
    expect(ultimo('finish')).toMatchObject({ sessionId: p.sessionId, text: 'Ola!', usage: { totalTokens: 18 } });
    expect(cc.getUsage().windows).toEqual(expect.arrayContaining([expect.objectContaining({ rateLimitType: 'weekly' })]));
    // O turno seguinte da conversa retoma a sessao da CLI, sem repetir as regras.
    const prox = await rodar({ conversationId: 'conv' });
    expect(prox.s.args).toEqual(expect.arrayContaining(['--resume', 'cli-1']));
    expect(prox.filho.entrada).toBe('oi');
    cc.forgetConversation('conv');
    cc.forgetConversation(undefined);
    expect((await rodar({ conversationId: 'conv' })).s.args).not.toContain('--resume');
  });

  it('result com erro avisa e esquece a sessao retomada; sem texto, a mensagem padrao', async () => {
    const um = await rodar({ conversationId: 'c2' });
    linha(um.filho, { type: 'system', subtype: 'init', session_id: 'cli-2' });
    linha(um.filho, { type: 'result', is_error: true, api_error_status: 529 });
    expect(ultimo('error').message).toBe(529);
    const dois = await rodar({ conversationId: 'c2' });
    expect(dois.s.args).toContain('--resume');
    linha(dois.filho, { type: 'result', is_error: true, result: 'sessao sumiu' });
    expect(ultimo('error').message).toBe('sessao sumiu');
    expect((await rodar({ conversationId: 'c2' })).s.args).not.toContain('--resume');
    const tres = await rodar();
    linha(tres.filho, { type: 'result', is_error: true });
    expect(ultimo('error').message).toBe('Claude Code reported an error.');
    linha(tres.filho, { type: 'result', usage: null });
    expect(ultimo('finish')).toMatchObject({ text: '', usage: { totalTokens: 0 } });
  });

  it('fechar sem result: com texto e fim, sem texto e erro (stderr ou codigo)', async () => {
    const a = await rodar();
    linha(a.filho, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'parcial' } } });
    a.filho.emit('close', 0);
    expect(ultimo('finish')).toMatchObject({ text: 'parcial', usage: null });
    const b = await rodar({ conversationId: 'c3' });
    linha(b.filho, { type: 'system', subtype: 'init', session_id: 'cli-3' });
    b.filho.stderr.emit('data', Buffer.from('  falhou feio \n'));
    b.filho.emit('close', 1);
    expect(ultimo('error').message).toBe('falhou feio');
    // So esquece a sessao da CLI quando o turno que caiu era uma retomada.
    const retomada = await rodar({ conversationId: 'c3' });
    expect(retomada.s.args).toContain('--resume');
    retomada.filho.emit('close', 1);
    expect((await rodar({ conversationId: 'c3' })).s.args).not.toContain('--resume');
    const c = await rodar();
    c.filho.emit('close', 3);
    expect(ultimo('error').message).toBe('Claude Code exited (code 3) without a response.');
  });

  it('abortar: taskkill na arvore e o evento aborted com o texto que havia', async () => {
    const { p, filho } = await rodar();
    linha(filho, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'meio' } } });
    expect(cc.abort(p.sessionId)).toBe(true);
    expect(spawns.at(-1)).toMatchObject({ cmd: 'taskkill', args: ['/pid', '4242', '/T', '/F'] });
    filho.emit('close', 1);
    expect(ultimo('aborted')).toMatchObject({ text: 'meio' });
  });

  it('erro do processo vira erro, e nao repete se o turno ja tinha fechado', async () => {
    const { filho } = await rodar();
    filho.emit('error', new Error('ENOENT'));
    expect(ultimo('error').message).toBe('Claude Code failed to start: ENOENT');
    const dois = await rodar();
    linha(dois.filho, { type: 'result', result: 'ok' });
    const antes = eventos.length;
    dois.filho.emit('error', 'tarde');
    expect(eventos).toHaveLength(antes);
  });

  it('silencio sem ferramenta em voo: mata a CLI e avisa que parou de responder', async () => {
    vi.useFakeTimers();
    try {
      const { filho } = await rodar();
      // Com uma ferramenta em voo, o relogio nao corre.
      linha(filho, { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'lenta', name: 'compile' }] } });
      await vi.advanceTimersByTimeAsync(150_000);
      expect(spawns.some((x) => x.cmd === 'taskkill')).toBe(false);
      linha(filho, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'lenta', content: 'ok' }] } });
      await vi.advanceTimersByTimeAsync(150_000);
      expect(spawns.at(-1).cmd).toBe('taskkill');
      filho.emit('close', 1);
      expect(ultimo('error').message).toBe('Claude Code stopped responding (no output). Please try again.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('stdin que ja fechou nao derruba o turno', async () => {
    const original = cp.spawn;
    cp.spawn = (cmd, args, opcoes) => {
      const r = original(cmd, args, opcoes);
      r.filho = r;
      r.stdin.write = () => { throw new Error('EPIPE'); };
      return r;
    };
    try {
      await cc.start(turno(), janela);
      expect(spawns).toHaveLength(1);
    } finally {
      cp.spawn = original;
    }
  });
});

describe('fora do Windows', () => {
  it('parar uma sessao da CLI usa SIGTERM, e uma sessao sem nada para parar devolve false', async () => {
    logar();
    local.locateClaude.mockReturnValue(binario);
    const plataforma = Object.getOwnPropertyDescriptor(process, 'platform');
    await cc.start(turno({ sessionId: 'l' }), janela);
    const filho = spawns.at(-1).filho;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      expect(cc.abort('l')).toBe(true);
      expect(filho.kill).toHaveBeenCalledWith('SIGTERM');
      filho.kill.mockImplementation(() => { throw new Error('ja morreu'); });
      await cc.start(turno({ sessionId: 'l2' }), janela);
      spawns.at(-1).filho.kill = filho.kill;
      expect(cc.abort('l2')).toBe(true);
    } finally {
      Object.defineProperty(process, 'platform', plataforma);
    }
    agente.tryStart.mockImplementation(async (_p, _w, c) => { c.sessions.set('vazia', {}); return true; });
    await cc.start(turno({ sessionId: 'vazia' }), janela);
    expect(cc.abort('vazia')).toBe(false);
  });
});
