// chat_render.js — Aurora Intelligence chat text rendering (extracted from
// ai_assistant_manager.js, A2 god-file decomposition). The full text→HTML
// pipeline, all pure/DOM-only (no instance state, no electronAPI/TabManager):
//   • zero-dep syntax highlighter for fenced code blocks,
//   • HTML escape + LaTeX→Unicode math (optional KaTeX) + inline Markdown,
//   • block Markdown (headings/lists/quotes/GFM tables),
//   • file-reference linkification (core.v, my_proc.cmm:25 → clickable spans).
// The class drives it as a pipeline: renderMarkdown → highlightCodeBlocks →
// linkifyFileRefs. Exports only the entry points the class calls.

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
export function highlightCodeBlocks(containerEl) {
  if (!containerEl) return;
  containerEl.querySelectorAll('.ai-code-block code:not([data-hl])').forEach(el => {
    el.innerHTML = _highlightCode(el.textContent);
    el.dataset.hl = '1';
  });
}

/* ============================================================
 *  Markdown rendering (small, dependency-free)
 * ========================================================== */

export function escapeHtml(s) {
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
  const raw = String(src || '');

  // Prefer KaTeX when it's loaded (index.html bundles it locally): a real
  // LaTeX engine renders \underbrace, \text, matrices, nested sub/superscripts,
  // etc. that the Unicode subset below can't. KaTeX is XSS-safe by default
  // (trust:false — no \href/\htmlData), and throwOnError:false renders any
  // unparseable bit in red instead of throwing. Falls back to the subset when
  // KaTeX is absent (e.g. jsdom in unit tests).
  if (typeof window !== 'undefined' && window.katex) {
    try {
      const html = window.katex.renderToString(raw, {
        displayMode: !!display,
        throwOnError: false,
        strict: false,
      });
      return display
        ? `<div class="ai-math ai-math-display">${html}</div>`
        : `<span class="ai-math">${html}</span>`;
    } catch (_) { /* fall through to the Unicode subset */ }
  }

  // SECURITY: the math source is model-controlled and reaches the DOM via
  // innerHTML, so it MUST be escaped before any macro runs. renderInline()
  // stashes the raw `$…$`/`$$…$$` source to keep escapeHtml() from mangling
  // the LaTeX, which means the escaping has to happen HERE. escapeHtml only
  // touches & < > " ' — it leaves \ { } ^ _ intact, so the macros below still
  // match. Without this, `$$<img src=x onerror=…>$$` is an XSS→RCE sink.
  let s = escapeHtml(raw);
  // Text-mode macros (\text, \mathrm, \operatorname, …) render their argument as
  // ordinary text. Strip the macro, keep the content — and do this BEFORE the
  // super/sub pass so a `^{\text{miss}}` no longer leaves nested braces that made
  // the script render literally (the reported bug). Twice handles one nest level.
  const _stripTextMacros = (str) => str.replace(
    /\\(?:text|mathrm|mathbf|mathit|mathsf|mathtt|mathbb|mathcal|operatorname)\s*\{([^{}]*)\}/g,
    '$1');
  s = _stripTextMacros(_stripTextMacros(s));
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
      return `<a href="#" class="ai-link" data-href="${escapeHtml(url)}">${text}</a>`;
    }
    return text;
  });

  // Bare URLs (https://… typed directly, not in [text](url) form) → clickable.
  // Most model replies use bare URLs, so without this they rendered as plain,
  // unclickable, un-highlighted text. The lookbehind skips URLs already inside
  // an attribute (data-href=") or right after a tag's '>' (the visible text of
  // a link just built above), so we never nest or break an existing anchor.
  s = s.replace(/(?<!["'=>])(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g,
    (url) => `<a href="#" class="ai-link" data-href="${url}">${url}</a>`);

  // Bare absolute filesystem paths (C:\… or \\server\…) → clickable. The string
  // is already escaped, and paths don't contain & < > " so the escaped form
  // equals the raw path. Backtick-wrapped paths are handled in the code restore.
  s = s.replace(/(^|[\s(>])((?:[A-Za-z]:\\|\\\\)[^\s<>"]*[^\s<>".,;:)\]])/g,
    (_m, lead, p) => `${lead}<span class="ai-path" data-path="${p}" title="Open">${p}</span>`);

  const codeRe = new RegExp(`${CODE_SENTINEL_OPEN}(\\d+)${CODE_SENTINEL_CLOSE}`, 'g');
  s = s.replace(codeRe, (_, i) => {
    const c = codes[+i];
    // A backtick span that is purely an absolute path is clickable too.
    if (/^(?:[A-Za-z]:\\|\\\\)[^\s<>"]+$/.test(c.trim())) {
      const p = escapeHtml(c.trim());
      return `<code class="ai-path" data-path="${p}" title="Open">${escapeHtml(c)}</code>`;
    }
    return `<code>${escapeHtml(c)}</code>`;
  });
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

// When an absolute filesystem path in chat is clicked and points at a FILE, we
// open it inside Monaco if its extension is text/code; everything else (images,
// video, audio, pdf, archives, …) is handed to the OS default app instead.
const AI_TEXT_OPENABLE = new Set([
  ...AI_KNOWN_EXTS,
  'log', 'conf', 'config', 'env', 'lst', 'rpt', 'out', 'err', 'diff', 'patch',
  'do', 'ucf', 'lds', 'map', 'make', 'in', 'toml', 'properties', 'gitignore',
]);
export function aiPathIsText(p) {
  const m = String(p).match(/\.([A-Za-z0-9]{1,12})$/);
  return m ? AI_TEXT_OPENABLE.has(m[1].toLowerCase()) : false;
}

// Persisted preference (shared by the link-warning checkbox and the Settings
// toggle): when '1', external links open without the confirmation dialog.
export const TRUST_LINKS_KEY = 'aurora-ai-trust-external-links';

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
export function linkifyFileRefs(root) {
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

export function renderMarkdown(md) {
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
