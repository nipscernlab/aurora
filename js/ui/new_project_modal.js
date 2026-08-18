import { electronAPI } from '../app/electron_api.js';
import { projectManager } from '../project/project_manager.js';
import { showDialog } from './dialog_manager.js';

document.addEventListener("DOMContentLoaded", () => {
    const newProjectModal = document.getElementById("newProjectModal");
    const newProjectBtn = document.getElementById("newProjectBtn");
    const newProjectBtnWelcome = document.getElementById("newProjectBtnWelcome");
    
    const projectNameInput = document.getElementById('projectNameInput');
    const projectLocationInput = document.getElementById('projectLocationInput');

    const nameRegex = /^[a-zA-Z0-9_-]+$/;
    const pathRegex = /^[a-zA-Z0-9_:\\/.-]+$/;

    const setErrorStyle = (element) => {
        element.style.border = "1px solid rgba(255, 82, 82, 0.8)"; 
        element.style.boxShadow = "0 0 5px rgba(255, 82, 82, 0.2)"; 
        element.style.transition = "border 0.3s ease";
    };

    const resetInputStyle = (element) => {
        element.style.border = "";
        element.style.boxShadow = "";
    };

    const validateInput = (element, regex) => {
        const value = element.value;
        
        if (!regex.test(value)) {
            setErrorStyle(element);
            return false;
        } else {
            resetInputStyle(element);
            return true;
        }
    };

    projectNameInput.addEventListener('input', () => {
        validateInput(projectNameInput, nameRegex);
    });

    projectLocationInput.addEventListener('input', () => {
        validateInput(projectLocationInput, pathRegex);
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
                validateInput(projectLocationInput, pathRegex);
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

            const isNameValid = validateInput(projectNameInput, nameRegex);
            const isLocationValid = validateInput(projectLocationInput, pathRegex);

            if (!isNameValid || !isLocationValid) {
                await showDialog({
                    title: tr('dialog.newProject.invalidInputTitle'),
                    message: tr('dialog.newProject.invalidInputMessage'),
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

                await new Promise(resolve => setTimeout(resolve, 1000));

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