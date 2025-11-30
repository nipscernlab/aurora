export function showDialog({ title, message, buttons }) {
    return new Promise((resolve) => {
        // 1. Clean up any existing modals to prevent stacking
        const existingModal = document.querySelector('.confirm-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // 2. Generate Buttons HTML
        // Note: 'type' maps to your CSS classes like 'save', 'dont-save', 'cancel'
        const buttonsHTML = buttons.map(btn => {
            return `<button class="confirm-btn ${btn.type}" data-action="${btn.action}">${btn.label}</button>`;
        }).join('');

        // 3. Create Modal HTML
        const modalHTML = `
            <div class="confirm-modal" id="custom-dialog-modal">
                <div class="confirm-modal-content">
                    <div class="confirm-modal-header">
                        <div class="confirm-modal-icon">⚠</div>
                        <h3 class="confirm-modal-title">${title}</h3>
                    </div>
                    <div class="confirm-modal-message">
                        ${message}
                    </div>
                    <div class="confirm-modal-actions">
                        ${buttonsHTML}
                    </div>
                </div>
            </div>
        `;

        // 4. Inject into DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('custom-dialog-modal');

        // 5. Cleanup and Resolve Helper
        function closeModal(resultAction) {
            document.removeEventListener('keydown', handleEscape);
            modal.classList.remove('show');
            
            // Wait for CSS animation
            setTimeout(() => {
                modal.remove();
                resolve(resultAction);
            }, 300);
        }

        // 6. Event Listeners
        modal.addEventListener('click', (e) => {
            // Check if a button with data-action was clicked
            if (e.target.matches('button[data-action]')) {
                const action = e.target.getAttribute('data-action');
                closeModal(action);
            }
        });

        // Handle Escape Key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                // Default to 'cancel' or the first available action if cancel isn't present
                closeModal('cancel');
            }
        };
        document.addEventListener('keydown', handleEscape);

        // 7. Show with Animation & Focus
        setTimeout(() => {
            modal.classList.add('show');
            
            // Focus the last button (usually the primary action) or the first one
            const buttonsEl = modal.querySelectorAll('.confirm-btn');
            if (buttonsEl.length > 0) {
                // Determine which button to focus. 
                // Prioritize 'save' (primary) or fall back to the last one.
                const primaryBtn = modal.querySelector('.confirm-btn.save') || buttonsEl[buttonsEl.length - 1];
                primaryBtn.focus();
            }
        }, 10);
    });
}