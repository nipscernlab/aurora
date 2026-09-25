/**
 * Tipos de processor_config_panel.js, para os modulos .ts que o importam sem o
 * tsc reclamar de modulo sem declaracao. Mesma razao do tab_manager.d.ts.
 *
 * Declaracao PARCIAL, de proposito: so o que os .ts ja migrados usam.
 * Acrescente o proximo quando ele for preciso, e apague o arquivo quando o
 * processor_config_panel.js virar .ts.
 */

export const processorConfigPanel: {
  /** Relê o .spf e redesenha o painel, se ele estiver aberto. */
  refresh(): unknown;
};
