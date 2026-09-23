// vitest.config.e2e.js
//
// E2E config: runs only tests/e2e/**, with longer timeouts for the
// Electron launch overhead (~10s on a warm machine, more on first run).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.js'],
    // Run e2e files ONE AT A TIME. Each file cold-starts a full Electron
    // app (main + renderer + GPU processes). Vitest parallelises files by
    // default, so 3 files = 3 concurrent Electron instances — fine on a
    // dev box, but a 2-core windows-latest runner can't bring all their
    // windows up inside waitForMainWindow's 20 s budget, so every file
    // times out. (Broke the moment a 3rd e2e file was added.) Serialising
    // keeps one Electron alive at a time, matching how a user runs the app.
    fileParallelism: false,
    // TODA corrida deixa o resultado em arquivo, alem do que sai na tela.
    //
    // Existe por um caso concreto: uma corrida desta suite acusou dois casos
    // falhando, a saida foi lida por um `tail` que cortou o nome deles, e as
    // cinco corridas seguintes passaram. Sem o nome nao da para dizer se foi a
    // mudanca ou se foi instabilidade, e 'nao sei' nao e resposta aceitavel
    // para um teste vermelho. Agora o nome fica gravado, e quem investigar
    // uma corrida vermelha nao depende de ter capturado a tela na hora.
    reporters: ['default', 'json'],
    outputFile: { json: 'reports/e2e-last-run.json' },
    // Each test boots a renderer and asks Monaco's AMD loader to finish.
    // CI (windows-latest) is noticeably slower than a dev machine —
    // electron cold-start + .spf-load IPC chain takes ~10–15 s on the
    // runner where it's <2 s locally. Sized for the worst observed
    // case while still flagging genuinely-hung runs.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
