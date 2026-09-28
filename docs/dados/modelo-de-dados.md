# Modelo de dados

Referência: 28/09/2026. PostgreSQL. Instantes em `timestamptz` (UTC); datas de reserva e vigência em `date` interpretadas em `America/Sao_Paulo`. Identificadores `uuid` gerados no servidor. Nada aqui é código final; é a especificação que a Etapa 1 e a Etapa 2 implementam em migrações SQL.

## Domínios e tabelas

### Identidade (esquema gerenciado pelo Better Auth)

`user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`. O `user` carrega apenas identidade de autenticação. Tudo sobre a pessoa vive em `employee`.

### Colaboradores

| Tabela | Colunas principais | Regras |
|---|---|---|
| `employee` | `id`, `user_id` (nulo até aceitar convite), `full_name`, `corporate_email` (único, `citext`), `area_id`, `job_title`, `manager_employee_id`, `org_condition` (`standard`, `director`), `status` (`invited`, `active`, `suspended`, `deactivated`), `hire_date`, `exit_date`, `deactivated_at`, `deactivated_by`, `created_at`, `updated_at` | `org_condition = director` não concede permissão alguma |
| `employee_sensitive` | `employee_id` (PK e FK), `cpf_ciphertext` (`bytea`), `cpf_key_version`, `cpf_hmac` (`bytea`, único), `created_at`, `updated_at` | Tabela separada, cifra AES 256 GCM com chave fora do banco; deduplicação por HMAC SHA256 com chave distinta; nunca em `SELECT *` de listagens |
| `area` | `id`, `name`, `code` | |
| `access_group` | `id`, `code` (`diretoria`), `name` | Grupo beneficiário de mesas exclusivas de grupo |
| `access_group_member` | `id`, `group_id`, `employee_id`, `valid_from`, `valid_to`, `added_by`, `removed_at`, `removed_by` | Só integrantes ativos na data contam |
| `invitation` | `id`, `employee_id`, `token_hash` (único), `expires_at`, `used_at`, `revoked_at`, `created_by`, `sent_at`, `delivery_status` | Token aleatório de 32 bytes; só o hash é gravado; uso único |

### Acesso

| Tabela | Colunas principais |
|---|---|
| `role` | `code` (`employee`, `manager`, `hr`, `facilities`, `admin`, `tech_admin`), `name`, `privileged` |
| `permission` | `code`, `description`, `sensitive` |
| `role_permission` | `role_code`, `permission_code` |
| `employee_role` | `id`, `employee_id`, `role_code`, `valid_from`, `valid_to`, `granted_by`, `revoked_at`, `revoked_by`, `reason` |
| `employee_permission` | `id`, `employee_id`, `permission_code`, `valid_from`, `valid_to`, `granted_by`, `revoked_at`, `reason` |

Regras: `granted_by <> employee_id` por check; concessão de `role.privileged` exige permissão `role.assign.privileged`; alterações registram auditoria.

### Escritório

| Tabela | Colunas principais | Regras |
|---|---|---|
| `floor_plan_version` | `id`, `name`, `source_file_id`, `status` (`draft`, `approved`, `published`, `retired`), `approved_by`, `approved_at`, `published_at`, `notes` | PDF original, arquivo de trabalho e mapa operacional são objetos distintos |
| `floor_plan_placement` | `id`, `plan_version_id`, `resource_id`, `x`, `y`, `w`, `h`, `rotation`, `shape` | Posição por versão; trocar desenho não troca `resource_id` |
| `zone` | `id`, `code`, `name`, `plan_version_id` | |
| `resource` | `id`, `code` (estável e único, ex.: `M045`, `R1`, `B1`), `type` (`desk`, `room`, `booth`), `zone_id`, `capacity` (nulo para mesa), `attributes` (`jsonb`), `attributes_verified_at`, `attributes_verified_by`, `retired_at` | Sem política de acesso aqui; ver `exclusive_assignment` |
| `resource_status_period` | `id`, `resource_id`, `status` (`maintenance`, `admin_block`), `starts_on`, `ends_on` (nulo = sem término), `reason`, `created_by`, `released_at`, `released_by` | Situação operacional por período, permite histórico e indicadores retroativos |
| `office_calendar` | `date`, `is_open`, `reason` | Fechamentos e feriados |
| `office_settings` | chave e valor tipado | Janela de abertura, limites, prazos de oferta, tudo configurável |

### Exclusividade

| Tabela | Colunas principais | Regras |
|---|---|---|
| `exclusive_assignment` | `id`, `resource_id`, `mode` (`individual`, `group`), `holder_employee_id`, `access_group_id`, `valid_from`, `valid_to` (nulo = até liberação), `status` (`scheduled`, `active`, `needs_review`, `ended`), `reason`, `created_by`, `ended_at`, `ended_by`, `end_reason`, `transferred_from_id` | Check: `individual` exige `holder_employee_id` e proíbe grupo; `group` o inverso. Exclusão de sobreposição por recurso entre atribuições não encerradas |
| `access_exception` | `id`, `assignment_id`, `resource_id`, `kind` (`release_to_shared`, `release_to_employee`), `beneficiary_employee_id`, `starts_on`, `ends_on`, `reason`, `created_by`, `revoked_at`, `revoked_by` | Dias inteiros; exclusão de sobreposição por recurso entre exceções não revogadas; não pode ultrapassar a vigência da atribuição |

