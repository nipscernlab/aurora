/* eslint-disable no-undef */
// statusUpdater, checkCancellation, startCompilation, endCompilation are global
/**
 * compilation_module.js — toolchain orchestrator (renderer side).
 *
 * Expoe a classe CompilationModule, que e o "backend" dos botoes
 * disparados em compilation_flow.js. Cada metodo publico corresponde
 * a uma etapa da pipeline:
 *
 *   loadConfig()            le o .spf em this.projectConfig
 *   ensureDirectories(name) cria components/Temp/<name>
 *   cmmCompilation(proc)    cmmcomp.exe -> Software/<proc>.asm + cmm_log.txt
 *   asmCompilation(proc, ...)
 *                           appcomp + asmcomp -> Hardware/<proc>.v +
 *                           pc_<proc>_mem.txt + Simulation/<proc>_tb.v
 *   verilogSyntaxCheck()    iverilog -tnull (Verilog/PRISM/ASM) +
 *                           generateProjectHierarchy via Yosys.
 *   waveBuildVvp()          iverilog -o <sim>.vvp (Wave) com testbench
 *                           instrumentado + signal selection resolvida.
 *   runGtkWave()            8-fase pipeline _wave* — pre-compila vvp,
 *                           roda vvp, abre gtkwave (ver §9 de
 *                           ARCHITECTURE.md)
 *
 * Decisoes de design (post-2026-05):
 *
 *   1. Pipeline unico — sem branches "tem processador?". For-loops
 *      sobre processors[] sao no-op quando o array e vazio
 *      (projeto verilog puro). Branches estruturais foram
 *      removidos na fase 3.
 *
 *   2. .spf e a unica fonte de config. projectOriented.json e
 *      processorConfig.json (legado) foram consolidados no .spf.
 *      Defaults pra clk/numClocks/cmmFile estao hardcoded em
 *      precompileAllProcessors (compilation_flow.js).
 *
 *   3. synthesizableFiles[] (populado pelo file tree) ja inclui os
 *      .v dos processadores. -y components/HDL e sempre adicionado
 *      pra resolver a biblioteca SAPHO (processor.v, ula.v,
 *      myFIFO.v, etc) sem o usuario precisar listar.
 *
 *   4. runGtkWave esta dividido em 8 fases _wave*. Cada fase tem
 *      JSDoc com inputs/returns/throws/side-effects. Mudancas de
 *      comportamento da wave-flow pertencem dentro de uma fase. Ver
 *      ARCHITECTURE.md §9 pro racional.
 */
import { TabManager } from '../tabs/tab_manager.js';
import { EditorManager } from '../editor/monaco_editor.js';
import { TerminalManager } from '../terminal/terminal_module.js';
import { parseVcdHeaderFromContent } from '../wave/vcd_parser.js';
import { SpfStore } from '../project/spf_store.js';
import { extractSignalRefs } from '../wave/gtkw_writer.js';
import { buildAuroraGtkw, detectProcessors } from '../wave/gtkw_proc_writer.js';
import {
  instrumentTestbenchSource, hasUserDumpCalls,
} from '../wave/testbench_instrumenter.js';
import { validateSelection } from '../wave/selection_validator.js';
import { parseVerilogModules, buildHierarchyTree } from '../wave/signal_parser.js';
import { WaveStore } from '../wave/wave_state_store.js';
import { getSimulator } from '../wave/simulator_preference.js';
import { runSpec, runSpecStreamed } from './spec_runner.js';
import {
  buildCmmSpec,
  buildAsmPreSpec, buildAsmSpec,
  buildIverilogCheckSpec, buildIverilogBuildSpec,
  buildVvpHeaderSpec, buildVvpRunSpec,
  buildCocotbRunSpec,
  buildVerilatorBuildSpec, buildVerilatorHeaderSpec, buildVerilatorRunSpec,
  buildVerilatorJsonSpec, buildVerilatorTbBuildSpec, buildVerilatorTbRunSpec,
  buildFst2VcdSpec, buildGtkwaveSpec,
  buildYosysHierarchySpec,
} from './builders/index.js';
import {
  parseVerilatorPorts,
  parseProcessorIO, generateVerilatorProcTb,
} from './verilator_tb.js';
import * as CommandSpec from './command_spec.js';

function basenameOfPath(filePath) {
    return String(filePath || '').split(/[\\/]/).pop();
}

function moduleStemFromPath(filePath) {
    return basenameOfPath(filePath).replace(/\.[^.]+$/i, '');
}

function isPythonFile(filePath) {
    return /\.py$/i.test(String(filePath || ''));
}

// Insere a diretiva `#TOAQUI` logo antes do `}` que fecha a funcao main()
// de um fonte C±. O #TOAQUI faz o compilador pulsar o pino `cheguei` no fim
// do programa — usado pelo harness do botao Verilator pra encerrar a sim
// assim que o programa termina. Acha o `}` casando chaves a partir de
// `main(`, ignorando `//` e `/* */`. Retorna o texto original inalterado se
// nao achar o main ou se as chaves nao fecharem (nao instrumenta as cegas).
function insertChegueiToaqui(src) {
    const s = String(src || '');
    // Definicao de main (nao uma chamada num comentario): tipo de retorno
    // explicito antes de `main(`.
    const m = /\b(?:void|int)\s+main\s*\([^)]*\)\s*\{/.exec(s);
    if (!m) return s;
    let i = m.index + m[0].length; // logo apos o `{` de abertura
    let depth = 1;
    while (i < s.length && depth > 0) {
        const c = s[i];
        const n = s[i + 1];
        if (c === '/' && n === '/') {            // comentario de linha
            const nl = s.indexOf('\n', i);
            i = nl === -1 ? s.length : nl;
            continue;
        }
        if (c === '/' && n === '*') {            // comentario de bloco
            const end = s.indexOf('*/', i + 2);
            i = end === -1 ? s.length : end + 2;
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) break; }
        i++;
    }
    if (depth !== 0) return s;                   // chaves desbalanceadas — desiste
    return `${s.slice(0, i)}\n    #TOAQUI\n${s.slice(i)}`;
}

function isVerilogLikeFile(filePath) {
    return /\.(v|sv|vh)$/i.test(String(filePath || ''));
}

function assertPythonModuleName(filePath) {
    const stem = moduleStemFromPath(filePath);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(stem)) {
        throw new Error(`cocotb testbench file name must be a valid Python module name: ${basenameOfPath(filePath)}`);
    }
    return stem;
}

function safeNamePart(name) {
    return String(name || 'cocotb')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'cocotb';
}


// i18n shim — falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

class CompilationModule {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.projectConfig = null;
        // Reuse the single global TerminalManager. CompilationModule is
        // reconstructed on every compile, and a fresh TerminalManager per
        // instance fragmented the shared terminal state (messageCounts,
        // currentSessionCards, updatableCards) across instances even though
        // they all drive the SAME terminal DOM. Per-compile reset is explicit
        // via clearTerminal(), so one long-lived owner is both correct and
        // leak-free. initializeGlobalTerminalManager() is a lazy singleton;
        // fall back to a local instance only outside the renderer.
        this.terminalManager = (typeof window !== 'undefined' && window.initializeGlobalTerminalManager)
            ? window.initializeGlobalTerminalManager()
            : new TerminalManager();
        this.hierarchyData = null;
        this.isHierarchicalView = false;
        this.gtkwaveProcess = null;
        this.hierarchyGenerated = false;
        this._hierarchyGenerationInProgress = false;
        this.componentsPath = null;
        this.initializeComponentsPath();

        // Pin this instance as "the latest" — the file-tree view
        // controller's hierarchy renderer delegates to whatever
        // CompilationModule lives here. New compile click =
        // new instance = new pin = freshest data.
        if (typeof window !== 'undefined') {
            window._latestCompilationModule = this;
        }
    }

    static extractFileInfoFromSource(sourceAttr) {
        if (!sourceAttr) return null;

        const match = sourceAttr.match(/^(.+\.v):(\d+)\.\d+(?:-\d+\.\d+)?$/);
        if (!match) return null;

        return {
            filePath: match[1],
            lineNumber: parseInt(match[2], 10)
        };
    }

    static async openModuleFile(filePath, lineNumber = null) {
        try {
            const fileExists = await window.electronAPI.fileExists(filePath);
            if (!fileExists) {
                this.terminalManager.appendToTerminal('tveri',
                    tr('terminal.veri.fileNotFound', { path: filePath }), 'error');
                return;
            }

            const content = await window.electronAPI.readFile(filePath, {
                encoding: 'utf8'
            });

            TabManager.addTab(filePath, content);

            if (lineNumber) {
                setTimeout(() => {
                    const editor = EditorManager.getEditorForFile(filePath);
                    if (editor) {
                        this.goToLineInEditor(editor, lineNumber);
                    }
                }, 100);
            }

        } catch (error) {
            console.error('Error opening module file:', error);
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.failedToOpen', { message: error.message }), 'error');
        }
    }

    static goToLineInEditor(editor, lineNumber) {
        if (!editor) return;

        const model = editor.getModel();
        if (!model) return;

        const totalLines = model.getLineCount();
        const targetLine = Math.max(1, Math.min(lineNumber, totalLines));

        editor.setPosition({
            lineNumber: targetLine,
            column: 1
        });

        editor.revealLineInCenter(targetLine);

        editor.focus();

        editor.setSelection({
            startLineNumber: targetLine,
            startColumn: 1,
            endLineNumber: targetLine,
            endColumn: model.getLineMaxColumn(targetLine)
        });
    }

    async initializeComponentsPath() {
        if (!this.componentsPath) {
            this.componentsPath = await window.electronAPI.getComponentsPath();
        }
    }


    async monitorGtkwaveProcess() {
        if (!this.gtkwaveProcess) return;

        const checkInterval = setInterval(async () => {
            try {
                const isRunning = await window.electronAPI.isProcessRunning(this.gtkwaveProcess);

                if (!isRunning) {
                    clearInterval(checkInterval);

                    if (this.isHierarchicalView) {
                        this.terminalManager.appendToTerminal('twave',
                            tr('terminal.wave.gtkwaveClosed'), 'info');

                        setTimeout(() => {
                            this.isHierarchicalView = false;
                            window.fileTreeViewController?.showFileMode?.();
                        }, 500);
                    }

                    this.gtkwaveProcess = null;
                    this.hierarchyGenerated = false;
                }
            } catch (error) {
                clearInterval(checkInterval);
                console.error('Error monitoring GTKWave process:', error);
            }
        }, 2000);
    }

async generateProjectHierarchy() {
    // Hierarchy generation runs whenever there's at least one synthesizable
    // file — Yosys can build a hierarchy from any user .v. The yosys
    // script below handles the no-files case implicitly (empty
    // read_verilog → yosys errors out, caught by the surrounding
    // try/catch).
        try {
            if (!this.projectConfig) throw new Error("Project configuration not loaded");

            const topLevelFilePath = this.projectConfig.topLevelFile;
            if (!topLevelFilePath) throw new Error("'topLevelFile' not found in .spf");

            const designTopModule = moduleStemFromPath(topLevelFilePath);
            const yosysPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');
            const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');

            // components/HDL/ tem a biblioteca SAPHO (myFIFO, processor,
            // core, ula, addr_dec, instr_dec, etc) — modulos referenciados
            // pelo design do usuario mas nao listados em
            // synthesizableFiles. Sem incluir esses .v no read_verilog,
            // o yosys faz blackbox automatico mas nao cria entry em
            // modules[], entao parseYosysHierarchy os trata como
            // primitivos e eles somem da arvore (`hierarchy -libdir`
            // existe na doc mas nao funciona nessa versao bundled).
            //
            // `hierarchy -top` remove modulos nao alcancaveis depois,
            // entao incluir HDL/* todo nao polui o JSON final.
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            let hdlReadCmds = '';
            try {
                const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlPath);
                if (Array.isArray(hdlEntries)) {
                    const hdlVerilogPaths = await Promise.all(
                        hdlEntries
                            .filter((n) => typeof n === 'string' && n.endsWith('.v') && !n.includes('_tb'))
                            .map((n) => window.electronAPI.joinPath(hdlPath, n)),
                    );
                    hdlReadCmds = hdlVerilogPaths
                        .map((p) => `read_verilog -sv "${p}"`)
                        .join('\n');
                }
            } catch (_e) {
                this.terminalManager.appendToTerminal(
                    'tveri',
                    tr('terminal.veri.hdlListWarn', { path: hdlPath }),
                    'warning',
                );
            }

            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchyGen'));

            const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
            const yosysScript = `
                ${hdlReadCmds}
                ${synthesizableFiles.map(file => `read_verilog -sv "${file.path}"`).join('\n')}
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempBaseDir}\\project_hierarchy.json"
            `;

            const scriptPath = await window.electronAPI.joinPath(tempBaseDir, 'project_hierarchy_gen.ys');
            await window.electronAPI.writeFile(scriptPath, yosysScript);

            const hierSpec = buildYosysHierarchySpec({
                yosysPath,
                scriptPath,
                cwd: tempBaseDir,
            });
            const result = await runSpec(hierSpec, { consumeEphemeral: true });

            if (result.code !== 0) throw new Error(tr('error.compilation.yosysProjectFailed'));

            const jsonPath = await window.electronAPI.joinPath(tempBaseDir, 'project_hierarchy.json');
            const hierarchyJson = JSON.parse(await window.electronAPI.readFile(jsonPath, {
                encoding: 'utf8'
            }));

            this.hierarchyData = this.parseYosysHierarchy(hierarchyJson, designTopModule);
            window.fileTreeViewController?.setHierarchyData?.(this.hierarchyData);
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchySuccess'), 'success');
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchyError', { message: error.message }), 'warning');
            return false;
        }
    }


    parseYosysIdentifier(yosysName) {
        let cleanName = yosysName;
        let filePath = null;
        const pathRegex = /([a-zA-Z]:\\[^:]+\.v)|(\/[^:]+\.v)/;
        const match = yosysName.match(pathRegex);
        if (match) filePath = match[1] || match[2] || null;
        if (filePath) cleanName = cleanName.split(filePath)[0];
        if (cleanName.startsWith('$paramod')) {
            const parts = cleanName.split('\\');
            if (parts.length >= 2) cleanName = parts[1];
        }
        cleanName = cleanName.replace(/\$[a-f0-9]{32,}/g, '').replace(/^\$[0-9]+\$/g, '').replace(/[$\\]+$/, '').replace(/^[$\\]+/, '');
        if (!cleanName.trim()) cleanName = yosysName.split('\\').pop() || 'unknown';
        return {
            cleanName,
            filePath
        };
    }

    parseYosysHierarchy(jsonData, topLevelModule) {
        const modules = jsonData.modules || {};
        const memo = new Map();

        const PRIMITIVE_PATTERNS = [
            /^\$_/,
            /^\$paramod\$_/,
            /^\$lut/i,
            /^\$(and|or|xor|not|buf|mux|add|sub|mul|div|mod|pow|eq|ne|lt|le|gt|ge)/i,
            /^\$(dff|dffe|adff|adffe|sdff|sdffe|dlatch|dlatchsr)/i,
            /^\$(mem|memrd|memwr)/i,
            /^\$(assert|assume|cover|check)/i,
            /^\$reduce_/i,
            /^\$logic_/i,
            /^\$shift/i,
        ];

        const isPrimitive = (moduleName) => {
            const cleanName = this.parseYosysIdentifier(moduleName).cleanName;

            if (PRIMITIVE_PATTERNS.some(pattern => pattern.test(cleanName))) {
                return true;
            }

            if (!modules[moduleName]) {
                return true;
            }

            const moduleData = modules[moduleName];

            if (!moduleData.attributes || !moduleData.attributes.src) {
                const hasCells = moduleData.cells && Object.keys(moduleData.cells).length > 0;
                return !hasCells;
            }

            return false;
        };

        const buildDefinitionTree = (moduleName) => {
            if (memo.has(moduleName)) return memo.get(moduleName);

            if (isPrimitive(moduleName)) {
                return null;
            }

            const moduleData = modules[moduleName];
            const {
                cleanName,
                filePath
            } = this.parseYosysIdentifier(moduleName);

            if (!moduleData) return null;

            let sourceFilePath = filePath;
            let sourceLineNumber = null;

            if (moduleData.attributes && moduleData.attributes.src) {
                const fileInfo = this.constructor.extractFileInfoFromSource(moduleData.attributes.src);
                if (fileInfo) {
                    sourceFilePath = fileInfo.filePath;
                    sourceLineNumber = fileInfo.lineNumber;
                }
            }

            const definitionNode = {
                name: cleanName,
                filePath: sourceFilePath,
                lineNumber: sourceLineNumber,
                children: []
            };

            memo.set(moduleName, definitionNode);

            const cells = moduleData.cells || {};
            for (const [cellName, cellData] of Object.entries(cells)) {
                const subModuleDefinition = buildDefinitionTree(cellData.type);

                if (subModuleDefinition) {
                    const instanceNode = {
                        instanceName: this.parseYosysIdentifier(cellName).cleanName,
                        type: 'instance',
                        moduleDefinition: subModuleDefinition
                    };
                    definitionNode.children.push(instanceNode);
                }
            }

            return definitionNode;
        };

        const originalTopLevelName = Object.keys(modules).find(key =>
            this.parseYosysIdentifier(key).cleanName === topLevelModule
        );

        if (!originalTopLevelName) {
            console.error(`Top module "${topLevelModule}" not found.`);
            return {
                name: topLevelModule,
                filePath: null,
                lineNumber: null,
                children: []
            };
        }

        const hierarchyTree = buildDefinitionTree(originalTopLevelName);

        console.log(`Hierarchy built: ${memo.size} user modules found`);

        return hierarchyTree;
    }

    renderHierarchicalTree() {
        // Hierarchy view owns its dedicated subcontainer inside
        // #file-tree. Each view is in its own subtree so we can
        // freely innerHTML='' our own without touching the standard
        // tree or the verilog picker. See js/tree/tree_view.js.
        const hostContainer = window.treeView?.getContainer('hierarchy');
        if (!hostContainer) return;

        // Single source of truth for hierarchy data: the file-tree
        // view controller. Per-instance `this.hierarchyData` is just
        // a freshness shortcut for the compile that produced it —
        // the controller's slot survives the per-compile reconstruction
        // of CompilationModule.
        const hierarchyData = this.hierarchyData ?? window.fileTreeViewController?.getHierarchyData?.();
        if (!hierarchyData) return;

        // Preserve expand/collapse state across view switches. The
        // controller re-invokes this renderer every time the hierarchy
        // view becomes active (it's the 'hierarchy' renderer in the
        // toggle cycle); a full rebuild would reset every node back to
        // the default "only top level expanded" layout — exactly the
        // "it collapses when I come back" bug. So if the DOM already
        // reflects this exact hierarchy data object, leave it alone.
        // Only a new compile (new parsed object → different reference)
        // forces a rebuild.
        if (hostContainer.__auroraHierarchyData === hierarchyData
            && hostContainer.querySelector('.hierarchy-container')) {
            return;
        }
        hostContainer.__auroraHierarchyData = hierarchyData;

        hostContainer.innerHTML = '';

        const container = document.createElement('div');
        container.className = 'hierarchy-container';

        const topLevelInstance = {
            instanceName: hierarchyData.name,
            type: 'instance',
            moduleDefinition: hierarchyData
        };

        const topItem = this.createHierarchyItem(topLevelInstance, 'top-level', 'fa-solid fa-microchip', true);

        topItem.setAttribute('data-type', 'top-level');

        container.appendChild(topItem);

        this.buildHierarchyTree(topItem, hierarchyData);

        hostContainer.appendChild(container);
    }

    buildHierarchyTree(parentItem, moduleDefinition) {
        if (!moduleDefinition.children || moduleDefinition.children.length === 0) {
            return;
        }

        const childrenContainer = parentItem.querySelector('.hierarchy-children');
        if (!childrenContainer) return;

        const sortedInstances = [...moduleDefinition.children].sort((a, b) => {
            const nameA = a?.instanceName || '';
            const nameB = b?.instanceName || '';
            return nameA.localeCompare(nameB);
        });

        for (const instanceNode of sortedInstances) {
            const childItem = this.createHierarchyItem(instanceNode, 'module', 'fa-solid fa-cube');

            childItem.setAttribute('data-type', 'module');

            childrenContainer.appendChild(childItem);

            this.buildHierarchyTree(childItem, instanceNode.moduleDefinition);
        }
    }

    createHierarchyItem(instanceNode, type, icon, isExpanded = false) {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'hierarchy-item';

        const moduleDef = instanceNode.moduleDefinition;

        if (moduleDef.filePath) {
            itemContainer.setAttribute('data-filepath', moduleDef.filePath);
            if (moduleDef.lineNumber) {
                itemContainer.setAttribute('data-linenumber', moduleDef.lineNumber);
            }
        }

        const itemElement = document.createElement('div');
        itemElement.className = 'hierarchy-item-content';

        const hasChildren = moduleDef.children && moduleDef.children.length > 0;

        if (hasChildren) {
            const toggle = document.createElement('span');
            toggle.className = `hierarchy-toggle ${isExpanded ? 'expanded' : ''}`;
            // The affordance is now a curved-tree node (hollow when
            // collapsed, filled accent when expanded) drawn via the
            // ::before pseudo in h_tree.css. No glyph child needed.
            toggle.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleHierarchyItem(itemContainer);
            });
            itemElement.appendChild(toggle);
        } else {
            itemElement.appendChild(document.createElement('span')).className = 'hierarchy-spacer';
        }

        itemElement.appendChild(document.createElement('span')).className = 'hierarchy-icon';
        itemElement.querySelector('.hierarchy-icon').innerHTML = `<i class="${icon}"></i>`;

        const label = document.createElement('span');
        label.className = 'hierarchy-label';
        label.textContent = instanceNode.instanceName === moduleDef.name ?
            moduleDef.name :
            `${instanceNode.instanceName} (${moduleDef.name})`;
        itemElement.appendChild(label);

        itemContainer.appendChild(itemElement);
        itemContainer.appendChild(document.createElement('div')).className =
            `hierarchy-children ${isExpanded ? 'expanded' : 'collapsed'}`;

        if (moduleDef.filePath) {
            itemElement.style.cursor = 'pointer';

            const fileName = moduleDef.filePath.split(/[\\/]/).pop();
            itemElement.title = `Click to open ${fileName}`;

            itemElement.addEventListener('click', async (e) => {
                if (e.target.closest('.hierarchy-toggle')) return;

                const filePath = itemContainer.getAttribute('data-filepath');
                const lineNumber = itemContainer.getAttribute('data-linenumber');

                if (filePath) {
                    await this.constructor.openModuleFile(
                        filePath,
                        lineNumber ? parseInt(lineNumber, 10) : null
                    );
                }
            });
        }

        return itemContainer;
    }

    toggleHierarchyItem(itemElement) {
        const toggle = itemElement.querySelector('.hierarchy-toggle');
        const children = itemElement.querySelector('.hierarchy-children');
        if (!toggle || !children) return;

        const isExpanded = children.classList.contains('expanded');
        children.classList.toggle('expanded', !isExpanded);
        children.classList.toggle('collapsed', isExpanded);
        toggle.classList.toggle('expanded', !isExpanded);
    }

