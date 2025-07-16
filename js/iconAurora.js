/**
 * Aurora Icon Manager
 * Gerencia o carregamento, armazenamento e exibição do ícone do aplicativo
 * com suporte para fallback e persistência usando localStorage
 */

// Constantes
const DEFAULT_ICON_PATH = './assets/icons/aurora-chameleon-animal-by-Vexels.svg';
const IMAGE_KEY = 'auroraIconPath';
const IMAGE_DATA_KEY = 'auroraIconData'; // Nova chave para salvar os dados da imagem

// Cache de elementos DOM
const auroraIcon = document.getElementById('aurora-icon');
const fallbackIcon = document.getElementById('fallback-icon');
const iconUpload = document.getElementById('icon-upload');
const changeIconBtn = document.getElementById('change-icon-btn');
const iconContainer = document.getElementById('icon-container');
const flyIcon = document.getElementById('fly'); // Elemento fly para remoção

// Estado da aplicação
let currentIconPath = DEFAULT_ICON_PATH;
let isIconLoaded = false;

/**
 * Remove o elemento fly quando uma nova imagem é selecionada
 */
function removeFlyIcon() {
  if (flyIcon) {
    console.log('Removendo ícone fly');
    flyIcon.remove();
  }
}

/**
 * Exibe o ícone de fallback quando não é possível carregar a imagem
 */
function showFallbackIcon() {
  console.log('Exibindo ícone de fallback');
  auroraIcon.style.display = 'none';
  fallbackIcon.style.display = 'inline-block';
  fallbackIcon.innerHTML = '<i class="fa-solid fa-notdef"></i>';
  isIconLoaded = false;
}

/**
 * Salva os dados da imagem no localStorage
 * @param {string} dataURL - DataURL da imagem
 * @param {string} filePath - Caminho do arquivo
 */
function saveIconData(dataURL, filePath) {
  try {
    console.log(`Salvando informações do ícone: ${filePath}`);
    localStorage.setItem(IMAGE_DATA_KEY, dataURL);
    localStorage.setItem(IMAGE_KEY, filePath);
    currentIconPath = filePath;
  } catch (err) {
    console.error('Erro ao salvar dados no localStorage:', err);
  }
}

/**
 * Converte uma imagem em DataURL
 * @param {string} filePath - Caminho do arquivo de imagem
 * @returns {Promise<string>} - Promise com o DataURL da imagem
 */
function convertImageToDataURL(filePath) {
  return new Promise((resolve, reject) => {
    const tempImg = new Image();
    
    tempImg.onload = function() {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = this.naturalWidth;
        canvas.height = this.naturalHeight;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this, 0, 0);
        
        const dataURL = canvas.toDataURL('image/png');
        resolve(dataURL);
      } catch (err) {
        reject(err);
      }
    };
    
    tempImg.onerror = function(err) {
      reject(new Error(`Falha ao carregar imagem: ${err}`));
    };
    
    tempImg.src = filePath;
  });
}

/**
 * Exibe a imagem principal e esconde o ícone de fallback
 * @param {string} iconSrc - Fonte da imagem (caminho ou dataURL)
 */
function showIcon(iconSrc) {
  console.log(`Exibindo ícone: ${iconSrc.substring(0, 30)}${iconSrc.length > 30 ? '...' : ''}`);
  
  auroraIcon.onload = () => {
    auroraIcon.style.display = 'inline-block';
    fallbackIcon.style.display = 'none';
    isIconLoaded = true;
    console.log('Ícone carregado com sucesso');
  };
  
  auroraIcon.onerror = () => {
    console.error(`Falha ao carregar o ícone: ${iconSrc.substring(0, 30)}...`);
    
    // Se o ícone que falhou não é o padrão, tentamos carregar o padrão
    if (iconSrc !== DEFAULT_ICON_PATH) {
      console.log('Tentando carregar ícone padrão após falha');
      loadDefaultIcon();
    } else {
      showFallbackIcon();
    }
  };
  
  // Define a fonte da imagem após configurar os handlers
  auroraIcon.src = iconSrc;
}

/**
 * Carrega o ícone padrão
 */
