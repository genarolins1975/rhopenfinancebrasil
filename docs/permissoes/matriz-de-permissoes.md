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
| `exclusive.view` | Ver a tela de exclusividade em modo leitura, sem nomes de titulares | |
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
| `booking.admin.manage` | | | C | S | C | |
| `team.view` | | S | | | | |
| `employee.read.basic` | S | S | S | S | S | S |
| `employee.read.full` | | | S | | C | |
| `employee.manage` | | | S | | C | |
| `employee.import` | | | S | | C | |
| `cpf.reveal` | | | C | | | |
| `role.assign.standard` | | | S | | C | |
| `role.assign.privileged` | | | | | C | |
| `resource.manage` | | | | S | C | |
| `resource.status.manage` | | | | S | C | |
| `floorplan.edit` | | | | S | C | |
| `floorplan.publish` | | | C | C | C | |
| `manage_executive_seat_assignments` | | | S | | C | |
| `exclusive.holder.view` | | | S | C | C | |
| `exclusive.view` | | | S | S | C | |
| `waitlist.admin` | | | C | S | C | |
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
| `survey.aggregate.view` | | C | S | | C | |
| `survey.raw.view` | | | | | | |
| `actions.manage` | | | S | S | C | |
| `report.view` | | S | S | S | C | |
| `report.export` | | | C | C | C | |
| `audit.view` | | | C | | C | C |
| `settings.manage` | | | | | S | C |
| `integration.manage` | | | | | | S |
| `session.revoke.any` | | | | | C | S |

Administrador recebe por perfil somente `settings.manage`; todo o resto é concessão explícita com vigência, como o prompt define. Administrador técnico não recebe leitura de auditoria de negócio por perfil, pois ela contém antes e depois de operações confidenciais. RH opera reservas e fila só por concessão, pois reservas operacionais são de Facilities. Facilities não recebe `manage_executive_seat_assignments` automaticamente. O titular de mesa exclusiva não recebe nada por ser titular: só vê e opera a própria mesa por `booking.self.manage` mais o vínculo.

## Separação de atribuições

1. Ninguém altera os próprios perfis ou permissões. A função rejeita `ator = alvo` para qualquer concessão.
2. `role.assign.privileged` é concedida a pessoas nomeadas, com vigência, não a um perfil inteiro. Proposta: exigir segundo aprovador para conceder `admin` e `tech_admin` (dupla aprovação), pendente de validação.
3. Editar o cadastro (`employee.manage`) não altera perfis nem o email de autenticação de pessoa ativa: `user.email` muda apenas pelo fluxo de troca de email com confirmação no endereço antigo, e a edição administrativa gera pedido pendente para o próprio usuário. Alterar o email de pessoa ainda convidada revoga todos os convites. Perfis e permissões privilegiados só tomam efeito para pessoa ativa com segundo fator (`PAR-33`). A importação CSV ignora colunas de perfil privilegiado e reporta isso na prévia.
7. A prévia da importação nunca funciona como oráculo de CPF: conflito de duplicidade aparece como "linha N conflita com cadastro existente", com o email corporativo mascarado, sem nome e sem dizer qual campo; a importação inteira gera um evento de auditoria com contagem de duplicidades e ids envolvidos; há limite de importações por pessoa e por hora; violações de unicidade do banco são capturadas e respondidas genericamente, com o detalhe redigido no log; o arquivo é processado em memória e nunca persistido.
8. `integration.manage` não dá acesso a endereço, porta ou credenciais de email, que existem apenas como segredo de ambiente; a tela de integrações cobre remetente, modelos e envio de teste.
4. Administrador técnico não tem `cpf.reveal`, não atende filas de RH e não vê respostas de pesquisa. Sua atuação sobre dados confidenciais acontece apenas por procedimento emergencial.
5. Revelar CPF exige `cpf.reveal`, motivo obrigatório e gera `audit_event` com ator, alvo e motivo. A máscara padrão exibe apenas os dois últimos dígitos (`PAR-24`).
6. Reservar em nome de alguém exige `booking.on_behalf.create`, confirmação com resumo, registro do ator e notificação ao beneficiário. Não existe impersonação.

## Vínculo com o recurso

| Situação | Regra |
|---|---|
| Reserva própria | `employee_id` da reserva igual ao da sessão |
| Equipe do gestor | `manager_employee_id` igual ao gestor, apenas para o que a pessoa autorizou compartilhar |
| Atendimento | Solicitante vê o próprio; atendente vê a fila da sua área; assunto sensível só com `ticket.restricted.handle` |
| Anexo | Herda a regra do atendimento ou do conteúdo de origem |
| Mesa exclusiva | Titular, integrante com vigência no grupo ou beneficiário de exceção vigente, avaliado por data; atribuição individual em revisão não admite ninguém |
| Reserva em nome | O ator precisa de `booking.on_behalf.create`; o beneficiário precisa estar `active` e ter `booking.self.manage`; pessoa convidada ou suspensa não recebe reserva |
| Mapa e lista | A resposta carrega estado calculado e a marca "é minha"; identificadores e nomes de titulares só com `exclusive.holder.view` (`DIR-035`) |
| Conteúdo | `visibility_roles` do item |

## Ciclo de vida do usuário

Suspender uma pessoa: revoga sessões, bloqueia o login, mantém reservas futuras e atribuições, e impede reservas em nome dela.

Desativar uma pessoa: revoga sessões e bloqueia o login pelo adaptador interno do Better Auth (o bloqueio deriva de `employee.status`), invalida convites, encerra concessões de perfil e permissão, trata reservas futuras conforme `PAR-25` (proposta: cancelar com notificação ao gestor e às áreas afetadas), encaminha atendimentos abertos para triagem, e marca atribuições exclusivas onde é titular como `needs_review`. Nada disso libera mesa exclusiva ao público. A operação trava as mesas com reservas futuras e atribuições da pessoa e passa pelo diálogo de conflito. Histórico preservado conforme retenção.

Readmitir uma pessoa: reutiliza o mesmo cadastro, abre novo período de vínculo, gera novo convite, reativa o login com sessões e segundo fator zerados; concessões e atribuições antigas permanecem encerradas (`PAR-36`).

Primeiro administrador: procedimento controlado por linha de comando no servidor, sem conta pública padrão nem credencial fixa no código; a concessão nasce com `granted_by` nulo, registrada em auditoria com motivo `bootstrap`, e exige segundo fator no primeiro acesso.

## Acesso emergencial e auditoria

Acesso direto ao banco ou a segredos em produção só por procedimento registrado: solicitação com motivo, aprovação de segunda pessoa, credencial temporária, registro de início e fim, revisão posterior. O procedimento está em `../operacao/privacidade-e-protecao-de-dados.md`. Não se promete isolamento absoluto contra operadores com acesso direto.
