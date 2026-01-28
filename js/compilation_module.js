/* eslint-disable no-undef */
// statusUpdater, refreshFileTree, checkCancellation, startCompilation, endCompilation are global
import { TabManager } from './tab_manager.js';
import { EditorManager } from './monaco_editor.js';
import { TerminalManager, showVVPProgress, hideVVPProgress} from './terminal_module.js';
import { TreeViewState } from './tree_view_state_module.js';

class CompilationModule {
    constructor(projectPath) {
        this.projectPath = projectPath;
        this.config = null;
        this.projectConfig = null;
        this.terminalManager = new TerminalManager();
        this.isProjectOriented = false;
        this.hierarchyData = null;
        this.isHierarchicalView = false;
        this.gtkwaveProcess = null;
        this.hierarchyGenerated = false;
        this.setupHierarchyToggle();
        this._hierarchyGenerationInProgress = false;
        this.componentsPath = null;
        this.projectTestbenchBackup = null;
        this.initializeComponentsPath();
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
                    `File not found: ${filePath}`, 'error');
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
                `Failed to open file: ${error.message}`, 'error');
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
                            'GTKWave closed - restoring standard file tree...', 'info');

                        setTimeout(() => {
                            this.restoreStandardTreeState();
                            if (typeof refreshFileTree === 'function') {
                                refreshFileTree();
                            }
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

    async generateProcessorHierarchy(processor) {
        try {
            const yosysPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe');
            const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', processor.name);
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            const hardwarePath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Hardware');
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const designTopModule = selectedCmmFile.replace(/\.cmm$/i, '');

            this.terminalManager.appendToTerminal('tveri', 'Generating module hierarchy with Yosys...');

            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${designTopModule}.v`);

            const yosysScript = `
                ${verilogFiles.map(f => `read_verilog -sv "${hdlPath}\\${f}"`).join('\n')}
                read_verilog -sv "${hardwareFile}"
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempPath}\\hierarchy.json"
            `;

            const scriptPath = await window.electronAPI.joinPath(tempPath, 'hierarchy_gen.ys');
            await window.electronAPI.writeFile(scriptPath, yosysScript);

            const yosysCmd = `cd "${tempPath}" && "${yosysPath}" -s "${scriptPath}"`;
            const result = await window.electronAPI.execCommand(yosysCmd);

            if (result.code !== 0) {
                throw new Error(`Yosys hierarchy generation failed.`);
            }

            const jsonPath = await window.electronAPI.joinPath(tempPath, 'hierarchy.json');
            const jsonContent = await window.electronAPI.readFile(jsonPath, {
                encoding: 'utf8'
            });
            const hierarchyJson = JSON.parse(jsonContent);

            this.hierarchyData = this.parseYosysHierarchy(hierarchyJson, designTopModule);
            this.terminalManager.appendToTerminal('tveri', 'Module hierarchy generated successfully', 'success');
            this.enableHierarchyToggle(); // ✅ Enable toggle
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Hierarchy generation error: ${error.message}`, 'warning');
            return false;
        }
    }

    async generateProjectHierarchy() {
        try {
            if (!this.projectConfig) throw new Error("Project configuration not loaded");

            const topLevelFilePath = this.projectConfig.topLevelFile;
            if (!topLevelFilePath) throw new Error("'topLevelFile' not found in projectOriented.json");

            const designTopModule = topLevelFilePath.split(/[\\\\/]/).pop().replace(/\.v$/i, '');
            const yosysPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe');
            const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');

            this.terminalManager.appendToTerminal('tveri', 'Generating project hierarchy with Yosys...');

            const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
            const yosysScript = `
                ${synthesizableFiles.map(file => `read_verilog -sv "${file.path}"`).join('\n')}
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempBaseDir}\\project_hierarchy.json"
            `;

            const scriptPath = await window.electronAPI.joinPath(tempBaseDir, 'project_hierarchy_gen.ys');
            await window.electronAPI.writeFile(scriptPath, yosysScript);

            const yosysCmd = `cd "${tempBaseDir}" && "${yosysPath}" -s "${scriptPath}"`;
            const result = await window.electronAPI.execCommand(yosysCmd);

            if (result.code !== 0) throw new Error(`Yosys project hierarchy generation failed.`);

            const jsonPath = await window.electronAPI.joinPath(tempBaseDir, 'project_hierarchy.json');
            const hierarchyJson = JSON.parse(await window.electronAPI.readFile(jsonPath, {
                encoding: 'utf8'
            }));

            this.hierarchyData = this.parseYosysHierarchy(hierarchyJson, designTopModule);
            this.terminalManager.appendToTerminal('tveri', 'Project hierarchy generated successfully', 'success');
            this.enableHierarchyToggle(); // ✅ Enable toggle
            return true;
        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Project hierarchy generation error: ${error.message}`, 'warning');
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
        const fileTreeElement = document.getElementById('file-tree');
        if (!fileTreeElement || !this.hierarchyData) return;

        fileTreeElement.innerHTML = '';
        fileTreeElement.classList.add('hierarchy-view');

        const container = document.createElement('div');
        container.className = 'hierarchy-container';

        const topLevelInstance = {
            instanceName: this.hierarchyData.name,
            type: 'instance',
            moduleDefinition: this.hierarchyData
        };

        const topItem = this.createHierarchyItem(topLevelInstance, 'top-level', 'fa-solid fa-microchip', true);

        topItem.setAttribute('data-type', 'top-level');

        container.appendChild(topItem);

        this.buildHierarchyTree(topItem, this.hierarchyData);

        fileTreeElement.appendChild(container);
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
        const projectModeRadio = document.getElementById('Project Mode');
        this.isProjectOriented = projectModeRadio?.checked || false;

        const projectInfo = await window.electronAPI.getCurrentProject();
        const currentProjectPath = projectInfo.projectPath || this.projectPath;

        if (!currentProjectPath) {
            throw new Error('No current project path available for loading configuration');
        }

        // Always load processor config
        const configFilePath = await window.electronAPI.joinPath(currentProjectPath, 'processorConfig.json');
        const config = await window.electronAPI.loadConfigFromPath(configFilePath);
        this.config = config;
        console.log("Processor config loaded:", config);

        // If in Project Mode, also load project config
        if (this.isProjectOriented) {
            const projectConfigPath = await window.electronAPI.joinPath(currentProjectPath, 'projectOriented.json');
            try {
                const projectConfigData = await window.electronAPI.readFile(projectConfigPath);
                this.projectConfig = JSON.parse(projectConfigData);
                console.log("✅ Project config loaded:", this.projectConfig);
            } catch (error) {
                console.warn("⚠️ Could not load projectOriented.json:", error);
                this.projectConfig = null;
            }
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
        let selectedCmmFile = null;
        if (this.config && this.config.selectedCmmFile) {
            selectedCmmFile = this.config.selectedCmmFile;
        } else if (processor.cmmFile) {
            selectedCmmFile = processor.cmmFile;
        } else {
            throw new Error('No C± file selected. Please select one to compile.');
        }
        return selectedCmmFile;
    }

    async getTestbenchInfo(processor, cmmBaseName) {
        let tbModule, tbFile;
        const testbenchFilePath = processor.testbenchFile;

        if (testbenchFilePath && testbenchFilePath !== 'standard') {
            if (this.isProjectOriented) {
                tbFile = testbenchFilePath;
            } else {
                const simulationPath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Simulation');
                tbFile = await window.electronAPI.joinPath(simulationPath, testbenchFilePath);
            }
            const tbFileName = testbenchFilePath.split(/[\\\\/]/)
                .pop();
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
     * Modifica o testbench injetando o bloco de simulação específico do Aurora
     * (Barra de progresso e Dumpvars escopado)
     */
    async modifyTestbenchForSimulation(testbenchPath, tbModuleName, tempBaseDir, simuDelay = "200000") {
        try {
            const originalContent = await window.electronAPI.readFile(testbenchPath, {
                encoding: 'utf8'
            });

            // Normaliza caminhos para escrita no arquivo Verilog (escape duplo para Windows)
            const fixedTempBaseDir = tempBaseDir.replace(/\\/g, '\\\\');
            
            // Garante que o delay seja numérico
            const numericSimuDelay = parseFloat(simuDelay) || 200000.0;
            const vcdFileName = `${tbModuleName}.vcd`;

            // Bloco de simulação solicitado
            const newSimulationCode = `
// --- AURORA SIMULATION BLOCK ---
integer progress, chrys;
initial begin
    $dumpfile("${vcdFileName}");
    $dumpvars(0, ${tbModuleName});
    progress = $fopen("${fixedTempBaseDir}\\\\progress.txt", "w");
    for (chrys = 10; chrys <= 100; chrys = chrys + 10) begin
        #${numericSimuDelay};
        $fdisplay(progress,"%0d",chrys);
        $fflush(progress);
    end
    $fclose(progress);
    $finish;
end
// -------------------------------
`;

            // Limpeza de comandos antigos ($dumpfile/$dumpvars) para evitar conflitos
            let content = originalContent.replace(/\$dumpfile\s*\([^)]+\)\s*;/g, '')
                                         .replace(/\$dumpvars\s*\([^)]+\)\s*;/g, '')
                                         .replace(/\$dumpvars\s*;/g, '');

            // Inserir antes do último 'endmodule'
            const lastEndmoduleIndex = content.lastIndexOf('endmodule');
            if (lastEndmoduleIndex === -1) throw new Error("'endmodule' not found in testbench.");

            const newContent = content.slice(0, lastEndmoduleIndex) + newSimulationCode + content.slice(lastEndmoduleIndex);

            // Salva o arquivo instrumentado na pasta Temp
            const instrumentedPath = await window.electronAPI.joinPath(tempBaseDir, `instr_${testbenchPath.split(/[\\\/]/).pop()}`);
            await window.electronAPI.writeFile(instrumentedPath, newContent);
            
            return instrumentedPath;

        } catch (error) {
            console.error("Failed to modify testbench:", error);
            throw error;
        }
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
            const formatPath = (p) => p.replace(/\\/g, '/');

            const infosContent = [
                formatPath(tempDir),        // 3. tmp_dir
                formatPath(binDir),         // 4. bin_dir
            ].join('\n');

            const infoFilePath = await window.electronAPI.joinPath(tempDir, 'tcl_infos.txt');
            await window.electronAPI.writeFile(infoFilePath, infosContent);
            
            return scriptsDir; // Retorna o caminho dos scripts para uso posterior
        } catch (error) {
            console.error("Error creating tcl_infos.txt:", error);
            throw error;
        }
    }

    getSimulationDelay(processor = null) {
        if (this.isProjectOriented && this.projectConfig && this.projectConfig.simuDelay) {
            return this.projectConfig.simuDelay;
        }
        if (!this.isProjectOriented && processor && processor.numClocks) {
            return processor.numClocks;
        }
        return "200000";
    }

    async cmmCompilation(processor) {
        const {
            name,
            showArraysInGtkwave
        } = processor;
        const showArraysFlag = showArraysInGtkwave === 1 ? '1' : '0';
        await this.terminalManager.clearTerminal('tcmm');

        this.terminalManager.appendToTerminal('tcmm', `Starting C± compilation for ${name}...`);
        
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

            // 3. Comando (Voltou a usar "${macrosPath}" como argumento único para macros)
            const cmd = `"${cmmCompPath}" ${selectedCmmFile} ${cmmBaseName} "${projectPath}" "${macrosPath}" "${tempPath}" ${showArraysFlag}`;
            
            this.terminalManager.appendToTerminal('tcmm', `Executing command: ${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tcmm', result);

            if (result.code !== 0) {
                statusUpdater.compilationError('cmm', `CMM compilation failed with code ${result.code}`);
                throw new Error(`CMM compilation failed with code ${result.code}`);
            }
            statusUpdater.compilationSuccess('cmm');
            return asmPath;
        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('cmm', error.message);
            throw error;
        }
    }

    async asmCompilation(processor, projectParam = null) {
        const {
            name,
            clk,
            numClocks
        } = processor;
        await this.terminalManager.clearTerminal('tasm');

        this.terminalManager.appendToTerminal('tasm', `Starting ASM compilation process for ${name}...`);

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

            let cmd = `"${appCompPath}" "${asmPath}" "${tempPath}"`;
            this.terminalManager.appendToTerminal('tasm', `Executing ASM Preprocessor: ${cmd}`);
            const appResult = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tasm', appResult);

            if (appResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM Preprocessor failed with code ${appResult.code}`);
                throw new Error(`ASM Preprocessor failed with code ${appResult.code}`);
            }

            if (projectParam === null) {
                projectParam = this.isProjectOriented ? 1 : 0;
            }

            cmd = `"${asmCompPath}" "${asmPath}" "${projectPath}" "${hdlPath}" "${macrosPath}" "${tempPath}" ${clk || 0} ${numClocks || 0} ${projectParam}`;
            this.terminalManager.appendToTerminal('tasm', `Executing ASM Compiler: ${cmd}`);

            const asmResult = await window.electronAPI.execCommand(cmd);

            this.terminalManager.processExecutableOutput('tasm', asmResult);


            if (asmResult.code !== 0) {
                statusUpdater.compilationError('asm', `ASM compilation failed with code ${asmResult.code}`);
                throw new Error(`ASM compilation failed with code ${asmResult.code}`);
            }

            if (!this.isProjectOriented && processor.testbenchFile == 'standard') {
                const tbFileName = tbFile.split(/[\\\\/]/)
                    .pop();
                const sourceTestbench = await window.electronAPI.joinPath(tempPath, tbFileName);
                const destinationTestbench = tbFile;

                this.terminalManager.appendToTerminal('tasm', `Copying testbench from "${sourceTestbench}" to "${destinationTestbench}"`);
                await window.electronAPI.copyFile(sourceTestbench, destinationTestbench);
                this.terminalManager.appendToTerminal('tasm', 'Testbench updated in project folder.', 'tips');
            }

            statusUpdater.compilationSuccess('asm');
        } catch (error) {
            this.terminalManager.appendToTerminal('tasm', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('asm', error.message);
            throw error;
        }
    }


    /**
 * Icarus Verilog Compilation (Project Mode)
 * Compiles user files with instrumented testbench (using a temp file, preserving original)
 */


async collectVerilogSources(processors, componentsPath, projectPath) {
    const verilogSources = [];
    
    const hdlPath = await window.electronAPI.joinPath(componentsPath, 'HDL');
    const baseHdlFiles = [
        'addr_dec.v',
        'core.v', 
        'instr_dec.v',
        'myFIFO.v',
        'processor.v',
        'ula.v'
    ];

    for (const file of baseHdlFiles) {
        const filePath = await window.electronAPI.joinPath(hdlPath, file);
        verilogSources.push({
            path: filePath,
            type: 'base_hdl',
            description: `Core HDL: ${file}`
        });
    }

    this.terminalManager.appendToTerminal('tveri', `Added ${baseHdlFiles.length} base HDL files`, 'info');

    for (const processor of processors) {
        try {
            const processorName = processor.name;
            
            const hardwarePath = await window.electronAPI.joinPath(
                projectPath, 
                processorName, 
                'Hardware'
            );

            const hardwareDirExists = await window.electronAPI.fileExists(hardwarePath);
            if (!hardwareDirExists) {
                this.terminalManager.appendToTerminal(
                    'tveri',
                    `Warning: Hardware directory not found for ${processorName}`,
                    'warning'
                );
                continue;
            }

            const files = await window.electronAPI.getFolderFiles(hardwarePath);
            const verilogFiles = files.filter(f => {
                const fileName = typeof f === 'string' ? f : f.name;
                return fileName.endsWith('.v');
            });

            for (const vFile of verilogFiles) {
                const fileName = typeof vFile === 'string' ? vFile : vFile.name;
                const filePath = await window.electronAPI.joinPath(hardwarePath, fileName);
                verilogSources.push({
                    path: filePath,
                    type: 'processor_hardware',
                    processor: processorName,
                    description: `${processorName} Hardware: ${fileName}`
                });
            }

            this.terminalManager.appendToTerminal(
                'tveri',
                `  Processor ${processorName}: ${verilogFiles.length} hardware file(s)`,
                'info'
            );

        } catch (error) {
            this.terminalManager.appendToTerminal(
                'tveri',
                `Warning: Error collecting files for ${processor.name}: ${error.message}`,
                'warning'
            );
        }
    }

    return verilogSources;
}

async validateMemoryFiles(projectTempDir) {
    this.terminalManager.appendToTerminal('tveri', 'Validating memory files...', 'info');
    
    try {
        const files = await window.electronAPI.getFolderFiles(projectTempDir);
        const memoryFiles = files.filter(f => {
            const fileName = typeof f === 'string' ? f : f.name;
            return fileName.startsWith('pc_') && fileName.endsWith('mem.txt');
        });

        if (memoryFiles.length === 0) {
            this.terminalManager.appendToTerminal(
                'tveri',
                'WARNING: No pc_*mem.txt files found in Temp directory',
                'warning'
            );
            this.terminalManager.appendToTerminal(
                'tveri',
                'This will cause "invalid file descriptor" errors if testbench uses $readmemh/$fscanf',
                'warning'
            );
            return { valid: false, files: [] };
        }

        const validatedFiles = [];
        for (const file of memoryFiles) {
            const fileName = typeof file === 'string' ? file : file.name;
            const filePath = await window.electronAPI.joinPath(projectTempDir, fileName);
            
            try {
                const stats = await window.electronAPI.getFileStats(filePath);
                if (stats.size === 0) {
                    this.terminalManager.appendToTerminal(
                        'tveri',
                        `  Warning: ${fileName} is empty`,
                        'warning'
                    );
                } else {
                    validatedFiles.push({
                        name: fileName,
                        path: filePath,
                        size: stats.size
                    });
                    this.terminalManager.appendToTerminal(
                        'tveri',
                        `  Validated: ${fileName} (${stats.size} bytes)`,
                        'success'
                    );
                }
            } catch (error) {
                this.terminalManager.appendToTerminal(
                    'tveri',
                    `  Error validating ${fileName}: ${error.message}`,
                    'error'
                );
            }
        }

        return {
            valid: validatedFiles.length > 0,
            files: validatedFiles
        };

    } catch (error) {
        this.terminalManager.appendToTerminal(
            'tveri',
            `Error validating memory files: ${error.message}`,
            'error'
        );
        return { valid: false, files: [] };
    }
}


async iverilogProjectCompilation() {
    this.terminalManager.appendToTerminal('tveri', '--- Icarus Verilog Project Compilation ---', 'info');
    statusUpdater.startCompilation('verilog');

    try {
        if (!this.projectConfig) {
            throw new Error("Project configuration not loaded");
        }

        if (!this.projectConfig.processors || !Array.isArray(this.projectConfig.processors)) {
            throw new Error("No processors defined in projectOriented.json");
        }

        if (this.projectConfig.processors.length === 0) {
            throw new Error("Processor array is empty in projectOriented.json");
        }

        this.terminalManager.appendToTerminal(
            'tveri', 
            `Configured processors: ${this.projectConfig.processors.length}`, 
            'info'
        );

        const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
        const scriptsPath = await window.electronAPI.joinPath(this.componentsPath, 'Scripts');
        const iveriCompPath = await window.electronAPI.joinPath(
            this.componentsPath, 
            'Packages', 
            'iverilog', 
            'bin', 
            'iverilog.exe'
        );

        await window.electronAPI.mkdir(tempBaseDir);

        const fixVcdSource = await window.electronAPI.joinPath(scriptsPath, 'fix.vcd');
        const fixVcdDest = await window.electronAPI.joinPath(tempBaseDir, 'fix.vcd');
        
        try {
            await window.electronAPI.copyFile(fixVcdSource, fixVcdDest);
            this.terminalManager.appendToTerminal('tveri', 'fix.vcd copied', 'success');
        } catch (error) {
            this.terminalManager.appendToTerminal(
                'tveri', 
                `Warning: Could not copy fix.vcd - ${error.message}`, 
                'warning'
            );
        }

        const memoryFilesResult = await this.copyProcessorMemoryFiles(
            this.projectConfig.processors,
            this.componentsPath,
            tempBaseDir
        );

        if (!memoryFilesResult.success) {
            this.terminalManager.appendToTerminal(
                'tveri',
                'WARNING: No memory files copied. Simulation may fail.',
                'warning'
            );
        }

        const validationResult = await this.validateMemoryFiles(tempBaseDir);
        
        if (!validationResult.valid) {
            this.terminalManager.appendToTerminal(
                'tveri',
                'WARNING: Memory file validation failed',
                'warning'
            );
        }

        const topLevelFile = this.projectConfig.topLevelFile;
        const testbenchFile = this.projectConfig.testbenchFile;
        
        if (!topLevelFile) {
            throw new Error("No top-level file specified in projectOriented.json");
        }
        
        if (!testbenchFile) {
            throw new Error("No testbench file specified in projectOriented.json");
        }

        const topLevelModuleName = topLevelFile.split(/[\\\/]/).pop().replace(/\.v$/i, '');
        const testbenchModuleName = testbenchFile.split(/[\\\/]/).pop().replace(/\.v$/i, '');
        
        this.terminalManager.appendToTerminal('tveri', `Top-level: ${topLevelModuleName}`, 'info');
        this.terminalManager.appendToTerminal('tveri', `Testbench: ${testbenchModuleName}`, 'info');

        const tempTbFileName = `tb_inst_${testbenchModuleName}.v`;
        const tempTbPath = await window.electronAPI.joinPath(tempBaseDir, tempTbFileName);
        const simuDelay = this.projectConfig.simuDelay || '200000';
        
        await this.instrumentProjectTestbench(
            testbenchFile,
            tempTbPath,
            tempBaseDir,
            testbenchModuleName, 
            topLevelModuleName,
            simuDelay
        );

        this.terminalManager.appendToTerminal('tveri', 'Collecting Verilog sources...', 'info');
        
        const verilogSources = await this.collectVerilogSources(
            this.projectConfig.processors,
            this.componentsPath,
            this.projectPath
        );

        const userSourceFiles = this.projectConfig.synthesizableFiles || [];
        for (const userFile of userSourceFiles) {
            if (userFile.path) {
                verilogSources.push({
                    path: userFile.path,
                    type: 'user_synthesizable',
                    description: `User: ${userFile.path.split(/[\\\/]/).pop()}`
                });
            }
        }

        this.terminalManager.appendToTerminal(
            'tveri',
            `Total Verilog sources: ${verilogSources.length}`,
            'info'
        );

        const flags = this.projectConfig.iverilogFlags || '';
        const outputFile = await window.electronAPI.joinPath(tempBaseDir, `${topLevelModuleName}.vvp`);
        
        const lastSeparatorIndex = Math.max(
            testbenchFile.lastIndexOf('/'), 
            testbenchFile.lastIndexOf('\\')
        );
        const originalTbDir = (lastSeparatorIndex !== -1) 
            ? testbenchFile.substring(0, lastSeparatorIndex) 
            : ".";
        const includeFlag = `-I "${originalTbDir}"`;

        const sourceFilesString = verilogSources
            .map(src => `"${src.path}"`)
            .join(' ');

        const cmd = [
            `"${iveriCompPath}"`,
            flags,
            `-s ${testbenchModuleName}`,
            `-o "${outputFile}"`,
            includeFlag,
            sourceFilesString,
            `"${tempTbPath}"`
        ].filter(Boolean).join(' ');

        this.terminalManager.appendToTerminal('tveri', 'Compilation command:', 'info');
        this.terminalManager.appendToTerminal('tveri', cmd, 'info');

        await TabManager.saveAllFiles();

        this.terminalManager.appendToTerminal('tveri', 'Compiling...', 'info');
        
        const result = await window.electronAPI.execCommand(cmd);
        this.terminalManager.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            throw new Error(`Iverilog compilation failed with exit code ${result.code}`);
        }

        this.terminalManager.appendToTerminal('tveri', '--- Compilation Successful ---', 'success');
        statusUpdater.compilationSuccess('verilog');

        await this.generateProjectHierarchy();

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', '--- Compilation Failed ---', 'error');
        this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
        statusUpdater.compilationError('verilog', error.message);
        throw error;
    }
}
/**
 * Instrument testbench for Project Mode with progress tracking and VCD generation
 * Creates a TEMPORARY file, does NOT modify the user file.
 * Conditionally adds VCD logic only if missing.
 */
async instrumentProjectTestbench(sourcePath, destPath, tempDir, tbModuleName, topLevelModuleName, simuDelay) {
    try {
        const originalContent = await window.electronAPI.readFile(sourcePath, { encoding: 'utf8' });
        
        const hasDumpVars = /\$dumpvars/.test(originalContent);
        const hasDumpFile = /\$dumpfile/.test(originalContent);
        const userHasVcdLogic = hasDumpVars || hasDumpFile;

        let content = originalContent
            .replace(/\$finish\s*;/g, '// $finish; (Aurora controlled)');

        const numericSimuDelay = parseFloat(simuDelay) || 200000.0;
        const vcdFileName = `${tbModuleName}.vcd`; // ✅ VCD named after testbench, not top-level
        const progressFilePath = `${tempDir.replace(/\\/g, '\\\\')}\\\\progress.txt`;

        let vcdLogic = '';
        
        if (!userHasVcdLogic) {
            vcdLogic = `
    // VCD Configuration - SCOPED to testbench module (Auto-injected by Aurora)
    $dumpfile("${vcdFileName}");
    $dumpvars(0, ${tbModuleName});`;
        } else {
            vcdLogic = `
    // VCD Configuration skipped: User defined $dumpvars/$dumpfile detected.`;
        }

        const injectionCode = `
// ============================================
// AURORA PROJECT MODE SIMULATION BLOCK
// ============================================
integer aurora_progress_file, aurora_progress_counter;
initial begin
    ${vcdLogic}
    
    // Progress Tracking
    aurora_progress_file = $fopen("${progressFilePath}", "w");
    for (aurora_progress_counter = 10; aurora_progress_counter <= 100; aurora_progress_counter = aurora_progress_counter + 10) begin
        #${numericSimuDelay}; 
        $fdisplay(aurora_progress_file, "%0d", aurora_progress_counter);
        $fflush(aurora_progress_file);
    end
    $fclose(aurora_progress_file);
    $finish;
end
// ============================================
`;

        const lastEndmoduleIndex = content.lastIndexOf('endmodule');
        if (lastEndmoduleIndex === -1) {
            throw new Error("Invalid testbench: 'endmodule' keyword not found");
        }

        const instrumentedContent = 
            content.slice(0, lastEndmoduleIndex) + 
            injectionCode + 
            content.slice(lastEndmoduleIndex);

        await window.electronAPI.writeFile(destPath, instrumentedContent);
        
        this.terminalManager.appendToTerminal('tveri', 
            `Testbench instrumented to temp file: ${destPath.split(/[\\\/]/).pop()}`, 'info');
        
        return {
            instrumentedPath: destPath
        };

    } catch (error) {
        console.error("Failed to instrument testbench:", error);
        throw new Error(`Testbench instrumentation failed: ${error.message}`);
    }
}


    setupHierarchyToggle() {
        const toggleButton = document.getElementById('alternate-tree-toggle');
        if (!toggleButton) {
            console.warn('Hierarchy toggle button not found');
            return;
        }

        TreeViewState.setCompilationModule(this);

        TreeViewState.disableToggle();

        toggleButton.addEventListener('click', () => {
            if (toggleButton.disabled || toggleButton.dataset.switching === 'true') {
                console.log('Toggle disabled or switching in progress');
                return;
            }

            if (!TreeViewState.isHierarchical && !this.hierarchyData) {
                console.warn('Cannot switch to hierarchical view - no data');
                this.terminalManager.appendToTerminal('tveri',
                    'Please compile Verilog first to generate hierarchy', 'warning');
                return;
            }

            toggleButton.dataset.switching = 'true';

            try {
                if (TreeViewState.isHierarchical) {
                    this.switchToStandardView();
                } else {
                    this.switchToHierarchicalView();
                }
            } catch (error) {
                console.error('Error toggling hierarchy view:', error);
                this.terminalManager.appendToTerminal('tveri',
                    `Error switching view: ${error.message}`, 'error');
            } finally {
                setTimeout(() => {
                    toggleButton.dataset.switching = 'false';
                }, 300);
            }
        });
    }

    switchToStandardView() {
        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;

        fileTree.style.transition = 'opacity 0.2s ease';
        fileTree.style.opacity = '0';

        setTimeout(() => {
            fileTree.innerHTML = '';
            fileTree.classList.remove('hierarchy-view');

            TreeViewState.setHierarchical(false);

            refreshFileTree();


            this.terminalManager.appendToTerminal('tveri',
                'Switched to standard file tree', 'info');
        }, 200);
    }

    async generateHierarchyAfterCompilation(processor = null) {
        try {
            if (this._hierarchyGenerationInProgress) {
                console.log('Hierarchy generation already in progress, skipping duplicate call');
                return true;
            }

            this._hierarchyGenerationInProgress = true;
            let success = false;

            if (this.isProjectOriented) {
                success = await this.generateProjectHierarchy();
            } else if (processor) {
                success = await this.generateProcessorHierarchy(processor);
            }

            if (success) {
                this.hierarchyGenerated = true;
                TreeViewState.hierarchyData = this.hierarchyData;

                if (!TreeViewState.isToggleEnabled) {
                    TreeViewState.enableToggle();
                    TreeViewState.isToggleEnabled = true;
                }

                await this.switchToHierarchicalView();
            }

            return success;
        } catch (error) {
            console.error('Error generating hierarchy:', error);
            return false;
        } finally {
            this._hierarchyGenerationInProgress = false;
        }
    }

