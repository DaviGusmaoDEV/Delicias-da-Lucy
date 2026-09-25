// Host atual da documentação; o domínio .com.br continua aceito para links
// legados já emitidos pela InfinitePay.
const URL_API = process.env.INFINITEPAY_API_BASE_URL || 'https://api.checkout.infinitepay.io';
const HOST_CHECKOUTS = new Set(['checkout.infinitepay.io', 'checkout.infinitepay.com.br']);

function urlCheckoutValida(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' && !url.username && !url.password && HOST_CHECKOUTS.has(url.hostname);
  } catch { return false; }
}

function origemValida(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

function criarInfinitePay({ db, handle = process.env.INFINITEPAY_HANDLE, urlPublica = process.env.PUBLIC_BASE_URL, consultar = fetch } = {}) {
  const origem = origemValida(urlPublica);
  const disponivel = Boolean(db && handle && /^[A-Za-z0-9._-]{2,80}$/.test(handle) && origem);

  async function checkout(pedido) {
    if (!disponivel) throw new Error('InfinitePay ainda não foi configurada.');
    const resposta = await consultar(`${URL_API}/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        handle, order_nsu: String(pedido.id),
        redirect_url: new URL('/tela cliente/meu perfil cliente.html', origem).href,
        webhook_url: new URL('/api/webhooks/infinitepay', origem).href,
        items: [{ quantity: 1, price: Math.round(Number(pedido.valor) * 100), description: `Pedido Delícias da Lucy #${pedido.id}` }]
      })
    });
    const dados = await resposta.json().catch(() => null);
    const paymentUrl = dados?.url || dados?.checkout_url || dados?.link;
    if (!resposta.ok || !urlCheckoutValida(paymentUrl)) {
      console.error(JSON.stringify({ evento: 'infinitepay_checkout', resultado: 'falha', status: resposta.status, motivo: String(dados?.message || 'resposta_invalida').slice(0, 80) }));
      throw new Error('Checkout InfinitePay indisponível.');
    }
    console.info(JSON.stringify({ evento: 'infinitepay_checkout', resultado: 'criado' }));
    return paymentUrl;
  }

  async function notificar(req, res) {
    if (!disponivel) return res.status(503).json({ erro: 'InfinitePay indisponível.' });
    const body = req.body || {};
    const pedidoId = typeof body.order_nsu === 'string' ? body.order_nsu : '';
    const transacao = typeof body.transaction_nsu === 'string' ? body.transaction_nsu : '';
    const slug = typeof body.invoice_slug === 'string' ? body.invoice_slug : '';
    if (!pedidoId || !transacao || !slug) return res.status(400).json({ success: false, message: 'Notificação incompleta.' });
    try {
      const resposta = await consultar(`${URL_API}/payment_check`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle, order_nsu: pedidoId, transaction_nsu: transacao, slug })
      });
      const pagamento = await resposta.json().catch(() => null);
      if (!resposta.ok || pagamento?.success !== true) return res.status(503).json({ success: false, message: 'Pagamento não confirmado.' });
      const { data: pedido, error } = await db.from('pedidos').select('id,valor,pagamento').eq('id', pedidoId).maybeSingle();
      if (error) throw new Error('consulta');
      if (!pedido || pedido.pagamento !== 'site') return res.status(404).json({ success: false, message: 'Pedido não encontrado.' });
      if (!Number.isFinite(Number(pagamento.amount)) || Math.round(Number(pagamento.amount)) !== Math.round(Number(pedido.valor) * 100)) return res.status(422).json({ success: false, message: 'Valor inválido.' });
      const status = pagamento.paid === true ? 'approved' : 'pending';
      const registro = await db.rpc('registrar_pagamento_pedido', {
        p_pedido_id: pedidoId, p_pagamento_id: `infinitepay:${transacao}`, p_status: status,
        p_valor: Number(pedido.valor), p_estornado: 0,
        p_atualizado: new Date().toISOString(), p_aprovado: status === 'approved' ? new Date().toISOString() : null
      });
      if (registro.error) throw new Error('registro');
      return res.status(200).json({ success: true, message: null });
    } catch {
      console.error('[infinitepay] Não foi possível reconciliar a notificação; aguardando nova tentativa.');
      return res.status(503).json({ success: false, message: 'Não foi possível registrar o pagamento.' });
    }
  }
  return { disponivel, checkout, notificar };
}

module.exports = { criarInfinitePay, urlCheckoutValida };
