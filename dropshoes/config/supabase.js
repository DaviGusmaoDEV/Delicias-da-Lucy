const { createClient } = require('@supabase/supabase-js');

function criarClienteSupabase() {
  // A chave secreta/service-role é obrigatória para as operações administrativas
  // de login, cadastro e pedidos. Os nomes públicos ficam como fallback para
  // ambientes que ainda usam a nomenclatura do painel/Next.js.
  const chave = process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const urlNormalizada = typeof url === 'string' ? url.trim() : '';
  const chaveNormalizada = typeof chave === 'string' ? chave.trim() : '';
  if (!urlNormalizada || !chaveNormalizada) return null;
  try {
    return createClient(urlNormalizada, chaveNormalizada, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch (erro) {
    // Uma variável vazia ou inválida não pode derrubar a Function inteira.
    console.error('[supabase] Configuração inválida:', erro?.message || 'cliente indisponível');
    return null;
  }
}
module.exports = { criarClienteSupabase };
