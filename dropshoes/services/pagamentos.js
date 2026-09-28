const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');

const URL_API = 'https://api.mercadopago.com';
const URLS_PERMITIDAS = new Set(['www.mercadopago.com.br', 'www.mercadopago.com']);

function urlCheckoutValida(valor) {
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (URLS_PERMITIDAS.has(url.hostname) || ['checkout.infinitepay.io', 'checkout.infinitepay.com.br'].includes(url.hostname));
  } catch { return false; }
}

function assinaturaValida(req, segredo) {
  const id = req.query?.['data.id'];
  const requestId = req.get?.('x-request-id');
  if (!segredo || typeof id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(id) || typeof requestId !== 'string' || !requestId) return false;
  const partes = Object.fromEntries(String(req.get?.('x-signature') || '').split(',').map(parte => {
    const [chave, ...valor] = parte.trim().split('=');
    return [chave, valor.join('=')];
  }));
  if (!/^\d+$/.test(partes.ts || '') || !/^[a-fA-F0-9]{64}$/.test(partes.v1 || '')) return false;
  const manifesto = `id:${id.toLowerCase()};request-id:${requestId};ts:${partes.ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest();
  const recebido = Buffer.from(partes.v1, 'hex');
  return recebido.length === esperado.length && timingSafeEqual(esperado, recebido);
}

function erroHttp(status, dados) {
  const erro = new Error(String(dados?.message || dados?.error || dados?.status_detail || 'Resposta inválida do Mercado Pago').slice(0, 180));
  erro.status_http = status;
  erro.codigo = String(dados?.code || dados?.error || dados?.status_detail || 'mercadopago_error').slice(0, 80);
  return erro;
}

function mensagemSegura(erro) {
  return {
    status_http: Number.isInteger(erro?.status_http) ? erro.status_http : undefined,
    codigo: String(erro?.codigo || erro?.name || 'erro').slice(0, 80),
    mensagem: String(erro?.message || 'erro no provedor').slice(0, 180)
  };
}

function statusPagamento(order, payment) {
  const ordem = String(order?.status || '').toLowerCase();
  const pagamento = String(payment?.status || '').toLowerCase();
  const detalhe = String(order?.status_detail || payment?.status_detail || '').toLowerCase();
  if (['processed', 'approved', 'accredited', 'completed'].includes(ordem) || ['processed', 'approved', 'accredited', 'completed'].includes(pagamento)) return 'approved';
  if (['refunded', 'partially_refunded'].includes(ordem) || ['refunded', 'partially_refunded'].includes(pagamento)) return 'refunded';
  if (['cancelled', 'canceled', 'expired'].includes(ordem) || ['cancelled', 'canceled', 'expired'].includes(pagamento) || detalhe.includes('expired')) return 'cancelled';
  if (['rejected', 'failed', 'declined'].includes(ordem) || ['rejected', 'failed', 'declined'].includes(pagamento)) return 'rejected';
  return 'pending';
}

async function chamadaMercadoPago(fetcher, token, path, options = {}) {
  const resposta = await fetcher(`${URL_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw erroHttp(resposta.status, dados);
  return dados;
}

function dadosPagamento(order) {
  const payment = order?.transactions?.payments?.[0] || {};
  return { payment, metodo: payment.payment_method || {} };
}

function expiraEm(order, payment, agora) {
  const candidato = payment.expiration_time || order.expiration_time || order.expires_at;
  if (candidato && !Number.isNaN(Date.parse(candidato))) return new Date(candidato).toISOString();
  return new Date(agora.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function criarPagamentos({ db, accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN, segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET, payerEmail = process.env.MERCADOPAGO_PAYER_EMAIL, fetcher = globalThis.fetch, agora = () => new Date() } = {}) {
  // Sem o segredo do webhook não há confirmação confiável; portanto o Pix não
  // deve ser oferecido mesmo que o Access Token esteja configurado.
  const disponivel = Boolean(db && accessToken && segredo && typeof fetcher === 'function');

  async function persistir(id, valores) {
    if (!db?.from) return;
    const { error } = await db.from('pedidos').update(valores).eq('id', id);
    if (error) throw new Error('Não foi possível salvar os dados do pagamento.');
  }

  async function checkout(pedido) {
    if (!disponivel) throw new Error('Pagamento Pix indisponível.');
    const expirado = pedido.pagamento_expira_em && Date.parse(pedido.pagamento_expira_em) <= agora().getTime();
    if (!expirado && pedido.pagamento_provedor === 'mercadopago_pix' && pedido.pagamento_id && pedido.pagamento_qr_code) {
      const paymentId = String(pedido.pagamento_id).replace(/^mercadopago:/, '');
      return { provider: 'mercadopago_pix', payment_url: pedido.payment_url || null, qr_code: pedido.pagamento_qr_code, qr_code_base64: pedido.pagamento_qr_code_base64, payment_id: paymentId, status: pedido.pagamento_status || 'pending', expires_at: pedido.pagamento_expira_em };
    }
    // A primeira tentativa é determinística por pedido: se a API responder e a
    // gravação local falhar, o retry usa a mesma chave e não cria outra Order.
    const idempotencyKey = expirado ? randomUUID() : (pedido.pagamento_idempotencia || `pedido-${pedido.id}-pix`);
    const email = String(pedido.cliente_email || pedido.email || payerEmail || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido para gerar o Pix.');
    const valor = Number(pedido.valor);
    if (!Number.isFinite(valor) || valor <= 0) throw new Error('Valor do pedido inválido.');
    const order = await chamadaMercadoPago(fetcher, accessToken, '/v1/orders', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        type: 'online', total_amount: valor.toFixed(2), external_reference: String(pedido.id), processing_mode: 'automatic',
        transactions: { payments: [{ amount: valor.toFixed(2), payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: 'P1D' }] },
        payer: { email }
      })
    });
    const { payment, metodo } = dadosPagamento(order);
    if (!metodo.qr_code || !metodo.qr_code_base64) {
      const erro = new Error('O Mercado Pago não retornou os dados do Pix.');
      erro.codigo = 'resposta_sem_qr_code';
      console.error(JSON.stringify({ evento: 'mercadopago_order', resultado: 'resposta_sem_qr_code', pedido_id: String(pedido.id), propriedades: Object.keys(order || {}) }));
      throw erro;
    }
    const expiresAt = expiraEm(order, payment, agora());
    const paymentId = String(payment.id || order.id || '');
    const retorno = { provider: 'mercadopago_pix', payment_url: metodo.ticket_url || null, qr_code: metodo.qr_code, qr_code_base64: metodo.qr_code_base64, payment_id: paymentId, order_id: String(order.id || ''), status: statusPagamento(order, payment), expires_at: expiresAt };
    await persistir(pedido.id, {
      pagamento_provedor: 'mercadopago_pix', pagamento_id: `mercadopago:${paymentId}`, pagamento_status: retorno.status,
      pagamento_atualizado: new Date().toISOString(), pagamento_expira_em: expiresAt, pagamento_idempotencia: idempotencyKey,
      pagamento_qr_code: retorno.qr_code, pagamento_qr_code_base64: retorno.qr_code_base64, payment_url: retorno.payment_url
    });
    console.info(JSON.stringify({ evento: 'mercadopago_order', resultado: 'criado', pedido_id: String(pedido.id), order_id: String(order.id || ''), payment_id: paymentId, status: retorno.status }));
    return retorno;
  }

  async function notificar(req, res) {
    if (!accessToken || !segredo) return res.status(503).json({ erro: 'Pagamento indisponível.' });
    if (!assinaturaValida(req, segredo)) return res.status(401).json({ erro: 'Notificação inválida.' });
    const orderId = req.query?.['data.id'];
    const eventoId = req.body?.id ? String(req.body.id) : `${orderId}:${req.body?.action || 'updated'}`;
    try {
      const { data: eventoAnterior, error: erroEventoAnterior } = await db.from('pagamento_eventos').select('id').eq('provedor', 'mercadopago').eq('evento_id', eventoId).maybeSingle();
      if (erroEventoAnterior) throw new Error('consulta_evento');
      if (eventoAnterior) return res.sendStatus(200);
      const order = await chamadaMercadoPago(fetcher, accessToken, `/v1/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
      const { payment } = dadosPagamento(order);
      const externalReference = String(order.external_reference || '');
      if (!externalReference) return res.sendStatus(200);
      const { data: pedido, error } = await db.from('pedidos').select('id,valor,pagamento,pagamento_provedor').eq('id', externalReference).maybeSingle();
      if (error) throw new Error('consulta_pedido');
      if (!pedido || pedido.pagamento !== 'site') return res.sendStatus(200);
      const valor = Number(payment.amount ?? order.total_amount);
      if (!Number.isFinite(valor) || Math.round(valor * 100) !== Math.round(Number(pedido.valor) * 100)) return res.status(422).json({ erro: 'Pagamento não corresponde ao pedido.' });
      const status = statusPagamento(order, payment);
      const paymentId = String(payment.id || order.id || '');
      const atualizado = payment.date_last_updated || order.last_updated_date || new Date().toISOString();
      const aprovado = payment.date_approved || null;
      const { error: erroRegistro } = await db.rpc('registrar_pagamento_pedido', {
        p_pedido_id: externalReference, p_pagamento_id: `mercadopago:${paymentId}`, p_status: status,
        p_valor: valor, p_estornado: Number(payment.refunded_amount || 0), p_atualizado: atualizado, p_aprovado: aprovado
      });
      if (erroRegistro) throw new Error('registro_pagamento');
      const { error: erroEvento } = await db.from('pagamento_eventos').insert([{ provedor: 'mercadopago', evento_id: eventoId, pagamento_id: paymentId, pedido_id: externalReference, status }]);
      if (erroEvento && !['23505', '409'].includes(String(erroEvento.code))) throw new Error('registro_evento');
      console.info(JSON.stringify({ evento: 'mercadopago_order', resultado: 'processado', pedido_id: externalReference, order_id: String(order.id || ''), payment_id: paymentId, status }));
      return res.sendStatus(200);
    } catch (erro) {
      console.error(JSON.stringify({ evento: 'mercadopago_webhook', resultado: 'falha', ...mensagemSegura(erro), order_id: typeof orderId === 'string' ? orderId : undefined }));
      return res.status(503).json({ erro: 'Não foi possível processar a confirmação.' });
    }
  }

  return { disponivel, checkout, notificar };
}

module.exports = { criarPagamentos, assinaturaValida, urlCheckoutValida, statusPagamento };
