  // Wait for the DOM to fully load before executing the script
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('auroraAboutModal');
    let performanceInterval;

    // Function to open the modal
    function openAuroraAboutModal() {
        modal.classList.remove('aurora-about-hidden');
        startPerformanceMonitoring();
    }

    // Function to close the modal
    function closeAuroraAboutModal() {
        modal.classList.add('aurora-about-hidden');
        stopPerformanceMonitoring();
    }

    // Make functions globally available
    window.openAuroraAboutModal = openAuroraAboutModal;
    window.closeAuroraAboutModal = closeAuroraAboutModal;

    // Format bytes to human readable format
    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Format uptime to human readable format
    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${secs}s`;
        return `${secs}s`;
    }

    // Start performance monitoring
    function startPerformanceMonitoring() {
        updatePerformanceStats();
        performanceInterval = setInterval(updatePerformanceStats, 2000);
    }

    // Stop performance monitoring
    function stopPerformanceMonitoring() {
        if (performanceInterval) {
            clearInterval(performanceInterval);
            performanceInterval = null;
        }
    }

    // Update performance statistics
    function updatePerformanceStats() {
        if (window.electronAPI && window.electronAPI.getPerformanceStats) {
            window.electronAPI.getPerformanceStats().then(stats => {
                document.getElementById('aurora-uptime').textContent = formatUptime(stats.uptime);
                document.getElementById('aurora-memory-usage').textContent = formatBytes(stats.memoryUsage);
                document.getElementById('aurora-cpu-usage').textContent = stats.cpuUsage + '%';
            }).catch(err => {
                console.warn('Performance stats not available:', err);
            });
        } else {
            // Fallback for basic stats
            const uptime = performance.now() / 1000;
            document.getElementById('aurora-uptime').textContent = formatUptime(uptime);
            
            if (performance.memory) {
                document.getElementById('aurora-memory-usage').textContent = 
                    formatBytes(performance.memory.usedJSHeapSize);
            }
        }
    }

    // Fetch and display application information
    if (window.electronAPI && window.electronAPI.getAppInfo) {
        window.electronAPI.getAppInfo().then((info) => {
            document.getElementById('aurora-app-version').textContent = info.appVersion || '1.0.0';
            document.getElementById('aurora-electron-version').textContent = info.electronVersion || 'N/A';
            document.getElementById('aurora-chrome-version').textContent = info.chromeVersion || 'N/A';
            document.getElementById('aurora-node-version').textContent = info.nodeVersion || 'N/A';
            document.getElementById('aurora-os-info').textContent = info.osInfo || 'Unknown OS';
            document.getElementById('aurora-arch').textContent = info.arch || 'Unknown';
            document.getElementById('aurora-memory').textContent = info.totalMemory ? 
                formatBytes(info.totalMemory) : 'N/A';
            document.getElementById('aurora-build-date').textContent = info.buildDate || 
                new Date().toLocaleDateString();
            document.getElementById('aurora-environment').textContent = info.environment || 'Production';
        }).catch(err => {
            console.error('Failed to load app info:', err);
            // Set fallback values
            document.getElementById('aurora-app-version').textContent = '1.0.0';
            document.getElementById('aurora-electron-version').textContent = 'N/A';
            document.getElementById('aurora-chrome-version').textContent = 'N/A';
            document.getElementById('aurora-node-version').textContent = 'N/A';
            document.getElementById('aurora-os-info').textContent = navigator.platform || 'Unknown OS';
            document.getElementById('aurora-arch').textContent = 'Unknown';
            document.getElementById('aurora-memory').textContent = 'N/A';
            document.getElementById('aurora-build-date').textContent = new Date().toLocaleDateString();
            document.getElementById('aurora-environment').textContent = 'Development';
        });
    }

    // Close modal with Escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('aurora-about-hidden')) {
            closeAuroraAboutModal();
        }
    });

    // Prevent modal content click from closing modal
    modal.querySelector('.aurora-about-content').addEventListener('click', (event) => {
        event.stopPropagation();
    });
  });