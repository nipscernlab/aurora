document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');

    const saveConfigButton = document.getElementById('saveConfig');
    const multicoreCheckbox = document.querySelector('input[id="multicore"]');

    if (!saveConfigButton || !multicoreCheckbox) {
        console.error('Required elements not found. Check IDs and selectors.');
        return;
    }

    // Function to populate file cards with testbench and GTKW files
    function populateFileCards(tbFiles, gtkwFiles) {
        const tbFilesContainer = document.getElementById('tb-files-container');
        const gtkwFilesContainer = document.getElementById('gtkw-files-container');

        // Clear containers before populating
        tbFilesContainer.innerHTML = '';
        gtkwFilesContainer.innerHTML = '';

        // Populate testbench files (_tb.v)
        if (tbFiles.length > 0) {
            tbFiles.forEach(file => {
                const fileName = file.split('/').pop();
                const card = createFileCard(fileName, 'tb');
                tbFilesContainer.appendChild(card);
            });
        } else {
            tbFilesContainer.innerHTML = '<p class="empty-message">No testbench files found</p>';
        }

        // Populate GTKW files (.gtkw)
        if (gtkwFiles.length > 0) {
            gtkwFiles.forEach(file => {
                const fileName = file.split('/').pop();
                const card = createFileCard(fileName, 'gtkw');
                gtkwFilesContainer.appendChild(card);
            });
        } else {
            gtkwFilesContainer.innerHTML = '<p class="empty-message">No GTKW files found</p>';
        }

        // Update file counters
        updateFileCounters();
    }

    // Function to create a file card for display
    function createFileCard(fileName, type) {
        const card = document.createElement('div');
        card.classList.add('file-card');
        card.dataset.filename = fileName;
        card.dataset.type = type;

        const icon = type === 'tb' ? 'fa-file-code' : 'fa-chart-line';
        const typeLabel = type === 'tb' ? 'Testbench' : 'GTKW';
        const typeColor = type === 'tb' ? 'var(--accent-primary)' : 'var(--success)';

        card.innerHTML = `
            <div class="file-card-header">
                <i class="fas ${icon}" style="color: ${typeColor}"></i>
                <span class="file-type-badge" style="background-color: ${typeColor}">${typeLabel}</span>
            </div>
            <div class="file-card-body">
                <h3 class="file-name">${fileName}</h3>
                <p class="file-info">Click to select</p>
            </div>
        `;

        // Add click event to select the file
        card.addEventListener('click', () => {
            document.querySelectorAll(`.file-card[data-type="${type}"]`).forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            if (!window.selectedFiles) window.selectedFiles = {};
            window.selectedFiles[type] = fileName;
        });

        return card;
    }

    // Function to update file counters for testbench and GTKW files
    function updateFileCounters() {
        const tbFilesContainer = document.getElementById('tb-files-container');
        const gtkwFilesContainer = document.getElementById('gtkw-files-container');
        const tbFileCount = document.getElementById('tb-file-count');
        const gtkwFileCount = document.getElementById('gtkw-file-count');

        if (tbFileCount && gtkwFileCount) {
            const tbCount = tbFilesContainer.querySelectorAll('.file-card').length;
            const gtkwCount = gtkwFilesContainer.querySelectorAll('.file-card').length;

            tbFileCount.textContent = tbCount;
            gtkwFileCount.textContent = gtkwCount;
        }
    }

    // Event listener for saving configuration
    saveConfigButton.addEventListener('click', () => {
        if (multicoreCheckbox.checked) {
            const loadingOverlay = document.createElement('div');
            loadingOverlay.classList.add('loading-overlay');
            loadingOverlay.innerHTML = `
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <p>Loading Multicore Configuration...</p>
                </div>
            `;
            document.body.appendChild(loadingOverlay);

            setTimeout(() => {
                window.electronAPI.scanTopLevelFolder(currentProjectPath)
                    .then(files => {
                        const tbFiles = files.filter(file => file.endsWith('_tb.v'));
                        const gtkwFiles = files.filter(file => file.endsWith('.gtkw'));

                        return fetch('./html/multicore.html')
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error(`HTTP error! Status: ${response.status}`);
                                }
                                return response.text();
                            })
                            .then(html => ({ html, tbFiles, gtkwFiles }));
                    })
                    .then(data => {
                        loadingOverlay.remove();

                        const multicoreModalBody = document.getElementById('multicore-modal-body');
                        multicoreModalBody.innerHTML = data.html;

                        const multicoreModal = document.getElementById('multicore-modal');
                        multicoreModal.classList.remove('hidden');
                        multicoreModal.classList.add('active');

                        setTimeout(() => {
                            populateFileCards(data.tbFiles, data.gtkwFiles);
                        }, 100);

                        initializeMulticoreContent();
                    })
                    .catch(error => {
                        console.error('Error loading multicore.html:', error);
                        loadingOverlay.remove();
                        alert('Error loading multicore configuration. Please try again.');
                    });
            }, 800);
        }
    });

    // Function to initialize multicore modal content
    function initializeMulticoreContent() {
        const runMulticoreButton = document.getElementById('run-multicore-sim');
        if (runMulticoreButton) {
            runMulticoreButton.addEventListener('click', () => {
                const selectedFiles = window.selectedFiles || {};

                if (!selectedFiles.tb) {
                    alert('Please select a testbench file to run the simulation.');
                    return;
                }

                if (!selectedFiles.gtkw) {
                    alert('Please select a GTKW file for visualization.');
                    return;
                }

                console.log(`Running multicore simulation for TB: ${selectedFiles.tb}, GTKW: ${selectedFiles.gtkw}`);

                const multicoreModal = document.getElementById('multicore-modal');
                multicoreModal.classList.remove('active');
                multicoreModal.classList.add('hidden');

                saveMulticoreConfig(selectedFiles);
            });
        }
    }

    // Function to save multicore configuration
    function saveMulticoreConfig(selectedFiles) {
        console.log('Saving multicore configuration:', selectedFiles);

        localStorage.setItem('multicoreConfig', JSON.stringify(selectedFiles));

        const toast = document.createElement('div');
        toast.classList.add('toast');
        toast.innerHTML = `
            <div class="toast-content">
                <i class="fas fa-check-circle" style="color: var(--success);"></i>
                <span>Multicore configuration saved successfully!</span>
            </div>
        `;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
});
// Event listener for DOMContentLoaded to initialize button and terminal functionality
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Fully Loaded');
  
  const button = document.getElementById('create-toplevel-folder');
  if (button) {
    console.log('Button found');
    button.addEventListener('click', (e) => {
      console.log('Button clicked directly');
      e.preventDefault();
    });
  } else {
    console.error('Button not found');
  }
});

