/**
 * Quanto vale um processador novo (js/project/processor_defaults.ts).
 *
 * Os mesmos numeros estavam em quatro lugares: aqui, no `CMM_DEFAULTS` do
 * tab_utils, no espelho a mao do processor_hub e nos `value=` do formulario do
 * index.html. Os tres primeiros passaram a importar deste modulo.
 *
 * O quarto nao da para importar, porque e HTML estatico e o formulario tem de
 * nascer preenchido mesmo antes de qualquer script rodar. Entao ele fica
 * TRAVADO por teste: se alguem mudar o padrao num lado e esquecer o outro, o
 * caso abaixo quebra e diz qual campo divergiu. E a escolha consciente
 * enquanto o index.html nao for tratado, que e o ultimo item do roteiro de
 * modernizacao.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    PADROES_DO_CMM,
    PADROES_DO_CPPCOMP,
    cmmTemplate,
    cmmTemplatePadrao,
} from '../../js/project/processor_defaults.ts';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `value="23"` do `<input id="nBits" ...>`, para cada campo do formulario. */
function valoresDoFormulario() {
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    const achados = {};
    for (const m of html.matchAll(/<input\b[^>]*\bid="([A-Za-z]+)"[^>]*>/g)) {
        const valor = m[0].match(/\bvalue="([^"]*)"/);
        if (valor) achados[m[1]] = Number(valor[1]);
    }
    return achados;
}

describe('PADROES_DO_CMM', () => {
    it('e o float estreito do SAPHO: 23 = 16 + 6 + 1', () => {
        expect(PADROES_DO_CMM.nBits)
            .toBe(PADROES_DO_CMM.nbMantissa + PADROES_DO_CMM.nbExponent + 1);
    });

    it('bate campo a campo com o formulario do Processor Hub no index.html', () => {
        const doHtml = valoresDoFormulario();
        for (const [campo, valor] of Object.entries(PADROES_DO_CMM)) {
            expect(doHtml[campo], `o campo ${campo} do index.html`).toBe(valor);
        }
    });

    it('cobre os oito campos de hardware, e nenhum a mais', () => {
        expect(Object.keys(PADROES_DO_CMM).sort()).toEqual([
            'dataStackSize', 'gain', 'inputPorts', 'instructionStackSize',
            'nBits', 'nbExponent', 'nbMantissa', 'outputPorts',
        ]);
    });
});

describe('PADROES_DO_CPPCOMP', () => {
    it('e o float de precisao simples do IEEE-754: 32 = 23 + 8 + 1', () => {
        expect(PADROES_DO_CPPCOMP.nBits)
            .toBe(PADROES_DO_CPPCOMP.nbMantissa + PADROES_DO_CPPCOMP.nbExponent + 1);
    });

    it('nao diz nada sobre portas: quem as escolhe e a pessoa, nas duas linguagens', () => {
        expect(PADROES_DO_CPPCOMP).not.toHaveProperty('inputPorts');
        expect(PADROES_DO_CPPCOMP).not.toHaveProperty('outputPorts');
    });
});

describe('cmmTemplatePadrao', () => {
    it('e o cmmTemplate com os padroes, mais a quebra de linha do editor', () => {
        expect(cmmTemplatePadrao('Foo'))
            .toBe(`${cmmTemplate({ processorName: 'Foo', ...PADROES_DO_CMM })}\n`);
    });

    it('carimba as nove diretivas com os valores do formulario', () => {
        const t = cmmTemplatePadrao('Foo');
        expect(t).toContain('#PRNAME Foo');
        expect(t).toContain(`#NUBITS ${PADROES_DO_CMM.nBits}`);
        expect(t).toContain(`#NBMANT ${PADROES_DO_CMM.nbMantissa}`);
        expect(t).toContain(`#NBEXPO ${PADROES_DO_CMM.nbExponent}`);
        expect(t).toContain(`#NUGAIN ${PADROES_DO_CMM.gain}`);
        expect(t.match(/^#[A-Z]{6} /gm)).toHaveLength(9);
    });

    it('cai em "processor" quando ninguem passa nome', () => {
        expect(cmmTemplatePadrao()).toContain('#PRNAME processor');
    });
});
