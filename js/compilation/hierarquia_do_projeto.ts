/**
 * hierarquia_do_projeto.ts: a hierarquia de modulos do projeto, montada pelo
 * Yosys depois da checagem de sintaxe do botao de Verilog.
 *
 * Saiu do compilation_module.js. Escreve um script `.ys` na Temp do projeto,
 * roda o Yosys, le o `write_json` e entrega a arvore (hierarchy_parser.ts) a
 * quem chamou. Depois, de cortesia, escreve no terminal o resumo do design
 * (verilog_stats.ts). Nada aqui para a compilacao: toda falha vira um aviso no
 * TVERI e `false`, porque a sintaxe ja passou e a hierarquia e so a vista.
 */

import { electronAPI } from '../app/electron_api.js';
import { buildYosysHierarchySpec } from './builders/index.js';
import { moduleStemFromPath } from './compilation_helpers.js';
import { parseYosysHierarchy, type NoDaHierarquia } from './hierarchy_parser.js';
import type { TerminalManager } from './processor_compiler.js';
import { runSpec } from './spec_runner.js';
import { resumirHierarquiaYosys } from './verilog_stats.js';
import { projectTempDir } from '../project/project_temp.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** O que a geracao le da instancia (CompilationModule._instanceDeps()). */
export interface DepsDaHierarquia {
    projectPath: string;
    componentsPath: string;
    terminalManager: Pick<TerminalManager, 'appendToTerminal'>;
    projectConfig?: {
        topLevelFile?: string;
        synthesizableFiles?: { path?: string }[];
    } | null;
}

/**
 * As linhas `read_verilog` da biblioteca SAPHO (components/HDL).
 *
 * Ela tem os modulos que o design do usuario instancia sem listar no `.spf`
 * (processor, core, ula, myFIFO, addr_dec, instr_dec...). Sem le-los, o Yosys
 * faz blackbox automatico mas nao cria entrada em `modules`, o parser os trata
 * como primitivos e eles somem da arvore (`hierarchy -libdir` existe na
 * documentacao mas nao funciona na versao empacotada). O `hierarchy -top`
 * descarta depois o que nao e alcancado, entao ler a pasta inteira nao polui o
 * JSON. Pasta que nao se deixa listar vira aviso e string vazia.
 */
async function lerBibliotecaHdl(deps: DepsDaHierarquia): Promise<string> {
    const hdlPath = await electronAPI.joinPath(deps.componentsPath, 'HDL');
    try {
        const hdlEntries: unknown = await electronAPI.listFilesInDirectory(hdlPath);
        if (!Array.isArray(hdlEntries)) return '';
        const hdlVerilogPaths = await Promise.all(
            hdlEntries
                .filter((n): n is string => typeof n === 'string' && n.endsWith('.v') && !n.includes('_tb'))
                .map((n) => electronAPI.joinPath(hdlPath, n)),
        );
        return hdlVerilogPaths.map((p) => `read_verilog -sv "${p}"`).join('\n');
    } catch (_e) {
        deps.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hdlListWarn', { path: hdlPath }), 'warning');
        return '';
    }
}

/**
 * O que a elaboracao do Yosys encontrou, lido do mesmo JSON que montou a
 * arvore: modulos alcancados a partir do topo, instancias, portas do topo e
 * celulas por familia. Numero da compilacao, nao de leitura de texto.
 */
function resumirNoTerminal(deps: DepsDaHierarquia, hierarchyJson: unknown, designTopModule: string): void {
    const r = resumirHierarquiaYosys(hierarchyJson, designTopModule);
    if (!r.encontrouTop) return;
    const familias = Object.entries(r.families)
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${n} ${tr(`terminal.veri.families.${f}`)}`)
        .join(', ');
    deps.terminalManager.appendToTerminal('tveri', tr('terminal.veri.designStats', {
        top: r.top,
        modules: r.modules,
        moduleList: r.moduleNames.join(', '),
        instances: r.instances,
        ports: r.topPorts.total,
        inputs: r.topPorts.inputs,
        outputs: r.topPorts.outputs,
        cells: r.cells,
        families: familias || '-',
    }), 'tips');
}

/**
 * Gera a hierarquia e a passa para `entregar`, antes da mensagem de sucesso.
 *
 * `entregar` recebe null quando o proprio topo nao elaborou como modulo do
 * projeto; isso ainda conta como sucesso, como sempre contou.
 *
 * @returns true quando a arvore foi entregue; false quando algo faltou e o
 *          aviso ja esta no terminal.
 */
export async function gerarHierarquiaDoProjeto(
    deps: DepsDaHierarquia,
    entregar: (arvore: NoDaHierarquia | null) => void,
): Promise<boolean> {
    try {
        if (!deps.projectConfig) throw new Error('Project configuration not loaded');

        const topLevelFilePath = deps.projectConfig.topLevelFile;
        if (!topLevelFilePath) throw new Error("'topLevelFile' not found in .spf");

        const designTopModule = moduleStemFromPath(topLevelFilePath);
        const yosysPath = await electronAPI.joinPath(deps.componentsPath, 'Packages', 'msys', 'mingw64', 'bin', 'yosys.exe');
        const tempBaseDir = await projectTempDir(deps.projectPath);
        const hdlReadCmds = await lerBibliotecaHdl(deps);

        deps.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchyGen'));

        const synthesizableFiles = deps.projectConfig.synthesizableFiles || [];
        const yosysScript = `
                ${hdlReadCmds}
                ${synthesizableFiles.map((file) => `read_verilog -sv "${file.path}"`).join('\n')}
                hierarchy -top ${designTopModule}
                proc
                write_json "${tempBaseDir}\\project_hierarchy.json"
            `;

        const scriptPath = await electronAPI.joinPath(tempBaseDir, 'project_hierarchy_gen.ys');
        await electronAPI.writeFile(scriptPath, yosysScript);

        const hierSpec = buildYosysHierarchySpec({ yosysPath, scriptPath, cwd: tempBaseDir });
        const result = await runSpec(hierSpec, { consumeEphemeral: true });
        if (result.code !== 0) throw new Error(tr('error.compilation.yosysProjectFailed'));

        const jsonPath = await electronAPI.joinPath(tempBaseDir, 'project_hierarchy.json');
        const hierarchyJson = JSON.parse(await electronAPI.readFile(jsonPath, { encoding: 'utf8' }));

        entregar(parseYosysHierarchy(hierarchyJson, designTopModule));
        deps.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchySuccess'), 'success');

        try {
            resumirNoTerminal(deps, hierarchyJson, designTopModule);
        } catch (_e) { /* resumo de cortesia; a hierarquia ja esta na arvore */ }
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.terminalManager.appendToTerminal('tveri', tr('terminal.veri.hierarchyError', { message }), 'warning');
        return false;
    }
}
