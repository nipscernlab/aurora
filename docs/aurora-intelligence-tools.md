# Ferramentas da Aurora Intelligence

<!-- GERADO por scripts/gen-ai-tools-doc.js. Nao edite a mao: a proxima
     execucao sobrescreve. Para mudar o texto de uma ferramenta, edite a
     `description` dela em main/ai/tools.js, que e o mesmo texto que o
     modelo le ao decidir se a chama. -->

A AURORA expoe 112 ferramentas ao modelo. Elas chegam ate ele por dois
caminhos, descritos abaixo.

Pelo caminho de API, o `main/ai/chat.js` liga este manifesto direto no Vercel
AI SDK. Pelo caminho de assinatura, as CLIs do Claude Code e do Codex so
conhecem as proprias ferramentas embutidas, entao o `aurora_mcp_server.js`
serve este mesmo manifesto por um servidor MCP local. Sem essa ponte o modelo
cairia para o shell, chamando os compiladores na mao.

A coluna de acesso separa o que so le do que escreve. Ferramentas de escrita
passam pelo cartao de permissao do painel, conforme o modo configurado.

## Projeto

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `analyze_asm` | read | `filePath`?, `processorName`? | Parse a SAPHO assembly (.asm) file and return a structured summary: total instruction count, count per opcode, count per family (memory/arith_float/arith_int/control/io/...), labels with line numbers, and detected loops (back-jumps with body size). Use this to find optimisation targets (the largest loops) and to verify an optimisation actually reduced the instruction count. Provide either filePath OR processorName; if neither, the active editor file is used (must be .asm). |
| `backup_project` | write | nenhum | Create a timestamped backup (.zip) of the currently open SAPHO project. Returns the absolute path of the archive. |
| `close_project` | write | nenhum | Close the project currently open and return the IDE to its empty state. The user still confirms in a dialog, and unsaved files are handled there, so this REQUESTS the close rather than forcing it. |
| `create_file` | write | `filePath`, `content`? | Create a new file (or overwrite an existing one) with the given content. |
| `create_folder` | write | `dirPath` | Create a directory, including any missing parent folders. Use a project-relative path; creating one that already exists is not an error. |
| `create_processor` | write | `processorName`, `nBits`?, `nbMantissa`?, `nbExponent`?, `dataStackSize`?, `instructionStackSize`?, `inputPorts`?, `outputPorts`?, `gain`? | Generate a processor in the open project. Hardware widths (nBits/nbMantissa/nbExponent) are in bits. |
| `create_project` | write | `name`, `location` | Create a new SAPHO project under location/name and open it. The name may contain only letters, numbers, underscore or hyphen. |
| `delete_file` | write | `filePath` | Delete a file or directory. |
| `delete_processor` | write | `processorName` | Delete a processor from the open project: removes its folder (Hardware/Simulation/Software + .cmm) and its SPF entries. Irreversible — prefer backup_project first. |
| `dismiss_missing_files` | write | nenhum | Dismiss the missing-files warning by pruning every dangling reference from the .spf (the synthesizable / testbench lists, plus the top-level / testbench pointers if they point at a missing file). The files are already gone from disk — this only cleans up the project's stale references, so the warning stops reappearing. Use only when the user has confirmed they deleted those files on purpose. Returns { removed }. |
| `forget` | write | `name` | Delete one project memory by name — use when a remembered fact turned out to be wrong or went stale. Returns { removed:false } when there was no such memory. |
| `get_current_project` | read | nenhum | Get the path and metadata of the SAPHO project currently open. |
| `get_missing_files` | read | nenhum | List the project's MISSING files — paths the .spf still references but that no longer exist on disk (moved, renamed, or deleted outside Aurora). Same list the file tree's missing-files warning shows, always current. Returns { count, files:[{name, path, category}] }; empty when nothing is missing. Use this to reason about a broken build or before offering to clean up dangling references with dismiss_missing_files. |
| `get_processor_config` | read | `processorName`? | Read the simulation config of one (or every) processor: clk (MHz), numClocks, simTime_us = numClocks/clk, showArrays, and the parsed CMM header directives (NUBITS, NBMANT, NBEXPO, ...). Omit processorName to get them all. |
| `get_project_tree` | read | nenhum | List ALL files in the open project recursively, as relative paths (e.g. "src/main.cmm"). Use this before read_file to get the exact path of any file. |
| `get_rename_status` | read | `jobId` | Get the progress and final result of a project rename started by rename_project. Pass the jobId that rename_project returned. Returns { status: "running" \| "done" \| "failed", done, steps (the phases completed so far), result }. Poll this until status is "done" (success — result.newName is the new name; a result.warning means only the file-tree auto-reload failed, not the rename itself) or "failed" (result.failedStep and result.reason say which step broke and why). |
| `get_tree_view` | read | nenhum | Report which tree view is active and whether the hierarchy view is available. |
| `import_file` | write | `filePath`, `kind`? | Register an existing .v / .sv / .vh / .py file as a synthesizable or testbench file in the current project SPF. Copies the file into the project root if it lives elsewhere. Python .py files are treated as cocotb testbenches. |
| `list_memories` | read | nenhum | List everything you were told to remember about THIS project (from <root>/.aurora/memory/). The same memories are already injected into your system prompt each turn, so call this only to audit or before forget(). |
| `list_processors` | read | nenhum | List the processors of the open project together with their configuration. |
| `list_recent_projects` | read | nenhum | List recently opened SAPHO projects with full .spf paths and human-friendly names. |
| `open_project` | write | `spfPath` | Open an existing SAPHO project by its .spf file path. |
| `read_file` | read | `filePath` | Read the full text of ANY file inside the open project folder, at any nesting depth — not just the focused editor tab. Use get_project_tree to discover paths first. |
| `refresh_file_tree` | write | nenhum | Force-repaint the project file tree. Use this after creating or importing files that are not yet showing up in the tree. |
| `remember` | write | `name`, `content` | Save ONE durable fact about this project to <root>/.aurora/memory/<name>.md, so it survives across chats. Use it for what the code and git do NOT already record: a decision and its rationale, a user preference about how to work, a constraint, an external reference. Do NOT save what a tool can re-derive (file lists, paths, compile output) or what only matters to the current turn. One fact per name; writing an existing name OVERWRITES it, which is how you update. Prefer updating a related memory over creating a near-duplicate. |
| `remove_imported_file` | write | `filePath`, `deleteFromDisk`? | Remove a file from the SPF synthesizable / testbench list. By default the file is kept on disk; set deleteFromDisk:true to also delete it. |
| `rename_file` | write | `fromPath`, `toPath` | Rename or move a file from one absolute path to another. |
| `rename_imported_file` | write | `fromPath`, `toPath` | Rename an imported file (in both the SPF list and on disk). |
| `rename_processor` | write | `processorName`, `newName` | Rename an existing processor everywhere SAPHO/Aurora cares: the processor working directory (<old> to <new>), the Software/<old>.cmm source file, the #PRNAME directive inside it, the auto-generated build artifacts (.asm, Hardware/<old>.v, Simulation/<old>_tb.v) and every reference in the .spf (the processors[] entry — clk/numClocks/showArrays are preserved — plus the top-level, testbench and synthesizable/testbench file path lists). User comments and code inside the .cmm are NOT touched, only the #PRNAME directive. Open editor tabs are re-pointed automatically. Custom user toplevels/testbenches at the project root are NOT renamed — use rename_file for those. |
| `rename_project` | write | `newName` | Rename the CURRENTLY OPEN SAPHO project everywhere: the project root folder (<location>/<old> → <location>/<new>), the <old>.spf project file, the .spf metadata (projectName/projectPath/basePath) and EVERY absolute path stored in the .spf. Processor folders move with the root, so their #PRNAME directives are untouched (use rename_processor for a processor). IMPORTANT: this starts a BACKGROUND JOB and returns IMMEDIATELY with a jobId — it does NOT wait for the rename to finish (waiting on it used to time out). After calling this you MUST call get_rename_status with the returned jobId, polling a few times if needed, until its status is "done" or "failed", to learn the real outcome and (on failure) the step and reason. The project reopens itself when the job completes. The name may contain only letters, numbers, underscore or hyphen. |
| `set_processor_config` | write | `processorName`, `clk`?, `numClocks`?, `showArrays`? | Update the clock frequency (clk, MHz), simulation length (numClocks), or array-debug flag of one processor. Aurora bakes `$finish` at `numClocks/clk` µs, so this is the lever to change total simulation time. Omitted fields keep their current value. |
| `set_testbench_top` | write | `filePath` | Mark a Verilog or cocotb Python file as the project's Testbench Top module (the simulation entry point). Registers the file in the project if it is not yet tracked, and refreshes the file tree. Call this after create_file and before compiling. Do NOT use on the auto-generated <proc>_tb.v inside <proc>/Simulation/ — that file is managed by SAPHO. |
| `set_top_level` | write | `filePath` | Mark a synthesizable Verilog file as the project's Top Level module (the synthesizable root). Registers the file in the project if it is not yet tracked, and refreshes the file tree. Call this after create_file and before compiling. Do NOT use on the auto-generated <proc>.v inside <proc>/Hardware/ — that file is managed by SAPHO. |
| `set_tree_view` | write | `mode` | Switch the left panel between the file tree and the post-synthesis hierarchy tree. The hierarchy view is only populated after a successful Verilog compilation — call compile_step("verilog") first if it is empty. |

