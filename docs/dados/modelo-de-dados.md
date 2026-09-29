# Modelo de dados

Referência: 28/09/2026, versão 2 após revisão adversarial independente. PostgreSQL. Especificação que as Etapas 1 e 2 implementam em migrações SQL; nada aqui é código final.

## Convenções

* Instantes em `timestamptz` (UTC). Datas de reserva, vigência e calendário em `date`, sempre dia local de `America/Sao_Paulo`.
* O papel de banco da aplicação tem `timezone = 'America/Sao_Paulo'` fixado por `alter role`. Mesmo assim, `current_date`, `now()::date` e casts implícitos de `timestamptz` para `date` são proibidos em SQL, funções e triggers. Toda função recebe `p_today date` calculado pela aplicação com `@date-fns/tz`, ou usa `local_today()`, função única definida como `(now() at time zone 'America/Sao_Paulo')::date`.
* Intervalos de dia inteiro para salas, cabines e períodos de manutenção nascem de `local_day_range(d date)`, que devolve `tstzrange` de `make_timestamptz(y, m, d, 0, 0, 0, 'America/Sao_Paulo')` até o mesmo instante de `d + 1`, semiaberto. Na aplicação, instantes nascem com `TZDate` e viajam como ISO com offset. Atualização de `tzdata` do banco e do Node é item operacional registrado.
* Extensão `btree_gist` criada na primeira migração; sem ela, `exclude using gist (uuid with =, ...)` falha. O provedor escolhido precisa oferecer essa extensão (Neon, Railway, Supabase e a imagem oficial oferecem; a verificação entra no teste `DB-01`).
* Identificadores `uuid` gerados no servidor. Isolamento `read committed` em toda transação; a serialização vem de locks explícitos, descritos adiante. `set local lock_timeout = '3s'` e `statement_timeout` em toda transação de reserva (`PAR-34`).

## Domínios e tabelas

### Identidade (esquema gerenciado pelo Better Auth)

`user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`. O `user` carrega apenas identidade de autenticação; `user.email` muda somente pelo fluxo `changeEmail` com confirmação no endereço antigo. Tudo sobre a pessoa vive em `employee`.

### Colaboradores

| Tabela | Colunas principais | Regras |
|---|---|---|
| `employee` | `id`, `user_id` (nulo até aceitar convite), `full_name`, `corporate_email` (único, `citext`), `area_id`, `job_title`, `manager_employee_id`, `org_condition` (`standard`, `director`), `status` (`invited`, `active`, `suspended`, `deactivated`), `deactivated_at`, `deactivated_by`, `created_at`, `updated_at` | Fotografia atual. `org_condition = director` não concede permissão alguma. Semântica de `suspended`: sessões revogadas, login bloqueado, reservas futuras mantidas (validadas por `booking_remains_valid`, não por `is_bookable`), atribuições inalteradas, nenhuma reserva nova nem em nome dela permitida |
| `employment_period` | `id`, `employee_id`, `hire_date`, `exit_date`, `reason` | Histórico de vínculos empregatícios. Readmissão reutiliza `employee.id`, abre novo período, gera novo convite, reativa o login (o bloqueio deriva de `employee.status`) com sessões e segundo fator zerados; concessões e atribuições antigas permanecem encerradas (`PAR-36`) |
| `employee_org_assignment` | `id`, `employee_id`, `area_id`, `manager_employee_id`, `job_title`, `org_condition`, `valid_from`, `valid_to`, `created_by`, `reason` | Histórico organizacional com vigência; indicadores históricos e Meu time usam a vigência |
| `employee_sensitive` | `employee_id` (PK e FK), `cpf_ciphertext` (`bytea`), `cpf_key_version`, `cpf_hmac` (`bytea`, único), `cpf_hmac_key_version`, `cpf_suffix` (`char(2)`, `PAR-32`), `created_at`, `updated_at` | Tabela separada. Formato do texto cifrado: `versão(1) || nonce(12) || ct || tag(16)`, AES 256 GCM, nonce de CSPRNG por gravação, AAD = `employee_id`, chave fora do banco com custódia própria (cofre do provedor ou envelope com KMS). Deduplicação por HMAC SHA256 com chave distinta e versão própria; rotação em duas fases documentada na Etapa 1. `cpf_suffix` permite mascarar sem decifrar; nunca sai em exportações, nem o HMAC. Auditoria de alteração registra apenas "alterado" e a versão de chave, nunca antes e depois. Nunca em `SELECT *` de listagens |
| `area` | `id`, `name`, `code` | |
| `access_group` | `id`, `code` (`diretoria`), `name` | Grupo beneficiário de mesas exclusivas de grupo |
| `access_group_member` | `id`, `group_id`, `employee_id`, `valid_from`, `valid_to`, `added_by`, `removed_by`, `reason` | Só integrantes com vigência cobrindo a data contam; alterar vigência passa pelo protocolo de locks e pelos triggers deferidos |
| `invitation` | `id`, `employee_id`, `token_hash` (único), `expires_at`, `used_at`, `revoked_at`, `created_by`, `sent_at`, `delivery_status` (`queued`, `sent`, `blocked`) | Token aleatório de 32 bytes; na tabela só o hash é gravado; uso único. O link completo existe na carga da outbox até a entrega, quando é apagado. `sent_at` e `delivery_status = sent` só após envio real pelo worker; destinatário fora da lista permitida vira `blocked`. Único parcial `(employee_id) where used_at is null and revoked_at is null`. Aceite exige `employee.status = 'invited'` e `user_id is null`. Alterar `corporate_email` de pessoa `invited` revoga todos os convites |

