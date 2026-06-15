// @ts-check
/**
 * Project lifecycle (open/close/create) e processor CRUD (main process).
 *
 * Per-project config: o .spf e a fonte canonica unica. Este modulo
 * cuida do lifecycle (open/close/create-project, create/delete-
 * processor) e reescreve o .spf nesses eventos. Mudancas de tree/
 * picker (synth files, top, testbench top) vivem no renderer via
 * SpfStore.update.
 *
 * The handlers are split by concern into sibling files — lifecycle.js
 * (open/close/create/getInfo/recents), processors.js (create/list/delete),
 * rename.js (rename-processor + rename-project) — plus helpers.js for the
 * shared .spf schema and path-remap/watcher/move utilities. This index just
 * wires them up. `register()` keeps the same single entry point main.js
 * calls; ProjectFile is re-exported for compatibility.
 */

const { ProjectFile } = require('./helpers');
const { registerLifecycle } = require('./lifecycle');
const { registerProcessors } = require('./processors');
const { registerRename } = require('./rename');

function register() {
  registerLifecycle();
  registerProcessors();
  registerRename();
}

module.exports = { register, ProjectFile };
