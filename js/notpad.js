// NotPad Modal Control
document.addEventListener('DOMContentLoaded', () => {
    const notpadButton = document.getElementById('notpad');
    const modalNotpad = document.getElementById('modal-notpad');
    const closeNotpadModal = document.getElementById('close-notpad-modal');
    
    // Open NotPad modal
    notpadButton.addEventListener('click', () => {
      modalNotpad.classList.add('active');
      initializeNotpad();
    });
    
    // Close NotPad modal
    closeNotpadModal.addEventListener('click', () => {
      if (window.isModified) {
        showSaveModal();
      } else {
        modalNotpad.classList.remove('active');
      }
    });
    
    // Close modal when clicking outside
    modalNotpad.addEventListener('click', (e) => {
      if (e.target === modalNotpad) {
        if (window.isModified) {
          showSaveModal();
        } else {
          modalNotpad.classList.remove('active');
        }
      }
    });
    
    // Prevent propagation of clicks inside the modal content
    document.querySelector('.modal-notpad-content').addEventListener('click', (e) => {
      e.stopPropagation();
    });
    
    // Initialize NotPad functions
    function initializeNotpad() {
      // Only initialize if not already initialized
      if (!window.notpadInitialized) {
        // Get DOM elements
        const editor = document.getElementById('editor');
        const lineNumbers = document.getElementById('line-numbers');
        const stats = document.getElementById('stats');
        const wordCount = document.getElementById('word-count');
        const lastSaved = document.getElementById('last-saved');
        const titleFilename = document.getElementById('title-filename');
        const titleModified = document.getElementById('title-modified');
        const fontSizeDisplay = document.getElementById('font-size');
        const searchInput = document.getElementById('search-input');
        const searchCount = document.getElementById('search-count');
        const toast = document.getElementById('toast');
        const saveModal = document.getElementById('save-modal');
  
        // Track state
        window.isModified = false;
        let fontSize = 14;
        let searchMatches = [];
        let currentMatch = -1;
        let lastSearchText = '';
        let undoStack = [];
        let redoStack = [];
        const MAX_UNDO_STEPS = 100;
        let autoSaveInterval = null;
        const AUTO_SAVE_INTERVAL_MS = 300000; // 5 minutes
        const FILENAME = 'notpad.txt';
        const FILEPATH = FILENAME; // Save in the project root
  
        // Initialize
        initUndoState();
        updateLineNumbers();
        updateWordCount();
        setupMouseWheelZoom();
        
        // Start auto-save timer
        startAutoSaveInterval();
  
        // Load content on startup
        loadContent();
  
        // Handle editor events
        editor.addEventListener('input', () => {
          updateLineNumbers();
          updateWordCount();
          updateCursorPosition();
          trackModification();
          pushToUndoStack();
        });
  
        editor.addEventListener('keydown', (e) => {
          // Tab key handling
          if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            
            // Insert tab
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            
            // Put cursor after tab
            editor.selectionStart = editor.selectionEnd = start + 4;
            pushToUndoStack();
            trackModification();
          }
          
          // Save shortcut (Ctrl+S)
          if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            saveContent();
          }
          
          // Undo shortcut (Ctrl+Z)
          if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            undo();
          }
          
          // Redo shortcut (Ctrl+Shift+Z or Ctrl+Y)
          if ((e.ctrlKey && e.shiftKey && e.key === 'z') || (e.ctrlKey && e.key === 'y')) {
            e.preventDefault();
            redo();
          }
          
          // Strike through text (Ctrl+X for selected text)
          if (e.ctrlKey && e.key === 'x' && editor.selectionStart !== editor.selectionEnd) {
            e.preventDefault();
            strikeText();
          }
          
          // Escape key closes the modal
          if (e.key === 'Escape') {
            if (window.isModified) {
              showSaveModal();
            } else {
              modalNotpad.classList.remove('active');
            }
          }
        });
  
        editor.addEventListener('scroll', () => {
          lineNumbers.scrollTop = editor.scrollTop;
        });
  
        editor.addEventListener('click', updateCursorPosition);
        editor.addEventListener('keyup', (e) => {
          if (e.key !== 'Control' && e.key !== 'Shift' && e.key !== 'Alt') {
            updateCursorPosition();
          }
        });
        
        // Selection and cursor movement
        editor.addEventListener('select', updateCursorPosition);
        editor.addEventListener('mouseup', updateCursorPosition);
  
        // Font size controls
        document.getElementById('font-decrease').addEventListener('click', () => {
          if (fontSize > 8) {
            fontSize -= 2;
            updateFontSize();
          }
        });
  
        document.getElementById('font-increase').addEventListener('click', () => {
          if (fontSize < 32) {
            fontSize += 2;
            updateFontSize();
          }
        });
  
        // Search functionality
        searchInput.addEventListener('input', () => {
          const searchText = searchInput.value.trim();
          if (searchText && searchText !== lastSearchText) {
            performSearch(searchText);
            lastSearchText = searchText;
          } else if (!searchText) {
            clearSearch();
            lastSearchText = '';
          }
        });
  
        document.getElementById('search-prev').addEventListener('click', () => {
          navigateSearch('prev');
        });
  
        document.getElementById('search-next').addEventListener('click', () => {
          navigateSearch('next');
        });
  
        // Save button
        document.getElementById('save-btn').addEventListener('click', saveContent);
  
        // Undo/Redo buttons
        document.getElementById('undo-btn').addEventListener('click', undo);
        document.getElementById('redo-btn').addEventListener('click', redo);
  
        // Save modal buttons
        document.getElementById('save-modal-close').addEventListener('click', hideSaveModal);
        document.getElementById('discard-btn').addEventListener('click', () => {
          hideSaveModal();
          modalNotpad.classList.remove('active');
        });
        document.getElementById('save-confirm-btn').addEventListener('click', () => {
          saveContent();
          hideSaveModal();
          setTimeout(() => {
            modalNotpad.classList.remove('active');
          }, 200);
        });
  
        // Functions
        function updateLineNumbers() {
          // Clear current line numbers
          lineNumbers.innerHTML = '';
          
          // Get line count
          const lines = editor.value.split('\n');
          const lineCount = lines.length;
          
          // Generate line numbers
          for (let i = 0; i < lineCount; i++) {
            const lineNumber = document.createElement('div');
            lineNumber.textContent = (i + 1).toString();
            lineNumber.classList.add('line-number');
            lineNumbers.appendChild(lineNumber);
          }
          
          // Add an extra line if the last character is a newline
          if (editor.value.endsWith('\n')) {
            const lineNumber = document.createElement('div');
            lineNumber.textContent = (lineCount + 1).toString();
            lineNumber.classList.add('line-number');
            lineNumbers.appendChild(lineNumber);
          }
        }
  
        function updateWordCount() {
          const text = editor.value.trim();
          const wordCount = text ? text.split(/\s+/).length : 0;
          document.getElementById('word-count').innerText = `${wordCount} words`;
        }
  
        function updateCursorPosition() {
          const cursorPos = editor.selectionStart;
          const text = editor.value.substring(0, cursorPos);
          const lineCount = (text.match(/\n/g) || []).length + 1;
          
          // Calculate column (considering tab as 4 spaces)
          const lastNewLine = text.lastIndexOf('\n');
          const lineStart = lastNewLine === -1 ? 0 : lastNewLine + 1;
          const column = cursorPos - lineStart + 1;
          
          stats.innerText = `Line: ${lineCount}, Column: ${column}`;
          
          // Show selection info if text is selected
          if (editor.selectionStart !== editor.selectionEnd) {
            const selectedText = editor.value.substring(editor.selectionStart, editor.selectionEnd);
            const selectedLength = selectedText.length;
            const selectedWords = selectedText.trim() ? selectedText.trim().split(/\s+/).length : 0;
            stats.innerText += ` | Selected: ${selectedLength} chars, ${selectedWords} words`;
          }
        }
  
        function trackModification() {
          if (!window.isModified) {
            window.isModified = true;
            titleModified.style.display = 'inline';
          }
        }
  
        function updateFontSize() {
          editor.style.fontSize = `${fontSize}px`;
          lineNumbers.style.fontSize = `${fontSize}px`;
          fontSizeDisplay.innerText = `${fontSize}px`;
        }
        
        function setupMouseWheelZoom() {
          editor.addEventListener('wheel', (e) => {
            // Check for Ctrl key held down while scrolling
            if (e.ctrlKey) {
              e.preventDefault();
              
              // Zoom in or out based on scroll direction
              if (e.deltaY < 0 && fontSize < 32) {
                // Scroll up - zoom in
                fontSize += 2;
                updateFontSize();
              } else if (e.deltaY > 0 && fontSize > 8) {
                // Scroll down - zoom out
                fontSize -= 2;
                updateFontSize();
              }
            }
          });
        }
  
        function performSearch(searchText) {
          clearSearch();
          
          if (!searchText) return;
          
          // Find all matches
          const text = editor.value;
          const regex = new RegExp(escapeRegExp(searchText), 'gi');
          let match;
          
          // Store matches with indices
          while ((match = regex.exec(text)) !== null) {
            searchMatches.push({
              start: match.index,
              end: match.index + match[0].length
            });
          }
          
          // Update search count display
          if (searchCount) {
            searchCount.textContent = searchMatches.length > 0 ? 
              `${searchMatches.length} matches` : 
              'No matches';
            searchCount.style.display = 'inline';
          }
          
          // Highlight all matches
          highlightAllMatches();
          
          // Focus on first match if found
          if (searchMatches.length > 0) {
            currentMatch = 0;
            navigateToMatch(currentMatch);
          }
        }
        
        function highlightAllMatches() {
          // This function would ideally highlight all matches in a real editor
          // But since we're using a textarea, we can only visually highlight one at a time
          // by setting the selection
          
          // In a real implementation, you'd need to use a code editor library like 
          // CodeMirror or Monaco Editor to highlight multiple matches simultaneously
        }
  
        function navigateSearch(direction) {
          if (searchMatches.length === 0) return;
          
          if (direction === 'next') {
            currentMatch = (currentMatch + 1) % searchMatches.length;
          } else {
            currentMatch = (currentMatch - 1 + searchMatches.length) % searchMatches.length;
          }
          
          navigateToMatch(currentMatch);
        }
  
        function navigateToMatch(index) {
          const match = searchMatches[index];
          
          // Set selection to the match
          editor.focus();
          editor.setSelectionRange(match.start, match.end);
          
          // Update search count to show current position
          if (searchCount) {
            searchCount.textContent = `${index + 1}/${searchMatches.length} matches`;
          }
          
          // Ensure the match is visible by scrolling to it
          const lineHeight = parseInt(getComputedStyle(editor).lineHeight);
          const lines = editor.value.substring(0, match.start).split('\n').length - 1;
          const approximatePosition = lines * lineHeight;
          
          // Calculate if the selection is in view
          const editorHeight = editor.clientHeight;
          const scrollTop = editor.scrollTop;
          
          if (approximatePosition < scrollTop || approximatePosition > scrollTop + editorHeight - lineHeight * 2) {
            editor.scrollTop = Math.max(0, approximatePosition - editorHeight / 2);
          }
        }
  
        function clearSearch() {
          searchMatches = [];
          currentMatch = -1;
          if (searchCount) {
            searchCount.style.display = 'none';
          }
        }
  
        function escapeRegExp(string) {
          return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        
        function strikeText() {
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          
          if (start !== end) {
            const selectedText = editor.value.substring(start, end);
            const struckText = selectedText.split('').map(char => 
              char === ' ' ? ' ' : char + '\u0336'
            ).join('');
            
            editor.value = editor.value.substring(0, start) + struckText + editor.value.substring(end);
            editor.setSelectionRange(start, start + struckText.length);
            
            pushToUndoStack();
            trackModification();
          }
        }
  
        function saveContent() {
          const content = editor.value;
          
          // Send content to main process to save
          if (window.ipcRenderer) {
            window.ipcRenderer.send('save-notpad', {
              filePath: FILEPATH,
              content: content
            });
            
            // Listen for save result
            window.ipcRenderer.once('save-notpad-reply', (event, success) => {
              if (success) {
                updateSavedState();
                showToast('Note saved successfully!', 'success');
              } else {
                showToast('Failed to save note', 'error');
              }
            });
          } else {
            // If not in Electron, use localStorage as fallback
            try {
              localStorage.setItem('notpad-content', content);
              updateSavedState();
              showToast('Note saved successfully!', 'success');
            } catch (error) {
              showToast('Failed to save note: ' + error.message, 'error');
            }
          }
        }
        
        function updateSavedState() {
          // Update UI
          window.isModified = false;
          titleModified.style.display = 'none';
          const now = new Date();
          const timeStr = now.toLocaleTimeString();
          lastSaved.innerText = `Saved at ${timeStr}`;
        }
  
        function loadContent() {
          // Check if we're in Electron or browser
          if (window.ipcRenderer) {
            // Request content from main process
            window.ipcRenderer.send('load-notpad', {
              filePath: FILEPATH
            });
            
            // Listen for the response
            window.ipcRenderer.once('load-notpad-reply', (event, response) => {
              if (response.success) {
                editor.value = response.content || '';
              } else {
                // If file doesn't exist or there's an error, start with empty content
                editor.value = '';
                showToast('Starting with empty note: ' + (response.message || ''), 'info');
              }
              
              completeContentLoad();
            });
          } else {
            // In browser mode, use localStorage
            const content = localStorage.getItem('notpad-content') || '';
            editor.value = content;
            completeContentLoad();
          }
        }
        
        function completeContentLoad() {
          updateLineNumbers();
          updateWordCount();
          updateCursorPosition();
          initUndoState();
          
          // Reset modification state
          window.isModified = false;
          titleModified.style.display = 'none';
          
          if (editor.value) {
            const now = new Date();
            const timeStr = now.toLocaleTimeString();
            lastSaved.innerText = `Loaded at ${timeStr}`;
          }
        }
  
        function showToast(message, type = 'success') {
          document.getElementById('toast-message').innerText = message;
          toast.className = `toast ${type} show`;
          
          setTimeout(() => {
            toast.className = toast.className.replace('show', '');
          }, 3000);
        }
  
        function showSaveModal() {
          saveModal.classList.add('active');
        }
  
        function hideSaveModal() {
          saveModal.classList.remove('active');
        }
  
        // Undo/Redo functionality
        function initUndoState() {
          const currentContent = editor.value;
          undoStack = [currentContent];
          redoStack = [];
        }
  
        function pushToUndoStack() {
          const currentContent = editor.value;
          const lastState = undoStack[undoStack.length - 1];
          
          // Only push if state has changed
          if (currentContent !== lastState) {
            undoStack.push(currentContent);
            
            // Limit undo stack size
            if (undoStack.length > MAX_UNDO_STEPS) {
              undoStack.shift();
            }
            
            // Clear redo stack since a new action was performed
            redoStack = [];
          }
        }
  
        function undo() {
          if (undoStack.length <= 1) return; // Keep at least one state
          
          // Move current state to redo stack
          redoStack.push(undoStack.pop());
          
          // Apply previous state
          const previousState = undoStack[undoStack.length - 1];
          editor.value = previousState;
          
          // Update UI
          updateLineNumbers();
          updateWordCount();
          updateCursorPosition();
          trackModification();
        }
  
        function redo() {
          if (redoStack.length === 0) return;
          
          // Get state from redo stack
          const nextState = redoStack.pop();
          
          // Apply and push to undo stack
          editor.value = nextState;
          undoStack.push(nextState);
          
          // Update UI
          updateLineNumbers();
          updateWordCount();
          updateCursorPosition();
          trackModification();
        }
  
        // Auto-save functionality - on typing
        let autoSaveTimeout;
        editor.addEventListener('input', () => {
          // Clear previous timeout
          if (autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
          }
          
          // Set new timeout for auto-save (3 seconds after typing stops)
          autoSaveTimeout = setTimeout(() => {
            if (window.isModified) {
              saveContent();
            }
          }, 30000);
        });
        
        // Auto-save functionality - on interval
        function startAutoSaveInterval() {
          // Clear any existing interval
          if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
          }
          
          // Set new interval for periodic auto-save
          autoSaveInterval = setInterval(() => {
            if (window.isModified) {
              saveContent();
              showToast('Auto-saved note', 'info');
            }
          }, AUTO_SAVE_INTERVAL_MS);
        }
        
        // Mark NotPad as initialized
        window.notpadInitialized = true;
      }
    }
    
    // Handler for minimize button
    document.getElementById('minimize-btn').addEventListener('click', () => {
      if (window.ipcRenderer) {
        window.ipcRenderer.send('notpad-minimize');
      } else {
        // In browser context, minimize visual effect
        modalNotpad.style.opacity = '0.3';
        setTimeout(() => {
          modalNotpad.style.opacity = '1';
        }, 300);
      }
    });
    
    // Handler for maximize button
    document.getElementById('maximize-btn').addEventListener('click', () => {
      const modalContent = document.querySelector('.modal-notpad-content');
      if (modalContent.classList.contains('maximized')) {
        modalContent.classList.remove('maximized');
        modalContent.style.width = '80%';
        modalContent.style.height = '80%';
        modalContent.style.margin = '50px auto';
      } else {
        modalContent.classList.add('maximized');
        modalContent.style.width = '98%';
        modalContent.style.height = '96%';
        modalContent.style.margin = '10px auto';
      }
    });
    
    // Ensure ipcRenderer is available if in Electron
    if (window.require) {
      try {
        window.ipcRenderer = require('electron').ipcRenderer;
      } catch (e) {
        console.log('ipcRenderer not available, running in browser mode');
      }
    }
  
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+N to open NotPad
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        modalNotpad.classList.add('active');
        initializeNotpad();
      }
    });
    
  });
  
  // Expose isModified globally for modal close handlers
  window.isModified = false;
  
  // Global function to show save modal
  function showSaveModal() {
    document.getElementById('save-modal').classList.add('active');
  }