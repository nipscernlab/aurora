/**
 * design-lab.js — entry module for html/design-lab.html.
 *
 * Imports every shell component so the gallery in design-lab.html renders them
 * (each component self-registers on import). Add new components here as they are
 * built. The Design Lab (DESIGN §11) is dev tooling — it is NOT loaded into the
 * main shell (index.html), which keeps the component pattern honest and keeps
 * Lit out of the main page's raw-fallback path until the live migration (Fase C).
 */
import './aurora-statusbar.js';
