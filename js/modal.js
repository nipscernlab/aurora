import { projectManager } from './project_manager.js';
import { showDialog } from './dialogManager.js';

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
        newProjectModal.classList.remove("hidden");
        resetInputStyle(projectNameInput);
        resetInputStyle(projectLocationInput);
    };

    if(newProjectBtn) newProjectBtn.addEventListener("click", openModal);
    if(newProjectBtnWelcome) newProjectBtnWelcome.addEventListener("click", openModal);

    document.getElementById('browseBtn').addEventListener('click', async () => {
        try {
            const folderPath = await window.electronAPI.selectDirectory();
            
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

            if (!projectName || !projectLocation) {
                await showDialog({
                    title: 'Missing Information',
                    message: 'Please enter both the Project Name and Project Location.',
                    buttons: [{ label: 'OK', action: 'ok', type: 'save' }]
                });
                return;
            }

            const isNameValid = validateInput(projectNameInput, nameRegex);
            const isLocationValid = validateInput(projectLocationInput, pathRegex);

            if (!isNameValid || !isLocationValid) {
                await showDialog({
                    title: 'Invalid Input',
                    message: 'Project Name and Location must not contain spaces or special symbols. Use only letters, numbers, underscores, or hyphens.',
                    buttons: [{ label: 'Understood', action: 'ok', type: 'save' }]
                });
                return; 
            }

            const projectPath = `${projectLocation}\\${projectName}`;
            const spfPath = `${projectPath}\\${projectName}.spf`;

            const result = await window.electronAPI.createProjectStructure(projectPath, spfPath, projectName);

            if (result.success) {
                closeNewProjectModal();

                await new Promise(resolve => setTimeout(resolve, 1000));

                await projectManager.loadProject(spfPath);

            } else {
                throw new Error('Failed to create project structure');
            }

        } catch (error) {
            console.error(error);
            await showDialog({
                title: 'Generation Error',
                message: 'Failed to create the project. Please check the console for details.',
                buttons: [{ label: 'Close', action: 'close', type: 'cancel' }]
            });
        }
    });

    function closeNewProjectModal() {
        newProjectModal.classList.add('hidden');
        projectNameInput.value = '';
        projectLocationInput.value = '';
        resetInputStyle(projectNameInput);
        resetInputStyle(projectLocationInput);
    }

    document.getElementById('cancelProjectBtn').addEventListener('click', closeNewProjectModal);
});