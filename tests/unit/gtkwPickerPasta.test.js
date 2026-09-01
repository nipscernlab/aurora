// @vitest-environment happy-dom
//
// O dropdown de layout de ondas depois que ele passou a mostrar as duas listas
// juntas (js/wave/gtkw_picker.js).
//
// Antes o menu so listava os arquivos do visualizador ligado, e cada arquivo
// entrava por um dialog, um de cada vez. Duas coisas mudaram, e as duas tem
// como errar em silencio.
//
// A primeira e a pasta: apontar uma e registrar tudo que houver dentro. O que
// precisa de prova e o que entra e o que fica de fora (um .vcd nao e layout) e
// que cada arquivo cai na lista do programa certo, porque cair na lista errada
// so aparece na hora de abrir a simulacao.
//
// A segunda e a convivencia das listas. Com .gtkw e .surf.ron no mesmo menu, o
// icone e a unica coisa que diz de quem e cada linha, e clicar num arquivo do
// outro programa tem que trocar o visualizador junto: escolher o arquivo e
// escolher o programa, senao a pessoa escolhe um layout e ve outro.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectStore } from '../../js/project/project_store.js';
import { GtkwPickerManager, kindOf, LAYOUT_KINDS } from '../../js/wave/gtkw_picker.js';
import { getViewer, setViewer } from '../../js/wave/viewer_preference.js';
import { WaveStore } from '../../js/wave/wave_state_store.js';

const TOOLBAR_HTML = `
    <div id="gtkwPicker">
        <button id="gtkwPickerButton"><span class="gtkw-picker-label"></span></button>
    </div>
    <div id="gtkwPickerMenu"></div>
`;

/** Uma arvore de pastas falsa, no formato que o getFolderFiles devolve. */
function fakeTree(tree) {
    return (dir) => {
        const entries = tree[dir];
        if (!entries) throw new Error(`sem permissao: ${dir}`);
        return Promise.resolve(entries);
    };
}

beforeEach(() => {
    document.body.innerHTML = TOOLBAR_HTML;
    setViewer('gtkwave');
});

afterEach(() => {
    document.body.innerHTML = '';
    delete window.electronAPI;
    vi.restoreAllMocks();
});

describe('que arquivo conta como layout de onda', () => {
    it('da um icone diferente para cada extensao', () => {
        const icons = LAYOUT_KINDS.map((k) => k.icon);
        expect(new Set(icons).size).toBe(icons.length);
    });

    it('manda cada extensao para a lista do seu programa', () => {
        expect(kindOf('ondas.gtkw').field).toBe('gtkwFiles');
        expect(kindOf('ondas.surf.ron').field).toBe('surferFiles');
        expect(kindOf('ondas.sucl').field).toBe('surferFiles');
    });

    it('nao confunde .surf.ron com .sucl, que sao layouts diferentes do mesmo programa', () => {
        expect(kindOf('ondas.surf.ron').icon).not.toBe(kindOf('ondas.sucl').icon);
    });

    it('recusa o que nao e layout', () => {
        // O .vcd e a onda em si, nao o layout dela: registrar um como layout
        // faria o visualizador abrir com uma configuracao que nao existe.
        for (const nome of ['somador.v', 'saida.vcd', 'saida.fst', 'notas.txt', 'gtkw']) {
            expect(kindOf(nome)).toBeNull();
        }
    });
});

describe('varrer a pasta escolhida', () => {
    it('acha layout em subpasta e ignora o resto', async () => {
        window.electronAPI = {
            getFolderFiles: fakeTree({
                'C:/lay': [
                    { name: 'a.gtkw',  isDirectory: false, path: 'C:/lay/a.gtkw' },
                    { name: 'saida.vcd', isDirectory: false, path: 'C:/lay/saida.vcd' },
                    { name: 'surfer', isDirectory: true,  path: 'C:/lay/surfer' },
                ],
                'C:/lay/surfer': [
                    { name: 'b.surf.ron', isDirectory: false, path: 'C:/lay/surfer/b.surf.ron' },
                    { name: 'c.sucl',     isDirectory: false, path: 'C:/lay/surfer/c.sucl' },
                ],
            }),
        };

        const achados = await new GtkwPickerManager()._scanFolder('C:/lay');

        expect(achados.map((f) => f.name).sort()).toEqual(['a.gtkw', 'b.surf.ron', 'c.sucl']);
        expect(achados.find((f) => f.name === 'a.gtkw').field).toBe('gtkwFiles');
        expect(achados.find((f) => f.name === 'b.surf.ron').field).toBe('surferFiles');
    });

    it('nao desce em pasta oculta nem em node_modules', async () => {
        window.electronAPI = {
            getFolderFiles: fakeTree({
                'C:/lay': [
                    { name: '.git',         isDirectory: true, path: 'C:/lay/.git' },
                    { name: 'node_modules', isDirectory: true, path: 'C:/lay/node_modules' },
                    { name: 'ok.gtkw',      isDirectory: false, path: 'C:/lay/ok.gtkw' },
                ],
                // Estas existem, mas nao podem ser visitadas.
                'C:/lay/.git': [{ name: 'x.gtkw', isDirectory: false, path: 'C:/lay/.git/x.gtkw' }],
                'C:/lay/node_modules': [{ name: 'y.gtkw', isDirectory: false, path: 'C:/lay/node_modules/y.gtkw' }],
            }),
        };

        const achados = await new GtkwPickerManager()._scanFolder('C:/lay');
        expect(achados.map((f) => f.name)).toEqual(['ok.gtkw']);
    });

    it('segue adiante quando uma subpasta nao pode ser lida', async () => {
        window.electronAPI = {
            getFolderFiles: fakeTree({
                'C:/lay': [
                    { name: 'trancada', isDirectory: true, path: 'C:/lay/trancada' },
                    { name: 'ok.gtkw',  isDirectory: false, path: 'C:/lay/ok.gtkw' },
                ],
                // 'C:/lay/trancada' de proposito fora do mapa: o fake lanca.
            }),
        };

        const achados = await new GtkwPickerManager()._scanFolder('C:/lay');
        expect(achados.map((f) => f.name)).toEqual(['ok.gtkw']);
    });
});

