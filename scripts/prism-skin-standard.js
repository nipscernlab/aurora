#!/usr/bin/env node
/**
 * prism-skin-standard.js — the PRISM symbol STANDARD, made executable.
 *
 * We are designing the look of the PRISM (RTL viewer) symbols. This file is the
 * flagship: it renders the most complex SAPHO cell, `ula_mux` (a 42-to-1 result
 * multiplexer), to a professional, legible, standardised symbol — and in doing
 * so it *defines* the conventions every other symbol will follow. Run it:
 *
 *     node scripts/prism-skin-standard.js          # writes assets/prism-skins/ula_mux.svg
 *     node scripts/prism-skin-standard.js --print  # dump to stdout instead
 *
 * ── THE STANDARD (what any reader should be able to rely on) ────────────────
 *  1. SILHOUETTE = MEANING. The body shape states the function. A selector is a
 *     right-pointing pentagon (many inputs on the flat left → narrowing to one
 *     output apex on the right). The eye reads "many in, one out" instantly.
 *  2. SIGNAL FLOW is left → right. Data inputs enter west (x=0), the result
 *     leaves east (x=width). CONTROL enters north (the `op` select on top), so
 *     control is visually separate from data — a universal schematic cue.
 *  3. PORTS ARE GROUPED BY SEMANTIC FAMILY. High-fan-in cells are unreadable as
 *     40 anonymous pins; here they're clustered (arithmetic / logic / compare /
 *     …) exactly as the Verilog groups them, each cluster with a coloured family
 *     header and a bracket. Colour encodes family — consistently, everywhere.
 *  4. EVERY PIN IS LABELLED at its anchor, in mono, with a dot marker so wires
 *     visibly land. Buses carry a width hint ([N-1:0]).
 *  5. TITLE BLOCK. The type name sits in the body's open zone; a one-line role
 *     caption underneath says what the cell DOES; the instance ref floats above.
 *  6. THEME-DRIVEN COLOUR. Every colour is a PRISM/Aurora CSS var with a hex
 *     fallback, so a symbol tracks the app theme but still renders standalone.
 *  7. CRISP GEOMETRY on an integer grid: 1.5px body stroke, 8px row pitch.
 *
 * To roll the standard out, describe each module as a SPEC like ULA_MUX below
 * (groups of {dir,name,bus}) and call renderSymbol(spec) — the same routine
 * draws them all, guaranteeing a consistent family across the whole datapath.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ── Design tokens (the standard's constants) ───────────────────────────── */
const T = {
  bodyW: 170,        // bounding-box width
  taper: 50,         // width of the right-side taper to the output apex
  apexH: 18,         // half-height of the flat output edge
  topEdge: 20,       // body top (room above for the op select + ref)
  rowPitch: 8,       // vertical spacing between input pins
  firstRow: 16,      // gap from topEdge to the first family header
  headerH: 13,       // vertical space a family header occupies
  groupGap: 7,       // extra gap between families
  botPad: 16,        // body bottom edge → bounding box bottom
  labelX: 9,         // x of a pin's name label (just inside the west edge)
  bracketX: 4,       // x of the family bracket spine
};

// Colour roles — every one is a CSS var (themable) with a standalone hex fallback.
const C = {
  fill:    'var(--prism-module-fill, rgba(95,224,176,0.07))',
  stroke:  'var(--prism-module-stroke, #5FE0B0)',
  glyph:   'var(--prism-module-glyph, rgba(255,255,255,0.86))',
  accent:  'var(--prism-module-accent, #5FE0B0)',
  control: 'var(--accent, #8E83E8)',          // select/control = violet (not data)
  label:   'var(--prism-port-label, #8a93a6)',
  caption: 'var(--text-secondary, #9CA1AE)',
  pin:     'var(--prism-module-stroke, #5FE0B0)',
};

// Family palette — colour encodes operation family. Muted, from the Aurora aurora-* set.
const FAMILY = {
  operand:     'var(--aurora-cyan, #5BB8E8)',
  arithmetic:  'var(--aurora-mint, #5FE0B0)',
  logic:       'var(--aurora-violet, #8E83E8)',
  conditional: 'var(--aurora-purple, #B98AE0)',
  comparison:  'var(--aurora-teal, #4FD3C2)',
  shift:       'var(--aurora-pink, #E68FB8)',
  normalize:   'var(--status-warning, #E8B86C)',
};

