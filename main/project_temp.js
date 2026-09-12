// @ts-check
/**
 * project_temp.js: a Temp de cada projeto, do lado do processo principal.
 *
 * Os intermediarios de compilacao moram em <projeto>/.aurora/Temp desde
 * 09/2026 (ver js/project/project_temp.js para o porque). Quem escreve la e o
 * renderer; o que fica para o main sao as duas coisas que so ele consegue
 * fazer bem:
 *
 *   - marcar a pasta como oculta no Windows, para ela nao aparecer no
 *     Explorer no meio dos arquivos do aluno (na arvore da AURORA ela ja e
 *     escondida por files_ops.entradaOcultaNaArvore);
 *   - podar. A pasta nao e mais apagada a cada saida, como era a
 *     components/Temp, porque o obj_dir do Verilator vale 5 a 15 s de build
 *     por clique e o make dele so reaproveita o que sobreviveu. Em troca,
 *     alguem tem que impedir que ela cresca sem fim, e esse alguem e a poda
 *     de cada abertura de projeto: fora o que passou da idade, e depois o
 *     mais antigo primeiro ate caber no teto.
 *
 * Tudo aqui e melhor esforco. Uma poda que falha nao pode impedir um projeto
 * de abrir, entao nada lanca: registra e segue.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const log = require('electron-log');

/** Os mesmos segmentos de js/project/project_temp.js. */
const SEGMENTOS = ['.aurora', 'Temp'];

/** Uma semana sem uso e o suficiente para um intermediario ter virado lixo. */
const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;
/** Meio gigabyte por projeto: cabe uns quantos obj_dir e nenhum HD sente. */
const TETO_BYTES = 512 * 1024 * 1024;

/**
 * `<projectDir>/.aurora/Temp`.
 * @param {string} projectDir
 */
function tempDoProjeto(projectDir) {
  return path.join(projectDir, ...SEGMENTOS);
}

/**
 * Tamanho total e data mais recente de uma entrada (arquivo ou arvore).
 * A data mais recente e a que importa: um obj_dir com um .o de hoje e um
 * Makefile de mes passado esta em uso hoje.
 * @param {string} p
 * @returns {{ bytes: number, mtimeMs: number }}
 */
function medir(p) {
  let bytes = 0;
  let mtimeMs = 0;
  /** @param {string} q */
  const visitar = (q) => {
    let st;
    try { st = fs.lstatSync(q); } catch (_) { return; }
    if (st.mtimeMs > mtimeMs) mtimeMs = st.mtimeMs;
    if (st.isDirectory()) {
      let nomes;
      try { nomes = fs.readdirSync(q); } catch (_) { return; }
      for (const n of nomes) visitar(path.join(q, n));
    } else {
      bytes += st.size;
    }
  };
  visitar(p);
  return { bytes, mtimeMs };
}

/**
 * Poda uma pasta Temp: apaga as entradas de primeiro nivel que passaram da
 * idade e, se o que sobrou ainda passa do teto, as mais antigas ate caber.
 *
 * Trabalha por entrada de primeiro nivel de proposito. E nesse nivel que os
 * intermediarios se agrupam (um obj_dir_<tb>/ por testbench, uma pasta por
 * processador, um .vvp por topo), entao apagar uma entrada inteira nunca
 * deixa um build pela metade, que e o que aconteceria apagando arquivo a
 * arquivo dentro de um obj_dir.
 *
 * Pura fora do disco: recebe `agora` e os limites para o teste nao depender
 * do relogio nem de encher meio gigabyte.
 *
 * @param {string} dir a pasta Temp
 * @param {{ agora?: number, idadeMaximaMs?: number, tetoBytes?: number }} [opts]
 * @returns {{ removidos: string[], bytesAntes: number, bytesDepois: number }}
 */
function podarTemp(dir, opts = {}) {
  const agora = opts.agora ?? Date.now();
  const idadeMaximaMs = opts.idadeMaximaMs ?? IDADE_MAXIMA_MS;
  const tetoBytes = opts.tetoBytes ?? TETO_BYTES;
  const removidos = /** @type {string[]} */ ([]);

  let nomes;
  try { nomes = fs.readdirSync(dir); } catch (_) {
    return { removidos, bytesAntes: 0, bytesDepois: 0 };
  }

  const entradas = nomes.map((n) => {
    const p = path.join(dir, n);
    return { p, ...medir(p) };
  });
  const bytesAntes = entradas.reduce((s, e) => s + e.bytes, 0);

  /** @param {{ p: string }} e */
  const apagar = (e) => {
    try {
      fs.rmSync(e.p, { recursive: true, force: true, maxRetries: 2 });
      removidos.push(e.p);
      return true;
    } catch (err) {
      log.warn('[project-temp] nao consegui apagar', e.p, err instanceof Error ? err.message : err);
      return false;
    }
  };

  // 1) Idade: o que ninguem toca ha uma semana.
  let vivas = entradas.filter((e) => {
    if (agora - e.mtimeMs <= idadeMaximaMs) return true;
    return !apagar(e);
  });

  // 2) Teto: mais antigo primeiro, ate caber.
  let total = vivas.reduce((s, e) => s + e.bytes, 0);
  vivas.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const e of vivas) {
    if (total <= tetoBytes) break;
    if (apagar(e)) total -= e.bytes;
  }

  return { removidos, bytesAntes, bytesDepois: total };
}

