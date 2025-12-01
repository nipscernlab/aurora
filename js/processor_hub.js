import { showDialog } from './dialogManager.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Element Selection ---
    const processorHubButton = document.getElementById('processorHub'); 
    const form = document.getElementById('processorHubForm');
    const generateButton = document.getElementById('generateProcessor'); 
    const modalContainer = document.getElementById('modalContainer'); 

    // Input Map
    const inputs = {
        name: document.getElementById('processorName'),
        nBits: document.getElementById('nBits'),
        gain: document.getElementById('gain'),
        mantissa: document.getElementById('nbMantissa'),
        exponent: document.getElementById('nbExponent'),
        iStack: document.getElementById('instructionStackSize'),
        dStack: document.getElementById('dataStackSize'),
        inPorts: document.getElementById('inputPorts'),
        outPorts: document.getElementById('outputPorts')
    };

    // --- State Management ---
    let currentProjectPath = null;

    // --- 2. Visual Feedback (Live Red Border) ---

    const setErrorStyle = (element) => {
        // Increased border width to 3px as requested
        element.style.setProperty('border', '3px solid #ff4444', 'important');
        element.style.setProperty('box-shadow', '0 0 6px rgba(255, 68, 68, 0.4)', 'important');
        element.style.setProperty('outline', 'none', 'important');
    };

    const resetInputStyle = (element) => {
        element.style.removeProperty('border');
        element.style.removeProperty('box-shadow');
        element.style.removeProperty('outline');
    };

    // --- 3. Validation Logic ---

    // Helper: Validates a single field based on a condition function
    const validateField = (element, conditionFn) => {
        const value = element.value;
        const isValid = conditionFn(value);

        if (!isValid) {
            setErrorStyle(element);
            return false;
        } else {
            resetInputStyle(element);
            return true;
        }
    };

    // Rule A: Name Validation
    // Allowed: a-z, A-Z, 0-9, - (dash), _ (underscore)
    // Disallowed: Spaces, symbols (!@#$), accents, punctuation
    const checkName = () => {
        return validateField(inputs.name, (val) => {
            if (!val) return false; // Empty check
            
            // Regex Explanation:
            // ^             : Start of line
            // [a-zA-Z0-9_-] : Character set allowing letters, numbers, dash, underscore
            // +             : One or more of the preceding set
            // $             : End of line
            const validNameRegex = /^[a-zA-Z0-9_-]+$/;
            
            return validNameRegex.test(val);
        });
    };

    // Rule B: Positive Integers (> 0)
    const checkPositiveInteger = (element) => {
        return validateField(element, (val) => {
            const num = Number(val);
            // Must be number, integer, and strictly greater than 0
            return !isNaN(num) && Number.isInteger(num) && num > 0;
        });
    };

    // Rule C: Non-Negative Integers (>= 0)
    const checkNonNegativeInteger = (element) => {
        return validateField(element, (val) => {
            const num = Number(val);
            return !isNaN(num) && Number.isInteger(num) && num >= 0;
        });
    };

    // Rule D: Gain (Power of 2)
    const checkGain = () => {
        return validateField(inputs.gain, (val) => {
            const num = parseInt(val);
            if (isNaN(num) || num <= 0) return false;
            return (num & (num - 1)) === 0; // Bitwise check for power of 2
        });
    };

    // Rule E: Bit Consistency (Total = Mantissa + Exponent + 1)
    const checkBitConsistency = () => {
        const nBits = parseInt(inputs.nBits.value) || 0;
        const mantissa = parseInt(inputs.mantissa.value) || 0;
        const exponent = parseInt(inputs.exponent.value) || 0;

        const isConsistent = nBits === (mantissa + exponent + 1);

        if (!isConsistent) {
            setErrorStyle(inputs.nBits);
        } else {
            // Only reset if it also passes the basic integer check
            if (nBits > 0) resetInputStyle(inputs.nBits);
        }
        return isConsistent;
    };

    // --- 4. Master Validation (Updates Button) ---

    const validateAll = () => {
        let isValid = true;

        if (!checkName()) isValid = false;
        if (!checkPositiveInteger(inputs.nBits)) isValid = false;
        if (!checkPositiveInteger(inputs.mantissa)) isValid = false;
        if (!checkPositiveInteger(inputs.exponent)) isValid = false;
        if (!checkGain()) isValid = false;
        if (!checkPositiveInteger(inputs.iStack)) isValid = false;
        if (!checkPositiveInteger(inputs.dStack)) isValid = false;
        if (!checkNonNegativeInteger(inputs.inPorts)) isValid = false;
        if (!checkNonNegativeInteger(inputs.outPorts)) isValid = false;

        // Logical Check (Must be last to override style if needed)
        if (!checkBitConsistency()) isValid = false;

        // Update Button State
        if (generateButton) {
            generateButton.disabled = !isValid;
        }

        return isValid;
    };

    // --- 5. Event Listeners (Live) ---

    // Attach 'input' listeners to ALL fields to trigger validation instantly
    Object.values(inputs).forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                validateAll();
            });
        }
    });


    // --- 6. IPC Listeners (Electron) ---

    if (window.electronAPI) {
        if (window.electronAPI.onProcessorHubState) {
            window.electronAPI.onProcessorHubState((state) => {
                if (processorHubButton) processorHubButton.disabled = false;
            });
        }

        if (window.electronAPI.onProcessorsUpdated) {
            window.electronAPI.onProcessorsUpdated((data) => {
                currentProjectPath = data.projectPath;
            });
        }
    }

    // --- 7. Modal Interaction ---

    document.getElementById('cancelProcessorHub')?.addEventListener('click', () => {
        if (modalContainer) modalContainer.classList.add('hidden');
        if (form) form.reset();
        
        Object.values(inputs).forEach(input => resetInputStyle(input));
        
        // Reset button state based on default values
        setTimeout(validateAll, 50); 
    });


    // --- 8. Submit Handler ---

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!validateAll()) return; 

            if (!currentProjectPath) {
                await showDialog({
                    title: 'Error',
                    message: 'No active project found.',
                    buttons: [{ label: 'OK', action: 'ok', type: 'cancel' }]
                });
                return;
            }

            // UI Loading
            const originalButtonText = generateButton.innerHTML;
            generateButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Generating...</span>';
            generateButton.disabled = true;

            const formData = {
                projectLocation: currentProjectPath,
                processorName: inputs.name.value.trim(), // Trim strictly just in case
                nBits: parseInt(inputs.nBits.value),
                nbMantissa: parseInt(inputs.mantissa.value),
                nbExponent: parseInt(inputs.exponent.value),
                dataStackSize: parseInt(inputs.dStack.value),
                instructionStackSize: parseInt(inputs.iStack.value),
                inputPorts: parseInt(inputs.inPorts.value),
                outputPorts: parseInt(inputs.outPorts.value),
                gain: parseInt(inputs.gain.value),
            };

            try {
                const result = await window.electronAPI.createProcessorProject(formData);

                if (result && result.success) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    try {
                        await window.electronAPI.triggerFileTreeRefresh();
                    } catch (err) { console.error(err); }

                    document.getElementById('cancelProcessorHub').click(); 
                    /*
                    await showDialog({
                        title: 'Success',
                        message: `Processor "${formData.processorName}" created successfully!`,
                        buttons: [{ label: 'Great', action: 'ok', type: 'save' }]
                    });
                    */
                } else {
                    throw new Error(result.message || 'Unknown error');
                }

            } catch (error) {
                console.error(error);
                await showDialog({
                    title: 'Error',
                    message: `Failed to create processor: ${error.message}`,
                    buttons: [{ label: 'Close', action: 'close', type: 'cancel' }]
                });
            } finally {
                generateButton.innerHTML = originalButtonText;
                validateAll(); 
            }
        });
    }

    // --- 9. Initial Run ---
    validateAll();
});