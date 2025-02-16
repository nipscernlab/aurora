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
      
          // O caminho da pasta do projeto e do arquivo SPF:
          const projectPath = `${projectLocation}\\${projectName}`;
          const spfPath = `${projectPath}\\${projectName}.spf`;
      
          console.log('Project Name:', projectName);
          console.log('Project Location:', projectLocation);
          console.log('Project Path:', projectPath);
          console.log('SPF Path:', spfPath);
      
          // Validar argumentos
          if (!projectPath || !spfPath || !projectName) {
            alert('Please provide valid project path, SPF path, and project name.');
            return;
          }
      
          // Chamar a criação da estrutura do projeto
          const result = await window.electronAPI.createProjectStructure(projectPath, spfPath, projectName);
      
          if (result.success) {
            // Fechar o modal
            closeNewProjectModal();
      
            // Aguarda um momento para garantir que os arquivos foram criados
            await new Promise(resolve => setTimeout(resolve, 1000));
      
            // Atualiza os caminhos globais (se necessário)
            currentProjectPath = projectPath;
            currentSpfPath = spfPath;
      
            // Chama a função loadProject passando o caminho correto do .spf
            await loadProject(spfPath);
          } else {
            throw new Error('Failed to create project structure');
          }
      
        } catch (error) {
          console.error('Error generating project:', error);
          alert('Failed to create the project. See console for details.');
        }
      });
      
      function closeNewProjectModal() {
        newProjectModal.classList.add('hidden');
        // Limpar os campos do formulário, se necessário
        document.getElementById('projectNameInput').value = '';
        document.getElementById('projectLocationInput').value = '';
      }
      
      document.getElementById('cancelProjectBtn').addEventListener('click', closeNewProjectModal);
      });