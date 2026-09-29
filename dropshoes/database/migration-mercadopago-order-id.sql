-- Migração aditiva: vincula a Order da Orders API ao pedido existente.
-- Aplicar no Supabase antes de publicar o código que grava pagamento_order_id.
begin;
alter table public.pedidos add column if not exists pagamento_order_id text;
create unique index if not exists pedidos_pagamento_order_id_unique
  on public.pedidos(pagamento_order_id);
notify pgrst, 'reload schema';
commit;
