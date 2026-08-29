/**
 * O motivo de uma resposta de API que falhou.
 *
 * A regra da casa: nenhuma API responde de forma incompleta. Ou ela foi
 * chamada errado, e diz onde; ou ela falhou, e diz o erro; ou deu certo, e
 * devolve o resultado. Este modulo cuida do lado de quem LE a resposta: o
 * texto que vai para a tela nunca pode ser um "Falhou." seco, porque um
 * "Falhou." seco e uma resposta incompleta disfarcada de tratada.
 *
 * Havia trinta e tantos lugares escrevendo `res?.error || 'Falha em X.'`. O
 * `||` esta certo como ultimo recurso, mas o que ele mostrava quando o erro
 * nao vinha era so o nome da operacao, sem dizer que a API respondeu sem
 * motivo, nem o que respondeu. Aqui, quando o motivo falta, a mensagem diz
 * isso e mostra o que chegou, que e a unica pista que existe para consertar.
 */

/** Tira o motivo de qualquer das formas que as APIs da casa usam. */
function motivoBruto(res) {
  if (res == null) return '';
  if (typeof res === 'string') return res;
  const m = res.error ?? res.erro ?? res.message ?? res.mensagem;
  if (m == null) return '';
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object' && typeof m.message === 'string') return m.message;
  return String(m);
}

/** Um retrato curto da resposta, para a mensagem de "respondeu sem motivo". */
function retrato(res) {
  if (res === undefined) return 'undefined';
  if (res === null) return 'null';
  try {
    const s = JSON.stringify(res);
    return s.length > 160 ? `${s.slice(0, 157)}...` : s;
  } catch (_) {
    return String(res);
  }
}

/**
 * O texto de erro para a tela.
 *
 * @param {any} res a resposta da API, do jeito que veio
 * @param {string} operacao o que se tentava fazer, no idioma da tela
 *   ("Instalar a biblioteca", "Consultar a PyPI")
 * @returns {string} `operacao: motivo`, ou, sem motivo, `operacao: a API
 *   respondeu sem dizer o erro (resposta: ...)`
 */
export function motivoDe(res, operacao) {
  const motivo = motivoBruto(res).trim();
  if (motivo) return operacao ? `${operacao}: ${motivo}` : motivo;
  const t = typeof window !== 'undefined' && window.t ? window.t : null;
  const semMotivo = t
    ? t('api.semMotivo', { resposta: retrato(res) })
    : `a API respondeu sem dizer o erro (resposta: ${retrato(res)})`;
  return operacao ? `${operacao}: ${semMotivo}` : semMotivo;
}
