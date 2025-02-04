document.addEventListener('DOMContentLoaded', () => {
    const bugReportButton = document.getElementById('open-bug-report');
    const bugReportModal = document.getElementById('bug-report-modal');
    const closeBugReportButton = document.getElementById('close-bug-report');
  
    // Abrir modal
    bugReportButton.addEventListener('click', () => {
      bugReportModal.classList.remove('hidden');
    });
  
    // Fechar modal
    closeBugReportButton.addEventListener('click', () => {
      bugReportModal.classList.add('hidden');
    });
  
    // Submissão do formulário
    const bugReportForm = document.getElementById('bug-report-form');
    bugReportForm.addEventListener('submit', (event) => {
      event.preventDefault(); // Evitar o comportamento padrão
      const formData = new FormData(bugReportForm);
  
      // Enviar dados ao FormSpree
      fetch(bugReportForm.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      })
        .then((response) => {
          if (response.ok) {
            alert('Bug report enviado com sucesso!');
            bugReportForm.reset();
            bugReportModal.classList.add('hidden');
          } else {
            alert('Erro ao enviar bug report. Tente novamente.');
          }
        })
        .catch(() => alert('Erro ao enviar bug report. Verifique sua conexão.'));
    });
  });
  
