# Matriz requisito, implementação e teste

Referência: 28/09/2026. Coluna "Implementação" aponta o módulo previsto enquanto não há código; passa a apontar arquivos quando existir. Coluna "Status": pendente, implementado, testado, aceito. Tipos de teste: U (unitário), I (integração com banco), C (concorrência com sessões distintas), E (ponta a ponta), A (acessibilidade), M (manual).

## Exclusividade (casos obrigatórios do prompt §23, resultado transcrito literalmente)

| Caso | Requisito | Implementação prevista | Teste | Tipo | Resultado obrigatório | Status |
|---|---|---|---|---|---|---|
| Colaborador tenta reservar mesa individual da diretoria | `DIR-008`, `DIR-021`, `DIR-022` | `src/modules/availability/rules.ts`, `booking/service.ts` | `DIR-008-T1` em `booking.test.ts`; `DIR-008-T2` (semana) em `booking.test.ts` BKG-02; `DIR-008-T3` por fila em `waitlist.test.ts` (DIR-025-T1: oferta automática, varredura e oferta manual recusam a mesa exclusiva); `office.spec.ts` | I, E | Negação no servidor, por qualquer rota. | testado (29/09/2026) |
| Usuário altera IDs no pedido | `DIR-022` | `booking/service.ts`, `office/shared.ts` | `DIR-022-T1` em `booking.test.ts` | I | Sem acesso à mesa, reserva ou pessoa não autorizada. | testado (29/09/2026) |
| Diretor titular reserva sua mesa | `DIR-009` | `booking/service.ts` | `DIR-009-T1` em `booking.test.ts`; `office.spec.ts` | I, E | Permitido se operacional e sem conflito. | testado (29/09/2026) |
| Outro diretor tenta essa mesma mesa | `DIR-002` | `availability/rules.ts` | `DIR-002-T1` em `booking.test.ts`; `office.spec.ts` | I | Negado sem exceção específica. | testado (29/09/2026) |
| Integrante autorizado reserva mesa exclusiva de grupo | `DIR-010` | `availability/rules.ts`, `booking/service.ts` | `DIR-010-T1` e `T2` em `booking.test.ts` | I | Permitido conforme política e disponibilidade. | testado (29/09/2026) |
| RH trava mesa sem reservas incompatíveis | `DIR-004`, `DIR-021` | `exclusivity/service.ts` | `DIR-004-T1` em `exclusivity.test.ts` (mapa, lista e reserva refletem); `office.spec.ts` | I, E | Restrição aplicada de forma consistente a todos os canais. | testado (29/09/2026) |
| RH trava mesa com reservas incompatíveis | `DIR-016` | `exclusivity/service.ts`, `office/conflicts.ts` | `DIR-016-T1` a `T3` em `exclusivity.test.ts`; `office.spec.ts` (prévia, decisão e histórico) | I, E | Conflito explícito; nenhuma exclusão silenciosa. | testado (29/09/2026) |
| RH trava enquanto colaborador reserva | `DIR-024` | `office/shared.ts`, migração `0004` (triggers) | `DIR-024-T1` (50 repetições) em `office-concurrency.test.ts`; `DIR-024-T2` em `office-db.test.ts` | C, I | Apenas um resultado serializável e coerente; sem reserva proibida coexistente. | testado (29/09/2026) |
| Diretor cancela ou não faz check-in | `DIR-006` | `booking/service.ts` | `DIR-006-T1` em `booking.test.ts`; `DIR-006-T2` em `checkin.test.ts` (liberação por falta de confirmação desativada por padrão; ativada, nunca toca mesa exclusiva) | I | Exclusividade permanece. | testado (29/09/2026) |
| Fila procura vaga para funcionário comum | `DIR-025` | `availability/service.ts` | `DIR-025-T0` em `booking.test.ts`; `DIR-025-T1` em `waitlist.test.ts`; invariante `ofertaDeMesaExclusiva` em `waitlist-concurrency.test.ts` | I, C | Mesa exclusiva não é oferecida sem exceção válida. | testado (29/09/2026) |
| Liberação temporária expira | `DIR-013` | `availability/rules.ts`, funções SQL | `DIR-013-T1` em `booking.test.ts` e `office-db.test.ts` (vigência, sem job) | U, I | Política exclusiva volta pela vigência, mesmo sem execução de job. | testado (29/09/2026) |
| Mesa exclusiva entra em manutenção | `DIR-020` | `availability/rules.ts` | `DIR-020-T1` e `T2` em `booking.test.ts`; `DIR-003-T1` em `exclusivity.test.ts` | I | Reserva impedida também para o titular. | testado (29/09/2026) |
| Titular é desativado | `DIR-018` | `employees/service.ts`, `exclusivity/service.ts` | `DIR-018-T1` em `exclusivity.test.ts` (inclui liberação vigente com reserva de terceiro, gestor comunicado e integrante de grupo desativado) | I | Acesso revogado e vínculo sinalizado para RH; mesa não liberada automaticamente. | testado (29/09/2026); ponta a ponta da desativação pendente |
| Usuários disputam a última vaga | `DIR-023`, `DIR-024` | `booking/service.ts`, índices únicos | `DIR-023-T1` (10 sessões) em `office-concurrency.test.ts` | C | Uma confirmação; demais recebem conflito correto. | testado (29/09/2026) |
| Capacidade combina exclusividade e manutenção | `DIR-026` | `availability/rules.ts` (`deskClass`), `capacityOn` | `DIR-026-T1` e `T2` em `tests/unit/availability.test.ts` | U | Sem dupla contagem ou indicador de presença fictício. | testado (29/09/2026) |

