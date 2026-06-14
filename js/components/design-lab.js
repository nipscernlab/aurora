/**
 * design-lab.js — entry module for html/design-lab.html.
 *
 * Imports every shell component so the gallery in design-lab.html renders them
 * (each component self-registers on import), and wires the few interactive
 * specimens. Add new components here as they are built. The Design Lab
 * (DESIGN §11) is dev tooling — NOT loaded into the main shell (index.html).
 */
import './aurora-statusbar.js';
import './aurora-toast.js';
import './aurora-tooltip.js';
import './aurora-command-palette.js';

// The command palette is a full-screen overlay — show it on a button press
// (the live app opens it with Ctrl+Shift+K via command_palette.js, which isn't
// loaded here). Wire a sample item list + the lab's open button.
const cmdk = document.querySelector('aurora-command-palette');
if (cmdk) {
  cmdk.items = [
    { group: 'Compile', title: 'Compile C±', icon: 'ph ph-play-circle' },
    { group: 'Compile', title: 'Synthesize Verilog', icon: 'ph ph-cpu' },
    { group: 'Project', title: 'New Project…', icon: 'ph ph-folder-simple-plus' },
    { group: 'Tools', title: 'Aurora settings', icon: 'ph ph-gear' },
  ];
  cmdk.selected = 0;
  cmdk.addEventListener('cmdk-close', () => { cmdk.open = false; });
  cmdk.addEventListener('cmdk-run', () => { cmdk.open = false; });
  cmdk.addEventListener('cmdk-hover', (e) => { cmdk.selected = e.detail; });
  document.getElementById('lab-open-cmdk')?.addEventListener('click', () => { cmdk.open = true; });
}
