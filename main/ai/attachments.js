// @ts-check
/**
 * attachments.js — turn composer attachments (images + files) into a text suffix
 * for the subscription CLIs, which take a plain-text prompt only.
 *
 *  - Files: inlined as a fenced ``` block of their text.
 *  - Images: the CLI can't take image bytes inline. Claude Code, however, reads
 *    images NATIVELY with its Read tool — so when `imagesAsFiles` is set we write
 *    each image to a temp file and reference its path. Providers without native
 *    image reading (Codex) get a one-line "can't view images" note instead.
 *
 * The temp images are ONE-SHOT: the CLI reads the path during the turn it is sent
 * in and never again (a resumed/restarted chat doesn't re-reference it), so any
 * file left behind is garbage. To stop them piling up in the OS temp dir, we
 * clear the directory at app start (cleanupTempImages(0), called from main.js)
 * and TTL-prune (>1h) on every write.
 *
 * The SDK transport (chat.js) does NOT use this — it sends real multimodal parts.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const ATT_DIR = path.join(os.tmpdir(), 'aurora-ai-attachments');

/**
 * Best-effort prune of temp attachment files. Removes anything older than
 * `maxAgeMs`; pass 0 to clear the whole directory (safe at app start — no chat
 * references old files then).
 * @param {number} [maxAgeMs]
 */
function cleanupTempImages(maxAgeMs = 60 * 60 * 1000) {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(ATT_DIR)) {
      const f = path.join(ATT_DIR, name);
      try {
        if (now - fs.statSync(f).mtimeMs >= maxAgeMs) fs.unlinkSync(f);
      } catch (_) { /* skip a file we can't stat/remove */ }
    }
  } catch (_) { /* dir doesn't exist yet — nothing to clean */ }
}

/** Write an image attachment (a `data:…;base64,…` URL) to a temp file. */
function writeTempImage(att) {
  try {
    const m = /^data:([^;]+);base64,(.*)$/s.exec((att && att.dataUrl) || '');
    if (!m) return null;
    let ext = (att.name && path.extname(att.name)) || '';
    if (!ext) ext = '.' + (((m[1] || '').split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png');
    fs.mkdirSync(ATT_DIR, { recursive: true });
    cleanupTempImages();   // TTL-prune stale files so the dir can't grow unbounded
    const file = path.join(ATT_DIR, `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
    fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
    return file;
  } catch (_) {
    return null;
  }
}

/**
 * Build the text to append to a CLI prompt for a message's attachments.
 * @param {any[]|undefined} attachments
 * @param {{imagesAsFiles?: boolean}} [opts]
 * @returns {string}
 */
function buildPromptSuffix(attachments, opts = {}) {
  const atts = Array.isArray(attachments) ? attachments : [];
  if (!atts.length) return '';
  const out = [];
  let degradedImages = 0;
  for (const a of atts) {
    if (a.kind === 'file' && a.text != null) {
      out.push(`\n\n[Attached file: ${a.name}${a.clipped ? ' (truncated)' : ''}]\n\`\`\`\n${a.text}\n\`\`\``);
    } else if (a.kind === 'image') {
      const p = opts.imagesAsFiles ? writeTempImage(a) : null;
      if (p) out.push(`\n\n[The user attached an image saved at: ${p}\nRead it with your Read tool to view it.]`);
      else degradedImages += 1;
    }
  }
  if (degradedImages > 0) {
    out.push(
      `\n\n[Note: the user attached ${degradedImages} image(s), but this provider can't view images. ` +
      `Switch to Claude Code or an API-key provider to send images.]`,
    );
  }
  return out.join('');
}

module.exports = { writeTempImage, buildPromptSuffix, cleanupTempImages, ATT_DIR };
