// @vitest-environment happy-dom
//
// js/tabs/tab_viewers.js: os visualizadores que uma aba mostra em vez do
// editor: imagem (zoom e arraste), PDF (com a posicao guardada entre trocas
// de aba) e a onda no Surfer (com o veu de carregamento).
//
// Caracterizacao escrita antes de o modulo virar .ts, contra o .js antigo. O
// ouvinte do aviso "onda servida" e ligado na carga do modulo, entao a ponte
// falsa nasce antes do import. Os iframes do PDF sao objetos de mentira: o
// que interessa e o que o modulo le e escreve neles.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ponte = vi.hoisted(() => {
    const ponte = { ondaServida: null };
    globalThis.window.electronAPI = {
        onSurferTabWaveServed: (cb) => { ponte.ondaServida = cb; },
    };
    return ponte;
});

import { tabViewers } from '../../js/tabs/tab_viewers.js';

const api = window.electronAPI;

function abas() {
    return Object.assign(Object.create(tabViewers), {
        viewerInstances: new Map(),
        pdfViewerStates: new Map(),
        pdfStateIntervals: new Map(),
    });
}

beforeEach(() => {
    document.body.innerHTML = '';
    delete window.t;
    URL.createObjectURL = vi.fn(() => `blob:${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('imagem', () => {
    function montar() {
        api.readFileBuffer = vi.fn(async () => new Uint8Array([1, 2, 3]));
        const t = abas();
        const v = t.createImageViewer('C:\\p\\foto.png');
        document.body.appendChild(v);
        const img = v.querySelector('#image-display');
        const area = v.querySelector('#image-content');
        // 200x100 de imagem numa area de 100x100.
        Object.defineProperty(img, 'offsetWidth', { value: 200 });
        Object.defineProperty(img, 'offsetHeight', { value: 100 });
        Object.defineProperty(area, 'clientWidth', { value: 100 });
        Object.defineProperty(area, 'clientHeight', { value: 100 });
        return { t, v, img, area, nivel: v.querySelector('#zoom-level') };
    }
    const evento = (tipo, extra) => Object.assign(new Event(tipo, { cancelable: true }), extra);

    it('monta uma vez por arquivo, com o nome e a imagem carregada', async () => {
        const { t, v, img } = montar();
        expect(v.querySelector('#image-name').textContent).toBe('foto.png');
        expect(t.createImageViewer('C:\\p\\foto.png')).toBe(v);
        await tick();
        expect(img.src).toMatch(/^blob:/);
    });

    it('zoom pelos botoes, com teto e piso, e o reset volta ao centro', () => {
        const { v, img, nivel } = montar();
        v.querySelector('#zoom-in-btn').click();
        expect(nivel.textContent).toBe('120%');
        expect(img.style.transition).toBe('transform 180ms ease');
        for (let i = 0; i < 20; i++) v.querySelector('#zoom-in-btn').click();
        expect(nivel.textContent).toBe('500%');
        for (let i = 0; i < 40; i++) v.querySelector('#zoom-out-btn').click();
        expect(nivel.textContent).toBe('10%');
        v.querySelector('#zoom-reset-btn').click();
        expect(nivel.textContent).toBe('100%');
        expect(img.style.transform).toBe('translate(0px, 0px) scale(1)');
    });

    it('roda do mouse com Ctrl da zoom sem animacao; sem Ctrl, nada', () => {
        const { area, img, nivel } = montar();
        const semCtrl = evento('wheel', { ctrlKey: false, deltaY: 1 });
        area.dispatchEvent(semCtrl);
        expect(nivel.textContent).toBe('100%');
        area.dispatchEvent(evento('wheel', { ctrlKey: true, deltaY: 1 }));
        expect(nivel.textContent).toBe('90%');
        area.dispatchEvent(evento('wheel', { ctrlKey: true, deltaY: -1 }));
        expect(nivel.textContent).toBe('99%');
        expect(img.style.transition).toBe('none');
    });

    it('arrastar move a imagem ate a borda, e nao alem', () => {
        const { area, img } = montar();
        const desce = evento('mousedown', { button: 0, pageX: 0, pageY: 0 });
        area.dispatchEvent(desce);
        expect(desce.defaultPrevented).toBe(true);
        expect(area.classList.contains('dragging')).toBe(true);
        area.dispatchEvent(evento('mousemove', { pageX: 30, pageY: 30 }));
        // Sobra 100 px na largura: anda ate 50; na altura nao sobra nada.
        expect(img.style.transform).toBe('translate(30px, 0px) scale(1)');
        area.dispatchEvent(evento('mousemove', { pageX: 500, pageY: 0 }));
        expect(img.style.transform).toBe('translate(50px, 0px) scale(1)');
        area.dispatchEvent(evento('mouseup'));
        expect(area.classList.contains('dragging')).toBe(false);
        area.dispatchEvent(evento('mousemove', { pageX: -500, pageY: 0 }));
        expect(img.style.transform).toBe('translate(50px, 0px) scale(1)');

        // Outro botao nao comeca arraste; sair da area termina.
        area.dispatchEvent(evento('mousedown', { button: 2, pageX: 0, pageY: 0 }));
        expect(area.classList.contains('dragging')).toBe(false);
        area.dispatchEvent(evento('mousedown', { button: 0, pageX: 0, pageY: 0 }));
        area.dispatchEvent(evento('mouseleave'));
        expect(area.classList.contains('dragging')).toBe(false);
    });

    it('um dedo arrasta; dois dedos nao', () => {
        const { area, img } = montar();
        area.dispatchEvent(evento('touchstart', { touches: [{ pageX: 0, pageY: 0 }] }));
        const move = evento('touchmove', { touches: [{ pageX: -20, pageY: 5 }] });
        area.dispatchEvent(move);
        expect(move.defaultPrevented).toBe(true);
        expect(img.style.transform).toBe('translate(-20px, 0px) scale(1)');
        area.dispatchEvent(evento('touchstart', { touches: [{}, {}] }));
        area.dispatchEvent(evento('touchmove', { touches: [{}, {}] }));
        expect(img.style.transform).toBe('translate(-20px, 0px) scale(1)');
    });

    it('carregar: cada forma do buffer vira Blob; a url antiga e solta no onload; erro avisa', async () => {
        const t = abas();
        const img = document.createElement('img');
        const formas = [
            new ArrayBuffer(2),
            new Uint8Array([1, 2]),
            { buffer: new ArrayBuffer(4), byteOffset: 1, byteLength: 2 },
            [1, 2, 3],
        ];
        for (const forma of formas) {
            api.readFileBuffer = async () => forma;
            await t.loadImageFile('a.png', img);
            img.onload();
        }
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);

        api.readFileBuffer = async () => { throw new Error('x'); };
        await t.loadImageFile('a.png', img);
        expect(img.alt).toBe('Failed to load image');
    });
});

describe('PDF', () => {
    /** Um iframe de mentira com o documento e a janela que o modulo le. */
    function iframeFalso({ topo = 10, esquerda = 0, escala, semDoc = false } = {}) {
        const ouvintes = {};
        const doc = {
            documentElement: { scrollTop: topo, scrollLeft: esquerda },
            body: { scrollTop: 77, scrollLeft: 5 },
        };
        const janela = {
            document: doc,
            addEventListener: (ev, fn) => { ouvintes[ev] = fn; },
            ...(escala ? { PDFViewerApplication: { pdfViewer: { currentScale: escala } } } : {}),
        };
        return {
            ouvintes,
            doc,
            contentDocument: semDoc ? null : doc,
            contentWindow: janela,
            addEventListener: (ev, fn) => { ouvintes[`frame:${ev}`] = fn; },
        };
    }

    it('monta uma vez; carregado, liga o rastreio; reaberto, repoe a posicao', async () => {
        api.readFileBuffer = async () => new Uint8Array([1]);
        const t = abas();
        t.setupPdfStateTracking = vi.fn();
        const v = t.createPdfViewer('doc.pdf');
        const frame = v.querySelector('#pdf-frame');
        frame.dispatchEvent(new Event('load'));
        expect(t.setupPdfStateTracking).toHaveBeenCalledWith('doc.pdf', frame);
        t.restorePdfViewerState = vi.fn();
        expect(t.createPdfViewer('doc.pdf')).toBe(v);
        expect(t.restorePdfViewerState).toHaveBeenCalledWith('doc.pdf', v);
    });

    it('carregar o PDF: url nova no onload solta a velha; erro mostra a pagina de falha', async () => {
        const t = abas();
        const frame = { dataset: {} };
        api.readFileBuffer = async () => new Uint8Array([1]);
        await t.loadPdfFile('doc.pdf', frame);
        frame.onload();
        await t.loadPdfFile('doc.pdf', frame);
        frame.onload();
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        api.readFileBuffer = async () => { throw new Error('x'); };
        await t.loadPdfFile('doc.pdf', frame);
        expect(frame.src).toMatch(/Failed to load PDF/);
    });

    it('o rastreio guarda rolagem e zoom, a cada 2 s e a cada rolar; repetir troca o relogio', () => {
        vi.useFakeTimers();
        const t = abas();
        const f = iframeFalso({ topo: 0, esquerda: 3, escala: 1.5 });
        t.setupPdfStateTracking('doc.pdf', f);
        f.ouvintes.scroll();
        expect(t.pdfViewerStates.get('doc.pdf')).toEqual({ scrollTop: 77, scrollLeft: 3, zoom: 1.5 });
        const primeiro = t.pdfStateIntervals.get('doc.pdf');
        t.setupPdfStateTracking('doc.pdf', f);
        expect(t.pdfStateIntervals.get('doc.pdf')).not.toBe(primeiro);
        f.doc.documentElement.scrollTop = 40;
        vi.advanceTimersByTime(2000);
        expect(t.pdfViewerStates.get('doc.pdf').scrollTop).toBe(40);
        clearInterval(t.pdfStateIntervals.get('doc.pdf'));
    });

    it('rastreio sem acesso ao iframe: o ligar avisa, o guardar engole', () => {
        const t = abas();
        t.setupPdfStateTracking('doc.pdf', { contentWindow: null });
        expect(console.log).toHaveBeenCalledWith('PDF state tracking limited due to security restrictions');

        vi.useFakeTimers();
        const f = iframeFalso({ semDoc: true });
        f.contentWindow.document = null;
        t.setupPdfStateTracking('doc.pdf', f);
        f.ouvintes.resize();
        expect(t.pdfViewerStates.has('doc.pdf')).toBe(false);
        f.contentWindow.document = { get documentElement() { throw new Error('cross-origin'); } };
        f.ouvintes.resize();
        expect(t.pdfViewerStates.has('doc.pdf')).toBe(false);
        clearInterval(t.pdfStateIntervals.get('doc.pdf'));
    });

    it('repor a posicao depois do load, com o zoom quando o visor do PDF existe', () => {
        vi.useFakeTimers();
        const t = abas();
        t.pdfViewerStates.set('doc.pdf', { scrollTop: 30, scrollLeft: 4, zoom: 2 });
        const f = iframeFalso({ escala: 1 });
        t.restorePdfViewerState('doc.pdf', { querySelector: () => f });
        f.ouvintes['frame:load']();
        vi.advanceTimersByTime(500);
        expect(f.doc.documentElement).toEqual({ scrollTop: 30, scrollLeft: 4 });
        expect(f.contentWindow.PDFViewerApplication.pdfViewer.currentScale).toBe(2);

        const sem = iframeFalso({ semDoc: true });
        sem.contentWindow.document = null;
        t.restorePdfViewerState('doc.pdf', { querySelector: () => sem });
        sem.ouvintes['frame:load']();
        vi.advanceTimersByTime(500);

        const semVisor = iframeFalso();
        t.restorePdfViewerState('doc.pdf', { querySelector: () => semVisor });
        semVisor.ouvintes['frame:load']();
        vi.advanceTimersByTime(500);
        expect(semVisor.doc.documentElement.scrollTop).toBe(30);

        const fechado = { contentDocument: null, contentWindow: null, addEventListener: (_e, fn) => fn() };
        t.restorePdfViewerState('doc.pdf', { querySelector: () => fechado });
        vi.advanceTimersByTime(500);
    });

    it('repor sem estado guardado ou sem iframe: nada', () => {
        const t = abas();
        const viewer = { querySelector: vi.fn(() => null) };
        t.restorePdfViewerState('doc.pdf', viewer);
        expect(viewer.querySelector).not.toHaveBeenCalled();
        t.pdfViewerStates.set('doc.pdf', {});
        t.restorePdfViewerState('doc.pdf', viewer);
        expect(viewer.querySelector).toHaveBeenCalled();
    });

    it('guardar a posicao ao sair da aba', () => {
        const t = abas();
        t.savePdfViewerState('doc.pdf');
        t.viewerInstances.set('doc.pdf', { querySelector: () => null });
        t.savePdfViewerState('doc.pdf');
        expect(t.pdfViewerStates.size).toBe(0);

        const f = iframeFalso({ topo: 12, esquerda: 0 });
        t.viewerInstances.set('doc.pdf', { querySelector: () => f });
        t.savePdfViewerState('doc.pdf');
        expect(t.pdfViewerStates.get('doc.pdf')).toEqual({ scrollTop: 12, scrollLeft: 5, zoom: 1 });

        const semDoc = iframeFalso({ semDoc: true });
        semDoc.contentWindow.document = null;
        t.viewerInstances.set('x.pdf', { querySelector: () => semDoc });
        t.savePdfViewerState('x.pdf');
        const proibido = { contentDocument: null, contentWindow: null };
        t.viewerInstances.set('y.pdf', { querySelector: () => proibido });
        t.savePdfViewerState('y.pdf');
        expect(t.pdfViewerStates.size).toBe(1);
    });
});

describe('Surfer', () => {
    it('monta o iframe com o veu, que sai quando o main avisa que a onda foi servida', () => {
        const t = abas();
        window.t = (k) => `[${k}]`;
        const v = t.createSurferViewer('C:/p/onda.vcd', 'aurora-surfer://x');
        const frame = v.querySelector('iframe.surfer-frame');
        expect(frame.getAttribute('src')).toBe('aurora-surfer://x');
        expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
        expect(v.querySelector('.surfer-carregando p').textContent).toBe('[tabs.waveLoading]');
        expect(t.createSurferViewer('C:/p/onda.vcd', 'outra')).toBe(v);

        ponte.ondaServida({ tabId: 'wave:C:/p/outra.vcd' });
        ponte.ondaServida({ tabId: 7 });
        ponte.ondaServida({ tabId: 'outro:C:/p/onda.vcd' });
        expect(v.querySelector('.surfer-carregando')).not.toBeNull();
        ponte.ondaServida({ tabId: 'wave:C:/p/onda.vcd' });
        expect(v.querySelector('.surfer-carregando')).toBeNull();
    });

    it('recarregar poe o veu de volta e troca a url; o prazo tira o veu se o aviso nao vier', () => {
        vi.useFakeTimers();
        const t = abas();
        const v = t.createSurferViewer('w.vcd', 'u1');
        expect(v.querySelector('.surfer-carregando p').textContent).toBe('Loading the waveform…');
        t.refreshSurferViewer('w.vcd', 'u2');
        expect(v.querySelectorAll('.surfer-carregando')).toHaveLength(1);
        expect(v.querySelector('iframe').getAttribute('src')).toBe('u2');
        vi.advanceTimersByTime(90000);
        expect(v.querySelector('.surfer-carregando')).toBeNull();

        t.refreshSurferViewer('nada.vcd', 'u3');
        t.viewerInstances.set('sem.vcd', document.createElement('div'));
        t.refreshSurferViewer('sem.vcd', 'u3');
    });
});