describe('as duas listas no mesmo menu', () => {
    /** Um estado do WaveStore com um layout de cada programa. */
    const ESTADO = {
        gtkwFiles:   [{ name: 'a.gtkw', path: 'C:/p/a.gtkw', isActive: true }],
        surferFiles: [{ name: 'b.surf.ron', path: 'C:/p/b.surf.ron', isActive: true }],
    };

    it('mostra o grupo do visualizador ligado primeiro', () => {
        const inst = new GtkwPickerManager();

        inst._isSurfer = false;
        expect(inst._collect(ESTADO).map((f) => f.name)).toEqual(['a.gtkw', 'b.surf.ron']);

        inst._isSurfer = true;
        expect(inst._collect(ESTADO).map((f) => f.name)).toEqual(['b.surf.ron', 'a.gtkw']);
    });

    it('cada linha carrega o icone da sua extensao', () => {
        const linhas = new GtkwPickerManager()._collect(ESTADO);
        expect(linhas[0].icon).not.toBe(linhas[1].icon);
    });

    it('so o ativo do visualizador ligado aparece marcado no menu', () => {
        const inst = new GtkwPickerManager();
        inst.menu = document.getElementById('gtkwPickerMenu');
        // Os dois arquivos estao com isActive nas suas listas; o menu so pode
        // marcar um, o do programa que vai abrir.
        inst._isSurfer = false;
        inst._files = inst._collect(ESTADO);
        inst._activePath = 'C:/p/a.gtkw';
        inst._renderMenu();

        const marcadas = [...document.querySelectorAll('.gtkw-picker-row.active .gtkw-picker-row-label')]
            .map((el) => el.textContent);
        expect(marcadas).toEqual(['a.gtkw']);
    });

    it('escolher um layout do outro programa troca o visualizador junto', async () => {
        vi.spyOn(ProjectStore, 'getProjectPath').mockReturnValue('C:/p');
        const update = vi.spyOn(WaveStore, 'update').mockResolvedValue(undefined);
        const inst = new GtkwPickerManager();
        inst._currentTbKey = 'tb';
        inst._isSurfer = false;              // GTKWave ligado
        inst._files = inst._collect(ESTADO);
        vi.spyOn(inst, 'refresh').mockResolvedValue(undefined);

        const avisos = [];
        window.addEventListener('aurora:wave-viewer-changed', (e) => avisos.push(e.detail.viewer));

        await inst._setActive('C:/p/b.surf.ron');

        // O .surf.ron so abre no Surfer: escolher o arquivo tem que ligar o
        // programa dele, senao a simulacao ignora o layout escolhido.
        expect(getViewer()).toBe('surfer');
        expect(avisos).toEqual(['surfer']);
        // E a escrita foi na lista do Surfer, nao na do GTKWave.
        expect(update.mock.calls[0][2]).toBeTypeOf('function');
        const cfg = { surferFiles: [{ path: 'C:/p/b.surf.ron', isActive: false }] };
        update.mock.calls[0][2](cfg);
        expect(cfg.surferFiles[0].isActive).toBe(true);
    });

    it('escolher um layout do proprio programa nao mexe no visualizador', async () => {
        vi.spyOn(ProjectStore, 'getProjectPath').mockReturnValue('C:/p');
        vi.spyOn(WaveStore, 'update').mockResolvedValue(undefined);
        const inst = new GtkwPickerManager();
        inst._currentTbKey = 'tb';
        inst._isSurfer = false;
        inst._files = inst._collect(ESTADO);
        vi.spyOn(inst, 'refresh').mockResolvedValue(undefined);

        await inst._setActive('C:/p/a.gtkw');
        expect(getViewer()).toBe('gtkwave');
    });
});
