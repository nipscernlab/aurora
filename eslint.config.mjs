import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

// Cross-file globals attached to window via <script> tags in index.html.
// These aren't ES modules — different files share state through globals.
const rendererSharedGlobals = {
  editor: "readonly",
  monaco: "readonly",
  TabManager: "readonly",
  CodeFormatter: "readonly",
  FileTreeState: "readonly",
  TreeViewState: "readonly",
  refreshFileTree: "readonly",
  showConfirmationDialog: "readonly",
  // Some renderer modules use `if (typeof module !== 'undefined')` to also
  // export themselves under Node — declare it readonly so the typeof check lints.
  module: "readonly",
};

// Each block scopes the right global environment to the right code:
//   • main process + Node bootstrap scripts → CommonJS + node globals
//   • preload bridges both worlds            → CommonJS + node + browser
//   • renderer modules                       → browser + cross-file globals
// Underscore-prefixed identifiers are treated as intentionally unused so
// `_event`, `_info`, `_stdout`, `_` placeholders don't trip the rule.
export default defineConfig([
  {
    // Global ignores. `components/` is the downloaded toolchain (Verilator,
    // yosys, yanc…) — bundled third-party artifacts, some named *.js but not
    // JavaScript (e.g. terminfo files), so linting the whole repo choked on
    // them. components/Scripts is our own code and is linted via the block
    // below. `dist/`/`release/` are build output (the Vite bundle and the
    // electron-builder package) — generated, minified, not ours to lint; eslint
    // only ignores node_modules/.git by default, so list them explicitly.
    ignores: [
      "components/**/*",
      "!components/Scripts/",
      "!components/Scripts/**",
      "dist/**",
      "release/**",
      // docs/ holds LaTeX sources and their Node build/lint helpers (CommonJS,
      // top-level return) — documentation tooling, not the app surface.
      "docs/**",
      // resources/docs/ is the SAPHO manual, downloaded from the
      // docs_aurora Release by `npm run bootstrap` and gitignored. It ships
      // Sphinx's own vendored JS (clipboard, copybutton, language stemmers),
      // which trips no-undef on globals it defines elsewhere. CI never saw
      // it — `npm ci` doesn't run bootstrap — but `npm start` does, so
      // anyone who launched the app once had 225 lint errors from files
      // that aren't ours.
      "resources/docs/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      // Lenient on params and caught errors (the Electron/forEach/try-catch
      // callback patterns generate a lot of "we have to declare this but
      // don't read it" cases). Still flag unused *declared* variables, since
      // those are usually genuine dead code. `_`-prefix is the escape hatch
      // for the rare declared var we want to keep.
      "no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    files: [
      "main.js",
      "main/**/*.js",
      "components/Scripts/**/*.js",
      "scripts/**/*.js",
      "knip.config.js",
    ],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },

  {
    // E2E tests: ES modules, Node globals (vitest + playwright), plus
    // a few `window.*` references inside page.evaluate() callbacks where
    // the body actually runs in the renderer. Mark `window` readonly so
    // those callbacks lint clean without weakening renderer rules.
    files: ["tests/e2e/**/*.{js,mjs}"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, window: "readonly", document: "readonly" },
    },
  },

  {
    // Unit tests: ES modules, Node globals (vitest). Tests assert against
    // production code that reads `window.*` and stub it via globalThis.window
    // in beforeEach/afterEach — declare `window` so the assertions lint
    // clean. `document` is included for the same reason in case future
    // tests stub DOM apis.
    files: ["tests/unit/**/*.{js,mjs,cjs}"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, window: "readonly", document: "readonly" },
    },
  },

  {
    // Toolchain integration tests: ES modules running in plain Node, where
    // they spawn the real compilers and simulators. No `window`/`document`
    // here on purpose — nothing in this suite touches a renderer, and leaving
    // them undeclared keeps that boundary enforced by the linter.
    files: ["tests/toolchain/**/*.{js,mjs,cjs}"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },

  {
    files: ["js/app/preload*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser },
    },
  },

  {
    files: ["js/**/*.js", "html/**/*.js"],
    ignores: ["js/app/preload*.js"],
    languageOptions: {
      globals: { ...globals.browser, ...rendererSharedGlobals },
    },
  },
]);