async iverilogCompilation(processor) {
    // If project oriented, delegate to project compilation
    if (this.isProjectOriented) {
        return this.iverilogProjectCompilation();
    }

    // DEFENSIVE CHECK: Ensure processor is provided
    if (!processor) {
        throw new Error('Processor configuration is required for processor-mode Verilog compilation. Use Project Mode for processor-less compilation.');
    }

    const { name } = processor;
    await this.terminalManager.clearTerminal('tveri');

    this.terminalManager.appendToTerminal('tveri', `Starting Icarus Verilog compilation for ${name}...`);
    statusUpdater.startCompilation('verilog');

        try {
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
            const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
            const iveriCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe');

            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const {
                tbModule,
                tbFile
            } = await this.getTestbenchInfo(processor, cmmBaseName);

            const flags = this.config.iverilogFlags ? this.config.iverilogFlags.join(' ') : '';
            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const verilogFilesString = verilogFiles.map(f => `"${hdlPath}\\${f}"`).join(' ');

            await TabManager.saveAllFiles();

            const outputFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}.vvp`);
            const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);

            const cmd = `"${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFile}" "${tbFile}" "${hardwareFile}" ${verilogFilesString}`;
            this.terminalManager.appendToTerminal('tveri', `Executing: ${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tveri', result);

            if (result.code !== 0) {
                statusUpdater.compilationError('verilog', `Icarus Verilog failed with code ${result.code}`);
                throw new Error(`Icarus Verilog compilation failed`);
            }

            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`),
                await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
            );
            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`),
                await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
            );

            this.terminalManager.appendToTerminal('tveri', 'Verilog compilation completed', 'success');
            statusUpdater.compilationSuccess('verilog');
            await this.generateHierarchyAfterCompilation(processor);
            const hierarchyGenerated = await this.generateProcessorHierarchy(processor);
            if (hierarchyGenerated) {
                this.hierarchyGenerated = true;
                this.enableHierarchyToggle();
                await this.switchToHierarchicalView();
            }


        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('verilog', error.message);
            throw error;
        }
    }

    async runOptimizedVVP(command, workingDir, terminalTag = 'twave') {
        const cardId = `vvp-run-${Date.now()}`;
        let cardContent = [];
        let vvpProcessPid = null;

        const outputListener = (event, payload) => {
            if (payload.type === 'pid') {
                vvpProcessPid = payload.pid;
                cardContent.push(`High-performance VVP started (PID: ${vvpProcessPid})`);
                this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');
            }
        };

        window.electronAPI.onCommandOutputStream(outputListener);

        try {
            cardContent.push('Starting optimized VVP execution...');
            this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');

            const systemInfo = await window.electronAPI.getSystemPerformance();
            cardContent.push(`System: ${systemInfo.cpuCount} cores, ${systemInfo.totalMemory}GB RAM, ${systemInfo.freeMemory}GB free`);
            this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'running');

            const enhancedCommand = command.replace(/\s*-fst\s*/g, ' ');
            const vvpResult = await window.electronAPI.execVvpOptimized(enhancedCommand, workingDir);

            this.terminalManager.processExecutableOutput(terminalTag, vvpResult);

            checkCancellation();
            if (vvpResult.code !== 0) {
                hideVVPProgress();
                throw new Error(`VVP simulation failed with code ${vvpResult.code}`);
            }

            cardContent.push(`<b>VVP completed successfully using ${vvpResult.performance?.cpuCount || 'N/A'} cores</b>`);
            this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'success');

            try {
                const audio = new Audio('./assets/audio/audio_compilation.wav');
                audio.play().catch(e => console.log('Could not play success sound:', e));
            } catch (e) {
                console.log('Audio not available:', e);
            }

            return vvpResult;

        } catch (error) {
            if (error.message === 'Compilation canceled by user') {
                cardContent.push('<b>VVP process terminated due to cancellation.</b>');
                this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'canceled');
            } else {
                cardContent.push(`<b>VVP simulation failed:</b> ${error.message}`);
                this.terminalManager.createOrUpdateCard(terminalTag, cardId, cardContent, 'vvp-process', 'error');
            }

            throw error;

        } finally {
            window.electronAPI.removeCommandOutputListener(outputListener);
        }
    }

    getCompilationMode() {
        const stored = localStorage.getItem('aurora-settings');
        if (stored) {
            const settings = JSON.parse(stored);
            return settings.parallelCompilation !== false;
        }
        return true;
    }

    async waitForVcdCompletion(tempPath, maxWaitMs = 600000) {
        const progressFile = await window.electronAPI.joinPath(tempPath, 'progress.txt');
        const startTime = Date.now();

        this.terminalManager.appendToTerminal('twave',
            'Waiting for VCD generation to complete...', 'info');

        return new Promise((resolve, reject) => {
            const checkProgress = async () => {
                try {
                    if (Date.now() - startTime > maxWaitMs) {
                        reject(new Error('VCD generation timeout'));
                        return;
                    }

                    const exists = await window.electronAPI.fileExists(progressFile);
                    if (!exists) {
                        setTimeout(checkProgress, 500);
                        return;
                    }

                    const content = await window.electronAPI.readFile(progressFile, {
                        encoding: 'utf8'
                    });
                    const lines = content.trim().split('\n');
                    const lastProgress = lines[lines.length - 1];
                    const progress = parseInt(lastProgress, 10);

                    if (progress >= 100) {
                        this.terminalManager.appendToTerminal('twave',
                            'VCD generation complete (100%)', 'success');
                        resolve();
                    } else {
                        setTimeout(checkProgress, 500);
                    }
                } catch {
                    setTimeout(checkProgress, 500);
                }
            };

            checkProgress();
        });
    }

    async launchGtkwaveSequential(gtkwCmd, workingDir) {
        this.terminalManager.appendToTerminal('twave',
            'Launching GTKWave with complete VCD file...', 'info');

        const gtkwaveOutputHandler = (event, payload) => {
            switch (payload.type) {
                case 'stdout':
                case 'stderr':
                    if (payload.data.trim()) {
                        this.terminalManager.processStreamedLine('twave', payload.data.trim());
                    }
                    break;
                case 'completion':
                    this.terminalManager.appendToTerminal('twave', payload.message,
                        payload.code === 0 ? 'success' : 'warning');
                    break;
                case 'error':
                    this.terminalManager.appendToTerminal('twave', payload.data, 'error');
                    break;
            }
        };

        window.electronAPI.onGtkwaveOutput(gtkwaveOutputHandler);

        try {
            const result = await window.electronAPI.launchGtkwaveOnly({
                gtkwCmd: gtkwCmd,
                workingDir: workingDir
            });

            if (result.success) {
                this.gtkwaveProcess = result.gtkwavePid;
                this.terminalManager.appendToTerminal('twave',
                    'GTKWave launched successfully', 'success');
                this.monitorGtkwaveProcess();
                return result;
            } else {
                throw new Error(`Failed to launch GTKWave: ${result.message}`);
            }
        } finally {
            window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
        }
    }

