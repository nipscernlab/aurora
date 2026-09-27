/**
 * arquivos_da_simulacao.ts: os arquivos em volta de uma simulacao, em
 * qualquer caminho (Icarus, Verilator, cocotb).
 *
 * Saiu do compilation_module.js. Os dados que o testbench le, copiados para
 * a pasta onde a simulacao roda; o dump que ela gravou; e as duas defesas do
 * dump, cujas regras puras moram em dump_guard.ts: antes de simular, o dump
 * da corrida anterior precisa aceitar ser sobrescrito; depois, o dump achado
 * precisa ser desta corrida.
 */

import { electronAPI } from '../app/electron_api.js';
import { basenameOfPath } from './compilation_helpers.js';
import { dumpEstaFresco } from './dump_guard.js';
import { comAjuda } from '../ui/help_link.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

type Terminal = { appendToTerminal(id: string, texto: string, tipo?: string): void };

/** Os arquivos que o testbench LE: $readmemb/$readmemh e $fopen em modo de leitura. */
function arquivosLidosPeloTestbench(content: string): Set<string> {
    // Arquivo aberto para ESCRITA (um dump.txt via $fopen("...", "w")) e saida
    // do testbench e nao existe antes da simulacao; copia-lo daria um aviso
    // falso de "not found".
    //
    //   $readmemb / $readmemh        sempre leitura, copia.
    //   $fopen sem 2o argumento      escrita (Verilog 2001 devolve mcd), pula.
    //   $fopen com "r"/"rb"/"r+"...  leitura, copia.
    //   $fopen com outro modo        escrita ou acrescimo, pula.
    const filenames = new Set<string>();
    const reReadmem = /\$readmem[bh]\s*\(\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = reReadmem.exec(content)) !== null) {
        filenames.add(m[1]);
    }
    const reFopenWithMode = /\$fopen\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/g;
    while ((m = reFopenWithMode.exec(content)) !== null) {
        const mode = m[2].toLowerCase();
        if (mode === 'r' || mode === 'rb' || mode.startsWith('r+') || mode.startsWith('rb+')) {
            filenames.add(m[1]);
        }
    }
    return filenames;
}

/**
 * Copia os dados que o testbench le de <pasta-do-testbench>/<nome> para
 * `destDir`, a pasta onde a simulacao procura (a do projeto). Caminho absoluto
 * fica como esta; subpasta relativa e criada no destino; testbench que ja esta
 * na pasta do projeto nao copia nada (copiar um arquivo sobre ele mesmo pode
 * trunca-lo no Windows).
 *
 * O sucesso e silencioso. Falha vira aviso por arquivo, porque um dado que
 * falta derruba o $readmemh; o erro do proprio simulador, apontando o $fopen,
 * diz o resto.
 */
