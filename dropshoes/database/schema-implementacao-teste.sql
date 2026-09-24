-- Delícias da Lucy: execute TODO este arquivo uma vez no SQL Editor do Supabase.
-- É idempotente: pode ser executado novamente sem duplicar colunas, índices ou receitas.
begin;

-- Dados necessários para endereço, frete, checkout e ciclo do pedido.
alter table public.pedidos add column if not exists subtotal numeric(10,2);
alter table public.pedidos add column if not exists taxa_entrega numeric(10,2) not null default 0;
alter table public.pedidos add column if not exists endereco text;
alter table public.pedidos add column if not exists numero_casa text;
alter table public.pedidos add column if not exists bairro text;
alter table public.pedidos add column if not exists cep varchar(8);
alter table public.pedidos add column if not exists pagamento varchar(30) not null default 'a_combinar';
alter table public.pedidos add column if not exists pronto_em timestamptz;
alter table public.pedidos add column if not exists recebido_em timestamptz;
alter table public.pedidos add column if not exists pagamento_status text not null default 'pending';
alter table public.pedidos add column if not exists pagamento_id text;
alter table public.pedidos add column if not exists pagamento_atualizado timestamptz;
alter table public.pedidos add column if not exists pago_em timestamptz;
alter table public.pedidos add column if not exists payment_url text;
alter table public.pedidos add column if not exists checkout_chave uuid;

update public.pedidos set status = 'aceito' where status = 'confirmado';
update public.pedidos set status = 'pronto_entrega' where status = 'saiu_para_entrega';
update public.pedidos set status = 'recebido' where status = 'entregue';

-- Produto e perfil usados pelas telas atuais.
alter table public.profiles add column if not exists telefone varchar(30);
alter table public.profiles alter column role set default 'cliente';
alter table public.products add column if not exists categoria varchar(80);
alter table public.products add column if not exists descricao text;
alter table public.products add column if not exists imagem_url text;
alter table public.products add column if not exists "isEspecial" boolean not null default false;
alter table public.products alter column nome set not null;

-- Clientes que compram sem conta.
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

-- Caixa: receitas de pagamentos aprovados são inseridas automaticamente.
create table if not exists public.fluxo_caixa (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  tipo text not null check (tipo in ('receita', 'despesa', 'total-despesa-funcionario')),
  valor numeric(10,2) not null check (valor > 0),
  data date not null
);
alter table public.fluxo_caixa add column if not exists pedido_id text;

create index if not exists pedidos_visitante_idx on public.pedidos(visitante_id);
create unique index if not exists pedidos_checkout_chave_unique on public.pedidos(checkout_chave);
create unique index if not exists pedidos_pagamento_id_unique on public.pedidos(pagamento_id);
create unique index if not exists fluxo_caixa_pedido_tipo_unique on public.fluxo_caixa(pedido_id, tipo);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_um_comprador' and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_um_comprador check (num_nonnulls(usuario_id, visitante_id) = 1) not valid;
  end if;
end $$;