Ambientes de desenvolvimento e homologação usam gerador de CPF sintético com dígitos verificadores válidos e prefixo reservado, e chaves de cifra e HMAC distintas das de produção.

### Acesso

| Tabela | Colunas principais |
|---|---|
| `role` | `code` (`employee`, `manager`, `hr`, `facilities`, `admin`, `tech_admin`), `name`, `privileged` |
| `permission` | `code`, `description`, `sensitive` |
| `role_permission` | `role_code`, `permission_code` |
| `employee_role` | `id`, `employee_id`, `role_code`, `valid_from`, `valid_to`, `granted_by`, `revoked_at`, `revoked_by`, `reason` |
| `employee_permission` | `id`, `employee_id`, `permission_code`, `valid_from`, `valid_to`, `granted_by`, `revoked_at`, `reason` |

Regras: `granted_by <> employee_id` por check; `granted_by` nulo só no bootstrap por CLI, registrado em `audit_event` com `actor_user_id` nulo e `reason = 'bootstrap'`; únicos parciais `(employee_id, role_code) where revoked_at is null` e `(employee_id, permission_code) where revoked_at is null`; `valid_to` encerra a vigência em data, `revoked_at` registra revogação antecipada; concessão de `role.privileged` exige permissão `role.assign.privileged` e só toma efeito para pessoa `active` com segundo fator ativo (`PAR-33`); alterações registram auditoria.

### Escritório

| Tabela | Colunas principais | Regras |
|---|---|---|
| `floor_plan_version` | `id`, `name`, `source_file_id`, `source_sha256`, `status` (`draft`, `approved`, `published`, `retired`), `approved_by`, `approved_at`, `published_at`, `notes` | PDF original, arquivo de trabalho e mapa operacional são objetos distintos |
| `floor_plan_placement` | `id`, `plan_version_id`, `resource_id`, `x`, `y`, `w`, `h`, `rotation`, `shape` | Posição por versão; trocar desenho não troca `resource_id` |
| `zone` | `id`, `code`, `name`, `plan_version_id` | |
| `resource` | `id`, `code` (estável e único), `type` (`desk`, `room`, `booth`), `zone_id`, `capacity` (nulo para mesa), `attributes` (`jsonb`), `attributes_verified_at`, `attributes_verified_by`, `retired_on` (`date`) | Sem política de acesso aqui. Desativar recurso exige encerrar atribuições e períodos na mesma transação, com o diálogo de conflito para reservas futuras |
| `resource_status_period` | `id`, `resource_id`, `status` (`maintenance`, `admin_block`), `starts_on`, `ends_on` (nulo = sem término), `released_on` (`date`, dia local a partir do qual a mesa volta), `released_at` (instante, só auditoria), `reason`, `created_by`, `released_by` | Vigência efetiva = `daterange(starts_on, least(ends_on, released_on - 1), '[]')`. Exclusão de sobreposição por recurso e tipo. Criar ou estender período sobre reservas ativas passa pelo diálogo de conflito (`DIR-033`) |
| `office_calendar` | `date`, `is_open`, `reason`, `updated_by` | Fechamentos e feriados. Alterar uma data exige advisory lock exclusivo daquela data e tratamento das reservas ativas do dia |
| `office_settings` | chave e valor tipado | Janela de abertura, horizonte, prazo de oferta, limites de duração. O piso de supressão de pesquisas não fica aqui (`PAR-31`) |

