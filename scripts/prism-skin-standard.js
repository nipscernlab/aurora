#!/usr/bin/env node
/**
 * prism-skin-standard.js — the PRISM symbol STANDARD, made executable.
 *
 * Renders the most complex SAPHO cell, `ula_mux` (a 42-to-1 result mux), to a
 * professional, legible symbol, and in doing so DEFINES the conventions every
 * other symbol follows. Run:
 *
 *     node scripts/prism-skin-standard.js          # writes assets/prism-skins/ula_mux.svg
 *     node scripts/prism-skin-standard.js --print  # stdout
 *
 * ── THE STANDARD ────────────────────────────────────────────────────────────
 *  1. SILHOUETTE = MEANING. A selector is a right-pointing pentagon (many inputs
 *     on the flat left → one output apex on the right): "many in, one out".
 *  2. IT'S A CHIP. The body is a dark card so labels always read with contrast,
 *     regardless of the host background — like an IC on a board.
 *  3. PRISM IDENTITY = a FAINT watermark of the real PRISM logo (the Newton-prism
 *     dispersion mark) in the body's open area. Quiet branding, not decoration.
 *  4. FLOW left→right; CONTROL enters north (the `op` select, in violet).
 *  5. PORTS GROUPED BY FAMILY, colour-coded headers, each cluster bracketed.
 *  6. TYPOGRAPHY: one sans family for all UI text (title/headers/labels), mono
 *     ONLY for port identifiers. A clear size/weight hierarchy. (No serif — that
 *     was the bug: text with no font-family fell back to Times.)
 *  7. THEME-DRIVEN COLOUR via CSS vars + hex fallbacks. NO gradients/external
 *     <defs>: PRISM merges only the <g s:type> block, so a root <defs> is dropped.
 *  8. CRISP GEOMETRY: integer grid, 1.4px stroke, 7px row pitch, round joins.
 *
 * Roll out by describing each module as a SPEC (families of {name,bus} + select
 * + output) and calling renderSymbol(spec) — one routine draws them all.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ── Fonts ──────────────────────────────────────────────────────────────── */
const FONT = "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";
const MONO = "var(--font-mono, 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace)";

/* ── Geometry tokens ────────────────────────────────────────────────────── */
const T = {
  bodyW: 182,
  taper: 56,        // right-side taper to the output apex
  apexH: 20,        // half-height of the flat output edge
  topEdge: 18,      // body top (room above for op + ref)
  headerH: 34,      // header band: ref + wordmark + subtitle + divider
  rowPitch: 7,      // input pin spacing
  groupH: 12,       // a family header's vertical space
  groupGap: 5,      // extra gap between families
  botPad: 16,
  labelX: 12,       // x of a pin's name label
  bracketX: 6,      // x of the family bracket spine
};

/* ── Colour roles (CSS var → standalone hex fallback) ───────────────────── */
const C = {
  card:    'var(--prism-card, #0E1320)',                 // dark chip body
  stroke:  'var(--prism-module-stroke, #5FE0B0)',
  glyph:   'var(--prism-module-glyph, #EAF2EE)',         // title near-white
  accent:  'var(--prism-module-accent, #5FE0B0)',
  control: 'var(--accent, #8E83E8)',                     // select = violet
  label:   'var(--prism-port-label, #AEB6C4)',
  caption: 'var(--text-secondary, #9CA1AE)',
};

