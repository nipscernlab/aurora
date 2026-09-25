/**
 * deadcode.mts: o knip (arquivos e dependencias sem uso) sobre a arvore como
 * ela esta no git, sem os .js que o build:ts gera.
 *
 * POR QUE NAO E SO `knip`
 * -----------------------
 * Cada .ts do repositorio ganha um .js ao lado, gerado e posto no .gitignore.
 * O resolvedor do knip tenta .js antes de .ts, sem opcao para mudar a ordem, e
 * o .js gerado fica fora da analise por estar no .gitignore. Resultado: todo
 * `require('./x')` parava no x.js ignorado, o x.ts aparecia como arquivo sem
 * uso, e uma dependencia usada so por um .ts (o simple-git, depois que o
 * ipc/git foi convertido) aparecia como dependencia sem uso.
 *
 * Entao os .js gerados saem antes do knip e voltam depois, pelo proprio
 * build:ts, que os recria em cerca de um segundo. Sai so o que o git ignora E
 * tem um .ts do mesmo nome ao lado: nada que esteja versionado e tocado.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Os .js gerados: ignorados pelo git e com um .ts irmao. `ignorados` e a saida
 * de `git ls-files -o -i --exclude-standard`, `existe` diz se um caminho existe.
 */
export function jsGerados(ignorados: string[], existe: (rel: string) => boolean): string[] {
  return ignorados
    .map((l) => l.trim())
    .filter((rel) => /\.js$/.test(rel) && /^(js|main|html)\//.test(rel))
    .filter((rel) => existe(rel.replace(/\.js$/, '.ts')))
    .sort();
}

/* v8 ignore start */ // a cola da linha de comando: git, apagar, knip, recompilar
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cwd = process.cwd();
  const ignorados = execFileSync('git', ['ls-files', '-o', '-i', '--exclude-standard', '--', 'js', 'main', 'html'], { cwd, encoding: 'utf8' }).split('\n');
  const gerados = jsGerados(ignorados, (rel) => fs.existsSync(path.join(cwd, rel)));
  for (const rel of gerados) fs.rmSync(path.join(cwd, rel), { force: true });
  let codigo = 1;
  try {
    const r = spawnSync('npx', ['knip', '--include', 'files,dependencies', '--no-config-hints', ...process.argv.slice(2)], { cwd, stdio: 'inherit', shell: true });
    codigo = r.status ?? 1;
  } finally {
    const b = spawnSync('npm', ['run', '-s', 'build:ts'], { cwd, stdio: 'inherit', shell: true });
    if (b.status !== 0) {
      console.error('[deadcode] o build:ts nao recriou os .js gerados; rode npm run build:ts');
      codigo = codigo || 1;
    }
  }
  process.exit(codigo);
}
/* v8 ignore stop */
