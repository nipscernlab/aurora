/**
 * viewer_toggle.js: Toolbar segmented switch choosing the waveform viewer
 * (GTKWave external window vs embedded Surfer). Mirrors simulator_toggle.js.
 *
 * Both viewers are shown side by side; the active one is highlighted. The
 * choice lives in viewer_preference.js (localStorage, global):
 * compilation_module reads getViewer() fresh on each Wave run. The same
 * preference is settable by Aurora Intelligence (AuroraAPI.wave.setViewer),
 * which dispatches the same event so this stays in sync.
 */
import { getViewer, setViewer } from './viewer_preference.js';
import { showCardNotification } from '../ui/notification.js';

let lastAnnounced = getViewer();

/** Toast announcing the viewer change, fired for both toolbar and AI changes. */
function announceViewerChange(viewer) {
    if (viewer === lastAnnounced) return;
    lastAnnounced = viewer;
    const msg = viewer === 'surfer'
        ? 'Waveform viewer: Surfer (embedded)'
        : 'Waveform viewer: GTKWave (external window)';
    showCardNotification(msg, 'info', 4000, 'Waveform viewer');
}

function render(segments) {
    const viewer = getViewer();
    for (const seg of segments) {
        const active = seg.dataset.viewer === viewer;
        seg.classList.toggle('active', active);
        seg.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
}

function init() {
    const sw = document.getElementById('viewerSwitch');
    const segments = sw ? Array.from(sw.querySelectorAll('.viewer-seg')) : [];
    if (segments.length === 0) return;

    render(segments);

    for (const seg of segments) {
        seg.addEventListener('click', () => {
            const applied = setViewer(seg.dataset.viewer);
            render(segments); // immediate feedback
            window.dispatchEvent(new CustomEvent('aurora:wave-viewer-changed', { detail: { viewer: applied } }));
        });
    }

    // The preference can also change from Aurora Intelligence (setViewer);
    // both paths dispatch this event, so announce + re-render here once.
    window.addEventListener('aurora:wave-viewer-changed', (e) => {
        render(segments);
        announceViewerChange(e?.detail?.viewer || getViewer());
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