async loadConfig() {
    try {
        const projectInfo = await window.electronAPI.getCurrentProject();
        const currentProjectPath = projectInfo.projectPath || this.projectPath;

        if (!currentProjectPath) {
            throw new Error('No current project path available for loading configuration');
        }

        // .spf — fonte canonica unica. projectOriented.json (legado) e
        // processorConfig.json (legado) foram consolidados no .spf.
        // Defaults pra cmm/asm (cmmFile=`${proc}.cmm`, clk=100,
        // numClocks=2000) sao hardcoded em precompileAllProcessors.
        const spfPath = projectInfo.spfPath;
        try {
            if (!spfPath) throw new Error('No spf path');
            this.projectConfig = await SpfStore.read(spfPath);
        } catch (error) {
            console.warn("Could not load .spf:", error);
            this.projectConfig = null;
        }
    } catch (error) {
        console.error("Failed to load configuration:", error);
        throw error;
    }
}

    async ensureDirectories(name) {
        try {
            const componentsDir = await window.electronAPI.joinPath('components');
            await window.electronAPI.mkdir(componentsDir);
            const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
            await window.electronAPI.mkdir(tempBaseDir);
            const tempProcessorDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
            await window.electronAPI.mkdir(tempProcessorDir);
            return tempProcessorDir;
        } catch (error) {
            console.error("Failed to ensure directories:", error);
            throw error;
        }
    }

    async getSelectedCmmFile(processor) {
        if (!processor.cmmFile) {
            throw new Error(tr('error.config.noCmm'));
        }
        return processor.cmmFile;
    }

    /**
     * Resolve qual testbench o asmCompilation vai copiar pra
     * <proj>/<proc>/Simulation/. Duas formas:
     *
     *   - processor.testbenchFile e um path absoluto → usa direto
     *     (testbench custom, salvo no .spf).
     *   - caso contrario → convencao "<cmmBase>_tb.v" dentro de
     *     <proj>/<proc>/Simulation/ (testbench auto-gerado pelo
     *     asmcomp).
     */
    async getTestbenchInfo(processor, cmmBaseName) {
        let tbModule, tbFile;
        const testbenchFilePath = processor.testbenchFile;

        if (testbenchFilePath && testbenchFilePath !== 'standard') {
            tbFile = testbenchFilePath;
            const tbFileName = testbenchFilePath.split(/[\\\\/]/).pop();
            tbModule = moduleStemFromPath(tbFileName);
        } else {
            tbModule = `${cmmBaseName}_tb`;
            const simulationPath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Simulation');
            tbFile = await window.electronAPI.joinPath(simulationPath, `${tbModule}.v`);
        }

        return {
            tbModule,
            tbFile
        };
    }

    /**
     * Garante que o .cmm tenha #TOAQUI antes do `}` de main() — sem isso o
     * pino `cheguei` nao vira porta do <proc>.v e o harness do botao Verilator
     * nao consegue detectar o fim do programa. Idempotente: se ja houver
     * #TOAQUI em qualquer lugar do arquivo, nao mexe. Roda DEPOIS do
     * saveAllFiles (sem corrida) e sincroniza o buffer do editor aberto pra
     * que um save manual posterior nao derrube a instrumentacao.
     *
     * @param {string} softwarePath  <proj>/<proc>/Software
     * @param {string} cmmFile       nome do .cmm (ex: ProcDTW.cmm)
     */
    async _ensureChegueiToaqui(softwarePath, cmmFile) {
        const cmmPath = await window.electronAPI.joinPath(softwarePath, cmmFile);
        let src;
        try {
            src = await window.electronAPI.readFile(cmmPath, { encoding: 'utf8' });
        } catch (_e) {
            return; // sem .cmm — o proprio cmmcomp vai reclamar adiante
        }

        if (/#TOAQUI\b/.test(src)) {
            this.terminalManager.appendToTerminal('thtest',
                tr('terminal.htest.toaquiPresent', { file: cmmFile }), 'plain', { internal: true });
            return;
        }

        const out = insertChegueiToaqui(src);
        if (out === src) {
            this.terminalManager.appendToTerminal('thtest',
                tr('terminal.htest.toaquiNoMain', { file: cmmFile }), 'warning');
            return;
        }

        await window.electronAPI.writeFile(cmmPath, out);
        // Mantem o editor em sincronia com o disco (se o .cmm estiver aberto),
        // pra que um Ctrl+S posterior nao reescreva sem o #TOAQUI.
        const model = window.SharedModelRegistry?.getModel?.(cmmPath)
            ?? window.EditorManager?.getEditorForFile?.(cmmPath)?.getModel?.();
        if (model && model.getValue() !== out) model.setValue(out);

        this.terminalManager.appendToTerminal('thtest',
            tr('terminal.htest.toaquiAdded', { file: cmmFile }), 'info');
    }

    async cmmCompilation(processor) {
        const { name, showArrays } = processor;
        await this.terminalManager.clearTerminal('tcmm');

        this.terminalManager.appendToTerminal('tcmm', tr('terminal.cmm.starting', { name }));
        
        try {
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            
            // 1. Caminhos
            const macrosPath = await window.electronAPI.joinPath(this.componentsPath, 'Macros');
            
            // Define o caminho da pasta temporária específica do processador: components/Temp/{name}
            const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
            
            // 2. NOVA LÓGICA: Criar a pasta Temp/{name} se não existir
            // O parâmetro { recursive: true } no backend garante que cria a pasta 'Temp' e a subpasta '{name}'
            await window.electronAPI.createDirectory(tempPath);

            const cmmCompPath = await window.electronAPI.joinPath(this.componentsPath, 'bin', 'cmmcomp.exe');
            const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
            const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
            const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);

            await TabManager.saveAllFiles();

            // Botao Verilator: instrumenta o .cmm do processador-alvo com
            // #TOAQUI (pino `cheguei` no fim do programa) ANTES do cmmcomp.exe
            // ler o arquivo. Aqui — depois do saveAllFiles — pra que o save
            // nao sobrescreva a instrumentacao com o buffer do editor. Idem-
            // potente: pula se ja houver #TOAQUI em qualquer lugar.
            if (this._chegueiInstrumentProc === name) {
                await this._ensureChegueiToaqui(softwarePath, selectedCmmFile);
            }

            statusUpdater.startCompilation('cmm');

            // yanc v4 usa named options (CMMComp/Sources/args.c):
            //   -i input  -n name  -p proc-dir  -m macros-dir  -t temp-dir  [-A]
            // -pt / -en vem do toggle de locale (UI + compiler unified) e vai
            // PRIMEIRO: parse_lang_flag() consome essa flag e a remove de argv
            // antes do cli_parse() ler o resto. Explicito pra que a UI mande,
            // ignorando qualquer env var preexistente do shell.
            //
            // -A / --array liga o showArrays do .spf (campo per-processador) —
            // dump de arrays no waveform. Era -P no yanc v3.
            const lang = window.getYancLang?.() ?? 'pt';
            const cmmSpec = buildCmmSpec({
                cmmCompPath,
                inputFile: selectedCmmFile,
                baseName: cmmBaseName,
                projectPath,
                macrosPath,
                tempPath,
                processorName: name,
                lang,
                showArrays: !!showArrays,
            });

            // Track which .cmm this run is compiling so the terminal's
            // "line N" click handler can resolve the file even when verbose
            // is off (the cmmcomp.exe echo is hidden in that mode, so DOM
            // scraping would find nothing).
            this.lastCompiledCmmPath = await window.electronAPI.joinPath(softwarePath, selectedCmmFile);

            // internal:true marca como 'plain', entao o filtro de
            // verbose esconde a linha de comando quando verbose=off.
            // Continua util pra debug verbose mas nao polui o
            // terminal padrao.
            this.terminalManager.appendToTerminal('tcmm', tr('terminal.common.executing', { cmd: CommandSpec.formatSpec(cmmSpec) }), 'info', { internal: true });

            const result = await runSpec(cmmSpec, { consumeEphemeral: true });
            this.terminalManager.processExecutableOutput('tcmm', result);

            if (result.code !== 0) {
                statusUpdater.compilationError('cmm', `CMM compilation failed with code ${result.code}`);
                throw new Error(tr('error.compilation.cmmFailed', { code: result.code }));
            }
            statusUpdater.compilationSuccess('cmm');
            return asmPath;
        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', tr('terminal.common.error', { message: error.message }), 'error');
            statusUpdater.compilationError('cmm', error.message);
            throw error;
        }
    }

    async asmCompilation(processor, preamble = null) {
        const {
            name,
            clk,
            numClocks
        } = processor;
        await this.terminalManager.clearTerminal('tasm');

        // Mensagem opcional logada APOS o clear — usada pelo handler
        // do botao ASM pra avisar quando o C+- foi recompilado por
        // falta de cmm_log.txt. Antes do clear ela era apagada antes
        // do usuario ver.
        if (preamble) {
            this.terminalManager.appendToTerminal('tasm', preamble, 'tips');
        }

        this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.starting', { name }));

        try {
            const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
            const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
            const appCompPath = await window.electronAPI.joinPath(this.componentsPath, 'bin', 'appcomp.exe');
            const asmCompPath = await window.electronAPI.joinPath(this.componentsPath, 'bin', 'asmcomp.exe');
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
            const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);
            const macrosPath = await window.electronAPI.joinPath(this.componentsPath, 'Macros');

            const {
                tbFile
            } = await this.getTestbenchInfo(processor, cmmBaseName);

            statusUpdater.startCompilation('asm');
            await TabManager.saveAllFiles();

            // -pt / -en vem do toggle de locale. Vai PRIMEIRO: parse_lang_flag()
            // consome a flag antes do cli_parse() ler as named options. Aplicado
            // igual em appcomp e asmcomp pra que stdout/stderr dos dois passos
            // saiam na mesma lingua.
            const lang = window.getYancLang?.() ?? 'pt';

            // appcomp: named options -i input  -t temp-dir (APP/Sources/args.c).
            const asmPreSpec = buildAsmPreSpec({
                appCompPath,
                asmFile: asmPath,
                tempPath,
                processorName: name,
                lang,
            });
            this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingPrep', { cmd: CommandSpec.formatSpec(asmPreSpec) }), 'info', { internal: true });
            const appResult = await runSpec(asmPreSpec, { consumeEphemeral: true });
            this.terminalManager.processExecutableOutput('tasm', appResult);

            if (appResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM Preprocessor failed with code ${appResult.code}`);
                throw new Error(tr('error.compilation.asmPrepFailed', { code: appResult.code }));
            }

            // asmcomp v4: named options -i -p -d -m -t -f -c (ASM/Sources/args.c).
            // -f/-c TEM que ser inteiros — o yanc rejeita valor nao-numerico
            // e sai com usage. O -P (project mode = sem $finish no _tb.v) foi
            // removido no v4: o $finish agora e sempre emitido; multi-proc
            // workflows ignoram o _tb.v individual e usam um top-level proprio.
            const freq = Number.parseInt(clk, 10) || 0;
            const clocks = Number.parseInt(numClocks, 10) || 0;
            const asmSpec = buildAsmSpec({
                asmCompPath,
                asmFile: asmPath,
                projectPath,
                hdlPath,
                macrosPath,
                tempPath,
                freq,
                clocks,
                processorName: name,
                lang,
            });
            this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingComp', { cmd: CommandSpec.formatSpec(asmSpec) }), 'info', { internal: true });

            const asmResult = await runSpec(asmSpec, { consumeEphemeral: true });

            this.terminalManager.processExecutableOutput('tasm', asmResult);


            if (asmResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM compilation failed with code ${asmResult.code}`);
                throw new Error(tr('error.compilation.asmFailed', { code: asmResult.code }));
            }

            // Copia o testbench auto-gerado (asmcomp escreve em tempPath)
            // pra <proc>/Simulation/<base>_tb.v sempre que o processador
            // usa o testbench "standard" — i.e., nao tem um testbench
            // customizado configurado. O testbench auto-gerado e
            // per-processador (Simulation/<base>_tb.v), distinto do
            // testbench-top que o .spf aponta, entao nao
            // conflita com nada.
            const usesStandardTestbench =
                !processor.testbenchFile || processor.testbenchFile === 'standard';
            if (usesStandardTestbench) {
                const tbFileName = tbFile.split(/[\\\\/]/)
                    .pop();
                const sourceTestbench = await window.electronAPI.joinPath(tempPath, tbFileName);
                const destinationTestbench = tbFile;

                // Path-cheio so em verbose; o resumo "Testbench
                // atualizado" (tips) e o que aparece sem verbose.
                this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.copyingTb', { src: sourceTestbench, dst: destinationTestbench }), 'info', { internal: true });
                await window.electronAPI.copyFile(sourceTestbench, destinationTestbench);
                this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.tbUpdated'), 'tips');
            }

            statusUpdater.compilationSuccess('asm');
        } catch (error) {
            this.terminalManager.appendToTerminal('tasm', tr('terminal.common.error', { message: error.message }), 'error');
            statusUpdater.compilationError('asm', error.message);
            throw error;
        }
    }


/**
 * Helper privado: monta a "shape canonica" do config —
 *   { topLevelFile, testbenchFile, synthesizableFiles }
 * — a partir de this.projectConfig. NAO valida nada e NAO joga.
 * Retorna null se projectConfig nao foi carregado.
 *
 * Usado pelos 3 validators publicos (validateForVerilog,
 * validateForWave, loadConfigUnsafe). Cada validator decide quais
 * campos sao obrigatorios.
 */
_buildConfigShape() {
    if (!this.projectConfig) return null;

    const synth = this.projectConfig.synthesizableFiles || [];
    const topEntry = this._pickSingleTop(synth, 'synthesizable');

    // testbenchFile (legacy single field) vence sobre testbenchFiles[]
    // (lista nova). Se nenhum, procura starred entry; ultimo recurso:
    // primeira entry valida.
    let foundTb = null;
    if (this.projectConfig.testbenchFile && this.projectConfig.testbenchFile.trim() !== '') {
        foundTb = this.projectConfig.testbenchFile;
    } else if (Array.isArray(this.projectConfig.testbenchFiles) && this.projectConfig.testbenchFiles.length > 0) {
        const tbs = this.projectConfig.testbenchFiles.filter((f) => f.path && f.path.trim() !== '');
        const starred = this._pickSingleTop(tbs, 'testbench');
        if (starred) {
            foundTb = starred.path;
        } else if (tbs.length > 0) {
            foundTb = tbs[0].path;
        }
    }

    return {
        topLevelFile:       topEntry ? topEntry.path : null,
        testbenchFile:      foundTb, // may be null
        synthesizableFiles: synth.map((f) => f.path),
    };
}

/**
 * Validacao pro botao Verilog / PRISM / Syntax Check: compile-check
 * do design sintetizavel. Exige projectConfig carregado, pelo menos
 * 1 synth file, e um top-level marcado (iverilog precisa do `-s <top>`).
 * Testbench e opcional (esses fluxos nao usam stimuli).
 *
 * Throws com mensagem amigavel em cada falha.
 */
validateForVerilog() {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    if (!this.projectConfig.synthesizableFiles || this.projectConfig.synthesizableFiles.length === 0) {
        throw new Error(tr('error.config.noSynth'));
    }
    const shape = this._buildConfigShape();
    if (!shape.topLevelFile) {
        throw new Error(tr('error.config.noTopLevel'));
    }
    return shape;
}

/**
 * Validacao pro botao Wave: simulacao precisa de um testbench
 * (que vira o `-s` do iverilog e fornece os estimulos). synth files
 * e top-level sao OPCIONAIS — um tb standalone que define tudo
 * inline (incluindo o DUT) e valido.
 *
 * Throws so se projectConfig ausente ou sem testbench.
 */
validateForWave() {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    const shape = this._buildConfigShape();
    if (!shape.testbenchFile) {
        throw new Error(tr('error.config.noTestbench'));
    }
    return shape;
}

/**
 * Re-entry helper pra fases internas que ja foram validadas upstream
 * (ex: _waveRunVvpSimulation so precisa consultar config.testbenchFile).
 * NAO valida design requirements — supoe que o caller publico ja jogou
 * pelos validators acima.
 *
 * Throws so se projectConfig nao foi carregado.
 */
loadConfigUnsafe() {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }
    return this._buildConfigShape();
}

/**
 * Pick the file marked `isTopLevel` from a category list, warning if
 * multiple are marked.
 *
 * The set-top-level UI clears the flag from siblings before applying
 * it, so within a single Aurora session you can't end up with two
 * tops in the same category. But the .spf can be hand-edited,
 * migrated from older builds, or written by a buggy
 * version — and a silent "first match wins" turns those cases into
 * "I marked counter.v as top but the build keeps using oldcounter.v"
 * mysteries. Surface the conflict in tveri instead.
 *
 * @param {Array<{path:string, name?:string, isTopLevel?:boolean}>} files
 * @param {'synthesizable'|'testbench'} category  — used in the warning text
 * @returns {object|undefined}  The picked file (first match), or undefined
 *      if none has isTopLevel.
 */
