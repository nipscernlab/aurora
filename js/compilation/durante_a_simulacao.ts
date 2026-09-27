/**
 * durante_a_simulacao.ts: o que acompanha uma simulacao enquanto ela roda,
 * em qualquer caminho (Icarus, Verilator, cocotb).
 *
 * Saiu do compilation_module.js. A barra de progresso, o aviso de bateria e o
 * vigia do tamanho do dump. Nada aqui para a simulacao: sao cortesias.
 */

import { electronAPI } from '../app/electron_api.js';
import { lerProgresso } from '../terminal/progress_line.js';

const tr = (k: string, p?: Record<string, unknown>): string => (window.t ? window.t(k, p) : k);

/** O terminal, visto daqui: a barra e o pill do dump sao opcionais. */
export interface TerminalDaSimulacao {
    appendToTerminal(id: string, texto: string, tipo?: string): void;
    renderHardwareProgress?(id: string, p: {
        pct: number; cyc: number | null; total: number | null; reads: number | null; label: string; done?: boolean;
    }): void;
    renderDumpSize?(id: string, d: { name: string; path?: string; bytes: number; done?: boolean }): void;
}

/**
 * A linha e um contador subindo? Entao ela move a barra e nao vai para o
 * terminal.
 *
 * Um so ponto de decisao para todos os caminhos de saida. Antes cada um trazia
 * o seu reconhecedor, entao um formato novo precisava ser ensinado quatro
 * vezes, e na pratica era ensinado a um so: o resto continuava despejando uma
 * linha por atualizacao no terminal.
 *
 * @param rotuloPadrao  o que a barra mostra quando a linha nao se nomeia
 * @returns true quando a linha foi consumida pela barra
 */
export function consumirProgresso(
    terminal: TerminalDaSimulacao, terminalId: string, linha: string, rotuloPadrao: string,
): boolean {
    const p = lerProgresso(linha, { rotuloPadrao });
    if (!p) return false;
    terminal.renderHardwareProgress?.(terminalId, {
        pct: p.pct,
        cyc: p.cyc,
        total: p.total,
        reads: p.reads,
        label: p.label,
        done: p.done,
    });
    return true;
}

/**
 * Um lembrete quando a simulacao comeca com o laptop na bateria.
 *
 * Na bateria o Windows corta o clock da CPU, e uma simulacao longa fica
 * visivelmente mais lenta; quem nao sabe disso conclui que a AURORA e lenta.
 * Uma linha de dica, uma vez por corrida: sem alerta modal e sem mexer no plano
 * de energia, que e escolha do dono da maquina. Num desktop o main responde
 * false e nada aparece.
 */
export async function avisarSeNaBateria(terminal: TerminalDaSimulacao, terminalId: string): Promise<void> {
    try {
        if (typeof electronAPI.isOnBattery !== 'function') return;
        if (await electronAPI.isOnBattery()) {
            terminal.appendToTerminal(terminalId, tr('terminal.wave.onBattery'), 'tips');
        }
    } catch (_e) { /* dica e cortesia */ }
}

/**
 * Vigia o tamanho do arquivo de onda enquanto a simulacao roda.
 *
 * Recebe os caminhos CANDIDATOS (o nome vem do $dumpfile do testbench, e a
 * extensao varia por simulador), adota o primeiro que aparecer no disco e
 * atualiza o pill do TWAVE ate `stop()`. Melhor esforco por inteiro: falha de
 * stat nao para o vigia nem a simulacao.
 *
 * @returns stop: a ultima leitura, marcada `done`
 */
export function vigiarTamanhoDoDump(terminal: TerminalDaSimulacao, candidatos: string[]): () => Promise<void> {
    let alvo: string | null = null;
    let vivo = true;
    const medir = async (final = false) => {
        try {
            if (!alvo) {
                for (const c of candidatos) {
                    if (await electronAPI.fileExists(c)) { alvo = c; break; }
                }
                if (!alvo) return;
            }
            const st = await electronAPI.getFileStats(alvo);
            if (!vivo && !final) return; // stat resolveu depois do stop
            terminal.renderDumpSize?.('twave', {
                name: alvo.split(/[\\/]/).pop() as string,
                path: alvo,
                bytes: st?.size ?? 0,
                done: final,
            });
        } catch (_e) { /* dump ainda nao existe, ou sumiu no meio */ }
    };
    const timer = setInterval(() => { if (vivo) medir(false); }, 700);
    return async () => {
        vivo = false;
        clearInterval(timer);
        await medir(true);
    };
}
