// tooltip.js - Enhanced universal tooltip system for AURORA IDE
document.addEventListener('DOMContentLoaded', () => {
    // Create tooltip element with arrow
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    tooltip.innerHTML = '<div class="tooltip-content"></div><div class="tooltip-arrow"></div>';
    document.body.appendChild(tooltip);
    
    const tooltipContent = tooltip.querySelector('.tooltip-content');
    const tooltipArrow = tooltip.querySelector('.tooltip-arrow');
  
    // Tooltip configuration
    const tooltipConfig = {
        delay: 300,
        duration: 200,
        distance: 12,
        arrowSize: 6
    };
    
    // Track current active element
    let activeElement = null;
    let tooltipTimeout = null;
  
    // Extended descriptions for each element
    const extendedDescriptions = {
        // Main toolbar buttons
        'sidebarMenu': 'Opens the main navigation panel to access the website, report bugs, view GitHub repository, read update news, check keyboard shortcuts, and exit the program.',
        'refresh-button': 'Refreshes the file tree and reloads project structure.',
        'newProjectBtn': 'Creates a new AURORA .spf project with the complete folder structure and initial configuration files.',
        'backupFolderBtn': 'Creates a .zip backup of the entire project, making it easy to share or safeguard your work.',
        'openProjectBtn': 'Opens an existing .spf project and loads it into the workspace.',
        'projectInfo': 'Displays detailed information and properties about the currently loaded .spf project.',
        
        // Compilation buttons
        'cmmcomp': 'Compiles the project\'s C+- (.cmm) source files into low-level assembly (.asm) code.',
        'asmcomp': 'Converts assembly (.asm) files into Verilog (.v) code, preparing them for hardware simulation.',
        'vericomp': 'Compiles Verilog (.v) files using Icarus Verilog (iverilog) to generate simulation binaries.',
        'wavecomp': 'Analyzes Verilog output using VVP, generates VCD waveforms, and opens GTKWave to visualize signal behavior.',
        'prismcomp': 'Launches the RTL interactive visualizer to explore processor architectures and signal relationships.',
        'allcomp': 'Performs a full compilation workflow: C± ➔ ASM ➔ Verilog ➔ Waveform, building the processor completely.',
        'fractalcomp': 'Performs a full compilation workflow and launches the Fractal Processor Simulator, allowing you to run and test your processor design interactively.',
        'importBtn': 'Import all files to the compilation environment. Supports drag & drop.',
        'line-number': 'Shows current line and column position in the editor.',
        'themeToggle': 'Switches between light and dark themes for optimal comfort based on your environment.',
        'settings': 'Opens the processor configuration panel to customize hardware parameters and optimization settings.',
        
        // Additional main buttons
        'info-aurora': 'Shows detailed information about AURORA IDE version, system specs (Windows, Node.js, Electron, Chromium), and credits.',
        'processorHub': 'Opens the Processor Hub to design and configure new processors, setting ports, memory size, and architectural options.',
        'aiButton': 'Accesses the AI Assistant to leverage ChatGPT or Claude for help with processor development and troubleshooting inside the IDE.',
        'aurora-settings': 'Opens AURORA IDE settings to configure preferences and application behavior.',
        'current-spf-name': 'Displays the name of the currently loaded project.',
        'verilog-block': 'Browse and insert a prebuilt Verilog module into your project. Most modules are generic and FPGA-agnostic, but always review before integrating.',
        'toggle-ui': 'Switch the IDE\'s GUI between Processor Oriented and Project Oriented modes.',
        'change-icon-btn': 'Change the icon of the AURORA IDE. You can select any image file from your computer.',
        'context-refactor-button': 'Opens refactoring options for the current code context.',
        'cancel-everything': 'Cancel all processes and stop the simulation. This will not stop the program, but it will stop all processes and the simulation.',
        'translate': 'Opens translation tools for internationalization support.',
        
        // Terminal buttons
        'clear-terminal': 'Clear all content from the current terminal tab.',
        'goup-terminal': 'Scroll up in the terminal output.',
        'godown-terminal': 'Scroll down in the terminal output.',
        'export-log': 'Export the current terminal log to a file.',
        'reload-everything-terminal': 'Reload the entire application and refresh all components.',
        'filter-error': 'Toggle visibility of error messages in the terminal output.',
        'filter-warning': 'Toggle visibility of warning messages in the terminal output.',
        'filter-success': 'Toggle visibility of success messages in the terminal output.',
        'filter-tip': 'Toggle visibility of tip messages in the terminal output.',
        
        // File tree buttons
        'open-hdl-button': 'Open HDL files viewer for hardware description language files.',
        'open-folder-button': 'Open the current project folder in the system file explorer.',
        'close-button': 'Close the current project and return to the welcome screen.',
        'toggle-file-tree': 'Collapse or expand all folders in the file tree.',
        'clear-search': 'Clear the current file search query.',
        
        // Processor Configuration Modal
        'closeModal': 'Close the processor configuration modal without saving changes.',
        'deleteProcessor': 'Delete the currently selected processor configuration.',
        'saveConfig': 'Save the current processor configuration settings.',
        'cancelConfig': 'Cancel and discard any changes made to the processor configuration.',
        'processorSelect': 'Choose which processor to configure from the available processors in your project.',
        'cmmFileSelect': 'Select the C± source file (.cmm) to compile for this processor.',
        'processortestbenchSelect': 'Choose the testbench file (.v) for simulating the processor behavior.',
        'processorClk': 'Set the clock frequency in MHz for processor simulation (maximum 1000MHz).',
        'processorNumClocks': 'Define the total number of clock cycles to run during simulation.',
        'processorSimulTime': 'Specify the total simulation time in microseconds.',
        'processorgtkwaveSelect': 'Select a GTKWave configuration file (.gtkw) to customize waveform display.',
        'showArraysInGtkwave': 'Enable viewing of C± array contents in the waveform viewer (may slow simulation).',
        
        // Project Configuration Modal
        'closeProjectModal': 'Close the project configuration modal without saving changes.',
        'saveProjectConfig': 'Save the current project configuration settings.',
        'cancelProjectConfig': 'Cancel and discard any changes made to the project configuration.',
        'importSynthesizableBtn': 'Import synthesizable Verilog (.v) files into the project.',
        'importTestbenchBtn': 'Import testbench and GTKWave (.v, .gtkw) files into the project.',
        'addProcessor': 'Add a new processor configuration to the current project.',
        'projectSimuDelay': 'Set the default simulation time value used in testbench timing calculations.',
        'showArraysInGtkwave-project': 'Enable viewing of C± array contents in the waveform viewer for all processors (may slow simulation).',
        
        // New Project Modal
        'browseBtn': 'Browse and select the directory where the new project will be created.',
        'generateProjectBtn': 'Generate the new project with the specified name and location.',
        'cancelProjectBtn': 'Cancel the new project creation and close the dialog.',
        'projectNameInput': 'Enter a name for your new processor project.',
        'projectLocationInput': 'Specify the directory where the project files will be created.',
        
        // Processor Hub Modal (dynamic elements)
        'processorName': 'Enter a unique name for your processor (used in file generation).',
        'nBits': 'Total number of bits for the processor architecture (must equal mantissa + exponent + 1 sign bit).',
        'nbMantissa': 'Number of bits allocated for the mantissa in floating-point operations.',
        'nbExponent': 'Number of bits allocated for the exponent in floating-point operations.',
        'dataStackSize': 'Size of the data stack for storing operands and intermediate results.',
        'instructionStackSize': 'Size of the instruction stack for program execution flow.',
        'inputPorts': 'Number of input ports for external data communication.',
        'outputPorts': 'Number of output ports for external data communication.',
        'pipeln': 'Pipeline depth level - higher values increase performance but complexity.',
        'gain': 'Amplification factor for signal processing (must be a power of 2).',
        'cancelProcessorHub': 'Cancel processor creation and return to the main interface.',
        'generateProcessor': 'Create the processor with the specified configuration.',
        
        // Search and file inputs
        'file-search-input': 'Search for files in the current project by name or extension.',
        'synthesizableFileInput': 'Select synthesizable Verilog files to import.',
        'testbenchFileInput': 'Select testbench or GTKWave files to import.',
        
        // Power off
        'power-off': 'Exit the AURORA IDE application safely.'
    };
    
    // Universal selector for all interactive elements that should have tooltips
    const elementSelectors = [
        'button:not([data-no-tooltip])',
        '[role="button"]:not([data-no-tooltip])',
        '.toolbar-button',
        '.toolbar-toggle-ui',
        '.tab',
        '.filter-btn',
        'input[type="button"]',
        'input[type="submit"]',
        'input[type="text"]:not(.search-input)',
        'input[type="number"]',
        'select',
        'textarea',
        '.clickable',
        '[data-tooltip]',
        '[title]',
        '.modalConfig-select',
        '.modalConfig-input',
        '.modalConfig-checkbox',
        '.npmodal-btn',
        '.processor-hub-form input',
        '.processor-hub-form select'
    ].join(', ');
  
    // Function to get all relevant elements
    function getAllTooltipElements() {
        return document.querySelectorAll(elementSelectors);
    }
    
    // Function to get tooltip text for an element
    function getTooltipText(element) {
        const elementId = element.id;
        
        // Priority order: extended descriptions > data-tooltip > title attribute > fallback
        if (elementId && extendedDescriptions[elementId]) {
            return extendedDescriptions[elementId];
        }
        
        if (element.getAttribute('data-tooltip')) {
            return element.getAttribute('data-tooltip');
        }
        
        if (element.getAttribute('title')) {
            const titleText = element.getAttribute('title');
            // Remove the title attribute to prevent native tooltip from showing
            element.removeAttribute('title');
            // Store it as data-original-title for reference
            element.setAttribute('data-original-title', titleText);
            return titleText;
        }
        
        if (element.getAttribute('data-original-title')) {
            return element.getAttribute('data-original-title');
        }
        
        // Fallback based on element type
        if (element.tagName === 'INPUT') {
            const placeholder = element.getAttribute('placeholder');
            const label = element.getAttribute('aria-label') || element.getAttribute('name');
            if (placeholder) return `Input field: ${placeholder}`;
            if (label) return `Input field for ${label}`;
            return 'Input field for data entry';
        }
        
        if (element.tagName === 'SELECT') {
            const label = element.getAttribute('aria-label') || element.getAttribute('name');
            if (label) return `Selection dropdown for ${label}`;
            return 'Selection dropdown';
        }
        
        if (element.textContent && element.textContent.trim()) {
            const text = element.textContent.trim();
            if (text.length < 50) { // Don't use long text content as tooltip
                return `${text}`;
            }
        }
        
        return null;
    }
    
    // Calculate optimal tooltip position
    function calculateTooltipPosition(mouseX, mouseY, tooltipWidth, tooltipHeight) {
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        
        const margin = 10; // Margin from viewport edges
        let position = {
            x: mouseX + tooltipConfig.distance,
            y: mouseY + tooltipConfig.distance,
            arrowPosition: 'top-left' // Default arrow position
        };
        
        // Check horizontal overflow and adjust
        if (position.x + tooltipWidth > viewport.width - margin) {
            position.x = mouseX - tooltipWidth - tooltipConfig.distance;
            position.arrowPosition = position.arrowPosition.replace('left', 'right');
        }
        
        // Check vertical overflow and adjust
        if (position.y + tooltipHeight > viewport.height - margin) {
            position.y = mouseY - tooltipHeight - tooltipConfig.distance;
            position.arrowPosition = position.arrowPosition.replace('top', 'bottom');
        }
        
        // Ensure tooltip doesn't go off screen edges
        if (position.x < margin) {
            position.x = margin;
            position.arrowPosition = 'top-left';
        }
        
        if (position.y < margin) {
            position.y = margin;
            position.arrowPosition = 'top-left';
        }
        
        return position;
    }
    
    // Position the tooltip arrow based on tooltip and mouse position
    function positionTooltipArrow(tooltipPos, mouseX, mouseY) {
        const tooltipRect = tooltip.getBoundingClientRect();
        const arrowSize = tooltipConfig.arrowSize;
        
        // Calculate relative mouse position to tooltip
        const relativeX = mouseX - tooltipPos.x;
        const relativeY = mouseY - tooltipPos.y;
        
        // Reset arrow classes
        tooltipArrow.className = 'tooltip-arrow';
        
        // Determine arrow position and styling
        if (tooltipPos.arrowPosition.includes('bottom')) {
            tooltipArrow.classList.add('arrow-bottom');
            tooltipArrow.style.top = '100%';
            tooltipArrow.style.bottom = 'auto';
            tooltipArrow.style.left = Math.max(arrowSize, Math.min(tooltipRect.width - arrowSize, relativeX)) + 'px';
        } else {
            tooltipArrow.classList.add('arrow-top');
            tooltipArrow.style.top = `-${arrowSize}px`;
            tooltipArrow.style.bottom = 'auto';
            tooltipArrow.style.left = Math.max(arrowSize, Math.min(tooltipRect.width - arrowSize, relativeX)) + 'px';
        }
        
        if (tooltipPos.arrowPosition.includes('right')) {
            tooltipArrow.classList.add('arrow-right');
            tooltipArrow.style.left = '100%';
            tooltipArrow.style.right = 'auto';
            tooltipArrow.style.top = Math.max(arrowSize, Math.min(tooltipRect.height - arrowSize, relativeY)) + 'px';
        } else if (!tooltipPos.arrowPosition.includes('bottom') && !tooltipPos.arrowPosition.includes('top')) {
            tooltipArrow.classList.add('arrow-left');
            tooltipArrow.style.left = `-${arrowSize}px`;
            tooltipArrow.style.right = 'auto';
        }
    }
    
    // Add event listeners to all relevant elements
    function addTooltipListeners() {
        const elements = getAllTooltipElements();
        
        elements.forEach(element => {
            // Skip if already has listeners (to avoid duplicates)
            if (element.hasAttribute('data-tooltip-initialized')) {
                return;
            }
            
            element.setAttribute('data-tooltip-initialized', 'true');
            
            element.addEventListener('mouseenter', (e) => handleMouseEnter(e, element));
            element.addEventListener('mouseleave', (e) => handleMouseLeave(e, element));
            element.addEventListener('mousemove', (e) => handleMouseMove(e, element));
        });
    }
    
    // Handle mouse enter
    function handleMouseEnter(e, element) {
        // Clear any existing timeout
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
        }
        
        // Get tooltip text
        const tooltipText = getTooltipText(element);
        if (!tooltipText) {
            return;
        }
        
        // Set a timeout to show the tooltip (prevents flashing on quick mouse movements)
        tooltipTimeout = setTimeout(() => {
            // Update tooltip content
            tooltipContent.textContent = tooltipText;
            tooltip.classList.add('visible');
            
            // Position the tooltip
            positionTooltip(e);
            
            // Track this as the active element
            activeElement = element;
        }, tooltipConfig.delay);
    }
    
    // Handle mouse leave
    function handleMouseLeave(e, element) {
        // Clear the show timeout if it exists
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }
        
        // If this was the active element, hide tooltip
        if (activeElement === element) {
            tooltip.classList.remove('visible');
            activeElement = null;
        }
    }
    
    // Handle mouse move
    function handleMouseMove(e, element) {
        if (activeElement === element && tooltip.classList.contains('visible')) {
            positionTooltip(e);
        }
    }
    
    // Position the tooltip with improved arrow positioning
    function positionTooltip(e) {
        const mouseX = e.clientX;
        const mouseY = e.clientY;
        
        // Force a layout calculation to get accurate dimensions
        tooltip.style.visibility = 'hidden';
        tooltip.style.display = 'block';
        
        const tooltipRect = tooltip.getBoundingClientRect();
        const tooltipWidth = tooltipRect.width;
        const tooltipHeight = tooltipRect.height;
        
        // Calculate optimal position
        const position = calculateTooltipPosition(mouseX, mouseY, tooltipWidth, tooltipHeight);
        
        // Set the tooltip position
        tooltip.style.left = `${position.x}px`;
        tooltip.style.top = `${position.y}px`;
        tooltip.style.visibility = 'visible';
        
        // Position the arrow after a brief delay to ensure tooltip is rendered
        setTimeout(() => {
            positionTooltipArrow(position, mouseX, mouseY);
        }, 10);
    }
    
    // Initialize tooltips
    addTooltipListeners();
    
    // Re-initialize tooltips when new elements are added to the DOM
    const observer = new MutationObserver((mutations) => {
        let shouldReinitialize = false;
        
        mutations.forEach((mutation) => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node or its children match our selectors
                        if (node.matches && node.matches(elementSelectors)) {
                            shouldReinitialize = true;
                        } else if (node.querySelector) {
                            const hasRelevantChildren = node.querySelector(elementSelectors);
                            if (hasRelevantChildren) {
                                shouldReinitialize = true;
                            }
                        }
                    }
                });
            }
        });
        
        if (shouldReinitialize) {
            // Small delay to ensure DOM is fully updated
            setTimeout(addTooltipListeners, 10);
        }
    });
    
    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Hide tooltip on various events
    const hideTooltipEvents = ['resize', 'scroll', 'click', 'keydown'];
    hideTooltipEvents.forEach(eventType => {
        window.addEventListener(eventType, () => {
            if (activeElement) {
                tooltip.classList.remove('visible');
                activeElement = null;
            }
            if (tooltipTimeout) {
                clearTimeout(tooltipTimeout);
                tooltipTimeout = null;
            }
        }, eventType === 'scroll' ? true : false);
    });
});

// Handle horizontal scrolling for tabs container
document.addEventListener('DOMContentLoaded', () => {
    const tabsContainer = document.querySelector('.tabs-container');
    if (tabsContainer) {
        tabsContainer.addEventListener('wheel', function(e) {
            if (e.deltaY !== 0) {
                e.preventDefault();
                this.scrollLeft += e.deltaY > 0 ? 50 : -50;
            }
        });
    }
});