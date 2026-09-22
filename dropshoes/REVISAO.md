# Revisão geral

Foram corrigidos cadastro/login, permissões consultadas no Supabase, encerramento de sessão, links e módulos do navegador, perfil administrativo, persistência do fluxo de caixa, validação dos produtos/pedidos, cálculo monetário em centavos e tratamento de falhas assíncronas da API.

As bibliotecas não utilizadas Google APIs, Stripe, Multer e a dependência direta MongoDB foram removidas. O código legado Mongoose foi mantido e sua dependência atualizada. O SDK Mercado Pago foi atualizado; a interface `MercadoPagoConfig`/`Preference.create` usada pelo servidor foi verificada localmente. SweetAlert2 agora é servido pelo próprio servidor na versão do arquivo de dependências.

## Validação

- `npm test`: 9 testes aprovados, incluindo integração HTTP com banco simulado, autenticação, permissões, caixa, pedidos, erros, limitação de tentativas, links e sintaxe dos scripts.
- `npm audit fix --ignore-scripts --no-fund`: auditoria final com zero vulnerabilidades conhecidas.
- `npm ls --depth=0`: dependências instaladas consistentes.
- `git diff --check`: sem erros de formatação.

## Antes da publicação

Configure a chave privada do Supabase e aplique os três scripts SQL na ordem indicada em [database/AUTENTICACAO.md](database/AUTENTICACAO.md). A revisão não executou migrações nem alterou contas reais. As contas existentes precisam estar em `public.profiles`, como no código anterior; contas apenas em Supabase Auth não são autenticadas por esse fluxo.

Não foi possível testar o banco ou pagamentos reais neste ambiente. Não havia navegador conectado para inspeção visual. Os testes HTTP usam dados fictícios e não chamam serviços de pagamento.

A regra de entrega existente usa faixas de CEP e valores configurados em `DELIVERY_FEE_*`; a cobertura geográfica precisa ser confirmada com o restaurante. Não há confirmação automática de pagamento por webhook: criar um checkout não significa que o pedido foi pago.

O fluxo de caixa antigo guardava transações apenas no navegador. Elas não são apagadas nem importadas automaticamente; devem ser conferidas antes de uma importação para evitar duplicidade. A gravação de pedido e itens continua em duas operações, com tentativa de remover o pedido incompleto em caso de falha; uma transação de banco é recomendada para garantir atomicidade mesmo se houver indisponibilidade durante essa remoção.
