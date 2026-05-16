#!/usr/bin/env node
/**
 * sync-sapho-rules.js — dev-only generator for `resources/sapho_rules.json`.
 *
 * Reads the yanc compiler sources (default `C:\Users\LCOM\Documents\Github\yanc`,
 * overridable via `--yanc <path>` or `$YANC_PATH`) and consolidates the
 * CMM language surface (keywords, types, operators, hardware directives,
 * bilingual error/warning catalog, grammar skeleton) into a single static
 * JSON the Aurora Intelligence panel ships with.
 *
 * Why this exists
 * ---------------
 * yanc is *not* bundled into the AURORA installer — the binaries are
 * pulled at runtime/setup, and the source tree only lives on a
 * maintainer's machine. Without this sync, the AI would have no idea
 * which directives exist, what their defaults are, or what error
 * messages mean. Run before each release (or whenever yanc changes):
 *
 *     npm run rules:sync
 *
 * The resulting JSON is checked into git so CI / packaging never has
 * to look for yanc.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_PATH  = path.join(REPO_ROOT, 'resources', 'sapho_rules.json');
const DEFAULT_YANC = 'C:\\Users\\LCOM\\Documents\\Github\\yanc';

/* ============================================================
 *  Argument / env resolution
 * ========================================================== */

function resolveYancPath() {
  const idx = process.argv.indexOf('--yanc');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.YANC_PATH) return process.env.YANC_PATH;
  return DEFAULT_YANC;
}

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.warn(`[sync-sapho-rules] missing: ${path.relative(process.cwd(), p)}`);
    return null;
  }
}

function gitCommit(yancPath) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: yancPath, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().slice(0, 12);
  } catch { return null; }
}

/* ============================================================
 *  Lexer parser  (CMMComp.l → tokens / keywords / operators)
 *
 *  Each rule in CMMComp.l takes one of these forms:
 *      "literal"     return TOKEN;
 *      "literal"    {... return TOKEN; ...}
 *  We pull `literal` and `TOKEN`, then classify the literal by
 *  hand-curated sets — the lexer is the single source of truth
 *  for which strings the parser will ever see.
 * ========================================================== */

const TYPE_KEYWORDS         = new Set(['int', 'float', 'comp', 'void']);
const LANGUAGE_KEYWORDS     = new Set(['while', 'break', 'if', 'else', 'switch', 'case', 'default', 'return']);
const IO_KEYWORDS           = new Set(['in', 'fin', 'out', 'fout']);
const STDLIB_FUNCTIONS      = new Set([
  'norm', 'pset', 'abs', 'sign', 'copy',
  'sqrt', 'atan', 'sin', 'cos',
  'real', 'imag', 'fase', 'complex', 'mod2',
]);
const MACRO_DIRECTIVES      = new Set(['#USEMAC', '#ENDMAC', '#INTERPOINT']);
// Single-character operators get caught by the {CARES} class in the
// lexer, not by a named rule — they never reach this scraper.
const OPERATOR_SHAPE_RE = /^[<>=!&|+\-*/%~^?:]+$/;

function parseLexer(src) {
  if (!src) return null;
  const result = {
    hwDirectives:     [], // #NBMANT, #NUBITS, #NUIOIN, ...
    macroDirectives:  [], // #USEMAC, #ENDMAC, #INTERPOINT
    keywords:         [],
    types:            [],
    ioKeywords:       [],
    stdlibFunctions:  [],
    operators:        [],
    diracTokens:      [],
  };

  // The lexer keeps each rule on its own line. We capture every quoted
  // literal followed by either a bare `return X;` or an action block
  // that returns X. `[^"]+` is intentional — no escaped quotes appear
  // in CMMComp.l, and trying to handle them here would only invite
  // false positives off legitimate code in actions.
  const ruleRe = /^\s*"([^"]+)"\s+(?:return\s+(\w+)\s*;|\{[^}]*?return\s+(\w+)\s*;[^}]*\})/gm;
  let m;
  while ((m = ruleRe.exec(src))) {
    const text  = m[1];
    const token = m[2] || m[3];
    const entry = { symbol: text, token };

    if (text.startsWith('#')) {
      (MACRO_DIRECTIVES.has(text) ? result.macroDirectives : result.hwDirectives).push(entry);
    } else if (TYPE_KEYWORDS.has(text)) {
      result.types.push(text);
    } else if (LANGUAGE_KEYWORDS.has(text)) {
      result.keywords.push(text);
    } else if (IO_KEYWORDS.has(text)) {
      result.ioKeywords.push(text);
    } else if (STDLIB_FUNCTIONS.has(text)) {
      result.stdlibFunctions.push(text);
    } else if (OPERATOR_SHAPE_RE.test(text)) {
      result.operators.push(entry);
    } else {
      // Dirac-style notation (⟩, ⟨, |I|, |0⟩) and anything else exotic
      // lands here; the AI can still surface them as known constructs.
      result.diracTokens.push(entry);
    }
  }
  return result;
}

