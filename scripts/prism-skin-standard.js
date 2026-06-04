#!/usr/bin/env node
/**
 * prism-skin-standard.js — the PRISM symbol STANDARD, made executable.
 *
 * Parses every SAPHO HDL module (components/HDL/*.v) and renders each one to a
 * professional, consistent PRISM symbol, so the whole datapath looks like one
 * deliberate family. Run:
 *
 *     node scripts/prism-skin-standard.js            # regenerate every skin
 *     node scripts/prism-skin-standard.js --only pc  # just one (debug)
 *     node scripts/prism-skin-standard.js --print pc # dump one to stdout
 *
 * ── THE STANDARD ────────────────────────────────────────────────────────────
 *  1. SILHOUETTE = MEANING. A selector/mux is a right-pointing pentagon (many
 *     in → one out); everything else is a clean rounded "chip" card.
 *  2. IT'S A CHIP. Dark card body so labels read with contrast anywhere.
 *  3. PRISM IDENTITY = a FAINT logo watermark in the body's open area: the PRISM
 *     dispersion mark, or the SAPHO "S" for the `processor` top cell.
 *  4. FLOW left→right. Data inputs west, result(s) east; CONTROL (clk/rst/op/en…)
 *     is drawn in violet so it's visually separate from data. `clk` gets an edge ▸.
 *  5. PORTS LABELLED at their anchor; pins are small squares (NOT circles — PRISM
 *     CSS forces a stroke on every <circle>). Selectors group inputs by family.
 *  6. TYPOGRAPHY: one sans family for UI text, mono for port identifiers. (Always
 *     set font-family — bare text falls back to serif.)
 *  7. THEME COLOUR via CSS vars + hex fallbacks. NO gradients / no root <defs>:
 *     PRISM merges only the <g s:type> block, so a root <defs> is dropped.
 *  8. CRISP GEOMETRY on an integer grid; 1.4px stroke; round joins.
 *
 * HARD RULES: `s:pid` MUST equal the Verilog port name; exclude `ifdef
 * YANC_SIM_VIS ports (yosys reads PRISM without that define). Keep s:type/alias.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const HDL_DIR = path.join(REPO, 'components', 'HDL');
const SKIN_DIR = path.join(REPO, 'assets', 'prism-skins');

/* ── Fonts & colour roles ───────────────────────────────────────────────── */
const FONT = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'Cascadia Code', 'Consolas', ui-monospace, monospace";
const C = {
  card:    'var(--prism-card, #0E1320)',
  stroke:  'var(--prism-module-stroke, #5FE0B0)',
  glyph:   'var(--prism-module-glyph, #EAF2EE)',
  label:   'var(--prism-port-label, #AEB6C4)',
  caption: 'var(--text-secondary, #9CA1AE)',
  control: 'var(--accent, #8E83E8)',
};

// Per-class accent (header rule, subtitle, data-pin colour).
const CLASS = {
  selector:   { color: 'var(--aurora-pink, #E68FB8)',     tag: 'selector' },
  arithmetic: { color: 'var(--aurora-mint, #5FE0B0)',     tag: 'datapath op' },
  control:    { color: 'var(--aurora-violet, #8E83E8)',   tag: 'control' },
  memory:     { color: 'var(--aurora-cyan, #5BB8E8)',     tag: 'memory' },
  fifo:       { color: 'var(--aurora-teal, #4FD3C2)',     tag: 'FIFO' },
  core:       { color: 'var(--aurora-mint, #5FE0B0)',     tag: 'processor core' },
  processor:  { color: 'var(--aurora-mint, #5FE0B0)',     tag: 'SAPHO processor' },
};

// Input-family palette (selectors only).
const FAMILY = {
  operand: 'var(--aurora-cyan, #5BB8E8)', arithmetic: 'var(--aurora-mint, #5FE0B0)',
  logic: 'var(--aurora-violet, #8E83E8)', conditional: 'var(--aurora-purple, #B98AE0)',
  comparison: 'var(--aurora-teal, #4FD3C2)', shift: 'var(--aurora-pink, #E68FB8)',
  normalize: 'var(--status-warning, #E8B86C)',
};