## Demais regras DIR

| Requisito | Implementação prevista | Teste | Tipo | Status |
|---|---|---|---|---|
| `DIR-003` dimensões separadas | `workplace`, `exclusivity` | `db/schema/office.ts` | `DIR-003-T1` em `exclusivity.test.ts` | testado (29/09/2026) |
| `DIR-005` vínculo não é reserva | `availability` | `availability/rules.ts` | `DIR-005-T1` em `tests/unit/availability.test.ts` | testado (29/09/2026) |
| `DIR-007` sem recomendação | `availability`, `waitlist` | `DIR-007-T1` em `waitlist.test.ts` (varredura de mesas livres, lista de mesas disponíveis e oferta manual não incluem a exclusiva) | I | testado (29/09/2026) |
| `DIR-011` reserva em nome | `booking`, `access` | `booking/service.ts` | `DIR-011-T1` e `T2` em `booking.test.ts` | testado (29/09/2026) |
| `DIR-012` uma reserva por dia | `booking` | índice `desk_booking_employee_day`, `availability/rules.ts` | `DIR-012-T1` em `booking.test.ts` | testado (29/09/2026) |
| `DIR-014` reserva fora da janela | `availability` | `availability/rules.ts` | `DIR-014-T1` em `booking.test.ts` | testado (29/09/2026) |
| `DIR-015` diretor não remove | `exclusivity`, `access` | `exclusivity/service.ts` | `DIR-015-T1` em `exclusivity.test.ts` | testado (29/09/2026) |
| `DIR-017` transferência e revogação | `exclusivity` | `exclusivity/service.ts`, função `transfer_assignment` | `DIR-017-T1` em `exclusivity.test.ts`; `DIR-017-T2` (revogação de grupo) coberto por `DIR-032-T1` | testado (29/09/2026) |
| `DIR-019` ordem de cálculo | `availability` | `availability/rules.ts` | `DIR-019-T1` em `tests/unit/availability.test.ts` | testado (29/09/2026) |
| `DIR-027` lote atômico | `exclusivity` | `exclusivity/service.ts` (`batchAssign`) | `DIR-027-T1` em `exclusivity.test.ts` | testado (29/09/2026) |
| `DIR-028` auditoria e notificação | `audit`, `notifications` | `exclusivity/service.ts`, `office/conflicts.ts` | `DIR-028-T1` em `exclusivity.test.ts` | testado (29/09/2026) |
| `DIR-029` datas locais | `availability`, `booking` | funções SQL, `availability/rules.ts` | `DIR-029-T1` em `tests/unit/availability.test.ts` e `office-db.test.ts` | testado (29/09/2026) |
| `DIR-030` planta não altera identidade | `workplace` | `workplace/service.ts` (`publishPlan`, `movePlacement`) | `DIR-030-T1` | implementado (29/09/2026); `DIR-030-T1` pendente |
| `DIR-031` função única de elegibilidade | `availability`, `db` (triggers) | `availability/rules.ts`, função `is_eligible` | `DIR-031-T1` em `office-db.test.ts` (mesma tabela de casos no serviço e no banco); `DIR-031-T2` em `booking.test.ts` | testado (29/09/2026) |
| `DIR-032` remoção de integrante do grupo | `exclusivity` | `exclusivity/service.ts` | `DIR-032-T1` em `exclusivity.test.ts`; `DIR-032-T2` em `office-db.test.ts` | testado (29/09/2026) |
| `DIR-033` manutenção, bloqueio, fechamento e desativação sobre reservas | `workplace`, `availability` | `workplace/service.ts`, triggers deferidos | `DIR-033-T1` em `exclusivity.test.ts`; `DIR-033-T2` em `office-db.test.ts`; `DIR-033-T3` em `office-concurrency.test.ts` | testado (29/09/2026) |
| `DIR-034` retenção vencida não trava mesa nem pessoa; oferta nasce no cancelamento | `booking`, `waitlist` | `office/shared.ts` (`expireHolds`) | `DIR-034-T1` em `booking.test.ts`; `DIR-034-T2` em `waitlist.test.ts` (WL-04-T2) | testado (29/09/2026) |
| `DIR-035` resposta sem identificadores de titular | `availability`, `app` | `availability/service.ts` | `DIR-035-T1` em `booking.test.ts`; `office.spec.ts` | testado (29/09/2026) |
| `DIR-036` estado derivado; encerrar não contorna a sobreposição | `exclusivity`, `db` | trigger `exclusive_assignment_validity`, constraint de exclusão | `DIR-036-T1` em `exclusivity.test.ts`; `DIR-036-T2` em `exclusivity.test.ts`; `DIR-036-T3` em `office-db.test.ts` | testado (29/09/2026) |
| Modelo: extensão e constraints existem no catálogo | `src/db/migrations` | `DB-01` em `tests/integration/db.test.ts` | I | testado (29/09/2026) para as Etapas 1 e 2 |
| Modelo: lock imposto por trigger | `db` | migração `0004` | `DIR-024-T2` em `office-db.test.ts` (pares reserva e trava, integrante, fechamento, desativação, manutenção, recurso) | testado (29/09/2026) |
| Modelo: trigger de vigência da atribuição | `db` | migração `0004` | `DIR-036-T3` em `office-db.test.ts` | testado (29/09/2026) |
| Modelo: suspensão mantém reservas, desativação exige tratamento | `db`, `employees` | triggers, `employees/service.ts` | `EMP-02-T1` em `office-db.test.ts` e `exclusivity.test.ts` | testado (29/09/2026) |
| Fila: entrada e oferta obsoletas expiradas de forma preguiçosa; reserva direta oferece à fila antes | `waitlist`, `booking` | `WL-04-T1`, `WL-04-T2`, `WL-04-T3` (semana cede à fila) em `waitlist.test.ts` | I | testado (29/09/2026) |
| Modelo: virada de dia local | `db`, `availability` | funções SQL | `DIR-029-T1` em `office-db.test.ts` | testado (29/09/2026) |
| Modelo: chave da semana por requisição | `booking` | `booking/service.ts` (`planWeek`) | `BKG-02-T4` em `booking.test.ts` | testado (29/09/2026) |
| Modelo: transferência e anulação com restrições | `exclusivity` | função `transfer_assignment`, trigger deferido | `DIR-017-T3` em `office-db.test.ts` | testado (29/09/2026) |

