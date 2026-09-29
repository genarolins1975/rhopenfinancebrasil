# Demonstração em rhopenfinancebrasil.com (Vercel Pro e Neon)

Roteiro para publicar o portal como demonstração do conceito, com dados fictícios (`DEC-45`). Não é produção nem piloto: nenhuma pessoa real, nenhum CPF real, nenhum email enviado. A publicação, cada atualização da demonstração e a alteração de DNS só acontecem com autorização do responsável registrada em `../decisoes/registro-de-decisoes.md` (regra 10 do `CLAUDE.md`).

## O que roda onde

| Parte | Onde | Observação |
|---|---|---|
| Portal (Next.js) | Vercel, projeto novo, funções em São Paulo (`gru1`, fixada em `vercel.json`) | Publica só a branch `demo`; as branches de trabalho (`claude/...`) não geram deploy |
| Banco PostgreSQL 16 | Neon, região AWS São Paulo (`aws-sa-east-1`), projeto criado direto em neon.com | A aplicação usa a conexão com pool; as migrações usam a conexão direta |
| Migrações e dados fictícios | No build de produção (`pnpm vercel-build`) | Dados só com banco vazio; a segunda vez não altera nada |
| Emails e varreduras da fila | Tarefa agendada da Vercel em `/api/cron/operacao`, a cada 15 minutos em dias úteis, das 08:00 às 19:59 de Brasília | Fechada por `CRON_SECRET`. Com `EMAIL_TRANSPORT=none`, nada é enviado. A correção das reservas não depende da tarefa (`DIR-034`); o intervalo deixa o banco dormir e respeita a cota do Neon |

## 1. Banco no Neon

1. Em neon.com, crie um projeto com PostgreSQL 16 na região **AWS São Paulo (aws-sa-east-1)**. O Neon sugere uma versão mais nova por padrão (18, em 29/09/2026); na janela de criação, em **Services**, clique em **Postgres database** para abrir as opções e escolha 16 em **Postgres version**, a versão em que o portal foi testado. A versão de um projeto não muda depois de criado. Não use a integração Neon pela aba Storage da Vercel: ela grava no projeto da Vercel a credencial do papel dono do Neon, inclusive em ambientes de prévia. Se o console do Neon abrir numa organização com nome "Vercel: ..." (conta criada por essa integração), o botão **New project** fica desativado, porque ali os projetos só nascem pela Vercel. Nesse caso, crie uma organização própria do Neon no menu do canto superior direito, em **Create organization**, com o plano **Free**, e crie o projeto nela.
2. Abra o **SQL Editor** do projeto, no banco padrão (`neondb`), e rode os Blocos 1, 2 e 3 do arquivo `demo-neon.sql` deste diretório, um de cada vez. O editor pode rodar cada comando numa conexão própria; o arquivo foi escrito para isso, e o Bloco 1 pode ser rodado de novo sem estrago.
3. Guarde as duas senhas que o Bloco 1 mostra (`senha_rh_owner`, `senha_rh_app`) num cofre de senhas. Não devem ir para email, chat, print nem planilha. Depois do passo 4, rode o Bloco 4 com o banco `neondb` selecionado no topo do editor (a tabela fica nele), que apaga a tabela onde elas ficaram; a partir daí, não aparecem de novo.
4. Em **Connect**, escolha o banco `rh_demo` e copie os dois endereços do servidor: o **com pool** (com `-pooler` no nome) e o **direto** (sem `-pooler`). Monte as duas URLs:
   * `DATABASE_URL` (aplicação, com pool): `postgresql://rh_app:<senha_rh_app>@<servidor com -pooler>/rh_demo?sslmode=require`
   * `DATABASE_OWNER_URL` (migrações, direta): `postgresql://rh_owner:<senha_rh_owner>@<servidor sem -pooler>/rh_demo?sslmode=require`

Cota do plano gratuito do Neon (documentação do Neon consultada em 29/09/2026): 100 CU-horas por projeto por mês; esgotada a cota, o banco fica suspenso até o ciclo seguinte. O banco dorme depois de 5 minutos sem consulta. Com a tarefa a cada 15 minutos só em horário comercial e uso de demonstração, o consumo fica dentro da cota. Se a demonstração for usada o dia todo, avalie o plano pago por uso.

## 2. Branch de publicação

