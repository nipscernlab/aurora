// Aguarda o DOM ser totalmente carregado para garantir que todos os elementos HTML estejam disponíveis.
document.addEventListener('DOMContentLoaded', () => {

    // --- Seleção de Elementos ---
    const processorHubButton = document.getElementById('processorHub');
    const form = document.getElementById('processorHubForm');
    const generateButton = document.getElementById('generateProcessor');

    // Inputs do formulário
    const nBitsInput = document.getElementById('nBits');
    const nbMantissaInput = document.getElementById('nbMantissa');
    const nbExponentInput = document.getElementById('nbExponent');
    const gainInput = document.getElementById('gain');
    const processorNameInput = document.getElementById('processorName');

    // --- Gerenciamento de Estado ---
    let currentProjectPath = null;

    // --- Listeners de IPC (Comunicação com o Processo Principal) ---

    // 1. Ouve o evento que habilita/desabilita o botão do Processor Hub.
    if (window.electronAPI && window.electronAPI.onProcessorHubState) {
        window.electronAPI.onProcessorHubState((state) => {
            console.log('Estado do Processor Hub recebido do processo principal:', state);
            processorHubButton.disabled = false;
        });
    } else {
        console.error('A função onProcessorHubState não está disponível em window.electronAPI!');
    }

    // 2. Ouve o evento que envia a lista de processadores e o caminho do projeto.
    if (window.electronAPI && window.electronAPI.onProcessorsUpdated) {
        window.electronAPI.onProcessorsUpdated((data) => {
            console.log('Dados do projeto recebidos. Caminho do projeto:', data.projectPath);
            currentProjectPath = data.projectPath;
        });
    } else {
        console.error('A função onProcessorsUpdated não está disponível em window.electronAPI!');
    }

    // --- Funções de Validação ---
    function isPowerOfTwo(value) {
        return value > 0 && (value & (value - 1)) === 0;
    }

    function validateCustomRules() {
        if (!form) return;

        const nBits = parseInt(nBitsInput.value) || 0;
        const nbMantissa = parseInt(nbMantissaInput.value) || 0;
        const nbExponent = parseInt(nbExponentInput.value) || 0;
        const gain = parseInt(gainInput.value) || 0;

        const isNBitsValid = nBits === nbMantissa + nbExponent + 1;
        const isGainValid = isPowerOfTwo(gain);

        nBitsInput.setCustomValidity(isNBitsValid ? '' : 'O Total de Bits deve ser igual a Mantissa + Expoente + 1');
        gainInput.setCustomValidity(isGainValid ? '' : 'O Ganho (Gain) deve ser uma potência de 2');

        generateButton.disabled = !form.checkValidity();
    }

    // --- Listeners de Eventos da UI ---

    [nBitsInput, nbMantissaInput, nbExponentInput, gainInput, processorNameInput].forEach(input => {
        if (input) {
            input.addEventListener('input', validateCustomRules);
        }
    });

    // Manipula o envio do formulário.
// Substituir a seção do submit do formulário por esta versão corrigida
if (form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentProjectPath) {
            console.error('Nenhum caminho de projeto disponível. Não é possível criar o processador.');
            if (window.electronAPI && window.electronAPI.showErrorDialog) {
                window.electronAPI.showErrorDialog('Erro', 'Nenhum projeto está aberto. Abra ou crie um projeto antes de gerar um processador.');
            }
            return;
        }

        const processorName = processorNameInput.value;
        if (!processorName || processorName.trim() === '') {
            console.error('O nome do processador é obrigatório');
            return;
        }

        const originalButtonText = generateButton.innerHTML;
        generateButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Gerando...</span>';
        generateButton.disabled = true;

        const formData = {
            projectLocation: currentProjectPath,
            processorName: processorName,
            nBits: parseInt(nBitsInput.value),
            nbMantissa: parseInt(nbMantissaInput.value),
            nbExponent: parseInt(nbExponentInput.value),
            dataStackSize: parseInt(document.getElementById('dataStackSize').value),
            instructionStackSize: parseInt(document.getElementById('instructionStackSize').value),
            inputPorts: parseInt(document.getElementById('inputPorts').value),
            outputPorts: parseInt(document.getElementById('outputPorts').value),
            gain: parseInt(gainInput.value),
        };

        console.log('Dados do formulário enviados para o processo principal:', formData);

        try {
            const result = await window.electronAPI.createProcessorProject(formData);

            if (result && result.success) {
                console.log('Projeto do processador criado com sucesso.');
                
                // CORREÇÃO CRÍTICA: Aguardar sistema de arquivos estabilizar
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // CORREÇÃO: Chamar o novo método de refresh
                try {
                    console.log('Disparando atualização da file tree...');
                    await window.electronAPI.triggerFileTreeRefresh();
                    console.log('File tree atualizada com sucesso');
                } catch (refreshError) {
                    console.error('Erro ao atualizar file tree:', refreshError);
                }
                
                // Mostrar notificação de sucesso
                if (typeof showCardNotification === 'function') {
                    showCardNotification(`Processador "${processorName}" criado com sucesso!`, 'success', 3000);
                }
            } else {
                throw new Error(result.message || 'Falha ao criar o projeto do processador.');
            }
        } catch (error) {
            console.error('Erro ao criar projeto do processador:', error);
            if (window.electronAPI && window.electronAPI.showErrorDialog) {
                window.electronAPI.showErrorDialog('Falha na Criação', `Ocorreu um erro: ${error.message}`);
            }
        } finally {
            generateButton.innerHTML = originalButtonText;
            validateCustomRules();
        }
    });
}

    // --- Configuração Inicial ---
    processorHubButton.disabled = true;
    validateCustomRules();
});