/**
 * O que dentro de `.aurora` o git deve ignorar, escrito DENTRO dela.
 *
 * Um `.gitignore` aninhado vale para a propria pasta, entao isto resolve o
 * projeto que ja existia sem tocar no `.gitignore` da raiz, que e do usuario.
 * O botao "New .gitignore" tambem escreve a linha na raiz, mas so em projeto
 * novo; quem ja tinha um ficaria com a Temp aparecendo no `git status` para
 * sempre.
 *
 * `memory/` fica de FORA da lista de proposito: e a memoria de projeto da
 * Aurora Intelligence, escrita por gente, e uma equipe pode querer versiona-la.
 * Ignorado e so o que a maquina gera.
 */
const GITIGNORE_DA_AURORA = [
  '# Gerado pela AURORA. Intermediarios de compilacao e registro de execucoes:',
  '# saem da maquina de quem compilou e nao valem para mais ninguem.',
  '# A pasta memory/ NAO entra aqui, ela e conteudo e pode ser versionada.',
  'Temp/',
  'execucoes/',
  '',
].join('\n');

/**
 * Garante o `.gitignore` de dentro da `.aurora`.
 *
 * Nao sobrescreve um que ja exista com conteudo: se alguem editou aquilo a
 * mao, a edicao vale mais do que o nosso padrao.
 * @param {string} projectDir
 */
function garantirGitignoreDaAurora(projectDir) {
  const alvo = path.join(projectDir, SEGMENTOS[0], '.gitignore');
  try {
    if (fs.existsSync(alvo) && fs.readFileSync(alvo, 'utf8').trim() !== '') return;
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, GITIGNORE_DA_AURORA, 'utf8');
  } catch (e) {
    log.debug('[project-temp] nao consegui escrever o .gitignore da .aurora:', e instanceof Error ? e.message : e);
  }
}

/**
 * Marca `<projectDir>/.aurora` como oculta no Windows. Melhor esforco, fora
 * do Windows nao faz nada (o ponto no nome ja esconde nos outros sistemas).
 * @param {string} projectDir
 * @returns {Promise<void>}
 */
function ocultarNoWindows(projectDir) {
  if (process.platform !== 'win32') return Promise.resolve();
  const alvo = path.join(projectDir, SEGMENTOS[0]);
  return new Promise((resolve) => {
    execFile('attrib', ['+h', alvo], { windowsHide: true, timeout: 3000 }, (err) => {
      if (err) log.debug('[project-temp] attrib +h falhou:', err.message);
      resolve();
    });
  });
}

/**
 * O que roda a cada abertura de projeto: garante a pasta, esconde-a, poda.
 * Fora do caminho critico de quem chamou (setImmediate) e sem lancar.
 * @param {string} projectDir
 */
function prepararTempDoProjeto(projectDir) {
  if (!projectDir) return;
  setImmediate(() => {
    const dir = tempDoProjeto(projectDir);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* disco so leitura: a compilacao vai reclamar no lugar certo */ }
    garantirGitignoreDaAurora(projectDir);
    ocultarNoWindows(projectDir).catch(() => {});
    try {
      const r = podarTemp(dir);
      if (r.removidos.length) {
        log.info(`[project-temp] poda em ${dir}: ${r.removidos.length} entradas, `
          + `${(r.bytesAntes / 1048576).toFixed(1)} MB -> ${(r.bytesDepois / 1048576).toFixed(1)} MB`);
      }
    } catch (err) {
      log.warn('[project-temp] poda falhou:', err instanceof Error ? err.message : err);
    }
  });
}

module.exports = {
  SEGMENTOS, IDADE_MAXIMA_MS, TETO_BYTES, GITIGNORE_DA_AURORA,
  tempDoProjeto, podarTemp, garantirGitignoreDaAurora, prepararTempDoProjeto,
};