async runGtkWave(processor) {
    // If project oriented, delegate to project GTKWave
    if (this.isProjectOriented) {
        checkCancellation();
        return this.runProjectGtkWave();
    }

    // DEFENSIVE CHECK: Ensure processor is provided
    if (!processor) {
        throw new Error('Processor configuration is required for processor-mode waveform viewing. Use Project Mode for processor-less simulation.');
    }

    const { name } = processor;
    await this.terminalManager.clearTerminal('twave');
    
    this.terminalManager.appendToTerminal('twave', `Starting GTKWave for ${name}...`);
    statusUpdater.startCompilation('wave');

        const isParallelMode = this.getCompilationMode();

        let testbenchBackupInfo = null;
        let gtkwaveOutputHandler = null;

        try {
            const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
            const simulationPath = await window.electronAPI.joinPath(this.projectPath, name, 'Simulation');
            const scriptsPath = await window.electronAPI.joinPath(this.componentsPath, 'Scripts');
            const iveriCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe');
            const vvpCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'vvp.exe');
            const gtkwCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe');
            const binPath = await window.electronAPI.joinPath(this.componentsPath, 'bin');
            const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');

            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const {
                tbModule,
                tbFile
            } = await this.getTestbenchInfo(processor, cmmBaseName);

            if (processor.testbenchFile && processor.testbenchFile !== 'standard') {
                const simuDelay = this.getSimulationDelay(processor);
                testbenchBackupInfo = await this.modifyTestbenchForSimulation(tbFile, tbModule, tempPath, simuDelay);
            }

            const tclFilePath = await window.electronAPI.joinPath(tempPath, 'tcl_infos.txt');

            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(scriptsPath, 'fix.vcd'),
                await window.electronAPI.joinPath(tempBaseDir, 'fix.vcd')
            );

            const tclContent = `${tempPath}\n${binPath}\n`;
            await window.electronAPI.writeFile(tclFilePath, tclContent);

            await TabManager.saveAllFiles();

            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const verilogFilesString = verilogFiles.join(' ');
            const outputFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}.vvp`);
            const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
            const iverilogCmd = `cd "${hdlPath}" && "${iveriCompPath}" -s ${tbModule} -o "${outputFile}" "${tbFile}" "${hardwareFile}" ${verilogFilesString}`;

            const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
            this.terminalManager.processExecutableOutput('twave', iverilogResult);

            if (iverilogResult.code !== 0) {
                throw new Error('Icarus Verilog compilation failed');
            }

            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_data.mif`),
                await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_data.mif`)
            );
            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_inst.mif`),
                await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_inst.mif`)
            );

            const vcdPath = await window.electronAPI.joinPath(tempPath, `${tbModule}.vcd`);
            await window.electronAPI.deleteFileOrDirectory(vcdPath);

            const vvpCmd = `"${vvpCompPath}" "${cmmBaseName}.vvp"`;

            const useStandardGtkw = !processor.gtkwFile || processor.gtkwFile === 'standard';
            let gtkwCmd;

            if (useStandardGtkw) {
                const scriptPath = await window.electronAPI.joinPath(scriptsPath, 'gtk_proc_init.tcl');
                gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${vcdPath}" --script=${scriptPath}`;
            } else {
                const gtkwPath = await window.electronAPI.joinPath(simulationPath, processor.gtkwFile);
                const posScript = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
                gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${gtkwPath}" --script=${posScript}`;
            }

            gtkwaveOutputHandler = (event, payload) => {
                switch (payload.type) {
                    case 'stdout':
                    case 'stderr':
                        if (payload.data.trim()) {
                            this.terminalManager.processStreamedLine('twave', payload.data.trim());
                        }
                        break;
                    case 'completion':
                        this.terminalManager.appendToTerminal('twave', payload.message,
                            payload.code === 0 ? 'success' : 'warning');
                        break;
                    case 'error':
                        this.terminalManager.appendToTerminal('twave', payload.data, 'error');
                        break;
                }
            };

            window.electronAPI.onGtkwaveOutput(gtkwaveOutputHandler);
            await showVVPProgress(String(name));

            const simulationMethod = isParallelMode ? 'launchParallelSimulation' : 'launchSerialSimulation';
            this.terminalManager.appendToTerminal('twave',
                `Starting ${isParallelMode ? 'parallel' : 'serial'} simulation...`, 'info');

            const result = await window.electronAPI[simulationMethod]({
                vvpCmd: vvpCmd,
                gtkwCmd: gtkwCmd,
                vcdPath: vcdPath,
                workingDir: tempPath
            });

            hideVVPProgress();

            if (result.success) {
                this.gtkwaveProcess = result.gtkwavePid;
                this.terminalManager.appendToTerminal('twave',
                    `GTKWave launched successfully (${isParallelMode ? 'parallel' : 'serial'} mode)`, 'success');
                this.monitorGtkwaveProcess();
            } else {
                throw new Error(`Failed to launch simulation: ${result.message}`);
            }

            statusUpdater.compilationSuccess('wave');

        } catch (error) {
            hideVVPProgress();
            this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('wave', error.message);
            throw error;

        } finally {
            if (gtkwaveOutputHandler) {
                window.electronAPI.removeGtkwaveOutputListener(gtkwaveOutputHandler);
            }
            if (testbenchBackupInfo) {
                await window.electronAPI.restoreOriginalTestbench(testbenchBackupInfo.originalPath, testbenchBackupInfo.backupPath);
            }
        }
    }

    async copyProcessorMemoryFiles(processors, componentsPath, projectTempDir) {
    this.terminalManager.appendToTerminal('tveri', 'Copying processor memory files to Temp...', 'info');
    
    const copiedFiles = [];
    const errors = [];

    for (const processor of processors) {
        try {
            const processorType = processor.type || processor.name;
            const processorTempDir = await window.electronAPI.joinPath(
                componentsPath, 
                'Temp', 
                processorType
            );

            const dirExists = await window.electronAPI.fileExists(processorTempDir);
            if (!dirExists) {
                this.terminalManager.appendToTerminal(
                    'tveri', 
                    `Warning: Processor '${processorType}' temp directory not found at ${processorTempDir}`, 
                    'warning'
                );
                this.terminalManager.appendToTerminal(
                    'tveri',
                    `You must compile processors individually first to generate their temp directories`,
                    'warning'
                );
                continue;
            }

            const files = await window.electronAPI.getFolderFiles(processorTempDir);
            
            for (const file of files) {
                const fileName = typeof file === 'string' ? file : file.name;
                
                if (fileName.startsWith('pc_') && fileName.endsWith('mem.txt')) {
                    const sourcePath = await window.electronAPI.joinPath(processorTempDir, fileName);
                    const destPath = await window.electronAPI.joinPath(projectTempDir, fileName);
                    
                    try {
                        await window.electronAPI.copyFile(sourcePath, destPath);
                        copiedFiles.push({
                            processor: processorType,
                            file: fileName,
                            source: sourcePath,
                            destination: destPath
                        });
                        
                        this.terminalManager.appendToTerminal(
                            'tveri', 
                            `  Copied: ${fileName} (from ${processorType})`, 
                            'success'
                        );
                    } catch (copyError) {
                        errors.push({
                            processor: processorType,
                            file: fileName,
                            error: copyError.message
                        });
                        
                        this.terminalManager.appendToTerminal(
                            'tveri', 
                            `  Error copying ${fileName}: ${copyError.message}`, 
                            'error'
                        );
                    }
                }
            }
        } catch (processorError) {
            this.terminalManager.appendToTerminal(
                'tveri', 
                `Warning: Error processing ${processor.type || processor.name}: ${processorError.message}`, 
                'warning'
            );
        }
    }

    this.terminalManager.appendToTerminal(
        'tveri', 
        `Memory files copied: ${copiedFiles.length}, Errors: ${errors.length}`, 
        copiedFiles.length > 0 ? 'info' : 'warning'
    );

    return {
        copiedFiles,
        errors,
        success: copiedFiles.length > 0
    };
}

