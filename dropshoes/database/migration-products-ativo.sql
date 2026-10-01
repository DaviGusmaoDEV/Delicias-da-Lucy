-- Ciclo de vida seguro dos produtos: desativação sem apagar histórico.
-- Migration aditiva; executar somente após revisar o schema de produção.
BEGIN;

DO $$
DECLARE
  tipo_id text;
BEGIN
  IF to_regclass('public.products') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.products não encontrada';
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO tipo_id
  FROM pg_attribute a
  WHERE a.attrelid = 'public.products'::regclass
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF tipo_id <> 'bigint' THEN
    RAISE EXCEPTION 'public.products.id deve ser bigint; encontrado %', tipo_id;
  END IF;
END $$;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;

COMMIT;
