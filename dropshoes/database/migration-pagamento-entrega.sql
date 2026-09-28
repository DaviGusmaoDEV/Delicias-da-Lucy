-- Migração aditiva: permite pedidos com pagamento na entrega sem checkout online.
-- Execute uma vez no Supabase após as migrações de pedidos e visitantes.
begin;

create or replace function public.criar_pedido_com_itens(p_pedido jsonb, p_itens jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  novo public.pedidos%rowtype;
  entrada public.pedidos%rowtype;
  forma_pagamento text;
begin
  if jsonb_typeof(p_pedido) is distinct from 'object'
     or jsonb_typeof(p_itens) is distinct from 'array' then
    raise exception 'Pedido inválido';
  end if;
  if jsonb_array_length(p_itens) not between 1 and 100 then
    raise exception 'Itens inválidos';
  end if;
  entrada := jsonb_populate_record(null::public.pedidos, p_pedido);
  forma_pagamento := coalesce(nullif(entrada.pagamento, ''), 'site');
  if forma_pagamento not in ('site', 'entrega') then raise exception 'Forma de pagamento inválida'; end if;
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
    usuario_id, visitante_id, cliente_nome, cliente_telefone, cliente_email, valor, subtotal,
    taxa_entrega, status, observacao_geral, endereco, numero_casa, bairro, cep,
    pagamento, checkout_chave, pagamento_status
  ) values (
    entrada.usuario_id, entrada.visitante_id, entrada.cliente_nome, entrada.cliente_telefone, entrada.cliente_email,
    entrada.valor, entrada.subtotal, entrada.taxa_entrega, 'pendente',
    entrada.observacao_geral, entrada.endereco, entrada.numero_casa, entrada.bairro,
    entrada.cep, forma_pagamento, entrada.checkout_chave, 'pending'
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
