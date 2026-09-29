-- Numeração comercial independente do ID técnico de public.pedidos.
-- Aplicar somente após revisar o plano de operação. Não preenche pedidos antigos.
begin;

alter table public.pedidos
  add column if not exists numero_pedido bigint;

create sequence if not exists public.pedidos_numero_pedido_seq
  start with 1
  increment by 1
  minvalue 1;

alter sequence public.pedidos_numero_pedido_seq
  owned by public.pedidos.numero_pedido;

alter table public.pedidos
  alter column numero_pedido set default nextval('public.pedidos_numero_pedido_seq'::regclass);

create unique index if not exists pedidos_numero_pedido_unique
  on public.pedidos (numero_pedido);

revoke all privileges on sequence public.pedidos_numero_pedido_seq from public, anon, authenticated;
grant usage, select on sequence public.pedidos_numero_pedido_seq to service_role;

notify pgrst, 'reload schema';
commit;
