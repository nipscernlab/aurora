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
import { showCardNotification } from './notification.js';
import { constrainTerminalHeight } from '../utils/resize.js';
import { TabManager } from '../tabs/tab_manager.js';

const PROVIDER_META = {
  // Subscription-backed: runs through the Claude Code / Claude Agent SDK,
  // billed against the user's Pro/MAX plan — no per-token API key.
  'claude-code': {
    label: 'Claude Code', icon: './assets/icons/ai_claude.svg',
    subscription: true, tagline: 'Pro / MAX plan — no API key',
  },
  // Subscription-backed: runs through the OpenAI Codex CLI, billed
  // against the user's ChatGPT plan — no per-token API key.
  'chatgpt': {
    label: 'ChatGPT', icon: './assets/icons/ai_codex.svg',
    subscription: true, tagline: 'ChatGPT plan — no API key',
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

// Synthetic provider entry for ChatGPT (Codex CLI) — like Claude Code it
// is subscription-authed, so the backend `listProviders()` never returns
// it and the panel injects it.
const CHATGPT_PROVIDER = { name: 'chatgpt', model: 'default', defaultModel: 'default' };

// Codex model presets surfaced as a segmented control. We only expose
// `default` — explicit `-m gpt-5-codex` and `-m gpt-5` both fail on a
// ChatGPT subscription with:
//   "The '<model>' model is not supported when using Codex with a
//    ChatGPT account."
// "default" omits `-m` entirely and lets the CLI pick whatever the
// signed-in plan is entitled to (Plus / Pro / Business / Edu / Enterprise).
const CHATGPT_MODELS = [
  { id: 'default', label: 'Default' },
];

// Per-subscription-provider specifics. The panel's subscription UI
// (status row, usage bars, model presets) is driven entirely off this
// table so Claude Code and ChatGPT share one code path.
const SUB_META = {
  'claude-code': {
    models: CLAUDE_CODE_MODELS,
    hasEffort: true,
    statusApi: 'getClaudeCodeStatus',
    usageApi: 'getClaudeCodeUsage',
    modelStoreKey: 'aurora-ai-claude-code-model',
    cliName: 'Claude Code',
    notInstalled: 'Claude Code not installed',
    installHint: 'Reinstall Aurora, or run: npm i -g @anthropic-ai/claude-code',
    loginCmd: 'claude login',
  },
  'chatgpt': {
    models: CHATGPT_MODELS,
    hasEffort: false,
    statusApi: 'getCodexStatus',
    usageApi: 'getCodexUsage',
    modelStoreKey: 'aurora-ai-chatgpt-model',
    cliName: 'Codex',
    notInstalled: 'Codex CLI not installed',
    installHint: 'Reinstall Aurora, or run: npm i -g @openai/codex',
    loginCmd: 'codex login',
  },
};

/** True when `name` is a subscription-backed CLI provider. */
function isSubProvider(name) {
  return !!SUB_META[name];
}

// Anti-freeze watchdog: if a streaming turn goes this long with NO chat event
// AND nothing pending (no in-flight tool, no open ask/confirm card), it's
// treated as wedged and the UI self-heals back to idle. Generous so a slow
// model or a long single tool never trips it falsely.
const STREAM_STALL_MS = 180000;

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
  "You are AURORA INTELLIGENCE — the AI assistant built into the AURORA IDE (always feminine, " +
  "\"a AURORA\"), developed by the NIPSCERN laboratory (Núcleo de Instrumentação e Processamento " +
  "de Sinais — CERN). NIPSCERN operates from two sites: the Swiss site at Route Salam, Meyrin GE " +
  "1217 (CERN campus), and the Brazilian site (NIPS) at the PPEE building — Programa de Pós-Graduação " +
  "em Engenharia Elétrica, UFJF (Universidade Federal de Juiz de Fora). Public website: nipscern.com. " +
  "The group designs custom signal-processing processors for scientific instrumentation, working on " +
  "the ATLAS experiment at the LHC (CERN) — NEVER LHCb. Team Leader and ATLAS coordinator: " +
  "Prof. Dr. Luciano Manhães de Andrade Filho. The AURORA IDE and the surrounding infrastructure " +
  "for the SAPHO processor (Scalable Architecture for Hardware Optimization) were built by the " +
  "undergraduate Chrysthofer Arthur Amaro Afonso (UFJF) in partnership with Prof. Luciano. " +
  "Be concise and precise. Use Markdown. Use fenced ```cmm blocks for CMM snippets, ```verilog for " +
  "Verilog/VHDL snippets, and $...$ / $$...$$ for LaTeX math. When you point the user to a spot in a " +
  "project file, write the reference in backticks as `filename.ext:line` (e.g. `my_proc.cmm:25` or " +
  "`core.v:42`), or a bare `filename.ext` — optionally a project-relative path like `src/core.v` — for " +
  "the whole file. The IDE turns it into a clickable link that opens that file at that line. " +
  "ALWAYS reply in the same language " +
  "the user writes in (Portuguese or English).",

  // ── SAPHO Ecosystem ───────────────────────────────────────────────────────
  "\n\nSAPHO ECOSYSTEM — Scalable Architecture for Hardware Optimization:\n" +
  "  • YANC  — Yet Another Compiler (v5.0+, cross-platform: Linux + Windows). A multi-stage\n" +
  "      toolchain in C + Flex + Bison — THREE compilers, two preprocessors, and helpers:\n" +
  "      - cmmcomp: C± source (.cmm) → SAPHO Assembly (.asm)\n" +
  "      - cppcomp: C++ source (.cpp) → SAPHO Assembly (.asm)   (runs after cpppp)\n" +
  "      - asmcomp: Assembly (.asm) → synthesizable Verilog (.v) + memory images (.mif) + testbench (_tb.v)\n" +
  "      - cpppp:   C++ preprocessor for cppcomp (#include / #define / #if / #pragma once)\n" +
  "      - appcomp: first pass over the .asm — records processor params + resolves variable/\n" +
  "                 label addresses BEFORE asmcomp runs\n" +
  "      - gen_gtkw / comp2gtkw: build the formatted GTKWave save view (.gtkw) from a VCD header\n" +
  "  • AURORA — Windows IDE (Electron): editor, compiler UI, file tree, Aurora Intelligence (you).\n" +
  "  • POLARIS — Cross-platform IDE (Tauri + Rust): successor to AURORA, also uses YANC.\n" +
  "  • PRISM  — RTL viewer: visualises the processor datapath from the generated Verilog.\n" +
  "  • Simulators — Icarus Verilog (iverilog + vvp, DEFAULT; keeps every internal SAPHO signal) OR\n" +
  "      Verilator (--binary --timing, 5–10× faster, needs +define+YANC_TRACE; only top-level user\n" +
  "      signals — stack/ULA debug taps are fenced out). Both emit a .vcd/.fst trace for GTKWave.\n" +
  "  • GTKWave — waveform viewer (nipscernlab build): reads the .vcd/.fst dump.\n" +
  "Full pipelines (Aurora drives them via the compile_* tools — you NEVER call the binaries yourself):\n" +
  "  C±:  .cmm → cmmcomp ───────────┐\n" +
  "  C++: .cpp → cpppp → cppcomp ───┴→ .asm → appcomp → asmcomp → .v (+.mif +_tb.v) → iverilog | verilator → .vcd/.fst → GTKWave / PRISM",

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

  "\nCOMPILE-TIME MACROS (cmmcomp, handled in the lexer — NO separate preprocessor):\n" +
  "  #define NAME body   — object-like macro only. A later use of NAME is replaced by re-lexing\n" +
  "                        body, e.g. `#define LIMIT 256` lets you write `LIMIT` anywhere the\n" +
  "                        literal would go. Nested defines expand; a self-referential define\n" +
  "                        expands once. NO function-like macros, NO #ifdef, NO #include in C±\n" +
  "                        (those exist only in the C++ front-end, via the cpppp preprocessor).\n" +

  "\nCONTROL FLOW:\n" +
  "  while (cond) { ... }          — top-tested loop\n" +
  "  do { ... } while (cond);      — bottom-tested loop; the body always runs at least once\n" +
  "  for (init; cond; step) { ... }— C-style counted loop; `continue` still runs `step`\n" +
  "  break;                        — exits the innermost loop OR switch\n" +
  "  continue;                     — jumps to the next iteration of the innermost LOOP (a switch does NOT catch it; continue inside a switch binds to the enclosing loop). In a for loop the step still runs.\n" +
  "  if (cond) { ... }\n" +
  "  if (cond) { ... } else { ... }\n" +
  "  switch (exp) { case N: ... break; default: ... }  — real C fall-through (a case with no break falls into the next); switches may nest, each break binds to its own switch\n" +
  "  return exp;  /  return;       — function return\n" +
  "  #PRACA                        — marks the interrupt resume point (reset on itr pin)\n" +
  "  #TOAQUI                       — marks an address the hardware compares against (cheguei pin pulses when PC reaches it)\n" +

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

  "\nSTANDARD LIBRARY:\n" +
  "  I/O:\n" +
  "    in(port)         — reads integer from input port N\n" +
  "    fin(port)        — reads float from input port N\n" +
  "    out(port, val)   — writes integer val to output port N\n" +
  "    fout(port, val)  — writes float val to output port N\n" +
  "    out(port, c|vec⟩) — outputs vector vec scaled by c to port (Dirac)\n" +
  "  Math:\n" +
  "    sqrt(x)          — square root → float; also sqrt(z) on a comp = principal complex root\n" +
  "    atan(x)          — arctangent → float\n" +
  "    sin(x)           — sine → float\n" +
  "    cos(x)           — cosine → float\n" +
  "    tan(x)           — tangent → float (dedicated minimax macro, not sin/cos)\n" +
  "    exp(x)           — e^x (natural exponential) → float\n" +
  "    log(x)           — natural logarithm ln(x) → float (guarded: x ≤ 0 returns 0)\n" +
  "    pow(x, y)        — x^y → float. Integer-literal y → exact square-and-multiply; fractional/float y → exp(y·ln x), so needs x > 0\n" +
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

  "\nKNOWN LANGUAGE RESTRICTIONS (document in comments when relevant):\n" +
  "  • No +=, -=, *= — use x = x + y;\n" +
  "  • No exponent literals (1e-6) — write 0.000001\n" +
  "  • Arrays cannot be function parameters — use global arrays\n" +
  "  • No dynamic allocation — all sizes must be compile-time constants\n" +

  "\n\n══════════════════════════════════════════════════════════════\n" +
  "SAPHO HARD CONSTRAINTS — ABSOLUTE RULES (violations FAIL the build)\n" +
  "══════════════════════════════════════════════════════════════\n" +
  "These are NOT style preferences — yanc rejects the build if any of these is broken.\n" +
  "When creating, renaming, or editing .cmm files always validate ALL of these BEFORE\n" +
  "calling create_file / write tools. If unsure, call get_project_tree + read_file first.\n" +

  "\n1. PRNAME MUST EXACTLY MATCH THE FILE BASENAME.\n" +
  "   The processor name in `#PRNAME <name>` must equal the .cmm filename minus the\n" +
  "   .cmm extension (case-sensitive, no path).\n" +
  "     ✓ file `Sqrt.cmm` → `#PRNAME Sqrt`\n" +
  "     ✗ file `Sqrt.cmm` → `#PRNAME sqrt`  (case mismatch)\n" +
  "     ✗ file `MyProc.cmm` → `#PRNAME Proc`  (different name)\n" +
  "   When renaming a .cmm file: update BOTH the filename AND the #PRNAME directive.\n" +

  "\n2. EVERY .cmm FILE MUST DECLARE THE FULL DIRECTIVE BLOCK.\n" +
  "   All NINE core directives are mandatory and must appear at the top of every .cmm\n" +
  "   file BEFORE any code:\n" +
  "     #PRNAME, #NUBITS, #NBMANT, #NBEXPO, #NDSTAC, #SDEPTH, #NUIOIN, #NUIOOU, #NUGAIN\n" +
  "   (`#FFTSIZ` is OPTIONAL — required only for FFT processors.)\n" +
  "   Missing even one of the nine directives = build error.\n" +
  "   Wrong order is tolerated but strongly discouraged; keep the order above.\n" +

  "\n3. NUBITS = NBMANT + NBEXPO + 1   (strict equality; the +1 is the sign bit)\n" +
  "   Always recompute and validate this equation before suggesting a config change.\n" +

  "\n4. NUGAIN MUST BE A POWER OF 2: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, …\n" +
  "   norm() divides by NUGAIN via a shift; non-power-of-2 values are rejected.\n" +

  "\n5. A PROJECT MUST DECLARE A TOPLEVEL AND A TESTBENCH BEFORE COMPILATION.\n" +
  "   The synthesizable Top Level (.v) and the Testbench Top (.v) are NOT optional.\n" +
  "   Compile / wave / PRISM steps all assume they exist. Workflow:\n" +
  "     create_file (.v)  →  set_top_level  →  set_testbench_top  →  compile_*\n" +
  "   If list_processors / list_wave_signals indicates none is set, STOP and ask the\n" +
  "   user (or set them yourself if it is unambiguous which file is which).\n" +

  "\n6. RESERVED PATHS — NEVER write here; yanc overwrites them on every compile:\n" +
  "     <proc>/Hardware/<proc>.v      (asmcomp synthesizable output)\n" +
  "     <proc>/Simulation/<proc>_tb.v (auto-generated testbench)\n" +
  "     <proc>/Software/<proc>.asm    (assembly from CMM)\n" +
  "   Place user-written .v files at the project root with UNIQUE names\n" +
  "   (e.g. `sqrt_newton_top.v`, `sqrt_newton_test.v`) — never inside Hardware/ or\n" +
  "   Simulation/ subfolders of an existing processor.\n" +

  "\n7. THE TESTBENCH MUST MATCH THE COMPILED PROCESSOR.\n" +
  "   If the active testbench Top belongs to a DIFFERENT processor than the one being\n" +
  "   compiled, wave signals will be meaningless. Verify with list_processors before\n" +
  "   running compile_step({step:'wave'}).\n" +

  "\n8. WAVE CONFIG REQUIRES SIGNALS SELECTED.\n" +
  "   compile_step({step:'wave'}) without selected wave signals dumps nothing useful.\n" +
  "   Pipeline: list_wave_signals → select_wave_signals → compile_step({step:'wave'}).\n" +
  "   If list_wave_signals returns empty, the testbench Top is not set — ask the user\n" +
  "   to right-click the correct .v and choose 'Set as Testbench Top'.\n" +

  "\n9. ARRAY-FROM-FILE PATHS ARE RELATIVE TO THE .cmm FILE.\n" +
  "   `float lut[152] \"Seno_LUT.txt\";` looks up Seno_LUT.txt next to the .cmm,\n" +
  "   NOT at the project root. When creating new LUT-backed arrays, place the .txt\n" +
  "   file alongside the .cmm.\n" +

  "\n10. NEVER DELETE GENERATED FOLDERS DIRECTLY.\n" +
  "    Hardware/, Simulation/, Software/ are recreated by yanc — but the .spf and\n" +
  "    other user state lives at the project root. To remove a processor use\n" +
  "    AuroraAPI.processors.delete (when available) or ask the user.\n" +

  "\nGENERAL HEURISTIC: when uncertain about constraints (e.g. is this filename ok? does\n" +
  "this NUGAIN work?), call list_processors / get_project_tree / read_file FIRST to\n" +
  "ground in current truth, then act. Do NOT guess a processor's existing header.\n",

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

  // ── C++ Front-End (cppcomp) ───────────────────────────────────────────────
  "\n\nC++ FRONT-END (.cpp → cpppp → cppcomp) — an ALTERNATIVE source language to C±.\n" +
  "Same SAPHO target, same I/O builtins (in/fin/out/fout), same .asm → asmcomp → .v pipeline —\n" +
  "but a MUCH richer surface than C±: real `for` loops, `class`/struct, virtual methods +\n" +
  "polymorphism, `new`/`delete`, references, `sizeof`, and a subset of the STL via bundled\n" +
  "header shims (array, vector, bit, cmath, cstddef, cstdint, cstring, limits).\n" +
  "Processor params come from PRAGMAS, not #-directives — record them near the top of the .cpp:\n" +
  "  #pragma yanc prname <name>     (REQUIRED; should match the .cpp basename, like #PRNAME does for .cmm)\n" +
  "  #pragma yanc nubits|nbmant|nbexpo|nugain|ndstac|sdepth|nuioin|nuioou|fftsiz|itradd <n>\n" +
  "Width-parametric: with NO pragmas a .cpp defaults to 32-bit / IEEE-754 single float. cpppp does\n" +
  "full C-style preprocessing (#include / #define / #if / #pragma once) — unlike C±'s lone #define.\n" +
  "GUIDANCE: prefer C± (.cmm) for DSP / fixed-point / Dirac-notation work (its sweet spot); use\n" +
  "C++ (.cpp) when the user explicitly asks for C++ or needs OO / STL / general control flow.\n",

  // ── SAPHO Assembly (ISA) ──────────────────────────────────────────────────
  "\n\nSAPHO ASSEMBLY (.asm) — ISA + OPTIMISATION WORKFLOW\n" +
  "═══════════════════════════════════════════════════════\n" +
  "yanc emits a stack-machine assembly with one accumulator (acc), a data stack,\n" +
  "a subroutine stack, named memory variables, and labels (prefixed `@`). The\n" +
  "canonical .asm starts with NOP + the directive block from the .cmm, then a\n" +
  "linear stream of instructions, one per line, optionally prefixed by `@label`\n" +
  "tokens. Multiple labels can decorate the same line (e.g. `@main @L1 LOD 1`).\n" +
  "\nThe ISA has 112 opcodes grouped into families. Use list_opcodes for the\n" +
  "full table; the families below are the only ones you need to plan an\n" +
  "optimisation:\n" +
  "  • memory    — LOD/SET (acc↔mem), LDI/STI (indirect), ILI/ISI (bit-rev for FFT), LEA\n" +
  "  • stack     — PSH (push acc), POP\n" +
  "  • arith_int — ADD/MLT/DIV/MOD/NEG/ABS/PST/SGN (acc OP mem)\n" +
  "  • arith_float — F_ADD/F_MLT/F_DIV/F_NEG/F_ABS/F_PST/F_SGN, plus F_SU1/F_SU2 (subtraction)\n" +
  "  • arith_norm — NRM (acc /= NUGAIN, shift-based)\n" +
  "  • conversion — I2F (int→float), F2I (float→int)\n" +
  "  • bitwise   — AND/ORR/XOR/INV\n" +
  "  • logical   — LAN/LOR/LIN (short-circuit boolean over acc)\n" +
  "  • compare   — LES/GRE/EQU (and F_LES/F_GRE for float)\n" +
  "  • shift     — SHL/SHR (logical), SRS (arithmetic right shift)\n" +
  "  • control   — JMP, JIZ (jump-if-zero), CAL (subroutine), RET\n" +
  "  • io        — INN/F_INN (input port), OUT (output port)\n" +
  "  • indirect  — LDA (acc = mem[acc]), STA (mem[top of stack] = acc)\n" +
  "  • special   — NOP, F_ROT (nearest power-of-2 sqrt)\n" +
  "\nPREFIX/SUFFIX CONVENTIONS — every base opcode has up to 6 variants:\n" +
  "  F_<X>    floating-point version of X         (e.g. F_ADD = float ADD)\n" +
  "  S_<X>    operand from data stack, not memory (e.g. S_ADD = ADD with stack)\n" +
  "  SF_<X>   stack + floating                    (e.g. SF_MLT)\n" +
  "  P_<X>    PUSH acc, then run X                (saves an explicit PSH)\n" +
  "  PF_<X>   PUSH + floating variant\n" +
  "  <X>_M    memory-operand variant of an acc-only op (NEG_M, ABS_M, ...)\n" +
  "  <X>_V    constant-offset addressing (LOD_V var,N → acc = mem[&var + N])\n" +
  "Combining P_ with _M (e.g. P_NEG_M, P_ABS_M, P_INV_M, P_NRM_M) collapses a\n" +
  "PSH + op-on-memory pair into a single instruction. **First optimisation move**:\n" +
  "look for PSH + <op>_M patterns and replace with P_<op>_M.\n" +
  "\nOTHER COMMON SHRINK PATTERNS:\n" +
  "  PSH + LOD <v> + ADD <w> + SET <z>   →  LOD <v> + ADD <w> + SET <z>   (no PSH needed if acc not reused)\n" +
  "  LOD <v> + F_ADD <w>                  →  F_ADD_V is NOT an alias — F_ADD <w> already takes mem\n" +
  "  PSH + LOD <v>                        →  P_LOD <v>\n" +
  "  PSH + SET <v>                        →  no equivalent — SET pops naturally; use SET_P (SET + POP)\n" +
  "  back-jump loops with constant trip-count → unroll if NDSTAC allows (counter is just a SET/ADD pair)\n" +
  "\nOPTIMISATION WORKFLOW (the only safe way to shrink an .asm):\n" +
  "  1. analyze_asm({processorName: \"<p>\"})    — find total + the hottest loop\n" +
  "  2. read_file(\"<p>/Software/<p>.asm\")        — read the current canonical .asm\n" +
  "  3. (reason: identify P_<op>_M / SET_P opportunities, dead PSH/POP, unrolling)\n" +
  "  4. create_file(\"<p>/Software/_aurora_opt/<p>.asm\", content: <rewritten asm>)\n" +
  "     — SAME basename so the tooling matches it; sandbox folder so the canonical\n" +
  "       .asm is untouched.\n" +
  "  5. set_command_override({                 — redirect the next asm step's -i\n" +
  "       step: \"asm\",\n" +
  "       processorName: \"<p>\",\n" +
  "       removeArgs:  [\"-i\", \"<root>/<p>/Software/<p>.asm\"],\n" +
  "       appendArgs:  [\"-i\", \"<root>/<p>/Software/_aurora_opt/<p>.asm\"] })\n" +
  "     Verify with preview_compile_command before setting if unsure.\n" +
  "  6. compile_step(\"asm\")                    — asmcomp + iverilog -tnull. Does\n" +
  "     NOT regenerate the .asm from .cmm, so the sandbox version is consumed.\n" +
  "     Confirms the optimised .asm produces a valid Verilog module.\n" +
  "  7. analyze_asm({filePath: \"<root>/<p>/Software/_aurora_opt/<p>.asm\"})\n" +
  "     — measure delta vs. step 1. Report savings in the summary.\n" +
  "  8. If valid AND smaller: ask the user whether to promote the .asm to\n" +
  "     <p>/Software/<p>.asm (rename_file) or keep it sandboxed.\n" +
  "     If broken or unchanged: clear_command_override({step:\"asm\", processorName:\"<p>\"}).\n" +
  "\nNEVER call compile_step(\"cmm\"|\"verilog\"|\"wave\"|\"prism\") on a processor whose\n" +
  ".asm has been hand-optimised before you've promoted it — cmmcomp regenerates\n" +
  "the canonical .asm from the .cmm and your optimisation is lost. The `asm` step\n" +
  "is the ONLY step that bypasses cmmcomp.\n" +
  "\nCMM-LEVEL OPTIMISATIONS that reduce .asm size (do these first when possible):\n" +
  "  • Hoist invariants out of `while` loops (CMM has no for-loop, so every loop\n" +
  "    is a while — invariants are expensive to repeat).\n" +
  "  • Replace `x = x + y` chains with shift-register Dirac notation when applicable.\n" +
  "  • Use `norm()` instead of `/ N` when N is a power-of-2 (norm = single NRM).\n" +
  "  • Cache repeated array accesses in scalars (`tmp = arr[i]` once, then reuse).\n" +
  "  • Pre-compute lookup-table values (`float lut[N] \"file.txt\"`).\n",

  // ── SAPHO Simulation ──────────────────────────────────────────────────────
  "\n\nSIMULATION PARAMETERS — stored per-processor in the project's .spf file:\n" +
  "  clk (MHz)     clock frequency (default 100 MHz)\n" +
  "  numClocks     clock cycles to simulate (default 2000)\n" +
  "  simTime_us    = numClocks / clk  (e.g. 2000 / 100 = 20 µs)\n" +
  "Always call list_processors to read the actual clk / numClocks / simTime_us and the full\n" +
  "parsed header (header.NUBITS, header.NBMANT, etc.) before suggesting parameter changes.\n" +
  "SIMULATOR CHOICE — the Wave step runs either Icarus Verilog or Verilator (read/switch with the\n" +
  "get_simulator / set_simulator tools, or the toolbar simulator toggle):\n" +
  "  iverilog  (default) — preserves EVERY internal SAPHO signal; slower on long testbenches.\n" +
  "  verilator           — 5–10× faster, but only top-level user signals survive (the ULA rounding\n" +
  "                        taps and stack-monitor flags are intentionally omitted for speed).\n" +
  "Pick iverilog when the user needs deep internal visibility; verilator for long/fast runs.\n" +
  "VERILATOR-ONLY SIMULATIONS (headless, no GTKWave — fastest dev loop):\n" +
  "  run_fast_sim         runs the project testbench headless under Verilator (no waveform). Needs a\n" +
  "                       testbench set; a Verilog tb requires set_simulator('verilator'), a .py cocotb\n" +
  "                       tb runs on any engine. Read results with get_terminal_output('twave').\n" +
  "  run_verilator_proc   runs the ACTIVE processor's generated <proc>.v under Verilator as a hardware\n" +
  "                       test (decimal input_<N>.txt / output_<N>.txt). Needs an active processor.\n" +
  "                       Read results with get_terminal_output('thtest').\n" +
  "  Both are slow on long runs — prefer run_in_background({task:'compile_step', step:'verilator-fast'|'verilator-proc'}).\n",

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
  "     for confirmation on every step. Only ask when genuinely ambiguous.\n" +
  "  6. LONG-RUNNING WORK — for a slow compile or simulation that the user shouldn't have to\n" +
  "     wait on, call `run_in_background({task:'compile_all'|'compile_step', step, note})`. It\n" +
  "     returns immediately; tell the user you've started it and will report back, then END your\n" +
  "     turn. Aurora runs it under the hood and AUTOMATICALLY re-invokes you with the result as a\n" +
  "     fresh turn — at which point you read the terminals and report the outcome. Do NOT block\n" +
  "     the chat waiting; that is exactly what run_in_background is for.\n",

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

// Extra PUA sentinels for math stashing — same trick as the code one
// above, just a different code-point pair so they never collide.
const MATH_SENTINEL_OPEN  = '';
const MATH_SENTINEL_CLOSE = '';

// LaTeX → Unicode maps used by _renderMath(). Pragmatic subset that
// covers the bulk of what AI assistants emit; the rest passes through.
const _GREEK_MAP = {
  alpha:'α', beta:'β', gamma:'γ', delta:'δ', epsilon:'ε', zeta:'ζ',
  eta:'η', theta:'θ', iota:'ι', kappa:'κ', lambda:'λ', mu:'μ', nu:'ν',
  xi:'ξ', omicron:'ο', pi:'π', rho:'ρ', sigma:'σ', tau:'τ', upsilon:'υ',
  phi:'φ', chi:'χ', psi:'ψ', omega:'ω', varphi:'φ', vartheta:'ϑ',
  Alpha:'Α', Beta:'Β', Gamma:'Γ', Delta:'Δ', Epsilon:'Ε', Zeta:'Ζ',
  Eta:'Η', Theta:'Θ', Iota:'Ι', Kappa:'Κ', Lambda:'Λ', Mu:'Μ', Nu:'Ν',
  Xi:'Ξ', Omicron:'Ο', Pi:'Π', Rho:'Ρ', Sigma:'Σ', Tau:'Τ', Upsilon:'Υ',
  Phi:'Φ', Chi:'Χ', Psi:'Ψ', Omega:'Ω',
};
const _OP_MAP = {
  cdot:'·', times:'×', div:'÷', pm:'±', mp:'∓', leq:'≤', geq:'≥',
  neq:'≠', approx:'≈', equiv:'≡', sim:'∼', propto:'∝', infty:'∞',
  partial:'∂', nabla:'∇', sum:'∑', prod:'∏', int:'∫', oint:'∮',
  forall:'∀', exists:'∃', in:'∈', notin:'∉', subset:'⊂', supset:'⊃',
  cap:'∩', cup:'∪', emptyset:'∅', rightarrow:'→', leftarrow:'←',
  Rightarrow:'⇒', Leftarrow:'⇐', leftrightarrow:'↔', to:'→', mapsto:'↦',
  ldots:'…', cdots:'⋯', dots:'…', langle:'⟨', rangle:'⟩', hbar:'ℏ',
  ell:'ℓ', Re:'ℜ', Im:'ℑ',
};

/**
 * Render a LaTeX math expression as styled HTML. We support a subset
 * (super/sub-scripts, \frac, \sqrt, Greek, common operators) that
 * covers the bulk of what AI chat assistants actually emit, without
 * pulling in a 300kB MathJax/KaTeX bundle. Anything unrecognised falls
 * through as styled text so the user still reads something.
 */
function _renderMath(src, display) {
  // SECURITY: the math source is model-controlled and reaches the DOM via
  // innerHTML, so it MUST be escaped before any macro runs. renderInline()
  // stashes the raw `$…$`/`$$…$$` source to keep escapeHtml() from mangling
  // the LaTeX, which means the escaping has to happen HERE. escapeHtml only
  // touches & < > " ' — it leaves \ { } ^ _ intact, so the macros below still
  // match. Without this, `$$<img src=x onerror=…>$$` is an XSS→RCE sink.
  let s = escapeHtml(String(src || ''));
  // \frac{a}{b}
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
    '<span class="ai-frac"><span class="num">$1</span><span class="den">$2</span></span>');
  // \sqrt[n]{x}  /  \sqrt{x}
  s = s.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g,
    '<span class="ai-sqrt"><sup>$1</sup>√<span class="rad">$2</span></span>');
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g,
    '<span class="ai-sqrt">√<span class="rad">$1</span></span>');
  // \name → Greek letter / operator
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => {
    if (_GREEK_MAP[name]) return _GREEK_MAP[name];
    if (_OP_MAP[name]) return _OP_MAP[name];
    return m;
  });
  // Super/sub-scripts
  s = s.replace(/\^\{([^{}]*)\}/g, '<sup>$1</sup>');
  s = s.replace(/_\{([^{}]*)\}/g,  '<sub>$1</sub>');
  s = s.replace(/\^([A-Za-z0-9])/g, '<sup>$1</sup>');
  s = s.replace(/_([A-Za-z0-9])/g,  '<sub>$1</sub>');
  // Spacing macros
  s = s.replace(/\\,|\\;|\\:|\\!/g, ' ');
  return display
    ? `<div class="ai-math ai-math-display">${s}</div>`
    : `<span class="ai-math">${s}</span>`;
}

