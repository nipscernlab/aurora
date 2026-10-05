"use strict";
/**
 * Project lifecycle (open/close/create) e processor CRUD (main process).
 *
 * Per-project config: o .spf e a fonte canonica unica. Este modulo
 * cuida do lifecycle (open/close/create-project, create/delete-
 * processor) e reescreve o .spf nesses eventos. Mudancas de tree/
 * picker (synth files, top, testbench top) vivem no renderer via
 * SpfStore.update.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectFile = void 0;
exports.register = register;
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_os_1 = __importDefault(require("node:os"));
const electron_1 = require("electron");
const electron_log_1 = __importDefault(require("electron-log"));
const state_js_1 = __importDefault(require("../state.js"));
// Leitura tolerante do .spf e reescrita de caminhos no rename. Extraidas daqui
// em 08/08/2026 para ficarem testaveis: sao puras, mas este modulo carrega o
// Electron no topo e nenhum teste as alcancava. Ver main/ipc/project_paths.js.
// remapRootPath nao entra aqui: quem o usa e o deepRemapPaths, que foi junto.
const project_paths_js_1 = require("./project_paths.js");
const files_ops_js_1 = require("./files_ops.js");
const project_temp_js_1 = require("../project_temp.js");
const main_windows_js_1 = __importDefault(require("../main_windows.js"));
const project_trash_js_1 = require("./project_trash.js");
const processor_defaults_js_1 = require("../../js/project/processor_defaults.js");
const processor_header_js_1 = require("../../js/compilation/processor_header.js");
const processor_source_js_1 = require("../../js/compilation/processor_source.js");
const spf_parse_js_1 = require("../../js/project/spf_parse.js");
const processor_sim_config_js_1 = require("../../js/project/processor_sim_config.js");
const processor_rename_js_1 = require("./processor_rename.js");
const node_module_1 = require("node:module");
const requireTarde = (0, node_module_1.createRequire)(__filename);
// ---- ProjectFile schema ----
/**
 * A versao do aplicativo, ou uma reserva fora do Electron.
 *
 * Mesmo motivo da reserva em main/paths.js: este e o unico gerador de `.spf`
 * do projeto, e amarra-lo ao `app` o tornava impossivel de exercitar em teste,
 * ou de reusar num caminho que rode antes de o app existir. A versao entra no
 * `metadata`, que e informativo; nenhuma decisao e tomada a partir dela.
 */
function versaoDoApp() {
    try {
        if (electron_1.app && typeof electron_1.app.getVersion === 'function')
            return electron_1.app.getVersion();
    }
    catch (_) { /* fora do Electron */ }
    return '0.0.0';
}
class ProjectFile {
    metadata;
    structure;
    constructor(projectPath) {
        this.metadata = {
            projectName: node_path_1.default.basename(projectPath),
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            computerName: process.env.COMPUTERNAME || node_os_1.default.hostname(),
            appVersion: versaoDoApp(),
            projectPath,
        };
        this.structure = {
            basePath: projectPath,
            processors: [],
            folders: [],
            topLevelFile: '',
            testbenchFile: '',
            synthesizableFiles: [],
            testbenchFiles: [],
        };
    }
    toJSON() {
        return {
            metadata: this.metadata,
            structure: this.structure,
        };
    }
}
exports.ProjectFile = ProjectFile;
/**
 * Close every chokidar watcher (directory + per-file) rooted inside
 * `rootDir` so the OS doesn't keep a handle on the folder we're about to
 * rename. Without this, a directory rename fails with EPERM/EBUSY on
 * Windows. The renderer re-establishes its watchers when it reopens the
 * project at the new path.
 */
