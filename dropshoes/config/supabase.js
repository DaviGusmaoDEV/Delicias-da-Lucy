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
  if (!url || !chave) return null;
  return createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
module.exports = { criarClienteSupabase };