-- A API do servidor é a única forma de acessar os dados privados.
do $$
declare tabela text; sequencia text;
begin
  foreach tabela in array array['profiles','clientes_visitantes','products','pedidos','itens_pedido','fluxo_caixa'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on table public.%I to service_role', tabela);
    sequencia := pg_get_serial_sequence(format('public.%I', tabela), 'id');
    if sequencia is not null then
      execute format('revoke all privileges on sequence %s from public, anon, authenticated', sequencia);
      execute format('grant usage, select on sequence %s to service_role', sequencia);
    end if;
  end loop;
end $$;

-- Cria pedido e itens juntos para não haver pedido sem produto.
create or replace function public.criar_pedido_com_itens(p_pedido jsonb, p_itens jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare novo public.pedidos%rowtype; entrada public.pedidos%rowtype;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object' or jsonb_typeof(p_itens) is distinct from 'array'
     or jsonb_array_length(p_itens) not between 1 and 100 then
    raise exception 'Pedido ou itens inválidos';
  end if;
  entrada := jsonb_populate_record(null::public.pedidos, p_pedido);
  if entrada.checkout_chave is null or num_nonnulls(entrada.usuario_id, entrada.visitante_id) <> 1 then
    raise exception 'Comprador ou chave inválidos';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(entrada.checkout_chave::text, 0));
  select * into novo from public.pedidos where checkout_chave = entrada.checkout_chave;
  if found then return to_jsonb(novo); end if;
  if exists (select 1 from jsonb_populate_recordset(null::public.itens_pedido, p_itens) i where i.produto_id is null or i.quantidade not between 1 and 50 or i.preco_unitario is null or i.preco_unitario <= 0) then
    raise exception 'Item inválido';
  end if;
  insert into public.pedidos(usuario_id, visitante_id, cliente_nome, cliente_telefone, valor, subtotal, taxa_entrega, status, observacao_geral, endereco, numero_casa, bairro, cep, pagamento, checkout_chave, pagamento_status)
  values(entrada.usuario_id, entrada.visitante_id, entrada.cliente_nome, entrada.cliente_telefone, entrada.valor, entrada.subtotal, entrada.taxa_entrega, 'pendente', entrada.observacao_geral, entrada.endereco, entrada.numero_casa, entrada.bairro, entrada.cep, 'site', entrada.checkout_chave, 'pending')
  returning * into novo;
  insert into public.itens_pedido(pedido_id, produto_id, quantidade, preco_unitario, observacao_item)
  select novo.id, i.produto_id, i.quantidade, i.preco_unitario, i.observacao_item from jsonb_populate_recordset(null::public.itens_pedido, p_itens) i;
  return to_jsonb(novo);
end;
$$;

-- Confirma o pagamento e cria uma única entrada no caixa, mesmo com webhook repetido.
create or replace function public.registrar_pagamento_pedido(p_pedido_id text, p_pagamento_id text, p_status text, p_valor numeric, p_estornado numeric, p_atualizado timestamptz, p_aprovado timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare pedido public.pedidos%rowtype; dia date;
begin
  select * into pedido from public.pedidos where id::text = p_pedido_id for update;
  if not found or pedido.pagamento <> 'site' then raise exception 'Pedido inválido'; end if;
  if p_valor is null or p_valor <> pedido.valor or p_valor <= 0 or p_atualizado is null or p_estornado is null or p_estornado < 0 or p_estornado > p_valor then raise exception 'Valor ou data inválidos'; end if;
  if p_status not in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back','in_mediation') then raise exception 'Status inválido'; end if;
  if pedido.pagamento_id is not null and pedido.pagamento_id <> p_pagamento_id and pedido.pago_em is not null then return; end if;
  if pedido.pagamento_atualizado is not null and pedido.pagamento_atualizado > p_atualizado then return; end if;
  update public.pedidos set pagamento_status = p_status, pagamento_id = p_pagamento_id, pagamento_atualizado = p_atualizado, pago_em = case when p_status in ('approved','refunded','charged_back') then coalesce(pago_em,p_aprovado,p_atualizado) else pago_em end where id = pedido.id;
  if p_status in ('approved','refunded','charged_back') then
    dia := (coalesce(p_aprovado,p_atualizado) at time zone 'America/Sao_Paulo')::date;
    insert into public.fluxo_caixa(descricao,tipo,valor,data,pedido_id)
    values ('Pedido #' || p_pedido_id || ' — ' || case when p_pagamento_id like 'infinitepay:%' then 'InfinitePay' else 'Mercado Pago' end, 'receita', p_valor, dia, p_pedido_id)
    on conflict (pedido_id,tipo) do nothing;
    if p_status in ('refunded','charged_back') and p_estornado > 0 then
      insert into public.fluxo_caixa(descricao,tipo,valor,data,pedido_id) values ('Estorno do pedido #' || p_pedido_id, 'despesa', p_estornado, (p_atualizado at time zone 'America/Sao_Paulo')::date, p_pedido_id)
      on conflict (pedido_id,tipo) do update set valor = greatest(fluxo_caixa.valor, excluded.valor);
    end if;
  end if;
end;
$$;

revoke all privileges on function public.criar_pedido_com_itens(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_com_itens(jsonb,jsonb) to service_role;
revoke all on function public.registrar_pagamento_pedido(text,text,text,numeric,numeric,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_pagamento_pedido(text,text,text,numeric,numeric,timestamptz,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
