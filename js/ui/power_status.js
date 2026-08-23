/**
 * power_status.js: o indicador de energia da barra de baixo.
 *
 * Numa simulação longa, a diferença entre tomada e bateria é a diferença
 * entre minutos e meia hora: na bateria o Windows corta o clock da CPU. O
 * aluno não vê essa causa, vê "a AURORA está lenta". O indicador torna o
 * estado visível o tempo todo: verde conectado, vermelho na bateria, com a
 * porcentagem no balão; o clique explica a situação e leva às configurações
 * de energia do Windows, onde a escolha é do dono da máquina, nunca nossa.
 *
 * A fonte do estado é a Battery API do próprio Chromium
 * (`navigator.getBattery`), que entrega `charging`, `level` e os eventos de
 * mudança sem custo de IPC. Máquina sem bateria (desktop do laboratório)
 * reporta carregando com nível 1: o indicador fica verde e quieto, que é a
 * verdade que interessa. Se a API não existir, o item some em vez de mentir.
 *
 * O que este módulo NÃO faz, de propósito: mudar o plano de energia. Mexer
 * na configuração do sistema por conta própria é o tipo de surpresa que faz
 * um administrador de laboratório desconfiar do aplicativo inteiro.
 */

import { electronAPI } from '../app/electron_api.js';
import { showDialog } from './dialog_manager.js';

const tr = (k, fb, p) => {
    const v = window.t ? window.t(k, p) : null;
    if (v && v !== k) return v;
    return String(fb).replace(/\{\{(\w+)\}\}/g, (m, key) => (p && key in p ? String(p[key]) : m));
};

export function initPowerStatus() {
    const el = document.getElementById('powerStatusItem');
    if (!el || typeof navigator === 'undefined' || typeof navigator.getBattery !== 'function') return;

    navigator.getBattery().then((bateria) => {
        el.hidden = false;

        const pintar = () => {
            const naBateria = !bateria.charging;
            const nivel = Math.round((bateria.level ?? 1) * 100);
            el.classList.toggle('on-battery', naBateria);
            el.classList.toggle('plugged', !naBateria);
            el.innerHTML = `<i class="ph ${naBateria ? 'ph-battery-medium' : 'ph-battery-charging'}" aria-hidden="true"></i>`;
            el.dataset.tooltip = naBateria
                ? tr('statusbar.power.onBattery', 'On battery ({{level}}%): Windows lowers the CPU clock and simulations run slower. Click for details.', { level: nivel })
                : tr('statusbar.power.plugged', 'Plugged in ({{level}}%): full performance available.', { level: nivel });
        };

        bateria.addEventListener('chargingchange', pintar);
        bateria.addEventListener('levelchange', pintar);
        pintar();

        el.addEventListener('click', async () => {
            const naBateria = !bateria.charging;
            const acao = await showDialog({
                title: tr('statusbar.power.dialogTitle', 'Power and simulation speed'),
                message: naBateria
                    ? tr('statusbar.power.dialogOnBattery',
                        'This laptop is running on battery. Windows lowers the CPU clock to save energy, so compilations and simulations take noticeably longer, and a long run may be interrupted if the machine sleeps.\n\n'
                        + 'Plugging in restores full speed. In Windows power settings you can also pick a performance power mode and keep the screen on for long runs. The AURORA already keeps the machine awake while a compilation is running.')
                    : tr('statusbar.power.dialogPlugged',
                        'This machine is plugged in, so the CPU runs at full speed.\n\n'
                        + 'For long simulations you can still pick a performance power mode in Windows power settings. The AURORA already keeps the machine awake while a compilation is running.'),
                variant: 'info',
                buttons: [
                    { label: tr('dialog.common.close', 'Close'), action: 'close', type: 'cancel' },
                    { label: tr('statusbar.power.openSettings', 'Open Windows power settings'), action: 'abrir', type: 'primary' },
                ],
            });
            if (acao === 'abrir') {
                try { await electronAPI.openPowerSettings?.(); } catch (_) { /* melhor esforco */ }
            }
        });
    }).catch(() => { /* sem Battery API: o item continua escondido */ });
}
