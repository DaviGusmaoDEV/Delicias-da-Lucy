-- Etapa 7B: taxas fixas por bairro, adicionais e vínculos produto/adicional.
-- NÃO executar automaticamente. Aplicar somente após revisão e backup.
begin;

-- Adapta-se ao schema existente e falha antes de criar objetos novos se os
-- tipos reais das colunas referenciadas não forem os contratos conhecidos.
do $$
declare
  tipo_produto text;
  tipo_item_produto text;
  tipo_pedido text;
  tipo_item_pedido text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_produto
    from pg_attribute a where a.attrelid = 'public.products'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_item_produto
    from pg_attribute a where a.attrelid = 'public.itens_pedido'::regclass and a.attname = 'produto_id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_pedido
    from pg_attribute a where a.attrelid = 'public.pedidos'::regclass and a.attname = 'id' and not a.attisdropped;
  select format_type(a.atttypid, a.atttypmod) into tipo_item_pedido
    from pg_attribute a where a.attrelid = 'public.itens_pedido'::regclass and a.attname = 'pedido_id' and not a.attisdropped;
  if tipo_produto is distinct from 'bigint'
     or tipo_item_produto is distinct from 'bigint'
     or tipo_pedido is distinct from 'integer'
     or tipo_item_pedido is distinct from 'integer' then
    raise exception 'Tipos incompatíveis: products.id=%, itens_pedido.produto_id=%, pedidos.id=%, itens_pedido.pedido_id=%; migration requer bigint/bigint/integer/integer', tipo_produto, tipo_item_produto, tipo_pedido, tipo_item_pedido;
  end if;
end $$;

create table if not exists public.delivery_bairro_taxas (
  id uuid primary key default gen_random_uuid(),
  cidade varchar(120) not null,
  uf char(2) not null,
  nome varchar(120) not null,
  chave_normalizada varchar(120) not null,
  taxa numeric(10,2) not null check (taxa >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_bairro_taxas_uf_check check (uf = upper(uf)),
  constraint delivery_bairro_taxas_nome_check check (length(btrim(nome)) > 0),
  constraint delivery_bairro_taxas_chave_check check (length(btrim(chave_normalizada)) > 0),
  constraint delivery_bairro_taxas_unique unique (cidade, uf, chave_normalizada)
);
create index if not exists delivery_bairro_taxas_busca_idx
  on public.delivery_bairro_taxas (cidade, uf, chave_normalizada) where ativo;

create table if not exists public.adicionais (
  id uuid primary key default gen_random_uuid(),
  nome varchar(120) not null,
  preco numeric(10,2) not null check (preco >= 0),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adicionais_nome_check check (length(btrim(nome)) > 0)
);
create unique index if not exists adicionais_nome_unique
  on public.adicionais (lower(btrim(nome)));

create table if not exists public.produto_adicionais (
  produto_id bigint not null references public.products(id) on delete restrict,
  adicional_id uuid not null references public.adicionais(id) on delete restrict,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (produto_id, adicional_id)
);
create index if not exists produto_adicionais_adicional_idx
  on public.produto_adicionais (adicional_id) where ativo;

alter table public.itens_pedido add column if not exists produto_nome_snapshot varchar(150);
alter table public.itens_pedido add column if not exists preco_base_unitario numeric(10,2);
alter table public.itens_pedido add column if not exists adicionais_snapshot jsonb;
alter table public.itens_pedido add column if not exists preco_adicionais_unitario numeric(10,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'itens_pedido_preco_base_check' and conrelid = 'public.itens_pedido'::regclass) then
    alter table public.itens_pedido add constraint itens_pedido_preco_base_check check (preco_base_unitario is null or preco_base_unitario >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'itens_pedido_preco_adicionais_check' and conrelid = 'public.itens_pedido'::regclass) then
    alter table public.itens_pedido add constraint itens_pedido_preco_adicionais_check check (preco_adicionais_unitario is null or preco_adicionais_unitario >= 0) not valid;
  end if;
end $$;

-- Apenas service_role/backend acessa dados comerciais e relacionamentos.
do $$
declare tabela text;
begin
  foreach tabela in array array['delivery_bairro_taxas','adicionais','produto_adicionais'] loop
    execute format('alter table public.%I enable row level security', tabela);
    execute format('revoke all privileges on table public.%I from public, anon, authenticated', tabela);
    execute format('grant select, insert, update, delete on table public.%I to service_role', tabela);
  end loop;
end $$;

-- Seeds idempotentes: não sobrescrevem taxa/preço alterado pelo administrador.
insert into public.delivery_bairro_taxas (cidade, uf, nome, chave_normalizada, taxa)
select 'Ribeirão Preto', 'SP', v.nome, v.chave, v.taxa
from (values
  ('Eugênio','eugenio',7.00), ('Macaúba','macauba',8.00), ('Cristo','cristo',8.00),
  ('Alto do Ipiranga','alto do ipiranga',5.00), ('Quintino','quintino',7.00),
  ('Avelino','avelino',8.00), ('Simioni','simioni',7.00), ('Vila Carvalho','vila carvalho',7.00),
  ('Pão de Alhozinho','pao de alhozinho',8.00), ('Vila Mariana','vila mariana',7.00),
  ('Vila Tibério','vila tiberio',7.00), ('Vila Virgínia','vila virginia',10.00),
  ('Aeroporto','aeroporto',8.00), ('Ipiranga','ipiranga',3.00), ('Dutra','dutra',4.00),
  ('Geraldo','geraldo',5.00), ('Parque dos Pinus','parque dos pinus',6.00),
  ('Rigon','rigon',6.00), ('Marincek','marincek',5.00), ('Jandaia','jandaia',5.00),
  ('Campos Elíseos','campos eliseos',6.00), ('José Sampaio','jose sampaio',5.00),
  ('Balbo','balbo',6.00), ('Planalto Verde','planalto verde',6.00),
  ('Paiva','paiva',6.00), ('Dom Miele','dom miele',7.00)
) as v(nome, chave, taxa)
where not exists (
  select 1 from public.delivery_bairro_taxas t
  where t.cidade = 'Ribeirão Preto' and t.uf = 'SP' and t.chave_normalizada = v.chave
);

insert into public.adicionais (nome, preco)
select v.nome, v.preco
from (values
  ('Cheddar',5.00), ('Catupiry',5.00), ('Calabresa',5.00), ('Mussarela',5.00),
  ('Presunto',5.00), ('Bacon',5.00), ('Azeitona',5.00), ('Salsicha',3.00),
  ('Cebola',3.00), ('Ovo',3.00), ('Ervilha',3.00), ('Milho',3.00), ('Alho',3.00),
  ('Ketchup',0.50), ('Maionese',0.50), ('Para viagem',3.00)
) as v(nome, preco)
where not exists (select 1 from public.adicionais a where lower(btrim(a.nome)) = lower(btrim(v.nome)));

notify pgrst, 'reload schema';
commit;
