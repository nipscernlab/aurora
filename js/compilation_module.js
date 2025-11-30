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

    /**
 * PRISM compilation for Processor Mode
 */
async prismProcessorCompilation(processor) {
    this.terminalManager.appendToTerminal('tveri', 'Starting PRISM synthesis (Processor Mode)...');
    
    try {
        const yosysPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'
        );
        const netlistsvgPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe'
        );
        const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', 'PRISM');
        const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
        const hardwarePath = await window.electronAPI.joinPath(this.projectPath, processor.name, 'Hardware');
        
        await window.electronAPI.mkdir(tempPath);
        
        const selectedCmmFile = await this.getSelectedCmmFile(processor);
        const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
        const hardwareFile = await window.electronAPI.joinPath(hardwarePath, `${cmmBaseName}.v`);
        
        await TabManager.saveAllFiles();
        
        const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
        const readVerilogCommands = verilogFiles.map(f => `read_verilog -sv "${hdlPath}\\${f}"`).join('\n');
        
        const yosysScript = `
${readVerilogCommands}
read_verilog -sv "${hardwareFile}"
hierarchy -top ${cmmBaseName}
proc
opt
flatten
opt
write_json "${tempPath}\\${cmmBaseName}_synth.json"
`;
        
        const scriptPath = await window.electronAPI.joinPath(tempPath, 'prism_synth.ys');
        await window.electronAPI.writeFile(scriptPath, yosysScript);
        
        this.terminalManager.appendToTerminal('tveri', 'Running Yosys synthesis...');
        const yosysCmd = `cd "${tempPath}" && "${yosysPath}" -s "${scriptPath}"`;
        const yosysResult = await window.electronAPI.execCommand(yosysCmd);
        
        this.terminalManager.processExecutableOutput('tveri', yosysResult);
        
        if (yosysResult.code !== 0) {
            throw new Error('Yosys synthesis failed');
        }
        
        this.terminalManager.appendToTerminal('tveri', 'Generating schematic with netlistsvg...');
        const jsonFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_synth.json`);
        const svgFile = await window.electronAPI.joinPath(tempPath, `${cmmBaseName}_schematic.svg`);
        
        const netlistsvgCmd = `"${netlistsvgPath}" "${jsonFile}" -o "${svgFile}"`;
        const svgResult = await window.electronAPI.execCommand(netlistsvgCmd);
        
        this.terminalManager.processExecutableOutput('tveri', svgResult);
        
        if (svgResult.code !== 0) {
            throw new Error('netlistsvg generation failed');
        }
        
        this.terminalManager.appendToTerminal('tveri', 
            `PRISM synthesis completed successfully. Output: ${svgFile}`, 'success');
        
        await window.electronAPI.openExternal(svgFile);
        
    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', 
            `PRISM compilation error: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * PRISM compilation for Project Mode
 */
