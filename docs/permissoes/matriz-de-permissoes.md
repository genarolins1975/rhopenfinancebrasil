# Matriz de permissões e separação de atribuições

Referência: 28/09/2026. Autorização decidida no servidor pela função `can(ator, permissão, recurso?)`, que combina perfil, concessões diretas com vigência, situação do usuário (`active` apenas), vínculo com o recurso e contexto. Negação por padrão. Anexos, exportações, buscas e endpoints auxiliares passam pela mesma função.

## Permissões nomeadas

| Código | Significado | Sensível |
|---|---|---|
| `booking.self.manage` | Criar e cancelar as próprias reservas, planejar a semana, entrar na fila | |
| `booking.on_behalf.create` | Reservar em nome de outra pessoa, com confirmação, registro do ator e notificação ao beneficiário | Sim |
| `booking.admin.manage` | Cancelamento administrativo com motivo, visão de todas as reservas | Sim |
| `team.view` | Ver planos e reservas autorizadas da própria equipe | |
| `employee.read.basic` | Nome, área, cargo, email corporativo | |
| `employee.read.full` | Cadastro completo exceto CPF | Sim |
| `employee.manage` | Cadastrar, editar, convidar, desativar | Sim |
| `employee.import` | Importação CSV | Sim |
| `cpf.reveal` | Revelar CPF completo, sempre auditado | Sim |
| `role.assign.standard` | Conceder `employee`, `manager` | Sim |
| `role.assign.privileged` | Conceder `hr`, `facilities`, `admin`, `tech_admin` e permissões sensíveis | Sim |
| `resource.manage` | Recursos, atributos, zonas | |
| `resource.status.manage` | Manutenção e bloqueio administrativo | |
| `floorplan.edit` | Editar versões da planta | |
| `floorplan.publish` | Aprovar e publicar versão | Sim |
| `manage_executive_seat_assignments` | Criar, agendar, transferir, encerrar, liberar temporariamente, revisar vínculo, ver histórico e conflitos | Sim |
| `exclusive.holder.view` | Ver nome do titular de mesa exclusiva | Sim |
| `waitlist.admin` | Gerir fila e ofertas | |
| `ticket.self` | Abrir e acompanhar as próprias solicitações | |
| `ticket.hr.handle` | Atender fila RH | Sim |
| `ticket.facilities.handle` | Atender fila Facilities | |
| `ticket.it.handle` | Atender fila TI | |
| `ticket.restricted.handle` | Atender assuntos sensíveis | Sim |
| `ticket.internal_note` | Escrever notas internas | |
| `content.edit` | Rascunhos | |
| `content.approve` | Aprovar | |
| `content.publish` | Publicar | |
| `survey.manage` | Criar e configurar pesquisas | Sim |
| `survey.aggregate.view` | Ver resultados agregados com supressão | |
| `survey.raw.view` | Ver respostas individuais identificadas | Sim, inicialmente ninguém |
| `actions.manage` | Plano de ações | |
| `report.view` | Indicadores agregados | |
| `report.export` | Exportar sem CPF | Sim |
| `audit.view` | Consultar auditoria | Sim |
| `settings.manage` | Configuração operacional | Sim |
| `integration.manage` | Integrações e configuração técnica | Sim |
| `session.revoke.any` | Revogar sessões de terceiros | Sim |

## Matriz inicial (proposta)

Legenda: S = concedida pelo perfil; C = só por concessão explícita com vigência; vazio = negada.

