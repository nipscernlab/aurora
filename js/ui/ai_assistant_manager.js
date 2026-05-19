/**
 * ai_assistant_manager.js — Aurora Intelligence side panel.
 *
 * Replaces the previous `<webview>`-based wrapper. The panel now talks
 * directly to a Vercel-AI-SDK-driven backend via `window.aiAPI`:
 *
 *   • renderer maintains the chat history,
 *   • each turn streams from main via `ai:chat-event` packets,
 *   • assistant text is rendered as Markdown live (token by token).
 *
 * Chat history (this version) — every conversation is auto-persisted
 * to `userData/aurora-intelligence-chats/<id>.json` and listed in a
 * dropdown anchored to the history button. New / Open / Rename /
 * Delete operate on those files (see `main/ai/conversations.js`).
 */

import { showConfirm } from './dialog_manager.js';

const PROVIDER_META = {
  // Subscription-backed: runs through the Claude Code / Claude Agent SDK,
  // billed against the user's Pro/MAX plan — no per-token API key.
  'claude-code': {
    label: 'Claude Code', icon: './assets/icons/ai_claude.svg',
    subscription: true, tagline: 'Pro / MAX plan — no API key',
  },
  openai:    { label: 'ChatGPT',  icon: './assets/icons/ai_chatgpt.svg'  },
  anthropic: { label: 'Claude',   icon: './assets/icons/ai_claude.svg'   },
  google:    { label: 'Gemini',   icon: './assets/icons/ai_gemini.webp'  },
  deepseek:  { label: 'DeepSeek', icon: './assets/icons/ai_deepseek.svg' },
  groq:      { label: 'Groq',     icon: './assets/icons/ai_groq.svg'     },
  ollama:    { label: 'Ollama',   icon: './assets/icons/ai_ollama.svg'   },
};

// Synthetic provider entry for Claude Code — it is not returned by the
// backend `listProviders()` (no API key), so the panel injects it.
const CLAUDE_CODE_PROVIDER = { name: 'claude-code', model: 'default', defaultModel: 'default' };

// Claude Code model aliases + effort levels — surfaced as segmented
// controls in the model popover. `effort: ''` means "let the CLI decide".
const CLAUDE_CODE_MODELS = [
  { id: 'default', label: 'Default' },
  { id: 'sonnet',  label: 'Sonnet'  },
  { id: 'opus',    label: 'Opus'    },
  { id: 'haiku',   label: 'Haiku'   },
];
const CLAUDE_CODE_EFFORT = [
  { id: '',       label: 'Auto'  },
  { id: 'low',    label: 'Low'   },
  { id: 'medium', label: 'Medium'},
  { id: 'high',   label: 'High'  },
  { id: 'xhigh',  label: 'xHigh' },
  { id: 'max',    label: 'Max'   },
];

