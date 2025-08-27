// Wait for the DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- Element Selection ---
    const processorHubButton = document.getElementById('processorHub');
    const modalContainer = document.getElementById('modalContainer');
    const form = document.getElementById('processorHubForm');
    const generateButton = document.getElementById('generateProcessor');
    const cancelButton = document.getElementById('cancelProcessorHub');
    const overlay = document.querySelector('.processor-hub-overlay');

    // Form input elements
    const nBitsInput = document.getElementById('nBits');
    const nbMantissaInput = document.getElementById('nbMantissa');
    const nbExponentInput = document.getElementById('nbExponent');
    const gainInput = document.getElementById('gain');
    const processorNameInput = document.getElementById('processorName');

    // --- State Management ---
    // This variable will hold the path to the current project, received from the main process.
    let currentProjectPath = null;

    // --- IPC Listeners (Communication with Main Process) ---
    // This is the core of the solution. We listen for events sent from main.js.

    // 1. Listen for the event that enables/disables the Processor Hub button.
    // Your preload.js exposes this as 'onProcessorHubState'.
    if (window.electronAPI && window.electronAPI.onProcessorHubState) {
        window.electronAPI.onProcessorHubState((state) => {
            console.log('Received processor hub state from main process:', state);
            // Enable or disable the button based on the message from main.js
            processorHubButton.disabled = false;
        });
    } else {
        console.error('onProcessorHubState is not available on window.electronAPI!');
    }

    // 2. Listen for the event that sends the list of processors and, crucially, the project path.
    // Your preload.js exposes this as 'onProcessorsUpdated'.
    if (window.electronAPI && window.electronAPI.onProcessorsUpdated) {
        window.electronAPI.onProcessorsUpdated((data) => {
            console.log('Received project data update from main process. Project path is:', data.projectPath);
            // Set the local 'currentProjectPath' variable with the path received from main.js
            currentProjectPath = data.projectPath;
        });
    } else {
        console.error('onProcessorsUpdated is not available on window.electronAPI!');
    }


    // --- UI Functions ---
    /**
     * Opens the processor creation modal.
     */
    function openModal() {
        modalContainer.classList.remove('hidden');
        validateCustomRules(); // Perform initial validation
    }

    /**
     * Closes the processor creation modal.
     */
    function closeModal() {
        modalContainer.classList.add('hidden');
    }

    // --- Validation Functions ---
    /**
     * Helper function to check if a number is a power of 2.
     * @param {number} value - The number to check.
     * @returns {boolean}
     */
    function isPowerOfTwo(value) {
        return value > 0 && (value & (value - 1)) === 0;
    }

    /**
     * Performs real-time validation for custom form rules.
     */
    function validateCustomRules() {
        const nBits = parseInt(nBitsInput.value) || 0;
        const nbMantissa = parseInt(nbMantissaInput.value) || 0;
        const nbExponent = parseInt(nbExponentInput.value) || 0;
        const gain = parseInt(gainInput.value) || 0;

        const isNBitsValid = nBits === nbMantissa + nbExponent + 1;
        const isGainValid = isPowerOfTwo(gain);

        nBitsInput.setCustomValidity(isNBitsValid ? '' : 'Number of Bits must equal Nb Mantissa + Nb Exponent + 1');
        gainInput.setCustomValidity(isGainValid ? '' : 'Gain must be a power of 2');

        generateButton.disabled = !form.checkValidity();
    }


    // --- UI Event Listeners ---
    processorHubButton.addEventListener('click', openModal);
    cancelButton.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    // Attach real-time validation to relevant input fields
    [nBitsInput, nbMantissaInput, nbExponentInput, gainInput, processorNameInput].forEach(input => {
        input.addEventListener('input', validateCustomRules);
    });

    // Handle the main form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Now, this check will work because 'currentProjectPath' is updated by the IPC listener.
        if (!currentProjectPath) {
            console.error('No project path available. Cannot create processor.');
            window.electronAPI.showErrorDialog('Error', 'No project is currently open or the project path was not received.');
            return;
        }

        const processorName = processorNameInput.value;
        if (!processorName || processorName.trim() === '') {
            console.error('Processor name is required');
            return;
        }

        // Show loading state
        const originalButtonText = generateButton.innerHTML;
        generateButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
        generateButton.disabled = true;

        const formData = {
            projectLocation: currentProjectPath,
            processorName: processorName,
            nBits: parseInt(nBitsInput.value),
            nbMantissa: parseInt(nbMantissaInput.value),
            nbExponent: parseInt(nbExponentInput.value),
            dataStackSize: parseInt(document.getElementById('dataStackSize').value),
            instructionStackSize: parseInt(document.getElementById('instructionStackSize').value),
            inputPorts: parseInt(document.getElementById('inputPorts').value),
            outputPorts: parseInt(document.getElementById('outputPorts').value),
            pipeln: parseInt(document.getElementById('pipeln').value),
            gain: parseInt(gainInput.value),
        };

        console.log('Form data being sent to main process:', formData);

        try {
            const result = await window.electronAPI.createProcessorProject(formData);
            if (result && result.success) {
                console.log('Processor project created successfully.');
                closeModal();
                await window.electronAPI.refreshFileTree();
            } else {
                throw new Error(result.message || 'Failed to create processor project.');
            }
        } catch (error) {
            console.error('Error creating processor project:', error);
            window.electronAPI.showErrorDialog('Creation Failed', `An error occurred: ${error.message}`);
        } finally {
            // Always reset the button state
            generateButton.innerHTML = originalButtonText;
            validateCustomRules();
        }
    });

    // --- Initial Setup ---
    // Initially, the button should be disabled until a project is opened.
    // The IPC listener 'onProcessorHubState' will handle enabling it.
    processorHubButton.disabled = true;
});