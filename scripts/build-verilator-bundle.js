// @ts-check
/**
 * scripts/build-verilator-bundle.js
 *
 * Assembles a portable Verilator bundle from a local msys2 install by
 * copying the WHOLE mingw64 subsystem + a minimal msys2 base. Aggressive
 * post-prune of docs/man/locales/static-libs keeps size manageable.
 *
 * Rationale: surgical per-package copy was fragile — Verilator's build
 * pipeline (perl wrapper → verilator_bin → g++ → make → cc1plus) touches
 * lots of msys2 internals that aren't trivially enumerable. Copying the
 * full tree avoids the dependency-cascade rabbit hole.
 *
 * Output layout (mimics msys2 install root):
 *   components/Packages/verilator/
 *     mingw64/...           ← entire mingw64 subsystem (g++, perl, verilator)
 *     usr/bin/{bash,coreutils,...}.exe + msys-*.dll
 *     usr/lib/perl5/... (kept for compat — mingw64 perl has its own)
 *     usr/share/perl5/...
 *     tmp/                  ← empty, bash needs it
 *
 * Usage:
 *   node scripts/build-verilator-bundle.js [--skip-smoke] [--no-clean]
 *   MSYS2_ROOT=D:/msys64 node scripts/build-verilator-bundle.js
 *
 * After this completes, zip the output and upload as `aurora-verilator-v1.zip`
 * to GitHub Releases (tag verilator-v1).
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ── Configuration ────────────────────────────────────────────────────────────

const MSYS2_ROOT = (process.env.MSYS2_ROOT || 'C:/packs/msys64').replace(/\\/g, '/');
const ROOT_DIR   = path.resolve(__dirname, '..');
const BUNDLE_DIR = path.join(ROOT_DIR, 'components', 'Packages', 'verilator');

// Top-level subtrees copiados from msys2. Tudo o que nao esta nesta
// lista NAO entra no bundle.
const SUBTREES = [
    // Toda a mingw64/ — base do toolchain (g++, perl, verilator, make,
    // includes, libs, share/verilator templates).
    { src: 'mingw64', dest: 'mingw64' },
    // bash + coreutils + utils basicos do msys2 — Verilator-generated
    // Makefile usa `$(shell uname -s)`, `rm -rf`, `mkdir -p`, etc.
    { src: 'usr/bin', dest: 'usr/bin' },
    // Perl modules path (mingw64 perl re-aproveita esses fallbacks).
    { src: 'usr/lib/perl5', dest: 'usr/lib/perl5' },
    { src: 'usr/share/perl5', dest: 'usr/share/perl5' },
    // /tmp expected by bash; criado vazio na fase de post-processing.
];

// Blacklist de paths/patterns a NAO copiar (avoid coping cruft).
// Aplicado durante a recursao da copia.
const COPY_BLACKLIST_RE = [
    // Docs / man / locales — universal sem valor
    /[\\/]share[\\/]doc[\\/]/i,
    /[\\/]share[\\/]man[\\/]/i,
    /[\\/]share[\\/]info[\\/]/i,
    /[\\/]share[\\/]locale[\\/]/i,
    /[\\/]share[\\/]gtk-doc[\\/]/i,
    /[\\/]share[\\/]bash-completion[\\/]/i,
    /[\\/]share[\\/]zsh[\\/]/i,
    /[\\/]share[\\/]fish[\\/]/i,
    /[\\/]share[\\/]vim[\\/]/i,
    /[\\/]share[\\/]gettext[\\/]/i,
    /[\\/]share[\\/]aclocal[\\/]/i,
    /[\\/]share[\\/]help[\\/]/i,
    /[\\/]share[\\/]icons[\\/]/i,
    /[\\/]share[\\/]applications[\\/]/i,
    /[\\/]share[\\/]metainfo[\\/]/i,
    /[\\/]share[\\/]devhelp[\\/]/i,
    // Static libs / pkgconfig / cmake — dev-only
    /[\\/]lib[\\/]pkgconfig[\\/]/i,
    /[\\/]lib[\\/]cmake[\\/]/i,

    // === GUI libs / ecosystems que o usuario tem no msys2 mas Verilator
    //     nao usa (librsvg sozinho da 148MB). ===
    /[\\/]lib[\\/]librsvg[^\\/]*$/i,
    /[\\/]lib[\\/]libgtk[^\\/]*$/i,
    /[\\/]lib[\\/]libgdk[^\\/]*$/i,
    /[\\/]lib[\\/]libgio[^\\/]*$/i,
    /[\\/]lib[\\/]libcairo[^\\/]*$/i,
    /[\\/]lib[\\/]libpango[^\\/]*$/i,
    /[\\/]lib[\\/]libatk[^\\/]*$/i,
    /[\\/]lib[\\/]libfontconfig[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libfreetype[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libharfbuzz[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libwebp[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libjpeg[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libpng[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libtiff[^\\/]*\.a$/i,
    /[\\/]lib[\\/]gdk-pixbuf[^\\/]*[\\/]/i,
    /[\\/]lib[\\/]girepository[^\\/]*[\\/]/i,
    /[\\/]lib[\\/]gtk-[\d.]+[\\/]/i,
    /[\\/]lib[\\/]glib-[\d.]+[\\/]/i,
    /[\\/]lib[\\/]libssl[^\\/]*$/i,
    /[\\/]lib[\\/]libcrypto[^\\/]*$/i,
    /[\\/]lib[\\/]tcl\d/i,
    /[\\/]lib[\\/]tk\d/i,
    /[\\/]lib[\\/]itcl/i,
    /[\\/]lib[\\/]itk/i,
    /[\\/]lib[\\/]terminfo[\\/]/i,
    /[\\/]lib[\\/]engines-[\d]+[\\/]/i,   // OpenSSL engines
    /[\\/]lib[\\/]ossl-modules[\\/]/i,
    /[\\/]lib[\\/]ngspice[\\/]/i,
    // Mingw64 extra static libs nao usadas pelo Verilator
    /[\\/]lib[\\/]libicu[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libxml2[^\\/]*\.a$/i,
    /[\\/]lib[\\/]liblzma[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libsqlite[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libcurl[^\\/]*\.a$/i,

    // === Python stdlib pruning — keep core, drop test/idle/tkinter ===
    /[\\/]python3\.\d+[\\/]test[\\/]/i,
    /[\\/]python3\.\d+[\\/]idlelib[\\/]/i,
    /[\\/]python3\.\d+[\\/]tkinter[\\/]/i,
    /[\\/]python3\.\d+[\\/]turtledemo[\\/]/i,
    /[\\/]python3\.\d+[\\/]ensurepip[\\/]/i,
    /[\\/]python3\.\d+[\\/]lib2to3[\\/]/i,
    /[\\/]python3\.\d+[\\/]distutils[\\/]/i,
    /[\\/]python3\.\d+[\\/]dbm[\\/]/i,
    /[\\/]python3\.\d+[\\/]sqlite3[\\/]/i,
    /[\\/]python3\.\d+[\\/]asyncio[\\/]/i,
    /[\\/]python3\.\d+[\\/]wsgiref[\\/]/i,
    /[\\/]python3\.\d+[\\/]xmlrpc[\\/]/i,
    /[\\/]python3\.\d+[\\/]email[\\/]/i,
    /[\\/]python3\.\d+[\\/]html[\\/]/i,
    /[\\/]python3\.\d+[\\/]http[\\/]/i,
    /[\\/]python3\.\d+[\\/]urllib[\\/]/i,
    /[\\/]python3\.\d+[\\/]xml[\\/]/i,
    /[\\/]python3\.\d+[\\/]venv[\\/]/i,
    /[\\/]python3\.\d+[\\/]ctypes[\\/]/i,
    /[\\/]python3\.\d+[\\/]curses[\\/]/i,
    /[\\/]python3\.\d+[\\/]concurrent[\\/]/i,
    /[\\/]python3\.\d+[\\/]multiprocessing[\\/]/i,
    /[\\/]python3\.\d+[\\/]unittest[\\/]/i,
    /[\\/]python3\.\d+[\\/]pydoc_data[\\/]/i,
    /[\\/]python3\.\d+[\\/]site-packages[\\/]/i,
    /[\\/]python3\.\d+[\\/]__pycache__[\\/]/i,
    // gcc internals que nao precisamos
    /[\\/]plugin[\\/]/i,
    /lto1\.exe$/i,                       // LTO compiler, sem -flto
    /[\\/]install-tools[\\/]/i,
    /[\\/]include-fixed[\\/]/i,          // Linux glibc workarounds
    /[\\/]finclude[\\/]/i,               // Fortran includes
    // Perl modules dev-only
    /[\\/]perl5[\\/][^\\/]*[\\/]CPAN[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]CPANPLUS[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]Test[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]Test2[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]DBI[^\\/]*[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]Net[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]Tk[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]XML[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]HTTP[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]ExtUtils[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]Module[\\/]/i,
    /[\\/]perl5[\\/][^\\/]*[\\/]Devel[\\/]/i,
    // Debug variants
    /_dbg\.exe$/i,
    /\.exe\.a$/i,                        // gcc plugin static libs
    // Win32 SDK headers grandes que Verilator-generated C++ nunca usa
    /[\\/]include[\\/](d3d|d2d|dwrite|dxva|mshtml|msxml|sapi|tuner|strmif|windows\.ui\.|windows\.applicationmodel\.|windows\.media\.|windows\.devices\.|windows\.gaming\.|windows\.networking\.|windows\.storage\.|windows\.web\.|uiautomation|gdiplus|wbem|wmi|wsbapp|wsdapi|wuapi|wia|setupapi|dbghelp|dbgeng|comdef|openssl)/i,
    /[\\/]include[\\/](winrt|ddk|GL|KHR|AL)[\\/]/i,
    // CRT static libs que nao usamos. CUIDADO: NAO incluir libmsvcrt.a
    // (CRT base do Windows, ld linka contra) nem libucrt.a (Universal
    // CRT que tambem e necessario). So bater versoes legacy ou Win10+ APIs.
    /[\\/]lib[\\/]lib(onecore|onecoreuap|windowsapp|windowscoreheadless|nanosrv|mincore|apiset)[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libapi-[^\\/]*\.a$/i,
    /[\\/]lib[\\/]libwsmsvc[^\\/]*\.a$/i,
    // Legacy MSVC runtimes (numerados): msvcr80/90/100/110/120, msvcp60
    /[\\/]lib[\\/]libmsvcr\d+\.a$/i,
    /[\\/]lib[\\/]libmsvcp\d+\.a$/i,
    /[\\/]lib[\\/]libucrtbased?\.a$/i,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[bundle] ${msg}`); }
function warn(msg) { console.warn(`[bundle] WARN: ${msg}`); }
function err(msg) { console.error(`[bundle] ERROR: ${msg}`); }

function isBlacklisted(absPath) {
    return COPY_BLACKLIST_RE.some(re => re.test(absPath));
}

// Whitelist de binarios em mingw64/bin/ e usr/bin/. Qualquer .exe que
// NAO bate com esses padroes e dropado. DLLs (*.dll) sao sempre
// mantidos — sao deps em runtime de tudo.
const BIN_WHITELIST_RE = [
    // Verilator + suas tools auxiliares
    /^verilator(_bin)?(_coverage|_gantt|_profcfunc)?(\.exe)?$/i,
    // Perl runtime
    /^perl[\d.]*\.exe$/i,
    /^perl[\d.]*\.dll$/i,
    /^perlglob\.exe$/i,
    // Python runtime
    /^python[\d.]*\.exe$/i,
    /^pythonw?\.exe$/i,
    // Make
    /^(mingw32-)?make\.exe$/i,
    // C/C++ compiler toolchain
    /^(g\+\+|gcc|cc|cpp|c\+\+)\.exe$/i,
    /^x86_64-w64-mingw32-(g\+\+|gcc|cc|cpp|c\+\+|as|ld|ar|ranlib|strip|nm|objcopy|objdump|readelf|size|addr2line|c\+\+filt|dlltool|dllwrap|elfedit|gprof|gcov|windres|windmc)\.exe$/i,
    /^(as|ld|ld\.bfd|ar|ranlib|strip|nm|objcopy|objdump|readelf|size|addr2line|c\+\+filt|dlltool|dllwrap|elfedit|windres|windmc)\.exe$/i,
    /^cygpath\.exe$/i,  // util pra path translation se necessario
    // msys2 utils essenciais (coreutils + minimum shell)
    /^(bash|sh|env|cat|cp|dd|df|du|echo|false|true|ls|mkdir|mv|pwd|rm|rmdir|sleep|wc|sort|head|tail|cut|tr|tee|sed|awk|grep|find|chmod|chown|date|uname|hostname|expr|test|tee|basename|dirname|realpath|readlink|sync|stty|tty|sleep|touch|kill|ps|getopt|getconf|locale|id|whoami|nproc|tput|mktemp|seq|paste|sleep|stat|tar|gzip|gunzip|bzip2|xz|patch|xargs|printf|which|sh\.exe|tr|join|comm|md5sum|sha1sum|sha256sum|uniq|fold|fmt|nl|od|split|tac|true|false|yes|cmp|diff)\.exe$/i,
    /^msys-.*\.dll$/i,                   // todas msys runtime DLLs
];
function isWhitelistedBin(filename) {
    return BIN_WHITELIST_RE.some(re => re.test(filename));
}

function copyTreeFiltered(srcDir, destDir, stats, opts = {}) {
    if (!fs.existsSync(srcDir)) return;
    if (isBlacklisted(srcDir)) { stats.skipped++; return; }
    fs.mkdirSync(destDir, { recursive: true });
    let entries;
    try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); }
    catch (e) { warn(`readdir ${srcDir}: ${e.message}`); return; }
    // inBin: estamos dentro de um diretorio chamado "bin" (mingw64/bin/
    // ou usr/bin/). Se sim, *.exe sofrem whitelist.
    const inBin = /[\\/]bin$/i.test(srcDir);
    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        if (isBlacklisted(srcPath)) { stats.skipped++; continue; }
        // Whitelist em diretorios bin/: drop .exe nao-essenciais
        // (cmake, gdb, pacman, gtk-tools, rsvg, etc.). DLLs e scripts
        // sem extensao sempre passam — sao deps runtime ou wrappers.
        if (inBin && entry.isFile() && /\.exe$/i.test(entry.name)) {
            if (!isWhitelistedBin(entry.name)) { stats.skipped++; continue; }
        }
        if (entry.isDirectory()) {
            copyTreeFiltered(srcPath, destPath, stats, opts);
        } else if (entry.isSymbolicLink()) {
            // Symlinks msys2 → resolve e copia o conteudo final.
            try {
                const real = fs.realpathSync(srcPath);
                if (fs.existsSync(real) && fs.statSync(real).isFile()) {
                    fs.copyFileSync(real, destPath);
                    stats.copied++;
                }
            } catch (_e) { stats.skipped++; }
        } else if (entry.isFile()) {
            try {
                fs.copyFileSync(srcPath, destPath);
                stats.copied++;
            } catch (e) { warn(`copy ${srcPath}: ${e.message}`); stats.skipped++; }
        }
    }
}

function* walk(dir) {
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { return; }
    for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(p);
        else yield p;
    }
}

function dirSize(dir) {
    let total = 0;
    for (const file of walk(dir)) {
        try { total += fs.statSync(file).size; } catch (_e) { /* */ }
    }
    return total;
}

