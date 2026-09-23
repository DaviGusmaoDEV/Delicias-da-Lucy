# Delícias da Lucy

Para iniciar o servidor, execute na raiz do repositório:

```sh
npm --prefix dropshoes start
```

Abra `http://localhost:3000`. A entrada encaminha para o arquivo real de login do cliente.

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

O cadastro público cria apenas clientes. Administradores usam contas existentes
com cargo `admin1` ou `admin2`. O envio dos formulários usa `POST /api/cadastro`
e `POST /api/login`. Consulte `dropshoes/database/AUTENTICACAO.md` para configurar
o Supabase e `JWT_SECRET`; iniciar o servidor sem essa configuração não habilita
a autenticação real. Com esse comando, o dotenv busca o arquivo `.env` dentro de `dropshoes`.

Para validar o projeto com banco simulado:

```sh
npm --prefix dropshoes test
```