_pickSingleTop(files, category) {
    const tops = (files || []).filter((f) => f && f.isTopLevel === true);
    if (tops.length <= 1) return tops[0];
    const picked = tops[0];
    const ignored = tops.slice(1).map((f) => f.name || f.path?.split(/[\\/]/).pop() || '?').join(', ');
    const pickedName = picked.name || picked.path?.split(/[\\/]/).pop() || '?';
    this.terminalManager.appendToTerminal('tveri',
        tr('terminal.veri.multipleTops', { count: tops.length, category, picked: pickedName, ignored }),
        'warning');
    return picked;
}

/**
 * Read a VCD from disk, hand its scopes/signals + the user's picker
 * selection to the gtkw_writer module to build a save-file string,
 * and write the result. Returns true on a non-empty write, false if
 * there was nothing worth saving.
 *
 * The pure VCD walking lives in js/wave/vcd_parser.js and the .gtkw
 * formatting in js/wave/gtkw_writer.js — both unit-tested. This
 * method is the IO glue.
 */
/**
 * Filter the user's saved Wave Configuration selection against the
 * current parsed Verilog hierarchy and warn about stale entries.
 *
 * Why this exists: the picker stores selections by dotted path. If
 * the user later renames a signal (rst → rs) or removes an instance,
 * the saved entry dangles. Feeding it to the testbench instrumenter
 * makes iverilog produce `$dumpvars(0, tb_counter.rst)` against a
 * design that has no `rst`, and the build fails with a cryptic
 * "exit code 2". Pre-validating turns that into a readable warning
 * in tveri and lets the build proceed with the still-valid subset.
 *
 * Returns the pruned selection. On parse failure, falls back to the
 * raw selection — better to let iverilog produce a real error than
 * to silently strip the user's choice on a transient parse hiccup.
 */
async _validateWaveSelection(rawSelected, filePaths, simTopModule, tbKey = null) {
    if (!Array.isArray(rawSelected) || rawSelected.length === 0) return [];
    try {
        const fileContents = await Promise.all(
            filePaths.map(async (path) => ({
                path,
                content: await window.electronAPI.readFile(path, { encoding: 'utf8' }),
            })),
        );
        const { modules } = parseVerilogModules(fileContents);
        const tree = simTopModule && modules.has(simTopModule)
            ? buildHierarchyTree(modules, simTopModule)
            : null;
        const { valid, dropped } = validateSelection(rawSelected, tree);
        if (dropped.length > 0) {
            const preview = dropped.slice(0, 5).map((s) => `"${s}"`).join(', ');
            const more = dropped.length > 5 ? ` (+${dropped.length - 5} more)` : '';
            const msg = dropped.length === 1
                ? tr('terminal.wave.staleSignalOne', { preview })
                : tr('terminal.wave.staleSignalMany', { count: dropped.length, preview, more });
            // Goes to twave — this is a Wave Configuration concern,
            // even though it's detected during the iverilog
            // instrumentation step (the wave button is the only flow
            // that triggers buildVvp; the plain Compile button never
            // hits this path).
            this.terminalManager.appendToTerminal('twave', msg, 'warning');

            // Auto-prune the persisted selection so the warning fires
            // once, not on every compile. We can't tell the user to
            // "uncheck" a stale entry — the picker only shows signals
            // that exist in the parsed hierarchy, so a missing path
            // has no UI to remove it from. waveSignals agora vive
            // per-testbench no WaveStore; sem tbKey resolvido (caso
            // raro: topLevelFile sem testbenchFile) skip o write — o
            // run em si ja procede com `valid`.
            if (tbKey) {
                try {
                    await WaveStore.update(this.projectPath, tbKey, (cfg) => {
                        cfg.waveSignals = valid;
                    });
                } catch (_persistErr) {
                    // Non-fatal: o run ja procede com `valid`.
                    // Proxima compilacao re-detecta e re-tenta.
                }
            }
        }
        return valid;
    } catch (err) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.preValidateFailed', { message: err.message }),
            'warning');
        return rawSelected;
    }
}

/**
 * Run iverilog in `-tnull` mode with the testbench as the simulation
 * top, just to confirm the design (synth files + testbench together)
 * actually parses + elaborates. No `.vvp` is produced; nothing is
 * instrumented.
 *
 * Used by the Wave Configuration modal as a gate: there's no point
 * showing a hierarchy picker built from a regex parse if iverilog
 * itself can't read the design. On failure the iverilog output goes
 * to the `tveri` terminal (which we switch focus to) and the modal
 * stays closed — the user fixes their code before picking signals.
 *
 * Returns `{ success: boolean, message?: string }`. Never throws.
 */
async syntaxCheck() {
    if (!this.componentsPath) {
        await this.initializeComponentsPath();
    }
    try {
        const config = this.validateForVerilog();

        const iveriCompPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe',
        );
        if (!await window.electronAPI.fileExists(iveriCompPath)) {
            const msg = tr('terminal.veri.iverilogNotFound', { path: iveriCompPath });
            this.terminalManager.appendToTerminal('tveri', msg, 'error');
            return { success: false, message: msg };
        }

        const topLevelModuleName = moduleStemFromPath(config.topLevelFile);
        const hasVerilogTestbench = config.testbenchFile && !isPythonFile(config.testbenchFile);
        const simTopModule = hasVerilogTestbench
            ? moduleStemFromPath(config.testbenchFile)
            : topLevelModuleName;

        // Whole design: synth files + testbench (raw, no auto-instrumentation
        // — we want iverilog to evaluate exactly what the user wrote).
        const fileSet = new Set(config.synthesizableFiles);
        if (hasVerilogTestbench) fileSet.add(config.testbenchFile);

        // -y points iverilog at components/HDL pra resolver os modulos
        // da biblioteca SAPHO (processor.v, addr_dec.v, instr_dec.v,
        // ula.v, myFIFO.v, core.v) que o .v gerado pelo asmcomp
        // instancia. Sem isso o syntax check falha com "Unknown module
        // type: processor" em projetos que tem processadores SAPHO.
        // Mesmo padrao do verilogSyntaxCheck / waveBuildVvp.
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');

        const checkSpec = buildIverilogCheckSpec({
            iveriCompPath,
            hdlPath,
            simTopModule,
            sourceFiles: [...fileSet],
            cwd: this.projectPath,
        });

        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.bannerSyntaxWc'), 'info');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.simTop', { name: simTopModule }), 'info');
        // Linha de comando crua e ruido pra usuario nao-debug — esconde
        // quando verbose=off (mesmo padrao do cmm/asm).
        this.terminalManager.appendToTerminal('tveri', CommandSpec.formatSpec(checkSpec), 'info', { internal: true });

        const result = await runSpec(checkSpec, { consumeEphemeral: true });
        this.terminalManager.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.bannerSyntaxFailed'), 'error');
            return {
                success: false,
                message: `Iverilog reported errors (exit ${result.code}). See terminal.`,
            };
        }

        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.bannerSyntaxPassed'), 'success');
        return { success: true };

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.syntaxError', { message: error.message }), 'error');
        return { success: false, message: error.message };
    }
}

/**
 * Read the testbench, hand its content + the user's picker selection
 * to the testbench_instrumenter module to decide whether and how to
 * inject $dumpfile/$dumpvars, then write the result to Temp/. Returns
 * the path iverilog should compile against — either the original (if
 * the user already wrote dump plumbing, or the file is malformed) or
 * the new instrumented copy.
 *
 * Pure decision logic + string building lives in
 * js/wave/testbench_instrumenter.js (unit-tested). This method is
 * the IO glue.
 */
/**
 * Decide o que vai dentro do `$dumpvars` injetado e se devemos
 * sobrescrever um `$dumpvars` hand-written do usuario. Tres axes
 * agem em conjunto, com a precedencia (de maior a menor):
 *
 *   1. **.gtkw selecionado** (state.gtkwFiles ∩ isActive=true).
 *      Aurora le o arquivo, extrai signal refs com extractSignalRefs,
 *      valida contra a hierarquia do source atual e usa esse conjunto.
 *      Signals referenciados no .gtkw mas que sumiram do source geram
 *      twave warning + toast — o build segue sem eles.
 *   2. **Wave Configuration customizada** (state.wcCustomized=true).
 *      state.waveSignals dita o $dumpvars. Override do $dumpvars
 *      do usuario se houver — o WC e a fonte canonica nesse caso.
 *   3. **Testbench com $dumpvars hand-written na 1a visita**
 *      (state.hadOriginalDumpvars). NAO injetamos nada; o testbench
 *      domina o que vai pro VCD.
 *   4. **Default**: `$dumpvars(1, tbModule)` — signals so do scope
 *      do testbench, sem descer no DUT. Sem override.
 *
 * Side effects: registra o tb no WaveStore na 1a visita (snapshot
 * de hadOriginalDumpvars pra usar nas visitas futuras).
 *
 * @param {object} input
 * @param {object} input.config        .spf structure (precisa testbenchFile)
 * @param {string} input.simTopModule  nome do module top da simulacao
 * @param {string[]} input.filePaths   .v files pra parsear (synth + tb + HDL)
 * @returns {Promise<{
 *   signalsToDump: string[],
 *   overrideUserDumpvars: boolean,
 *   source: 'gtkw'|'wc'|'tb'|'default',
 *   tbKey: string,
 * }>}
 */
async _resolveWaveSelection({ config, simTopModule, filePaths }) {
    const tbKey = moduleStemFromPath(config.testbenchFile);

    // 1a visita: snapshot do estado original do testbench. Idempotente
    // — re-chamadas nao mudam o flag.
    const tbContent = await window.electronAPI.readFile(config.testbenchFile, { encoding: 'utf8' });
    const hadOriginalDumpvars = hasUserDumpCalls(tbContent);
    await WaveStore.ensureRegistered(this.projectPath, tbKey, {
        tbPath: config.testbenchFile,
        tbModule: tbKey,
        hadOriginalDumpvars,
    });
    const state = await WaveStore.read(this.projectPath, tbKey);

    // Parse de source on-demand — so se precisarmos validar um conjunto
    // de signals (vem do .gtkw ou do WC).
    let cachedTree = null;
    const buildTree = async () => {
        if (cachedTree !== null) return cachedTree;
        const contents = await Promise.all(
            filePaths.map(async (p) => ({
                path: p,
                content: await window.electronAPI.readFile(p, { encoding: 'utf8' }),
            })),
        );
        const { modules } = parseVerilogModules(contents);
        cachedTree = simTopModule && modules.has(simTopModule)
            ? buildHierarchyTree(modules, simTopModule)
            : null;
        return cachedTree;
    };

    // (d) .gtkw ativo vence — varredura do arquivo dita o $dumpvars.
    const activeGtkw = (state.gtkwFiles || []).find((f) => f && f.isActive === true);
    if (activeGtkw && activeGtkw.path) {
        try {
            const gtkwContent = await window.electronAPI.readFile(activeGtkw.path, { encoding: 'utf8' });
            const refs = extractSignalRefs(gtkwContent);
            if (refs.length > 0) {
                const tree = await buildTree();
                const { valid, dropped } = validateSelection(refs, tree);
                if (dropped.length > 0) {
                    const gtkwName = activeGtkw.path.split(/[\\/]/).pop();
                    const preview = dropped.slice(0, 5).map((s) => `"${s}"`).join(', ');
                    const more = dropped.length > 5 ? ` (+${dropped.length - 5} more)` : '';
                    const msg = dropped.length === 1
                        ? tr('terminal.wave.gtkwStaleSignalOne', { preview, file: gtkwName })
                        : tr('terminal.wave.gtkwStaleSignalMany', { count: dropped.length, file: gtkwName, preview, more });
                    this.terminalManager.appendToTerminal('twave', msg, 'warning');
                    if (typeof window.showNotification === 'function') {
                        window.showNotification(msg, 'warning', 6000, 'Wave Selection');
                    }
                }
                return {
                    signalsToDump: valid,
                    overrideUserDumpvars: true,
                    source: 'gtkw',
                    tbKey,
                };
            }
        } catch (err) {
            this.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.gtkwReadError', { file: activeGtkw.path.split(/[\\/]/).pop(), message: err.message }),
                'warning');
        }
    }

    // (c) Wave Configuration customizada.
    if (state.wcCustomized
        && Array.isArray(state.waveSignals)
        && state.waveSignals.length > 0) {
        // Mesma validacao: signals podem ter sumido entre o save do WC
        // e este compile. _validateWaveSelection ja faz isso e auto-prune.
        const valid = await this._validateWaveSelection(
            state.waveSignals, filePaths, simTopModule, tbKey,
        );
        return {
            signalsToDump: valid,
            overrideUserDumpvars: true,
            source: 'wc',
            tbKey,
        };
    }

    // (a) Testbench tem $dumpvars hand-written: nao instrumentamos.
    if (state.hadOriginalDumpvars) {
        return {
            signalsToDump: [],
            overrideUserDumpvars: false,
            source: 'tb',
            tbKey,
        };
    }

    // (default) $dumpvars(1, tbModule) — signals do escopo do tb.
    return {
        signalsToDump: [],
        overrideUserDumpvars: false,
        source: 'default',
        tbKey,
    };
}

async instrumentTestbench(testbenchPath, tbModule, tempBaseDir, selectedSignals = [], overrideUserDumpvars = false) {
    const originalContent = await window.electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
    const result = instrumentTestbenchSource({
        originalContent,
        tbModule,
        selectedSignals,
        overrideUserDumpvars,
    });
    if (!result.needsWrite) return { path: testbenchPath, reason: result.reason };

    const basename = testbenchPath.split(/[\\/]/).pop();
    const instrumentedPath = await window.electronAPI.joinPath(tempBaseDir, `instr_${basename}`);

    // Idempotencia de mtime: so escreve se o conteudo realmente mudou.
    // Importante pro path do Verilator — o make detecta mudanca via
    // mtime; se reescrevemos com mesmo conteudo a cada clique no Wave,
    // o make recompila tudo (5-15s desperdicados). Pro iverilog e
    // neutro (compile e fast anyway). Checamos existence antes de readFile
    // pra evitar o ENOENT spam que o IPC handler loga ate em try/catch.
    if (await window.electronAPI.fileExists(instrumentedPath)) {
        try {
            const existing = await window.electronAPI.readFile(instrumentedPath, { encoding: 'utf8' });
            if (existing === result.content) {
                return { path: instrumentedPath, reason: result.reason };
            }
        } catch (_e) { /* read falhou apos exists ok — race ou disco; segue e escreve */ }
    }

    await window.electronAPI.writeFile(instrumentedPath, result.content);
    return { path: instrumentedPath, reason: result.reason };
}

/**
 * Pre-flight do botao Wave compartilhado entre iverilog e verilator:
 * resolve a selecao de signals, instrumenta o testbench e monta o
 * conjunto de fontes (synth + tb instrumentado).
 *
 * Tudo que e independente do simulador esta aqui. As fases _waveBuild*
 * que vem depois so precisam saber o cmdline do seu simulador.
 *
 * Side-effects:
 *   - Escreve instr_<basename>.v em tempBaseDir (se instrumentacao for
 *     necessaria).
 *   - Atualiza this._validatedWaveSelection (consumido pelo .gtkw
 *     auto-generator em _waveResolveGtkwSaveFile).
 *   - Loga "Wave source: ..." em twave.
 *
 * Returns: { fileSet, instrumentedTbPath, decision }
 *   fileSet: Set<string> com synth files + tb instrumentado (uso direto
 *            pra montar a linha de comando do simulador).
 *   instrumentedTbPath: string (== config.testbenchFile se o tb tem
 *                       $dumpvars hand-written e o user nao customizou).
 *   decision: objeto retornado por _resolveWaveSelection.
 */
async _prepareWaveBuildInputs(config, simTopModule, tempBaseDir) {
    const filePaths = new Set(config.synthesizableFiles);
    if (config.testbenchFile) filePaths.add(config.testbenchFile);
    try {
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
        const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlPath);
        if (Array.isArray(hdlEntries)) {
            for (const name of hdlEntries) {
                if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                    filePaths.add(await window.electronAPI.joinPath(hdlPath, name));
                }
            }
        }
    } catch (_e) { /* HDL nao acessivel — segue sem */ }

    const decision = await this._resolveWaveSelection({
        config,
        simTopModule,
        filePaths: [...filePaths],
    });

    const { path: tbPath, reason } = await this.instrumentTestbench(
        config.testbenchFile,
        simTopModule,
        tempBaseDir,
        decision.signalsToDump,
        decision.overrideUserDumpvars,
    );

    this._validatedWaveSelection = reason === 'user-defined'
        ? []
        : decision.signalsToDump;

    const sourceLabel = {
        gtkw: tr('terminal.wave.sourceLabelGtkw', { count: decision.signalsToDump.length }),
        wc: tr('terminal.wave.sourceLabelWc', { count: decision.signalsToDump.length }),
        tb: tr('terminal.wave.sourceLabelTb'),
        default: tr('terminal.wave.sourceLabelDefault'),
    }[decision.source] || decision.source;
    this.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.waveSource', { label: sourceLabel }), 'info');

    if (reason === 'override-user') {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.overrideUserDumpvars'), 'tips');
    }

    const fileSet = new Set(config.synthesizableFiles);
    fileSet.add(tbPath);

    return { fileSet, instrumentedTbPath: tbPath, decision };
}

// ---------------------------------------------------------------------
// Iverilog shared helpers
// ---------------------------------------------------------------------

/**
 * Resolve os paths/binarios que ambos os fluxos iverilog (syntax-check
 * e wave-build) precisam:
 *   - tempBaseDir: components/Temp/ (criado se nao existe)
 *   - iveriCompPath: caminho absoluto pro iverilog.exe (throws se ausente)
 *   - hdlPath: components/HDL/ (search dir do -y, pra modulos tipo
 *     processor.v, myFIFO.v, etc.)
 *
 * Side-effect: mkdir tempBaseDir.
 */
async _resolveIverilogTools() {
    const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
    const iveriCompPath = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'iverilog.exe',
    );
    if (!await window.electronAPI.fileExists(iveriCompPath)) {
        throw new Error(tr('error.toolchain.iverilogNotFound', { path: iveriCompPath }));
    }
    await window.electronAPI.mkdir(tempBaseDir);
    const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
    return { tempBaseDir, iveriCompPath, hdlPath };
}

/**
 * Spawna iverilog com a spec dada, faz streaming do output pro terminal
 * tveri, e joga se exit code != 0. `phase` controla as mensagens:
 *   'check' → "Check command:", "Verificando...", iverilogFailedCheck
 *   'build' → "Build command:", "Construindo VVP...", iverilogFailedBuild
 *
 * NAO loga sucesso — caller faz isso (cada fluxo tem mensagem diferente
 * de "Build successful" / "Check successful").
 */
