// Notepad Modal JavaScript
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const notepadButton = document.getElementById('notpad');
  const notepadModal = document.getElementById('notepad-modal');
  
  // Verificar se o modal está visível no início e desabilitar suas funções se não estiver
  if (notepadModal) {
    // Certifique-se de que o modal comece oculto e desativado
    notepadModal.classList.remove('visible');
    
    // Certifique-se de que o editor não receba foco quando o modal não está visível
    const editor = document.getElementById('notepad-editor');
    if (editor) {
      editor.disabled = true;
    }
  }
  
  // Configurar o botão de abrir o notepad
  if (notepadButton) {
    notepadButton.addEventListener('click', showNotepad);
  }

  // DOM Elements
  const notpadButton = document.getElementById('notpad');
  let editor = document.getElementById('notepad-editor');
  let lineNumbers = document.getElementById('notepad-line-numbers');
  let saveTimeout = null;
  let isDirty = false;
  let fontSize = 14; // Default font size in pixels
  
  // Constants
  const AUTOSAVE_INTERVAL = 120000; // 2 minutes in milliseconds
  const NOTEPAD_FILE_PATH = 'notpad.txt';
  
  // Setup all event listeners for the notepad
  function setupEventListeners() {
    // Close button
    const closeButton = document.getElementById('notepad-close');
    if (closeButton) {
      closeButton.addEventListener('click', closeNotepad);
      console.log('Close button event listener attached');
    } else {
      console.error('Close button not found in DOM');
    }
    
    // Save button
    const saveButton = document.getElementById('notepad-save');
    if (saveButton) {
      saveButton.addEventListener('click', saveContent);
      console.log('Save button event listener attached');
    }
    
    // Font size buttons
    const increaseButton = document.getElementById('notepad-font-increase');
    const decreaseButton = document.getElementById('notepad-font-decrease');
    
    if (increaseButton) {
      increaseButton.addEventListener('click', increaseFontSize);
      console.log('Font increase button event listener attached');
    }
    
    if (decreaseButton) {
      decreaseButton.addEventListener('click', decreaseFontSize);
      console.log('Font decrease button event listener attached');
    }
    
    // Formatting buttons
    const boldButton = document.getElementById('notepad-bold');
    const italicButton = document.getElementById('notepad-italic');
    const strikeButton = document.getElementById('notepad-strikethrough');
    
    if (boldButton) boldButton.addEventListener('click', applyBold);
    if (italicButton) italicButton.addEventListener('click', applyItalic);
    if (strikeButton) strikeButton.addEventListener('click', applyStrikethrough);
    
    // Editor events
    if (editor) {
      editor.addEventListener('input', () => {
        updateStats();
        markUnsaved();
      });
      
      editor.addEventListener('keydown', handleKeyDown);
      editor.addEventListener('scroll', syncScroll);
      editor.addEventListener('keyup', updateCursorPosition);
      editor.addEventListener('click', updateCursorPosition);
      
      console.log('Editor event listeners attached');
    } else {
      console.error('Editor not found in DOM');
    }
  }
  
  // Load content from file via preload API
function loadContent() {
  if (window.notepadAPI && typeof window.notepadAPI.load === 'function') {
    window.notepadAPI.load()
      .then(result => {
        if (result.success && editor) {
          editor.value = result.content;
          updateLineNumbers();
          updateStats();
          console.log('Conteúdo carregado de notepad.txt');
        } else if (!result.success) {
          console.error('Falha ao carregar notepad.txt:', result.error);
        }
      })
      .catch(err => {
        console.error('Erro ao invocar notepadAPI.load:', err);
      });
  } else {
    console.log('notepadAPI não disponível, ignorando load');
  }
}

