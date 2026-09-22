-- Aplicar no SQL Editor do Supabase antes de publicar o servidor atualizado.
-- Mantém IDs, pedidos, senhas e cargos das contas existentes.
begin;

alter table public.profiles add column if not exists telefone varchar(30);
alter table public.profiles alter column senha type text;
alter table public.profiles alter column role set default 'cliente';

-- Interrompe a migração sem excluir contas se já existirem e-mails duplicados.
do $$
begin
  if exists (
    select lower(btrim(email)) from public.profiles
    where email is not null group by lower(btrim(email)) having count(*) > 1
  ) then
    raise exception 'Existem e-mails duplicados em profiles. Resolva as duplicidades preservando as contas e execute novamente.';
  end if;
end $$;

update public.profiles set email = lower(btrim(email)) where email is not null;
create unique index if not exists profiles_email_normalizado_unique
  on public.profiles (lower(btrim(email)));

-- Toda leitura e gravação de credenciais passa pelo servidor Express.
-- A chave pública não pode ler senhas nem inserir/alterar cargos diretamente.
alter table public.profiles enable row level security;
revoke all privileges on table public.profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

-- Preserva o tipo do ID existente (UUID, identity ou serial).
do $$
declare sequencia text;
begin
  sequencia := pg_get_serial_sequence('public.profiles', 'id');
  if sequencia is not null then
    execute format('grant usage, select on sequence %s to service_role', sequencia);
  end if;
end $$;
commit;
