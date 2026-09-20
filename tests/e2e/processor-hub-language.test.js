// tests/e2e/processor-hub-language.test.js
//
// O seletor de linguagem do Processor Hub, no index.html de verdade.
//
// A regra: marcar C++ desabilita tudo menos o nome e as duas contagens de
// porta, porque o front end C++ do yanc le so isso do fonte e usa os padroes
// dele para o resto. Os campos desabilitados passam a MOSTRAR esses padroes
// (32 bits, mantissa 23, expoente 8), em vez de deixar na tela os numeros do
// C+-, que seriam mentira sobre o que vai ser compilado.
//
// Nao precisa de toolchain: e comportamento de formulario. Roda sempre.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Os seis que so o C+- usa, e o que o cppcomp assume no lugar de cada um. */
const SO_DO_CMM = {
    nBits: '32',
    nbMantissa: '23',
    nbExponent: '8',
    gain: '128',
    dataStackSize: '128',
    instructionStackSize: '128',
};
/** Os que continuam valendo nas duas linguagens. */
const SEMPRE = ['processorName', 'inputPorts', 'outputPorts'];

function stripElectronNodeMode(env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) {
        if (k === 'ELECTRON_RUN_AS_NODE') continue;
        out[k] = v;
    }
    return out;
}

async function waitForMainWindow(app, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const w of app.windows()) {
            const url = w.url();
            if (url.endsWith('/index.html') || url.endsWith('\\index.html')) return w;
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Main window (index.html) did not appear within timeout.');
}

/** Marca um dos dois radios e deixa o handler de `change` rodar. */
async function escolherLinguagem(window, id) {
    await window.evaluate((alvo) => {
        const radio = document.getElementById(alvo);
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
    }, id);
}

const estadoDosCampos = (window, ids) => window.evaluate((lista) => {
    const out = {};
    for (const id of lista) {
        const el = document.getElementById(id);
        out[id] = el
            ? { disabled: el.disabled, value: el.value, grupoApagado: !!el.closest('.form-group')?.classList.contains('is-disabled') }
            : null;
    }
    return out;
}, ids);