/** Strip vendor prefixes / date suffixes so a model id fits on the chip. */
function shortModelName(model) {
  if (!model) return '';
  return String(model)
    .replace(/^(claude-|gpt-|gemini-|models\/|deepseek-)/i, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
}

/** Compact a token count: 1234 → "1.2k", 12 → "12". */
function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (v >= 1_000)     return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

// Rate-limit window display metadata, keyed by the CLI's `rateLimitType`.
const WINDOW_META = {
  five_hour: { label: '5-hour window', icon: 'ph-hourglass-medium' },
  weekly:    { label: 'This week',     icon: 'ph-calendar-dots'    },
};

/** Compact "in 2h 14m" / "in 3d" countdown from a unix-seconds timestamp. */
function untilTime(unixSeconds) {
  const ms = Number(unixSeconds) * 1000 - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const m = Math.round(ms / 60000);
  if (m < 60)   return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * One row in the Claude Code usage panel: a label, a value, and a thin
 * bar. `state` colours the fill (ok / mid / high / count); `pct` is the
 * fill width (0–100).
 */
function usageRowHTML(label, icon, valText, state, pct) {
  return `
    <div class="ai-usage" data-state="${state}">
      <div class="ai-usage-top">
        <span class="ai-usage-label"><i class="ph ${icon}" aria-hidden="true"></i>${label}</span>
        <span class="ai-usage-val">${valText || ''}</span>
      </div>
      <div class="ai-usage-track"><div class="ai-usage-fill" style="width:${pct || 0}%"></div></div>
    </div>`;
}

// ─── Aurora Intelligence System Prompt ──────────────────────────────────────
// Built from: yanc compiler grammar (CMMComp.y/.l), real CMM examples
// (Sqrt, Seno, ArcTan, FFT, RLS, DTW, Blind, PulseSim), NIPSCERN website,
// and the full Aurora API tool manifest.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = [

  // ── Identity ──────────────────────────────────────────────────────────────
  "You are AURORA INTELLIGENCE — the AI assistant built into the AURORA IDE, developed by the " +
  "NIPSCERN laboratory (Núcleo de Inteligência de Processadores e Sistemas Computacionais Em Rede " +
  "Neurais) at UFJF (Universidade Federal de Juiz de Fora), Brazil. " +
  "NIPSCERN designs custom signal-processing processors for scientific instrumentation, particularly " +
  "for the LHCb experiment at CERN, and teaches hardware design through the SAPHO ecosystem. " +
  "Be concise and precise. Use Markdown. Use fenced ```cmm blocks for CMM snippets, ```verilog for " +
  "Verilog/VHDL snippets. ALWAYS reply in the same language the user writes in (Portuguese or English).",

  // ── SAPHO Ecosystem ───────────────────────────────────────────────────────
  "\n\nSAPHO ECOSYSTEM — Scalable Architecture for Hardware Optimization:\n" +
  "  • YANC  — Yet Another Compiler: two-stage toolchain written in C + Flex + Bison.\n" +
  "      - cmmcomp: CMM source (.cmm) → SAPHO Assembly (.asm)\n" +
  "      - asmcomp: Assembly (.asm) → Verilog HDL (.v) + testbench (.v) + machine code\n" +
  "  • AURORA — Windows IDE (Electron): editor, compiler UI, file tree, Aurora Intelligence.\n" +
  "  • POLARIS — Cross-platform IDE (Tauri + Rust): successor to AURORA, also uses YANC.\n" +
  "  • PRISM  — RTL viewer: visualises processor datapath from the generated Verilog.\n" +
  "  • GTKWave — waveform viewer: reads .vcd dumps from Icarus Verilog simulation.\n" +
  "The full pipeline: .cmm → cmmcomp → .asm → asmcomp → .v → iverilog → .vcd → GTKWave/PRISM.",

  // ── CMM Language ──────────────────────────────────────────────────────────
  "\n\nCMM LANGUAGE (C+- / C Plus Minus) — proprietary C-like language for SAPHO processors.\n" +

  "TYPES:\n" +
  "  int    — fixed-point integer (width = NUBITS bits)\n" +
  "  float  — custom floating-point (1 sign + NBEXPO exponent + NBMANT mantissa bits)\n" +
  "  comp   — complex number (two floats: real + imaginary). Literal: 3.0+4.0i\n" +
  "  void   — no return value (functions only)\n" +

  "\nHEADER DIRECTIVES — EVERY .cmm file must begin with ALL of these:\n" +
  "  #PRNAME <name>    processor name (letters, digits, underscore, hyphen)\n" +
  "  #NUBITS <n>       total data-word width in bits\n" +
  "  #NBMANT <n>       mantissa bits for the custom float\n" +
  "  #NBEXPO <n>       exponent bits for the custom float\n" +
  "  #NDSTAC <n>       data stack depth\n" +
  "  #SDEPTH <n>       subroutine call stack depth\n" +
  "  #NUIOIN <n>       number of input I/O ports\n" +
  "  #NUIOOU <n>       number of output I/O ports\n" +
  "  #NUGAIN <n>       gain constant used by norm() — MUST be a power of 2\n" +
  "  #FFTSIZ <n>       FFT size = 2^n (optional — only for FFT processors)\n" +

  "\nHARD CONSTRAINTS — violations cause yanc build errors:\n" +
  "  NUBITS == NBMANT + NBEXPO + 1  (sign bit is the +1; strict equality)\n" +
  "  NUGAIN must be a power of 2: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024 …\n" +
  "  All 9 core directives (#PRNAME … #NUGAIN) must be present.\n" +
  "  Typical 32-bit float config: NUBITS=32, NBMANT=23, NBEXPO=8, NUGAIN=128\n" +
  "  Typical 23-bit config:       NUBITS=23, NBMANT=16, NBEXPO=6, NUGAIN=128\n" +
  "Always validate NUBITS = NBMANT + NBEXPO + 1 before writing or editing any .cmm file.\n" +

  "\nOPERATORS (C precedence):\n" +
  "  Arithmetic : +  -  *  /  %\n" +
  "  Bitwise    : &  |  ^  ~\n" +
  "  Shift      : <<  >>  >>>   (>>> = arithmetic right shift, sign-preserving)\n" +
  "  Comparison : ==  !=  <  >  <=  >=\n" +
  "  Logical    : &&  ||  !\n" +
  "  Increment  : ++  (post-increment, usable in expressions and as statement)\n" +
  "  No +=, -=, *=, /= — use explicit: x = x + y;\n" +

  "\nCONTROL FLOW:\n" +
  "  while (cond) { ... }          — the ONLY loop construct (no for, no do-while)\n" +
  "  break;                        — exits a while loop\n" +
  "  if (cond) { ... }\n" +
  "  if (cond) { ... } else { ... }\n" +
  "  switch (exp) { case N: ... break; default: ... }\n" +
  "  return exp;  /  return;       — function return\n" +
  "  #INTERPOINT                   — marks the interrupt resume point (reset on itr pin)\n" +

  "\nFUNCTIONS:\n" +
  "  Declaration: type name(type param1, type param2) { ... }\n" +
  "  Arrays CANNOT be passed as function parameters — declare arrays globally.\n" +
  "  Void call: funcName(args);    Valued call: x = funcName(args);\n" +

  "\nVARIABLE DECLARATION:\n" +
  "  int x;                          — integer\n" +
  "  float y = 3.14;                 — float with initializer\n" +
  "  int arr[128];                   — 1D integer array\n" +
  "  float mat[4][4];                — 2D float array\n" +
  "  float lut[152] \"Seno_LUT.txt\"; — array pre-loaded from file at compile time\n" +
  "  comp c = 1.0+0.0i;             — complex number\n" +

  "\nARRAY INDEXING:\n" +
  "  x[i]   — standard index\n" +
  "  x[i)   — BIT-REVERSED index (used in FFT butterfly): bits of i are reversed\n" +
  "  No exponent literals: write 0.000001 instead of 1e-6.\n" +
  "  No log() function — use hardcoded values (e.g. log(1006) ≈ 6.913737).\n" +

  "\nSTANDARD LIBRARY:\n" +
  "  I/O:\n" +
  "    in(port)         — reads integer from input port N\n" +
  "    fin(port)        — reads float from input port N\n" +
  "    out(port, val)   — writes integer val to output port N\n" +
  "    fout(port, val)  — writes float val to output port N\n" +
  "    out(port, c|vec⟩) — outputs vector vec scaled by c to port (Dirac)\n" +
  "  Math:\n" +
  "    sqrt(x)          — square root → float\n" +
  "    atan(x)          — arctangent → float\n" +
  "    sin(x)           — sine → float\n" +
  "    cos(x)           — cosine → float\n" +
  "  Special:\n" +
  "    abs(x)           — absolute value (for comp: magnitude)\n" +
  "    sign(x, y)       — returns y with the sign of x\n" +
  "    pset(x)          — returns x if x > 0, else 0 (positive clamp)\n" +
  "    norm(x)          — divides x by NUGAIN (fast shift-based division)\n" +
  "    copy(src, dst)   — copies src into dst without type checking\n" +
  "  Complex:\n" +
  "    real(c)          — real part of complex c\n" +
  "    imag(c)          — imaginary part of complex c\n" +
  "    fase(c)          — phase angle of complex c\n" +
  "    mod2(c)          — squared magnitude of complex c\n" +
  "    complex(r, i)    — creates comp from two reals\n" +

  "\nDIRAC NOTATION (linear algebra — SAPHO's unique feature):\n" +
  "  ⟨a|b⟩              inner product of vectors a and b → scalar\n" +
  "  a # |M|b⟩;         a = M × b  (matrix-vector product)\n" +
  "  a # c|b⟩;          a = c × b  (scalar × vector)\n" +
  "  a # |b⟩ + c|d⟩;    a = b + c×d\n" +
  "  A # |a⟩⟨b|;         A = a × bᵀ  (outer product)\n" +
  "  A # |P| - |a⟩⟨b|;   A = P − a×bᵀ\n" +
  "  A # c|B|;           A = c × B\n" +
  "  A # c|I|;           A = c × Identity\n" +
  "  a # |0⟩;            zeros every element of vector a\n" +
  "  a # c|in(p)⟩;       fills a from input port p scaled by c\n" +
  "  a # c → |a⟩;        shift register: shifts a and inserts c×(new input)\n" +
  "  Use ⟨ ⟩ Unicode characters — NOT < > ASCII angle brackets.\n" +

  "\nMACRO DIRECTIVES:\n" +
  "  #USEMAC \"file.asm\" N   — inline an optimised .asm macro at position N\n" +
  "  #ENDMAC               — end of the macro region\n" +

  "\nKNOWN LANGUAGE RESTRICTIONS (document in comments when relevant):\n" +
  "  • No for loop — only while\n" +
  "  • No +=, -=, *= — use x = x + y;\n" +
  "  • No exponent literals (1e-6) — write 0.000001\n" +
  "  • No log() — hardcode the value\n" +
  "  • Arrays cannot be function parameters — use global arrays\n" +
  "  • No dynamic allocation — all sizes must be compile-time constants\n",

  // ── CMM Examples (patterns from real processors) ───────────────────────────
  "\n\nCMM REAL-WORLD PATTERNS (from NIPSCERN production processors):\n" +

  "Newton's method sqrt:\n" +
  "```cmm\n" +
  "float my_sqrt(float num) {\n" +
  "    if (num == 0.0) return 0.0;\n" +
  "    int v = (((num << 1) >>> 24) + 22) >>> 1;\n" +
  "    v = ((((v-22) << 23) + (1 << 22)) << 1) >> 1;\n" +
  "    float x; copy(v,x);\n" +
  "    x = 0.5*(x+num/x); x = 0.5*(x+num/x);\n" +
  "    x = 0.5*(x+num/x); x = 0.5*(x+num/x);\n" +
  "    return x;\n" +
  "}\n" +
  "```\n" +

  "LUT-based sine (interpolated):\n" +
  "```cmm\n" +
  "float Seno_LUT[152] \"Seno_LUT.txt\";  // loaded at compile time\n" +
  "float seno_lut(float x) {\n" +
  "    while (abs(x) > 3.141592653589793) x = x - sign(x, 6.283185307);\n" +
  "    float idxf = abs(x * 47.746482927568);  // 150.0/pi\n" +
  "    int idx = idxf;\n" +
  "    float v = Seno_LUT[idx];\n" +
  "    return sign(x, v + (Seno_LUT[idx+1] - v) * (idxf - idx));\n" +
  "}\n" +
  "```\n" +

  "RLS filter using Dirac notation (from proc_rls.cmm):\n" +
  "```cmm\n" +
  "float x[4]; float w[4]; float P[4][4];\n" +
  "void rls_update(float d) {\n" +
  "    float e = d - ⟨w|x⟩;\n" +
  "    float Px[4] # |P|x⟩;\n" +
  "    float g = 1.0/(0.99 + ⟨x|Px⟩);\n" +
  "    float K[4] # g|Px⟩;\n" +
  "    w # |w⟩ + e|K⟩;\n" +
  "    P # |P| - |K⟩⟨Px|;\n" +
  "    P # 1.010101|P|;  // 1/0.99\n" +
  "}\n" +
  "```\n" +

  "FFT with complex data and bit-reversal:\n" +
  "```cmm\n" +
  "#FFTSIZ 3   // N = 2^3 = 8\n" +
  "comp data[8]; comp wpv[4];\n" +
  "// Butterfly: data[j) uses bit-reversed index\n" +
  "temp    = wpv[sind]*data[j);\n" +
  "data[j) = data[k) - temp;\n" +
  "data[k) = data[k) + temp;\n" +
  "// Output complex result:\n" +
  "fout(0, 1000.0*real(data[0)));\n" +
  "fout(1, 1000.0*imag(data[0)));\n" +
  "```\n" +

  "Shift register (IIR filter pattern from proc_sim.cmm):\n" +
  "```cmm\n" +
  "// Manual shift register (no 'c → |a>' if not using vector notation):\n" +
  "r7=r6; r6=r5; r5=r4; r4=r3; r3=r2; r2=r1; r1=xl;\n" +
  "// Or with Dirac shift notation:\n" +
  "x # fin(0)*0.001 -> |x⟩;  // shifts x and inserts new input scaled 0.001\n" +
  "```\n",

  // ── SAPHO Simulation ──────────────────────────────────────────────────────
  "\n\nSIMULATION PARAMETERS — stored per-processor in the project's .spf file:\n" +
  "  clk (MHz)     clock frequency (default 100 MHz)\n" +
  "  numClocks     clock cycles to simulate (default 2000)\n" +
  "  simTime_us    = numClocks / clk  (e.g. 2000 / 100 = 20 µs)\n" +
  "Always call list_processors to read the actual clk / numClocks / simTime_us and the full\n" +
  "parsed header (header.NUBITS, header.NBMANT, etc.) before suggesting parameter changes.\n",

  // ── Reserved Files ────────────────────────────────────────────────────────
  "\n\nRESERVED SAPHO PATHS — auto-generated and OVERWRITTEN on every compile. NEVER create " +
  "files at these locations:\n" +
  "  <proc>/Hardware/<proc>.v        synthesizable Verilog (asmcomp output)\n" +
  "  <proc>/Simulation/<proc>_tb.v   auto-generated testbench\n" +
  "  <proc>/Software/<proc>.asm      assembly from CMM\n" +
  "Always use unique names at the project root: e.g. sqrt_newton_top.v, sqrt_newton_test.v\n",

  // ── Workflow Rules ─────────────────────────────────────────────────────────
  "\n\nWORKFLOW — Custom Verilog files (always follow this order):\n" +
  "  1. get_project_tree           discover project root and all existing files\n" +
  "  2. create_file                write the .v — auto-added to the file tree\n" +
  "  3. set_top_level              mark synthesizable wrapper as Top Level\n" +
  "  4. set_testbench_top          mark testbench as Testbench Top\n" +
  "  5. compile_all / compile_step only AFTER steps 3 and 4 are done\n" +
  "  6. list_wave_signals → select_wave_signals → compile_step('wave')  for GTKWave\n" +

  "\nGTKWAVE PREREQUISITES:\n" +
  "  • A Testbench Top OR Top-Level module must be set in the file tree.\n" +
  "  • Wave Configuration roots at testbenchFile (falls back to topLevelFile).\n" +
  "  • If the selected testbench belongs to a DIFFERENT processor than the one being compiled,\n" +
  "    the signals will be wrong. Call list_processors to verify before selecting signals.\n" +
  "  • If list_wave_signals returns empty: ask the user to right-click the correct .v file\n" +
  "    in the file tree and choose 'Set as Testbench Top', then retry.\n",

  // ── Tool Use Rules ────────────────────────────────────────────────────────
  "\n\nTOOL USE RULES:\n" +
  "  1. Chain all required tool calls in sequence before writing any response text.\n" +
  "     Do NOT explain between tool calls — execute, then summarise once at the end.\n" +
  "  2. After ALL tools finish, write ONE concise summary: what was done, results, next steps.\n" +
  "  3. If a tool fails: include the error in the summary and explain the remediation.\n" +
  "  4. Never emit JSON or XML tool-call syntax as visible text — always use the actual\n" +
  "     function-calling mechanism provided by the SDK.\n" +
  "  5. Be creative and dynamic — prefer doing things autonomously over asking the user\n" +
  "     for confirmation on every step. Only ask when genuinely ambiguous.\n",

].join('');
// ─────────────────────────────────────────────────────────────────────────────

/* ============================================================
 *  Tool permission modes
 *
 *  Persisted in localStorage; chosen from the chat's gear popover.
 *    ask    — every tool call needs an inline OK (read and write)
 *    writes — reads run freely, writes need an inline OK (default)
 *    allow  — nothing is prompted; the assistant is fully autonomous
 * ========================================================== */

const PERMISSION_STORE_KEY = 'aurora-ai-permission';
const PERMISSION_MODES = [
  { id: 'ask',    label: 'Ask every time',     hint: 'Confirm every action' },
  { id: 'writes', label: 'Ask before changes', hint: 'Reads run freely; changes ask first' },
  { id: 'allow',  label: 'Allow all',          hint: 'Full autonomy — no prompts' },
];

function readPermissionMode() {
  try {
    const v = localStorage.getItem(PERMISSION_STORE_KEY);
    if (PERMISSION_MODES.some((m) => m.id === v)) return v;
  } catch (_) { /* fall through to default */ }
  return 'writes';
}

/** Compact "2 min ago" / "3 d ago" / locale date stamp. */
function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  if (diff < 60_000)      return 'just now';
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)} h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} d ago`;
  try { return new Date(Number(ts)).toLocaleDateString(); }
  catch (_) { return ''; }
}

/* ============================================================
 *  Generic syntax highlighter — zero external dependencies.
 *  Covers C/C++/CMM, JS/TS, Python, Verilog, Bash, and more.
 * ========================================================== */

const _HKW = new Set([
  'if','else','for','while','do','return','break','continue','switch','case','default',
  'function','const','let','var','class','import','export','new','this','super',
  'true','false','null','undefined','void','typeof','instanceof','in','of','delete',
  'async','await','try','catch','finally','throw','yield',
  'int','float','double','char','bool','short','long','unsigned','signed',
  'struct','enum','typedef','sizeof','static','extern','volatile','register','inline',
  'public','private','protected','abstract','interface','extends','implements','override','virtual',
  'module','wire','reg','input','output','inout','begin','end','always','assign',
  'posedge','negedge','initial','endmodule','parameter','localparam',
  'def','lambda','pass','with','as','from','not','and','or','is','elif','None','True','False',
  'namespace','using','template','typename','auto',
]);

// Groups: 1=// comment  2=/* block */  3=# comment/preprocessor
//         4=string  5=number  6=fn-call-ident  7=ident  8=any-other-char
const _HRE = /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(0x[0-9a-fA-F]+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([a-zA-Z_$][\w$]*(?=\s*\())|([a-zA-Z_$][\w$]*)|([^\w]|\s)/g;

function _hesc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _highlightCode(text) {
  _HRE.lastIndex = 0;
  let out = '', m;
  while ((m = _HRE.exec(text)) !== null) {
    if (m[1] || m[2] || m[3]) out += `<span class="hl-c">${_hesc(m[0])}</span>`;
    else if (m[4])             out += `<span class="hl-s">${_hesc(m[4])}</span>`;
    else if (m[5])             out += `<span class="hl-n">${_hesc(m[5])}</span>`;
    else if (m[6])             out += `<span class="hl-f">${_hesc(m[6])}</span>`;
    else if (m[7])             out += _HKW.has(m[7]) ? `<span class="hl-k">${_hesc(m[7])}</span>` : _hesc(m[7]);
    else                       out += _hesc(m[0]);
  }
  return out;
}

/** Apply syntax highlighting to all unhighlighted code blocks in `containerEl`. */
function highlightCodeBlocks(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll('.ai-code-block code:not([data-hl])').forEach(el => {
    el.innerHTML = _highlightCode(el.textContent);
    el.dataset.hl = '1';
  });
}

/* ============================================================
 *  Markdown rendering (small, dependency-free)
 * ========================================================== */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sentinels for placeholder stashing. We use Unicode Private-Use Area
// (U+E000..U+F8FF) — those code points carry no semantics, never
// appear in normal text, and are not control characters (so ESLint's
// no-control-regex rule stays happy).
const CODE_SENTINEL_OPEN  = '';
const CODE_SENTINEL_CLOSE = '';

function renderInline(s) {
  // Inline code is extracted first so bold/italic regexes never run
  // inside it (`a*b*c` inside a backtick must stay literal).
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `${CODE_SENTINEL_OPEN}${codes.length - 1}${CODE_SENTINEL_CLOSE}`;
  });
  s = escapeHtml(s);
  s = s.replace(/\*\*([^\n*][^\n]*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//i.test(url)) {
      return `<a href="#" data-href="${escapeHtml(url)}">${text}</a>`;
    }
    return text;
  });
  const sentinelRe = new RegExp(`${CODE_SENTINEL_OPEN}(\\d+)${CODE_SENTINEL_CLOSE}`, 'g');
  s = s.replace(sentinelRe, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  return s;
}

function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  let listType = null;
  let paraLines = [];

  const flushPara = () => {
    if (paraLines.length) {
      out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
      paraLines = [];
    }
  };
  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null; }
  };
  const flushCode = () => {
    const lang = escapeHtml(codeLang || 'text');
    out.push(
      `<div class="ai-code-block">` +
      `<div class="ai-code-header"><span class="ai-code-lang">${lang}</span>` +
      `<button class="ai-code-copy" title="Copy"><i class="ph ph-copy"></i></button></div>` +
      `<pre><code class="lang-${lang}">${escapeHtml(codeLines.join('\n'))}</code></pre>` +
      `</div>`,
    );
    codeLines = [];
    codeLang = '';
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushPara(); closeList(); inCode = true; codeLang = fence[1] || ''; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flushPara(); closeList();
      const level = head[1].length;
      out.push(`<h${level}>${renderInline(head[2])}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== 'ul') { closeList(); listType = 'ul'; out.push('<ul>'); }
      out.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== 'ol') { closeList(); listType = 'ol'; out.push('<ol>'); }
      out.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    if (!line.trim()) { flushPara(); closeList(); continue; }

    closeList();
    paraLines.push(line);
  }

  if (inCode) flushCode();         // unclosed fence during streaming
  flushPara();
  closeList();
  return out.join('');
}