function loadDefaultIcon() {
  console.log('Carregando ícone padrão');
  currentIconPath = DEFAULT_ICON_PATH;
  
  // Limpa o localStorage
  localStorage.removeItem(IMAGE_KEY);
  localStorage.removeItem(IMAGE_DATA_KEY);
  
  showIcon(DEFAULT_ICON_PATH);
}

/**
 * Carrega o ícone que foi persistido no localStorage
 */
function loadPersistedIcon() {
  console.log('Tentando carregar ícone persistido');
  
  // Primeiro tentamos carregar a partir do DataURL salvo
  const iconDataURL = localStorage.getItem(IMAGE_DATA_KEY);
  const storedPath = localStorage.getItem(IMAGE_KEY);
  
  if (iconDataURL) {
    console.log('Encontrado DataURL no localStorage');
    showIcon(iconDataURL);
    currentIconPath = storedPath || DEFAULT_ICON_PATH;
    return;
  }
  
  if (!storedPath) {
    console.log('Nenhum caminho de ícone encontrado no localStorage');
    loadDefaultIcon();
    return;
  }
  
  console.log(`Encontrado caminho de arquivo no localStorage: ${storedPath}`);
  
  // Verifica se o arquivo existe
  window.electronAPI.checkFileExists(storedPath)
    .then(exists => {
      if (exists) {
        console.log('Arquivo existe, convertendo para DataURL');
        // Converter o arquivo para DataURL e salvar
        convertImageToDataURL(storedPath)
          .then(dataURL => {
            saveIconData(dataURL, storedPath);
            showIcon(dataURL);
          })
          .catch(err => {
            console.error('Erro ao converter imagem:', err);
            showIcon(storedPath); // Tenta usar o caminho diretamente
          });
      } else {
        console.warn(`Arquivo de ícone não encontrado: ${storedPath}`);
        loadDefaultIcon();
      }
    })
    .catch(error => {
      console.error('Erro ao verificar existência do arquivo:', error);
      // Tenta usar o caminho diretamente se não conseguir verificar
      showIcon(storedPath);
    });
}

/**
 * Processa um novo arquivo de ícone selecionado
 * @param {File} file - Arquivo de imagem
 */
function processNewIcon(file) {
  if (!file) return;
  
  const filePath = file.path;
  console.log(`Novo ícone selecionado: ${filePath}`);
  
  // Remove o ícone fly quando uma nova imagem é selecionada
  removeFlyIcon();
  
  // Criar um FileReader para ler o arquivo como DataURL
  const reader = new FileReader();
  
  reader.onload = function(e) {
    const dataURL = e.target.result;
    saveIconData(dataURL, filePath);
    showIcon(dataURL);
  };
  
  reader.onerror = function() {
    console.error('Erro ao ler arquivo de imagem');
    // Tenta usar o caminho diretamente como fallback
    convertImageToDataURL(filePath)
      .then(dataURL => {
        saveIconData(dataURL, filePath);
        showIcon(dataURL);
      })
      .catch(err => {
        console.error('Erro ao converter imagem:', err);
        showIcon(filePath);
      });
  };
  
  reader.readAsDataURL(file);
}

// Evento: clique no botão de alterar ícone
changeIconBtn.addEventListener('click', () => {
  iconUpload.click();
});

// Evento: seleção de nova imagem
iconUpload.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    processNewIcon(file);
  }
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
    console.log('Duplo clique detectado, resetando ícone');
    loadDefaultIcon();
  }
  
  iconContainer.lastRightClick = now;
});

// Inicialização - garante que aconteça no momento certo
function init() {
  console.log('Inicializando Aurora Icon Manager');
  loadPersistedIcon();
}

// Carregar na inicialização com verificação robusta
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // DOM já está carregado
  init();
}

// Garantir que o ícone seja recarregado se o app for reaberto ou a página recarregada
window.addEventListener('load', () => {
  console.log('Evento window.load disparado');
  // Verifica se já carregamos com sucesso
  if (!isIconLoaded) {
    console.log('Ícone ainda não carregado, tentando novamente');
    loadPersistedIcon();
  }
});