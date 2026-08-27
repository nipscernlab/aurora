// @vitest-environment happy-dom
/**
 * O portão de componentes antes de compilar.
 *
 * O que ele resolve: sem checagem prévia, a compilação arrancava, rodava o que
 * conseguia e morria no meio quando o allowlist do processo principal recusava
 * um binário ausente. O aviso existia, mas só como diálogo disparado lá do
 * fundo, e diálogo se fecha; o terminal, onde a pessoa está olhando quando
 * aperta Compilar, ficava em silêncio.
 *
 * O teste é aqui e não numa captura de tela porque o estado que ele cobre (uma
 * máquina SEM a cadeia de compilação) é exatamente o que não existe na máquina
 * de quem desenvolve, e é o estado do aluno no primeiro dia.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** O pt.json do repositório, para o teste falar a mesma língua do aplicativo. */
const PT = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'locales', 'pt.json'), 'utf8'));

const electronAPI = { componentesListar: vi.fn() };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));

const linhas = [];
const tm = { appendToTerminal: vi.fn((terminal, texto, tipo) => linhas.push({ terminal, texto, tipo })) };

beforeEach(() => {
  vi.clearAllMocks();
  linhas.length = 0;
  globalThis.window = globalThis.window || {};
  window.globalTerminalManager = tm;
  // O i18n de VERDADE, lendo o pt.json do repositório e interpolando como o
  // aplicativo interpola. Um `window.t` de mentira aqui esconderia justamente
  // a classe de erro que este teste pegou: as chaves do projeto são DUPLAS
  // ({{nome}}), e uma string escrita com chave simples atravessa o teste, o
  // lint e o check-i18n, e só aparece na tela do usuário como "{nome}".
  window.t = (chave, params) => {
    const bruto = chave.split('.').reduce((o, k) => (o == null ? o : o[k]), PT);
    if (typeof bruto !== 'string') return chave;
    return params
      ? bruto.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''))
      : bruto;
  };
});

// O compilation_flow arrasta o módulo de compilação, o gerenciador de abas e o
// terminal no import; todos entram como espião para o teste alcançar o portão
// de verdade, e não uma cópia dele.
vi.mock('../../js/compilation/compilation_module.js', () => ({ CompilationModule: class {} }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { getEditingFilePath: () => null } }));
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal: vi.fn() }));
vi.mock('../../js/compilation/command_overrides.js', () => ({ resolveOverride: vi.fn() }));
vi.mock('../../js/wave/simulator_preference.js', () => ({ getSimulator: () => 'iverilog' }));
vi.mock('../../js/project/active_processor.js', () => ({ getActiveProcessorName: () => null }));
vi.mock('../../js/utils/path_utils.js', () => ({ toForwardSlashes: (x) => x }));

const { exigirComponentesDeCompilacao: exigir } =
  await import('../../js/compilation/compilation_flow.js');

const comp = (o = {}) => ({
  nome: 'MSYS Toolchain', instalado: false, requerParaCompilar: true, downloadMB: 272, ...o,
});

describe('portão de componentes antes de compilar', () => {
  it('barra e escreve no terminal do passo quando falta o que compila', async () => {
    electronAPI.componentesListar.mockResolvedValue({ componentes: [comp()] });
    expect(await exigir('tcmm')).toBe(false);
    expect(linhas[0].terminal).toBe('tcmm');
    expect(linhas[0].tipo).toBe('error');
    expect(linhas[0].texto).toContain('272 MB');   // o tamanho decide se dá tempo agora
    expect(linhas[1].texto).toContain('Componentes');   // e onde resolver
  });

  it('deixa passar quando está tudo instalado', async () => {
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp({ instalado: true }), comp({ nome: 'GTKWave', requerParaCompilar: false })],
    });
    expect(await exigir('tveri')).toBe(true);
    expect(linhas).toHaveLength(0);
  });

  it('componente opcional ausente NÃO barra: é escolha, não defeito', async () => {
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp({ nome: 'Surfer', requerParaCompilar: false })],
    });
    expect(await exigir('twave')).toBe(true);
    expect(linhas).toHaveLength(0);
  });

  it('cita CADA componente que falta, e não só o primeiro', async () => {
    electronAPI.componentesListar.mockResolvedValue({
      componentes: [comp(), comp({ nome: 'YANC', downloadMB: 12 })],
    });
    await exigir('tcmm');
    const texto = linhas.map((l) => l.texto).join(' | ');
    expect(texto).toContain('MSYS Toolchain');
    expect(texto).toContain('YANC');
  });

  it('gigabytes saem em GB, porque "1024 MB" não ajuda ninguém a decidir', async () => {
    electronAPI.componentesListar.mockResolvedValue({ componentes: [comp({ downloadMB: 2048 })] });
    await exigir('tcmm');
    expect(linhas[0].texto).toContain('2.0 GB');
  });

  it('FALHA ABERTA: erro ao consultar o main deixa a compilação seguir', async () => {
    // A tranca de verdade é o allowlist do processo principal; este portão é
    // um aviso melhor. Bloquear por falha de consulta trocaria um aviso que
    // some por uma compilação que não acontece.
    electronAPI.componentesListar.mockRejectedValue(new Error('IPC caiu'));
    expect(await exigir('tcmm')).toBe(true);
    expect(linhas).toHaveLength(0);
  });
});