/* ============================================================
 *  Chat manager
 * ========================================================== */

class AIAssistantManager {
  constructor() {
    this.container = null;
    this.providerSelect = null;
    this.providerIcon = null;
    this.messagesEl = null;
    this.emptyStateEl = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.stopBtn = null;
    this.clearBtn = null;
    this.tokenCounter = null;

    this.messages = [];              // [{ role:'user'|'assistant', content }]
    this.currentProvider = null;
    this.providersAvailable = [];    // [{ name, model, defaultModel }]
    this.providersConfigured = {};   // { name: bool }
    this.currentSessionId = null;
    this.currentAssistantContentEl = null;  // current text segment bubble, or null
    this.segmentBuffer = '';                // text of the current segment
    this.turnText = '';                     // full assistant text for the turn
    this.runningChips = [];                 // [{ toolName, el }] in-flight tools
    this.thinkingEl = null;                 // "thinking…" placeholder, or null
    this.cumulativeTokens = 0;

    this.unsubChatEvent = null;

    // Tool permission gate.
    this.permissionMode = readPermissionMode();
    this.modelPopoverOpen = false;
    this.pendingConfirms = new Set();   // resolve fns of open confirmation cards

    // Claude Code (subscription) state.
    this.claudeUsage = null;            // last usage snapshot, or null
    this.claudeCodeStatus = null;       // { installed, authed, plan, … }, or null
    this.claudeCodeEffort = '';         // '' | low | medium | high | xhigh | max
    try {
      const e = localStorage.getItem('aurora-ai-cc-effort');
      if (CLAUDE_CODE_EFFORT.some((x) => x.id === e)) this.claudeCodeEffort = e;
    } catch (_) { /* default '' */ }

    // Persistent chat history.
    this.currentChatId = null;          // null until the user sends the 1st turn
    this.currentChatTitle = '';
    this.currentChatCreatedAt = 0;
    this.historyOpen = false;
    this.chatList = [];                 // cached light metadata
  }

  toggle() {
    if (!this.container) this.initialize();
    const opening = !this.container.classList.contains('open');
    this.container.classList.toggle('open', opening);
    document.body.classList.toggle('ai-assistant-open', opening);
    try { localStorage.setItem('aurora-ai-panel-open', opening ? '1' : '0'); } catch (_) { /* ignore */ }
    if (opening) {
      this.refreshProviders().then(() => this.inputEl?.focus());
      this.refreshChatList();
    }
  }

