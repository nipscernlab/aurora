// @ts-check
/**
 * tools/ — the tool manifest Aurora Intelligence is allowed to call.
 *
 * Each entry maps a function-calling tool to an `AuroraAPI` namespace
 * method in the renderer. The manifest is *pure data* (no closures) so
 * it can be shipped over IPC verbatim — the renderer's tool_runner
 * pulls it and uses the same `api` / `argStyle` / `argNames` fields to
 * dispatch the call, which keeps a single source of truth.
 *
 * The definitions are split by `api` namespace into sibling files
 * (editor.js, terminal.js, project.js, rules.js, settings.js, wave.js,
 * compile.js, misc.js); this index assembles them into TOOL_MANIFEST.
 * Concatenation order is presentational only — every consumer dispatches
 * by `def.name` (buildTools keys an object; getManifest and the MCP
 * server map/find by name), so a tool's position never affects behaviour.
 * To add a tool, drop it in the file for its namespace; to add a
 * namespace, add a file and splice it into the array below.
 *
 * `access`:
 *   - 'read'  — pure inspection, runs without prompting.
 *   - 'write' — mutates the workspace; the renderer shows an
 *               ask-before-write confirmation before executing.
 *
 * `argStyle` tells the renderer how to turn the JSON args object into
 * the AuroraAPI call:
 *   - 'none'        → fn()
 *   - 'positional'  → fn(args[argNames[0]], args[argNames[1]], ...)
 *   - 'object'      → fn(args)
 */

'use strict';

// `ai` is loaded defensively so a broken install does not crash the main
// process at module load. buildTools (which is the only function that
// actually uses these) checks for null before doing anything.
/** @type {any} */ let tool;
/** @type {any} */ let jsonSchema;
try {
  ({ tool, jsonSchema } = require('ai'));
} catch (_) {
  // Silently ignored — provider.js logs the same failure once.
}

/** @typedef {{ name:string, description:string, access:'read'|'write', api:[string,string], argStyle:'none'|'positional'|'object', argNames?:string[], inputSchema:object }} ToolDef */

/** @type {ToolDef[]} */
const TOOL_MANIFEST = [
  ...require('./editor'),
  ...require('./terminal'),
  ...require('./project'),
  ...require('./rules'),
  ...require('./settings'),
  ...require('./wave'),
  ...require('./compile'),
  ...require('./misc'),
];

/**
 * Build the Vercel-AI-SDK `tools` object. `runToolFn(name, args)` is
 * the bridge that ships the call to the renderer and resolves with the
 * AuroraAPI result — supplied by `chat.js`, bound to the right
 * webContents.
 *
 * @param {(name:string, args:object) => Promise<unknown>} runToolFn
 */
function buildTools(runToolFn) {
  if (!tool || !jsonSchema) return {};
  /** @type {Record<string, any>} */
  const tools = {};
  for (const def of TOOL_MANIFEST) {
    tools[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema),
      execute: async (/** @type {any} */ args) => runToolFn(def.name, args || {}),
    });
  }
  return tools;
}

/** Serialisable manifest for the renderer's tool_runner (no closures). */
function getManifest() {
  return TOOL_MANIFEST.map((d) => ({
    name: d.name,
    description: d.description,
    access: d.access,
    api: d.api,
    argStyle: d.argStyle,
    argNames: d.argNames || [],
    inputSchema: d.inputSchema,
  }));
}

module.exports = { TOOL_MANIFEST, buildTools, getManifest };
