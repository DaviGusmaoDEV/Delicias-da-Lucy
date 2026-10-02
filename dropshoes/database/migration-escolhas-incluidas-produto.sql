-- Escolhas incluídas no produto — NÃO EXECUTAR AUTOMATICAMENTE.
-- Aplicar somente após migration-taxas-adicionais.sql,
-- migration-pedido-adicionais-rpc.sql, migration-tipo-pagamento-entrega.sql
-- e migration-troco-pagamento-entrega.sql, com backup e revisão.
begin;

create table if not exists public.produto_grupos_escolha (
  id uuid primary key default gen_random_uuid(),
  produto_id bigint not null references public.products(id) on delete restrict,
  nome varchar(120) not null,
  min_escolhas integer not null default 0 check (min_escolhas >= 0),
  max_escolhas integer not null check (max_escolhas >= min_escolhas and max_escolhas > 0),
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint produto_grupos_escolha_nome_check check (length(btrim(nome)) between 1 and 120)
);

create table if not exists public.produto_opcoes_escolha (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid not null references public.produto_grupos_escolha(id) on delete cascade,
  nome varchar(120) not null,
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint produto_opcoes_escolha_nome_check check (length(btrim(nome)) between 1 and 120),
  constraint produto_opcoes_escolha_ordem_check check (ordem >= 0)
);

create index if not exists produto_grupos_escolha_produto_idx
  on public.produto_grupos_escolha(produto_id, ordem) where ativo;
create index if not exists produto_opcoes_escolha_grupo_idx
  on public.produto_opcoes_escolha(grupo_id, ordem) where ativo;
create unique index if not exists produto_grupos_escolha_nome_ativo_unique
  on public.produto_grupos_escolha(produto_id, lower(btrim(nome))) where ativo;
create unique index if not exists produto_opcoes_escolha_nome_ativo_unique
  on public.produto_opcoes_escolha(grupo_id, lower(btrim(nome))) where ativo;

alter table public.itens_pedido add column if not exists escolhas_snapshot jsonb;

