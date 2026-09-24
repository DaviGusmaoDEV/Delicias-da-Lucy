-- Execute após schema-revisao.sql. Não marca pedidos antigos como pagos.
begin;
alter table public.pedidos add column if not exists pagamento_status text not null default 'pending';
alter table public.pedidos add column if not exists pagamento_id text;
alter table public.pedidos add column if not exists pagamento_atualizado timestamptz;
alter table public.pedidos add column if not exists pago_em timestamptz;
alter table public.pedidos add column if not exists payment_url text;
alter table public.pedidos add column if not exists checkout_chave uuid;
create unique index if not exists pedidos_checkout_chave_unique on public.pedidos(checkout_chave);
create unique index if not exists pedidos_pagamento_id_unique on public.pedidos(pagamento_id);
alter table public.fluxo_caixa add column if not exists pedido_id text;
create unique index if not exists fluxo_caixa_pedido_tipo_unique on public.fluxo_caixa(pedido_id,tipo);

-- Confirmação e lançamento atômicos: repetição ou concorrência não duplica receita.
create or replace function public.registrar_pagamento_pedido(
  p_pedido_id text, p_pagamento_id text, p_status text, p_valor numeric,
  p_estornado numeric, p_atualizado timestamptz, p_aprovado timestamptz
) returns void language plpgsql security definer set search_path = public as $$
declare pedido public.pedidos%rowtype; estorno numeric; dia date;
begin
  select * into pedido from public.pedidos where id::text = p_pedido_id for update;
  if not found or pedido.pagamento <> 'site' then raise exception 'Pedido inválido'; end if;
  if p_valor is null or p_valor <> pedido.valor or p_valor <= 0 or p_atualizado is null
    or p_estornado is null or p_estornado < 0 or p_estornado > p_valor then
    raise exception 'Valor ou data inválidos';
  end if;
  if p_status not in ('approved','pending','in_process','authorized','rejected','cancelled','refunded','charged_back','in_mediation') then
    raise exception 'Status inválido';
  end if;
  if pedido.pagamento_id is not null and pedido.pagamento_id <> p_pagamento_id then
    if pedido.pago_em is not null then
      if p_status in ('approved','refunded','charged_back') then raise exception 'Outro pagamento já registrado'; end if;
      return;
    end if;
  elsif pedido.pagamento_atualizado is not null and pedido.pagamento_atualizado > p_atualizado then
    return;
  end if;
  -- Uma tentativa recusada não substitui um pagamento já aprovado.
  if pedido.pago_em is not null and p_status in ('pending','in_process','authorized','rejected','cancelled') then return; end if;
  update public.pedidos set pagamento_status = p_status, pagamento_id = p_pagamento_id,
    pagamento_atualizado = p_atualizado,
    pago_em = case when p_status in ('approved','refunded','charged_back') then coalesce(pago_em,p_aprovado,p_atualizado) else pago_em end
    where id = pedido.id;
  if p_status in ('approved','refunded','charged_back') then
    dia := (coalesce(p_aprovado,pedido.pago_em,p_atualizado) at time zone 'America/Sao_Paulo')::date;
    insert into public.fluxo_caixa(descricao,tipo,valor,data,pedido_id)
      values ('Pedido #' || p_pedido_id || ' — ' || case when p_pagamento_id like 'infinitepay:%' then 'InfinitePay' else 'Mercado Pago' end,'receita',p_valor,dia,p_pedido_id)
      on conflict (pedido_id,tipo) do nothing;
    estorno := case when p_status in ('refunded','charged_back') then p_valor else p_estornado end;
    if estorno > 0 then
      insert into public.fluxo_caixa(descricao,tipo,valor,data,pedido_id)
        values ('Estorno do pedido #' || p_pedido_id,'despesa',estorno,(p_atualizado at time zone 'America/Sao_Paulo')::date,p_pedido_id)
        on conflict (pedido_id,tipo) do update set valor = greatest(fluxo_caixa.valor, excluded.valor);
    end if;
  end if;
end;
$$;
revoke all on function public.registrar_pagamento_pedido(text,text,text,numeric,numeric,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.registrar_pagamento_pedido(text,text,text,numeric,numeric,timestamptz,timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;
