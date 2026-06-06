/**
 * deterministic_harness.js — conversor DETERMINISTICO (sem IA) de um testbench
 * Verilog "bem comportado" (so estimulos + 1 instancia do top-level) num harness
 * C++ Verilator SINCRONO (loop de clock, SEM --timing). Espelha o que o harness
 * IA (ai_harness_prompt.js) faz com um LLM, mas por PARSING: instantaneo, grátis,
 * reproduzivel. So serve pra tb ELEGIVEL — um detector diz sim/nao ANTES.
 *
 * Puro (sem I/O, sem window). A orquestracao (build/run/validacao contra o
 * gabarito) reusa a MESMA infra do harness IA em CompilationModule.
 *
 * MODELO (a ideia toda): o clock "always #N clk=~clk" (clk parte de 0) tem
 * posedge no tempo halfPeriod + k*period (period=2N). Um evento do testbench no
 * tempo T (uma atribuicao, um $fscanf) faz efeito no PRIMEIRO posedge >= T, ou
 * seja no ciclo  ceil((T - halfPeriod)/period), clampado a >=0. Caminhamos a
 * linha-do-tempo de cada `initial` (begin sequencial, fork paralelo, repeat/for
 * desenrolados), viramos cada evento num par (ciclo, acao) ordenado, e o C++
 * aplica os eventos por um ponteiro monotonico dentro do loop de ciclos. Como o
 * tb elegivel NAO tem `always @(posedge)` de estado, nao ha logica de "advance":
 * toda a dinamica esta na linha-do-tempo dos initials.
 */

import { stripVerilogComments } from '../wave/testbench_instrumenter.js';
import { findDutInstance } from '../wave/gold_instrumenter.js';
import { dumpSection } from './ai_harness_prompt.js';

// =====================================================================
// Tokenizer
// =====================================================================

/**
 * Tokeniza Verilog (ja sem comentarios) numa lista de tokens. Tipos:
 *  - 'num'  literal numerico (12345, 16'd0, 1'b1, 'h1A, 16'sd-1...)
 *  - 'id'   identificador OU keyword OU tarefa de sistema ($fscanf, $finish)
 *  - 'str'  conteudo de "..." (sem as aspas)
 *  - 'op'   operador/pontuacao de 1 char (= ( ) , ~ + - * / { } [ ] < > . : @ etc)
 *  - 'le'   o operador '<=' (nao-bloqueante)
 *  - 'hash' '#' (delay control)
 *  - 'semi' ';'
 */
export function tokenize(src) {
  const s = String(src || '');
  const n = s.length;
  const toks = [];
  const isIdStart = (c) => /[A-Za-z_$]/.test(c);
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    // string "..."
    if (c === '"') {
      let j = i + 1; let str = '';
      while (j < n && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < n) { str += s[j + 1]; j += 2; } else { str += s[j]; j++; }
      }
      toks.push({ type: 'str', value: str });
      i = j + 1; continue;
    }
    // numero: [digits] opcional + base ('b/'d/'h/'o, com 's' opcional p/ signed)
    if (/[0-9]/.test(c) || (c === "'" && /[sSbBdDhHoO]/.test(s[i + 1] || ''))) {
      let j = i; let num = '';
      while (j < n && /[0-9_]/.test(s[j])) { num += s[j]; j++; }
      if (s[j] === "'") {
        num += s[j]; j++;
        if (j < n && /[sS]/.test(s[j])) { num += s[j]; j++; }
        if (j < n && /[bBdDhHoO]/.test(s[j])) { num += s[j]; j++; }
        while (j < n && /[0-9a-fA-FxXzZ_]/.test(s[j])) { num += s[j]; j++; }
      }
      toks.push({ type: 'num', value: num });
      i = j; continue;
    }
    if (isIdStart(c)) {
      let j = i; let id = '';
      while (j < n && isId(s[j])) { id += s[j]; j++; }
      toks.push({ type: 'id', value: id });
      i = j; continue;
    }
    if (c === '<' && s[i + 1] === '=') { toks.push({ type: 'le', value: '<=' }); i += 2; continue; }
    if (c === '#') { toks.push({ type: 'hash', value: '#' }); i++; continue; }
    if (c === ';') { toks.push({ type: 'semi', value: ';' }); i++; continue; }
    toks.push({ type: 'op', value: c });
    i++;
  }
  return toks;
}

