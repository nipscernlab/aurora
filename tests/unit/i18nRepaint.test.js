// @vitest-environment happy-dom
/**
 * A corrida que punha chave crua na tela.
 *
 * O cartao do Manual, nas Configuracoes, mostrava literalmente
 * "modal.settings.manualInstalled". A traducao existia; o que faltava era
 * ordem: o `docsStatus()` responde antes de o catalogo do idioma carregar, o
 * `t()` devolve a PROPRIA CHAVE quando nao ha traducao ainda, e o codigo
 * antigo ainda TIRAVA o `data-i18n` do elemento, o que impedia o aplicador de
 * alcanca-lo quando o catalogo finalmente chegava. A chave ficava ali para
 * sempre.
 *
 * O conserto (js/processors/aurora_settings.js) mantem o `data-i18n` com a
 * chave que vale agora e repinta no evento `aurora:locale-changed`, que o
 * i18n dispara tambem quando o catalogo termina de carregar. Estes testes
 * exercitam o mecanismo em que ele se apoia, que e o que pode se perder numa
 * mudanca futura do i18n.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

// Importado com `window` definido, o i18n tenta buscar `./locales/pt.json` e
// grita no console quando nao ha servidor. O catalogo deste teste e posto a
// mao logo abaixo, entao a busca so faria barulho; hoisted para valer ANTES
// do import do modulo.
vi.hoisted(() => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
});

import {
    t,
    applyDOM,
    _setTranslations,
    _setLocaleSync,
} from '../../js/i18n/i18n.js';

const CHAVE = 'modal.settings.manualInstalled';

beforeEach(() => {
    // Comeca sem catalogo nenhum, que e o estado da primeira pintura.
    _setTranslations('en', {});
    _setTranslations('pt', {});
    _setLocaleSync('pt');
    document.body.innerHTML = '<h4 id="manual-estado-titulo"></h4>';
});

const chegaOCatalogo = () => _setTranslations('pt', {
    modal: { settings: { manualInstalled: 'Neste computador' } },
});

describe('um rotulo pintado antes do catalogo', () => {
    it('sai com a chave crua, que e o sintoma', () => {
        expect(t(CHAVE)).toBe(CHAVE);
    });

    it('se conserta quando o catalogo chega, porque o data-i18n ficou', () => {
        const el = document.getElementById('manual-estado-titulo');
        el.setAttribute('data-i18n', CHAVE);
        el.textContent = t(CHAVE);
        expect(el.textContent).toBe(CHAVE);

        chegaOCatalogo();
        applyDOM();
        expect(el.textContent).toBe('Neste computador');
    });

    it('sem o data-i18n a chave crua fica para sempre, que era o defeito', () => {
        const el = document.getElementById('manual-estado-titulo');
        el.textContent = t(CHAVE);
        chegaOCatalogo();
        applyDOM();
        expect(el.textContent).toBe(CHAVE);
    });

    it('trocar de idioma repinta de novo, sem passar pelo codigo do cartao', () => {
        const el = document.getElementById('manual-estado-titulo');
        el.setAttribute('data-i18n', CHAVE);
        chegaOCatalogo();
        applyDOM();
        expect(el.textContent).toBe('Neste computador');

        _setTranslations('en', { modal: { settings: { manualInstalled: 'On this computer' } } });
        _setLocaleSync('en');
        applyDOM();
        expect(el.textContent).toBe('On this computer');
    });
});
