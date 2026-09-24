// vitest.config.mts
//
// Default `npm test` runs unit tests only (tests/unit/**) — fast, no Electron.
// E2E tests live under tests/e2e/ and launch a full Electron app via
// Playwright; they take ~10s each so they're a separate command
// (`npm run test:e2e`) and a separate CI step.
import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

// Um teste que importa `../../js/x.js` recebia o .js que o `build:ts` gerou ao
// lado do x.ts, e nao o .ts. O teste passava do mesmo jeito, mas a cobertura
// caia no arquivo gerado, com numeracao de linha diferente da do fonte, e o
// scripts/check-diff-coverage.mts nao conseguia dizer se a linha que alguem
// mexeu no .ts estava coberta. Com este redirecionamento o teste exercita o
// proprio .ts, que e tambem o que se quer testar. So vale para modulo que o
// Vite carrega; quem chega por `createRequire` continua no .js gerado.
function preferTsSource(): Plugin {
  return {
    name: 'prefer-ts-source',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('.js')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return null;
      const id = resolved.id.split('?')[0];
      if (id.includes('/node_modules/')) return null;
      const ts = `${id.slice(0, -3)}.ts`;
      return fs.existsSync(ts) ? ts : null;
    },
  };
}

export default defineConfig({
  plugins: [preferTsSource()],
  test: {
    include: ['tests/unit/**/*.test.js'],
    exclude: ['**/node_modules/**'],
    // O padrao do vitest e 5 s, e ele nao cobre um caso legitimo desta suite:
    // pylibs.test.js chama pylib_manager.getState(), que resolve o Python
    // embarcado por bundledPython() -> python_locator, um modulo que trabalha
    // com execFileSync. Nascer um processo no Windows leva milissegundos numa
    // maquina ociosa e segundos num runner carregado, entao o teste passava
    // aqui e estourava no CI sem nada ter mudado no codigo — apareceu nos
    // builds do bump de Electron, que baixam bem mais coisa antes de testar.
    // A suite inteira roda em ~5 s local; 20 s da folga para o runner ruim sem
    // esconder travamento de verdade.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      // `npm run test:coverage` (and CI) measure coverage of the source the unit
      // tests actually exercise. `all:false` keeps the report to the modules the
      // tests import (meaningful for the current pure-module suite) rather than
      // diluting it with the whole renderer/main tree at 0%.
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: './coverage',
      all: false,
      exclude: ['**/*.test.js', '**/node_modules/**', 'dist/**', 'components/**', 'tests/**', '**/*.config.*'],
    },
  },
});
