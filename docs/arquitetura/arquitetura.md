# Arquitetura recomendada

Referência: 28/09/2026. Projeto novo, sem stack anterior a respeitar. Direção: monólito modular, banco relacional, serviços gerenciados proporcionais. Nenhuma contratação está autorizada por este documento.

## Stack proposta com versões verificadas

| Componente | Escolha | Versão verificada | Fonte e data | Observação |
|---|---|---|---|---|
| Runtime | Node.js 24 (Active LTS) | 24 em Active LTS até 20/10/2026, manutenção até 30/04/2028 | nodejs/Release `schedule.json`, 28/09/2026 | Ambiente atual tem 22.22.2 (Maintenance LTS até 30/04/2027), compatível com tudo abaixo |
| Framework | Next.js (App Router) | 16.3.6 | npm, 27/09/2026; docs exigem Node 20.9 ou superior | Turbopack padrão; lint não roda no build |
| UI | React | 19.3.0 | npm, 23/09/2026 | |
| Linguagem | TypeScript | a definir na Etapa 1 entre 5.9 e 7.0.2 conforme compatibilidade do toolchain do Next | npm, 28/09/2026 | |
| Banco | PostgreSQL 18 | 18.6, suportado até 14/11/2030 | postgresql.org/support/versioning, 28/09/2026 | Se o provedor não oferecer 18, usar 17 (suporte até 08/11/2029). Ambiente local tem 16.13 para testes |
| Acesso a dados | Drizzle ORM com driver `pg` | `drizzle-orm` 0.45.3, `drizzle-kit` 0.31.11, `pg` 8.23.0 | npm, 21/09/2026 e 08/08/2026 | 1.0 está em release candidate; ficar na linha estável |
| Autenticação | Better Auth | 1.7.6 | npm, 24/09/2026 | Plugins: two factor, admin, have i been pwned; SSO depois |
| Hash de senha | Argon2id via `@node-rs/argon2` | 2.2.1 | npm, 10/09/2026 | Better Auth usa scrypt por padrão; será substituído por `password.hash` e `password.verify` |
| Fila e agendamento | `pg-boss` | 12.35.0, exige Node 22.12 ou superior | npm, 26/09/2026 | Roda sobre o próprio PostgreSQL |
| Validação | zod | 4.6.5 | npm, 25/09/2026 | |
| Datas | `date-fns` e `@date-fns/tz` | 4.4.0 e 1.5.0 | npm, 29/05/2026 e 21/05/2026 | Interpretação em `America/Sao_Paulo` |
| Estilo | Tailwind CSS com tokens em variáveis CSS | 4.3.3 | npm, 25/09/2026 | |
| Testes | Vitest, Playwright, axe | 5.0.2, 1.63.0, `@axe-core/playwright` 4.13.0 | npm, 25/09/2026, 28/09/2026, 02/09/2026 | Integração com PostgreSQL real |
| Logs | pino com redação de campos | 10.3.1 | npm, 15/08/2026 | |
| Email | nodemailer (SMTP) atrás de interface própria | 10.0.12 | npm, 28/09/2026 | Provedor pendente de decisão |

Alternativas avaliadas: Prisma 7.10.0 (Prisma 8 em RC) no lugar do Drizzle; descartada por preferir SQL explícito para constraints de exclusão, locks e triggers. Kysely 0.29.6 como query builder puro; descartado por não trazer migrações integradas. Auth.js e provedores gerenciados (Auth0, Clerk, Keycloak) no lugar do Better Auth; Auth.js não gerencia senha local, os gerenciados implicam contratação e envio de dados de identidade a terceiro sem decisão do encarregado.

## Por que Better Auth atende aos requisitos de acesso

Verificado na documentação oficial em 28/09/2026:

* `emailAndPassword.disableSignUp` fecha o cadastro. Contas só nascem no servidor, pelo módulo de colaboradores.
* `password.hash` e `password.verify` permitem Argon2id. Parâmetros propostos: m = 47104 KiB, t = 1, p = 1 ou m = 19456 KiB, t = 2, p = 1, conforme o cheat sheet OWASP. Pepper opcional em cofre de segredos, decisão pendente.
* `minPasswordLength` 15 e `maxPasswordLength` 128 atendem ao mínimo de 15 e ao suporte a pelo menos 64.
* `requireEmailVerification`, `revokeSessionsOnPasswordReset`, `resetPasswordTokenExpiresIn` cobrem verificação, revogação e validade de tokens.
* Limitação de tentativas com armazenamento em banco (não em memória) e regras por rota.
* Plugin two factor com TOTP e códigos de recuperação; a obrigatoriedade para perfis administrativos será imposta por hook no servidor antes de qualquer rota `/admin`.
* Plugin admin fornece `createUser`, `banUser`, `revokeUserSessions`, `setUserPassword`. Serão chamados apenas do lado do servidor, depois da verificação de permissão própria do portal. `impersonateUser` não será habilitado.
* Plugin have i been pwned bloqueia senhas comprometidas enviando apenas os cinco primeiros caracteres do SHA1 (k anonimato). Depende de aceite do encarregado, pois envolve chamada a serviço externo.
* Plugin SSO (OIDC, SAML) pode ser adicionado depois sem alterar o esquema de usuários, o que prepara a integração com identidade corporativa sem presumir fornecedor.

O que Better Auth não faz e o portal fará: convite individual expirável de uso único (tabela própria com hash do token), matriz de permissões por recurso e vigência, separação de atribuições, auditoria de negócio.

## Módulos do monólito