function renderInline(s) {
  // 1. Stash inline code first so bold/italic/math regexes never run
  //    inside it (`a*b*c` inside a backtick must stay literal).
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `${CODE_SENTINEL_OPEN}${codes.length - 1}${CODE_SENTINEL_CLOSE}`;
  });

  // 2. Stash math: $$…$$ display first, then $…$ inline. Stashing keeps
  //    escapeHtml() from mangling the LaTeX source. Inline math has to
  //    sidestep plain "$10" / "R$ 5" by requiring at least one math token.
  const maths = [];
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    maths.push({ expr, display: true });
    return `${MATH_SENTINEL_OPEN}${maths.length - 1}${MATH_SENTINEL_CLOSE}`;
  });
  s = s.replace(/(^|[^$\w])\$([^$\n]+?)\$(?!\d)/g, (m, lead, expr) => {
    if (!/[\\^_={}]/.test(expr)) return m;
    maths.push({ expr, display: false });
    return `${lead}${MATH_SENTINEL_OPEN}${maths.length - 1}${MATH_SENTINEL_CLOSE}`;
  });

  s = escapeHtml(s);

  s = s.replace(/\*\*([^\n*][^\n]*?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<!\*)\*([^\n*]+?)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/~~([^\n~]+?)~~/g, '<del>$1</del>');
  // ==highlight== → soft <mark> so the model can underline a term.
  s = s.replace(/==([^\n=]+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//i.test(url)) {
      return `<a href="#" data-href="${escapeHtml(url)}">${text}</a>`;
    }
    return text;
  });
  const codeRe = new RegExp(`${CODE_SENTINEL_OPEN}(\\d+)${CODE_SENTINEL_CLOSE}`, 'g');
  s = s.replace(codeRe, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  const mathRe = new RegExp(`${MATH_SENTINEL_OPEN}(\\d+)${MATH_SENTINEL_CLOSE}`, 'g');
  s = s.replace(mathRe, (_, i) => {
    const m = maths[+i];
    return _renderMath(m.expr, m.display);
  });
  return s;
}