## Acesso, cadastro e CPF

| Requisito | Implementação prevista | Teste | Tipo | Status |
|---|---|---|---|---|
| `REQ-01` convite expirado ou usado | `src/modules/identity/invitations.ts` | `AUT-01-T1`, `AUT-01-T2` em `tests/integration/invitation.test.ts`; `tests/e2e/public.spec.ts` | I, E | testado (29/09/2026) |
| `REQ-01` sem autorregistro | `src/app/api/auth/[...all]/route.ts`, `disabledPaths` | `AUT-02-T1` em `tests/integration/auth-surface.test.ts` | I | testado (29/09/2026) |
| Troca obrigatória de senha temporária, se o fluxo for adotado | não implementado: o fluxo padrão é o convite, sem senha temporária | `AUT-03-T1` | I | não aplicável enquanto o fluxo não for adotado |
| Recuperação sem revelar conta | `src/modules/identity/auth.ts`, `actions.ts` | `AUT-04-T1` em `tests/integration/password-reset.test.ts` | I | testado (29/09/2026); ponta a ponta pendente |
| Limite de tentativas | `src/modules/identity/throttle.ts` e limitador do Better Auth em banco | `AUT-05-T1` em `tests/integration/session-status.test.ts` | I | testado (29/09/2026) |
| MFA obrigatório para admin | `src/modules/access/can.ts` (PAR-33), `session.ts` | `AUT-06-T1` em `tests/integration/two-factor.test.ts`; `tests/e2e/admin.spec.ts` | I, E | testado (29/09/2026) |
| Revogação de sessão em desativação e troca de senha | `src/modules/employees/service.ts`, `auth.ts` | `AUT-07-T1` em `tests/integration/employees.test.ts`, `password-reset.test.ts` e `session-status.test.ts` (troca de senha com `revokeOtherSessions`) | I | testado (29/09/2026) |
| `REQ-23` e `REQ-24` CPF nunca em senha, usuário ou recuperação; senha nunca exibida | `src/modules/identity/password.ts` (política rejeita 11 dígitos) | `AUT-08-T1` em `tests/unit/password.test.ts`; revisão de código | U, M | testado (29/09/2026); revisão pendente |
| Endpoints administrativos de identidade inexistentes | `src/app/api/auth/[...all]/route.ts`, `DEC-13` | `AUT-09-T1` em `tests/integration/auth-surface.test.ts` | I | testado (29/09/2026) |
| Autorização por página e por action no ambiente administrativo (colaboradores, acessos, auditoria, importação, modelo CSV) e sessão de 12 horas para privilegiados em todo o portal (`PAR-42`) | `session.ts` (`requirePermission`, `requireAnyPermission`, `getCurrentResult`) | `tests/e2e/admin.spec.ts` (gestor redirecionado em cada rota administrativa; colaborador comum idem); `tests/integration/privileged-target.test.ts` (RH comum não troca email, não reenvia nem revoga convite de convidada privilegiada, não reativa administrador) | E, I | testado (29/09/2026) |
| Troca de email com confirmação no endereço antigo; link final exige sessão e não emite sessão; cadastro sincronizado, e desfeito se o cadastro recusar; endereço tomado entre os dois links recusado; email já cadastrado recusado; convite revogado ao editar email de convidado; privilégio só após ativo com segundo fator | `auth.ts` (`sendChangeEmailConfirmation`, hooks, `databaseHooks.user.update.after`), `actions.ts`, `service.ts`, `can.ts` | `AUT-10-T1` em `email-change.test.ts` (fluxo completo e conflito entre os links, com log verificado) e `actions.test.ts`; `AUT-10-T2` e `AUT-10-T3` em `employees.test.ts` e `access.test.ts` | I | testado (29/09/2026) |
| Limite por conta com cabeçalho de IP forjado | `throttle.ts` (chave por email, independente de IP) | `AUT-11-T1` em `session-status.test.ts` e `actions.test.ts` (pela própria `signInAction`, com IP variando) | I | testado (29/09/2026) |
| Revogação vale na requisição seguinte (sem cache de sessão) | `auth.ts` (`cookieCache` desativado) | `AUT-12-T1` em `session-status.test.ts` | I | testado (29/09/2026) |
| Segundo fator sem dispositivo confiável (PAR-38, todos) | `auth.ts` (hook remove `trustDevice`) | `AUT-13-T1` em `two-factor.test.ts` | I | testado (29/09/2026) |
| Hook global bloqueia sessão emitida antes da desativação, inclusive nas rotas do próprio Better Auth; revogação retentada pela outbox | `auth.ts` (`hooks.before`), `service.ts` | `AUT-14-T1` em `session-status.test.ts`; `AUT-14-T2` (falha de revogação reenfileirada) | I | parcial: T1 testado; T2 pendente |
| Importação não é oráculo de CPF; detalhe de unicidade redigido; arquivo não persistido | `import.ts` | `CPF-03-T1` e `T3` em `import.test.ts`; `CPF-03-T2` em `db-errors.test.ts` (corrida real de 23505 em `employee_sensitive`, conflito genérico e log capturado sem consulta, sem email e sem CPF); limite de prévias em `import.test.ts` | I | testado (29/09/2026) |
| Cifra com nonce único, AAD por pessoa, versão de chave e rotação em duas fases | `crypto.ts`, `cpf.ts` | `CPF-04-T1` em `tests/unit/crypto.test.ts`; `CPF-04-T2` (procedimento de rotação) | U | parcial: T1 testado; rotação documentada, não automatizada |
| Readmissão reutiliza cadastro e zera credenciais | `service.ts` | `EMP-01-T1` em `employees.test.ts` | I | testado (29/09/2026) |
| `REQ-05` CPF ausente de respostas, logs, erros, exportações | `cpf.ts`, `logger.ts`, `service.ts` | `CPF-01-T1` a `T3` em `employees.test.ts`; logs em `tests/unit/scrub.test.ts`; ponta a ponta em `admin.spec.ts` | U, I, E | testado (29/09/2026) |
| `REQ-05` HMAC para duplicidade e zeros à esquerda | `cpf.ts` | `CPF-02-T1` em `employees.test.ts` e `tests/unit/cpf.test.ts` | U, I | testado (29/09/2026) |
| `REQ-04` sem autopromoção | `grants.ts`, `import.ts` | `ACC-01-T1` em `access.test.ts`; `ACC-01-T2` em `import.test.ts` | I | testado (29/09/2026) |
| Importação CSV com prévia e validação por linha | `import.ts` | `IMP-01-T1` em `import.test.ts`; `admin.spec.ts` | I, E | testado (29/09/2026) |
| `REQ-28` buscas, anexos e exportações sob o mesmo controle de acesso | `content`, `helpdesk`, `access` | `ACC-02-T1` (anexos), `ACC-02-T2` (chamados), `ACC-02-T3` (pesquisas), `ACC-02-T4` (busca e exportação) | I | pendente (Etapa 4) |

