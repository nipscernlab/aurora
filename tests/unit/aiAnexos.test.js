// @vitest-environment happy-dom
//
// Os anexos do composer do painel de IA (js/ui/ai_assistant_manager.js):
// imagem e arquivo de texto entram por arrastar, colar ou escolher, viram
// chips acima da caixa de texto, e a imagem enviada abre em tela cheia.
// Teste de caracterizacao, escrito antes de o grupo sair do painel.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../js/ui/dialog_manager.js', () => ({ showConfirm: vi.fn(async () => true) }));
vi.mock('../../js/ui/notification.js', () => ({ showCardNotification: vi.fn() }));
vi.mock('../../js/tabs/tab_manager.js', () => ({ TabManager: { addTab: vi.fn(), tabs: new Map() } }));
vi.mock('../../js/app/electron_api.js', () => ({
  electronAPI: { readFile: vi.fn(async () => ''), fileExists: vi.fn(async () => false) },
}));

import { aiAssistantManager } from '../../js/ui/ai_assistant_manager.js';

const AIAssistantManager = aiAssistantManager.constructor;
let painel;

beforeEach(() => {
  document.body.innerHTML = '<div class="main-container"></div>';
  window.aiAPI = {
    listProviders: vi.fn(async () => ({ providers: [] })),
    getKeyStatus: vi.fn(async () => ({ configured: {} })),
    onChatEvent: vi.fn(() => () => {}),
  };
  painel = new AIAssistantManager();
  painel.initialize();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

const chips = () => Array.from(painel.attachmentsEl.querySelectorAll('.ai-att-chip'));
const avisos = () => Array.from(painel.messagesEl.querySelectorAll('.ai-msg-content')).map((e) => e.textContent.trim());

describe('anexos no composer', () => {
  it('imagem vira chip com miniatura; texto vira chip com o tamanho; o x tira', async () => {
    const img = new File([new Uint8Array([137, 80, 78, 71])], 'foto.png', { type: 'image/png' });
    const txt = new File(['module top; endmodule'], 'top.v', { type: 'text/plain' });
    await painel._addFiles([img, txt]);
    expect(painel.pendingAttachments.map((a) => [a.kind, a.name, a.mime])).toEqual([
      ['image', 'foto.png', 'image/png'], ['file', 'top.v', 'text/plain']]);
    expect(painel.pendingAttachments[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(painel.pendingAttachments[1]).toMatchObject({ text: 'module top; endmodule', clipped: false, size: 21 });
    expect(painel.attachmentsEl.hidden).toBe(false);
    expect(chips()).toHaveLength(2);
    painel.attachmentsEl.querySelector('.ai-att-remove').click();
    expect(painel.pendingAttachments.map((a) => a.name)).toEqual(['top.v']);
    painel.attachmentsEl.querySelector('.ai-att-remove').click();
    expect(painel.attachmentsEl.hidden).toBe(true);
  });

  it('sem nome nem tipo, recebem os padroes', async () => {
    await painel._addFiles([new File(['x'], '', { type: '' })]);
    expect(painel.pendingAttachments[0]).toMatchObject({ kind: 'file', name: 'file.txt', mime: 'text/plain' });
    const semNome = new File([new Uint8Array([1])], '', { type: 'image/gif' });
    await painel._addFiles([semNome]);
    expect(painel.pendingAttachments[1]).toMatchObject({ kind: 'image', name: 'image.png', mime: 'image/gif' });
  });

  it('texto grande e cortado em 256 KB e marcado', async () => {
    const grande = new File(['a'.repeat(300 * 1024)], 'log.txt', { type: 'text/plain' });
    await painel._addFiles([grande]);
    expect(painel.pendingAttachments[0].text).toHaveLength(256 * 1024);
    expect(painel.pendingAttachments[0].clipped).toBe(true);
    expect(chips()[0].textContent).toContain('clipped');
  });

  it('imagem acima de 8 MB, arquivo que nao le e o decimo primeiro sao recusados com aviso', async () => {
    const gigante = { name: 'enorme.jpg', type: 'image/jpeg', size: 9 * 1024 * 1024 };
    const ilegivel = { name: 'quebrado.txt', type: 'text/plain', size: 3 };
    await painel._addFiles([gigante, ilegivel]);
    expect(painel.pendingAttachments).toHaveLength(0);
    // O markdown do painel nao trata _italico_, e o aviso sai com os sublinhados.
    expect(avisos()).toEqual(['_"enorme.jpg" is too large (images max 8 MB)._', '_Could not read "quebrado.txt"._']);
    const onze = Array.from({ length: 11 }, (_, i) => new File(['x'], `f${i}.txt`, { type: 'text/plain' }));
    await painel._addFiles(onze);
    expect(painel.pendingAttachments).toHaveLength(10);
    expect(avisos().at(-1)).toBe('_Up to 10 attachments per message._');
    await painel._addFiles(null);
    expect(painel.pendingAttachments).toHaveLength(10);
  });

  it('leitura que falha no meio tambem vira aviso', async () => {
    vi.stubGlobal('FileReader', class {
      readAsText() { this.error = new Error('disco'); this.onerror(); }
    });
    try {
      await painel._addFiles([new File(['x'], 'a.txt', { type: 'text/plain' })]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(painel.pendingAttachments).toHaveLength(0);
    expect(avisos().at(-1)).toBe('_Could not read "a.txt"._');
  });

  it('o nome do anexo sai escapado no chip', async () => {
    await painel._addFiles([new File(['x'], '<b>a</b>.txt', { type: 'text/plain' })]);
    expect(painel.attachmentsEl.innerHTML).toContain('&lt;b&gt;a&lt;/b&gt;.txt');
    expect(painel._escAtt(null)).toBe('');
    expect(painel._escAtt('a & b')).toBe('a &amp; b');
  });

  it('sem a faixa de anexos no DOM, desenhar nao faz nada', () => {
    painel.attachmentsEl = null;
    expect(() => painel._renderAttachments()).not.toThrow();
  });
});

describe('anexos na bolha enviada', () => {
  it('a bolha ganha a faixa dentro do conteudo, ou nela mesma sem conteudo', () => {
    const bolha = document.createElement('div');
    bolha.innerHTML = '<div class="ai-msg-content"></div>';
    painel._renderBubbleAttachments(bolha, [{ kind: 'image', name: 'a.png', dataUrl: 'data:image/png;base64,AA' }]);
    expect(bolha.querySelector('.ai-msg-content > .ai-msg-attachments img')).not.toBeNull();
    const nua = document.createElement('div');
    painel._renderBubbleAttachments(nua, [{ kind: 'file', name: 'b.txt', size: 10 }]);
    expect(nua.querySelector(':scope > .ai-msg-attachments').textContent).toContain('b.txt');
  });

  it('sem bolha ou sem anexos, nada', () => {
    const bolha = document.createElement('div');
    painel._renderBubbleAttachments(bolha, []);
    painel._renderBubbleAttachments(bolha, null);
    painel._renderBubbleAttachments(null, [{ kind: 'file', name: 'x' }]);
    expect(bolha.children).toHaveLength(0);
  });
});

describe('imagem em tela cheia', () => {
  const abrir = () => {
    painel._openImageLightbox('data:image/png;base64,AA', 'foto "1"');
    return document.querySelector('.ai-lightbox');
  };

  it('abre por cima e aparece no proximo quadro', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] });
    const ov = abrir();
    expect(ov.getAttribute('role')).toBe('dialog');
    // O escape de hoje nao cobre aspas: o alt com aspas termina nelas.
    expect(ov.querySelector('img').getAttribute('alt')).toBe('foto ');
    vi.advanceTimersToNextFrame();
    expect(ov.classList.contains('open')).toBe(true);
  });

  it('Escape fecha; outra tecla nao', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] });
    const ov = abrir();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(ov.isConnected).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    vi.advanceTimersByTime(160);
    expect(ov.isConnected).toBe(false);
  });

  it('clicar na imagem nao fecha; no fundo ou no x, fecha', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'setTimeout'] });
    let ov = abrir();
    ov.querySelector('img').click();
    vi.advanceTimersByTime(200);
    expect(ov.isConnected).toBe(true);
    ov.click();
    vi.advanceTimersByTime(160);
    expect(ov.isConnected).toBe(false);
    ov = abrir();
    ov.querySelector('.ai-lightbox-close i').click();
    vi.advanceTimersByTime(160);
    expect(ov.isConnected).toBe(false);
  });

  it('sem imagem, nao abre; o clique numa miniatura enviada abre', () => {
    painel._openImageLightbox('', 'x');
    expect(document.querySelector('.ai-lightbox')).toBeNull();
    const bolha = painel.appendBubble('user', 'olha');
    painel._renderBubbleAttachments(bolha, [{ kind: 'image', name: 'a.png', dataUrl: 'data:image/png;base64,AA' }]);
    bolha.querySelector('img.ai-att-thumb').click();
    expect(document.querySelector('.ai-lightbox')).not.toBeNull();
  });
});