  initialize() {
    this.container = document.createElement('div');
    this.container.className = 'ai-assistant-container';
    this.container.innerHTML = `
      <div class="ai-assistant-header">
        <div class="ai-header-left">
          <span class="ai-assistant-mark">
            <img id="ai-provider-icon" src="./assets/icons/ai_claude.svg" alt="" class="ai-provider-icon">
          </span>
          <h3 class="ai-assistant-title">Aurora Intelligence</h3>
        </div>
        <div class="ai-header-right">
          <button class="ai-hbtn" id="ai-history-btn" title="Chat history" aria-label="Chat history">
            <i class="ph ph-clock-counter-clockwise"></i>
          </button>
          <button class="ai-hbtn" id="ai-clear-btn" title="New chat" aria-label="New chat">
            <i class="ph ph-note-pencil"></i>
          </button>
          <button class="ai-hbtn" id="ai-terminal-clear-btn" title="Clear terminal output" aria-label="Clear terminal">
            <i class="ph ph-terminal-window"></i>
          </button>
          <span class="ai-hbtn-sep"></span>
          <button class="ai-hbtn ai-hbtn-close" id="ai-close-btn" aria-label="Close AI Assistant" title="Close">
            <i class="ph ph-x"></i>
          </button>
        </div>

        <!-- Chat-history popover: list of saved conversations + "New chat".
             The actual list is populated by refreshChatList(). -->
        <div class="ai-history-popover hidden" id="ai-history-popover" role="menu">
          <div class="ai-history-head">
            <span class="ai-history-title">Chats</span>
            <button class="ai-history-new" id="ai-history-new" title="New chat">
              <i class="ph ph-plus"></i><span>New</span>
            </button>
          </div>
          <div class="ai-history-list" id="ai-history-list"></div>
        </div>
      </div>

      <div class="ai-assistant-content">
        <div class="ai-empty-state hidden" id="ai-empty-state">
          <i class="ph ph-sparkle ai-empty-icon" aria-hidden="true"></i>
          <h4>Aurora Intelligence is offline</h4>
          <p>The AI backend could not be reached. Restart Aurora, or open Settings to configure a provider.</p>
        </div>

        <div class="ai-messages" id="ai-messages" role="log" aria-live="polite">
          <div class="ai-chat-empty-hint" id="ai-chat-empty-hint" aria-hidden="true">
            <i class="ph ph-brain" aria-hidden="true"></i>
            <p>Ask Aurora Intelligence about your project, Verilog, or SAPHO/CMM</p>
          </div>
        </div>

        <div class="ai-input-area">
          <!-- Model / provider popover — anchored above the composer chip. -->
          <div class="ai-model-popover hidden" id="ai-model-popover" role="menu">
            <div class="ai-mp-section">
              <div class="ai-mp-label">Provider</div>
              <div class="ai-mp-list" id="ai-mp-providers"></div>
            </div>

            <!-- Claude Code connection status (subscription provider only) -->
            <div class="ai-mp-section ai-mp-cc hidden" id="ai-mp-cc-status"></div>

            <div class="ai-mp-section" id="ai-mp-model-section">
              <div class="ai-mp-label">Model</div>
              <div class="ai-mp-modelrow" id="ai-mp-model-api">
                <input type="text" id="ai-model-input" class="ai-mp-model-input"
                       spellcheck="false" autocomplete="off" placeholder="default">
                <button class="ai-mp-iconbtn" id="ai-model-reset" type="button"
                        title="Reset to default model" aria-label="Reset model">
                  <i class="ph ph-arrow-counter-clockwise"></i>
                </button>
              </div>
              <div class="ai-mp-seg hidden" id="ai-mp-model-presets"></div>
            </div>

            <!-- Effort / reasoning depth (Claude Code only) -->
            <div class="ai-mp-section ai-mp-cc hidden" id="ai-mp-effort-section">
              <div class="ai-mp-label">Effort &amp; reasoning</div>
              <div class="ai-mp-seg" id="ai-mp-effort"></div>
            </div>

            <div class="ai-mp-section ai-mp-usage ai-mp-cc hidden" id="ai-mp-usage">
              <div class="ai-mp-label">
                <span>Subscription usage</span>
                <span class="ai-usage-plan" id="ai-usage-plan"></span>
              </div>
              <div class="ai-usage-bars" id="ai-usage-bars"></div>
            </div>

            <div class="ai-mp-section">
              <div class="ai-mp-label">Permissions</div>
              <div class="ai-mp-list" id="ai-mp-perms"></div>
            </div>
            <button class="ai-mp-managekeys" id="ai-mp-managekeys" type="button">
              <i class="ph ph-key" aria-hidden="true"></i><span>Manage API keys &amp; providers</span>
            </button>
          </div>

          <div class="ai-composer" id="ai-composer">
            <button class="ai-model-chip" id="ai-model-chip" type="button"
                    title="Switch model or provider" aria-label="Model and provider">
              <img class="ai-model-chip-icon" id="ai-model-chip-icon"
                   src="./assets/icons/ai_claude.svg" alt="">
              <span class="ai-model-chip-name" id="ai-model-chip-name">Claude</span>
              <i class="ph ph-caret-up-down ai-model-chip-caret"></i>
            </button>

            <textarea id="ai-input"
              class="ai-input"
              placeholder="Ask Aurora Intelligence…"
              rows="1"
              aria-label="Message"></textarea>

            <span class="ai-token-counter" id="ai-token-counter" title="Tokens this conversation">0</span>

            <button class="ai-stop-btn hidden" id="ai-stop-btn" title="Stop generation" aria-label="Stop">
              <i class="ph ph-stop"></i>
            </button>
            <button class="ai-send-btn" id="ai-send-btn" title="Send (Enter)" aria-label="Send">
              <i class="ph-bold ph-arrow-up"></i>
            </button>
          </div>
        </div>

        <div class="ai-resize-handle" aria-label="Resize AI panel"></div>
      </div>`;
    document.body.appendChild(this.container);

    this.providerIcon  = this.container.querySelector('#ai-provider-icon');
    this.messagesEl    = this.container.querySelector('#ai-messages');
    this.emptyStateEl  = this.container.querySelector('#ai-empty-state');
    this.inputEl       = this.container.querySelector('#ai-input');
    this.composerEl    = this.container.querySelector('#ai-composer');
    this.sendBtn       = this.container.querySelector('#ai-send-btn');
    this.stopBtn       = this.container.querySelector('#ai-stop-btn');
    this.clearBtn      = this.container.querySelector('#ai-clear-btn');
    this.tokenCounter  = this.container.querySelector('#ai-token-counter');

    // Model / provider chip + popover.
    this.modelChip     = this.container.querySelector('#ai-model-chip');
    this.modelChipIcon = this.container.querySelector('#ai-model-chip-icon');
    this.modelChipName = this.container.querySelector('#ai-model-chip-name');
    this.modelPopover  = this.container.querySelector('#ai-model-popover');
    this.mpProviders   = this.container.querySelector('#ai-mp-providers');
    this.mpPerms       = this.container.querySelector('#ai-mp-perms');
    this.modelInput    = this.container.querySelector('#ai-model-input');
    this.modelResetBtn = this.container.querySelector('#ai-model-reset');
    this.mpModelApi    = this.container.querySelector('#ai-mp-model-api');
    this.mpModelPresets= this.container.querySelector('#ai-mp-model-presets');
    this.mpUsage       = this.container.querySelector('#ai-mp-usage');
    this.usageBars     = this.container.querySelector('#ai-usage-bars');
    this.usagePlan     = this.container.querySelector('#ai-usage-plan');
    this.ccStatusEl    = this.container.querySelector('#ai-mp-cc-status');
    this.effortSection = this.container.querySelector('#ai-mp-effort-section');
    this.effortSeg     = this.container.querySelector('#ai-mp-effort');
    this.ccSections    = this.container.querySelectorAll('.ai-mp-cc');

    this.historyBtn        = this.container.querySelector('#ai-history-btn');
    this.historyPopover    = this.container.querySelector('#ai-history-popover');
    this.historyList       = this.container.querySelector('#ai-history-list');
    this.chatEmptyHint     = this.container.querySelector('#ai-chat-empty-hint');
    this.terminalClearBtn  = this.container.querySelector('#ai-terminal-clear-btn');

    this.buildPermissionOptions();
    this.attachListeners();
    this.setupResize(this.container.querySelector('.ai-resize-handle'), this.container);

    // Restore persisted panel width.
    try {
      const w = parseInt(localStorage.getItem('aurora-ai-panel-width'), 10);
      if (w >= 320) this.container.style.width = w + 'px';
    } catch (_) { /* ignore */ }

    // Restore open state — if the panel was open when the user last closed
    // the app, re-open it now so they land right back where they left off.
    try {
      if (localStorage.getItem('aurora-ai-panel-open') === '1') {
        this.container.classList.add('open');
        document.body.classList.add('ai-assistant-open');
        this.refreshProviders().then(() => this.inputEl?.focus());
        this.refreshChatList();
      }
    } catch (_) { /* ignore */ }
  }

