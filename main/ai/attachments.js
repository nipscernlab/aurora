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
 * The SDK transport (chat.js) does NOT use this — it sends real multimodal parts.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

/** Write an image attachment (a `data:…;base64,…` URL) to a temp file. */
function writeTempImage(att) {
  try {
    const m = /^data:([^;]+);base64,(.*)$/s.exec((att && att.dataUrl) || '');
    if (!m) return null;
    let ext = (att.name && path.extname(att.name)) || '';
    if (!ext) ext = '.' + (((m[1] || '').split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png');
    const dir = path.join(os.tmpdir(), 'aurora-ai-attachments');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
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

module.exports = { writeTempImage, buildPromptSuffix };
