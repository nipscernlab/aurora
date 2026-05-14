/* eslint-disable no-undef */
// statusUpdater, refreshFileTree, checkCancellation, startCompilation, endCompilation are global
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
 *   iverilogCompile({ buildVvp })
 *                           iverilog -tnull (check + hierarquia) OU
 *                           iverilog -o <sim>.vvp (pra simulacao)
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
import { toForwardSlashes } from '../utils/path_utils.js';
import { parseVcdHeaderFromContent } from '../wave/vcd_parser.js';
import { SpfStore } from '../project/spf_store.js';
import { extractSignalRefs } from '../wave/gtkw_writer.js';
import { buildAuroraGtkw } from '../wave/gtkw_proc_writer.js';
import { instrumentTestbenchSource, hasUserDumpCalls } from '../wave/testbench_instrumenter.js';
import { validateSelection } from '../wave/selection_validator.js';
import { parseVerilogModules, buildHierarchyTree } from '../wave/signal_parser.js';
import { WaveStore } from '../wave/wave_state_store.js';

// i18n shim — falls back to the key path if i18n didn't boot yet.
const tr = (k, p) => (window.t ? window.t(k, p) : k);

class CompilationModule {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.projectConfig = null;
        this.terminalManager = new TerminalManager();
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

            const designTopModule = topLevelFilePath.split(/[\\\\/]/).pop().replace(/\.v$/i, '');
            const yosysPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe');
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

