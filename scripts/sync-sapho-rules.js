#!/usr/bin/env node
/**
 * sync-sapho-rules.js: dev-only generator for `resources/sapho_rules.json`.
 *
 * Reads the yanc compiler sources (default `C:\Users\LCOM\Documents\Github\yanc`,
 * overridable via `--yanc <path>` or `$YANC_PATH`) and consolidates the
 * CMM language surface (keywords, types, operators, hardware directives,
 * bilingual error/warning catalog, grammar skeleton) into a single static
 * JSON the Aurora Intelligence panel ships with.
 *
 * Why this exists
 * ---------------
 * yanc is *not* bundled into the AURORA installer, the binaries are
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
 *  hand-curated sets, the lexer is the single source of truth
 *  for which strings the parser will ever see.
 * ========================================================== */

const TYPE_KEYWORDS         = new Set(['int', 'float', 'comp', 'void']);
const LANGUAGE_KEYWORDS     = new Set([
  'while', 'do', 'for', 'break', 'continue',
  'if', 'else', 'switch', 'case', 'default', 'return',
]);
const IO_KEYWORDS           = new Set(['in', 'fin', 'out', 'fout']);
const STDLIB_FUNCTIONS      = new Set([
  'norm', 'pset', 'abs', 'sign', 'copy',
  'sqrt', 'atan', 'sin', 'cos', 'tan', 'exp', 'log', 'pow',
  'cosh', 'sinh', 'tanh', 'floor', 'ceil', 'round',
  'real', 'imag', 'fase', 'complex', 'mod2', 'conj',
]);
const MACRO_DIRECTIVES      = new Set(['#PRACA']);
// Single-character operators get caught by the {CARES} class in the
// lexer, not by a named rule, they never reach this scraper.
const OPERATOR_SHAPE_RE = /^[<>=!&|+\-*/%~^?:]+$/;

