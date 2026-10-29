#!/usr/bin/env node
/**
 * check-manual-version.mts: a trava de publicacao do manual.
 *
 * Na PR de release, falha se o manual publicado nao documenta a versao que a
 * PR vai lancar. Em qualquer outra PR, ou num push, nao faz nada.
 *
 *     node scripts/check-manual-version.mts      (a CI passa HEAD_REF)
 *
 * Por que existe
 * --------------
 * A AURORA saiu varias vezes com o manual versoes atras, e a Aurora
 * Intelligence consulta e cita esse manual. O vigia do docs_aurora so abre
 * issue depois que a release ja saiu; esta trava fica antes, na PR que a
 * publica (GUIDELINES.md do nipscernlab/.github, secao 5).
 *
 * A versao que sai e a do package.json, que o release-please sobe na propria
 * PR. A do manual vem do manifesto publicado, o mesmo que o download-docs.js
 * baixa. O manual usa um quarto segmento como revisao propria (7.0.0.1
 * documenta a 7.0.0), entao a comparacao olha os tres primeiros, como o vigia.
 *
 * Diferente do download-docs.js, a falta de rede aqui reprova: trava que
 * abre quando nao consegue conferir nao trava nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_URL = 'https://nipscernlab.github.io/docs_aurora/docs-manifest.json';

/** A branch que o release-please abre: release-please--branches--main--... */
export function ehPrDeRelease(branch: string | undefined): boolean {
  return Boolean(branch && branch.startsWith('release-please--'));
}

/** Os tres primeiros segmentos da versao do manual: 7.0.0.1 -> 7.0.0. */
export function baseDoManual(versao: string): string {
  return versao.split('.').slice(0, 3).join('.');
}

/** null quando o manual documenta a versao que sai; senao, a mensagem do erro. */
export function conferirManual(release: string, manual: string | null): string | null {
  if (!manual) return `Could not read the published manual version from ${MANIFEST_URL}.`;
  const base = baseDoManual(manual);
  if (base === release) return null;
  return `This release is ${release}, but the published manual documents ${base} (manifest: ${manual}). `
    + 'Publish the manual for this version in nipscernlab/docs_aurora, then re-run this check.';
}

/* v8 ignore start */ // a cola da linha de comando: le a versao, baixa o manifesto
async function versaoDoManual(): Promise<string | null> {
  try {
    const resposta = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!resposta.ok) return null;
    const manifesto = await resposta.json() as { version?: unknown };
    return typeof manifesto.version === 'string' ? manifesto.version : null;
  } catch { return null; }
}

async function main() {
  const branch = process.env.HEAD_REF;
  if (!ehPrDeRelease(branch)) {
    console.log('[check-manual-version] not a release pull request; nothing to check.');
    return;
  }
  const pacote = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string };
  const manual = await versaoDoManual();
  const erro = conferirManual(pacote.version, manual);
  if (erro) {
    console.error(`[check-manual-version] ${erro}`);
    process.exit(1);
  }
  console.log(`[check-manual-version] the published manual (${manual}) documents ${pacote.version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
/* v8 ignore stop */