`status` é derivável da vigência e será recalculado na leitura; a coluna existe para `needs_review` e `ended`, que são decisões humanas, e como índice.

### Reservas

| Tabela | Colunas principais | Regras |
|---|---|---|
| `desk_booking` | `id`, `resource_id`, `employee_id`, `booking_date`, `status` (`held`, `confirmed`, `cancelled`, `expired`), `origin` (`self`, `week_plan`, `on_behalf`, `waitlist_offer`, `admin`), `actor_employee_id`, `idempotency_key`, `hold_expires_at`, `cancelled_at`, `cancelled_by`, `cancel_reason`, `created_at` | Únicos parciais: (`resource_id`, `booking_date`) e (`employee_id`, `booking_date`) onde `status in ('held','confirmed')`; (`actor_employee_id`, `idempotency_key`) único |
| `space_booking` | `id`, `resource_id`, `employee_id`, `period` (`tstzrange`, semiaberto `[)`), `title`, `title_visibility` (`private`, `team`, `all`), `status`, `actor_employee_id`, `idempotency_key`, `cancelled_at`, `cancel_reason` | `EXCLUDE USING gist (resource_id WITH =, period WITH &&) WHERE (status = 'confirmed')`; intervalos adjacentes não conflitam por serem semiabertos |
| `presence_intent` | `employee_id`, `date`, `intent` (`onsite`, `remote`, `not_informed`), `updated_at` | Único (`employee_id`, `date`); intenção não é reserva |
| `week_plan_request` | `id`, `employee_id`, `idempotency_key`, `payload`, `result`, `created_at` | Registro da operação atômica de semana para repetição segura |
| `checkin` | `id`, `booking_id`, `booking_kind`, `declared_at`, `method` (`portal`, `qr`), `actor_employee_id` | Declaração de uso, nunca prova de presença |

### Lista de espera

| Tabela | Colunas principais | Regras |
|---|---|---|
| `waitlist_entry` | `id`, `employee_id`, `date`, `preferences` (`jsonb`), `status` (`waiting`, `offered`, `accepted`, `expired`, `cancelled`), `created_at` | Único parcial (`employee_id`, `date`) onde `status in ('waiting','offered')` |
| `waitlist_offer` | `id`, `entry_id`, `resource_id`, `hold_booking_id`, `offered_at`, `expires_at`, `status` (`open`, `accepted`, `expired`, `declined`, `superseded`) | A retenção é um `desk_booking` com `status = 'held'`, o que impede dupla oferta pela unicidade |

### Atendimento

`helpdesk_ticket` (`protocol` sequencial formatado, `requester_employee_id`, `category`, `sensitivity` (`normal`, `restricted`), `responsible_area` (`hr`, `facilities`, `it`), `resource_id`, `location_text`, `status` (`received`, `triage`, `in_progress`, `waiting_third_party`, `resolved`, `closed`, `reopened`), `assigned_to`, `next_update_at`, `resolved_at`, `closed_at`), `ticket_message` (visível ao solicitante), `ticket_internal_note` (tabela separada, nunca exposta ao solicitante), `ticket_attachment` (`storage_key`, `mime`, `size`, `sha256`, `scanned_at`), `ticket_transition` (histórico com motivo), `incident` (ocorrência de manutenção agrupadora) e `incident_ticket` (vínculo sem copiar detalhes pessoais), `service_calendar` por área.

Reclassificar um atendimento para outra área cria transição com motivo e move somente a mensagem inicial; notas internas da área anterior ficam ocultas à nova equipe, salvo compartilhamento explícito e auditado.

### Conteúdo, escuta, ações, notificações, auditoria

* `content_item` (`slug`, `kind` (`benefit`, `guide`, `notice`), `status` (`draft`, `in_review`, `published`, `archived`), `owner_area`, `visibility_roles`, `review_due_on`), `content_version`, `content_attachment`, `notice_target` (público alvo, prioridade, validade).
* `survey` (`mode` (`identified`, `confidential`), `opens_at`, `closes_at`, `min_group_size` padrão 10), `survey_question`, `survey_participation` (quem concluiu, sem chave para as respostas no modo confidencial), `survey_response` (no modo confidencial não guarda `employee_id`, IP, user agent nem instante com precisão de segundos), `survey_aggregate` (instantâneos com supressão aplicada). O modo "anônimo" não existe até demonstração técnica registrada.
* `action_item` (tema, `evidence_ref` com pesquisa e período, ação, `owner_area`, prazo, `status` (`planned`, `in_progress`, `done`, `not_executed`), justificativa quando não executado, resultado observado), `action_update`.
* `outbox_event` (`event_type`, `aggregate_type`, `aggregate_id`, `payload` sem CPF, `idempotency_key` único, `status`, `attempts`, `next_attempt_at`, `last_error`), `notification_delivery` (`channel`, `provider_message_id`, `status`), `notification_preference`.
* `audit_event` (`actor_user_id`, `actor_employee_id`, `action`, `entity_type`, `entity_id`, `before`, `after` (ambos redigidos), `reason`, `request_id`, `ip_hash`, `created_at`). Papel de banco da aplicação sem `UPDATE` e `DELETE` nesta tabela.