/**
 * Converte um literal Verilog num inteiro JS (BigInt-free; usa Number — os
 * valores de delay/contagem cabem em double com folga). Suporta:
 *  - decimal puro: 12345
 *  - sized: 16'd0, 1'b1, 8'hFF, 4'o7, com '_' separador e 's' (signed) ignorado
 *  - based sem size: 'h1A, 'b101
 * Retorna NaN se houver x/z (valor desconhecido — nao da pra converter).
 */
export function parseVerilogLiteral(tok) {
  let t = String(tok || '').replace(/_/g, '').trim();
  const tick = t.indexOf("'");
  if (tick === -1) {
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  }
  let rest = t.slice(tick + 1);
  if (/^[sS]/.test(rest)) rest = rest.slice(1);
  const base = rest[0]?.toLowerCase();
  const digits = rest.slice(1);
  if (/[xXzZ]/.test(digits)) return NaN;
  const radix = base === 'b' ? 2 : base === 'o' ? 8 : base === 'h' ? 16 : base === 'd' ? 10 : null;
  if (radix === null) return NaN;
  const v = parseInt(digits, radix);
  return Number.isFinite(v) ? v : NaN;
}

// =====================================================================
// Parser de declaracoes (regs) — larguras/sinal/init dos registradores do tb
// =====================================================================

/**
 * Le as declaracoes `reg`/`integer` do testbench. Devolve um Map nome->info
 * { width, signed, init }. `integer` => 32 bits signed. Usado pra tipar/inicar
 * os locais C++ e pra mascarar os drives na largura certa.
 */
export function parseRegDecls(src) {
  const s = stripVerilogComments(src);
  const out = new Map();
  // reg [signed] [a:b] name [= init] (, name2 ...) ;
  const reReg = /\breg\b(\s+signed\b)?\s*(\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*([^;]+);/g;
  for (const m of s.matchAll(reReg)) {
    const signed = !!m[1];
    const width = m[3] !== undefined ? Math.abs(parseInt(m[3], 10) - parseInt(m[4], 10)) + 1 : 1;
    for (const decl of m[5].split(',')) {
      const d = decl.trim();
      const eq = d.indexOf('=');
      const name = (eq === -1 ? d : d.slice(0, eq)).trim().replace(/\[.*$/, '').trim();
      if (!/^[A-Za-z_]\w*$/.test(name)) continue;
      const init = eq === -1 ? 0 : (parseVerilogLiteral(d.slice(eq + 1).trim()) || 0);
      out.set(name, { width, signed, init: Number.isFinite(init) ? init : 0 });
    }
  }
  // integer name [= init] (, ...) ;
  const reInt = /\binteger\b\s*([^;]+);/g;
  for (const m of s.matchAll(reInt)) {
    for (const decl of m[1].split(',')) {
      const d = decl.trim();
      const eq = d.indexOf('=');
      const name = (eq === -1 ? d : d.slice(0, eq)).trim();
      if (!/^[A-Za-z_]\w*$/.test(name)) continue;
      const init = eq === -1 ? 0 : (parseVerilogLiteral(d.slice(eq + 1).trim()) || 0);
      out.set(name, { width: 32, signed: true, init: Number.isFinite(init) ? init : 0 });
    }
  }
  return out;
}

// =====================================================================
// Deteccao de clock
// =====================================================================

/**
 * Acha o clock: `always #N <id> = ~<id>;` (ou `<=`). Devolve
 * { name, halfPeriod, period } ou null. So um clock e' suportado.
 */
export function detectClockGen(toks) {
  for (let i = 0; i + 7 < toks.length; i++) {
    if (toks[i].type === 'id' && toks[i].value === 'always' &&
        toks[i + 1].type === 'hash' && toks[i + 2].type === 'num' &&
        toks[i + 3].type === 'id' &&
        (toks[i + 4].type === 'op' && toks[i + 4].value === '=' || toks[i + 4].type === 'le') &&
        toks[i + 5].type === 'op' && toks[i + 5].value === '~' &&
        toks[i + 6].type === 'id' && toks[i + 6].value === toks[i + 3].value) {
      const half = parseVerilogLiteral(toks[i + 2].value);
      if (Number.isFinite(half) && half > 0) {
        return { name: toks[i + 3].value, halfPeriod: half, period: half * 2 };
      }
    }
  }
  return null;
}

// =====================================================================
// Walker da linha-do-tempo (eventos) dos blocos `initial`
// =====================================================================

class DeterministicError extends Error {}

/**
 * Avalia uma expressao constante (delays, contagens de loop, valores) sobre uma
 * fatia de tokens [p, end). Suporta + - * / unario, parens, literais e variaveis
 * do env (vars de loop). Retorna o valor (Number). Lanca DeterministicError se
 * encontrar algo nao-constante (ex: $random, sinal).
 */
function evalExprTokens(toks, p, end, env) {
  // recursivo: expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)*
  let pos = p;
  const peek = () => (pos < end ? toks[pos] : null);
  function factor() {
    const t = peek();
    if (!t) throw new DeterministicError('expressao incompleta');
    if (t.type === 'op' && (t.value === '-' || t.value === '+' || t.value === '~')) {
      pos++;
      const v = factor();
      return t.value === '-' ? -v : t.value === '~' ? ~v : v;
    }
    if (t.type === 'op' && t.value === '(') {
      pos++;
      const v = expr();
      const close = peek();
      if (!close || close.value !== ')') throw new DeterministicError('parenteses sem fechar');
      pos++;
      return v;
    }
    if (t.type === 'num') { pos++; const v = parseVerilogLiteral(t.value); if (!Number.isFinite(v)) throw new DeterministicError(`literal nao-constante "${t.value}"`); return v; }
    if (t.type === 'id') {
      if (env && env.has(t.value)) { pos++; return env.get(t.value); }
      throw new DeterministicError(`identificador nao-constante "${t.value}" em expressao`);
    }
    throw new DeterministicError(`token inesperado "${t.value}" em expressao`);
  }
  function term() {
    let v = factor();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '*' || t.value === '/')) {
        pos++; const r = factor(); v = t.value === '*' ? v * r : Math.trunc(v / r);
      } else break;
    }
    return v;
  }
  function expr() {
    let v = term();
    for (;;) {
      const t = peek();
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        pos++; const r = term(); v = t.value === '+' ? v + r : v - r;
      } else break;
    }
    return v;
  }
  const val = expr();
  return { val, next: pos };
}

