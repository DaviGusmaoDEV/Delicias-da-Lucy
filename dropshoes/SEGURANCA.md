# Revisão de segurança — 24/09/2026

## Escopo e resultado

Revisão do código, testes HTTP com banco simulado, migrações em PostgreSQL temporário e consultas remotas somente de leitura no Supabase. Não foram executados ataques destrutivos nem um pentest completo da infraestrutura publicada. A referência utilizada foi a [OWASP Top 10:2025](https://top10.owasp.org/2025/).

## Achados e correções

| Área | Achado ou risco | Correção e situação |
| --- | --- | --- |
| A01 — Controle de acesso | A compra sem conta precisa impedir acesso a pedidos de terceiros. | Sessão de visitante assinada e filtro pelo comprador em todas as rotas de consulta/pagamento/recebimento. Telefone nunca recupera sessão. Testado com visitantes diferentes usando o mesmo telefone. |
| A02 — Configuração | Cabeçalhos de proteção estavam desativados; faltava política de origem para sessão por cookie. | Helmet/CSP, bloqueio de frames, no-store na API e validação de Origin/Sec-Fetch-Site. Cookie Secure depende de NODE_ENV=production e HTTPS. |
| A03 — Dependências | Auditoria inicial da raiz apontou axios e form-data com vulnerabilidades altas. | Instalação e lock atualizados para axios 1.20.0 e form-data 4.0.6; auditoria retorna zero vulnerabilidades conhecidas. Auditoria de produção de dropshoes também retornou zero. |
| A04/A07 — Credenciais e autenticação | JWT em localStorage ficava acessível a scripts da página. | Telas usam cookie HttpOnly/SameSite; cargo é consultado no banco a cada requisição. Senhas de contas usam scrypt. Verificação remota não encontrou senhas legadas em texto puro nem hashes inválidos. |
| A05 — Injeção | Entradas, impressão e corpos malformados exigem validação. | Validação de tipos e limites, escape no bilhete, JSON limitado a 100 KB e erros sem stack ou detalhes do banco. Testes incluem payloads malformados e manipulação de cargo/preço. |
| A06 — Projeto | Nome, telefone e CEP não comprovam identidade. | Cadastro simplificado separado de contas com senha. Cookie de visitante permite consultar somente seus pedidos por até 30 dias. Login existente de cliente/admin permanece. |
| A08 — Integridade | Preço, destino de pagamento e confirmação não podem ser confiados ao navegador. | Preços e frete calculados no servidor, URLs Mercado Pago permitidas explicitamente, webhook assinado com consulta do pagamento. RPC transacional impede receita duplicada e trata estorno. |
| A09 — Registro | Falhas devem ser observáveis sem registrar credenciais. | Logs de recusas/limites e erros com código/status, sem corpo da requisição. Alertas centralizados dependem da hospedagem. |
| A10 — Exceções | Erros de entrada ou serviço externo não devem revelar detalhes nem liberar operações. | Tratamento de JSON/URI inválidos, indisponibilidade e falha no checkout; nenhum pagamento é liberado por retorno do navegador. |

## Supabase

A consulta pública de leitura a profiles, products, pedidos, itens_pedido e fluxo_caixa não revelou linhas (HEAD com contagem, sem baixar registros). Isso não prova por si só a ausência de permissões de escrita ou falhas em outras tabelas/RPCs. Nenhum dado de produção foi modificado nessa verificação.

A migração `database/schema-seguranca-visitantes.sql` cria a tabela privada de visitantes, adiciona proprietário e contato aos pedidos, habilita RLS e revoga acesso direto de public/anon/authenticated nas seis tabelas utilizadas. O servidor continua acessando pelo service_role e verificando autorização. O catálogo público passa pela projeção restrita da API. Conforme a [documentação do Supabase](https://supabase.com/docs/guides/api/securing-your-api), permissões e RLS devem ser configurados juntos.

**A migração ainda precisa ser executada no Supabase real**, após as migrações anteriores. Foi aplicada duas vezes no PostgreSQL temporário e testada contra SELECT/INSERT/DELETE de anon e authenticated. A constraint de proprietário usa NOT VALID para preservar pedidos antigos; linhas novas precisam de exatamente um comprador.

Scripts opcionais (a partir de dropshoes):

```sh
node scripts/auditar-supabase.js
node scripts/migrar-senhas.js
```

O segundo comando é somente leitura por padrão. `--aplicar` converte senhas legadas em hash sem alterar a senha do usuário; não foi necessário executá-lo nesta revisão.

## Validação

24 testes passaram, incluindo HTTP, permissões por cargo, cookies, CSRF, pedidos entre visitantes, validação, rate limit, links reais de HTML/CSS/JS, entrega, impressão, webhook e PostgreSQL real. Os testes PostgreSQL usam banco temporário, sem tocar no Supabase de produção.

```sh
RUN_POSTGRES_TESTS=1 npm --prefix dropshoes test
npm audit --omit=dev
npm --prefix dropshoes audit --omit=dev
```

## Antes de publicar

1. Aplicar o SQL de visitantes/permissões e confirmar o fluxo no banco real.
2. Configurar as credenciais Mercado Pago e PUBLIC_BASE_URL, validar pagamento de teste e webhook.
3. Configurar HTTPS, NODE_ENV=production e TRUST_PROXY_HOPS conforme o proxy real. Em múltiplos processos, adotar limite compartilhado; os limites atuais são por processo.
4. Configurar backup, alertas e retenção de dados na hospedagem. Revisar permissões de outras tabelas/RPCs fora do escopo.

A entrega usa localização aproximada de CEP; o OSRM público de demonstração deve ser substituído por provedor adequado antes de depender dele em produção. A criação de pedido e itens agora usa a RPC transacional `criar_pedido_com_itens`, com bloqueio por chave de checkout para evitar duplicação concorrente. Uma falha em qualquer item desfaz também o pedido. A confirmação financeira também usa transação no banco. Reexecute a versão atual de `schema-seguranca-visitantes.sql` mesmo se uma versão anterior já foi aplicada.

Não houve migração para Firebase nem alteração de DNS nesta revisão.

## Complementos desta implementação

- Produção recusa JWT_SECRET menor que 32 bytes, origem pública sem HTTPS/com caminho e número inválido de proxies. O segredo deve ser aleatório; o limite de tamanho não mede entropia.
- Logs de recusas passam a registrar o modelo da rota, sem IDs, query strings ou dados pessoais, incluindo rejeições de origem.
- A atualização de preparo verifica pagamento aprovado também no UPDATE, evitando ignorar um estorno concorrente.
- A administração lista pedidos com paginação de 50 e filtros validados no servidor. A tela `tela admin/pedidos clientes.html` usa o período das 18h à meia-noite da data escolhida, UTC-3, e atualiza a cada 15 segundos.
- Testes adicionais cobrem fronteiras do horário, paginação, configurações inválidas de produção e rollback/concorrência da nova RPC em PostgreSQL real.

Hospedagem HTTPS, DNS, alertas, backups, limite compartilhado entre instâncias e aplicação do SQL no Supabase continuam pendentes de configuração externa. O código não substitui esses controles operacionais.
