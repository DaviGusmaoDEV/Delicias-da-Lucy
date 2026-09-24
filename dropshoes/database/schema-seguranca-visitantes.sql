-- Executar após as migrações existentes de pedidos/pagamentos.
begin;
create table if not exists public.clientes_visitantes (
  id uuid primary key default gen_random_uuid(),
  nome varchar(100) not null check (length(btrim(nome)) between 2 and 100),
  telefone varchar(13) not null check (telefone ~ '^[0-9]{10,13}$'),
  cep varchar(8) not null check (cep ~ '^[0-9]{8}$'),
  criado_em timestamptz not null default now()
);
alter table public.pedidos alter column usuario_id drop not null;
alter table public.pedidos add column if not exists visitante_id uuid references public.clientes_visitantes(id);
alter table public.pedidos add column if not exists cliente_nome varchar(100);
alter table public.pedidos add column if not exists cliente_telefone varchar(13);
create index if not exists pedidos_visitante_idx on public.pedidos(visitante_id);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='pedidos_um_comprador' and conrelid='public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_um_comprador check(num_nonnulls(usuario_id,visitante_id)=1) not valid;
  end if;
end $$;
-- Dados privados acessíveis somente pelo backend, que verifica a sessão e o cargo.
do $$
declare tabela text; sequencia text;
begin
  foreach tabela in array array['profiles','clientes_visitantes','products','pedidos','itens_pedido','fluxo_caixa'] loop
    execute format('alter table public.%I enable row level security',tabela);
    execute format('revoke all privileges on table public.%I from public,anon,authenticated',tabela);
    execute format('grant select,insert,update,delete on table public.%I to service_role',tabela);
    sequencia := pg_get_serial_sequence(format('public.%I',tabela),'id');
    if sequencia is not null then
      execute format('revoke all privileges on sequence %s from public,anon,authenticated',sequencia);
      execute format('grant usage,select on sequence %s to service_role',sequencia);
    end if;
  end loop;
end $$;
-- Pedido e itens são gravados juntos: qualquer falha desfaz a operação inteira.
-- Somente o backend pode chamar esta função; preço e comprador vêm da API validada.
create or replace function public.criar_pedido_com_itens(p_pedido jsonb, p_itens jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  novo public.pedidos%rowtype;
  entrada public.pedidos%rowtype;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object'
     or jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'Pedido inválido';
  end if;
  if jsonb_array_length(p_itens) not between 1 and 100 then
    raise exception 'Itens inválidos';
  end if;
  entrada := jsonb_populate_record(null::public.pedidos, p_pedido);
  if entrada.checkout_chave is null or num_nonnulls(entrada.usuario_id, entrada.visitante_id) <> 1 then
    raise exception 'Comprador ou chave inválidos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(entrada.checkout_chave::text, 0));
  select * into novo from public.pedidos where checkout_chave = entrada.checkout_chave;
  if found then
    if novo.usuario_id is distinct from entrada.usuario_id
       or novo.visitante_id is distinct from entrada.visitante_id then
      raise exception 'Chave indisponível';
    end if;
    return to_jsonb(novo);
  end if;
  if exists (
    select 1 from jsonb_populate_recordset(null::public.itens_pedido, p_itens) i
    where i.produto_id is null or i.quantidade is null or i.quantidade not between 1 and 50
       or i.preco_unitario is null or i.preco_unitario <= 0
  ) then raise exception 'Item inválido'; end if;
  insert into public.pedidos (
    usuario_id, visitante_id, cliente_nome, cliente_telefone, valor, subtotal,
    taxa_entrega, status, observacao_geral, endereco, numero_casa, bairro, cep,
    pagamento, checkout_chave, pagamento_status
  ) values (
    entrada.usuario_id, entrada.visitante_id, entrada.cliente_nome, entrada.cliente_telefone,
    entrada.valor, entrada.subtotal, entrada.taxa_entrega, 'pendente',
    entrada.observacao_geral, entrada.endereco, entrada.numero_casa, entrada.bairro,
    entrada.cep, 'site', entrada.checkout_chave, 'pending'
  ) returning * into novo;
  insert into public.itens_pedido (pedido_id, produto_id, quantidade, preco_unitario, observacao_item)
    select novo.id, i.produto_id, i.quantidade, i.preco_unitario, i.observacao_item
    from jsonb_populate_recordset(null::public.itens_pedido, p_itens) i;
  return to_jsonb(novo);
end;
$$;
revoke all privileges on function public.criar_pedido_com_itens(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.criar_pedido_com_itens(jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
