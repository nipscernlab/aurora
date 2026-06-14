/**
 * design-lab.js — entry module for html/design-lab.html.
 *
 * Imports every shell component so the gallery in design-lab.html renders them
 * (each component self-registers on import). Add new components here as they are
 * built. The Design Lab (DESIGN §11) is dev tooling — it is NOT loaded into the
 * main shell (index.html), which keeps the component pattern honest. (Once a
 * component is wired into the live shell, index.html imports it directly too.)
 */
import './aurora-statusbar.js';
import './aurora-toast.js';
