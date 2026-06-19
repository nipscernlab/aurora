import { electronAPI } from '../app/electron_api.js';
// wave_toolchain.js — resolve bundled toolchain paths for the wave/sim flow.
//
// Extracted from compilation_module.js (A2 god-file decomposition #3). Pure IO
// helpers: they join paths to bundled executables and probe the filesystem for
// existence / wave artifacts. No DOM, no simulation state — the only coupling is
// `electronAPI` (path join + fileExists + listFilesInDirectory) and the
// i18n shim. componentsPath is passed in (was this.componentsPath) so these are
// plain functions the wave pipeline calls.
//
// Kept on `electronAPI` (live global) rather than the ../app/electron_api
// re-export so the module stays unit-testable with the repo's
// `globalThis.window = { electronAPI: fake }` pattern (same as WaveStore /
// SpfStore) — migrating these globals belongs to A3, not this extraction.

// i18n shim — falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

/**
 * Resolve absolute paths to bundled toolchain executables and Aurora's
 * Temp / Scripts directories.
 *
 * Inputs:  componentsPath
 * Returns: { tempBaseDir, gtkwaveBin, vvpBin, iverilogBin,
 *            iverilogBinDir, gtkwaveBinDir, fst2vcdBin, surferBin } — all absolute
 * Throws:  never (joinPath is total)
 * Side-effects: none
 *
 * The iverilog / gtkwaveBinDir / fst2vcd fields exist so the cocotb
 * (Python testbench) flow can find the Icarus binary, put it on PATH,
 * and convert the FST it produces — that path uses the base tools object
 * directly (unlike Verilator, which merges in resolveVerilatorTools()).
 */
export async function resolveWaveToolchain(componentsPath) {
    const tempBaseDir = await electronAPI.joinPath(componentsPath, 'Temp');
    const gtkwaveBin = await electronAPI.joinPath(
        componentsPath, 'Packages', 'gtkwave-nipscern', 'gtkwave.exe',
    );
    // Unified mingw bundle: iverilog + vvp live in Packages/msys/mingw64/bin.
    const iverilogBinDir = await electronAPI.joinPath(
        componentsPath, 'Packages', 'msys', 'mingw64', 'bin',
    );
    const iverilogBin = await electronAPI.joinPath(iverilogBinDir, 'iverilog.exe');
    const vvpBin = await electronAPI.joinPath(iverilogBinDir, 'vvp.exe');
    // fst2vcd is the only GTKWave CLI tool Aurora needs; it ships in the
    // gtkwave-nipscern fork (no separate Icarus GTKWave bundle anymore).
    const gtkwaveBinDir = await electronAPI.joinPath(
        componentsPath, 'Packages', 'gtkwave-nipscern',
    );
    const fst2vcdBin = await electronAPI.joinPath(gtkwaveBinDir, 'fst2vcd.exe');
    // Surfer (optional, opt-in viewer): a standalone surfer.exe dropped under
    // Packages/surfer/. NOT bundled by default — _waveLaunchSurfer degrades to
    // GTKWave with a friendly message if it's absent, so resolving the path
    // unconditionally here is harmless.
    const surferBin = await electronAPI.joinPath(
        componentsPath, 'Packages', 'surfer', 'surfer.exe',
    );
    return {
        tempBaseDir, gtkwaveBin, vvpBin,
        iverilogBin, iverilogBinDir, gtkwaveBinDir, fst2vcdBin, surferBin,
    };
}

/**
 * Find the wave artifact (.fst / .vcd) a simulation produced in `dir`.
 *
 * Inputs:  dir, topModule
 * Returns: absolute path to the chosen wave file, or null if none.
 * Throws:  never (a missing/unreadable dir resolves to null).
 *
 * Preference order: `<top>.fst` > `<top>.vcd` > `dump.fst` > `dump.vcd`;
 * `fix.vcd` (the auto-gtkw scratch file) is always excluded. When none of
 * the preferred names match and exactly one wave file exists, take it;
 * an ambiguous multi-file directory with no preferred match returns null.
 */
export async function findWaveCandidateInDir(dir, topModule) {
    let entries = [];
    try {
        entries = await electronAPI.listFilesInDirectory(dir);
    } catch (_e) {
        return null;
    }
    const waves = (entries || [])
        .filter((name) => typeof name === 'string' && /\.(fst|vcd)$/i.test(name) && name !== 'fix.vcd');
    if (waves.length === 0) return null;

    const preferred = [
        `${topModule}.fst`,
        `${topModule}.vcd`,
        'dump.fst',
        'dump.vcd',
    ];
    const lowerToName = new Map(waves.map((name) => [name.toLowerCase(), name]));
    for (const name of preferred) {
        const found = lowerToName.get(name.toLowerCase());
        if (found) return await electronAPI.joinPath(dir, found);
    }
    if (waves.length === 1) {
        return await electronAPI.joinPath(dir, waves[0]);
    }
    return null;
}

/**
 * Resolve the Verilator toolchain (verilator script + perl + g++) from the
 * bundled msys tree, plus fst2vcd from gtkwave-nipscern.
 *
 * Inputs:  componentsPath
 * Returns: { mingwBin, usrBin, verilatorScript, perlExe, cxxBin, fst2vcdBin }
 * Throws:  toolchain.verilatorNotFound if the verilator script or perl.exe
 *          is missing (bundle not installed / corrupted).
 *
 * PATH at runtime is mingwBin (verilator, perl, g++, make, DLLs) + usrBin
 * (bash + coreutils the generated verilated.mk shells out to). Unlike the
 * base wave toolchain, Verilator merges these into its own tools object.
 */
export async function resolveVerilatorTools(componentsPath) {
    const bundleRoot = await electronAPI.joinPath(componentsPath, 'Packages', 'msys');
    const mingwBin = await electronAPI.joinPath(bundleRoot, 'mingw64', 'bin');
    const usrBin   = await electronAPI.joinPath(bundleRoot, 'usr', 'bin');
    const verilatorScript = await electronAPI.joinPath(mingwBin, 'verilator');
    const perlExe         = await electronAPI.joinPath(mingwBin, 'perl.exe');
    const cxxBin          = await electronAPI.joinPath(mingwBin, 'g++.exe');

    if (!await electronAPI.fileExists(verilatorScript)) {
        throw new Error(tr('error.toolchain.verilatorNotFound', {
            paths: `  ${verilatorScript}\n  (bundle nao instalado — rode "npm run bootstrap" pra baixar)`,
        }));
    }
    if (!await electronAPI.fileExists(perlExe)) {
        throw new Error(tr('error.toolchain.verilatorNotFound', {
            paths: `  ${perlExe}\n  (bundle corrompido — apague components/Packages/msys/ e rode "npm run bootstrap")`,
        }));
    }

    // fst2vcd vem do gtkwave-nipscern (a unica CLI de GTKWave que o Aurora usa).
    const fst2vcdBin = await electronAPI.joinPath(
        componentsPath, 'Packages', 'gtkwave-nipscern', 'fst2vcd.exe',
    );

    // PATH em runtime: bundle/mingw64/bin (verilator, perl, g++, make,
    // DLLs) + bundle/usr/bin (bash + coreutils que o verilated.mk usa
    // via `$(shell ...)`). System32 sempre presente automaticamente
    // quando invocamos via cmd.exe com `%PATH%` suffix.
    return { mingwBin, usrBin, verilatorScript, perlExe, cxxBin, fst2vcdBin };
}
