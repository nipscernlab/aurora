document.addEventListener("DOMContentLoaded", () => {
    const newProjectModal = document.getElementById("newProjectModal");
    const newProjectBtn = document.getElementById("newProjectBtn");

    newProjectBtn.addEventListener("click", () => {
        newProjectModal.classList.remove("hidden");
    });

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

    document.getElementById('generateProjectBtn').addEventListener('click', async () => {
        try {
            const projectName = document.getElementById('projectNameInput').value.trim();
            const projectLocation = document.getElementById('projectLocationInput').value.trim();
    
            if (!projectName || !projectLocation) {
                alert('Please enter both Project Name and Location.');
                return;
            }
    
            const projectPath = `${projectLocation}\\${projectName}`;
            const spfPath = `${projectPath}\\${projectName}.spf`;
    
            // Log the values to verify they are correct
            console.log('Project Name:', projectName);
            console.log('Project Location:', projectLocation);
            console.log('Project Path:', projectPath);
            console.log('SPF Path:', spfPath);
    
            // Ensure all required arguments are defined
            if (!projectPath || !spfPath || !projectName) {
                alert('Please provide valid project path, SPF path, and project name.');
                return;
            }
    
            await window.electronAPI.createProjectStructure(projectPath, spfPath, projectName);
            alert('Project created successfully!');
            closeNewProjectModal();
            openFolderAndRenderTree(projectPath);
    
        } catch (error) {
            console.error('Error generating project:', error);
            alert('Failed to create the project. See console for details.');
        }
    });

    async function openFolderAndRenderTree(folderPath) {
        try {
            const files = await window.electronAPI.getFolderFiles(folderPath);
            if (files && Array.isArray(files)) {
                const fileTree = document.getElementById('file-tree');
                fileTree.innerHTML = '';
                renderFileTree(files, fileTree);
                updateProcessorHubButton(true);  // Activate the button if needed
            } else {
                console.error('Invalid files structure received:', files);
            }
        } catch (error) {
            console.error('Error opening folder:', error);
            alert('Failed to open folder.');
        }
    }

    function renderFileTree(files, container, level = 0) {
        if (!Array.isArray(files)) return;
        
        files.forEach(file => {
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'file-tree-item';

            const item = document.createElement('div');
            item.className = 'file-item';
            item.style.paddingLeft = `${level * 20}px`;

            const icon = document.createElement('i');

            if (file.type === 'directory') {
                const folderToggle = document.createElement('i');
                folderToggle.className = 'fas fa-chevron-right folder-toggle';
                item.appendChild(folderToggle);

                icon.className = 'fas fa-folder file-item-icon';

                const childContainer = document.createElement('div');
                childContainer.className = 'folder-content hidden';

                const toggleFolder = (e) => {
                    e.stopPropagation();
                    childContainer.classList.toggle('hidden');
                    folderToggle.classList.toggle('fa-chevron-right');
                    folderToggle.classList.toggle('fa-chevron-down');
                    icon.classList.toggle('fa-folder');
                    icon.classList.toggle('fa-folder-open');
                };

                item.addEventListener('click', toggleFolder);

                if (Array.isArray(file.children)) {
                    renderFileTree(file.children, childContainer, level + 1);
                }

                itemWrapper.appendChild(item);
                itemWrapper.appendChild(childContainer);
            } else {
                icon.className = 'fas fa-file file-item-icon';
                item.addEventListener('click', () => openFile(file.path));
                itemWrapper.appendChild(item);
            }

            const name = document.createElement('span');
            name.textContent = file.name;

            item.appendChild(icon);
            item.appendChild(name);

            container.appendChild(itemWrapper);
        });
    }

    function closeNewProjectModal() {
        newProjectModal.classList.add('hidden');
    }

    document.getElementById('cancelProjectBtn').addEventListener('click', closeNewProjectModal);
});