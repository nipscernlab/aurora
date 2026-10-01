import https from 'node:https';
import { EventEmitter } from 'node:events';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { getJson } from '../../main/net/fetcher.js';

// O erro de timeout tem que dizer DE QUEM se esperava resposta e por quanto
// tempo. "requisicao JSON expirou" era o que o painel de bibliotecas mostrava
// ao usuario, e nao deixava saber se a culpa era da PyPI, da rede ou do nome.
//
// O pedido e um duble do https.get que nunca responde e honra o setTimeout e o
// destroy, como o de verdade. Antes o teste apontava para 10.255.255.1, um
// endereco privado que nao roteia, contando que a conexao ficasse pendurada
// ate o prazo; numa rede que recusa esse endereco na hora (ECONNREFUSED) o
// teste falhava sem relacao com o codigo. O fetcher so aceita https e ignora a
// porta da URL, entao um servidor local tambem nao serve de duble.

afterEach(() => vi.restoreAllMocks());

/** Um pedido que nunca responde: so o prazo o encerra. */
function pedidoMudo() {
  const req = new EventEmitter();
  req.setTimeout = (ms, cb) => { req.timer = setTimeout(cb, ms); return req; };
  req.destroy = (err) => { clearTimeout(req.timer); if (err) req.emit('error', err); return req; };
  return req;
}

describe('getJson: timeout', () => {
  it('a mensagem leva a URL e o prazo', async () => {
    const get = vi.spyOn(https, 'get').mockImplementation(() => pedidoMudo());
    const url = 'https://pypi.org/pypi/numpy/json';
    await expect(getJson(url, { timeoutMs: 1000 })).rejects.toThrow(`${url} nao respondeu em 1 s`);
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: 'pypi.org', path: '/pypi/numpy/json' }),
      expect.any(Function),
    );
  }, 10000);
});