const CONTROL = new Set(['clk', 'rst', 'en', 'load', 'sclr', 'wrreq', 'rdreq', 'op', 'sel', 'mode', 'itr', 'wr', 'ld']);

/* ── Watermarks (logo path data, single-tone, faint) ────────────────────── */
const WM = {
  // PRISM logo dispersion mark (assets/icons/aurora_prism.svg) minus the ray.
  prism: {
    paths: [
      'm327.53452 297.88818l-5.7504272 16.688568l365.17203 -108.40233l-30.44159 -26.969238z',
      'm318.43182 286.348l-11.223328 22.280762l351.7826 -126.497665l-26.929504 -26.335007z',
      'm304.62537 286.30695l-11.207367 14.449921l340.4418 -141.6302l-39.911743 -40.151627z',
      'm264.4577 272.8916l20.995453 27.348694l314.02628 -177.67105l-58.80481 -54.30976z',
      'm275.2167 277.6664l12.479584 16.278748l270.61615 -207.41946l-38.113586 -36.82104z',
      'm270.3765 270.99115l11.347015 11.56308l239.784 -233.43181l-39.289124 -33.94025z',
      'm146.4552 342.84518l107.22885 -207.15404l105.570465 208.96922z',
    ],
    cx: 410, cy: 196, w: 540, extra: '',
  },
  // SAPHO "S" mark (assets/icons/sapho_aurora_icon.svg). Drawn through the
  // logo's own rotate(180,4550,3770) so the glyph is upright.
  sapho: {
    paths: [
      'M5170 5739 l0 -282 -57 7 c-768 88 -1469 -233 -1886 -864 -544 -825 -369 -1947 402 -2566 359 -289 769 -434 1223 -434 312 0 590 66 873 208 161 80 371 226 452 314 l22 24 -173 173 -174 174 -74 -60 c-240 -197 -496 -303 -806 -333 -145 -15 -316 0 -479 40 -563 138 -914 496 -1050 1070 -30 130 -42 390 -24 521 80 553 453 1004 978 1178 165 55 239 66 458 66 213 0 264 -7 440 -62 83 -26 249 -102 323 -148 l42 -26 0 315 c0 208 3 316 10 316 21 0 187 -89 275 -147 301 -199 532 -454 691 -765 l55 -108 -48 0 c-26 0 -430 5 -897 10 -888 11 -940 10 -1078 -31 -437 -128 -726 -557 -678 -1009 12 -118 38 -210 90 -318 50 -104 86 -157 169 -244 201 -214 502 -324 793 -290 179 21 380 106 495 208 l48 43 -174 174 -174 175 -49 -34 c-94 -64 -240 -90 -357 -63 -195 45 -350 238 -351 436 0 203 128 381 319 443 l70 22 1231 -8 1230 -9 0 31 c0 63 -53 294 -101 439 -144 433 -412 832 -753 1119 -276 233 -589 402 -928 501 -118 34 -309 75 -354 75 l-24 0 0 -281z',
    ],
    cx: 5130, cy: 3770, w: 4500, extra: ' rotate(180,4550,3770)',
  },
};

/* ── ula_mux input families (the one richly-grouped selector) ────────────── */
const ULA_MUX_GROUPS = [
  { family: 'operand',     label: 'OPERANDS',           pins: ['in1', 'in2'] },
  { family: 'arithmetic',  label: 'ARITHMETIC · BINARY', pins: ['add', 'mlt', 'div', 'mod', 'sgn', 'fsgn'] },
  { family: 'arithmetic',  label: 'ARITHMETIC · UNARY',  pins: ['neg', 'negm', 'fneg', 'fnegm', 'abs', 'absm', 'fabs', 'fabsm', 'pst', 'pstm', 'fpst', 'fpstm', 'nrm', 'nrmm', 'f2i', 'f2im'] },
  { family: 'logic',       label: 'LOGIC',              pins: ['ann', 'orr', 'cor', 'inv', 'invm'] },
  { family: 'conditional', label: 'CONDITIONAL',        pins: ['lan', 'lor', 'lin', 'linm'] },
  { family: 'comparison',  label: 'COMPARISON',         pins: ['les', 'fles', 'gre', 'fgre', 'equ'] },
  { family: 'shift',       label: 'SHIFT',              pins: ['shl', 'shr', 'srs'] },
  { family: 'normalize',   label: 'NORMALIZE',          pins: ['smx'] },
];