/**
 * Acha o indice do token que casa o fechamento de um bloco/par, dado um par
 * (open, closeSet). Conta profundidade. start aponta para DEPOIS do token de
 * abertura. Devolve o indice do token de fechamento.
 */
function matchDelim(toks, start, opens, closes) {
  let depth = 1;
  for (let p = start; p < toks.length; p++) {
    const v = toks[p].value;
    if (opens.includes(v)) depth++;
    else if (closes.includes(v)) { depth--; if (depth === 0) return p; }
  }
  return -1;
}

/**
 * Parser dos blocos `initial`. Caminha os statements acumulando o tempo (cur.t),
 * empurrando eventos { t, kind, ... } em ctx.events e fopens em ctx.fopens.
 * Suporta: #delay, begin/end, fork/join, repeat, for, atribuicao (=,<=),
 * $fscanf, $fopen, $finish/$stop, e ignora $display/$write/$fflush/$fclose/etc.
 */
class InitialParser {
  constructor(toks, ctx) {
    this.toks = toks;
    this.ctx = ctx; // { events, fopens, clkName, emitWarn }
  }

  // parseStatement: devolve o indice apos o statement. cur = { t }.
  stmt(p, cur, env) {
    const toks = this.toks;
    const t = toks[p];
    if (!t) return p;
    if (t.type === 'semi') return p + 1; // statement vazio
    if (t.type === 'hash') {
      // #delay <stmt>
      let dp = p + 1;
      let delay;
      if (toks[dp] && toks[dp].type === 'op' && toks[dp].value === '(') {
        const close = matchDelim(toks, dp + 1, ['('], [')']);
        if (close === -1) throw new DeterministicError('#(...) sem fechar');
        delay = evalExprTokens(toks, dp + 1, close, env).val;
        dp = close + 1;
      } else {
        const r = evalExprTokens(toks, dp, dp + 1, env);
        delay = r.val; dp = r.next;
      }
      if (!Number.isFinite(delay)) throw new DeterministicError('delay nao-constante');
      cur.t += delay;
      // o que segue o delay e' outro statement (pode ser ';' vazio)
      return this.stmt(dp, cur, env);
    }
    if (t.type === 'id') {
      const kw = t.value;
      if (kw === 'begin') return this.block(p + 1, 'end', cur, env, false);
      if (kw === 'fork') return this.block(p + 1, 'join', cur, env, true);
      if (kw === 'repeat') return this.repeatStmt(p + 1, cur, env);
      if (kw === 'for') return this.forStmt(p + 1, cur, env);
      if (kw === 'while' || kw === 'forever' || kw === 'if' || kw === 'case' || kw === 'wait') {
        throw new DeterministicError(`construcao de controle nao suportada em initial: "${kw}"`);
      }
      if (kw[0] === '$') return this.sysTask(p, cur, env);
      // atribuicao: <lhs> ('='|'<=') <rhs> ;
      return this.assign(p, cur, env);
    }
    throw new DeterministicError(`token inesperado "${t.value}" em initial`);
  }

