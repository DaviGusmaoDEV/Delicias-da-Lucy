import { api } from './api.js';
import { sessaoPronta } from './sessao.js';
import { pedidoNoHistorico, statusPedido, textoPagamento } from './status-pedidos.mjs';
import { rotuloPedido } from './numero-pedido.js';

const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;

function dataPedido(valor) {
  const data = valor ? new Date(valor) : null;
  return data && !Number.isNaN(data.getTime())
    ? data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : 'Data indisponível';
}

function textoSemPedidos(texto) {
  const aviso = document.createElement('p');
  aviso.className = 'estado-pedidos';
  aviso.textContent = texto;
  return aviso;
}

function adicionarInformacao(container, rotulo, valor, classe = '') {
  const bloco = document.createElement('div');
  bloco.className = `pedido-informacao${classe ? ` ${classe}` : ''}`;
  const titulo = document.createElement('span');
  titulo.className = 'pedido-informacao-rotulo';
  titulo.textContent = rotulo;
  const conteudo = document.createElement('strong');
  conteudo.className = 'pedido-informacao-valor';
  conteudo.textContent = valor;
  bloco.append(titulo, conteudo);
  container.append(bloco);
}

function detalhesPagamento(pedido) {
  if (pedido.pagamento === 'site') return textoPagamento(pedido.pagamento_status);
  if (pedido.pagamento === 'entrega') return 'Pagamento na entrega — será cobrado quando receber o pedido.';
  return null;
}

function adicionarItens(card, pedido) {
  if (!Array.isArray(pedido.itens_pedido) || !pedido.itens_pedido.length) return;
  const titulo = document.createElement('h4');
  titulo.className = 'pedido-itens-titulo';
  titulo.textContent = 'Itens do pedido';
  const lista = document.createElement('ul');
  lista.className = 'pedido-itens';
  for (const item of pedido.itens_pedido) {
    const linha = document.createElement('li');
    const nome = item.products?.nome || item.nome || 'Produto';
    linha.textContent = `${item.quantidade || 0} × ${nome}`;
    if (item.subtotal != null) linha.append(` — ${dinheiro(item.subtotal)}`);
    lista.append(linha);
  }
  card.append(titulo, lista);
}

