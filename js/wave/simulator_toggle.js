/**
 * simulator_toggle.js — Toolbar button that flips the Wave simulator
 * (Icarus Verilog ↔ Verilator) for the next Wave run.
 *
 * The choice itself lives in simulator_preference.js (localStorage,
 * global). This module is only the UI: it paints the button with the
 * ACTIVE simulator's logo, sets a dynamic tooltip ("click to use the
 * other one"), and flips the preference on click. Nothing else needs to
 * be notified — compilation_module reads getSimulator() fresh on each
 * Wave run, and cocotb/Python testbenches are routed to iverilog there
 * regardless of this flag.
 *
 * The tooltip is BOTH state- and locale-dependent, so it's rendered
 * imperatively here (not via data-i18n-tooltip, which applyDOM would
 * overwrite on locale change) and re-rendered on aurora:locale-changed.
 */
import { getSimulator, setSimulator } from './simulator_preference.js';

const META = {
    iverilog:  { label: 'Icarus Verilog', icon: 'assets/icons/Icarus_Verilog_logo.png' },
    verilator: { label: 'Verilator',      icon: 'assets/icons/Verilator_logo.png' },
};

function render(btn, img) {
    const sim = getSimulator();
    const current = META[sim] || META.iverilog;
    const other = META[sim === 'verilator' ? 'iverilog' : 'verilator'];

    img.src = current.icon;
    img.alt = current.label;

    const tip = (typeof window.t === 'function')
        ? window.t('toolbar.simulatorToggle.tooltip', { active: current.label, other: other.label })
        : `Simulator: ${current.label} — click to use ${other.label}`;
    btn.setAttribute('data-tooltip', tip);
    btn.setAttribute('aria-label', tip);
    btn.dataset.simulator = sim;
}

function init() {
    const btn = document.getElementById('simulatorToggle');
    const img = btn?.querySelector('img');
    if (!btn || !img) return;

    render(btn, img);

    btn.addEventListener('click', () => {
        setSimulator(getSimulator() === 'verilator' ? 'iverilog' : 'verilator');
        render(btn, img);
    });

    // Tooltip text is localized — re-render when the user flips language.
    window.addEventListener('aurora:locale-changed', () => render(btn, img));
    // The preference can also change from outside (Aurora Intelligence via
    // AuroraAPI.setSimulator) — reflect it here too.
    window.addEventListener('aurora:wave-simulator-changed', () => render(btn, img));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
