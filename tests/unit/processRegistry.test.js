/**
 * main/process_registry: o registro de todo processo que a AURORA dispara e o
 * que os derruba no Cancelar e ao fechar.
 *
 * Nada aqui mata processo de verdade, e isso e garantido um nivel abaixo do
 * utils: o execFile do proprio child_process, por onde passam o taskkill e o
 * PowerShell, e trocado no topo deste arquivo, antes de qualquer modulo
 * carregar, e nunca e restaurado. Tem de ser assim porque o registro e o utils
 * desestruturam o que importam na hora do require: um espiao posto depois
 * (no utils, por exemplo) nao intercepta nada, e a primeira versao deste teste
 * rodou taskkill /F /T e Stop-Process de verdade por causa disso. O process.kill,
 * que o utils usa fora do Windows, tambem e trocado.
 *
 * O beforeAll confere que a troca pegou antes de qualquer teste que mataria
 * alguma coisa: se o utils nao passar pelo execFile falso, o arquivo inteiro
 * falha ali.
 *
 * Como no pylibManagerFluxos.test.js, ha duas copias do state, a do require
 * nativo e a do Vite, e o teste nao sabe qual o registro usa (depende de ele ser
 * .js ou .ts). A copia em uso e descoberta registrando um processo falso e vendo
 * em qual Set ele caiu.
 */

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);

// ── A trava: nenhum taskkill nem PowerShell de verdade ──────────────────────
const cp = req('node:child_process');
/** cada chamada ao execFile falso: [comando, ...args] */
const execs = [];
/** proxima resposta do execFile falso: codigo de saida, ou 'erro' */
let respostaExec = 0;
cp.execFile = (cmd, args) => {
  execs.push([cmd, ...(args || [])]);
  const filho = new EventEmitter();
  filho.kill = () => {};
  setImmediate(() => {
    if (respostaExec === 'erro') filho.emit('error', new Error('falso'));
    else filho.emit('close', respostaExec);
  });
  return filho;
};
process.kill = () => true;

/** O que cada helper do utils pediu, lido das chamadas ao execFile. */
function pedidos() {
  const porPid = [];
  const porNome = [];
  const porCaminho = [];
  for (const [cmd, ...a] of execs) {
    if (cmd === 'taskkill' && a.includes('/PID')) porPid.push(Number(a.at(-1)));
    else if (cmd === 'taskkill' && a.includes('/IM')) porNome.push(a.at(-1));
    else if (cmd === 'powershell.exe') {
      const script = Buffer.from(a.at(-1), 'base64').toString('utf16le');
      porCaminho.push(/\$p = '(.*?)';/.exec(script)[1].replace(/''/g, "'"));
    }
  }
  return { porPid, porNome, porCaminho };
}

async function copias(caminho) {
  const nativo = req(caminho);
  const mod = await import(caminho);
  return [...new Set([nativo, mod.default ?? mod])];
}

/** Um ChildProcess de mentira: so pid, killed e os eventos. */
function falso(pid, extra = {}) {
  const e = new EventEmitter();
  Object.assign(e, { pid, killed: false }, extra);
  return e;
}

let registry;
let state;

beforeAll(async () => {
  // A troca pegou? Nome inventado: se nao tiver pego, o taskkill real nao acha nada.
  for (const u of await copias('../../main/utils.js')) {
    await u.killProcessesByName('aurora-teste-nao-existe.exe');
  }
  if (!execs.some(([c, ...a]) => c === 'taskkill' && a.includes('aurora-teste-nao-existe.exe'))) {
    throw new Error('o execFile falso nao intercepta o utils: parar antes de matar processo de verdade');
  }
});

beforeEach(async () => {
  registry = await import('../../main/process_registry.js');
  execs.length = 0;
  respostaExec = 0;
  // Qual copia do state o registro usa.
  const sonda = falso(1);
  registry.trackChild(sonda);
  state = (await copias('../../main/state.js')).find((s) => s.childProcesses.has(sonda));
  sonda.emit('exit');
  state.childProcesses.clear();
  state.projectTempDirs.clear();
  state.currentVvpProcess = null;
  state.vvpProcessPid = null;
  state.currentGtkwaveProcesses.clear();
});

describe('GROUP', () => {
  it('os tres grupos, congelados', () => {
    expect(registry.GROUP).toEqual({ RUN: 'run', VIEWER: 'viewer', SERVICE: 'service' });
    expect(Object.isFrozen(registry.GROUP)).toBe(true);
  });
});

describe('trackChild', () => {
  it('registra com o grupo SERVICE por padrao e devolve o mesmo filho', () => {
    const c = falso(10);
    expect(registry.trackChild(c)).toBe(c);
    expect(state.childProcesses.has(c)).toBe(true);
    expect(c.__auroraGroup).toBe('service');
  });

  it('sai do registro no primeiro exit, close ou error', () => {
    for (const evento of ['exit', 'close', 'error']) {
      const c = falso(11);
      registry.trackChild(c, registry.GROUP.RUN);
      expect(c.__auroraGroup).toBe('run');
      c.emit(evento, evento === 'error' ? new Error('x') : 0);
      expect(state.childProcesses.has(c), evento).toBe(false);
    }
  });

  it('filho sem pid (o spawn falhou) nao entra', () => {
    const c = falso(undefined);
    expect(registry.trackChild(c)).toBe(c);
    expect(state.childProcesses.has(c)).toBe(false);
    expect(registry.trackChild(null)).toBeNull();
  });
});

