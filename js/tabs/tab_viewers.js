/**
 * Image / PDF viewers for the tab system.
 *
 * These methods used to be static members of TabManager. They're factored
 * out here as a plain object that gets `Object.assign(TabManager, viewers)`
 * back into the class — `this` inside each method still resolves to
 * TabManager when called as `TabManager.foo()`, so no signatures or
 * call-site behaviour change.
 *
 * Why a mixin instead of a separate class:
 *   - The viewer cache (`viewerInstances`, `pdfViewerStates`) lives on
 *     TabManager and is read by other parts of the class (close paths,
 *     activation paths). Keeping `this`-binding compatible avoids having
 *     to thread a context object through every callsite.
 */

// Decode whatever shape window.electronAPI.readFileBuffer returns into a
// fresh ArrayBuffer suitable for Blob construction.
function bufferToArrayBuffer(buffer) {
    if (buffer instanceof ArrayBuffer) return buffer;
    if (ArrayBuffer.isView(buffer)) {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    if (buffer.buffer && buffer.byteLength) {
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
    return Uint8Array.from(buffer).buffer;
}

export const tabViewers = {
    // -- Image viewer ---------------------------------------------------------

    createImageViewer(filePath /*, container */) {
        if (this.viewerInstances.has(filePath)) {
            return this.viewerInstances.get(filePath);
        }

        const imageViewer = document.createElement('div');
        imageViewer.className = 'image-viewer';
        imageViewer.innerHTML = `
    <div class="image-viewer-toolbar">
      <div class="image-viewer-controls">
        <button class="image-control-btn" id="zoom-in-btn" title="Zoom In">
          <i class="fas fa-search-plus"></i>
        </button>
        <button class="image-control-btn" id="zoom-out-btn" title="Zoom Out">
          <i class="fas fa-search-minus"></i>
        </button>
        <button class="image-control-btn" id="zoom-reset-btn" title="Reset Zoom">
          <i class="fas fa-expand-arrows-alt"></i>
        </button>
        <span class="zoom-level" id="zoom-level">100%</span>
      </div>
      <div class="image-info">
        <span id="image-name">${filePath.split(/[\\/]/).pop()}</span>
      </div>
    </div>
    <div class="image-viewer-content" id="image-content">
      <div class="image-container" id="image-container">
        <img id="image-display" src="" alt="Image" />
      </div>
    </div>
  `;

        const zoomInBtn = imageViewer.querySelector('#zoom-in-btn');
        const zoomOutBtn = imageViewer.querySelector('#zoom-out-btn');
        const zoomResetBtn = imageViewer.querySelector('#zoom-reset-btn');
        const zoomLevel = imageViewer.querySelector('#zoom-level');
        const imageDisplay = imageViewer.querySelector('#image-display');
        const imageContent = imageViewer.querySelector('#image-content');

        let currentZoom = 1;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let scrollLeft = 0;
        let scrollTop = 0;

        const updateZoom = (newZoom) => {
            currentZoom = Math.max(0.1, Math.min(5, newZoom));
            imageDisplay.style.transform = `scale(${currentZoom})`;
            zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
        };

        zoomInBtn.addEventListener('click', () => updateZoom(currentZoom * 1.2));
        zoomOutBtn.addEventListener('click', () => updateZoom(currentZoom / 1.2));
        zoomResetBtn.addEventListener('click', () => {
            updateZoom(1);
            imageContent.scrollLeft = 0;
            imageContent.scrollTop = 0;
        });

        imageContent.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                updateZoom(currentZoom * delta);
            }
        });

        imageContent.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                isDragging = true;
                imageContent.classList.add('dragging');
                startX = e.pageX - imageContent.offsetLeft;
                startY = e.pageY - imageContent.offsetTop;
                scrollLeft = imageContent.scrollLeft;
                scrollTop = imageContent.scrollTop;
                e.preventDefault();
            }
        });

        imageContent.addEventListener('mouseleave', () => {
            isDragging = false;
            imageContent.classList.remove('dragging');
        });

        imageContent.addEventListener('mouseup', () => {
            isDragging = false;
            imageContent.classList.remove('dragging');
        });

        imageContent.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const x = e.pageX - imageContent.offsetLeft;
            const y = e.pageY - imageContent.offsetTop;
            const walkX = (x - startX) * 2;
            const walkY = (y - startY) * 2;
            imageContent.scrollLeft = scrollLeft - walkX;
            imageContent.scrollTop = scrollTop - walkY;
        });

        // Touch support for mobile drag and pan
        let touchStartX = 0;
        let touchStartY = 0;
        let touchScrollLeft = 0;
        let touchScrollTop = 0;

        imageContent.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                touchStartX = touch.pageX;
                touchStartY = touch.pageY;
                touchScrollLeft = imageContent.scrollLeft;
                touchScrollTop = imageContent.scrollTop;
            }
        });

        imageContent.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                const touch = e.touches[0];
                const walkX = touchStartX - touch.pageX;
                const walkY = touchStartY - touch.pageY;
                imageContent.scrollLeft = touchScrollLeft + walkX;
                imageContent.scrollTop = touchScrollTop + walkY;
            }
        });

        this.loadImageFile(filePath, imageDisplay);
        this.viewerInstances.set(filePath, imageViewer);

        return imageViewer;
    },

    async loadImageFile(filePath, imgElement) {
        try {
            const buffer = await window.electronAPI.readFileBuffer(filePath);
            const arrayBuffer = bufferToArrayBuffer(buffer);
            const blob = new Blob([arrayBuffer]);
            const url = URL.createObjectURL(blob);
            imgElement.src = url;
            imgElement.onload = () => {
                if (imgElement.dataset.previousUrl) {
                    URL.revokeObjectURL(imgElement.dataset.previousUrl);
                }
                imgElement.dataset.previousUrl = url;
            };
        } catch (error) {
            console.error('Error loading image:', error);
            imgElement.alt = 'Failed to load image';
        }
    },

    // -- PDF viewer -----------------------------------------------------------

    createPdfViewer(filePath /*, container */) {
        if (this.viewerInstances.has(filePath)) {
            const existingViewer = this.viewerInstances.get(filePath);
            this.restorePdfViewerState(filePath, existingViewer);
            return existingViewer;
        }

        const pdfViewer = document.createElement('div');
        pdfViewer.className = 'pdf-viewer';
        pdfViewer.innerHTML = `
    <div class="pdf-viewer-content">
      <iframe id="pdf-frame" src="" style="width: 100%; height: 100%; border: none;"></iframe>
    </div>
  `;

        const pdfFrame = pdfViewer.querySelector('#pdf-frame');

        pdfFrame.addEventListener('load', () => {
            this.setupPdfStateTracking(filePath, pdfFrame);
        });

        this.loadPdfFile(filePath, pdfFrame);
        this.viewerInstances.set(filePath, pdfViewer);

        return pdfViewer;
    },

    async loadPdfFile(filePath, iframeElement) {
        try {
            const buffer = await window.electronAPI.readFileBuffer(filePath);
            const arrayBuffer = bufferToArrayBuffer(buffer);
            const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            iframeElement.src = url;
            iframeElement.onload = () => {
                if (iframeElement.dataset.previousUrl) {
                    URL.revokeObjectURL(iframeElement.dataset.previousUrl);
                }
                iframeElement.dataset.previousUrl = url;
            };
        } catch (error) {
            console.error('Error loading PDF:', error);
            iframeElement.src = 'data:text/html,<html><body><h3>Failed to load PDF</h3></body></html>';
        }
    },

    // PDF state preservation across tab switches.
    //
    // setupPdfStateTracking is best-effort — same-origin policy blocks
    // contentWindow access for many configurations. We swallow the resulting
    // throws instead of crashing the tab.
    setupPdfStateTracking(filePath, iframe) {
        try {
            const saveState = () => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) {
                        const state = {
                            scrollTop: iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop,
                            scrollLeft: iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft,
                            zoom: iframe.contentWindow.PDFViewerApplication?.pdfViewer?.currentScale || 1,
                        };
                        this.pdfViewerStates.set(filePath, state);
                    }
                } catch (_) {
                    /* cross-origin, ignore */
                }
            };

            iframe.contentWindow.addEventListener('scroll', saveState);
            iframe.contentWindow.addEventListener('resize', saveState);
            setInterval(saveState, 2000);
        } catch (_) {
            console.log('PDF state tracking limited due to security restrictions');
        }
    },

    restorePdfViewerState(filePath, viewer) {
        const state = this.pdfViewerStates.get(filePath);
        if (!state) return;

        const iframe = viewer.querySelector('#pdf-frame');
        if (!iframe) return;

        iframe.addEventListener('load', () => {
            setTimeout(() => {
                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (iframeDoc) {
                        iframeDoc.documentElement.scrollTop = state.scrollTop;
                        iframeDoc.documentElement.scrollLeft = state.scrollLeft;

                        if (iframe.contentWindow.PDFViewerApplication) {
                            iframe.contentWindow.PDFViewerApplication.pdfViewer.currentScale = state.zoom;
                        }
                    }
                } catch (_) {
                    /* cross-origin, ignore */
                }
            }, 500);
        });
    },

    savePdfViewerState(filePath) {
        const viewer = this.viewerInstances.get(filePath);
        if (!viewer) return;

        const iframe = viewer.querySelector('#pdf-frame');
        if (!iframe) return;

        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (iframeDoc) {
                const state = {
                    scrollTop: iframeDoc.documentElement.scrollTop || iframeDoc.body.scrollTop,
                    scrollLeft: iframeDoc.documentElement.scrollLeft || iframeDoc.body.scrollLeft,
                    zoom: iframe.contentWindow.PDFViewerApplication?.pdfViewer?.currentScale || 1,
                };
                this.pdfViewerStates.set(filePath, state);
            }
        } catch (_) {
            /* cross-origin, ignore */
        }
    },
};
