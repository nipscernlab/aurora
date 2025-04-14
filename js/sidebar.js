// Function to toggle the visibility of the sidebar
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");

  // Check if the sidebar is currently open
  if (sidebar.style.left === "0px") {
    sidebar.style.left = "-60px"; // Close the sidebar
  } else {
    sidebar.style.left = "0px"; // Open the sidebar
  }
}

// Close the sidebar when clicking outside of it
document.addEventListener("click", function (event) {
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("sidebarMenu");

  // Close the sidebar if it's open and the click is outside the sidebar and menu button
  if (
    sidebar.style.left === "0px" &&
    !sidebar.contains(event.target) &&
    !menuButton.contains(event.target)
  ) {
    sidebar.style.left = "-60px";
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarItems = sidebar.querySelectorAll('li');

  // Function to open a browser with a predefined URL
  const launchBrowser = () => {
    window.electronAPI.openExternalLink('https://nipscern.com');
  };

  // Function to display a loading overlay for search operations
  const showSearchLoading = () => {
    const loadingIcon = document.createElement('div');
    loadingIcon.innerHTML = `
      <div class="loading-overlay">
        <i class="fa-solid fa-hourglass-half"></i>
        <button id="closeLoading" class="close-loading">✕</button>
      </div>
    `;
    document.body.appendChild(loadingIcon);

    document.getElementById('closeLoading').addEventListener('click', () => {
      loadingIcon.remove();
    });
  };

  // Function to display a loading overlay for AST view operations
  const showASTLoading = () => {
    const loadingIcon = document.createElement('div');
    loadingIcon.innerHTML = `
      <div class="loading-overlay">
        <i class="fa-solid fa-hourglass-half"></i>
        <button id="closeASTLoading" class="close-loading">✕</button>
      </div>
    `;
    document.body.appendChild(loadingIcon);

    document.getElementById('closeASTLoading').addEventListener('click', () => {
      loadingIcon.remove();
    });
  };

  // Function to display project information in a loading overlay
  const showProjectInfo = () => {
    const loadingIcon = document.createElement('div');
    loadingIcon.innerHTML = `
      <div class="loading-overlay">
        <i class="fa-solid fa-hourglass-half"></i>
        <button id="closeProjectInfo" class="close-loading">✕</button>
      </div>
    `;
    document.body.appendChild(loadingIcon);

    document.getElementById('closeProjectInfo').addEventListener('click', () => {
      loadingIcon.remove();
    });
  };

  // Function to handle application shutdown with a confirmation dialog
  const shutdownApplication = () => {
    const shutdownOverlay = document.createElement('div');
    shutdownOverlay.innerHTML = `
      <div class="shutdown-overlay">
        <div class="shutdown-dialog">
          <h3>Shutting Down</h3>
          <div class="countdown">5</div>
          <div class="shutdown-actions">
            <button id="cancelShutdown">Cancel</button>
            <button id="confirmShutdown">Confirm</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(shutdownOverlay);

    const countdownEl = shutdownOverlay.querySelector('.countdown');
    let countdown = 5;
    const countdownInterval = setInterval(() => {
      countdown--;
      countdownEl.textContent = countdown;

      if (countdown <= 0) {
        clearInterval(countdownInterval);
        window.electronAPI.quitApp();
      }
    }, 1000);

    document.getElementById('cancelShutdown').addEventListener('click', () => {
      clearInterval(countdownInterval);
      shutdownOverlay.remove();
    });

    document.getElementById('confirmShutdown').addEventListener('click', () => {
      window.electronAPI.quitApp();
    });
  };

  // Function to open the keyboard shortcuts modal
  const openKeyboardShortcuts = () => {
    const infoBox = document.getElementById('infoBox');
    infoBox.classList.remove('hidden');

    const closeButton = infoBox.querySelector('.info-box-close');
    closeButton.addEventListener('click', () => {
      infoBox.classList.add('hidden');
    });
  };

  // Add click event listeners to sidebar items
  sidebarItems.forEach(item => {
    item.addEventListener('click', (event) => {
      const title = item.getAttribute('title');

      // Handle actions based on the title of the clicked sidebar item
      switch (title) {
        case 'Browse the web':
          launchBrowser();
          break;
        case 'Search for information':
          showSearchLoading();
          break;
        case 'View the Abstract Syntax Tree (AST)':
          showASTLoading();
          break;
        case 'Report a bug':
          openModal('bug-report-modal');
          break;
        case 'Open GitHub Desktop':
          window.electronAPI.openGitHubDesktop();
          break;
        case 'Keyboard shortcuts':
          openKeyboardShortcuts();
          break;
        case 'Project information':
          showProjectInfo();
          break;
        case 'Shut down the application':
          shutdownApplication();
          break;
      }
    });
  });
});

// Utility function to open modals by ID
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}