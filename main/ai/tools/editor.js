// @ts-check
/**
 * Editor tools — `api` namespace 'editor' (active file, cursor, text edits, tabs/splits).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'get_active_file',
    description: 'Get the path of the file currently focused in the editor.',
    access: 'read',
    api: [ 'editor', 'getActiveFilePath' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_open_files',
    description: 'List the file paths of every open editor tab.',
    access: 'read',
    api: [ 'editor', 'getOpenFiles' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'read_active_file',
    description: 'Read the full text content of the file currently focused in the editor.',
    access: 'read',
    api: [ 'editor', 'getActiveText' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_cursor',
    description: 'Get the current cursor position (1-indexed line and column) in the active editor.',
    access: 'read',
    api: [ 'editor', 'getCursor' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'write_active_file',
    description: 'Replace the ENTIRE content of the active editor file. Prefer insert_text or replace_range for smaller edits.',
    access: 'write',
    api: [ 'editor', 'setActiveText' ],
    argStyle: 'positional',
    argNames: [ 'text' ],
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The new full file content' } },
      required: [ 'text' ]
    }
  },
  {
    name: 'insert_text',
    description: 'Insert text into the active editor at a 1-indexed line/column. Omit position to insert at the cursor.',
    access: 'write',
    api: [ 'editor', 'insertAt' ],
    argStyle: 'positional',
    argNames: [ 'text', 'position' ],
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        position: {
          type: 'object',
          properties: { line: { type: 'number' }, column: { type: 'number' } }
        }
      },
      required: [ 'text' ]
    }
  },
  {
    name: 'replace_range',
    description: 'Replace a range of text in the active editor (1-indexed line/column, end-exclusive column).',
    access: 'write',
    api: [ 'editor', 'replaceRange' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        startLine: { type: 'number' },
        startColumn: { type: 'number' },
        endLine: { type: 'number' },
        endColumn: { type: 'number' },
        text: { type: 'string' }
      },
      required: [ 'startLine', 'startColumn', 'endLine', 'endColumn', 'text' ]
    }
  },
  {
    name: 'save_file',
    description: 'Save the active editor file to disk.',
    access: 'write',
    api: [ 'editor', 'save' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'open_file',
    description: 'Open a project file in the editor. Set inNewSplit:true to open it in a new split pane.',
    access: 'write',
    api: [ 'editor', 'openFile' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or project-relative path' },
        inNewSplit: { type: 'boolean', description: 'Open in a new split pane' }
      },
      required: [ 'filePath' ]
    }
  },
  {
    name: 'create_split',
    description: 'Create a new editor split pane.',
    access: 'write',
    api: [ 'editor', 'createSplit' ],
    argStyle: 'none',
    inputSchema: { type: 'object', properties: {} }
  }
];
