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
import './aurora-welcome.js';

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

// Welcome — fill its sized stage with a couple of sample recent projects so the
// Recent column isn't empty. (In the app, RecentProjectsManager drives this.)
const welcome = document.querySelector('aurora-welcome');
if (welcome) {
  welcome.projects = [
    { name: 'sqrt_newton', path: '~/projects/sqrt_newton/sqrt_newton.spf', displayPath: '~/projects/sqrt_newton' },
    { name: 'fir_filter', path: '~/work/dsp/fir_filter/fir_filter.spf', displayPath: '~/work/dsp/fir_filter' },
    { name: 'uart_top', path: '~/rtl/uart/uart_top.spf', displayPath: '~/rtl/uart' },
  ];
  welcome.addEventListener('project-open', (e) => console.log('[lab] open', e.detail));
  welcome.addEventListener('project-remove', (e) => {
    welcome.projects = welcome.projects.filter((p) => p.path !== e.detail);
  });
}
