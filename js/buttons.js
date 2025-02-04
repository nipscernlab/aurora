
// Theme toggle
document.getElementById('themeToggle').addEventListener('click', () => {
    const body = document.body;
    const isDark = body.classList.contains('theme-dark');
    
    body.classList.toggle('theme-dark');
    body.classList.toggle('theme-light');
    
    if (editor) {
      editor.updateOptions({
        theme: isDark ? 'vs' : 'vs-dark'
      });
    }
  });


  
// Função para criar e mostrar o box de informações
function showInfoBox() {
    const infoBox = document.getElementById('infoBox');
    infoBox.classList.add('visible');
    infoBox.classList.remove('hidden');
  
    // Reposition the info box in the center
    const infoBoxHeight = infoBox.offsetHeight;
    const viewportHeight = window.innerHeight;
    if (infoBoxHeight > viewportHeight * 0.8) {
      infoBox.style.top = `${viewportHeight / 2}px`;
      infoBox.style.transform = 'translate(-50%, -50%)';
    }
  }
  
  function closeInfoBox() {
    const infoBox = document.getElementById('infoBox');
    infoBox.classList.remove('visible');
    setTimeout(() => {
      infoBox.classList.add('hidden');
    }, 300);
  }
  
 