/* ── Flagship spec: ula_mux, grouped exactly as components/HDL/ula.v ─────── */
const ULA_MUX = {
  type: 'ula_mux',
  title: 'ula_mux',
  caption: 'ALU result selector — routes one operation output to `out`, chosen by op[5:0]',
  select: { name: 'op', bus: '[5:0]' },          // north control port
  output: { name: 'out', bus: '[N-1:0]' },       // east result port
  groups: [
    { family: 'operand',     label: 'OPERANDS',    pins: ['in1', 'in2'] },
    { family: 'arithmetic',  label: 'ARITHMETIC ·2', pins: ['add', 'mlt', 'div', 'mod', 'sgn', 'fsgn'] },
    { family: 'arithmetic',  label: 'ARITHMETIC ·1', pins: ['neg', 'negm', 'fneg', 'fnegm', 'abs', 'absm', 'fabs', 'fabsm', 'pst', 'pstm', 'fpst', 'fpstm', 'nrm', 'nrmm', 'f2i', 'f2im'] },
    { family: 'logic',       label: 'LOGIC',       pins: ['ann', 'orr', 'cor', 'inv', 'invm'] },
    { family: 'conditional', label: 'CONDITIONAL', pins: ['lan', 'lor', 'lin', 'linm'] },
    { family: 'comparison',  label: 'COMPARISON',  pins: ['les', 'fles', 'gre', 'fgre', 'equ'] },
    { family: 'shift',       label: 'SHIFT',       pins: ['shl', 'shr', 'srs'] },
    { family: 'normalize',   label: 'NORMALIZE',   pins: ['smx'] },
  ],
};