  // bloco begin..end (sequencial) ou fork..join (paralelo).
  block(p, endKw, cur, env, parallel) {
    const toks = this.toks;
    const t0 = cur.t;
    let maxT = cur.t;
    while (p < toks.length) {
      const t = toks[p];
      if (t.type === 'id' && (t.value === endKw || (endKw === 'join' && /^join/.test(t.value)))) {
        if (t.value === 'join_any' || t.value === 'join_none') {
          throw new DeterministicError(`"${t.value}" nao suportado (use fork..join)`);
        }
        if (parallel) cur.t = maxT;
        return p + 1;
      }
      if (parallel) cur.t = t0;
      p = this.stmt(p, cur, env);
      if (parallel) maxT = Math.max(maxT, cur.t);
    }
    throw new DeterministicError(`bloco "${endKw}" sem fechar`);
  }

  repeatStmt(p, cur, env) {
    const toks = this.toks;
    if (!toks[p] || toks[p].value !== '(') throw new DeterministicError('repeat sem (');
    const close = matchDelim(toks, p + 1, ['('], [')']);
    if (close === -1) throw new DeterministicError('repeat(...) sem fechar');
    const count = evalExprTokens(toks, p + 1, close, env).val;
    if (!Number.isFinite(count) || count < 0) throw new DeterministicError('contagem de repeat nao-constante');
    // o corpo e' UM statement; reparseamos ele `count` vezes a partir do mesmo p.
    const bodyStart = close + 1;
    let after = bodyStart;
    for (let k = 0; k < count; k++) {
      after = this.stmt(bodyStart, cur, env);
    }
    return after;
  }

  forStmt(p, cur, env) {
    const toks = this.toks;
    if (!toks[p] || toks[p].value !== '(') throw new DeterministicError('for sem (');
    const close = matchDelim(toks, p + 1, ['('], [')']);
    if (close === -1) throw new DeterministicError('for(...) sem fechar');
    // for ( <var> = <init> ; <var> <op> <bound> ; <var> = <var> <op> <step> )
    const head = [];
    for (let q = p + 1; q < close; q++) head.push(toks[q]);
    // separa por ';' nos 3 campos
    const fields = [[], [], []];
    let fi = 0;
    for (const tk of head) { if (tk.type === 'semi') { fi++; continue; } if (fi < 3) fields[fi].push(tk); }
    // init: var = expr
    if (fields[0].length < 3 || fields[0][1].value !== '=') throw new DeterministicError('for: init invalido');
    const varName = fields[0][0].value;
    const localEnv = new Map(env || []);
    localEnv.set(varName, evalExprTokens(fields[0], 2, fields[0].length, localEnv).val);
    // cond: var <op> bound
    const cond = fields[1];
    if (cond.length < 3 || cond[0].value !== varName) throw new DeterministicError('for: condicao invalida');
    const cmp = cond[1].value;
    const boundEnv = new Map(localEnv);
    // incr: var = var <op> step
    const incr = fields[2];
    if (incr.length < 5 || incr[0].value !== varName || incr[1].value !== '=' || incr[2].value !== varName) {
      throw new DeterministicError('for: incremento invalido');
    }
    const stepOp = incr[3].value;
    const bodyStart = close + 1;
    let after = bodyStart;
    let guard = 0;
    for (;;) {
      const iv = localEnv.get(varName);
      const bound = evalExprTokens(cond, 2, cond.length, boundEnv).val;
      let go;
      if (cmp === '<') go = iv < bound; else if (cmp === '<=') go = iv <= bound;
      else if (cmp === '>') go = iv > bound; else if (cmp === '>=') go = iv >= bound;
      else throw new DeterministicError(`for: comparador "${cmp}" nao suportado`);
      if (!go) break;
      after = this.stmt(bodyStart, cur, localEnv);
      const step = evalExprTokens(incr, 4, incr.length, localEnv).val;
      if (stepOp === '+') localEnv.set(varName, iv + step);
      else if (stepOp === '-') localEnv.set(varName, iv - step);
      else if (stepOp === '*') localEnv.set(varName, iv * step);
      else throw new DeterministicError(`for: operador de passo "${stepOp}" nao suportado`);
      if (++guard > 10_000_000) throw new DeterministicError('for: loop excessivo (>10M iteracoes)');
    }
    return after;
  }