            const yosysCmd = `cd "${tempBaseDir}" && "${yosysPath}" -s "${scriptPath}"`;
            const result = await window.electronAPI.execCommand(yosysCmd);

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
            toggle.innerHTML = '<i class="fa-solid fa-caret-right"></i>';
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
            const scriptsPath = await window.electronAPI.joinPath(this.componentsPath, 'Scripts', 'fix.vcd');
            const destPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name, 'fix.vcd');
            await window.electronAPI.copyFile(scriptsPath, destPath);
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
            tbModule = tbFileName.replace(/\.v$/i, '');
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
     * Cria o arquivo tcl_infos.txt necessário para o script TCL configurar o GTKWave.
     * Estrutura baseada no padrão que o script TCL lê:
     * Linha 1: Lista de processadores (ou módulo topo)
     * Linha 2: Tipo (verilog)
     * Linha 3: Pasta Temp
     * Linha 4: Pasta Bin
     * Linha 5: Pasta Scripts
     */
    async createTclInfos(tempDir, topModuleName) {
        try {
            const packagesPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages');
            const binDir = await window.electronAPI.joinPath(packagesPath, 'iverilog', 'bin');
            // Assume que seus scripts .tcl ficam numa pasta 'Scripts' dentro de components
            const scriptsDir = await window.electronAPI.joinPath(this.componentsPath, 'Scripts');

            // Formatando caminhos para o TCL (barras normais funcionam melhor em TCL que invertidas)
            const infosContent = [
                toForwardSlashes(tempDir),  // 3. tmp_dir
                toForwardSlashes(binDir),   // 4. bin_dir
            ].join('\n');

            const infoFilePath = await window.electronAPI.joinPath(tempDir, 'tcl_infos.txt');
            await window.electronAPI.writeFile(infoFilePath, infosContent);
            
            return scriptsDir; // Retorna o caminho dos scripts para uso posterior
        } catch (error) {
            console.error("Error creating tcl_infos.txt:", error);
            throw error;
        }
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
            statusUpdater.startCompilation('cmm');

            // 3. Comando — yanc usa named options (CMMComp/Sources/args.c):
            //   -i input  -n name  -p proc-dir  -m macros-dir  -t temp-dir  [-P]
            // -pt / -en vem do toggle de locale (UI + compiler unified) e vai
            // PRIMEIRO: parse_lang_flag() consome essa flag e a remove de argv
            // antes do cli_parse() ler o resto. Explicito pra que a UI mande,
            // ignorando qualquer env var preexistente do shell.
            const langFlag = `-${window.getYancLang?.() ?? 'pt'}`;
            // -P liga o showArrays do .spf (campo per-processador). Cuidado
            // com o nome: o yanc chama esse flag de --project / cli_args.project,
            // MAS o main() do cmmcomp passa esse valor pro slot `d_array` do
            // parse_init, que faz `sim_arr = strcmp(d_array,"1")==0` — ou seja,
            // pro cmmcomp -P significa "simular/mostrar arrays", nao project
            // mode. Era o 6o arg posicional antes da migracao p/ named flags.
            let cmd = `"${cmmCompPath}" ${langFlag} -i "${selectedCmmFile}" -n "${cmmBaseName}" -p "${projectPath}" -m "${macrosPath}" -t "${tempPath}"`;
            if (showArrays) cmd += ' -P';
            
            this.terminalManager.appendToTerminal('tcmm', tr('terminal.common.executing', { cmd }));

            const result = await window.electronAPI.execCommand(cmd);
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

    async asmCompilation(processor, projectParam = null, preamble = null) {
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
            const langFlag = `-${window.getYancLang?.() ?? 'pt'}`;

            // appcomp: named options -i input  -t temp-dir (APP/Sources/args.c).
            let cmd = `"${appCompPath}" ${langFlag} -i "${asmPath}" -t "${tempPath}"`;
            this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingPrep', { cmd }));
            const appResult = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tasm', appResult);

            if (appResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM Preprocessor failed with code ${appResult.code}`);
                throw new Error(tr('error.compilation.asmPrepFailed', { code: appResult.code }));
            }

            if (projectParam === null) {
                // Project Mode (modo unico) -> 1 (sem auto $finish no
                // testbench).
                projectParam = 1;
            }

            // asmcomp: named options -i -p -d -m -t -f -c [-P] (ASM/Sources/args.c).
            // -f/-c TEM que ser inteiros — o yanc novo rejeita valor nao-numerico
            // e sai com usage. -P liga o project mode (era o 9o arg posicional).
            const freq = Number.parseInt(clk, 10) || 0;
            const clocks = Number.parseInt(numClocks, 10) || 0;
            cmd = `"${asmCompPath}" ${langFlag} -i "${asmPath}" -p "${projectPath}" -d "${hdlPath}" -m "${macrosPath}" -t "${tempPath}" -f ${freq} -c ${clocks}`;
            if (projectParam) cmd += ' -P';
            this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.executingComp', { cmd }));

            const asmResult = await window.electronAPI.execCommand(cmd);

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

                this.terminalManager.appendToTerminal('tasm', tr('terminal.asm.copyingTb', { src: sourceTestbench, dst: destinationTestbench }));
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
 * Valida config minima pro pipeline iverilog: synthesizableFiles
 * presente, um top-level marcado.
 *
 * `requireTopLevel` e default-true porque os botoes Verilog/PRISM/
 * Syntax Check realmente precisam — eles invocam iverilog com `-s
 * <top>` direto contra o design. O botao Wave passa
 * `requireTopLevel: false` porque um testbench presente vira o `-s`
 * em `_waveDeriveSimTopModule`; o top-level so seria fallback pro
 * caminho "sem testbench", que `runGtkWave` ja bloqueia upstream com
 * mensagem propria. Antes, exigir top-level aqui produzia o erro
 * errado ("mark a file as top-level") em vez do real ("add a
 * testbench") quando o usuario clicava Wave sem ter nada marcado.
 *
 * Testbench e opcional aqui pelas mesmas razoes: Verilog/PRISM nao
 * usam, e o caller que precisa (Wave) ja faz a checagem propria.
 */
validateConfig({ requireTopLevel = true } = {}) {
    if (!this.projectConfig) {
        throw new Error('Project configuration not loaded');
    }

    if (!this.projectConfig.synthesizableFiles || this.projectConfig.synthesizableFiles.length === 0) {
        throw new Error(tr('error.config.noSynth'));
    }

    const topLevelFile = this._pickSingleTop(
        this.projectConfig.synthesizableFiles,
        'synthesizable',
    );
    if (requireTopLevel && !topLevelFile) {
        throw new Error(tr('error.config.noTopLevel'));
    }

    // Testbench e opcional pros botoes Verilog e PRISM (que usam -s
    // top-level e nao precisam de stimuli). Pro botao Wave e obrigatorio,
    // mas o handler de Wave checa separadamente. Quando absent, iverilog
    // usa o synthesizable top-level como -s.
    let foundTestbenchPath = null;

    if (this.projectConfig.testbenchFile && this.projectConfig.testbenchFile.trim() !== "") {
        foundTestbenchPath = this.projectConfig.testbenchFile;
    }

    if (!foundTestbenchPath && this.projectConfig.testbenchFiles && this.projectConfig.testbenchFiles.length > 0) {
        const starred = this._pickSingleTop(
            this.projectConfig.testbenchFiles.filter((f) => f.path && f.path.trim() !== ""),
            'testbench',
        );
        if (starred) {
            foundTestbenchPath = starred.path;
        } else {
            const validEntry = this.projectConfig.testbenchFiles.find((f) => f.path && f.path.trim() !== "");
            if (validEntry) foundTestbenchPath = validEntry.path;
        }
    }

    return {
        // null no caminho requireTopLevel:false sem top marcado.
        // Consumers que so usam top como fallback (Wave quando ha
        // testbench) podem ignorar.
        topLevelFile: topLevelFile ? topLevelFile.path : null,
        testbenchFile: foundTestbenchPath, // may be null
        synthesizableFiles: this.projectConfig.synthesizableFiles.map(f => f.path)
    };
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
        const config = this.validateConfig();

        const iveriCompPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe',
        );
        if (!await window.electronAPI.fileExists(iveriCompPath)) {
            const msg = tr('terminal.veri.iverilogNotFound', { path: iveriCompPath });
            this.terminalManager.appendToTerminal('tveri', msg, 'error');
            return { success: false, message: msg };
        }

        const topLevelModuleName = config.topLevelFile.split(/[\\/]/).pop().replace(/\.v$/i, '');
        const simTopModule = config.testbenchFile
            ? config.testbenchFile.split(/[\\/]/).pop().replace(/\.v$/i, '')
            : topLevelModuleName;

        // Whole design: synth files + testbench (raw, no auto-instrumentation
        // — we want iverilog to evaluate exactly what the user wrote).
        const fileSet = new Set(config.synthesizableFiles);
        if (config.testbenchFile) fileSet.add(config.testbenchFile);
        const sourceFilesString = [...fileSet].map((f) => `"${f}"`).join(' ');

        // -y points iverilog at components/HDL pra resolver os modulos
        // da biblioteca SAPHO (processor.v, addr_dec.v, instr_dec.v,
        // ula.v, myFIFO.v, core.v) que o .v gerado pelo asmcomp
        // instancia. Sem isso o syntax check falha com "Unknown module
        // type: processor" em projetos que tem processadores SAPHO.
        // Mesmo padrao do iverilogCompile.
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
        const libraryArgs = `-y "${hdlPath}"`;

        const cmd = [
            `"${iveriCompPath}"`,
            libraryArgs,
            '-tnull',
            `-s ${simTopModule}`,
            sourceFilesString,
        ].filter(Boolean).join(' ');

        this.terminalManager.appendToTerminal('tveri',
            tr('terminal.veri.bannerSyntaxWc'), 'info');
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.simTop', { name: simTopModule }), 'info');
        this.terminalManager.appendToTerminal('tveri', cmd, 'info');

        const result = await window.electronAPI.execCommand(cmd);
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
    const tbKey = config.testbenchFile.split(/[\\/]/).pop().replace(/\.v$/i, '');

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
    await window.electronAPI.writeFile(instrumentedPath, result.content);
    return { path: instrumentedPath, reason: result.reason };
}

/**
 * Compila o design Verilog do projeto via iverilog. Pipeline unico
 * sem branches sobre presenca de processador — synthesizableFiles
 * (populado pelo file tree) ja inclui os .v de cada processador.
 *
 * Two shapes, controlled by `buildVvp`:
 *   - false (default, used by the Compile button): syntax-check only —
 *     iverilog is invoked with `-tnull`, no .vvp output, testbench
 *     excluded from the source set. After a clean elaboration we run
 *     Yosys to regenerate the hierarchy. This is what the user wants
 *     a "compile" click to do: confirm the design parses and refresh
 *     the hierarchy view, no simulation artifacts.
 *   - true (used by the Wave button's auto-compile): full build of a
 *     `.vvp` for vvp/GTKWave to run. Includes the testbench, sets `-s`
 *     to the testbench module, and writes the .vvp into Temp/.
 *
 * Splitting along this boundary keeps the Compile button fast and
 * focused (no simulation-only artifacts) while the Wave button still
 * has a path to produce a fresh .vvp on demand.
 */
async iverilogCompile({ buildVvp = false } = {}) {
    this.terminalManager.appendToTerminal('tveri', tr(buildVvp ? 'terminal.veri.phaseBuild' : 'terminal.veri.phaseCheck'), 'info');
    statusUpdater.startCompilation('verilog');

    try {
        // Syntax-check / Verilog button (buildVvp:false): top-level e
        // o `-s` do iverilog, obrigatorio. Wave button (buildVvp:true):
        // o `-s` vem do testbench (que runGtkWave ja exigiu upstream),
        // top-level vira opcional.
        const config = this.validateConfig({ requireTopLevel: !buildVvp });

        // 'tips' = blue/info badge. These lines are contextual info
        // about what's about to be compiled, not a success outcome —
        // the green "Compilation Successful" line later is what
        // signals success. Using 'tips' here keeps the visual hierarchy
        // (blue = "FYI", green = "it worked").
        if (config.topLevelFile) {
            this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.topLevel', { name: config.topLevelFile.split(/[\\/]/).pop() }), 'tips');
        }
        if (buildVvp) {
            if (config.testbenchFile) {
                this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.testbench', { name: config.testbenchFile.split(/[\\/]/).pop() }), 'tips');
            } else {
                this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.noTbUsingTop'), 'info');
            }
        }
        this.terminalManager.appendToTerminal('tveri', tr('terminal.veri.synthFiles', { count: config.synthesizableFiles.length }), 'info');

        const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
        const iveriCompPath = await window.electronAPI.joinPath(
            this.componentsPath,
            'Packages',
            'iverilog',
            'bin',
            'iverilog.exe'
        );

        if (!await window.electronAPI.fileExists(iveriCompPath)) {
            throw new Error(tr('error.toolchain.iverilogNotFound', { path: iveriCompPath }));
        }

        await window.electronAPI.mkdir(tempBaseDir);

        const topLevelModuleName = config.topLevelFile
            ? config.topLevelFile.split(/[\\/]/).pop().replace(/\.v$/i, '')
            : null;
        const simTopModule = config.testbenchFile
            ? config.testbenchFile.split(/[\\/]/).pop().replace(/\.v$/i, '')
            : topLevelModuleName;

        const outputFile = await window.electronAPI.joinPath(tempBaseDir, `${simTopModule}.vvp`);

        // File set:
        //   - syntax-check: just the synthesizable files. The testbench has
        //     non-synthesizable constructs ($dumpvars, $finish, delays); it
        //     would only confuse a pure design check.
        //   - build: synth files + testbench, since vvp needs both. The
        //     testbench is auto-instrumented if it lacks $dumpfile/$dumpvars
        //     so Wave just works on first click.
        const fileSet = new Set(config.synthesizableFiles);
        if (buildVvp && config.testbenchFile) {
            // Reunir o conjunto de .v files que entram na validacao de
            // signals: synth + testbench + components/HDL/*.v (assim
            // selecoes Stack/ULA/SAPHO nao sao descartadas como "stale").
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

            // _resolveWaveSelection cuida da precedencia: .gtkw > WC >
            // tb-with-dumpvars > default. Tambem registra o tb no
            // WaveStore na 1a visita.
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
            // .gtkw auto-gerado fica vazia — buildAuroraGtkw cai no
            // layout completo do VCD. Pros outros casos, _validatedWaveSelection
            // = signals escolhidos, e o auto-gtkw filtra por eles.
            this._validatedWaveSelection = reason === 'user-defined'
                ? []
                : decision.signalsToDump;

            // Log diagnostico — mostra qual axe ditou a selecao,
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
                    tr('terminal.wave.overrideUserDumpvars'),
                    'tips');
            }

            if (tbPath !== config.testbenchFile) {
                this.terminalManager.appendToTerminal('tveri',
                    tr('terminal.veri.autoInstrTb', { name: tbPath.split(/[\\/]/).pop() }), 'info');
            }
        }
        const sourceFilesString = [...fileSet].map(f => `"${f}"`).join(' ');

        // -y tells iverilog to resolve any module referenced but not
        // listed in the source set by looking for `<moduleName>.v` in
        // these directories. components/HDL tem tanto componentes do
        // processador SAPHO (processor.v, addr_dec.v, instr_dec.v, ula.v,
        // core.v) quanto componentes usados fora dele (myFIFO.v). Sempre
        // ligado, em qualquer fluxo — projetos sem processador tambem
        // se beneficiam pra coisas tipo myFIFO.
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
        const libraryArgs = `-y "${hdlPath}"`;

        const cmdParts = buildVvp
            ? [
                `"${iveriCompPath}"`,
                libraryArgs,
                `-s ${simTopModule}`,
                `-o "${outputFile}"`,
                sourceFilesString,
            ]
            : [
                `"${iveriCompPath}"`,
                libraryArgs,
                // -tnull tells iverilog to elaborate but skip code-gen, so
                // we get the parse + type-check without producing a .vvp.
                '-tnull',
                `-s ${topLevelModuleName}`,
                sourceFilesString,
            ];

        const cmd = cmdParts.filter(Boolean).join(' ');

        this.terminalManager.appendToTerminal('tveri', tr(buildVvp ? 'terminal.veri.buildCmd' : 'terminal.veri.checkCmd'), 'info');
        this.terminalManager.appendToTerminal('tveri', cmd, 'info');

        await TabManager.saveAllFiles();

        this.terminalManager.appendToTerminal('tveri', tr(buildVvp ? 'terminal.veri.building' : 'terminal.veri.checking'), 'info');

        const result = await window.electronAPI.execCommand(cmd);
        this.terminalManager.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            throw new Error(tr(buildVvp ? 'error.compilation.iverilogFailedBuild' : 'error.compilation.iverilogFailedCheck', { code: result.code }));
        }

        if (buildVvp) {
            const vvpExists = await window.electronAPI.fileExists(outputFile);
            if (!vvpExists) {
                throw new Error(tr('error.compilation.vvpNotGenerated'));
            }
        }

        this.terminalManager.appendToTerminal('tveri', tr(buildVvp ? 'terminal.veri.buildSuccess' : 'terminal.veri.checkSuccess'), 'success');
        statusUpdater.compilationSuccess('verilog');

        // Hierarchy is regenerated on the syntax-check path only — that's
        // the user-facing "compile" action. The wave-button auto-compile
        // (buildVvp) doesn't touch hierarchy because the user already
        // pressed compile to land on a known-good design.
        if (!buildVvp) {
            await this.generateProjectHierarchy();
        }

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
 *   _waveResolveToolchain()          → { tempBaseDir, scriptsPath, gtkwaveBin, vvpBin }
 *   _waveDeriveSimTopModule(config)  → testbench module name
 *   _waveBuildAndVerifyVvp()         → tempBaseDir/${simTop}.vvp on disk
 *   _waveRunVvpSimulation()          → tempBaseDir/<some>.vcd on disk
 *   _waveResolveVcdFile()            → absolute path to that .vcd
 *   _waveStageFixVcd()               → tempBaseDir/fix.vcd (GTK3 quirk)
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
        // Wave nao precisa de top-level marcado: quando ha testbench
        // (caso normal), o `-s` do iverilog vem do nome do testbench.
        // O top-level so seria fallback pro caso "sem testbench" — que
        // bloqueamos uma linha abaixo com mensagem propria. Exigir
        // top-level aqui produzia o erro errado pro usuario.
        const config = this.validateConfig({ requireTopLevel: false });

        // No testbench → vvp has nothing to dump and no $finish to
        // hit, so simulation can't produce a VCD. Bail early with a
        // readable message instead of letting the user hit the
        // generic "VCD not generated" error from _waveResolveVcdFile.
        if (!config.testbenchFile) {
            throw new Error(tr('error.config.noTestbench'));
        }

        const tools = await this._waveResolveToolchain();
        const simTopModule = this._waveDeriveSimTopModule(config);

        await this._waveBuildAndVerifyVvp(simTopModule, tools.tempBaseDir);
        await this._waveRunVvpSimulation(simTopModule, tools);
        const vcdFile = await this._waveResolveVcdFile(simTopModule, tools.tempBaseDir);
        await this._waveStageFixVcd(tools);
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
 * Returns: { tempBaseDir, scriptsPath, gtkwaveBin, vvpBin } — all absolute
 * Throws:  never (joinPath is total)
 * Side-effects: none
 */
async _waveResolveToolchain() {
    const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
    const scriptsPath = await window.electronAPI.joinPath(this.componentsPath, 'Scripts');
    const gtkwaveBin = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe',
    );
    const vvpBin = await window.electronAPI.joinPath(
        this.componentsPath, 'Packages', 'iverilog', 'bin', 'vvp.exe',
    );
    return { tempBaseDir, scriptsPath, gtkwaveBin, vvpBin };
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
        return config.testbenchFile.split(/[\\/]/).pop().replace(/\.v$/i, '');
    }
    // Fallback inalcancavel pelo Wave (runGtkWave ja exige testbench),
    // mas o helper fica geral: se um dia for chamado sem tb, exige top.
    if (!config.topLevelFile) return null;
    return config.topLevelFile.split(/[\\/]/).pop().replace(/\.v$/i, '');
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
 *               iverilogCompile (the .gtkw resolver reads it).
 */
async _waveBuildAndVerifyVvp(simTopModule, tempBaseDir) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.buildingVvp'), 'info');
    await this.iverilogCompile({ buildVvp: true });
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
    // requireTopLevel:false pq aqui so consultamos testbenchFile —
    // se exigissemos top, este reentry validate quebraria o Wave
    // mesmo apos o filtro top-level do runGtkWave acima.
    const config = this.validateConfig({ requireTopLevel: false });
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

    const headerCmd = `cd "${tools.tempBaseDir}" && "${tools.vvpBin}" "${vvpFile}" +AURORA_HEADER_ONLY`;
    const headerResult = await window.electronAPI.execCommand(headerCmd);
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
    const unsubscribe = window.electronAPI.onVvpStream((payload) => {
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
        const r = await window.electronAPI.execVvpStreamed(
            tools.vvpBin, vvpFile, ['-fst'], tools.tempBaseDir,
        );
        code = r.code;
    } finally {
        unsubscribe();
    }
    if (code !== 0) {
        throw new Error(tr('error.compilation.vvpFailed', { code }));
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

    // Match $fopen("X"), $readmemb("X", ...), $readmemh("X", ...).
    // Argumento entre aspas duplas; nao tentamos cobrir aspas simples
    // ou concatenacao Verilog (raro em testbenches reais).
    const re = /\$(?:fopen|readmem[bh])\s*\(\s*"([^"]+)"/g;
    const filenames = new Set();
    let m;
    while ((m = re.exec(content)) !== null) {
        filenames.add(m[1]);
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
 * picked. We scan for unambiguous .vcd files (excluding fix.vcd which
 * we stage ourselves later) and adopt one if the choice is clear.
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
            return (n.endsWith('.fst') || n.endsWith('.vcd')) && name !== 'fix.vcd';
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
 * Copy the canned `fix.vcd` companion alongside the user's VCD.
 * GTKWave under GTK3 needs that file opened in a second tab to
 * refresh its view — the launch script (`gtk_almost_proj.tcl`)
 * triggers that. Don't remove this without first ripping out the
 * companion-tab line in the script.
 *
 * Inputs:  tools (uses scriptsPath + tempBaseDir)
 * Returns: void
 * Throws:  never (best-effort; logs a warning on failure)
 * Side-effects: writes ${tempBaseDir}/fix.vcd
 */
async _waveStageFixVcd(tools) {
    try {
        await window.electronAPI.copyFile(
            await window.electronAPI.joinPath(tools.scriptsPath, 'fix.vcd'),
            await window.electronAPI.joinPath(tools.tempBaseDir, 'fix.vcd'),
        );
    } catch (copyErr) {
        this.terminalManager.appendToTerminal('twave',
            tr('terminal.wave.couldNotStageFix', { message: copyErr.message }), 'warning');
    }
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
        .split(/[\\/]/).pop().replace(/\.v$/i, '');
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
                const preview = dropped.slice(0, 5).map((s) => `"${s}"`).join(', ');
                const more = dropped.length > 5 ? ` (+${dropped.length - 5} more)` : '';
                const msg = dropped.length === 1
                    ? tr('terminal.wave.staleVcdSignalOne', { preview })
                    : tr('terminal.wave.staleVcdSignalMany', { count: dropped.length, preview, more });
                this.terminalManager.appendToTerminal('twave', msg, 'warning');
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
        const paths = new Set([...synthFiles, ...(tbFile ? [tbFile] : []), ...tbFiles]);

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
 * Three switches matter:
 *   - `--dark` — Aurora's dark theme parity.
 *   - `--rcvar "hide_sst on"` + `-a <gtkw>` — only when a save-file is
 *     in play. SST is GTKWave's Signal Search Tree; Wave Configuration
 *     replaces it as the canonical picker, so showing both duplicates
 *     work.
 *   - `--script=<tcl>` — `gtk_almost_proj.tcl` zooms-fit and opens
 *     `fix.vcd` in a second tab (the GTK3 redraw workaround).
 *
 * Inputs:  vcdFile (absolute), gtkwSaveFile (absolute or null), tools
 * Returns: void
 * Throws:  if launchGtkwaveOnly reports failure
 * Side-effects: spawns gtkwave.exe, stores PID on this.gtkwaveProcess,
 *               starts the lifecycle monitor.
 */
async _waveLaunchGtkwave(vcdFile, gtkwSaveFile, tools) {
    this.terminalManager.appendToTerminal('twave', tr('terminal.wave.launching'), 'info');
    const fixScript = await window.electronAPI.joinPath(tools.scriptsPath, 'gtk_almost_proj.tcl');
    let gtkwaveCmd = `"${tools.gtkwaveBin}" --dark "${vcdFile}"`;
    if (gtkwSaveFile) {
        gtkwaveCmd += ` --rcvar "hide_sst on" -a "${gtkwSaveFile}"`;
    }
    gtkwaveCmd += ` --script="${fixScript}"`;

    const gtkwaveResult = await window.electronAPI.launchGtkwaveOnly({
        gtkwCmd: gtkwaveCmd,
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

        const topLevelModule = topLevelFile.split(/[\\\\/]/)
            .pop()
            .replace(/\.v$/i, '');

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

        const yosysCmd = `cd "${tempBaseDir}" && "${yosysPath}" -s "${yosysScriptPath}"`;

        this.terminalManager.appendToTerminal('twave', tr('terminal.wave.yosysRun', { cmd: yosysCmd }));

        const yosysResult = await window.electronAPI.execCommand(yosysCmd);

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
