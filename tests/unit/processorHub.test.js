// @vitest-environment happy-dom
//
// O formulario do Processor Hub (js/processors/processor_hub.ts), sobre o
// trecho de verdade do index.html. O que estes casos travam e a caixa
// "o compilador dimensiona as pilhas": marcada, as duas pilhas ficam vazias e
// desabilitadas, saem da validacao e vao para o IPC sem valor, que e o que
// faz o cmmTemplate deixar #NDSTAC e #SDEPTH fora do cabecalho. O E2E em
// tests/e2e/processor-hub-language.test.js prova o mesmo na janela inteira.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const electronAPI = {
    createProcessorProject: vi.fn(async () => ({ success: true })),
    triggerFileTreeRefresh: vi.fn(async () => {}),
    onProcessorHubState: vi.fn(),
    onProcessorsUpdated: vi.fn(),
};
vi.mock('../../js/app/electron_api.js', () => ({ electronAPI }));
vi.mock('../../js/ui/dialog_manager.js', () => ({ showDialog: vi.fn(async () => 'ok') }));

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/** O <form> do Hub e o rodape com os botoes, como estao no index.html. */
function trechoDoHub() {
    const form = INDEX.slice(
        INDEX.indexOf('<form class="processor-form" id="processorHubForm"'),
        INDEX.indexOf('</form>', INDEX.indexOf('id="processorHubForm"')) + '</form>'.length,
    );
    const ini = INDEX.indexOf('<button type="button" id="cancelProcessorHub"');
    const rodape = INDEX.slice(ini, INDEX.indexOf('</footer>', ini));
    return `<div id="modalContainer">${form}${rodape}</div>`;
}

/** O handler de DOMContentLoaded do modulo, para rodar uma vez por caso. */
let iniciarHub;

beforeAll(async () => {
    const original = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((tipo, fn, opts) => {
        if (tipo === 'DOMContentLoaded') iniciarHub = fn;
        else original(tipo, fn, opts);
    });
    await import('../../js/processors/processor_hub.ts');
    document.addEventListener.mockRestore();
});

const $ = (id) => document.getElementById(id);

function mudar(id, valor) {
    const el = $(id);
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = valor;
    else el.value = valor;
    el.dispatchEvent(new Event(el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input'));
}

async function gerar() {
    $('processorHubForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(electronAPI.createProcessorProject).toHaveBeenCalled());
    return electronAPI.createProcessorProject.mock.calls[0][0];
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = trechoDoHub();
    iniciarHub();
    // O Hub so gera com projeto aberto; e o main que avisa qual e.
    electronAPI.onProcessorsUpdated.mock.calls[0][0]({ projectPath: 'C:/proj' });
});

describe('Processor Hub: a caixa das pilhas', () => {
    it('comeca desmarcada, e o IPC recebe as duas pilhas como sempre', async () => {
        expect($('autoStackSizes').checked).toBe(false);
        expect($('dataStackSize').disabled).toBe(false);
        const dados = await gerar();
        expect(dados.dataStackSize).toBe(5);
        expect(dados.instructionStackSize).toBe(5);
    });

    it('marcada, as pilhas ficam vazias e apagadas, e o IPC as recebe sem valor', async () => {
        mudar('autoStackSizes', true);
        for (const id of ['dataStackSize', 'instructionStackSize']) {
            expect($(id).disabled, id).toBe(true);
            expect($(id).value, id).toBe('');
            expect($(id).closest('.form-group').classList.contains('is-disabled'), id).toBe(true);
        }
        // Vazias, nao travam o Gerar.
        expect($('generateProcessor').disabled).toBe(false);

        const dados = await gerar();
        expect(dados.dataStackSize).toBeUndefined();
        expect(dados.instructionStackSize).toBeUndefined();
        expect(dados.nBits).toBe(23);
    });

    it('desmarcada, voltam os valores que a pessoa tinha digitado', () => {
        mudar('dataStackSize', '9');
        mudar('autoStackSizes', true);
        mudar('autoStackSizes', false);
        expect($('dataStackSize').value).toBe('9');
        expect($('dataStackSize').disabled).toBe(false);
        expect($('instructionStackSize').value).toBe('5');
    });

    it('em C++ a caixa fica desabilitada, e no C+- de novo as pilhas seguem com o compilador', () => {
        mudar('autoStackSizes', true);
        mudar('languageCpp', true);
        expect($('autoStackSizes').disabled).toBe(true);
        expect($('dataStackSize').value).toBe('128');

        mudar('languageCmm', true);
        expect($('autoStackSizes').disabled).toBe(false);
        expect($('dataStackSize').value).toBe('');
        expect($('dataStackSize').disabled).toBe(true);

        mudar('autoStackSizes', false);
        expect($('dataStackSize').value).toBe('5');
    });

    it('com a caixa desmarcada, pilha vazia continua travando o Gerar', () => {
        mudar('dataStackSize', '');
        expect($('generateProcessor').disabled).toBe(true);
        mudar('autoStackSizes', true);
        expect($('generateProcessor').disabled).toBe(false);
    });

    it('cancelar desmarca a caixa e reabre as pilhas', () => {
        mudar('autoStackSizes', true);
        $('cancelProcessorHub').click();
        expect($('autoStackSizes').checked).toBe(false);
        expect($('dataStackSize').disabled).toBe(false);
        expect($('dataStackSize').value).toBe('5');
    });
});
