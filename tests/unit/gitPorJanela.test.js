/**
 * O git age no repositorio da janela que pediu (main/ipc/git.js).
 *
 * Todos os 29 handlers afunilavam em `projectDir()`, que resolvia contra o
 * ultimo projeto aberto em QUALQUER janela. Com duas janelas abertas, o
 * commit, o push, o descartar e o trocar de ramo da janela B agiam no
 * repositorio da janela A, e nada na tela dizia isso: do ponto de vista do
 * git estava tudo certo, so era o repositorio errado.
 *
 * O `event` do IPC ja chegava a `safe` e era jogado fora ali. Agora ele
 * atravessa ate os resolvedores. O que se prova aqui e o resolvedor, que e a
 * unica peca que decidia errado, e o embrulho que o alimenta.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);

// git.js chama `require('electron')` no topo so para pegar o ipcMain, que
// nenhum teste aqui aciona: `register()` nao e chamado. O falso existe para o
// carregamento nao morrer fora do Electron.
const electronPath = req.resolve('electron');
req.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true, children: [], paths: [],
    exports: { ipcMain: { handle() {}, on() {} }, app: { getPath: () => '' }, safeStorage: {} },
};

const state = req('../../main/state.js');
const { registrarSpfDaJanela } = req('../../main/ipc/project_paths.js');
const { projectDir } = req('../../main/ipc/git.js');

const evento = (id) => ({ sender: { id, once() {} } });
const A = path.join('C:', 'alunos', 'somador', 'somador.spf');
const B = path.join('C:', 'alunos', 'contador', 'contador.spf');

beforeEach(() => {
    state.currentOpenProjectPath = null;
    state.projectPathsBySender.clear();
});

describe('projectDir por janela', () => {
    it('cada janela age no proprio repositorio', () => {
        registrarSpfDaJanela(evento(1), A);
        registrarSpfDaJanela(evento(2), B);
        expect(projectDir(evento(1))).toBe(path.dirname(A));
        expect(projectDir(evento(2))).toBe(path.dirname(B));
    });

    it('janela sem projeto nao age no repositorio da vizinha', () => {
        // Este e o bug: aqui a janela 2 recebia a pasta do projeto da janela 1,
        // e um push dela subia o trabalho do outro projeto.
        registrarSpfDaJanela(evento(1), A);
        expect(projectDir(evento(2))).toBeNull();
    });

    it('sem projeto nenhum, null, e quem chama recusa a operacao', () => {
        expect(projectDir(evento(1))).toBeNull();
        expect(projectDir(null)).toBeNull();
    });

    it('no arranque de uma janela so, antes de registrar, vale o global', () => {
        state.currentOpenProjectPath = A;
        expect(projectDir(evento(9))).toBe(path.dirname(A));
    });

    it('fechar o projeto da janela tira o repositorio dela', () => {
        registrarSpfDaJanela(evento(1), A);
        registrarSpfDaJanela(evento(2), B);
        registrarSpfDaJanela(evento(1), null);
        expect(projectDir(evento(1))).toBeNull();
        expect(projectDir(evento(2))).toBe(path.dirname(B));
    });
});
