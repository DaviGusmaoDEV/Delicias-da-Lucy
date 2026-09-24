# Pagamentos, entrega e caixa

## Ativação

1. No SQL Editor do Supabase, aplique `schema-pagamentos-caixa.sql`, depois da
   estrutura existente de pedidos e caixa (`schema-revisao.sql`). O script adiciona
   colunas sem excluir pedidos antigos. A função de confirmação só pode ser
   executada pelo servidor com a chave privada `service_role`.
2. Em `dropshoes/.env`, configure:

   ```dotenv
   MERCADOPAGO_ACCESS_TOKEN=token_privado_da_aplicacao
   MERCADOPAGO_WEBHOOK_SECRET=segredo_de_assinatura_das_notificacoes
   PUBLIC_BASE_URL=https://dominio-publico-do-site
   MERCADOPAGO_SANDBOX=false
   ```

   Esses valores são privados, exceto a URL pública. Não os coloque no frontend
   nem no Git. O token do Mercado Pago é diferente da chave do Supabase.
3. Em **Suas integrações** no Mercado Pago, configure notificações Webhooks para
   **Pagamentos / payment**, com a URL:
   `https://dominio-publico-do-site/api/webhooks/mercadopago`.
   Copie o segredo de assinatura para `MERCADOPAGO_WEBHOOK_SECRET`.
4. Para testes, use as credenciais/contas de teste do Mercado Pago e defina
   `MERCADOPAGO_SANDBOX=true`. O servidor precisa de HTTPS público alcançável pelo
   Mercado Pago, inclusive em desenvolvimento (localhost sozinho não recebe webhook).
5. Reinicie o servidor. Faça uma compra de teste e confirme no painel que o webhook
   recebeu HTTP 200, o pedido está aprovado e existe apenas uma entrada no caixa.

Referências: [Webhooks do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/additional-content/your-integrations/notifications/webhooks)
e [notificações do Checkout Pro](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications).

## Regra financeira

- Pedido de R$ 20 pago: entrada bruta de R$ 20. Inclui entrega, se cobrada.
- A volta do navegador para o site não confirma pagamento. O servidor verifica a
  assinatura e consulta o pagamento diretamente no Mercado Pago, conferindo pedido,
  valor e moeda BRL.
- Pedidos pendentes, rejeitados ou apenas criados não geram receita. O preparo só
  é liberado após aprovação. O status de entrega é independente do status financeiro.
- A função SQL bloqueia a linha do pedido e confirma pagamento e receita na mesma
  transação. Reenvios e chamadas concorrentes não duplicam o lançamento.
- Estornos confirmados geram uma saída vinculada; estornos parciais atualizam o
  acumulado, sem duplicar. Taxas do Mercado Pago não são descontadas dessa entrada
  bruta; podem ser registradas como despesa manual.
- Lançamentos vinculados a pedidos não podem ser editados/excluídos pela API de
  transações manuais. Cancelar o preparo do pedido não solicita um reembolso:
  reembolsos devem ser feitos no Mercado Pago e entram no caixa via notificação.
- Se houver falha ao abrir checkout, o mesmo pedido pode ser retomado no carrinho
  ou no perfil. Se houver falha ao confirmar no banco, o webhook retorna 503 para
  que o provedor repita a notificação. Acompanhe falhas no painel de notificações.
- Dois pagamentos aprovados diferentes para o mesmo pedido exigem conferência
  manual: a função rejeita o segundo, evitando duplicar receita do pedido.

## Entrega

Origem informada: Rua Javari, 2705, Ipiranga, Ribeirão Preto. O Plus Code enviado
pelo responsável, `V56H+8G`, recuperado na região de Ribeirão Preto, corresponde
à célula `58CJV56H+8G`, centro `-21.1391875, -47.8211875`.

```dotenv
STORE_LATITUDE=-21.1391875
STORE_LONGITUDE=-47.8211875
DELIVERY_PRICE_PER_KM=1.50
DELIVERY_CHARGE_MODE=excedente
OSRM_BASE_URL=https://router.project-osrm.org
```

Até 2.000 metros: grátis. Acima disso:
`taxa = arredondar((metros - 2000) / 1000 * 1.50, 2 casas)`.
Exemplos: 2,5 km = R$ 0,75; 3 km = R$ 1,50; 4 km = R$ 3,00.

O servidor consulta [BrasilAPI CEP V2](https://brasilapi.com.br/docs), usa as
coordenadas do CEP e consulta a distância de carro na [API OSRM](https://project-osrm.org/docs/v5.22.0/api/).
A cotação é aproximada: o ponto do CEP pode não representar o número da casa.
O CEP 14060-040 retornou Rua Caravelas na consulta feita durante a implementação;
por isso a origem usa o Plus Code, não esse CEP.

Sem coordenadas, sem rota ou fora de Ribeirão Preto/SP, a entrega não é liberada.
O preço é recalculado no servidor; o cliente não define a taxa. Resultados ficam
em cache por 15 minutos. O endpoint público OSRM é de demonstração; para produção,
configure `OSRM_BASE_URL` com uma instância/provedor adequado ao tráfego da loja.

## Impressão

O botão **Imprimir bilhete** abre um cupom de 80 mm e o diálogo de impressão do
navegador. Selecione a impressora térmica. Endereço impresso: nome, bairro, rua e
número, sem CEP. Também inclui itens, observações, valores e situação do pagamento.
Impressão silenciosa automática depende da configuração local da impressora/quiosque;
o site não instala drivers nem envia diretamente à impressora.

## Verificação realizada

Testes de assinatura, cotação, filtros, impressão, checkout e autorização com
serviços simulados. A migração e os lançamentos repetidos/concorrentes também foram
validados em PostgreSQL temporário local. A consulta de CEP e rota foi testada com
os serviços externos. Não foram criados pagamentos reais nem aplicada a migração
no Supabase de produção; as credenciais Mercado Pago/URL pública estavam ausentes.
