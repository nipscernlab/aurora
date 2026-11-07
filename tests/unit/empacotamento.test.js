/**
 * O que o build.files do package.json leva para o instalador.
 *
 * O electron-builder le a lista em ordem e o ultimo padrao que casa decide,
 * como num .gitignore: e por isso que o codex-sdk, excluido por
 * "!@openai/codex-*", volta logo depois. Este teste reproduz essa regra com o
 * path.matchesGlob do Node para fixar o que entra e o que fica de fora sem rodar um build.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const pacote = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const padroes = pacote.build.files;

function entra(caminho) {
  let dentro = false;
  for (const p of padroes) {
    const nega = p.startsWith('!');
    if (posix.matchesGlob(caminho, nega ? p.slice(1) : p)) dentro = !nega;
  }
  return dentro;
}

describe('build.files', () => {
  it('leva o JS do codex-sdk, que o codex_agent importa', () => {
    expect(entra('node_modules/@openai/codex-sdk/dist/index.js')).toBe(true);
    expect(entra('node_modules/@openai/codex-sdk/package.json')).toBe(true);
  });

  it('deixa de fora a copia do Codex que o codex-sdk traz dentro de si', () => {
    // O codex_agent sempre passa codexPathOverride com o CLI que o
    // cli_downloader baixa, entao essa copia (uns 480 MB) nunca roda.
    expect(entra('node_modules/@openai/codex-sdk/node_modules/@openai/codex/package.json')).toBe(false);
    expect(entra('node_modules/@openai/codex-sdk/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/codex/codex.exe')).toBe(false);
  });

  it('continua deixando de fora o Codex do topo e o binario de plataforma', () => {
    expect(entra('node_modules/@openai/codex/package.json')).toBe(false);
    expect(entra('node_modules/@openai/codex-win32-x64/package.json')).toBe(false);
  });
});
