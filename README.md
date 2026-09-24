# Delícias da Lucy

Para iniciar o servidor, execute na raiz do repositório:

```sh
npm --prefix dropshoes start
```

Abra `http://localhost:3000`. A entrada encaminha para o catálogo público de produtos.

| Tela | Arquivo dentro de `dropshoes/public` | Entrada alternativa |
| --- | --- | --- |
| Login do cliente | `tela de login/login cliente.html` | `/login-cliente` |
| Cadastro do cliente | `tela de login/cadastro cliente.html` | `/cadastro-cliente` |
| Login administrativo | `tela de login/login.html` | `/login` |
| Login administrativo adicional | `tela admin/login.html` | Acesso direto ao arquivo |

As entradas alternativas redirecionam para o HTML correspondente para que CSS,
scripts e links relativos funcionem também ao acessar rotas com barra final.
Os nomes de pastas foram preservados. Os links no HTML usam espaços normais;
o navegador codifica esses espaços como `%20` ao enviar a URL.

O cadastro simplificado usa nome, telefone e CEP, sem SMS, e salva um visitante
em `clientes_visitantes` por `POST /api/cadastro-cliente`. Os pedidos ficam ligados
à sessão desse navegador; informar um telefone não recupera contas ou pedidos.
Contas existentes continuam entrando por e-mail e senha em `POST /api/login`.
Administradores usam contas existentes com cargo `admin1` ou `admin2`.
Consulte `dropshoes/database/AUTENTICACAO.md` para configurar
o Supabase e `JWT_SECRET`; iniciar o servidor sem essa configuração não habilita
a autenticação real. Com esse comando, o dotenv busca o arquivo `.env` dentro de `dropshoes`.

Após as migrações anteriores, execute `dropshoes/database/schema-seguranca-visitantes.sql`
no SQL Editor do Supabase para habilitar a compra sem conta. O checkout exige nome,
telefone, CEP, rua, bairro e número da casa. Consulte [a revisão de segurança](dropshoes/SEGURANCA.md).

Para validar o projeto com banco simulado:

```sh
npm --prefix dropshoes test
```

## Produtos e cardápio

Execute `dropshoes/database/schema-produtos.sql` no SQL Editor do Supabase
antes de cadastrar produtos. A tabela `products` precisa de `categoria`,
`descricao`, `imagem_url` e `isEspecial`, além dos campos existentes `id`, `nome` e `preco`.

Na tela `tela admin/produtos.html`, administradores cadastram e editam produtos
normais ou promocionais com preço e descrição. A API grava ambos em `products`.
Clientes consultam o mesmo catálogo em `tela cliente/Produtos.html`, com filtros
por categoria e tipo, descrição, preço e selo de promoção. A página aberta atualiza
o catálogo a cada 10 segundos e ao voltar para a aba. Criar, editar e excluir
produtos exige cargo administrativo no servidor.

## Checkout, entrega e caixa

Consulte [a configuração de pagamentos e entrega](dropshoes/database/PAGAMENTOS.md).
Aplique `dropshoes/database/schema-pagamentos-caixa.sql` no Supabase e configure
as credenciais do Mercado Pago e a URL HTTPS pública antes de aceitar pedidos.
O carrinho usa somente Mercado Pago; o webhook confirmado gera uma única receita
por pedido. O caixa permite filtrar entradas, custos, saídas e despesas de funcionários.

O checkout também pode usar InfinitePay. Para ativá-lo, configure
`PAYMENT_PROVIDER=infinitepay` e `INFINITEPAY_HANDLE` no ambiente privado do
servidor. O backend cria o link pelo Checkout Integrado, confirma a transação
com `payment_check` e só então registra a receita. O webhook da InfinitePay é
`POST /api/webhooks/infinitepay`; o corpo recebido nunca é aceito como prova
única de pagamento.

A loja tem 2 km gratuitos e cobra R$ 1,50 por quilômetro excedente, proporcional à
distância. A origem foi configurada pelo Plus Code `58CJV56H+8G`. A estimativa usa
a localização do CEP e trajeto de carro, podendo diferir da distância até a porta.

Para testar também a migração e a concorrência em PostgreSQL temporário
(requer `initdb`, `pg_ctl` e `psql` instalados):

```sh
RUN_POSTGRES_TESTS=1 npm --prefix dropshoes test
```

## Pedidos da noite

No menu administrativo, abra **Pedidos dos clientes**, no arquivo
`dropshoes/public/tela admin/pedidos clientes.html`. A tela consulta o Supabase
pela API protegida e mostra pedidos das **18h à meia-noite** da data selecionada
(horário de Ribeirão Preto), com filtro de status, paginação e atualização a cada
15 segundos. Admin 1 e Admin 2 podem aceitar, iniciar preparo, indicar entrega,
cancelar e imprimir; somente o cliente confirma o recebimento. Cancelamento de
pedido pago não executa reembolso: faça o reembolso no Mercado Pago.

A versão atual de `schema-seguranca-visitantes.sql` também instala a RPC de
criação atômica de pedido/itens. Execute-a novamente se já aplicou a versão anterior,
após `schema-pedidos.sql`, `schema-autenticacao.sql`, `schema-revisao.sql`,
`schema-produtos.sql` e `schema-pagamentos-caixa.sql`.
