// untitled_docs.js — pure metadata helpers for untitled (never-saved) tabs,
// extracted from tab_manager.js (A2 god-file decomposition).
//
// The untitled STATE stays owned by TabManager (the `untitledDocuments` Map +
// the `untitledCounter`); these functions receive it as a parameter and never
// mutate the counter (createNewFile writes it back — the class owns it).
//
// The monaco/DOM-heavy untitled orchestration (type detection, snippet
// expansion, tab presentation) deliberately stays in the class: it's
// side-effect orchestration with no clean seam, has external callers, and
// isn't exercised by the E2E — extracting it via a deps bag would be high
// risk for little gain.

import { getExtensionForDocumentType } from '../editor/document_type_detector.js';
import { basenameOf } from './tab_utils.js';

// Prefix for generated untitled names: "Untitled-1", "Untitled-2", ...
export const UNTITLED_PREFIX = 'Untitled-';

// Is this path one of the in-memory untitled documents?
export function isUntitled(untitledDocuments, filePath) {
    return untitledDocuments.has(filePath);
}

// Display name for a tab. Untitled docs show "<path>.<ext>" once a type has
// been detected (else the bare path); saved files show their basename.
export function untitledDisplayName(untitledDocuments, filePath) {
    if (isUntitled(untitledDocuments, filePath)) {
        const meta = untitledDocuments.get(filePath);
        const ext = getExtensionForDocumentType(meta?.detectedType);
        return ext ? `${filePath}.${ext}` : filePath;
    }
    return basenameOf(filePath);
}

// Find the next free "Untitled-N" name given the current counter. Returns the
// chosen path and the advanced counter; the caller writes the counter back
// (the class owns it). Skips any name already live as a tab or untitled doc.
export function nextUntitledPath(untitledDocuments, tabs, counter) {
    let next = counter;
    let filePath;
    do {
        next += 1;
        filePath = `${UNTITLED_PREFIX}${next}`;
    } while (tabs.has(filePath) || untitledDocuments.has(filePath));
    return { filePath, counter: next };
}
