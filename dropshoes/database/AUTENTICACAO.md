# Cadastro e login

O projeto mantém as contas na tabela `public.profiles` do Supabase, como na implementação existente. Não usa `auth.users` nem cria contas no Supabase Auth. Os administradores existentes em `profiles`, com cargo `admin1` ou `admin2`, são preservados. O formulário público só cria `cliente`.

## Configuração necessária

1. Configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (ou a chave legada `SUPABASE_SERVICE_ROLE_KEY`) no ambiente privado do servidor. Não coloque essa chave nos arquivos de `public`, no Git nem nas mensagens do navegador.
2. Mantenha `JWT_SECRET` configurado com um segredo forte e estável.
3. Execute, nesta ordem, `database/schema-pedidos.sql`, `database/schema-autenticacao.sql` e `database/schema-revisao.sql` no SQL Editor do Supabase. O script normaliza e-mails, garante unicidade e impede acesso direto à tabela por chaves públicas. Se houver duplicidades, ele aborta sem apagar contas; resolva-as antes de executar novamente.
4. Reinicie o servidor com `npm start`.

Sem a chave privada, as rotas de autenticação retornam 503. A chave pública não é usada como alternativa para acessar credenciais. A chave privada fica restrita ao backend, conforme a [documentação do Supabase](https://supabase.com/docs/guides/database/secure-data).

## Comportamento

- Cadastro: nome, e-mail, telefone opcional e senha de 8 a 128 caracteres. A confirmação é validada na tela; cargo e metadados enviados pelo cliente são ignorados.
- E-mails são normalizados para minúsculas. O índice único resolve também cadastros simultâneos.
- Senhas novas recebem hash scrypt com salt aleatório. Senhas antigas em texto puro são migradas no primeiro login válido, preservando os cargos. Contas antigas que nunca entrarem continuam com a senha antiga no banco, por isso a tabela fica inacessível às chaves públicas.
- O login consulta `profiles` a cada entrada. Senhas são verificadas sem remover espaços. Contas desconhecidas e senhas incorretas recebem a mesma mensagem.
- `/login-cliente` aceita clientes; `/login` aceita os administradores existentes. Não há cadastro de administrador.
- Cada requisição autenticada consulta o cargo atual no banco. Alterar o cargo no navegador ou manter um token antigo não concede permissões.
- Sessões expiram após oito horas; o navegador guarda o token, nunca a senha.

## Verificação

Execute `npm test`. Os testes usam um banco simulado e não alteram contas reais. Para validar a integração após configurar o ambiente, cadastre um cliente de teste pela tela, entre novamente, consulte seu perfil e confirme que sua conta não acessa a administração. Entre também com um administrador já existente.

O fluxo de caixa agora persiste em `fluxo_caixa`; dados antigos de `localStorage.transacoes` não são importados automaticamente e permanecem no navegador original. Exporte-os antes de limpar dados do navegador.

Há limite de 30 tentativas de login/cadastro por IP a cada 15 minutos, por processo. Atrás de proxy, configure `TRUST_PROXY_HOPS` com o número real de proxies controlados. Em múltiplas instâncias, aplique também um limite compartilhado na infraestrutura.