### Exclusividade

| Tabela | Colunas principais | Regras |
|---|---|---|
| `exclusive_assignment` | `id`, `resource_id`, `mode` (`individual`, `group`), `holder_employee_id`, `access_group_id`, `valid_from`, `valid_to` (nulo = até liberação), `needs_review` (boolean, só `individual`), `cancelled_at`, `cancelled_by`, `reason`, `responsible` (`PAR-27`), `created_by`, `ended_by`, `end_reason`, `transferred_from_id` | Estado `scheduled`, `active` ou `ended` é derivado por `assignment_state(a, p_today)` a partir da vigência; nunca armazenado. "Encerrar" grava apenas `valid_to`, `ended_by`, `end_reason`. "Anular" (`cancelled_at`) só é permitido se `valid_from > local_today()`, e é o único caso fora da constraint de sobreposição. Checks: `individual` exige `holder_employee_id` e proíbe grupo, `group` o inverso; `valid_to is null or valid_to >= valid_from`; `needs_review` só com `mode = 'individual'`. Trigger de vigência (`before insert or update`): na criação, `valid_from >= local_today()` (exceção apenas para importação inicial com flag explícita); `valid_from` imutável depois de iniciada e, antes disso, só pode mudar para data `>= local_today()`; `valid_to` nunca volta de preenchido para nulo (reabrir é criar nova atribuição); novo `valid_to >= local_today()`, salvo transferência com `valid_to = local_today() - 1` ou posterior; linha com `valid_to < local_today()` fica congelada, sem alteração de vigência nem anulação. Checks: `ended_by is null or valid_to is not null`; `(ended_by is null) = (end_reason is null)`. Transferência é uma única função no banco, que encerra a antiga e insere a nova na mesma instrução, com `mesma resource_id`, `antiga.valid_to = nova.valid_from - 1` e `nova.valid_from >= local_today()`; trigger deferido exige, no commit, que `end_reason = 'transferred'` tenha sucessora não anulada contígua. Anular a sucessora exige decisão explícita na mesma transação (reabrir por nova atribuição ou registrar a liberação); sem isso, o commit é rejeitado |
| `access_exception` | `id`, `assignment_id` (obrigatório), `resource_id`, `kind` (`release_to_shared`, `release_to_employee`), `beneficiary_employee_id`, `starts_on`, `ends_on` (obrigatório), `reason`, `created_by`, `revoked_at`, `revoked_by` | Dias inteiros. Checks: `ends_on >= starts_on`; `ends_on - starts_on < limite configurável` (`PAR-35`); `(kind = 'release_to_employee') = (beneficiary_employee_id is not null)`. Trigger valida `resource_id = atribuição.resource_id` e `daterange(starts_on, ends_on, '[]') <@ vigência da atribuição`, reavaliado ao encurtar a atribuição. Exclusão de sobreposição por recurso entre exceções não revogadas. Revogar exceção com reserva do beneficiário na janela passa pelo diálogo de conflito |

### Reservas

