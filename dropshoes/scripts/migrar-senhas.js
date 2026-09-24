// Verifica senhas legadas sem exibi-las. --aplicar converte para scrypt,
// preservando a senha usada pelo cliente e sem sobrescrever alterações concorrentes.
const path = require('node:path');
require('dotenv').config({path:path.join(__dirname,'../.env')});
const { criarClienteSupabase } = require('../config/supabase');
const { hashSenha } = require('../config/autenticacao');
(async () => {
  const db = criarClienteSupabase(); if(!db) throw new Error('configuracao');
  const aplicar = process.argv.includes('--aplicar'); let legadas=0, convertidas=0, invalidas=0;
  for(let inicio=0;;inicio+=100) {
    const {data,error}=await db.from('profiles').select('id,senha').order('id').range(inicio,inicio+99);
    if(error) throw new Error('consulta');
    for(const perfil of data) {
      if(typeof perfil.senha !== 'string' || !perfil.senha) { invalidas++; continue; }
      if(perfil.senha.startsWith('scrypt$')) { if(!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(perfil.senha)) invalidas++; continue; }
      legadas++;
      if(aplicar) {
        const {data:atual,error:falha}=await db.from('profiles').update({senha:await hashSenha(perfil.senha)}).eq('id',perfil.id).eq('senha',perfil.senha).select('id').maybeSingle();
        if(falha) throw new Error('gravacao'); if(atual) convertidas++;
      }
    }
    if(data.length<100) break;
  }
  console.log(JSON.stringify({modo:aplicar?'aplicar':'somente-leitura',legadas,convertidas,invalidas}));
})().catch(() => { console.error('Verificação interrompida; nenhum dado sensível foi exibido.');process.exitCode=1; });
