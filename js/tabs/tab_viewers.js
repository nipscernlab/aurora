import { electronAPI } from '../app/electron_api.js';
/**
 * Image / PDF viewers for the tab system.
 *
 * These methods used to be static members of TabManager. They're factored
 * out here as a plain object that gets `Object.assign(TabManager, viewers)`
 * back into the class, `this` inside each method still resolves to
 * TabManager when called as `TabManager.foo()`, so no signatures or
 * call-site behaviour change.
 *
 * Why a mixin instead of a separate class:
 *   - The viewer cache (`viewerInstances`, `pdfViewerStates`) lives on
 *     TabManager and is read by other parts of the class (close paths,
 *     activation paths). Keeping `this`-binding compatible avoids having
 *     to thread a context object through every callsite.
 */

/* ── O veu de carregamento da onda numa aba ────────────────────────────────
 *
 * O `tabId` que o main usa para uma onda e `wave:<caminho do arquivo>`, e o
 * viewer e guardado pelo caminho: e por essa igualdade que o aviso do main
 * encontra a aba certa. O ouvinte e UM so, no modulo, e nao um por aba: o
 * `ipcRenderer.on` do preload nao devolve como cancelar, e um por aba se
 * acumularia a cada onda aberta.
 *
 * O prazo de socorro existe porque o veu cobre a aba: se o aviso nunca vier
 * (servidor que morreu, cliente que buscou a onda por outro caminho), a
 * pessoa nao pode ficar sem enxergar o Surfer por causa do indicador.
 */
const veusDaOnda = new Map();
const PRAZO_DO_VEU = 90000;

function tirarVeuDaOnda(filePath) {
    const veu = veusDaOnda.get(filePath);
    if (!veu) return;
    veusDaOnda.delete(filePath);
    clearTimeout(veu.prazo);
    veu.el.remove();
}

function montarVeuDaOnda(viewer, filePath) {
    tirarVeuDaOnda(filePath);
    const el = document.createElement('div');
    el.className = 'surfer-carregando';
    el.innerHTML = '<div class="surfer-carregando-giro animate-spin" aria-hidden="true"></div>'
        + `<p>${window.t ? window.t('tabs.waveLoading') : 'Loading the waveform…'}</p>`;
    viewer.appendChild(el);
    veusDaOnda.set(filePath, { el, prazo: setTimeout(() => tirarVeuDaOnda(filePath), PRAZO_DO_VEU) });
}

if (typeof window !== 'undefined' && electronAPI.onSurferTabWaveServed) {
    electronAPI.onSurferTabWaveServed(({ tabId }) => {
        if (typeof tabId === 'string' && tabId.startsWith('wave:')) tirarVeuDaOnda(tabId.slice(5));
    });
}