async _runIverilogSpec(spec, { phase }) {
    const isBuild = phase === 'build';
    // Rotulo + linha de comando crua: ambos so em verbose/debug. O
    // rotulo ("Build command:" / "Check command:") precisa do
    // { internal: true } senao aparece sozinho no modo normal
    // enquanto o comando que ele rotula fica escondido.
    this.terminalManager.appendToTerminal('tveri',
        tr(isBuild ? 'terminal.veri.buildCmd' : 'terminal.veri.checkCmd'),
        'info', { internal: true });
    this.terminalManager.appendToTerminal('tveri', CommandSpec.formatSpec(spec), 'info', { internal: true });

    await TabManager.saveAllFiles();

    this.terminalManager.appendToTerminal('tveri',
        tr(isBuild ? 'terminal.veri.building' : 'terminal.veri.checking'),
        'info');

    const result = await runSpec(spec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput('tveri', result);

    if (result.code !== 0) {
        throw new Error(tr(
            isBuild ? 'error.compilation.iverilogFailedBuild' : 'error.compilation.iverilogFailedCheck',
            { code: result.code },
        ));
    }
}

/**
 * Syntax-check do design Verilog via iverilog -tnull. Usado pelos
 * botoes Verilog, ASM (re-check pos-otimizacao do .asm) e PRISM
 * (que precisa da hierarquia regenerada pra Yosys consumir).
 *
 * NAO gera .vvp (iverilog -tnull pula code-gen) e NAO inclui o
 * testbench no source set (constructos nao-sintetizaveis como
 * $dumpvars/$finish/delays confundiriam o check puro).
 *
 * Apos sucesso, regenera a hierarquia (write_json via Yosys) pro
 * file tree mostrar a arvore de modulos atualizada.
 *
 * Substitui iverilogCompile({buildVvp:false}). Pareado com
 * waveBuildVvp() — que cuida do fluxo do botao Wave.
 */
async verilogSyntaxCheck() {
    this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.phaseCheck'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        const config = this.validateForVerilog();

        // 'tips' = blue/info badge. Contexto do que vai compilar (FYI),
        // nao success — o verde so aparece no checkSuccess no fim.
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.topLevel', { name: config.topLevelFile.split(/[\\/]/).pop() }), 'tips');
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const { iveriCompPath, hdlPath } = await this._resolveIverilogTools();

        const topLevelModuleName = config.topLevelFile.split(/[\\/]/).pop().replace(/\.v$/i, '');

        // Source set: so synth files. Testbench fica de fora — tem
        // $dumpvars/$finish/delays nao-sintetizaveis que so confundiriam
        // um check de design puro.
        const fileSet = new Set(config.synthesizableFiles);

        // -y tells iverilog to resolve any module referenced but not
        // listed in the source set by looking for `<moduleName>.v` in
        // these directories. components/HDL tem componentes do processador
        // SAPHO (processor.v, addr_dec.v, instr_dec.v, ula.v, core.v) e
        // componentes usados fora dele (myFIFO.v).
        const spec = buildIverilogCheckSpec({
            iveriCompPath,
            hdlPath,
            // -tnull pede pro iverilog elaborar mas pular code-gen, dando
            // parse + type-check sem produzir .vvp.
            simTopModule: topLevelModuleName,
            sourceFiles: [...fileSet],
            cwd: this.projectPath,
        });

        await this._runIverilogSpec(spec, { phase: 'check' });

        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.checkSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');

        // Hierarquia regenerada so no syntax-check (acao user-facing
        // "compile"). O Wave button (waveBuildVvp) nao toca hierarquia —
        // o user ja clicou Verilog antes pra chegar num design valido.
        await this.generateProjectHierarchy();

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.common.error', { message: error.message }), 'error');
        statusUpdater.compilationError('verilog', error.message);
        throw error;
    }
}

/**
 * Build do .vvp pro botao Wave: synth files + testbench instrumentado
 * → iverilog -o components/Temp/<tb>.vvp.
 *
 * Antes de spawnar o iverilog, faz a parte heavy do pipeline Wave:
 *   1. Resolve a selecao de signals (.gtkw ativo > Wave Config > tb com
 *      $dumpvars hand-written > default $dumpvars(1, tb)).
 *   2. Instrumenta o testbench (escreve cópia em
 *      components/Temp/instr_<tb>.v com o $dumpvars escolhido e o hook
 *      do AURORA_HEADER_ONLY pra pass-1 rapido). O .v original NUNCA
 *      e tocado — Aurora escreve uma cópia em Temp/.
 *
 * Apos sucesso, NAO regenera hierarquia (essa e tarefa do botao Verilog).
 *
 * Substitui iverilogCompile({buildVvp:true}). Pareado com
 * verilogSyntaxCheck() — que cuida do botao Verilog.
 */
async waveBuildVvp() {
    this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.phaseBuild'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        const config = this.validateForWave();

        if (config.topLevelFile) {
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.topLevel', { name: config.topLevelFile.split(/[\\/]/).pop() }), 'tips');
        }
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.testbench', { name: config.testbenchFile.split(/[\\/]/).pop() }), 'tips');
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const { tempBaseDir, iveriCompPath, hdlPath } = await this._resolveIverilogTools();

        const simTopModule = config.testbenchFile.split(/[\\/]/).pop().replace(/\.v$/i, '');
        const outputFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);

        // Source set: synth files; o tb instrumentado e adicionado abaixo.
        const fileSet = new Set(config.synthesizableFiles);

        // Reunir o conjunto de .v pra validacao de signals do picker:
        // synth + testbench + components/HDL/*.v (assim selecoes de
        // Stack/ULA/SAPHO nao sao descartadas como "stale").
        const filePaths = new Set(config.synthesizableFiles);
        filePaths.add(config.testbenchFile);
        try {
            const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlPath);
            if (Array.isArray(hdlEntries)) {
                for (const name of hdlEntries) {
                    if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                        filePaths.add(await window.electronAPI.joinPath(hdlPath, name));
                    }
                }
            }
        } catch (_e) { /* HDL nao acessivel — segue sem */ }

        // Precedencia: .gtkw ativo > Wave Config customizado >
        // tb-com-dumpvars > default. Tambem registra o tb no WaveStore
        // na 1a visita.
        const decision = await this._resolveWaveSelection({
            config,
            simTopModule,
            filePaths: [...filePaths],
        });

        const { path: tbPath, reason } = await this.instrumentTestbench(
            config.testbenchFile,
            simTopModule,
            tempBaseDir,
            decision.signalsToDump,
            decision.overrideUserDumpvars,
        );
        fileSet.add(tbPath);

        // Quando o tb domina (`user-defined`), a selecao usada pelo
        // .gtkw auto-gerado fica vazia — buildAuroraGtkw cai no layout
        // completo do VCD. Pros outros casos, _validatedWaveSelection
        // = signals escolhidos, e o auto-gtkw filtra por eles.
        this._validatedWaveSelection = reason === 'user-defined'
            ? []
            : decision.signalsToDump;

        // Log diagnostico — mostra qual eixo ditou a selecao,
        // pra debuggar quando o user esperava outra coisa.
        const sourceLabel = {
            gtkw: tr('terminal.wave.sourceLabelGtkw', { count: decision.signalsToDump.length }),
            wc: tr('terminal.wave.sourceLabelWc', { count: decision.signalsToDump.length }),
            tb: tr('terminal.wave.sourceLabelTb'),
            default: tr('terminal.wave.sourceLabelDefault'),
        }[decision.source] || decision.source;
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.waveSource', { label: sourceLabel }), 'info');

        if (reason === 'override-user') {
            this.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.overrideUserDumpvars'), 'tips');
        }
        if (tbPath !== config.testbenchFile) {
            this.terminalManager.appendToTerminal('tveri',
                tr('terminal.veri.autoInstrTb', { name: tbPath.split(/[\\/]/).pop() }), 'info');
        }

        // -y components/HDL pra resolver modulos referenciados mas nao
        // listados (processor.v, myFIFO.v, etc).
        const spec = buildIverilogBuildSpec({
            iveriCompPath,
            hdlPath,
            simTopModule,
            outputFile,
            sourceFiles: [...fileSet],
            cwd: this.projectPath,
        });

        await this._runIverilogSpec(spec, { phase: 'build' });

        // Defensive: iverilog exit 0 mas o -o pode ter falhado em escrever
        // (race com AV scanner, permission, etc).
        if (!await window.electronAPI.fileExists(outputFile)) {
            throw new Error(tr('error.compilation.vvpNotGenerated'));
        }

        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.buildSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.bannerFailed'), 'error');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.common.error', { message: error.message }), 'error');
        statusUpdater.compilationError('verilog', error.message);
        throw error;
    }
}

/**
 * Wave button entrypoint. Orquestra o pipeline completo de .v sources
 * ate uma janela GTKWave rodando. Cada fase e um metodo privado com
 * contrato proprio; o orquestrador e curto pra deixar a *ordem das
 * fases* como unica coisa que um futuro leitor tem que entender aqui.
 *
 * Memory file staging (pc_*_mem.txt gerados pelo cmmcomp) acontece
 * dentro de _waveRunVvpSimulation — no-op natural em projetos sem
 * processador (nao ha subdir com .txt pra copiar).
 *
 * Pipeline (read top-to-bottom):
 *
 *   _waveResolveToolchain()          → { tempBaseDir, gtkwaveBin, vvpBin }
 *   _waveDeriveSimTopModule(config)  → testbench module name
 *   _waveBuildAndVerifyVvp()         → tempBaseDir/${simTop}.vvp on disk
 *   _waveRunVvpSimulation()          → tempBaseDir/<some>.vcd on disk
 *   _waveResolveVcdFile()            → absolute path to that .vcd
 *   _waveResolveGtkwSaveFile()       → .gtkw absolute path or null
 *   _waveLaunchGtkwave()             → GTKWave process, monitored
 *
 * If you need to change behaviour, change the phase that owns the
 * concern. The orchestrator only changes when you add / remove a
 * phase or reorder them.
 *
 * See ARCHITECTURE.md §10 for the broader rationale (why VCD is the
 * ground truth, how the three .gtkw sources interact, etc.).
 */
async runGtkWave() {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.bannerSim'), 'info');

    try {
        // validateForWave exige testbench (sem ele, vvp nao tem o que
        // simular). Synth e top-level sao opcionais — um tb standalone
        // pode definir DUT inline. Esse validator substituiu o
        // validateConfig({requireTopLevel:false}) + check separado de
        // testbench que vivia aqui.
        const config = this.validateForWave();

        const tools = await this._waveResolveToolchain();
        let simTopModule = this._waveDeriveSimTopModule(config);
        let vcdFile = null;

        if (isPythonFile(config.testbenchFile)) {
            const cocotbCtx = this._waveValidateCocotbConfig(config);
            simTopModule = cocotbCtx.hdlTopModule;
            this.terminalManager.appendToTerminal('twave', tr('terminal.wave.cocotbSimulator', {
                sim: getSimulator() === 'verilator' ? 'Verilator' : 'Icarus',
            }), 'tips');
            // The cocotb build + run doesn't go through the statusUpdater per
            // step, so without this the bar stays stuck on 'asm'. Reflect the
            // actual engine (verilator OR the iverilog/Verilog flow).
            statusUpdater.startCompilation(getSimulator() === 'verilator' ? 'verilator' : 'verilog');
            vcdFile = await this._waveRunCocotbSimulation(cocotbCtx, tools, config);
        } else {
            // Branch no simulador escolhido. iverilog e default; verilator e
            // opt-in via Wave Config (localStorage flag aurora.waveSimulator).
            // Ambos os caminhos convergem em _waveResolveVcdFile — o arquivo
            // de saida (.fst ou .vcd-com-FST) e descoberto la, sem branch.
            const simulator = getSimulator();
            if (simulator === 'verilator') {
                this.terminalManager.appendToTerminal('twave', tr('terminal.wave.verilatorSimulator'), 'tips');
                // O build do Verilator (verilation + g++, pesado) e a sim nao
                // passam pelo statusUpdater por step, entao a barra ficava presa
                // no ultimo step do pipeline ('asm'/Assembly). Marca 'verilator'
                // aqui pra a barra refletir a etapa real durante build + sim.
                statusUpdater.startCompilation('verilator');
                const vTools = await this._waveResolveVerilatorTools();
                const fullTools = { ...tools, ...vTools };
                const { exePath } = await this._waveBuildVerilator(simTopModule, tools.tempBaseDir, config, fullTools);
                await this._waveRunVerilatorSimulation(simTopModule, fullTools, exePath);
            } else {
                this.terminalManager.appendToTerminal('twave', tr('terminal.wave.iverilogSimulator'), 'tips');
                // Same as Verilator above: the iverilog build/run doesn't touch
                // the statusUpdater per step, so mark 'verilog' here or the bar
                // stays on 'asm' through the whole Wave.
                statusUpdater.startCompilation('verilog');
                await this._waveBuildAndVerifyVvp(simTopModule, tools.tempBaseDir);
                await this._waveRunVvpSimulation(simTopModule, tools);
            }
            vcdFile = await this._waveResolveVcdFile(simTopModule, tools.tempBaseDir);
        }
        const gtkwSaveFile = await this._waveResolveGtkwSaveFile(simTopModule, vcdFile, tools.tempBaseDir);
        await this._waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools);
    } catch (error) {
        this.terminalManager.appendToTerminal('twave', tr('terminal.common.error', { message: error.message }), 'error');
        console.error(error);
        throw error;
    }
}

// ---------------------------------------------------------------------
// Wave-flow phases — keep each method's contract block in sync with
// what it actually does. The orchestrator above documents the order;
// each phase below documents the local invariants. ARCHITECTURE.md §10
// has the cross-cutting principles (VCD-as-truth, validation gates).
// ---------------------------------------------------------------------

/**
 * Resolve absolute paths to bundled toolchain executables and Aurora's
 * Temp / Scripts directories.
 *
 * Inputs:  this.componentsPath
 * Returns: { tempBaseDir, gtkwaveBin, vvpBin, iverilogBin,
 *            iverilogBinDir, gtkwaveBinDir, fst2vcdBin } — all absolute
 * Throws:  never (joinPath is total)
 * Side-effects: none
 *
 * The iverilog / gtkwaveBinDir / fst2vcd fields exist so the cocotb
 * (Python testbench) flow can find the Icarus binary, put it on PATH,
 * and convert the FST it produces — that path uses the base tools object
 * directly (unlike Verilator, which merges in _waveResolveVerilatorTools()).
 */
async _waveResolveToolchain() {
    const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
    const gtkwaveBin = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'gtkwave-nipscern', 'gtkwave.exe',
    );
    // Unified mingw bundle: iverilog + vvp live in Packages/msys/mingw64/bin.
    const iverilogBinDir = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'msys', 'mingw64', 'bin',
    );
    const iverilogBin = await window.electronAPI.joinPath(iverilogBinDir, 'iverilog.exe');
    const vvpBin = await window.electronAPI.joinPath(iverilogBinDir, 'vvp.exe');
    // fst2vcd is the only GTKWave CLI tool Aurora needs; it ships in the
    // gtkwave-nipscern fork (no separate Icarus GTKWave bundle anymore).
    const gtkwaveBinDir = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'gtkwave-nipscern',
    );
    const fst2vcdBin = await window.electronAPI.joinPath(gtkwaveBinDir, 'fst2vcd.exe');
    return {
        tempBaseDir, gtkwaveBin, vvpBin,
        iverilogBin, iverilogBinDir, gtkwaveBinDir, fst2vcdBin,
    };
}

/**
 * Derive the simulation-top module name (the `-s` value passed to
 * iverilog and the basename Aurora expects for the .vvp / .vcd / .gtkw
 * triplet).
 *
 * The testbench module is the simulation top when one exists; falling
 * back to the synthesizable top is for the rare "compile a single .v
 * with no testbench" flow (which the wave button rejects upstream
 * anyway, but the helper stays general).
 */
_waveDeriveSimTopModule(config) {
    if (config.testbenchFile) {
        return moduleStemFromPath(config.testbenchFile);
    }
    // Fallback inalcancavel pelo Wave (runGtkWave ja exige testbench),
    // mas o helper fica geral: se um dia for chamado sem tb, exige top.
    if (!config.topLevelFile) return null;
    return moduleStemFromPath(config.topLevelFile);
}

_waveValidateCocotbConfig(config) {
    if (!config.topLevelFile) {
        throw new Error(tr('error.compilation.cocotbRequiresTop'));
    }
    if (!/\.(v|sv)$/i.test(config.topLevelFile)) {
        throw new Error(tr('error.compilation.cocotbRequiresTop'));
    }
    if (!config.testbenchFile || !isPythonFile(config.testbenchFile)) {
        throw new Error(tr('error.compilation.cocotbRequiresPythonTb'));
    }

    return {
        hdlTopFile: config.topLevelFile,
        hdlTopModule: moduleStemFromPath(config.topLevelFile),
        testbenchFile: config.testbenchFile,
        testModule: assertPythonModuleName(config.testbenchFile),
        tbKey: moduleStemFromPath(config.testbenchFile),
    };
}

async _writeCocotbRunnerScript(tempBaseDir) {
    const scriptPath = await window.electronAPI.joinPath(tempBaseDir, 'aurora_cocotb_runner.py');
    const source = [
        'import json',
        'import os',
        'import sys',
        'from pathlib import Path',
        '',
        'try:',
        '    from cocotb_tools.runner import get_runner',
        'except ModuleNotFoundError:',
        '    from cocotb.runner import get_runner',
        '',
        'def _json_env(name, default):',
        '    try:',
        '        return json.loads(os.environ.get(name, default))',
        '    except Exception as exc:',
        '        raise SystemExit(f"Invalid {name}: {exc}") from exc',
        '',
        'def main():',
        '    sources = _json_env("AURORA_COCOTB_SOURCES_JSON", "[]")',
        '    build_args = _json_env("AURORA_COCOTB_BUILD_ARGS_JSON", "[]")',
        '    test_args = _json_env("AURORA_COCOTB_TEST_ARGS_JSON", "[]")',
        '    top = os.environ["AURORA_COCOTB_TOP"]',
        '    test_module = os.environ["AURORA_COCOTB_TEST_MODULE"]',
        '    build_dir = os.environ["AURORA_COCOTB_BUILD_DIR"]',
        '    test_dir = os.environ.get("AURORA_COCOTB_TEST_DIR", build_dir)',
        '',
        '    for entry in os.environ.get("AURORA_COCOTB_PYTHONPATH", "").split(os.pathsep):',
        '        if entry and entry not in sys.path:',
        '            sys.path.insert(0, entry)',
        '',
        '    Path(build_dir).mkdir(parents=True, exist_ok=True)',
        '    os.environ.setdefault("SIM", "icarus")',
        '    os.environ.setdefault("TOPLEVEL_LANG", "verilog")',
        '    os.environ.setdefault("WAVES", "1")',
        '    sim = os.environ["SIM"]',
        '',
        '    runner = get_runner(sim)',
        '    runner.build(',
        '        sources=sources,',
        '        hdl_toplevel=top,',
        '        build_dir=build_dir,',
        '        build_args=build_args,',
        '        timescale=("1ns", "1ps"),',
        '        always=True,',
        '        waves=True,',
        '    )',
        '    runner.test(',
        '        hdl_toplevel=top,',
        '        test_module=test_module,',
        '        build_dir=build_dir,',
        '        test_dir=test_dir,',
        '        test_args=test_args,',
        '        waves=True,',
        '        results_xml=str(Path(build_dir) / "results.xml"),',
        '    )',
        '',
        'if __name__ == "__main__":',
        '    main()',
        '',
    ].join('\n');
    await window.electronAPI.writeFile(scriptPath, source);
    return scriptPath;
}

async _collectCocotbSources(config) {
    const fileSet = new Set();
    for (const path of config.synthesizableFiles || []) {
        if (isVerilogLikeFile(path)) fileSet.add(path);
    }
    if (config.topLevelFile && isVerilogLikeFile(config.topLevelFile)) {
        fileSet.add(config.topLevelFile);
    }

    try {
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
        const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlPath);
        if (Array.isArray(hdlEntries)) {
            for (const name of hdlEntries) {
                if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                    fileSet.add(await window.electronAPI.joinPath(hdlPath, name));
                }
            }
        }
    } catch (_e) { /* optional bundled HDL library */ }

    return [...fileSet];
}

async _stageProcessorMemoryFilesForCocotb(tempBaseDir, buildDir) {
    await this._stageProcessorMemoryFiles(tempBaseDir);
    let entries = [];
    try {
        entries = await window.electronAPI.listFilesInDirectory(tempBaseDir);
    } catch (_e) {
        return;
    }
    for (const name of entries || []) {
        if (typeof name !== 'string') continue;
        if (!name.startsWith('pc_') || !name.endsWith('_mem.txt')) continue;
        try {
            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(tempBaseDir, name),
                await window.electronAPI.joinPath(buildDir, name),
            );
        } catch (_copyErr) { /* best effort: simulator reports the missing file */ }
    }
}

async _resolveCocotbWaveSelection(ctx, config, sources) {
    await WaveStore.ensureRegistered(this.projectPath, ctx.tbKey, {
        tbPath: ctx.testbenchFile,
        tbModule: ctx.testModule,
        hadOriginalDumpvars: false,
    });

    const state = await WaveStore.read(this.projectPath, ctx.tbKey);
    const savedSignals = Array.isArray(state.waveSignals) ? state.waveSignals : [];
    const validSignals = savedSignals.length > 0
        ? await this._validateWaveSelection(savedSignals, sources, ctx.hdlTopModule, ctx.tbKey)
        : [];

    this._validatedWaveSelection = validSignals;

    if (validSignals.length > 0) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.waveSource', {
                label: tr('terminal.wave.sourceLabelWc', { count: validSignals.length }),
            }), 'info');
    }

    return validSignals;
}

