import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    isSubProvider, formatTokens, shortModelName,
    readPermissionMode, PERMISSION_MODES,
    usageRows, formatPlanLabel, untilTime,
} from '../../js/ai/ai_metadata.js';

describe('isSubProvider', () => {
    it('flags the subscription CLIs, not API providers', () => {
        expect(isSubProvider('claude-code')).toBe(true);
        expect(isSubProvider('chatgpt')).toBe(true);
        expect(isSubProvider('openai')).toBe(false);
        expect(isSubProvider('')).toBe(false);
    });
});

describe('formatTokens', () => {
    it('compacts with k/M and trims trailing .0', () => {
        expect(formatTokens(500)).toBe('500');
        expect(formatTokens(1500)).toBe('1.5k');
        expect(formatTokens(2000)).toBe('2k');
        expect(formatTokens(2_000_000)).toBe('2M');
    });
});

describe('shortModelName', () => {
    it('strips the provider prefix, tolerates empty', () => {
        expect(shortModelName('claude-opus-4-8')).toBe('opus-4-8');
        expect(shortModelName('')).toBe('');
    });
});

describe('permission modes', () => {
    beforeEach(() => {
        const store = {};
        globalThis.localStorage = {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
        };
    });
    afterEach(() => { delete globalThis.localStorage; });

    it('exposes ask / writes / allow', () => {
        expect(PERMISSION_MODES.map((m) => m.id)).toEqual(['ask', 'writes', 'allow']);
    });
    it('defaults to writes when unset', () => {
        expect(readPermissionMode()).toBe('writes');
    });
    it('returns a stored valid mode, ignores an invalid one', () => {
        localStorage.setItem('aurora-ai-permission', 'allow');
        expect(readPermissionMode()).toBe('allow');
        localStorage.setItem('aurora-ai-permission', 'bogus');
        expect(readPermissionMode()).toBe('writes');
    });
});

// O painel de uso, cujas regras moravam dentro do render e por isso nunca
// tinham sido verificadas. O instante de referencia entra por parametro
// para o teste nao depender do relogio da maquina.
const AGORA = 1_700_000_000_000; // ms
const EM_SEGUNDOS = AGORA / 1000;

describe('formatPlanLabel', () => {
    it('unifica os nomes que o mesmo plano recebe', () => {
        expect(formatPlanLabel('pro_max')).toBe('MAX');
        expect(formatPlanLabel('claude_max')).toBe('MAX');
        expect(formatPlanLabel('claude_pro')).toBe('PRO');
        expect(formatPlanLabel('  Team  ')).toBe('TEAM');
    });

    it('mostra o desconhecido em maiuscula, em vez de esconder', () => {
        expect(formatPlanLabel('plano_novo')).toBe('PLANO_NOVO');
    });

    it('vazio continua vazio, para o rotulo sumir', () => {
        expect(formatPlanLabel('')).toBe('');
        expect(formatPlanLabel(null)).toBe('');
        expect(formatPlanLabel(undefined)).toBe('');
    });
});

describe('untilTime', () => {
    it('conta a partir do instante dado', () => {
        expect(untilTime(EM_SEGUNDOS + 1800, AGORA)).toBe('in 30m');
        expect(untilTime(EM_SEGUNDOS + 3600 * 2 + 60 * 14, AGORA)).toBe('in 2h 14m');
        expect(untilTime(EM_SEGUNDOS + 3600 * 25, AGORA)).toBe('in 1d 1h');
    });

    it('prazo vencido vira "now", nunca contagem negativa', () => {
        expect(untilTime(EM_SEGUNDOS - 60, AGORA)).toBe('now');
        expect(untilTime(NaN, AGORA)).toBe('now');
    });
});

describe('usageRows', () => {
    it('sem relatorio nenhum, sobra a linha da sessao zerada', () => {
        const linhas = usageRows(undefined, { agora: AGORA });
        expect(linhas).toHaveLength(1);
        expect(linhas[0].label).toBe('This session');
        expect(linhas[0].valText).toBe('0 tokens');
        expect(linhas[0].sev).toBe('count');
    });

    it('o custo so aparece quando existe', () => {
        const sem = usageRows({ session: { tokens: 1500 } }, { agora: AGORA });
        expect(sem[0].valText).toBe('1.5k tokens');
        const com = usageRows({ session: { tokens: 1500, costUsd: 0.5 } }, { agora: AGORA });
        expect(com[0].valText).toBe('1.5k tokens · $0.50');
    });

    it('recorta a utilizacao no intervalo da pista', () => {
        const linhas = usageRows({ windows: [
            { rateLimitType: 'five_hour', utilization: 120 },
            { rateLimitType: 'seven_day', utilization: -5 },
        ] }, { agora: AGORA });
        expect(linhas[1].pct).toBe(100);
        expect(linhas[2].pct).toBe(0);
    });

    it('a cor vira alerta em 90 e atencao em 60', () => {
        const sev = (u) => usageRows({ windows: [{ rateLimitType: 'five_hour', utilization: u }] },
            { agora: AGORA })[1].sev;
        expect(sev(10)).toBe('ok');
        expect(sev(59.9)).toBe('ok');
        expect(sev(60)).toBe('mid');
        expect(sev(89.9)).toBe('mid');
        expect(sev(90)).toBe('high');
    });

    it('resetsAt em milissegundos e dobrado para segundos', () => {
        const emMs = usageRows({ windows: [
            { rateLimitType: 'five_hour', utilization: 50, resetsAt: (EM_SEGUNDOS + 3600) * 1000 },
        ] }, { agora: AGORA })[1];
        const emSeg = usageRows({ windows: [
            { rateLimitType: 'five_hour', utilization: 50, resetsAt: EM_SEGUNDOS + 3600 },
        ] }, { agora: AGORA })[1];
        expect(emMs.valText).toBe('50% · resets in 1h 0m');
        expect(emSeg.valText).toBe(emMs.valText);
    });

    it('sem numero, o status decide a cor e a largura', () => {
        const linhas = usageRows({ windows: [
            { rateLimitType: 'five_hour', status: 'rejected' },
            { rateLimitType: 'seven_day', status: 'throttled' },
            { rateLimitType: 'weekly', status: 'allowed' },
        ] }, { agora: AGORA });
        expect([linhas[1].sev, linhas[1].pct]).toEqual(['high', 100]);
        expect([linhas[2].sev, linhas[2].pct]).toEqual(['mid', 66]);
        expect([linhas[3].sev, linhas[3].pct]).toEqual(['ok', 22]);
    });

    it('janela de tipo desconhecido ainda aparece, com o proprio nome', () => {
        const linhas = usageRows({ windows: [{ rateLimitType: 'trinta_dias', utilization: 5 }] },
            { agora: AGORA });
        expect(linhas[1].label).toBe('trinta_dias');
        expect(linhas[1].icon).toBe('ph-clock');
    });

    it('windows que nao e lista e ignorado, sem estourar', () => {
        expect(usageRows({ windows: null }, { agora: AGORA })).toHaveLength(1);
        expect(usageRows({ windows: 'nada' }, { agora: AGORA })).toHaveLength(1);
    });
});
