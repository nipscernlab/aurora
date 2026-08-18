// tests/e2e/cmm-tokenizer.test.js
//
// O realce do C± tem que tokenizar a notação de Dirac sem derrubar o editor.
//
// O Monarch exige que, numa regra com ação em ARRAY, todo caractere do
// casamento pertença a um grupo de captura. Várias regras da notação de Dirac
// tinham `\s*` solto entre grupos, então o espaço casava e não pertencia a
// grupo nenhum. O erro não aparece ao registrar a linguagem: ele só estoura
// quando o tokenizador encontra a construção num arquivo de verdade, e aí o
// realce inteiro cai com "with groups, all characters should be matched in
// consecutive groups".
//
// Por isso o teste é e2e e tokeniza texto real: nenhuma leitura do fonte
// encontraria isso, e foi assim que passou despercebido até um usuário abrir um
// .cmm com `P # 1000.0|I|;`.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { _electron as electron } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stripElectronNodeMode(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    out[k] = v;
  }
  return out;
}

async function waitForMainWindow(app, timeoutMs = 25_000) {
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

/** As construções do relato, mais as outras formas de Dirac que o C± aceita. */
const LINHAS = [
  'P # 1000.0|I|;',
  'w # |0);',
  'x # fin(0) → |x);',
  'P # |v⟩⟨v|;',
  'P # |a| - |b⟩⟨c|;',
  'y # ⟨w|x⟩;',
  'out(0, r|s⟩);',
  '#PRNAME proc_rls',
  '#define N 4',
  'float P[N][N];',
];

describe('E2E — o tokenizador do C± aguenta a notação de Dirac', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;
  let userDataDir;

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-e2e-cmm-'));
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: REPO_ROOT,
      env: { ...stripElectronNodeMode(process.env), SAPHO_SKIP_SINGLE_INSTANCE: '1' },
      timeout: 30_000,
    });
    window = await waitForMainWindow(app);
    await window.waitForLoadState('load');
    // O Monaco é carregado sob demanda; a linguagem só existe depois disso.
    await window.waitForFunction(
      () => typeof window.monaco !== 'undefined'
        && window.monaco.languages.getLanguages().some((l) => l.id === 'cmm'),
      null, { timeout: 30_000 },
    );
  }, 90_000);

  afterAll(async () => {
    try { await app?.close(); } catch (_) { /* já morreu */ }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  });

  it('tokeniza cada construção sem erro', async () => {
    const falhas = await window.evaluate(async (linhas) => {
      const ruins = [];
      for (const linha of linhas) {
        try {
          // `tokenize` roda o Monarch de verdade; é aqui que a regra defeituosa
          // estourava, e não no registro da linguagem.
          const r = window.monaco.editor.tokenize(linha, 'cmm');
          if (!Array.isArray(r) || !r.length) ruins.push(`${linha} :: sem tokens`);
        } catch (e) {
          ruins.push(`${linha} :: ${e?.message || e}`);
        }
      }
      return ruins;
    }, LINHAS);

    expect(falhas).toEqual([]);
  }, 60_000);

  it('um arquivo inteiro no editor nao derruba o realce', async () => {
    // Tokenizar linha a linha e diferente de deixar o Monaco tokenizar um
    // modelo: o caminho real usa o tokenizador de fundo, que foi onde a pilha
    // de erro do relato apontava.
    const erro = await window.evaluate(async (linhas) => {
      const texto = linhas.join('\n');
      let capturado = null;
      const antes = window.onerror;
      window.onerror = (msg) => { capturado = String(msg); return true; };
      try {
        const modelo = window.monaco.editor.createModel(texto, 'cmm');
        // Força a tokenização de todas as linhas.
        for (let i = 1; i <= modelo.getLineCount(); i++) modelo.getLineTokens?.(i);
        await new Promise((r) => setTimeout(r, 400));
        modelo.dispose();
      } catch (e) {
        capturado = String(e?.message || e);
      } finally {
        window.onerror = antes;
      }
      return capturado;
    }, LINHAS);

    expect(erro).toBeNull();
  }, 60_000);
});