// Event listener for creating a top-level folder
document.getElementById("create-toplevel-folder").addEventListener("click", async () => {
  console.log("Button clicked"); // Diagnostic log
    
  if (!currentProjectPath) {
    console.error("No project open for TopLevel");
    alert("No project open for TopLevel.");
    return;
  }
  
  try {
    console.log("Attempting to create TopLevel in:", currentProjectPath);
    const result = await window.electronAPI.createTopLevel(currentProjectPath);
    
    console.log("Result:", result); // Diagnostic log
    alert(result.message);

    refreshFileTree(); // Refresh the file tree
  } catch (error) {
    console.error("Error creating TopLevel:", error);
    alert("Error creating TopLevel: " + error.message);
  }
});

// Event listener for initializing the TCMD terminal
document.addEventListener('DOMContentLoaded', () => {
  setupTcmdTerminal();
});

// Function to set up the TCMD terminal
function setupTcmdTerminal() {
  const terminalTcmd = document.getElementById('terminal-tcmd');
  if (!terminalTcmd) return;
  
  const terminalBody = terminalTcmd.querySelector('.terminal-body');
  terminalBody.innerHTML = ''; // Clear terminal content
  
  // Create terminal container
  const tcmdTerminal = document.createElement('div');
  tcmdTerminal.className = 'tcmd-terminal';
  terminalBody.appendChild(tcmdTerminal);
  
  // Create output area
  const outputArea = document.createElement('div');
  outputArea.className = 'tcmd-output';
  tcmdTerminal.appendChild(outputArea);
  
  // Create input wrapper
  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'tcmd-input-wrapper';
  tcmdTerminal.appendChild(inputWrapper);
  
  // Create prompt
  const prompt = document.createElement('span');
  prompt.className = 'tcmd-prompt';
  prompt.textContent = '> ';
  inputWrapper.appendChild(prompt);
  
  // Create input field
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tcmd-input';
  input.autofocus = true;
  inputWrapper.appendChild(input);
  
  let terminalStarted = false; // Flag to check if terminal has started
  
  // Start terminal when TCMD tab is clicked
  const tabTcmd = document.querySelector('button.tab[data-terminal="tcmd"]');
  if (tabTcmd) {
    tabTcmd.addEventListener('click', () => {
      if (!terminalStarted) {
        startTerminal();
      }
      setTimeout(() => input.focus(), 100);
    });
  }
  
  // Function to initialize the terminal
  function startTerminal() {
    if (window.terminalAPI) {
      window.terminalAPI.start(); // Start terminal process
      
      window.terminalAPI.onStarted(() => {
        terminalStarted = true;
        outputArea.textContent = 'Connecting to CMD...\n';
      });
      
      window.terminalAPI.onData((data) => {
        let cleanData = data
          .replace(/\r?\n/g, '\n') // Normalize line breaks
          .replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); // Remove ANSI codes
        
        outputArea.textContent += cleanData; // Append output
        
        const dirMatch = outputArea.textContent.match(/([A-Z]:\\[^\r\n>]*?)>/);
        if (dirMatch) {
          prompt.textContent = dirMatch[0]; // Update prompt with directory
        }
        
        tcmdTerminal.scrollTop = tcmdTerminal.scrollHeight; // Scroll to bottom
      });
    } else {
      outputArea.textContent += 'Terminal API not available in the current environment.\n';
    }
  }
  
  // Handle user input
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && terminalStarted) {
      const command = input.value;
      window.terminalAPI.write(command + '\r'); // Send command to terminal
      input.value = ''; // Clear input
      tcmdTerminal.scrollTop = tcmdTerminal.scrollHeight; // Scroll to bottom
      e.preventDefault();
    }
  });
  
  // Keep focus on input field
  tcmdTerminal.addEventListener('click', () => {
    input.focus();
  });
  
  // Clear terminal output
  const clearButton = document.getElementById('clear-terminal');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.terminal === 'tcmd') {
        outputArea.textContent = ''; // Clear output area
        if (terminalStarted) {
          window.terminalAPI.clear(); // Clear terminal process
        }
      }
    });
  }
}
