// Era o <script> inline da propria pagina; saiu do HTML para a CSP do
// aplicativo poder viver sem 'unsafe-inline' em script-src. Conteudo
// movido verbatim; o comportamento e o mesmo.

import { sky } from '../js/ui/sky.js';
const ceu = document.getElementById('stars');
if (ceu) sky(ceu);