/**
 * Run GTKWave for Project Mode with progress monitoring
 */
async runProjectGtkWave() {
    this.terminalManager.appendToTerminal('twave', 'Starting Simulation & GTKWave (Project Mode)...');

    try {
        if (!this.projectConfig) throw new Error("Project configuration not loaded");

        const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');

        const topLevelFile = this.projectConfig.topLevelFile;
        const testbenchFile = this.projectConfig.testbenchFile;

        if (!topLevelFile) throw new Error("No top-level file specified.");
        if (!testbenchFile) throw new Error("No testbench file specified.");

        const topLevelModuleName = topLevelFile.split(/[\\\/]/).pop().replace(/\.v$/i, '');
        const testbenchModuleName = testbenchFile.split(/[\\\/]/).pop().replace(/\.v$/i, '');

        const vvpFile = await window.electronAPI.joinPath(tempBaseDir, `${topLevelModuleName}.vvp`);
        const vcdFile = await window.electronAPI.joinPath(tempBaseDir, `${testbenchModuleName}.vcd`); // ✅ VCD named after testbench

        if (!await window.electronAPI.fileExists(vvpFile)) {
            throw new Error(`Simulation file not found: ${vvpFile}. Please compile first.`);
        }

        this.terminalManager.appendToTerminal('twave', 'Running VVP simulation...');

        const vvpBin = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'vvp.exe');
        const vvpCmd = `cd "${tempBaseDir}" && "${vvpBin}" "${vvpFile}"`;
        
        const result = await window.electronAPI.execCommand(vvpCmd);
        
        if (result.stdout) this.terminalManager.appendToTerminal('twave', result.stdout);
        if (result.stderr) this.terminalManager.appendToTerminal('twave', result.stderr);

        if (result.code !== 0) {
            throw new Error(`VVP simulation failed with exit code ${result.code}`);
        }

        if (!await window.electronAPI.fileExists(vcdFile)) {
            throw new Error(`VCD file was not generated at: ${vcdFile}`);
        }

        this.terminalManager.appendToTerminal('twave', 'Opening GTKWave...');
        
        const gtkwaveBin = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'gtkwave', 'bin', 'gtkwave.exe');
        const gtkwaveCmd = `"${gtkwaveBin}" "${vcdFile}"`;
        
        await window.electronAPI.execCommand(gtkwaveCmd).catch(err => {
            console.error("GTKWave closed or error:", err);
        });

        this.terminalManager.appendToTerminal('twave', 'GTKWave launched successfully', 'success');

    } catch (error) {
        this.terminalManager.appendToTerminal('twave', `Error: ${error.message}`, 'error');
        console.error(error);
        throw error;
    }
}
/**
 * Restore original testbench from backup after simulation
 */