## Editor

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `create_split` | write | nenhum | Create a new editor split pane. |
| `format_file` | write | `filePath`? | Reformat a file using Aurora's own formatter — the same one behind the wand button and Shift+Alt+F. Routes by language: clang-format for C, C++ and C± (C± borrows C rules), black for Python, Verible for Verilog. PREFER THIS over rewriting a file yourself when the only problem is layout: indentation, brace style, line breaks, spacing, alignment. Rewriting a whole file to fix its formatting is slow, risks dropping code, and buries the real change in a huge diff. Formats the buffer and saves. Omit filePath to format the focused file. Returns changed:false when the file was already formatted. |
| `get_active_file` | read | nenhum | Get the path of the file currently focused in the editor. |
| `get_cursor` | read | nenhum | Get the current cursor position (1-indexed line and column) in the active editor. |
| `get_open_files` | read | nenhum | List the file paths of every open editor tab. |
| `insert_text` | write | `text`, `position`? | Insert text into the active editor at a 1-indexed line/column. Omit position to insert at the cursor. |
| `open_file` | write | `filePath`, `inNewSplit`? | Open a project file in the editor. Set inNewSplit:true to open it in a new split pane. |
| `read_active_file` | read | nenhum | Read the full text content of the file currently focused in the editor. |
| `replace_range` | write | `startLine`, `startColumn`, `endLine`, `endColumn`, `text` | Replace a range of text in the active editor (1-indexed line/column, end-exclusive column). |
| `save_file` | write | nenhum | Save the active editor file to disk. |
| `write_active_file` | write | `text` | Replace the ENTIRE content of the active editor file. Prefer insert_text or replace_range for smaller edits. |

