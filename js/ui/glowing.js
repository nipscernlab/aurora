/* ========================================================== */
/*                      glowing.js CORRIGIDO                    */
/* ========================================================== */

// CORREÇÃO: Remova as chaves {} ao redor de Glowing.
// Isso importa a "exportação padrão" do módulo.
import Glowing from 'https://cdn.jsdelivr.net/npm/glowing/dist/index.js';

// O resto do seu código permanece EXATAMENTE O MESMO.

const glowOptions = {
    "Verilog Mode": {
        colors: ['#00b907', '#0aff0f', '#00b907'],
        width: 2
    },
    "Processor Mode": {
        colors: ['#67b6d5', '#87ceeb', '#67b6d5'],
        width: 2
    },
    "Project Mode": {
        colors: ['#a92218', '#e74c3c', '#a92218'],
        width: 2
    }
};

let currentGlow = null;
const radioButtons = document.querySelectorAll('.toggle-group input[type="radio"]');

function updateGlow(selectedRadio) {
    if (currentGlow) {
        currentGlow.remove();
        currentGlow = null;
    }

    const selectedLabel = document.querySelector(`label[for="${selectedRadio.id}"]`);
    const options = glowOptions[selectedRadio.id];

    if (selectedLabel && options) {
        // Agora 'Glowing' é a classe correta, importada como padrão.
        currentGlow = new Glowing(selectedLabel, {
            ...options,
            borderRadius: '8px'
        });
        currentGlow.show();
    }
}

radioButtons.forEach(radio => {
    radio.addEventListener('change', (event) => {
        if (event.target.checked) {
            updateGlow(event.target);
        }
    });
});

const initiallyChecked = document.querySelector('.toggle-group input[type="radio"]:checked');
if (initiallyChecked) {
    updateGlow(initiallyChecked);
}