#!/usr/bin/env node
/**
 * gen-prism-skins.js: baseline PRISM skin generator + inventory.
 *
 * PRISM (the RTL viewer) renders each Verilog cell through a netlistsvg skin.
 * A module WITHOUT a custom skin falls back to the plain `generic` box. This
 * script walks the SAPHO HDL (`components/HDL/*.v`), extracts every module's
 * REAL synthesised port list, and emits a clean baseline skin for each module
 * that doesn't already have a hand-crafted one, so the whole datapath gets a
 * proper labelled symbol with correctly-anchored ports. The visual design is
 * intentionally neutral (a rounded box, inputs left / outputs right): it is the
 * scaffold for the later by-hand redesign pass, not the final art.
 *
 * It also writes `assets/prism-skins/COMPONENTS.md`, the full inventory of
 * every component PRISM can skin (netlistsvg primitives + SAPHO modules).
 *
 *   node scripts/gen-prism-skins.js          # generate + inventory
 *   node scripts/gen-prism-skins.js --check  # report only, write nothing
 *
 * Idempotent: hand-crafted skins (and any baseline a human later redesigns and
 * removes the AUTO-GENERATED marker from) are never overwritten.
 *
 * KEY CORRECTNESS RULE, ports guarded by `\`ifdef YANC_SIM_VIS` (the
 * simulation-visibility taps like `sim`) are EXCLUDED: yosys reads the Verilog
 * without that define for PRISM, so those ports aren't in the netlist. Emitting
 * an anchor for them would make ELK abort with "Referenced shape does not
 * exist" (see pruneNetlistToSkinPorts in main/ipc/prism.js).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const HDL_DIR = path.join(REPO, 'components', 'HDL');
const SKIN_DIR = path.join(REPO, 'assets', 'prism-skins');
const AUTO_MARK = 'AUTO-GENERATED baseline skin (gen-prism-skins.js)';

const CHECK_ONLY = process.argv.includes('--check');

/* netlistsvg built-in cell types (lib/default.svg). These render via the
 * stock skin or the hand-made gate skins already in assets/prism-skins/. Listed
 * in the inventory for completeness; the generator never touches them. */
const NETLISTSVG_PRIMITIVES = [
  '_AOI3_', '_AOI4_', '_OAI3_', '_OAI4_', 'add', 'and', 'andnot', 'buf',
  'constant', 'dff', 'dff-bus', 'dffn', 'dffn-bus', 'div', 'dlatch',
  'dlatch-bus', 'dlatchn', 'dlatchn-bus', 'eq', 'ge', 'generic', 'gt',
  'inputExt', 'join', 'le', 'lt', 'mod', 'mul', 'mux', 'mux-bus', 'nand',
  'ne', 'neg', 'not', 'or', 'ornot', 'outputExt', 'pos', 'pow', 'reduce_nor',
  'reduce_nxor', 'reduce_xor', 'shl', 'shr', 'split', 'sshl', 'sshr', 'sub',
  'tribuf',
];

/* ── Verilog port extraction ─────────────────────────────────────────────── */

/** Remove Verilog block comments and line comments. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/** Find the matching close paren for the `(` at `open` (depth-counted). */
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Pull the port-list text of a module: skip an optional `#( … )` parameter
 * block, then capture the next balanced `( … )`. Returns the inner text.
 */
function portListText(src, afterName) {
  let i = afterName;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === '#') {                 // parameter block — skip it
    const popen = src.indexOf('(', i);
    if (popen < 0) return '';
    i = matchParen(src, popen) + 1;
    while (i < src.length && /\s/.test(src[i])) i++;
  }
  if (src[i] !== '(') return '';
  const close = matchParen(src, i);
  if (close < 0) return '';
  return src.slice(i + 1, close);
}

