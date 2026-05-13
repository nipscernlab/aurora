/**
 * i18n.js — Internationalization layer for Aurora.
 *
 * Pattern
 * -------
 * Two locale files in `locales/` ({en,pt}.json) hold all user-facing
 * strings, organized by area. The DOM declares bindings via two attrs:
 *
 *   data-i18n="path.to.key"          → element.textContent
 *   data-i18n-tooltip="path.to.key"  → element.setAttribute('data-tooltip', ...)
 *
 * `applyDOM()` walks the document on boot and on every locale change,
 * resolving each binding through `t(key)`. The same `t()` is exposed
 * as `window.t` for JS callers (terminal messages, dynamic UI, etc).
 *
 * Locale source of truth
 * ----------------------
 * The active locale lives in localStorage under `aurora-locale`. The
 * previous yanc-specific key `aurora-yanc-lang` is migrated silently
 * on first read so users don't lose their preference when this lands.
 *
 * Default: `pt` (matches the previous yanc toggle default). If a key
 * is missing from the active locale, falls back to `en`; if still
 * missing, returns the key path itself (loud failure — surfaces
 * untranslated strings during development).
 *
 * Interpolation
 * -------------
 * `t('errors.compile.failed', { code: 1 })` resolves `{{code}}` in
 * the template. Missing params become empty string (no throw — a
 * blank is more useful in the UI than a stack trace).
 *
 * Events
 * ------
 * `window.dispatchEvent('aurora:locale-changed', { detail: { locale } })`
 * fires after each `setLocale`. Components that render strings
 * imperatively (terminal messages, notifications) should listen and
 * re-render on this event.
 *
 * yanc compatibility
 * ------------------
 * `window.getYancLang` is kept as an alias for `getLocale()` so
 * compilation_module's `-pt`/`-en` injection works unchanged.
 */

const STORAGE_KEY = 'aurora-locale';
const LEGACY_KEY = 'aurora-yanc-lang';
const DEFAULT_LOCALE = 'pt';
const FALLBACK_LOCALE = 'en';
const SUPPORTED = ['en', 'pt'];

// translations[locale] = nested object loaded from locales/<locale>.json
const translations = Object.create(null);
let currentLocale = readLocale();
let booted = false;

function readLocale() {
    try {
        let v = localStorage.getItem(STORAGE_KEY);
        if (!v) {
            // One-shot migration from the earlier yanc-only toggle.
            const legacy = localStorage.getItem(LEGACY_KEY);
            if (legacy === 'en' || legacy === 'pt') {
                v = legacy;
                localStorage.setItem(STORAGE_KEY, v);
            }
        }
        return SUPPORTED.includes(v) ? v : DEFAULT_LOCALE;
    } catch {
        return DEFAULT_LOCALE;
    }
}

function writeLocale(lng) {
    try { localStorage.setItem(STORAGE_KEY, lng); } catch { /* private mode etc — silent */ }
}

function lookup(obj, dottedPath) {
    if (!obj) return undefined;
    return dottedPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''));
}

/**
 * Translate a dotted key against the active locale, with EN fallback.
 * Returns the key itself when no translation is found anywhere — that
 * makes missing strings loud in the UI instead of silently empty.
 */
function t(key, params) {
    if (typeof key !== 'string' || key.length === 0) return '';
    let v = lookup(translations[currentLocale], key);
    if (v === undefined && currentLocale !== FALLBACK_LOCALE) {
        v = lookup(translations[FALLBACK_LOCALE], key);
    }
    if (typeof v !== 'string') return key;
    return interpolate(v, params);
}

// Maps a `data-i18n-<suffix>` attribute name to the DOM attribute it
// targets. Adding a new attribute is one entry here. Suffixes use
// kebab-case in HTML (data-i18n-aria-label) to match the underlying
// attribute name without surprises.
const ATTR_BINDINGS = [
    ['data-i18n-tooltip',    'data-tooltip'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title',      'title'],
];

function applyDOM(root) {
    const scope = root || document;
    // Text content: data-i18n="path.to.key" → element.textContent
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        const val = t(key);
        // Only overwrite when we actually have a translation distinct
        // from the key path — preserves the HTML-authored fallback if
        // i18n hasn't loaded yet or the key is missing in both locales.
        if (val !== key) el.textContent = val;
    });
    // Attribute bindings (tooltip, placeholder, aria-label, title).
    for (const [sourceAttr, targetAttr] of ATTR_BINDINGS) {
        scope.querySelectorAll(`[${sourceAttr}]`).forEach((el) => {
            const key = el.getAttribute(sourceAttr);
            const val = t(key);
            if (val !== key) el.setAttribute(targetAttr, val);
        });
    }
    // Auto-tooltip by element ID: any element with id="X" gets its
    // data-tooltip filled from `tooltip.extended.X` when the key exists.
    // Runs AFTER the explicit data-i18n-tooltip bindings above and
    // intentionally overrides them — the extended description is the
    // canonical tooltip wherever a registered ID exists. Short labels
    // that may be set via data-i18n-tooltip apply only to elements
    // without an extended-description key (the auto-resolve is a no-op
    // for those, leaving the explicit binding in place).
    scope.querySelectorAll('[id]').forEach((el) => {
        const key = `tooltip.extended.${el.id}`;
        const val = t(key);
        if (val !== key) el.setAttribute('data-tooltip', val);
    });
}

async function loadLocale(lng) {
    if (translations[lng]) return;
    try {
        const res = await fetch(`./locales/${lng}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        translations[lng] = await res.json();
    } catch (e) {
        console.error(`[i18n] Failed to load ${lng}.json:`, e);
        translations[lng] = {};
    }
}

function getLocale() {
    return currentLocale;
}

/**
 * Switch the active locale, persist it, re-apply DOM, broadcast.
 * No-op if the requested locale isn't supported or already active.
 */
async function setLocale(lng) {
    if (!SUPPORTED.includes(lng) || lng === currentLocale) return;
    await loadLocale(lng);
    currentLocale = lng;
    writeLocale(lng);
    applyDOM();
    window.dispatchEvent(new CustomEvent('aurora:locale-changed', { detail: { locale: lng } }));
}

async function boot() {
    if (booted) return;
    booted = true;
    // Load both locales upfront — they're tiny and pre-loading kills
    // the flicker that would happen on first toggle. Load active first
    // so the initial paint isn't blocked on a network of fallbacks.
    await loadLocale(currentLocale);
    if (currentLocale !== FALLBACK_LOCALE) loadLocale(FALLBACK_LOCALE); // fire-and-forget
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyDOM(), { once: true });
    } else {
        applyDOM();
    }
}

/**
 * Test seam: inject a translation tree without going through the network.
 * Exported only so unit tests can populate `translations` directly; the
 * runtime code path always goes through `loadLocale()`.
 */
export function _setTranslations(locale, obj) {
    translations[locale] = obj;
}

export function _setLocaleSync(locale) {
    if (SUPPORTED.includes(locale)) currentLocale = locale;
}

export { t, setLocale, getLocale, lookup, interpolate, applyDOM };

if (typeof window !== 'undefined') {
    window.t = t;
    window.setLocale = setLocale;
    window.getLocale = getLocale;
    // Compatibility with compilation_module.js (was set by yanc_lang_toggle.js).
    window.getYancLang = getLocale;
    boot();
}