async _findWaveCandidateInDir(dir, topModule) {
    let entries = [];
    try {
        entries = await window.electronAPI.listFilesInDirectory(dir);
    } catch (_e) {
        return null;
    }
    const waves = (entries || [])
        .filter((name) => typeof name === 'string' && /\.(fst|vcd)$/i.test(name) && name !== 'fix.vcd');
    if (waves.length === 0) return null;

    const preferred = [
        `${topModule}.fst`,
        `${topModule}.vcd`,
        'dump.fst',
        'dump.vcd',
    ];
    const lowerToName = new Map(waves.map((name) => [name.toLowerCase(), name]));
    for (const name of preferred) {
        const found = lowerToName.get(name.toLowerCase());
        if (found) return await window.electronAPI.joinPath(dir, found);
    }
    if (waves.length === 1) {
        return await window.electronAPI.joinPath(dir, waves[0]);
    }
    return null;
}

/**
 * Pull ONLY the VCD header (the $scope/$var hierarchy, up to $enddefinitions)
 * out of an FST — WITHOUT materializing the full text VCD. fst2vcd streams VCD
 * to stdout header-first; we accumulate stdout and, the instant we see
 * $enddefinitions, kill fst2vcd (cancelVvpProcess). So it iterates only the FST
 * geometry plus the first buffered block, never the whole multi-hundred-MB body.
 * The header alone is what _waveResolveGtkwSaveFile / _waveValidateUserGtkwAgainstVcd
 * parse to build the auto-gtkw and cross-check user .gtkw files; GTKWave then
 * opens the .fst directly. Returns true on success, false if the header could
 * not be captured (caller falls back to a full conversion).
 */
async _extractFstHeaderVcd(fstPath, headerVcdPath, fst2vcdBin, cwd) {
    if (typeof window.electronAPI.onExecSpecStream !== 'function'
        || typeof window.electronAPI.cancelVvpProcess !== 'function') {
        return false;
    }
    // No -o → fst2vcd emits the VCD to stdout (per its --help). We read the
    // header off the stream instead of writing a file.
    const spec = {
        step: 'fst2vcd',
        binary: fst2vcdBin,
        args: ['-f', fstPath],
        cwd,
        label: 'fst2vcd (header only — cancelled at $enddefinitions)',
    };
    const ENDDEFS = /\$enddefinitions\s+\$end/;
    let acc = '';
    let header = null;
    const unsubscribe = window.electronAPI.onExecSpecStream((payload) => {
        if (header !== null || !payload || payload.type !== 'stdout' || !payload.data) return;
        acc += payload.data;
        const m = ENDDEFS.exec(acc);
        if (m) {
            header = `${acc.slice(0, m.index + m[0].length)}\n`;
            // We have the whole hierarchy — stop fst2vcd before it streams the body.
            window.electronAPI.cancelVvpProcess();
        }
    });
    try {
        await runSpecStreamed(spec, { consumeEphemeral: true });
    } catch {
        // fall through — header may still have been captured before the throw
    } finally {
        unsubscribe();
    }
    // The boundary can also land exactly as the process closes (tiny design that
    // fully emitted before a chunk carried $enddefinitions) — re-check the tail.
    if (header === null) {
        const m = ENDDEFS.exec(acc);
        if (m) header = `${acc.slice(0, m.index + m[0].length)}\n`;
    }
    if (header === null || header.length === 0) return false;
    await window.electronAPI.writeFile(headerVcdPath, header);
    return true;
}

async _adoptCocotbWaveform(ctx, tools, buildDir) {
    // cocotb runs the sim with cwd = the test dir, so the dump can land next to
    // the .py (the project dir) instead of in buildDir. Search the build dir
    // first, then the testbench's dir.
    const testDir = await window.electronAPI.dirname(ctx.testbenchFile);
    const candidate =
        await this._findWaveCandidateInDir(buildDir, ctx.hdlTopModule) ||
        await this._findWaveCandidateInDir(testDir, ctx.hdlTopModule);
    if (!candidate) {
        throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
    }

    // Mirror the non-cocotb flow: hand GTKWave the FST (small, native) and stash
    // a header-only `.header.vcd` sibling for the auto-gtkw step to parse. We do
    // NOT convert the whole FST to a text VCD — that produced a 100+MB file (slow
    // to write, heavy on disk) purely to read its header. _extractFstHeaderVcd
    // pulls only the $scope/$var hierarchy (killing fst2vcd at $enddefinitions),
    // which is all _waveResolveGtkwSaveFile needs to filter to the Wave-Config
    // selection. Full conversion stays as a fallback if the header capture fails.
    if (/\.fst$/i.test(candidate)) {
        const targetFst = await window.electronAPI.joinPath(tools.tempBaseDir, `${ctx.hdlTopModule}.fst`);
        if (candidate.toLowerCase() !== targetFst.toLowerCase()) {
            await window.electronAPI.copyFile(candidate, targetFst);
        }
        const headerVcd = await window.electronAPI.joinPath(tools.tempBaseDir, `${ctx.hdlTopModule}.header.vcd`);
        const gotHeader = await this._extractFstHeaderVcd(
            targetFst, headerVcd, tools.fst2vcdBin, tools.tempBaseDir);
        if (gotHeader) {
            this.terminalManager.appendToTerminal('twave',
                tr('terminal.wave.cocotbVcd', { name: basenameOfPath(targetFst) }), 'info');
            return targetFst;
        }
        // Header capture unavailable/failed — fall back to the full text VCD.
        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.cocotbFstConvert'), 'info');
        const targetVcd = await window.electronAPI.joinPath(tools.tempBaseDir, `${ctx.hdlTopModule}.vcd`);
        const spec = buildFst2VcdSpec({
            fst2vcdBin: tools.fst2vcdBin,
            inputFile: candidate,
            outputFile: targetVcd,
            cwd: tools.tempBaseDir,
        });
        const result = await runSpec(spec, { consumeEphemeral: true });
        if (result.code !== 0 && result.code !== null) {
            throw new Error(tr('error.compilation.cocotbFst2vcdFailed', { code: result.code }));
        }
        if (!await window.electronAPI.fileExists(targetVcd)) {
            throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
        }
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.cocotbVcd', { name: basenameOfPath(targetVcd) }), 'info');
        return targetVcd;
    }

    // Candidate is already a text VCD (rare — cocotb dumped VCD directly). It is
    // its own parseable source, so just normalize it into the temp dir.
    const targetVcd = await window.electronAPI.joinPath(tools.tempBaseDir, `${ctx.hdlTopModule}.vcd`);
    if (candidate.toLowerCase() !== targetVcd.toLowerCase()) {
        await window.electronAPI.copyFile(candidate, targetVcd);
    }
    if (!await window.electronAPI.fileExists(targetVcd)) {
        throw new Error(tr('error.compilation.cocotbNoWave', { path: buildDir }));
    }
    this.terminalManager.appendToTerminal('twave',
        tr('terminal.wave.cocotbVcd', { name: basenameOfPath(targetVcd) }), 'info');
    return targetVcd;
}

/**
 * Resolve the simulator-specific half of the cocotb run.
 *
 * Both flows run on the ONE Python inside the unified mingw bundle
 * (components/Packages/msys/mingw64/bin/python.exe), whose cocotb carries
 * BOTH VPIs (libcocotbvpi_icarus.vpl + the static libcocotbvpi_verilator.a).
 * That Python needs PYTHONHOME at the bundle's mingw64 and its bin on PATH
 * (for its own DLLs + the iverilog/verilator/g++ it spawns). The only
 * per-simulator differences are SIM and the build args (-g2012 is Icarus-only).
 */
async _resolveCocotbSimProfile() {
    const vTools = await this._waveResolveVerilatorTools();
    const pythonPath = await window.electronAPI.joinPath(vTools.mingwBin, 'python.exe');
    if (!await window.electronAPI.fileExists(pythonPath)) {
        throw new Error(tr('error.compilation.cocotbVerilatorPythonMissing', { path: pythonPath }));
    }
    const status = await window.electronAPI.getVerilatorPythonStatus();
    if (!status?.ok || !status.hasCocotb) {
        throw new Error(tr('error.compilation.cocotbVerilatorPackageMissing', { path: pythonPath }));
    }
    // <bundle>/mingw64/bin → <bundle>/mingw64 (PYTHONHOME).
    const pythonHome = await window.electronAPI.dirname(vTools.mingwBin);
    const base = {
        pythonPath,
        prependPath: [vTools.mingwBin, vTools.usrBin],
        extraEnv: { PYTHONHOME: pythonHome },
    };
    // Verilator is stricter than Icarus: the SAPHO HDL (e.g. ula.v's float
    // normalization) trips warnings like UNOPTFLAT that Icarus tolerates.
    // Mirror the non-cocotb Verilator flow's -Wno set so warnings don't abort
    // the build (-Wno-fatal is the key one).
    const VERILATOR_BUILD = [
        '-Wno-fatal', '-Wno-TIMESCALEMOD', '-Wno-DECLFILENAME',
        '-Wno-STMTDLY', '-Wno-WIDTHTRUNC', '-Wno-WIDTHEXPAND',
        // Activate the YANC_SIM_VIS block in the generated <proc>.v so the
        // processor's mirrored variables/arrays (marked /* verilator public_flat */)
        // are visible in the waveform — same as the non-cocotb Verilator flow.
        // (Icarus gets this for free via the predefined __ICARUS__.)
        '+define+YANC_TRACE',
        // cocotb's runner builds the model with -Os (size). SAPHO sims are
        // embedded-processor and can run long, so optimize the C++ for speed
        // like the non-cocotb flow: -O3 + -march=native (Aurora builds and runs
        // on the same host and discards the exe, so native is safe). The last -O
        // on the g++ line wins, so this overrides cocotb's -Os.
        '-CFLAGS', '-O3',
        '-CFLAGS', '-march=native',
        // Dump FST instead of VCD: cocotb forces --trace (VCD); --trace-fst
        // comes after it in the command, so it wins (VM_TRACE_FST=1) and cocotb's
        // verilator.cpp wrapper writes dump.fst. FST is ~10x smaller than the raw
        // VCD, so the trace I/O during the (long) sim is far cheaper — the main
        // reason cocotb was slower than the native flow. _adoptCocotbWaveform
        // already converts the .fst to .vcd via fst2vcd for GTKWave.
        '--trace-fst',
    ];
    return getSimulator() === 'verilator'
        ? { ...base, sim: 'verilator', buildArgs: VERILATOR_BUILD }
        : { ...base, sim: 'icarus', buildArgs: ['-g2012'] };
}

async _waveRunCocotbSimulation(ctx, tools, config) {
    await TabManager.saveAllFiles();
    await window.electronAPI.mkdir(tools.tempBaseDir);

    const profile = await this._resolveCocotbSimProfile();

    const buildDir = await window.electronAPI.joinPath(
        tools.tempBaseDir,
        `cocotb_${safeNamePart(ctx.tbKey)}`,
    );
    await window.electronAPI.mkdir(buildDir);
    await this._stageProcessorMemoryFilesForCocotb(tools.tempBaseDir, buildDir);

    const sources = await this._collectCocotbSources(config);
    await this._resolveCocotbWaveSelection(ctx, config, sources);
    const tbDir = await window.electronAPI.dirname(ctx.testbenchFile);
    const runnerScript = await this._writeCocotbRunnerScript(tools.tempBaseDir);
    const pythonPathSep = ';';
    const env = {
        AURORA_COCOTB_SOURCES_JSON: JSON.stringify(sources),
        AURORA_COCOTB_TOP: ctx.hdlTopModule,
        AURORA_COCOTB_TEST_MODULE: ctx.testModule,
        AURORA_COCOTB_BUILD_DIR: buildDir,
        AURORA_COCOTB_TEST_DIR: tbDir,
        AURORA_COCOTB_PYTHONPATH: [tbDir, this.projectPath, buildDir].filter(Boolean).join(pythonPathSep),
        AURORA_COCOTB_BUILD_ARGS_JSON: JSON.stringify(profile.buildArgs),
        AURORA_COCOTB_TEST_ARGS_JSON: JSON.stringify([]),
        SIM: profile.sim,
        TOPLEVEL_LANG: 'verilog',
        WAVES: '1',
        // Force UTF-8 stdio so cocotb's logs (and the user's prints/docstrings)
        // with non-ASCII — arrows, pt-BR accents, emoji — don't crash the bundle
        // Python's logging on the Windows cp1252 codepage (UnicodeEncodeError).
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        ...profile.extraEnv,
    };

    const spec = buildCocotbRunSpec({
        pythonPath: profile.pythonPath,
        runnerScript,
        cwd: buildDir,
        env,
        prependPath: profile.prependPath,
    });

    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningCocotb', {
        sim: profile.sim === 'verilator' ? 'Verilator' : 'Icarus',
    }), 'info');
    this.terminalManager.appendToTerminal('twave', CommandSpec.formatSpec(spec), 'info', { internal: true });

    let unsubscribe = null;
    if (typeof window.electronAPI.onExecSpecStream === 'function') {
        unsubscribe = window.electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                this.terminalManager.appendToTerminal('twave', line, 'raw');
            }
        });
    }

    let code;
    try {
        const result = await runSpecStreamed(spec, { consumeEphemeral: true });
        code = result.code;
    } finally {
        if (unsubscribe) unsubscribe();
    }
    if (code !== 0) {
        throw new Error(tr('error.compilation.cocotbFailed', { code }));
    }

    return this._adoptCocotbWaveform(ctx, tools, buildDir);
}

/**
 * Build the .vvp via iverilog and confirm it landed at the expected
 * path. Always rebuilds — the instrumented testbench bakes the user's
 * $dumpvars selection in at iverilog time, so a previous .vvp would
 * lock in a previous selection.
 *
 * Inputs:  simTopModule, tempBaseDir
 * Returns: void (vvp file path is reconstructible from the inputs)
 * Throws:  if iverilog fails OR the expected .vvp isn't on disk
 * Side-effects: writes ${tempBaseDir}/${simTopModule}.vvp; logs to twave;
 *               also caches `this._validatedWaveSelection` as part of
 *               waveBuildVvp (the .gtkw resolver reads it).
 */
async _waveBuildAndVerifyVvp(simTopModule, tempBaseDir) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.buildingVvp'), 'info');
    await this.waveBuildVvp();
    // waveBuildVvp ja verifica internamente que o .vvp existe (defesa
    // em profundidade); este check externo permite mensagem de erro
    // especifica do contexto Wave caso o path seja sintetizado errado.
    const vvpFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);
    if (!await window.electronAPI.fileExists(vvpFile)) {
        throw new Error(tr('error.compilation.vvpNotProduced', { path: vvpFile }));
    }
}

/**
 * Run vvp on the freshly-built .vvp. We `cd` to tempBaseDir before
 * exec so any user-written `$dumpfile("foo.vcd")` lands in a
 * predictable location (the resolver below scans tempBaseDir).
 *
 * Inputs:  simTopModule, tools (uses tempBaseDir + vvpBin)
 * Returns: void
 * Throws:  if vvp exits non-zero
 * Side-effects: writes a .vcd somewhere under tempBaseDir; streams
 *               vvp's stdout/stderr to twave.
 */