function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ── Post-processing ──────────────────────────────────────────────────────────

function postProcess(bundleDir) {
    // make.exe alias → mingw32-make.exe. Verilator wrapper invoca
    // `make`, mas o pacote mingw-w64-x86_64-make instala como mingw32-make.
    const mingw32Make = path.join(bundleDir, 'mingw64', 'bin', 'mingw32-make.exe');
    const bundleMake = path.join(bundleDir, 'mingw64', 'bin', 'make.exe');
    if (fs.existsSync(mingw32Make) && !fs.existsSync(bundleMake)) {
        fs.copyFileSync(mingw32Make, bundleMake);
        log('  Aliased make.exe → mingw32-make.exe');
    }

    // verilator_includer: SE Python3 esta no bundle (msys2 do usuario
    // tem mingw-w64-x86_64-python instalado), deixa o script Python
    // original — Verilator's Makefile chama `python3 verilator_includer`
    // que funciona direto. Sem Python, substituimos por um port Perl
    // + shim python3.
    const bundlePython = path.join(bundleDir, 'mingw64', 'bin', 'python3.exe');
    if (fs.existsSync(bundlePython)) {
        log('  Python3 detected in bundle — keeping original verilator_includer.py');
    } else {
        const verilatorIncluder = path.join(bundleDir, 'mingw64', 'share', 'verilator', 'bin', 'verilator_includer');
        if (fs.existsSync(verilatorIncluder)) {
            // Port Perl SEM shebang (invocado como `perl verilator_includer ...`).
            const perlPort = `# Port de verilator_includer.py pra Perl (Aurora bundle).
print "// DESCRIPTION: Generated by verilator_includer (Perl port)\\n";
for my $arg (@ARGV) {
    if ($arg =~ /^-D([^=]+)=(.*)/) {
        print "#define $1 $2\\n";
    } else {
        print "#include \\"$arg\\"\\n";
    }
}
`;
            fs.writeFileSync(verilatorIncluder, perlPort);
            log('  Replaced verilator_includer with Perl port (no Python in bundle)');
        }
        const python3Cmd = path.join(bundleDir, 'mingw64', 'bin', 'python3.cmd');
        fs.writeFileSync(python3Cmd, '@perl %*\r\n');
        const python3Sh = path.join(bundleDir, 'usr', 'bin', 'python3');
        fs.mkdirSync(path.dirname(python3Sh), { recursive: true });
        fs.writeFileSync(python3Sh, '#!/usr/bin/env bash\nexec perl "$@"\n');
        try { fs.chmodSync(python3Sh, 0o755); } catch (_e) { /* */ }
        log('  Created python3 shims (cmd + sh) → perl');
    }

    // /tmp/ — bash msys procura ao iniciar.
    fs.mkdirSync(path.join(bundleDir, 'tmp'), { recursive: true });
    log('  Created /tmp/');
}

