// @ts-check
/**
 * pylib_paths.js — onde as bibliotecas Python instaladas moram.
 *
 * A DECISAO E O MOTIVO
 * --------------------
 * As bibliotecas NAO vao para o site-packages do bundle
 * (components/Packages/msys/mingw64/lib/python3.12/site-packages).
 *
 * Aquela pasta pertence a toolchain: ela e baixada pelo bootstrap, o
 * scripts/verify-components.js re-baixa por cima quando o componente esta
 * faltando ou desatualizado, e o components/Packages/ inteiro e gitignored
 * justamente por ser artefato derivado, descartavel. Instalar estado do usuario
 * la dentro daria dois problemas concretos:
 *
 *   1. Um `--force` do downloader extrai o bundle novo por cima. O que ele
 *      sobrescreve fica novo, o que ele nao conhece fica velho, e nao sobra
 *      jeito de distinguir biblioteca instalada de arquivo do bundle.
 *   2. Quem apaga components/Packages/ para resolver um problema de toolchain
 *      (que e o conserto documentado) perde todas as bibliotecas sem aviso.
 *
 * Por isso existe uma raiz separada, `components/PyLibs/`, com dono unico: este
 * modulo. O bundle continua intocado e reinstalavel a qualquer momento, e as
 * bibliotecas continuam existindo depois disso.
 *
 * COMO O PYTHON ENXERGA
 * ---------------------
 * Sem pip nem ensurepip no runtime embarcado, venv nao e uma opcao real. O
 * isolamento aqui e por diretorio + PYTHONPATH: `PyLibs/site/` entra no
 * AURORA_COCOTB_PYTHONPATH e o runner gerado insere no sys.path. Efeito pratico
 * igual ao de um site-packages, sem tocar no do bundle.
 */

'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Raiz de tudo que o instalador de bibliotecas possui.
 *
 * A variavel AURORA_PYLIBS_ROOT redireciona a arvore inteira — e o mesmo recurso
 * que o cli_downloader expoe via AURORA_CLI_CACHE, e existe pelo mesmo motivo:
 * os testes precisam de um destino descartavel, e `main/paths.js` depende do
 * `app.getAppPath()` do Electron, que nao existe fora do app.
 */
function pylibRoot() {
  if (process.env.AURORA_PYLIBS_ROOT) return process.env.AURORA_PYLIBS_ROOT;
  // require tardio: fora do Electron (testes, scripts) o modulo nem carrega.
  const { componentsPath } = require('../paths');
  return path.join(componentsPath, 'PyLibs');
}

/** O diretorio importavel — e ele que entra no PYTHONPATH. */
function pylibSite() {
  return path.join(pylibRoot(), 'site');
}

/** Manifesto do que esta instalado (por maquina, nunca commitado). */
function manifestFile() {
  return path.join(pylibRoot(), 'installed.json');
}

/** Area de trabalho para wheels em transito. */
function stagingDir() {
  return path.join(pylibRoot(), '.staging');
}

/** Cria a arvore se ainda nao existir. Idempotente. */
function ensureDirs() {
  fs.mkdirSync(pylibSite(), { recursive: true });
  return { root: pylibRoot(), site: pylibSite() };
}

module.exports = { pylibRoot, pylibSite, manifestFile, stagingDir, ensureDirs };
