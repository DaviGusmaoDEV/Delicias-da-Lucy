-- Executar após schema-pedidos.sql e schema-autenticacao.sql.
begin;
create table if not exists public.fluxo_caixa (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  tipo text not null check (tipo in ('receita', 'despesa', 'total-despesa-funcionario')),
  valor numeric(10,2) not null check (valor > 0),
  data date not null
);

-- Todas as operações dessas tabelas passam pelas permissões da API Express.
-- Evita contornar autenticação e permissões pela API pública do Supabase.
do $$
declare tabela text; sequencia text;
begin
  foreach tabela in array array['profiles', 'products', 'pedidos', 'itens_pedido', 'fluxo_caixa'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on table public.%I to service_role', tabela);
    sequencia := null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = tabela and column_name = 'id') then
      sequencia := pg_get_serial_sequence(format('public.%I', tabela), 'id');
    end if;
    if sequencia is not null then
      execute format('grant usage, select on sequence %s to service_role', sequencia);
    end if;
  end loop;
end $$;
commit;
