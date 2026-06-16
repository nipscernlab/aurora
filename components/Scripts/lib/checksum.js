// @ts-check
/**
 * checksum.js — SHA-256 integrity check for bootstrap downloads.
 *
 * Each downloader pins an EXPECTED_SHA256 (or null). After the zip lands and
 * BEFORE it is extracted, verifyChecksum() either:
 *   - enforces the pinned hash (throws on mismatch → the bad zip is never
 *     extracted), or
 *   - when no hash is pinned, computes and logs it so a maintainer can pin it
 *     (and publish a SHA256SUMS alongside the release).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * SHA-256 of a file as lowercase hex.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/**
 * Verify (or record) the SHA-256 of a downloaded artifact.
 * @param {string} filePath
 * @param {string|null|undefined} expected lowercase hex, or falsy to skip
 * @param {(m: string) => void} log
 * @returns {Promise<string>} the actual hash
 */
async function verifyChecksum(filePath, expected, log) {
    const actual = await sha256File(filePath);
    if (!expected) {
        log(`sha256(${path.basename(filePath)}) = ${actual}`);
        log('(no EXPECTED_SHA256 pinned — verification skipped; pin it to enforce integrity.)');
        return actual;
    }
    if (actual.toLowerCase() !== String(expected).toLowerCase()) {
        throw new Error(
            `Checksum mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}. `
            + 'Refusing to extract a possibly-tampered download.',
        );
    }
    log(`sha256 verified (${actual}).`);
    return actual;
}

module.exports = { sha256File, verifyChecksum };
