// @vitest-environment happy-dom
//
// O retorno visual de campo recusado, um so para o modal de projeto e o
// Processor Hub (#187): a borda e, quando ha o que dizer, a explicacao embaixo.

import { beforeEach, describe, expect, it } from 'vitest';

import { marcarCampo, limparCampo } from '../../js/ui/aviso_do_campo.ts';

const campo = () => document.getElementById('c');
const aviso = () => document.querySelector('.campo-aviso');

beforeEach(() => {
    document.body.innerHTML = `
      <div class="form-group">
        <label for="c">Nome</label>
        <div class="input-with-action"><input id="c"><button>...</button></div>
      </div>`;
});

describe('aviso do campo', () => {
    it('marca a borda e escreve o motivo no grupo do campo, fora da linha do botao', () => {
        marcarCampo(campo(), 'Tire: espaço.');
        expect(campo().style.getPropertyValue('border')).not.toBe('');
        expect(campo().style.getPropertyPriority('border')).toBe('important');
        expect(aviso().textContent).toBe('Tire: espaço.');
        expect(aviso().parentElement.classList.contains('form-group')).toBe(true);
    });

    it('marcar de novo troca o texto, sem empilhar avisos', () => {
        marcarCampo(campo(), 'um');
        marcarCampo(campo(), 'dois');
        expect(document.querySelectorAll('.campo-aviso')).toHaveLength(1);
        expect(aviso().textContent).toBe('dois');
    });

    it('marcar sem texto so pinta a borda e tira o aviso que havia', () => {
        marcarCampo(campo(), 'um');
        marcarCampo(campo());
        expect(campo().style.getPropertyValue('border')).not.toBe('');
        expect(aviso()).toBeNull();
    });

    it('limpar tira a borda e o aviso', () => {
        marcarCampo(campo(), 'um');
        limparCampo(campo());
        expect(campo().style.getPropertyValue('border')).toBe('');
        expect(campo().style.getPropertyValue('box-shadow')).toBe('');
        expect(aviso()).toBeNull();
    });

    it('campo fora de .form-group usa o pai, e campo nulo nao quebra', () => {
        document.body.innerHTML = '<div id="pai"><input id="c"></div>';
        marcarCampo(campo(), 'x');
        expect(aviso().parentElement.id).toBe('pai');
        expect(() => { marcarCampo(null, 'x'); limparCampo(null); }).not.toThrow();
    });
});
