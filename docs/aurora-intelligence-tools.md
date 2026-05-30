# Aurora Intelligence — Function Calling Reference

Complete reference for every tool available to Aurora Intelligence.  
Tools are dispatched via the Vercel AI SDK; each entry documents the name, access level, arguments, and usage examples.

---

## Access Levels

| Level | Behaviour |
|-------|-----------|
| `read` | Runs immediately, no confirmation prompt |
| `write` | Shows an inline confirmation card to the user before executing |

---

## READ Tools — Inspection & Discovery

### `get_active_file`
Returns the absolute path of the file currently focused in the Monaco editor.

```jsonc
// input: (no arguments)
// output example:
{ "ok": true, "path": "C:/Projects/MyProc/proc/Software/proc.cmm" }
```

---

### `get_open_files`
Lists every file path open as an editor tab.

```jsonc
// input: (no arguments)
// output: array of absolute paths
{ "ok": true, "files": ["C:/Projects/MyProc/proc/Software/proc.cmm", "..."] }
```

---

### `read_active_file`
Reads the full text content of the currently focused file.

```jsonc
// input: (no arguments)
// output:
{ "ok": true, "text": "#PRNAME proc\n#NUBITS 32\n..." }
```

---

### `get_cursor`
Returns the cursor position (1-indexed line and column) in the active editor.

```jsonc
// input: (no arguments)
// output:
{ "ok": true, "line": 14, "column": 5 }
```

---

### `get_terminal_output`
Reads the visible text of a compiler terminal panel.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `terminalId` | string | No | One of: `tcmm`, `tasm`, `tveri`, `twave`, `tprism`. Omit for the currently visible panel. |

```jsonc
// input:
{ "terminalId": "tcmm" }
// output:
{ "ok": true, "text": "[CMM] Compiled successfully.\n[CMM] Opcodes: 147" }
```

**Terminal IDs:**
- `tcmm` — CMM compiler (yanc cmmcomp) output
- `tasm` — Assembly compiler (yanc asmcomp) output
- `tveri` — Icarus Verilog simulation output
- `twave` — GTKWave launch output
- `tprism` — PRISM RTL viewer output

---

### `read_all_terminals`
Reads every terminal panel at once, keyed by ID.

```jsonc
// input: (no arguments)
// output:
{
  "ok": true,
  "terminals": {
    "tcmm": "[CMM] Done.",
    "tasm": "[ASM] Opcodes: 147",
    "tveri": "VCD info: dumpfile proc_tb.vcd opened for output.",
    "twave": "",
    "tprism": ""
  }
}
```

---

### `list_terminals`
Lists the IDs of every compiler terminal panel.

```jsonc
// input: (no arguments)
// output:
{ "ok": true, "terminals": ["tcmm", "tasm", "tveri", "twave", "tprism"] }
```

---

### `get_current_project`
Returns metadata of the currently open SAPHO project.

```jsonc
// input: (no arguments)
// output:
{
  "ok": true,
  "name": "MyProject",
  "spfPath": "C:/Projects/MyProject/MyProject.spf",
  "projectPath": "C:/Projects/MyProject"
}
```

---

### `get_project_tree`
Lists ALL files in the open project recursively as relative paths.  
**Always call this first** before `read_file` or `create_file` to discover the exact structure.

```jsonc
// input: (no arguments)
// output:
{
  "ok": true,
  "tree": [
    "MyProject.spf",
    "proc/Software/proc.cmm",
    "proc/Hardware/proc.v",
    "proc/Simulation/proc_tb.v",
    "proc/Software/proc.asm",
    "my_toplevel.v",
    "my_testbench.v"
  ]
}
```

---

### `read_file`
Reads the full text of ANY file inside the open project folder.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | Yes | Absolute path, or relative to the project root |

```jsonc
// input:
{ "filePath": "proc/Software/proc.cmm" }
// output:
{ "ok": true, "text": "#PRNAME proc\n..." }
```

---

### `analyze_asm`
Parses a SAPHO `.asm` and returns counts + structure the AI can plan optimisations against.

