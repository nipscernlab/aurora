/**
 * simulator_toggle.js — Toolbar segmented switch choosing the Wave
 * simulator engine (Icarus Verilog vs Verilator).
 *
 * Both engines are shown side by side; the active one is highlighted and
 * the other dimmed. Clicking a segment selects that engine. The choice
 * itself lives in simulator_preference.js (localStorage, global) —
 * compilation_module reads getSimulator() fresh on each Wave run, and
 * cocotb/Python testbenches are routed to iverilog there regardless.
 *
 * Tooltips are static per segment (data-i18n-tooltip), so applyDOM handles
 * locale changes; this module only keeps the active highlight in sync.
 */
import { getSimulator, setSimulator } from './simulator_preference.js';

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
            setSimulator(seg.dataset.sim);
            render(segments);
        });
    }

    // The preference can also change from outside (Aurora Intelligence via
    // AuroraAPI.setSimulator) — reflect it here too.
    window.addEventListener('aurora:wave-simulator-changed', () => render(segments));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
