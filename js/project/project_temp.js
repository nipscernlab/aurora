/**
 * project_temp.js: onde ficam os intermediarios de compilacao de um projeto.
 *
 * Ate 09/2026 tudo ia para components/Temp, uma pasta so para o aplicativo
 * inteiro, e o nome de cada artefato vinha do modulo do testbench: dois
 * projetos com um `contador_tb.v` escreviam no MESMO `contador_tb.vvp`, no
 * mesmo `instr_contador_tb.v`, no mesmo `obj_dir_contador_tb/`. Com duas
 * janelas abertas, quem compilava por ultimo ganhava, e a outra janela
 * rodava o binario do projeto alheio sem erro nenhum na tela. Foi assim que
 * um aluno viu o testbench de um projeto aparecer na compilacao do outro.
 *
 * Agora cada projeto tem a sua: `<projeto>/.aurora/Temp`. Duas janelas com
 * projetos diferentes nao se tocam. A pasta e escondida na arvore
 * (main/ipc/files_ops.js) e recebe o atributo oculto do Windows quando o
 * projeto abre (main/project_temp.js), que tambem e quem poda o que ficou
 * velho ou grande demais. O `obj_dir` do Verilator sobrevive entre sessoes
 * de proposito: o make dele decide o que recompilar pelo mtime, e apagar a
 * pasta a cada saida jogava fora de 5 a 15 s de build por clique.
 *
 * components/Temp continua existindo para o que nao e de projeto nenhum
 * (o PRISM, por exemplo, que roda numa janela propria com caminhos que o
 * main deriva sozinho).
 */

import { electronAPI } from '../app/electron_api.js';

/** Os dois segmentos, na ordem, para quem monta caminho sem joinPath. */
export const PROJECT_TEMP_SEGMENTS = Object.freeze(['.aurora', 'Temp']);

/**
 * `<projectPath>/.aurora/Temp`, com o separador da plataforma.
 *
 * @param {string} projectPath pasta do projeto (a do `.spf`)
 * @returns {Promise<string>}
 */
export async function projectTempDir(projectPath) {
    if (!projectPath) throw new Error('projectTempDir: projeto sem caminho');
    return electronAPI.joinPath(projectPath, ...PROJECT_TEMP_SEGMENTS);
}
