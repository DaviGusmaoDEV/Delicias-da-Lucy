const { createHmac, timingSafeEqual } = require('node:crypto');
const { Preference, Payment } = require('mercadopago');

function urlCheckoutValida(valor) {
  try { const url = new URL(valor); return url.protocol === 'https:' && !url.username && !url.password && ['www.mercadopago.com.br', 'www.mercadopago.com', 'checkout.infinitepay.com.br'].includes(url.hostname); } catch { return false; }
}
function assinaturaValida(req, segredo) {
  const id = req.query['data.id'];
  const requestId = req.get('x-request-id');
  if (!segredo || typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id) || !requestId) return false;
  const partes = Object.fromEntries(String(req.get('x-signature') || '').split(',').map(p => p.trim().split('=')));
  if (!/^\d+$/.test(partes.ts || '') || !/^[a-fA-F0-9]{64}$/.test(partes.v1 || '')) return false;
  const manifesto = `id:${id.toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest();
  return timingSafeEqual(esperado, Buffer.from(partes.v1, 'hex'));
}
function criarPagamentos({ cliente, db, urlPublica = process.env.PUBLIC_BASE_URL, segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET, sandbox = process.env.MERCADOPAGO_SANDBOX === 'true' }) {
  let origem;
  try { const url = new URL(urlPublica); if (url.protocol === 'https:' && !url.username && !url.password) origem = url.origin; } catch {}
  const preferencias = cliente ? new Preference(cliente) : null;
  const pagamentos = cliente ? new Payment(cliente) : null;
  return {
    disponivel: Boolean(cliente && origem && segredo),
    async checkout(pedido) {
      if (!cliente || !origem || !segredo) throw new Error('Pagamento online indisponível. Tente novamente mais tarde.');
      const retorno = new URL('/tela cliente/meu perfil cliente.html', origem).href;
      const resposta = await preferencias.create({
        requestOptions: { idempotencyKey: `pedido-${pedido.id}`, timeout: 15000 },
        body: {
          external_reference: String(pedido.id),
          notification_url: `${origem}/api/webhooks/mercadopago`,
          back_urls: { success: retorno, failure: retorno, pending: retorno }, auto_return: 'approved',
          items: [{ id: String(pedido.id), title: `Pedido Delícias da Lucy #${pedido.id}`, quantity: 1, unit_price: Number(pedido.valor), currency_id: 'BRL' }]
        }
      });
      const url = sandbox ? resposta.sandbox_init_point : resposta.init_point;
      if (!urlCheckoutValida(url)) throw new Error('Checkout indisponível.');
      return url;
    },
    async notificar(req, res) {
      if (!pagamentos || !segredo) return res.status(503).json({ erro: 'Pagamento indisponível.' });
      if (!assinaturaValida(req, segredo)) return res.status(401).json({ erro: 'Notificação inválida.' });
      if (req.body?.type !== 'payment') return res.sendStatus(200);
      try {
        // O corpo e o retorno do navegador nunca comprovam pagamento.
        const pagamento = await pagamentos.get({ id: req.query['data.id'], requestOptions: { timeout: 15000 } });
        if (!pagamento.external_reference) return res.sendStatus(200);
        const { data: pedido, error } = await db.from('pedidos').select('id,valor,pagamento').eq('id', pagamento.external_reference).maybeSingle();
        if (error) throw new Error('consulta');
        if (!pedido) return res.sendStatus(200);
        if (pedido.pagamento !== 'site' || pagamento.currency_id !== 'BRL' || !Number.isFinite(Number(pagamento.transaction_amount)) || Math.round(Number(pagamento.transaction_amount) * 100) !== Math.round(Number(pedido.valor) * 100)) return res.status(422).json({ erro: 'Pagamento não corresponde ao pedido.' });
        const estados = ['approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'refunded', 'charged_back', 'in_mediation'];
        if (!estados.includes(pagamento.status)) return res.sendStatus(200);
        const { error: erroRegistro } = await db.rpc('registrar_pagamento_pedido', {
          p_pedido_id: String(pedido.id), p_pagamento_id: String(pagamento.id), p_status: pagamento.status,
          p_valor: Number(pagamento.transaction_amount), p_estornado: Number(pagamento.transaction_amount_refunded || 0),
          p_atualizado: pagamento.date_last_updated, p_aprovado: pagamento.date_approved || null
        });
        if (erroRegistro) throw new Error('registro');
        return res.sendStatus(200);
      } catch {
        console.error('[pagamento] Não foi possível reconciliar a notificação; aguardando nova tentativa.');
        return res.status(503).json({ erro: 'Não foi possível registrar o pagamento.' });
      }
    }
  };
}
module.exports = { criarPagamentos, assinaturaValida, urlCheckoutValida };
