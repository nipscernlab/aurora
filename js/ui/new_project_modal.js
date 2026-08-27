import { electronAPI } from '../app/electron_api.js';
import { projectManager } from '../project/project_manager.js';
import { showDialog } from './dialog_manager.js';
import { analisarNomeDeProjeto, analisarCaminhoDeProjeto, explicar } from '../project/path_rules.js';

document.addEventListener("DOMContentLoaded", () => {
    const newProjectModal = document.getElementById("newProjectModal");
    const newProjectBtn = document.getElementById("newProjectBtn");
    const newProjectBtnWelcome = document.getElementById("newProjectBtnWelcome");
    
    const projectNameInput = document.getElementById('projectNameInput');
    const projectLocationInput = document.getElementById('projectLocationInput');

    // A validacao vive em js/project/path_rules.js, com teste.
    //
    // O que havia aqui eram dois regex, e os dois erravam de lados opostos. O do
    // caminho recusava ate espaco simples, entao "Meus Projetos" era barrado sem
    // motivo. E, quando barrava, a unica resposta era pintar a borda de vermelho
    // e um dialogo dizendo "entrada invalida", sem dizer qual caractere nem por
    // que ele impede, que e justamente a informacao que resolve o problema.

    const setErrorStyle = (element) => {
        element.style.border = "1px solid rgba(255, 82, 82, 0.8)"; 
        element.style.boxShadow = "0 0 5px rgba(255, 82, 82, 0.2)"; 
        element.style.transition = "border 0.3s ease";
    };

    const resetInputStyle = (element) => {
        element.style.border = "";
        element.style.boxShadow = "";
    };

    /** Mostra ou some com a explicacao logo abaixo do campo. */
    const mostrarMotivo = (element, texto) => {
        let aviso = element.parentElement.querySelector('.campo-aviso');
        if (!texto) { aviso?.remove(); return; }
        if (!aviso) {
            aviso = document.createElement('p');
            aviso.className = 'campo-aviso';
            element.parentElement.appendChild(aviso);
        }
        aviso.textContent = texto;
    };

    /** Valida um campo com a regra dada e explica na tela quando recusa. */
    const validateInput = (element, analisar) => {
        const r = analisar(element.value.trim());
        if (r.ok) {
            resetInputStyle(element);
            mostrarMotivo(element, '');
            return true;
        }
        setErrorStyle(element);
        mostrarMotivo(element, explicar(r));
        return false;
    };

    projectNameInput.addEventListener('input', () => {
        // Campo vazio nao e erro enquanto se digita: o aviso de obrigatorio e
        // do envio, e reclamar antes da primeira tecla e ruido.
        if (!projectNameInput.value.trim()) {
            resetInputStyle(projectNameInput); mostrarMotivo(projectNameInput, ''); return;
        }
        validateInput(projectNameInput, analisarNomeDeProjeto);
    });

    projectLocationInput.addEventListener('input', () => {
        if (!projectLocationInput.value.trim()) {
            resetInputStyle(projectLocationInput); mostrarMotivo(projectLocationInput, ''); return;
        }
        validateInput(projectLocationInput, analisarCaminhoDeProjeto);
    });

    const openModal = () => {
        newProjectModal.setAttribute('aria-hidden', 'false');
        resetInputStyle(projectNameInput);
        resetInputStyle(projectLocationInput);
    };

    if(newProjectBtn) newProjectBtn.addEventListener("click", openModal);
    if(newProjectBtnWelcome) newProjectBtnWelcome.addEventListener("click", openModal);

    document.getElementById('browseBtn').addEventListener('click', async () => {
        try {
            // Open the dialog at the last "new project" location the
            // user picked, falling back to ~/Documents on the main side
            // when this is the first time. Without this, Windows opens
            // the dialog inside the currently-loaded project folder
            // (process's last-used dir) and the user accidentally
            // creates Project-B nested under Project-A.
            const lastLocation = localStorage.getItem('aurora-last-new-project-location') || undefined;
            const folderPath = await electronAPI.selectDirectory({ defaultPath: lastLocation });

            if (folderPath) {
                projectLocationInput.value = folderPath;
                // Validar aqui e o que mais importa: o campo e readonly, entao
                // a pasta quase sempre chega pelo seletor, e nao digitada.
                validateInput(projectLocationInput, analisarCaminhoDeProjeto);
            }
        } catch (error) {
            console.error(error);
        }
    });

    document.getElementById('generateProjectBtn').addEventListener('click', async () => {
        try {
            const projectName = projectNameInput.value.trim();
            const projectLocation = projectLocationInput.value.trim();

            // tr() is a tiny wrapper around window.t, falls back to the
            // English key path if i18n hasn't booted yet (rare but possible
            // during very early renderer init).
            const tr = (k) => (window.t ? window.t(k) : k);

            if (!projectName || !projectLocation) {
                await showDialog({
                    title: tr('dialog.newProject.missingInfoTitle'),
                    message: tr('dialog.newProject.missingInfoMessage'),
                    buttons: [{ label: tr('dialog.common.ok'), action: 'ok', type: 'save' }]
                });
                return;
            }

            const rNome = analisarNomeDeProjeto(projectName);
            const rLocal = analisarCaminhoDeProjeto(projectLocation);
            validateInput(projectNameInput, analisarNomeDeProjeto);
            validateInput(projectLocationInput, analisarCaminhoDeProjeto);

            if (!rNome.ok || !rLocal.ok) {
                // A mensagem diz o que impede, e nao so que algo impede. O
                // erro antigo aparecia depois, vindo de uma ferramenta de linha
                // de comando, e nao havia como ligar aquilo ao nome da pasta.
                const problemas = [
                    !rNome.ok ? `Nome do projeto: ${explicar(rNome)}` : '',
                    !rLocal.ok ? `Pasta: ${explicar(rLocal)}` : '',
                ].filter(Boolean).join('\n\n');
                await showDialog({
                    title: tr('dialog.newProject.invalidInputTitle'),
                    message: problemas,
                    buttons: [{ label: tr('dialog.common.understood'), action: 'ok', type: 'save' }]
                });
                return;
            }

            const projectPath = `${projectLocation}\\${projectName}`;
            const spfPath = `${projectPath}\\${projectName}.spf`;

            const result = await electronAPI.createProjectStructure(projectPath, spfPath, projectName);

            if (result.success) {
                // Remember this location so the next New Project
                // dialog opens at the same parent directory, sibling
                // projects are the common case.
                try {
                    localStorage.setItem('aurora-last-new-project-location', projectLocation);
                } catch (_e) { /* localStorage failure is non-fatal */ }

                closeNewProjectModal();

                // The .spf is on disk once createProjectStructure resolves;
                // the fixed one-second sleep that used to sit here only made
                // the first project of the day feel slow.
                await projectManager.loadProject(spfPath);

            } else {
                throw new Error('Failed to create project structure');
            }

        } catch (error) {
            console.error(error);
            const tr = (k) => (window.t ? window.t(k) : k);
            await showDialog({
                title: tr('dialog.newProject.generationErrorTitle'),
                message: tr('dialog.newProject.generationErrorMessage'),
                buttons: [{ label: tr('dialog.common.close'), action: 'close', type: 'cancel' }]
            });
        }
    });

    function closeNewProjectModal() {
        newProjectModal.setAttribute('aria-hidden', 'true');
        projectNameInput.value = '';
        projectLocationInput.value = '';
        resetInputStyle(projectNameInput);
        resetInputStyle(projectLocationInput);
    }

    document.getElementById('cancelProjectBtn').addEventListener('click', closeNewProjectModal);
});