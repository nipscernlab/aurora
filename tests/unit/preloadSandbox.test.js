/**
 * Os preloads so podem pedir 'electron'.
 *
 * As janelas rodam com `sandbox: true` (main/windows.js), e no preload em
 * sandbox o `require` e um substituto que so conhece electron, events,
 * timers e url. Um `require('os')` que passou por js/app/preload.js em
 * 12/09/2026 estourou na primeira linha: a ponte inteira deixou de existir,
 * `window.electronAPI` ficou indefinido e nenhum botao da interface tinha
 * mais quem o escutasse. A tela inteira pareceu travada.
 *
 * Nada do que se testa aqui roda o Electron. E leitura do fonte: toda chamada
 * `require(...)` num preload tem que ser `require('electron')`. O que precisa
 * do Node vai por IPC, como tudo o mais nesses arquivos.
 */

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const PRELOADS = [
    'js/app/preload.js',
    'js/app/preload_prism.js',
    'js/app/preload_update.js',
    'js/app/preload_docs.js',
];

describe('preloads em sandbox', () => {
    for (const arquivo of PRELOADS) {
        it(`${arquivo} so pede 'electron'`, () => {
            if (!fs.existsSync(arquivo)) return;
            const fonte = fs.readFileSync(arquivo, 'utf8');
            // Ignora comentarios: o proprio aviso sobre o require('os') mora num.
            const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            const pedidos = [...codigo.matchAll(/\brequire\(\s*(['"])([^'"]+)\1\s*\)/g)].map((m) => m[2]);
            expect(pedidos.length).toBeGreaterThan(0);
            for (const modulo of pedidos) expect(modulo).toBe('electron');
        });
    }
});