```
src/
  app/                 rotas Next.js (público, portal, admin); só orquestra e renderiza
  modules/
    identity/          Better Auth, sessão, MFA, convites, recuperação
    employees/         colaboradores, áreas, vínculos, CPF protegido, importação CSV
    access/            perfis, permissões, concessões com vigência, função can()
    workplace/         planta, versões, recursos, zonas, situação operacional, bloqueios, calendário
    exclusivity/       atribuições exclusivas, exceções, revisão de vínculo, conflitos
    availability/      serviço central de disponibilidade e autorização de uso
    booking/           reservas de mesa por dia, salas e cabines por intervalo, semana atômica
    waitlist/          fila, ofertas, retenções
    checkin/           confirmação declarada de uso, QR
    helpdesk/          atendimentos, mensagens, notas internas, anexos, ocorrências
    content/           benefícios, guia, avisos, versões, aprovação
    listening/         pesquisas, respostas, agregação com supressão
    actions/           plano "Vocês disseram. Estamos fazendo."
    notifications/     outbox, entregas, preferências
    audit/             eventos de auditoria, somente inserção
    integrations/      email, armazenamento, calendário (futuro), identidade corporativa (futuro)
  components/          componentes de interface sem regra de negócio
  design/              tokens e primitivas acessíveis
  db/                  esquema Drizzle, migrações SQL, seeds sintéticos
```

Regras: componentes não decidem autorização nem disponibilidade; toda mutação passa por um serviço de módulo que abre a transação, aplica locks na ordem documentada, revalida e grava auditoria; server actions e route handlers só validam entrada, derivam identidade da sessão e delegam.

## Ambientes

| Ambiente | Banco | Dados | Email | Acesso |
|---|---|---|---|---|
| Desenvolvimento | PostgreSQL local ou container | Sintéticos com prefixo `DEMO` | Capturado localmente, nunca enviado | Desenvolvedor |
| Homologação | Instância própria | Sintéticos | Provedor em modo restrito a lista de destinatários de teste | RH, Facilities, ADM designados |
| Produção | Instância própria, backups e teste de restauração | Reais | Provedor com SPF, DKIM e DMARC | Colaboradores |

Segredos fora do repositório, por ambiente. Chave de cifra do CPF e chave do HMAC separadas entre si e do banco.

## Domínio e publicação

`rhopenfinancebrasil.com` como canônico, HTTPS obrigatório, redirecionamento de `www` para o apex (proposto), callbacks de autenticação restritos ao domínio canônico. Domínio adquirido não comprova DNS, hospedagem ou email configurados: cada um é item de decisão. Área pública limitada à entrada e aos fluxos de autenticação e privacidade. Bloqueio de indexação é complementar à autorização.

## Notificações confiáveis

Toda notificação nasce como linha em `outbox_event` na mesma transação da operação de negócio. Um worker `pg-boss` consome a outbox, entrega com chave de idempotência, registra tentativa, erro e próxima tentativa, e expõe falhas no painel administrativo. Email indisponível não corrompe a reserva nem produz confirmação falsa: a interface mostra "confirmada" com base no banco e "notificação pendente" com base na outbox.

## Armazenamento de anexos

Bucket privado compatível com S3, provedor pendente. Validação de tipo por assinatura de conteúdo e tamanho (limite proposto de 10 MB por arquivo), sem execução de arquivos ativos, download por URL assinada de curta duração emitida apenas após autorização no servidor. Nada em `public/`.

## Custo operacional indicativo

Preços de lista consultados nas páginas oficiais em 28/09/2026, em dólares, sem impostos, sem compromisso. Não são cotação.

| Opção | Componentes | Custo mensal de lista |
|---|---|---|
| A | Vercel Pro (USD 20 por seat de desenvolvedor, com USD 20 de crédito de uso) mais Neon Launch (compute USD 0,106 por CU hora, armazenamento USD 0,35 por GB mês, restauração pontual USD 0,20 por GB mês) | Entre USD 30 e USD 80 para a carga estimada de uma associação, dependendo do consumo |
| B | Railway Pro (USD 20 com USD 20 de uso incluído; CPU cerca de USD 20 por vCPU mês, memória cerca de USD 10 por GB mês, volume USD 0,15 por GB mês) com PostgreSQL no próprio Railway | Entre USD 20 e USD 60 |
| C | Supabase Pro (USD 25, banco de 8 GB, backups diários de 7 dias; restauração pontual USD 100 adicionais) mais hospedagem da aplicação em A ou B | Entre USD 45 e USD 130 |
| D | Servidor virtual com Docker Compose (aplicação, PostgreSQL, `pg-boss`) | Depende do provedor; exige operação própria de backup e atualização |

Pontos a validar antes de escolher: região de dados no Brasil, política de backup e restauração, contrato de tratamento de dados com o provedor, custo de email transacional e de armazenamento privado. Recomendação preliminar: opção A ou B para piloto, por baixo custo e operação simples; decisão registrada como pendente.

## Observabilidade e operação

Logs estruturados com redação de CPF, tokens, senhas e conteúdo de atendimentos. Auditoria de negócio em tabela própria, somente inserção. Rastreamento de erros por serviço externo é decisão pendente por envolver envio de dados a terceiro. Backups diários com teste de restauração documentado antes do piloto. Procedimento de incidente e responsável pela operação registrados em `../operacao/privacidade-e-protecao-de-dados.md`.

## Testes

* Unitários: regras puras (cálculo de disponibilidade, vigências, supressão de grupos pequenos, normalização de CPF).
* Integração com PostgreSQL real: constraints, triggers, transações, ordem de locks, idempotência.
* Concorrência: sessões distintas disparando reserva e trava simultâneas com barreira de sincronização; disputa pela última vaga com N clientes.
* Ponta a ponta: Playwright com axe em cada fluxo prioritário.
* Sem daemon Docker nesta sessão; a integração usará o cluster PostgreSQL 16 local. Em CI, container oficial do PostgreSQL 18.
