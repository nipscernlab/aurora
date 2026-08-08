// @ts-check
/**
 * project_paths.js — leitura tolerante do `.spf` e reescrita de caminhos
 * absolutos quando um projeto ou um processador e renomeado.
 *
 * Extraido de main/ipc/project.js em 08/08/2026, sem mudanca de comportamento.
 * Duas razoes. Estas quatro funcoes sao puras e nao dependem do Electron, mas
 * viviam num modulo que carrega `app` no topo, entao nenhum teste as alcancava
 * — e elas sao a parte perigosa do arquivo: renomear um projeto move a pasta
 * inteira e reescreve todo caminho absoluto guardado no `.spf`, de modo que um
 * erro aqui corrompe o projeto de quem estava usando. A segunda razao e que
 * este e o primeiro corte da divisao pedida no item 7 do PENDENCIAS.
 *
 * Quem usa: main/ipc/project.js (rename de projeto e de processador).
 */

const path = require('path');

/**
 * Le o conteudo de um `.spf` tolerando sujeira.
 *
 * Um `.spf` e JSON, mas arquivo real pega BOM, virgula sobrando ou comentario
 * solto, por edicao a mao, por outra ferramenta, por escrita parcial ou por ter
 * vindo clonado de outra maquina. Primeiro tenta estrito; falhando, faz uma
 * passada lenient para que um projeto recuperavel abra em vez de morrer.
 * Espelha o spf_store.ts do lado do renderer.
 *
 * @param {string} content
 * @returns {any}
 */
function parseSpfTolerant(content) {
  try {
    return JSON.parse(content);
  } catch (_strictErr) {
    let inStr = false; let strCh = ''; let inLine = false; let inBlock = false; let out = '';
    for (let i = 0; i < content.length; i++) {
      const c = content[i]; const n = content[i + 1];
      if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
      if (inStr) { out += c; if (c === '\\') { out += content[i + 1] || ''; i++; } else if (c === strCh) inStr = false; continue; }
      if (c === '"') { inStr = true; strCh = c; out += c; continue; }
      if (c === '/' && n === '/') { inLine = true; i++; continue; }
      if (c === '/' && n === '*') { inBlock = true; i++; continue; }
      out += c;
    }
    const cleaned = out.replace(/^\s+/, '').replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned);
  }
}

/**
 * Reescreve um caminho absoluto que morava dentro da pasta de um processador
 * quando esse processador e renomeado de `oldName` para `newName`.
 *
 * So mexe em caminho DENTRO de `<projectDir>/<oldName>/`. O prefixo de
 * diretorio e reescrito, e o nome do arquivo so troca quando ele e um dos
 * artefatos que o SAPHO nomeia a partir do processador: `<old>.cmm`,
 * `<old>.asm`, `<old>.v` e `<old>_tb.v`. Arquivo nomeado pelo usuario dentro da
 * pasta mantem o nome e apenas acompanha a pasta. Caminho de fora volta
 * intocado.
 *
 * @param {any} p
 * @param {any} projectDir
 * @param {any} oldName
 * @param {any} newName
 */
function remapProcessorPath(p, projectDir, oldName, newName) {
  if (!p || typeof p !== 'string') return p;
  const toNative = (/** @type {any} */ s) => s.replace(/\//g, path.sep);
  const native = toNative(p);
  const oldDir = toNative(path.join(projectDir, oldName));
  const lower = native.toLowerCase();
  const oldLower = oldDir.toLowerCase();
  const inside = lower === oldLower || lower.startsWith(oldLower + path.sep.toLowerCase());
  if (!inside) return p;

  const rest = native.slice(oldDir.length); // '' ou '\Hardware\old.v'
  const out = path.join(projectDir, newName) + rest;

  // Troca so o nome dos artefatos nomeados pelo processador.
  const dir = path.dirname(out);
  const base = path.basename(out);
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const swapped = base.replace(
    new RegExp(`^${escaped}(_tb)?(\\.v|\\.sv|\\.asm|\\.cmm)$`, 'i'),
    (_m, /** @type {any} */ tb, /** @type {any} */ ext) => `${newName}${tb || ''}${ext}`,
  );
  return out === native && swapped === base ? out : path.join(dir, swapped);
}

/**
 * Reescreve um caminho absoluto que morava sob `oldRoot` para sob `newRoot`.
 * Comparacao de prefixo sem diferenciar maiuscula, porque Windows. Qualquer
 * coisa fora de `oldRoot` volta verbatim. Usado quando a pasta inteira do
 * projeto e renomeada.
 *
 * @param {any} p
 * @param {any} oldRoot
 * @param {any} newRoot
 */
function remapRootPath(p, oldRoot, newRoot) {
  if (!p || typeof p !== 'string') return p;
  const native = p.replace(/\//g, path.sep);
  const oldN = oldRoot.replace(/\//g, path.sep);
  const lower = native.toLowerCase();
  const oldLower = oldN.toLowerCase();
  if (lower === oldLower) return newRoot;
  if (lower.startsWith(oldLower + path.sep.toLowerCase())) {
    return newRoot + native.slice(oldN.length);
  }
  return p;
}

/**
 * Percorre um objeto inteiro e reescreve toda string que aponte para dentro de
 * `oldRoot`. Pega todo caminho absoluto persistido no `.spf`, incluindo listas
 * de arquivo e o cwd e o env dos command overrides, de modo que renomear um
 * projeto nao deixe caminho velho para tras. Muta o objeto no lugar.
 *
 * @param {any} obj
 * @param {any} oldRoot
 * @param {any} newRoot
 */
function deepRemapPaths(obj, oldRoot, newRoot) {
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') obj[i] = remapRootPath(obj[i], oldRoot, newRoot);
      else deepRemapPaths(obj[i], oldRoot, newRoot);
    }
  } else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'string') obj[k] = remapRootPath(obj[k], oldRoot, newRoot);
      else deepRemapPaths(obj[k], oldRoot, newRoot);
    }
  }
}

module.exports = { parseSpfTolerant, remapProcessorPath, remapRootPath, deepRemapPaths };