export async function copiarDadosDoTestbench(
    terminal: Terminal, destDir: string, testbenchPath: string | null | undefined,
): Promise<void> {
    if (!testbenchPath) return;
    let content: string;
    try {
        content = await electronAPI.readFile(testbenchPath, { encoding: 'utf8' });
    } catch (_e) {
        return;
    }
    const filenames = arquivosLidosPeloTestbench(content);
    if (filenames.size === 0) return;

    const tbDir = await electronAPI.dirname(testbenchPath);
    const failures: Array<{ name: string; reason: string }> = [];
    for (const fname of filenames) {
        if (/^[a-zA-Z]:[\\/]/.test(fname) || fname.startsWith('/') || fname.startsWith('\\')) continue;
        const clean = fname.replace(/^\.[\\/]+/, '');
        const src = await electronAPI.joinPath(tbDir, clean);
        try {
            const exists = await electronAPI.fileExists(src);
            if (!exists) {
                failures.push({ name: fname, reason: 'not found in testbench folder' });
                continue;
            }
            const dst = await electronAPI.joinPath(destDir, clean);
            if (src.replace(/\//g, '\\').toLowerCase() === dst.replace(/\//g, '\\').toLowerCase()) {
                continue;
            }
            const dstDir = await electronAPI.dirname(dst);
            if (dstDir && dstDir !== destDir) {
                try { await electronAPI.mkdir(dstDir); } catch (_e) { /* exists ok */ }
            }
            await electronAPI.copyFile(src, dst);
        } catch (e) {
            failures.push({ name: fname, reason: (e as { message?: string })?.message as string });
        }
    }

    for (const fail of failures) {
        terminal.appendToTerminal(
            'twave',
            tr('terminal.wave.couldNotStageTbFile', { name: fail.name, reason: fail.reason }),
            'warning',
        );
    }
}

/**
 * O dump que a simulacao acabou de gravar em `simDir`.
 *
 * O caminho feliz e `<simTop>.fst` (o testbench instrumentado grava assim), e
 * o `.vcd` de mesmo nome fica de reserva. Quando o usuario escreveu $dumpfile
 * com outro nome, um unico candidato na pasta e adotado com aviso; nenhum ou
 * varios viram erro que diz o que se procurava.
 */
export async function acharDumpDaSimulacao(terminal: Terminal, simTopModule: string, simDir: string): Promise<string> {
    const expectedFst = await electronAPI.joinPath(simDir, `${simTopModule}.fst`);
    if (await electronAPI.fileExists(expectedFst)) return expectedFst;
    const expectedVcd = await electronAPI.joinPath(simDir, `${simTopModule}.vcd`);
    if (await electronAPI.fileExists(expectedVcd)) return expectedVcd;

    let candidates: string[] = [];
    try {
        const entries = await electronAPI.listFilesInDirectory(simDir);
        candidates = (entries || []).filter((name) => {
            const n = name.toLowerCase();
            return n.endsWith('.fst') || n.endsWith('.vcd');
        });
    } catch (_listErr) {
        candidates = [];
    }

    if (candidates.length === 1) {
        const adopted = await electronAPI.joinPath(simDir, candidates[0]);
        terminal.appendToTerminal('twave',
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
 * Defesa 1: cada nome em `nomes` que JA exista em `simDir` precisa aceitar
 * abertura em escrita, o acesso que o simulador vai pedir ao sobrescrever.
 * Medido no Windows real: visualizador prendendo o arquivo da EBUSY;
 * somente-leitura ou politica da EPERM. Teste de ESCRITA de proposito, nunca
 * de delecao: o GTKWave aberto bloqueia apagar mas nao sobrescrever.
 *
 * @throws quando um dump existente esta travado; a mensagem separa EBUSY
 *         (feche o visualizador) do resto (destrave o arquivo). Falha do
 *         proprio IPC nao bloqueia (fail-open).
 */
export async function exigirDumpGravavel(simDir: string, nomes: string[]): Promise<void> {
    if (typeof electronAPI.checkFileWritable !== 'function') return;
    for (const nome of nomes) {
        let veredito;
        try {
            const alvo = await electronAPI.joinPath(simDir, nome);
            veredito = await electronAPI.checkFileWritable(alvo);
        } catch (_) { continue; }
        if (!veredito || !veredito.exists || veredito.writable) continue;
        const chave = veredito.code === 'EBUSY'
            ? 'error.compilation.dumpLockedBusy'
            : 'error.compilation.dumpLockedDenied';
        throw comAjuda(
            new Error(tr(chave, { file: nome, code: veredito.code || '?' })),
            'dumpBloqueadoHelp',
        );
    }
}

/**
 * Defesa 2: o dump achado precisa ser DESTA corrida. `inicioMs` e capturado
 * antes de qualquer build; um mtime anterior (com a folga do dumpEstaFresco)
 * quer dizer que o simulador NAO reescreveu o arquivo e aquilo e onda velha.
 *
 * @throws quando o dump e de uma corrida anterior. Stat quebrado nao bloqueia.
 */
export async function exigirDumpNovo(vcdFile: string, inicioMs: number): Promise<void> {
    let stats;
    try { stats = await electronAPI.getFileStats(vcdFile); } catch (_) { return; }
    if (dumpEstaFresco(stats ? stats.mtime : NaN, inicioMs)) return;
    throw comAjuda(
        new Error(tr('error.compilation.dumpStale', { file: basenameOfPath(vcdFile) })),
        'dumpBloqueadoHelp',
    );
}
