// Toggle between light and dark themes
document.getElementById('themeToggle').addEventListener('click', () => {
    const body = document.body;
    const isDark = body.classList.contains('theme-dark');
    
    // Switch theme classes on the body element
    body.classList.toggle('theme-dark');
    body.classList.toggle('theme-light');
    
    // Update the editor theme if it exists
    if (editor) {
      editor.updateOptions({
        theme: isDark ? 'vs' : 'vs-dark'
      });
    }
});

// Show the information box
function showInfoBox() {
    const infoBox = document.getElementById('infoBox');
    infoBox.classList.add('visible');
    infoBox.classList.remove('hidden');
    
    // Adjust the position of the info box if it exceeds 80% of the viewport height
    const infoBoxHeight = infoBox.offsetHeight;
    const viewportHeight = window.innerHeight;
    if (infoBoxHeight > viewportHeight * 0.8) {
      infoBox.style.top = `${viewportHeight / 2}px`;
      infoBox.style.transform = 'translate(-50%, -50%)';
    }
}

// Close the information box
function closeInfoBox() {
    const infoBox = document.getElementById('infoBox');
    infoBox.classList.remove('visible');
    
    // Add the hidden class after a delay to allow for animations
    setTimeout(() => {
      infoBox.classList.add('hidden');
    }, 300);
}