async restoreProjectTestbenchBackup() {
    if (!this.projectTestbenchBackup) return;
    
    try {
        const backupExists = await window.electronAPI.fileExists(this.projectTestbenchBackup);
        if (!backupExists) return;
        
        const originalPath = this.projectTestbenchBackup.replace('.aurora_backup', '');
        
        // Restore original file
        await window.electronAPI.copyFile(this.projectTestbenchBackup, originalPath);
        
        // Delete backup
        await window.electronAPI.deleteFileOrDirectory(this.projectTestbenchBackup);
        
        this.terminalManager.appendToTerminal('twave', 'Original testbench restored', 'success');
        this.projectTestbenchBackup = null;
        
    } catch (error) {
        console.error("Failed to restore testbench backup:", error);
        this.terminalManager.appendToTerminal('twave', 
            'Warning: Could not restore original testbench', 'warning');
    }
}

    async generateHierarchyWithYosys(yosysPath, tempBaseDir) {
        this.terminalManager.appendToTerminal('twave', 'Generating hierarchy with Yosys...');

        const projectConfigPath = await window.electronAPI.joinPath(this.projectPath, 'projectOriented.json');
        const projectConfigData = await window.electronAPI.readFile(projectConfigPath);
        this.projectConfig = JSON.parse(projectConfigData);

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

        this.terminalManager.appendToTerminal('twave', `Running Yosys command: ${yosysCmd}`);

        const yosysResult = await window.electronAPI.execCommand(yosysCmd);

        if (yosysResult.stdout) this.terminalManager.appendToTerminal('twave', yosysResult.stdout, 'stdout');
        if (yosysResult.stderr) this.terminalManager.appendToTerminal('twave', yosysResult.stderr, 'stderr');

        if (yosysResult.code !== 0) {
            throw new Error(`Yosys synthesis failed with code ${yosysResult.code}`);
        }

        const jsonExists = await window.electronAPI.fileExists(jsonOutputPath);
        if (!jsonExists) {
            throw new Error(`Yosys JSON output file not generated: ${jsonOutputPath}`);
        }

        const jsonContent = await window.electronAPI.readFile(jsonOutputPath, {
            encoding: 'utf8'
        });
        const hierarchyData = JSON.parse(jsonContent);

        this.hierarchyData = this.parseYosysHierarchy(hierarchyData, topLevelModule);

        this.terminalManager.appendToTerminal('twave', `Hierarchy generated successfully for top-level module: ${topLevelModule}`, 'success');

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

    saveStandardTreeState() {
        const fileTree = document.getElementById('file-tree');
        if (fileTree) {
            this.standardTreeState = fileTree.innerHTML;
        }
    }

    restoreStandardTreeState() {
        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return;

        this.isHierarchicalView = false;

        fileTree.innerHTML = '';

        if (typeof refreshFileTree === 'function') {
            refreshFileTree();
        }
    }

switchToHierarchicalView() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) {
        console.warn('File tree element not found');
        return;
    }

    if (!this.hierarchyData) {
        console.warn('No hierarchy data available');
        this.terminalManager.appendToTerminal('tveri',
            'No hierarchy data available. Please compile Verilog first.', 'warning');
        return;
    }

    fileTree.style.transition = 'opacity 0.2s ease';
    fileTree.style.opacity = '0';

    setTimeout(() => {
        fileTree.innerHTML = '';
        fileTree.classList.add('hierarchy-view');

        this.renderHierarchicalTree();

        TreeViewState.setHierarchical(true);
        this.updateToggleButtonForCurrentMode(); // Update button state

        fileTree.style.opacity = '1';

        this.terminalManager.appendToTerminal('tveri',
            'Switched to hierarchical module view', 'info');
    }, 200);
}
        enableHierarchyToggle() {
            const toggleButton = document.getElementById('alternate-tree-toggle');
            if (!toggleButton) return;

            toggleButton.classList.remove('disabled');
            toggleButton.disabled = false;
            TreeViewState.isToggleEnabled = true;
            
            this.updateToggleButtonForCurrentMode();
            
            this.terminalManager.appendToTerminal('tveri',
                'Hierarchical view is now available', 'success');
        }

        /**
 * Update toggle button text and icon based on current mode and view
 */
