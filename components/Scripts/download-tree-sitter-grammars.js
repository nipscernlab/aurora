// @ts-check
/**
 * Aurora IDE - tree-sitter grammars bootstrap (O7)
 *
 * Baixa as gramaticas tree-sitter (.wasm) usadas pelo highlight semantico
 * do editor e copia o runtime do web-tree-sitter pra um lugar unico
 * (components/Packages/tree-sitter/). O renderer
 * (js/editor/treesitter_highlight.js) carrega esses .wasm por BYTES via IPC
 * (main/treesitter/grammars.js) e gera semantic tokens no Monaco — highlight
 * preciso (nome de modulo, instancia, direcao de porta, tipo, macro…) bem
 * alem do Monarch. Aplica-se a Verilog/SystemVerilog, C e C++ (CMM/ASM nao
 * tem gramatica → seguem no Monarch).
 *
 * Fontes (releases GitHub, asset .wasm avulso):
 *   - SystemVerilog: gmlarumbe/tree-sitter-systemverilog (cobre .v e .sv)
 *   - C:  tree-sitter/tree-sitter-c
 *   - C++: tree-sitter/tree-sitter-cpp
 * web-tree-sitter.wasm (o runtime) vem do pacote npm web-tree-sitter — copiado
 * daqui pra casar exatamente com a versao do JS bundlado (sem skew).
 *
 * Pinning: TAG + EXPECTED_SHA256 por arquivo abaixo. Licencas: MIT
 * (tree-sitter-c/cpp) e a da gmlarumbe; runtime web-tree-sitter MIT.
 *
 * Roda no bootstrap, depois do download-slang-server e antes do
 * copy-components. Best-effort: se falhar, sai com 0 (o editor cai pro
 * highlight Monarch do Monaco, sem erro).
 *
 * Usage:  node components/Scripts/download-tree-sitter-grammars.js [--force]
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { verifyChecksum } = require('./lib/checksum');

// ── Configuration ────────────────────────────────────────────────────────────

const ROOT_DIR    = path.join(__dirname, '..', '..');
const INSTALL_DIR = path.join(ROOT_DIR, 'components', 'Packages', 'tree-sitter');

/** Grammar .wasm artifacts pinned by tag + SHA-256 (immutable per release). */
const GRAMMARS = [
  {
    name: 'tree-sitter-systemverilog.wasm',
    url: 'https://github.com/gmlarumbe/tree-sitter-systemverilog/releases/download/v0.3.1/tree-sitter-systemverilog.wasm',
    sha256: 'b07c23a12884f3bad0043ed77d246a7a3b04da70fc74d9193b67166481487801',
  },
  {
    name: 'tree-sitter-c.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-c/releases/download/v0.24.2/tree-sitter-c.wasm',
    sha256: '83e8d7902b9d7f8c7c5cd4bd9acb5c7eb5faf42c09f85546b183964d3b5f48f9',
  },
  {
    name: 'tree-sitter-cpp.wasm',
    url: 'https://github.com/tree-sitter/tree-sitter-cpp/releases/download/v0.23.4/tree-sitter-cpp.wasm',
    sha256: '174eb0deb75b2ec7881bcacda9f995648d8e683956e5c2267e69ab6dc503fcbf',
  },
];

// The web-tree-sitter runtime ships in the npm package; copy it here so the
// main process reads everything from one folder and the runtime matches the
// bundled JS version exactly.
const RUNTIME_WASM_NAME = 'web-tree-sitter.wasm';
const RUNTIME_WASM_SRC  = path.join(ROOT_DIR, 'node_modules', 'web-tree-sitter', RUNTIME_WASM_NAME);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(/** @type {string} */ msg) { console.log(`[tree-sitter] ${msg}`); }
function err(/** @type {string} */ msg) { console.error(`[tree-sitter] ERROR: ${msg}`); }

function downloadFile(/** @type {string} */ url, /** @type {string} */ dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    function doRequest(/** @type {any} */ requestUrl, redirectCount = 0) {
      if (redirectCount > 5) { reject(new Error('Too many redirects')); return; }
      const u = new URL(requestUrl);
      https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'aurora-ide-treesitter-bootstrap' } }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode || 0)) { doRequest(res.headers.location, redirectCount + 1); res.resume(); return; }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} from ${requestUrl}`)); res.resume(); return; }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        res.on('data', (c) => {
          received += c.length;
          if (total > 0) process.stdout.write(`\r[tree-sitter] ${path.basename(dest)} ${Math.round(received / total * 100)}% (${(received / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB)`);
        });
        res.pipe(file);
        res.on('end', () => process.stdout.write('\n'));
        res.on('error', reject);
      }).on('error', reject);
    }
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    doRequest(url);
  });
}

function rmf(/** @type {string} */ p) { try { fs.rmSync(p, { force: true }); } catch { /* best-effort */ } }

/** Already present AND matching the pinned hash? Then skip re-download. */
async function isValid(/** @type {string} */ dest, /** @type {string} */ sha) {
  if (!fs.existsSync(dest)) return false;
  try {
    const actual = await verifyChecksum(dest, sha, () => {});
    return actual.toLowerCase() === sha.toLowerCase();
  } catch { return false; }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const force = process.argv.includes('--force');
  fs.mkdirSync(INSTALL_DIR, { recursive: true });

  let ok = true;

  for (const g of GRAMMARS) {
    const dest = path.join(INSTALL_DIR, g.name);
    try {
      if (!force && await isValid(dest, g.sha256)) { log(`${g.name} already present (hash ok) — skipping.`); continue; }
      const tmp = dest + '.download';
      rmf(tmp);
      log(`Downloading ${g.name}…`);
      await downloadFile(g.url, tmp);
      await verifyChecksum(tmp, g.sha256, log);
      fs.renameSync(tmp, dest);
      log(`${g.name} installed.`);
    } catch (e) {
      ok = false;
      rmf(dest + '.download');
      err(`${g.name}: ${e instanceof Error ? e.message : String(e)}`);
      err(`  manual: download ${g.url} → ${dest}`);
    }
  }

  // Copy the web-tree-sitter runtime wasm from node_modules (version-locked
  // to the bundled JS). Non-fatal if missing (deps not installed yet).
  try {
    if (fs.existsSync(RUNTIME_WASM_SRC)) {
      fs.copyFileSync(RUNTIME_WASM_SRC, path.join(INSTALL_DIR, RUNTIME_WASM_NAME));
      log(`${RUNTIME_WASM_NAME} copied from node_modules.`);
    } else {
      err(`${RUNTIME_WASM_NAME} not found in node_modules (run npm install first). tree-sitter highlight will be off until present.`);
    }
  } catch (e) {
    err(`copy runtime: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!ok) {
    err(`\nSome grammars failed. tree-sitter highlight degrades to Monarch for those languages; setup again to retry.`);
  }
  // Best-effort: never block npm start.
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { GRAMMARS, INSTALL_DIR, RUNTIME_WASM_NAME };
