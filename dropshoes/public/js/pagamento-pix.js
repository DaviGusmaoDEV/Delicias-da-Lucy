import { api, enviar } from './api.js';
import { rotuloPedido } from './numero-pedido.js';

const params = new URLSearchParams(location.search);
const pedidoId = params.get('pedido');
let pagamento;
let timer;
let finalizado = false;
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const $ = id => document.getElementById(id);

function atualizarStatus(mensagem) {
  const elemento = $('pix-pendente');
  if (elemento && elemento.textContent !== mensagem) elemento.textContent = mensagem;
}

function mostrarDados(dados) {
  pagamento = dados.pagamento || dados;
  $('pix-pedido').textContent = rotuloPedido({ numero_pedido: dados.numero_pedido ?? dados.pedido?.numero_pedido, id: dados.pedido_id || dados.pedido?.id || pedidoId });
  $('pix-total').textContent = dinheiro(dados.valor || dados.pedido?.valor);
  const base64 = pagamento.qr_code_base64;
  if (base64) $('pix-qr').src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
  $('pix-copia-cola').value = pagamento.qr_code || '';
  $('pix-conteudo').hidden = !pagamento.qr_code;
  if (pagamento.expires_at) $('pix-expira').textContent = `Esta cobrança expira em ${new Date(pagamento.expires_at).toLocaleString('pt-BR')}.`;
}

function finalizar(status) {
  finalizado = true;
  pararVerificacao();
  $('pix-pendente').hidden = true;
  $('pix-conteudo').hidden = true;
  $('pix-finalizado').hidden = false;
  if (status !== 'approved') {
    $('pix-finalizado-titulo').textContent = status === 'cancelled' ? 'Pix expirado ou cancelado' : 'Pagamento não aprovado';
    $('pix-finalizado-texto').textContent = 'Gere uma nova cobrança para tentar novamente.';
    $('pix-novo').hidden = false;
  } else {
    $('pix-finalizado-titulo').textContent = 'Pagamento confirmado';
    $('pix-finalizado-texto').textContent = 'Seu pedido foi recebido e já foi enviado para a loja.';
  }
}

function pararVerificacao() {
  if (timer) clearInterval(timer);
  timer = null;
}

function iniciarVerificacao() {
  if (timer || document.hidden || finalizado) return;
  timer = setInterval(() => verificar().catch(() => {}), 5000);
}

async function verificar() {
  if (!pedidoId) throw new Error('Pedido não informado.');
  const estado = await api(`/api/pedidos/${encodeURIComponent(pedidoId)}/pagamento-status`);
  if (estado.payment_status === 'approved') finalizar('approved');
  else if (['cancelled', 'rejected', 'refunded'].includes(estado.payment_status)) finalizar(estado.payment_status);
}

async function iniciar() {
  if (!pedidoId) throw new Error('Pedido não informado.');
  let salvo;
  try { salvo = JSON.parse(sessionStorage.getItem('pagamentoPix') || 'null'); } catch {}
  if (salvo?.pedido_id === pedidoId) mostrarDados(salvo);
  else mostrarDados(await api(`/api/pedidos/${encodeURIComponent(pedidoId)}/pagamento`));
  atualizarStatus('Verificando pagamento...');
  await verificar();
  if (!finalizado) atualizarStatus('Aguardando confirmação do pagamento. Após pagar, aguarde nesta página.');
  iniciarVerificacao();
}

async function copiarCodigo(texto) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return 'copiado';
    }
  } catch {}
  const campo = $('pix-copia-cola');
  if (!campo) return 'erro';
  campo.focus();
  campo.select();
  campo.setSelectionRange(0, campo.value.length);
  return 'selecionado';
}

$('pix-copiar')?.addEventListener('click', async () => {
  if (!pagamento?.qr_code) {
    $('pix-feedback').textContent = 'O código Pix ainda não está disponível.';
    return;
  }
  const resultado = await copiarCodigo(pagamento.qr_code);
  $('pix-feedback').textContent = resultado === 'copiado'
    ? 'Código Pix copiado.'
    : resultado === 'selecionado'
      ? 'Código Pix selecionado. Pressione Ctrl+C ou use a opção Copiar do seu celular.'
      : 'Não foi possível copiar automaticamente. Selecione o código acima para copiar.';
});
$('pix-novo')?.addEventListener('click', async () => {
  $('pix-novo').disabled = true;
  try { const dados = await enviar(`/api/pedidos/${encodeURIComponent(pedidoId)}/pagar`, 'POST', {}); sessionStorage.setItem('pagamentoPix', JSON.stringify({ pedido_id: pedidoId, valor: dados.pedido.valor, pagamento: dados.pagamento })); location.reload(); }
  catch (erro) { $('pix-erro').hidden = false; $('pix-erro').textContent = erro.message; $('pix-novo').disabled = false; }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return pararVerificacao();
  verificar().catch(() => {}).finally(iniciarVerificacao);
});
window.addEventListener('pagehide', pararVerificacao, { once: true });
iniciar().catch(erro => { $('pix-erro').hidden = false; $('pix-erro').textContent = erro.message; });