do $$
declare tabela text;
begin
  foreach tabela in array array['produto_grupos_escolha','produto_opcoes_escolha'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on table public.%I to service_role', tabela);
  end loop;
end $$;

-- A RPC continua sendo a barreira final: valida snapshots de escolhas,
-- limites por grupo, produto, adicionais e totais dentro da mesma transação.
create or replace function public.criar_pedido_com_itens(p_pedido jsonb, p_itens jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  novo public.pedidos%rowtype;
  entrada public.pedidos%rowtype;
  item jsonb;
  item_persistido jsonb;
  escolha jsonb;
  adicional jsonb;
  produto public.products%rowtype;
  adicional_registro public.adicionais%rowtype;
  grupo public.produto_grupos_escolha%rowtype;
  opcao_id uuid;
  opcao_grupo_id uuid;
  opcao_nome text;
  grupo_id_informado uuid;
  grupo_nome text;
  opcao_encontrada boolean;
  forma_pagamento text;
  tipo_entrega text;
  troco_bruto numeric;
  quantidade integer;
  preco_base numeric(10,2);
  preco_adicionais numeric(10,2);
  preco_final numeric(10,2);
  subtotal_calculado numeric(10,2) := 0;
  subtotal_item numeric(10,2);
  adicionais_ids uuid[];
  escolhas_ids uuid[];
  escolhas_snapshot jsonb;
  itens_persistidos jsonb := '[]'::jsonb;
  produto_id_val public.products.id%TYPE;
  escolha_id uuid;
  escolhas_count integer;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object'
     or jsonb_typeof(p_itens) is distinct from 'array'
     or jsonb_array_length(p_itens) not between 1 and 100 then
    raise exception 'Pedido ou itens inválidos';
  end if;

  forma_pagamento := coalesce(nullif(p_pedido->>'pagamento', ''), 'site');
  tipo_entrega := nullif(p_pedido->>'tipo_pagamento_entrega', '');
  if forma_pagamento not in ('site', 'entrega') then raise exception 'Forma de pagamento inválida'; end if;
  if forma_pagamento = 'entrega' and tipo_entrega not in ('dinheiro', 'cartao') then
    raise exception 'Tipo de pagamento na entrega inválido';
  end if;
  entrada := jsonb_populate_record(null::public.pedidos,
    case when forma_pagamento = 'entrega' and tipo_entrega = 'dinheiro' then p_pedido else p_pedido - 'troco_para' end);
  forma_pagamento := coalesce(nullif(entrada.pagamento, ''), 'site');
  tipo_entrega := nullif(entrada.tipo_pagamento_entrega, '');
  if forma_pagamento <> 'entrega' or tipo_entrega <> 'dinheiro' then entrada.troco_para := null; end if;
  if forma_pagamento = 'entrega' and tipo_entrega = 'dinheiro'
     and p_pedido ? 'troco_para' and p_pedido->'troco_para' <> 'null'::jsonb then
    if jsonb_typeof(p_pedido->'troco_para') <> 'number' then raise exception 'Troco inválido'; end if;
    troco_bruto := (p_pedido->>'troco_para')::numeric;
    if troco_bruto::text = 'NaN' or troco_bruto <= 0 or troco_bruto > 99999999.99
       or troco_bruto <> round(troco_bruto, 2) then
      raise exception 'Troco inválido';
    end if;
  end if;
  if entrada.checkout_chave is null or num_nonnulls(entrada.usuario_id, entrada.visitante_id) <> 1 then
    raise exception 'Comprador ou chave inválidos';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(entrada.checkout_chave::text, 0));
  select * into novo from public.pedidos where checkout_chave = entrada.checkout_chave;
  if found then
    if novo.usuario_id is distinct from entrada.usuario_id or novo.visitante_id is distinct from entrada.visitante_id then
      raise exception 'Chave indisponível';
    end if;
    return to_jsonb(novo);
  end if;

  for item in select value from jsonb_array_elements(p_itens) loop
    if (item->>'produto_id') is null or (item->>'quantidade') is null then raise exception 'Item inválido'; end if;
    begin
      produto_id_val := (item->>'produto_id')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Produto inválido';
    end;
    quantidade := (item->>'quantidade')::integer;
    if quantidade not between 1 and 50 then raise exception 'Quantidade inválida'; end if;
    select * into produto from public.products where id = produto_id_val and ativo;
    if not found or produto.preco is null or produto.preco <= 0 then raise exception 'Produto inválido'; end if;

    preco_base := round(produto.preco::numeric, 2);
    if (item->>'preco_base_unitario')::numeric is distinct from preco_base then raise exception 'Preço de produto inválido'; end if;

    if jsonb_typeof(coalesce(item->'escolhas_ids', '[]'::jsonb)) is distinct from 'array' then
      raise exception 'Escolhas incluídas inválidas';
    end if;
    escolhas_ids := array[]::uuid[];
    escolhas_snapshot := '[]'::jsonb;
    for escolha in select value from jsonb_array_elements(coalesce(item->'escolhas_ids', '[]'::jsonb)) loop
      if jsonb_typeof(escolha) <> 'string' then raise exception 'Escolha incluída inválida'; end if;
      begin
        escolha_id := (escolha #>> '{}')::uuid;
        if escolhas_ids @> array[escolha_id] then raise exception 'Escolha incluída duplicada'; end if;
        escolhas_ids := array_append(escolhas_ids, escolha_id);
        -- A existência, estado e pertencimento são verificados em uma única
        -- operação. FOUND é testado imediatamente após essa operação.
        select o.id, o.grupo_id, o.nome, g.id, g.nome
          into opcao_id, opcao_grupo_id, opcao_nome, grupo_id_informado, grupo_nome
          from public.produto_opcoes_escolha o
          join public.produto_grupos_escolha g on g.id = o.grupo_id
         where o.id = escolha_id
           and o.ativo
           and g.produto_id = produto.id
           and g.ativo;
        opcao_encontrada := found;
      exception when invalid_text_representation then
        raise exception 'Escolha incluída inválida';
      end;
      if not opcao_encontrada or opcao_id is null or opcao_grupo_id is distinct from grupo_id_informado then
        raise exception 'Escolha incluída não permitida';
      end if;
      escolhas_snapshot := escolhas_snapshot || jsonb_build_array(jsonb_build_object(
        'id', opcao_id,
        'grupo_id', opcao_grupo_id,
        'nome', opcao_nome,
        'grupo_nome', grupo_nome));
    end loop;
    for grupo in select * from public.produto_grupos_escolha where produto_id = produto.id and ativo loop
      select count(*) into escolhas_count from jsonb_array_elements(escolhas_snapshot) e
        where e->>'grupo_id' = grupo.id::text;
      if escolhas_count < grupo.min_escolhas or escolhas_count > grupo.max_escolhas then
        raise exception 'Quantidade de escolhas inválida';
      end if;
    end loop;

    preco_adicionais := 0;
    adicionais_ids := array[]::uuid[];
    for adicional in select value from jsonb_array_elements(coalesce(item->'adicionais_snapshot', '[]'::jsonb)) loop
      if (adicional->>'id') is null then raise exception 'Adicional inválido'; end if;
      if adicionais_ids @> array[(adicional->>'id')::uuid] then raise exception 'Adicional duplicado'; end if;
      adicionais_ids := array_append(adicionais_ids, (adicional->>'id')::uuid);
      select a.* into adicional_registro from public.adicionais a
      join public.produto_adicionais pa on pa.adicional_id = a.id
      where a.id = (adicional->>'id')::uuid and a.ativo and pa.produto_id = produto.id and pa.ativo;
      if not found then raise exception 'Adicional não permitido'; end if;
      if (adicional->>'nome') is distinct from adicional_registro.nome
         or (adicional->>'preco')::numeric is distinct from round(adicional_registro.preco::numeric, 2) then
        raise exception 'Snapshot de adicional inválido';
      end if;
      preco_adicionais := preco_adicionais + round(adicional_registro.preco::numeric, 2);
    end loop;
    if (item->>'preco_adicionais_unitario')::numeric is distinct from preco_adicionais then raise exception 'Preço de adicionais inválido'; end if;
    preco_final := preco_base + preco_adicionais;
    if (item->>'preco_unitario')::numeric is distinct from preco_final then raise exception 'Preço unitário inválido'; end if;
    subtotal_item := preco_final * quantidade;
    if (item->>'produto_nome_snapshot') is distinct from left(produto.nome, 150) then raise exception 'Snapshot de produto inválido'; end if;
    subtotal_calculado := subtotal_calculado + subtotal_item;
    item_persistido := item || jsonb_build_object('escolhas_snapshot', escolhas_snapshot);
    itens_persistidos := itens_persistidos || jsonb_build_array(item_persistido);
  end loop;

  if entrada.subtotal is distinct from subtotal_calculado
     or entrada.valor is distinct from round(subtotal_calculado + coalesce(entrada.taxa_entrega, 0), 2)
     or coalesce(entrada.taxa_entrega, 0) < 0 then
    raise exception 'Total do pedido inválido';
  end if;

  -- numero_pedido continua fora da lista: o default da coluna usa a
  -- sequence comercial existente e o RETURNING * preserva esse valor.
  insert into public.pedidos (
    usuario_id, visitante_id, cliente_nome, cliente_telefone, cliente_email, valor, subtotal,
    taxa_entrega, status, observacao_geral, endereco, numero_casa, bairro, cep,
    pagamento, tipo_pagamento_entrega, troco_para, checkout_chave, pagamento_status
  ) values (
    entrada.usuario_id, entrada.visitante_id, entrada.cliente_nome, entrada.cliente_telefone, entrada.cliente_email,
    entrada.valor, entrada.subtotal, entrada.taxa_entrega, 'pendente', entrada.observacao_geral,
    entrada.endereco, entrada.numero_casa, entrada.bairro, entrada.cep, forma_pagamento, tipo_entrega,
    entrada.troco_para, entrada.checkout_chave, 'pending'
  ) returning * into novo;

  insert into public.itens_pedido (
    pedido_id, produto_id, quantidade, produto_nome_snapshot, preco_base_unitario,
    escolhas_snapshot, adicionais_snapshot, preco_adicionais_unitario, preco_unitario, observacao_item
  )
  select novo.id, (item_row->>'produto_id')::bigint, (item_row->>'quantidade')::integer,
    item_row->>'produto_nome_snapshot', (item_row->>'preco_base_unitario')::numeric,
    item_row->'escolhas_snapshot', item_row->'adicionais_snapshot', (item_row->>'preco_adicionais_unitario')::numeric,
    (item_row->>'preco_unitario')::numeric, left(coalesce(item_row->>'observacao_item', ''), 300)
  from jsonb_array_elements(itens_persistidos) as item_row;
  return to_jsonb(novo);
end;
$$;

revoke all privileges on function public.criar_pedido_com_itens(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_com_itens(jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
