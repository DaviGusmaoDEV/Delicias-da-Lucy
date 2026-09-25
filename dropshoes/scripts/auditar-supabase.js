// Somente leitura. Nunca imprime registros, credenciais ou conteúdo de senhas.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname,'../.env') });
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !chave) throw new Error('Configure SUPABASE_URL e SUPABASE_ANON_KEY para o teste público.');
  const db = createClient(url,chave,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const tabela of ['profiles','products','pedidos','itens_pedido','fluxo_caixa','clientes_visitantes']) {
    const {error,status,count}=await db.from(tabela).select('id',{head:true,count:'exact'});
    console.log(JSON.stringify({tabela,status,codigo:error?.code || null,linhasVisiveis:typeof count==='number'?count>0:null}));
    if(count>0) process.exitCode=1;
  }
})().catch(() => { console.error('Não foi possível concluir a auditoria. Verifique a configuração e a conexão.'); process.exitCode=1; });
