// Function to toggle the sidebar
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");

  // Check if the sidebar is open
  if (sidebar.style.left === "0px") {
    // Close the sidebar
    sidebar.style.left = "-60px";
  } else {
    // Open the sidebar
    sidebar.style.left = "0px";
  }
}

// Close the sidebar when clicking outside
document.addEventListener("click", function (event) {
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("sidebarMenu");

  // Check if the sidebar is open and the click is outside the sidebar and button
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

  // Browser launch function
  const launchBrowser = () => {
      window.electronAPI.openExternalLink('https://nipscern.com');
  };

  // Search information function
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

  // AST View function
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

  // Project Information function
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

  // Shutdown Application function
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

  // Open Keyboard Shortcuts
  const openKeyboardShortcuts = () => {
      const infoBox = document.getElementById('infoBox');
      infoBox.classList.remove('hidden');

      const closeButton = infoBox.querySelector('.info-box-close');
      closeButton.addEventListener('click', () => {
          infoBox.classList.add('hidden');
      });
  };

  // Sidebar Item Click Handlers
  sidebarItems.forEach(item => {
      item.addEventListener('click', (event) => {
          const title = item.getAttribute('title');

          switch(title) {
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

// Utility function to open modals (assuming you have this from previous implementation)
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
      modal.classList.add('active');
  }
}