async function releaseWatchersUnder(rootDir) {
    const sep = node_path_1.default.sep.toLowerCase();
    const r = rootDir.replace(/\//g, node_path_1.default.sep).toLowerCase();
    const under = (p) => {
        const n = String(p || '').replace(/\//g, node_path_1.default.sep).toLowerCase();
        return n === r || n.startsWith(r + sep);
    };
    // chokidar's close() can hang on Windows while the watched tree is mid-change;
    // if it wedges, a rename would stall until the IPC's tool timeout (the
    // "renomeação excedeu o tempo limite" symptom). Bound each close so handle
    // release is best-effort but never blocks the rename, moveWithRetry below
    // absorbs a lock that wasn't quite released in time.
    const closeBounded = (watcher) => Promise.race([
        Promise.resolve().then(() => watcher.close()).catch(() => { }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
    // Close ALL matching watchers concurrently. Awaiting them one-at-a-time
    // serialized N watchers into N×1.5s of wedge time, on a project with many
    // files that alone overran the tool timeout, so the rename only "finished"
    // around the 120s mark and its success reply lost the race to the timer
    // (the "spins forever / false timeout" symptom). Firing them together
    // collapses the whole release to ~one 1.5s bound. Each map entry is deleted
    // only after its own close settles, so the maps stay consistent.
    const jobs = [];
    for (const [dirPath, info] of [...state_js_1.default.activeDirectoryWatchers.entries()]) {
        if (under(dirPath)) {
            jobs.push(closeBounded(info.watcher).then(() => {
                state_js_1.default.activeDirectoryWatchers.delete(dirPath);
                state_js_1.default.directoryStatsCache.delete(dirPath);
            }));
        }
    }
    for (const [filePath, info] of [...state_js_1.default.activeWatchers.entries()]) {
        if (under(info.filePath || filePath)) {
            jobs.push(closeBounded(info.watcher).then(() => {
                state_js_1.default.activeWatchers.delete(filePath);
            }));
        }
    }
    await Promise.all(jobs);
}
/** fse.move with a few quick retries, Windows AV/indexer can briefly lock. */
async function moveWithRetry(from, to, options = {}) {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await fs_extra_1.default.move(from, to, options);
            return;
        }
        catch (err) {
            lastErr = err;
            const ec = err;
            if (ec && (ec.code === 'EPERM' || ec.code === 'EBUSY' || ec.code === 'ENOTEMPTY')) {
                await new Promise((resolve) => setTimeout(resolve, 120));
                continue;
            }
            throw err;
        }
    }
    throw lastErr;
}
/**
 * Grava o .spf inteiro de forma atomica: escreve num .tmp ao lado e renomeia
 * por cima. Uma queda no meio do writeFile deixava JSON truncado, que o
 * parseSpfTolerant nao recupera, e o projeto nao reabria. O rename e atomico
 * no NTFS; se falhar (antivirus segurando o arquivo), cai para a escrita
 * direta, que e o comportamento antigo, e o .tmp e recolhido.
 */
async function escreverSpf(spfPath, dados) {
    // A RAIZ GRAVADA E A DE AGORA, sempre.
    //
    // `metadata.projectPath` e `structure.basePath` apontam para a pasta do
    // proprio projeto. Eram gravados como estavam em memoria, e a leitura ja os
    // relocalizava ao abrir (`deepRemapPaths`, mais abaixo), entao o arquivo
    // ficava em disco afirmando uma raiz que podia ja nao ser a dele: o projeto
    // funcionava e o arquivo mentia. Qualquer leitor que nao seja a AURORA, um
    // script, um diff, uma pessoa abrindo o JSON, acreditava na mentira.
    //
    // Derivada do `spfPath`, que e o unico dado aqui que nao pode estar errado:
    // e o caminho onde este arquivo esta sendo gravado neste instante.
    //
    // So sobrescreve campo que JA existe: um .spf sem `metadata` nao ganha um
    // aqui, porque inventar estrutura na hora de gravar e como um escritor
    // atomico perde a previsibilidade.
    const raizDeAgora = node_path_1.default.dirname(spfPath);
    if (dados && typeof dados === 'object') {
        if (dados.metadata && typeof dados.metadata === 'object') {
            dados.metadata.projectPath = raizDeAgora;
        }
        if (dados.structure && typeof dados.structure === 'object') {
            dados.structure.basePath = raizDeAgora;
        }
    }
    const json = JSON.stringify(dados, null, 2);
    const tmp = `${spfPath}.tmp`;
    try {
        await fs_extra_1.default.writeFile(tmp, json, 'utf8');
        await fs_extra_1.default.rename(tmp, spfPath);
    }
    catch (e) {
        electron_log_1.default.warn('[spf] escrita atomica falhou, gravando direto:', e instanceof Error ? e.message : e);
        try {
            await fs_extra_1.default.remove(tmp);
        }
        catch { /* melhor esforco */ }
        await fs_extra_1.default.writeFile(spfPath, json, 'utf8');
    }
}
function register() {
    // ---- project lifecycle ----
    electron_1.ipcMain.handle('project:getInfo', async (_event, spfPath) => {
        if (!spfPath)
            throw new Error('No project file path provided');
        const stat = await fs_extra_1.default.stat(spfPath).catch(() => null);
        if (!stat)
            throw new Error(`Project file not found at: ${spfPath}`);
        let target = spfPath;
        // Tolerate a project FOLDER being passed instead of its .spf, resolve to
        // the .spf inside it. (The old code passed a directory straight to readJSON
        // and crashed the handler with EISDIR.)
        if (stat.isDirectory()) {
            const entries = await fs_extra_1.default.readdir(spfPath);
            const spf = entries.find((n) => n.toLowerCase().endsWith('.spf'));
            if (!spf)
                throw new Error(`No .spf project file found in directory: ${spfPath}`);
            target = node_path_1.default.join(spfPath, spf);
        }
        return fs_extra_1.default.readJSON(target);
    });
    electron_1.ipcMain.handle('project:createStructure', async (_event, projectPath, spfPath) => {
        try {
            await fs_extra_1.default.mkdir(projectPath, { recursive: true });
            const projectFile = new ProjectFile(projectPath);
            await escreverSpf(spfPath, projectFile.toJSON());
            const projectExists = await fs_extra_1.default.pathExists(projectPath);
            const spfExists = await fs_extra_1.default.pathExists(spfPath);
            if (!projectExists || !spfExists) {
                throw new Error('Failed to create project structure or .spf file');
            }
            const files = await fs_extra_1.default.readdir(projectPath, { withFileTypes: true });
            const fileList = files.map((file) => ({
                name: file.name,
                isDirectory: file.isDirectory(),
                path: node_path_1.default.join(projectPath, file.name),
            }));
            // Newly-created project lands in the jumplist's Recent Projects
            // category too. Same path the open IPC takes; sharing it here
            // keeps "I just made a project, it should be in recents now"
            // working without an extra app launch.
            try {
                if (process.platform === 'win32') {
                    if (typeof electron_1.app.addRecentDocument === 'function')
                        electron_1.app.addRecentDocument(spfPath);
                    const recents = requireTarde('../recents');
                    recents.push(spfPath);
                    const { rebuildJumpList } = requireTarde('../windows');
                    rebuildJumpList();
                }
            }
            catch (e) {
                electron_log_1.default.warn('jumplist refresh (createStructure) failed:', e);
            }
            return {
                success: true,
                projectData: projectFile.toJSON(),
                files: fileList,
                spfPath,
                projectPath,
            };
        }
        catch (error) {
            electron_log_1.default.error('Error creating project structure:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('project:open', async (event, spfPath) => {
        try {
            if (typeof spfPath !== 'string' || !spfPath.trim()) {
                return { success: false, message: 'No project path provided.' };
            }
            // Try to correct the path if the .spf doesn't exist (older formats placed
            // the file in <root>/<name>.spf vs <root>/<name>/<name>.spf).
            if (!(await fs_extra_1.default.pathExists(spfPath))) {
                const projectName = node_path_1.default.basename(spfPath, '.spf');
                const correctedSpfPath = node_path_1.default.join(node_path_1.default.dirname(spfPath), projectName, `${projectName}.spf`);
                spfPath = correctedSpfPath;
                if (!(await fs_extra_1.default.pathExists(spfPath))) {
                    throw new Error('SPF file not found at both original and corrected paths.');
                }
            }
            // Track in our own recents store + refresh the Windows jumplist.
            // We don't use Windows' shell-managed `frequent`/`recent` lists
            // anymore (they surfaced stale "Electron" entries from earlier
            // dev runs), instead `main/recents.js` owns the list and
            // `rebuildJumpList()` re-renders the "Recent Projects" custom
            // category every time a project opens. `addRecentDocument` is
            // still called so the file shows up in Win+E and File Explorer's
            // own recents.
            try {
                if (process.platform === 'win32') {
                    if (typeof electron_1.app.addRecentDocument === 'function') {
                        electron_1.app.addRecentDocument(spfPath);
                    }
                    const recents = requireTarde('../recents');
                    recents.push(spfPath);
                    const { rebuildJumpList } = requireTarde('../windows');
                    rebuildJumpList();
                }
            }
            catch (e) {
                electron_log_1.default.warn('jumplist refresh failed:', e);
            }
            const spfContent = await fs_extra_1.default.readFile(spfPath, 'utf8');
            const projectData = (0, spf_parse_js_1.parseSpfTolerant)(spfContent);
            // Um `.spf` tem `structure`. Qualquer JSON valido passa pelo parse
            // tolerante, e sem esta conferencia um `package.json`, um `.vscode` ou
            // qualquer objeto do disco seria aceito como projeto ate o primeiro
            // campo faltante estourar, ja com a janela registrada nele.
            if (!projectData || typeof projectData.structure !== 'object' || !projectData.structure) {
                throw new Error('Not a SAPHO project file: no "structure" section.');
            }
            if (!projectData.metadata || typeof projectData.metadata !== 'object') {
                projectData.metadata = {};
            }
            // A4: the open .spf in state is the SINGLE source of truth for "which
            // project is open". The project DIRECTORY is derived from it on demand
            // (path.dirname), no duplicated global.currentProject* to keep in sync.
            // Indexado tambem pela janela que abriu (event.sender), porque cada
            // janela principal tem o seu projeto; ver project_paths.spfDaJanela.
            //
            // O registro acontece DEPOIS de o arquivo ser lido e reconhecido como
            // `.spf`. Antes ele vinha logo apos o teste de existencia, e um arquivo
            // que existisse mas nao fosse um projeto deixava a janela registrada
            // assim mesmo: o `catch` la embaixo relanca sem desfazer nada. Isso
            // importa porque a pasta do `.spf` registrado e uma das areas gravaveis
            // do guarda de escrita (main/ipc/fs_guard.js), entao apontar a janela
            // para um arquivo qualquer abria a pasta dele para escrita.
            (0, project_paths_js_1.registrarSpfDaJanela)(event, spfPath);
            projectData.metadata.lastOpened = new Date().toISOString();
            // basePath SEMPRE alinha com dirname(spfPath). Antes checavamos so
            // existence (oldBasePath nao existe -> reconcilia); mas isso falhava
            // quando o user copiava o projeto pra outra pasta no MESMO PC -
            // oldBasePath ainda existia (apontando pro projeto original), nao
            // reconciliava, e os paths relativos do .spf eram resolvidos contra
            // o basePath errado. Comparar com dirname(spfPath) trata os 2 casos
            // (outro PC E mesma maquina) de forma uniforme. Trade-off: se algum
            // user mantiver basePath propositalmente diferente do dirname do
            // .spf, ele e sobrescrito (cenario muito improvavel).
            const oldBasePath = projectData.structure.basePath;
            const expectedBasePath = node_path_1.default.dirname(spfPath);
            if (oldBasePath !== expectedBasePath) {
                // Relocate every absolute path the .spf still pins to the OLD root so a
                // copied/backed-up project keeps working. The file lists are stored
                // relative (untouched here), but command overrides keep freeform
                // absolutes, appendArgs/prependArgs tokens, envSet values, that the
                // relative-on-disk scheme can't safely round-trip (it can't tell a path
                // from `-O2` or `2`). A root prefix-swap can: remapRootPath only rewrites
                // strings genuinely under oldRoot, leaving flags and out-of-project paths
                // alone. Same transform the rename flow applies, run here on move/copy.
                if (oldBasePath && node_path_1.default.isAbsolute(oldBasePath)) {
                    (0, project_paths_js_1.deepRemapPaths)(projectData.structure, oldBasePath, expectedBasePath);
                }
                projectData.metadata.projectPath = expectedBasePath;
                projectData.structure.basePath = expectedBasePath;
            }
            if (projectData.structure.processors) {
                projectData.structure.processors = await Promise.all(projectData.structure.processors.map(async (processor) => {
                    const processorPath = node_path_1.default.join(projectData.structure.basePath, processor.name);
                    const exists = await fs_extra_1.default.pathExists(processorPath);
                    return { ...processor, exists };
                }));
            }
            else {
                projectData.structure.processors = [];
            }
            if (!projectData.structure.folders)
                projectData.structure.folders = [];
            await escreverSpf(spfPath, projectData);
            // A Temp deste projeto (<projeto>/.aurora/Temp): garante, esconde no
            // Windows e poda o que envelheceu ou passou do teto. Fora do caminho
            // da abertura, sem lancar; ver main/project_temp.js.
            (0, project_temp_js_1.prepararTempDoProjeto)(projectData.structure.basePath);
            const files = await fs_extra_1.default.readdir(projectData.structure.basePath, { withFileTypes: true });
            const fileList = files
                .filter((file) => !(0, files_ops_js_1.entradaOcultaNaArvore)(file.name))
                .map((file) => ({
                name: file.name,
                isDirectory: file.isDirectory(),
                path: node_path_1.default.join(projectData.structure.basePath, file.name),
            }));
            // Prefer the window that actually sent the request. During a startup
            // auto-open the main window isn't focused yet, the splash is still on
            // top and the main window is created hidden (deferShow), so
            // getFocusedWindow() returns null. Falling back to the sender keeps the
            // processor list flowing AND, crucially, keeps the return shape
            // consistent: the renderer reads result.projectData.structure.processors
            // to group the file tree by processor. The old `return projectData`
            // early-exit returned a different shape, so on auto-open the renderer
            // saw no processors and rendered every file in one flat, ungrouped list.
            const targetWindow = electron_1.BrowserWindow.fromWebContents(event.sender)
                || electron_1.BrowserWindow.getFocusedWindow();
            if (targetWindow && !targetWindow.isDestroyed()) {
                targetWindow.webContents.send('project:processorHubState', { enabled: true });
                targetWindow.webContents.send('project:processors', {
                    processors: projectData.structure.processors.map((p) => p.name),
                    projectPath: projectData.structure.basePath,
                });
            }
            else {
                electron_log_1.default.warn('open-spf-project: no window to send IPC events to');
            }
            return { projectData, files: fileList, spfPath };
        }
        catch (error) {
            // Abrir falhou depois do registro (disco, permissao, `.spf` que o parse
            // aceitou mas o resto recusou): a janela nao pode ficar com um projeto
            // meio aberto, porque a pasta dele e area gravavel.
            (0, project_paths_js_1.registrarSpfDaJanela)(event, null);
            electron_log_1.default.error('Error opening project file:', error);
            throw error;
        }
    });
    /**
     * Solta o que prende a pasta de um projeto antes de move-la.
     *
     * No Windows uma pasta com descritor aberto ou com um processo cujo
     * diretorio de trabalho esta nela nao se move. Sao tres donos conhecidos:
     * os vigias de pasta e de arquivo deste processo, o servidor de linguagem
     * do slang (nasce com cwd no projeto) e o PowerShell do TCMD (idem). O
     * renderer ja fechou as abas antes de pedir; aqui vai o que so o main
     * alcanca. Tudo melhor esforco: o que nao soltar, a lixeira tenta de novo
     * e por fim diz que nao conseguiu.
     */
    function soltarAPasta(dir) {
        for (const [caminho, info] of [...state_js_1.default.activeDirectoryWatchers.entries()]) {
            if (!(0, project_trash_js_1.dentroDe)(caminho, dir))
                continue;
            try {
                info?.watcher?.close?.();
            }
            catch (_) { /* ja caiu */ }
            state_js_1.default.activeDirectoryWatchers.delete(caminho);
        }
        for (const [caminho, info] of [...(state_js_1.default.activeWatchers?.entries?.() || [])]) {
            if (!(0, project_trash_js_1.dentroDe)(caminho, dir))
                continue;
            try {
                (info?.watcher || info)?.close?.();
            }
            catch (_) { /* ja caiu */ }
            state_js_1.default.activeWatchers.delete(caminho);
        }
        try {
            requireTarde('../lsp/slang_lsp').stop(false);
        }
        catch (e) {
            electron_log_1.default.debug('[project:trash] slang stop:', e instanceof Error ? e.message : e);
        }
        try {
            requireTarde('./shell').matarSessoesEm(dir);
        }
        catch (e) {
            electron_log_1.default.debug('[project:trash] shell:', e instanceof Error ? e.message : e);
        }
    }
    const mandarParaLixeira = (0, project_trash_js_1.criarLixeiraDeProjeto)({ trashItem: (p) => electron_1.shell.trashItem(p) });
    /**
     * Manda a pasta do projeto que ESTA JANELA ACABOU DE FECHAR para a Lixeira.
     *
     * Nunca apaga de vez: `shell.trashItem` tem volta pelo Windows. A ordem
     * inteira (confirmar com contagem, fechar, esta chamada, recentes) mora em
     * js/project/delete_project.js; a autorizacao mora em project_trash.js e
     * vale para um pedido: so o projeto que esta janela acabou de fechar.
     */
    electron_1.ipcMain.handle('project:trash', async (event, spfPedido) => {
        const auth = (0, project_trash_js_1.autorizarExclusao)(state_js_1.default.ultimoProjetoFechado, event?.sender?.id, spfPedido);
        if (!auth.ok) {
            electron_log_1.default.warn('[project:trash] recusado:', auth.motivo);
            return { success: false, message: auth.motivo };
        }
        const dir = node_path_1.default.dirname(auth.spf);
        if (!fs_extra_1.default.existsSync(dir))
            return { success: false, message: 'project folder not found on disk' };
        soltarAPasta(dir);
        const r = await mandarParaLixeira(dir);
        if (r.success) {
            electron_log_1.default.info(`[project:trash] ${dir} foi para a Lixeira (tentativa ${r.tentativas})`);
            // Requeridos aqui, como no `project:open`: o modulo de janelas importa
            // de volta este, e o require no topo fecharia o ciclo.
            try {
                requireTarde('../recents').remove(auth.spf);
                requireTarde('../windows').rebuildJumpList();
            }
            catch (e) {
                electron_log_1.default.warn('[project:trash] recentes:', e);
            }
        }
        else {
            electron_log_1.default.warn(`[project:trash] nao consegui mover ${dir}: ${r.message}`);
        }
        return { success: r.success, message: r.message };
    });
    electron_1.ipcMain.handle('project:close', async (event) => {
        try {
            const spfFechado = (0, project_paths_js_1.spfDaJanela)(event);
            if (!spfFechado) {
                return { success: true, message: 'No project to close' };
            }
            (0, project_paths_js_1.registrarSpfDaJanela)(event, null);
            // Lembra o que fechou: e isto que autoriza `project:trash` em seguida.
            if (event?.sender?.id != null)
                state_js_1.default.ultimoProjetoFechado.set(event.sender.id, spfFechado);
            // Para a janela que pediu, nao para a que tem foco: fechar projeto com
            // outra janela em primeiro plano limpava a arvore errada.
            if (!event.sender.isDestroyed()) {
                const notifications = [
                    { channel: 'project:processorHubState', data: { enabled: false } },
                    { channel: 'project:processors', data: { processors: [], projectPath: null } },
                    { channel: 'project:fileTree', data: { files: [], projectPath: null } },
                    { channel: 'project:closed', data: { success: true } },
                ];
                notifications.forEach(({ channel, data }) => event.sender.send(channel, data));
            }
            return { success: true };
        }
        catch (error) {
            electron_log_1.default.error('Error closing project:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    /**
     * Grava o `.spf` do projeto desta janela, de forma atomica.
     *
     * O renderer e o dono da escrita do `.spf` e gravava pelo `write-file`
     * generico, que trunca e escreve: uma leitura que caisse no meio pegava
     * JSON pela metade, o parser tolerante desistia, e o `SpfStore` devolvia a
     * estrutura vazia EM SILENCIO. Na tela isso aparecia como "nenhum testbench
     * definido" num projeto que tinha um, e o clique seguinte funcionava porque
     * a escrita ja tinha terminado. O `escreverSpf` daqui grava num `.tmp` e
     * renomeia por cima, e o rename e atomico: nao existe meio-arquivo para
     * ninguem ler.
     *
     * So aceita o `.spf` que ESTA JANELA abriu. E mais estreito do que o
     * `write-file` generico de proposito: este canal escreve um arquivo que o
     * projeto inteiro depende, e nao precisa de mais alcance do que esse.
     */
    electron_1.ipcMain.handle('project:write-spf', async (event, spfPath, doc) => {
        try {
            const aberto = (0, project_paths_js_1.spfDaJanela)(event);
            const mesmo = typeof spfPath === 'string' && aberto
                && node_path_1.default.resolve(spfPath).toLowerCase() === node_path_1.default.resolve(aberto).toLowerCase();
            if (!mesmo) {
                return { success: false, message: 'spf path is not the project open in this window' };
            }
            if (!doc || typeof doc !== 'object') {
                return { success: false, message: 'spf document must be an object' };
            }
            await escreverSpf(aberto, doc);
            return { success: true };
        }
        catch (error) {
            electron_log_1.default.error('project:write-spf failed:', error);
            return { success: false, message: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('get-current-project', async (event) => {
        const spfPath = (0, project_paths_js_1.spfDaJanela)(event);
        if (!spfPath)
            return { projectOpen: false };
        try {
            const spfData = await fs_extra_1.default.readFile(spfPath, 'utf8');
            const projectData = (0, spf_parse_js_1.parseSpfTolerant)(spfData);
            return {
                projectOpen: true,
                projectPath: projectData.structure.basePath,
                spfPath,
                processors: projectData.structure.processors.map((p) => p.name),
            };
        }
        catch (error) {
            electron_log_1.default.error('Error getting current project:', error);
            return { projectOpen: false };
        }
    });
    // ---- processors ----
    electron_1.ipcMain.handle('create-processor-project', async (event, formData) => {
        try {
            if (!formData.projectLocation)
                throw new Error('Project location is required');
            // SECURITY: processorName goes straight into path.join below, so it must
            // be confined to a single path segment, same allowlist the rename
            // handlers use. Without this, "..\\.." would create the Software/Hardware/
            // Simulation tree outside the project (path traversal).
            if (!/^[A-Za-z0-9_-]+$/.test(formData.processorName || '')) {
                throw new Error('Invalid processor name: use only letters, numbers, hyphen and underscore');
            }
            const processorPath = node_path_1.default.join(formData.projectLocation, formData.processorName);
            const softwarePath = node_path_1.default.join(processorPath, 'Software');
            const hardwarePath = node_path_1.default.join(processorPath, 'Hardware');
            const simulationPath = node_path_1.default.join(processorPath, 'Simulation');
            try {
                await fs_extra_1.default.access(processorPath);
                throw new Error(`A processor with name "${formData.processorName}" already exists`);
            }
            catch (err) {
                if (err.code !== 'ENOENT')
                    throw err;
                await fs_extra_1.default.mkdir(processorPath, { recursive: true });
                await fs_extra_1.default.mkdir(softwarePath, { recursive: true });
                await fs_extra_1.default.mkdir(hardwarePath, { recursive: true });
                await fs_extra_1.default.mkdir(simulationPath, { recursive: true });
                // A linguagem decide o nome e o conteudo do fonte: as diretivas
                // `#NUBITS` do C+- ou os `#pragma yanc` do C++. Ver
                // js/project/processor_defaults.ts. Sem `language`, C+-, como sempre.
                const { fileName, content } = (0, processor_defaults_js_1.processorSourceFile)(formData, formData.language);
                const sourceFilePath = node_path_1.default.join(softwarePath, fileName);
                await fs_extra_1.default.writeFile(sourceFilePath, content, 'utf8');
                const spfPath = node_path_1.default.join(formData.projectLocation, `${node_path_1.default.basename(formData.projectLocation)}.spf`);
                const spfContent = await fs_extra_1.default.readFile(spfPath, 'utf8');
                const spfData = (0, spf_parse_js_1.parseSpfTolerant)(spfContent);
                // Garante array antes do push e dedup case-insensitive: bugs
                // anteriores podiam acumular o mesmo nome multiplas vezes no
                // .spf, e da pra ainda haver arquivos no disco que escapem o
                // check de fs.access la em cima (race com criar manual).
                if (!Array.isArray(spfData.structure.processors)) {
                    spfData.structure.processors = [];
                }
                const targetLower = formData.processorName.toLowerCase();
                const already = spfData.structure.processors.some((p) => (typeof p === 'string' ? p : p?.name)?.toLowerCase() === targetLower);
                if (!already) {
                    // `language` so e gravada quando NAO e a padrao: uma entrada C+-
                    // continua sendo `{ name }`, byte a byte o que era, e quem le
                    // (js/compilation/processor_source.ts) ja trata a ausencia como C+-.
                    // Para o C++ o campo e o que tira a ambiguidade quando existem um
                    // .cmm e um .cpp com o mesmo nome na pasta.
                    const ehCpp = String(formData.language || '').toLowerCase() === 'cpp';
                    spfData.structure.processors.push({
                        name: formData.processorName,
                        ...(ehCpp ? { language: 'cpp' } : {}),
                    });
                }
                await escreverSpf(spfPath, spfData);
                // Channel `processor:created`, preload.js (onProcessorCreated)
                // escuta com esse nome (colon-separated, mesmo padrao de
                // `project:opened` e `project:processors`). O nome anterior
                // `processor-created` era um typo: o listener nunca disparava,
                // entao um novo processador so era refletido em
                // window.availableProcessors / file tree apos restart do app.
                //
                // Vai para a JANELA QUE PEDIU, e nao para `state.mainWindow`, que e
                // apenas a criada por ultimo: com duas janelas abertas, criar um
                // processador numa delas fazia a arvore da OUTRA atualizar, e a que
                // pediu so via o processador novo depois de reabrir o projeto.
                main_windows_js_1.default.mandar({ origem: event, reserva: false }, 'processor:created', {
                    processorName: formData.processorName,
                    projectPath: formData.projectLocation,
                });
                return { success: true, path: processorPath };
            }
        }
        catch (error) {
            electron_log_1.default.error('Error in create-processor-project:', error);
            throw error;
        }
    });
    electron_1.ipcMain.handle('get-available-processors', async (event, projectPath) => {
        // Os parametros de hardware que o fonte declara: `#NUBITS 32` no C+- e
        // `#pragma yanc nubits 32` no C++. Quem sabe ler os dois e o
        // js/compilation/processor_header.ts; aqui so o disco.
        async function lerCabecalho(projectDir, proc) {
            const entrada = typeof proc === 'string' ? { name: proc } : proc;
            const { language, sourceFile } = (0, processor_source_js_1.resolveProcessorSource)(entrada);
            const caminho = node_path_1.default.join(projectDir, entrada.name, 'Software', sourceFile);
            try {
                return (0, processor_header_js_1.parseProcessorHeader)(await fs_extra_1.default.readFile(caminho, 'utf8'), language);
            }
            catch (_) {
                return {};
            }
        }
        // Enrich the raw SPF processors array with clk/numClocks and the source
        // header directives (C+- or C++).
        async function enrichProcessors(procs, projectDir) {
            return Promise.all(procs.map(async (p) => {
                return {
                    name: typeof p === 'string' ? p : p.name,
                    ...(0, processor_sim_config_js_1.configComTempo)(p),
                    header: await lerCabecalho(projectDir, p),
                };
            }));
        }
        try {
            // Prefer the currently open project, most reliable source of truth.
            const spfAberto = (0, project_paths_js_1.spfDaJanela)(event);
            if (spfAberto && (await fs_extra_1.default.pathExists(spfAberto))) {
                const spfData = await fs_extra_1.default.readFile(spfAberto, 'utf8');
                const projectData = (0, spf_parse_js_1.parseSpfTolerant)(spfData);
                if (projectData.structure && projectData.structure.processors) {
                    return enrichProcessors(projectData.structure.processors, projectData.structure.basePath);
                }
            }
            if (projectPath) {
                const stats = await fs_extra_1.default.stat(projectPath);
                let spfPath;
                if (stats.isDirectory()) {
                    const files = await fs_extra_1.default.readdir(projectPath);
                    const spfFile = files.find((file) => file.endsWith('.spf'));
                    if (spfFile)
                        spfPath = node_path_1.default.join(projectPath, spfFile);
                }
                else if (projectPath.endsWith('.spf')) {
                    spfPath = projectPath;
                }
                if (spfPath && (await fs_extra_1.default.pathExists(spfPath))) {
                    const spfData = await fs_extra_1.default.readFile(spfPath, 'utf8');
                    const projectData = (0, spf_parse_js_1.parseSpfTolerant)(spfData);
                    if (projectData.structure && projectData.structure.processors) {
                        return enrichProcessors(projectData.structure.processors, projectData.structure.basePath);
                    }
                }
            }
            return [];
        }
        catch (error) {
            electron_log_1.default.error('Error getting available processors:', error);
            return [];
        }
    });
    /**
     * Recently-opened projects. Pulls from `main/recents.js` (already
     * persisted on every project:open), prunes stale entries whose .spf
     * has been deleted, and returns the absolute paths so the renderer
     * (and Aurora Intelligence) can list them with a single round-trip.
     */
    electron_1.ipcMain.handle('list-recent-projects', async () => {
        try {
            const recents = requireTarde('../recents');
            return recents.prune();
        }
        catch (e) {
            electron_log_1.default.warn('list-recent-projects failed:', e instanceof Error ? e.message : e);
            return [];
        }
    });
    electron_1.ipcMain.handle('delete-processor', async (event, processorName) => {
        try {
            // Pela janela que pediu: contra o global, apagar um processador na
            // janela A removia a pasta do projeto aberto na janela B.
            const spfPath = (0, project_paths_js_1.spfDaJanela)(event);
            if (!spfPath)
                throw new Error('No open project');
            const spfData = await fs_extra_1.default.readFile(spfPath, 'utf8');
            const projectData = (0, spf_parse_js_1.parseSpfTolerant)(spfData);
            const projectDir = projectData.structure.basePath;
            // O nome vem do renderer (e da IA, via delete_processor): so a mesma
            // allowlist do create entra no path.join, senao `..` apaga a pasta pai.
            const nome = String(processorName || '').trim();
            if (!/^[A-Za-z0-9_-]+$/.test(nome)) {
                throw new Error('Processor name may contain only letters, numbers, underscore or hyphen');
            }
            const processorDir = node_path_1.default.join(projectDir, nome);
            if (await fs_extra_1.default.pathExists(processorDir))
                await fs_extra_1.default.remove(processorDir);
            if (projectData.structure.processors) {
                projectData.structure.processors = projectData.structure.processors.filter((processor) => processor.name !== nome);
                await escreverSpf(spfPath, projectData);
            }
            // Para a janela que pediu, nao para a que tem foco: com o PRISM ou o
            // manual na frente, a lista ficava velha na janela certa.
            if (!event.sender.isDestroyed()) {
                event.sender.send('project:processors', {
                    processors: projectData.structure.processors.map((p) => p.name),
                    projectPath: projectData.structure.basePath,
                });
            }
            return { success: true };
        }
        catch (error) {
            electron_log_1.default.error('Error deleting processor:', error);
            throw error;
        }
    });
    /**
     * Rename a processor across every SAPHO-internal surface:
     *   - the processor working directory  <root>/<old>  →  <root>/<new>
     *   - the source file  Software/<old>.cmm  →  Software/<new>.cmm
     *   - the `#PRNAME` directive inside that .cmm (directive line ONLY:
     *     user comments and code are never touched)
     *   - the auto-generated build artifacts (asm / Hardware .v / Simulation
     *     _tb.v) so stale-named files don't linger; they regenerate on the
     *     next compile anyway
     *   - the .spf: the processors[] entry (clk/numClocks/showArrays config is
     *     preserved) and any path reference (topLevelFile / testbenchFile /
     *     synthesizableFiles / testbenchFiles) that pointed inside the folder.
     *
     * Custom user toplevels / testbenches that live at the project root are
     * intentionally left alone, the user renames those explicitly.
     */
    electron_1.ipcMain.handle('rename-processor', async (event, oldName, newName) => {
        try {
            // Mesma regra do delete-processor: o projeto e o da janela que pediu.
            const spfPath = (0, project_paths_js_1.spfDaJanela)(event);
            if (!spfPath)
                throw new Error('No open project');
            const oldNm = String(oldName || '').trim();
            const newNm = String(newName || '').trim();
            if (!oldNm)
                throw new Error('Current processor name is required');
            if (!newNm)
                throw new Error('New processor name is required');
            if (!/^[A-Za-z0-9_-]+$/.test(newNm)) {
                throw new Error('Processor name may contain only letters, numbers, underscore or hyphen');
            }
            const spfData = (0, spf_parse_js_1.parseSpfTolerant)(await fs_extra_1.default.readFile(spfPath, 'utf8'));
            const projectDir = spfData.structure.basePath;
            const procs = Array.isArray(spfData.structure.processors)
                ? spfData.structure.processors : [];
            const nameOf = (p) => (typeof p === 'string' ? p : p?.name);
            const idx = procs.findIndex((p) => nameOf(p)?.toLowerCase() === oldNm.toLowerCase());
            if (idx === -1)
                throw new Error(`Processor "${oldNm}" not found in this project`);
            // Canonical current casing (the .spf entry, not what the caller typed).
            const currentName = nameOf(procs[idx]);
            // O nome atual vem do .spf, que pode ter sido clonado: um `../x` la
            // dentro moveria uma pasta de fora do projeto. Mesma allowlist do novo.
            if (!/^[A-Za-z0-9_-]+$/.test(String(currentName || ''))) {
                throw new Error(`Processor "${currentName}" has a folder name the project cannot handle`);
            }
            const caseOnly = currentName.toLowerCase() === newNm.toLowerCase();
            if (!caseOnly) {
                const clash = procs.some((p, i) => i !== idx && nameOf(p)?.toLowerCase() === newNm.toLowerCase());
                if (clash)
                    throw new Error(`A processor named "${newNm}" already exists`);
            }
            const oldDir = node_path_1.default.join(projectDir, currentName);
            const newDir = node_path_1.default.join(projectDir, newNm);
            if (!(await fs_extra_1.default.pathExists(oldDir))) {
                throw new Error(`Processor folder not found: ${oldDir}`);
            }
            if (!caseOnly && (await fs_extra_1.default.pathExists(newDir))) {
                throw new Error(`A folder named "${newNm}" already exists in the project`);
            }
            // Release the project's file/dir watchers FIRST. chokidar
            // (ReadDirectoryChangesW) keeps a handle on the watched tree, so moving
            // a watched subfolder otherwise fails with EPERM ("operation not
            // permitted"), exactly the processor-rename failure. The renderer
            // re-establishes watching after the rename.
            await releaseWatchersUnder(projectDir);
            // 1. Move the processor directory. A case-only rename on a
            //    case-insensitive FS (Windows) needs a temp hop so the OS
            //    actually re-cases the folder. moveWithRetry rides out a brief
            //    residual lock (AV / indexer / a just-released watcher handle).
            if (caseOnly) {
                const tmpDir = node_path_1.default.join(projectDir, `__rename_${Date.now()}__`);
                await moveWithRetry(oldDir, tmpDir, { overwrite: false });
                await moveWithRetry(tmpDir, newDir, { overwrite: false });
            }
            else {
                await moveWithRetry(oldDir, newDir, { overwrite: false });
            }
            // 2. Rename the SAPHO-managed files that carry the processor name.
            // A lista vem do processor_rename.ts, que conhece as duas linguagens:
            // os fontes das duas entram, e o que nao existir no disco e pulado logo
            // abaixo. Ver o comentario de la sobre por que nao se filtra por
            // linguagem declarada.
            for (const { sub, de, para } of (0, processor_rename_js_1.artefatosDoProcessador)(currentName, newNm)) {
                if (de === para)
                    continue;
                const fromP = node_path_1.default.join(newDir, sub, de);
                const toP = node_path_1.default.join(newDir, sub, para);
                if (await fs_extra_1.default.pathExists(fromP)) {
                    await fs_extra_1.default.move(fromP, toP, { overwrite: true });
                }
            }
            // 3. Reescreve o nome DENTRO do fonte, e so a linha da diretiva:
            // `#PRNAME` no C+-, `#pragma yanc prname` no C++. Procura os dois
            // arquivos porque o rename nao pergunta a linguagem a ninguem; o que
            // existir e o que vale.
            for (const { language, arquivo } of (0, processor_rename_js_1.fontesPossiveis)(newNm)) {
                const fontePath = node_path_1.default.join(newDir, 'Software', arquivo);
                if (!await fs_extra_1.default.pathExists(fontePath))
                    continue;
                const raw = await fs_extra_1.default.readFile(fontePath, 'utf8');
                const patched = (0, processor_rename_js_1.reescreverNomeNoFonte)(raw, newNm, language);
                if (patched !== raw)
                    await fs_extra_1.default.writeFile(fontePath, patched, 'utf8');
            }
            // 4. Update the processors[] entry, preserving per-processor config.
            procs[idx] = typeof procs[idx] === 'string'
                ? { name: newNm }
                : { ...procs[idx], name: newNm };
            spfData.structure.processors = procs;
            // 5. Remap any .spf path reference that lived under the old folder.
            spfData.structure.topLevelFile =
                (0, project_paths_js_1.remapProcessorPath)(spfData.structure.topLevelFile, projectDir, currentName, newNm);
            spfData.structure.testbenchFile =
                (0, project_paths_js_1.remapProcessorPath)(spfData.structure.testbenchFile, projectDir, currentName, newNm);
            for (const key of ['synthesizableFiles', 'testbenchFiles']) {
                const arr = Array.isArray(spfData.structure[key]) ? spfData.structure[key] : [];
                for (const f of arr) {
                    if (f && typeof f === 'object' && f.path) {
                        const np = (0, project_paths_js_1.remapProcessorPath)(f.path, projectDir, currentName, newNm);
                        if (np !== f.path) {
                            f.path = np;
                            f.name = node_path_1.default.basename(np);
                        }
                    }
                }
            }
            if (spfData.metadata)
                spfData.metadata.lastModified = new Date().toISOString();
            await escreverSpf(spfPath, spfData);
            // Para a janela que pediu, nao para a que tem foco: com o PRISM ou o
            // manual na frente, a lista ficava velha na janela certa.
            if (!event.sender.isDestroyed()) {
                event.sender.send('project:processors', {
                    processors: spfData.structure.processors.map((p) => p.name),
                    projectPath: projectDir,
                });
                event.sender.send('processor:renamed', {
                    oldName: currentName, newName: newNm, projectPath: projectDir, oldDir, newDir,
                });
            }
            return { success: true, oldName: currentName, newName: newNm, oldDir, newDir };
        }
        catch (error) {
            electron_log_1.default.error('Error renaming processor:', error);
            throw error;
        }
    });
    /**
     * Rename the currently open project. This renames BOTH the project root
     * folder (<location>/<old> → <location>/<new>) and the project file
     * (<old>.spf → <new>.spf), updates the .spf metadata (projectName,
     * projectPath, basePath) and deep-remaps every absolute path stored in
     * the .spf (synth/testbench file lists, top-level/testbench pointers,
     * command-override cwd/env, …) from the old root to the new one.
     *
     * Open chokidar watchers under the old root are released first so the
     * folder rename can't fail with EPERM/EBUSY on Windows. Main-process
     * state + the recents/jumplist are updated to the new .spf path; the
     * renderer reopens the project there.
     *
     * Processor folders are subdirectories of the root, so they move with it
     *, their #PRNAME directives and per-processor names are unaffected by a
     * project rename (use rename_processor for those).
     */
    electron_1.ipcMain.handle('rename-project', async (event, newName) => {
        // Track each phase so the renderer (and the AI, via get_rename_status)
        // gets step-by-step completion feedback and, on failure, the exact step
        // it died on. We return a STRUCTURED verdict instead of throwing so the
        // caller never sees an opaque IPC rejection (the old "timed out" symptom).
        const steps = [];
        const t0 = Date.now();
        let failedStep = 'validate';
        const mark = (step) => { steps.push({ step, ok: true, ms: Date.now() - t0, where: 'main' }); };
        try {
            const spfAberto = (0, project_paths_js_1.spfDaJanela)(event);
            if (!spfAberto)
                throw new Error('No open project');
            const newNm = String(newName || '').trim();
            if (!newNm)
                throw new Error('New project name is required');
            if (!/^[A-Za-z0-9_-]+$/.test(newNm)) {
                throw new Error('Project name may contain only letters, numbers, underscore or hyphen');
            }
            const oldSpfPath = spfAberto;
            const oldRoot = node_path_1.default.dirname(oldSpfPath);
            const parent = node_path_1.default.dirname(oldRoot);
            const oldFolderName = node_path_1.default.basename(oldRoot);
            const oldSpfBase = node_path_1.default.basename(oldSpfPath);
            const spfData = (0, spf_parse_js_1.parseSpfTolerant)(await fs_extra_1.default.readFile(oldSpfPath, 'utf8'));
            const oldName = spfData.metadata?.projectName
                || node_path_1.default.basename(oldSpfPath, '.spf');
            const newRoot = node_path_1.default.join(parent, newNm);
            const folderCaseOnly = oldFolderName.toLowerCase() === newNm.toLowerCase();
            const needFolderMove = oldFolderName !== newNm;
            if (needFolderMove && !folderCaseOnly && (await fs_extra_1.default.pathExists(newRoot))) {
                throw new Error(`A folder named "${newNm}" already exists at ${parent}`);
            }
            mark('validate');
            // 1. Release watchers so the folder isn't locked during the move.
            failedStep = 'release-watchers';
            await releaseWatchersUnder(oldRoot);
            mark('release-watchers');
            // 2. Rename the project root folder (temp hop for a case-only change).
            failedStep = 'move-folder';
            let movedRoot = oldRoot;
            if (needFolderMove) {
                if (folderCaseOnly) {
                    const tmp = node_path_1.default.join(parent, `__aurora_rename_${Date.now()}__`);
                    await moveWithRetry(oldRoot, tmp);
                    await moveWithRetry(tmp, newRoot);
                }
                else {
                    await moveWithRetry(oldRoot, newRoot);
                }
                movedRoot = newRoot;
            }
            mark('move-folder');
            // 3. Rename the .spf inside the (possibly moved) root.
            failedStep = 'rename-spf';
            const currentSpfInRoot = node_path_1.default.join(movedRoot, oldSpfBase);
            const newSpfPath = node_path_1.default.join(movedRoot, `${newNm}.spf`);
            if (currentSpfInRoot.toLowerCase() !== newSpfPath.toLowerCase()) {
                if (await fs_extra_1.default.pathExists(currentSpfInRoot)) {
                    await moveWithRetry(currentSpfInRoot, newSpfPath, { overwrite: false });
                }
            }
            else if (currentSpfInRoot !== newSpfPath) {
                const tmp = node_path_1.default.join(movedRoot, `__aurora_rename_${Date.now()}__.spf`);
                await moveWithRetry(currentSpfInRoot, tmp);
                await moveWithRetry(tmp, newSpfPath);
            }
            mark('rename-spf');
            // 4. Update metadata + deep-remap every absolute path old → new.
            failedStep = 'rewrite-spf';
            spfData.metadata = spfData.metadata || {};
            spfData.metadata.projectName = newNm;
            spfData.metadata.projectPath = movedRoot;
            spfData.metadata.lastModified = new Date().toISOString();
            spfData.structure = spfData.structure || {};
            spfData.structure.basePath = movedRoot;
            // Remap the ENTIRE .spf, not just structure, so no absolute path
            // anywhere is left pointing at the old root: the synth/testbench file
            // lists, the top-level/testbench pointers, per-processor entries,
            // persisted command-override cwd/env (structure.commandOverrides),
            // gtkw save files, AND any future top-level field. metadata.projectName
            // (a name, not a path) and the already-updated projectPath/basePath are
            // safe: remapRootPath only rewrites strings that sit under oldRoot.
            (0, project_paths_js_1.deepRemapPaths)(spfData, oldRoot, movedRoot);
            await escreverSpf(newSpfPath, spfData);
            mark('rewrite-spf');
            // 5. Re-sync main-process state + recents/jumplist to the new path.
            failedStep = 'resync';
            (0, project_paths_js_1.registrarSpfDaJanela)(event, newSpfPath);
            try {
                if (process.platform === 'win32') {
                    if (typeof electron_1.app.addRecentDocument === 'function')
                        electron_1.app.addRecentDocument(newSpfPath);
                    const recents = requireTarde('../recents');
                    recents.push(newSpfPath);
                    recents.prune();
                    const { rebuildJumpList } = requireTarde('../windows');
                    rebuildJumpList();
                }
            }
            catch (e) {
                electron_log_1.default.warn('jumplist refresh (rename-project) failed:', e);
            }
            mark('resync');
            return {
                success: true,
                oldName,
                newName: newNm,
                oldRoot,
                newRoot: movedRoot,
                oldSpfPath,
                newSpfPath,
                steps,
            };
        }
        catch (error) {
            electron_log_1.default.error('Error renaming project:', error);
            // Structured failure (never throw): the renderer always gets a clear
            // verdict + the step it died on, instead of an opaque IPC rejection
            // that the AI could only read as a timeout.
            const mensagem = error?.message;
            return {
                success: false,
                failedStep,
                error: mensagem ? mensagem : String(error),
                steps,
            };
        }
    });
}