// Operation-family colours. Colour encodes family — consistently, everywhere.
const FAMILY = {
  operand:     'var(--aurora-cyan, #5BB8E8)',
  arithmetic:  'var(--aurora-mint, #5FE0B0)',
  logic:       'var(--aurora-violet, #8E83E8)',
  conditional: 'var(--aurora-purple, #B98AE0)',
  comparison:  'var(--aurora-teal, #4FD3C2)',
  shift:       'var(--aurora-pink, #E68FB8)',
  normalize:   'var(--status-warning, #E8B86C)',
};
// The real PRISM logo (assets/icons/aurora_prism.svg), path data only, used as a
// faint single-tone watermark. viewBox is 703×373; content bbox ≈ (16,50)-(680,344).
const WM = {
  paths: [
    'm209.91321 224.15445l-193.85022 -133.60327l14.607443 51.116684l165.14786 117.025894z',
    'm327.53452 297.88818l-5.7504272 16.688568l365.17203 -108.40233l-30.44159 -26.969238z',
    'm318.43182 286.348l-11.223328 22.280762l351.7826 -126.497665l-26.929504 -26.335007z',
    'm304.62537 286.30695l-11.207367 14.449921l340.4418 -141.6302l-39.911743 -40.151627z',
    'm264.4577 272.8916l20.995453 27.348694l314.02628 -177.67105l-58.80481 -54.30976z',
    'm275.2167 277.6664l12.479584 16.278748l270.61615 -207.41946l-38.113586 -36.82104z',
    'm270.3765 270.99115l11.347015 11.56308l239.784 -233.43181l-39.289124 -33.94025z',
    'm146.4552 342.84518l107.22885 -207.15404l105.570465 208.96922z',
  ],
  cx: 348, cy: 197,   // logo content centre, for placement
};

/* ── Flagship spec: ula_mux, grouped as components/HDL/ula.v ─────────────── */
const ULA_MUX = {
  type: 'ula_mux',
  title: 'ula_mux',
  caption: 'ALU result selector — routes one operation output to `out`, chosen by op[5:0]',
  select: { name: 'op', bus: '[5:0]' },
  output: { name: 'out', bus: '[N-1:0]' },
  groups: [
    { family: 'operand',     label: 'OPERANDS',          pins: ['in1', 'in2'] },
    { family: 'arithmetic',  label: 'ARITHMETIC · BINARY', pins: ['add', 'mlt', 'div', 'mod', 'sgn', 'fsgn'] },
    { family: 'arithmetic',  label: 'ARITHMETIC · UNARY',  pins: ['neg', 'negm', 'fneg', 'fnegm', 'abs', 'absm', 'fabs', 'fabsm', 'pst', 'pstm', 'fpst', 'fpstm', 'nrm', 'nrmm', 'f2i', 'f2im'] },
    { family: 'logic',       label: 'LOGIC',             pins: ['ann', 'orr', 'cor', 'inv', 'invm'] },
    { family: 'conditional', label: 'CONDITIONAL',       pins: ['lan', 'lor', 'lin', 'linm'] },
    { family: 'comparison',  label: 'COMPARISON',        pins: ['les', 'fles', 'gre', 'fgre', 'equ'] },
    { family: 'shift',       label: 'SHIFT',             pins: ['shl', 'shr', 'srs'] },
    { family: 'normalize',   label: 'NORMALIZE',         pins: ['smx'] },
  ],
};

/* ── Renderer ───────────────────────────────────────────────────────────── */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const P = [];
const push = (...l) => P.push(...l);

