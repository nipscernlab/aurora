// Select key elements for notification and modal functionality
const bellIcon = document.querySelector('.notification-bell');
const notificationDot = document.querySelector('.notification-dot');
const newsModal = document.getElementById('newsModal');
const modalBackdrop = document.getElementById('modalBackdrop');
const closeButton = document.getElementById('closeNewsModal');

// Key for storing read status in local storage
const READ_STATUS_KEY = 'newsUpdatesReadStatus';

// Check if the user has seen the latest updates and update the notification dot
function checkReadStatus() {
  const lastReadDate = localStorage.getItem(READ_STATUS_KEY);
  const latestUpdateDate = '2023-06-15'; // Update this date when new content is added

  if (!lastReadDate || new Date(lastReadDate) < new Date(latestUpdateDate)) {
    notificationDot.classList.remove('hidden');
  } else {
    notificationDot.classList.add('hidden');
  }
}

// Open the news modal and mark updates as read
function openNewsModal() {
  newsModal.classList.add('visible');
  modalBackdrop.classList.add('visible');
  markAsRead();
}

// Close the news modal
function closeNewsModal() {
  newsModal.classList.remove('visible');
  modalBackdrop.classList.remove('visible');
}

// Mark updates as read by hiding the notification dot and saving the current date
function markAsRead() {
  notificationDot.classList.add('hidden');
  const currentDate = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
  localStorage.setItem(READ_STATUS_KEY, currentDate);
}

// Toggle the news modal when the bell icon is clicked
bellIcon.addEventListener('click', (event) => {
  event.stopPropagation();
  if (newsModal.classList.contains('visible')) {
    closeNewsModal();
  } else {
    openNewsModal();
  }
});

// Close the modal when the close button is clicked
closeButton.addEventListener('click', () => {
  closeNewsModal();
});

// Close the modal when clicking outside the modal content
modalBackdrop.addEventListener('click', () => {
  closeNewsModal();
});

// Prevent modal from closing when clicking inside the modal content
newsModal.addEventListener('click', (event) => {
  event.stopPropagation();
});

// Close the modal when the Escape key is pressed
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && newsModal.classList.contains('visible')) {
    closeNewsModal();
  }
});

// Initialize notification status and add animation effect to new content
document.addEventListener('DOMContentLoaded', () => {
  checkReadStatus();

  // Remove the "pulse" animation effect from new content after 10 seconds
  setTimeout(() => {
    const newItems = document.querySelectorAll('.news-section.new');
    newItems.forEach(item => {
      item.classList.remove('pulse');
    });
  }, 10000);
});