  sysTask(p, cur, env) {
    const toks = this.toks;
    const name = toks[p].value;
    let q = p + 1;
    if (name === '$finish' || name === '$stop') {
      if (toks[q] && toks[q].value === '(') { const c = matchDelim(toks, q + 1, ['('], [')']); q = c + 1; }
      if (toks[q] && toks[q].type === 'semi') q++;
      this.ctx.events.push({ t: cur.t, kind: 'finish' });
      return q;
    }
    // $display/$write/$fwrite/$fflush/$fclose/$fdisplay/$readmemh/... -> ignora
    if (toks[q] && toks[q].value === '(') { const c = matchDelim(toks, q + 1, ['('], [')']); q = c + 1; }
    if (toks[q] && toks[q].type === 'semi') q++;
    return q;
  }

  assign(p, cur, env) {
    const toks = this.toks;
    const lhs = toks[p].value;
    let q = p + 1;
    // bit/part-select no LHS: pula [ ... ] (driva o reg inteiro mesmo)
    if (toks[q] && toks[q].value === '[') { const c = matchDelim(toks, q + 1, ['['], [']']); q = c + 1; }
    const opTok = toks[q];
    if (!opTok || !(opTok.type === 'le' || (opTok.type === 'op' && opTok.value === '='))) {
      throw new DeterministicError(`atribuicao malformada perto de "${lhs}"`);
    }
    q++;
    const rhs = toks[q];
    if (rhs && rhs.type === 'id' && rhs.value === '$fscanf') {
      return this.fscanf(q, lhs, cur, env);
    }
    if (rhs && rhs.type === 'id' && rhs.value === '$fopen') {
      return this.fopen(q, lhs, cur, env);
    }
    if (rhs && rhs.type === 'id' && rhs.value[0] === '$') {
      // $random, $time, etc. no RHS -> nao-determinístico
      throw new DeterministicError(`RHS de sistema "${rhs.value}" nao suportado (nao-determinístico)`);
    }
    // valor constante (expressao): ate o ';'
    let end = q;
    while (end < toks.length && toks[end].type !== 'semi') end++;
    const { val } = evalExprTokens(toks, q, end, env);
    if (this.ctx.clkName !== lhs) {
      this.ctx.events.push({ t: cur.t, kind: 'assign', target: lhs, value: val });
    }
    return end + 1;
  }

  fscanf(q, _lhs, cur, env) {
    const toks = this.toks;
    // $fscanf ( <fd> , "<fmt>" , <target> )
    if (!toks[q + 1] || toks[q + 1].value !== '(') throw new DeterministicError('$fscanf sem (');
    const close = matchDelim(toks, q + 2, ['('], [')']);
    if (close === -1) throw new DeterministicError('$fscanf(...) sem fechar');
    // argumentos separados por virgula no nivel 0
    const args = this.splitArgs(q + 2, close);
    if (args.length < 3) throw new DeterministicError('$fscanf precisa de (fd, fmt, target)');
    const fd = toks[args[0][0]] ? toks[args[0][0]].value : null;
    const fmtTok = toks[args[1][0]];
    const fmt = fmtTok && fmtTok.type === 'str' ? fmtTok.value : '%d';
    const target = toks[args[2][0]] ? toks[args[2][0]].value : null;
    if (!fd || !target) throw new DeterministicError('$fscanf com fd/target invalido');
    this.ctx.events.push({ t: cur.t, kind: 'fscanf', fd, fmt, target });
    let after = close + 1;
    if (toks[after] && toks[after].type === 'semi') after++;
    return after;
  }

  fopen(q, lhs, cur, env) {
    const toks = this.toks;
    if (!toks[q + 1] || toks[q + 1].value !== '(') throw new DeterministicError('$fopen sem (');
    const close = matchDelim(toks, q + 2, ['('], [')']);
    if (close === -1) throw new DeterministicError('$fopen(...) sem fechar');
    const args = this.splitArgs(q + 2, close);
    const fileTok = toks[args[0] ? args[0][0] : -1];
    const modeTok = args[1] ? toks[args[1][0]] : null;
    const file = fileTok && fileTok.type === 'str' ? fileTok.value : null;
    if (!file) throw new DeterministicError('$fopen sem nome de arquivo literal');
    const mode = modeTok && modeTok.type === 'str' ? modeTok.value : 'r';
    this.ctx.fopens.push({ varName: lhs, file, mode });
    let after = close + 1;
    if (toks[after] && toks[after].type === 'semi') after++;
    return after;
  }

