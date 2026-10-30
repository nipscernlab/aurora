#!/usr/bin/env node
/**
 * sync-sapho-rules.mts: dev-only generator for `resources/sapho_rules.json`.
 *
 * Reads the yanc compiler sources and consolidates the CMM language surface
 * (keywords, types, operators, hardware directives, bilingual error/warning
 * catalog, grammar skeleton) into a single static JSON the Aurora
 * Intelligence panel ships with.
 *
 * Which yanc
 * ----------
 * By default, the one AURORA bundles: the YANC_TAG pinned in
 * components/Scripts/download-yanc.cts, cloned from nipscernlab/yanc into a
 * temporary folder. `--yanc <path>` or `$YANC_PATH` reads a local checkout
 * instead, for trying a yanc that has no tag yet.
 *
 *     npm run rules:sync              regenerate from the pinned tag
 *     npm run rules:sync -- --check   fail if the committed JSON differs
 *
 * Why this exists
 * ---------------
 * The binaries come from the yanc release, but the language they accept is
 * only written down in the yanc sources. Without this sync, the AI would
 * have no idea which directives exist, what their defaults are, or what
 * error messages mean. The JSON is checked into git so packaging never has
 * to look for yanc, and CI runs `--check` so it cannot drift from the
 * bundled version (issue 217: it used to be generated from a clone on one
 * maintainer's machine, whenever someone remembered).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH  = path.join(REPO_ROOT, 'resources', 'sapho_rules.json');
const PINO_DO_YANC = path.join(REPO_ROOT, 'components', 'Scripts', 'download-yanc.cts');
const YANC_REPO = 'https://github.com/nipscernlab/yanc.git';

/* ============================================================
 *  Argument / env resolution
 * ========================================================== */

/** O YANC_TAG que a AURORA empacota, lido do fonte do download-yanc. */
export function tagFixada(fonteDoDownload: string): string {
  const m = fonteDoDownload.match(/^const YANC_TAG\s*=\s*'([^']+)'/m);
  if (!m) throw new Error('YANC_TAG not found in components/Scripts/download-yanc.cts');
  return m[1];
}

/**
 * null quando o JSON versionado e o que acabou de ser gerado sao iguais; senao,
 * a mensagem que o CI mostra.
 */
export function conferir(versionado: string | null, gerado: string, tag: string | null): string | null {
  if (versionado === gerado) return null;
  const qual = tag ? `YANC ${tag}` : 'this yanc checkout';
  return `resources/sapho_rules.json does not match ${qual}. Run \`npm run rules:sync\` and commit the result.`;
}

export function readSafe(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    console.warn(`[sync-sapho-rules] missing: ${path.relative(process.cwd(), p)}`);
    return null;
  }
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

interface LexEntry {
  symbol: string;
  token: string;
  kind?: string;
  description?: string;
}

interface LexResult {
  hwDirectives: LexEntry[];
  macroDirectives: LexEntry[];
  keywords: string[];
  types: string[];
  ioKeywords: string[];
  stdlibFunctions: string[];
  operators: LexEntry[];
  diracTokens: LexEntry[];
}