| Tabela | Colunas principais | Regras |
|---|---|---|
| `desk_booking` | `id`, `resource_id`, `employee_id`, `booking_date`, `status` (`held`, `confirmed`, `cancelled`, `expired`), `origin` (`self`, `week_plan`, `on_behalf`, `waitlist_offer`, `admin_realloc`), `actor_employee_id`, `idempotency_key` (nulo para `week_plan`), `week_plan_request_id` (FK nula), `access_exception_id` (FK nula, explica por que um não titular ocupou a mesa), `hold_expires_at`, `cancelled_at`, `cancelled_by`, `cancel_reason`, `created_at` | Únicos parciais: (`resource_id`, `booking_date`) e (`employee_id`, `booking_date`) onde `status in ('held','confirmed')`; (`actor_employee_id`, `idempotency_key`) único onde `idempotency_key is not null`. Checks: `status <> 'held' or hold_expires_at is not null` (linha expirada conserva o instante para métricas); `origin <> 'on_behalf' or actor_employee_id <> employee_id`. Leitura considera ativa apenas `status = 'confirmed' or (status = 'held' and hold_expires_at > now())` |
| `space_booking` | `id`, `resource_id`, `employee_id`, `period` (`tstzrange`, semiaberto), `title`, `title_visibility` (`private`, `manager`, `all`; `manager` = gestor direto vigente), `status` (`confirmed`, `cancelled`), `actor_employee_id`, `idempotency_key`, `cancelled_at`, `cancel_reason` | `EXCLUDE USING gist (resource_id WITH =, period WITH &&) WHERE (status = 'confirmed')`; adjacentes não conflitam por serem semiabertos; dia inteiro só por `local_day_range()` |
| `presence_intent` | `employee_id`, `date`, `intent` (`onsite`, `remote`, `not_informed`), `updated_at` | Único (`employee_id`, `date`); intenção não é reserva |
| `week_plan_request` | `id`, `employee_id`, `idempotency_key`, `payload`, `result`, `created_at` | Único (`employee_id`, `idempotency_key`). Repetir a chave devolve `result`; aceitar seleção menor gera nova chave |
| `checkin` | `id`, `desk_booking_id`, `space_booking_id`, `declared_at`, `method` (`portal`, `qr`), `actor_employee_id` | Check de exatamente uma FK preenchida; único por reserva. O QR identifica `resource.code`; o servidor resolve a reserva `confirmed` da própria sessão naquela mesa e data. Declaração de uso, nunca prova de presença |

### Lista de espera

| Tabela | Colunas principais | Regras |
|---|---|---|
| `waitlist_entry` | `id`, `employee_id`, `date`, `preferences` (`jsonb`), `status` (`waiting`, `offered`, `accepted`, `expired`, `cancelled`), `created_at` | Único parcial (`employee_id`, `date`) onde `status in ('waiting','offered')`. Inscrição negada a quem já tem reserva ativa na data (`PAR-30`). Leitura considera `offered` viva apenas com oferta `open` e `expires_at > now()`; inserir nova inscrição da mesma pessoa e data expira antes a entrada obsoleta, no mesmo padrão preguiçoso das retenções |
| `waitlist_offer` | `id`, `entry_id`, `resource_id`, `hold_booking_id` (único), `offered_at`, `expires_at`, `status` (`open`, `accepted`, `expired`, `declined`) | A retenção é um `desk_booking` `held`; único parcial `(entry_id) where status = 'open'`; leitura considera `open` apenas com `expires_at > now()`. A oferta nasce na própria transação do cancelamento que liberou a mesa e também no caminho de reserva direta que expirou uma retenção (`DIR-034`, `PAR-37`) |

### Atendimento

`helpdesk_ticket` (`protocol` sequencial formatado, `requester_employee_id`, `category`, `sensitivity` (`normal`, `restricted`), `responsible_area` (`hr`, `facilities`, `it`), `resource_id`, `location_text`, `status` (`received`, `triage`, `in_progress`, `waiting_third_party`, `resolved`, `closed`, `reopened`), `assigned_to`, `next_update_at`, `resolved_at`, `closed_at`), `ticket_message` (visível ao solicitante), `ticket_internal_note` (tabela separada, nunca exposta ao solicitante), `ticket_attachment` (`message_id` ou `internal_note_id`, exatamente um por check; `storage_key`, `mime`, `size`, `sha256`, `scanned_at`; visibilidade derivada do pai), `ticket_transition` (histórico com motivo), `incident` e `incident_ticket` (agrupamento sem copiar detalhes pessoais), `service_calendar` por área.