  // separa argumentos (lista de indices-de-inicio) entre [start, end) por ',' nivel-0
  splitArgs(start, end) {
    const toks = this.toks;
    const args = [];
    let cur = [];
    let depth = 0;
    for (let p = start; p < end; p++) {
      const v = toks[p].value;
      if (v === '(' || v === '[' || v === '{') depth++;
      else if (v === ')' || v === ']' || v === '}') depth--;
      if (depth === 0 && toks[p].type === 'op' && v === ',') { args.push(cur); cur = []; continue; }
      cur.push(p);
    }
    if (cur.length) args.push(cur);
    return args;
  }

  // parseia um bloco initial cujo corpo comeca em `start` (token apos 'initial').
  parseInitial(start) {
    const cur = { t: 0 };
    return this.stmt(start, cur, null);
  }
}

/**
 * Acha cada `initial` e parseia a linha-do-tempo. Devolve { events, fopens } ou
 * lanca DeterministicError. clkName e' suprimido dos eventos (clock = loop).
 */
function walkTimeline(toks, clkName) {
  const ctx = { events: [], fopens: [], clkName };
  const parser = new InitialParser(toks, ctx);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type === 'id' && toks[i].value === 'initial') {
      parser.parseInitial(i + 1);
    }
  }
  return ctx;
}

// =====================================================================
// Detector de elegibilidade
// =====================================================================

/** ciclo do 1o posedge >= tempo t (clamp >=0). cycle(t)=ceil((t-half)/period). */
function cycleOf(t, half, period) {
  return Math.max(0, Math.ceil((t - half) / period));
}

/**
 * Analisa se o testbench e' ELEGIVEL pro conversor determinístico. Retorna
 * { eligible, reasons:[...], info:{ clock, instName, finishCycle, events, ... } }.
 * `ports` = parseVerilatorPorts(V<top>.tree.json) (nome/direcao/width/signed).
 */
export function analyzeTestbenchEligibility({ src, topModule, ports }) {
  const reasons = [];
  const info = {};
  const stripped = stripVerilogComments(src);
  const toks = tokenize(stripped);

  // 1) clock unico "always #N clk=~clk"
  const clock = detectClockGen(toks);
  if (!clock) reasons.push('nao achei um clock gerado por "always #N clk = ~clk"');
  info.clock = clock;

  // 2) nenhum `always` de estado (alem do clock). Esse e' o bloqueador classico.
  //    always @(...) ou always #N <algo que nao seja o ~clk>.
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].type === 'id' && toks[i].value === 'always') {
      const a = toks[i + 1];
      const isClockGen = clock && a && a.type === 'hash' &&
        toks[i + 3] && toks[i + 3].value === clock.name;
      if (!isClockGen) {
        const kindTok = a ? a.value : '?';
        reasons.push(`bloco "always ${kindTok}..." com logica de estado nao e' suportado ` +
          '(reescreva o estimulo como sequencia temporal num initial)');
        break;
      }
    }
  }

  // 3) construcoes proibidas
  for (let i = 0; i < toks.length; i++) {
    const v = toks[i].value;
    if (toks[i].type === 'id' && (v === 'force' || v === 'release' || v === 'assign' && false)) {
      reasons.push(`"${v}" nao suportado`);
    }
    if (toks[i].type === 'id' && (v === 'join_any' || v === 'join_none')) {
      reasons.push(`"${v}" nao suportado (use fork..join)`);
    }
    if (toks[i].type === 'le' && toks[i + 1] && toks[i + 1].type === 'hash') {
      reasons.push('inter-assignment delay ("<= #N ...") nao suportado');
    }
  }

  // 4) instancia unica do DUT, inputs conectados a regs simples
  const inst = findDutInstance(stripped, topModule);
  if (!inst) {
    reasons.push(`nao achei a instancia do top-level "${topModule}" no testbench`);
  } else {
    info.instName = inst.instName;
    const regs = parseRegDecls(src);
    const inputs = (ports || []).filter((p) => p.direction === 'input');
    for (const ip of inputs) {
      if (clock && ip.name === clock.name) continue; // clk e' o loop
      const conn = inst.conns.get(ip.name);
      if (conn === undefined) continue; // input nao conectado: vira 0 (ok)
      if (!/^[A-Za-z_]\w*$/.test(conn)) {
        reasons.push(`entrada "${ip.name}" conectada a expressao "${conn}" (esperado um reg simples)`);
      } else if (!regs.has(conn) && !(clock && conn === clock.name)) {
        reasons.push(`entrada "${ip.name}" conectada a "${conn}", que nao e' um reg declarado`);
      }
    }
    if (inputs.some((p) => p.width > 64)) {
      reasons.push('alguma entrada tem >64 bits (VlWide nao suportado pelo harness)');
    }
    if ((ports || []).some((p) => p.direction === 'output' && p.width > 64)) {
      reasons.push('alguma saida tem >64 bits (VlWide nao suportado pelo harness)');
    }
  }

  // 5) parse da linha-do-tempo (pega construcoes nao suportadas em initial) + $finish
  if (clock) {
    try {
      const ctx = walkTimeline(toks, clock.name);
      const finishes = ctx.events.filter((e) => e.kind === 'finish').map((e) => e.t);
      if (finishes.length === 0) {
        reasons.push('nenhum $finish/$stop encontrado (nao da pra delimitar o numero de ciclos)');
      } else {
        const ft = Math.min(...finishes);
        info.finishTime = ft;
        info.finishCycle = cycleOf(ft, clock.halfPeriod, clock.period);
      }
      info.eventCount = ctx.events.filter((e) => e.kind !== 'finish').length;
      info.fopens = ctx.fopens.map((f) => f.file);
    } catch (e) {
      reasons.push(e instanceof DeterministicError ? e.message : `erro ao analisar: ${e.message}`);
    }
  }

  return { eligible: reasons.length === 0, reasons, info };
}

