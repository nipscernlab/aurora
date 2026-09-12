// @vitest-environment happy-dom
//
// Dois padroes de fabrica que decidem o que um aluno ve na primeira vez.
//
// O terminal verboso vinha ligado, entao a primeira compilacao mostrava a
// linha de comando inteira do Verilator, cinco linhas de caminhos absolutos,
// antes de qualquer mensagem util. E a lista de recentes queria trocar a
// pasta do usuario por `~`, mas lia um campo que nao existia na ponte: a
// comparacao falhava em silencio e as seis linhas mostravam o mesmo prefixo,
// cortado pelo CSS justamente na parte que as distinguia.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: {} }));
vi.mock('../../js/editor/monaco_editor.js', () => ({ EditorManager: {} }));
vi.mock('../../js/terminal/terminal.js', () => ({ switchTerminal: () => {}, smoothFollowToBottom: () => {} }));
vi.mock('../../js/terminal/error_locations.js', () => ({ comLinks: (s) => s }));
vi.mock('../../js/ui/help_link.js', () => ({ abrirAjudaDe: () => {}, AJUDAS: {} }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: () => {} }));
vi.mock('../../js/ui/dialog_manager.js', () => ({ showAlert: () => {} }));
vi.mock('../../js/components/aurora-terminal.js', () => ({}));
vi.mock('../../js/components/aurora-welcome.js', () => ({}));

import { TerminalManager } from '../../js/terminal/terminal_module.js';
import { RecentProjectsManager } from '../../js/project/recent_projects.js';

const HOME = 'C:\\Users\\chrys';
const truncar = (p, max, home = HOME) => RecentProjectsManager.prototype.truncatePath.call({}, p, max, home);

describe('terminal verboso', () => {
    beforeEach(() => localStorage.clear());

    it('vem DESLIGADO de fabrica', () => {
        expect(TerminalManager.prototype.loadVerboseMode.call({})).toBe(false);
    });

    it('quem ja escolheu mantem a escolha', () => {
        localStorage.setItem('terminal-verbose-mode', 'true');
        expect(TerminalManager.prototype.loadVerboseMode.call({})).toBe(true);
        localStorage.setItem('terminal-verbose-mode', 'false');
        expect(TerminalManager.prototype.loadVerboseMode.call({})).toBe(false);
    });

    it('o interruptor da tela nasce desligado tambem', async () => {
        const fs = await import('node:fs');
        const html = fs.readFileSync('index.html', 'utf8');
        const m = /<input type="checkbox" id="verbose-toggle"([^>]*)>/.exec(html);
        expect(m).not.toBeNull();
        expect(m[1]).not.toMatch(/\bchecked\b/);
    });
});

describe('caminho dos recentes', () => {

    it('tira o nome do .spf e troca a pasta do usuario por ~', () => {
        expect(truncar('C:\\Users\\chrys\\Desktop\\sapho_procs\\exemplos-sapho\\contador\\contador.spf'))
            .toBe('~\\Desktop\\sapho_procs\\exemplos-sapho\\contador');
    });

    it('a pasta do usuario e reconhecida sem diferenciar caixa, como o Windows faz', () => {
        expect(truncar('c:\\users\\chrys\\Projetos\\x\\x.spf')).toBe('~\\Projetos\\x');
    });

    it('fora da pasta do usuario, o caminho fica inteiro', () => {
        expect(truncar('D:\\alunos\\turma\\somador\\somador.spf')).toBe('D:\\alunos\\turma\\somador');
    });

    it('sem a pasta do usuario resolvida, nao quebra e nao inventa ~', () => {
        expect(truncar('C:\\Users\\chrys\\p\\p.spf', 56, null)).toBe('C:\\Users\\chrys\\p');
        // O padrao do parametro e a pasta resolvida por IPC; sem ponte, nula.
        expect(RecentProjectsManager.prototype.truncatePath.call({}, 'C:\\Users\\chrys\\p\\p.spf'))
            .toBe('C:\\Users\\chrys\\p');
    });

    it('vazio devolve vazio', () => {
        expect(truncar('')).toBe('');
        expect(truncar(null)).toBe('');
    });

    it('quando nem o ~ faz caber, corta o COMECO e guarda o fim, que e o que distingue', () => {
        const longo = 'D:\\uma\\pasta\\muito\\comprida\\cheia\\de\\niveis\\intermediarios\\projeto-final\\projeto-final.spf';
        const r = truncar(longo, 40);
        expect(r.startsWith('\u2026\\')).toBe(true);
        expect(r.endsWith('\\projeto-final')).toBe(true);
        expect(r.length).toBeLessThanOrEqual(41);
        // O pai imediato entra sempre que couber: e ele que separa dois
        // projetos de mesmo nome.
        expect(r).toContain('intermediarios\\projeto-final');
    });

    it('um caminho que cabe nao ganha reticencias', () => {
        expect(truncar('D:\\a\\b\\b.spf', 40)).toBe('D:\\a\\b');
    });
});
