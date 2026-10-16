/**
 * aviso_do_campo.ts: o retorno visual de um campo recusado, um só para o modal
 * de projeto novo e o Processor Hub (#187).
 *
 * A borda diz que algo está errado; a frase embaixo diz o quê, e é ela que
 * resolve o problema para quem lê. Os dois formulários tinham bordas
 * diferentes, e só o de projeto dizia o motivo.
 *
 * A frase vai para o `.form-group` do campo, e não para o pai direto: o campo
 * de pasta mora numa linha com o botão de procurar, e a frase ali dentro
 * espremia os dois.
 */

/** Onde a frase do campo mora. */
function grupoDo(campo: HTMLElement): HTMLElement | null {
  return campo.closest<HTMLElement>('.form-group') ?? campo.parentElement;
}

/**
 * Pinta o campo como recusado e, com `texto`, escreve o motivo embaixo. Sem
 * `texto`, só a borda, e some a frase que houvesse.
 */
export function marcarCampo(campo: HTMLElement | null, texto = ''): void {
  if (!campo) return;
  // `important` porque o .form-input tem borda propria no :focus.
  campo.style.setProperty('border', '3px solid var(--status-error)', 'important');
  campo.style.setProperty('box-shadow', '0 0 6px rgba(255, 68, 68, 0.4)', 'important');
  campo.style.setProperty('outline', 'none', 'important');
  escrever(campo, texto);
}

/** Devolve o campo ao normal, sem borda nem frase. */
export function limparCampo(campo: HTMLElement | null): void {
  if (!campo) return;
  campo.style.removeProperty('border');
  campo.style.removeProperty('box-shadow');
  campo.style.removeProperty('outline');
  escrever(campo, '');
}

function escrever(campo: HTMLElement, texto: string): void {
  const grupo = grupoDo(campo);
  if (!grupo) return;
  let aviso = grupo.querySelector(':scope > .campo-aviso');
  if (!texto) { aviso?.remove(); return; }
  if (!aviso) {
    aviso = document.createElement('p');
    aviso.className = 'campo-aviso';
    grupo.appendChild(aviso);
  }
  aviso.textContent = texto;
}