  attachListeners() {
    this.container.querySelector('.ai-hbtn-close').addEventListener('click', () => this.toggle());

    // Model / provider popover — opened from the composer chip.
    this.modelChip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleModelPopover();
    });
    this.modelPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggleModelPopover(false));

    // Re-sync providers whenever the AI settings panel changes model/key.
    window.addEventListener('aurora-ai-settings-changed', () => this.refreshProviders());

    this.mpProviders.addEventListener('change', (e) => {
      const radio = e.target.closest('input[name="ai-provider"]');
      if (radio) this.selectProvider(radio.value);
    });
    this.mpPerms.addEventListener('change', (e) => {
      const radio = e.target.closest('input[name="ai-perm"]');
      if (radio) this.setPermissionMode(radio.value);
    });

    // Model id — committed on Enter / blur (API providers, free text).
    this.modelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.modelInput.blur(); }
    });
    this.modelInput.addEventListener('change', () => this.commitModel(this.modelInput.value));
    this.modelResetBtn.addEventListener('click', () => {
      const meta = this.providersAvailable.find((p) => p.name === this.currentProvider);
      this.commitModel(meta?.defaultModel || '');
    });

    // Claude Code model presets (segmented control).
    this.mpModelPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-model]');
      if (btn) this.commitModel(btn.dataset.model);
    });

    // Claude Code effort / reasoning depth (segmented control).
    this.effortSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-effort]');
      if (btn) this.setClaudeCodeEffort(btn.dataset.effort);
    });

    // Claude Code status section — "Re-check" button.
    this.ccStatusEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-cc-recheck]')) this.refreshClaudeCodeStatus();
    });

    this.container.querySelector('#ai-mp-managekeys').addEventListener('click', () => {
      this.toggleModelPopover(false);
      document.getElementById('aurora-settings')?.click();
      // Jump straight to the AI Assistant pane once the modal is up.
      setTimeout(() => {
        document.querySelector('.settings-nav-item[data-pane="ai"]')?.click();
      }, 60);
    });

    // History popover — list of persisted chats + "New chat".
    this.historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistory();
    });
    this.historyPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => this.toggleHistory(false));
    this.container.querySelector('#ai-history-new').addEventListener('click', () => {
      this.toggleHistory(false);
      this.newChat();
    });
    this.historyList.addEventListener('click', (e) => this.handleHistoryClick(e));

    this.sendBtn.addEventListener('click', () => this.send());
    this.stopBtn.addEventListener('click', () => this.stop());
    this.clearBtn.addEventListener('click', () => this.newChat());
    this.terminalClearBtn.addEventListener('click', async () => {
      try { await window.AuroraAPI?.terminal?.clear(); } catch (_) { /* silent */ }
    });

    // Enter sends, Shift+Enter inserts a newline.
    // Block sending while streaming — user can still type their next message.
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!this._isStreaming && !this.sendBtn.disabled) this.send();
      }
    });

    // Grow the composer with the text the user types (up to a cap, then
    // scroll). Runs on every input event.
    this.inputEl.addEventListener('input', () => this.autoGrowInput());

    // External links in markdown bubbles: openExternal so the renderer
    // window doesn't navigate. The anchor itself is just a sentinel —
    // `data-href` carries the real URL.
    this.messagesEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-href]');
      if (!a) return;
      e.preventDefault();
      window.electronAPI?.openExternal?.(a.getAttribute('data-href'));
    });

    // Copy button on code blocks.
    this.messagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.ai-code-copy');
      if (!btn) return;
      const code = btn.closest('.ai-code-block')?.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.innerText).then(() => {
        btn.innerHTML = '<i class="ph ph-check"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="ph ph-copy"></i>'; }, 2000);
      }).catch(() => {});
    });
  }

  /* ---------------- model / provider popover ---------------- */

  toggleModelPopover(force) {
    const open = force === undefined ? !this.modelPopoverOpen : force;
    this.modelPopoverOpen = open;
    this.modelPopover.classList.toggle('hidden', !open);
    this.modelChip.classList.toggle('active', open);
    if (open && this.currentProvider === 'claude-code') this.refreshClaudeCodeUsage();
  }

  buildPermissionOptions() {
    this.mpPerms.innerHTML = PERMISSION_MODES.map((m) => `
      <label class="ai-mp-opt ai-mp-opt-perm">
        <input type="radio" name="ai-perm" value="${m.id}"${m.id === this.permissionMode ? ' checked' : ''}>
        <span class="ai-mp-opt-text">
          <span class="ai-mp-opt-label">${m.label}</span>
          <span class="ai-mp-opt-hint">${m.hint}</span>
        </span>
      </label>
    `).join('');
  }

  setPermissionMode(mode) {
    if (!PERMISSION_MODES.some((m) => m.id === mode)) return;
    this.permissionMode = mode;
    try { localStorage.setItem(PERMISSION_STORE_KEY, mode); }
    catch (_) { /* persistence is best-effort */ }
  }

  async refreshProviders() {
    if (!window.aiAPI) {
      this.showEmptyState(true);
      this.sendBtn.disabled = true;
      this.inputEl.disabled = true;
      return;
    }

    let providers = [];
    try {
      const r = await window.aiAPI.listProviders();
      const s = await window.aiAPI.getKeyStatus();
      providers = r?.providers || [];
      this.providersConfigured = s?.configured || {};
    } catch (e) {
      console.warn('[ai-panel] refreshProviders failed:', e);
      providers = [];
      this.providersConfigured = {};
    }

    // Claude Code is a synthetic, always-available provider (subscription
    // auth — no API key). Its model is persisted locally, not by the backend.
    if (!this.claudeCodeEntry) {
      this.claudeCodeEntry = { ...CLAUDE_CODE_PROVIDER };
      try {
        const saved = localStorage.getItem('aurora-ai-claude-code-model');
        if (saved) this.claudeCodeEntry.model = saved;
      } catch (_) { /* ignore */ }
    }
    this.providersConfigured['claude-code'] = true;

    const apiUsable = providers.filter((p) => this.providersConfigured[p.name]);
    this.providersAvailable = [this.claudeCodeEntry, ...apiUsable];

    this.showEmptyState(false);
    this.sendBtn.disabled = false;
    this.inputEl.disabled = false;

    // Keep the current selection if still valid; otherwise prefer a
    // configured API provider, falling back to Claude Code.
    if (!this.currentProvider ||
        !this.providersAvailable.some((p) => p.name === this.currentProvider)) {
      this.currentProvider = apiUsable[0]?.name || 'claude-code';
    }

    this.renderProviderOptions();
    this.applyProviderState();
  }

  renderProviderOptions() {
    this.mpProviders.innerHTML = this.providersAvailable.map((p) => {
      const meta = PROVIDER_META[p.name] || { label: p.name };
      const checked = p.name === this.currentProvider ? ' checked' : '';
      const hint = meta.subscription ? meta.tagline : (p.model || 'default model');
      return `
        <label class="ai-mp-opt">
          <input type="radio" name="ai-provider" value="${p.name}"${checked}>
          <img class="ai-mp-opt-icon" src="${meta.icon}" alt="">
          <span class="ai-mp-opt-text">
            <span class="ai-mp-opt-label">${meta.label}${
              meta.subscription ? '<span class="ai-mp-opt-tag">SUB</span>' : ''}</span>
            <span class="ai-mp-opt-hint">${hint}</span>
          </span>
        </label>
      `;
    }).join('');
  }

  /** Reflect the active provider across the icon, chip, controls and usage. */
  applyProviderState() {
    const meta = PROVIDER_META[this.currentProvider] || {};
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    const isSub = !!meta.subscription;

    if (meta.icon) this.providerIcon.src = meta.icon;
    this.updateModelChip();
    if (this.modelInput) this.modelInput.value = entry?.model || '';

    // Show / hide the Claude-Code-only sections (status, effort, usage).
    this.ccSections.forEach((el) => el.classList.toggle('hidden', !isSub));

    this.renderModelControls();
    if (isSub) {
      this.renderEffort();
      this.refreshClaudeCodeStatus();
      this.refreshClaudeCodeUsage();
    }
  }

  /** Switch the active provider (from a radio change in the popover). */
  selectProvider(name) {
    if (name === this.currentProvider) return;
    this.currentProvider = name;
    this.applyProviderState();
  }

  /** Model picker: free-text input for API providers, presets for Claude Code. */
  renderModelControls() {
    const isSub = this.currentProvider === 'claude-code';
    this.mpModelApi.classList.toggle('hidden', isSub);
    this.mpModelPresets.classList.toggle('hidden', !isSub);
    if (isSub) {
      const active = this.claudeCodeEntry?.model || 'default';
      this.mpModelPresets.innerHTML = CLAUDE_CODE_MODELS.map((m) =>
        `<button type="button" data-model="${m.id}" class="ai-seg-btn${
          m.id === active ? ' active' : ''}">${m.label}</button>`).join('');
    }
  }

  /** Effort / reasoning-depth segmented control (Claude Code only). */
  renderEffort() {
    this.effortSeg.innerHTML = CLAUDE_CODE_EFFORT.map((e) =>
      `<button type="button" data-effort="${e.id}" class="ai-seg-btn${
        e.id === this.claudeCodeEffort ? ' active' : ''}">${e.label}</button>`).join('');
  }

  setClaudeCodeEffort(id) {
    if (!CLAUDE_CODE_EFFORT.some((e) => e.id === id)) return;
    this.claudeCodeEffort = id;
    try { localStorage.setItem('aurora-ai-cc-effort', id); }
    catch (_) { /* best-effort */ }
    this.renderEffort();
  }

  /** Persist a model id for the active provider and refresh the chip. */
  async commitModel(value) {
    const v = (value || '').trim();
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);

    if (this.currentProvider === 'claude-code') {
      const model = v || 'default';
      if (entry) entry.model = model;
      try { localStorage.setItem('aurora-ai-claude-code-model', model); }
      catch (_) { /* best-effort */ }
      this.renderModelControls();
      this.updateModelChip();
      return;
    }

    try {
      const r = await window.aiAPI.setModel(this.currentProvider, v);
      if (r && r.ok) {
        if (entry) entry.model = r.model || '';
        if (this.modelInput) this.modelInput.value = r.model || '';
      }
    } catch (_) { /* leave the field as the user typed it */ }
    this.updateModelChip();
    this.renderProviderOptions();   // refresh the per-provider model hint
  }

  /** Refresh the composer chip — provider icon + short model name. */
  updateModelChip() {
    const meta = PROVIDER_META[this.currentProvider] || {};
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    if (meta.icon) this.modelChipIcon.src = meta.icon;

    const short = shortModelName(entry?.model);
    this.modelChipName.textContent = short || meta.label || this.currentProvider || 'Model';
    this.modelChip.title = entry?.model
      ? `${meta.label || this.currentProvider} · ${entry.model}`
      : `${meta.label || this.currentProvider} — switch model or provider`;
  }

  /* ---------------- Claude Code: connection status ---------------- */

  /** Probe the local Claude Code CLI install + subscription login. */
  async refreshClaudeCodeStatus() {
    let status = null;
    try {
      const r = await window.aiAPI?.getClaudeCodeStatus?.();
      status = r?.status || null;
    } catch (_) { /* treat as not installed */ }
    this.claudeCodeStatus = status;
    this.renderClaudeCodeStatus();
  }

  renderClaudeCodeStatus() {
    if (!this.ccStatusEl) return;
    const s = this.claudeCodeStatus;
    let state = 'off';
    let icon = 'ph-x-circle';
    let title = 'Checking…';
    let detail = '';

    if (!s) {
      title = 'Checking Claude Code…';
    } else if (!s.installed) {
      state = 'off'; icon = 'ph-x-circle';
      title = 'Claude Code not installed';
      detail = 'Install it: npm i -g @anthropic-ai/claude-code';
    } else if (!s.authed) {
      state = 'warn'; icon = 'ph-warning-circle';
      title = 'Not signed in';
      detail = 'Run <code>claude login</code> in a terminal, then re-check.';
    } else {
      state = 'on'; icon = 'ph-check-circle';
      const plan = s.plan ? String(s.plan).toUpperCase() : 'subscription';
      title = `Connected · ${plan}`;
      detail = `Claude Code ${s.version || ''}`.trim();
    }

    this.ccStatusEl.dataset.state = state;
    this.ccStatusEl.innerHTML = `
      <div class="ai-cc-row">
        <i class="ph ${icon} ai-cc-icon" aria-hidden="true"></i>
        <span class="ai-cc-title">${title}</span>
        <button type="button" class="ai-cc-recheck" data-cc-recheck
                title="Re-check connection">
          <i class="ph ph-arrow-clockwise" aria-hidden="true"></i>
        </button>
      </div>
      ${detail ? `<p class="ai-cc-detail">${detail}</p>` : ''}`;
  }

  /** True when Claude Code is installed and signed in. */
  isClaudeCodeReady() {
    return !!(this.claudeCodeStatus &&
      this.claudeCodeStatus.installed && this.claudeCodeStatus.authed);
  }

  /* ---------------- Claude Code: subscription usage ---------------- */

  async refreshClaudeCodeUsage() {
    let usage = null;
    try {
      const r = await window.aiAPI?.getClaudeCodeUsage?.();
      usage = r?.usage || null;
    } catch (_) { /* leave usage null */ }
    this.claudeUsage = usage;
    this.renderUsage();
  }

  renderUsage() {
    if (!this.usageBars) return;
    const u = this.claudeUsage;

    this.usagePlan.textContent = u?.plan ? `${String(u.plan).toUpperCase()} plan` : '';

    // Session: real token tally for this app run (from the CLI's per-turn
    // usage), plus the local conversation counter as a floor.
    const sessTokens = Math.max(u?.session?.tokens || 0, this.cumulativeTokens);
    const cost = u?.session?.costUsd;
    const rows = [
      usageRowHTML('Session', 'ph-lightning',
        `${formatTokens(sessTokens)} tk${cost ? ` · $${cost.toFixed(2)}` : ''}`,
        'count', 0),
    ];

    // Rate-limit windows (5-hour, weekly) reported by the CLI.
    const windows = Array.isArray(u?.windows) ? u.windows : [];
    for (const w of windows) {
      const meta = WINDOW_META[w.rateLimitType] || { label: w.rateLimitType, icon: 'ph-clock' };
      const sev = w.status === 'rejected' ? 'high'
        : (w.status && w.status !== 'allowed') ? 'mid' : 'ok';
      const reset = w.resetsAt ? `resets ${untilTime(w.resetsAt)}` : '';
      rows.push(usageRowHTML(meta.label, meta.icon, reset || w.status || '', sev,
        sev === 'high' ? 100 : sev === 'mid' ? 66 : 22));
    }

    this.usageBars.innerHTML = rows.join('');

    const hint = this.mpUsage.querySelector('.ai-usage-hint');
    if (!windows.length) {
      if (!hint) {
        const h = document.createElement('p');
        h.className = 'ai-usage-hint';
        h.textContent = 'Plan limits appear here after your first Claude Code message.';
        this.mpUsage.appendChild(h);
      }
    } else if (hint) {
      hint.remove();
    }
  }

  /* ---------------- tool permission gate ---------------- */

  /**
   * Decide whether a tool call may run. Resolves true/false. Called by
   * the tool runner before every tool. `allow` mode auto-approves;
   * `writes` auto-approves reads; otherwise an inline card is shown.
   */
  confirmToolCall(def, args) {
    const mode = this.permissionMode;
    if (mode === 'allow') return Promise.resolve(true);
    if (mode === 'writes' && def && def.access === 'read') return Promise.resolve(true);
    return this.showInlineConfirm(def, args);
  }

  previewArgs(args) {
    if (!args || Object.keys(args).length === 0) return '';
    let json;
    try { json = JSON.stringify(args, null, 2); }
    catch { json = String(args); }
    return json.length > 500 ? json.slice(0, 500) + '\n…' : json;
  }

  /**
   * Render an inline Allow/Deny card in the message stream (not a
   * full-screen modal) and resolve with the user's choice. The card
   * removes itself once decided.
   */
  showInlineConfirm(def, args) {
    return new Promise((resolve) => {
      const card = document.createElement('div');
      card.className = 'ai-confirm enter';
      const verb = def && def.access === 'write' ? 'make a change' : 'read something';
      card.innerHTML = `
        <div class="ai-confirm-head">
          <i class="ph ph-shield-check" aria-hidden="true"></i>
          <span>Aurora Intelligence wants to ${verb}</span>
        </div>
        <div class="ai-confirm-tool"></div>
        <div class="ai-confirm-desc"></div>
        <pre class="ai-confirm-args"></pre>
        <div class="ai-confirm-actions">
          <button class="ai-confirm-deny" type="button">Deny</button>
          <button class="ai-confirm-allow" type="button">Allow</button>
        </div>
      `;
      card.querySelector('.ai-confirm-tool').textContent = def ? def.name : 'tool';
      card.querySelector('.ai-confirm-desc').textContent = def ? (def.description || '') : '';
      const preview = this.previewArgs(args);
      const pre = card.querySelector('.ai-confirm-args');
      if (preview) pre.textContent = preview; else pre.remove();

      let settled = false;
      const finish = (allowed) => {
        if (settled) return;
        settled = true;
        this.pendingConfirms.delete(decide);
        card.classList.add('done');
        setTimeout(() => card.remove(), 180);
        resolve(allowed);
      };
      // Registered so an aborted/failed turn can auto-deny a stale card.
      const decide = (allowed) => finish(allowed);
      this.pendingConfirms.add(decide);

      card.querySelector('.ai-confirm-allow').addEventListener('click', () => finish(true));
      card.querySelector('.ai-confirm-deny').addEventListener('click', () => finish(false));

      this.messagesEl.appendChild(card);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      requestAnimationFrame(() => card.classList.remove('enter'));
    });
  }

  showEmptyState(show) {
    this.emptyStateEl.classList.toggle('hidden', !show);
    this.messagesEl.classList.toggle('hidden', show);
    if (!show && this.chatEmptyHint) {
      this.chatEmptyHint.classList.toggle('hidden', this.messages.length > 0);
    }
  }

  /* ---------------- sending ---------------- */

  async send() {
    if (!window.aiAPI || !this.currentProvider) return;
    const text = this.inputEl.value.trim();
    if (!text) return;

    // Claude Code talks to the user's subscription via the local CLI.
    // If it isn't installed / signed in, fail fast with a clear notice
    // (display-only bubble — not persisted) instead of a stream error.
    if (this.currentProvider === 'claude-code') {
      if (!this.claudeCodeStatus) await this.refreshClaudeCodeStatus();
      if (!this.isClaudeCodeReady()) {
        const s = this.claudeCodeStatus;
        this.appendBubble('assistant', !s || !s.installed
          ? '**Claude Code is not installed.** Install it with ' +
            '`npm i -g @anthropic-ai/claude-code`, then open the model menu ' +
            'and click re-check.'
          : '**Claude Code is not signed in.** Run `claude login` in a ' +
            'terminal, then open the model menu and click re-check.', false);
        return;
      }
    }

    this.inputEl.value = '';
    this.autoGrowInput();

    // First message of a new chat — assign an id, derive a title from
    // the user's text, and mark this as the conversation we'll persist.
    if (!this.currentChatId) {
      try {
        const r = await window.aiAPI.newConversationId?.();
        this.currentChatId = (r && r.id) || `c-${Date.now()}`;
      } catch (_) { this.currentChatId = `c-${Date.now()}`; }
      this.currentChatTitle = text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New chat';
      this.currentChatCreatedAt = Date.now();
    }

    this.appendBubble('user', text);
    this.messages.push({ role: 'user', content: text });

    // Assistant output is built lazily: text segments and tool chips
    // append in arrival order, so a turn reads top-to-bottom even when
    // the model interleaves "explain → call a tool → explain".
    this.turnText = '';
    this.segmentBuffer = '';
    this.currentAssistantContentEl = null;
    this.runningChips = [];
    this.showThinking(true);

    // Subscribe lazily so we never miss the first packet — startChat
    // fires the work detached on main.
    if (!this.unsubChatEvent) {
      this.unsubChatEvent = window.aiAPI.onChatEvent((ev) => this.handleChatEvent(ev));
    }

    this.currentSessionId = (crypto.randomUUID && crypto.randomUUID()) ||
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.setStreaming(true);

    // Tool-type entries are display-only records; filter them before sending to the model.
    const apiMessages = this.messages
      .filter((m) => m.role !== 'tool')
      .map((m) => ({ role: m.role, content: m.content }));

    const isClaudeCode = this.currentProvider === 'claude-code';

    // Inject the current project path into the system prompt on every
    // turn. Without this, the model has to spend a `get_current_project`
    // tool-call (and the user's tokens) just to know where it is —
    // worse, models that don't reliably call tools first sometimes
    // hallucinate paths from earlier projects. The block is rebuilt
    // per-turn so switching projects mid-chat just works.
    const projectPath =
      window.currentProjectPath || window.currentOpenProjectPath || null;
    const spfPath = window.ProjectStore?.getSpfPath?.() || null;
    const projectContext = projectPath
      ? `\n\nACTIVE AURORA PROJECT — single source of truth, refreshed every turn:\n` +
        `  project_root: ${projectPath}\n` +
        (spfPath ? `  spf_file:     ${spfPath}\n` : '') +
        `Use these exact paths when calling tools (read_file, create_file, set_top_level, …).\n` +
        `Do not hallucinate a different root, do not assume cwd. If you need the full file list, call get_project_tree.\n`
      : '\n\nNO PROJECT IS CURRENTLY OPEN — ask the user to open one before running any project-scoped tool.\n';
    const systemPrompt = SYSTEM_PROMPT + projectContext;

    try {
      const r = await window.aiAPI.startChat({
        sessionId: this.currentSessionId,
        conversationId: this.currentChatId,
        provider: this.currentProvider,
        modelId: isClaudeCode ? (this.claudeCodeEntry?.model || 'default') : undefined,
        messages: apiMessages,
        system: systemPrompt,
        effort: isClaudeCode ? this.claudeCodeEffort : undefined,
        permission: this.permissionMode,
      });
      if (r && r.ok === false) this.failTurn(r.error || 'Failed to start chat');
    } catch (e) {
      this.failTurn(e?.message || String(e));
    }
  }

  async stop() {
    if (!this.currentSessionId || !window.aiAPI) return;
    try { await window.aiAPI.abortChat(this.currentSessionId); }
    catch (_) { /* the stream side reports back via 'aborted' */ }
  }

  handleChatEvent(ev) {
    if (!ev || ev.sessionId !== this.currentSessionId) return;
    switch (ev.type) {
      case 'text-delta':
        this.showThinking(false);
        this.appendDelta(ev.delta || '');
        break;
      case 'tool-call':
        this.showThinking(false);
        this.hadToolCalls = true;
        this.startToolChip(ev.toolName, ev.args, ev.toolUseId);
        // Text after a tool call opens a fresh segment below the chip.
        this.currentAssistantContentEl = null;
        this.segmentBuffer = '';
        break;
      case 'tool-result':
        this.finishToolChip(ev.toolName, ev.result, ev.toolUseId);
        break;
      case 'finish':
        this.showThinking(false);
        this.commitTurn();
        this.applyUsage(ev.usage);
        this.setStreaming(false);
        break;
      case 'aborted':
        this.showThinking(false);
        this.commitTurn();
        this.setStreaming(false);
        break;
      case 'error':
        this.failTurn(ev.message || 'Unknown error');
        break;
    }
  }

  /* ---------------- streaming text segments ---------------- */

  appendDelta(delta) {
    if (!delta) return;
    if (!this.currentAssistantContentEl) {
      const bubble = this.appendBubble('assistant', '');
      this.currentAssistantContentEl = bubble.querySelector('.ai-msg-content');
      this.segmentBuffer = '';
    }
    this.segmentBuffer += delta;
    this.turnText += delta;
    // Strip tool-call artefacts that some models (Llama/Qwen) emit as inline
    // text. This covers XML blocks, Qwen-style JSON+</tool_call> lines, and
    // orphan closing tags. Only complete patterns are stripped while streaming
    // so partial tags don't permanently corrupt the buffer.
    const displayText = this.segmentBuffer
      .replace(/<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g, '')
      .replace(/[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g, '')
      .replace(/<\/tool_call>/g, '')
      .trim();
    // If stripping removes everything and the buffer looks like a tool-call
    // JSON being streamed token-by-token, render empty rather than flashing
    // raw JSON at the user (the tool chip will appear shortly).
    const looksLikeToolArtifact = !displayText &&
      /^\s*[⺀-鿿]*\s*\{/.test(this.segmentBuffer) &&
      /"name"\s*:/.test(this.segmentBuffer);
    this.currentAssistantContentEl.innerHTML = renderMarkdown(
      looksLikeToolArtifact ? '' : (displayText || this.segmentBuffer),
    );
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  commitTurn() {
    // The whole turn's text is persisted as one assistant message so
    // the next turn carries context. Strip XML tool-call artifacts before
    // storing — they confuse models on subsequent turns.
    const cleanText = this.turnText
      .replace(/<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g, '')
      .replace(/[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g, '')
      .replace(/<\/tool_call>/g, '')
      .trim();
    if (cleanText) {
      this.messages.push({ role: 'assistant', content: cleanText });
    }
    if (this.currentAssistantContentEl) highlightCodeBlocks(this.currentAssistantContentEl);

    // If the model called tools but never generated a text explanation
    // (common with some Ollama models), show a prompt so the user knows
    // the turn is over and can ask a follow-up.
    if (!cleanText && this.hadToolCalls) {
      this.appendBubble('assistant', '_All actions completed. Ask a follow-up if you want details._');
    }

    this.resetTurnState();
    // Auto-save the conversation after every turn.
    this.persistCurrentChat();
  }

  failTurn(message) {
    this.showThinking(false);
    this.appendBubble('assistant', `Error: ${message}`, { error: true });
    // Mark in-flight chips as failed in DOM and persist them — args
    // are kept so the saved transcript still shows what was attempted.
    for (const running of this.runningChips) {
      const { toolName, toolUseId, args, el } = running;
      el.classList.remove('running');
      el.classList.add('failed');
      const statusEl = el.querySelector('.ai-tool-status');
      if (statusEl) statusEl.textContent = 'failed';
      const icon = el.querySelector('i');
      if (icon) icon.className = 'ph ph-x-circle';
      this.messages.push({
        role: 'tool',
        toolName,
        status: 'failed',
        toolUseId: toolUseId || null,
        args: args || null,
        error: message,
      });
    }
    this.persistCurrentChat();
    this.resetTurnState();
    this.setStreaming(false);
  }

  resetTurnState() {
    this.currentAssistantContentEl = null;
    this.segmentBuffer = '';
    this.turnText = '';
    this.currentSessionId = null;
    this.runningChips = [];
    this.hadToolCalls = false;
    // Auto-deny any confirmation cards still open when the turn ends
    // (e.g. the user hit Stop while a card was waiting).
    for (const decide of this.pendingConfirms) decide(false);
    this.pendingConfirms.clear();
  }

  /* ---------------- tool chips ---------------- */

  startToolChip(toolName, args, toolUseId) {
    const name = toolName || 'tool';
    const chip = document.createElement('div');
    chip.className = 'ai-tool-chip running';
    chip.innerHTML = `
      <i class="ph ph-circle-notch ai-tool-spin" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status">running…</span>
    `;
    chip.querySelector('.ai-tool-name').textContent = name;
    // Args go into the chip's title so users can inspect the inputs
    // by hovering — useful for diagnosing model behaviour without
    // bloating the visible chip. Long args are clipped at 800 chars.
    if (args && Object.keys(args).length) {
      const argText = this._formatArgsForTitle(args);
      if (argText) chip.title = argText;
    }
    this.messagesEl.appendChild(chip);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.runningChips.push({ toolUseId: toolUseId || null, toolName: name, args, el: chip });
  }

  finishToolChip(toolName, result, toolUseId) {
    const name = toolName || 'tool';
    // Prefer matching by toolUseId (carried end-to-end from the
    // provider/CLI) — without it, two parallel calls to the same tool
    // would collide on toolName and one chip would stay spinning
    // forever. Fall back to name-match for legacy events without ids.
    let idx = -1;
    if (toolUseId) {
      idx = this.runningChips.findIndex((c) => c.toolUseId === toolUseId);
    }
    if (idx < 0) {
      idx = this.runningChips.findIndex((c) => c.toolName === name);
    }
    if (idx < 0) return;
    const running = this.runningChips.splice(idx, 1)[0];
    const { el, args } = running;
    const ok = !(result && result.ok === false);
    const denied = !ok && /denied/i.test((result && result.error) || '');
    const statusStr = ok ? 'done' : (denied ? 'denied' : 'failed');
    el.classList.remove('running');
    el.classList.add(statusStr);
    const icon = el.querySelector('i');
    const statusEl = el.querySelector('.ai-tool-status');
    if (icon) icon.className = ok ? 'ph ph-check-circle' : (denied ? 'ph ph-prohibit' : 'ph ph-x-circle');
    if (statusEl) statusEl.textContent = statusStr;
    // Tooltip now shows args + result preview together.
    const tooltip = this._formatToolTooltip(args, result);
    if (tooltip) el.title = tooltip;

    // Persist the tool call in the messages array so it survives
    // into the saved chat and can be replayed when history is opened.
    // Args + a result preview are saved so the user can later inspect
    // exactly what each call did even after the model context is gone.
    const entry = {
      role: 'tool',
      toolName: name,
      status: statusStr,
      toolUseId: toolUseId || running.toolUseId || null,
      args: args || null,
      result: this._summariseResult(result),
    };
    if (!ok && result?.error) entry.error = result.error;
    this.messages.push(entry);
  }

  /** Compact, hover-friendly representation of tool args. */
  _formatArgsForTitle(args) {
    try {
      const s = JSON.stringify(args, null, 2);
      return s.length > 800 ? `${s.slice(0, 800)}…` : s;
    } catch (_) { return ''; }
  }

  /** Hover tooltip showing args and a preview of the result. */
  _formatToolTooltip(args, result) {
    const lines = [];
    if (args && Object.keys(args).length) {
      const a = this._formatArgsForTitle(args);
      if (a) lines.push(`args: ${a}`);
    }
    if (result) {
      const r = this._summariseResult(result);
      if (typeof r === 'string') {
        lines.push(`result: ${r.length > 400 ? r.slice(0, 400) + '…' : r}`);
      } else if (r != null) {
        try {
          const s = JSON.stringify(r);
          lines.push(`result: ${s.length > 400 ? s.slice(0, 400) + '…' : s}`);
        } catch (_) { /* ignore */ }
      }
    }
    return lines.join('\n');
  }

  /** Reduce a tool result to a small JSON-serialisable summary for persistence. */
  _summariseResult(result) {
    if (result == null) return null;
    if (typeof result === 'string') return result.slice(0, 4000);
    if (typeof result !== 'object') return result;
    // Common shapes: { ok, data } from AuroraAPI, { ok, content } from Claude Code.
    const out = {};
    if ('ok' in result) out.ok = !!result.ok;
    if ('error' in result && result.error) out.error = String(result.error).slice(0, 800);
    if ('content' in result && typeof result.content === 'string') {
      out.content = result.content.length > 4000 ? result.content.slice(0, 4000) + '…' : result.content;
    }
    if ('data' in result) {
      try {
        const s = JSON.stringify(result.data);
        out.data = s.length > 4000 ? JSON.parse(s.slice(0, 4000)) : result.data;
      } catch (_) { out.data = '[unserialisable]'; }
    }
    return out;
  }

  /**
   * Renders a completed tool chip with no animation — used when replaying
   * saved conversations from history. The chip shows the final status
   * (done / failed / denied) and a tooltip with args + result.
   */
  appendStaticToolChip(toolName, status, error, args, result) {
    const chip = document.createElement('div');
    chip.className = `ai-tool-chip ${status || 'done'}`;
    const iconClass = status === 'done'   ? 'ph ph-check-circle'
                    : status === 'denied' ? 'ph ph-prohibit'
                                          : 'ph ph-x-circle';
    chip.innerHTML = `
      <i class="${iconClass}" aria-hidden="true"></i>
      <span class="ai-tool-name"></span>
      <span class="ai-tool-status"></span>
    `;
    chip.querySelector('.ai-tool-name').textContent = toolName || 'tool';
    chip.querySelector('.ai-tool-status').textContent = status || 'done';
    const tooltip = this._formatToolTooltip(args, result) ||
                    (error ? `error: ${error}` : '');
    if (tooltip) chip.title = tooltip;
    this.messagesEl.appendChild(chip);
  }

  /* ---------------- thinking indicator ---------------- */

  showThinking(show) {
    if (show && !this.thinkingEl) {
      const words = [
        'Descombobulating', 'Reticulating splines', 'Calibrating flux',
        'Summoning quarks', 'Consulting the oracle', 'Defragmenting neurons',
        'Reverse-engineering vibes', 'Untangling spaghetti', 'Overclocking brain cells',
        'Pondering the imponderables',
      ];
      const word = words[Math.floor(Math.random() * words.length)];
      const el = document.createElement('div');
      el.className = 'ai-thinking-wrap';
      el.innerHTML = `<div class="ai-thinking"><div class="ai-thinking-dots"><span></span><span></span><span></span></div></div><em class="ai-thinking-word">${word}…</em>`;
      this.messagesEl.appendChild(el);
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      this.thinkingEl = el;
    } else if (!show && this.thinkingEl) {
      this.thinkingEl.remove();
      this.thinkingEl = null;
    }
  }

  applyUsage(usage) {
    if (!usage) return;
    // Vercel AI SDK v6 surfaces `totalTokens` (sometimes `inputTokens`
    // + `outputTokens`). Be defensive about both shapes.
    const total = usage.totalTokens ??
      ((usage.inputTokens ?? usage.promptTokens ?? 0) +
       (usage.outputTokens ?? usage.completionTokens ?? 0));
    if (total > 0) {
      this.cumulativeTokens += total;
      this.updateTokenCounter();
    }
  }

  /** Refresh the compact composer token pill (+ live Claude Code usage). */
  updateTokenCounter() {
    this.tokenCounter.textContent = formatTokens(this.cumulativeTokens);
    this.tokenCounter.title = `${this.cumulativeTokens.toLocaleString()} tokens this conversation`;
    if (this.currentProvider === 'claude-code' && this.modelPopoverOpen) this.renderUsage();
  }

  /** Grow the textarea to fit its content (up to ~10 lines, then scroll). */
  autoGrowInput() {
    const el = this.inputEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  setStreaming(streaming) {
    this._isStreaming = streaming;
    this.sendBtn.classList.toggle('hidden', streaming);
    this.stopBtn.classList.toggle('hidden', !streaming);
    // Keep textarea enabled so the user can compose their next message
    // while generation is running; Enter-to-send is blocked by _isStreaming.
    this.clearBtn.disabled = streaming;
  }

  /* ---------------- bubbles / clear ---------------- */

  appendBubble(role, content, { error = false } = {}) {
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const el = document.createElement('div');
    el.className = `ai-message ai-msg-${role}${error ? ' error' : ''}`;
    const label = role === 'user' ? 'You' : 'Aurora Intelligence';
    el.innerHTML = `
      <div class="ai-msg-role">${label}</div>
      <div class="ai-msg-content"></div>
    `;
    const contentEl = el.querySelector('.ai-msg-content');
    if (role === 'user') {
      // User text is verbatim, not rendered as markdown.
      contentEl.textContent = content;
    } else if (content) {
      contentEl.innerHTML = renderMarkdown(content);
      highlightCodeBlocks(contentEl);
    }
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return el;
  }

  /**
   * Start a fresh chat. Saves the current one first so it remains in
   * the history sidebar, then clears every piece of in-memory state.
   * Replaces the old `clearChat` — the button at the header now
   * carries a "+" icon and is wired here.
   */
  async newChat() {
    if (this.currentSessionId) return;        // never switch mid-stream
    await this.persistCurrentChat();
    this.messages = [];
    this.messagesEl.innerHTML = '';
    if (this.chatEmptyHint) {
      this.messagesEl.appendChild(this.chatEmptyHint);
      this.chatEmptyHint.classList.remove('hidden');
    }
    this.cumulativeTokens = 0;
    this.updateTokenCounter();
    this.runningChips = [];
    this.thinkingEl = null;
    this.currentChatId = null;
    this.currentChatTitle = '';
    this.currentChatCreatedAt = 0;
    this.refreshChatList();
  }

  /* ---------------- chat history ---------------- */

  toggleHistory(force) {
    const open = force === undefined ? !this.historyOpen : force;
    this.historyOpen = open;
    this.historyPopover.classList.toggle('hidden', !open);
    this.historyBtn.classList.toggle('active', open);
    if (open) this.refreshChatList();
  }

  async refreshChatList() {
    if (window.aiAPI?.listConversations) {
      try {
        const r = await window.aiAPI.listConversations();
        this.chatList = r?.chats || [];
      } catch (_) { this.chatList = []; }
    }
    this.renderChatList();
  }

  renderChatList() {
    if (!this.historyList) return;
    if (!this.chatList.length) {
      this.historyList.innerHTML = '<p class="ai-history-empty">No saved chats yet.</p>';
      return;
    }
    this.historyList.innerHTML = this.chatList.map((c) => {
      const meta = PROVIDER_META[c.provider] || {};
      const icon = meta.icon || '';
      const providerLabel = meta.label || c.provider || '';
      const active = c.id === this.currentChatId ? ' active' : '';
      return `
        <div class="ai-history-item${active}" data-chat-id="${escapeHtml(c.id)}">
          ${icon ? `<img class="ai-history-item-icon" src="${icon}" alt="">` : '<span class="ai-history-item-icon-spacer"></span>'}
          <div class="ai-history-item-text">
            <span class="ai-history-item-title">${escapeHtml(c.title || 'Untitled')}</span>
            <span class="ai-history-item-meta">${escapeHtml(providerLabel)}${providerLabel ? ' · ' : ''}${escapeHtml(relativeTime(c.updatedAt))}</span>
          </div>
          <div class="ai-history-item-actions">
            <button class="ai-history-item-act" data-action="rename" title="Rename"><i class="ph ph-pencil-simple"></i></button>
            <button class="ai-history-item-act" data-action="delete" title="Delete"><i class="ph ph-trash"></i></button>
          </div>
        </div>
      `;
    }).join('');
  }

  async handleHistoryClick(e) {
    const item = e.target.closest('.ai-history-item');
    if (!item) return;
    const id = item.dataset.chatId;
    const actBtn = e.target.closest('[data-action]');
    if (actBtn) {
      e.stopPropagation();
      if (actBtn.dataset.action === 'delete') {
        const yes = await showConfirm('Delete chat?', 'This conversation will be deleted permanently.', {
          variant: 'warning', confirmLabel: 'Delete', danger: true,
        });
        if (yes) await this.deleteChat(id);
      } else if (actBtn.dataset.action === 'rename') {
        this.renameChatInline(item, id);
      }
      return;
    }
    // Anywhere else on the row: open the chat.
    this.toggleHistory(false);
    this.loadChat(id);
  }

  renameChatInline(itemEl, id) {
    const titleEl = itemEl.querySelector('.ai-history-item-title');
    if (!titleEl) return;
    const oldTitle = titleEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ai-history-item-rename';
    input.value = oldTitle;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const finish = async (commit) => {
      const newTitle = input.value.trim() || oldTitle;
      const span = document.createElement('span');
      span.className = 'ai-history-item-title';
      span.textContent = newTitle;
      if (input.parentNode) input.replaceWith(span);
      if (commit && newTitle !== oldTitle) {
        try { await window.aiAPI.renameConversation(id, newTitle); }
        catch (_) { /* the list refresh below will reveal a failure */ }
        if (id === this.currentChatId) this.currentChatTitle = newTitle;
        this.refreshChatList();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async deleteChat(id) {
    try { await window.aiAPI.deleteConversation(id); }
    catch (_) { /* refresh below will reveal a failure */ }
    if (id === this.currentChatId) {
      // The visible chat was deleted — reset to a fresh state.
      this.currentChatId = null;
      this.currentChatTitle = '';
      this.currentChatCreatedAt = 0;
      this.messages = [];
      this.messagesEl.innerHTML = '';
      if (this.chatEmptyHint) {
        this.messagesEl.appendChild(this.chatEmptyHint);
        this.chatEmptyHint.classList.remove('hidden');
      }
      this.cumulativeTokens = 0;
      this.updateTokenCounter();
    }
    this.refreshChatList();
  }

  async loadChat(id) {
    if (this.currentSessionId) return;        // never switch mid-stream
    if (id === this.currentChatId) return;
    await this.persistCurrentChat();

    let chat;
    try { chat = await window.aiAPI.readConversation(id); }
    catch (_) { chat = null; }
    if (!chat) return;

    this.currentChatId = chat.id;
    this.currentChatTitle = chat.title || 'Untitled';
    this.currentChatCreatedAt = chat.createdAt || Date.now();
    this.messages = Array.isArray(chat.messages) ? chat.messages.slice() : [];
    this.cumulativeTokens = Number(chat.cumulativeTokens) || 0;
    this.updateTokenCounter();

    // Switch provider if the saved chat used a different one (and it's
    // still available). Falls back silently if not.
    if (chat.provider && chat.provider !== this.currentProvider) {
      if (this.providersConfigured && this.providersConfigured[chat.provider]) {
        this.currentProvider = chat.provider;
        this.applyProviderState();
        const radio = this.mpProviders.querySelector(`input[name="ai-provider"][value="${chat.provider}"]`);
        if (radio) radio.checked = true;
      }
    }

    // Replay every message into the bubble stream.
    this.messagesEl.innerHTML = '';
    if (this.chatEmptyHint) this.messagesEl.appendChild(this.chatEmptyHint);
    if (this.chatEmptyHint) this.chatEmptyHint.classList.toggle('hidden', this.messages.length > 0);
    for (const msg of this.messages) {
      if (!msg || !msg.role) continue;
      if (msg.role === 'tool') {
        this.appendStaticToolChip(msg.toolName, msg.status, msg.error, msg.args, msg.result);
      } else if (typeof msg.content === 'string') {
        this.appendBubble(msg.role, msg.content);
      }
    }
    highlightCodeBlocks(this.messagesEl);
    this.refreshChatList();
  }

  async persistCurrentChat() {
    if (!this.currentChatId || !this.messages.length || !window.aiAPI?.saveConversation) return;
    const providerInfo = (this.providersAvailable || []).find((p) => p.name === this.currentProvider);
    try {
      await window.aiAPI.saveConversation({
        id: this.currentChatId,
        title: this.currentChatTitle || 'Untitled',
        provider: this.currentProvider,
        model: providerInfo ? providerInfo.model : null,
        createdAt: this.currentChatCreatedAt || Date.now(),
        messages: this.messages.map((m) => {
            const entry = { role: m.role };
            if (m.role === 'tool') {
              // Persist the full tool-call breadcrumb — toolName, status,
              // args, result, error, toolUseId — so a re-opened chat
              // shows every call exactly as it happened (success AND
              // failure). The chip tooltip is rebuilt from these fields
              // by appendStaticToolChip on replay.
              entry.toolName  = m.toolName;
              entry.status    = m.status;
              if (m.toolUseId) entry.toolUseId = m.toolUseId;
              if (m.args != null)   entry.args   = m.args;
              if (m.result != null) entry.result = m.result;
              if (m.error)          entry.error  = m.error;
            } else {
              entry.content = m.content;
            }
            return entry;
          }),
        cumulativeTokens: this.cumulativeTokens,
      });
    } catch (e) { console.warn('[ai-panel] persist failed:', e); }
    this.refreshChatList();
  }

  /* ---------------- resize ---------------- */

  setupResize(handle, container) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      let active = true;
      let raf = null;
      const startX = e.clientX;
      const startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);

      document.body.classList.add('resizing-vertical');

      const onMove = (ev) => {
        if (!active) return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const newWidth = Math.max(
            320,
            Math.min(startWidth + (startX - ev.clientX), window.innerWidth * 0.7),
          );
          container.style.width = newWidth + 'px';
        });
      };

      const onUp = () => {
        active = false;
        document.body.classList.remove('resizing-vertical');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (raf) cancelAnimationFrame(raf);
        try {
          const w = parseInt(container.style.width, 10);
          if (w >= 320) localStorage.setItem('aurora-ai-panel-width', String(w));
        } catch (_) { /* ignore */ }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}

const aiAssistantManager = new AIAssistantManager();
export { aiAssistantManager };
