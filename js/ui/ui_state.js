/**
 * ui_state.js — preenche o status indicator do rodape (#compmode)
 * com "Project Mode" + icone na primeira pintura.
 *
 * O nome "UIStateManager" vem da epoca em que Aurora tinha 3 modos
 * (Processor / Project / Verilog) e essa classe gerenciava a
 * transicao entre eles, escondendo botoes/abas, fading o body, etc.
 * Hoje so existe Project Mode — todo esse aparato saiu na fase 2.5.
 *
 * O indicator em si ainda existe pra contexto visual ao usuario; se
 * voce decidir tira-lo, pode apagar este arquivo + a entry em
 * index.html (procurar por #compmode).
 */

const MODE_LABEL = 'Project Mode';
const MODE_ICON = 'fa-solid fa-compass-drafting';

function paintStatusIndicator() {
    const statusElement = document.getElementById('compmode');
    if (!statusElement) {
        console.warn('Status element #compmode not found');
        return;
    }

    statusElement.classList.add('status-fading');

    // Espera o fade-out completar antes de trocar conteudo.
    setTimeout(() => {
        const iconElement = statusElement.querySelector('i');
        if (iconElement) {
            iconElement.className = '';
            MODE_ICON.split(' ').forEach(cls => iconElement.classList.add(cls));
        }
        const textElement = statusElement.querySelector('#compmode-text');
        if (textElement) {
            textElement.textContent = ` ${MODE_LABEL}`;
        } else {
            console.warn('Text element #compmode-text not found inside status indicator.');
        }
        // Fade-in.
        setTimeout(() => statusElement.classList.remove('status-fading'), 50);
    }, 200);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintStatusIndicator);
} else {
    paintStatusIndicator();
}