Reclassificar um atendimento cria transição com motivo e move somente a mensagem inicial e seus anexos; notas internas e anexos de notas da área anterior ficam ocultos à nova equipe, salvo compartilhamento explícito e auditado.

### Conteúdo, escuta, ações, notificações, auditoria

* `content_item` (`slug`, `kind` (`benefit`, `guide`, `notice`), `status` (`draft`, `in_review`, `published`, `archived`), `owner_area`, `visibility_roles`, `review_due_on`), `content_version`, `content_attachment`, `notice_target`.
* `survey` (`mode` (`identified`, `confidential`), `opens_at`, `closes_at`), `survey_question`, `survey_participation` (quem concluiu, sem chave para as respostas no modo confidencial), `survey_response` (no modo confidencial sem `employee_id`, IP, user agent ou instante com precisão de segundos), `survey_aggregate` (instantâneos com supressão). O piso de supressão é constante de código (`PAR-31`), não configurável por `survey.manage` nem por `settings.manage`; toda consulta agregada com filtro é auditada. O modo "anônimo" não existe até demonstração técnica registrada.
* `action_item` e `action_update`.
* `outbox_event` (`event_type`, `aggregate_type`, `aggregate_id`, `payload` sem CPF e apagado após entrega, bloqueio ou desistência, `idempotency_key` único, `status` (`pending`, `delivered`, `failed`, `blocked`), `attempts`, `next_attempt_at`, `last_error`), `notification_delivery`, `notification_preference`. Limitação do Better Auth registrada em `RSK-23`: o token de recuperação de senha fica em claro em `auth_verification` por 60 minutos.
* `audit_event` (`actor_user_id`, `actor_employee_id`, `action`, `entity_type`, `entity_id`, `before`, `after` (redigidos), `reason`, `request_id`, `ip_hash`, `created_at`). Papel da aplicação sem `UPDATE` e `DELETE` nesta tabela.

## Constraints que sustentam as regras

```sql
create extension if not exists btree_gist;

-- uma reserva ativa por mesa e dia, e por pessoa e dia
create unique index desk_booking_resource_day
  on desk_booking (resource_id, booking_date)
  where status in ('held', 'confirmed');
create unique index desk_booking_employee_day
  on desk_booking (employee_id, booking_date)
  where status in ('held', 'confirmed');
create unique index desk_booking_idempotency
  on desk_booking (actor_employee_id, idempotency_key)
  where idempotency_key is not null;

-- salas e cabines sem sobreposição; adjacentes permitidos
alter table space_booking add constraint space_booking_no_overlap
  exclude using gist (resource_id with =, period with &&)
  where (status = 'confirmed');

-- uma atribuição exclusiva por mesa e período; só a anulada fica de fora
alter table exclusive_assignment add constraint exclusive_assignment_no_overlap
  exclude using gist (
    resource_id with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) where (cancelled_at is null);

-- uma exceção por mesa e período
alter table access_exception add constraint access_exception_no_overlap
  exclude using gist (
    resource_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (revoked_at is null);

-- um período por recurso e tipo
alter table resource_status_period add constraint resource_status_no_overlap
  exclude using gist (
    resource_id with =,
    status with =,
    daterange(starts_on, least(ends_on, released_on - 1), '[]') with &&
  );
```

`daterange(valid_from, null, '[]')` já é ilimitado; não se usa `infinity`. Índices parciais não podem usar `now()`, por isso a expiração de `held` é tratada na leitura e no caminho de escrita, não no índice.

## Funções SQL compartilhadas