/* ============================================================
 *  Directives parser  (diretivas.c / diretivas.h)
 *
 *  Pulls defaults from "int xxx = N;" and human descriptions from
 *  the trailing "// blah" comment. Tolerates `extern` and array
 *  decls so the same regex works on both .c and .h sources.
 * ========================================================== */

const DECL_RE = /^\s*(?:extern\s+)?(?:char|int)\s+(\w+)\s*(?:\[\d+\])?\s*(?:=\s*([^;]+?))?\s*;\s*(?:\/\/\s*(.+))?\s*$/gm;

function parseDirectiveSource(src) {
  if (!src) return {};
  const acc = {};
  let m;
  while ((m = DECL_RE.exec(src))) {
    const name        = m[1].toLowerCase();
    const defaultRaw  = m[2]?.trim();
    const description = m[3]?.trim();
    const prev = acc[name] || {};
    const next = { ...prev };
    if (defaultRaw && /^-?\d+$/.test(defaultRaw)) next.default = parseInt(defaultRaw, 10);
    if (description) next.description = description;
    acc[name] = next;
  }
  return acc;
}

function buildDirectives(lexResult, ...sources) {
  // Merge information from every directive source in order — first hit
  // wins for `description`, later sources still fill in missing
  // `default`s where they appear.
  const merged = {};
  for (const src of sources) {
    const parsed = parseDirectiveSource(src);
    for (const [name, info] of Object.entries(parsed)) {
      merged[name] = { ...info, ...(merged[name] || {}) };
    }
  }
  const out = {};
  for (const d of (lexResult?.hwDirectives || [])) {
    const key = d.symbol.replace(/^#/, '');
    const lookup = key.toLowerCase();
    out[key] = {
      symbol: d.symbol,
      token: d.token,
      ...(merged[lookup] || {}),
    };
  }
  return out;
}

/* ============================================================
 *  Message catalog parser  (messages.h)
 *
 *  Each entry is a bilingual `#define MSG_X M("pt", "en")`.
 *  Section comments above groups give us categories.
 * ========================================================== */

function inferSeverity(code) {
  if (code.includes('_ERR_'))  return 'error';
  if (code.includes('_WARN_')) return 'warning';
  if (code.includes('_INFO_')) return 'info';
  if (code.includes('_OK_'))   return 'success';
  if (code.startsWith('MSG_CLI')) return 'cli';
  return 'message';
}

// Match the section banners in messages.h, e.g.
//   // declaration / assignment errors --------------------------
//   // command-line interface ----------------------------------
// The lazy `.+?` allows hyphens inside the section name (e.g.
// "command-line", "variable-use") but the `\s+-{3,}` anchor still
// pins the closing dash run.
const SECTION_RE = /^\s*\/\/\s+(.+?)\s+-{3,}\s*$/gm;

function decodeC(s) {
  // Convert C-escape sequences relevant to message strings. We don't
  // need a full C unescape — printf format specifiers (%d, %s, …)
  // stay verbatim because the AI surfaces them as patterns.
  return s
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}

// Skip a quoted C string literal starting at index i (i points at the
// opening `"`). Returns the index *after* the closing `"`. Handles
// embedded escapes so a `\"` inside the literal doesn't terminate it.
function skipString(src, i) {
  i++; // past opening "
  while (i < src.length && src[i] !== '"') {
    if (src[i] === '\\' && i + 1 < src.length) i += 2;
    else i++;
  }
  return i + 1; // past closing "
}

// Split the body of `M(...)` on its single top-level comma — the C
// preprocessor allows commas inside string literals and parens
// (think `MSG_CLI_HELP` with "cmmcomp (YANC)" in the body), so a
// naive `body.split(',')` would mangle them.
function splitTopLevelComma(body) {
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') { i = skipString(body, i) - 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      return [body.slice(0, i), body.slice(i + 1)];
    }
  }
  return [body];
}

// Concatenate all `"..."` literals in `s` (the C preprocessor glues
// adjacent string literals into one) and decode the C escapes.
function concatStrings(s) {
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let out = '';
  let m;
  while ((m = re.exec(s))) out += m[1];
  return decodeC(out);
}

