// @vitest-environment happy-dom
//
// A analise de .asm do SAPHO: a parte pura (js/compilation/analise_asm) e o
// invólucro que acha e le o arquivo (js/api/analise_asm_ns).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { analisarAsm } from '../../js/compilation/analise_asm.js';

const OPCODES = [
  { mnemonic: 'LOD', family: 'mem' },
  { mnemonic: 'ADD', family: 'alu' },
  { mnemonic: 'JMP', family: 'ctrl' },
  { mnemonic: 'JIZ', family: 'ctrl' },
  { mnemonic: 'CAL', family: 'ctrl' },
];

const ASM = [
  '#PRNAME proc',
  '// comentario inteiro',
  '@main @L1 LOD 1',
  'ADD 2   // comentario no fim',
  '@L2',
  'fmul 3',
  'XYZ 1',
  'JIZ L2',
  'JMP L1',
  'CAL fim',
  'JMP 123',
  '@fim',
  '@',
].join('\n');

describe('analisarAsm', () => {
  it('conta instrucoes por opcode e familia, e marca o desconhecido', () => {
    const a = analisarAsm(ASM, OPCODES);
    expect(a.total).toBe(7);
    expect(a.byOpcode).toEqual({ LOD: 1, ADD: 1, XYZ: 1, JIZ: 1, JMP: 2, CAL: 1 });
    expect(a.byFamily).toEqual({ mem: 1, alu: 1, other: 1, ctrl: 4 });
    expect(a.unknownMnemonics).toEqual(['XYZ']);
  });

  it('acha os rotulos, varios numa linha, e os lacos (saltos para tras), maior primeiro', () => {
    const a = analisarAsm(ASM, OPCODES);
    expect(a.labels).toEqual([
      { name: 'main', line: 3 }, { name: 'L1', line: 3 }, { name: 'L2', line: 5 }, { name: 'fim', line: 12 },
    ]);
    expect(a.loops).toEqual([
      { label: 'L1', labelLine: 3, branchLine: 9, branchMnemonic: 'JMP', bodyInstructions: 6 },
      { label: 'L2', labelLine: 5, branchLine: 8, branchMnemonic: 'JIZ', bodyInstructions: 3 },
    ]);
  });

  it('rotulo repetido vale o primeiro; salto para rotulo que nao existe nao e laco', () => {
    const a = analisarAsm('@A LOD 1\n@A LOD 2\nJMP A\nJMP B', OPCODES);
    expect(a.loops).toEqual([{ label: 'A', labelLine: 1, branchLine: 3, branchMnemonic: 'JMP', bodyInstructions: 2 }]);
  });

  it('sem tabela, todo mnemonico em maiusculas conta e sai como desconhecido, uma vez cada', () => {
    const a = analisarAsm('LOD 1\nLOD 2\nADD 3');
    expect(a.total).toBe(3);
    expect(a.byFamily).toEqual({ other: 3 });
    expect(a.unknownMnemonics).toEqual(['LOD', 'ADD']);
  });
});

// ------------------------------------------------------------------ invólucro

const disco = new Map();
const electronAPI = { readFile: vi.fn(async (p) => { if (!disco.has(p)) throw new Error('ENOENT'); return disco.get(p); }) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const modelos = new Map();
vi.mock('../../js/editor/shared_models.js', () => ({ SharedModelRegistry: { getModel: (p) => modelos.get(p) ?? null } }));
const foco = { caminho: null };
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { getEditingFilePath: () => foco.caminho } }));
const regras = { valor: { asm: { opcodes: OPCODES } } };
vi.mock('../../js/api/rules_ns.js', () => ({ loadRules: async () => regras.valor }));

describe('analyzeAsm', () => {
  let ns;
  let ProjectStore;
  const msg = (r) => r.error?.message;

  beforeEach(async () => {
    vi.resetModules();
    disco.clear();
    modelos.clear();
    foco.caminho = null;
    regras.valor = { asm: { opcodes: OPCODES } };
    ({ ProjectStore } = await import('../../js/project/project_store.js'));
    ({ analiseDoAsm: ns } = await import('../../js/api/analise_asm_ns.js'));
    ProjectStore.setProject('C:\\p\\p.spf', 'C:\\p');
    disco.set('C:\\p\\P\\Software\\P.asm', 'LOD 1\nADD 2');
  });

  it('pelo processador, pelo caminho relativo, ou pelo arquivo em foco', async () => {
    expect((await ns.analyzeAsm({ processorName: 'P' })).data).toMatchObject({ filePath: 'C:\\p\\P\\Software\\P.asm', total: 2 });
    expect((await ns.analyzeAsm({ filePath: '\\P\\Software\\P.asm' })).data.filePath).toBe('C:\\p\\P\\Software\\P.asm');
    foco.caminho = 'C:\\p\\P\\Software\\P.asm';
    expect((await ns.analyzeAsm()).data.total).toBe(2);
  });

  it('o arquivo aberto e analisado pelo buffer, com o que nao foi salvo', async () => {
    modelos.set('C:\\p\\P\\Software\\P.asm', { getValue: () => 'LOD 1' });
    expect((await ns.analyzeAsm({ processorName: 'P' })).data.total).toBe(1);
  });

  it('sem tabela de regras, analisa do mesmo jeito', async () => {
    regras.valor = null;
    expect((await ns.analyzeAsm({ processorName: 'P' })).data.unknownMnemonics).toEqual(['LOD', 'ADD']);
  });

  it('as recusas', async () => {
    expect(msg(await ns.analyzeAsm())).toMatch(/active file is not .asm/);
    foco.caminho = 'C:\\p\\top.v';
    expect(msg(await ns.analyzeAsm())).toMatch(/active file is not .asm/);
    expect(msg(await ns.analyzeAsm({ filePath: '..\\x.asm' }))).toBe('path must not contain ".."');
    expect(msg(await ns.analyzeAsm({ filePath: 'D:\\x.asm' }))).toBe('file is outside the open project folder');
    expect(msg(await ns.analyzeAsm({ filePath: 'sumiu.asm' }))).toBe('File not found: "C:\\p\\sumiu.asm"');
    ProjectStore.clearProject();
    expect(msg(await ns.analyzeAsm({ processorName: 'P' }))).toBe('No project open');
  });

  it('sem projeto, um caminho absoluto ainda e lido', async () => {
    ProjectStore.clearProject();
    disco.set('D:\\x.asm', 'JMP 1');
    expect((await ns.analyzeAsm({ filePath: 'D:\\x.asm' })).data.total).toBe(1);
    electronAPI.readFile.mockResolvedValueOnce(null);
    expect((await ns.analyzeAsm({ filePath: 'D:\\y.asm' })).data.total).toBe(0);
  });
});