No GitHub, no repositório `genarolins1975/rhopenfinancebrasil`, crie a branch `demo` a partir de `claude/new-session-0rzo0n` (Branches, New branch). A demonstração publica só o que estiver em `demo`. Para atualizar a demonstração depois, avance `demo` só com autorização registrada: é esse ato que publica.

## 3. Projeto na Vercel

1. **Add New, Project**, importe o repositório. A Vercel detecta Next.js e pnpm; o `vercel.json` do repositório define o build, a região, a tarefa agendada e o bloqueio de deploy das branches de trabalho.
2. Na tela de importação, não cadastre variáveis: ali elas valeriam para todos os ambientes. Conclua a importação; o primeiro deploy de um projeto novo é sempre de produção e falha sem variáveis, o que é esperado.
3. Em **Settings, Environments, Production, Branch Tracking**, defina a branch de produção como `demo`. Em **Settings, Environment Variables**, cadastre as variáveis abaixo só em **Production**: as marcadas na tabela com o tipo **Secret** (valor ilegível depois de salvo; é o antigo Sensitive, trocado pela Vercel em 24/08/2026) e as demais com o tipo **Config**. Depois, publique juntando a branch de trabalho na `demo` por pull request no GitHub (base `demo`), o que gera um commit novo com o seu nome; a Vercel publica cada commit novo da `demo` e ignora commit que já teve deploy. Deploy cancelado não aparece na lista de **Deployments**; o estado de um commit aparece na janela **Create Deployment**.

| Variável | Valor | Secret |
|---|---|---|
| `APP_ENV` | `demo` | não |
| `APP_BASE_URL` | `https://rhopenfinancebrasil.com` | não |
| `DATABASE_URL` | URL do papel `rh_app`, com pool (passo 1.4) | sim |
| `DATABASE_OWNER_URL` | URL do papel `rh_owner`, direta (passo 1.4) | sim |
| `DATABASE_TZ_OPTION` | `off` (o fuso vem do papel e do banco) | não |
| `DATABASE_POOL_MAX` | `3` | não |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | sim |
| `CPF_ENC_KEY_V1` | `openssl rand -base64 32` | sim |
| `CPF_HMAC_KEY_V1` | `openssl rand -base64 32` | sim |
| `CPF_KEY_VERSION` | `1` | não |
| `IMPORT_ENC_KEY_V1` | `openssl rand -base64 32` | sim |
| `CRON_SECRET` | `openssl rand -hex 32` | sim |
| `EMAIL_TRANSPORT` | `none` | não |
| `EMAIL_FROM` | `Portal do Colaborador <nao-responda@rhopenfinancebrasil.com>` | não |
| `TRUSTED_IP_HEADER` | `x-real-ip` | não |
| `PASSWORD_BREACH_CHECK` | `on` | não |
| `LOG_LEVEL` | `info` | não |
| `DEMO_ADMIN_PASSWORD` | Senha da conta de administração (regras abaixo) | sim |
| `DEMO_PASSWORD` | Senha das demais contas de demonstração, diferente da anterior (regras abaixo) | sim |
| `DEMO_EMAIL_DOMAIN` | `demo.rhopenfinancebrasil.com` (opcional; é o padrão) | não |

Gere as chaves no Terminal do Mac com os comandos indicados; cada chave é diferente das outras. Regras das senhas de demonstração (política de senha do portal): frase de 15 a 128 caracteres; no máximo 10 dígitos no total; sem as palavras admin, administração, demonstração, colaboradora, gestor, diretor ou diretora; fora de listas de senhas vazadas e de senhas comuns.

4. No log do build do deploy de `demo` devem aparecer, nesta ordem: `migrações aplicadas`, `banco conferido: papel rh_app, banco rh_demo, fuso America/Sao_Paulo, btree_gist presente, auditoria só de inserção` e `dados de demonstração criados: 5 contas, N reservas`. Qualquer falha interrompe o deploy e diz o que ajustar. Atenção: se a falha acontecer depois de `migrações aplicadas`, o banco já foi migrado; a versão no ar continua a anterior. Por isso, toda migração da demonstração precisa ser compatível com o código anterior.
5. Em **Settings, Cron Jobs**, confira a tarefa `/api/cron/operacao`. Em **Logs**, confira uma execução com resposta 200 no horário da agenda. Resposta 401 indica `CRON_SECRET` ausente ou diferente.
6. Depois do primeiro deploy com os dados criados, apague `DEMO_ADMIN_PASSWORD`, `DEMO_PASSWORD` e `DATABASE_OWNER_URL` das variáveis da Vercel. Sem a URL do dono, os deploys seguintes não migram o banco e dizem isso no log. Quando uma atualização autorizada trouxer migração nova, cadastre a URL do dono de novo, publique e apague em seguida.

