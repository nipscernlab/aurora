document.addEventListener('DOMContentLoaded', () => {
    const bugReportButton = document.getElementById('open-bug-report');
    const bugReportModal = document.getElementById('bug-report-modal');
    const closeBugReportButton = document.getElementById('close-bug-report');
    const bugReportForm = document.getElementById('bug-report-form');

    // Open the bug report modal when the button is clicked
    bugReportButton.addEventListener('click', () => {
        bugReportModal.classList.remove('hidden');
    });

    // Close the bug report modal when the close button is clicked
    closeBugReportButton.addEventListener('click', () => {
        bugReportModal.classList.add('hidden');
    });

    // Handle the bug report form submission
    bugReportForm.addEventListener('submit', (event) => {
        event.preventDefault(); // Prevent default form submission behavior

        const formData = new FormData(bugReportForm);

        // Send the form data to the server using the FormSpree API
        fetch(bugReportForm.action, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: formData,
        })
            .then((response) => {
                if (response.ok) {
                    // Show success message and reset the form
                    alert('Bug report sent successfully!');
                    bugReportForm.reset();
                    bugReportModal.classList.add('hidden');
                } else {
                    // Show error message if the response is not OK
                    alert('Failed to send bug report. Please try again.');
                }
            })
            .catch(() => {
                // Show error message if there is a network issue
                alert('Failed to send bug report. Please check your connection.');
            });
    });
});