async _waveRunVvpSimulation(simTopModule, tools) {
    // asmcomp gera `initial $readmemb("pc_<proc>_mem.txt", min)` dentro
    // do .v do processador (yanc/ASM/Sources/hdl.c). O caminho e
    // RELATIVO — vvp procura no CWD, que aqui e tempBaseDir.
    // Mas o cmmcomp escreve o pc_<proc>_mem.txt em
    // <components>/Temp/<proc>/, nao em <components>/Temp/.
    //
    // Antes de rodar o vvp, copiar todo pc_*_mem.txt que estiver em
    // qualquer Temp/<sub>/ pra Temp/ direto, pra que o $readmemb
    // resolva. Idempotente: se ja foi copiado antes, o copyFile
    // simplesmente sobrescreve com o mesmo conteudo.
    await this._stageProcessorMemoryFiles(tools.tempBaseDir);

    // Mesmo problema, outro vetor: testbenches do usuario costumam
    // ler arquivos de dado com $fopen("sinal.txt") ou $readmemh.
    // Paths sao relativos ao CWD do vvp (tempBaseDir), mas o usuario
    // espera resolucao relativa a pasta do testbench. Varremos o
    // source do testbench atras dessas chamadas e copiamos cada
    // arquivo da pasta do testbench pra tempBaseDir.
    //
    // Re-entry: runGtkWave ja validou pra Wave upstream; aqui so
    // precisamos consultar config.testbenchFile pra fazer staging
    // dos arquivos de dado referenciados pelo tb. loadConfigUnsafe
    // pega o config sem re-validar (evita throws fantasmas no meio
    // da execucao).
    const config = this.loadConfigUnsafe();
    if (config.testbenchFile) {
        await this._stageTestbenchDataFiles(tools.tempBaseDir, config.testbenchFile);
    }

    const vvpFile = await window.electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.vvp`);

    // Two-pass strategy:
    //
    //   Pass 1: run vvp with +AURORA_HEADER_ONLY. The auto-instrumented
    //   testbench (testbench_instrumenter.js) injects
    //
    //       if ($test$plusargs("AURORA_HEADER_ONLY")) $finish;
    //
    //   after the $dumpvars call. Simulation runs only the initial
    //   block — $dumpvars flushes the complete VCD header (every scope
    //   and signal name), then $finish exits cleanly. The resulting
    //   ${simTopModule}.vcd has a parseable header but no value-change
    //   section, which is exactly what Aurora needs for the Wave
    //   Configuration picker and the SAPHO-decorated auto-gtkw.
    //
    //   Pass 2: run vvp -fst (no plusarg) to completion. Result:
    //   ${simTopModule}.fst, 10-100x smaller than the equivalent VCD,
    //   opened by GTKWave at the end of the pipeline. The pass-1 .vcd
    //   stays on disk for downstream parsing; never opened by GTKWave.
    //
    // For testbenches with hand-written $dumpvars where Aurora ceded
    // control (no auto-instrumentation), the +AURORA_HEADER_ONLY
    // plusarg is a no-op and pass 1 runs the full simulation. That
    // costs the user-defined-dumpvars edge case extra runtime, but
    // the common path (Aurora-instrumented testbench) is fast.
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningVvp'), 'info');

    const vvpHeaderSpec = buildVvpHeaderSpec({
        vvpBin: tools.vvpBin,
        vvpFile,
        cwd: tools.tempBaseDir,
    });
    const headerResult = await runSpec(vvpHeaderSpec, { consumeEphemeral: true });
    // Pass 1 stdout/stderr are intentionally suppressed — the $finish
    // injected by the instrumenter produces a "$finish at simulation
    // time 0" line that's just noise. Errors surface via pass 2 anyway.
    if (headerResult.code !== 0 && headerResult.code !== null) {
        // Non-fatal: pass 2 may still succeed. Log a tip so the user
        // knows the auto-gtkw header capture failed.
        this.terminalManager.appendToTerminal('twave',
            `Note: header-only pass exited with code ${headerResult.code}; auto-gtkw may fall back to a generic layout.`,
            'tips');
    }

    // Stash the pass-1 text VCD under a separate name before pass 2
    // overwrites the original. vvp -fst keeps the $dumpfile() name
    // ("...vcd") but writes FST binary into it — without this copy
    // the pass-1 header is destroyed and the downstream parse sees
    // binary garbage where it expects $var/$scope lines.
    const pass1Vcd = await window.electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.vcd`);
    const headerVcd = await window.electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.header.vcd`);
    try {
        if (await window.electronAPI.fileExists(pass1Vcd)) {
            await window.electronAPI.copyFile(pass1Vcd, headerVcd);
        }
    } catch (e) {
        this.terminalManager.appendToTerminal('twave',
            `Note: could not stash pass-1 header (${e.message}); auto-gtkw may fall back to a generic layout.`,
            'tips');
    }

    // Stream pass-2 output to twave live so $display lines from the
    // testbench show up as the simulation progresses. User $display
    // lines get tagged 'raw' (no card, always visible). Lines that
    // are clearly vvp/iverilog system noise — dump-format announce,
    // $finish location, etc. — get tagged 'plain' so the verbose-off
    // filter hides them; the user only cares about those during
    // debugging.
    // Substring match (lowercased) is more robust than regex against
    // variations of vvp's bookkeeping output.
    const isVvpNoise = (line) => {
        const t = (line || '').toLowerCase();
        return (
            t.includes('fst info:')
            || t.includes('vcd info:')
            || t.includes('lxt info:') || t.includes('lxt2 info:')
            || t.includes('vzt info:')
            || t.includes('$finish called at')
            || t.includes('$stop called at')
        );
    };
    const unsubscribe = window.electronAPI.onExecSpecStream((payload) => {
        if (!payload || !payload.data) return;
        // Split so each line can be classified independently; chunks
        // from spawn can carry multiple newlines per data event.
        for (const line of payload.data.split(/\r?\n/)) {
            if (!line.trim()) continue;
            // Hard-drop toolchain bookkeeping lines (FST/VCD info,
            // $finish called at, …). They're useful only when
            // debugging the simulator itself, and the user has
            // electron-log + DevTools for that. Keeping them out
            // of twave entirely avoids the verbose-mode toggle
            // sync issue altogether.
            if (isVvpNoise(line)) continue;
            this.terminalManager.appendToTerminal('twave', line, 'raw');
        }
    });
    let code;
    try {
        const vvpRunSpec = buildVvpRunSpec({
            vvpBin: tools.vvpBin,
            vvpFile,
            cwd: tools.tempBaseDir,
        });
        const r = await runSpecStreamed(vvpRunSpec, { consumeEphemeral: true });
        code = r.code;
    } finally {
        unsubscribe();
    }
    if (code !== 0) {
        throw new Error(tr('error.compilation.vvpFailed', { code }));
    }
}

// ---------------------------------------------------------------------
// Verilator wave-flow phases. Paralelas a _waveBuildAndVerifyVvp /
// _waveRunVvpSimulation, mas com toolchain diferente:
//
//   iverilog: source -> .vvp -> vvp (interpretador)  → FST
//   verilator: source -> C++ -> g++ -> .exe nativo    → FST
//
// O .exe que sai do Verilator e tipicamente 10-100x mais rapido que vvp
// em testbenches longos, ao custo de stricter linting e dependencia
// adicional (verilator + g++). Escolha do simulador via
// js/wave/simulator_preference.js (default: iverilog).
// ---------------------------------------------------------------------

/**
 * Resolve os binarios necessarios pro pipeline do Verilator.
 *
 * Bundle Verilator autocontido em components/Packages/verilator/ —
 * preparado pelo scripts/build-verilator-bundle.js, baixado por
 * download-toolchain.js no `npm run bootstrap`. Layout:
 *
 *   components/Packages/verilator/
 *     mingw64/bin/{verilator,perl.exe,g++.exe,make.exe,...} + DLLs
 *     mingw64/share/verilator/{include,bin}/      <- templates C++
 *     usr/bin/{bash.exe,coreutils...}             <- shell utils que o
 *                                                    verilated.mk invoca
 *
 * Invocacao direta: perl <script> <args> com PATH ajustado. Sem msys2
 * no host, sem bash -lc, sem MSYSTEM, sem .sh intermediario.
 *
 * Throws com instrucao de bootstrap se o bundle nao estiver presente.
 */
async _waveResolveVerilatorTools() {
    const bundleRoot = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'msys');
    const mingwBin = await window.electronAPI.joinPath(bundleRoot, 'mingw64', 'bin');
    const usrBin   = await window.electronAPI.joinPath(bundleRoot, 'usr', 'bin');
    const verilatorScript = await window.electronAPI.joinPath(mingwBin, 'verilator');
    const perlExe         = await window.electronAPI.joinPath(mingwBin, 'perl.exe');
    const cxxBin          = await window.electronAPI.joinPath(mingwBin, 'g++.exe');

    if (!await window.electronAPI.fileExists(verilatorScript)) {
        throw new Error(tr('error.toolchain.verilatorNotFound', {
            paths: `  ${verilatorScript}\n  (bundle nao instalado — rode "npm run bootstrap" pra baixar)`,
        }));
    }
    if (!await window.electronAPI.fileExists(perlExe)) {
        throw new Error(tr('error.toolchain.verilatorNotFound', {
            paths: `  ${perlExe}\n  (bundle corrompido — apague components/Packages/msys/ e rode "npm run bootstrap")`,
        }));
    }

    // fst2vcd vem do gtkwave-nipscern (a unica CLI de GTKWave que o Aurora usa).
    const fst2vcdBin = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'gtkwave-nipscern', 'fst2vcd.exe',
    );

    // PATH em runtime: bundle/mingw64/bin (verilator, perl, g++, make,
    // DLLs) + bundle/usr/bin (bash + coreutils que o verilated.mk usa
    // via `$(shell ...)`). System32 sempre presente automaticamente
    // quando invocamos via cmd.exe com `%PATH%` suffix.
    return { mingwBin, usrBin, verilatorScript, perlExe, cxxBin, fst2vcdBin };
}

/**
 * Compila o design via Verilator. Produz um .exe nativo em
 * <tempBaseDir>/obj_dir_<simTop>/V<simTop>.exe.
 *
 * Reusa _prepareWaveBuildInputs pra resolver selecao + instrumentar
 * testbench — o conjunto de fontes que vai pro Verilator e o mesmo que
 * iria pro iverilog (synth + tb instrumentado + -y HDL).
 *
 * Flags Verilator:
 *   --binary       gera main + invoca make pra produzir o .exe
 *   --main         o main e gerado pelo Verilator (default eval-loop ate $finish)
 *   --trace-fst    instrumenta runtime pra FST (respeita $dumpvars/$dumpfile)
 *   -j 0           parallel build (numero de CPUs)
 *   -O0            zero optimization no Verilator (build rapido; runtime ainda
 *                  e nativo, entao bem mais rapido que vvp mesmo sem O3)
 *   -Wno-fatal     warnings nao param o build — iverilog e mais permissivo
 *                  que Verilator, entao testbenches que rodam em iverilog
 *                  costumam ter "issues" que Verilator marcaria como erro
 *   -Mdir <dir>    onde gerar os arquivos C++ e o Makefile
 *   --top-module   modulo top da simulacao (== nome do testbench)
 *   -y <hdl>       biblioteca de modulos (mesma logica do iverilog)
 *
 * Throws se Verilator falhar OU se o .exe nao for produzido.
 */
async _waveBuildVerilator(simTopModule, tempBaseDir, config, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.buildingVerilator'), 'plain');

    const prep = await this._prepareWaveBuildInputs(config, simTopModule, tempBaseDir);
    if (prep.instrumentedTbPath !== config.testbenchFile) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.veri.autoInstrTb', { name: prep.instrumentedTbPath.split(/[\\/]/).pop() }), 'plain');
    }

    const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
    const objDir = await window.electronAPI.joinPath(tempBaseDir, `obj_dir_${simTopModule}`);
    await window.electronAPI.mkdir(objDir);

    // --timing (e nao --no-timing): testbenches SAPHO usam # delays pra
    // gerar clock e timing de IO. Sem isso, o clk fica preso em settling
    // loop e simulacao aborta com DIDNOTCONVERGE. Verilator 5.x suporta
    // --timing via -fcoroutines do g++.
    //
    // Otimizacoes (vs primeira versao -O0):
    //  - SEM `-O0`: deixa Verilator usar o default `--O3` (otimizacao do
    //    Verilog pra C++). Build ~2x mais lento, runtime ~5x mais rapido.
    //  - `--x-assign fast`: assume X = 0 (em vez de gerar codigo de
    //    tracking de X-state). Ganho substancial em design com regs
    //    inicializados implicitamente.
    //  - `--no-trace-top`: nao tracker signals nivel raiz (TOP scope nao
    //    interessa pro picker; reduz overhead do tracing).
    //  - `-CFLAGS '-O3 -fstrict-aliasing'`: g++ usa -O3 em vez do -Os
    //    default do Verilator (que otimiza tamanho, nao velocidade).
    //    Tecnica: g++ recebe -Os primeiro (do OPT_FAST) e -O3 depois (do
    //    CFLAGS) — quando ha multiplas flags -O*, a ULTIMA vence.
    //    OPT_FAST=-O3 via env nao funciona porque o Makefile gerado usa
    //    `=` direto (nao `?=`), entao env nao sobrescreve.
    //    Build fica ~2x mais lento, runtime ~3-5x mais rapido — maior
    //    ganho isolado da otimizacao.
    //
    // Filosofia de warnings: deixar passar o que indica bug ou
    // oportunidade de melhoria. Silenciar so o que e mecanico/SAPHO
    // convention e nao agrega valor de revisao:
    //   - TIMESCALEMOD: floods 50+ warnings (1 por modulo); a fix e
    //     mecanica (`timescale 1ns/1ps em cada .v). Util saber, mas
    //     a primeira leva drowna o resto.
    //   - DECLFILENAME: SAPHO usa "proc_*.v contem module Proc*" como
    //     convencao; nao e bug.
    //   - STMTDLY: --timing ja trata #delay; aviso e redundante.
    //   - fatal: alguns "warnings" viram errors em Verilator; precisamos
    //     manter como warning pra Aurora seguir o build.
    //
    // Tudo o resto vem a tona — WIDTHTRUNC/EXPAND, COMBDLY, INITIALDLY,
    // PINMISSING, UNOPTFLAT, UNUSEDSIGNAL/PARAM — sao reais e iverilog
    // escondia. Vale revisar o codigo a partir deles.
    const verilatorWarnings = [
        '-Wno-fatal',
        '-Wno-TIMESCALEMOD',
        '-Wno-DECLFILENAME',
        '-Wno-STMTDLY',
    ];
    // Visibilidade de signals sob Verilator (YANC v4.3): o harness agora
    // compila sob Verilator via +define+YANC_TRACE (ver buildVerilatorBuildSpec).
    // O <proc>.v gerado espelha cada variavel/array do usuario, a PC->C±
    // line table, o opcode tap e os I/O ports em signals de sim-visibility
    // taggeados /* verilator public_flat */ — entao essas variaveis curadas
    // aparecem no FST igual ao iverilog, e proc.valr10 resolve
    // hierarquicamente (por isso o strip workaround foi removido — o $finish
    // de fim-de-programa funciona).
    //
    // O que continua NAO-visivel sob Verilator: os CPU internals e wires de
    // plumbing (me1_f_global_v_..., raw `comp` halves, valr5, PC-delay
    // intermediates) — o <proc>.v os cerca com /* verilator tracing_off */
    // (no-op pro iverilog). Sob Verilator a fence vence mesmo que o
    // $dumpvars do picker nomeie um deles; sob iverilog tudo e dumpavel.
    // Expor um signal cercado sob Verilator exigiria um .vlt per-proc do
    // lado do yanc.
    const buildSources = [...prep.fileSet];
    // Builder monta tokens individuais (sem aspas, sem shell). Executor
    // em main faz spawn(perlExe, args, { shell:false }) — cada token vai
    // direto pro child sem reparse. -CFLAGS aparece duas vezes (O3 +
    // fstrict-aliasing) porque o cmd-via-shell antigo perdia aspas; com
    // shell:false isso virou apenas convenção do Verilator (uma flag
    // por -CFLAGS) — preservada no builder.
    const verilatorSpec = buildVerilatorBuildSpec({
        perlExe: tools.perlExe,
        verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin,
        usrBin: tools.usrBin,
        hdlPath,
        simTopModule,
        objDir,
        sourceFiles: buildSources,
        cwd: tempBaseDir,
        extraWarnings: verilatorWarnings,
    });

    this.terminalManager.appendToTerminal('twave', CommandSpec.formatSpec(verilatorSpec), 'info', { internal: true });

    const result = await runSpec(verilatorSpec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput('twave', result);
    if (result.code !== 0) {
        throw new Error(tr('error.compilation.verilatorFailed', { code: result.code }));
    }

    // Verilator nomeia o .exe como V<top>.exe (Windows mingw) ou V<top>.
    const exePath = await window.electronAPI.joinPath(objDir, `V${simTopModule}.exe`);
    if (!await window.electronAPI.fileExists(exePath)) {
        const fallback = await window.electronAPI.joinPath(objDir, `V${simTopModule}`);
        if (!await window.electronAPI.fileExists(fallback)) {
            throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
        }
        return { exePath: fallback, objDir };
    }
    return { exePath, objDir };
}

/**
 * Roda o .exe do Verilator em duas passadas, espelhando a estrategia
 * do _waveRunVvpSimulation:
 *
 *   Pass 1: +AURORA_HEADER_ONLY → o testbench instrumentado faz $finish
 *           logo apos $dumpvars. Produz <simTop>.vcd contendo FST data
 *           header-only (Verilator com --trace-fst escreve formato FST
 *           no arquivo que $dumpfile nomeou, sem trocar extensao).
 *
 *   Convert: fst2vcd <simTop>.vcd → <simTop>.header.vcd (texto VCD,
 *            consumido pelo wave_config_manager + gtkw_proc_writer).
 *
 *   Pass 2: sem plusarg → sobrescreve <simTop>.vcd com FST completo.
 *           GTKWave abre esse arquivo direto (autodetecta FST).
 *
 * Cwd do .exe = tempBaseDir, pelos mesmos motivos do vvp ($readmemb
 * relativo, $fopen do testbench relativo).
 */