/** Drop `\`ifdef … \`endif` regions (the sim-only ports live there). */
function dropIfdefRegions(text) {
  const out = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    if (/^\s*`(ifdef|ifndef|if)\b/.test(line)) { depth++; continue; }
    if (/^\s*`endif\b/.test(line)) { if (depth > 0) depth--; continue; }
    if (/^\s*`(else|elsif)\b/.test(line)) continue;
    if (depth === 0) out.push(line);
  }
  return out.join('\n');
}

const DIR_RE = /^(input|output|inout)\b/;
const KEYWORD_RE = /\b(input|output|inout|reg|wire|logic|signed|unsigned|integer)\b/g;

/** Parse `dir [width] a, b, …` ANSI port text → [{name, dir}]. */
function parsePorts(portText) {
  const clean = dropIfdefRegions(portText);
  // Split on commas that are NOT inside [ ] width brackets.
  const segments = [];
  let depth = 0, buf = '';
  for (const ch of clean) {
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { segments.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf.trim()) segments.push(buf);

  const ports = [];
  let curDir = 'input';
  for (let seg of segments) {
    seg = seg.trim();
    if (!seg) continue;
    const dm = seg.match(DIR_RE);
    if (dm) curDir = dm[1];
    // name = last identifier after stripping keywords, widths and defaults
    const name = seg
      .replace(/=[^,]*/g, ' ')        // drop `= default`
      .replace(/\[[^\]]*\]/g, ' ')    // drop widths
      .replace(KEYWORD_RE, ' ')
      .trim()
      .split(/\s+/)
      .pop();
    if (name && /^[A-Za-z_]\w*$/.test(name)) {
      ports.push({ name, dir: curDir });
    }
  }
  return ports;
}

/** Extract every `module NAME … ( ports );` from one .v file. */
function modulesInFile(src) {
  const clean = stripComments(src);
  const mods = [];
  const re = /\bmodule\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(clean))) {
    const ports = parsePorts(portListText(clean, m.index + m[0].length));
    mods.push({ name: m[1], ports });
  }
  return mods;
}

/* ── Existing-skin coverage ──────────────────────────────────────────────── */

/** s:type + s:alias values already claimed by a skin file. */
function coveredTypes() {
  const covered = new Map(); // type -> skin filename
  for (const f of fs.readdirSync(SKIN_DIR)) {
    if (!f.endsWith('.svg')) continue;
    const txt = fs.readFileSync(path.join(SKIN_DIR, f), 'utf8');
    const auto = txt.includes(AUTO_MARK);
    for (const mm of txt.matchAll(/s:type="([^"]+)"/g)) covered.set(mm[1], { file: f, auto });
    for (const mm of txt.matchAll(/<s:alias val="([^"]+)"/g)) {
      covered.set(mm[1].replace(/^\$/, ''), { file: f, auto });
    }
  }
  return covered;
}

/* ── Baseline skin emitter ───────────────────────────────────────────────── */

const PORT_PITCH = 18;
const HEAD = 16;   // top padding inside box
const FOOT = 12;
const WIDTH = 88;

function baselineSkin(name, ports) {
  const ins = ports.filter((p) => p.dir !== 'output');
  const outs = ports.filter((p) => p.dir === 'output');
  const rows = Math.max(ins.length, outs.length, 1);
  const height = HEAD + FOOT + (rows - 1) * PORT_PITCH + PORT_PITCH;

  const anchors = [];
  ins.forEach((p, i) => {
    anchors.push(`    <g s:x="0" s:y="${HEAD + i * PORT_PITCH}" s:pid="${p.name}"/>`);
  });
  outs.forEach((p, i) => {
    anchors.push(`    <g s:x="${WIDTH}" s:y="${HEAD + i * PORT_PITCH}" s:pid="${p.name}"/>`);
  });

  // Tiny in/out port labels so the baseline is readable before the redesign.
  const labels = [];
  ins.forEach((p, i) => {
    labels.push(`    <text x="5" y="${HEAD + i * PORT_PITCH + 3}" class="$cell_id" ` +
      `style="font-size:7px; fill: var(--prism-port-label, #8a93a6);">${p.name}</text>`);
  });
  outs.forEach((p, i) => {
    labels.push(`    <text x="${WIDTH - 5}" y="${HEAD + i * PORT_PITCH + 3}" class="$cell_id" ` +
      `style="text-anchor:end; font-size:7px; fill: var(--prism-port-label, #8a93a6);">${p.name}</text>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${AUTO_MARK}.
     Module "${name}" — ${ins.length} input(s), ${outs.length} output(s).
     Baseline scaffold: correct ports, neutral look. Redesign the body freely;
     KEEP the s:type / s:alias / s:pid names so PRISM keeps routing. -->
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:s="https://github.com/nturley/netlistsvg">

  <g s:type="${name}" transform="translate(0, 0)" s:width="${WIDTH}" s:height="${height}">
    <s:alias val="${name}"/>

    <rect width="${WIDTH}" height="${height}" rx="4" ry="4"
          class="$cell_id"
          style="fill: var(--prism-module-fill, rgba(95,224,176,0.14));
                 stroke: var(--prism-module-stroke, #5FE0B0);
                 stroke-width: 1.4;"/>

    <text x="${WIDTH / 2}" y="${height / 2 + 4}"
          class="nodelabel $cell_id" s:attribute=""
          style="text-anchor: middle; font-weight: 700; font-size: 11px;
                 fill: var(--prism-module-glyph, #e6e9f0);">${name}</text>

    <text x="${WIDTH / 2}" y="-4"
          class="nodelabel $cell_id" s:attribute="ref"
          style="text-anchor: middle; font-size: 8px; font-style: italic;
                 fill: var(--prism-module-accent, #5FE0B0); opacity: 0.8;">u</text>

${labels.join('\n')}

${anchors.join('\n')}
  </g>

</svg>
`;
}

/* ── Main ────────────────────────────────────────────────────────────────── */

function main() {
  const covered = coveredTypes();
  const files = fs.readdirSync(HDL_DIR).filter((f) => f.endsWith('.v'));
  const allModules = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(HDL_DIR, f), 'utf8');
    for (const mod of modulesInFile(src)) allModules.push({ ...mod, file: f });
  }
  allModules.sort((a, b) => a.name.localeCompare(b.name));

  const written = [];
  const skipped = [];
  for (const mod of allModules) {
    const hit = covered.get(mod.name);
    if (hit && !hit.auto) { skipped.push({ ...mod, reason: `hand-crafted (${hit.file})` }); continue; }
    if (!mod.ports.length) { skipped.push({ ...mod, reason: 'no ports parsed' }); continue; }
    const outPath = path.join(SKIN_DIR, `${mod.name}.svg`);
    if (!CHECK_ONLY) fs.writeFileSync(outPath, baselineSkin(mod.name, mod.ports));
    written.push(mod);
  }

  if (!CHECK_ONLY) writeInventory(allModules, covered, written);

  console.log(`[gen-prism-skins] HDL modules: ${allModules.length}`);
  console.log(`  baseline skins ${CHECK_ONLY ? 'to write' : 'written'}: ${written.length}`);
  console.log(`  skipped (hand-crafted / portless): ${skipped.length}`);
  for (const s of skipped) console.log(`    - ${s.name}  (${s.reason})`);
}

function writeInventory(allModules, covered, written) {
  const writtenSet = new Set(written.map((m) => m.name));
  const row = (m) => {
    const hit = covered.get(m.name);
    const status = writtenSet.has(m.name) ? 'baseline'
      : hit && !hit.auto ? `hand-crafted (\`${hit.file}\`)`
      : hit && hit.auto ? 'baseline'
      : 'none';
    const ports = m.ports.map((p) => `${p.dir === 'output' ? '←' : '→'}${p.name}`).join(' ');
    return `| \`${m.name}\` | \`${m.file}\` | ${m.ports.length} | ${status} | ${ports || '—'} |`;
  };

  const md = `# PRISM component inventory

> Auto-generated by \`scripts/gen-prism-skins.js\`. Lists every component PRISM
> can give a custom skin. Re-run \`node scripts/gen-prism-skins.js\` after the
> HDL changes.

A skin is a netlistsvg symbol keyed by \`s:type\` (with \`<s:alias>\` fallbacks).
Files live in \`assets/prism-skins/\` and are merged over the stock netlistsvg
skin at compile time by \`getDefaultSkinData\` in \`main/ipc/prism.js\`.

## 1. SAPHO HDL modules (\`components/HDL/*.v\`)

These are the real Verilog modules in a SAPHO processor. Each is a clickable
PRISM cell; without a skin it renders as a plain \`generic\` box.

| module | source | ports | skin | port list (→in ←out) |
| ------ | ------ | ----: | ---- | -------------------- |
${allModules.map(row).join('\n')}

## 2. netlistsvg built-in primitives (\`lib/default.svg\`)

Generic gates / arithmetic / storage cells yosys emits. Many already have
hand-made skins in this folder; the rest fall back to the stock netlistsvg
symbol. The generator never touches these.

\`\`\`
${NETLISTSVG_PRIMITIVES.join(', ')}
\`\`\`

_Built-ins still WITHOUT a hand-made skin (candidates for the redesign):_
_\`_AOI3_\`, \`_AOI4_\`, \`_OAI3_\`, \`_OAI4_\`, \`andnot\`, \`ornot\`, \`constant\`,_
_\`pos\`, \`pow\`, \`tribuf\`, \`dlatch-bus\`, \`dlatchn\`, \`dlatchn-bus\`, \`dffn-bus\`._
_(\`generic\`, \`join\`, \`split\`, \`inputExt\`, \`outputExt\` are netlistsvg-internal, leave them.)_
`;
  fs.writeFileSync(path.join(SKIN_DIR, 'COMPONENTS.md'), md);
}

main();
