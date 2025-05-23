document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  const menuButton = document.getElementById("sidebarMenu");
  const sidebarItems = sidebar.querySelectorAll("li");

  // === Modal elements & helpers ===
  const kbModal = document.querySelector(".kb-modal");
  const kbOverlay = document.createElement("div");
  kbOverlay.className = "kb-modal__overlay";
  // insert overlay as first child of modal container
  kbModal.insertBefore(kbOverlay, kbModal.firstChild);

  function openKeyboardShortcuts() {
    kbModal.classList.add("is-open");
  }

  function closeKeyboardShortcuts() {
    kbModal.classList.remove("is-open");
  }

  // close via X button
  kbModal
    .querySelector(".kb-modal__close")
    .addEventListener("click", closeKeyboardShortcuts);

  // close by clicking overlay
  kbOverlay.addEventListener("click", closeKeyboardShortcuts);

  // close on Esc
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && kbModal.classList.contains("is-open")) {
      closeKeyboardShortcuts();
    }
  });

  // === Sidebar toggle logic ===
  function toggleSidebar() {
    sidebar.style.left =
      sidebar.style.left === "0px" ? "-60px" : "0px";
  }
  document.getElementById("sidebarMenu").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
  document.addEventListener("click", (event) => {
    if (
      sidebar.style.left === "0px" &&
      !sidebar.contains(event.target) &&
      !menuButton.contains(event.target)
    ) {
      sidebar.style.left = "-60px";
    }
  });

  // === Loading overlays, shutdown, etc. ===
  // (keep your existing showSearchLoading, showASTLoading, showProjectInfo, shutdownApplication)

  // === Sidebar item routing ===
  sidebarItems.forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.getAttribute("title");
      switch (action) {
        case "Browse the web":
          launchBrowser();
          break;
        case "Search for information":
          showSearchLoading();
          break;
        case "View the Abstract Syntax Tree (AST)":
          showASTLoading();
          break;
        case "Report a bug":
          openModal("bug-report-modal");
          break;
        case "Open GitHub Desktop":
          window.electronAPI.openGitHubDesktop();
          break;
        case "Keyboard shortcuts":
          openKeyboardShortcuts();
          break;
        case "Project information":
          showProjectInfo();
          break;
        case "Shut down the application":
          shutdownApplication();
          break;
      }
    });
  });
});