updateToggleButtonForCurrentMode() {
    const toggleButton = document.getElementById('alternate-tree-toggle');
    if (!toggleButton) return;

    const icon = toggleButton.querySelector('i');
    const text = toggleButton.querySelector('.toggle-text');
    if (!icon || !text) return;

    const currentMode = this.getCurrentMode();
    
    if (TreeViewState.isHierarchical) {
        // Currently showing hierarchical view
        if (currentMode === 'verilog') {
            icon.className = 'fa-solid fa-file-code';
            text.textContent = 'File Mode';
            toggleButton.title = 'Switch to Verilog File Mode tree';
        } else {
            icon.className = 'fa-solid fa-folder-tree';
            text.textContent = 'File Tree';
            toggleButton.title = 'Switch to Standard File Tree';
        }
        toggleButton.classList.add('active');
    } else {
        // Currently showing standard/file mode view
        icon.className = 'fa-solid fa-sitemap';
        text.textContent = 'Hierarchical';
        toggleButton.title = 'Switch to Hierarchical Module View';
        toggleButton.classList.remove('active');
    }
}
/**
 * Get current compilation mode
 */
getCurrentMode() {
    const verilogModeRadio = document.getElementById('Verilog Mode');
    const processorModeRadio = document.getElementById('Processor Mode');
    const projectModeRadio = document.getElementById('Project Mode');
    
    if (verilogModeRadio?.checked) return 'verilog';
    if (processorModeRadio?.checked) return 'processor';
    if (projectModeRadio?.checked) return 'project';
    
    return 'processor';
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

    async launchFractalVisualizerAsync(processorName, palette = 'grayscale') {
        try {
            const outputFilePath = await window.electronAPI.joinPath(
                this.projectPath, processorName, 'Simulation', 'output_0.txt'
            );

            const fancyFractalPath = await window.electronAPI.joinPath(
                this.componentsPath, 'Packages', 'FFPGA', 'fancyFractal.exe'
            );


            const executableExists = await window.electronAPI.pathExists(fancyFractalPath);
            if (!executableExists) {
                throw new Error(`Visualizador não encontrado em: ${fancyFractalPath}`);
            }

            const command = `"${fancyFractalPath}" "${outputFilePath}"`;

            await window.electronAPI.deleteFileOrDirectory(outputFilePath);

            this.terminalManager.appendToTerminal('tcmm', `Iniciando visualizador de fractal (${palette})...`);
            this.terminalManager.appendToTerminal('tcmm', `Comando: ${command}`);

            window.electronAPI.execCommand(command)
                .then(result => {
                    if (result.code === 0) {
                        this.terminalManager.appendToTerminal('tcmm', `Visualizador concluído com sucesso`);
                    } else {
                        this.terminalManager.appendToTerminal('tcmm', `Visualizador finalizou com código: ${result.code}`, 'warning');
                    }
                })
                .catch(error => {
                    this.terminalManager.appendToTerminal('tcmm', `Erro no visualizador: ${error.message}`, 'error');
                });

            return true;

        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', `Erro ao iniciar visualizador: ${error.message}`, 'error');
            console.error('Falha ao iniciar visualizador:', error);
            return false;
        }
    }

    async launchFractalVisualizersForProject(palette = 'fire') {
        if (!this.isProjectOriented) {
            const activeProcessor = this.config.processors.find(p => p.isActive === true);
            if (activeProcessor) {
                await this.launchFractalVisualizerAsync(activeProcessor.name, palette);
            }
        }
    }

    /**
 * Load File Mode configuration from projectOriented.json
 */
async loadFileModeConfig() {
    try {
        const fileModeConfigPath = await window.electronAPI.joinPath(this.projectPath, 'projectOriented.json');
        const fileModeExists = await window.electronAPI.fileExists(fileModeConfigPath);
        
        if (!fileModeExists) {
            throw new Error('projectOriented.json not found in project root');
        }
        
        const fileModeData = await window.electronAPI.readFile(fileModeConfigPath, { encoding: 'utf8' });
        this.fileModeConfig = JSON.parse(fileModeData);
        
        console.log("File mode config loaded:", this.fileModeConfig);
        return true;
    } catch (error) {
        console.error("Failed to load projectOriented.json:", error);
        throw error;
    }
}

/**
 * Icarus Verilog compilation for Verilog Mode (Project without Simulation)
 * Compiles all HDL files + synthesizable files from projectOriented.json
 */
async iverilogVerilogModeCompilation() {
    await this.terminalManager.clearTerminal('tveri');

    this.terminalManager.appendToTerminal('tveri', 'Starting Icarus Verilog compilation (Verilog Mode)...');
    
    statusUpdater.startCompilation('verilog');

    try {
        // Load projectOriented.json configuration
        await this.loadFileModeConfig();

        const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
            
        await window.electronAPI.createDirectory(tempPath);

        // Validate synthesizable files exist
        if (!this.fileModeConfig.synthesizableFiles || !Array.isArray(this.fileModeConfig.synthesizableFiles)) {
            throw new Error('No synthesizable files defined in projectOriented.json');
        }

        if (this.fileModeConfig.synthesizableFiles.length === 0) {
            throw new Error('synthesizableFiles array is empty. Please import at least one .v file in Project Settings.');
        }

        // Find top-level module
        const topLevelFile = this.fileModeConfig.synthesizableFiles.find(file => file.isTopLevel === true);
        if (!topLevelFile) {
            throw new Error('No top-level module marked in synthesizableFiles. Please set one file as top level (star icon).');
        }

        const topLevelModuleName = topLevelFile.name.replace(/\.v$/i, '');
        this.terminalManager.appendToTerminal('tveri', `Top-level module: ${topLevelModuleName}`);

        // Setup paths
        const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
        const iveriCompPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe'
        );
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');

        // Collect all HDL files from components/HDL
        const hdlFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
        const hdlFilesString = hdlFiles.map(f => `"${hdlPath}\\${f}"`).join(' ');

        // Collect all synthesizable files from projectOriented.json
        const fileModeFiles = this.fileModeConfig.synthesizableFiles
            .map(file => `"${file.path}"`)
            .join(' ');

        // Save all open files
        await TabManager.saveAllFiles();

        // Output file path
        const projectName = this.projectPath.split(/[\\/]/).pop();
        const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}_verilog.vvp`);

        // Get optional flags from projectOriented.json
        const flags = this.fileModeConfig.iverilogFlags || '';

        // Build iverilog command
        const cmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${topLevelModuleName} -o "${outputFilePath}" ${fileModeFiles} ${hdlFilesString}`;
        
        this.terminalManager.appendToTerminal('tveri', `Executing: ${cmd}`);

        const result = await window.electronAPI.execCommand(cmd);
        this.terminalManager.processExecutableOutput('tveri', result);

        if (result.code !== 0) {
            statusUpdater.compilationError('verilog', `Icarus Verilog failed with code ${result.code}`);
            throw new Error('Icarus Verilog compilation failed');
        }

        this.terminalManager.appendToTerminal('tveri', 'Verilog Mode compilation completed successfully', 'success');
        statusUpdater.compilationSuccess('verilog');

        // Generate hierarchy for Verilog Mode
        await this.generateVerilogModeHierarchy();
        
        if (this.hierarchyData) {
            TreeViewState.hierarchyData = this.hierarchyData;
            TreeViewState.enableToggle();
            this.hierarchyGenerated = true;
            await this.switchToHierarchicalView();
        }

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
        statusUpdater.compilationError('verilog', error.message);
        throw error;
    }
}

