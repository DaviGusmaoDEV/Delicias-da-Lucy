function calcularValorEntrega(metros, precoKm, modo = 'excedente') {
  if (!Number.isFinite(metros) || metros < 0) throw new Error('Distância de entrega inválida.');
  if (metros <= 2000) return 0;
  if (!Number.isFinite(precoKm) || precoKm <= 0 || !['excedente', 'total'].includes(modo)) throw new Error('Taxa por quilômetro ainda não configurada pela loja.');
  const cobrados = modo === 'total' ? metros : metros - 2000;
  return Math.round(cobrados / 1000 * precoKm * 100) / 100;
}
function coordenadas(lon, lat) {
  if (lon == null || lat == null || String(lon).trim() === '' || String(lat).trim() === '') return null;
  const longitude = Number(lon), latitude = Number(lat);
  return Number.isFinite(longitude) && Math.abs(longitude) <= 180 && Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? [longitude, latitude] : null;
}
function criarEntrega({ consultar = fetch, origem = coordenadas(process.env.STORE_LONGITUDE, process.env.STORE_LATITUDE), precoKm = Number(process.env.DELIVERY_PRICE_PER_KM), modo = process.env.DELIVERY_CHARGE_MODE || 'excedente', roteador = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org', cidade = 'Ribeirão Preto', uf = 'SP' } = {}) {
  const cache = new Map();
  async function json(url) {
    try {
      const resposta = await consultar(url, { signal: AbortSignal.timeout(8000) });
      if (!resposta.ok) throw new Error();
      return await resposta.json();
    } catch { throw new Error('Não foi possível calcular a entrega. Tente novamente.'); }
  }
  return async cep => {
    const numero = String(cep || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(numero)) throw new Error('Informe um CEP com 8 números.');
    if (!origem || !coordenadas(...origem)) throw new Error('O ponto de saída da loja ainda não foi configurado.');
    const salvo = cache.get(numero);
    if (salvo && salvo.ate > Date.now()) return salvo.dados;
    const endereco = await json(`https://brasilapi.com.br/api/cep/v2/${numero}`);
    if (endereco.errors || !endereco.city) throw new Error('CEP não encontrado. Confira os números.');
    if (endereco.city !== cidade || endereco.state !== uf) throw new Error(`No momento entregamos apenas em ${cidade} / ${uf}.`);
    const destino = coordenadas(endereco.location?.coordinates?.longitude, endereco.location?.coordinates?.latitude);
    if (!destino) throw new Error('Este CEP não possui localização para calcular a entrega. Consulte a loja.');
    const rota = await json(`${roteador.replace(/\/$/, '')}/route/v1/driving/${origem.join(',')};${destino.join(',')}?overview=false&steps=false`);
    if (rota.code !== 'Ok' || !rota.routes?.length) throw new Error('Não foi encontrado um trajeto para este CEP.');
    const metros = rota.routes[0].distance;
    const dados = { cep: numero, taxa: calcularValorEntrega(metros, precoKm, modo), distancia_km: metros / 1000, gratis_ate_km: 2, cidade: endereco.city, uf: endereco.state, endereco: endereco.street || '', bairro: endereco.neighborhood || '', aproximado: true };
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(numero, { dados, ate: Date.now() + 15 * 60 * 1000 });
    return dados;
  };
}
module.exports = { criarEntrega, calcularValorEntrega };
