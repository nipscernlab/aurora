// @ts-check
/**
 * pylib_paths.js: onde as bibliotecas Python instaladas moram.
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
 * A variavel AURORA_PYLIBS_ROOT redireciona a arvore inteira, e o mesmo recurso
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

/** O diretorio importavel, e ele que entra no PYTHONPATH. */
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

/**
 * O site-packages do interpretador embarcado.
 *
 * Varre por `python3.*` em vez de fixar `python3.12` para sobreviver a um bump
 * de versao menor do bundle. Devolve '' quando o bundle nao esta instalado.
 */
function bundleSitePackages() {
  // Valvula de teste, no mesmo padrao de AURORA_PYLIBS_ROOT e AURORA_CLI_CACHE,
  // para exercitar a ligacao com o interpretador sem depender do bundle real.
  //
  // A existencia e conferida mesmo aqui. Um caminho apontado e inexistente
  // significa a mesma coisa que bundle ausente, e devolve-lo faria o resto do
  // codigo trabalhar sobre um diretorio que nao esta la, trocando uma falha
  // limpa por um erro de escrita mais adiante.
  if (process.env.AURORA_BUNDLE_SITE) {
    return fs.existsSync(process.env.AURORA_BUNDLE_SITE)
      ? process.env.AURORA_BUNDLE_SITE
      : '';
  }

  let componentsPath;
  try {
    ({ componentsPath } = require('../paths'));
  } catch (_) {
    return '';
  }
  const libBase = path.join(componentsPath, 'Packages', 'msys', 'mingw64', 'lib');
  let entries;
  try {
    entries = fs.readdirSync(libBase);
  } catch (_) {
    return '';
  }
  for (const name of entries) {
    if (!/^python3\./i.test(name)) continue;
    const sp = path.join(libBase, name, 'site-packages');
    if (fs.existsSync(sp)) return sp;
  }
  return '';
}

/**
 * O arquivo `.pth` que liga o PyLibs ao interpretador.
 *
 * POR QUE UM .pth E NAO UMA VARIAVEL DE AMBIENTE
 * ---------------------------------------------
 * O Python le, na inicializacao, todo arquivo `.pth` que encontra no proprio
 * site-packages, e acrescenta ao sys.path as pastas listadas neles. Isso resolve
 * de uma vez os dois requisitos:
 *
 *   ALCANCE , vale para QUALQUER execucao deste interpretador: o runner do
 *              cocotb, um `.py` solto do projeto, uma linha digitada no TCMD.
 *              Nao depende de quem chamou nem de exportar variavel.
 *
 *   ISOLAMENTO, vale SO para este interpretador. O `site.py` de cada Python le
 *              apenas os `.pth` do site-packages dele. O Python que o usuario
 *              tem instalado na maquina nunca enxerga o nosso PyLibs, entao nao
 *              ha colisao possivel com o que ele instalou por pip.
 *
 * Uma variavel PYTHONPATH no ambiente do terminal faria o oposto: seria lida por
 * QUALQUER python que rodasse ali, inclusive o do usuario. E exatamente a
 * colisao que se quer evitar.
 *
 * O arquivo mora dentro do bundle, que e artefato descartavel, de proposito.
 * Ele nao e estado: e um ponteiro de uma linha, recriado na abertura do app. Se
 * a toolchain for re-baixada e levar o ponteiro embora, ele volta sozinho. O
 * argumento que mantem as BIBLIOTECAS fora do bundle nao se aplica aqui, porque
 * nada se perde se este arquivo desaparecer.
 */
function sitePthFile() {
  const sp = bundleSitePackages();
  return sp ? path.join(sp, 'aurora-pylibs.pth') : '';
}

module.exports = {
  pylibRoot,
  pylibSite,
  manifestFile,
  stagingDir,
  ensureDirs,
  bundleSitePackages,
  sitePthFile,
};