// =====================================================================
// Emissor C++
// =====================================================================

/** nome do local C++ pro reg `name` (prefixo r_ pra nao colidir com nada). */
const regLocal = (name) => `r_${name}`;
/** nome do FILE* pro fopen var `name`. */
const fileLocal = (name) => `f_${name}`;

/**
 * Expressao C++ que driva uma entrada do DUT (porta `port`, width W) a partir do
 * local do reg, mascarando na largura. Espelha o masking do verilator_tb.js:
 * bits acima de W zerados (Verilator nao garante limpos no tipo C).
 */
function driveExpr(regExpr, width) {
  if (width >= 64) return `(uint64_t)(${regExpr})`;
  if (width > 32) return `((uint64_t)(${regExpr}) & ((1ULL << ${width}) - 1))`;
  if (width === 32) return `(uint32_t)(${regExpr})`;
  return `((uint32_t)(${regExpr}) & ((1u << ${width}) - 1u))`;
}

/** formato de leitura C pro $fscanf, a partir do fmt Verilog ("%d","%h",...). */
function scanfFmt(verilogFmt) {
  const f = String(verilogFmt || '').toLowerCase();
  if (f.includes('h') || f.includes('x')) return '%llx';
  if (f.includes('o')) return '%llo';
  return '%lld';
}

/**
 * Gera o harness C++ determinístico. Lanca DeterministicError se o tb nao for
 * elegivel. Reusa dumpSection (sign-aware) pro bloco de saida — identico ao
 * harness IA, entao a validacao contra o gabarito e' apples-to-apples.
 *
 * @param {object} o
 * @param {string} o.topModule
 * @param {Array}  o.ports             parseVerilatorPorts
 * @param {string} o.testbenchSource
 * @returns {{ cpp:string, info:object }}
 */
