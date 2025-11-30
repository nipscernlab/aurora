import { projectManager } from './project_manager.js';
import { showDialog } from './dialogManager.js';

document.addEventListener("DOMContentLoaded", () => {
    const newProjectModal = document.getElementById("newProjectModal");
    const newProjectBtn = document.getElementById("newProjectBtn");
    const newProjectBtnWelcome = document.getElementById("newProjectBtnWelcome");
    
    // Input Elements
    const projectNameInput = document.getElementById('projectNameInput');
    const projectLocationInput = document.getElementById('projectLocationInput');

    // --- Styling Helpers ---

    const setErrorStyle = (element) => {
        element.style.border = "1px solid rgba(255, 82, 82, 0.8)"; // Soft red
        element.style.boxShadow = "0 0 5px rgba(255, 82, 82, 0.2)"; // Slight glow
        element.style.transition = "border 0.3s ease";
    };

    const resetInputStyle = (element) => {
        element.style.border = "";
        element.style.boxShadow = "";
    };

    /**
     * Checks if the input contains spaces.
     * Applies error style if spaces are found, removes it otherwise.
     * @param {HTMLElement} element - The input element to validate
     * @returns {boolean} - Returns false if invalid (has spaces), true if valid.
     */
    const validateInput = (element) => {
        const value = element.value;
        const hasSpaceRegex = /\s/;

        if (hasSpaceRegex.test(value)) {
            setErrorStyle(element);
            return false; // Invalid
        } else {
            resetInputStyle(element);
            return true; // Valid
        }
    };

    // --- Event Listeners for Live Validation ---

    // 1. Live check for Project Name (typing)
    projectNameInput.addEventListener('input', () => {
        validateInput(projectNameInput);
    });

    // --- Modal Logic ---

    // Open Modal Handlers
    const openModal = () => {
        newProjectModal.classList.remove("hidden");
        // Reset styles and values when opening fresh
        resetInputStyle(projectNameInput);
        resetInputStyle(projectLocationInput);
    };

    if(newProjectBtn) newProjectBtn.addEventListener("click", openModal);
    if(newProjectBtnWelcome) newProjectBtnWelcome.addEventListener("click", openModal);

    // Handle "Browse" Button
    document.getElementById('browseBtn').addEventListener('click', async () => {
        try {
            const folderPath = await window.electronAPI.selectDirectory();
            
            if (folderPath) {
                projectLocationInput.value = folderPath;
                // Trigger live validation immediately after selection
                validateInput(projectLocationInput);
            }
        } catch (error) {
            console.error('Error selecting directory:', error);
        }
    });

    // Handle "Generate Project" Button
    document.getElementById('generateProjectBtn').addEventListener('click', async () => {
        try {
            const projectName = projectNameInput.value.trim();
            const projectLocation = projectLocationInput.value.trim();

            // 1. Check for Empty Fields
            if (!projectName || !projectLocation) {
                await showDialog({
                    title: 'Missing Information',
                    message: 'Please enter both the Project Name and Project Location.',
                    buttons: [{ label: 'OK', action: 'ok', type: 'save' }]
                });
                return;
            }

            // 2. Check for Spaces (Final Validation check before submission)
            const isNameValid = validateInput(projectNameInput);
            const isLocationValid = validateInput(projectLocationInput);

            if (!isNameValid || !isLocationValid) {
                await showDialog({
                    title: 'Invalid Input',
                    message: 'Spaces are not allowed in the Project Name or Project Location path.',
                    buttons: [{ label: 'Understood', action: 'ok', type: 'save' }]
                });
                return; 
            }

            // Define Paths
            const projectPath = `${projectLocation}\\${projectName}`;
            const spfPath = `${projectPath}\\${projectName}.spf`;

            // Call API to create structure
            const result = await window.electronAPI.createProjectStructure(projectPath, spfPath, projectName);

            if (result.success) {
                closeNewProjectModal();

                // Wait briefly to ensure file system acts
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Load Project
                // This call triggers enableCompileButtons() in project_manager.js
                // which handles the UI transition (Not Ready -> Ready) automatically.
                await projectManager.loadProject(spfPath);

            } else {
                throw new Error('Failed to create project structure');
            }

        } catch (error) {
            console.error('Error generating project:', error);
            await showDialog({
                title: 'Generation Error',
                message: 'Failed to create the project. Please check the console for details.',
                buttons: [{ label: 'Close', action: 'close', type: 'cancel' }]
            });
        }
    });

    // Close Modal Logic
    function closeNewProjectModal() {
        newProjectModal.classList.add('hidden');
        projectNameInput.value = '';
        projectLocationInput.value = '';
        resetInputStyle(projectNameInput);
        resetInputStyle(projectLocationInput);
    }

    document.getElementById('cancelProjectBtn').addEventListener('click', closeNewProjectModal);
});