async _waveRunVerilatorSimulation(simTopModule, tools, exePath) {
    await this._stageProcessorMemoryFiles(tools.tempBaseDir);

    // Re-entry: runGtkWave ja validou; aqui so consultamos testbenchFile.
    const config = this.loadConfigUnsafe();
    if (config.testbenchFile) {
        await this._stageTestbenchDataFiles(tools.tempBaseDir, config.testbenchFile);
    }

    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.runningVerilator'), 'plain');

    // Pass 1: header capture. PATH inclui bundle mingw + usr bin pro
    // .exe achar libstdc++-6.dll / libwinpthread-1.dll / msys DLLs em
    // runtime (Verilator-generated binary linka contra mingw64 runtime).
    const verilatorHeaderSpec = buildVerilatorHeaderSpec({
        exePath,
        cwd: tools.tempBaseDir,
        mingwBin: tools.mingwBin,
        usrBin: tools.usrBin,
    });
    const headerResult = await runSpec(verilatorHeaderSpec, { consumeEphemeral: true });
    if (headerResult.code !== 0 && headerResult.code !== null) {
        // Nao fatal — pass 2 ainda pode resolver. Log curto.
        this.terminalManager.appendToTerminal('twave',
            `Note: header-only pass exited with code ${headerResult.code}; auto-gtkw may fall back to a generic layout.`,
            'tips');
    } else {
        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.verilatorHeaderOk'), 'plain');
    }

    // Converte pass-1 FST → texto VCD pro picker (wave_config_manager,
    // gtkw_proc_writer). fst2vcd detecta formato por magic, entao
    // extensao .vcd no arquivo de entrada (que contem FST) e OK.
    const pass1File = await window.electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.vcd`);
    const headerVcd = await window.electronAPI.joinPath(tools.tempBaseDir, `${simTopModule}.header.vcd`);
    if (await window.electronAPI.fileExists(pass1File)) {
        if (await window.electronAPI.fileExists(tools.fst2vcdBin)) {
            this.terminalManager.appendToTerminal('twave', tr('terminal.wave.verilatorFstConvert'), 'plain');
            // fst2vcd exige `-f <input>` explicito (positional argument
            // imprime pra stdout em vez de honrar o `-o`).
            const fst2vcdSpec = buildFst2VcdSpec({
                fst2vcdBin: tools.fst2vcdBin,
                inputFile: pass1File,
                outputFile: headerVcd,
                cwd: tools.tempBaseDir,
            });
            const convertResult = await runSpec(fst2vcdSpec, { consumeEphemeral: true });
            if (convertResult.code !== 0 && convertResult.code !== null) {
                this.terminalManager.appendToTerminal('twave',
                    tr('error.compilation.fst2vcdFailed', { code: convertResult.code }), 'warning');
            }
        } else {
            // Sem fst2vcd? Tenta copiar o FST como header.vcd e deixa o
            // parser do picker tentar — vai falhar mas com mensagem
            // melhor que silencio.
            try { await window.electronAPI.copyFile(pass1File, headerVcd); } catch (_e) { /* */ }
        }
    }

    // Pass 2: full sim. Stream output pro twave live (igual vvp pass 2).
    const isVvpNoise = (line) => {
        const t = (line || '').toLowerCase();
        return (
            t.includes('fst info:')
            || t.includes('vcd info:')
            || t.includes('$finish called at')
            || t.includes('$stop called at')
        );
    };
    // Banner/relatorio do PROPRIO Verilator (prefixados "- ": "Simulation
    // Report", "Verilator: walltime/cpu", "...Verilog $finish") = toolchain
    // noise. Marca 'plain' (verbose-only) pra sumir com verbose off; os
    // $display do testbench (sem esse prefixo) seguem 'raw' (sempre visivel).
    const isVerilatorReport = (line) => {
        const t = (line || '').trim();
        if (!t.startsWith('-')) return false;
        const low = t.toLowerCase();
        return low.includes('verilator')
            || low.includes('$finish')
            || low.includes('$stop')
            || low.replace(/\s/g, '').includes('simulationreport');
    };

    let unsubscribe = null;
    if (typeof window.electronAPI.onExecSpecStream === 'function') {
        unsubscribe = window.electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (isVvpNoise(line)) continue;
                this.terminalManager.appendToTerminal('twave', line, isVerilatorReport(line) ? 'plain' : 'raw');
            }
        });
    }
    let code;
    try {
        // PATH precisa incluir bundle mingw64+usr bin: o .exe gerado pelo
        // Verilator linka dinamicamente contra libstdc++-6.dll / libgcc /
        // libwinpthread do bundle, e sem PATH o Windows aborta com
        // STATUS_DLL_NOT_FOUND (0xC0000135 → exit 3221225781). O builder
        // monta isso via prependPath; executor em main injeta no env.
        const verilatorRunSpec = buildVerilatorRunSpec({
            exePath,
            cwd: tools.tempBaseDir,
            mingwBin: tools.mingwBin,
            usrBin: tools.usrBin,
        });
        const r = await runSpecStreamed(verilatorRunSpec, { consumeEphemeral: true });
        code = r.code;
    } finally {
        if (unsubscribe) unsubscribe();
    }
    if (code !== 0) {
        throw new Error(tr('error.compilation.verilatorRunFailed', { code }));
    }
}

// =====================================================================
// Botao "Verilator (processador CMM)"
// =====================================================================
//
// Roda o top-level gerado pelo compilador CMM (<proc>.v) com Verilator,
// usando a fiacao previsivel do processador SAPHO. Self-contained: o
// handler (compilation_flow) ja roda cmm+asm antes pra ter <proc>.v,
// <proc>_tb.v e .mif frescos.
//
//   1. --json-only no <proc>.v        -> portas (clk/rst/in/out/req_in/out_en[/itr])
//   2. parseia o <proc>_tb.v          -> fiacao input_<N>.txt <-> req_in one-hot,
//                                        output_<N>.txt <-> out_en one-hot
//   3. gera o harness C++ (decimal com sinal, rst pulso, itr=0 se existir)
//   4. --cc --exe --build             -> V<proc>.exe
//   5. roda numClocks fixos no <proc>/Simulation/ (mesmos arquivos do iverilog)
//
// O exe imprime no fim "N clocks simulados, M leitura(s) de entrada" no
// terminal twave. Diferente do botao top-level generico, NAO ha templates
// nem diretivas `# @gate` — a fiacao vem do tb.

/**
 * Resolve o processador-alvo do botao: o PROCESSADOR ATIVO mostrado na
 * status bar (o .cmm em foco no editor cruzado com a lista do projeto).
 * Fonte unica = window.statusBarManager.getActiveProcessorName(). Retorna
 * o objeto do processador (com numClocks) ou null se nao ha ativo — caso
 * em que o botao ja deveria estar desabilitado; o run() trata o null com
 * uma mensagem clara como rede de seguranca (ex: chamada via AuroraAPI).
 */
_resolveProcessorTarget() {
    const activeName = window.statusBarManager?.getActiveProcessorName?.() || null;
    if (!activeName) return null;
    const procs = (Array.isArray(this.projectConfig?.processors) ? this.projectConfig.processors : [])
        .map((p) => (typeof p === 'string' ? { name: p } : p))
        .filter((p) => p && p.name);
    return procs.find((p) => p.name === activeName) || null;
}

/**
 * Pipeline do harness Verilator do processador CMM. Throws com mensagem
 * clara em qualquer falha de etapa.
 */
async verilatorProcessorRun() {
    await this.initializeComponentsPath();
    if (!this.projectConfig) throw new Error(tr('error.config.notLoaded'));

    const proc = this._resolveProcessorTarget();
    if (!proc) throw new Error(tr('error.compilation.noActiveProcessor'));
    const procName = proc.name;
    const numClocks = Number.isFinite(proc.numClocks) ? proc.numClocks : 2000;

    const procDir = await window.electronAPI.joinPath(this.projectPath, procName);
    const procV = await window.electronAPI.joinPath(procDir, 'Hardware', `${procName}.v`);
    const simDir = await window.electronAPI.joinPath(procDir, 'Simulation');

    if (!await window.electronAPI.fileExists(procV)) {
        throw new Error(tr('error.compilation.procVMissing', { path: procV }));
    }

    const tools = await this._waveResolveVerilatorTools();
    const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
    const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
    const objDir = await window.electronAPI.joinPath(tempBaseDir, `obj_dir_proc_${procName}`);
    await window.electronAPI.mkdir(objDir);

    // Todo este fluxo loga no terminal THTEST (Hardware Test) — etapas de
    // pipeline em alto nivel (info/success), ruido da toolchain
    // (verilator/perl/g++/make) so no modo verbose (plain), e a barra de
    // progresso ASCII inline da execucao. Ver renderHardwareProgress.
    const T = 'thtest';

    // ---- Inicio ----
    this.terminalManager.appendToTerminal(T, tr('terminal.htest.start', { name: procName, clocks: numClocks }), 'info');

    // ---- Passo 1: portas via --json-only ----
    this.terminalManager.appendToTerminal(T, tr('terminal.wave.procPorts', { name: procName }), 'info');
    const jsonSpec = buildVerilatorJsonSpec({
        perlExe: tools.perlExe, verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        hdlPath, topModule: procName, objDir,
        sourceFiles: [procV], cwd: tempBaseDir,
    });
    this.terminalManager.appendToTerminal(T, CommandSpec.formatSpec(jsonSpec), 'info', { internal: true });
    const jsonResult = await runSpec(jsonSpec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput(T, jsonResult);
    if (jsonResult.code !== 0) throw new Error(tr('error.compilation.verilatorJsonFailed', { code: jsonResult.code }));
    const jsonPath = await window.electronAPI.joinPath(objDir, `V${procName}.tree.json`);
    if (!await window.electronAPI.fileExists(jsonPath)) {
        throw new Error(tr('error.compilation.verilatorJsonMissing', { path: jsonPath }));
    }
    const ports = parseVerilatorPorts(JSON.parse(await window.electronAPI.readFile(jsonPath, { encoding: 'utf8' })));

    // ---- Passo 2: fiacao de I/O lida do proprio <proc>.v (bloco YANC_SIM_VIS) ----
    const wiring = parseProcessorIO(await window.electronAPI.readFile(procV, { encoding: 'utf8' }));
    if (wiring.inputs.length === 0 && wiring.outputs.length === 0) {
        this.terminalManager.appendToTerminal(T, tr('terminal.wave.procNoPorts'), 'warning');
    }

    // ---- Passo 3: gera o harness C++ ----
    this.terminalManager.appendToTerminal(T, tr('terminal.htest.genCpp', { name: procName }), 'info');
    const gen = generateVerilatorProcTb({
        topModule: procName, ports,
        inputs: wiring.inputs, outputs: wiring.outputs,
        numClocks,
    });
    const cppPath = await window.electronAPI.joinPath(tempBaseDir, `tl_proc_${procName}.cpp`);
    await window.electronAPI.writeFile(cppPath, gen.source);

    this.terminalManager.appendToTerminal(T,
        tr('terminal.wave.procWiring', {
            inputs: wiring.inputs.map((p) => `${p.file}@req${p.reqValue}`).join(', ') || '—',
            outputs: wiring.outputs.map((p) => `${p.file}@en${p.enValue}`).join(', ') || '—',
            itr: gen.hasItr ? 'itr=0' : 'sem itr',
        }), 'info');

    // ---- Passo 4: build ----
    this.terminalManager.appendToTerminal(T, tr('terminal.wave.procBuilding', { name: procName }), 'info');
    const buildSpec = buildVerilatorTbBuildSpec({
        perlExe: tools.perlExe, verilatorScript: tools.verilatorScript,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        hdlPath, topModule: procName, objDir,
        sourceFiles: [procV, cppPath], cwd: tempBaseDir,
    });
    this.terminalManager.appendToTerminal(T, CommandSpec.formatSpec(buildSpec), 'info', { internal: true });
    const buildResult = await runSpec(buildSpec, { consumeEphemeral: true });
    this.terminalManager.processExecutableOutput(T, buildResult);
    if (buildResult.code !== 0) throw new Error(tr('error.compilation.verilatorTbBuildFailed', { code: buildResult.code }));

    let exePath = await window.electronAPI.joinPath(objDir, `V${procName}.exe`);
    if (!await window.electronAPI.fileExists(exePath)) {
        const fallback = await window.electronAPI.joinPath(objDir, `V${procName}`);
        if (!await window.electronAPI.fileExists(fallback)) {
            throw new Error(tr('error.compilation.verilatorExeMissing', { path: exePath }));
        }
        exePath = fallback;
    }

    // ---- Passo 5: roda numClocks no Simulation/ (streamed, com barra) ----
    this.terminalManager.appendToTerminal(T, tr('terminal.wave.procRunning', { name: procName, clocks: numClocks }), 'info');
    const runProcSpec = buildVerilatorTbRunSpec({
        exePath, cwd: simDir,
        mingwBin: tools.mingwBin, usrBin: tools.usrBin,
        cycles: numClocks,
    });
    this.terminalManager.appendToTerminal(T, CommandSpec.formatSpec(runProcSpec), 'info', { internal: true });

    // O harness imprime "@@AURORA_PROG <cyc> <nclk> <reads>" no stdout a
    // cada ~1% dos clocks (com fflush). A gente consome essas linhas pra
    // mover a barra ASCII inline e NAO as ecoa; o resto do stdout (relatorio
    // do Verilator, etc) vai como plain (so no verbose).
    // @@AURORA_PROG move a barra; @@AURORA_CHEGUEI <clock> sinaliza que o
    // pino `cheguei` (#TOAQUI) encerrou a sim — guardamos o clock pra avisar
    // o usuario. Ambos sao consumidos (nao ecoados); o resto do stdout vai
    // como plain (so no verbose).
    const PROG_RE = /^@@AURORA_PROG\s+(\d+)\s+(\d+)\s+(\d+)/;
    const CHEGUEI_RE = /^@@AURORA_CHEGUEI\s+(\d+)/;
    const execLabel = tr('terminal.htest.exec');
    let chegueiClock = null;
    let lastReads = null;
    let unsub = null;
    if (typeof window.electronAPI.onExecSpecStream === 'function') {
        unsub = window.electronAPI.onExecSpecStream((payload) => {
            if (!payload || !payload.data) return;
            for (const line of payload.data.split(/\r?\n/)) {
                const m = line.match(PROG_RE);
                if (m) {
                    const cyc = +m[1];
                    const total = +m[2] || numClocks;
                    const reads = +m[3];
                    lastReads = reads;
                    const pct = total ? Math.round((cyc / total) * 100) : 0;
                    this.terminalManager.renderHardwareProgress?.(T, { pct, cyc, total, reads, label: execLabel });
                    continue;
                }
                const ch = line.match(CHEGUEI_RE);
                if (ch) { chegueiClock = +ch[1]; continue; }
                if (!line.trim()) continue;
                this.terminalManager.processStreamedLine(T, line.trim());
            }
        });
    }
    let runCode;
    try {
        const r = await runSpecStreamed(runProcSpec, { consumeEphemeral: true });
        runCode = r.code;
    } finally {
        if (unsub) unsub();
    }
    if (runCode !== 0) throw new Error(tr('error.compilation.verilatorTbRunFailed', { code: runCode }));

    // Fecha a barra no clock REAL de parada: o teto (numClocks) num run
    // completo, ou o clock do `cheguei` se o programa terminou antes — assim
    // a barra para em "1224/2000", nao forca "2000/2000".
    const endCyc = chegueiClock != null ? chegueiClock : numClocks;
    const endPct = numClocks ? Math.min(100, Math.round((endCyc / numClocks) * 100)) : 100;
    this.terminalManager.renderHardwareProgress?.(T, {
        pct: endPct, cyc: endCyc, total: numClocks, reads: lastReads, label: execLabel, done: true,
    });

    // Encerrou pelo pino `cheguei` (programa terminou antes do teto de clocks).
    if (chegueiClock != null) {
        this.terminalManager.appendToTerminal(T,
            tr('terminal.htest.chegueiEnd', { clock: chegueiClock }), 'success');
    }

    // Mensagem final com o diretorio de saida como LINK: clicar abre a
    // view de pastas da file tree e revela essa pasta (aberta).
    const doneMsg = tr('terminal.wave.procDone', {
        dir: simDir,
        outputs: wiring.outputs.map((p) => p.file).join(', ') || '—',
    });
    if (this.terminalManager.appendFolderLink) {
        this.terminalManager.appendFolderLink(T, doneMsg, simDir, 'success');
    } else {
        this.terminalManager.appendToTerminal(T, doneMsg, 'success');
    }
}

/**
 * Varre subdirectorias de tempBaseDir procurando arquivos pc_*_mem.txt
 * (gerados pelo cmmcomp em cada Temp/<proc>/) e copia pro proprio
 * tempBaseDir. vvp roda com CWD=tempBaseDir e precisa achar esses
 * arquivos no $readmemb que o ProcDTW.v faz internamente.
 *
 * Tolerante a falha por subdir — se uma das pastas nao puder ser
 * lida, segue pra proxima. Tolerante a "subdir nao existe ou nao tem
 * arquivo de memoria" — silencio.
 */
async _stageProcessorMemoryFiles(tempBaseDir) {
    // Projeto sem processador no .spf nunca gera pc_*_mem.txt — o
    // $readmemb que consome esses arquivos so existe dentro do .v do
    // processador SAPHO. Pular o staging inteiro (incluindo o warning
    // "no pc_*_mem.txt found") nesse caso: procurar arquivos de memoria
    // de processador num design que nao tem processador so confunde.
    const procs = Array.isArray(this.projectConfig?.processors)
        ? this.projectConfig.processors.filter(
            (p) => p && (typeof p === 'string' ? p.trim() : p.name))
        : [];
    if (procs.length === 0) return;

    let entries;
    try {
        entries = await window.electronAPI.getFolderFiles(tempBaseDir);
    } catch (_e) {
        this.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.couldNotList', { path: tempBaseDir }),
            'warning',
        );
        return;
    }
    if (!Array.isArray(entries)) return;

    let staged = 0;
    const failedSubdirs = [];
    for (const entry of entries) {
        if (!entry?.isDirectory) continue;
        const subDir = entry.path;
        let subFiles;
        try {
            subFiles = await window.electronAPI.listFilesInDirectory(subDir);
        } catch (_e) {
            failedSubdirs.push(subDir);
            continue;
        }
        if (!Array.isArray(subFiles)) continue;
        for (const fileName of subFiles) {
            if (typeof fileName !== 'string') continue;
            if (!fileName.startsWith('pc_') || !fileName.endsWith('_mem.txt')) continue;
            const src = await window.electronAPI.joinPath(subDir, fileName);
            const dst = await window.electronAPI.joinPath(tempBaseDir, fileName);
            try {
                await window.electronAPI.copyFile(src, dst);
                staged++;
            } catch (_e) {
                this.terminalManager.appendToTerminal(
                    'twave',
                    tr('terminal.wave.copyMemFailed', { name: fileName, path: subDir }),
                    'warning',
                );
            }
        }
    }

    if (staged === 0) {
        // Sem nenhum pc_*_mem.txt → o $readmemb do .v do processador
        // vai falhar logo a seguir. Avisar claramente em vez de deixar
        // o erro do vvp ser a unica pista. O caminho de sucesso e
        // silencioso por design: copiar arquivos de mem entre pastas
        // e plumbing interno, nao algo que o usuario precisa saber.
        this.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.noMemFiles', { path: tempBaseDir }),
            'warning',
        );
    }
}

/**
 * Varre o source do testbench atras de chamadas $fopen / $readmemb /
 * $readmemh com argumentos string literal. Pra cada arquivo
 * referenciado por path relativo (i.e. sem drive letter ou raiz
 * absoluta), tenta copia-lo de <dir-do-testbench>/<nome> pra
 * tempBaseDir/<nome> — onde vvp realmente procura, ja que roda com
 * CWD=tempBaseDir.
 *
 * Suporta paths com subpastas (ex: $fopen("data/x.txt")) criando
 * dirs intermediarios em tempBaseDir.
 *
 * Tolerante a falhas: arquivo nao existe ou copia falha apenas
 * pula com warning silencioso. O proprio erro do vvp (com
 * mensagem clara apontando o $fopen falho) e mais informativo
 * que tentar adivinhar aqui.
 */
async _stageTestbenchDataFiles(tempBaseDir, testbenchPath) {
    if (!testbenchPath) return;
    let content;
    try {
        content = await window.electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
    } catch (_e) {
        return;
    }

    // Coletar so arquivos que o testbench LE — sao os que precisam
    // ser stageados em tempBaseDir antes do vvp rodar. Arquivos
    // abertos pra ESCRITA (ex: um dump.txt via $fopen("...", "w"))
    // sao output do testbench e nao existem antes da simulacao;
    // stageamos quebraria com um warning falso "not found".
    //
    //   $readmemb / $readmemh        — sempre leitura → stage.
    //   $fopen sem 2o arg            — modo write-only (padrao Verilog
    //                                  2001 retorna mcd) → skip.
    //   $fopen com 2o arg "r"/"rb"   — leitura → stage.
    //   $fopen com qualquer outro
    //   modo ("w","a","wb",etc)      — write/append → skip.
    const filenames = new Set();
    // $readmemb / $readmemh — argumento entre aspas duplas.
    const reReadmem = /\$readmem[bh]\s*\(\s*"([^"]+)"/g;
    let m;
    while ((m = reReadmem.exec(content)) !== null) {
        filenames.add(m[1]);
    }
    // $fopen("file", "mode") — captura modo pra decidir se le ou
    // escreve. Sem 2o arg, e write-only por default (Verilog 2001
    // returns mcd) — nao entra aqui, ent skip implicito.
    const reFopenWithMode = /\$fopen\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
    while ((m = reFopenWithMode.exec(content)) !== null) {
        const mode = m[2].toLowerCase();
        // Modos de leitura: "r", "rb", "r+", "rb+", "r+b". Conservador
        // mas cobre os casos comuns.
        if (mode === 'r' || mode === 'rb' || mode.startsWith('r+') || mode.startsWith('rb+')) {
            filenames.add(m[1]);
        }
    }
    if (filenames.size === 0) return;

    const tbDir = await window.electronAPI.dirname(testbenchPath);
    const failures = [];
    for (const fname of filenames) {
        // Skip absolute paths — usuario sabe o que quer (e o vvp
        // resolve corretamente desde o CWD).
        if (/^[a-zA-Z]:[\\/]/.test(fname) || fname.startsWith('/') || fname.startsWith('\\')) continue;
        const clean = fname.replace(/^\.[\\/]+/, '');
        const src = await window.electronAPI.joinPath(tbDir, clean);
        try {
            const exists = await window.electronAPI.fileExists(src);
            if (!exists) {
                failures.push({ name: fname, reason: 'not found in testbench folder' });
                continue;
            }
            const dst = await window.electronAPI.joinPath(tempBaseDir, clean);
            // Garante dirs intermediarios pra fname com subpasta.
            const dstDir = await window.electronAPI.dirname(dst);
            if (dstDir && dstDir !== tempBaseDir) {
                try { await window.electronAPI.mkdir(dstDir); } catch (_e) { /* exists ok */ }
            }
            await window.electronAPI.copyFile(src, dst);
        } catch (e) {
            failures.push({ name: fname, reason: e.message });
        }
    }

    // Success path is silent — copying testbench data files between
    // folders is internal plumbing. Failures still surface as warnings
    // because those *are* actionable (a missing data file means the
    // testbench will crash on $readmemh).
    for (const fail of failures) {
        this.terminalManager.appendToTerminal(
            'twave',
            tr('terminal.wave.couldNotStageTbFile', { name: fail.name, reason: fail.reason }),
            'warning',
        );
    }
}

/**
 * Find the .vcd that vvp just produced.
 *
 * Aurora's auto-instrumented testbench writes `${simTopModule}.vcd`,
 * which is the happy path. The recovery branch handles the
 * "user wrote $dumpfile with a different name" case: vvp's CWD is
 * tempBaseDir, so the file is in there under whatever name the user
 * picked. We scan for unambiguous .vcd files and adopt one if the
 * choice is clear.
 *
 * Inputs:  simTopModule, tempBaseDir
 * Returns: absolute path to the .vcd to use downstream
 * Throws:  if zero or multiple candidate .vcds (ambiguous);
 *          message names the candidates and offers two concrete fixes
 * Side-effects: logs to twave (success line, or warning when the
 *               adopted file's name differs from simTopModule.vcd)
 */
async _waveResolveVcdFile(simTopModule, tempBaseDir) {
    // Pass 2 (vvp -fst) produces ${simTopModule}.fst — that's what
    // GTKWave opens. Pass 1 left a partial .vcd alongside it for
    // _waveResolveGtkwSaveFile to parse the header from; that file
    // isn't returned here.
    // Success is silent — confirming the dump file exists is internal
    // plumbing. The user already saw "Simulation started"; the next
    // visible step is GTKWave opening. Failures still throw with a
    // detailed error below.
    const expectedFst = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.fst`);
    if (await window.electronAPI.fileExists(expectedFst)) {
        return expectedFst;
    }
    // Legacy fallback: a full .vcd, in case someone runs vvp without
    // -fst (e.g. when investigating a problem with the two-pass flow).
    const expectedVcd = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vcd`);
    if (await window.electronAPI.fileExists(expectedVcd)) {
        return expectedVcd;
    }

    let candidates = [];
    try {
        const entries = await window.electronAPI.listFilesInDirectory(tempBaseDir);
        candidates = (entries || []).filter((name) => {
            const n = name.toLowerCase();
            return n.endsWith('.fst') || n.endsWith('.vcd');
        });
    } catch (_listErr) {
        candidates = [];
    }

    if (candidates.length === 1) {
        const adopted = await window.electronAPI.joinPath(tempBaseDir, candidates[0]);
        // The warning is the actionable bit — the user's $dumpfile()
        // picked a different name than expected. Keep it. The "found
        // the file" success line is suppressed (internal plumbing).
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.dumpfileMismatch', { name: candidates[0], expected: simTopModule }),
            'warning');
        return adopted;
    }

    const detail = candidates.length === 0
        ? `No .fst/.vcd was produced.`
        : `Multiple dump candidates were produced: ${candidates.join(', ')}.`;
    throw new Error(
        `Dump file was not generated as ${simTopModule}.fst.\n` +
        `${detail}\n` +
        `Aurora looks for a .fst (or .vcd) named after the testbench module.`,
    );
}

