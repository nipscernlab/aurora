// @ts-check
/**
 * Misc tools — namespaces 'ai' (run_in_background) and 'ui' (ask_user_question).
 *
 * One slice of the TOOL_MANIFEST assembled in ./index.js. Pure data (no
 * closures) so it ships over IPC verbatim — see ./index.js for the ToolDef
 * shape and how the manifest is consumed.
 */

'use strict';

/** @type {import('./index.js').ToolDef[]} */
module.exports = [
  {
    name: 'run_in_background',
    description: 'Run a long compile task in the BACKGROUND and return immediately so the current turn can end. When the task finishes, YOU are automatically given the result as a new turn and should report it to the user — i.e. start the work, tell the user you will report back, let the turn finish, and Aurora re-invokes you on completion. Use this for long compiles/simulations instead of blocking on compile_all/compile_step. task is "compile_all" or "compile_step" (then pass step); optionally pass a short note describing the intent so your follow-up turn has context.',
    access: 'write',
    api: [ 'ai', 'runInBackground' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', enum: [ 'compile_all', 'compile_step' ] },
        step: {
          type: 'string',
          enum: [ 'cmm', 'asm', 'verilog', 'wave', 'prism', 'verilator-proc', 'verilator-fast' ],
          description: 'Required when task is compile_step'
        },
        note: {
          type: 'string',
          description: 'Short description of the goal, echoed back to you on completion'
        }
      },
      required: [ 'task' ]
    }
  },
  {
    name: 'ask_user_question',
    description: 'Pause the turn and ask the human a question with optional choices. Use this only when truly ambiguous — prefer doing things autonomously. Returns { answer, selected }. Use sparingly; do not chain.',
    access: 'read',
    api: [ 'ui', 'askUserQuestion' ],
    argStyle: 'object',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to display.' },
        options: {
          type: 'array',
          description: 'Optional list of pre-defined choices.',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, description: { type: 'string' } },
            required: [ 'label' ]
          }
        },
        multiSelect: { type: 'boolean', default: false }
      },
      required: [ 'question' ]
    }
  }
];
