/**
 * Tipos de tab_manager.js, para os modulos .ts salvarem os buffers abertos
 * antes de compilar sem o tsc reclamar de modulo sem declaracao. Mesma razao
 * do electron_api.d.ts ao lado do electron_api.js.
 *
 * Declaracao MUITO PARCIAL, e de proposito: o TabManager real tem dezenas de
 * metodos estaticos e quase dois mil linhas. Aqui mora so o que os .ts ja
 * migrados chamam. Acrescente o proximo quando ele for preciso, e apague o
 * arquivo quando o tab_manager.js virar .ts.
 */

export const TabManager: {
  /** Grava todos os buffers sujos. Os passos de compilacao chamam antes de rodar. */
  saveAllFiles(): Promise<void>;
  /** Caminho do arquivo em foco, ou vazio quando nao ha nenhum. */
  getEditingFilePath?(): string;
};
