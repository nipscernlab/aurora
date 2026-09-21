// atualizar-api-surface.js: regrava o retrato da superficie da AuroraAPI.
//
// O tests/e2e/api-surface.test.js compara a superficie real, lida do
// window.AuroraAPI num Electron rodando, com o api-surface.json ao lado. Este
// script e o unico jeito previsto de mexer nesse arquivo: ele sobe a mesma
// aplicacao, le a mesma coisa e grava.
//
// Rode DEPOIS de uma mudanca intencional na API (metodo novo, metodo removido,
// namespace novo), e ponha o .json no MESMO commit da mudanca, para o diff
// mostrar o que a API ganhou ou perdeu.
//
//   node tests/e2e/fixtures/atualizar-api-surface.js

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HERE = __dirname;
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const DESTINO = path.join(HERE, 'api-surface.json');

async function main() {
  const { _electron: electron } = require('playwright');
  const { lerSuperficie } = require('./api_surface_probe.cjs');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-api-snap-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.SAPHO_SKIP_SINGLE_INSTANCE = '1';

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env,
    timeout: 30_000,
  });

  try {
    const deadline = Date.now() + 20_000;
    let win = null;
    while (!win && Date.now() < deadline) {
      for (const w of app.windows()) {
        const url = w.url();
        if (url.endsWith('/index.html') || url.endsWith('\\index.html')) { win = w; break; }
      }
      if (!win) await new Promise((r) => setTimeout(r, 100));
    }
    if (!win) throw new Error('a janela principal nao apareceu');

    await win.waitForLoadState('load');
    await win.waitForFunction(() => !!window.AuroraAPI, null, { timeout: 20_000 });
    const superficie = await win.evaluate(`(${lerSuperficie.toString()})()`);

    const ordenado = {};
    for (const chave of Object.keys(superficie).sort()) ordenado[chave] = superficie[chave];
    fs.writeFileSync(DESTINO, `${JSON.stringify(ordenado, null, 2)}\n`);

    const metodos = Object.values(ordenado).filter(Array.isArray).reduce((n, a) => n + a.length, 0);
    console.log(`  OK  retrato regravado: ${Object.keys(ordenado).length} namespaces, ${metodos} metodos`);
    console.log(`      ${path.relative(REPO_ROOT, DESTINO)}`);
  } finally {
    try { await app.close(); } catch (_) { /* ja morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('  FALHOU:', e && e.message ? e.message : e);
  process.exit(1);
});
