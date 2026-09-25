-- Execute no SQL Editor somente se quiser limpar o catálogo inicial.
-- Produtos usados em pedidos não são removidos para preservar o histórico.
begin;
delete from public.products p
where not exists (select 1 from public.itens_pedido i where i.produto_id = p.id);
commit;