| Função | Papel |
|---|---|
| `local_today()` | Dia local de São Paulo; única fonte de "hoje" em SQL |
| `local_day_range(d date)` | `tstzrange` do dia local |
| `assignment_state(a, p_today)` | `scheduled`, `active` ou `ended` pela vigência; `cancelled` se anulada |
| `is_eligible(employee_id, resource_id, d)` | Regra literal de `DIR-031`: sem atribuição vigente, qualquer conta; com exceção `release_to_shared`, qualquer conta; com exceção `release_to_employee`, só o beneficiário; individual sem exceção, só o titular; grupo sem exceção, só integrante com vigência na data; atribuição individual com `needs_review`, ninguém |
| `is_bookable(employee_id, resource_id, d)` | Passos 1 a 6 de `DIR-019` sem a checagem de permissão, para reserva nova: pessoa `active`; calendário aberto; recurso não desativado, sem manutenção e sem bloqueio vigentes; `is_eligible` |
| `booking_remains_valid(employee_id, resource_id, d)` | Mesma regra para reserva já existente, aceitando pessoa `active` ou `suspended`; usada pelos triggers deferidos que avaliam reservas existentes e pelo painel de conflitos |
| `desk_class(resource_id, d)` | `retired`, `maintenance`, `blocked`, `exclusive` ou `shared`, pela mesma ordem, considerando exceções; base de todos os indicadores (`DIR-026`) |
| `booking_window_open(d, p_now)` | Data dentro do horizonte e abertura da semana já ocorrida em horário local (`PAR-01`, `PAR-29`) |

O serviço de disponibilidade da aplicação implementa a mesma tabela de casos e é testado contra estas funções (`DIR-031-T1`).

## Triggers

Triggers de lock, `before insert or update`, impostos pelo banco e não pela disciplina do código:

| Tabela | Lock adquirido pelo trigger |
|---|---|
| `desk_booking`, `space_booking`, `exclusive_assignment`, `access_exception`, `resource_status_period` | `perform 1 from resource where id = new.resource_id for update`; em realocação (`update` de `resource_id`) a aplicação já travou mesa antiga e nova em ordem crescente no passo 5. O trigger de `desk_booking` ignora transições `held` para `expired` ou `cancelled` que não mudem recurso nem data, para que a expiração preguiçosa não trave mesas de terceiros |
| `desk_booking`, `space_booking` | `pg_advisory_xact_lock_shared(hashtext('office_day:' || data))` para a data da reserva e para todas as datas locais cobertas pelo `period` |
| `office_calendar` | `pg_advisory_xact_lock(hashtext('office_day:' || date))` exclusivo |
| `employee` (`before update of status`) | `perform 1 from employee where id = new.id for update`. Necessário porque um `update` comum toma `for no key update`, compatível com o `for key share` que as chaves estrangeiras de reservas e atribuições tomam na linha da pessoa; só `for update` serializa contra elas |
| `access_group_member` | `perform 1 from access_group where id = new.group_id for update`, o que serializa remoção de integrante contra criação de atribuição de grupo |

Lotes inserem em ordem crescente de `resource_id`. Os advisory locks e os locks de pessoa e grupo também aparecem no protocolo da aplicação, mas a rede independente é a dos triggers: o teste `DIR-024-T2` remove todos os locks da aplicação, inclusive advisory e de pessoa, e comprova que o banco ainda serializa e rejeita.

Triggers de constraint `deferrable initially deferred`, que rodam no commit com snapshot posterior ao lock:

| Tabela | Rejeita no commit |
|---|---|
| `desk_booking` | Reserva ativa para a qual `is_bookable(employee, resource, date)` é falso |
| `space_booking` | Reserva `confirmed` cujo período intersecta manutenção, bloqueio, fechamento do escritório ou recurso desativado |
| `exclusive_assignment`, `access_exception`, `access_group_member` | Inserção, alteração, encerramento ou anulação que deixe reserva ativa de pessoa que deixou de ser elegível em qualquer data coberta |
| `resource_status_period`, `office_calendar`, `resource` (`retired_on`) | Alteração que deixe reserva ativa futura em período indisponível, dia fechado ou recurso desativado |
| `employee` (mudança de `status`) | Desativação que deixe reserva ativa futura de pessoa não `active` nem `suspended` sem tratamento na mesma transação (`booking_remains_valid`); suspensão mantém reservas |