function parseMessages(src) {
  if (!src) return [];

  const sections = [];
  let sm;
  while ((sm = SECTION_RE.exec(src))) {
    sections.push({ name: sm[1].trim().toLowerCase(), index: sm.index });
  }
  const categoryAt = (pos) => {
    let cat = 'general';
    for (const s of sections) {
      if (s.index <= pos) cat = s.name;
      else break;
    }
    return cat;
  };

  // Each macro looks like:
  //     #define MSG_X \
  //         M("pt-text", "en-text")
  // We anchor on the `#define MSG_X`, scan forward to `M(`, then walk
  // until the matching `)` while properly skipping over string
  // literals. That makes the parser robust to embedded parens inside
  // the message body (e.g. `"cmmcomp (YANC)"` in `MSG_CLI_HELP`).
  const defRe = /#define\s+(MSG_\w+)\b/g;
  const out = [];
  let dm;
  while ((dm = defRe.exec(src))) {
    const code = dm[1];
    const mStart = src.indexOf('M(', dm.index + dm[0].length);
    if (mStart < 0) continue;
    let i = mStart + 2;
    let depth = 1;
    const bodyStart = i;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"') { i = skipString(src, i); continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    if (depth !== 0) continue;          // unbalanced — skip
    const body = src.slice(bodyStart, i - 1);
    const [ptRaw, enRaw] = splitTopLevelComma(body);
    if (ptRaw === undefined || enRaw === undefined) continue;
    out.push({
      code,
      severity: inferSeverity(code),
      category: categoryAt(dm.index),
      pt: concatStrings(ptRaw),
      en: concatStrings(enRaw),
    });
  }
  return out;
}

/* ============================================================
 *  Grammar parser  (CMMComp.y)
 *
 *  v1: lift the %token list and the LHS production names. A full
 *  BNF dump can come later if the AI needs more structure.
 * ========================================================== */

function parseGrammar(src) {
  if (!src) return { tokens: [], productions: [] };
  const tokens = new Set();
  const tokenRe = /%token(?:\s*<\w+>)?\s+([^\n]+)/g;
  let tm;
  while ((tm = tokenRe.exec(src))) {
    for (const t of tm[1].split(/\s+/)) {
      if (/^[A-Z][A-Z0-9_]*$/.test(t)) tokens.add(t);
    }
  }
  // Production heads: lowercase identifier followed by `:` at the
  // start of a line. We split the file on the `%%` separators first
  // so the prologue (C declarations) doesn't pollute the list.
  const parts = src.split(/^%%$/m);
  const grammarBody = parts[1] || '';
  const productions = new Set();
  const prodRe = /^([a-z]\w*)\s*\n?\s*:/gm;
  let pm;
  while ((pm = prodRe.exec(grammarBody))) {
    productions.add(pm[1]);
  }
  return { tokens: [...tokens].sort(), productions: [...productions].sort() };
}

/* ============================================================
 *  Main
 * ========================================================== */

function main() {
  const yancPath = resolveYancPath();
  if (!fs.existsSync(yancPath)) {
    console.error(`[sync-sapho-rules] yanc path not found: ${yancPath}`);
    console.error('Pass --yanc <path> or set YANC_PATH.');
    process.exit(1);
  }

  const cmm = {
    lex:     readSafe(path.join(yancPath, 'CMMComp', 'Sources', 'CMMComp.l')),
    grammar: readSafe(path.join(yancPath, 'CMMComp', 'Sources', 'CMMComp.y')),
    dirC:    readSafe(path.join(yancPath, 'CMMComp', 'Sources', 'diretivas.c')),
    dirH:    readSafe(path.join(yancPath, 'CMMComp', 'Headers', 'diretivas.h')),
    msg:     readSafe(path.join(yancPath, 'CMMComp', 'Headers', 'messages.h')),
  };

  const lex        = parseLexer(cmm.lex);
  const directives = buildDirectives(lex, cmm.dirC, cmm.dirH);
  const messages   = parseMessages(cmm.msg);
  const grammar    = parseGrammar(cmm.grammar);

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      yancPath: path.resolve(yancPath).replace(/\\/g, '/'),
      yancCommit: gitCommit(yancPath),
    },
    language: lex ? {
      keywords:        lex.keywords.sort(),
      types:           lex.types.sort(),
      ioKeywords:      lex.ioKeywords.sort(),
      stdlibFunctions: lex.stdlibFunctions.sort(),
      operators:       lex.operators,
      diracTokens:     lex.diracTokens,
      macroDirectives: lex.macroDirectives,
    } : {},
    directives,
    grammar,
    messages,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n');

  const rel = path.relative(REPO_ROOT, OUT_PATH).replace(/\\/g, '/');
  console.log(`[sync-sapho-rules] wrote ${rel}`);
  console.log(`  keywords:   ${out.language.keywords?.length ?? 0}`);
  console.log(`  directives: ${Object.keys(directives).length}`);
  console.log(`  messages:   ${messages.length}`);
  console.log(`  tokens:     ${grammar.tokens.length}`);
  console.log(`  productions:${grammar.productions.length}`);
  if (out.source.yancCommit) console.log(`  yanc commit: ${out.source.yancCommit}`);
}

main();
