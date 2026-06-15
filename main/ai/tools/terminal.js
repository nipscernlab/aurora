// @ts-check
/**
 * Terminal tools — `api` namespace 'terminal' (read compiler terminal panels).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'get_terminal_output',
    description: 'Read the visible text of a compiler terminal panel. Omit terminalId for the currently visible panel.',
    access: 'read',
    api: [ 'terminal', 'getText' ],
    argStyle: 'positional',
    argNames: [ 'terminalId' ],
    inputSchema: {
      type: 'object',
      properties: {
        terminalId: { type: 'string', description: 'One of: tcmm, tasm, tveri, twave, tprism' }
      }
    }
  },
  {
    name: 'list_terminals',
    description: 'List the ids of every compiler terminal panel.',
    access: 'read',
    api: [ 'terminal', 'list' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_all_terminals',
    description: 'Read the visible text of EVERY terminal panel at once, keyed by id (tcmm, tasm, tveri, twave, ...).',
    access: 'read',
    api: [ 'terminal', 'getAll' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  }
];