Triggers de validação: exceção dentro da vigência e na mesma mesa da atribuição; vigência de atribuição conforme a tabela de exclusividade (criação a partir de hoje, início imutável após começar, término nunca volta a nulo, linha encerrada congelada); transferência atômica com sucessora verificada no commit; anulação só de atribuição futura.

Quando a decisão explícita do diálogo de conflito cancela ou realoca reservas na mesma transação, os triggers não encontram reserva incompatível e a operação confirma. Sem a decisão, o commit é rejeitado e a resposta é de conflito, nunca erro genérico.

## Protocolo transacional e ordem de locks

Toda mutação que altera reserva ou elegibilidade (reservar, cancelar, reter ou aceitar oferta, criar, agendar, transferir, encerrar, anular ou revisar atribuição, criar ou revogar exceção, alterar integrante de grupo, criar, estender ou liberar período de manutenção ou bloqueio, fechar ou abrir dia do calendário, desativar ou suspender pessoa, desativar recurso) segue o mesmo protocolo:

1. Abrir transação em `read committed` com `set local lock_timeout = '3s'` e `statement_timeout`.
2. Verificar conta e permissão do ator com a identidade da sessão, lendo `employee` e concessões no banco (nunca do cache de sessão). Em reserva em nome de alguém, aplicar o passo 1 de `DIR-019` também ao beneficiário.
3. Advisory lock por data: `pg_advisory_xact_lock_shared(hashtext('office_day:' || data))` para reservas e retenções; `pg_advisory_xact_lock(...)` exclusivo para alterar `office_calendar` naquela data.
4. Lock das pessoas e grupos: `select ... for share` em `employee` da pessoa que reserva ou, em reserva em nome, do beneficiário; `for share` no titular ou no grupo ao criar atribuição; `for update` em `employee` na desativação ou suspensão e em `access_group` na alteração de integrante. A serialização pessoa e grupo se apoia em `for update` contra o `for key share` das chaves estrangeiras; `update` simples não serve.
5. Lock dos recursos: `select id from resource where id = any($1) for update`, em ordem crescente de `id`, em instrução separada de qualquer leitura. O conjunto inclui: os recursos da operação; mesa antiga e nova em realocação; todas as mesas com atribuição de grupo vigente, na alteração de integrante; as mesas com reservas futuras e atribuições da pessoa, na desativação ou suspensão. Depois de travar, o conjunto é derivado de novo e o que apareceu é travado, até estabilizar, porque um conjunto derivado antes do lock do agregado não enxerga o que outra transação ainda não confirmou.
6. Expiração preguiçosa: `update desk_booking set status = 'expired' where status = 'held' and hold_expires_at <= now() and ((resource_id = $r and booking_date = $d) or (employee_id = $p and booking_date = $d))`, sempre com os dois filtros, com cascata para `waitlist_offer` e `waitlist_entry`. Se a expiração liberou uma mesa, a próxima inscrição `waiting` elegível recebe a oferta antes de qualquer reserva direta (`PAR-37`).
7. Ler o estado atual, em instruções posteriores aos locks: períodos, calendário, atribuições, exceções, integrantes, reservas do dia, limites da pessoa.
8. Revalidar a operação inteira com o serviço de disponibilidade e com as decisões do diálogo de conflito.
9. Gravar reservas, atribuições, exceções, cancelamentos e realocações decididos, gravar `audit_event` e `outbox_event`.
10. Commit. Os triggers deferidos são a segunda verificação, agora independente da disciplina do código porque o lock por recurso também é imposto por trigger.
11. Em `40P01` (deadlock) ou `55P03` (`lock_timeout`), repetir até três vezes com espera crescente, sempre recomeçando pela verificação de idempotência. `read committed` não emite `40001`. Violação de unicidade, de exclusão ou de trigger deferido vira resposta de conflito, nunca erro genérico; o `detail` do driver nunca chega ao cliente nem ao log sem redação.

Idempotência: cada mutação vinda do cliente carrega `idempotency_key`; a repetição da mesma chave pelo mesmo ator devolve o resultado original. A semana usa uma chave por requisição em `week_plan_request`, e as linhas de `desk_booking` apontam para ela.