/**
 * Decide o .gtkw save-file que o GTKWave vai abrir. Duas sources, em
 * ordem de prioridade:
 *
 *   1. User-curated .gtkw (`gtkwFiles[].isTopLevel === true`, marcado
 *      pelo dropdown gtkwPickerSelect na toolbar). Cross-check contra
 *      o VCD pra avisar de paths stale. Retorna o path do usuario
 *      intocado.
 *   2. Auto-gerado pelo `buildAuroraGtkw`: secao "Top-level" com tudo
 *      que nao pertence a processador + uma secao SAPHO completa
 *      (cores/aliases/grupos) por processador detectado. Filtrado por
 *      `_validatedWaveSelection` (cache do Wave Config picker) quando
 *      ha selecao.
 *
 * Se ambas falharem (VCD invalido, etc.), retorna null e GTKWave abre
 * sem save-file.
 *
 * Inputs:  simTopModule, vcdFile, tempBaseDir
 * Returns: path absoluto pro .gtkw, ou null
 * Throws:  nunca (validation hiccups viram warnings)
 * Side-effects: pode escrever ${tempBaseDir}/${simTopModule}.gtkw;
 *               loga em twave.
 *
 * Ver ARCHITECTURE.md §9 pro racional de precedencia.
 */
async _waveResolveGtkwSaveFile(simTopModule, vcdFile, tempBaseDir) {
    // Source 1: user-curated .gtkw — entrada com `isActive: true` na
    // lista per-testbench do WaveStore. Cada testbench tem sua propria
    // lista (gtkwFiles isolados por tb), entao a resolucao aqui depende
    // do `testbenchFile` corrente.
    const tbKey = (this.projectConfig.testbenchFile || '')
        .split(/[\\/]/).pop().replace(/\.[^.]+$/i, '');
    if (tbKey) {
        const state = await WaveStore.get(this.projectPath, tbKey);
        const files = state?.gtkwFiles;
        if (Array.isArray(files) && files.length > 0) {
            const gtkwFile = files.find((f) => f && f.isActive === true);
            if (gtkwFile) {
                const userGtkw = gtkwFile.path;
                this.terminalManager.appendToTerminal('twave',
                    tr('terminal.wave.usingGtkwFile', { name: userGtkw.split(/[\\/]/).pop() }), 'info');
                await this._waveValidateUserGtkwAgainstVcd(userGtkw, vcdFile);
                return userGtkw;
            }
        }
    }

    // Source 2: auto-gerado. buildAuroraGtkw cobre o caso geral —
    // top-level flat + secoes por processador SAPHO detectado.
    const autoGtkw = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.gtkw`);
    // Preferencia: a selecao ja validada (escrita por _validateWaveSelection
    // durante o passo de instrumentacao). Senao, le do WaveStore — caso
    // onde o auto-gtkw e chamado sem o pipeline de instrumentacao
    // (defensivo; o flow normal sempre seta _validatedWaveSelection).
    let selected;
    if (Array.isArray(this._validatedWaveSelection)) {
        selected = this._validatedWaveSelection;
    } else if (tbKey) {
        const tbState = await WaveStore.get(this.projectPath, tbKey);
        selected = Array.isArray(tbState?.waveSignals) ? tbState.waveSignals : [];
    } else {
        selected = [];
    }
    // For the auto-gtkw we need to PARSE scopes from a text VCD.
    // vvp -fst (pass 2) overwrites the $dumpfile target with FST
    // binary even when the path ends in .vcd, so the pass-1 header
    // is stashed to a `.header.vcd` sibling by _waveRunVvpSimulation.
    // Prefer that header file when it exists.
    let parseSource = vcdFile;
    const headerSibling = vcdFile.replace(/\.(fst|vcd)$/i, '.header.vcd');
    if (await window.electronAPI.fileExists(headerSibling)) {
        parseSource = headerSibling;
    } else if (vcdFile.toLowerCase().endsWith('.fst')) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwError', { message: 'no parseable header (.header.vcd missing); GTKWave opens .fst without auto-gtkw' }),
            'tips');
        return null;
    }
    try {
        const vcdContent = await window.electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const binDir = await window.electronAPI.joinPath(this.componentsPath, 'bin');

        // Last-line-of-defense pra picker selection: avisa o usuario
        // sobre sinais selecionados que nao chegaram no VCD (testbench
        // dumpou subset, signal renomeado entre compile e wave, etc).
        // Aurora ainda escreve o .gtkw — gtkwave so mostra os que tem.
        if (selected.length > 0) {
            const inVcd = new Set();
            for (const sc of scopes) {
                for (const sig of sc.signals) inVcd.add(`${sc.path}.${sig.name}`);
            }
            const dropped = selected.filter((s) => !inVcd.has(s));
            if (dropped.length > 0) {
                // Sob Verilator os sinais internos de monitoramento do
                // processador (stack/ULA, dentro do `.core`) ficam fenced fora
                // do trace — entao sinais selecionados que vivem ali nao chegam
                // no VCD. Isso e ESPERADO (limitacao conhecida do Verilator,
                // nao um erro): em vez de listar cada sinal omitido, mostra uma
                // info amigavel por processador afetado. Os demais dropped
                // (renomeados, dump parcial, ...) seguem com o aviso generico.
                const procs = getSimulator() === 'verilator' ? detectProcessors(scopes) : [];
                const affectedProcs = new Map(); // nome do proc -> true (preserva ordem)
                const others = [];
                for (const s of dropped) {
                    const proc = /\.core\./.test(s)
                        && procs.find((p) => s.startsWith(`${p.instancePath}.`));
                    if (proc) {
                        affectedProcs.set(proc.procType || proc.instanceName, true);
                    } else {
                        others.push(s);
                    }
                }
                for (const procName of affectedProcs.keys()) {
                    this.terminalManager.appendToTerminal('twave',
                        tr('terminal.wave.verilatorNoProcSignals', { proc: procName }), 'tips');
                }
                if (others.length > 0) {
                    const preview = others.slice(0, 5).map((s) => `"${s}"`).join(', ');
                    const more = others.length > 5 ? ` (+${others.length - 5} more)` : '';
                    const msg = others.length === 1
                        ? tr('terminal.wave.staleVcdSignalOne', { preview })
                        : tr('terminal.wave.staleVcdSignalMany', { count: others.length, preview, more });
                    this.terminalManager.appendToTerminal('twave', msg, 'warning');
                }
            }
        }

        // Parseia o source verilog (synthesizableFiles + testbenchFiles)
        // pra extrair declaracoes (signed → format dos barramentos;
        // instances → resolve scope.path → moduleType pra ter o
        // procType correto = nome da pasta Temp/<procType>/ onde
        // cmmcomp escreveu trad files). Best-effort: falha vira null
        // (cai nas heuristicas baseadas em nome de scope).
        const modules = await this._parseProjectSources();

        const result = buildAuroraGtkw({
            vcdPath: vcdFile,
            gtkwPath: autoGtkw,
            scopes,
            tbModule: simTopModule,
            tempBaseDir,
            binDir,
            selectedSignals: selected.length > 0 ? selected : null,
            modules,
        });
        if (!result.content) return null;

        await window.electronAPI.writeFile(autoGtkw, result.content);
        const procPart = result.processorCount > 0
            ? `${result.processorCount} processor${result.processorCount === 1 ? '' : 's'}`
            : 'flat layout';
        const selPart = selected.length > 0
            ? `, ${selected.length} signal${selected.length === 1 ? '' : 's'} from picker`
            : '';
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwLayout', { detail: `${procPart}${selPart}` }), 'info');
        return autoGtkw;
    } catch (err) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.autoGtkwError', { message: err.message }), 'warning');
        return null;
    }
}

/**
 * Le e parseia os arquivos verilog do projeto (synthesizableFiles +
 * testbenchFiles), devolvendo o `modules` map de
 * `parseVerilogModules`. Usado por `buildAuroraGtkw` pra:
 *   - extrair declaracoes `signed` (FMT_DEC vs FMT_SIGNED_DEC)
 *   - resolver scope.path → moduleType (procType correto)
 *
 * Best-effort: erros de I/O ou parse viram `null`, e buildAuroraGtkw
 * cai nas heuristicas baseadas em nome de scope.
 */
async _parseProjectSources() {
    try {
        const synthFiles = (this.projectConfig?.synthesizableFiles ?? [])
            .map((f) => f && f.path).filter(Boolean);
        const tbFile = this.projectConfig?.testbenchFile;
        const tbFiles = (this.projectConfig?.testbenchFiles ?? [])
            .map((f) => f && f.path).filter(Boolean);
        const paths = new Set(
            [...synthFiles, ...(tbFile ? [tbFile] : []), ...tbFiles]
                .filter((p) => p && isVerilogLikeFile(p)),
        );

        // components/HDL/*.v — biblioteca SAPHO. Inclui pra que
        // buildSignedSet/resolveScopeModules conhecam modulos como
        // `core`, `ula`, `myFIFO`. Sem isso, sinais dentro de
        // <inst>.core.sp.pointeri ficam com moduleType=null e nao
        // recebem decoracao SAPHO no .gtkw.
        try {
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            const hdlEntries = await window.electronAPI.listFilesInDirectory(hdlPath);
            if (Array.isArray(hdlEntries)) {
                for (const name of hdlEntries) {
                    if (typeof name === 'string' && name.endsWith('.v') && !name.includes('_tb')) {
                        paths.add(await window.electronAPI.joinPath(hdlPath, name));
                    }
                }
            }
        } catch (_e) { /* HDL nao acessivel — segue sem */ }

        if (paths.size === 0) return null;

        const files = [];
        for (const p of paths) {
            try {
                const content = await window.electronAPI.readFile(p, { encoding: 'utf8' });
                files.push({ path: p, content });
            } catch (_e) { /* arquivo sumiu — ignora */ }
        }
        if (files.length === 0) return null;

        const { modules } = parseVerilogModules(files);
        return modules;
    } catch (err) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.parseSourcesNote', { message: err.message }),
            'tips');
        return null;
    }
}

/**
 * Cross-check a user-curated .gtkw against the VCD: every dotted path
 * the layout references must exist in the parsed scopes, otherwise
 * GTKWave shows an empty trace with no warning. Best-effort —
 * parse hiccups produce a single twave warning but don't block.
 *
 * Inputs:  gtkwPath (absolute), vcdPath (absolute)
 * Returns: void
 * Throws:  never
 * Side-effects: logs to twave (per-signal note when stale references found)
 */
async _waveValidateUserGtkwAgainstVcd(gtkwPath, vcdPath) {
    // Two-pass dump stashes the parseable header in `.header.vcd`
    // (because vvp -fst overwrites the original .vcd with FST binary).
    // Prefer that for the cross-check; skip silently if it isn't
    // available — GTKWave shows empty traces for stale signals,
    // same behaviour as before the hook existed.
    let parseSource = vcdPath;
    if (vcdPath) {
        const headerSibling = vcdPath.replace(/\.(fst|vcd)$/i, '.header.vcd');
        if (await window.electronAPI.fileExists(headerSibling)) {
            parseSource = headerSibling;
        } else if (vcdPath.toLowerCase().endsWith('.fst')) {
            return;
        }
    }
    try {
        const gtkwContent = await window.electronAPI.readFile(gtkwPath, { encoding: 'utf8' });
        const referenced = extractSignalRefs(gtkwContent);
        if (referenced.length === 0) return;
        const vcdContent = await window.electronAPI.readFile(parseSource, { encoding: 'utf8' });
        const scopes = parseVcdHeaderFromContent(vcdContent);
        const inVcd = new Set();
        for (const scope of scopes) {
            for (const sig of scope.signals) {
                inVcd.add(`${scope.path}.${sig.name}`);
            }
        }
        const missing = referenced.filter((s) => !inVcd.has(s));
        if (missing.length === 0) return;
        const preview = missing.slice(0, 5).map((s) => `"${s}"`).join(', ');
        const more = missing.length > 5 ? ` (+${missing.length - 5} more)` : '';
        const fileName = gtkwPath.split(/[\\/]/).pop();
        const msg = missing.length === 1
            ? tr('terminal.wave.gtkwStaleVcdOne', { preview, file: fileName })
            : tr('terminal.wave.gtkwStaleVcdMany', { count: missing.length, file: fileName, preview, more });
        this.terminalManager.appendToTerminal('twave', msg, 'warning');
    } catch (refErr) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.gtkwPreValidateFailed', { file: gtkwPath.split(/[\\/]/).pop(), message: refErr.message }),
            'warning');
    }
}

/**
 * Build the GTKWave command line and launch the process.
 *
 * gtkwave-nipscern fork (components/Packages/gtkwave-nipscern/):
 *   - `--dark` — Aurora's dark theme parity (signal panel + GTK chrome).
 *   - `--zoom-fit` — initial zoom-fit.
 *   - `--left-justify` — alinha nomes de sinais a esquerda.
 *   - `-a <gtkw>` — save-file (so quando aplicavel). SST ja vem removido
 *     da fork, entao --rcvar 'hide_sst on' nao e mais necessario.
 *
 * Inputs:  vcdFile (absolute), gtkwSaveFile (absolute or null), tools
 * Returns: void
 * Throws:  if launchGtkwaveOnly reports failure
 * Side-effects: spawns gtkwave.exe, stores PID on this.gtkwaveProcess,
 *               starts the lifecycle monitor.
 */
async _waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.launching'), 'info');

    // gtkwave usa spawn detached (monitorado via launch-gtkwave-only)
    // em vez do executor padrao. Mesmo assim, passamos pelo runSpec-
    // -equivalente pra que overrides da AI funcionem: aplicamos override
    // a um base spec e renderizamos a linha de comando — o IPC velho
    // espera string. Override no spec de gtkwave fica em ../command_overrides.
    const baseSpec = buildGtkwaveSpec({
        gtkwaveBin: tools.gtkwaveBin,
        vcdFile,
        gtkwSaveFile: gtkwSaveFile || undefined,
        cwd: tools.tempBaseDir,
    });
    const { applyResolved } = await import('./command_overrides.js');
    const resolved = await applyResolved(baseSpec, { consumeEphemeral: true });
    const finalSpec = resolved.appliedSpec;
    // Pass the resolved spec's binary + tokenized args straight through.
    // Rendering to a string and re-parsing dropped the quotes around a
    // space-free gtkwave path, so the old IPC rejected it as "Invalid
    // GTKWave command format". The args array is already exactly what
    // spawn needs (e.g. '--script=PATH' stays one token).
    const gtkwaveResult = await window.electronAPI.launchGtkwaveOnly({
        gtkwaveBin: finalSpec.binary,
        args: finalSpec.args,
        workingDir: tools.tempBaseDir,
    });
    if (!gtkwaveResult.success) {
        throw new Error(tr('error.compilation.gtkwaveFailed', { message: gtkwaveResult.message }));
    }
    this.gtkwaveProcess = gtkwaveResult.gtkwavePid;
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.launched'), 'success');
    this.monitorGtkwaveProcess();
}



    switchToStandardView() {
        // Delegate to the controller — it picks verilog vs standard
        // based on IDE mode and owns the active-view state.
        window.fileTreeViewController?.showFileMode?.();
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.switchedFileTree'), 'info');
    }

    async generateHierarchyWithYosys(yosysPath, tempBaseDir) {
        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.hierarchyGen'));

        const spfPath = window.currentSpfPath;
        if (!spfPath) {
            throw new Error('No spf path available for loading project configuration');
        }
        this.projectConfig = await SpfStore.read(spfPath);

        const topLevelFile = this.projectConfig.topLevelFile;
        if (!topLevelFile) {
            throw new Error(`No top-level module specified in project configuration`);
        }

        const topLevelModule = moduleStemFromPath(topLevelFile);

        const jsonOutputPath = await window.electronAPI.joinPath(tempBaseDir, `${topLevelModule}.json`);

        const yosysScript = `
# Read all synthesizable files
${this.projectConfig.synthesizableFiles.map(file => `read_verilog "${file.path}"`).join('\n')}

# Set hierarchy with top-level module
hierarchy -top ${topLevelModule}

# Convert processes (always blocks, etc.) to netlists
proc

# Generate JSON output with correct path
write_json ${jsonOutputPath}
`;

        const yosysScriptPath = await window.electronAPI.joinPath(tempBaseDir, 'hierarchy_gen.ys');
        await window.electronAPI.writeFile(yosysScriptPath, yosysScript);

        const yosysSpec = buildYosysHierarchySpec({
            yosysPath,
            scriptPath: yosysScriptPath,
            cwd: tempBaseDir,
        });

        // Comando cru do Yosys: só em verbose/debug, igual aos demais
        // (executing/executingPrep/executingComp, build/check veri).
        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.yosysRun', { cmd: CommandSpec.formatSpec(yosysSpec) }), 'info', { internal: true });

        const yosysResult = await runSpec(yosysSpec, { consumeEphemeral: true });

        if (yosysResult.stdout) this.terminalManager.appendToTerminal('twave', yosysResult.stdout, 'stdout');
        if (yosysResult.stderr) this.terminalManager.appendToTerminal('twave', yosysResult.stderr, 'stderr');

        if (yosysResult.code !== 0) {
            throw new Error(tr('error.compilation.yosysFailed', { code: yosysResult.code }));
        }

        const jsonExists = await window.electronAPI.fileExists(jsonOutputPath);
        if (!jsonExists) {
            throw new Error(tr('error.compilation.yosysJsonMissing', { path: jsonOutputPath }));
        }

        const jsonContent = await window.electronAPI.readFile(jsonOutputPath, {
            encoding: 'utf8'
        });
        const hierarchyData = JSON.parse(jsonContent);

        this.hierarchyData = this.parseYosysHierarchy(hierarchyData, topLevelModule);

        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.hierarchyForTop', { name: topLevelModule }), 'success');

        this.enableHierarchicalTreeToggle();
    }

    cleanModuleName(moduleName) {
        let cleanName = moduleName;

        if (cleanName.startsWith('$paramod')) {
            if (cleanName.includes('\\\\')) {
                const parts = cleanName.split('\\\\');
                if (parts.length >= 2) {
                    cleanName = parts[1];
                    if (cleanName.includes('\\')) {
                        cleanName = cleanName.split('\\')[0];
                    }
                }
            } else if (cleanName.includes('\\')) {
                const parts = cleanName.split('\\');
                if (parts.length >= 2) {
                    cleanName = parts[1];
                }
            }
        }

        cleanName = cleanName.replace(/\$[a-f0-9]{40,}/g, '');
        cleanName = cleanName.replace(/\\[A-Z_]+=.*$/g, '');
        cleanName = cleanName.replace(/^[$\\]+/, '');

        return cleanName;
    }

switchToHierarchicalView() {
    // Delegate to the controller. It checks for data availability,
    // sets the active view, and runs the hierarchy renderer. Toggle
    // button UI (icon, title, enabled state) is handled inside the
    // controller's _updateToggleUI based on the data slot — no
    // explicit enable/disable calls or icon updates needed here.
    if (!window.fileTreeViewController?.showHierarchyMode?.()) {
        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.noHierarchyData'), 'warning');
        return;
    }
    this.terminalManager.appendToTerminal('tveri',
        tr('terminal.veri.switchedHierarchical'), 'info');
}
    updateToggleButton(isHierarchical) {
        const toggleButton = document.getElementById('alternate-tree-toggle');
        if (!toggleButton) return;

        const icon = toggleButton.querySelector('i');
        const text = toggleButton.querySelector('.toggle-text');

        if (isHierarchical) {
            icon.className = 'fa-solid fa-list-ul';
            text.textContent = 'Standard';
            toggleButton.classList.add('active');
            toggleButton.title = 'Switch to the default file tree';
        } else {
            icon.className = 'fa-solid fa-sitemap';
            text.textContent = 'Hierarchical';
            toggleButton.classList.remove('active');
            toggleButton.title = 'Switch to the hierarchical modules view';
        }
    }


    getModuleNumber(moduleName, parentNumber = '', moduleIndex = 0) {
        if (moduleName === this.hierarchyData.topLevel) {
            return '';
        }

        if (parentNumber === '') {
            return `${moduleIndex + 1}`;
        }

        return `${parentNumber}.${moduleIndex + 1}`;
    }


}

export { CompilationModule };