/**
 * Generate hierarchy for Verilog Mode using Yosys
 */
async generateVerilogModeHierarchy() {
    try {
        if (!this.fileModeConfig) {
            await this.loadFileModeConfig();
        }

        // Validate synthesizable files
        if (!this.fileModeConfig.synthesizableFiles || this.fileModeConfig.synthesizableFiles.length === 0) {
            throw new Error('No synthesizable files available for hierarchy generation');
        }

        const topLevelFile = this.fileModeConfig.synthesizableFiles.find(file => file.isTopLevel === true);
        if (!topLevelFile) {
            throw new Error('No top-level module defined in synthesizableFiles');
        }

        const topLevelModuleName = topLevelFile.name.replace(/\.v$/i, '');
        const yosysPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'
        );
        const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');

        this.terminalManager.appendToTerminal('tveri', 'Generating Verilog Mode hierarchy with Yosys...');

        // Build Yosys script with all synthesizable files
        const readVerilogCommands = this.fileModeConfig.synthesizableFiles
            .map(file => `read_verilog -sv "${file.path}"`)
            .join('\n');

        const yosysScript = `
${readVerilogCommands}
hierarchy -top ${topLevelModuleName}
proc
write_json "${tempBaseDir}\\verilog_mode_hierarchy.json"
`;

        const scriptPath = await window.electronAPI.joinPath(tempBaseDir, 'verilog_mode_hierarchy_gen.ys');
        await window.electronAPI.writeFile(scriptPath, yosysScript);

        const yosysCmd = `cd "${tempBaseDir}" && "${yosysPath}" -s "${scriptPath}"`;
        const result = await window.electronAPI.execCommand(yosysCmd);

        if (result.code !== 0) {
            throw new Error('Yosys hierarchy generation failed');
        }

        const jsonPath = await window.electronAPI.joinPath(tempBaseDir, 'verilog_mode_hierarchy.json');
        const hierarchyJson = JSON.parse(
            await window.electronAPI.readFile(jsonPath, { encoding: 'utf8' })
        );

        this.hierarchyData = this.parseYosysHierarchy(hierarchyJson, topLevelModuleName);
        this.terminalManager.appendToTerminal('tveri', 'Verilog Mode hierarchy generated successfully', 'success');
        
        TreeViewState.hierarchyData = this.hierarchyData;
        TreeViewState.enableToggle();
        
        return true;
    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', 
            `Verilog Mode hierarchy generation error: ${error.message}`, 'warning');
        return false;
    }
}

