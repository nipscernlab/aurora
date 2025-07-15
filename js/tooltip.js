// tooltip.js - Modern tooltip system for Electron app
document.addEventListener('DOMContentLoaded', () => {
    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    document.body.appendChild(tooltip);
  
    // Tooltip configuration
    const tooltipConfig = {
      delay: 300,
      duration: 200,
      distance: 10
    };
    
    // Track current active button
    let activeButton = null;
    let tooltipTimeout = null;
  
    // Get all toolbar buttons
    const buttons = document.querySelectorAll('.toolbar-button, .toolbar-toggle-ui');
    
    // Extended descriptions for each button
    const extendedDescriptions = {
        'sidebarMenu': 'Opens the main navigation panel to access the website, report bugs, view GitHub repository, read update news, check keyboard shortcuts, and exit the program.',
  
        'newProjectBtn': 'Creates a new AURORA .spf project with the complete folder structure and initial configuration files.',
        'backupFolderBtn': 'Creates a .zip backup of the entire project, making it easy to share or safeguard your work.',
        'openProjectBtn': 'Opens an existing .spf project and loads it into the workspace.',
        'projectInfo': 'Displays detailed information and properties about the currently loaded .spf project.',
        
        'saveFileBtn': 'Saves any changes made to the currently open file in the Monaco Editor.',
        
        'cmmcomp': 'Compiles the project\'s C+- (.cmm) source files into low-level assembly (.asm) code.',
        'asmcomp': 'Converts assembly (.asm) files into Verilog (.v) code, preparing them for hardware simulation.',
        'vericomp': 'Compiles Verilog (.v) files using Icarus Verilog (iverilog) to generate simulation binaries.',
        'wavecomp': 'Analyzes Verilog output using VVP, generates VCD waveforms, and opens GTKWave to visualize signal behavior.',
        'prismcomp': 'Launches the RTL interactive visualizer to explore processor architectures and signal relationships.',
        'allcomp': 'Performs a full compilation workflow: CMM ➔ ASM ➔ Verilog ➔ Waveform, building the processor completely.',
        'fractalcomp': 'Performs a full compilation workflow and launches the Fractal Processor Simulator, allowing you to run and test your processor design interactively.',
        'importBtn': 'Import all files to the compilation enviroment. Supports drag&drop.',
        'line-number': 'Opa. Bão?',
        'themeToggle': 'Switches between light and dark themes for optimal comfort based on your environment.',
        'settings': 'Opens the processor configuration panel to customize hardware parameters and optimization settings.',
        
        'info-aurora': 'Shows detailed information about AURORA IDE version, system specs (Windows, Node.js, Electron, Chromium), and credits.',
        'processorHub': 'Opens the Processor Hub to design and configure new processors, setting ports, memory size, and architectural options.',
        'aiAssistant': 'Accesses the AI Assistant to leverage ChatGPT or Claude for help with processor development and troubleshooting inside the IDE.',
        'current-spf-name': 'Project Currently Open',
        'verilog-block': 'Browse and Insert a Prebuilt Verilog Module into Your Project. Most modules are generic and FPGA-agnostic, but always review before integrating.',
        'toggle-ui' : 'Switch the IDE\'s GUI between Processor Oriented and Project Oriented modes.',
        'change-icon-btn' : 'Change the icon of the AURORA IDE. You can select any image file from your computer.',
        'context-refactor-button': 'teste',
        'cancel-everything': 'Cancel all processes and stop the simulation. This will not stop the program, but it will stop all processes and the simulation.',
        'palette': 'Add some colors and personalize your AURORA IDE!',
        'aiAssistant': 'Shows detailed information about AURORA IDE version, system specs (Windows, Node.js, Electron, Chromium), and credits.',

        'goup-terminal': 'Go Up',
        'godown-terminal': 'Go Down',
        'export-log': 'Export Log',
        'reload-everything-terminal': 'Reload Everything',
        'filter-error': 'Filter Errors',
        'filter-warning': 'Filter Warnings',
        'filter-success': 'Filter Successes',
        'filter-tip': 'Filter Tips',

        'power-off': 'Teste',
      };
  
    // Add mouse events to all buttons
    buttons.forEach(button => {
      button.addEventListener('mouseenter', (e) => {
        const buttonId = button.id;
        
        // Clear any existing timeout
        if (tooltipTimeout) {
          clearTimeout(tooltipTimeout);
        }
        
        // Set a timeout to show the tooltip (prevents flashing on quick mouse movements)
        tooltipTimeout = setTimeout(() => {
          // Get description from title attribute or extended descriptions
          const description = extendedDescriptions[buttonId] || button.getAttribute('title') || 'No description available';
          
          // Update tooltip content
          tooltip.textContent = description;
          tooltip.classList.add('visible');
          
          // Position the tooltip
          positionTooltip(e);
          
          // Track this as the active button
          activeButton = button;
          
          // Add event listener for mouse movement on this button
          button.addEventListener('mousemove', positionTooltip);
        }, tooltipConfig.delay);
      });
  
      button.addEventListener('mouseleave', () => {
        // Clear the show timeout if it exists
        if (tooltipTimeout) {
          clearTimeout(tooltipTimeout);
          tooltipTimeout = null;
        }
        
        // If this was the active button, hide tooltip and clean up
        if (activeButton === button) {
          // Add transition class for smooth fade out
          tooltip.classList.remove('visible');
          
          // Remove the mousemove listener
          button.removeEventListener('mousemove', positionTooltip);
          activeButton = null;
        }
      });
    });
  
    // Position the tooltip near the cursor
    function positionTooltip(e) {
      const x = e.clientX;
      const y = e.clientY;
      
      // Get tooltip dimensions
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      
      // Calculate position to ensure tooltip stays within viewport
      let posX = x + tooltipConfig.distance;
      let posY = y + tooltipConfig.distance;
      
      // Check if tooltip would go off right edge
      if (posX + tooltipWidth > window.innerWidth) {
        posX = x - tooltipWidth - tooltipConfig.distance;
      }
      
      // Check if tooltip would go off bottom edge
      if (posY + tooltipHeight > window.innerHeight) {
        posY = y - tooltipHeight - tooltipConfig.distance;
      }
      
      // Set the tooltip position
      tooltip.style.left = `${posX}px`;
      tooltip.style.top = `${posY}px`;
    }
  
    // Add window resize handling to reposition tooltips if needed
    window.addEventListener('resize', () => {
      if (activeButton) {
        // Force hide tooltip when window resizes
        tooltip.classList.remove('visible');
        activeButton = null;
      }
    });
  });

document.querySelector('.tabs-container').addEventListener('wheel', function(e) {
  if (e.deltaY !== 0) {
    e.preventDefault();
    this.scrollLeft += e.deltaY > 0 ? 50 : -50;
  }
});