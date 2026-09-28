// Limite por processo. Em múltiplas instâncias, aplicar também no proxy compartilhado.
function limitarAutenticacao({ maximo = 30, janela = 15 * 60 * 1000, agora = Date.now } = {}) {
  const tentativas = new Map();
  let proximaLimpeza = 0;
  return (req, res, next) => {
    const instante = agora();
    // Evita percorrer toda a tabela de IPs a cada requisição sob tráfego alto.
    // A retenção extra é limitada a um minuto (ou à própria janela, se menor).
    if (instante >= proximaLimpeza) {
      for (const [ip, registro] of tentativas) if (registro.ate <= instante) tentativas.delete(ip);
      proximaLimpeza = instante + Math.min(janela, 60 * 1000);
    }
    const chave = req.ip;
    let registro = tentativas.get(chave);
    if (!registro) {
      if (tentativas.size >= 10000) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde e tente novamente.' });
      registro = { total: 0, ate: instante + janela }; tentativas.set(chave, registro);
    }
    if (++registro.total > maximo) {
      res.set('Retry-After', String(Math.ceil((registro.ate - instante) / 1000)));
      return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });
    }
    next();
  };
}
module.exports = { limitarAutenticacao };
