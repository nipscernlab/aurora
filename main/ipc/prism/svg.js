// @ts-check
/**
 * SVG / skin rendering for PRISM. Loads the netlistsvg default skin merged
 * with project custom skins (assets/prism-skins/), prunes the netlist to
 * what each skin can draw, renders a module's JSON to SVG with netlistsvg,
 * and injects data-cell-type so the renderer can navigate on click.
 *
 * Split out of prism.js (2026-06); the public entry is
 * generateModuleSVGWithPaths — the rest are its helpers. See ./index.js.
 */

const path = require('path');
const fse = require('fs-extra');
const { app } = require('electron');
const log = require('electron-log');
// @ts-ignore -- @silimate/netlistsvg ships no type declarations
const netlistsvgLib = require('@silimate/netlistsvg');

const { sanitizeFileName } = require('../../utils');

// Skin default do pacote + merge de skins customizadas em assets/prism-skins/.
// Sem cache: re-le a cada compile pra que `Recompile` no PRISM ja mostre
// edicoes em SVGs custom sem precisar reiniciar o app (o cost de ler ~10
// arquivos pequenos por compile e' desprezivel).
//
// Por que merge em runtime em vez de editar node_modules/.../default.svg?
// `npm install` sobrescreve default.svg. Mantendo as customizacoes em
// assets/prism-skins/ a gente sobrevive a npm install e versionando no git.

// Extrai todo bloco `<g s:type="...">...</g>` de TOPO de um SVG, usando
// contagem de profundidade de tags `<g>` pra suportar `<g>` aninhados
// dentro de portas/labels (sem isso uma regex non-greedy quebraria em
// blocos como o `generic`, que tem `<g>...</g>` aninhados dentro).
function extractTopLevelGBlocks(/** @type {any} */ svgText) {
  const blocks = [];
  const tagRe = /<g\b[^>]*>|<\/g>/g;
  /** @type {any[]} */
  const stack = []; // entradas: { type, startIdx }
  let m;
  while ((m = tagRe.exec(svgText)) !== null) {
    const tag = m[0];
    if (tag === '</g>') {
      const open = stack.pop();
      if (open && open.type && stack.length === 0) {
        blocks.push({
          type: open.type,
          content: svgText.slice(open.startIdx, m.index + 4),
        });
      }
    } else if (!tag.endsWith('/>')) {
      // Tag de abertura nao self-closing. Pega `s:type` se existir.
      const typeMatch = tag.match(/\bs:type="([^"]+)"/);
      stack.push({ type: typeMatch ? typeMatch[1] : null, startIdx: m.index });
    }
    // Self-closing (`<g .../>`) nao entra na pilha.
  }
  return blocks;
}

async function loadCustomSkinBlocks(/** @type {any} */ customSkinDir) {
  if (!(await fse.pathExists(customSkinDir))) return [];
  const entries = (await fse.readdir(customSkinDir))
    .filter((f) => f.toLowerCase().endsWith('.svg') && !f.startsWith('_'))
    .sort();

  const merged = new Map(); // s:type -> content (ultimo arquivo a definir ganha)
  for (const file of entries) {
    try {
      const content = await fse.readFile(path.join(customSkinDir, file), 'utf-8');
      for (const block of extractTopLevelGBlocks(content)) {
        if (block.type) merged.set(block.type, block.content);
      }
    } catch (err) {
      log.warn(`[PRISM] Skipping malformed custom skin ${file}:`, err instanceof Error ? err.message : String(err));
    }
  }
  return [...merged.entries()];
}

async function getDefaultSkinData() {
  const libIndex = require.resolve('@silimate/netlistsvg');
  const skinPath = path.join(path.dirname(libIndex), '..', 'lib', 'default.svg');
  let skin = await fse.readFile(skinPath, 'utf-8');

  const customSkinDir = path.join(app.getAppPath(), 'assets', 'prism-skins');
  const customBlocks = await loadCustomSkinBlocks(customSkinDir);
  if (customBlocks.length === 0) return skin;

  // Pra cada custom, remove `<g s:type="X">` existente na skin default e
  // injeta o customizado logo antes de `</svg>`.
  for (const [type, content] of customBlocks) {
    const existing = extractTopLevelGBlocks(skin).find((b) => b.type === type);
    if (existing) skin = skin.replace(existing.content, '');
    skin = skin.replace('</svg>', `\n  ${content.trim()}\n</svg>`);
  }
  return skin;
}

// Constroi um mapa instanceName -> moduleType a partir do JSON do
// yosys do modulo atual. netlistsvg renderiza o label de cada cell
// com s:attribute="ref" (o NOME DA INSTANCIA), nao com o tipo — entao
// o renderer nao consegue saber pra qual modulo navegar olhando so o
// SVG. O fix e' injetar data-cell-type=<tipo> em cada <g id="cell_<inst>">
// abaixo, antes de devolver o SVG.
function buildInstanceTypeMap(/** @type {any} */ netlistJson) {
  const map = new Map();
  if (!netlistJson?.modules) return map;
  for (const moduleData of Object.values(netlistJson.modules)) {
    if (!moduleData?.cells) continue;
    for (const [instName, cellData] of Object.entries(moduleData.cells)) {
      if (cellData?.type) map.set(instName, cellData.type);
    }
  }
  return map;
}

