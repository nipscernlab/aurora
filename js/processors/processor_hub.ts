import { electronAPI } from '../app/electron_api.js';
import { showDialog } from '../ui/dialog_manager.js';
import { PADROES_DO_CPPCOMP as PADROES } from '../project/processor_defaults.js';

/*
 * Compilado por `tsc` (npm run build:ts) num processor_hub.js ao lado, e esse
 * .js que o runtime carrega; os imports usam a extensao `.js`.
 */

/** Os campos do formulario, todos <input>. */
type CampoDoFormulario = HTMLInputElement | null;

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. Element Selection ---
    const processorHubButton = document.getElementById('processorHub') as HTMLButtonElement | null;
    const form = document.getElementById('processorHubForm') as HTMLFormElement | null;
    const generateButton = document.getElementById('generateProcessor') as HTMLButtonElement | null;
    const modalContainer = document.getElementById('modalContainer');

    // Input Map
    const campo = (id: string): CampoDoFormulario =>
        document.getElementById(id) as HTMLInputElement | null;

    const inputs: Record<string, CampoDoFormulario> = {
        name: campo('processorName'),
        nBits: campo('nBits'),
        gain: campo('gain'),
        mantissa: campo('nbMantissa'),
        exponent: campo('nbExponent'),
        iStack: campo('instructionStackSize'),
        dStack: campo('dataStackSize'),
        inPorts: campo('inputPorts'),
        outPorts: campo('outputPorts')
    };

    // O seletor de linguagem e os campos que ele governa.
    //
    // O front end C++ do yanc (cpppp + cppcomp) le do fonte so o nome e as
    // duas contagens de porta, como `#pragma yanc prname/nuioin/nuioou`. Para
    // largura, mantissa, expoente, ganho e as duas pilhas ele usa os padroes
    // dele (Compilers/CPPComp/Headers/config.h), e escrever ali os numeros
    // deste formulario cravaria no fonte um valor que ninguem escolheu. Por
    // isso, em C++, estes seis campos ficam desabilitados, mostrando o que o
    // compilador vai de fato assumir, e saem da validacao.
    const radioCmm = campo('languageCmm');
    const radioCpp = campo('languageCpp');
    const dicaLinguagem = document.getElementById('processorLanguageHint');

    /** Os campos que SO existem em C+-. Nome e portas ficam de fora. */
    const CAMPOS_SO_DO_CMM = ['nBits', 'gain', 'mantissa', 'exponent', 'iStack', 'dStack'] as const;

    /**
     * O que o cppcomp assume quando o fonte nao traz o pragma, ja no
     * vocabulario curto que o `inputs` acima usa.
     *
     * Os NUMEROS vem de js/project/processor_defaults.ts, que e quem escreve o
     * fonte; aqui so se traduz o nome do campo. Antes eram os mesmos seis
     * numeros digitados de novo, com um comentario dizendo que nao dava para
     * compartilhar modulo entre o main e o renderer, o que deixou de ser
     * verdade quando o processo principal passou a carregar modulo daqui.
     */
    const PADROES_DO_CPPCOMP: Record<string, string> = {
        nBits: String(PADROES.nBits),
        mantissa: String(PADROES.nbMantissa),
        exponent: String(PADROES.nbExponent),
        gain: String(PADROES.gain),
        dStack: String(PADROES.dataStackSize),
        iStack: String(PADROES.instructionStackSize),
    };

    /** O que a pessoa digitou em C+-, para voltar quando ela desmarcar C++. */
    const valoresDoCmm: Record<string, string> = {};

    const linguagemEscolhida = (): 'cmm' | 'cpp' => (radioCpp?.checked ? 'cpp' : 'cmm');

    // --- State Management ---
    let currentProjectPath: string | null = null;

    // --- 2. Visual Feedback (Live Red Border) ---

    const setErrorStyle = (element: HTMLElement) => {
        // Increased border width to 3px as requested
        element.style.setProperty('border', '3px solid #ff4444', 'important');
        element.style.setProperty('box-shadow', '0 0 6px rgba(255, 68, 68, 0.4)', 'important');
        element.style.setProperty('outline', 'none', 'important');
    };

    const resetInputStyle = (element: HTMLElement | null) => {
        if (!element) return;
        element.style.removeProperty('border');
        element.style.removeProperty('box-shadow');
        element.style.removeProperty('outline');
    };

    // --- 3. Validation Logic ---

    // Helper: Validates a single field based on a condition function
    const validateField = (element: CampoDoFormulario, conditionFn: (v: string) => boolean): boolean => {
        if (!element) return false;
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

    // Rule B: Positive Integers (> 0). Empty strings are rejected explicitly
    //, `Number("")` is 0 which would otherwise pass the >0 guard for fields
    // whose JS check is non-negative; we don't want any field accepting empty.
    const checkPositiveInteger = (element: CampoDoFormulario): boolean => {
        return validateField(element, (val) => {
            if (val === '' || val == null) return false;
            const num = Number(val);
            return !isNaN(num) && Number.isInteger(num) && num > 0;
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
        const nBits = parseInt(inputs.nBits?.value ?? '') || 0;
        const mantissa = parseInt(inputs.mantissa?.value ?? '') || 0;
        const exponent = parseInt(inputs.exponent?.value ?? '') || 0;

        const isConsistent = nBits === (mantissa + exponent + 1);

        if (!isConsistent) {
            if (inputs.nBits) setErrorStyle(inputs.nBits);
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

        // Em C++ estes seis nao sao perguntados, entao nao sao validados: o
        // que esta neles e o padrao do cppcomp, so para a pessoa ver.
        if (linguagemEscolhida() === 'cmm') {
            if (!checkPositiveInteger(inputs.nBits)) isValid = false;
            if (!checkPositiveInteger(inputs.mantissa)) isValid = false;
            if (!checkPositiveInteger(inputs.exponent)) isValid = false;
            if (!checkGain()) isValid = false;
            if (!checkPositiveInteger(inputs.iStack)) isValid = false;
            if (!checkPositiveInteger(inputs.dStack)) isValid = false;
        }
        // Ports must be a positive integer like every other numeric field:
        // we used to accept 0 (and silently empty) which let users submit
        // a half-blank Processor Hub form.
        if (!checkPositiveInteger(inputs.inPorts)) isValid = false;
        if (!checkPositiveInteger(inputs.outPorts)) isValid = false;

        // Logical Check (Must be last to override style if needed)
        if (linguagemEscolhida() === 'cmm' && !checkBitConsistency()) isValid = false;

        // Update Button State
        if (generateButton) {
            generateButton.disabled = !isValid;
        }

        return isValid;
    };

    /**
     * Poe o formulario no estado da linguagem escolhida. Em C++ os seis
     * campos do C+- ficam desabilitados e passam a MOSTRAR o que o cppcomp
     * assume; ao voltar para C+-, o que a pessoa tinha digitado volta.
     */
    const aplicarLinguagem = () => {
        const ehCpp = linguagemEscolhida() === 'cpp';
        for (const chave of CAMPOS_SO_DO_CMM) {
            const el = inputs[chave];
            if (!el) continue;
            if (ehCpp) {
                if (!el.disabled) valoresDoCmm[chave] = el.value;
                el.value = PADROES_DO_CPPCOMP[chave] ?? el.value;
                el.disabled = true;
                resetInputStyle(el);
            } else {
                el.disabled = false;
                if (chave in valoresDoCmm) el.value = valoresDoCmm[chave];
            }
            el.closest('.form-group')?.classList.toggle('is-disabled', ehCpp);
        }
        dicaLinguagem?.classList.toggle('hidden', !ehCpp);
        validateAll();
    };

    for (const radio of [radioCmm, radioCpp]) {
        radio?.addEventListener('change', aplicarLinguagem);
    }

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

    if (electronAPI) {
        if (electronAPI.onProcessorHubState) {
            electronAPI.onProcessorHubState(() => {
                if (processorHubButton) processorHubButton.disabled = false;
            });
        }

        if (electronAPI.onProcessorsUpdated) {
            electronAPI.onProcessorsUpdated((data: { projectPath: string }) => {
                currentProjectPath = data.projectPath;
            });
        }
    }

    // --- 7. Modal Interaction ---

    const closeProcessorHubModal = () => {
        if (modalContainer) {
            modalContainer.classList.remove('show');
            modalContainer.setAttribute('aria-hidden', 'true');
        }
        if (form) form.reset();
        Object.values(inputs).forEach(input => resetInputStyle(input));
        // O form.reset() devolve o radio ao C+-, que e o `checked` do HTML;
        // aplicarLinguagem reabilita os campos e limpa os valores guardados.
        for (const chave of Object.keys(valoresDoCmm)) delete valoresDoCmm[chave];
        aplicarLinguagem();
        setTimeout(validateAll, 50);
    };

    document.getElementById('cancelProcessorHub')?.addEventListener('click', closeProcessorHubModal);
    document.getElementById('closeProcessorHub')?.addEventListener('click', closeProcessorHubModal);

    // A ajuda contextual deste modal mora na tabela de js/ui/help_link.js.


    // --- 8. Submit Handler ---

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!validateAll()) return;

            if (!currentProjectPath) {
                const tr = (k: string) => (window.t ? window.t(k) : k);
                await showDialog({
                    title: tr('dialog.common.error'),
                    message: tr('dialog.hub.noProjectMessage'),
                    buttons: [{ label: tr('dialog.common.ok'), action: 'ok', type: 'cancel' }]
                });
                return;
            }

            // UI Loading
            const originalButtonText = generateButton?.innerHTML ?? '';
            if (generateButton) {
                generateButton.innerHTML = '<i class="ph ph-spinner animate-spin"></i> <span>Generating...</span>';
                generateButton.disabled = true;
            }

            const formData = {
                projectLocation: currentProjectPath,
                processorName: (inputs.name?.value ?? '').trim(), // Trim strictly just in case
                language: linguagemEscolhida(),
                nBits: parseInt(inputs.nBits?.value ?? ''),
                nbMantissa: parseInt(inputs.mantissa?.value ?? ''),
                nbExponent: parseInt(inputs.exponent?.value ?? ''),
                dataStackSize: parseInt(inputs.dStack?.value ?? ''),
                instructionStackSize: parseInt(inputs.iStack?.value ?? ''),
                inputPorts: parseInt(inputs.inPorts?.value ?? ''),
                outputPorts: parseInt(inputs.outPorts?.value ?? ''),
                gain: parseInt(inputs.gain?.value ?? ''),
            };

            try {
                const result = await electronAPI.createProcessorProject(formData);

                if (result && result.success) {
                    // The IPC resolved, so the folder and files are already on
                    // disk; a fixed sleep here protected nothing and cost a
                    // second on every new processor.
                    try {
                        await electronAPI.triggerFileTreeRefresh();
                    } catch (err) { console.error(err); }

                    (document.getElementById('cancelProcessorHub') as HTMLButtonElement | null)?.click();
                } else {
                    const tr = (k: string) => (window.t ? window.t(k) : k);
                    throw new Error(result.message || tr('dialog.processorHub.unknownError'));
                }

            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                console.error(error);
                const tr = (k: string, p?: Record<string, unknown>) => (window.t ? window.t(k, p) : k);
                await showDialog({
                    title: tr('dialog.processorHub.errorTitle'),
                    // Technical detail (error.message) stays as-is, it may
                    // come from the main process (where i18n isn't loaded)
                    // and contains paths/codes that don't need translating.
                    message: tr('dialog.processorHub.errorMessage', { detail: error.message }),
                    buttons: [{ label: tr('dialog.common.close'), action: 'close', type: 'cancel' }]
                });
            } finally {
                if (generateButton) generateButton.innerHTML = originalButtonText;
                validateAll();
            }
        });
    }

    // --- 9. Initial Run ---
    aplicarLinguagem();
});
