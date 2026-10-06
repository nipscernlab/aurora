/**
 * dialogo_nao_salvo.ts: a pergunta "salvar, nao salvar ou cancelar" antes de
 * fechar a ultima instancia de um arquivo com mudanca nao salva.
 *
 * Saiu do tab_manager em 05/10/2026. O TabManager a usa ao fechar uma aba, e
 * o split_editor ao fechar a ultima instancia num painel dividido; por isso o
 * tab_manager a reexporta, e quem a importava de la continua importando.
 */

/** O que a pessoa escolheu: `save`, `dont-save` ou `cancel` (tambem o Esc). */
export type RespostaNaoSalvo = 'save' | 'dont-save' | 'cancel';

export function showUnsavedChangesDialog(fileName: string): Promise<RespostaNaoSalvo> {
    return new Promise((resolve) => {
        // Remove any existing modals
        const existingModal = document.querySelector('.confirm-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const modalHTML = `
            <div class="confirm-modal" id="unsaved-changes-modal">
                <div class="confirm-modal-content">
                    <div class="confirm-modal-header">
                        <div class="confirm-modal-icon"><i class="ph ph-warning" aria-hidden="true"></i></div>
                        <h3 class="confirm-modal-title">Unsaved Changes</h3>
                    </div>
                    <div class="confirm-modal-message">
                        Do you want to save the changes you made to "<strong>${fileName}</strong>"?<br>
                        Your changes will be lost if you don't save them.
                    </div>
                    <div class="confirm-modal-actions">
                        <button class="confirm-btn cancel" data-action="cancel">Cancel</button>
                        <button class="confirm-btn dont-save" data-action="dont-save">Don't Save</button>
                        <button class="confirm-btn save" data-action="save">Save</button>
                    </div>
                </div>
            </div>
        `;

        // Add modal to document
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        // Acabou de entrar no body com este id.
        const modal = document.getElementById('unsaved-changes-modal') as HTMLElement;

        // Handle button clicks
        modal.addEventListener('click', (e) => {
            const action = (e.target as Element).getAttribute('data-action') as RespostaNaoSalvo | null;
            if (action) {
                closeModal(action);
            }
        });

        // Handle escape key
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeModal('cancel');
            }
        };
        document.addEventListener('keydown', handleEscape);

        // Close modal function
        function closeModal(result: RespostaNaoSalvo) {
            document.removeEventListener('keydown', handleEscape);
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
                resolve(result);
            }, 300);
        }

        // Show modal with animation
        setTimeout(() => {
            modal.classList.add('show');
            // Focus the Save button by default
            (modal.querySelector('.confirm-btn.save') as HTMLElement)
                .focus();
        }, 10);
    });
}