## 4. Domínio

1. Em **Settings, Domains**, adicione `rhopenfinancebrasil.com` e `www.rhopenfinancebrasil.com`, com redirecionamento do `www` para o domínio sem `www` (`PAR-19`).
2. A Vercel mostra os registros de DNS a criar. Crie exatamente esses registros no painel do registrador do domínio. O HTTPS é emitido pela Vercel quando o DNS propagar.

## 5. Primeiro acesso e roteiro da apresentação

Contas criadas (emails no domínio de demonstração; senhas das variáveis `DEMO_*`):

| Conta | Perfil | Serve para mostrar |
|---|---|---|
| `admin@demo.rhopenfinancebrasil.com` | Administração, RH e Facilities | Cadastro, acessos, auditoria, planta, exclusividade, reservas e fila. No primeiro acesso, o portal exige o cadastro do segundo fator num aplicativo autenticador; só então as telas administrativas abrem |
| `colaboradora@demo.rhopenfinancebrasil.com` | Colaboradora | Mapa, reserva, semana, fila de espera, salas, confirmação de uso, perfil |
| `gestor@demo.rhopenfinancebrasil.com` | Gestor da colaboradora | Meu time, depois que a colaboradora autorizar no perfil |
| `diretora@demo.rhopenfinancebrasil.com` | Diretora, titular da mesa M001 | Mesa de uso exclusivo |
| `diretor@demo.rhopenfinancebrasil.com` | Diretor, integrante do grupo da diretoria | Política de grupo |

A carga também cria 24 pessoas fictícias sem acesso, que ocupam mesas compartilhadas no dia do deploy e no seguinte, para o mapa não aparecer vazio. A planta é a extração não validada da planta R00 (`RSK-26`).

Cuidados na apresentação:
* Os emails das contas estão neste roteiro, que é versionado. Qualquer pessoa pode errar a senha cinco vezes e travar uma conta por 10 minutos (`PAR-11`). Entregue as senhas só a quem vai apresentar; se uma conta travar, use outra ou aguarde.
* A mesma `DEMO_PASSWORD` vale para quatro contas. Quem a tiver pode trocar a senha de uma delas; sem email, não há recuperação, e a saída é recomeçar do zero (seção 6, alguns minutos).
* Nenhum email é enviado: uma pessoa cadastrada ao vivo recebe convite registrado como "não enviado" e não consegue entrar. Mostre o cadastro e use as contas de demonstração para o restante.
* A demonstração não tem as funções da Etapa 4, e a Etapa 3 ainda aguarda validação.

## 6. Recomeçar do zero

1. Na Vercel, cadastre de novo `DATABASE_OWNER_URL`, `DEMO_ADMIN_PASSWORD` e `DEMO_PASSWORD` (seção 3).
2. No SQL Editor do Neon, no banco `neondb`, rode `DROP DATABASE rh_demo WITH (FORCE);` e depois os Blocos 2 e 3 de `demo-neon.sql`.
3. Na Vercel, **Deployments**, refaça o último deploy de produção (Redeploy). O build recria o esquema e os dados fictícios. Depois, repita o passo 3.6.

Se o build acusar "o banco tem pessoas mas não tem a marca de conclusão da carga", uma carga anterior foi interrompida: recomece do zero como acima.

## 7. Retirar do ar

Na Vercel, remova o domínio do projeto (ou apague o projeto) e, no registrador, apague os registros de DNS criados na seção 4. No Neon, apague o projeto. Nada disso afeta o repositório.

## Passagem para o TI da Associação

A demonstração usa o mesmo código que o TI vai operar. Para produção, o que muda é a implantação, não o código: processo de fundo contínuo (`pnpm worker:outbox`) em vez da tarefa agendada; migrações num passo próprio, fora do processo web, sem a credencial do dono no ambiente de execução; email transacional com SPF, DKIM e DMARC; dados reais, backups e teste de restauração; domínio da Associação (por exemplo, um subdomínio de openfinancebrasil.org.br com link no site institucional) e, se desejado, entrada com a conta corporativa (SSO). Esse pacote é a Etapa 5 do plano (`plano-de-entregas.md`).
