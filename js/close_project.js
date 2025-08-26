// Add this to renderer.js or the appropriate UI JavaScript file

document.addEventListener('DOMContentLoaded', () => {
  const closeButton = document.querySelector('#close-button');

  if (closeButton) {
    closeButton.addEventListener('click', async () => {
      const confirmClose = confirm('Are you sure you want to close the current project?');

      if (!confirmClose) return;

      closeButton.disabled = true;

      try {
        const result = await window.electronAPI.closeProject();

        if (result.success) {
          clearProjectInterface();
        } else {
          console.error('Failed to close project:', result.error);
        }
      } catch (error) {
        console.error('Error closing project:', error);
      } finally {
        closeButton.disabled = false;
      }
    });
  }
});

// Clears the UI when a project is closed
function clearProjectInterface() {
  const fileTree = document.querySelector('#file-tree');
  if (fileTree) {
    fileTree.innerHTML = '';
  }

  const processorList = document.querySelector('#processor-list');
  if (processorList) {
    processorList.innerHTML = '';
  }

  const projectTitle = document.querySelector('#project-title');
  if (projectTitle) {
    projectTitle.textContent = 'No project open';
  }

  const currentSpfName = document.querySelector('#current-spf-name');
  if (currentSpfName) {
    currentSpfName.textContent = 'No project open';
  }

  const editor = document.querySelector('#editor');
  if (editor) {
    editor.innerHTML = '';
  }

  const projectButtons = document.querySelectorAll('.project-action-button');
  projectButtons.forEach(button => {
    button.disabled = true;
  });
}