// Salvar conteúdo em notepad.txt via preload API
function saveContent() {
  const saveStatus = document.getElementById('notepad-save-status');
  if (!saveStatus) {
    console.error('Save status element not found');
    return;
  }

  saveStatus.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
  saveStatus.classList.remove('unsaved');
  saveStatus.classList.add('saving');

  if (window.notepadAPI && typeof window.notepadAPI.save === 'function') {
    window.notepadAPI.save(editor.value)
      .then(result => {
        if (result.success) {
          saveStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Saved';
          saveStatus.classList.remove('saving', 'unsaved');
          isDirty = false;

          saveStatus.classList.add('saving-pulse');
          setTimeout(() => saveStatus.classList.remove('saving-pulse'), 1500);

          console.log('Conteúdo salvo com sucesso em notepad.txt');
        } else {
          throw new Error(result.error);
        }
      })
      .catch(err => {
        saveStatus.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Save failed';
        console.error('Falha ao salvar notepad.txt:', err);
      });
  } else {
    console.error('notepadAPI não disponível para save');
    saveStatus.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Save failed';
  }
}

  
  // Start autosave timer
  function startAutosaveTimer() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
      if (isDirty) {
        saveContent();
      }
      startAutosaveTimer(); // Restart the timer
    }, AUTOSAVE_INTERVAL);
    
    console.log('Autosave timer started');
  }
  
  // Mark content as unsaved
  function markUnsaved() {
    const saveStatus = document.getElementById('notepad-save-status');
    if (saveStatus) {
      saveStatus.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Unsaved changes';
      saveStatus.classList.add('unsaved');
      isDirty = true;
    }
  }
  
  // Show the notepad
  function showNotepad() {
  const notepadModal = document.getElementById('notepad-modal');
  const editor = document.getElementById('notepad-editor');
  
  if (notepadModal) {
    notepadModal.classList.add('visible');
    
    // Habilitar o editor quando o modal estiver visível
    if (editor) {
      editor.disabled = false;
      
      // Opcional: dar foco ao editor
      setTimeout(() => editor.focus(), 100);
    }
    
    // Configurar eventos, carregar conteúdo, etc.
    setupEventListeners();
    loadContent();
    startAutosaveTimer();
    
    if (editor) editor.style.fontSize = `${fontSize}px`;
    const lineNumbers = document.getElementById('notepad-line-numbers');
    if (lineNumbers) lineNumbers.style.fontSize = `${fontSize}px`;
  }
}
  
  // Close the notepad
  function closeNotepad() {
    console.log('Closing notepad');
    
    if (isDirty && typeof electron !== 'undefined') {
      electron.ipcRenderer.invoke('dialog:confirm', 'Save Changes?', 'You have unsaved changes. Would you like to save before closing?')
        .then(shouldSave => {
          if (shouldSave) {
            saveContent();
            setTimeout(hideNotepadModal, 500);
          } else {
            hideNotepadModal();
          }
        })
        .catch(err => {
          console.error('Error showing confirm dialog:', err);
          hideNotepadModal();
        });
    } else {
      hideNotepadModal();
    }
  }
  
  // Hide the notepad modal
  function hideNotepadModal() {
  const notepadModal = document.getElementById('notepad-modal');
  const editor = document.getElementById('notepad-editor');
  
  if (notepadModal) {
    notepadModal.classList.remove('hidden', 'visible');
    
    // Desabilitar o editor quando o modal não estiver visível
    if (editor) {
      editor.disabled = true;
    }
    
    // Limpar o autosave
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
  }
}
  
  // Update line numbers
  function updateLineNumbers() {
    if (!editor || !lineNumbers) return;
    
    const lines = editor.value.split('\n');
    let lineNumbersHTML = '';
    
    for (let i = 0; i < lines.length; i++) {
      lineNumbersHTML += `<div>${i + 1}</div>`;
    }
    
    // Ensure there's at least one line number
    if (lineNumbersHTML === '') {
      lineNumbersHTML = '<div>1</div>';
    }
    
    lineNumbers.innerHTML = lineNumbersHTML;
  }
  
  // Keep line numbers synced with editor scroll
  function syncScroll() {
    if (lineNumbers && editor) {
      lineNumbers.scrollTop = editor.scrollTop;
    }
  }
  
  // Update text statistics (word count, character count)
  function updateStats() {
    if (!editor) return;
    
    const text = editor.value;
    const wordCount = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const charCount = text.length;
    
    const wordCountElement = document.getElementById('notepad-word-count');
    const charCountElement = document.getElementById('notepad-char-count');
    
    if (wordCountElement) {
      wordCountElement.innerHTML = 
        `<i class="fa-solid fa-font"></i> ${wordCount} word${wordCount !== 1 ? 's' : ''}`;
    }
    
    if (charCountElement) {
      charCountElement.innerHTML = 
        `<i class="fa-solid fa-keyboard"></i> ${charCount} character${charCount !== 1 ? 's' : ''}`;
    }
    
    updateLineNumbers();
  }
  
  // Update cursor position indicator
  function updateCursorPosition() {
    if (!editor) return;
    
    const cursorPos = editor.selectionStart;
    const text = editor.value.substring(0, cursorPos);
    const lineBreaks = text.match(/\n/g) || [];
    const currentLine = lineBreaks.length + 1;
    
    // Calculate column (considering tab characters as 4 spaces)
    const lastLineBreak = text.lastIndexOf('\n');
    const currentLineText = lastLineBreak >= 0 ? text.substring(lastLineBreak + 1) : text;
    const currentColumn = currentLineText.length + 1;
    
    const positionElement = document.getElementById('notepad-position');
    if (positionElement) {
      positionElement.innerHTML = 
        `<i class="fa-solid fa-location-dot"></i> Ln: ${currentLine}, Col: ${currentColumn}`;
    }
  }
  
  // Increase font size
  function increaseFontSize() {
    if (fontSize < 36) { // Max font size
      fontSize += 2;
      if (editor) editor.style.fontSize = `${fontSize}px`;
      if (lineNumbers) lineNumbers.style.fontSize = `${fontSize}px`;
      console.log('Font size increased to', fontSize);
    }
  }
  
  // Decrease font size
  function decreaseFontSize() {
    if (fontSize > 10) { // Min font size
      fontSize -= 2;
      if (editor) editor.style.fontSize = `${fontSize}px`;
      if (lineNumbers) lineNumbers.style.fontSize = `${fontSize}px`;
      console.log('Font size decreased to', fontSize);
    }
  }
  
  // Apply bold formatting to selected text
  function applyBold() {
    applyFormatting('**', '**');
    console.log('Bold formatting applied');
  }
  
  // Apply italic formatting to selected text
  function applyItalic() {
    applyFormatting('*', '*');
    console.log('Italic formatting applied');
  }
  
  // Apply strikethrough formatting to selected text
  function applyStrikethrough() {
    applyFormatting('~~', '~~');
    console.log('Strikethrough formatting applied');
  }
  
  // Helper function to apply formatting
  function applyFormatting(prefix, suffix) {
    if (!editor) return;
    
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selectedText = editor.value.substring(start, end);
    const replacement = prefix + selectedText + suffix;
    
    editor.value = editor.value.substring(0, start) + replacement + editor.value.substring(end);
    editor.selectionStart = start + prefix.length;
    editor.selectionEnd = end + prefix.length;
    editor.focus();
    
    updateStats();
    markUnsaved();
  }
  
  // Handle keyboard shortcuts
  function handleKeyDown(e) {
    // Save - Ctrl+S
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveContent();
    }
    
    // Bold - Ctrl+B
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      applyBold();
    }
    
    // Italic - Ctrl+I
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      applyItalic();
    }
    
    // Strikethrough - Ctrl+Shift+S
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      applyStrikethrough();
    }
    
    // Increase font size - Ctrl++
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      increaseFontSize();
    }
    
    // Decrease font size - Ctrl+-
    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      decreaseFontSize();
    }
    
    // Tab key handling (insert spaces instead of changing focus)
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      
      // Insert 2 spaces at cursor position
      editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
      
      // Move cursor after inserted spaces
      editor.selectionStart = editor.selectionEnd = start + 2;
    }
  }
  
  // Set up the notepad button click handler
  if (notpadButton) {
    notpadButton.addEventListener('click', function() {
      showNotepad();
    });
    console.log('Notepad button click handler attached');
  } else {
    console.warn('Notepad button not found in DOM');
  }
  
  // Expose functions to window for debugging
  window.notepadDebug = {
    showNotepad,
    closeNotepad,
    saveContent,
    updateStats
  };
  
  console.log('Notepad module initialized');
});