describe('Aurora E2E — o seletor de linguagem do Processor Hub', () => {
    /** @type {import('playwright').ElectronApplication} */
    let app;
    /** @type {import('playwright').Page} */
    let window;
    let userDataDir;

    beforeAll(async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-hub-'));
        app = await electron.launch({
            args: ['.', `--user-data-dir=${userDataDir}`],
            cwd: REPO_ROOT,
            env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
            timeout: 30_000,
        });
        window = await waitForMainWindow(app);
        await window.waitForLoadState('load');
        await window.waitForFunction(
            () => !!document.getElementById('languageCmm') && !!document.getElementById('nBits'),
            null, { timeout: 15_000 },
        );
    }, 90_000);

    afterAll(async () => {
        try { await app?.close(); } catch (_) { /* ja morreu */ }
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    });

    it('comeca em C+-, com todos os campos abertos', async () => {
        const marcado = await window.evaluate(() => ({
            cmm: document.getElementById('languageCmm').checked,
            cpp: document.getElementById('languageCpp').checked,
        }));
        expect(marcado).toEqual({ cmm: true, cpp: false });

        const campos = await estadoDosCampos(window, [...Object.keys(SO_DO_CMM), ...SEMPRE]);
        for (const [id, estado] of Object.entries(campos)) {
            expect(estado, id).not.toBeNull();
            expect(estado.disabled, `${id} devia estar habilitado em C+-`).toBe(false);
        }
        const dicaEscondida = await window.evaluate(
            () => document.getElementById('processorLanguageHint').classList.contains('hidden'),
        );
        expect(dicaEscondida).toBe(true);
    });

    it('marcar C++ desabilita tudo menos nome e portas, e mostra os padroes do cppcomp', async () => {
        await escolherLinguagem(window, 'languageCpp');

        const campos = await estadoDosCampos(window, [...Object.keys(SO_DO_CMM), ...SEMPRE]);
        for (const [id, esperado] of Object.entries(SO_DO_CMM)) {
            expect(campos[id].disabled, `${id} devia estar desabilitado em C++`).toBe(true);
            expect(campos[id].value, `${id} devia mostrar o padrao do cppcomp`).toBe(esperado);
            expect(campos[id].grupoApagado, `${id} devia estar visivelmente apagado`).toBe(true);
        }
        for (const id of SEMPRE) {
            expect(campos[id].disabled, `${id} NAO devia ser desabilitado`).toBe(false);
        }

        // 32 = 23 + 8 + 1: o padrao do C++ e o float de precisao simples.
        expect(Number(campos.nBits.value))
            .toBe(Number(campos.nbMantissa.value) + Number(campos.nbExponent.value) + 1);

        const dicaEscondida = await window.evaluate(
            () => document.getElementById('processorLanguageHint').classList.contains('hidden'),
        );
        expect(dicaEscondida).toBe(false);
    });

    it('em C++ o botao Gerar continua vivo com so nome e portas preenchidos', async () => {
        // A validacao de consistencia de bits e a dos seis campos do C+- sao
        // puladas: se nao fossem, o formulario ficaria travado para sempre no
        // modo C++, porque os campos estao desabilitados.
        const habilitado = await window.evaluate(() => {
            const nome = document.getElementById('processorName');
            nome.value = 'proc_do_hub';
            nome.dispatchEvent(new Event('input', { bubbles: true }));
            return !document.getElementById('generateProcessor').disabled;
        });
        expect(habilitado).toBe(true);
    });

    it('o simbolo desenhado do botao segue o fonte em foco', async () => {
        // O botao compila as duas linguagens; o simbolo diz qual delas vai
        // rodar se a pessoa clicar agora. O desenho tem os dois tracos de
        // baixo e a classe is-cpp escolhe entre menos e segundo mais.
        const lerGlifos = () => window.evaluate(() => {
            const glifos = [...document.querySelectorAll('.glyph-cpm')];
            const botao = document.querySelector('#cmmcomp .glyph-cpm');
            return {
                quantos: glifos.length,
                todosComCpp: glifos.every((g) => g.classList.contains('is-cpp')),
                botaoComCpp: !!botao?.classList.contains('is-cpp'),
                // os dois tracos existem no desenho, e so um aparece por vez
                temMinus: !!botao?.querySelector('.cpm-minus'),
                temPlus2: !!botao?.querySelector('.cpm-plus2'),
                rotuloTerminal: document.querySelector('[data-terminal="tcmm"] .tab-label')?.textContent,
            };
        });

        // Finge um .cpp em foco e roda o sincronizador que o evento de troca
        // de arquivo chama.
        await window.evaluate(() => {
            window.TabManager.getEditingFilePath = () => 'C:\\proj\\P\\Software\\P.cpp';
            window.syncCmmcompEnabled();
        });
        const comCpp = await lerGlifos();
        expect(comCpp.quantos).toBeGreaterThanOrEqual(2);
        expect(comCpp.temMinus).toBe(true);
        expect(comCpp.temPlus2).toBe(true);
        expect(comCpp.botaoComCpp).toBe(true);
        expect(comCpp.todosComCpp).toBe(true);
        expect(comCpp.rotuloTerminal).toBe('C++');

        // E volta ao mais-menos com um .cmm em foco.
        await window.evaluate(() => {
            window.TabManager.getEditingFilePath = () => 'C:\\proj\\P\\Software\\P.cmm';
            window.syncCmmcompEnabled();
        });
        const comCmm = await lerGlifos();
        expect(comCmm.botaoComCpp).toBe(false);
        expect(comCmm.todosComCpp).toBe(false);
        expect(comCmm.rotuloTerminal).toBe('C\u00b1');
    }, 30_000);

    it('voltar para C+- reabre os campos e devolve o que a pessoa tinha digitado', async () => {
        // Digita um valor proprio em C+-, vai para C++ e volta.
        await escolherLinguagem(window, 'languageCmm');
        await window.evaluate(() => {
            const el = document.getElementById('nBits');
            el.value = '19';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await escolherLinguagem(window, 'languageCpp');
        expect((await estadoDosCampos(window, ['nBits'])).nBits.value).toBe('32');

        await escolherLinguagem(window, 'languageCmm');
        const voltou = (await estadoDosCampos(window, ['nBits'])).nBits;
        expect(voltou.disabled).toBe(false);
        expect(voltou.value).toBe('19');
        expect(voltou.grupoApagado).toBe(false);
    });
});
