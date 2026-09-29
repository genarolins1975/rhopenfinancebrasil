# Demonstração em rhopenfinancebrasil.com (Vercel Pro e Neon)

Roteiro para publicar o portal como demonstração do conceito, com dados fictícios (`DEC-45`). Não é produção nem piloto: nenhuma pessoa real, nenhum CPF real, nenhum email enviado. A publicação e a alteração de DNS só acontecem com a autorização registrada em `../decisoes/registro-de-decisoes.md` (regra 10 do `CLAUDE.md`).

## O que roda onde

| Parte | Onde | Observação |
|---|---|---|
| Portal (Next.js) | Vercel, projeto novo, região das funções São Paulo (`gru1`, fixada em `vercel.json`) | Deploy só da branch de produção; prévias de outras branches não são construídas |
| Banco PostgreSQL 16 | Neon, região AWS São Paulo (`aws-sa-east-1`) | Conexão direta, sem pool (o pool do Neon não aceita os ajustes de sessão do portal) |
| Migrações e dados fictícios | No build de produção (`pnpm vercel-build`) | Idempotente: a segunda vez não altera nada |
| Emails e varreduras da fila | Tarefa agendada da Vercel a cada minuto em `/api/cron/operacao`, fechada por `CRON_SECRET` | Com `EMAIL_TRANSPORT=none`, nada é enviado; as notificações ficam registradas como bloqueadas |

## 1. Banco no Neon

1. Em neon.com (ou pela aba Storage da Vercel, integração Neon), crie um projeto com PostgreSQL 16 na região **AWS São Paulo (aws-sa-east-1)**.
2. Abra o **SQL Editor** do projeto, no banco padrão (`neondb`), e rode o arquivo `demo-neon.sql` deste diretório em três blocos, um de cada vez, como está indicado nele.
3. Copie as duas senhas que o Bloco 1 mostra (`senha_rh_owner`, `senha_rh_app`) para um cofre de senhas. Elas não aparecem de novo.
4. Em **Connect**, com o pool de conexões **desligado**, copie o endereço do servidor (sem `-pooler` no nome). Monte as duas URLs:
   * `DATABASE_OWNER_URL`: `postgresql://rh_owner:<senha_rh_owner>@<servidor>/rh_demo?sslmode=require`
   * `DATABASE_URL`: `postgresql://rh_app:<senha_rh_app>@<servidor>/rh_demo?sslmode=require`

## 2. Projeto na Vercel

1. **Add New, Project**, importe o repositório `genarolins1975/rhopenfinancebrasil`. A Vercel detecta Next.js e pnpm; o `vercel.json` do repositório define o build, a região e a tarefa agendada.
2. Antes do primeiro deploy, em **Settings, Environments, Production**, defina a branch de produção como `claude/new-session-0rzo0n` (ou `main`, se o conteúdo for levado para lá).
3. Em **Settings, Environment Variables**, cadastre as variáveis abaixo **só no ambiente Production**. Gere as chaves no Terminal do Mac com os comandos indicados; cada chave é diferente das outras.

| Variável | Valor |
|---|---|
| `APP_ENV` | `demo` |
| `APP_BASE_URL` | `https://rhopenfinancebrasil.com` |
| `DATABASE_URL` | URL do papel `rh_app` (passo 1.4) |
| `DATABASE_OWNER_URL` | URL do papel `rh_owner` (passo 1.4) |
| `DATABASE_TZ_OPTION` | `off` (o fuso já vem do papel e do banco) |
| `DATABASE_POOL_MAX` | `3` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `CPF_ENC_KEY_V1` | `openssl rand -base64 32` |
| `CPF_HMAC_KEY_V1` | `openssl rand -base64 32` |
| `CPF_KEY_VERSION` | `1` |
| `IMPORT_ENC_KEY_V1` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `EMAIL_TRANSPORT` | `none` |
| `EMAIL_FROM` | `Portal do Colaborador <nao-responda@rhopenfinancebrasil.com>` |
| `TRUSTED_IP_HEADER` | `x-real-ip` |
| `PASSWORD_BREACH_CHECK` | `on` |
| `LOG_LEVEL` | `info` |
| `DEMO_ADMIN_PASSWORD` | Senha da conta de administração: frase de 15 a 128 caracteres, sem 11 dígitos seguidos e sem as palavras admin, administração, demonstração, colaboradora, gestor, diretor ou diretora (política de senha do portal, que vale para as contas de demonstração) |
| `DEMO_PASSWORD` | Senha das demais contas de demonstração, diferente da anterior, mesmas regras |
| `DEMO_EMAIL_DOMAIN` | `demo.rhopenfinancebrasil.com` (opcional; é o padrão) |

