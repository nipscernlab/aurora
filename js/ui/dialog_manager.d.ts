/**
 * Tipos de dialog_manager.js, para os modulos .ts abrirem os dialogos da
 * AURORA sem o tsc reclamar de modulo sem declaracao. Mesma razao do
 * electron_api.d.ts ao lado do electron_api.js.
 *
 * Declaracao PARCIAL: so o `showDialog`, que e o que os .ts ja migrados
 * chamam. O modulo tem outras saidas; acrescente a proxima quando ela for
 * precisa, e apague este arquivo quando o dialog_manager.js virar .ts.
 */

export interface BotaoDeDialogo {
  label: string;
  /** o que a promessa resolve quando este botao e apertado */
  action: string;
  /** muda a cara do botao: 'primary' e o principal, 'cancel' o discreto */
  type?: 'primary' | 'cancel' | 'danger' | 'save' | string;
}

export interface OpcoesDeDialogo {
  title: string;
  message: string;
  buttons: BotaoDeDialogo[];
  variant?: 'info' | 'warning' | 'danger' | 'success' | string;
  /** chave da tabela de ajuda (js/ui/help_link.js) */
  ajuda?: string;
  lista?: string[];
}

/** Resolve com o `action` do botao apertado. */
export function showDialog(opcoes: OpcoesDeDialogo): Promise<string>;