export function generateDeterministicHarness({ topModule, ports, testbenchSource }) {
  const analysis = analyzeTestbenchEligibility({ src: testbenchSource, topModule, ports });
  if (!analysis.eligible) {
    throw new DeterministicError(`testbench nao elegivel:\n - ${analysis.reasons.join('\n - ')}`);
  }
  const { clock } = analysis.info;
  const toks = tokenize(stripVerilogComments(testbenchSource));
  const ctx = walkTimeline(toks, clock.name);
  const regs = parseRegDecls(testbenchSource);

  // finish -> TOTAL_CYCLES
  const finishes = ctx.events.filter((e) => e.kind === 'finish').map((e) => e.t);
  const finishTime = Math.min(...finishes);
  const totalCycles = cycleOf(finishTime, clock.halfPeriod, clock.period);

  // eventos (assign/fscanf) -> (ciclo, acao), ordenados por ciclo+ordem, e
  // descartando os que caem em/depois do finish (nunca aplicam).
  const timed = ctx.events
    .filter((e) => e.kind === 'assign' || e.kind === 'fscanf')
    .map((e, idx) => ({ ...e, cycle: cycleOf(e.t, clock.halfPeriod, clock.period), idx }))
    .filter((e) => e.cycle < totalCycles)
    .sort((a, b) => (a.cycle - b.cycle) || (a.idx - b.idx));

  // regs que o harness precisa como locais: alvos de assign/fscanf (menos o clk).
  const regNames = new Set();
  for (const e of timed) {
    const tgt = e.kind === 'assign' ? e.target : e.target;
    if (tgt && tgt !== clock.name) regNames.add(tgt);
  }
  // entradas do DUT conectadas a regs tambem precisam existir como local mesmo
  // que nunca recebam evento (ficam no valor inicial).
  const inst = findDutInstance(stripVerilogComments(testbenchSource), topModule);
  const inputs = (ports || []).filter((p) => p.direction === 'input' && p.name !== clock.name);
  for (const ip of inputs) {
    const conn = inst.conns.get(ip.name);
    if (conn && /^[A-Za-z_]\w*$/.test(conn) && conn !== clock.name) regNames.add(conn);
  }

  const L = [];
  L.push(`// Auto-gerado por Aurora — harness Verilator DETERMINISTICO (sem IA) do`);
  L.push(`// top-level "${topModule}", a partir de um testbench elegivel.`);
  L.push(`// Clock="${clock.name}" periodo=${clock.period}; ${totalCycles} ciclos; ${timed.length} eventos.`);
  L.push(`#include "V${topModule}.h"`);
  L.push('#include "verilated.h"');
  L.push('#include <cstdint>');
  L.push('#include <cstdio>');
  L.push('#include <cstring>');
  L.push('#include <cstdlib>');
  L.push('');
  L.push('static uint64_t main_time = 0;');
  L.push('double sc_time_stamp() { return (double)main_time; }');
  L.push('');
  L.push('int main(int argc, char** argv) {');
  L.push('    Verilated::commandArgs(argc, argv);');
  L.push(`    V${topModule}* top = new V${topModule};`);
  L.push('');
  // arquivos
  for (const f of ctx.fopens) {
    L.push(`    FILE* ${fileLocal(f.varName)} = fopen(${JSON.stringify(f.file)}, ${JSON.stringify(f.mode)});`);
  }
  if (ctx.fopens.length) L.push('');
  // regs locais (long long; mascarados no drive)
  for (const name of regNames) {
    const info = regs.get(name);
    const init = info && Number.isFinite(info.init) ? info.init : 0;
    L.push(`    long long ${regLocal(name)} = ${init}LL;`);
  }
  L.push('');
  // tabela de ciclos dos eventos
  L.push(`    static const long long EV_CYCLE[] = {${timed.length ? ' ' + timed.map((e) => `${e.cycle}LL`).join(', ') + ' ' : ''}};`);
  L.push(`    const int NEV = ${timed.length};`);
  L.push('    int evIdx = 0;');
  L.push('');
  L.push(`    long long TOTAL_CYCLES = ${totalCycles}LL;`);
  L.push('    for (long long cyc = 0; cyc < TOTAL_CYCLES; cyc++) {');
  L.push('        while (evIdx < NEV && EV_CYCLE[evIdx] <= cyc) {');
  L.push('            switch (evIdx) {');
  timed.forEach((e, i) => {
    if (e.kind === 'assign') {
      L.push(`            case ${i}: ${regLocal(e.target)} = ${e.value}LL; break;`);
    } else {
      const cfmt = scanfFmt(e.fmt);
      L.push(`            case ${i}: { long long __v; if (${fileLocal(e.fd)} && fscanf(${fileLocal(e.fd)}, "${cfmt}", &__v) == 1) ${regLocal(e.target)} = __v; break; }`);
    }
  });
  L.push('            default: break;');
  L.push('            }');
  L.push('            evIdx++;');
  L.push('        }');
  L.push('');
  // driva as entradas do DUT a partir dos regs
  for (const ip of inputs) {
    const conn = inst.conns.get(ip.name);
    if (!conn) continue;
    if (clock && conn === clock.name) continue;
    if (!/^[A-Za-z_]\w*$/.test(conn)) continue;
    L.push(`        top->${ip.name} = ${driveExpr(regLocal(conn), ip.width)};`);
  }
  L.push('');
  L.push(`        top->${clock.name} = 1; top->eval(); main_time += ${clock.halfPeriod};   // posedge`);
  L.push(`        top->${clock.name} = 0; top->eval(); main_time += ${clock.halfPeriod};   // negedge`);
  L.push('    }');
  L.push('');
  L.push(dumpSection(ports));
  L.push('');
  for (const f of ctx.fopens) L.push(`    if (${fileLocal(f.varName)}) fclose(${fileLocal(f.varName)});`);
  L.push('    top->final();');
  L.push('    delete top;');
  L.push('    return 0;');
  L.push('}');

  return {
    cpp: L.join('\n') + '\n',
    info: { ...analysis.info, totalCycles, eventCount: timed.length },
  };
}

export { DeterministicError };