## Operação e experiência

| Requisito | Implementação prevista | Teste | Tipo | Status |
|---|---|---|---|---|
| Cancelamento reflete disponibilidade imediatamente | `booking` | `booking/service.ts` | `BKG-01-T1` em `booking.test.ts`; `office.spec.ts` | testado (29/09/2026) |
| Semana atômica e idempotente (`REQ-25` intenção não é reserva) | `booking` | `booking/service.ts` (`planWeek`) | `BKG-02-T1` a `T3` em `booking.test.ts`; `office.spec.ts` | testado (29/09/2026) |
| Salas sem sobreposição e adjacência permitida | `spaces` | `BKG-03-T1` e `BKG-03-T2` (10 sessões) em `spaces.test.ts`; intervalo, limite por recurso, título privado, conflito de manutenção e fechamento; `operation.spec.ts` | I, C, E | testado (29/09/2026) |
| Falha de notificação não corrompe a operação | `outbox.ts` | `NOT-01-T1` em `tests/integration/outbox.test.ts` (carga apagada após a entrega; convite a destinatário fora da lista fica `blocked` na outbox e em `invitation.delivery_status`, sem `sent_at`) | I | testado (29/09/2026) para convites; reservas na Etapa 2 |
| Fila sem dupla oferta e próxima pessoa elegível automática (`REQ-26`) | `waitlist` | `WL-01-T1`, `WL-01-T2` (concorrência), `WL-02-T1` em `waitlist.test.ts`; R10 em `waitlist-concurrency.test.ts`; `operation.spec.ts` | C, I, E | testado (29/09/2026) |
| `REQ-15` confirmação de uso não libera nem remove exclusividade; QR resolve a reserva no servidor | `checkin` | `CHK-01-T1`, `CHK-02-T1` (id de reserva alheia rejeitado, inclusive pelo banco) em `checkin.test.ts`; QR sem sessão com retorno em `operation.spec.ts` | I, E | testado (29/09/2026) |
| Fila nega inscrição com reserva ativa na data | `waitlist` | `WL-03-T1` em `waitlist.test.ts` (também nega com mesa disponível, dia fechado, janela fechada, data passada e pessoa inativa) | I | testado (29/09/2026) |
| Indicadores por `desk_class` sem dupla contagem, `held` fora do numerador, exceção contada | `availability/rules.ts` (`deskClass`), `capacityOn` | `DIR-026-T3` em `tests/unit/availability.test.ts`; `DIR-026-T1`, `T2`, `T4` e `T5` em `exclusivity.test.ts` (`capacityOn` com seis mesas contra `desk_class` do banco: exclusiva em manutenção, períodos sobrepostos, titular com reserva fora do numerador compartilhado, retenção fora, liberação ao compartilhado contada) | U, I | testado (29/09/2026) |
| Piso de supressão não configurável | `listening` | `ESC-02-T1` | I | pendente (Etapa 4) |
| Anexo de nota interna não migra na reclassificação | `helpdesk` | `ATD-03-T1` | I | pendente (Etapa 4) |
| `REQ-26` transições de atendimento com motivo; reclassificação sem expor notas internas | `helpdesk` | `ATD-01-T1`, `ATD-02-T1` | I | pendente (Etapa 4) |
| `REQ-28` conteúdo e busca respeitam controle de acesso | `content` | `CNT-01-T1` | I | pendente (Etapa 4) |
| `REQ-22` divergência de copa e nota metodológica exibidas | `actions`, `reports` | `IND-01-T1` | E | pendente (Etapa 4) |
| Supressão de grupos pequenos (`PAR-13`) | `listening` | `ESC-01-T1` | U | pendente (Etapa 4) |
| Acessibilidade dos fluxos prioritários | `components`, `design` | `A11Y-01` (axe, sério e crítico reprovam; moderado e menor registrados) em `tests/e2e/*.spec.ts`, inclusive com diálogo aberto; sem rolagem horizontal (`scrollWidth <= clientWidth`) nos projetos desktop e celular em visão geral, lista, cadastro, detalhe, edição, acessos, auditoria e importação com prévia gerada; `A11Y-02` (teclado e leitor de tela, manual) | E, M | A11Y-01 testado (29/09/2026); A11Y-02 pendente |
| Restauração de backup | operação | `OPS-01` | M | pendente (Etapa 5) |