// Decode whatever shape electronAPI.readFileBuffer returns into a
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
          <i class="ph ph-magnifying-glass-plus"></i>
        </button>
        <button class="image-control-btn" id="zoom-out-btn" title="Zoom Out">
          <i class="ph ph-magnifying-glass-minus"></i>
        </button>
        <button class="image-control-btn" id="zoom-reset-btn" title="Reset Zoom">
          <i class="ph ph-arrows-out"></i>
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

        // Pan is applied via the transform itself (translate + scale), NOT via
        // container scroll. `transform: scale()` doesn't grow the scroll box, so
        // a scroll-based pan can never reach the edges of a zoomed image, and
        // the flex-centering on the scroll container hides the top/left overflow
        // on top of that. Translating the image directly sidesteps both.
        let currentZoom = 1;
        let panX = 0;
        let panY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let startPanX = 0;
        let startPanY = 0;

        // The image sits centered at rest, so it can travel at most half its
        // overflow in each axis before an edge meets the viewport. Clamp to that
        // so every edge is reachable but the image can't be flung into the void.
        const clampPan = () => {
            const overflowX = imageDisplay.offsetWidth * currentZoom - imageContent.clientWidth;
            const overflowY = imageDisplay.offsetHeight * currentZoom - imageContent.clientHeight;
            const maxX = Math.max(0, overflowX / 2);
            const maxY = Math.max(0, overflowY / 2);
            panX = Math.max(-maxX, Math.min(maxX, panX));
            panY = Math.max(-maxY, Math.min(maxY, panY));
        };

        // `animate` is for the discrete zoom buttons; drag/wheel pass false so
        // the image tracks the cursor immediately (a transition would smear it).
        const applyTransform = (animate) => {
            clampPan();
            imageDisplay.style.transition = animate ? 'transform 180ms ease' : 'none';
            imageDisplay.style.transform = `translate(${panX}px, ${panY}px) scale(${currentZoom})`;
            zoomLevel.textContent = `${Math.round(currentZoom * 100)}%`;
        };

        const updateZoom = (newZoom, animate = true) => {
            currentZoom = Math.max(0.1, Math.min(5, newZoom));
            applyTransform(animate);
        };

        zoomInBtn.addEventListener('click', () => updateZoom(currentZoom * 1.2));
        zoomOutBtn.addEventListener('click', () => updateZoom(currentZoom / 1.2));
        zoomResetBtn.addEventListener('click', () => {
            currentZoom = 1;
            panX = 0;
            panY = 0;
            applyTransform(true);
        });

        imageContent.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? 0.9 : 1.1;
                updateZoom(currentZoom * delta, false);
            }
        });

        imageContent.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                isDragging = true;
                imageContent.classList.add('dragging');
                startX = e.pageX;
                startY = e.pageY;
                startPanX = panX;
                startPanY = panY;
                e.preventDefault();
            }
        });

        const endDrag = () => {
            isDragging = false;
            imageContent.classList.remove('dragging');
        };
        imageContent.addEventListener('mouseleave', endDrag);
        imageContent.addEventListener('mouseup', endDrag);

        imageContent.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            panX = startPanX + (e.pageX - startX);
            panY = startPanY + (e.pageY - startY);
            applyTransform(false);
        });

        // Touch: one-finger drag to pan (same translate model as the mouse).
        imageContent.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                const touch = e.touches[0];
                startX = touch.pageX;
                startY = touch.pageY;
                startPanX = panX;
                startPanY = panY;
            }
        });

        imageContent.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                const touch = e.touches[0];
                panX = startPanX + (touch.pageX - startX);
                panY = startPanY + (touch.pageY - startY);
                applyTransform(false);
            }
        });

        this.loadImageFile(filePath, imageDisplay);
        this.viewerInstances.set(filePath, imageViewer);

        return imageViewer;
    },

    async loadImageFile(filePath, imgElement) {
        try {
            const buffer = await electronAPI.readFileBuffer(filePath);
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
            const buffer = await electronAPI.readFileBuffer(filePath);
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
    // setupPdfStateTracking is best-effort, same-origin policy blocks
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
            // Clear any prior poll for this file (the iframe 'load' handler can
            // fire more than once) and track the new one so closeTab can stop
            // it, an untracked setInterval here leaked one 2s timer per PDF
            // open, forever, holding the detached iframe alive.
            clearInterval(this.pdfStateIntervals.get(filePath));
            this.pdfStateIntervals.set(filePath, setInterval(saveState, 2000));
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

    // -- Surfer viewer --------------------------------------------------------
    //
    // A onda numa aba: um iframe com o cliente WASM do Surfer, apontado para a
    // URL aurora-surfer:// que o main montou (bundle web + load_url do servidor
    // local daquela onda). Nao ha estado a salvar aqui: o proprio Surfer guarda
    // sua visao enquanto o iframe viver, e o iframe vive enquanto a aba viver.
    //
    // O veu de carregamento existe porque o caminho tem uma espera longa e
    // muda: o WASM sobe, busca a onda e so entao desenha. Ate aqui a aba
    // mostrava a tela de boas-vindas do Surfer ("Space: show command prompt")
    // por todo esse tempo, e quem olhava concluia que nao tinha funcionado. O
    // veu sai quando o main avisa que os bytes da onda foram servidos, que e o
    // unico sinal honesto que se tem de fora do WASM.
    createSurferViewer(filePath, pageUrl) {
        if (this.viewerInstances.has(filePath)) {
            return this.viewerInstances.get(filePath);
        }

        const viewer = document.createElement('div');
        viewer.className = 'surfer-viewer';
        montarVeuDaOnda(viewer, filePath);
        const iframe = document.createElement('iframe');
        iframe.className = 'surfer-frame';
        // aria-label e nao title: title vira tooltip nativo, e um "Surfer"
        // pipocando a cada passada de mouse sobre a onda e ruido. O aria-label
        // preserva o nome acessivel sem o balao.
        iframe.setAttribute('aria-label', 'Surfer');
        // Sem allow-same-origin nao ha fetch da propria origem (o .wasm e o
        // load_url); o esquema aurora-surfer:// e outra origem, entao isso nao
        // devolve ao conteudo o alcance do DOM do app.
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        iframe.src = pageUrl;
        viewer.appendChild(iframe);

        this.viewerInstances.set(filePath, viewer);
        return viewer;
    },

    // Recompilou a mesma onda: o servidor e outro (porta/token novos), entao o
    // iframe recarrega na URL nova. A aba e o viewer continuam os mesmos.
    refreshSurferViewer(filePath, pageUrl) {
        const viewer = this.viewerInstances.get(filePath);
        const iframe = viewer && viewer.querySelector('iframe.surfer-frame');
        if (!iframe) return;
        // A onda vai ser lida de novo, entao o veu volta com ela.
        montarVeuDaOnda(viewer, filePath);
        iframe.src = pageUrl;
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
