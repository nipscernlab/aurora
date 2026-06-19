// monaco is loaded globally via index.html (AMD vendor build).
/**
 * treesitter_highlight.js — precise syntax highlighting via tree-sitter (O7).
 *
 * web-tree-sitter (WASM) parses the buffer and a grammar's highlights query
 * produces captures; we map those to Monaco SEMANTIC TOKENS, which overlay
 * Monaco's Monarch base highlighting with grammar-accurate colors (module
 * names, instances, port directions, types, macros…). Applies to
 * Verilog/SystemVerilog (gmlarumbe grammar), C and C++ (official grammars).
 * CMM/ASM have no tree-sitter grammar and keep their Monarch tokenizers.
 *
 * Robustness: WASM bytes are pulled from the main process
 * (window.treeSitterAPI) and fed to web-tree-sitter directly — no URL/fetch
 * under the sandboxed file:// renderer. If anything is missing or fails, the
 * provider returns no tokens and Monaco's Monarch highlighting stands
 * (no regression). Loading is lazy: a grammar is fetched + compiled only the
 * first time a buffer of that language is highlighted.
 *
 * tree-sitter positions are BYTE offsets; Monaco wants UTF-16 columns — we
 * convert per line (ASCII fast-path) so accented comments/strings (e.g.
 * Portuguese) don't shift the highlighting after them.
 */

import { Parser, Language, Query } from 'web-tree-sitter';
import svScm from './treesitter/queries/systemverilog.scm?raw';
import cScm from './treesitter/queries/c.scm?raw';
import cppScm from './treesitter/queries/cpp.scm?raw';

// Monaco semantic token legend — standard VS Code token types, so the active
// theme colors them out of the box (vs-dark / cmm-dark inherit those).
const TOKEN_TYPES = [
  'namespace', 'type', 'class', 'struct', 'parameter', 'variable', 'property',
  'enumMember', 'function', 'method', 'macro', 'keyword', 'comment', 'string',
  'number', 'operator', 'modifier',
];
const TYPE_INDEX = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));
const LEGEND = { tokenTypes: TOKEN_TYPES, tokenModifiers: [] };

// tree-sitter capture name → semantic token type. `null` = leave to Monarch
// (punctuation). Lookup tries the full dotted name, then its first segment.
const CAPTURE_MAP = {
  comment: 'comment',
  string: 'string', char: 'string',
  number: 'number', float: 'number', integer: 'number', boolean: 'keyword',
  keyword: 'keyword', conditional: 'keyword', repeat: 'keyword', include: 'keyword',
  exception: 'keyword', label: 'keyword', 'keyword.directive': 'macro',
  operator: 'operator',
  function: 'function', constructor: 'function', method: 'method',
  type: 'type', 'type.qualifier': 'keyword', storageclass: 'keyword', 'storageclass.lifetime': 'keyword',
  variable: 'variable', 'variable.parameter': 'parameter', parameter: 'parameter',
  property: 'property', field: 'property', attribute: 'property',
  constant: 'variable', 'constant.macro': 'macro',
  preproc: 'macro', define: 'macro', macro: 'macro',
  namespace: 'namespace', module: 'namespace',
  punctuation: null,
};

function captureToType(name) {
  if (name in CAPTURE_MAP) return CAPTURE_MAP[name];
  const base = name.split('.')[0];
  return base in CAPTURE_MAP ? CAPTURE_MAP[base] : null;
}

// Monaco language id → { grammar artifact name, highlights query text }.
// cpp inherits c's queries (the `; inherits: c` convention).
const LANGS = [
  { ids: ['verilog', 'systemverilog'], grammar: 'systemverilog', scm: svScm },
  { ids: ['c'], grammar: 'c', scm: cScm },
  { ids: ['cpp'], grammar: 'cpp', scm: `${cScm}\n${cppScm}` },
];

let initialized = false;
let unavailable = false;       // set once if the runtime/bytes can't load
let parserInitPromise = null;
const grammarCache = new Map(); // grammar name → Promise<{parser, query}>