4. Faça o deploy. No log do build devem aparecer, nesta ordem: `migrações aplicadas`, `banco conferido: papel rh_app, fuso America/Sao_Paulo, btree_gist presente, auditoria só de inserção` e `dados de demonstração criados: 5 contas, N reservas`. Qualquer outra mensagem de falha interrompe o deploy sem publicar nada; ela diz o que ajustar.
5. Em **Settings, Cron Jobs**, confira a tarefa `/api/cron/operacao` a cada minuto.

## 3. Domínio

1. Em **Settings, Domains**, adicione `rhopenfinancebrasil.com` e `www.rhopenfinancebrasil.com` (com redirecionamento do `www` para o domínio sem `www`, `PAR-19`).
2. A Vercel mostra os registros de DNS a criar. Crie exatamente esses registros no painel do registrador do domínio. O HTTPS é emitido pela Vercel quando o DNS propagar.

## 4. Primeiro acesso e roteiro da apresentação

Contas criadas (emails no domínio de demonstração; senhas das variáveis `DEMO_*`):

| Conta | Perfil | Serve para mostrar |
|---|---|---|
| `admin@demo.rhopenfinancebrasil.com` | Administração, RH e Facilities | Cadastro, acessos, auditoria, planta, exclusividade, reservas e fila. No primeiro acesso, o portal exige o cadastro do segundo fator num aplicativo autenticador; só então as telas administrativas abrem |
| `colaboradora@demo.rhopenfinancebrasil.com` | Colaboradora | Mapa, reserva, semana, fila de espera, salas, confirmação de uso, perfil |
| `gestor@demo.rhopenfinancebrasil.com` | Gestor da colaboradora | Meu time, depois que a colaboradora autorizar no perfil |
| `diretora@demo.rhopenfinancebrasil.com` | Diretora, titular da mesa M001 | Mesa de uso exclusivo |
| `diretor@demo.rhopenfinancebrasil.com` | Diretor, integrante do grupo da diretoria | Política de grupo |

A carga também cria 24 pessoas fictícias sem acesso, que ocupam mesas compartilhadas hoje e amanhã (dia do deploy), para o mapa não aparecer vazio. A planta é a extração não validada da planta R00 (`RSK-26`).

O que a demonstração não faz: não envia email (convites de novas pessoas ficam registrados como não enviados); não tem as funções da Etapa 4; a Etapa 3 ainda aguarda validação.

## 5. Recomeçar do zero

No SQL Editor do Neon, rode `DROP DATABASE rh_demo WITH (FORCE);` e depois os Blocos 2 e 3 de `demo-neon.sql`. Na Vercel, **Deployments**, refaça o último deploy de produção (Redeploy). O build recria o esquema e os dados fictícios.

Se o build acusar "o banco tem pessoas mas não tem a marca de conclusão da carga", uma carga anterior foi interrompida: recomece do zero como acima.

## 6. Retirar do ar

Na Vercel, remova o domínio do projeto (ou pause o projeto) e, no registrador, apague os registros de DNS criados no passo 3. No Neon, apague o projeto. Nada disso afeta o repositório.

## Passagem para o TI da Associação

A demonstração usa o mesmo código que o TI vai operar. Para produção, o que muda é a implantação, não o código: processo de fundo contínuo (`pnpm worker:outbox`) em vez da tarefa agendada, email transacional com SPF, DKIM e DMARC, dados reais e backups com teste de restauração, domínio da Associação (por exemplo, um subdomínio de openfinancebrasil.org.br com link no site institucional) e, se desejado, entrada com a conta corporativa (SSO). Esse pacote é a Etapa 5 do plano (`plano-de-entregas.md`).