## Constraints que sustentam as regras

```sql
-- uma reserva ativa por mesa e dia, e por pessoa e dia
create unique index desk_booking_resource_day
  on desk_booking (resource_id, booking_date)
  where status in ('held', 'confirmed');
create unique index desk_booking_employee_day
  on desk_booking (employee_id, booking_date)
  where status in ('held', 'confirmed');

-- salas e cabines sem sobreposição; adjacentes permitidos
alter table space_booking add constraint space_booking_no_overlap
  exclude using gist (resource_id with =, period with &&)
  where (status = 'confirmed');

-- uma atribuição exclusiva por mesa e período
alter table exclusive_assignment add constraint exclusive_assignment_no_overlap
  exclude using gist (
    resource_id with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  ) where (status <> 'ended');

-- uma exceção por mesa e período
alter table access_exception add constraint access_exception_no_overlap
  exclude using gist (
    resource_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (revoked_at is null);
```

Rede de segurança adicional, além dos locks da aplicação: trigger de constraint `deferrable initially deferred` em `desk_booking` que rejeita, no commit, reserva `held` ou `confirmed` cujo `employee_id` não seja titular, integrante ativo do grupo ou beneficiário de exceção vigente para uma mesa com atribuição exclusiva ativa na data; e trigger equivalente em `exclusive_assignment` e `access_exception` que rejeita, no commit, inserção ou alteração que deixe reserva incompatível confirmada. Os dois triggers usam a mesma função SQL de elegibilidade, para que aplicação e banco nunca divirjam.

## Transações e ordem de locks

Toda mutação que toca um recurso (reservar, cancelar, reter oferta, criar, agendar, transferir, encerrar ou revisar atribuição, criar ou revogar exceção, criar ou liberar período de manutenção ou bloqueio) segue o mesmo protocolo:

1. Abrir transação em `read committed`.
2. Verificar conta e permissão do ator com a identidade da sessão.
3. Adquirir `select ... for update` nas linhas de `resource` envolvidas, em ordem crescente de `id`. Operações de semana e lotes travam todos os recursos antes de qualquer gravação.
4. Ler o estado atual: períodos de situação, calendário, atribuições, exceções, reservas do dia, limites da pessoa.
5. Revalidar a operação inteira com o serviço de disponibilidade.
6. Gravar reservas, atribuições ou exceções, gravar `audit_event` e `outbox_event`.
7. Commit. Os triggers deferidos são a segunda verificação.
8. Em `40001` (falha de serialização) ou `40P01` (deadlock), repetir até três vezes com espera crescente. Em violação de unicidade ou exclusão, converter em resposta de conflito.

Idempotência: cada mutação vinda do cliente carrega `idempotency_key`; a repetição da mesma chave pelo mesmo ator devolve o resultado original sem criar nova reserva.

Corrida entre reserva e trava: as duas operações disputam o `for update` da mesma linha de `resource`; a segunda espera a primeira e revalida com o estado já gravado. Resultado: ou a reserva entra e a trava reporta conflito explícito, ou a trava entra e a reserva é negada. Nunca coexistem.

## Índices

`desk_booking (employee_id, booking_date)`, `desk_booking (resource_id, booking_date)`, `space_booking using gist (resource_id, period)`, `exclusive_assignment (resource_id, valid_from)`, `exclusive_assignment (holder_employee_id) where status <> 'ended'`, `access_exception (resource_id, starts_on)`, `resource_status_period (resource_id, starts_on)`, `helpdesk_ticket (responsible_area, status)`, `audit_event (entity_type, entity_id, created_at)`, `outbox_event (status, next_attempt_at)`.

## Retenção (parâmetros propostos, pendentes)

| Dado | Proposta | Observação |
|---|---|---|
| Auditoria | 5 anos | Somente inserção |
| Reservas e confirmações de uso | 24 meses em detalhe, agregados depois | |
| Atendimentos | Enquanto durar o vínculo e 5 anos após | Anexos removidos com o atendimento |
| Convites e tokens | 30 dias após expiração | |
| Respostas de pesquisa confidencial | Somente agregados após 12 meses | |
| CPF | Enquanto exigido pela obrigação que justifica a coleta | Decisão do encarregado |

## Acesso direto ao banco

O papel da aplicação não é superusuário e não tem `UPDATE` e `DELETE` em `audit_event`. Papéis de operação com acesso direto têm procedimento de acesso emergencial e auditoria de sessão registrados em `../operacao/privacidade-e-protecao-de-dados.md`. Não há promessa de isolamento absoluto contra operador com acesso direto: a cifra do CPF com chave fora do banco reduz, sem eliminar, esse risco.
