/**
 * tabelas_do_yanc.ts: as tabelas que o yanc deixa na pasta de saida de cada
 * processador e que a forma de onda le.
 *
 * Desde o yanc v7.1 elas moram em <proj>/<proc>/<proc>/ (pastas_do_processador.ts):
 * trad_opcode.txt (o mnemonico de cada opcode), src_lines.txt (o texto de
 * cada linha do fonte, como a pessoa escreveu) e prog_log.txt, que anota numa
 * linha `lang` se o fonte e C± ou C++. Antes eram trad_cmm.txt e cmm_log.txt,
 * na .aurora/Temp/<proc>.
 *
 * Os escritores de layout (gtkw_proc_writer.ts, surfer_layout_writer.ts) sao
 * puros; quem le o disco por eles e este modulo.
 *
 * Compilado por `tsc` (npm run build:ts) num tabelas_do_yanc.js ao lado, e
 * esse .js que o runtime carrega; os imports usam a extensao `.js`.
 */

import { electronAPI } from '../app/electron_api.js';
import {
    arquivosDaSaida, linguagemDoProgLog, nomesDosProcessadores, segmentosDaSaida,
} from './pastas_do_processador.js';

/**
 * O nome da trilha do fonte de cada processador, pela linha `lang` do
 * prog_log.txt: `{ filtro: 'C++' }`. Processador sem prog_log, ou com um de
 * antes da v7.1, fica de fora, e o escritor cai no `C+-` de sempre.
 */
export async function linguagensDosProcessadores(
    projectPath: string | null | undefined, processors: unknown,
): Promise<Record<string, string>> {
    const saida: Record<string, string> = {};
    if (!projectPath) return saida;
    for (const nome of nomesDosProcessadores(processors)) {
        try {
            const log = await electronAPI.joinPath(
                projectPath, ...segmentosDaSaida(nome), arquivosDaSaida(nome).progLog);
            if (!await electronAPI.fileExists(log)) continue;
            const lang = linguagemDoProgLog(await electronAPI.readFile(log, { encoding: 'utf8' }));
            if (lang) saida[nome] = lang;
        } catch { /* prog_log ilegivel: fica o padrao */ }
    }
    return saida;
}
