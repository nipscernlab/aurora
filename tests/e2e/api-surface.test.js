// tests/e2e/api-surface.test.js
//
// A superficie da AuroraAPI, travada contra um retrato commitado.
//
// O js/api/aurora_api.js tem 3400 linhas e esta sendo dividido em um modulo
// por namespace, como ja foi feito com o `git` e com o nucleo de respostas. O
// risco de toda divisao e o mesmo: um metodo some, muda de namespace ou troca
// de nome, e ninguem percebe ate a Aurora Intelligence chamar a ferramenta e
// receber "is not a function" na cara do usuario.
//
// Este teste e a rede. Ele le a superficie REAL, do window.AuroraAPI no
// Electron rodando, e compara com tests/e2e/fixtures/api-surface.json, nome
// por nome. Mover um namespace de arquivo nao mexe no retrato; remover ou
// renomear um metodo mexe, e ai a mudanca tem de ser deliberada, com o retrato
// atualizado no mesmo commit.
//
// Para atualizar depois de uma mudanca INTENCIONAL:
//   node tests/e2e/fixtures/atualizar-api-surface.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const RETRATO = path.join(HERE, 'fixtures', 'api-surface.json');

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

// A leitura mora no probe, e nao aqui: o atualizar-api-surface.js usa a MESMA
// funcao para regravar o retrato, e duas copias poderiam ler coisas diferentes.
const { lerSuperficie } = createRequire(import.meta.url)('./fixtures/api_surface_probe.cjs');

describe('Aurora E2E — a superficie da AuroraAPI nao muda sozinha', () => {
    /** @type {import('playwright').ElectronApplication} */
    let app;
    /** @type {import('playwright').Page} */
    let window_;
    let userDataDir;
    let superficie;

    beforeAll(async () => {
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-api-'));
        app = await electron.launch({
            args: ['.', `--user-data-dir=${userDataDir}`],
            cwd: REPO_ROOT,
            env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
            timeout: 30_000,
        });
        window_ = await waitForMainWindow(app);
        await window_.waitForLoadState('load');
        await window_.waitForFunction(() => !!window.AuroraAPI, null, { timeout: 20_000 });
        superficie = await window_.evaluate(`(${lerSuperficie.toString()})()`);
    }, 90_000);

    afterAll(async () => {
        try { await app?.close(); } catch (_) { /* ja morreu */ }
        try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    });

    it('tem exatamente os namespaces do retrato', () => {
        const esperado = JSON.parse(fs.readFileSync(RETRATO, 'utf8'));
        expect(Object.keys(superficie).sort()).toEqual(Object.keys(esperado).sort());
    });

    it('tem exatamente os mesmos metodos em cada namespace', () => {
        const esperado = JSON.parse(fs.readFileSync(RETRATO, 'utf8'));
        // Compara namespace a namespace para a falha dizer QUAL mudou, em vez
        // de despejar a superficie inteira no terminal.
        for (const ns of Object.keys(esperado)) {
            expect(superficie[ns], `namespace ${ns}`).toEqual(esperado[ns]);
        }
    });

    it('um namespace movido continua RESPONDENDO, e nao so existindo', async () => {
        // Os dois casos acima comparam nomes, e nomes sobrevivem a um export
        // errado: um namespace pode virar objeto com as chaves certas e o
        // corpo quebrado. Chamar, nao. `manual.status()` e a escolha porque
        // nao toca em projeto nem em disco do usuario, e responde igual com o
        // manual instalado ou ausente.
        const r = await window_.evaluate(() => window.AuroraAPI.manual.status());
        expect(r, JSON.stringify(r)).toHaveProperty('ok');
        expect(typeof r.ok).toBe('boolean');

        // E `schema()`, que descreve a propria API, tem de listar os mesmos
        // namespaces do retrato: e o que a Aurora Intelligence le para saber o
        // que pode chamar, e ele ja se desencontrou da superficie antes.
        const descritos = await window_.evaluate(() => Object.keys(window.AuroraAPI._meta.schema().namespaces));
        const esperado = JSON.parse(fs.readFileSync(RETRATO, 'utf8'));
        const comMetodos = Object.keys(esperado).filter((k) => k !== '_meta' && k !== 'events');
        for (const ns of comMetodos) expect(descritos, `schema() sem ${ns}`).toContain(ns);
    });
});