function renderSymbol(spec) {
  P.length = 0;

  // 1) Measure the grouped input rows.
  const rows = [];
  const heads = [];
  let cur = T.topEdge + T.headerH + 6;
  for (const g of spec.groups) {
    const hy = cur;
    cur += T.groupH;
    const y0 = cur - T.rowPitch / 2;
    for (const name of g.pins) { rows.push({ y: cur, name, family: g.family }); cur += T.rowPitch; }
    heads.push({ hy, label: g.label, family: g.family, y0, y1: cur - T.rowPitch / 2 });
    cur += T.groupGap;
  }
  const inputCount = rows.length;
  const botEdge = cur - T.groupGap + T.rowPitch / 2 + 6;
  const height = Math.round(botEdge + T.botPad);
  const cy = Math.round((T.topEdge + botEdge) / 2);
  const flatRight = T.bodyW - T.taper;
  const opX = Math.round(flatRight * 0.5);

  // 2) Body silhouette: right-pointing pentagon with a top select notch.
  const body =
    `M 4,${T.topEdge} L ${opX - 7},${T.topEdge} L ${opX},${T.topEdge - 6} L ${opX + 7},${T.topEdge} ` +
    `L ${flatRight},${T.topEdge} L ${T.bodyW - 2},${cy - T.apexH} L ${T.bodyW - 2},${cy + T.apexH} ` +
    `L ${flatRight},${botEdge} L 4,${botEdge} Z`;

  push('<?xml version="1.0" encoding="UTF-8"?>');
  push(`<!-- PRISM symbol: ${spec.type} — generated by scripts/prism-skin-standard.js`);
  push(`     ${spec.caption}`);
  push('     FLAGSHIP that defines the PRISM symbol standard. Edit the standard');
  push('     there (tokens / families / geometry), not this file by hand. Keep');
  push('     s:type / s:alias / every s:pid — that is what PRISM routes to. -->');
  push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:s="https://github.com/nturley/netlistsvg">');
  push(`  <g s:type="${spec.type}" transform="translate(0, 0)" s:width="${T.bodyW}" s:height="${height}">`);
  push(`    <s:alias val="${spec.type}"/>`);
  push('');

  // ── Card body ──
  push(`    <path d="${body}" class="$cell_id"`);
  push(`          style="fill: ${C.card}; stroke: ${C.stroke}; stroke-width: 1.4; stroke-linejoin: round;"/>`);
  push('');

  // ── Faint PRISM-logo watermark in the body's open area ──
  push('    <!-- faint PRISM watermark -->');
  push(watermark(116, cy + 4, 0.155));

  // ── Header band: instance ref + wordmark + subtitle + divider ──
  const hy = T.topEdge + 16;
  push('    <!-- header -->');
  push(`    <text x="12" y="${T.topEdge + 4}" class="$cell_id" s:attribute="ref"`);
  push(`          style="font-family: ${FONT}; text-anchor: start; font-size: 7px; font-style: italic; fill: ${C.accent}; opacity: 0.8;">u</text>`);
  push(`    <text x="12" y="${hy}" class="nodelabel $cell_id" s:attribute=""`);
  push(`          style="font-family: ${FONT}; text-anchor: start; font-weight: 700; font-size: 12px; letter-spacing: 0.2px; fill: ${C.glyph};">${esc(spec.title)}</text>`);
  push(`    <text x="13" y="${hy + 9}" class="$cell_id" s:attribute=""`);
  push(`          style="font-family: ${FONT}; text-anchor: start; font-size: 5.5px; letter-spacing: 0.3px; fill: ${C.caption};">${inputCount} → 1 selector</text>`);
  push(`    <line x1="11" y1="${T.topEdge + T.headerH - 5}" x2="${flatRight - 6}" y2="${T.topEdge + T.headerH - 5}"`);
  push(`          stroke="${C.stroke}" stroke-width="0.7" opacity="0.28"/>`);
  push('');

  // ── Select (op) — north control ──
  push('    <!-- select / control (north) -->');
  push(`    <line x1="${opX}" y1="0" x2="${opX}" y2="${T.topEdge - 6}" stroke="${C.control}" stroke-width="1.4"/>`);
  push(`    <circle cx="${opX}" cy="0" r="1.8" fill="${C.control}"/>`);
  push(`    <text x="${opX + 5}" y="6" class="$cell_id" s:attribute=""`);
  push(`          style="font-family: ${FONT}; text-anchor: start; font-size: 6px; font-weight: 700; fill: ${C.control};">${esc(spec.select.name)}${esc(spec.select.bus)}</text>`);
  push(`    <g s:x="${opX}" s:y="0" s:pid="${spec.select.name}"/>`);
  push('');

  // ── Input families ──
  push('    <!-- input families (west) -->');
  for (const h of heads) {
    push(`    <text x="${T.labelX}" y="${h.hy + 4}" class="$cell_id" s:attribute=""`);
    push(`          style="font-family: ${FONT}; text-anchor: start; font-size: 5.5px; font-weight: 700; letter-spacing: 0.9px; fill: ${FAMILY[h.family]};">${esc(h.label)}</text>`);
    push(`    <path d="M ${T.bracketX},${h.y0} L 2.5,${h.y0} L 2.5,${h.y1} L ${T.bracketX},${h.y1}" fill="none" stroke="${FAMILY[h.family]}" stroke-width="0.8" opacity="0.5"/>`);
    for (const r of rows.filter((x) => x.y >= h.y0 && x.y <= h.y1)) {
      push(`    <circle cx="2.5" cy="${r.y}" r="1.3" fill="${FAMILY[h.family]}"/>`);
      push(`    <text x="${T.labelX}" y="${r.y + 2.1}" class="$cell_id" s:attribute=""`);
      push(`          style="font-family: ${MONO}; text-anchor: start; font-size: 5.5px; fill: ${C.label};">${esc(r.name)}</text>`);
      push(`    <g s:x="0" s:y="${r.y}" s:pid="${r.name}"/>`);
    }
  }
  push('');

  // ── Result (east) ──
  push('    <!-- result (east) -->');
  push(`    <circle cx="${T.bodyW}" cy="${cy}" r="2.2" fill="${C.stroke}"/>`);
  push(`    <text x="${T.bodyW - 7}" y="${cy - 3}" class="$cell_id" s:attribute=""`);
  push(`          style="font-family: ${FONT}; text-anchor: end; font-size: 6.5px; font-weight: 700; fill: ${C.glyph};">${esc(spec.output.name)}</text>`);
  push(`    <text x="${T.bodyW - 7}" y="${cy + 5}" class="$cell_id" s:attribute=""`);
  push(`          style="font-family: ${MONO}; text-anchor: end; font-size: 5px; fill: ${C.label};">${esc(spec.output.bus)}</text>`);
  push(`    <g s:x="${T.bodyW}" s:y="${cy}" s:pid="${spec.output.name}"/>`);

  push('  </g>');
  push('</svg>');
  return P.join('\n') + '\n';
}