async function getBytes(name) {
  const b = await window.treeSitterAPI.wasm(name);
  if (!b) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

function ensureParser() {
  if (parserInitPromise) return parserInitPromise;
  parserInitPromise = (async () => {
    const rt = await getBytes('runtime');
    if (!rt) throw new Error('web-tree-sitter runtime wasm unavailable');
    await Parser.init({ wasmBinary: rt });
  })();
  parserInitPromise.catch(() => { parserInitPromise = null; });
  return parserInitPromise;
}

function ensureGrammar(cfg) {
  if (grammarCache.has(cfg.grammar)) return grammarCache.get(cfg.grammar);
  const p = (async () => {
    await ensureParser();
    const bytes = await getBytes(cfg.grammar);
    if (!bytes) throw new Error(`grammar ${cfg.grammar} unavailable`);
    const language = await Language.load(bytes);
    const parser = new Parser();
    parser.setLanguage(language);
    const query = new Query(language, cfg.scm);
    return { parser, query };
  })();
  grammarCache.set(cfg.grammar, p);
  p.catch(() => grammarCache.delete(cfg.grammar)); // allow a later retry
  return p;
}

// ── byte (UTF-8) column → UTF-16 column, per line, cached ──────────────────────

function hasNonAscii(line) {
  for (let i = 0; i < line.length; i++) {
    if (line.charCodeAt(i) > 0x7f) return true;
  }
  return false;
}

function buildByteMap(line) {
  const map = new Map();
  let b = 0;
  for (let u = 0; u < line.length;) {
    map.set(b, u);
    const cp = line.codePointAt(u);
    b += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    u += cp > 0xffff ? 2 : 1;
  }
  map.set(b, line.length);
  return map;
}

// cache: row → null (pure ASCII, identity) | Map(byteOffset→utf16Offset)
function byteToUtf16(model, row, byteCol, cache) {
  if (byteCol === 0) return 0;
  let info = cache.get(row);
  if (info === undefined) {
    const line = model.getLineContent(row + 1);
    info = hasNonAscii(line) ? buildByteMap(line) : null;
    cache.set(row, info);
  }
  if (info === null) return byteCol; // ASCII: bytes == UTF-16 units
  const u = info.get(byteCol);
  return u !== undefined ? u : byteCol;
}

// ── captures → Monaco semantic token data (delta-encoded Uint32Array) ─────────

function buildTokens(model, tree, query) {
  const caps = query.captures(tree.rootNode);
  const raw = [];
  for (const c of caps) {
    const type = captureToType(c.name);
    if (type == null) continue;
    const ti = TYPE_INDEX[type];
    if (ti === undefined) continue;
    const n = c.node;
    raw.push({ s: n.startIndex, e: n.endIndex, sp: n.startPosition, ep: n.endPosition, ti });
  }
  // Resolve overlaps: earliest start first; at equal start, smallest span first
  // (inner/specific wins). Greedy keep of non-overlapping ranges.
  raw.sort((a, b) => a.s - b.s || (a.e - a.s) - (b.e - b.s));
  const cache = new Map();
  const tokens = []; // [line, col, len, typeIndex]
  let lastEnd = -1;
  for (const r of raw) {
    if (r.s < lastEnd) continue; // overlaps an already-kept range
    lastEnd = r.e;
    const sRow = r.sp.row, eRow = r.ep.row;
    if (sRow === eRow) {
      const sc = byteToUtf16(model, sRow, r.sp.column, cache);
      const ec = byteToUtf16(model, eRow, r.ep.column, cache);
      if (ec > sc) tokens.push([sRow, sc, ec - sc, r.ti]);
      continue;
    }
    // Multi-line capture (block comment, multi-line string): split per line.
    const sc = byteToUtf16(model, sRow, r.sp.column, cache);
    const firstLen = model.getLineLength(sRow + 1) - sc;
    if (firstLen > 0) tokens.push([sRow, sc, firstLen, r.ti]);
    for (let row = sRow + 1; row < eRow; row++) {
      const len = model.getLineLength(row + 1);
      if (len > 0) tokens.push([row, 0, len, r.ti]);
    }
    const ec = byteToUtf16(model, eRow, r.ep.column, cache);
    if (ec > 0) tokens.push([eRow, 0, ec, r.ti]);
  }

  const data = new Uint32Array(tokens.length * 5);
  let prevLine = 0, prevCol = 0, i = 0;
  for (const [line, col, len, ti] of tokens) {
    const dLine = line - prevLine;
    data[i++] = dLine;
    data[i++] = dLine === 0 ? col - prevCol : col;
    data[i++] = len;
    data[i++] = ti;
    data[i++] = 0;
    prevLine = line;
    prevCol = col;
  }
  return data;
}

// ── provider ──────────────────────────────────────────────────────────────────

function makeProvider(cfg) {
  return {
    getLegend: () => LEGEND,
    async provideDocumentSemanticTokens(model) {
      if (unavailable) return { data: new Uint32Array(0) };
      let tree = null;
      try {
        const { parser, query } = await ensureGrammar(cfg);
        if (model.isDisposed && model.isDisposed()) return { data: new Uint32Array(0) };
        tree = parser.parse(model.getValue());
        return { data: buildTokens(model, tree, query) };
      } catch (e) {
        // A missing runtime kills all grammars — stop trying after the first.
        if (/runtime/.test(String(e && e.message))) unavailable = true;
        return { data: new Uint32Array(0) };
      } finally {
        try { if (tree && tree.delete) tree.delete(); } catch { /* auto-managed */ }
      }
    },
    releaseDocumentSemanticTokens() { /* nothing to release */ },
  };
}

export function initTreeSitter() {
  if (initialized) return;
  if (typeof window === 'undefined' || !window.treeSitterAPI) return;
  if (typeof monaco === 'undefined') return;
  initialized = true;
  try {
    for (const cfg of LANGS) {
      const provider = makeProvider(cfg);
      for (const id of cfg.ids) {
        monaco.languages.registerDocumentSemanticTokensProvider(id, provider);
      }
    }
  } catch (e) {
    initialized = false;
    console.warn('[tree-sitter] highlight disabled:', e);
  }
}