export function parseLexer(src: string | null): LexResult | null {
  if (!src) return null;
  const result: LexResult = {
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
    const entry: LexEntry = { symbol: text, token };

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

interface DirectiveInfo {
  default?: number;
  description?: string;
}

function parseDirectiveSource(src: string | null): Record<string, DirectiveInfo> {
  if (!src) return {};
  const acc: Record<string, DirectiveInfo> = {};
  let m;
  while ((m = DECL_RE.exec(src))) {
    const name        = m[1].toLowerCase();
    const defaultRaw  = m[2]?.trim();
    const description = m[3]?.trim();
    const prev = acc[name] || {};
    const next: DirectiveInfo = { ...prev };
    if (defaultRaw && /^-?\d+$/.test(defaultRaw)) next.default = parseInt(defaultRaw, 10);
    if (description) next.description = description;
    acc[name] = next;
  }
  return acc;
}

export function buildDirectives(lexResult: LexResult | null, ...sources: (string | null)[]) {
  // Merge information from every directive source in order, first hit
  // wins for `description`, later sources still fill in missing
  // `default`s where they appear.
  const merged: Record<string, DirectiveInfo> = {};
  for (const src of sources) {
    const parsed = parseDirectiveSource(src);
    for (const [name, info] of Object.entries(parsed)) {
      merged[name] = { ...info, ...(merged[name] || {}) };
    }
  }
  const out: Record<string, LexEntry & DirectiveInfo> = {};
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

/**
 * Directives the lexer still recognises only to reject them. Since yanc v7.1
 * `#PRNAME` is lexed so the grammar can say it no longer exists:
 *
 *     direct : PRNAME   ID   {fprintf(stderr, MSG_ERR_PRNAME_GONE, ...); exit(...);}
 *
 * Every `#`-token of CMMComp.l is a directive to parseLexer, so without this
 * the rules would keep offering `#PRNAME` to the AI and the editor. A token
 * whose production in CMMComp.y does nothing but print a `MSG_ERR_*_GONE` is
 * a directive that left the language.
 */
export function diretivasQueSairam(grammarSrc: string | null): Set<string> {
  const out = new Set<string>();
  if (!grammarSrc) return out;
  const re = /\b([A-Z][A-Z0-9_]*)\b[^{}\n]*\{\s*fprintf\s*\(\s*stderr\s*,\s*MSG_ERR_[A-Z0-9_]*_GONE\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(grammarSrc)) !== null) out.add(m[1]);
  return out;
}

/** Tira de `directives` (o que buildDirectives montou) as que sairam da linguagem. */
export function tirarAsQueSairam(directives: Record<string, { token: string }>, grammarSrc: string | null): void {
  for (const saiu of diretivasQueSairam(grammarSrc)) {
    for (const [nome, info] of Object.entries(directives)) {
      if (info.token === saiu) delete directives[nome];
    }
  }
}

/* ============================================================
 *  Message catalog parser  (messages.h)
 *
 *  Each entry is a bilingual `#define MSG_X M("pt", "en")`.
 *  Section comments above groups give us categories.
 * ========================================================== */

function inferSeverity(code: string): string {
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

const ESCAPES_C: Record<string, string> = { '\\': '\\', '"': '"', n: '\n', t: '\t' };

function decodeC(s: string): string {
  // Convert C-escape sequences relevant to message strings. We don't
  // need a full C unescape, printf format specifiers (%d, %s, …)
  // stay verbatim because the AI surfaces them as patterns.
  //
  // Uma passada so. Em quatro replace seguidos, o \\ que o primeiro
  // desfazia virava barra solta, e o seguinte lia `\\n` (barra e n) como
  // quebra de linha (#276).
  return s.replace(/\\([\\"nt])/g, (_, c: string) => ESCAPES_C[c]);
}

// Skip a quoted C string literal starting at index i (i points at the
// opening `"`). Returns the index *after* the closing `"`. Handles
// embedded escapes so a `\"` inside the literal doesn't terminate it.
function skipString(src: string, i: number): number {
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
function splitTopLevelComma(body: string): string[] {
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
function concatStrings(s: string): string {
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let out = '';
  let m;
  while ((m = re.exec(s))) out += m[1];
  return decodeC(out);
}

interface Message {
  code: string;
  severity: string;
  category: string;
  pt: string;
  en: string;
}

export function parseMessages(src: string | null): Message[] {
  if (!src) return [];

  const sections: { name: string; index: number }[] = [];
  let sm;
  while ((sm = SECTION_RE.exec(src))) {
    sections.push({ name: sm[1].trim().toLowerCase(), index: sm.index });
  }
  const categoryAt = (pos: number): string => {
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
  const out: Message[] = [];
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

export function parseGrammar(src: string | null): { tokens: string[]; productions: string[] } {
  if (!src) return { tokens: [], productions: [] };
  const tokens = new Set<string>();
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
  const productions = new Set<string>();
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
const OPERAND_KIND: Record<number, string> = {
  0:  'none',           // accumulator-only / stack-only / no operand
  18: 'memory',         // variable or memory address
  19: 'label',          // jump / call target (@label)
  20: 'input_port',     // port number (INN family)
  21: 'output_port',    // port number (OUT)
  22: 'memory_offset',  // variable + constant offset (LOD_V, ADD_V, ...)
  24: 'address_const',  // LEA — bare address constant
  28: 'base_or_array',  // LDI/ILI/STI/ISI — array name, or a number as the raw base (LDI 0 = mem[acc])
};

// Classify a mnemonic into a coarse family used to group the ISA in
// the system prompt. Each entry is checked in order; the first match
// wins. Order matters: more-specific suffixes go before broader rules.
export function classifyMnemonic(mne: string): string {
  // Special / pseudo
  if (mne === 'NOP')   return 'special';
  if (mne === 'F_ROT') return 'special';
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
function variantTags(mne: string): string[] {
  const tags: string[] = [];
  if (/^F_/.test(mne))      tags.push('float');
  if (/^S_/.test(mne))      tags.push('stack');
  if (/^SF_/.test(mne)) { tags.push('stack'); tags.push('float'); }
  if (/^P_/.test(mne))      tags.push('push_prefix');
  if (/^PF_/.test(mne)) { tags.push('push_prefix'); tags.push('float'); }
  if (/_M$/.test(mne))      tags.push('mem_variant');
  if (/_V$/.test(mne))      tags.push('offset_variant');
  return Array.from(new Set(tags));
}

export interface AsmOpcode {
  mnemonic: string;
  opcode: number;
  operandKind: string;
  operandCode: number;
  hdlName: string;
  family: string;
  variants: string[];
  description: string;
}

export function parseAsmLexer(src: string | null): AsmOpcode[] | null {
  if (!src) return null;
  const opcodes: AsmOpcode[] = [];

  // Each rule looks like:
  //   "LOD"   eval_opcode(  1,18, yytext,    "LOD"  ); // loads data from memory
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

/**
 * O sapho_rules.json de um checkout do yanc. Sem data nem caminho local: o
 * mesmo yanc da sempre o mesmo texto, e e isso que deixa o `--check` do CI
 * comparar byte a byte.
 */
export function gerarRegras(yancPath: string, origem: { yancTag: string | null; yancCommit: string | null }) {
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
  tirarAsQueSairam(directives, cmm.grammar);
  const messages   = parseMessages(cmm.msg);
  const grammar    = parseGrammar(cmm.grammar);
  const opcodes    = parseAsmLexer(asm.lex);

  return {
    schemaVersion: 1,
    source: origem,
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
}

export function serializar(regras: ReturnType<typeof gerarRegras>): string {
  return JSON.stringify(regras, null, 2) + '\n';
}

/* v8 ignore start */ // a cola da linha de comando: clona o yanc, grava ou confere o JSON
/** A checkout local pedido por --yanc ou $YANC_PATH; null = a tag fixada. */
function resolveYancPath(): string | null {
  const idx = process.argv.indexOf('--yanc');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.YANC_PATH) return process.env.YANC_PATH;
  return null;
}

function git(yancPath: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: yancPath, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return null; }
}

function main() {
  const check = process.argv.includes('--check');
  const local = resolveYancPath();
  let yancPath: string;
  let yancTag: string | null;
  let temporario: string | null = null;

  if (local) {
    if (!fs.existsSync(local)) {
      console.error(`[sync-sapho-rules] yanc path not found: ${local}`);
      process.exit(1);
    }
    yancPath = local;
    yancTag = git(local, ['describe', '--tags', '--exact-match', 'HEAD']);
  } else {
    yancTag = tagFixada(fs.readFileSync(PINO_DO_YANC, 'utf8'));
    temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-rules-yanc-'));
    console.log(`[sync-sapho-rules] cloning ${YANC_REPO} at ${yancTag}`);
    // A tag do yanc e anotada: o git avisa que ela "nao e um commit" e conta
    // do HEAD destacado. So o erro interessa, e ele sobe na excecao.
    execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth', '1', '--branch', yancTag, YANC_REPO, temporario],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    yancPath = temporario;
  }

  try {
    const commit = git(yancPath, ['rev-parse', 'HEAD']);
    const regras = gerarRegras(yancPath, { yancTag, yancCommit: commit ? commit.slice(0, 12) : null });
    const texto = serializar(regras);
    const rel = path.relative(REPO_ROOT, OUT_PATH).replace(/\\/g, '/');

    if (check) {
      const versionado = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf8') : null;
      const erro = conferir(versionado, texto, yancTag);
      if (erro) {
        console.error(`[sync-sapho-rules] ${erro}`);
        process.exit(1);
      }
      console.log(`[sync-sapho-rules] ${rel} matches ${yancTag ? `YANC ${yancTag}` : yancPath}.`);
      return;
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, texto);

    console.log(`[sync-sapho-rules] wrote ${rel}`);
    console.log(`  keywords:   ${regras.language.keywords?.length ?? 0}`);
    console.log(`  directives: ${Object.keys(regras.directives).length}`);
    console.log(`  messages:   ${regras.messages.length}`);
    console.log(`  tokens:     ${regras.grammar.tokens.length}`);
    console.log(`  productions:${regras.grammar.productions.length}`);
    console.log(`  asm opcodes:${regras.asm?.opcodes.length ?? 0}`);
    console.log(`  yanc:       ${yancTag ?? '(no tag)'} ${regras.source.yancCommit ?? ''}`);
  } finally {
    if (temporario) fs.rmSync(temporario, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
/* v8 ignore stop */