async prismProjectCompilation() {
    this.terminalManager.appendToTerminal('tveri', 'Starting PRISM synthesis (Project Mode)...');
    
    try {
        if (!this.projectConfig) {
            throw new Error('Project configuration not loaded');
        }
        
        const topLevelFile = this.projectConfig.topLevelFile;
        if (!topLevelFile) {
            throw new Error('No top-level file specified in projectOriented.json');
        }
        
        const topLevelModuleName = topLevelFile.split(/[\\\\/]/).pop().replace(/\.v$/i, '');
        
        const yosysPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'
        );
        const netlistsvgPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe'
        );
        const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', 'PRISM');
        
        await window.electronAPI.mkdir(tempPath);
        await TabManager.saveAllFiles();
        
        const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
        const readVerilogCommands = synthesizableFiles
            .map(file => `read_verilog -sv "${file.path}"`)
            .join('\n');
        
        const yosysScript = `
${readVerilogCommands}
hierarchy -top ${topLevelModuleName}
proc
opt
flatten
opt
write_json "${tempPath}\\${topLevelModuleName}_synth.json"
`;
        
        const scriptPath = await window.electronAPI.joinPath(tempPath, 'prism_synth.ys');
        await window.electronAPI.writeFile(scriptPath, yosysScript);
        
        this.terminalManager.appendToTerminal('tveri', 'Running Yosys synthesis...');
        const yosysCmd = `cd "${tempPath}" && "${yosysPath}" -s "${scriptPath}"`;
        const yosysResult = await window.electronAPI.execCommand(yosysCmd);
        
        this.terminalManager.processExecutableOutput('tveri', yosysResult);
        
        if (yosysResult.code !== 0) {
            throw new Error('Yosys synthesis failed');
        }
        
        this.terminalManager.appendToTerminal('tveri', 'Generating schematic with netlistsvg...');
        const jsonFile = await window.electronAPI.joinPath(tempPath, `${topLevelModuleName}_synth.json`);
        const svgFile = await window.electronAPI.joinPath(tempPath, `${topLevelModuleName}_schematic.svg`);
        
        const netlistsvgCmd = `"${netlistsvgPath}" "${jsonFile}" -o "${svgFile}"`;
        const svgResult = await window.electronAPI.execCommand(netlistsvgCmd);
        
        this.terminalManager.processExecutableOutput('tveri', svgResult);
        
        if (svgResult.code !== 0) {
            throw new Error('netlistsvg generation failed');
        }
        
        this.terminalManager.appendToTerminal('tveri', 
            `PRISM synthesis completed successfully. Output: ${svgFile}`, 'success');
        
        await window.electronAPI.openExternal(svgFile);
        
    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', 
            `PRISM compilation error: ${error.message}`, 'error');
        throw error;
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
            const toggleButton = document.getElementById('toggle-ui');
            this.isProjectOriented = toggleButton && toggleButton.classList.contains('active');

            const projectInfo = await window.electronAPI.getCurrentProject();
            const currentProjectPath = projectInfo.projectPath || this.projectPath;

            if (!currentProjectPath) {
                throw new Error('No current project path available for loading configuration');
            }

            const configFilePath = await window.electronAPI.joinPath(currentProjectPath, 'processorConfig.json');
            const config = await window.electronAPI.loadConfigFromPath(configFilePath);
            this.config = config;
            console.log("Processor config loaded:", config);

            if (this.isProjectOriented) {
                const projectConfigPath = await window.electronAPI.joinPath(currentProjectPath, 'projectOriented.json');
                const projectConfigData = await window.electronAPI.readFile(projectConfigPath);
                this.projectConfig = JSON.parse(projectConfigData);
                console.log("Project config loaded:", this.projectConfig);
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

    async modifyTestbenchForSimulation(testbenchPath, tbModuleName, tempBaseDir, simuDelay = "200000") {
        try {
            const originalContent = await window.electronAPI.readFile(testbenchPath, {
                encoding: 'utf8'
            });
            const blockRegex = /(\s*integer\s+progress,\s+chrys;[\s\S]*?\$finish;\s*end)/im;
            const fixedTempBaseDir = tempBaseDir.replace(/\//g, '\\\\')
                .replace(/\\/g, '\\\\');
            const numericSimuDelay = parseFloat(simuDelay) || 200000.0;

            const newSimulationCode = `

integer progress, chrys;
initial begin
    $dumpfile("${tbModuleName}.vcd");
    $dumpvars(0, ${tbModuleName});
    progress = $fopen("${fixedTempBaseDir}\\\\progress.txt", "w");
    for (chrys = 10; chrys <= 100; chrys = chrys + 10) begin
        #${numericSimuDelay};
        $fdisplay(progress,"%0d",chrys);
        $fflush(progress);
    end
    $fclose(progress);
    $finish;
end`;

            const existingBlockMatch = originalContent.match(blockRegex);
            let modifiedContent = originalContent;
            let needsWrite = false;

            if (existingBlockMatch) {
                const existingBlock = existingBlockMatch[0];
                const delayRegex = /#\s*([\d.]+)/;
                const existingDelayMatch = existingBlock.match(delayRegex);
                let existingDelayValue = null;
                if (existingDelayMatch && existingDelayMatch[1]) {
                    existingDelayValue = parseFloat(existingDelayMatch[1]);
                }
                if (existingDelayValue !== numericSimuDelay) {
                    modifiedContent = originalContent.replace(blockRegex, newSimulationCode);
                    needsWrite = true;
                }
            } else {
                modifiedContent = originalContent.replace(/(\s*endmodule\s*)$/, `${newSimulationCode}\n$1`);
                needsWrite = true;
            }

            if (needsWrite) {
                await window.electronAPI.writeFile(testbenchPath, modifiedContent);
            }
        } catch (error) {
            throw new Error(`Failed to modify testbench: ${error.message}`);
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
        this.terminalManager.appendToTerminal('tcmm', `Starting C± compilation for ${name}...`);
        try {
            const selectedCmmFile = await this.getSelectedCmmFile(processor);
            const cmmBaseName = selectedCmmFile.replace(/\.cmm$/i, '');
            const macrosPath = await window.electronAPI.joinPath(this.componentsPath, 'Macros');
            const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', name);
            const cmmCompPath = await window.electronAPI.joinPath(this.componentsPath, 'bin', 'cmmcomp.exe');
            const projectPath = await window.electronAPI.joinPath(this.projectPath, name);
            const softwarePath = await window.electronAPI.joinPath(this.projectPath, name, 'Software');
            const asmPath = await window.electronAPI.joinPath(softwarePath, `${cmmBaseName}.asm`);

            await TabManager.saveAllFiles();
            statusUpdater.startCompilation('cmm');

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

    async iverilogProjectCompilation() {
        this.terminalManager.appendToTerminal('tveri', 'Starting Icarus Verilog verification for project...');
        statusUpdater.startCompilation('verilog');

        try {
            if (!this.projectConfig) {
                throw new Error("Project configuration not loaded");
            }

            const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
            const iveriCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe');
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');

            const testbenchFile = this.projectConfig.testbenchFile;
            if (!testbenchFile) {
                throw new Error("No testbench file specified");
            }

            const tbFileName = testbenchFile.split(/[\\\\/]/).pop();
            const tbModule = tbFileName.replace(/\.v$/i, '');

            const synthesizableFiles = this.projectConfig.synthesizableFiles || [];
            if (!synthesizableFiles.length) {
                throw new Error("No synthesizable files defined");
            }

            const synthesizableFilePaths = synthesizableFiles.map(f => `"${f.path}"`).join(' ');
            const verilogFiles = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v'];
            const verilogFilesString = verilogFiles.map(f => `"${hdlPath}\\${f}"`).join(' ');
            const flags = this.projectConfig.iverilogFlags || "";

            await TabManager.saveAllFiles();

            const projectName = this.projectPath.split(/[\\\\/]/).pop();
            const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}.vvp`);

            const cmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${flags} -s ${tbModule} -o "${outputFilePath}" ${synthesizableFilePaths} ${verilogFilesString} "${testbenchFile}"`;
            this.terminalManager.appendToTerminal('tveri', `Executing: ${cmd}`);

            const result = await window.electronAPI.execCommand(cmd);
            this.terminalManager.processExecutableOutput('tveri', result);

            if (result.code !== 0) {
                statusUpdater.compilationError('verilog', `Icarus Verilog failed with code ${result.code}`);
                throw new Error(`Icarus Verilog verification failed`);
            }

            const procList = this.projectConfig.processors || [];
            for (const proc of procList) {
                const tempProcDir = await window.electronAPI.joinPath(tempBaseDir, proc.type);
                const tbFile = await window.electronAPI.joinPath(tempProcDir, `${proc.type}_tb.v`);
                const destDir = await window.electronAPI.joinPath(this.projectPath, proc.type, 'Simulation');
                const destFile = await window.electronAPI.joinPath(destDir, `${proc.type}_tb.v`);

                try {
                    const tbExists = await window.electronAPI.fileExists(tbFile);
                    if (tbExists) {
                        await window.electronAPI.copyFile(tbFile, destFile);
                        this.terminalManager.appendToTerminal('tveri',
                            `Copied testbench for ${proc.type} to Simulation folder`);
                        await this.generateHierarchyAfterCompilation(proc);
                    }
                } catch (copyError) {
                    this.terminalManager.appendToTerminal('tveri',
                        `Warning: Could not copy testbench for ${proc.type}: ${copyError.message}`, 'warning');
                }
            }

            this.terminalManager.appendToTerminal('tveri', 'Sucesso: project verification completed', 'success');
            statusUpdater.compilationSuccess('verilog');

            await this.generateProjectHierarchy();
            await this.switchToHierarchicalView();

        } catch (error) {
            this.terminalManager.appendToTerminal('tveri', `Error: ${error.message}`, 'error');
            statusUpdater.compilationError('verilog', error.message);
            throw error;
        }
    }


    setupHierarchyToggle() {
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
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
        if (this.isProjectOriented) {
            return this.iverilogProjectCompilation();
        }

        const {
            name
        } = processor;
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
        if (this.isProjectOriented) {
            checkCancellation();
            return this.runProjectGtkWave();
        }

        const {
            name
        } = processor;
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

    async runProjectGtkWave() {
        this.terminalManager.appendToTerminal('twave', 'Starting GTKWave for project...');
        statusUpdater.startCompilation('wave');

        const isParallelMode = this.getCompilationMode();
        let gtkwaveOutputHandler = null;

        try {
            if (!this.projectConfig) throw new Error("Project configuration not loaded");

            const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');
            const scriptsPath = await window.electronAPI.joinPath(this.componentsPath, 'Scripts');
            const iveriCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'iverilog.exe');
            const vvpCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'bin', 'vvp.exe');
            const gtkwCompPath = await window.electronAPI.joinPath(this.componentsPath, 'Packages', 'iverilog', 'gtkwave', 'bin', 'gtkwave.exe');
            const hdlPath = await window.electronAPI.joinPath(this.componentsPath, 'HDL');
            const binPath = await window.electronAPI.joinPath(this.componentsPath, 'bin');

            const testbenchFile = this.projectConfig.testbenchFile;
            if (!testbenchFile) throw new Error("No testbench file specified");

            const testbenchFileName = testbenchFile.split(/[\\\\/]/).pop();
            const tbModule = testbenchFileName.replace(/\.v$/i, '');

            const testbenchInTemp = await window.electronAPI.joinPath(tempBaseDir, testbenchFileName);
            await window.electronAPI.copyFile(testbenchFile, testbenchInTemp);
            this.terminalManager.appendToTerminal('twave', `Copied testbench to temp directory: ${testbenchFileName}`);

            const simuDelay = this.getSimulationDelay();

            await this.modifyTestbenchForSimulation(
                testbenchInTemp,
                tbModule,
                tempBaseDir,
                simuDelay
            );

            const synthesizableFilePaths = (this.projectConfig.synthesizableFiles || [])
                .map(file => `"${file.path}"`)
                .join(' ');
            const verilogFilesString = ['addr_dec.v', 'core.v', 'instr_dec.v', 'myFIFO.v', 'processor.v', 'ula.v']
                .map(f => `"${hdlPath}\\${f}"`)
                .join(' ');

            await TabManager.saveAllFiles();
            const projectName = this.projectPath.split(/[\\\\/]/).pop();
            const outputFilePath = await window.electronAPI.joinPath(tempBaseDir, `${projectName}.vvp`);

            const iverilogCmd = `cd "${tempBaseDir}" && "${iveriCompPath}" ${this.projectConfig.iverilogFlags || ""} -s ${tbModule} -o "${outputFilePath}" ${synthesizableFilePaths} ${verilogFilesString} "${testbenchInTemp}"`;

            const iverilogResult = await window.electronAPI.execCommand(iverilogCmd);
            this.terminalManager.processExecutableOutput('twave', iverilogResult);

            if (iverilogResult.code !== 0) {
                throw new Error('Icarus Verilog compilation failed');
            }

            this.terminalManager.appendToTerminal('twave', 'Copying necessary files for simulation...');
            const topLevelPath = await window.electronAPI.joinPath(this.projectPath, 'TopLevel');

            this.terminalManager.appendToTerminal('twave', `Copying input data from: ${topLevelPath}`);
            try {
                const topLevelFiles = await window.electronAPI.readDir(topLevelPath);

                const dataFiles = topLevelFiles.filter(file =>
                    !file.toLowerCase().endsWith('.v') && !file.toLowerCase().endsWith('.vh')
                );

                if (dataFiles.length === 0) {
                    this.terminalManager.appendToTerminal('twave',
                        'No data files (non-Verilog) found in TopLevel to copy.', 'info');
                } else {
                    for (const dataFile of dataFiles) {
                        try {
                            const srcPath = await window.electronAPI.joinPath(topLevelPath, dataFile);
                            const destPath = await window.electronAPI.joinPath(tempBaseDir, dataFile);
                            await window.electronAPI.copyFile(srcPath, destPath);
                            this.terminalManager.appendToTerminal('twave', `Copied data file: ${dataFile}`, 'success');
                        } catch (copyError) {
                            this.terminalManager.appendToTerminal('twave',
                                `Warning: Could not copy ${dataFile}: ${copyError.message}`, 'warning');
                        }
                    }
                }
            } catch (readError) {
                this.terminalManager.appendToTerminal('twave',
                    `Warning: Could not read TopLevel directory: ${readError.message}`, 'warning');
            }

            try {
                const topLevelFiles = await window.electronAPI.readDir(topLevelPath);
                const txtFiles = topLevelFiles.filter(file => file.toLowerCase().endsWith('.txt'));

                for (const txtFile of txtFiles) {
                    try {
                        const srcPath = await window.electronAPI.joinPath(topLevelPath, txtFile);
                        const destPath = await window.electronAPI.joinPath(tempBaseDir, txtFile);
                        await window.electronAPI.copyFile(srcPath, destPath);
                        this.terminalManager.appendToTerminal('twave', `Copied ${txtFile} from TopLevel`);
                    } catch (error) {
                        this.terminalManager.appendToTerminal('twave',
                            `Warning: Could not copy ${txtFile}: ${error.message}`, 'warning');
                    }
                }
            } catch (error) {
                this.terminalManager.appendToTerminal('twave',
                    `Warning: Could not read TopLevel directory: ${error.message}`, 'warning');
            }

            const procList = this.projectConfig.processors || [];
            for (const proc of procList) {
                try {
                    const instMifSrc = await window.electronAPI.joinPath(
                        this.projectPath, proc.type, 'Hardware', `${proc.type}_inst.mif`
                    );
                    const instMifDest = await window.electronAPI.joinPath(tempBaseDir, `${proc.type}_inst.mif`);
                    await window.electronAPI.copyFile(instMifSrc, instMifDest);

                    const dataMifSrc = await window.electronAPI.joinPath(
                        this.projectPath, proc.type, 'Hardware', `${proc.type}_data.mif`
                    );
                    const dataMifDest = await window.electronAPI.joinPath(tempBaseDir, `${proc.type}_data.mif`);
                    await window.electronAPI.copyFile(dataMifSrc, dataMifDest);

                    const pcMemSrc = await window.electronAPI.joinPath(
                        tempBaseDir, proc.type, `pc_${proc.type}_mem.txt`
                    );
                    const pcMemDest = await window.electronAPI.joinPath(tempBaseDir, `pc_${proc.type}_mem.txt`);

                    if (await window.electronAPI.fileExists(pcMemSrc)) {
                        await window.electronAPI.copyFile(pcMemSrc, pcMemDest);
                        this.terminalManager.appendToTerminal('twave', `Copied pc_${proc.type}_mem.txt`);
                    }
                } catch (error) {
                    this.terminalManager.appendToTerminal('twave',
                        `Warning: Error copying files for ${proc.type}: ${error.message}`, 'warning');
                }
            }

            const instances = procList.map(p => p.instance).join(' ');
            const processors = procList.map(p => p.type).join(' ');
            const tclContent = `${instances}\n${processors}\n${tempBaseDir}\n${binPath}\n${scriptsPath}\n`;
            await window.electronAPI.writeFile(
                await window.electronAPI.joinPath(tempBaseDir, 'tcl_infos.txt'),
                tclContent
            );

            await window.electronAPI.copyFile(
                await window.electronAPI.joinPath(scriptsPath, 'fix.vcd'),
                await window.electronAPI.joinPath(tempBaseDir, 'fix.vcd')
            );

            const vcdPath = await window.electronAPI.joinPath(tempBaseDir, `${tbModule}.vcd`);
            await window.electronAPI.deleteFileOrDirectory(vcdPath);

            const vvpCmd = `"${vvpCompPath}" "${projectName}.vvp"`;

            const gtkwaveFile = this.projectConfig.gtkwaveFile;
            let gtkwCmd;
            if (gtkwaveFile && gtkwaveFile !== "Standard") {
                const posScript = await window.electronAPI.joinPath(scriptsPath, 'pos_gtkw.tcl');
                gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${gtkwaveFile}" --script=${posScript}`;
            } else {
                const initScript = await window.electronAPI.joinPath(scriptsPath, 'gtk_proj_init.tcl');
                gtkwCmd = `"${gtkwCompPath}" --rcvar "hide_sst on" --fastload --dark "${vcdPath}" --script=${initScript}`;
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
            await showVVPProgress(projectName);

            const simulationMethod = isParallelMode ? 'launchParallelSimulation' : 'launchSerialSimulation';
            this.terminalManager.appendToTerminal('twave',
                `Starting ${isParallelMode ? 'parallel' : 'serial'} simulation...`, 'info');

            const result = await window.electronAPI[simulationMethod]({
                vvpCmd: vvpCmd,
                gtkwCmd: gtkwCmd,
                vcdPath: vcdPath,
                workingDir: tempBaseDir
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
            const toggleButton = document.getElementById('hierarchy-tree-toggle');
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
    const toggleButton = document.getElementById('hierarchy-tree-toggle');
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
        const toggleButton = document.getElementById('hierarchy-tree-toggle');
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
 * Load projectOriented.json configuration
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
 * Icarus Verilog compilation for Verilog Mode
 * Compiles all HDL files + files from projectOriented.json
 */
async iverilogVerilogModeCompilation() {
    this.terminalManager.appendToTerminal('tveri', 'Starting Icarus Verilog compilation (Verilog Mode)...');
    statusUpdater.startCompilation('verilog');

    try {
        // Load projectOriented.json configuration
        await this.loadFileModeConfig();

        if (!this.fileModeConfig || !this.fileModeConfig.files || this.fileModeConfig.files.length === 0) {
            throw new Error('No files defined in projectOriented.json');
        }

        // Find top-level module
        const topLevelFile = this.fileModeConfig.files.find(file => file.isTopLevel === true);
        if (!topLevelFile) {
            throw new Error('No top-level module marked in projectOriented.json (isTopLevel: true)');
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

        // Collect all files from projectOriented.json
        const fileModeFiles = this.fileModeConfig.files
            .map(file => `"${file.path}"`)
            .join(' ');

        // Save all open files
        await TabManager.saveAllFiles();

        // Output file path
        const projectName = this.projectPath.split(/[\\\\/]/).pop();
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
    this.enableHierarchyToggle(); // ✅ Enable toggle
    this.hierarchyGenerated = true;
    await this.switchToHierarchicalView();
}
        await this.switchToHierarchicalView();

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

        const topLevelFile = this.fileModeConfig.files.find(file => file.isTopLevel === true);
        if (!topLevelFile) {
            throw new Error('No top-level module defined in projectOriented.json');
        }

        const topLevelModuleName = topLevelFile.name.replace(/\.v$/i, '');
        const yosysPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'
        );
        const tempBaseDir = await window.electronAPI.joinPath(this.componentsPath, 'Temp');

        this.terminalManager.appendToTerminal('tveri', 'Generating Verilog Mode hierarchy with Yosys...');

        // Build Yosys script with all files
        const readVerilogCommands = this.fileModeConfig.files
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


/**
 * PRISM synthesis for Verilog Mode
 * Generates schematic using Yosys + netlistsvg
 */
async prismVerilogModeCompilation() {
    this.terminalManager.appendToTerminal('tveri', 'Starting PRISM synthesis (Verilog Mode)...');
    
    try {
        // Load projectOriented.json configuration
        await this.loadFileModeConfig();

        if (!this.fileModeConfig || !this.fileModeConfig.files || this.fileModeConfig.files.length === 0) {
            throw new Error('No files defined in projectOriented.json');
        }

        // Find top-level module
        const topLevelFile = this.fileModeConfig.files.find(file => file.isTopLevel === true);
        if (!topLevelFile) {
            throw new Error('No top-level module marked in projectOriented.json');
        }

        const topLevelModuleName = topLevelFile.name.replace(/\.v$/i, '');
        
        // Setup paths
        const yosysPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'yosys', 'yosys.exe'
        );
        const netlistsvgPath = await window.electronAPI.joinPath(
            this.componentsPath, 'Packages', 'PRISM', 'netlistsvg', 'netlistsvg.exe'
        );
        const tempPath = await window.electronAPI.joinPath(this.componentsPath, 'Temp', 'PRISM');
        
        // Ensure PRISM temp directory exists
        await window.electronAPI.mkdir(tempPath);

        // Save all open files
        await TabManager.saveAllFiles();

        // Build Yosys synthesis script
        const readVerilogCommands = this.fileModeConfig.files
            .map(file => `read_verilog -sv "${file.path}"`)
            .join('\n');

        const yosysScript = `
${readVerilogCommands}
hierarchy -top ${topLevelModuleName}
proc
opt
flatten
opt
write_json "${tempPath}\\${topLevelModuleName}_synth.json"
`;

        const scriptPath = await window.electronAPI.joinPath(tempPath, 'prism_synth.ys');
        await window.electronAPI.writeFile(scriptPath, yosysScript);

        // Run Yosys synthesis
        this.terminalManager.appendToTerminal('tveri', 'Running Yosys synthesis...');
        const yosysCmd = `cd "${tempPath}" && "${yosysPath}" -s "${scriptPath}"`;
        const yosysResult = await window.electronAPI.execCommand(yosysCmd);
        
        this.terminalManager.processExecutableOutput('tveri', yosysResult);

        if (yosysResult.code !== 0) {
            throw new Error('Yosys synthesis failed');
        }

        // Run netlistsvg
        this.terminalManager.appendToTerminal('tveri', 'Generating schematic with netlistsvg...');
        const jsonFile = await window.electronAPI.joinPath(tempPath, `${topLevelModuleName}_synth.json`);
        const svgFile = await window.electronAPI.joinPath(tempPath, `${topLevelModuleName}_schematic.svg`);
        
        const netlistsvgCmd = `"${netlistsvgPath}" "${jsonFile}" -o "${svgFile}"`;
        const svgResult = await window.electronAPI.execCommand(netlistsvgCmd);
        
        this.terminalManager.processExecutableOutput('tveri', svgResult);

        if (svgResult.code !== 0) {
            throw new Error('netlistsvg generation failed');
        }

        // Open the generated SVG
        this.terminalManager.appendToTerminal('tveri', 
            `PRISM synthesis completed successfully. Output: ${svgFile}`, 'success');
        
        // Optionally open the SVG file
        await window.electronAPI.openExternal(svgFile);

    } catch (error) {
        this.terminalManager.appendToTerminal('tveri', 
            `PRISM compilation error: ${error.message}`, 'error');
        throw error;
    }
}

    async compileAll() {
        try {
            startCompilation();
            await this.loadConfig();

            if (this.isProjectOriented) {
                if (this.projectConfig && this.projectConfig.processors) {
                    const processedTypes = new Set();

                    switchTerminal('terminal-tcmm');

                    for (const processor of this.projectConfig.processors) {
                        checkCancellation();

                        if (processedTypes.has(processor.type)) {
                            this.terminalManager.appendToTerminal('tcmm', `Skipping duplicate processor type: ${processor.type}`);
                            continue;
                        }

                        processedTypes.add(processor.type);

                        try {
                            const processorObj = {
                                name: processor.type,
                                type: processor.type,
                                instance: processor.instance
                            };

                            checkCancellation();
                            this.terminalManager.appendToTerminal('tcmm', `Processing ${processor.type}...`);
                            await this.ensureDirectories(processor.type);

                            await this.cmmCompilation(processorObj);
                            checkCancellation();

                            await this.asmCompilation(processor, 1);
                        } catch (error) {
                            this.terminalManager.appendToTerminal('tcmm', `Error processing processor ${processor.type}: ${error.message}`, 'error');
                        }
                    }
                }

                switchTerminal('terminal-tveri');
                checkCancellation();
                await this.iverilogProjectCompilation();

                switchTerminal('terminal-twave');
                checkCancellation();
                await this.runProjectGtkWave();

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
            this.terminalManager.appendToTerminal('tcmm', `Error in compilation process: ${error.message}`, 'error');
            console.error('Complete compilation failed:', error);
            endCompilation();
            return false;
        }
    }

}

export { CompilationModule };
