// @ts-check
/**
 * Settings tools — `api` namespace 'settings' (read/write app settings).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'get_settings',
    description: 'Read the user-facing IDE settings: locale, tooltips, verbose mode.',
    access: 'read',
    api: [ 'settings', 'getAll' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'set_setting',
    description: 'Change one IDE setting.',
    access: 'write',
    api: [ 'settings', 'set' ],
    argStyle: 'positional',
    argNames: [ 'key', 'value' ],
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: [ 'locale', 'tooltipsEnabled', 'verboseMode' ] },
        value: {
          type: [ 'string', 'boolean' ],
          description: 'For locale: "pt" or "en". For the toggles: true/false.'
        }
      },
      required: [ 'key', 'value' ]
    }
  }
];
