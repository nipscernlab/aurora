// @vitest-environment happy-dom
//
// O modal de projeto novo (js/ui/new_project_modal.ts), sobre o trecho de
// verdade do index.html. A regra de nome e de caminho esta em
// tests/unit/pathRules.test.js; aqui fica o que o formulario faz com ela: onde
// o aviso aparece, quando ele some, e o que vai para o IPC.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const electronAPI = {
    createProjectStructure: vi.fn(async () => ({ success: true })),
    selectDirectory: vi.fn(async () => 'C:\\lab'),
};
const showDialog = vi.fn(async () => 'ok');
const projectManager = { loadProject: vi.fn(async () => {}) };
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog }));
vi.mock('../../js/project/project_manager.js', () => ({ projectManager }));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/** O <aurora-modal> de projeto novo, como esta no index.html. */
function trechoDoModal() {
    const ini = INDEX.indexOf('<aurora-modal id="newProjectModal">');
    return INDEX.slice(ini, INDEX.indexOf('</aurora-modal>', ini) + '</aurora-modal>'.length);
}

/** O handler de DOMContentLoaded do modulo, para rodar uma vez por caso. */
let iniciarModal;

beforeAll(async () => {
    const original = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, opts) => {
        if (tipo === 'DOMContentLoaded') iniciarModal = fn;
        else original(tipo, fn, opts);
    });
    await import('../../js/ui/new_project_modal.ts');
    document.addEventListener.mockRestore();
});

const $ = (id) => document.getElementById(id);
const avisoDe = (id) => $(id).closest('.form-group').querySelector('.campo-aviso');
const borda = (id) => $(id).style.getPropertyValue('border');

function digitar(id, valor) {
    $(id).value = valor;
    $(id).dispatchEvent(new Event('input'));
}

/** Deixa as promessas do handler de clique terminarem. */
const esperar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    document.body.innerHTML = trechoDoModal();
    vi.clearAllMocks();
    localStorage.clear();
    iniciarModal();
});

describe('Novo projeto: o aviso embaixo do campo', () => {
    it('nome recusado marca o campo e diz o caractere', () => {
        digitar('projectNameInput', 'a&b');
        expect(borda('projectNameInput')).not.toBe('');
        expect(avisoDe('projectNameInput').textContent).toContain('&');
    });

    it('apagar o nome tira a marca e o aviso: vazio nao e erro enquanto se digita', () => {
        digitar('projectNameInput', 'a&b');
        digitar('projectNameInput', '');
        expect(borda('projectNameInput')).toBe('');
        expect(avisoDe('projectNameInput')).toBeNull();
    });

    // #187: a regra e a do processador, entao hifen, que o projeto aceitava,
    // agora e recusado aqui tambem, com o mesmo texto que o Hub mostra.
    it('hifen e recusado, como no nome de processador', () => {
        digitar('projectNameInput', 'meu-proj');
        expect(avisoDe('projectNameInput').textContent).toContain('Tire: -.');
    });

    it('corrigir o nome tira o aviso', () => {
        digitar('projectNameInput', 'a&b');
        digitar('projectNameInput', 'ab');
        expect(avisoDe('projectNameInput')).toBeNull();
    });

    it('a pasta digitada e validada, e apagada perde o aviso', () => {
        digitar('projectLocationInput', 'C:\\lab\\a&b');
        expect(avisoDe('projectLocationInput').textContent).toContain('&');
        digitar('projectLocationInput', '');
        expect(avisoDe('projectLocationInput')).toBeNull();
    });

    it('a pasta escolhida no seletor e validada na hora', async () => {
        electronAPI.selectDirectory.mockResolvedValueOnce('C:\\lab\\a&b');
        $('browseBtn').click();
        await esperar();
        expect($('projectLocationInput').value).toBe('C:\\lab\\a&b');
        expect(avisoDe('projectLocationInput').textContent).toContain('&');
    });
});

describe('Novo projeto: o envio', () => {
    it('sem nome ou sem pasta, avisa e nao cria', async () => {
        $('generateProjectBtn').click();
        await esperar();
        expect(showDialog).toHaveBeenCalledTimes(1);
        expect(electronAPI.createProjectStructure).not.toHaveBeenCalled();
    });

    it('nome recusado: o dialogo diz o motivo e nada e criado', async () => {
        $('projectNameInput').value = 'a&b';
        $('projectLocationInput').value = 'C:\\lab';
        $('generateProjectBtn').click();
        await esperar();
        expect(showDialog.mock.calls[0][0].message).toContain('Nome do projeto:');
        // A mensagem do dialogo e HTML: o & digitado chega escapado (#276).
        expect(showDialog.mock.calls[0][0].message).toContain('Tire: &amp;.');
        expect(electronAPI.createProjectStructure).not.toHaveBeenCalled();
    });

    it('nome e pasta validos: cria pasta e .spf com o nome, e abre o projeto', async () => {
        $('projectNameInput').value = 'filtro';
        $('projectLocationInput').value = 'C:\\lab';
        $('generateProjectBtn').click();
        await esperar();
        expect(electronAPI.createProjectStructure).toHaveBeenCalledWith(
            'C:\\lab\\filtro', 'C:\\lab\\filtro\\filtro.spf', 'filtro');
        expect(projectManager.loadProject).toHaveBeenCalledWith('C:\\lab\\filtro\\filtro.spf');
        expect(localStorage.getItem('aurora-last-new-project-location')).toBe('C:\\lab');
        expect($('newProjectModal').getAttribute('aria-hidden')).toBe('true');
        expect($('projectNameInput').value).toBe('');
    });

    it('falha do IPC vira dialogo de erro', async () => {
        electronAPI.createProjectStructure.mockResolvedValueOnce({ success: false });
        $('projectNameInput').value = 'filtro';
        $('projectLocationInput').value = 'C:\\lab';
        $('generateProjectBtn').click();
        await esperar();
        expect(showDialog).toHaveBeenCalledTimes(1);
        expect(projectManager.loadProject).not.toHaveBeenCalled();
    });

    it('cancelar limpa os campos', () => {
        $('projectNameInput').value = 'filtro';
        $('cancelProjectBtn').click();
        expect($('projectNameInput').value).toBe('');
        expect($('newProjectModal').getAttribute('aria-hidden')).toBe('true');
    });

    it('abrir pelo botao mostra o modal', () => {
        document.body.insertAdjacentHTML('beforeend', '<button id="newProjectBtn"></button>');
        iniciarModal();
        $('newProjectBtn').click();
        expect($('newProjectModal').getAttribute('aria-hidden')).toBe('false');
    });
});
