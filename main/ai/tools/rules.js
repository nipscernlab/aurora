// @ts-check
/**
 * Rules tools — `api` namespace 'rules' (SAPHO directives, opcodes, compiler messages).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'list_directives',
    description: 'List all SAPHO hardware directives (NBMANT, NBEXPO, NUBITS, ...).',
    access: 'read',
    api: [ 'rules', 'listDirectives' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_directive',
    description: 'Get the default value and description of one SAPHO hardware directive.',
    access: 'read',
    api: [ 'rules', 'getDirective' ],
    argStyle: 'positional',
    argNames: [ 'name' ],
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Directive name, e.g. NBMANT' } },
      required: [ 'name' ]
    }
  },
  {
    name: 'lookup_compiler_message',
    description: 'Look up a yanc compiler message by code (e.g. MSG_ERR_SYNTAX); returns its bilingual text and severity.',
    access: 'read',
    api: [ 'rules', 'lookupMessage' ],
    argStyle: 'positional',
    argNames: [ 'code' ],
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Message code, e.g. MSG_ERR_SYNTAX' } },
      required: [ 'code' ]
    }
  },
  {
    name: 'list_opcodes',
    description: 'List every SAPHO assembly opcode (mnemonic, numeric opcode, operand kind, family classification, prefix variants, one-line description). Use this when reasoning about which instruction family dominates a loop and which alternative encoding might shrink it.',
    access: 'read',
    api: [ 'rules', 'listOpcodes' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_opcode',
    description: 'Look up one SAPHO assembly opcode by mnemonic (case-insensitive).',
    access: 'read',
    api: [ 'rules', 'getOpcode' ],
    argStyle: 'positional',
    argNames: [ 'mnemonic' ],
    inputSchema: {
      type: 'object',
      properties: { mnemonic: { type: 'string', description: 'e.g. F_MLT, P_LOD, NRM_M' } },
      required: [ 'mnemonic' ]
    }
  }
];
