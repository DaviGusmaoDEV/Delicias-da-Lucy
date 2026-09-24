// Entrada para a Vercel: o servidor local continua sendo iniciado por server.js.
// A Vercel detecta este arquivo e executa o Express como uma Function.
const { criarApp } = require('./server');

module.exports = criarApp();
