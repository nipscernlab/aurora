import { describe, it, expect } from 'vitest';
import { EventScanner, hasIoEventSignals } from '../../js/wave/event_markers.ts';

describe('hasIoEventSignals', () => {
    const scope = (signals) => ({ signals: signals.map((name) => ({ name })) });
    it('detecta req_in_sim_/out_en_sim_; ignora o resto', () => {
        expect(hasIoEventSignals([scope(['clk', 'req_in_sim_0'])])).toBe(true);
        expect(hasIoEventSignals([scope(['out_en_sim_3'])])).toBe(true);
        expect(hasIoEventSignals([scope(['clk', 'valr2', 'in_sim_0'])])).toBe(false);
    });
});

describe('EventScanner — tempos de evento p/ latencia', () => {
    // fst2vcd-style: $var, $enddefinitions, #N timestamps, 1-bit value changes.
    const dump = [
        '$timescale 1ns $end',
        '$var wire 1 ! clk $end',
        '$var wire 1 " req_in_sim_0 $end',
        '$var wire 1 # out_en_sim_0 $end',
        '$enddefinitions $end',
        '#0', '0!', '0"', '0#',
        '#120', '1"',          // entrada chega em 120
        '#5000', '1!',
        '#6050', '1#',         // saida pronta em 6050  -> latencia 5930
        '#7000', '0"',
        '',
    ].join('\n');

    it('acha o primeiro req_in (entrada) e out_en (saida) em alta', () => {
        const sc = new EventScanner();
        sc.feed(dump); sc.end();
        expect(sc.markers()).toEqual([
            { time: 120, label: 'input' },
            { time: 6050, label: 'output' },
        ]);
        expect(sc.done()).toBe(true);
    });

    it('para CEDO (done) assim que acha os dois — ignora o resto do dump', () => {
        const sc = new EventScanner();
        sc.feed(dump);
        // done vira true sem precisar do end(); o orquestrador mata o fst2vcd aqui.
        expect(sc.done()).toBe(true);
    });

    it('so entrada (sem saida): retorna apenas o marker de input', () => {
        const sc = new EventScanner();
        sc.feed([
            '$var wire 1 " req_in_sim_0 $end', '$enddefinitions $end',
            '#10', '1"', '',
        ].join('\n'));
        sc.end();
        expect(sc.markers()).toEqual([{ time: 10, label: 'input' }]);
        expect(sc.done()).toBe(false);
    });

    it('feed em chunks arbitrarios (split no meio de linha) funciona', () => {
        const sc = new EventScanner();
        for (let i = 0; i < dump.length; i += 5) sc.feed(dump.slice(i, i + 5));
        sc.end();
        expect(sc.markers()).toEqual([
            { time: 120, label: 'input' },
            { time: 6050, label: 'output' },
        ]);
    });
});
