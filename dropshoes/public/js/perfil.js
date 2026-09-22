const API_URL = window.location.origin;
const token = localStorage.getItem('token');
const dinheiro = valor => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
const STATUS = {
  pendente: ['Restaurante visualizando seu pedido', 'Seu pedido foi enviado e aguarda a confirmação do restaurante.'],
  aceito: ['Pedido aceito pelo restaurante', 'A cozinha recebeu seu pedido.'],
  em_preparo: ['Pedido em preparo', 'Estamos preparando sua delícia com carinho.'],
  pronto_entrega: ['Pedido pronto / em entrega', 'Seu pedido está a caminho. Confirme quando receber.'],
  recebido: ['Pedido recebido', 'Obrigada pela preferência!'],
  cancelado: ['Pedido cancelado', 'Se precisar, fale com o restaurante pelo WhatsApp.']
};
async function api(url, opcoes = {}) { const resposta = await fetch(`${API_URL}${url}`, { ...opcoes, headers: { Authorization: `Bearer ${token}`, ...(opcoes.headers || {}) } }); const dados = await resposta.json().catch(() => ({})); if (!resposta.ok) throw new Error(dados.erro || 'Não foi possível atualizar o pedido.'); return dados; }
async function confirmarRecebimento(id) { try { await api(`/api/pedidos/${id}/confirmar-recebimento`, { method: 'POST' }); carregarPedidos(); } catch (erro) { alert(erro.message); } }
async function carregarPedidos() {
  const corpo = document.getElementById('meus-pedidos'); if (!corpo) return;
  const pedidos = await api('/api/meus-pedidos'); corpo.innerHTML = '';
  if (!pedidos.length) corpo.innerHTML = '<tr><td colspan="4">Você ainda não fez pedidos.</td></tr>';
  pedidos.forEach(pedido => {
    const [titulo, descricao] = STATUS[pedido.status] || STATUS.pendente; const linha = document.createElement('tr'); linha.className = `linha-pedido status-${pedido.status}`;
    const id = document.createElement('td'); id.textContent = `#${pedido.id}`;
    const data = document.createElement('td'); data.textContent = new Date(pedido.data_criacao || Date.now()).toLocaleDateString('pt-BR');
    const situacao = document.createElement('td'); const selo = document.createElement('span'); selo.className = `status-pedido status-${pedido.status}`; selo.textContent = titulo; situacao.append(selo); const detalhe = document.createElement('small'); detalhe.className = 'status-detalhe'; detalhe.textContent = descricao; situacao.append(detalhe);
    if (pedido.status === 'pronto_entrega') { const botao = document.createElement('button'); botao.className = 'btn btn-recebido'; botao.textContent = 'Confirmar que recebi'; botao.onclick = () => confirmarRecebimento(pedido.id); situacao.append(botao); }
    const total = document.createElement('td'); total.textContent = dinheiro(pedido.valor); linha.append(id, data, situacao, total); corpo.append(linha);
  });
}
document.addEventListener('DOMContentLoaded', async () => {
  if (!token) return window.location.assign('../tela de login/login cliente.html');
  try { const { perfil } = await api('/api/meu-perfil'); document.getElementById('boas-vindas-usuario').textContent = `Olá, ${perfil.nome}. Acompanhe seus pedidos aqui.`; document.getElementById('user-nome').textContent = perfil.nome; document.getElementById('user-email').textContent = perfil.email; document.getElementById('user-fone').textContent = perfil.telefone || 'Não informado'; await carregarPedidos(); window.setInterval(carregarPedidos, 30000); } catch { localStorage.clear(); window.location.assign('../tela de login/login cliente.html'); }
});
