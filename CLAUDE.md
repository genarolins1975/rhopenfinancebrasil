# Portal do Colaborador da Associação Open Finance Brasil

Domínio adquirido: rhopenfinancebrasil.com. Etapa 0 (definição) validada em 28/09/2026. Etapa 1 (fundação) validada em 29/09/2026. Etapa 2 (núcleo do escritório) validada em 29/09/2026. Etapa 3 (operação) em andamento desde 29/09/2026.

## Estado atual
Consulte `docs/00-estado-do-projeto.md` antes de qualquer ação. Ele registra o que foi feito, testado, revisado e o que falta. Mapa da documentação em `docs/README.md`.

## Stack
Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind 4, PostgreSQL com Drizzle ORM e migrações SQL, Better Auth 1.7 (sem plugin admin), pino, Vitest, Playwright com axe. Node 22 ou superior; pnpm.

## Comandos reais
```
cp .env.example .env            # preencher segredos com openssl rand -base64 32
pnpm install
pnpm db:migrate                 # migrações como papel dono (DATABASE_OWNER_URL)
pnpm dev                        # http://localhost:3000
pnpm worker:outbox              # entrega de emails e revogações pendentes
pnpm bootstrap:admin --email <email> --name "<nome>" --cpf <cpf>
pnpm typecheck && pnpm lint
pnpm test:unit                  # sem banco
pnpm test:integration           # PostgreSQL local, banco rh_test, .env.test
pnpm build && pnpm test:e2e     # Playwright contra build de produção, porta 3100
pnpm db:generate                # nova migração a partir do esquema Drizzle
```
Banco local: cluster PostgreSQL 16 com papéis `rh_owner` (migrações) e `rh_app` (aplicação), bancos `rh_dev` e `rh_test`, ambos com `timezone = America/Sao_Paulo`.

## Onde as coisas vivem
`src/modules/<módulo>` tem a regra de negócio (identity, access, employees, audit, notifications, admin, workplace, availability, booking, exclusivity, office). `src/app` só orquestra e renderiza. `src/db/schema` e `src/db/migrations` são a única fonte do esquema; funções, triggers e constraints de exclusão do escritório vivem nas migrações manuais `0004` a `0006`. `src/components` não decide autorização. Toda mutação do escritório passa por `withOfficeTx` (locks, revalidação, tradução de erro) e pelo diálogo de conflito de `office/conflicts.ts`.

## Invariantes do projeto (não negociáveis)
1. Toda regra de autorização e disponibilidade vive no servidor. A interface só reflete o que o servidor decidiu.
2. Mesa com política exclusiva nunca aparece como disponível, recomendada, oferecida pela fila ou reservável para quem não é titular ou integrante autorizado, salvo exceção vigente registrada. Ausência do titular não libera a mesa.
3. Política de acesso, situação operacional e reserva são dimensões separadas. Nenhum campo único representa as três.
4. Toda mutação que envolve mesa (reserva, cancelamento, atribuição exclusiva, exceção, bloqueio, manutenção) serializa por recurso na mesma transação e revalida antes de confirmar. Ordem de locks documentada em `docs/dados/modelo-de-dados.md`.
5. Conflito nunca é resolvido em silêncio: reservas incompatíveis são exibidas e tratadas com decisão explícita, motivo e trilha de auditoria.
6. CPF é dado separado, cifrado em repouso, mascarado por padrão, ausente de logs, URLs, analytics, erros, notificações, exportações comuns e dados de demonstração.
7. Cadastro fechado. Não existe autorregistro. Convite individual, expirável e de uso único.
8. Instantes em UTC; datas e regras em `America/Sao_Paulo`; relógio do servidor. `current_date` é proibido em SQL; use `local_today()`.
9. Dados dos PDFs históricos são referências agregadas, nunca base de usuários ou séries individuais.
10. Nenhuma publicação em produção, alteração de DNS, envio em massa ou contratação sem autorização explícita registrada em `docs/decisoes/registro-de-decisoes.md`.
11. Verificar formato e dígitos do CPF não verifica identidade. CPF nunca é chave pública, nome de usuário, componente de senha ou resposta de recuperação. Nenhuma senha deriva de CPF ou de sufixo fixo.
12. O sistema jamais exibe senhas atuais a ninguém, ADM incluído. Registra eventos de segurança, não senhas nem tokens.
13. Intenção presencial não garante mesa. Ausência de reserva não indica falta ao trabalho. Confirmação de uso não é presença física, ponto nem produtividade.
14. Pela rede, o handler de autenticação só serve o verificador de email; tudo o mais passa por server actions com `auth.api`. O plugin admin do Better Auth não é montado.

## Regras de execução
Executor e Revisor são papéis separados. Cada entrega: especificar, implementar, testar, revisar, corrigir, testar novamente, registrar aceite em `docs/testes/aceite.md`. Reportar apenas testes realmente executados. Nunca versionar `.env`, PDFs ou `.e2e-state.json`.

Regras específicas do Next.js instalado estão em `AGENTS.md` (gerado pelo próprio Next).