describe('spawnTracked', () => {
  it('dispara de verdade, com os pipes, registra e larga quando o processo sai', async () => {
    const c = registry.spawnTracked(process.execPath, ['-e', 'process.stdout.write("oi")'], { windowsHide: true }, registry.GROUP.RUN);
    expect(state.childProcesses.has(c)).toBe(true);
    expect(c.__auroraGroup).toBe('run');
    let saida = '';
    c.stdout.on('data', (d) => { saida += d; });
    await new Promise((r) => c.on('close', r));
    expect(saida).toBe('oi');
    expect(state.childProcesses.has(c)).toBe(false);
  });

  it('com stdio ignore os pipes vem nulos, como no spawn', async () => {
    const c = registry.spawnTracked(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
    expect(c.stdout).toBeNull();
    expect(c.__auroraGroup).toBe('service');
    await new Promise((r) => c.on('close', r));
  });
});

describe('stopToolchainRun (o Cancelar)', () => {
  it('mata por pid so RUN e VIEWER vivos, mais o vvp avulso, e varre as Temps', async () => {
    const run = registry.trackChild(falso(111), registry.GROUP.RUN);
    const viewer = registry.trackChild(falso(112), registry.GROUP.VIEWER);
    const servico = registry.trackChild(falso(222), registry.GROUP.SERVICE);
    const morto = registry.trackChild(falso(113, { killed: true }), registry.GROUP.RUN);
    state.currentVvpProcess = falso(333);
    state.vvpProcessPid = 333;
    state.currentGtkwaveProcesses.add(falso(444));
    state.projectTempDirs.add(path.join('C:', 'proj', '.aurora', 'Temp'));

    const r = await registry.stopToolchainRun();

    expect(r).toEqual({ hadActive: true, killed: 3 });
    const p = pedidos();
    expect(p.porPid).toEqual([111, 112, 333]);
    expect(p.porNome).toEqual(['vvp.exe', 'gtkwave.exe']);
    expect(p.porCaminho).toHaveLength(2);
    expect(p.porCaminho[0].endsWith(`${path.sep}Temp${path.sep}`)).toBe(true);
    expect(p.porCaminho[1]).toBe(path.join('C:', 'proj', '.aurora', 'Temp') + path.sep);

    expect(state.childProcesses.has(run)).toBe(false);
    expect(state.childProcesses.has(viewer)).toBe(false);
    expect(state.childProcesses.has(servico)).toBe(true);
    expect(state.childProcesses.has(morto)).toBe(true);
    expect(state.currentVvpProcess).toBeNull();
    expect(state.vvpProcessPid).toBeNull();
    expect(state.currentGtkwaveProcesses.size).toBe(0);
  });

  it('o vvp avulso que ja estava no registro nao morre duas vezes', async () => {
    const vvp = registry.trackChild(falso(500), registry.GROUP.RUN);
    state.currentVvpProcess = vvp;
    expect(await registry.stopToolchainRun()).toEqual({ hadActive: true, killed: 1 });
    expect(pedidos().porPid).toEqual([500]);
  });

  it('sem nada rodando: nada a cancelar, e nenhuma varredura cara', async () => {
    registry.trackChild(falso(222));
    state.currentVvpProcess = falso(600, { killed: true });
    expect(await registry.stopToolchainRun()).toEqual({ hadActive: false, killed: 0 });
    expect(execs).toEqual([]);
  });
});

describe('stopAllToolchain (ao fechar)', () => {
  it('mata todo filho registrado, servico incluido, e o vvp avulso', async () => {
    registry.trackChild(falso(701), registry.GROUP.RUN);
    registry.trackChild(falso(702), registry.GROUP.SERVICE);
    registry.trackChild(falso(703, { killed: true }));
    state.currentVvpProcess = falso(704);
    state.projectTempDirs.add('D:\\p\\.aurora\\Temp');

    await registry.stopAllToolchain();

    const p = pedidos();
    expect(p.porPid).toEqual([701, 702, 704]);
    expect(state.childProcesses.size).toBe(0);
    expect(state.currentVvpProcess).toBeNull();
    // Algum filho rodou nesta sessao (o proprio teste registrou), entao as
    // varreduras de rede de seguranca rodam.
    expect(p.porNome).toEqual(['vvp.exe', 'gtkwave.exe']);
    expect(p.porCaminho.at(-1)).toBe(`D:\\p\\.aurora\\Temp${path.sep}`);
  });

  it('duas chamadas seguidas dividem a mesma execucao, e a seguinte roda de novo', async () => {
    registry.trackChild(falso(801));
    const a = registry.stopAllToolchain();
    const b = registry.stopAllToolchain();
    expect(b).toBe(a);
    await a;
    expect(pedidos().porPid).toEqual([801]);
    const c = registry.stopAllToolchain();
    expect(c).not.toBe(a);
    await c;
  });
});

describe('reapOrphans', () => {
  it('no Windows varre a pasta de componentes; fora dele nao faz nada', async () => {
    await registry.reapOrphans();
    const p = pedidos();
    if (process.platform === 'win32') {
      expect(p.porCaminho).toHaveLength(1);
      expect(path.isAbsolute(p.porCaminho[0])).toBe(true);
    } else {
      expect(p.porCaminho).toEqual([]);
    }
  });

  it('uma falha na faxina nunca derruba o arranque', async () => {
    respostaExec = 'erro';
    await expect(registry.reapOrphans()).resolves.toBeUndefined();
  });
});