**Arguments** (provide one, otherwise the active editor's `.asm` is used):

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | No | Absolute or project-relative path to a `.asm` file |
| `processorName` | string | No | Resolves to `<root>/<proc>/Software/<proc>.asm` |

```jsonc
// input:
{ "processorName": "sqrt_newton" }
// output:
{
  "ok": true,
  "filePath": "C:/.../sqrt_newton/Software/sqrt_newton.asm",
  "total": 147,
  "byOpcode": { "LOD": 24, "F_MLT": 12, "F_ADD": 8, "JIZ": 4, "JMP": 6, ... },
  "byFamily": { "memory": 38, "arith_float": 24, "control": 9, "compare": 6 },
  "labels":   [ { "name": "main", "line": 11 }, { "name": "L3", "line": 30 } ],
  "loops":    [ { "label": "L3", "labelLine": 30, "branchLine": 41,
                  "branchMnemonic": "JMP", "bodyInstructions": 11 } ],
  "unknownMnemonics": []
}
```

Pair with `list_opcodes` to plan a rewrite (which `_M`/`P_`/`SET_P` variant collapses a pair into one), then write the candidate to `<proc>/Software/_aurora_opt/<proc>.asm` and run `compile_step("asm")` — see the ASM optimisation workflow in the system prompt for the full loop.

---

### `list_opcodes`
Lists every SAPHO assembly opcode (112 entries) with mnemonic, numeric opcode, operand kind, family classification, prefix variants, and a one-line description from yanc's `ASMComp.l`.

```jsonc
// input: (no arguments)
// output: array of opcode entries
{
  "ok": true,
  "value": [
    { "mnemonic": "LOD", "opcode": 0, "operandKind": "memory",
      "family": "memory", "variants": [], "description": "loads data from memory" },
    { "mnemonic": "P_LOD", "opcode": 1, "operandKind": "memory",
      "family": "memory", "variants": ["push_prefix"], "description": "PUSH + LOD" },
    ...
  ]
}
```

---

### `get_opcode`
Look up one opcode by mnemonic (case-insensitive).

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `mnemonic` | string | Yes | e.g. `F_MLT`, `P_LOD`, `NRM_M` |

```jsonc
// input:  { "mnemonic": "P_NEG_M" }
// output:
{
  "ok": true,
  "mnemonic": "P_NEG_M",
  "opcode": 39,
  "operandKind": "memory",
  "family": "arith_int",
  "variants": ["push_prefix", "mem_variant"],
  "description": "PUSH +   NEG_M"
}
```

---

### `list_processors`
Lists every processor in the project together with its simulation configuration and parsed CMM header.

```jsonc
// input: (no arguments)
// output:
{
  "ok": true,
  "processors": [
    {
      "name": "sqrt_newton",
      "clk": 100,
      "numClocks": 2000,
      "simTime_us": 20,
      "header": {
        "PRNAME": "sqrt_newton",
        "NUBITS": "32",
        "NBMANT": "23",
        "NBEXPO": "8",
        "NDSTAC": "5",
        "SDEPTH": "5",
        "NUIOIN": "1",
        "NUIOOU": "1",
        "NUGAIN": "128"
      }
    }
  ]
}
```

---

### `list_directives`
Lists all SAPHO hardware directives with their descriptions and default values.

```jsonc
// input: (no arguments)
// output:
{
  "ok": true,
  "directives": [
    { "name": "PRNAME", "description": "Processor name", "default": null },
    { "name": "NUBITS", "description": "Total data width in bits", "default": 32 },
    ...
  ]
}
```

---

### `get_directive`
Returns the default value and description of a single SAPHO hardware directive.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | Yes | Directive name, e.g. `NBMANT` |

```jsonc
// input:
{ "name": "NUGAIN" }
// output:
{ "ok": true, "name": "NUGAIN", "description": "Division constant for norm()", "default": 128 }
```

---

### `lookup_compiler_message`
Looks up a yanc compiler message by code and returns its bilingual text and severity.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `code` | string | Yes | Message code, e.g. `MSG_ERR_SYNTAX` |

```jsonc
// input:
{ "code": "MSG_ERR_SYNTAX" }
// output:
{ "ok": true, "code": "MSG_ERR_SYNTAX", "severity": "error", "pt": "Erro de sintaxe na linha %d", "en": "Syntax error on line %d" }
```

---

### `get_settings`
Reads current IDE settings.

```jsonc
// input: (no arguments)
// output:
{ "ok": true, "locale": "pt", "tooltipsEnabled": true, "verboseMode": false }
```

---

### `list_wave_signals`
Lists all signals discovered for the current testbench and which are selected for GTKWave.  
**Requires** a testbench top or top-level module to be set in the file tree first.

```jsonc
// input: (no arguments)
// output:
{
  "ok": true,
  "signals": [
    { "path": "tb.clk",          "selected": true },
    { "path": "tb.dut.acc",      "selected": true },
    { "path": "tb.dut.stack[0]", "selected": false }
  ]
}
```

---

## WRITE Tools — Workspace Mutation

### `write_active_file`
Replaces the ENTIRE content of the active editor file.  
Prefer `insert_text` or `replace_range` for partial edits.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | The complete new file content |

```jsonc
// input:
{
  "text": "#PRNAME MyProc\n#NUBITS 32\n...\nvoid main() { ... }"
}
```

---

### `insert_text`
Inserts text into the active editor at a specific position.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `text` | string | Yes | Text to insert |
| `position` | object | No | `{ "line": N, "column": N }` (1-indexed). Omit to insert at cursor. |

```jsonc
// input:
{
  "text": "    float temp = x;\n",
  "position": { "line": 22, "column": 1 }
}
```

---

### `replace_range`
Replaces a range of text in the active editor (1-indexed, end column exclusive).

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `startLine` | number | Yes | Start line (1-indexed) |
| `startColumn` | number | Yes | Start column (1-indexed) |
| `endLine` | number | Yes | End line (1-indexed) |
| `endColumn` | number | Yes | End column (exclusive) |
| `text` | string | Yes | Replacement text |

```jsonc
// input:
{ "startLine": 15, "startColumn": 5, "endLine": 15, "endColumn": 20, "text": "0.5 * (x + num/x)" }
```

---

### `save_file`
Saves the active editor file to disk.

```jsonc
// input: (no arguments)
```

---

### `open_file`
Opens a file in the editor. Optionally in a new split pane.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | Yes | Absolute or project-relative path |
| `inNewSplit` | boolean | No | `true` to open in a new split pane |

```jsonc
// input:
{ "filePath": "proc/Software/proc.cmm", "inNewSplit": false }
```

---

### `create_split`
Creates a new editor split pane.

```jsonc
// input: (no arguments)
```

---

### `create_file`
Creates a new file (or overwrites an existing one) with given content.  
`.v`, `.sv`, `.vh` files are automatically registered in the project's synthesizable file list and appear in the file tree immediately.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | Yes | Absolute path of the file |
| `content` | string | No | File content (empty if omitted) |

```jsonc
// input:
{
  "filePath": "C:/Projects/MyProject/sqrt_newton_top.v",
  "content": "module sqrt_newton_top(...);\n  ...\nendmodule"
}
```

> **NEVER** use paths inside `<proc>/Hardware/`, `<proc>/Simulation/`, or `<proc>/Software/` for custom files — those are overwritten by SAPHO on every compile.

---

### `set_top_level`
Marks a `.v` file as the project's **Top Level** synthesizable module.  
Moves the file to `synthesizableFiles` if it was in `testbenchFiles`, sets `isTopLevel=true` exclusively, and refreshes the file tree.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | Yes | Absolute or project-relative path to the `.v` file |

```jsonc
// input:
{ "filePath": "C:/Projects/MyProject/sqrt_newton_top.v" }
```

> Call after `create_file` and before `compile_all`.  
> Do NOT use on `<proc>/Hardware/<proc>.v` — that is managed by SAPHO.

---

### `set_testbench_top`
Marks a `.v` file as the project's **Testbench Top** simulation entry point.  
Moves the file to `testbenchFiles` if it was in `synthesizableFiles`, sets `isTopLevel=true` exclusively, and refreshes the file tree.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | Yes | Absolute or project-relative path to the testbench `.v` file |

```jsonc
// input:
{ "filePath": "C:/Projects/MyProject/sqrt_newton_test.v" }
```

> Call after `create_file` and before `compile_all`.  
> Do NOT use on `<proc>/Simulation/<proc>_tb.v` — that is managed by SAPHO.

---

### `compile_all`
Runs the full SAPHO compilation pipeline: CMM → ASM → Verilog → simulation → PRISM.

```jsonc
// input: (no arguments)
```

---

### `compile_step`
Runs a single compilation step.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `step` | string | Yes | One of: `cmm`, `verilog`, `wave`, `prism` |

| Step | What it does |
|------|-------------|
| `cmm` | CMM → Assembly (yanc cmmcomp + asmcomp) — overwrites `<proc>/Software/<proc>.asm` |
| `asm` | Assembly → Verilog (asmcomp + iverilog `-tnull`) — **SKIPS cmmcomp**, leaves the `.cmm` untouched. Use after `set_command_override` redirects asm `-i` at a hand-optimised `_aurora_opt/<proc>.asm` |
| `verilog` | Full elaboration (cmm + asm + iverilog `-tnull`) |
| `wave` | Full simulation + opens GTKWave with the `.vcd` dump |
| `prism` | Opens the PRISM RTL viewer |

```jsonc
// input:
{ "step": "cmm" }
```

---

### `cancel_compilation`
Cancels a running compilation or simulation.

```jsonc
// input: (no arguments)
```

---

### `create_folder`
Creates a directory.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `dirPath` | string | Yes | Absolute path of the directory |

---

### `delete_file`
Deletes a file or directory.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | string | Yes | Absolute path |

---

### `rename_file`
Renames or moves a file.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `fromPath` | string | Yes | Current absolute path |
| `toPath` | string | Yes | New absolute path |

---

### `create_processor`
Generates a processor scaffold in the open project (creates the directory structure and initial `.cmm` file).

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `processorName` | string | Yes | Processor name (letters, digits, `_`, `-`) |
| `nBits` | number | No | `#NUBITS` — total data width |
| `nbMantissa` | number | No | `#NBMANT` — mantissa bits |
| `nbExponent` | number | No | `#NBEXPO` — exponent bits |
| `dataStackSize` | number | No | `#NDSTAC` |
| `instructionStackSize` | number | No | `#SDEPTH` |
| `inputPorts` | number | No | `#NUIOIN` |
| `outputPorts` | number | No | `#NUIOOU` |
| `gain` | number | No | `#NUGAIN` — must be a power of 2 |

> **Constraint**: `nBits = nbMantissa + nbExponent + 1` (strict equality).  
> `gain` must be a power of 2: 1, 2, 4, 8, 16, 32, 64, 128, 256 …

---

### `rename_processor`
Renames an existing processor across **every** SAPHO/Aurora surface in one call.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `processorName` | string | Yes | Current processor name |
| `newName` | string | Yes | New name (letters, digits, `_`, `-`) |

What it changes:
- the processor working directory `<root>/<old>` → `<root>/<new>`
- the source file `Software/<old>.cmm` → `Software/<new>.cmm`
- the `#PRNAME` **directive** inside that `.cmm` (the directive line only — user comments and code are untouched)
- the auto-generated build artifacts (`<old>.asm`, `Hardware/<old>.v`, `Simulation/<old>_tb.v`) so no stale-named files linger; they regenerate on the next compile
- the `.spf`: the `processors[]` entry (its `clk` / `numClocks` / `showArrays` config is preserved) and any path reference (`topLevelFile`, `testbenchFile`, `synthesizableFiles`, `testbenchFiles`) that pointed inside the folder

Open editor tabs under the old folder are closed and the renamed `.cmm` is re-opened automatically.

```jsonc
// input:
{ "processorName": "sqrt", "newName": "sqrt_newton" }
// output:
{ "ok": true, "oldName": "sqrt", "newName": "sqrt_newton" }
```

> Custom user toplevels / testbenches that live at the project **root** are NOT renamed — rename those explicitly with `rename_file`.

---

### `create_project`
Creates a new SAPHO project and opens it.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `name` | string | Yes | Project name (letters, digits, `_`, `-`) |
| `location` | string | Yes | Parent directory for the new project folder |

---

### `open_project`
Opens an existing SAPHO project.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `spfPath` | string | Yes | Absolute path to the `.spf` project file |

---

### `set_setting`
Changes one IDE setting.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `key` | string | Yes | `locale`, `tooltipsEnabled`, or `verboseMode` |
| `value` | string or boolean | Yes | `"pt"` / `"en"` for locale; `true`/`false` for toggles |

---

### `select_wave_signals`
Sets exactly which signals are displayed in GTKWave (replaces the current selection).  
Always call `list_wave_signals` first to get valid signal paths.

**Arguments:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `paths` | string[] | Yes | Array of full signal paths, e.g. `["tb.clk", "tb.dut.acc"]` |

```jsonc
// input:
{ "paths": ["tb.clk", "tb.rst", "tb.dut.acc", "tb.dut.out_port[0]"] }
```

---

### `open_wave_config`
Opens the Wave Configuration modal for the user (so they can select signals manually).

```jsonc
// input: (no arguments)
```

---

## Canonical Workflows

### 1. Create a custom Verilog toplevel + testbench and compile

```
get_project_tree
  ↓ (discover project root and existing files)
create_file(filePath="<root>/my_top.v",       content="module my_top...")
create_file(filePath="<root>/my_top_test.v",  content="`timescale 1ns/1ps\nmodule my_top_test...")
set_top_level(filePath="<root>/my_top.v")
set_testbench_top(filePath="<root>/my_top_test.v")
compile_all()
```

### 2. Read compiler errors and iterate

```
compile_step("cmm")
  ↓
get_terminal_output("tcmm")
  ↓ (parse error, fix the .cmm)
write_active_file(text="...")
compile_step("cmm")
```

### 3. Open GTKWave with all signals

```
list_wave_signals()
  ↓ (get all signal paths)
select_wave_signals(paths=[...all paths...])
compile_step("wave")
```

### 4. Inspect a processor's configuration before suggesting changes

```
list_processors()
  ↓ (check clk, numClocks, simTime_us, header.NUBITS, header.NBMANT, etc.)
```

### 5. Optimise an `.asm` without losing it on the next CMM compile

```
analyze_asm(processorName="proc")                      // baseline: total + hot loop
  ↓
read_file("proc/Software/proc.asm")                    // grab the canonical asm
  ↓ (rewrite: collapse PSH+<op>_M into P_<op>_M, etc.)
create_file("proc/Software/_aurora_opt/proc.asm", ...) // sandbox; same basename
  ↓
set_command_override({
  step: "asm", processorName: "proc",
  removeArgs:  ["-i", "<root>/proc/Software/proc.asm"],
  appendArgs:  ["-i", "<root>/proc/Software/_aurora_opt/proc.asm"]
})
  ↓
compile_step("asm")                                    // asmcomp + iverilog -tnull
  ↓                                                    // (does NOT regenerate .asm from .cmm)
analyze_asm(filePath="<sandbox>/proc.asm")             // verify delta
  ↓ ok?   → rename_file(<sandbox>, <canonical>)        // promote
  ↓ bad?  → clear_command_override(step="asm",         // revert
                                   processorName="proc")
```

---

## Return Value Shape

All tools return a JSON object. On success:
```jsonc
{ "ok": true, ...data }
```
On failure:
```jsonc
{ "ok": false, "error": "Human-readable error message" }
```

Always check `ok` before using the data. If `ok === false`, report the error and explain the remediation step.
