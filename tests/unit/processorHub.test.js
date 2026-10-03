// @vitest-environment happy-dom
//
// O formulario do Processor Hub (js/processors/processor_hub.ts), sobre o
// trecho de verdade do index.html. O Hub nao pergunta as pilhas: sem #NDSTAC
// e #SDEPTH no cabecalho, o yanc calcula a profundidade de cada uma pelo
// programa, e quem quiser tamanho fixo escreve a diretiva a mao. O que vai
// para o disco esta em tests/unit/processorTemplate.test.js; o E2E em
// tests/e2e/processor-hub-language.test.js prova o formulario na janela.

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
    const marcavel = el.type === 'checkbox' || el.type === 'radio';
    if (marcavel) el.checked = valor;
    else el.value = valor;
    el.dispatchEvent(new Event(marcavel ? 'change' : 'input'));
}

async function gerar() {
    $('processorHubForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(electronAPI.createProcessorProject).toHaveBeenCalled());
    return electronAPI.createProcessorProject.mock.calls[0][0];
}

const SO_DO_CMM = { nBits: '32', nbMantissa: '23', nbExponent: '8', gain: '128' };

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = trechoDoHub();
    iniciarHub();
    // O Hub so gera com projeto aberto; e o main que avisa qual e.
    electronAPI.onProcessorsUpdated.mock.calls[0][0]({ projectPath: 'C:/proj' });
});

describe('Processor Hub: as pilhas ficam com o compilador', () => {
    it('o formulario nao tem campo de pilha', () => {
        expect($('dataStackSize')).toBeNull();
        expect($('instructionStackSize')).toBeNull();
        expect($('autoStackSizes')).toBeNull();
    });

    it('o IPC recebe os campos do C+- e nenhuma pilha', async () => {
        const dados = await gerar();
        expect(dados).toMatchObject({
            projectLocation: 'C:/proj', language: 'cmm',
            nBits: 23, nbMantissa: 16, nbExponent: 6, gain: 128,
            inputPorts: 1, outputPorts: 1,
        });
        expect(dados).not.toHaveProperty('dataStackSize');
        expect(dados).not.toHaveProperty('instructionStackSize');
    });
});

describe('Processor Hub: o seletor de linguagem', () => {
    it('em C++ os quatro campos do C+- mostram o padrao do cppcomp e desabilitam', () => {
        mudar('languageCpp', true);
        for (const [id, valor] of Object.entries(SO_DO_CMM)) {
            expect($(id).disabled, id).toBe(true);
            expect($(id).value, id).toBe(valor);
        }
        expect($('inputPorts').disabled).toBe(false);
        expect($('generateProcessor').disabled).toBe(false);
    });

    it('voltando ao C+-, os campos reabrem com o que a pessoa tinha digitado', () => {
        mudar('nBits', '19');
        mudar('languageCpp', true);
        mudar('languageCmm', true);
        expect($('nBits').disabled).toBe(false);
        expect($('nBits').value).toBe('19');
    });

    it('cancelar devolve o formulario ao C+- com os campos abertos', () => {
        mudar('languageCpp', true);
        $('cancelProcessorHub').click();
        expect($('languageCmm').checked).toBe(true);
        expect($('nBits').disabled).toBe(false);
    });
});
