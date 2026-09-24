# Cadastro e login

O projeto mantém as contas na tabela `public.profiles` do Supabase, como na implementação existente. Não usa `auth.users` nem cria contas no Supabase Auth. Os administradores existentes em `profiles`, com cargo `admin1` ou `admin2`, são preservados. O formulário público simplificado salva visitantes em `clientes_visitantes`; não cria credenciais de login nem confirma a posse do telefone.

## Configuração necessária

1. Configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (ou a chave legada `SUPABASE_SERVICE_ROLE_KEY`) no ambiente privado do servidor. Não coloque essa chave nos arquivos de `public`, no Git nem nas mensagens do navegador.
2. Mantenha `JWT_SECRET` configurado com um segredo forte e estável.
3. Execute, nesta ordem, `database/schema-pedidos.sql`, `database/schema-autenticacao.sql` e `database/schema-revisao.sql` no SQL Editor do Supabase. O script normaliza e-mails, garante unicidade e impede acesso direto à tabela por chaves públicas. Se houver duplicidades, ele aborta sem apagar contas; resolva-as antes de executar novamente.
4. Aplique as migrações de produtos e pagamentos e, depois, `database/schema-seguranca-visitantes.sql`.
5. Reinicie o servidor com `npm start`.

Sem a chave privada, as rotas de autenticação retornam 503. A chave pública não é usada como alternativa para acessar credenciais. A chave privada fica restrita ao backend, conforme a [documentação do Supabase](https://supabase.com/docs/guides/database/secure-data).

## Comportamento

- Cadastro simplificado (`/api/cadastro-cliente`): nome, telefone e CEP, sem senha ou SMS. A sessão assinada dura 30 dias no mesmo navegador. Não há recuperação por telefone; perder o cookie perde o acesso aos pedidos dessa sessão.
- A API legada `/api/cadastro` continua disponível para clientes com e-mail e senha de 8 a 128 caracteres; cargo e metadados enviados pelo cliente são ignorados.
- E-mails são normalizados para minúsculas. O índice único resolve também cadastros simultâneos.
- Senhas novas recebem hash scrypt com salt aleatório. Senhas antigas em texto puro são migradas no primeiro login válido, preservando os cargos. Contas antigas que nunca entrarem continuam com a senha antiga no banco, por isso a tabela fica inacessível às chaves públicas.
- O login consulta `profiles` a cada entrada. Senhas são verificadas sem remover espaços. Contas desconhecidas e senhas incorretas recebem a mesma mensagem.
- `/login-cliente` aceita clientes; `/login` aceita os administradores existentes. Não há cadastro de administrador.
- Cada requisição autenticada consulta o cargo atual no banco. Alterar o cargo no navegador ou manter um token antigo não concede permissões.
- Sessões de contas expiram após oito horas. As telas usam cookie HttpOnly/SameSite; não guardam JWT em localStorage. Em produção, configure `NODE_ENV=production` para cookies Secure e `PUBLIC_BASE_URL` com a origem HTTPS exata. O modo bearer permanece para compatibilidade de clientes da API.

## Verificação

Execute `npm test`. Os testes usam um banco simulado e não alteram contas reais. Para validar a integração após aplicar `schema-seguranca-visitantes.sql`, preencha o cadastro simplificado e confira o perfil no mesmo navegador. Em outro navegador, o mesmo telefone não deve recuperar pedidos da primeira sessão. Valide também o login de um cliente existente. Entre também com um administrador já existente.

O fluxo de caixa agora persiste em `fluxo_caixa`; dados antigos de `localStorage.transacoes` não são importados automaticamente e permanecem no navegador original. Exporte-os antes de limpar dados do navegador.

Há limite de 30 tentativas de login/cadastro por IP a cada 15 minutos, por processo. Atrás de proxy, configure `TRUST_PROXY_HOPS` com o número real de proxies controlados. Em múltiplas instâncias, aplique também um limite compartilhado na infraestrutura.
