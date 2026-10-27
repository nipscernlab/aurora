// @vitest-environment happy-dom
// O runSpec recusa, antes de chamar o main, o passo cujo caminho a ferramenta
// nao aceita, e confere o comando ja com os overrides da IA, que e o que
// rodaria de fato.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const electronAPI = {
    execSpec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    execSpecStreamed: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
const override = { cwd: null };
vi.mock('../../js/compilation/command_overrides.js', () => ({
    applyResolved: vi.fn(async (spec) => ({
        appliedSpec: override.cwd ? { ...spec, cwd: override.cwd } : spec, override: null, sources: [],
    })),
}));

const { runSpec, runSpecStreamed } = await import('../../js/compilation/spec_runner.js');

const spec = (cwd) => ({ step: 'verilator-build', binary: 'C:\\comp\\perl.exe', args: ['-Mdir', `${cwd}\\obj`], cwd });

beforeEach(() => {
    vi.clearAllMocks();
    override.cwd = null;
    window.t = (k, p) => (p ? `${k}: ${p.path}` : k);
});

describe('runSpec e o caminho da ferramenta', () => {
    it.each([['runSpec', runSpec, 'execSpec'], ['runSpecStreamed', runSpecStreamed, 'execSpecStreamed']])(
        '%s recusa o Verilator em pasta com espaco sem chamar o main', async (_n, rodar, ipc) => {
            await expect(rodar(spec('C:\\Meus Projetos\\p'))).rejects.toThrow(
                'error.compilation.pathRefusedVerilator: C:\\Meus Projetos\\p');
            expect(electronAPI[ipc]).not.toHaveBeenCalled();
        });

    it('em pasta limpa o passo segue para o main', async () => {
        await runSpec(spec('C:\\lab\\p'));
        expect(electronAPI.execSpec).toHaveBeenCalledTimes(1);
    });

    it('confere o comando depois do override', async () => {
        override.cwd = 'C:\\a b';
        await expect(runSpec(spec('C:\\lab\\p'))).rejects.toThrow('pathRefusedVerilator: C:\\a b');
        expect(electronAPI.execSpec).not.toHaveBeenCalled();
    });

    it('sem tradutor carregado a mensagem e a chave', async () => {
        delete window.t;
        await expect(runSpec(spec('C:\\a b'))).rejects.toThrow('error.compilation.pathRefusedVerilator');
    });
});