## Etapa 3 (operação): itens novos

| Requisito | Módulo | Teste | Tipo | Estado |
|---|---|---|---|---|
| Prazo da oferta em horas úteis, limitado ao dia da reserva (`PAR-05`, `PAR-43`) | `waitlist/rules.ts` | `tests/unit/waitlist-rules.test.ts` | U | testado (29/09/2026) |
| Oferta manual com `waitlist.admin`, ator registrado; retirada com motivo | `waitlist` | `waitlist.test.ts` | I | testado (29/09/2026) |
| Desativação e suspensão tiram a pessoa da fila; retenção da pessoa desativada passa à próxima | `waitlist`, `employees` | `waitlist.test.ts`; R10 | I, C | testado (29/09/2026) |
| Meu time só com subordinados diretos que autorizaram; título segue a visibilidade | `team` | `team.test.ts`; `operation.spec.ts` | I, E | testado (29/09/2026) |
| Confirmação de sala pelo QR; confirmação imutável | `checkin` | `checkin.test.ts` | I | testado (29/09/2026) |
| Parâmetros da fila e da confirmação auditados, QR por recurso | `workplace`, telas | `operation.spec.ts` | E | testado (29/09/2026) |
| Integração de calendário corporativo | não implementada | não se aplica | | pendente de fonte oficial (`RSK-31`) |