/**
 * Faint single-tone watermark of the real PRISM logo, centred on (cxT, cyT) at
 * scale `s`. All paths share one tone at low opacity so it reads as quiet
 * branding behind the content, never as decoration competing with the ports.
 */
function watermark(cxT, cyT, s) {
  const tx = (cxT - WM.cx * s).toFixed(2);
  const ty = (cyT - WM.cy * s).toFixed(2);
  // Drop the first path (the incoming white ray) — on its own it reads as a
  // stray arrow. The prism + its dispersed beams carry the identity cleanly.
  const out = [`    <g class="$cell_id" transform="translate(${tx}, ${ty}) scale(${s})" fill="${C.stroke}" opacity="0.055">`];
  for (const d of WM.paths.slice(1)) out.push(`      <path d="${d}"/>`);
  out.push('    </g>');
  return out.join('\n');
}

/* ── Main ───────────────────────────────────────────────────────────────── */
const svg = renderSymbol(ULA_MUX);
if (process.argv.includes('--print')) {
  process.stdout.write(svg);
} else {
  const outPath = path.join(__dirname, '..', 'assets', 'prism-skins', `${ULA_MUX.type}.svg`);
  fs.writeFileSync(outPath, svg);
  const ports = ULA_MUX.groups.reduce((n, g) => n + g.pins.length, 0) + 2;
  console.log(`[prism-skin-standard] wrote assets/prism-skins/${ULA_MUX.type}.svg  (${ports} ports)`);
}

module.exports = { renderSymbol, T, C, FAMILY };
