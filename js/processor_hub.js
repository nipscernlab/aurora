// Aguarda o DOM ser totalmente carregado para garantir que todos os elementos HTML estejam disponíveis.
document.addEventListener('DOMContentLoaded', () => {

    // --- Seleção de Elementos ---
    // Selecionamos todos os elementos do formulário do Processor Hub que já existem no HTML.
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
    // Esta variável armazenará o caminho do projeto atual, que será recebido do processo principal do Electron.
    let currentProjectPath = null;

    // --- Listeners de IPC (Comunicação com o Processo Principal) ---
    // Esta parte é crucial. O script "ouve" eventos enviados pelo seu arquivo main.js.

    // 1. Ouve o evento que habilita/desabilita o botão do Processor Hub.
    if (window.electronAPI && window.electronAPI.onProcessorHubState) {
        window.electronAPI.onProcessorHubState((state) => {
            console.log('Estado do Processor Hub recebido do processo principal:', state);
            // Habilita ou desabilita o botão com base na mensagem.
            // O botão só deve estar ativo quando um projeto estiver aberto.
            processorHubButton.disabled = false;
        });
    } else {
        console.error('A função onProcessorHubState não está disponível em window.electronAPI!');
    }

    // 2. Ouve o evento que envia a lista de processadores e, mais importante, o caminho do projeto.
    if (window.electronAPI && window.electronAPI.onProcessorsUpdated) {
        window.electronAPI.onProcessorsUpdated((data) => {
            console.log('Dados do projeto recebidos. Caminho do projeto:', data.projectPath);
            // Define a variável local 'currentProjectPath' com o caminho recebido.
            currentProjectPath = data.projectPath;
        });
    } else {
        console.error('A função onProcessorsUpdated não está disponível em window.electronAPI!');
    }


    // --- Funções de Validação ---
    /**
     * Função auxiliar para verificar se um número é uma potência de 2.
     * @param {number} value - O número a ser verificado.
     * @returns {boolean}
     */
    function isPowerOfTwo(value) {
        return value > 0 && (value & (value - 1)) === 0;
    }

    /**
     * Realiza a validação em tempo real das regras customizadas do formulário.
     */
    function validateCustomRules() {
        // Garante que o formulário exista antes de tentar validar
        if (!form) return;

        const nBits = parseInt(nBitsInput.value) || 0;
        const nbMantissa = parseInt(nbMantissaInput.value) || 0;
        const nbExponent = parseInt(nbExponentInput.value) || 0;
        const gain = parseInt(gainInput.value) || 0;

        const isNBitsValid = nBits === nbMantissa + nbExponent + 1;
        const isGainValid = isPowerOfTwo(gain);

        // Aplica a validação customizada aos campos
        nBitsInput.setCustomValidity(isNBitsValid ? '' : 'O Total de Bits deve ser igual a Mantissa + Expoente + 1');
        gainInput.setCustomValidity(isGainValid ? '' : 'O Ganho (Gain) deve ser uma potência de 2');

        // Habilita ou desabilita o botão de gerar com base na validade geral do formulário
        generateButton.disabled = !form.checkValidity();
    }


    // --- Listeners de Eventos da UI ---

    // Adiciona validação em tempo real para cada campo relevante.
    [nBitsInput, nbMantissaInput, nbExponentInput, gainInput, processorNameInput].forEach(input => {
        if (input) {
            input.addEventListener('input', validateCustomRules);
        }
    });

    // Manipula o envio do formulário.
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault(); // Impede o recarregamento da página

            // A verificação do 'currentProjectPath' agora funcionará, pois ele é atualizado pelo listener do IPC.
            if (!currentProjectPath) {
                console.error('Nenhum caminho de projeto disponível. Não é possível criar o processador.');
                // Opcional: Mostrar um diálogo de erro para o usuário
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

            // Mostra o estado de carregamento no botão
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
                pipeln: parseInt(document.getElementById('pipeln').value),
                gain: parseInt(gainInput.value),
            };

            console.log('Dados do formulário enviados para o processo principal:', formData);

            try {
                const result = await window.electronAPI.createProcessorProject(formData);

                if (result && result.success) {
                    console.log('Projeto do processador criado com sucesso.');
                    // O modal já será fechado pelo seu script principal, então não precisamos chamar closeModal() aqui.
                    
                    // Atualiza a árvore de arquivos para mostrar o novo processador
                    if(window.electronAPI && window.electronAPI.refreshFileTree) {
                        await window.electronAPI.refreshFileTree();
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
                // Sempre restaura o estado do botão, seja em caso de sucesso ou falha.
                generateButton.innerHTML = originalButtonText;
                validateCustomRules(); // Revalida para definir o estado correto do botão
            }
        });
    }

    // --- Configuração Inicial ---
    // Desabilita o botão principal da barra de ferramentas inicialmente.
    // O listener de IPC 'onProcessorHubState' irá habilitá-lo quando um projeto for aberto.
    processorHubButton.disabled = true;

    // Realiza uma validação inicial para definir o estado correto do botão "Generate"
    validateCustomRules();
});