// Escape minimo pra valor de atributo XML — basta cobrir `"`, `&` e `<`
// (path/identificador yosys raramente tem esses, mas defensivo).
function xmlAttrEscape(/** @type {any} */ s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Injeta data-cell-type=<tipo> em cada <g id="cell_<inst>"> do SVG.
// Regex em vez de parse XML real porque (a) overkill, (b) a forma do
// output do netlistsvg e' previsivel (id="cell_..." sempre em <g>).
function injectCellTypesIntoSvg(/** @type {any} */ svgString, /** @type {any} */ instanceTypeMap) {
  if (instanceTypeMap.size === 0) return svgString;
  return svgString.replace(
    /<g\b([^>]*?)\sid="cell_([^"]+)"([^>]*?)(\/?>)/g,
    (/** @type {any} */ match, /** @type {any} */ before, /** @type {any} */ instName, /** @type {any} */ after, /** @type {any} */ close) => {
      const type = instanceTypeMap.get(instName);
      if (!type) return match;
      return `<g${before} id="cell_${instName}"${after} data-cell-type="${xmlAttrEscape(type)}"${close}`;
    },
  );
}

// Mapa tipo-de-cell -> Set de portas (s:pid) que a skin custom desenha.
// Uma skin custom tem um conjunto FIXO de portas; netlistsvg so cria a
// shape das portas que a skin declara.
function buildSkinPortMap(/** @type {any} */ skinData) {
  const map = new Map();
  for (const block of extractTopLevelGBlocks(skinData)) {
    if (!block.type) continue;
    const pids = new Set();
    for (const m of block.content.matchAll(/\bs:pid="([^"]+)"/g)) pids.add(m[1]);
    map.set(block.type, pids);
  }
  return map;
}

// Remove de cada cell as conexoes cujo port NAO existe na skin custom do
// seu tipo. Sem isso, uma porta presente no RTL mas ausente da skin (ex:
// o core ganhou `cheguei` mas core.svg nao tem o anchor) faz o netlistsvg
// gerar uma ARESTA pra uma shape de porta que ele nunca desenhou — e o ELK
// aborta com "Referenced shape does not exist: <cell>.<port>", derrubando
// TODO o render do modulo. Podar alinha o JSON ao que a skin sabe desenhar:
// a porta extra apenas nao aparece (com aviso), em vez de quebrar a tela.
// Cells de tipo generico (sem skin) nao sao tocadas — la o netlistsvg cria
// as portas a partir das proprias conexoes, entao nunca ficam penduradas.
function pruneNetlistToSkinPorts(/** @type {any} */ netlistJson, /** @type {any} */ skinPortMap) {
  if (!netlistJson?.modules) return;
  for (const moduleData of Object.values(netlistJson.modules)) {
    for (const [cellName, cell] of Object.entries(moduleData.cells || {})) {
      const allowed = skinPortMap.get(cell.type);
      if (!allowed || !cell.connections) continue;
      for (const port of Object.keys(cell.connections)) {
        if (allowed.has(port)) continue;
        delete cell.connections[port];
        if (cell.port_directions) delete cell.port_directions[port];
        log.warn(
          `[PRISM] cell "${cellName}" (${cell.type}): porta "${port}" nao esta na skin ` +
          `assets/prism-skins/${cell.type}.svg — omitida do esquematico ` +
          `(adicione um <g s:pid="${port}"/> na skin pra desenha-la).`,
        );
      }
    }
  }
}

async function generateModuleSVGWithPaths(/** @type {any} */ moduleName, /** @type {any} */ tempDir) {
  const cleanName = sanitizeFileName(moduleName);
  const inputJsonPath = path.join(tempDir, `${cleanName}.json`);
  const outputSvgPath = path.join(tempDir, `${cleanName}.svg`);

  if (!(await fse.pathExists(inputJsonPath))) {
    throw new Error(`Module JSON file not found: ${inputJsonPath}`);
  }

  const [skinData, netlistJson] = await Promise.all([
    getDefaultSkinData(),
    fse.readJson(inputJsonPath),
  ]);

  // Alinha o netlist ao que as skins custom conseguem desenhar (ver
  // pruneNetlistToSkinPorts) ANTES de renderizar — evita o abort do ELK
  // "Referenced shape does not exist" quando o RTL tem porta que a skin nao.
  pruneNetlistToSkinPorts(netlistJson, buildSkinPortMap(skinData));

  // lib.render usa callback (err, svgString) — wrap em Promise. Sem spawn
  // de processo, sem .exe externo: fica tudo in-process.
  const rawSvg = await new Promise((resolve, reject) => {
    netlistsvgLib.render(skinData, netlistJson, (/** @type {any} */ err, /** @type {any} */ svg) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });

  // Defensivo: se o layout falhar de outra forma e devolver vazio, falha
  // com mensagem clara em vez de estourar um TypeError no inject (.replace
  // de undefined) — esse era o sintoma "clicar no modulo nao faz nada".
  if (typeof rawSvg !== 'string' || !rawSvg) {
    throw new Error(`netlistsvg nao produziu SVG para o modulo "${moduleName}" (falha de layout)`);
  }

  const svgString = injectCellTypesIntoSvg(rawSvg, buildInstanceTypeMap(netlistJson));
  await fse.writeFile(outputSvgPath, svgString, 'utf-8');
  return outputSvgPath;
}

module.exports = { generateModuleSVGWithPaths };