// ── Smoke tests ──────────────────────────────────────────────────────────────

function smokeTest(bundleDir) {
    const mingwBin = path.join(bundleDir, 'mingw64', 'bin');
    const usrBin = path.join(bundleDir, 'usr', 'bin');
    const verilatorScript = path.join(mingwBin, 'verilator');
    const perlExe = path.join(mingwBin, 'perl.exe');
    if (!fs.existsSync(verilatorScript)) throw new Error(`verilator script missing at ${verilatorScript}`);
    if (!fs.existsSync(perlExe)) throw new Error(`perl.exe missing at ${perlExe}`);

    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const cleanPath = `${mingwBin};${usrBin};${sysRoot};${sysRoot}\\System32`;
    log(`Version smoke: perl verilator --version`);
    const r = spawnSync(perlExe, [verilatorScript, '--version'], {
        env: { PATH: cleanPath, SystemRoot: sysRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
        encoding: 'utf8',
    });
    if (r.status !== 0) {
        err(`Version smoke FAILED (exit ${r.status}): ${r.stdout || ''} ${r.stderr || ''}`);
        return false;
    }
    log(`Version smoke OK: ${r.stdout.trim().split('\n')[0]}`);
    return true;
}

function fullBuildSmokeTest(bundleDir) {
    const mingwBin = path.join(bundleDir, 'mingw64', 'bin');
    const usrBin = path.join(bundleDir, 'usr', 'bin');
    const verilatorScript = path.join(mingwBin, 'verilator');
    const perlExe = path.join(mingwBin, 'perl.exe');
    const tmpDir = path.join(require('os').tmpdir(), `aurora-vlt-smoke-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'smoke_tb.v'), `
module smoke_tb;
  initial begin
    $display("HELLO_FROM_VERILATOR");
    $finish;
  end
endmodule
`);

    const objDir = path.join(tmpDir, 'obj_dir');
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const env = {
        PATH: `${mingwBin};${usrBin};${sysRoot};${sysRoot}\\System32`,
        SystemRoot: sysRoot,
        TEMP: process.env.TEMP, TMP: process.env.TMP,
    };

    log(`Full build smoke: verilator --binary --main smoke_tb.v`);
    const r1 = spawnSync(perlExe, [
        verilatorScript, '--binary', '--main', '-Wno-fatal', '-j', '0',
        '--top-module', 'smoke_tb', '-Mdir', objDir,
        path.join(tmpDir, 'smoke_tb.v'),
    ], { env, encoding: 'utf8' });
    if (r1.status !== 0) {
        err(`Build phase FAILED (exit ${r1.status})`);
        err(`stdout: ${(r1.stdout || '').slice(0, 1500)}`);
        err(`stderr: ${(r1.stderr || '').slice(0, 1500)}`);
        return false;
    }
    const exePath = path.join(objDir, 'Vsmoke_tb.exe');
    if (!fs.existsSync(exePath)) { err(`Binary missing: ${exePath}`); return false; }

    log(`Running ${path.basename(exePath)}`);
    const r2 = spawnSync(exePath, [], { env, encoding: 'utf8' });
    if (r2.status !== 0 || !(r2.stdout || '').includes('HELLO_FROM_VERILATOR')) {
        err(`Run FAILED (exit ${r2.status}): ${r2.stdout || r2.stderr}`);
        return false;
    }
    log(`Full build smoke OK: "${r2.stdout.split('\n').find(l => l.includes('HELLO'))}"`);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* */ }
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const args = new Set(process.argv.slice(2));
    const skipSmoke = args.has('--skip-smoke');
    const skipClean = args.has('--no-clean');

    if (!fs.existsSync(MSYS2_ROOT)) {
        err(`msys2 root not at ${MSYS2_ROOT}. Set MSYS2_ROOT env var.`);
        process.exit(1);
    }

    if (!skipClean && fs.existsSync(BUNDLE_DIR)) {
        log(`Cleaning ${BUNDLE_DIR}`);
        try { fs.rmSync(BUNDLE_DIR, { recursive: true, force: true }); }
        catch (e) {
            err(`Could not clean: ${e.message}. Try "taskkill /F /IM perl.exe /IM bash.exe" and re-run.`);
            process.exit(1);
        }
    }
    fs.mkdirSync(BUNDLE_DIR, { recursive: true });

    log(`MSYS2_ROOT = ${MSYS2_ROOT}`);
    log(`Bundle out = ${BUNDLE_DIR}`);

    // ── COPY ───────────────────────────────────────────────────────────
    const stats = { copied: 0, skipped: 0 };
    for (const { src, dest } of SUBTREES) {
        log(`Copying ${src} → ${dest}/ ...`);
        // bin/ dirs: aplicar whitelist agressiva
        const isBinDir = /[\\/]bin$/.test(src);
        copyTreeFiltered(
            path.join(MSYS2_ROOT, src),
            path.join(BUNDLE_DIR, dest),
            stats,
            { binWhitelist: isBinDir }
        );
    }
    log(`Copied ${stats.copied} files; skipped ${stats.skipped} (blacklist + symlink failures).`);

    // ── POST-PROCESS ───────────────────────────────────────────────────
    log('Post-processing (aliases + shims + /tmp)...');
    postProcess(BUNDLE_DIR);

    const size = dirSize(BUNDLE_DIR);
    log(`Final bundle size: ${fmtBytes(size)}`);

    // ── SMOKE ──────────────────────────────────────────────────────────
    if (skipSmoke) { log('Skipping smoke (--skip-smoke).'); }
    else {
        log('Running smoke tests...');
        if (!smokeTest(BUNDLE_DIR)) { err('Version smoke FAILED.'); process.exit(2); }
        if (!fullBuildSmokeTest(BUNDLE_DIR)) { err('Full build smoke FAILED.'); process.exit(3); }
    }

    log('Done. Next steps:');
    log(`  1. Zip: 7z a -mx=9 aurora-verilator-v1.zip "${BUNDLE_DIR}"`);
    log(`  2. Upload to GitHub Releases (tag verilator-v1, file aurora-verilator-v1.zip).`);
    log(`  3. Test fresh-clone: rm -rf components/Packages/verilator && npm run bootstrap`);
}

if (require.main === module) main();
