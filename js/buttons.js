
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
  
 

const resizer = document.querySelector('.ai-resizer');
const container = document.querySelector('.ai-assistant-container');

resizer.addEventListener('mousedown', function (e) {
  document.addEventListener('mousemove', resizePanel);
  document.addEventListener('mouseup', stopResize);
});

function resizePanel(e) {
  const newWidth = window.innerWidth - e.clientX;
  container.style.width = `${newWidth}px`;
}

function stopResize() {
  document.removeEventListener('mousemove', resizePanel);
  document.removeEventListener('mouseup', stopResize);
}
