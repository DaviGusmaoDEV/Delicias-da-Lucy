const { createClient } = require('@supabase/supabase-js');

function criarClienteSupabase() {
  const chave = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.SUPABASE_URL || !chave) return null;
  return createClient(process.env.SUPABASE_URL, chave, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
module.exports = { criarClienteSupabase };