/* ── Renderer ───────────────────────────────────────────────────────────── */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function renderSymbol(spec) {
  // 1) Lay the input rows out, family by family, measuring as we go.
  const rows = [];          // { y, name, family }
  const headers = [];       // { y, label, family, y0, y1 }  (y0..y1 = bracket span)
  let cur = T.topEdge + T.firstRow;
  for (const g of spec.groups) {
    const headerY = cur;
    cur += T.headerH;
    const y0 = cur - T.rowPitch / 2;
    for (const name of g.pins) {
      rows.push({ y: cur, name, family: g.family });
      cur += T.rowPitch;
    }
    const y1 = cur - T.rowPitch / 2;
    headers.push({ y: headerY, label: g.label, family: g.family, y0, y1 });
    cur += T.groupGap;
  }
  const botEdge = cur - T.groupGap + T.rowPitch / 2 + 6;
  const height = Math.round(botEdge + T.botPad);
  const cy = Math.round((T.topEdge + botEdge) / 2);
  const flatRight = T.bodyW - T.taper;     // x where the taper begins
  // Title block sits in the clear central band: right of the input labels,
  // left of the output port labels at the apex.
  const openX = Math.round(flatRight - 22);
  const opX = Math.round(flatRight * 0.46);
  const inputCount = spec.groups.reduce((n, g) => n + g.pins.length, 0);

  // 2) Body silhouette: right-pointing pentagon with a small select notch on top.
  const body =
    `M 0,${T.topEdge} ` +
    `L ${opX - 7},${T.topEdge} L ${opX},${T.topEdge - 6} L ${opX + 7},${T.topEdge} ` + // select notch
    `L ${flatRight},${T.topEdge} ` +
    `L ${T.bodyW},${cy - T.apexH} L ${T.bodyW},${cy + T.apexH} ` +
    `L ${flatRight},${botEdge} L 0,${botEdge} Z`;

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<!-- PRISM symbol: ${spec.type} — generated by scripts/prism-skin-standard.js`);
  out.push(`     ${spec.caption}`);
  out.push('     This is the FLAGSHIP that defines the PRISM symbol standard. Edit the');
  out.push('     standard there (tokens / families / geometry), not this file by hand.');
  out.push('     Keep s:type / s:alias / every s:pid; they are what PRISM routes to. -->');
  out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="https://github.com/nturley/netlistsvg">');
  out.push(`  <g s:type="${spec.type}" transform="translate(0, 0)" s:width="${T.bodyW}" s:height="${height}">`);
  out.push(`    <s:alias val="${spec.type}"/>`);
  out.push('');

  // Body
  out.push(`    <path d="${body}" class="$cell_id"`);
  out.push(`          style="fill: ${C.fill}; stroke: ${C.stroke}; stroke-width: 1.5; stroke-linejoin: round;"/>`);
  out.push('');

  // Instance ref (floats above the body)
  out.push(`    <text x="${openX}" y="${T.topEdge - 11}" class="$cell_id" s:attribute="ref"`);
  out.push(`          style="text-anchor: middle; font-size: 8px; font-style: italic; fill: ${C.accent}; opacity: 0.8;">u</text>`);
  out.push('');

  // Title + one-line subtitle, centred in the clear band. The subtitle states
  // the cell's nature compactly ("42 → 1 · op[5:0]"); the full role sentence
  // lives in the SVG comment + STANDARD.md, where it can't overflow the body.
  out.push(`    <text x="${openX}" y="${cy - 2}" class="nodelabel $cell_id" s:attribute=""`);
  out.push(`          style="text-anchor: middle; font-weight: 700; font-size: 12px; letter-spacing: 0.3px; fill: ${C.glyph};">${esc(spec.title)}</text>`);
  out.push(`    <text x="${openX}" y="${cy + 10}" class="$cell_id" s:attribute=""`);
  out.push(`          style="text-anchor: middle; font-size: 6px; letter-spacing: 0.3px; fill: ${C.caption}; opacity: 0.9;">${inputCount} → 1 · ${esc(spec.select.name)}${esc(spec.select.bus)}</text>`);
  out.push('');

  // Select (op) — north control port: violet stub, notch label, width hint
  out.push('    <!-- select / control (north) -->');
  out.push(`    <line x1="${opX}" y1="0" x2="${opX}" y2="${T.topEdge - 6}" stroke="${C.control}" stroke-width="1.4"/>`);
  out.push(`    <circle cx="${opX}" cy="0" r="1.8" fill="${C.control}"/>`);
  out.push(`    <text x="${opX + 5}" y="6" class="$cell_id" s:attribute=""`);
  out.push(`          style="text-anchor: start; font-size: 6px; font-weight: 700; fill: ${C.control};">${esc(spec.select.name)}${esc(spec.select.bus)}</text>`);
  out.push(`    <g s:x="${opX}" s:y="0" s:pid="${spec.select.name}"/>`);
  out.push('');

  // Family brackets + headers
  out.push('    <!-- input families -->');
  for (const h of headers) {
    out.push(`    <text x="${T.labelX}" y="${h.y + 4}" class="$cell_id" s:attribute=""`);
    out.push(`          style="text-anchor: start; font-size: 6px; font-weight: 700; letter-spacing: 0.6px; fill: ${FAMILY[h.family]};">${esc(h.label)}</text>`);
    out.push(`    <path d="M ${T.bracketX},${h.y0} L 1,${h.y0} L 1,${h.y1} L ${T.bracketX},${h.y1}" fill="none" stroke="${FAMILY[h.family]}" stroke-width="0.9" opacity="0.55"/>`);
  }
  out.push('');

  // Input pins (west): dot marker, mono label, anchor
  for (const r of rows) {
    out.push(`    <circle cx="0" cy="${r.y}" r="1.5" fill="${C.pin}"/>`);
    out.push(`    <text x="${T.labelX}" y="${r.y + 2.2}" class="$cell_id" s:attribute=""`);
    out.push(`          style="text-anchor: start; font-size: 5.5px; font-family: var(--font-mono, monospace); fill: ${C.label};">${esc(r.name)}</text>`);
    out.push(`    <g s:x="0" s:y="${r.y}" s:pid="${r.name}"/>`);
  }
  out.push('');

  // Output (east): apex pin, width hint, anchor
  out.push('    <!-- result (east) -->');
  out.push(`    <circle cx="${T.bodyW}" cy="${cy}" r="2" fill="${C.stroke}"/>`);
  out.push(`    <text x="${T.bodyW - 5}" y="${cy - 4}" class="$cell_id" s:attribute=""`);
  out.push(`          style="text-anchor: end; font-size: 6px; font-weight: 700; fill: ${C.glyph};">${esc(spec.output.name)}</text>`);
  out.push(`    <text x="${T.bodyW - 5}" y="${cy + 5}" class="$cell_id" s:attribute=""`);
  out.push(`          style="text-anchor: end; font-size: 5px; font-family: var(--font-mono, monospace); fill: ${C.label};">${esc(spec.output.bus)}</text>`);
  out.push(`    <g s:x="${T.bodyW}" s:y="${cy}" s:pid="${spec.output.name}"/>`);

  out.push('  </g>');
  out.push('</svg>');
  return out.join('\n') + '\n';
}

/* ── Main ───────────────────────────────────────────────────────────────── */
const svg = renderSymbol(ULA_MUX);
if (process.argv.includes('--print')) {
  process.stdout.write(svg);
} else {
  const outPath = path.join(__dirname, '..', 'assets', 'prism-skins', `${ULA_MUX.type}.svg`);
  fs.writeFileSync(outPath, svg);
  const portCount = ULA_MUX.groups.reduce((n, g) => n + g.pins.length, 0) + 2;
  console.log(`[prism-skin-standard] wrote assets/prism-skins/${ULA_MUX.type}.svg  (${portCount} ports)`);
}

module.exports = { renderSymbol, T, C, FAMILY };
