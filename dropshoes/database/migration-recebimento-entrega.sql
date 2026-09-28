-- Aplicar após schema-pagamentos-caixa.sql e schema-seguranca-visitantes.sql.
-- Confirma a entrega e, apenas para pagamento na entrega, registra uma receita única.
begin;

create or replace function public.confirmar_recebimento_pedido(
  p_pedido_id text, p_recebido_em timestamptz
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pedido public.pedidos%rowtype;
begin
  if nullif(btrim(p_pedido_id), '') is null or p_recebido_em is null then
    raise exception 'Pedido ou data inválidos';
  end if;
  select * into pedido from public.pedidos where id::text = p_pedido_id for update;
  if not found then
    raise exception 'Pedido não encontrado';
  end if;
  -- Repetições concorrentes da confirmação retornam o resultado já persistido;
  -- a receita foi criada na mesma transação da primeira confirmação.
  if pedido.status = 'recebido' then
    return to_jsonb(pedido);
  end if;
  if pedido.status <> 'pronto_entrega' then
    raise exception 'Pedido não está pronto para recebimento';
  end if;

  update public.pedidos set
    status = 'recebido',
    recebido_em = p_recebido_em,
    pagamento_status = case when pedido.pagamento = 'entrega' then 'approved' else pagamento_status end,
    pagamento_id = case when pedido.pagamento = 'entrega' then coalesce(pagamento_id, 'entrega:' || id::text) else pagamento_id end,
    pagamento_atualizado = case when pedido.pagamento = 'entrega' then p_recebido_em else pagamento_atualizado end,
    pago_em = case when pedido.pagamento = 'entrega' then coalesce(pago_em, p_recebido_em) else pago_em end
    where id = pedido.id
    returning * into pedido;

  if pedido.pagamento = 'entrega' then
    insert into public.fluxo_caixa(descricao, tipo, valor, data, pedido_id)
      values ('Pedido #' || pedido.id || ' — pagamento na entrega', 'receita', pedido.valor,
        (p_recebido_em at time zone 'America/Sao_Paulo')::date, pedido.id::text)
      on conflict (pedido_id, tipo) do nothing;
  end if;
  return to_jsonb(pedido);
end;
$$;

create or replace function public.excluir_pedido_cancelado(p_pedido_id text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare pedido public.pedidos%rowtype;
begin
  if nullif(btrim(p_pedido_id), '') is null then raise exception 'Pedido inválido'; end if;
  select * into pedido from public.pedidos where id::text = p_pedido_id for update;
  if not found then return false; end if;
  if pedido.status <> 'cancelado' or pedido.pago_em is not null
     or coalesce(pedido.pagamento_status, 'pending') in ('approved', 'refunded', 'charged_back')
     or exists (select 1 from public.fluxo_caixa where pedido_id = pedido.id::text) then
    raise exception 'Pedido cancelado possui histórico financeiro';
  end if;
  delete from public.itens_pedido where pedido_id = pedido.id;
  delete from public.pedidos where id = pedido.id;
  return true;
end;
$$;

revoke all on function public.confirmar_recebimento_pedido(text,timestamptz) from public, anon, authenticated;
grant execute on function public.confirmar_recebimento_pedido(text,timestamptz) to service_role;
revoke all on function public.excluir_pedido_cancelado(text) from public, anon, authenticated;
grant execute on function public.excluir_pedido_cancelado(text) to service_role;
notify pgrst, 'reload schema';
commit;