async compileAllProcessorsIndividually() {
    if (!this.projectConfig || !this.projectConfig.processors) {
        throw new Error('No processors defined in projectOriented.json');
    }

    this.terminalManager.appendToTerminal('tcmm', '--- Compiling All Processors (Processor Mode) ---', 'info');
    
    const processedTypes = new Set();

    for (const projectProcessor of this.projectConfig.processors) {
        checkCancellation();

        const processorType = projectProcessor.type;
        
        // Skip duplicates
        if (processedTypes.has(processorType)) {
            this.terminalManager.appendToTerminal('tcmm', 
                `Skipping duplicate processor type: ${processorType}`, 'info');
            continue;
        }

        processedTypes.add(processorType);

        // Find processor configuration
        const processorConfig = this.config.processors.find(p => p.name === processorType);
        if (!processorConfig) {
            this.terminalManager.appendToTerminal('tcmm', 
                `Warning: Processor configuration not found for ${processorType}`, 'warning');
            continue;
        }

        try {
            this.terminalManager.appendToTerminal('tcmm', 
                `Processing ${processorType}...`, 'info');

            // Ensure directories exist
            await this.ensureDirectories(processorType);

            // CMM Compilation
            switchTerminal('terminal-tcmm');
            await this.cmmCompilation(processorConfig);
            checkCancellation();

            // ASM Compilation (mode = 1 for project)
            switchTerminal('terminal-tasm');
            await this.asmCompilation(processorConfig, 1);
            checkCancellation();

            // CRITICAL: Compile processor Verilog to create temp directory and memory files
            switchTerminal('terminal-tveri');
            this.terminalManager.appendToTerminal('tveri', 
                `Compiling ${processorType} (creating temp directory)...`, 'info');
            await this.iverilogCompilationForProcessor(processorConfig);
            
            this.terminalManager.appendToTerminal('tcmm', 
                `Processor ${processorType} compiled successfully`, 'success');

        } catch (error) {
            this.terminalManager.appendToTerminal('tcmm', 
                `Error processing processor ${processorType}: ${error.message}`, 'error');
            throw error;
        }
    }

    this.terminalManager.appendToTerminal('tcmm', 
        '--- All Processors Compiled ---', 'success');
}

async iverilogCompilationForProcessor(processor) {
    const { name } = processor;
    
    this.terminalManager.appendToTerminal('tveri', 
        `Compiling ${name} in processor mode...`, 'info');

    try {
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
        const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Hardware');
        const iveriCompPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe'
        );

        // Create processor temp directory
        await window.electronAPI.mkdir(tempPath);

        const selectedCmmFile = await this.getSelectedCmmFile(processor);
        const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
        
        const tbPath = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}_tb.v`);
        const tbExists = await window.electronAPI.fileExists(tbPath);
        
        if (!tbExists) {
            throw new Error(`Testbench not found: ${tbPath}`);
        }

        const hdlFiles = [
            'addr_dec.v',
            'core.v',
            'instr_dec.v',
            'myFIFO.v',
            'processor.v',
            'ula.v'
        ];

        const hdlFilesString = hdlFiles
            .map(f => `"${hdlPath}\\${f}"`)
            .join(' ');

        const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
        const outputFile = await window.electronAPI.joinPath(tempPath, `${name}.vvp`);

        const cmd = `cd "${tempPath}" && "${iveriCompPath}" -o "${outputFile}" ${hdlFilesString} "${hardwareFile}" "${tbPath}"`;

        this.terminalManager.appendToTerminal('tveri', `Executing: ${cmd}`, 'info');

        const result = await window.electronAPI.execCommand(cmd);
        
        if (result.stdout) this.terminalManager.appendToTerminal('tveri', result.stdout);
        if (result.stderr) this.terminalManager.appendToTerminal('tveri', result.stderr);

        if (result.code !== 0) {
            throw new Error(`Processor ${name} compilation failed with code ${result.code}`);
        }

        this.terminalManager.appendToTerminal('tveri', 
            `Processor ${name} temp directory created at: ${tempPath}`, 'success');

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', 
            `Error compiling processor ${name}: ${error.message}`, 'error');
        throw error;
    }
}


async compileAll() {
    try {
        startCompilation();
        await this.loadConfig();

        if (this.isProjectOriented) {
            if (this.projectConfig && this.projectConfig.processors) {
                // STEP 1: Compile all processors individually to create temp directories
                await this.compileAllProcessorsIndividually();

                // STEP 2: Compile project (now memory files are available)
                switchTerminal('terminal-tveri');
                checkCancellation();
                await this.iverilogProjectCompilation();

                // STEP 3: Run GTKWave
                switchTerminal('terminal-twave');
                checkCancellation();
                await this.runProjectGtkWave();
            }
        } else {
            const activeProcessor = this.config.processors.find(p => p.isActive === true);
            if (!activeProcessor) {
                throw new Error("No active processor found. Please set one processor as active.");
            }

            const processor = activeProcessor;
            await this.ensureDirectories(processor.name);

            switchTerminal('terminal-tcmm');
            checkCancellation();
            await this.cmmCompilation(processor);

            checkCancellation();
            await this.asmCompilation(processor, 0);

            switchTerminal('terminal-tveri');
            checkCancellation();
            await this.iverilogCompilation(processor);

            switchTerminal('terminal-twave');
            checkCancellation();
            await this.runGtkWave(processor);
        }

        endCompilation();
        return true;
    } catch (error) {
        this.terminalManager.appendToTerminal('tcmm', 
            `Error in compilation process: ${error.message}`, 'error');
        console.error('Complete compilation failed:', error);
        endCompilation();
        return false;
    }
}


}

export { CompilationModule };
