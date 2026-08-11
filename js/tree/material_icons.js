/**
 * material_icons.js — folder/file icon resolver for the Folders (standard)
 * file-tree view, backed by the **Material Icon Theme** SVG set.
 *
 * The package's generated VSCode-icon-theme manifest (`material-icons.json`) is
 * vendored next to its SVGs at `vendor/material-icons/` (see vite.config.mjs).
 * We fetch it once and resolve names exactly the way VSCode's file-icon-theme
 * spec does — exact filename → longest compound extension → simple extension →
 * default — so a `tests` folder gets `folder-test`, `app.module.ts` gets
 * `react_ts`/`typescript`, etc. The icons keep **their own colours** (rendered
 * as a `background-image`, NOT recoloured): this view intentionally drops
 * Aurora's old per-extension/per-depth tinting.
 *
 * Split in two layers:
 *   - PURE (no DOM, no fetch): resolveFolderIconName / resolveFileIconName /
 *     iconUrlFromManifest — unit-tested against a small fake manifest.
 *   - RUNTIME: ensureManifest() loads + caches the real manifest; iconUrlForFile
 *     / iconUrlForFolder use the cached copy (falling back to the default glyph
 *     before it lands / if the fetch fails).
 *
 * SAPHO override: Material maps `.v` to the V language ("vlang"); for this
 * hardware IDE `.v`/`.vh` are Verilog, so OVERRIDES forces the verilog icon.
 * `.cmm` has no Material equivalent and keeps its custom masked glyph — that
 * special case lives in the renderer, not here.
 */

// Where the vendored SVGs + manifest live, relative to the loaded document
// (index.html). Same convention as ./locales, ./resources, ./assets/icons —
// served by vite-plugin-static-copy in dev and shipped under dist/ in prod.
const VENDOR_BASE = './vendor/material-icons/';
const MANIFEST_URL = `${VENDOR_BASE}material-icons.json`;

// SAPHO-specific extension → Material icon-definition name. Merged ON TOP of the
// manifest's fileExtensions so the toolchain reads correctly.
const OVERRIDES = Object.freeze({
  v: 'verilog',
  vh: 'verilog',
  sv: 'verilog',
  m: 'matlab',      // Material maps .m → objective-c; in this IDE .m is MATLAB
  gtkw: 'log',
  vcd: 'log',
  fst: 'log',
  mif: 'database',
});

/** basename without directory, from a manifest iconPath like "./../icons/folder-test.svg". */
function baseName(p) {
  return String(p || '').split(/[\\/]/).pop();
}

/**
 * Resolve an icon-definition NAME to its vendored SVG URL using the manifest's
 * iconDefinitions (robust even if a def name differs from its file basename).
 * Falls back to `<name>.svg` when the def is missing.
 * @returns {string} document-relative URL
 */
export function iconUrlFromManifest(manifest, name) {
  const def = manifest && manifest.iconDefinitions && manifest.iconDefinitions[name];
  const file = def && def.iconPath ? baseName(def.iconPath) : `${name}.svg`;
  return `${VENDOR_BASE}${file}`;
}

/**
 * Folder name → icon-definition name. `open` picks the expanded variant.
 * Match is case-insensitive (manifest keys are lowercase). Unknown folders fall
 * back to the default folder / folder-open.
 */
export function resolveFolderIconName(manifest, folderName, open = false) {
  const key = String(folderName || '').toLowerCase();
  const names = open ? (manifest.folderNamesExpanded || {}) : (manifest.folderNames || {});
  if (Object.prototype.hasOwnProperty.call(names, key)) return names[key];
  return open ? (manifest.folderExpanded || 'folder-open') : (manifest.folder || 'folder');
}

/**
 * File name → icon-definition name, mirroring VSCode's file-icon-theme lookup:
 *   1. exact (lowercased) fileName
 *   2. SAPHO OVERRIDES on the simple extension
 *   3. compound extension, longest first  (e.g. "test.js" before "js")
 *   4. default file icon
 */
export function resolveFileIconName(manifest, fileName) {
  const lower = String(fileName || '').toLowerCase();

  const byName = manifest.fileNames || {};
  if (Object.prototype.hasOwnProperty.call(byName, lower)) return byName[lower];

  const byExt = manifest.fileExtensions || {};
  const parts = lower.split('.');
  // Simple (last) extension first checks the SAPHO override table.
  const simple = parts.length > 1 ? parts[parts.length - 1] : '';
  if (simple && Object.prototype.hasOwnProperty.call(OVERRIDES, simple)) return OVERRIDES[simple];

  // Compound extensions, longest → shortest: "a.b.c" tries "b.c" then "c".
  for (let i = 1; i < parts.length; i++) {
    const cand = parts.slice(i).join('.');
    if (Object.prototype.hasOwnProperty.call(byExt, cand)) return byExt[cand];
  }
  return manifest.file || 'file';
}

// ---------------------------------------------------------------------------
// Runtime layer — fetch + cache the real manifest, sync URL helpers.
// ---------------------------------------------------------------------------

let _manifest = null;       // resolved manifest object (null until loaded)
let _loadPromise = null;    // in-flight / settled load promise

/** Load + cache the manifest once. Resolves to the manifest, or null on failure. */
export function ensureManifest() {
  if (_manifest) return Promise.resolve(_manifest);
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _manifest = await res.json();
    } catch (err) {
      console.warn('material_icons: manifest load failed, using default glyphs', err);
      _manifest = null;
    }
    return _manifest;
  })();
  return _loadPromise;
}

/** True once a load attempt has settled (manifest may still be null on failure). */
export function ready() { return ensureManifest(); }

/** Folder icon URL (default glyph until the manifest is loaded). */
export function iconUrlForFolder(folderName, { open = false } = {}) {
  if (!_manifest) return `${VENDOR_BASE}${open ? 'folder-open' : 'folder'}.svg`;
  return iconUrlFromManifest(_manifest, resolveFolderIconName(_manifest, folderName, open));
}

/** File icon URL (default glyph until the manifest is loaded). */
export function iconUrlForFile(fileName) {
  if (!_manifest) return `${VENDOR_BASE}file.svg`;
  return iconUrlFromManifest(_manifest, resolveFileIconName(_manifest, fileName));
}