| Permissão | Colaborador | Gestor | RH | Facilities | Administrador | Adm. técnico |
|---|---|---|---|---|---|---|
| `booking.self.manage` | S | S | S | S | S | S |
| `booking.on_behalf.create` | | | C | C | C | |
| `booking.admin.manage` | | | S | S | C | |
| `team.view` | | S | | | | |
| `employee.read.basic` | S | S | S | S | S | S |
| `employee.read.full` | | | S | | C | |
| `employee.manage` | | | S | | C | |
| `employee.import` | | | S | | C | |
| `cpf.reveal` | | | C | | | |
| `role.assign.standard` | | | S | | S | |
| `role.assign.privileged` | | | | | C | |
| `resource.manage` | | | | S | C | |
| `resource.status.manage` | | | | S | C | |
| `floorplan.edit` | | | | S | C | |
| `floorplan.publish` | | | C | C | C | |
| `manage_executive_seat_assignments` | | | S | | C | |
| `exclusive.holder.view` | | | S | C | C | |
| `waitlist.admin` | | | S | S | C | |
| `ticket.self` | S | S | S | S | S | S |
| `ticket.hr.handle` | | | S | | | |
| `ticket.facilities.handle` | | | | S | | |
| `ticket.it.handle` | | | | | | C |
| `ticket.restricted.handle` | | | C | | | |
| `ticket.internal_note` | | | S | S | | C |
| `content.edit` | | | S | S | C | |
| `content.approve` | | | S | | C | |
| `content.publish` | | | S | | C | |
| `survey.manage` | | | S | | C | |
| `survey.aggregate.view` | | C | S | | S | |
| `survey.raw.view` | | | | | | |
| `actions.manage` | | | S | S | C | |
| `report.view` | | C | S | S | S | |
| `report.export` | | | C | C | C | |
| `audit.view` | | | C | | S | S |
| `settings.manage` | | | | | S | C |
| `integration.manage` | | | | | | S |
| `session.revoke.any` | | | | | S | S |

Facilities não recebe `manage_executive_seat_assignments` automaticamente. O titular de mesa exclusiva não recebe nada por ser titular: só vê e opera a própria mesa por `booking.self.manage` mais o vínculo.

## Separação de atribuições

1. Ninguém altera os próprios perfis ou permissões. A função rejeita `ator = alvo` para qualquer concessão.
2. `role.assign.privileged` é concedida a pessoas nomeadas, com vigência, não a um perfil inteiro. Proposta: exigir segundo aprovador para conceder `admin` e `tech_admin` (dupla aprovação), pendente de validação.
3. Editar o cadastro (`employee.manage`) não altera perfis. A importação CSV ignora colunas de perfil privilegiado e reporta isso na prévia.
4. Administrador técnico não tem `cpf.reveal`, não atende filas de RH e não vê respostas de pesquisa. Sua atuação sobre dados confidenciais acontece apenas por procedimento emergencial.
5. Revelar CPF exige `cpf.reveal`, motivo obrigatório e gera `audit_event` com ator, alvo e motivo. A interface mostra os últimos dois dígitos por padrão.
6. Reservar em nome de alguém exige `booking.on_behalf.create`, confirmação com resumo, registro do ator e notificação ao beneficiário. Não existe impersonação.

## Vínculo com o recurso

| Situação | Regra |
|---|---|
| Reserva própria | `employee_id` da reserva igual ao da sessão |
| Equipe do gestor | `manager_employee_id` igual ao gestor, apenas para o que a pessoa autorizou compartilhar |
| Atendimento | Solicitante vê o próprio; atendente vê a fila da sua área; assunto sensível só com `ticket.restricted.handle` |
| Anexo | Herda a regra do atendimento ou do conteúdo de origem |
| Mesa exclusiva | Titular, integrante ativo do grupo ou beneficiário de exceção vigente, avaliado por data |
| Conteúdo | `visibility_roles` do item |

## Ciclo de vida do usuário

Desativar uma pessoa: revoga sessões (Better Auth `revokeUserSessions`), bane o login (`banUser`), invalida convites, encerra concessões de perfil e permissão, cancela reservas futuras com notificação ao gestor e às áreas afetadas, encaminha atendimentos abertos para triagem, e marca atribuições exclusivas onde é titular como `needs_review`. Nada disso libera mesa exclusiva ao público. Histórico preservado conforme retenção.

## Acesso emergencial e auditoria

Acesso direto ao banco ou a segredos em produção só por procedimento registrado: solicitação com motivo, aprovação de segunda pessoa, credencial temporária, registro de início e fim, revisão posterior. O procedimento está em `../operacao/privacidade-e-protecao-de-dados.md`. Não se promete isolamento absoluto contra operadores com acesso direto.