## Compilacao e simulacao

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `cancel_compilation` | write | nenhum | Cancel a running compilation or simulation. |
| `clear_command_override` | write | `step`, `processorName`?, `scope`? | Remove a registered override. `scope` controls which layer: "ephemeral" (in-memory only), "persisted" (.spf only), or "both" (default). |
| `compile_all` | write | nenhum | Run the full SAPHO compilation pipeline (CMM, ASM, Verilog, wave, PRISM). |
| `compile_step` | write | `step` | Run a single compilation step. "cmm" regenerates the .asm from .cmm and assembles; "asm" SKIPS cmmcomp and runs asmcomp + iverilog -tnull (use this to test an .asm you hand-optimised — typically combined with a `set_command_override` on the asm step's -i flag pointing at <proc>/Software/_aurora_opt/<proc>.asm); "verilog" elaborates the project Verilog; "wave" opens GTKWave; "prism" opens the PRISM RTL viewer; "verilator-proc" runs the ACTIVE processor's generated top-level under Verilator as a hardware test; "verilator-fast" runs the testbench headless under Verilator (no waveform, fastest). For the two Verilator simulations the dedicated run_verilator_proc / run_fast_sim tools are equivalent and clearer. |
| `get_run_status` | read | nenhum | Check whether the last compilation or simulation is still running, finished, or was CANCELLED by the user. Call this when a compile_* tool returned but no result ever appeared in the terminal: a cancelled run is not a failure and not a hang, so do not go looking for a bug that is not there. Returns state: running \| cancelled \| idle. |
| `inspect_compile_command` | read | `step`, `processorName`? | Return the structured CommandSpec ({binary, args, cwd, env, prependPath}) that would be executed for one toolchain step RIGHT NOW, including any override the AI or the user has registered. Includes a printable command line and a diff vs. the base spec. |
| `list_allowed_compile_binaries` | read | nenhum | List the binaries the main-process executor will spawn. Aurora Intelligence cannot redirect a step to a binary outside this allowlist — only flags and env are editable. |
| `list_command_overrides` | read | nenhum | List every registered command override across the ephemeral (in-memory, consumed on next run) and persisted (.spf, survives sessions) layers. |
| `list_compile_steps` | read | nenhum | Enumerate every toolchain step whose command line Aurora Intelligence can override (cmm, asm, iverilog-check, iverilog-build, vvp-run, verilator-build, verilator-run, fst2vcd, gtkwave, yosys-hierarchy, prism-yosys). Each entry includes a short description of when the step runs. |
| `list_protected_compile_flags` | read | `step`? | List the flags that the override system refuses to remove or stomp for one (or every) step — Aurora pipeline invariants like iverilog -o, gtkwave --script, verilator --binary. Omit step to get the whole table. |
| `preview_compile_command` | read | `step`, `override`, `processorName`? | Dry-run a hypothetical override on a step WITHOUT registering it. Returns the same shape as inspect_compile_command, but with the proposed override layered on top of the current state. Use this to show the user what the resulting command line would look like before calling set_command_override. |
| `run_fast_sim` | write | nenhum | Run the project testbench headless via Verilator with NO waveform and NO GTKWave — the "Fast Sim" toolbar button (id: fastsim), optimised purely for speed. Requires a testbench to be set (set_testbench_top). A Verilog testbench requires the simulator to be Verilator (set_simulator("verilator")); a Python cocotb (.py) testbench runs headless on any engine. Recompiles cmm+asm first when the top-level instantiates SAPHO processors. Output lands in the wave (twave) terminal; read it with get_terminal_output("twave"). For long runs prefer run_in_background({task:"compile_step", step:"verilator-fast"}). |
| `run_verilator_proc` | write | nenhum | Run the ACTIVE SAPHO processor's generated top-level (<proc>.v) under Verilator as a hardware test — the "Verilator (processor)" toolbar button (id: verilatorproc). Uses SAPHO's predictable wiring (req_in/out_en one-hot, decimal input_<N>.txt/output_<N>.txt in the processor's Simulation/ folder) and recompiles cmm+asm first so the .v/_tb.v/.mif are fresh. Acts on the processor currently focused/shown in the status bar — fails if no processor is active. Output lands in the hardware-test (thtest) terminal; read it with get_terminal_output("thtest"). This can be slow — for long runs prefer run_in_background({task:"compile_step", step:"verilator-proc"}). |
| `set_command_override` | write | `step`, `processorName`?, `appendArgs`?, `prependArgs`?, `removeArgs`?, `envSet`?, `envUnset`?, `persist`?, `note`? | Register an override for one toolchain step. By default the override is EPHEMERAL — consumed on the next time that step runs. Pass persist:true to write it into the .spf so it survives across sessions. Supplying both global (no processorName) and per-processor overrides for the same step is allowed; the per-processor one wins for that processor. Use preview_compile_command first to verify the resulting command line. The main-process executor re-checks protected flags before spawn — if the override would strip a pipeline-critical flag (iverilog -o, gtkwave --script, etc.), the step run fails with a clear error. |

## Formas de onda

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `add_gtkw_file` | write | `filePath`, `setActive`? | Register a .gtkw save file from anywhere inside the project tree for the active testbench. The file must exist and end in .gtkw. By default the freshly added entry becomes the active one. |
| `add_surfer_file` | write | `filePath`, `setActive`? | Register a Surfer layout from inside the project tree for the active testbench: a .surf.ron saved state (loaded with -s) or a .sucl command file (loaded with -c). The file must exist. By default the freshly added entry becomes the active one. |
| `create_gtkw_layout` | write | `name`, `signals`, `setActive`? | Create a GTKWave layout (.gtkw) from an explicit signal list, write it at the project root and register it for the active testbench. This is the GTKWave sibling of create_surfer_layout, and the counterpart of add_gtkw_file (which only registers a file that already exists). Note the division of labour: when no .gtkw is active, Aurora GENERATES a curated layout from the dump on every run (processors grouped, colours, decoded Assembly/C+- traces). Prefer that default; create a layout here when the user asked for specific signals in a specific order. Signals must exist in the dump — check with list_wave_signals first, since GTKWave silently omits a path it cannot find. |
| `create_surfer_layout` | write | `name`, `commands`, `open`?, `setActive`? | Create a Surfer command file (.sucl) that sets up a waveform view, register it for the active testbench and optionally open Surfer with it. Write ONE Surfer command per line (load_file, add_variable, zoom_fit, ...); see the Surfer command reference. NOTE: this deliberately writes .sucl and not .surf.ron — .surf.ron is the RON serialisation of Surfer's internal state, it has no published schema and changes between versions, while .sucl is documented and meant to be hand-written. To drop a layout later, use remove_surfer_file. |
| `find_gtkw_files` | read | `query`? | Find .gtkw save files anywhere inside the open project by name. The user only needs to give the file name — this resolves the full path. Pass a name fragment to filter, or omit it to list every .gtkw in the project. Returns project-relative and absolute paths. |
| `find_surfer_files` | read | `query`? | Find Surfer layout files (.surf.ron saved state, or .sucl command files) anywhere inside the open project by name. The user only needs to give the file name — this resolves the full path. Pass a name fragment to filter, or omit it to list every Surfer layout. Returns project-relative and absolute paths. |
| `get_simulator` | read | nenhum | Read which Verilog simulator the Wave button runs. Returns "iverilog" (bundled vvp/iverilog, default — slower but preserves every internal SAPHO signal) or "verilator" (bundled Verilator — 5-10x faster on long testbenches but elides internal signals; only top-level testbench signals stay visible). |
| `get_waveform_viewer` | read | nenhum | Read which waveform viewer the Wave button opens. Returns "gtkwave" (the bundled GTKWave fork — opens in an EXTERNAL window, the default) or "surfer" (the embedded Surfer viewer — shows the waves INSIDE the IDE). Both read the same VCD/FST; the viewer is independent of the simulator choice. |
| `list_gtkw_files` | read | nenhum | List .gtkw save files registered for the currently active testbench, with their active flag. |
| `list_surfer_files` | read | nenhum | List Surfer layout files (.surf.ron saved state / .sucl command file) registered for the active testbench, with their active flag. The Surfer counterpart of list_gtkw_files; used when the waveform viewer is Surfer. |
| `list_wave_signals` | read | nenhum | List every signal discovered for the current testbench and which are selected to be shown in GTKWave. |
| `open_surfer` | write | `file`, `layout`? | Open the Surfer waveform viewer on a specific .vcd/.fst file, in its own window. Optionally load a Surfer layout: a .surf.ron saved state or a .sucl command file. If surfer-aurora.exe is not installed it cleanly falls back to GTKWave, so this always produces a viewer. Pass an ABSOLUTE file path (find one with get_project_tree — e.g. a <proc>/Simulation/<proc>.vcd or a dump.fst). Unlike set_waveform_viewer (which only changes what the Wave button uses), this launches the viewer immediately on the file you name. |
| `open_wave_config` | write | nenhum | Open the Wave Configuration modal for the user. |
| `remove_gtkw_file` | write | `filePath` | Remove a .gtkw entry from the active testbench list. Does not delete the file from disk. |
| `remove_surfer_file` | write | `filePath` | Remove a Surfer layout entry from the active testbench list. Does not delete the file from disk. |
| `select_wave_signals` | write | `paths` | Choose exactly which signals are dumped into GTKWave (replaces the current selection and saves it). Use list_wave_signals first to get valid signal paths. |
| `set_active_gtkw_file` | write | `filePath`? | Pick which already-registered .gtkw file GTKWave loads when "wave" is run. Omit filePath to clear the selection (Aurora auto-generates a layout). |
| `set_active_surfer_file` | write | `filePath`? | Pick which already-registered Surfer layout the Surfer viewer loads when "wave" is run. Omit filePath to clear the selection (Surfer opens the raw VCD with no curated layout). |
| `set_simulator` | write | `simulator` | Switch which simulator the Wave button runs. Use "verilator" when a long simulation is dominating the dev loop AND only top-level testbench signals matter; use "iverilog" when you need full visibility of internal SAPHO signals (in_sim_*, me1_*, delta_*, …). The choice persists across app restarts; re-running Wave picks up the new simulator immediately. |
| `set_waveform_viewer` | write | `viewer` | Switch which waveform viewer the Wave button opens. Use "surfer" for the embedded viewer (waves inside the IDE, no external window); use "gtkwave" for the bundled GTKWave external window (the default, with the curated source/opcode/complex tracks). The choice persists across app restarts; re-running Wave picks up the new viewer immediately. |
| `use_gtkw_file` | write | `name` | Given just a .gtkw file NAME (with or without the .gtkw extension), locate it in the project, register it for the active testbench, and mark it active — all in one step, so the next "wave" run loads it. If the name matches several files the candidates are reported so you can pick a more specific one. This is the easiest way to set the .gtkw. |
| `use_surfer_file` | write | `name` | Given just a Surfer layout file NAME (.surf.ron or .sucl, with or without the extension), locate it in the project, register it for the active testbench, and mark it active — so the next "wave" run opens Surfer with it. If the name matches several files the candidates are reported. This is the easiest way to set the Surfer layout. |

## Terminais

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `get_terminal_output` | read | `terminalId`? | Read the visible text of a compiler terminal panel. Omit terminalId for the currently visible panel. |
| `list_terminals` | read | nenhum | List the ids of every compiler terminal panel. |
| `read_all_terminals` | read | nenhum | Read the visible text of EVERY terminal panel at once, keyed by id (tcmm, tasm, tveri, twave, ...). |
| `run_in_terminal` | write | `command`, `execute`? | Type — and optionally run — a command in the user's TCMD terminal: their REAL interactive shell (PowerShell on Windows), the one they can see, NOT a sandbox. Use execute:false to just place the command on the input line for the user to review and press Enter (great for "what's the command to compile in python again?"); execute:true (the default) runs it and returns a best-effort snapshot of the output. `cd` and environment changes PERSIST in the session, so you can navigate folders and chain commands. This is the human shell — for real SAPHO builds/sims prefer compile_all / compile_step / run_fast_sim; use this for ad-hoc shell commands, navigation, git one-offs, running the user's python, etc. |

## Configuracoes

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `get_settings` | read | nenhum | Read the user-facing IDE settings: locale, tooltips, verbose mode. |
| `set_setting` | write | `key`, `value` | Change one IDE setting and apply it immediately. Call list_settings first to see the valid keys and their current values — an unknown key is rejected rather than silently stored. |

## Regras da linguagem

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `get_directive` | read | `name` | Get the default value and description of one SAPHO hardware directive. |
| `get_opcode` | read | `mnemonic` | Look up one SAPHO assembly opcode by mnemonic (case-insensitive). |
| `list_directives` | read | nenhum | List all SAPHO hardware directives (NBMANT, NBEXPO, NUBITS, ...). |
| `list_opcodes` | read | nenhum | List every SAPHO assembly opcode (mnemonic, numeric opcode, operand kind, family classification, prefix variants, one-line description). Use this when reasoning about which instruction family dominates a loop and which alternative encoding might shrink it. |
| `lookup_compiler_message` | read | `code` | Look up a yanc compiler message by code (e.g. MSG_ERR_SYNTAX); returns its bilingual text and severity. |

## Git

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `git_branches` | read | nenhum | List the local and remote branches of the open project and which one is currently checked out. |
| `git_commit` | write | `message`, `amend`? | Commit the STAGED changes of the open project with a message. Only staged changes are committed — stage files first with git_stage. Pass amend:true to amend the previous commit instead. |
| `git_create_branch` | write | `name` | Create a new branch from the current HEAD and switch to it, in the open project. |
| `git_diff` | read | `file`?, `staged`? | Show the unified diff of one file (or the whole working tree if `file` is omitted) in the open project. Size-capped. Pass staged:true for the staged (index) diff instead of the working tree. |
| `git_discard` | write | `files` | DISCARD local changes to one or more files in the open project — IRREVERSIBLE (restores them to the last committed state). Prefer git_stash if the user might want the changes back. |
| `git_fetch` | write | nenhum | Fetch from the remote for the open project (updates remote-tracking branches; does not touch the working tree). |
| `git_log` | read | `limit`? | List recent commits of the open project (newest first): hash, subject, author and date. |
| `git_pull` | write | nenhum | Pull from the remote for the open project (fetch + merge, with --autostash). |
| `git_push` | write | nenhum | Push the current branch to the remote for the open project. |
| `git_stage` | write | `files` | Stage one or more files (add to the index) in the open project. Paths are relative to the repo root. |
| `git_stash` | write | `message`? | Stash the uncommitted changes of the open project (including untracked files). Restore later from the Source Control panel. |
| `git_status` | read | nenhum | Get the working-tree git status of the OPEN project: current branch, ahead/behind the remote, and the changed files — each with its index (staged) flag and working-tree flag (M=modified, A=added, D=deleted, R=renamed, ?=untracked) plus +/- line counts. Use this first to see what changed. |
| `git_switch_branch` | write | `name` | Switch the open project to an EXISTING branch (checkout). Commit or git_stash a dirty tree first. |
| `git_unstage` | write | `files` | Unstage one or more files (remove from the index, KEEP the changes) in the open project. |

## Diversos

| Ferramenta | Acesso | Parametros | O que faz |
|---|---|---|---|
| `ask_user_question` | read | `question`, `options`?, `multiSelect`? | Pause the turn and ask the human a question with optional choices. Use this only when truly ambiguous — prefer doing things autonomously. Returns { answer, selected }. Use sparingly; do not chain. |
| `install_example_projects` | write | nenhum | Create all five example projects on disk. The user picks the destination folder in a native dialog, so this never writes to a path chosen by the model; if they cancel, the result is { cancelled: true } and nothing was written. On success it returns the .spf path of each project, which open_project then opens. Existing projects are never overwritten. |
| `list_example_projects` | read | nenhum | List the five ready-made example projects that ship with AURORA: key, name, what each one teaches, the language, and which processors it carries. Use this to answer "what can I study here?" or to pick a starting point for a beginner, instead of describing a project from memory. |
| `read_manual_page` | read | `pagePath`, `options`? | Read one page of the SAPHO manual as plain text, by the path that search_manual returned (for example "avancado/dirac.html"). Long pages come back truncated, with truncated:true. |
| `run_in_background` | write | `task`, `step`?, `note`? | Run a long compile task in the BACKGROUND and return immediately so the current turn can end. When the task finishes, YOU are automatically given the result as a new turn and should report it to the user — i.e. start the work, tell the user you will report back, let the turn finish, and Aurora re-invokes you on completion. Use this for long compiles/simulations instead of blocking on compile_all/compile_step. task is "compile_all" or "compile_step" (then pass step); optionally pass a short note describing the intent so your follow-up turn has context. |
| `search_manual` | read | `query`, `options`? | Search the SAPHO manual that ships with AURORA and get the closest pages, each with a title, a path and a snippet. The manual covers the C+- language, the compile flow, waveforms, cocotb, PRISM and the IDE itself, in Portuguese. Prefer it over answering from memory whenever the question is about how SAPHO or AURORA work, then read the page with read_manual_page and answer from what it actually says. Accents in the query are optional. |