async function confirmarRecebimento(id, botao) {
  if (!window.confirm('Confirma que recebeu este pedido?')) return;
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'Confirmando recebimento...';
  try {
    await api(`/api/pedidos/${encodeURIComponent(id)}/confirmar-recebimento`, { method: 'POST' });
    await carregarPedidos();
  } catch (erro) {
    mostrarErro(erro);
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
}

function adicionarAcoes(card, pedido) {
  const acoes = document.createElement('div');
  acoes.className = 'pedido-acoes';

  if (pedido.pagamento === 'site') {
    const pagamentoFinalizado = ['rejected', 'cancelled', 'refunded', 'charged_back'].includes(pedido.pagamento_status);
    if (!pedido.pago_em && pedido.status !== 'cancelado' && !pagamentoFinalizado) {
      const pagar = document.createElement('button');
      pagar.className = 'btn btn-primary';
      pagar.type = 'button';
      pagar.textContent = 'Continuar pagamento';
      pagar.setAttribute('aria-label', `Continuar pagamento do ${rotuloPedido(pedido)}`);
      pagar.onclick = async () => {
        pagar.disabled = true;
        pagar.textContent = 'Abrindo pagamento...';
        try {
          const dados = await api(`/api/pedidos/${encodeURIComponent(pedido.id)}/pagar`, { method: 'POST' });
          if (dados.pagamento?.provider === 'mercadopago_pix') {
            sessionStorage.setItem('pagamentoPix', JSON.stringify({ pedido_id: dados.pedido.id, valor: dados.pedido.valor, pagamento: dados.pagamento }));
            window.location.assign(`../tela cliente/pagamento pix.html?pedido=${encodeURIComponent(dados.pedido.id)}`);
            return;
          }
          if (!dados.payment_url?.startsWith('https://')) throw new Error('Não foi possível abrir o pagamento. Tente novamente.');
          window.location.assign(dados.payment_url);
        } catch (erro) {
          mostrarErro(erro);
          pagar.disabled = false;
          pagar.textContent = 'Continuar pagamento';
        }
      };
      acoes.append(pagar);
    }
  }

  if (pedido.status === 'pronto_entrega') {
    const recebido = document.createElement('button');
    recebido.className = 'btn btn-recebido';
    recebido.type = 'button';
    recebido.textContent = 'Confirmar que recebi o pedido';
    recebido.onclick = () => confirmarRecebimento(pedido.id, recebido);
    acoes.append(recebido);
  }

  if (acoes.children.length) card.append(acoes);
}

function cartaoPedido(pedido) {
  const [titulo, descricao] = statusPedido(pedido.status);
  const card = document.createElement('article');
  card.className = `pedido-card status-${pedido.status || 'desconhecido'}`;

  const cabecalho = document.createElement('header');
  cabecalho.className = 'pedido-cabecalho';
  const tituloPedido = document.createElement('h3');
  tituloPedido.textContent = rotuloPedido(pedido);
  const data = document.createElement('time');
  data.dateTime = pedido.data_criacao || '';
  data.textContent = dataPedido(pedido.data_criacao);
  cabecalho.append(tituloPedido, data);

  const resumo = document.createElement('div');
  resumo.className = 'pedido-resumo';
  const statusBloco = document.createElement('div');
  statusBloco.className = 'pedido-status-bloco';
  const statusRotulo = document.createElement('span');
  statusRotulo.className = `status-pedido status-${pedido.status || 'desconhecido'}`;
  statusRotulo.textContent = titulo;
  const statusDescricao = document.createElement('p');
  statusDescricao.className = 'status-detalhe';
  statusDescricao.textContent = descricao;
  statusBloco.append(statusRotulo, statusDescricao);
  resumo.append(statusBloco);

  const pagamento = detalhesPagamento(pedido);
  if (pagamento) adicionarInformacao(resumo, 'Pagamento', pagamento, 'pedido-pagamento');
  adicionarInformacao(resumo, 'Total', dinheiro(pedido.valor), 'pedido-total');

  card.append(cabecalho, resumo);
  adicionarItens(card, pedido);
  if (pedido.subtotal != null || pedido.taxa_entrega != null) {
    const valores = document.createElement('div');
    valores.className = 'pedido-valores';
    if (pedido.subtotal != null) adicionarInformacao(valores, 'Subtotal', dinheiro(pedido.subtotal));
    if (pedido.taxa_entrega != null) adicionarInformacao(valores, 'Entrega', dinheiro(pedido.taxa_entrega));
    card.append(valores);
  }
  adicionarAcoes(card, pedido);
  return card;
}

function preencherLista(elemento, pedidos, vazio) {
  elemento.replaceChildren();
  elemento.setAttribute('aria-busy', 'false');
  if (!pedidos.length) {
    elemento.append(textoSemPedidos(vazio));
    return;
  }
  pedidos.forEach(pedido => elemento.append(cartaoPedido(pedido)));
}

function mostrarCarregando() {
  for (const id of ['pedidos-em-andamento', 'meus-pedidos']) {
    const elemento = document.getElementById(id);
    if (!elemento) continue;
    elemento.setAttribute('aria-busy', 'true');
    elemento.replaceChildren(textoSemPedidos('Carregando pedidos...'));
  }
}

function mostrarFalhaPedidos() {
  for (const id of ['pedidos-em-andamento', 'meus-pedidos']) {
    const elemento = document.getElementById(id);
    if (!elemento) continue;
    elemento.setAttribute('aria-busy', 'false');
    elemento.replaceChildren(textoSemPedidos('Não foi possível carregar os pedidos. Tente novamente.'));
  }
}

async function carregarPedidos() {
  const atuais = document.getElementById('pedidos-em-andamento');
  const historico = document.getElementById('meus-pedidos');
  if (!atuais || !historico) return;
  mostrarCarregando();
  const pedidos = await api('/api/meus-pedidos');
  preencherLista(atuais, pedidos.filter(pedido => !pedidoNoHistorico(pedido)), 'Você não tem pedidos em andamento.');
  preencherLista(historico, pedidos.filter(pedido => pedidoNoHistorico(pedido)), 'Você ainda não fez nenhum pedido.');
}

function mostrarErro(erro) {
  let aviso = document.getElementById('erro-perfil');
  if (!aviso) {
    aviso = document.createElement('p');
    aviso.id = 'erro-perfil';
    aviso.setAttribute('role', 'alert');
    document.querySelector('main')?.prepend(aviso);
  }
  aviso.textContent = erro.message;
}

document.addEventListener('DOMContentLoaded', async () => {
  const perfil = await sessaoPronta;
  if (!perfil) return;
  const campos = {
    'boas-vindas-usuario': `Olá, ${perfil.nome || 'visitante'}.`,
    'user-nome': perfil.nome || 'Visitante',
    'user-email': perfil.email || 'Compra sem conta',
    'user-fone': perfil.telefone || 'Não informado'
  };
  for (const [id, valor] of Object.entries(campos)) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  }
  if (perfil.visitanteNovo) {
    const atuais = document.getElementById('pedidos-em-andamento');
    const historico = document.getElementById('meus-pedidos');
    if (atuais) preencherLista(atuais, [], 'Finalize uma compra para acompanhar seus pedidos neste navegador.');
    if (historico) preencherLista(historico, [], 'Você ainda não fez nenhum pedido.');
    return;
  }
  if (document.getElementById('meus-pedidos') && document.getElementById('pedidos-em-andamento')) {
    mostrarCarregando();
    const atualizar = () => carregarPedidos().catch(erro => { mostrarErro(erro); mostrarFalhaPedidos(); });
    await atualizar();
    window.setInterval(atualizar, 30000);
  }
});
