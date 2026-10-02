-- Pagamento na entrega: registra somente a intenção operacional do cliente.
-- NÃO executar automaticamente. Aplicar no Supabase antes de publicar o backend.
begin;

alter table public.pedidos
  add column if not exists tipo_pagamento_entrega varchar(20);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pedidos_tipo_pagamento_entrega_check' and conrelid = 'public.pedidos'::regclass) then
    alter table public.pedidos add constraint pedidos_tipo_pagamento_entrega_check
      check (tipo_pagamento_entrega is null or tipo_pagamento_entrega in ('dinheiro', 'cartao')) not valid;
  end if;
end $$;

-- A coluna é nullable para preservar pedidos históricos de entrega sem essa informação.
-- A API exige o valor para todo pedido novo com pagamento = entrega e normaliza online para NULL.
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
  adicional jsonb;
  produto public.products%rowtype;
  adicional_registro public.adicionais%rowtype;
  forma_pagamento text;
  tipo_entrega text;
  quantidade integer;
  preco_base numeric(10,2);
  preco_adicionais numeric(10,2);
  preco_final numeric(10,2);
  subtotal_calculado numeric(10,2) := 0;
  subtotal_item numeric(10,2);
  adicionais_ids uuid[];
  produto_id_val public.products.id%TYPE;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object'
     or jsonb_typeof(p_itens) is distinct from 'array'
     or jsonb_array_length(p_itens) not between 1 and 100 then
    raise exception 'Pedido ou itens inválidos';
  end if;

  entrada := jsonb_populate_record(null::public.pedidos, p_pedido);
  forma_pagamento := coalesce(nullif(entrada.pagamento, ''), 'site');
  tipo_entrega := nullif(entrada.tipo_pagamento_entrega, '');
  if forma_pagamento not in ('site', 'entrega') then raise exception 'Forma de pagamento inválida'; end if;
  if forma_pagamento = 'entrega' and tipo_entrega not in ('dinheiro', 'cartao') then
    raise exception 'Tipo de pagamento na entrega inválido';
  end if;
  if forma_pagamento <> 'entrega' then tipo_entrega := null; end if;
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
    begin produto_id_val := (item->>'produto_id')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Produto inválido'; end;
    quantidade := (item->>'quantidade')::integer;
    if quantidade not between 1 and 50 then raise exception 'Quantidade inválida'; end if;
    select * into produto from public.products where id = produto_id_val;
    if not found or produto.preco is null or produto.preco <= 0 then raise exception 'Produto inválido'; end if;
    preco_base := round(produto.preco::numeric, 2);
    if (item->>'preco_base_unitario')::numeric is distinct from preco_base then raise exception 'Preço de produto inválido'; end if;
    preco_adicionais := 0;
    adicionais_ids := array[]::uuid[];
    for adicional in select value from jsonb_array_elements(coalesce(item->'adicionais_snapshot', '[]'::jsonb)) loop
      if (adicional->>'id') is null then raise exception 'Adicional inválido'; end if;
      if adicionais_ids @> array[(adicional->>'id')::uuid] then raise exception 'Adicional duplicado'; end if;
      adicionais_ids := array_append(adicionais_ids, (adicional->>'id')::uuid);
      select a.* into adicional_registro from public.adicionais a join public.produto_adicionais pa on pa.adicional_id = a.id
        where a.id = (adicional->>'id')::uuid and a.ativo and pa.produto_id = produto.id and pa.ativo;
      if not found then raise exception 'Adicional não permitido'; end if;
      if (adicional->>'nome') is distinct from adicional_registro.nome or (adicional->>'preco')::numeric is distinct from round(adicional_registro.preco::numeric, 2) then raise exception 'Snapshot de adicional inválido'; end if;
      preco_adicionais := preco_adicionais + round(adicional_registro.preco::numeric, 2);
    end loop;
    if (item->>'preco_adicionais_unitario')::numeric is distinct from preco_adicionais then raise exception 'Preço de adicionais inválido'; end if;
    preco_final := preco_base + preco_adicionais;
    if (item->>'preco_unitario')::numeric is distinct from preco_final then raise exception 'Preço unitário inválido'; end if;
    subtotal_item := preco_final * quantidade;
    if (item->>'produto_nome_snapshot') is distinct from left(produto.nome, 150) then raise exception 'Snapshot de produto inválido'; end if;
    subtotal_calculado := subtotal_calculado + subtotal_item;
  end loop;

  if entrada.subtotal is distinct from subtotal_calculado
     or entrada.valor is distinct from round(subtotal_calculado + coalesce(entrada.taxa_entrega, 0), 2)
     or coalesce(entrada.taxa_entrega, 0) < 0 then raise exception 'Total do pedido inválido'; end if;

  insert into public.pedidos (
    usuario_id, visitante_id, cliente_nome, cliente_telefone, cliente_email, valor, subtotal,
    taxa_entrega, status, observacao_geral, endereco, numero_casa, bairro, cep,
    pagamento, tipo_pagamento_entrega, checkout_chave, pagamento_status
  ) values (
    entrada.usuario_id, entrada.visitante_id, entrada.cliente_nome, entrada.cliente_telefone, entrada.cliente_email,
    entrada.valor, entrada.subtotal, entrada.taxa_entrega, 'pendente', entrada.observacao_geral,
    entrada.endereco, entrada.numero_casa, entrada.bairro, entrada.cep, forma_pagamento, tipo_entrega,
    entrada.checkout_chave, 'pending'
  ) returning * into novo;

  insert into public.itens_pedido (pedido_id, produto_id, quantidade, produto_nome_snapshot, preco_base_unitario, adicionais_snapshot, preco_adicionais_unitario, preco_unitario, observacao_item)
  select novo.id, (item_row->>'produto_id')::bigint, (item_row->>'quantidade')::integer, item_row->>'produto_nome_snapshot', (item_row->>'preco_base_unitario')::numeric,
    item_row->'adicionais_snapshot', (item_row->>'preco_adicionais_unitario')::numeric, (item_row->>'preco_unitario')::numeric, left(coalesce(item_row->>'observacao_item', ''), 300)
  from jsonb_array_elements(p_itens) as item_row;
  return to_jsonb(novo);
end;
$$;

revoke all privileges on function public.criar_pedido_com_itens(jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.criar_pedido_com_itens(jsonb,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;

-- Validação pós-migration (executar separadamente, somente leitura):
-- select column_name, is_nullable, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'pedidos' and column_name = 'tipo_pagamento_entrega';
-- select conname, pg_get_constraintdef(oid) from pg_constraint
-- where conrelid = 'public.pedidos'::regclass and conname = 'pedidos_tipo_pagamento_entrega_check';
-- select p.proname, p.prosecdef, pg_get_functiondef(p.oid) like '%tipo_pagamento_entrega%'
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'criar_pedido_com_itens';
