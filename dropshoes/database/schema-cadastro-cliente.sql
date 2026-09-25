-- Execute no SQL Editor do projeto Supabase usado pelo servidor.
-- Corrige a coluna ausente que impede POST /api/cadastro de gravar profiles.
-- Preserva as contas existentes e pode ser executado novamente.
begin;
alter table public.profiles add column if not exists telefone varchar(30);
alter table public.profiles add column if not exists cep varchar(8);
-- O hash scrypt de novas senhas precisa caber por inteiro.
alter table public.profiles alter column senha type text;
notify pgrst, 'reload schema';
commit;
