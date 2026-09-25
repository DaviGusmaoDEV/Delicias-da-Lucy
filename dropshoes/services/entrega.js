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
function textoSeguro(valor, limite = 120) { return String(valor || '').trim().replace(/\s+/g, ' ').slice(0, limite); }
function criarEntrega({ consultar = fetch, origem = coordenadas(process.env.STORE_LONGITUDE, process.env.STORE_LATITUDE) || [-47.8211875, -21.1391875], precoKm = Number(process.env.DELIVERY_PRICE_PER_KM || 1.5), modo = process.env.DELIVERY_CHARGE_MODE || 'excedente', roteador = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org', geocodificador = process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org', cidade = 'Ribeirão Preto', uf = 'SP' } = {}) {
  const cache = new Map();
  const enderecos = new Map();
  async function json(url, opcoes = {}) {
    try {
      const resposta = await consultar(url, { signal: AbortSignal.timeout(8000), ...opcoes });
      if (!resposta.ok) throw new Error();
      return await resposta.json();
    } catch { throw new Error('Não foi possível calcular a entrega. Tente novamente.'); }
  }
  async function consultarEndereco(cep) {
    const numero = String(cep || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(numero)) throw new Error('Informe um CEP com 8 números.');
    const salvo = enderecos.get(numero);
    if (salvo && salvo.ate > Date.now()) return salvo.dados;
    const endereco = await json(`https://brasilapi.com.br/api/cep/v2/${numero}`);
    if (endereco.errors || !endereco.city) throw new Error('CEP não encontrado. Confira os números.');
    if (endereco.city !== cidade || endereco.state !== uf) throw new Error(`No momento entregamos apenas em ${cidade} / ${uf}.`);
    const dados = { cep: numero, cidade: endereco.city, uf: endereco.state, endereco: endereco.street || '', bairro: endereco.neighborhood || '' };
    if (enderecos.size >= 500) enderecos.delete(enderecos.keys().next().value);
    enderecos.set(numero, { dados, ate: Date.now() + 15 * 60 * 1000 });
    return dados;
  }
  const cotar = async (cep, enderecoInformado = {}) => {
    const numero = String(cep || '').replace(/\D/g, '');
    if (!/^\d{8}$/.test(numero)) throw new Error('Informe um CEP com 8 números.');
    if (!origem || !coordenadas(...origem)) throw new Error('O ponto de saída da loja ainda não foi configurado.');
    const enderecoCliente = String(enderecoInformado.endereco || '').trim().slice(0, 250);
    const bairroCliente = String(enderecoInformado.bairro || '').trim().slice(0, 250);
    const numeroCasa = String(enderecoInformado.numero_casa || '').trim().slice(0, 30);
    const chaveCache = `${numero}|${enderecoCliente.toLowerCase()}|${bairroCliente.toLowerCase()}|${numeroCasa.toLowerCase()}`;
    const salvo = cache.get(chaveCache);
    if (salvo && salvo.ate > Date.now()) return salvo.dados;
    const endereco = await consultarEndereco(numero);
    const rua = textoSeguro(enderecoCliente || endereco.endereco);
    const bairro = textoSeguro(bairroCliente || endereco.bairro);
    const localidade = textoSeguro(endereco.cidade || cidade);
    const estado = textoSeguro(endereco.uf || uf, 2);
    const estrategias = [
      { nome: 'rua_numero_bairro', partes: [rua, numeroCasa, bairro, localidade, estado, 'Brasil'] },
      { nome: 'rua_bairro', partes: [rua, bairro, localidade, estado, 'Brasil'] },
      { nome: 'cep_localidade', partes: [numero, localidade, estado, 'Brasil'] }
    ];
    let destino;
    let estrategiaUsada;
    for (const estrategia of estrategias) {
      const consulta = estrategia.partes.filter(Boolean).join(', ');
      try {
        const parametros = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br', addressdetails: '1', 'accept-language': 'pt-BR', q: consulta });
        const lugares = await json(`${geocodificador.replace(/\/$/, '')}/search?${parametros}`, { headers: { 'User-Agent': 'DeliciasDaLucy/1.0 (+https://dropshoes.social.br)', 'Accept-Language': 'pt-BR' } });
        const lugar = Array.isArray(lugares) ? lugares[0] : null;
        const coordenadasDestino = coordenadas(lugar?.lon, lugar?.lat);
        if (coordenadasDestino) { destino = coordenadasDestino; estrategiaUsada = estrategia.nome; break; }
        console.info(JSON.stringify({ evento: 'geocodificacao', resultado: 'sem_coordenadas', estrategia: estrategia.nome }));
      } catch (erro) {
        console.info(JSON.stringify({ evento: 'geocodificacao', resultado: 'falha_consulta', estrategia: estrategia.nome, codigo: String(erro.message || 'erro').slice(0, 40) }));
      }
    }
    if (!destino) {
      console.info(JSON.stringify({ evento: 'geocodificacao', resultado: 'falha_final', estrategias: estrategias.length }));
      throw new Error('Não foi possível localizar este endereço. Confira rua, número, bairro e CEP.');
    }
    console.info(JSON.stringify({ evento: 'geocodificacao', resultado: 'sucesso', estrategia: estrategiaUsada }));
    const rota = await json(`${roteador.replace(/\/$/, '')}/route/v1/driving/${origem.join(',')};${destino.join(',')}?overview=false&steps=false`);
    if (rota.code !== 'Ok' || !rota.routes?.length) throw new Error('Não foi encontrado um trajeto para este CEP.');
    const metros = rota.routes[0].distance;
    const dados = { cep: numero, taxa: calcularValorEntrega(metros, precoKm, modo), distancia_km: metros / 1000, gratis_ate_km: 2, cidade: endereco.cidade, uf: endereco.uf, endereco: endereco.endereco, bairro: endereco.bairro, aproximado: true };
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(chaveCache, { dados, ate: Date.now() + 15 * 60 * 1000 });
    return dados;
  };
  cotar.consultarEndereco = consultarEndereco;
  return cotar;
}
module.exports = { criarEntrega, calcularValorEntrega };