// Extensions we recognise in *prose* (un-backticked) references, so a bare
// `core.v` or `sim.vcd` mid-sentence still linkifies without turning English
// ("etc.", "i.e.") or method chains (`obj.value`) into links. Backticked refs
// and any path- or `:line`-bearing form bypass this list, so ANY extension a
// project file actually uses still works.
const AI_KNOWN_EXTS = new Set([
  'cmm', 'asm', 's', 'v', 'sv', 'vh', 'svh', 'vhd', 'vhdl',
  'py', 'c', 'h', 'cpp', 'hpp', 'cc', 'rs', 'go', 'java',
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'json', 'md', 'txt',
  'spf', 'vcd', 'gtkw', 'gtkwave', 'mem', 'hex', 'bin', 'do',
  'cfg', 'ini', 'yaml', 'yml', 'xml', 'csv', 'tcl', 'sdc', 'xdc',
  'sh', 'bat', 'ps1', 'mk', 'cmake',
]);

// A standalone file token: optional drive (C:\) / ./ ../ root, any project
// path segments, a basename with a dot-extension, and an optional :line.
// Anchored — used to decide whether an inline `code` span is *entirely* a
// file reference. The `:` in a `C:\` drive prefix is never the line colon.
const AI_FILE_TOKEN_RE =
  /^(?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z0-9]{1,12}(?::\d+)?$/;
// Scans running prose for basename-style references (paths arrive backticked
// and are handled as code spans, so this stays separator-free and tame).
const AI_FILE_SCAN_RE =
  /\b[A-Za-z0-9][\w-]*(?:\.[\w-]+)*\.[A-Za-z0-9]{1,12}(?::\d+)?\b/g;
const AI_FILE_SKIP_TAGS = new Set(['PRE', 'A', 'SCRIPT', 'STYLE', 'BUTTON']);

/** Split `path/file.ext:42` into { file, line }. A trailing `:<digits>` is the
 *  line number; a `C:\` drive colon (not followed by digits) is left alone. */
function splitFileRef(token) {
  const m = /:(\d+)$/.exec(token);
  return m
    ? { file: token.slice(0, m.index), line: parseInt(m[1], 10) }
    : { file: token, line: null };
}

/** True when `token` is a clickable file reference. A path- or `:line`-bearing
 *  token passes with ANY extension; a bare basename must carry a known
 *  extension so ordinary prose isn't linkified. */
function isFileRefToken(token) {
  if (!AI_FILE_TOKEN_RE.test(token)) return false;
  const { file, line } = splitFileRef(token);
  if (/[\\/]/.test(file) || line != null) return true;
  const ext = (/\.([A-Za-z0-9]{1,12})$/.exec(file) || [])[1];
  return !!ext && AI_KNOWN_EXTS.has(ext.toLowerCase());
}

/** Build the clickable `.ai-file-ref` span for a file-reference `token`. */
function makeFileRefSpan(token) {
  const { file, line } = splitFileRef(token);
  const span = document.createElement('span');
  span.className = 'ai-file-ref';
  span.dataset.file = file;
  if (line != null) span.dataset.line = String(line);
  span.textContent = token;
  span.title = (window.t && window.t('notification.ai.openInEditor')) || 'Open in editor';
  return span;
}

/**
 * Turn project-file references in a rendered message — `core.v`,
 * `my_proc.cmm:25`, `src/alu.sv:88` — into clickable `.ai-file-ref` spans.
 * Two passes: (1) inline `code` spans that are *entirely* a reference (the
 * form the model is told to emit), and (2) bare references in running prose.
 * Runs on the FINAL (committed / static) message DOM, never per streaming
 * frame; fenced snippets (`pre`), links and existing refs are left untouched.
 */