function parseLexer(src) {
  if (!src) return null;
  const result = {
    hwDirectives:     [], // #NBMANT, #NUBITS, #NUIOIN, ...
    macroDirectives:  [], // #PRACA
    keywords:         [],
    types:            [],
    ioKeywords:       [],
    stdlibFunctions:  [],
    operators:        [],
    diracTokens:      [],
  };

  // The lexer keeps each rule on its own line. We capture every quoted
  // literal followed by either a bare `return X;` or an action block
  // that returns X. `[^"]+` is intentional, no escaped quotes appear
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

  // `#define` is handled by a lexer start-condition (`"#define" BEGIN(DEFNAME)`),
  // not a `return TOKEN;` rule, so the ruleRe above never sees it. Detect it
  // directly and record it as the object-like macro directive it is, the AI
  // needs to know C± has `#define NAME body` (and only object-like, no
  // function-like macros / #ifdef / #include, those live in the C++ front-end).
  if (/^\s*"#define"/m.test(src)) {
    result.macroDirectives.push({
      symbol: '#define',
      token: 'DEFINE',
      kind: 'object-macro',
      description: 'object-like macro: a later use of NAME is replaced by re-lexing body (no function-like macros, #ifdef or #include in C±)',
    });
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
  // Merge information from every directive source in order, first hit
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
  // need a full C unescape, printf format specifiers (%d, %s, …)
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

// Split the body of `M(...)` on its single top-level comma, the C
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
 *  ASM lexer parser  (ASMComp.l → SAPHO opcode table)
 *
 *  ASMComp.l registers every mnemonic with `eval_opcode(opNum,
 *  operandKind, yytext, hdlName)` and a trailing `// comment`.
 *  We pull all four arguments and the comment so the AI can see:
 *    - the opcode number (machine code position)
 *    - the operand kind (decoded into a human label)
 *    - the HDL name (empty for opcodes that share encoding with
 *      another mnemonic, JMP/RET/NOP all reuse a sibling slot)
 *    - the one-line description of what the instruction does
 *
 *  Naming conventions (extracted from prefixes/suffixes, used to
 *  group the ISA in the system prompt):
 *      F_*    floating-point variant
 *      S_*    stack-based variant (operand on data stack instead of mem)
 *      SF_*   stack + floating
 *      P_*    pushes acc onto the stack before running the op
 *      PF_*   push + floating
 *      *_M    memory-operand variant of an acc-only op
 *      *_V    constant-offset addressing
 * ========================================================== */

// Decode the operand-kind code that ASMComp.l passes as the second
// argument to eval_opcode(). The numbers come from eval.h in yanc; we
// re-derive their meaning from how they're used in ASMComp.l (and from
// the inline comments in eval_opcode rules).
const OPERAND_KIND = {
  0:  'none',           // accumulator-only / stack-only / no operand
  18: 'memory',         // variable or memory address
  19: 'label',          // jump / call target (@label)
  20: 'input_port',     // port number (INN family)
  21: 'output_port',    // port number (OUT)
  22: 'memory_offset',  // variable + constant offset (LOD_V, ADD_V, ...)
  24: 'address_const',  // LEA — bare address constant
};

// Classify a mnemonic into a coarse family used to group the ISA in
// the system prompt. Each entry is checked in order; the first match
// wins. Order matters: more-specific suffixes go before broader rules.
function classifyMnemonic(mne) {
  // Special / pseudo
  if (mne === 'NOP')   return 'special';
  if (mne === 'F_ROT') return 'special';
  if (mne === 'LDA' || mne === 'STA') return 'indirect';
  if (mne === 'LEA')   return 'memory';

  // Control flow
  if (/^(JMP|JIZ|CAL|RET)$/.test(mne)) return 'control';

  // I/O
  if (/INN$|OUT$/.test(mne)) return 'io';

  // Memory load/store family (LOD/SET/LDI/STI/ILI/ISI and their _V/_P)
  if (/^(P_)?LOD/.test(mne) || /^(P_)?SET/.test(mne) ||
      /^(P_)?LDI/.test(mne) || /^(P_)?STI/.test(mne) ||
      /^(P_)?ILI/.test(mne) || /^(P_)?ISI/.test(mne)) return 'memory';

  // Stack manipulation
  if (mne === 'PSH' || mne === 'POP') return 'stack';

  // Compare
  if (/(LES|GRE|EQU)$/.test(mne.replace(/^S?F?_?/, ''))) return 'compare';

  // Shift
  if (/(SHL|SHR|SRS)$/.test(mne.replace(/^S_/, ''))) return 'shift';

  // Bitwise (AND/ORR/XOR/INV)
  if (/^(S_)?(AND|ORR|XOR)$/.test(mne) || /^(P_)?INV/.test(mne)) return 'bitwise';

  // Logical (LAN/LOR/LIN)
  if (/^(S_)?(LAN|LOR)$/.test(mne) || /^(P_)?LIN/.test(mne)) return 'logical';

  // Conversion (I2F/F2I)
  if (/(I2F|F2I)/.test(mne)) return 'conversion';

  // Normalisation (NRM, divide-by-NUGAIN)
  if (/^(P_)?NRM/.test(mne)) return 'arith_norm';

  // Floating-point arithmetic
  if (/^S?F_/.test(mne) && /(ADD|MLT|DIV|SU1|SU2|NEG|ABS|PST|SGN)/.test(mne)) {
    return 'arith_float';
  }

  // Integer arithmetic
  if (/(ADD|MLT|DIV|MOD|NEG|ABS|PST|SGN)/.test(mne)) return 'arith_int';

  return 'other';
}

// Tag prefix/suffix variants so the AI knows when an opcode is a
// PUSH-prefix / stack-variant / float-variant of another opcode.
function variantTags(mne) {
  const tags = [];
  if (/^F_/.test(mne))      tags.push('float');
  if (/^S_/.test(mne))      tags.push('stack');
  if (/^SF_/.test(mne)) { tags.push('stack'); tags.push('float'); }
  if (/^P_/.test(mne))      tags.push('push_prefix');
  if (/^PF_/.test(mne)) { tags.push('push_prefix'); tags.push('float'); }
  if (/_M$/.test(mne))      tags.push('mem_variant');
  if (/_V$/.test(mne))      tags.push('offset_variant');
  return Array.from(new Set(tags));
}

function parseAsmLexer(src) {
  if (!src) return null;
  const opcodes = [];

  // Each rule looks like:
  //   "LOD"   eval_opcode(  0,18, yytext,    "LOD"  ); // loads data from memory
  // We capture: mnemonic, opcode number, operand kind, hdl name,
  // and the trailing single-line comment (everything after //).
  //
  // The regex is anchored on the start of a line and accepts arbitrary
  // whitespace between fields. The HDL name field is a quoted string
  // (possibly empty: `""`).
  const ruleRe = /^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s+eval_opcode\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*yytext\s*,\s*"([^"]*)"\s*\)\s*;\s*(?:\/\/\s*(.*))?$/gm;
  let m;
  while ((m = ruleRe.exec(src))) {
    const mnemonic   = m[1];
    const opcode     = parseInt(m[2], 10);
    const operandRaw = parseInt(m[3], 10);
    const hdlName    = m[4];
    const description= (m[5] || '').trim();
    opcodes.push({
      mnemonic,
      opcode,
      operandKind: OPERAND_KIND[operandRaw] || `code_${operandRaw}`,
      operandCode: operandRaw,
      hdlName,                    // empty when reused via another opcode slot
      family:  classifyMnemonic(mnemonic),
      variants: variantTags(mnemonic),
      description,
    });
  }

  // Stable order: by opcode number, then mnemonic. Several mnemonics
  // share a number (pseudo-ops like LEA, LOD_V), so the secondary sort
  // keeps the dump deterministic across runs.
  opcodes.sort((a, b) => a.opcode - b.opcode || a.mnemonic.localeCompare(b.mnemonic));
  return opcodes;
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

  // yanc v4+ aninha os compilers em Compilers/<name>/
  const cmm = {
    lex:     readSafe(path.join(yancPath, 'Compilers', 'CMMComp', 'Sources', 'CMMComp.l')),
    grammar: readSafe(path.join(yancPath, 'Compilers', 'CMMComp', 'Sources', 'CMMComp.y')),
    dirC:    readSafe(path.join(yancPath, 'Compilers', 'CMMComp', 'Sources', 'diretivas.c')),
    dirH:    readSafe(path.join(yancPath, 'Compilers', 'CMMComp', 'Headers', 'diretivas.h')),
    msg:     readSafe(path.join(yancPath, 'Compilers', 'CMMComp', 'Headers', 'messages.h')),
  };

  const asm = {
    lex: readSafe(path.join(yancPath, 'Compilers', 'ASMComp', 'Sources', 'ASMComp.l')),
  };

  const lex        = parseLexer(cmm.lex);
  const directives = buildDirectives(lex, cmm.dirC, cmm.dirH);
  const messages   = parseMessages(cmm.msg);
  const grammar    = parseGrammar(cmm.grammar);
  const opcodes    = parseAsmLexer(asm.lex);

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
    asm: opcodes ? { opcodes } : null,
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
  console.log(`  asm opcodes:${opcodes?.length ?? 0}`);
  if (out.source.yancCommit) console.log(`  yanc commit: ${out.source.yancCommit}`);
}

main();
