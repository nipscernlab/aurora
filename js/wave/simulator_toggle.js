/**
 * simulator_toggle.js: Toolbar segmented switch choosing the Wave
 * simulator engine (Icarus Verilog vs Verilator).
 *
 * Both engines are shown side by side; the active one is highlighted and
 * the other dimmed. Clicking a segment selects that engine. The choice
 * itself lives in simulator_preference.js (localStorage, global):
 * compilation_module reads getSimulator() fresh on each Wave run, and
 * cocotb/Python testbenches are routed to iverilog there regardless.
 *
 * Tooltips are static per segment (data-i18n-tooltip), so applyDOM handles
 * locale changes; this module only keeps the active highlight in sync.
 */
import { getSimulator, setSimulator } from './simulator_preference.js';
import { showCardNotification } from '../ui/notification.js';

const tr = (k, p) => (window.t ? window.t(k, p) : k);

// Last engine we announced. Guards the feedback toast against no-op events
// (clicking the already-active segment, or a redundant broadcast) so we only
// surface a message on a REAL change. Seeded to the persisted choice so the
// first render on boot never fires a spurious toast.
let lastAnnounced = getSimulator();

/** Toast announcing the engine change, fired for both toolbar and AI changes. */
function announceSimulatorChange(sim) {
    if (sim === lastAnnounced) return;
    lastAnnounced = sim;
    const key = sim === 'verilator' ? 'notification.simulator.verilator'
                                     : 'notification.simulator.iverilog';
    showCardNotification(tr(key), 'info', 4000, tr('notification.simulator.title'));
}

function render(segments) {
    const sim = getSimulator();
    for (const seg of segments) {
        const active = seg.dataset.sim === sim;
        seg.classList.toggle('active', active);
        seg.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
}

function init() {
    const sw = document.getElementById('simulatorSwitch');
    const segments = sw ? Array.from(sw.querySelectorAll('.sim-seg')) : [];
    if (segments.length === 0) return;

    render(segments);

    for (const seg of segments) {
        seg.addEventListener('click', () => {
            const applied = setSimulator(seg.dataset.sim);
            render(segments); // immediate feedback
            // Broadcast so other surfaces (status bar, etc.) follow. The
            // listener below re-renders us too, idempotent.
            window.dispatchEvent(new CustomEvent('aurora:wave-simulator-changed', { detail: { simulator: applied } }));
        });
    }

    // The preference can also change from outside (Aurora Intelligence via
    // AuroraAPI.setSimulator), reflect it here too. Both that path and the
    // segment click above dispatch this same event, so announcing here is the
    // single point that covers every change source (the no-op guard inside
    // announceSimulatorChange keeps it to one toast per real switch).
    window.addEventListener('aurora:wave-simulator-changed', (e) => {
        render(segments);
        announceSimulatorChange(e?.detail?.simulator || getSimulator());
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
