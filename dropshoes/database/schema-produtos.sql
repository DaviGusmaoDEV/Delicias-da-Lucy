-- Execute no SQL Editor do projeto Supabase usado pelo servidor.
-- Preserva produtos existentes e adiciona os campos usados no cardápio.
begin;
alter table public.products add column if not exists categoria varchar(80) default 'outros';
alter table public.products add column if not exists descricao text;
alter table public.products add column if not exists imagem_url text;
alter table public.products add column if not exists "isEspecial" boolean not null default false;
notify pgrst, 'reload schema';
commit;
