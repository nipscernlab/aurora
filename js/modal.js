document.addEventListener("DOMContentLoaded", () => {
    const newProjectModal = document.getElementById("newProjectModal");
    const newProjectBtn = document.getElementById("newProjectBtn");

    // Open the "New Project" modal when the button is clicked
    newProjectBtn.addEventListener("click", () => {
        newProjectModal.classList.remove("hidden");
    });

    // Handle the "Browse" button to select a directory
    document.getElementById('browseBtn').addEventListener('click', async () => {
        try {
            const folderPath = await window.electronAPI.selectDirectory();
            if (folderPath) {
                document.getElementById('projectLocationInput').value = folderPath;
            }
        } catch (error) {
            console.error('Error selecting directory:', error);
        }
    });

    // Handle the "Generate Project" button to create a new project
    document.getElementById('generateProjectBtn').addEventListener('click', async () => {
        try {
            const projectName = document.getElementById('projectNameInput').value.trim();
            const projectLocation = document.getElementById('projectLocationInput').value.trim();

            // Validate input fields
            if (!projectName || !projectLocation) {
                alert('Please enter both Project Name and Location.');
                return;
            }

            // Define the project folder and SPF file paths
            const projectPath = `${projectLocation}\\${projectName}`;
            const spfPath = `${projectPath}\\${projectName}.spf`;

            console.log('Project Name:', projectName);
            console.log('Project Location:', projectLocation);
            console.log('Project Path:', projectPath);
            console.log('SPF Path:', spfPath);

            // Validate paths and project name
            if (!projectPath || !spfPath || !projectName) {
                alert('Please provide valid project path, SPF path, and project name.');
                return;
            }

            // Call the function to create the project structure
            const result = await window.electronAPI.createProjectStructure(projectPath, spfPath, projectName);

            if (result.success) {
                // Close the modal
                closeNewProjectModal();

                // Wait briefly to ensure files are created
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Update global paths (if necessary)
                currentProjectPath = projectPath;
                currentSpfPath = spfPath;

                // Load the project using the correct SPF path
                await loadProject(spfPath);
            } else {
                throw new Error('Failed to create project structure');
            }

        } catch (error) {
            console.error('Error generating project:', error);
            alert('Failed to create the project. See console for details.');
        }
    });

    // Close the "New Project" modal and reset form fields
    function closeNewProjectModal() {
        newProjectModal.classList.add('hidden');
        document.getElementById('projectNameInput').value = '';
        document.getElementById('projectLocationInput').value = '';
    }

    // Handle the "Cancel" button to close the modal
    document.getElementById('cancelProjectBtn').addEventListener('click', closeNewProjectModal);
});