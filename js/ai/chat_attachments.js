// chat_attachments.js: pure helpers for the AI composer's file/image
// attachments, extracted from ai_assistant_manager.js (A2 god-file decomposition).
//
// Pure: no DOM, no FileReader, no instance state. The class keeps the
// side-effectful orchestration (reading files via FileReader, the
// pendingAttachments state, inserting nodes + wiring listeners) and feeds these
// helpers the data plus an `esc` HTML-escaper, so the rendered markup stays
// byte-identical to the class's DOM-based escaper.

// Human-readable byte size: "B" / "KB" / "MB".
export function formatAttachmentSize(n) {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Composer preview chip (the strip above the input). `esc` escapes text for
// HTML, `fmtSize` formats the byte size. Image chips show a thumbnail; file
// chips show the size (+ " · clipped" when the text was truncated).
export function composerChipHtml(a, esc, fmtSize) {
    const thumb = a.kind === 'image'
        ? `<img class="ai-att-thumb" src="${a.dataUrl}" alt="">`
        : `<i class="ph ph-file-text ai-att-icon" aria-hidden="true"></i>`;
    const meta = a.kind === 'image'
        ? ''
        : `<span class="ai-att-meta">${fmtSize(a.size)}${a.clipped ? ' · clipped' : ''}</span>`;
    return `<span class="ai-att-chip ${a.kind === 'image' ? 'is-image' : ''}" title="${esc(a.name)}">
        ${thumb}
        <span class="ai-att-body"><span class="ai-att-name">${esc(a.name)}</span>${meta}</span>
        <button class="ai-att-remove" data-id="${a.id}" type="button" aria-label="Remove attachment"><i class="ph ph-x"></i></button>
      </span>`;
}

// Read-only chip inside a sent user bubble. A live image (still has its bytes)
// renders as a thumbnail; an image whose payload was dropped (a reopened chat
// keeps only the name/ext) falls back to a name + icon chip, so the message
// keeps its context instead of going blank.
export function bubbleChipHtml(a, esc, fmtSize) {
    if (a.kind === 'image' && a.dataUrl) {
        return `<img class="ai-att-thumb ai-att-thumb-lg" src="${a.dataUrl}" alt="${esc(a.name)}" title="${esc(a.name)}">`;
    }
    const icon = a.kind === 'image' ? 'ph-image' : 'ph-file-text';
    const meta = a.size != null ? fmtSize(a.size) : '';
    return `<span class="ai-att-chip" title="${esc(a.name)}"><i class="ph ${icon} ai-att-icon" aria-hidden="true"></i><span class="ai-att-body"><span class="ai-att-name">${esc(a.name)}</span>${meta ? `<span class="ai-att-meta">${meta}</span>` : ''}</span></span>`;
}