function linkifyFileRefs(root) {
  if (!root) return;

  // Pass 1 — inline `code` spans like `my_proc.cmm:25` (skip fenced blocks
  // and any code carrying child markup, e.g. syntax-highlighted snippets).
  root.querySelectorAll('code').forEach((codeEl) => {
    if (codeEl.closest('pre') || codeEl.querySelector('*')) return;
    const token = codeEl.textContent;
    if (!isFileRefToken(token)) return;
    codeEl.replaceWith(makeFileRefSpan(token));
  });

  // Pass 2 — bare references in prose text nodes.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      for (let p = node.parentNode; p && p !== root; p = p.parentNode) {
        if (p.nodeType === 1 &&
            (AI_FILE_SKIP_TAGS.has(p.tagName) || p.tagName === 'CODE' ||
             p.classList.contains('ai-file-ref'))) {
          return NodeFilter.FILTER_REJECT;
        }
      }
      AI_FILE_SCAN_RE.lastIndex = 0;
      return AI_FILE_SCAN_RE.test(node.nodeValue)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n);
  for (const textNode of targets) {
    const text = textNode.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    AI_FILE_SCAN_RE.lastIndex = 0;
    while ((m = AI_FILE_SCAN_RE.exec(text))) {
      const token = m[0];
      if (!isFileRefToken(token)) continue;   // prose that only looks file-ish
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      frag.appendChild(makeFileRefSpan(token));
      last = m.index + token.length;
    }
    if (last === 0) continue;                 // nothing survived the filter
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

/** Parse a single GFM-style table row. Strips the leading/trailing pipe. */
function _splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|'))   s = s.slice(0, -1);
  // Pipes inside backticks shouldn't split the row.
  const cells = [];
  let cur = '', inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '`') inCode = !inCode;
    if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];
  // Lists are tracked as a stack so nested lists work. Each entry:
  // { type: 'ul' | 'ol', indent: leading-space count }.
  const listStack = [];
  let paraLines = [];
  // Blockquote / callout state. callout: { tag: 'note'|'tip'|'warn'|'danger', title }
  let quoteLines = [];
  let quoteCallout = null;

  const flushPara = () => {
    if (paraLines.length) {
      out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
      paraLines = [];
    }
  };
  const closeListsTo = (indent) => {
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) {
      out.push(`</${listStack.pop().type}>`);
    }
  };
  const closeAllLists = () => closeListsTo(-1);

  const flushQuote = () => {
    if (!quoteLines.length && !quoteCallout) return;
    const inner = renderMarkdown(quoteLines.join('\n'));
    if (quoteCallout) {
      const { tag, title } = quoteCallout;
      out.push(
        `<div class="ai-callout ai-callout-${tag}">` +
        `<div class="ai-callout-head"><i class="ph ${({
          note: 'ph-info', tip: 'ph-lightbulb',
          warn: 'ph-warning', danger: 'ph-x-octagon',
        })[tag] || 'ph-info'}"></i><span>${escapeHtml(title || tag.toUpperCase())}</span></div>` +
        `<div class="ai-callout-body">${inner}</div></div>`,
      );
    } else {
      out.push(`<blockquote>${inner}</blockquote>`);
    }
    quoteLines = [];
    quoteCallout = null;
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

  // Table state — keeps two-row lookahead via index loop instead of for-of
  // so we can peek at lines[i+1] to detect the separator row.
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fence: starts/ends a verbatim block.
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      if (inCode) { flushCode(); inCode = false; }
      else { flushPara(); flushQuote(); closeAllLists(); inCode = true; codeLang = fence[1] || ''; }
      i++; continue;
    }
    if (inCode) { codeLines.push(line); i++; continue; }

    // Horizontal rule: --- *** ___
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushPara(); flushQuote(); closeAllLists();
      out.push('<hr class="ai-hr">');
      i++; continue;
    }

    // Headings (#, ##, …, ######)
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flushPara(); flushQuote(); closeAllLists();
      const level = head[1].length;
      out.push(`<h${level}>${renderInline(head[2])}</h${level}>`);
      i++; continue;
    }

    // GFM table — current line is a header row and next line is the
    // separator (|---|---|). We commit the whole table at once.
    if (line.includes('|') && i + 1 < lines.length
        && /^\s*\|?\s*:?-{2,}.*\|/.test(lines[i + 1])
        && /^[\s|:-]+$/.test(lines[i + 1])) {
      flushPara(); flushQuote(); closeAllLists();
      const headers = _splitTableRow(line);
      const sepCells = _splitTableRow(lines[i + 1]);
      const aligns = sepCells.map((c) => {
        const L = /^:/.test(c), R = /:$/.test(c);
        return L && R ? 'center' : R ? 'right' : L ? 'left' : '';
      });
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
        rows.push(_splitTableRow(lines[j]));
        j++;
      }
      const thead = `<thead><tr>${
        headers.map((h, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderInline(h)}</th>`).join('')
      }</tr></thead>`;
      const tbody = `<tbody>${
        rows.map((r) => `<tr>${
          r.map((c, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${renderInline(c)}</td>`).join('')
        }</tr>`).join('')
      }</tbody>`;
      out.push(`<div class="ai-table-wrap"><table class="ai-table">${thead}${tbody}</table></div>`);
      i = j; continue;
    }

    // Blockquote / callout
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara(); closeAllLists();
      const body = quote[1];
      // GFM callout: "> [!NOTE] optional title"
      const callout = !quoteLines.length && body.match(/^\[!(NOTE|TIP|WARN(?:ING)?|DANGER|IMPORTANT|CAUTION)\]\s*(.*)$/i);
      if (callout && !quoteCallout) {
        const raw = callout[1].toLowerCase();
        const tag = raw.startsWith('warn') || raw === 'caution' ? 'warn'
          : raw === 'danger' || raw === 'important' ? 'danger'
          : raw === 'tip' ? 'tip' : 'note';
        quoteCallout = { tag, title: callout[2].trim() || raw.toUpperCase() };
      } else {
        quoteLines.push(body);
      }
      i++; continue;
    } else if (quoteLines.length || quoteCallout) {
      flushQuote();
    }

    // Lists — track leading-space indent so nested lists nest properly.
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      flushPara();
      const indent = (ulMatch ? ulMatch[1] : olMatch[1]).length;
      const type = ulMatch ? 'ul' : 'ol';
      const text = ulMatch ? ulMatch[2] : olMatch[3];

      // Close lists deeper than current indent.
      while (listStack.length && listStack[listStack.length - 1].indent > indent) {
        out.push(`</${listStack.pop().type}>`);
      }
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        listStack.push({ type, indent });
        out.push(`<${type}>`);
      } else if (top.indent === indent && top.type !== type) {
        out.push(`</${listStack.pop().type}>`);
        listStack.push({ type, indent });
        out.push(`<${type}>`);
      }
      // Render checkbox lists (- [ ] / - [x]) as styled items.
      const cb = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (cb) {
        const checked = cb[1].toLowerCase() === 'x';
        out.push(`<li class="ai-task${checked ? ' done' : ''}">` +
          `<i class="ph ${checked ? 'ph-check-square-fill' : 'ph-square'}"></i>` +
          `<span>${renderInline(cb[2])}</span></li>`);
      } else {
        out.push(`<li>${renderInline(text)}</li>`);
      }
      i++; continue;
    }

    if (!line.trim()) { flushPara(); closeAllLists(); i++; continue; }

    closeAllLists();
    paraLines.push(line);
    i++;
  }

  if (inCode) flushCode();         // unclosed fence during streaming
  flushQuote();
  flushPara();
  closeAllLists();
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
    this._lastMsgRole = null;               // role of the last appended bubble (label de-dup)
    this.cumulativeTokens = 0;

    this.unsubChatEvent = null;

    // Tool permission gate.
    this.permissionMode = readPermissionMode();
    this.modelPopoverOpen = false;
    this.pendingConfirms = new Set();   // resolve fns of open confirmation cards

    // Subscription-provider (Claude Code / ChatGPT) state — keyed by
    // provider name so both CLIs share the same panel machinery.
    this.subStatus = {};                // provider → { installed, authed, … }
    this.subUsage = {};                 // provider → usage snapshot
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

    // Smart auto-scroll: true while the viewport is glued to the bottom.
    // The user scrolling up flips this to false (frees them to read
    // earlier messages); scrolling back to the bottom flips it on again.
    // Every appendDelta / appendBubble / tool chip respects this flag —
    // we only push the viewport when the user is already at the bottom.
    this.stickToBottom = true;
  }

  /** Distance in px the viewport may sit above the bottom and still count as "at the bottom". */
  get _bottomThresholdPx() { return 32; }

  _isAtBottom() {
    const el = this.messagesEl;
    if (!el) return true;
    return (el.scrollHeight - el.clientHeight - el.scrollTop) <= this._bottomThresholdPx;
  }

  /**
   * Scroll to the bottom IF the user hasn't scrolled away. Called from
   * every place that previously did `messagesEl.scrollTop = scrollHeight`
   * unconditionally. When `force` is true (e.g. the user just sent a
   * message) we re-stick regardless of where they were.
   */
  scrollToBottom(force = false) {
    if (!this.messagesEl) return;
    if (force) this.stickToBottom = true;
    if (this.stickToBottom) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  toggle() {
    if (!this.container) this.initialize();
    const opening = !this.container.classList.contains('open');
    this.container.classList.toggle('open', opening);
    document.body.classList.toggle('ai-assistant-open', opening);
    try { localStorage.setItem('aurora-ai-panel-open', opening ? '1' : '0'); } catch (_) { /* ignore */ }
    // v3 layout: panel is a flex sibling that pushes the editor area.
    // The CSS `width` transition (240ms) drives the open/close anim;
    // we just set the target width here. Read the persisted user
    // width (default 480px) so re-opening lands on the same size.
    this._applyOpenWidth(opening);
    if (opening) {
      this.refreshProviders().then(() => this.inputEl?.focus());
      this.refreshChatList();
    }
  }

  /**
   * Set the inline `width` driving the open/close animation. CSS leaves
   * the closed state at 0; opening sets it to the user's saved width
   * (or 480 default). Single helper so toggle() and the boot-time
   * "panel was open" restore both stay in sync.
   */
  _applyOpenWidth(opening) {
    if (!this.container) return;
    if (!opening) {
      this.container.style.width = '0px';
      return;
    }
    let target = 480;
    try {
      const saved = parseInt(localStorage.getItem('aurora-ai-panel-width'), 10);
      if (saved >= 320) target = saved;
    } catch (_) { /* ignore */ }
    this.container.style.width = target + 'px';
  }

  /** Bring the panel up if it isn't already open (idempotent). */
  ensureOpen() {
    if (!this.container) this.initialize();
    if (!this.container.classList.contains('open')) this.toggle();
  }

  /**
   * Public entry for the Monaco selection "star": open the panel and seed the
   * composer with a snippet the user highlighted, so they can ask the AI about
   * that exact passage. With a concrete `intent` ('explain'|'fix'|'improve'|
   * 'comment'|'doc') and `send:true`, the message is dispatched immediately;
   * otherwise the composer is just pre-filled and focused for the user to type.
   *
   * Reached via window.AuroraAPI.ai.askAboutSelection(...).
   */
  askAboutSelection({ code = '', language = '', filePath = '', lineStart = 0, lineEnd = 0, intent = '', send = false } = {}) {
    const snippet = String(code || '').replace(/\s+$/, '');
    if (!snippet) return;
    this.ensureOpen();
    if (!this.inputEl) return;

    const fileName = filePath ? String(filePath).split(/[\\/]/).pop() : '';
    const lineRef = lineStart && lineEnd
      ? (lineStart === lineEnd ? `line ${lineStart}` : `lines ${lineStart}–${lineEnd}`)
      : '';
    const where = fileName
      ? `\`${fileName}\`${lineRef ? ` (${lineRef})` : ''}`
      : (lineRef || 'the selection');

    const INTENT_LEAD = {
      explain: 'Explain what this code does',
      fix: 'Find and fix any bugs in this code',
      improve: 'Improve and refactor this code',
      comment: 'Add clear, concise comments to this code',
      doc: 'Write documentation for this code',
    };
    const lead = INTENT_LEAD[intent] || '';
    const fence = '```' + (language || '');
    const body = `${lead ? lead + ' ' : ''}from ${where}:\n\n${fence}\n${snippet}\n\`\`\`\n`;

    // Don't clobber a half-typed message the user already has in the composer.
    const existing = this.inputEl.value;
    this.inputEl.value = existing && !send ? `${existing.replace(/\s*$/, '')}\n\n${body}` : body;
    this.autoGrowInput?.();
    this.inputEl.focus();
    if (lead && send && !this._isStreaming) {
      this.send();
    } else if (!lead) {
      // Free-form "Ask…": leave the cursor at the very start so the user types
      // their question above the quoted snippet.
      try { this.inputEl.setSelectionRange(0, 0); } catch (_) { /* not focusable yet */ }
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
        <!-- Ambient aurora, low intensity. The shader concentrates its glow at
             the bottom, so it sits behind the composer rather than the chat
             text, keeping messages readable (DESIGN §7). -->
        <aurora-canvas class="ai-aurora-bg" intensity="0.34" speed="0.6" aria-hidden="true"></aurora-canvas>
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

            <!-- Connection status row — shown for ANY active provider.
                 For Claude Code / ChatGPT it shows CLI install + login + plan;
                 for API providers it shows configured / not configured + model. -->
            <div class="ai-mp-section" id="ai-mp-cc-status"></div>

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

            <!-- "Subscription usage" section removed: the CLIs only report an
                 in-memory, per-run tally that resets each launch, so the bars
                 never reflected real plan limits. Dropped rather than mislead.
                 renderUsage() no-ops without #ai-usage-bars (guarded). -->

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
    // v3: AI panel is a flex sibling of .file-tree-container and
    // .editor-terminal-container inside .main-container, so opening it
    // pushes (not overlays) the editor area. Fallback to body for the
    // edge case where main-container hasn't rendered yet (unlikely —
    // initialize() runs on first toggle, well after DOMContentLoaded).
    const mountTarget = document.querySelector('.main-container') || document.body;
    mountTarget.appendChild(this.container);

    this.providerIcon  = this.container.querySelector('#ai-provider-icon');
    this.messagesEl    = this.container.querySelector('#ai-messages');
    // Delegated: clicking a linkified file reference (`core.v`, `proc.cmm:25`)
    // opens that project file in the editor, jumping to the line when given.
    this.messagesEl?.addEventListener('click', (e) => {
      const ref = e.target.closest?.('.ai-file-ref');
      if (!ref) return;
      e.preventDefault();
      this.openFileRef(ref.dataset.file, ref.dataset.line ? parseInt(ref.dataset.line, 10) : null);
    });
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

    this.buildPermissionOptions();
    this.attachListeners();
    this.setupResize(this.container.querySelector('.ai-resize-handle'), this.container);
    this.setupTerminalCorner();

    // v3 layout: width = 0 means closed, width > 0 means open. CSS
    // initial value is 0; nothing to set here for the closed case.
    // (Persisted width is applied by _applyOpenWidth when opening.)

    // Restore open state — if the panel was open when the user last closed
    // the app, re-open it now so they land right back where they left off.
    try {
      if (localStorage.getItem('aurora-ai-panel-open') === '1') {
        this.container.classList.add('open');
        document.body.classList.add('ai-assistant-open');
        this._applyOpenWidth(true);
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

    // Subscription-provider status section — "Re-check" button.
    this.ccStatusEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-cc-recheck]')) this.refreshSubStatus();
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

    // Smart auto-scroll. We treat the scrollbar as the user's "I'm
    // reading earlier messages" signal: the moment they scroll up from
    // the bottom we stop pinning the viewport so new tokens don't yank
    // them down. Returning to the bottom re-arms the pin.
    // Wheel / touch events scroll the same element so a single scroll
    // listener catches every input modality.
    this.messagesEl.addEventListener('scroll', () => {
      const atBottom = this._isAtBottom();
      if (this.stickToBottom !== atBottom) {
        this.stickToBottom = atBottom;
        this._toggleResumeScrollHint(!atBottom);
      }
    }, { passive: true });
  }

  /**
   * Floating "Jump to latest" pill, shown while the user is reading above
   * the live edge. The element is created once and kept in the DOM; we just
   * toggle `.visible`, so it fades both in and out via CSS (instant
   * `.remove()` used to make it pop out abruptly). Clicking it jumps to the
   * bottom AND hides it immediately — relying on the scroll handler to hide
   * it failed because `scrollToBottom(true)` had already set
   * `stickToBottom = true`, so the handler's `stickToBottom !== atBottom`
   * guard short-circuited and the pill stayed up.
   */
  _toggleResumeScrollHint(show) {
    if (!this.container) return;
    let pill = this.container.querySelector('.ai-scroll-resume');
    if (show) {
      if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'ai-scroll-resume';
        pill.innerHTML = '<i class="ph ph-arrow-down"></i><span>Jump to latest</span>';
        pill.addEventListener('click', () => {
          this.scrollToBottom(true);
          this._toggleResumeScrollHint(false);
        });
        // Anchor inside .ai-assistant-content so it floats above the
        // messages but below the composer.
        this.messagesEl.parentElement.appendChild(pill);
        // Force a reflow so adding `.visible` on the same tick animates.
        void pill.offsetWidth;
      }
      pill.classList.add('visible');
    } else if (pill) {
      pill.classList.remove('visible');
    }
  }

  /* ---------------- model / provider popover ---------------- */

  toggleModelPopover(force) {
    const open = force === undefined ? !this.modelPopoverOpen : force;
    this.modelPopoverOpen = open;
    this.modelPopover.classList.toggle('hidden', !open);
    this.modelChip.classList.toggle('active', open);
    if (open && isSubProvider(this.currentProvider)) this.refreshSubUsage();
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

    // Claude Code and ChatGPT are synthetic, always-available providers
    // (subscription auth — no API key). Their model is persisted locally,
    // not by the backend.
    if (!this.claudeCodeEntry) {
      this.claudeCodeEntry = { ...CLAUDE_CODE_PROVIDER };
      try {
        const saved = localStorage.getItem(SUB_META['claude-code'].modelStoreKey);
        if (saved) this.claudeCodeEntry.model = saved;
      } catch (_) { /* ignore */ }
    }
    if (!this.chatgptEntry) {
      this.chatgptEntry = { ...CHATGPT_PROVIDER };
      try {
        const key = SUB_META['chatgpt'].modelStoreKey;
        const saved = localStorage.getItem(key);
        // Drop any previously-saved id that is no longer a valid preset.
        // Earlier versions offered `gpt-5` and `gpt-5-codex` — both fail
        // on ChatGPT-subscription auth with "model is not supported when
        // using Codex with a ChatGPT account". Falling back to "default"
        // avoids a stream error on the very first turn after the upgrade.
        if (saved && CHATGPT_MODELS.some((m) => m.id === saved)) {
          this.chatgptEntry.model = saved;
        } else if (saved) {
          localStorage.removeItem(key);
          this.chatgptEntry.model = 'default';
        }
      } catch (_) { /* ignore */ }
    }
    this.providersConfigured['claude-code'] = true;
    this.providersConfigured['chatgpt'] = true;

    const apiUsable = providers.filter((p) => this.providersConfigured[p.name]);
    this.providersAvailable = [this.claudeCodeEntry, this.chatgptEntry, ...apiUsable];

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

    // Effort / usage sections stay subscription-only — they have no
    // analog for API providers.
    this.ccSections.forEach((el) => el.classList.toggle('hidden', !isSub));
    // Effort is Claude-Code-only — Codex has no per-turn effort flag.
    const sm = SUB_META[this.currentProvider];
    if (this.effortSection) {
      this.effortSection.classList.toggle('hidden', !(sm && sm.hasEffort));
    }

    this.renderModelControls();
    if (isSub) {
      if (sm && sm.hasEffort) this.renderEffort();
      this.refreshSubStatus();
      this.refreshSubUsage();
    } else {
      // API provider — status row is generated synchronously from the
      // already-loaded providersConfigured map.
      this.renderProviderStatus();
    }
  }

  /** Switch the active provider (from a radio change in the popover). */
  selectProvider(name) {
    if (name === this.currentProvider) return;
    this.currentProvider = name;
    this.applyProviderState();
    this.logModelChange();
    // Choosing an AI is the last thing the user wants from the popover —
    // close it so they land straight back on the composer.
    this.toggleModelPopover(false);
  }

  /**
   * Print a `--- Modelo: <provider> · <model> ---` divider into the
   * messages list. Called whenever the user changes the provider or the
   * model — gives a clear in-chat marker of which model produced which
   * answers, in the style of Claude's VS Code extension.
   */
  logModelChange() {
    const meta = PROVIDER_META[this.currentProvider] || {};
    const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
    const label = meta.label || this.currentProvider || 'Model';
    const model = this._faithfulModelName(entry);
    const el = this.appendDivider(model ? `Modelo: ${label} · ${model}` : `Modelo: ${label}`);
    // Render this marker with a flowing sine wave instead of flat rules.
    el?.classList.add('ai-divider-wave');
  }

  /**
   * The model name to show in the switch marker — faithful to what the
   * user actually picked. For the subscription CLIs that means the chosen
   * preset label (Default / Sonnet / Opus / Haiku); for API providers it's
   * the real model id (lightly shortened), falling back to the provider's
   * default model so the marker is never blank.
   */
  _faithfulModelName(entry) {
    const model = entry?.model || '';
    const sm = SUB_META[this.currentProvider];
    if (sm) {
      const preset = sm.models.find((m) => m.id === (model || 'default'));
      return preset ? preset.label : (model || 'Default');
    }
    if (model && model !== 'default') return shortModelName(model) || model;
    const fallback = entry?.defaultModel && entry.defaultModel !== 'default'
      ? entry.defaultModel : '';
    return fallback ? (shortModelName(fallback) || fallback) : '';
  }

  /** Model picker: free-text input for API providers, presets for the CLIs. */
  renderModelControls() {
    const sm = SUB_META[this.currentProvider];
    this.mpModelApi.classList.toggle('hidden', !!sm);
    this.mpModelPresets.classList.toggle('hidden', !sm);
    if (sm) {
      const entry = this.providersAvailable.find((p) => p.name === this.currentProvider);
      const active = entry?.model || 'default';
      this.mpModelPresets.innerHTML = sm.models.map((m) =>
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
    const before = entry?.model || '';

    const sm = SUB_META[this.currentProvider];
    if (sm) {
      const model = v || 'default';
      if (entry) entry.model = model;
      try { localStorage.setItem(sm.modelStoreKey, model); }
      catch (_) { /* best-effort */ }
      this.renderModelControls();
      this.updateModelChip();
      if (model !== before) this.logModelChange();
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
    if ((entry?.model || '') !== before) this.logModelChange();
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

  /* ---------------- subscription provider: connection status ---------------- */

  /** Probe the active subscription CLI's install + login status. */
  async refreshSubStatus() {
    const provider = this.currentProvider;
    const sm = SUB_META[provider];
    if (!sm) return;
    let status = null;
    try {
      const r = await window.aiAPI?.[sm.statusApi]?.();
      status = r?.status || null;
    } catch (_) { /* treat as not installed */ }
    this.subStatus[provider] = status;
    // The user may have switched providers while the probe was in flight.
    if (this.currentProvider === provider) this.renderSubStatus();
  }

  /**
   * Friendly plan label for the status row. Raw values come straight
   * from the CLI/JWT (`pro`, `max`, `plus`, `business`, `free`, …) — we
   * uppercase them and map the few that have well-known marketing names.
   */
  formatPlanLabel(raw) {
    if (!raw) return '';
    const v = String(raw).toLowerCase().trim();
    const known = {
      'pro':         'PRO',
      'max':         'MAX',
      'plus':        'PLUS',
      'free':        'FREE',
      'team':        'TEAM',
      'business':    'BUSINESS',
      'edu':         'EDU',
      'enterprise':  'ENTERPRISE',
      // Some Claude payloads use `subscriptionType: 'pro_max'` / `claude_max`.
      'pro_max':     'MAX',
      'claude_max':  'MAX',
      'claude_pro':  'PRO',
    };
    return known[v] || v.toUpperCase();
  }

  renderSubStatus() {
    if (!this.ccStatusEl) return;
    const sm = SUB_META[this.currentProvider];
    if (!sm) return;
    const s = this.subStatus[this.currentProvider];
    const meta = PROVIDER_META[this.currentProvider] || {};
    let state = 'off';
    let icon = 'ph-x-circle';
    let title = 'Checking…';
    let detail = '';

    if (!s) {
      title = `Checking ${sm.cliName}…`;
    } else if (!s.installed) {
      state = 'off'; icon = 'ph-x-circle';
      title = sm.notInstalled;
      detail = sm.installHint;
    } else if (!s.authed) {
      state = 'warn'; icon = 'ph-warning-circle';
      title = 'Not signed in';
      detail = `Run <code>${sm.loginCmd}</code> in a terminal, then re-check.`;
    } else {
      state = 'on'; icon = 'ph-check-circle';
      const plan = this.formatPlanLabel(s.plan) || 'SUBSCRIPTION';
      title = `${meta.label || sm.cliName} · ${plan}`;
      detail = s.version || sm.cliName;
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
      ${detail ? `<p class="ai-cc-detail">${escapeHtml(detail)}</p>` : ''}`;
  }

  /**
   * Connection status row for an API (BYOK) provider — OpenAI, Anthropic,
   * Google, DeepSeek, Groq, Ollama. Mirrors renderSubStatus so the user
   * sees a uniform "what am I connected to?" badge regardless of whether
   * the provider is subscription- or key-backed.
   */
  renderProviderStatus() {
    if (!this.ccStatusEl) return;
    const provider = this.currentProvider;
    const meta = PROVIDER_META[provider] || {};
    const entry = this.providersAvailable.find((p) => p.name === provider);
    const configured = !!(this.providersConfigured && this.providersConfigured[provider]);

    let state, icon, title, detail;
    if (configured) {
      state = 'on';
      icon = 'ph-check-circle';
      title = `${meta.label || provider} · Connected`;
      const model = entry?.model || entry?.defaultModel || '';
      detail = model ? `Model: ${model}` : '';
    } else {
      state = 'off';
      icon = 'ph-x-circle';
      title = `${meta.label || provider} · Not configured`;
      detail = 'Add an API key in Settings → AI Assistant.';
    }

    this.ccStatusEl.dataset.state = state;
    this.ccStatusEl.innerHTML = `
      <div class="ai-cc-row">
        <i class="ph ${icon} ai-cc-icon" aria-hidden="true"></i>
        <span class="ai-cc-title">${escapeHtml(title)}</span>
      </div>
      ${detail ? `<p class="ai-cc-detail">${escapeHtml(detail)}</p>` : ''}`;
  }

  /** True when the active subscription CLI is installed and signed in. */
  isSubReady() {
    const s = this.subStatus[this.currentProvider];
    return !!(s && s.installed && s.authed);
  }

  /* ---------------- subscription provider: usage ---------------- */

  async refreshSubUsage() {
    const provider = this.currentProvider;
    const sm = SUB_META[provider];
    if (!sm) return;
    let usage = null;
    try {
      const r = await window.aiAPI?.[sm.usageApi]?.();
      usage = r?.usage || null;
    } catch (_) { /* leave usage null */ }
    this.subUsage[provider] = usage;
    if (this.currentProvider === provider) this.renderUsage();
  }

  renderUsage() {
    if (!this.usageBars) return;
    const u = this.subUsage[this.currentProvider];

    this.usagePlan.textContent = u?.plan ? `${this.formatPlanLabel(u.plan)} plan` : '';

    // Session: the CLI's per-turn usage is the source of truth. We
    // surface exactly what it reported — no synthetic floor — so the
    // counter never drifts from reality. The composer token pill stays
    // in sync because applyUsage() feeds the same numbers back.
    const sessTokens = Number(u?.session?.tokens) || 0;
    const cost = Number(u?.session?.costUsd) || 0;
    const rows = [
      usageRowHTML('This session', 'ph-lightning',
        `${formatTokens(sessTokens)} tokens${cost > 0 ? ` · $${cost.toFixed(2)}` : ''}`,
        'count', 0),
    ];

    // Rate-limit windows (5-hour, weekly, …) reported by the CLI.
    // When the CLI gives us `used` / `limit` (Claude Code does), we plot
    // the real percentage. Otherwise we fall back to a coarse heuristic
    // off `status` so the bar still communicates something useful.
    const windows = Array.isArray(u?.windows) ? u.windows : [];
    for (const w of windows) {
      const meta = WINDOW_META[w.rateLimitType] || { label: w.rateLimitType, icon: 'ph-clock' };
      const used = Number(w.used ?? w.tokensUsed ?? w.consumed);
      const limit = Number(w.limit ?? w.total ?? w.tokensLimit);
      let pct = null;
      if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) {
        pct = Math.max(0, Math.min(100, (used / limit) * 100));
      }
      const sev = (pct != null
        ? (pct >= 90 ? 'high' : pct >= 60 ? 'mid' : 'ok')
        : (w.status === 'rejected' ? 'high'
            : (w.status && w.status !== 'allowed') ? 'mid' : 'ok'));
      const reset = w.resetsAt ? `resets ${untilTime(w.resetsAt)}` : '';
      const usedText = (pct != null)
        ? `${Math.round(pct)}%${reset ? ` · ${reset}` : ''}`
        : (reset || w.status || '');
      rows.push(usageRowHTML(meta.label, meta.icon, usedText, sev,
        pct != null ? pct : (sev === 'high' ? 100 : sev === 'mid' ? 66 : 22)));
    }

    this.usageBars.innerHTML = rows.join('');

    let hint = this.mpUsage.querySelector('.ai-usage-hint');
    if (!windows.length) {
      // Codex's CLI exposes only a session token tally, never rate-limit
      // windows — so the "appears after your first message" copy was wrong
      // there forever. Tell each provider the truth.
      const text = this.currentProvider === 'chatgpt'
        ? 'The Codex CLI reports only this session’s token tally, not ChatGPT plan limits.'
        : 'Plan limits appear here after your first message.';
      if (!hint) {
        hint = document.createElement('p');
        hint.className = 'ai-usage-hint';
        this.mpUsage.appendChild(hint);
      }
      hint.textContent = text;
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
    // Project / processor renames are explicit (the user literally typed
    // "rename to X"), reversible (rename back), and the inline confirm card
    // here was the thing that made them "always time out": a subscription CLI
    // (Codex) hard-times-out an MCP tool call at 120 s and ignores progress
    // pings, so an un-clicked card silently fails the rename even though it
    // then runs ("de repente muda de nome"). Pre-authorize so they fire at
    // once and finish well inside that window.
    if (def && (def.name === 'rename_project' || def.name === 'rename_processor')) {
      return Promise.resolve(true);
    }
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
      this.scrollToBottom();
      requestAnimationFrame(() => card.classList.remove('enter'));
    });
  }

  /**
   * Inline "Ask User Question" card — the AI's way of pausing a turn and
   * asking the human for a decision/clarification. Mirrors Claude
   * Code's `AskUserQuestion` tool: one prompt, an optional list of
   * single- or multi-select options, plus an "Other" text field.
   *
   * Resolves with `{ answer, selected }` once the user submits, or with
   * `null` if the turn is aborted before they answer (see
   * resetTurnState — pendingAskUserQuestions is purged there).
   *
   * @param {object} params
   * @param {string} params.question
   * @param {Array<{label:string, description?:string}>} [params.options]
   * @param {boolean} [params.multiSelect]
   */
  showAskUserQuestionInline({ question, options = [], multiSelect = false } = {}) {
    if (!this.container) this.initialize();
    return new Promise((resolve) => {
      const card = document.createElement('div');
      card.className = 'ai-ask-question enter';
      const inputType = multiSelect ? 'checkbox' : 'radio';
      const safeOptions = Array.isArray(options) ? options : [];
      const optsHtml = safeOptions.map((opt, idx) => {
        const label = escapeHtml(opt.label || `Option ${idx + 1}`);
        const desc  = opt.description ? `<span class="ai-askq-opt-desc">${escapeHtml(opt.description)}</span>` : '';
        return `
          <label class="ai-askq-opt">
            <input type="${inputType}" name="ai-askq-opt" value="${idx}">
            <span class="ai-askq-opt-text">
              <span class="ai-askq-opt-label">${label}</span>${desc}
            </span>
          </label>`;
      }).join('');
      card.innerHTML = `
        <div class="ai-askq-head">
          <i class="ph ph-question" aria-hidden="true"></i>
          <span>Aurora Intelligence is asking</span>
        </div>
        <div class="ai-askq-question"></div>
        <div class="ai-askq-options">${optsHtml}</div>
        <div class="ai-askq-other">
          <label class="ai-askq-other-label">Other / write your own answer</label>
          <textarea class="ai-askq-other-input" rows="2"
                    placeholder="Type a custom answer (optional)"></textarea>
        </div>
        <div class="ai-askq-actions">
          <button type="button" class="ai-askq-cancel">Cancel</button>
          <button type="button" class="ai-askq-submit">Send answer</button>
        </div>
      `;
      card.querySelector('.ai-askq-question').textContent = question;

      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        this.pendingAskUserQuestions?.delete(decide);
        card.classList.add('done');
        setTimeout(() => card.remove(), 180);
        resolve(payload);
      };
      const decide = (val) => finish(val);
      if (!this.pendingAskUserQuestions) this.pendingAskUserQuestions = new Set();
      this.pendingAskUserQuestions.add(decide);

      const submit = () => {
        const otherText = card.querySelector('.ai-askq-other-input').value.trim();
        const checked = Array.from(card.querySelectorAll('input[name="ai-askq-opt"]:checked'))
          .map((el) => safeOptions[Number(el.value)]?.label).filter(Boolean);
        // Resolution: if "Other" text is present we use that as the
        // canonical answer (with the checked labels as supplementary
        // context). Otherwise the selected labels form the answer.
        let answer;
        if (otherText) {
          answer = checked.length
            ? `${otherText} (also selected: ${checked.join(', ')})`
            : otherText;
        } else if (checked.length) {
          answer = multiSelect ? checked.join(', ') : checked[0];
        } else {
          // Nothing selected and nothing typed — keep the card open and
          // flash the textarea so the user knows we need an input.
          card.classList.add('shake');
          setTimeout(() => card.classList.remove('shake'), 320);
          return;
        }
        finish({ answer, selected: checked });
      };

      card.querySelector('.ai-askq-submit').addEventListener('click', submit);
      card.querySelector('.ai-askq-cancel').addEventListener('click', () => {
        finish({ answer: '[user cancelled the question]', selected: [] });
      });
      // Enter inside the textarea (without shift) also submits.
      card.querySelector('.ai-askq-other-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      });

      this.messagesEl.appendChild(card);
      this.scrollToBottom();
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

    // Claude Code / ChatGPT talk to the user's subscription via a local
    // CLI. If it isn't installed / signed in, fail fast with a clear
    // notice (display-only bubble — not persisted) instead of a stream error.
    if (isSubProvider(this.currentProvider)) {
      const sm = SUB_META[this.currentProvider];
      if (!this.subStatus[this.currentProvider]) await this.refreshSubStatus();
      if (!this.isSubReady()) {
        const s = this.subStatus[this.currentProvider];
        this.appendBubble('assistant', !s || !s.installed
          ? `**${sm.notInstalled}.** ${sm.installHint}, then open the model ` +
            'menu and click re-check.'
          : `**${sm.cliName} is not signed in.** Run \`${sm.loginCmd}\` in a ` +
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
    // A real user message breaks any autonomous follow-up chain.
    this._autoChainCount = 0;

    await this._dispatchTurn();
  }

  /**
   * Shared turn dispatcher used by send() (a real user message) and
   * autoContinue() (an autonomous follow-up). The caller pushes its message
   * into this.messages FIRST; this resets the streaming state, (re)subscribes
   * to chat events, opens a session and calls startChat.
   */
  async _dispatchTurn() {
    // Assistant output is built lazily: text segments and tool chips
    // append in arrival order, so a turn reads top-to-bottom even when
    // the model interleaves "explain → call a tool → explain".
    this.turnText = '';
    this.segmentBuffer = '';
    this.currentAssistantContentEl = null;
    this.runningChips = [];
    this._toolGroup = null;
    // New turn → allow exactly one "Aurora Intelligence" label at the top of
    // this turn's first assistant bubble (later segments in the turn collapse).
    this._lastMsgRole = null;
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

    const isSub = isSubProvider(this.currentProvider);
    const subEntry = this.providersAvailable.find((p) => p.name === this.currentProvider);

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
        modelId: isSub ? (subEntry?.model || 'default') : undefined,
        messages: apiMessages,
        system: systemPrompt,
        effort: this.currentProvider === 'claude-code' ? this.claudeCodeEffort : undefined,
        permission: this.permissionMode,
      });
      if (r && r.ok === false) this.failTurn(r.error || 'Failed to start chat');
    } catch (e) {
      this.failTurn(e?.message || String(e));
    }
  }

  /* ---------------- autonomous turns (Phase E) ---------------- */

  /**
   * Start a turn the assistant triggered itself (not the user) — e.g. a
   * background task finished and the model should report back. `content` is
   * the synthetic user message handed to the model; a subtle "↻" note marks
   * the turn in the stream so the user sees why it appeared.
   *
   * If a turn is already streaming, the request is queued and drained when
   * that turn ends (see setStreaming → _drainAutoQueue). A safety cap stops
   * runaway self-chaining.
   */
  autoContinue(content, { label = 'Autonomous follow-up' } = {}) {
    if (!content || !this.currentProvider || !this.currentChatId) return;
    if (!this._autoQueue) this._autoQueue = [];
    this._autoQueue.push({ content, label });
    if (!this._isStreaming) this._drainAutoQueue();
  }

  _drainAutoQueue() {
    if (this._isStreaming) return;                 // wait for the live turn
    if (!this._autoQueue || !this._autoQueue.length) return;
    // Runaway guard: never let the assistant self-chain more than a handful of
    // turns without a human in the loop.
    this._autoChainCount = (this._autoChainCount || 0) + 1;
    if (this._autoChainCount > 5) {
      this._autoQueue = [];
      this.appendBubble('assistant',
        '_Paused autonomous follow-ups (chain limit reached). Send a message to continue._',
        { error: true });
      return;
    }
    const { content, label } = this._autoQueue.shift();
    // Subtle marker bubble (not a normal user message visually).
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const note = document.createElement('div');
    note.className = 'ai-auto-note';
    note.innerHTML = '<i class="ph ph-arrows-clockwise" aria-hidden="true"></i><span></span>';
    note.querySelector('span').textContent = label;
    this.messagesEl.appendChild(note);
    // The synthetic message goes into the model context as a user turn.
    this.messages.push({ role: 'user', content });
    this._dispatchTurn();
  }

  /**
   * Kick off a long task in the background and return immediately, so the
   * current turn can end. When the task finishes, the assistant auto-continues
   * with the result (autoContinue). Backs window.AuroraAPI.ai.runInBackground.
   *
   * @param {{task:'compile_all'|'compile_step', step?:string, note?:string}} p
   * @returns {{ok:boolean, data?:object, error?:string}}
   */
  runInBackground({ task, step, note } = {}) {
    const api = window.AuroraAPI;
    if (!api || !api.compile) return { ok: false, error: 'AuroraAPI.compile unavailable' };
    let job;
    if (task === 'compile_all') job = api.compile.compileAll();
    else if (task === 'compile_step') {
      if (!step) return { ok: false, error: 'compile_step requires a step' };
      job = api.compile.compileStep(step);
    } else {
      return { ok: false, error: `unknown background task: ${task}` };
    }

    const taskId = `bg-${Date.now().toString(36)}`;
    const label = task === 'compile_step' ? `compile ${step}` : 'compile all';
    // Pin the conversation this task belongs to — if the user switches chats
    // before it finishes, we must NOT inject the follow-up into the new one.
    const originChatId = this.currentChatId;
    this._renderBgTask(taskId, `Running ${label} in the background…`, 'running');

    const stillSameChat = () => this.currentChatId === originChatId;

    Promise.resolve(job).then(async (res) => {
      const okJob = !(res && res.ok === false);
      if (!stillSameChat()) return;   // user moved on — drop the auto-continue
      // Pull the compiler terminals for context so the follow-up turn can
      // actually report what happened.
      let terminals = '';
      try {
        const t = await api.terminal?.getAll?.();
        if (t && t.ok && t.data) terminals = JSON.stringify(t.data).slice(0, 4000);
      } catch (_) { /* terminals are best-effort context */ }
      this._renderBgTask(taskId, `${label} ${okJob ? 'finished' : 'failed'}`, okJob ? 'done' : 'failed');
      const status = okJob ? 'completed' : `failed: ${res?.error?.message || res?.error || 'unknown error'}`;
      this.autoContinue(
        `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) ${status}.\n\n` +
        (note ? `Original intent: ${note}\n\n` : '') +
        `Relevant terminal output (truncated):\n${terminals || '(none captured)'}\n\n` +
        `Summarise the outcome for the user concisely, and decide whether any follow-up action is warranted.`,
        { label: `Background task: ${label} ${okJob ? 'finished' : 'failed'}` },
      );
    }).catch((e) => {
      if (!stillSameChat()) return;
      this._renderBgTask(taskId, `${label} errored`, 'failed');
      this.autoContinue(
        `[AUTONOMOUS BACKGROUND TASK] "${label}" (${taskId}) threw: ${e?.message || e}. Report this to the user.`,
        { label: `Background task: ${label} errored` },
      );
    });

    return { ok: true, data: { taskId, status: 'started', task: label } };
  }

  /** Render (or update) the inline status chip for a background task. */
  _renderBgTask(taskId, text, state) {
    let el = this.messagesEl.querySelector(`.ai-bgtask[data-task-id="${taskId}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'ai-bgtask';
      el.dataset.taskId = taskId;
      el.innerHTML = '<i class="ph ai-bgtask-icon" aria-hidden="true"></i><span class="ai-bgtask-text"></span>';
      this.messagesEl.appendChild(el);
    }
    el.classList.remove('running', 'done', 'failed');
    el.classList.add(state);
    const icon = el.querySelector('.ai-bgtask-icon');
    if (icon) icon.className = `ph ai-bgtask-icon ${state === 'done' ? 'ph-check-circle' : state === 'failed' ? 'ph-x-circle' : 'ph-circle-notch ai-tool-spin'}`;
    el.querySelector('.ai-bgtask-text').textContent = text;
    this.scrollToBottom();
  }

  async stop() {
    if (!this.currentSessionId || !window.aiAPI) return;
    const sid = this.currentSessionId;
    try { await window.aiAPI.abortChat(sid); }
    catch (_) { /* the stream side reports back via 'aborted' */ }
    // Safety net: if the backend never delivers a terminal event (a wedged
    // CLI process), force the UI back to idle so the composer is never stuck
    // spinning. Guarded on sid so we don't clobber a turn the user restarted.
    setTimeout(() => {
      if (this._isStreaming && this.currentSessionId === sid) {
        this.showThinking(false);
        this._closeToolGroup();
        this.resetTurnState();
        this.setStreaming(false);
      }
    }, 2000);
  }

  /* ---------------- stream watchdog (anti-freeze) ---------------- */

  _armStreamWatchdog() {
    this._disarmStreamWatchdog();
    this._lastEventAt = Date.now();
    this._streamWatchdog = setInterval(() => {
      if (!this._isStreaming) return;
      // Never reap a turn that is legitimately waiting on a human (an
      // ask-user / confirm card) or on an in-flight tool — those can take
      // minutes by design.
      if (this.runningChips.length) return;
      if (this.pendingAskUserQuestions && this.pendingAskUserQuestions.size) return;
      if (this.pendingConfirms && this.pendingConfirms.size) return;
      if (Date.now() - (this._lastEventAt || 0) > STREAM_STALL_MS) {
        this._recoverFromStall();
      }
    }, 15000);
  }

  _disarmStreamWatchdog() {
    if (this._streamWatchdog) {
      clearInterval(this._streamWatchdog);
      this._streamWatchdog = null;
    }
  }

  /**
   * Self-heal a turn that went silent with nothing pending — the "a conversa
   * trava" symptom. Aborts the backend, drops the spinner, and returns the
   * composer to idle so the user is never stranded. The notice is display-only
   * (not persisted into the model context).
   */
  _recoverFromStall() {
    const sid = this.currentSessionId;
    try { if (sid) window.aiAPI?.abortChat?.(sid); } catch (_) { /* best-effort */ }
    this.showThinking(false);
    this._closeToolGroup();
    this.appendBubble('assistant',
      '_The assistant stopped responding, so the turn was reset. Send another message to continue._',
      { error: true });
    this.resetTurnState();
    this.setStreaming(false);
  }

  handleChatEvent(ev) {
    if (!ev || ev.sessionId !== this.currentSessionId) return;
    // Watchdog liveness: any packet from the active turn proves it's alive.
    this._lastEventAt = Date.now();
    switch (ev.type) {
      case 'text-delta':
        // Do NOT hide the thinking dots here. A delta can be whitespace or a
        // stripped tool-call artifact that produces no bubble yet, so hiding
        // on the first raw delta left a blank gap (dots gone, no text). The
        // dots are retired inside _renderStreamingBubble the instant real
        // text actually lands on screen.
        this.appendDelta(ev.delta || '');
        break;
      case 'tool-call':
        this.showThinking(false);
        this.hadToolCalls = true;
        this.startToolChip(ev.toolName, ev.args, ev.toolUseId);
        // Text after a tool call opens a fresh segment below the chip.
        this.currentAssistantContentEl = null;
        this.segmentBuffer = '';
        this._revealLength = 0;
        break;
      case 'tool-result':
        this.finishToolChip(ev.toolName, ev.result, ev.toolUseId);
        break;
      case 'finish':
        this.showThinking(false);
        this.commitTurn();
        this.applyUsage(ev.usage);
        this.setStreaming(false);
        // Pull the CLI's authoritative usage snapshot at the END of every
        // turn (not just when the model popover happens to be open) so the
        // Subscription usage bars and plan limits reflect reality the next
        // time the user looks — this is what fixes "usage never updates".
        if (isSubProvider(this.currentProvider)) this.refreshSubUsage();
        break;
      case 'aborted':
        this.showThinking(false);
        this.commitTurn();
        this.setStreaming(false);
        if (isSubProvider(this.currentProvider)) this.refreshSubUsage();
        break;
      case 'error':
        this.failTurn(ev.message || 'Unknown error');
        break;
    }
  }

  /* ---------------- streaming text segments ---------------- */

  appendDelta(delta) {
    if (!delta) return;
    // Text resuming after a run of tools closes that batch (tidy summary).
    this._closeToolGroup();
    // The bubble is created LAZILY in _renderStreamingBubble, only once there
    // is something visible to show. A segment that turns out to be just
    // tool-call artefacts or whitespace therefore never leaves an empty
    // "Aurora Intelligence" bar behind. segmentBuffer/_revealLength are reset
    // at segment boundaries (turn start in resetTurnState, and on each
    // tool-call), so here we only accumulate.
    this.segmentBuffer += delta;
    this.turnText += delta;
    // Coalesce every delta that lands in the same animation frame into ONE
    // DOM render. Re-rendering the whole markdown bubble on every token was
    // the source of the choppy stream — dozens of reflows a second, each
    // restarting the fade-reveal on a tiny new chunk. One render per frame
    // makes the reveal continuous and smooth.
    this._scheduleStreamRender();
  }

  /** Queue a streaming re-render on the next frame (idempotent per frame). */
  _scheduleStreamRender() {
    if (this._streamRenderRaf) return;
    this._streamRenderRaf = requestAnimationFrame(() => {
      this._streamRenderRaf = null;
      this._renderStreamingBubble();
    });
  }

  /** Render the accumulated stream buffer with the fade-reveal suffix. */
  _renderStreamingBubble() {
    // Strip tool-call artefacts that some models (Llama/Qwen) emit as inline
    // text. This covers XML blocks, Qwen-style JSON+</tool_call> lines, and
    // orphan closing tags. Only complete patterns are stripped while streaming
    // so partial tags don't permanently corrupt the buffer.
    // These three passes each scan the whole buffer every streaming frame.
    // Skip them when no tool-call marker is present (the common case — Claude
    // and most models never emit these artefacts), so a long well-behaved
    // response doesn't pay three full-buffer regex scans per frame. The result
    // is identical: with no markers the regexes were already no-ops.
    const buf = this.segmentBuffer;
    const mayHaveArtifacts = buf.indexOf('<') !== -1 || buf.indexOf('{"name"') !== -1;
    const displayText = (mayHaveArtifacts
      ? buf
        .replace(/<(?:tool_call|function_calls|invoke)(?:\s[^>]*)?>[\s\S]*?<\/(?:tool_call|function_calls|invoke)>/g, '')
        .replace(/[⺀-鿿]*\s*\{"name"\s*:\s*"[a-z_][a-z_0-9]*"\s*,\s*"arguments"\s*:[\s\S]*?\}\s*\}\s*(?:<\/tool_call>)?/g, '')
        .replace(/<\/tool_call>/g, '')
      : buf
    ).trim();
    // If stripping removes everything and the buffer looks like a tool-call
    // JSON being streamed token-by-token, render empty rather than flashing
    // raw JSON at the user (the tool chip will appear shortly).
    const looksLikeToolArtifact = !displayText &&
      /^\s*[⺀-鿿]*\s*\{/.test(this.segmentBuffer) &&
      /"name"\s*:/.test(this.segmentBuffer);
    // Use the cleaned + trimmed text only. The old `|| this.segmentBuffer`
    // fallback meant a segment that trimmed to empty (whitespace, or a fully
    // stripped tool-call artifact) still rendered the raw buffer — creating an
    // empty assistant bubble whose top/bottom borders showed as a pair of
    // faint hairlines ("várias linhas" between real answers). With displayText
    // alone, such segments yield '' and the block below drops the bubble.
    // Real prose (even containing "<" or "{") always survives in displayText.
    const sourceText = looksLikeToolArtifact ? '' : displayText;

    if (!sourceText) {
      // Nothing visible yet (segment is pure tool-call artifact / whitespace,
      // or it just stripped down to empty as a streamed <tool_call> block
      // completed). Drop any bubble we optimistically created so no empty
      // "Aurora Intelligence" bar is left behind; the tool chip carries the
      // information instead.
      if (this.currentAssistantContentEl) {
        this.currentAssistantContentEl.closest('.ai-message')?.remove();
        this.currentAssistantContentEl = null;
        this._revealLength = 0;
      }
      return;
    }

    // Real text is about to render — retire the "thinking…" dots NOW (not on
    // the first raw delta in handleChatEvent), so the dots stay on screen
    // continuously until the first words appear, with no blank gap between.
    this.showThinking(false);

    // Create the segment bubble lazily — now that there is real text to show.
    if (!this.currentAssistantContentEl) {
      const bubble = this.appendBubble('assistant', '');
      this.currentAssistantContentEl = bubble.querySelector('.ai-msg-content');
    }

    // Fade reveal: re-render the bubble, then wrap any characters that
    // weren't visible last frame in <span.ai-fade-reveal> so they animate
    // from soft purple → normal. We mark the boundary in the source text
    // BEFORE markdown rendering so the span surrounds whole tokens, not
    // partial HTML tags.
    this.currentAssistantContentEl.innerHTML = this._renderWithReveal(sourceText, this._revealLength || 0);
    this._revealLength = sourceText.length;
    this.scrollToBottom();
  }

  /**
   * Render markdown with a fade-reveal span around the suffix that begins
   * at `revealOffset`. The marker is dropped into the source text via a
   * PUA sentinel pair so it survives escapeHtml() and renderMarkdown's
   * paragraph/list splitting; afterwards we swap the sentinels for the
   * real <span class="ai-fade-reveal"> tags.
   */
  _renderWithReveal(text, revealOffset) {
    if (!text) return '';
    if (revealOffset <= 0 || revealOffset >= text.length) return renderMarkdown(text);
    // Use a sentinel that's safe across markdown rules (paragraphs,
    // lists, code-fences …). PUA U+E040/U+E041 stay literal everywhere.
    const OPEN  = 'AI_REVEAL_OPEN';
    const CLOSE = 'AI_REVEAL_CLOSE';
    const head = text.slice(0, revealOffset);
    const tail = text.slice(revealOffset);
    // Don't slice through a code fence — if the head ends inside an open
    // ```, drop the reveal so we don't poison the highlighter. Renders
    // without animation in that case; the next delta re-tries.
    const openFences = (head.match(/```/g) || []).length;
    if (openFences % 2 !== 0) return renderMarkdown(text);
    const marked = `${head}${OPEN}${tail}${CLOSE}`;
    let html = renderMarkdown(marked);
    // The sentinels survived rendering — convert to real spans, and
    // accept stray openings that happen to land inside attributes by
    // simply stripping any unmatched pair.
    html = html.split(OPEN).join('<span class="ai-fade-reveal">');
    html = html.split(CLOSE).join('</span>');
    return html;
  }

  commitTurn() {
    // Collapse the final tool batch so a finished turn reads clean.
    this._closeToolGroup();
    // Flush any frame-batched stream render so the bubble shows the full
    // final text before we highlight code blocks.
    if (this._streamRenderRaf) {
      cancelAnimationFrame(this._streamRenderRaf);
      this._streamRenderRaf = null;
      this._renderStreamingBubble();
    }
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
    if (this.currentAssistantContentEl) {
      highlightCodeBlocks(this.currentAssistantContentEl);
      linkifyFileRefs(this.currentAssistantContentEl);
    }

    // If the model called tools but never generated a text explanation
    // (common with some Ollama models), show a prompt so the user knows
    // the turn is over and can ask a follow-up.
    if (!cleanText && this.hadToolCalls) {
      this.appendBubble('assistant', '_All actions completed. Ask a follow-up if you want details._');
    }

    // Backstop: drop any assistant bubble that ended up with no visible
    // content, so a stray empty segment never lingers as the faint pair of
    // top/bottom-border hairlines between real answers.
    this._pruneEmptyBubbles();

    this.resetTurnState();
    // Auto-save the conversation after every turn.
    this.persistCurrentChat();
  }

  /**
   * Remove assistant bubbles whose content is visually empty (no text and no
   * element children — so image/code-only bubbles are preserved). Defensive
   * cleanup against empty "hairline" bars; the lazy creation in
   * _renderStreamingBubble already avoids creating them in the common case.
   */
  _pruneEmptyBubbles() {
    if (!this.messagesEl) return;
    for (const content of this.messagesEl.querySelectorAll('.ai-msg-assistant .ai-msg-content')) {
      if (!content.firstElementChild && !content.textContent.trim()) {
        content.closest('.ai-message')?.remove();
      }
    }
  }

  failTurn(message) {
    this.showThinking(false);
    this._closeToolGroup();
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
    if (this._streamRenderRaf) {
      cancelAnimationFrame(this._streamRenderRaf);
      this._streamRenderRaf = null;
    }
    this.currentAssistantContentEl = null;
    this.segmentBuffer = '';
    this.turnText = '';
    this._revealLength = 0;
    this.currentSessionId = null;
    this.runningChips = [];
    this._toolGroup = null;
    this.hadToolCalls = false;
    // Auto-deny any confirmation cards still open when the turn ends
    // (e.g. the user hit Stop while a card was waiting).
    for (const decide of this.pendingConfirms) decide(false);
    this.pendingConfirms.clear();
    // Same for any open Ask-User-Question cards — resolve them as
    // cancelled so the awaiting tool call doesn't hang forever.
    if (this.pendingAskUserQuestions) {
      for (const decide of this.pendingAskUserQuestions) {
        decide({ answer: '[turn aborted before user answered]', selected: [] });
      }
      this.pendingAskUserQuestions.clear();
    }
  }

  /* ---------------- tool chips ---------------- */

  /**
   * A run of consecutive tool calls is wrapped in one collapsible group so a
   * busy turn doesn't flood the chat with chips ("poluído de informações").
   * The group is created lazily on the first chip of a batch; a text segment
   * or the turn ending closes it (and collapses multi-step batches to a tidy
   * "N actions" summary the user can expand).
   */
  /**
   * Build a tool-group shell — `{ el, body, summaryEl }` — with the
   * expand/collapse header wired up. Shared by the live group
   * (_ensureToolGroup) and the static group rebuilt when replaying a saved
   * chat, so both render the identical "✓ N actions" collapsible bubble.
   */
  _createToolGroupEl() {
    const el = document.createElement('div');
    el.className = 'ai-tool-group';
    el.innerHTML = `
      <button class="ai-tool-group-head" type="button" aria-expanded="true">
        <i class="ph ph-caret-down ai-tool-group-caret" aria-hidden="true"></i>
        <i class="ph ph-wrench ai-tool-group-icon" aria-hidden="true"></i>
        <span class="ai-tool-group-summary">Working…</span>
      </button>
      <div class="ai-tool-group-body"></div>`;
    const head = el.querySelector('.ai-tool-group-head');
    head.addEventListener('click', () => {
      const collapsed = el.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!collapsed));
    });
    return {
      el,
      body: el.querySelector('.ai-tool-group-body'),
      summaryEl: el.querySelector('.ai-tool-group-summary'),
    };
  }

  _ensureToolGroup() {
    if (this._toolGroup && this._toolGroup.el.isConnected) return this._toolGroup;
    const parts = this._createToolGroupEl();
    this.messagesEl.appendChild(parts.el);
    this._toolGroup = { ...parts, total: 0 };
    return this._toolGroup;
  }

  /** Human-friendly form of a tool name for the group header (chips keep the
   *  raw mono name). "get_terminal_output" → "get terminal output". */
  _prettyToolName(name) {
    return String(name || 'tool').replace(/_/g, ' ');
  }

  /**
   * Live header. While a chip is spinning it names WHAT is running so the
   * user can see the current action at a glance — "Running get terminal
   * output…" (or "Running N actions…" when several run in parallel). Idle →
   * "N actions".
   */
  _refreshToolGroupSummary() {
    const g = this._toolGroup;
    if (!g) return;
    const running = this.runningChips.filter((c) => g.body.contains(c.el));
    if (running.length === 1) {
      g.summaryEl.textContent = `Running ${this._prettyToolName(running[running.length - 1].toolName)}…`;
    } else if (running.length > 1) {
      g.summaryEl.textContent = `Running ${running.length} actions…`;
    } else {
      g.summaryEl.textContent = `${g.total} action${g.total === 1 ? '' : 's'}`;
    }
  }

  /**
   * Finalise the current batch: swap the wrench for a check and collapse the
   * whole sequence into its own bubble — even a single action — so a finished
   * turn reads as a tidy, modern "✓ N actions" pill the user can expand.
   */
  _closeToolGroup() {
    const g = this._toolGroup;
    if (!g) return;
    this._finalizeToolGroup(g.el, g.summaryEl, g.total);
    this._toolGroup = null;
  }

  /**
   * Collapse a finished tool batch into its tidy "N actions" pill: set the
   * summary, pick a green check or a red ✗ depending on whether any chip
   * failed/was denied, and collapse it (even a single action). Shared by the
   * live group (_closeToolGroup) and the static group rebuilt on chat replay
   * so both look identical.
   */
  _finalizeToolGroup(el, summaryEl, total) {
    if (summaryEl) summaryEl.textContent = `${total} action${total === 1 ? '' : 's'}`;
    const failed = el.querySelector(
      '.ai-tool-group-body .ai-tool-chip.failed, .ai-tool-group-body .ai-tool-chip.denied',
    );
    const icon = el.querySelector('.ai-tool-group-icon');
    if (icon) icon.className = `ph ${failed ? 'ph-x-circle' : 'ph-check-circle'} ai-tool-group-icon`;
    el.classList.add('done');
    el.classList.toggle('has-failure', !!failed);
    if (total >= 1) {
      el.classList.add('collapsed');
      el.querySelector('.ai-tool-group-head')?.setAttribute('aria-expanded', 'false');
    }
  }

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
    const group = this._ensureToolGroup();
    group.body.appendChild(chip);
    group.total += 1;
    this.scrollToBottom();
    this.runningChips.push({ toolUseId: toolUseId || null, toolName: name, args, el: chip });
    this._refreshToolGroupSummary();
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
    this._refreshToolGroupSummary();
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
   * Builds a completed tool chip with no animation — used when replaying
   * saved conversations from history. The chip shows the final status
   * (done / failed / denied) and a tooltip with args + result. Returns the
   * element so the caller can drop it into the replay's collapsed group.
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
    return chip;
  }

  /* ---------------- thinking indicator ---------------- */

  showThinking(show) {
    if (show && !this.thinkingEl) {
      const words = [
        'Descombobulating', 'Reticulating splines', 'Calibrating flux',
        'Summoning quarks', 'Consulting the oracle', 'Defragmenting neurons',
        'Reverse-engineering vibes', 'Untangling spaghetti', 'Overclocking brain cells',
        'Pondering the imponderables', 'Aligning the qubits', 'Polishing the silicon',
        'Sweet-talking the compiler', 'Negotiating with yanc', 'Routing the nets',
        'Charging the flux capacitor', 'Counting to NUBITS', 'Folding the bitstream',
        'Tuning the oscillators', 'Herding the electrons', 'Waxing the waveforms',
        'Compiling confidence', 'Synthesizing brilliance', 'Asking the rubber duck',
        'Dividing by NUGAIN', 'Probing the testbench', 'Warming up the ALU',
        'Annealing the lattice', 'Sampling the aurora', 'Buffering inspiration',
        'Convincing the linter', 'Greasing the pipeline',
      ];
      const word = words[Math.floor(Math.random() * words.length)];
      const el = document.createElement('div');
      el.className = 'ai-thinking-wrap';
      // The funny word and the three loading dots share one line; the dots
      // read as the trailing ellipsis (so no literal "…" is appended).
      el.innerHTML =
        `<em class="ai-thinking-word">${word}</em>` +
        '<span class="ai-thinking-dots"><span></span><span></span><span></span></span>';
      this.messagesEl.appendChild(el);
      this.scrollToBottom();
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

  /** Refresh the compact composer token pill and (if open) the usage bars. */
  updateTokenCounter() {
    this.tokenCounter.textContent = formatTokens(this.cumulativeTokens);
    this.tokenCounter.title = `${this.cumulativeTokens.toLocaleString()} tokens this conversation`;
    // Refresh the usage section live for any subscription provider whose
    // popover is open — the per-turn `applyUsage()` may have ticked the
    // CLI-reported session counter forward.
    if (isSubProvider(this.currentProvider) && this.modelPopoverOpen) {
      this.refreshSubUsage();
    }
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
    if (streaming) this._armStreamWatchdog();
    else {
      this._disarmStreamWatchdog();
      // A turn just ended — drain any autonomous follow-up queued while it ran.
      this._drainAutoQueue();
    }
  }

  /* ---------------- bubbles / clear ---------------- */

  appendBubble(role, content, { error = false } = {}) {
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const el = document.createElement('div');
    el.className = `ai-message ai-msg-${role}${error ? ' error' : ''}`;
    const label = role === 'user' ? 'You' : 'Aurora Intelligence';
    // Collapse the role label across a run of consecutive assistant bubbles.
    // A single turn streams as several segments split by tool calls, and a
    // background-task chain adds more — labelling every one produced the wall
    // of repeated "AURORA INTELLIGENCE" headers. Show it once per assistant
    // group; user messages, dividers and background-task chips reset the run
    // (they clear _lastMsgRole) so the label reappears for the next section.
    const showLabel = !(role === 'assistant' && this._lastMsgRole === 'assistant');
    el.innerHTML = `
      ${showLabel ? `<div class="ai-msg-role">${label}</div>` : ''}
      <div class="ai-msg-content"></div>
    `;
    const contentEl = el.querySelector('.ai-msg-content');
    if (role === 'user') {
      // User text is verbatim, not rendered as markdown.
      contentEl.textContent = content;
    } else if (content) {
      contentEl.innerHTML = renderMarkdown(content);
      highlightCodeBlocks(contentEl);
      linkifyFileRefs(contentEl);
    }
    this.messagesEl.appendChild(el);
    this._lastMsgRole = role;
    // The user just sent a message: force-stick to the bottom even if
    // they had been reading scrollback. For an assistant bubble we only
    // follow if they're already at the bottom.
    this.scrollToBottom(role === 'user');
    return el;
  }

  /**
   * Inline log divider — a hairline with centered text, in the style of
   * Claude's VS Code extension when the active model changes. Used for
   * ephemeral, non-conversational notes (model switched, etc.). NOT
   * pushed to `this.messages` so the model never sees them and they
   * don't persist into saved chats.
   */
  appendDivider(text) {
    if (!this.messagesEl) return null;
    if (this.chatEmptyHint) this.chatEmptyHint.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'ai-divider';
    el.setAttribute('role', 'separator');
    const span = document.createElement('span');
    span.className = 'ai-divider-text';
    span.textContent = text;
    el.appendChild(span);
    this.messagesEl.appendChild(el);
    // A divider is a visual section break — let the next assistant bubble
    // re-show its label.
    this._lastMsgRole = null;
    this.scrollToBottom();
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
    this._lastMsgRole = null;
    if (this.chatEmptyHint) {
      this.messagesEl.appendChild(this.chatEmptyHint);
      this.chatEmptyHint.classList.remove('hidden');
    }
    this.cumulativeTokens = 0;
    this.updateTokenCounter();
    this.runningChips = [];
    this._toolGroup = null;
    this._autoQueue = [];
    this._autoChainCount = 0;
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
    // Smoothly animate the deleted card out instead of a full re-render — the
    // History popover stays open the whole time. We drop the row from the
    // in-memory list (and DOM) locally rather than calling refreshChatList(),
    // which would re-fetch and rebuild the whole list (the abrupt snap).
    const cardEl = this.historyList
      ? Array.from(this.historyList.querySelectorAll('.ai-history-item'))
          .find((n) => n.dataset.chatId === id)
      : null;

    const dropFromList = () => {
      this.chatList = (this.chatList || []).filter((c) => c.id !== id);
      if (this.historyList && !this.chatList.length) {
        this.historyList.innerHTML = '<p class="ai-history-empty">No saved chats yet.</p>';
      }
    };

    if (cardEl) this._animateHistoryItemOut(cardEl, dropFromList);
    else dropFromList();

    try { await window.aiAPI.deleteConversation(id); }
    catch (_) { /* the card is already animating out; a later open reveals failure */ }

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
  }

  /**
   * Collapse + fade a history row out, then remove it from the DOM and run
   * `onDone`. Pins an explicit pixel height first so the CSS `height: 0`
   * transition actually animates (you can't transition from `auto`).
   */
  _animateHistoryItemOut(el, onDone) {
    el.style.height = el.offsetHeight + 'px';
    void el.offsetHeight; // commit the start height before collapsing
    el.classList.add('removing');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
      if (typeof onDone === 'function') onDone();
    };
    el.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'height' || e.propertyName === 'opacity') finish();
    });
    setTimeout(finish, 450); // fallback if transitionend never fires
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
    this._lastMsgRole = null;
    if (this.chatEmptyHint) this.messagesEl.appendChild(this.chatEmptyHint);
    if (this.chatEmptyHint) this.chatEmptyHint.classList.toggle('hidden', this.messages.length > 0);
    // Consecutive tool calls are rebuilt into one collapsed "✓ N actions"
    // group, matching the live look so a reopened chat reads the same way.
    let staticGroup = null;
    const closeStaticGroup = () => {
      if (!staticGroup) return;
      this._finalizeToolGroup(staticGroup.el, staticGroup.summaryEl, staticGroup.total);
      staticGroup = null;
    };
    for (const msg of this.messages) {
      if (!msg || !msg.role) continue;
      if (msg.role === 'tool') {
        if (!staticGroup) {
          staticGroup = this._createToolGroupEl();
          staticGroup.total = 0;
          this.messagesEl.appendChild(staticGroup.el);
        }
        staticGroup.body.appendChild(
          this.appendStaticToolChip(msg.toolName, msg.status, msg.error, msg.args, msg.result),
        );
        staticGroup.total += 1;
      } else if (typeof msg.content === 'string') {
        closeStaticGroup();
        this.appendBubble(msg.role, msg.content);
      }
    }
    closeStaticGroup();
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

  /**
   * Corner handle at the junction where the AI panel's LEFT edge meets the
   * terminal's TOP edge — the right-side mirror of the file-tree↔terminal
   * corner in resize.js. Dragging it resizes the AI panel width and the
   * terminal height at once. Only live while the panel is open.
   */
  setupTerminalCorner() {
    const aiContainer = this.container;
    const terminalContainer = document.querySelector('.terminal-container');
    if (!aiContainer || !terminalContainer) return;

    const corner = document.createElement('div');
    corner.id = 'ai-terminal-corner-handle';
    // Generous invisible hit area; visual cue comes from the resizers it sits
    // on. Sits above the width-only handle so the junction grabs both axes.
    Object.assign(corner.style, {
      position: 'fixed', width: '22px', height: '22px',
      background: 'transparent', cursor: 'all-scroll', zIndex: '100',
      display: 'none',
    });
    document.body.appendChild(corner);

    // Hover discovery: lighting up BOTH the AI width handle and the terminal's
    // horizontal resizer is the cue the junction is grabbable — exactly the
    // file-tree↔terminal corner's behaviour (see styles.css / ai_assistant.css).
    corner.addEventListener('mouseenter', () => {
      if (isOpen()) document.body.classList.add('ai-corner-hovering');
    });
    corner.addEventListener('mouseleave', () => {
      document.body.classList.remove('ai-corner-hovering');
    });

    const MIN_AI_W = 320; // matches setupResize / _applyOpenWidth
    const constrainAiWidth = (w) => Math.max(MIN_AI_W, Math.min(w, window.innerWidth * 0.7));
    const isOpen = () => parseInt(aiContainer.style.width, 10) > 0;

    let posRaf = null, lastL = null, lastT = null;
    const position = () => {
      if (!isOpen()) { corner.style.display = 'none'; lastL = lastT = null; return; }
      const aiRect = aiContainer.getBoundingClientRect();
      const termRect = terminalContainer.getBoundingClientRect();
      const half = (corner.offsetWidth || 22) / 2;
      const left = aiRect.left - half;   // AI panel's left edge
      const top  = termRect.top  - half; // terminal's top edge
      if (left === lastL && top === lastT && corner.style.display === 'block') return;
      lastL = left; lastT = top;
      corner.style.left = left + 'px';
      corner.style.top  = top + 'px';
      corner.style.display = 'block';
    };
    const schedulePosition = () => {
      if (posRaf) return;
      posRaf = requestAnimationFrame(() => { posRaf = null; position(); });
    };

    let active = false, startX = 0, startY = 0, startW = 0, startH = 0, dragRaf = null;
    corner.addEventListener('mousedown', (e) => {
      if (!isOpen()) return;
      e.preventDefault();
      active = true;
      startX = e.clientX; startY = e.clientY;
      startW = aiContainer.offsetWidth;
      startH = terminalContainer.offsetHeight;
      // Dedicated class (not the file-tree's resizing-vertical/corner) so the
      // far-left file-tree resizers don't light up when dragging on the right.
      // The CSS for it suspends both panels' transitions, sets the all-scroll
      // cursor, and lights the AI handle + terminal resizer (ai_assistant.css).
      document.body.classList.add('resizing-ai-corner');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    const onMove = (e) => {
      if (!active) return;
      if (dragRaf) cancelAnimationFrame(dragRaf);
      dragRaf = requestAnimationFrame(() => {
        // AI panel is on the right: dragging left (smaller X) grows it.
        const w = constrainAiWidth(startW + (startX - e.clientX));
        const h = constrainTerminalHeight(startH - (e.clientY - startY));
        aiContainer.style.width = w + 'px';
        terminalContainer.style.height = h + 'px';
        position();
      });
    };

    const onUp = () => {
      if (!active) return;
      active = false;
      document.body.classList.remove('resizing-ai-corner');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dragRaf) cancelAnimationFrame(dragRaf);
      try {
        const w = parseInt(aiContainer.style.width, 10);
        if (w >= MIN_AI_W) localStorage.setItem('aurora-ai-panel-width', String(w));
        localStorage.setItem('terminalHeight', String(terminalContainer.offsetHeight));
      } catch (_) { /* storage full / private mode — ignore */ }
    };

    // Keep the handle glued to the junction as either dimension (or the open
    // state) changes. Coalesced to one reflow per frame.
    const obs = new MutationObserver(schedulePosition);
    obs.observe(aiContainer, { attributes: true, attributeFilter: ['style', 'class'] });
    obs.observe(terminalContainer, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', schedulePosition);
    position();
  }

  /* ---------------- clickable file references ---------------- */

  /**
   * Resolve a referenced filename to an absolute path using the project's
   * tracked files (the file tree's verilogFiles: Verilog + Python imports +
   * each processor's .cmm). Matched by basename, case-insensitive. Returns
   * null when the open project has no file by that name.
   */
  _resolveTrackedFile(fileName) {
    if (!fileName) return null;
    const base = String(fileName).split(/[\\/]/).pop().toLowerCase();
    const files = window.projectTreeManager?.verilogFiles;
    if (!Array.isArray(files)) return null;
    const hit = files.find((f) => (f.name || '').toLowerCase() === base);
    return hit ? hit.path : null;
  }

  /**
   * Ordered list of candidate paths to try for a reference, kept inside the
   * project sandbox: a tracked file matched by basename (handles any nesting,
   * plus absolute refs that point back into the tree), then the ref resolved
   * relative to the project root. Absolute paths and `..` segments that would
   * climb out of the project are never resolved as such — existence is checked
   * in openFileRef(), so only files that genuinely live under the project open.
   */
  _fileRefCandidates(ref) {
    const raw = String(ref || '').trim().replace(/^[("'<]+|[)"'>]+$/g, '');
    if (!raw) return [];
    const out = [];
    const push = (p) => { if (p && !out.includes(p)) out.push(p); };

    push(this._resolveTrackedFile(raw));

    const root = window.currentProjectPath;
    const isAbs = /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/');
    if (root && !isAbs) {
      const rel = raw.replace(/\\/g, '/');
      if (!rel.split('/').includes('..')) push(`${root}/${rel}`);
    }
    return out;
  }

  /** Open a referenced project file in the editor, jumping to `line` if given. */
  async openFileRef(fileName, line) {
    const tr = (k, p) => (window.t ? window.t(k, p) : null);
    let filePath = null;
    for (const cand of this._fileRefCandidates(fileName)) {
      try {
        if (await window.electronAPI.fileExists(cand)) { filePath = cand; break; }
      } catch (_) { /* try the next candidate */ }
    }
    if (!filePath) {
      showCardNotification(
        tr('notification.ai.fileNotFound', { name: fileName }) || `File not in project: ${fileName}`,
        'warning', 3000,
      );
      return;
    }
    try {
      const content = await window.electronAPI.readFile(filePath);
      const opts = (Number.isFinite(line) && line > 0)
        ? { revealPosition: { line, column: 1 } }
        : {};
      TabManager.addTab(filePath, content, opts);
    } catch (_e) {
      showCardNotification(
        tr('notification.ai.fileOpenError', { name: fileName }) || `Could not open ${fileName}`,
        'error', 3000,
      );
    }
  }
}

const aiAssistantManager = new AIAssistantManager();
// Expose on window so AuroraAPI (which lives in a sibling module) can
// reach back into the panel to show inline confirm / ask-question
// cards without creating a circular import.
try { window.aiAssistantManager = aiAssistantManager; } catch (_) { /* ignore */ }
export { aiAssistantManager };