Corrida entre reserva e trava: as duas operações disputam o `for update` da mesma linha de `resource`, imposto pelo trigger de lock mesmo que o código esqueça; a segunda espera a primeira e relê com snapshot novo. Resultado: ou a reserva entra e a trava reporta conflito explícito, ou a trava entra e a reserva é negada. Nunca coexistem. O teste `DIR-024-T2` remove propositalmente o lock da aplicação e comprova que o banco ainda rejeita a coexistência.

## Lista de espera sem dupla oferta e sem disputa escondida

Na transação de cancelamento de uma reserva de mesa, após os locks, o servidor seleciona a primeira inscrição `waiting` elegível para aquela mesa e data (mesma função de disponibilidade para a pessoa), cria o `desk_booking` `held`, o `waitlist_offer` e o `outbox_event` na mesma transação. Só se não houver ninguém elegível a mesa fica livre para reserva direta. A fila vem antes de quem clicou primeiro, por desenho. A unicidade por mesa e dia impede dupla retenção; a outbox idempotente impede notificação duplicada. O job `pg-boss` agendado em `expires_at` processa a próxima pessoa ao expirar uma oferta, uma oferta por transação, em ordem de `resource_id`, com nova tentativa em `40P01`; é conveniência, pois a expiração preguiçosa e o predicado de leitura já garantem que oferta vencida não trava mesa nem pessoa, e a reserva direta que expira uma retenção também oferece a mesa à fila antes de conceder (`PAR-37`).

## Índices

`desk_booking (employee_id, booking_date)`, `desk_booking (resource_id, booking_date)`, `desk_booking (hold_expires_at) where status = 'held'`, `space_booking using gist (resource_id, period)`, `exclusive_assignment (resource_id, valid_from)`, `exclusive_assignment (holder_employee_id, valid_from, valid_to) where cancelled_at is null`, `access_exception (resource_id, starts_on)`, `access_group_member (group_id, valid_from, valid_to)`, `resource_status_period (resource_id, starts_on)`, `helpdesk_ticket (responsible_area, status)`, `audit_event (entity_type, entity_id, created_at)`, `outbox_event (status, next_attempt_at)`.

## Retenção (parâmetros propostos, pendentes)

| Dado | Proposta | Observação |
|---|---|---|
| Auditoria | 5 anos | Somente inserção |
| Reservas e confirmações de uso | 24 meses em detalhe, agregados depois | |
| Intenção presencial e requisições de semana | 12 meses | Só a aplicação apaga; a intenção não é reserva |
| Atendimentos | Enquanto durar o vínculo e 5 anos após | Anexos removidos com o atendimento |
| Convites e tokens | 30 dias após expiração | |
| Respostas de pesquisa confidencial | Somente agregados após 12 meses | |
| CPF | Enquanto exigido pela obrigação que justifica a coleta; ao apagar, o HMAC permanece para impedir duplicidade, decisão do encarregado (`PAR-36`) | |

## Acesso direto ao banco

O papel da aplicação não é superusuário, não tem `UPDATE` e `DELETE` em `audit_event` e não tem `DELETE` em `exclusive_assignment`, `access_exception`, `resource_status_period`, `desk_booking`, `space_booking`, `access_group_member`, `office_calendar`, `floor_plan_version`, `resource`, `zone`, `access_group`, `office_settings` e `floor_plan_placement` (migrações `0005` e `0006`); atribuições e liberações têm identidade imutável por trigger. `presence_intent`, `week_plan_request` e `outbox_event` continuam apagáveis pela aplicação por retenção. Papéis de operação com acesso direto têm procedimento de acesso emergencial e auditoria de sessão registrados em `../operacao/privacidade-e-protecao-de-dados.md`. Não há promessa de isolamento absoluto contra operador com acesso direto: a cifra do CPF com chave fora do banco e AAD por pessoa reduz, sem eliminar, esse risco. O teste trimestral de restauração inclui a custódia das chaves; restaurar o banco sem a chave não é restauração.
