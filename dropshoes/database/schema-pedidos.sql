-- Execute este arquivo no SQL Editor do Supabase antes de publicar a nova versão.
-- Ele adiciona os dados necessários para entrega, pagamento e bilhete de cozinha.
alter table public.pedidos add column if not exists subtotal numeric(10,2);
alter table public.pedidos add column if not exists taxa_entrega numeric(10,2) not null default 0;
alter table public.pedidos add column if not exists endereco text;
alter table public.pedidos add column if not exists numero_casa text;
alter table public.pedidos add column if not exists bairro text;
alter table public.pedidos add column if not exists cep varchar(8);
alter table public.pedidos add column if not exists pagamento varchar(30) not null default 'a_combinar';
alter table public.pedidos add column if not exists pronto_em timestamptz;
alter table public.pedidos add column if not exists recebido_em timestamptz;
-- Mantém os pedidos antigos legíveis no novo fluxo de status.
update public.pedidos set status = 'aceito' where status = 'confirmado';
update public.pedidos set status = 'pronto_entrega' where status = 'saiu_para_entrega';
update public.pedidos set status = 'recebido' where status = 'entregue';

-- Perfis: admin1 = dono geral; admin2 = administrador sem acesso ao caixa; cliente = pedidos próprios.
alter table public.profiles add column if not exists telefone varchar(30);
alter table public.profiles alter column role set default 'cliente';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_role_check check (role in ('admin1', 'admin2', 'cliente')) not valid;
  end if;
end $$;

-- Campos utilizados pelo cadastro de produto e pelo cardápio.
alter table public.products add column if not exists categoria varchar(80);
alter table public.products add column if not exists descricao text;
alter table public.products add column if not exists imagem_url text;
alter table public.products add column if not exists "isEspecial" boolean not null default false;
alter table public.products alter column nome set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_preco_positivo' and conrelid = 'public.products'::regclass) then
    alter table public.products add constraint products_preco_positivo check (preco > 0) not valid;
  end if;
end $$;

-- Exemplos, substitua pelos e-mails corretos:
-- update public.profiles set role = 'admin1' where email = 'dono@empresa.com';
-- update public.profiles set role = 'admin2' where email = 'admin@empresa.com';
