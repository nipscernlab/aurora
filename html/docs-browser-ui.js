// Era o <script> inline da propria pagina; saiu do HTML para a CSP do
// aplicativo poder viver sem 'unsafe-inline' em script-src. Conteudo
// movido verbatim; o comportamento e o mesmo.

const api = window.docsWindowAPI;
const $ = (id) => document.getElementById(id);

const wire = (id, fn) => $(id).addEventListener('click', () => fn?.());
wire('back',    () => api?.back());
wire('forward', () => api?.forward());
wire('reload',  () => api?.reload());
wire('home',    () => api?.home());
wire('min',     () => api?.minimize());
wire('max',     () => api?.maximize());
wire('close',   () => api?.close());

// Voltar e avançar refletem o histórico do view do manual, que vive no
// main; sem isto os botões ficariam sempre acesos e mentiriam.
api?.onState(({ canGoBack, canGoForward, title }) => {
  $('back').disabled = !canGoBack;
  $('forward').disabled = !canGoForward;
  if (title) $('title').textContent = title;
});
api?.sync();
