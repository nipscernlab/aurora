import { describe, it, expect } from 'vitest';
import { getJson } from '../../main/net/fetcher.js';

// O erro de timeout tem que dizer DE QUEM se esperava resposta e por quanto
// tempo. "requisicao JSON expirou" era o que o painel de bibliotecas mostrava
// ao usuario, e nao deixava saber se a culpa era da PyPI, da rede ou do nome.
//
// 10.255.255.1 e um endereco privado que nao roteia: a conexao fica pendurada
// ate o prazo, sem depender de servidor nem de rede externa. O fetcher so
// aceita https, entao um servidor http local nao serve de duble.

describe('getJson: timeout', () => {
    it('a mensagem leva a URL e o prazo', async () => {
        const url = 'https://10.255.255.1/pypi/numpy/json';
        await expect(getJson(url, { timeoutMs: 1000 })).rejects.toThrow(`${url} nao respondeu em 1 s`);
    }, 10000);
});
