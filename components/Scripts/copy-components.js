const fse = require('fs-extra');
const path = require('path');

const sourceDir = path.join(__dirname, '..', '..', 'components');
const targetDir = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'components');

// Make the bundled toolchain reachable from the running Electron (dev) at
// node_modules/electron/dist/components. The toolchain is ~1 GB; the old
// remove+copy ran on EVERY `npm start`, duplicating it on disk each time.
//
// Strategy: prefer a directory junction (no copy, no duplication, always
// fresh). If a junction already points at the source, do nothing. Fall back
// to a physical copy only when the junction can't be created (e.g. the volume
// or permissions don't allow it).
async function copyComponents() {
    console.log('Linking components folder into electron dist...');
    console.log(`Source: ${sourceDir}`);
    console.log(`Target: ${targetDir}`);

    try {
        // Already a junction/symlink to the right place? Nothing to do.
        const stat = await fse.lstat(targetDir).catch(() => null);
        if (stat && stat.isSymbolicLink()) {
            const real = await fse.realpath(targetDir).catch(() => null);
            if (real && path.resolve(real) === path.resolve(sourceDir)) {
                console.log('Components already linked (junction) — skipping.');
                return;
            }
        }

        // Clear whatever is there (stale copy or wrong link), then link.
        await fse.remove(targetDir);
        await fse.ensureDir(path.dirname(targetDir));

        try {
            await fse.ensureSymlink(sourceDir, targetDir, 'junction');
            console.log('Components linked via junction (no copy).');
            return;
        } catch (linkErr) {
            console.warn(`Junction failed (${linkErr.message}); falling back to copy.`);
            await fse.copy(sourceDir, targetDir);
            console.log('Components folder copied successfully!');
        }
    } catch (error) {
        console.error('Error preparing components folder:', error);
        process.exit(1);
    }
}

copyComponents();
