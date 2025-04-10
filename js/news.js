// Select elements
const bellIcon = document.querySelector('.notification-bell');
const notificationDot = document.querySelector('.notification-dot');
const newsModal = document.getElementById('newsModal');
const modalBackdrop = document.getElementById('modalBackdrop');
const closeButton = document.getElementById('closeNewsModal');

// Local storage key for read status
const READ_STATUS_KEY = 'newsUpdatesReadStatus';

// Check if the user has seen the latest updates
function checkReadStatus() {
  const lastReadDate = localStorage.getItem(READ_STATUS_KEY);
  
  // If no read date found or it's older than the last update, show notification dot
  if (!lastReadDate) {
    notificationDot.classList.remove('hidden');
  } else {
    // Compare with your latest update date - this should be updated when new content is added
    const latestUpdateDate = '2023-06-15'; // Format: YYYY-MM-DD - Update this when adding new content
    if (new Date(lastReadDate) < new Date(latestUpdateDate)) {
      notificationDot.classList.remove('hidden');
    } else {
      notificationDot.classList.add('hidden');
    }
  }
}

// Open news modal
function openNewsModal() {
  newsModal.classList.add('visible');
  modalBackdrop.classList.add('visible');
  
  // Mark as read
  markAsRead();
}

// Close news modal
function closeNewsModal() {
  newsModal.classList.remove('visible');
  modalBackdrop.classList.remove('visible');
}

// Mark updates as read
function markAsRead() {
  // Hide notification dot
  notificationDot.classList.add('hidden');
  
  // Save current date as read date
  const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
  localStorage.setItem(READ_STATUS_KEY, currentDate);
}

// Toggle modal when clicking bell icon
bellIcon.addEventListener('click', (event) => {
  event.stopPropagation();
  
  if (newsModal.classList.contains('visible')) {
    closeNewsModal();
  } else {
    openNewsModal();
  }
});

// Close modal when clicking close button
closeButton.addEventListener('click', () => {
  closeNewsModal();
});

// Close modal when clicking outside
modalBackdrop.addEventListener('click', () => {
  closeNewsModal();
});

// Prevent closing when clicking inside modal
newsModal.addEventListener('click', (event) => {
  event.stopPropagation();
});

// Handle escape key to close modal
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && newsModal.classList.contains('visible')) {
    closeNewsModal();
  }
});

// Initialize notification status on page load
document.addEventListener('DOMContentLoaded', () => {
  checkReadStatus();
  
  // Add animation effect to new content
  setTimeout(() => {
    const newItems = document.querySelectorAll('.news-section.new');
    newItems.forEach(item => {
      item.classList.remove('pulse');
    });
  }, 10000);
});