/* ── Verilog port extraction ────────────────────────────────────────────── */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
function matchParen(s, open) { let d = 0; for (let i = open; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')') { if (--d === 0) return i; } } return -1; }
function portListText(s, after) {
  let i = after; while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] === '#') { const po = s.indexOf('(', i); if (po < 0) return ''; i = matchParen(s, po) + 1; while (i < s.length && /\s/.test(s[i])) i++; }
  if (s[i] !== '(') return ''; const c = matchParen(s, i); return c < 0 ? '' : s.slice(i + 1, c);
}
function dropIfdef(t) {
  const out = []; let d = 0;
  for (const ln of t.split('\n')) {
    if (/^\s*`(ifdef|ifndef|if)\b/.test(ln)) { d++; continue; }
    if (/^\s*`endif\b/.test(ln)) { if (d > 0) d--; continue; }
    if (/^\s*`(else|elsif)\b/.test(ln)) continue;
    if (d === 0) out.push(ln);
  }
  return out.join('\n');
}
const KW = /\b(input|output|inout|reg|wire|logic|signed|unsigned|integer)\b/g;
function parsePorts(text) {
  const clean = dropIfdef(text); const segs = []; let d = 0, buf = '';
  for (const ch of clean) { if (ch === '[') d++; else if (ch === ']') d = Math.max(0, d - 1); if (ch === ',' && d === 0) { segs.push(buf); buf = ''; } else buf += ch; }
  if (buf.trim()) segs.push(buf);
  const ports = []; let dir = 'input';
  for (let seg of segs) {
    seg = seg.trim(); if (!seg) continue;
    const dm = seg.match(/^(input|output|inout)\b/); if (dm) dir = dm[1];
    const bus = /\[[^\]]*\]/.test(seg);
    const name = seg.replace(/=[^,]*/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(KW, ' ').trim().split(/\s+/).pop();
    if (name && /^[A-Za-z_]\w*$/.test(name)) ports.push({ name, dir, bus });
  }
  return ports;
}
function modulesInFile(src) {
  const clean = stripComments(src); const out = []; const re = /\bmodule\s+([A-Za-z_]\w*)/g; let m;
  while ((m = re.exec(clean))) out.push({ name: m[1], ports: parsePorts(portListText(clean, m.index + m[0].length)) });
  return out;
}
function allModules() {
  const out = [];
  for (const f of fs.readdirSync(HDL_DIR).filter((x) => x.endsWith('.v'))) {
    for (const mod of modulesInFile(fs.readFileSync(path.join(HDL_DIR, f), 'utf8'))) out.push({ ...mod, file: f });
  }
  return out;
}

/* ── Classification ─────────────────────────────────────────────────────── */
function classify(name) {
  if (name === 'ula_mux' || name === 'norm_mux') return { cls: 'selector', shape: 'selector', wm: 'prism' };
  if (name === 'processor') return { cls: 'processor', shape: 'block', wm: 'sapho' };
  if (name === 'core') return { cls: 'core', shape: 'block', wm: 'prism' };
  if (name === 'myFIFO') return { cls: 'fifo', shape: 'block', wm: 'prism' };
  if (/^mem/.test(name)) return { cls: 'memory', shape: 'block', wm: 'prism' };
  if (/^ula_/.test(name)) return { cls: 'arithmetic', shape: 'block', wm: 'prism' };
  if (/(_ctrl|_dec|_fetch|prefetch|^pc$|^stack$|rel_addr|^addr_dec$)/.test(name)) return { cls: 'control', shape: 'block', wm: 'prism' };
  return { cls: 'control', shape: 'block', wm: 'prism' };
}

/* ── Drawing helpers ────────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const labW = (s) => String(s).length * 3.35 + 3;       // ~mono 5.5px width
let P = [];
const push = (...l) => P.push(...l);

function watermark(kind, cxT, cyT, size) {
  const w = WM[kind];
  const sc = (size / w.w).toFixed(5);
  const tx = (cxT - w.cx * (size / w.w)).toFixed(2);
  const ty = (cyT - w.cy * (size / w.w)).toFixed(2);
  const out = [`    <g class="$cell_id" transform="translate(${tx}, ${ty}) scale(${sc})${w.extra}" fill="${C.stroke}" opacity="0.085">`];
  for (const d of w.paths) out.push(`      <path d="${d}"/>`);
  out.push('    </g>');
  return out.join('\n');
}

function roundRect(x, y, w, h, r) {
  return `M ${x + r},${y} H ${x + w - r} A ${r},${r} 0 0 1 ${x + w},${y + r} V ${y + h - r} ` +
    `A ${r},${r} 0 0 1 ${x + w - r},${y + h} H ${x + r} A ${r},${r} 0 0 1 ${x},${y + h - r} ` +
    `V ${y + r} A ${r},${r} 0 0 1 ${x + r},${y} Z`;
}

const pin = (x, y, col) => `    <rect x="${(x - 1.3).toFixed(1)}" y="${(y - 1.3).toFixed(1)}" width="2.6" height="2.6" rx="0.8" fill="${col}"/>`;
const anchor = (x, y, name) => `    <g s:x="${x}" s:y="${y}" s:pid="${name}"/>`;

function header(x, w, title, subtitle, accent) {
  push(`    <text x="${x}" y="${TOP + 4}" class="$cell_id" s:attribute="ref" style="font-family: ${FONT}; text-anchor: start; font-size: 7px; font-style: italic; fill: ${accent}; opacity: 0.85;">u</text>`);
  push(`    <text x="${x}" y="${TOP + 16}" class="nodelabel $cell_id" s:attribute="" style="font-family: ${FONT}; text-anchor: start; font-weight: 700; font-size: 12px; letter-spacing: 0.2px; fill: ${C.glyph};">${esc(title)}</text>`);
  push(`    <text x="${x + 1}" y="${TOP + 25}" class="$cell_id" s:attribute="" style="font-family: ${FONT}; text-anchor: start; font-size: 5.5px; letter-spacing: 0.4px; fill: ${C.caption};">${esc(subtitle)}</text>`);
  push(`    <line x1="${x - 1}" y1="${TOP + HEADER - 4}" x2="${x + w}" y2="${TOP + HEADER - 4}" stroke="${accent}" stroke-width="0.7" opacity="0.35"/>`);
}

const TOP = 18, HEADER = 32;

/* ── Block renderer (registers, ALU ops, memory, decoders, core, processor) ─ */
function renderBlock(mod, info) {
  P = [];
  const accent = CLASS[info.cls].color;
  const ctrl = mod.ports.filter((p) => p.dir !== 'output' && CONTROL.has(p.name));
  const data = mod.ports.filter((p) => p.dir !== 'output' && !CONTROL.has(p.name));
  const ins = [...ctrl, ...data];
  const outs = mod.ports.filter((p) => p.dir === 'output');

  const rowPitch = 9;
  const rows = Math.max(ins.length, outs.length, 1);
  const maxInW = Math.max(0, ...ins.map((p) => labW(p.name)));
  const maxOutW = Math.max(0, ...outs.map((p) => labW(p.name)));
  const titleW = labW(mod.name) * 1.6;
  const bodyW = Math.round(Math.max(150, 22 + maxInW + 46 + maxOutW + 8, 30 + titleW));
  const bodyH = TOP + HEADER + 8 + rows * rowPitch + 8;
  const height = bodyH + 4;

  push('<?xml version="1.0" encoding="UTF-8"?>');
  push(`<!-- PRISM symbol: ${mod.name} (${CLASS[info.cls].tag}) — generated by scripts/prism-skin-standard.js`);
  push('     Edit the standard there, not this file. Keep s:type / s:alias / every s:pid. -->');
  push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="https://github.com/nturley/netlistsvg">');
  push(`  <g s:type="${mod.name}" transform="translate(0, 0)" s:width="${bodyW}" s:height="${height}">`);
  push(`    <s:alias val="${mod.name}"/>`);
  push('');
  push(`    <path d="${roundRect(0, TOP, bodyW, bodyH - TOP, 6)}" class="$cell_id" style="fill: ${C.card}; stroke: ${C.stroke}; stroke-width: 1.4; stroke-linejoin: round;"/>`);
  push('');
  // watermark in the lower-centre open band
  const wmSize = Math.min(bodyW * 0.42, (bodyH - TOP - HEADER) * 0.95, 64);
  if (wmSize > 18) push(watermark(info.wm, bodyW * 0.56, TOP + HEADER + (bodyH - TOP - HEADER) * 0.55, wmSize));
  push('');
  header(11, bodyW - 22, mod.name, `${CLASS[info.cls].tag} · ${ins.length}in ${outs.length}out`, accent);
  push('');
  // inputs (west)
  let y = TOP + HEADER + 8;
  push('    <!-- inputs (west) -->');
  for (const p of ins) {
    const isC = CONTROL.has(p.name);
    const col = isC ? C.control : accent;
    push(pin(0, y, col));
    if (p.name === 'clk') push(`    <path d="M 3,${y - 2.4} L 6,${y} L 3,${y + 2.4} Z" fill="${C.control}"/>`);
    push(`    <text x="${p.name === 'clk' ? 9 : 7}" y="${y + 2.1}" class="$cell_id" s:attribute="" style="font-family: ${MONO}; text-anchor: start; font-size: 5.5px; fill: ${isC ? C.control : C.label};">${esc(p.name)}</text>`);
    push(anchor(0, y, p.name));
    y += rowPitch;
  }
  // outputs (east)
  push('    <!-- outputs (east) -->');
  y = TOP + HEADER + 8;
  for (const p of outs) {
    push(pin(bodyW, y, C.stroke));
    push(`    <text x="${bodyW - 7}" y="${y + 2.1}" class="$cell_id" s:attribute="" style="font-family: ${MONO}; text-anchor: end; font-size: 5.5px; fill: ${C.label};">${esc(p.name)}</text>`);
    push(anchor(bodyW, y, p.name));
    y += rowPitch;
  }
  push('  </g>');
  push('</svg>');
  return P.join('\n') + '\n';
}

/* ── Selector renderer (ula_mux, norm_mux): pentagon + grouped inputs ──────── */
function renderSelector(mod, info) {
  P = [];
  const accent = CLASS.selector.color;
  const selPort = mod.ports.find((p) => p.name === 'op') || mod.ports.find((p) => CONTROL.has(p.name));
  const outPort = mod.ports.find((p) => p.dir === 'output');
  // groups
  let groups;
  if (mod.name === 'ula_mux') groups = ULA_MUX_GROUPS;
  else {
    const ins = mod.ports.filter((p) => p.dir !== 'output' && p !== selPort).map((p) => p.name);
    groups = [{ family: 'operand', label: 'INPUTS', pins: ins }];
  }
  const rowPitch = 7, groupH = 12, groupGap = 5;
  const bodyW = 170, taper = 56, apexH = 18, flatRight = bodyW - taper;

  const rows = []; const heads = [];
  let cur = TOP + HEADER + 6;
  for (const g of groups) {
    const hy = cur; cur += groupH; const y0 = cur - rowPitch / 2;
    for (const nm of g.pins) { rows.push({ y: cur, name: nm, family: g.family }); cur += rowPitch; }
    heads.push({ hy, label: g.label, family: g.family, y0, y1: cur - rowPitch / 2 });
    cur += groupGap;
  }
  const botEdge = cur - groupGap + rowPitch / 2 + 6;
  const height = Math.round(botEdge + 16);
  const cy = Math.round((TOP + botEdge) / 2);
  const opX = Math.round(flatRight * 0.5);

  const body = `M 4,${TOP} L ${opX - 7},${TOP} L ${opX},${TOP - 6} L ${opX + 7},${TOP} L ${flatRight},${TOP} ` +
    `L ${bodyW - 2},${cy - apexH} L ${bodyW - 2},${cy + apexH} L ${flatRight},${botEdge} L 4,${botEdge} Z`;

  push('<?xml version="1.0" encoding="UTF-8"?>');
  push(`<!-- PRISM symbol: ${mod.name} (selector) — generated by scripts/prism-skin-standard.js`);
  push('     Edit the standard there, not this file. Keep s:type / s:alias / every s:pid. -->');
  push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="https://github.com/nturley/netlistsvg">');
  push(`  <g s:type="${mod.name}" transform="translate(0, 0)" s:width="${bodyW}" s:height="${height}">`);
  push(`    <s:alias val="${mod.name}"/>`);
  push('');
  push(`    <path d="${body}" class="$cell_id" style="fill: ${C.card}; stroke: ${C.stroke}; stroke-width: 1.4; stroke-linejoin: round;"/>`);
  push('');
  push(watermark(info.wm, 116, cy + 4, 58));
  push('');
  header(12, flatRight - 12, mod.name, `${rows.length} → 1 selector`, accent);
  push('');
  // select (north)
  if (selPort) {
    push(`    <line x1="${opX}" y1="0" x2="${opX}" y2="${TOP - 6}" stroke="${C.control}" stroke-width="1.4"/>`);
    push(pin(opX, 0, C.control));
    push(`    <text x="${opX + 5}" y="6" class="$cell_id" s:attribute="" style="font-family: ${FONT}; text-anchor: start; font-size: 6px; font-weight: 700; fill: ${C.control};">${esc(selPort.name)}${selPort.bus ? '[…]' : ''}</text>`);
    push(anchor(opX, 0, selPort.name));
  }
  push('');
  // families
  for (const h of heads) {
    push(`    <text x="12" y="${h.hy + 4}" class="$cell_id" s:attribute="" style="font-family: ${FONT}; text-anchor: start; font-size: 5.5px; font-weight: 700; letter-spacing: 0.9px; fill: ${FAMILY[h.family]};">${esc(h.label)}</text>`);
    push(`    <path d="M 6,${h.y0} L 2.5,${h.y0} L 2.5,${h.y1} L 6,${h.y1}" fill="none" stroke="${FAMILY[h.family]}" stroke-width="0.8" opacity="0.5"/>`);
    for (const r of rows.filter((x) => x.y >= h.y0 && x.y <= h.y1)) {
      push(pin(0, r.y, FAMILY[h.family]));
      push(`    <text x="12" y="${r.y + 2.1}" class="$cell_id" s:attribute="" style="font-family: ${MONO}; text-anchor: start; font-size: 5.5px; fill: ${C.label};">${esc(r.name)}</text>`);
      push(anchor(0, r.y, r.name));
    }
  }
  push('');
  // result (east)
  if (outPort) {
    push(pin(bodyW, cy, C.stroke));
    push(`    <text x="${bodyW - 7}" y="${cy - 3}" class="$cell_id" s:attribute="" style="font-family: ${FONT}; text-anchor: end; font-size: 6.5px; font-weight: 700; fill: ${C.glyph};">${esc(outPort.name)}</text>`);
    push(anchor(bodyW, cy, outPort.name));
  }
  push('  </g>');
  push('</svg>');
  return P.join('\n') + '\n';
}

function renderModule(mod) {
  const info = classify(mod.name);
  return info.shape === 'selector' ? renderSelector(mod, info) : renderBlock(mod, info);
}

/* ── Main ───────────────────────────────────────────────────────────────── */
function main() {
  const onlyIdx = process.argv.indexOf('--only');
  const printIdx = process.argv.indexOf('--print');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : (printIdx >= 0 ? process.argv[printIdx + 1] : null);

  const mods = allModules().filter((m) => m.ports.length).sort((a, b) => a.name.localeCompare(b.name));
  if (printIdx >= 0) { const m = mods.find((x) => x.name === only); process.stdout.write(m ? renderModule(m) : `// no module ${only}\n`); return; }

  let n = 0;
  for (const mod of mods) {
    if (only && mod.name !== only) continue;
    fs.writeFileSync(path.join(SKIN_DIR, `${mod.name}.svg`), renderModule(mod));
    n++;
  }
  console.log(`[prism-skin-standard] wrote ${n} skin${n === 1 ? '' : 's'} to assets/prism-skins/`);
}

if (require.main === module) main();
module.exports = { renderModule, classify, allModules };
