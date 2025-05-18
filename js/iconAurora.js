const DEFAULT_ICON_PATH = './assets/icons/aurora_borealis-2.ico';
const IMAGE_KEY = 'auroraIconPath';

const auroraIcon = document.getElementById('aurora-icon');
const fallbackIcon = document.getElementById('fallback-icon');
const iconUpload = document.getElementById('icon-upload');
const changeIconBtn = document.getElementById('change-icon-btn');
const iconContainer = document.getElementById('icon-container');

// Função para carregar imagem persistida
function loadPersistedIcon() {
  const storedPath = localStorage.getItem(IMAGE_KEY);
  if (storedPath) {
    // Verifica se o arquivo existe
    window.electronAPI.checkFileExists(storedPath).then(exists => {
      if (exists) {
        auroraIcon.src = storedPath;
        fallbackIcon.style.display = 'none';
      } else {
        auroraIcon.style.display = 'none';
      }
    });
  } else {
    auroraIcon.src = DEFAULT_ICON_PATH;
    fallbackIcon.style.display = 'none';
  }
}

// Evento: clique no botão de alterar ícone
changeIconBtn.addEventListener('click', () => {
  iconUpload.click();
});

// Evento: seleção de nova imagem
iconUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const filePath = file.path;

  // Persistir caminho e aplicar imagem
  auroraIcon.src = filePath;
  fallbackIcon.style.display = 'none';
  localStorage.setItem(IMAGE_KEY, filePath);
});

// Evento: duplo clique com botão direito para resetar
iconContainer.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // impedir menu padrão
  const now = Date.now();
  if (!iconContainer.lastRightClick) {
    iconContainer.lastRightClick = now;
    setTimeout(() => iconContainer.lastRightClick = null, 400); // tempo limite
    return;
  }

  if (now - iconContainer.lastRightClick < 400) {
    // Duplo clique detectado
    localStorage.removeItem(IMAGE_KEY);
    auroraIcon.src = DEFAULT_ICON_PATH;
    fallbackIcon.style.display = 'none';
  }

  iconContainer.lastRightClick = now;
});

// Carregar na inicialização
loadPersistedIcon();
