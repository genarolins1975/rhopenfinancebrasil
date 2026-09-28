# Matriz requisito, implementação e teste

Referência: 28/09/2026. Coluna "Implementação" aponta o módulo previsto enquanto não há código; passa a apontar arquivos quando existir. Coluna "Status": pendente, implementado, testado, aceito. Tipos de teste: U (unitário), I (integração com banco), C (concorrência com sessões distintas), E (ponta a ponta), A (acessibilidade), M (manual).

## Exclusividade (casos obrigatórios do prompt §23, resultado transcrito literalmente)

| Caso | Requisito | Implementação prevista | Teste | Tipo | Resultado obrigatório | Status |
|---|---|---|---|---|---|---|
| Colaborador tenta reservar mesa individual da diretoria | `DIR-008`, `DIR-021`, `DIR-022` | `availability`, `booking` | `DIR-008-T1` por API, `DIR-008-T2` por semana, `DIR-008-T3` por fila | I, E | Negação no servidor, por qualquer rota. | pendente (Etapa 2) |
| Usuário altera IDs no pedido | `DIR-022` | `booking`, `access` | `DIR-022-T1` | I | Sem acesso à mesa, reserva ou pessoa não autorizada. | pendente (Etapa 2) |
| Diretor titular reserva sua mesa | `DIR-009` | `booking` | `DIR-009-T1` | I, E | Permitido se operacional e sem conflito. | pendente (Etapa 2) |
| Outro diretor tenta essa mesma mesa | `DIR-002` | `availability` | `DIR-002-T1` | I | Negado sem exceção específica. | pendente (Etapa 2) |
| Integrante autorizado reserva mesa exclusiva de grupo | `DIR-010` | `availability`, `booking` | `DIR-010-T1`, `DIR-010-T2` (integrante inativo negado) | I | Permitido conforme política e disponibilidade. | pendente (Etapa 2) |
| RH trava mesa sem reservas incompatíveis | `DIR-004`, `DIR-021` | `exclusivity` | `DIR-004-T1` (mapa, lista, busca, semana, fila refletem) | I, E | Restrição aplicada de forma consistente a todos os canais. | pendente (Etapa 2) |
| RH trava mesa com reservas incompatíveis | `DIR-016` | `exclusivity` | `DIR-016-T1` (conflito explícito), `DIR-016-T2` (opções), `DIR-016-T3` (revalidação na confirmação) | I, E | Conflito explícito; nenhuma exclusão silenciosa. | pendente (Etapa 2) |
| RH trava enquanto colaborador reserva | `DIR-024` | `exclusivity`, `booking` | `DIR-024-T1` (barreira de sincronização, 50 repetições), `DIR-024-T2` (trigger deferido sem lock) | C, I | Apenas um resultado serializável e coerente; sem reserva proibida coexistente. | pendente (Etapa 2) |
| Diretor cancela ou não faz check-in | `DIR-006` | `booking`, `checkin` | `DIR-006-T1`, `DIR-006-T2` | I | Exclusividade permanece. | pendente (Etapa 2) |
| Fila procura vaga para funcionário comum | `DIR-025` | `availability`, `waitlist` | `DIR-025-T0` (serviço nunca lista mesa exclusiva como ofertável), `DIR-025-T1` (fluxo completo da fila) | I, C | Mesa exclusiva não é oferecida sem exceção válida. | pendente (T0 na Etapa 2; T1 na Etapa 3) |
| Liberação temporária expira | `DIR-013` | `availability` | `DIR-013-T1` (relógio simulado, sem job) | U, I | Política exclusiva volta pela vigência, mesmo sem execução de job. | pendente (Etapa 2) |
| Mesa exclusiva entra em manutenção | `DIR-020` | `availability` | `DIR-020-T1` (titular negado), `DIR-020-T2` (exceção não anula) | I | Reserva impedida também para o titular. | pendente (Etapa 2) |
| Titular é desativado | `DIR-018` | `employees`, `exclusivity` | `DIR-018-T1` | I, E | Acesso revogado e vínculo sinalizado para RH; mesa não liberada automaticamente. | pendente (Etapa 2) |
| Usuários disputam a última vaga | `DIR-023`, `DIR-024` | `booking` | `DIR-023-T1` (N sessões, uma confirmação) | C | Uma confirmação; demais recebem conflito correto. | pendente (Etapa 2) |
| Capacidade combina exclusividade e manutenção | `DIR-026` | `availability` (cálculo de capacidade) | `DIR-026-T1` (união de restrições), `DIR-026-T2` (vínculo não vira utilização) | U | Sem dupla contagem ou indicador de presença fictício. | pendente (Etapa 2) |

## Demais regras DIR

| Requisito | Implementação prevista | Teste | Tipo | Status |
|---|---|---|---|---|
| `DIR-003` dimensões separadas | `workplace`, `exclusivity` | `DIR-003-T1` (mesa exclusiva em manutenção mantém as duas informações) | I | pendente (Etapa 2) |
| `DIR-005` vínculo não é reserva | `availability` | `DIR-005-T1` | U | pendente (Etapa 2) |
| `DIR-007` sem recomendação | `availability` | `DIR-007-T1` | I | pendente (Etapa 3) |
| `DIR-011` reserva em nome | `booking`, `access` | `DIR-011-T1` (permissão), `DIR-011-T2` (ator e notificação) | I, E | pendente (Etapa 2) |
| `DIR-012` uma reserva por dia | `booking` | `DIR-012-T1` | I | pendente (Etapa 2) |
| `DIR-014` reserva fora da janela | `availability` | `DIR-014-T1` | I | pendente (Etapa 2) |
| `DIR-015` diretor não remove | `exclusivity`, `access` | `DIR-015-T1` | I | pendente (Etapa 2) |
| `DIR-017` transferência e revogação | `exclusivity` | `DIR-017-T1`, `DIR-017-T2` | I, E | pendente (Etapa 2) |
| `DIR-019` ordem de cálculo | `availability` | `DIR-019-T1` (tabela de casos com razão esperada) | U | pendente (Etapa 2) |
| `DIR-027` lote atômico | `exclusivity` | `DIR-027-T1` | I | pendente (Etapa 2) |
| `DIR-028` auditoria e notificação | `audit`, `notifications` | `DIR-028-T1` | I | pendente (Etapa 2) |
| `DIR-029` datas locais | `availability`, `booking` | `DIR-029-T1` (virada de dia em UTC e horário de Brasília) | U, I | pendente (Etapa 2) |
| `DIR-030` planta não altera identidade | `workplace` | `DIR-030-T1` | I | pendente (Etapa 2) |
| `DIR-031` função única de elegibilidade | `availability`, `db` (triggers) | `DIR-031-T1` (mesma tabela de casos no serviço e no banco), `DIR-031-T2` (titular durante liberação nominal) | U, I | pendente (Etapa 2) |
| `DIR-032` remoção de integrante do grupo | `exclusivity` | `DIR-032-T1` (prévia e conflito), `DIR-032-T2` (trigger no commit) | I | pendente (Etapa 2) |
| `DIR-033` manutenção, bloqueio, fechamento e desativação sobre reservas | `workplace`, `availability` | `DIR-033-T1` (prévia e decisão), `DIR-033-T2` (trigger rejeita reserva em período indisponível), `DIR-033-T3` (calendário fechado com reserva em voo) | I, C | pendente (Etapa 2) |
| `DIR-034` retenção vencida não trava mesa nem pessoa; oferta nasce no cancelamento | `booking`, `waitlist` | `DIR-034-T1` (sem job, nova reserva entra), `DIR-034-T2` (oferta criada na transação do cancelamento) | I | pendente (T1 Etapa 2; T2 Etapa 3) |
| `DIR-035` resposta sem identificadores de titular | `availability`, `app` | `DIR-035-T1` (varredura das respostas do mapa, lista, busca e semana) | I, E | pendente (Etapa 2) |
| `DIR-036` estado derivado; encerrar não contorna a sobreposição | `exclusivity`, `db` | `DIR-036-T1` (encerrar e criar nova atribuição sobreposta é rejeitado), `DIR-036-T2` (anular só antes do início) | I | pendente (Etapa 2) |
| Modelo: extensão e constraints existem no catálogo | `db` | `DB-01` | I | pendente (Etapa 1) |
| Modelo: lock imposto por trigger | `db` | `DIR-024-T2` (aplicação sem lock, banco rejeita coexistência) | C | pendente (Etapa 2) |
| Modelo: virada de dia local | `db`, `availability` | `DIR-029-T1` às 21:00, 23:59 e 00:00 de Brasília, inclusive `local_day_range` para salas | U, I | pendente (Etapa 2) |
| Modelo: chave da semana por requisição | `booking` | `BKG-02-T4` (cinco dias com uma chave) | I | pendente (Etapa 2) |
| Modelo: transferência e anulação com restrições | `exclusivity` | `DIR-017-T3` (mesma mesa, datas contíguas, sem retroagir) | I | pendente (Etapa 2) |

## Acesso, cadastro e CPF

| Requisito | Implementação prevista | Teste | Tipo | Status |
|---|---|---|---|---|
| `REQ-01` convite expirado ou usado | `identity` | `AUT-01-T1`, `AUT-01-T2` | I, E | pendente (Etapa 1) |
| `REQ-01` sem autorregistro | `identity` | `AUT-02-T1` (rota de cadastro inexistente ou negada) | I | pendente (Etapa 1) |
| Troca obrigatória de senha temporária, se o fluxo for adotado | `identity` | `AUT-03-T1` | I | pendente (Etapa 1) |
| Recuperação sem revelar conta | `identity` | `AUT-04-T1` | I, E | pendente (Etapa 1) |
| Limite de tentativas | `identity` | `AUT-05-T1` | I | pendente (Etapa 1) |
| MFA obrigatório para admin | `identity`, `access` | `AUT-06-T1` | E | pendente (Etapa 1) |
| Revogação de sessão em desativação e troca de senha | `identity`, `employees` | `AUT-07-T1` | I | pendente (Etapa 1) |
| `REQ-23` e `REQ-24` CPF nunca em senha, usuário ou recuperação; senha nunca exibida | `identity` | `AUT-08-T1` (revisão de código e teste de rotas) | I, M | pendente (Etapa 1) |
| Endpoints administrativos de identidade inexistentes | `identity` | `AUT-09-T1` (`/api/auth/admin/*` responde 404 para toda sessão) | I | pendente (Etapa 1) |
| Troca de email com confirmação no endereço antigo; convite revogado ao editar email de convidado; privilégio só após ativo com segundo fator | `identity`, `employees`, `access` | `AUT-10-T1`, `AUT-10-T2`, `AUT-10-T3` | I, E | pendente (Etapa 1) |
| Limite por conta com cabeçalho de IP forjado | `identity` | `AUT-11-T1` | I | pendente (Etapa 1) |
| Revogação vale na requisição seguinte (sem cache de sessão) | `identity`, `access` | `AUT-12-T1` | I | pendente (Etapa 1) |
| Importação não é oráculo de CPF; detalhe de unicidade redigido; arquivo não persistido | `employees` | `CPF-03-T1`, `CPF-03-T2`, `CPF-03-T3` | I | pendente (Etapa 1) |
| Cifra com nonce único, AAD por pessoa, versão de chave e rotação em duas fases | `employees` | `CPF-04-T1` (troca de texto cifrado entre linhas falha), `CPF-04-T2` (rotação) | U, I | pendente (Etapa 1) |
| Readmissão reutiliza cadastro e zera credenciais | `employees`, `identity` | `EMP-01-T1` | I | pendente (Etapa 1) |
| `REQ-05` CPF ausente de respostas, logs, erros, exportações | `employees`, `audit` | `CPF-01-T1` (varredura de padrão), `CPF-01-T2` (mascaramento), `CPF-01-T3` (revelação auditada) | I, E | pendente (Etapa 1) |
| `REQ-05` HMAC para duplicidade e zeros à esquerda | `employees` | `CPF-02-T1` | U, I | pendente (Etapa 1) |
| `REQ-04` sem autopromoção | `access` | `ACC-01-T1`, `ACC-01-T2` (importação ignora perfis) | I | pendente (Etapa 1) |
| Importação CSV com prévia e validação por linha | `employees` | `IMP-01-T1` | I, E | pendente (Etapa 1) |
| `REQ-28` buscas, anexos e exportações sob o mesmo controle de acesso | `content`, `helpdesk`, `access` | `ACC-02-T1` (anexos), `ACC-02-T2` (chamados), `ACC-02-T3` (pesquisas), `ACC-02-T4` (busca e exportação) | I | pendente (Etapa 4) |

## Operação e experiência

| Requisito | Implementação prevista | Teste | Tipo | Status |
|---|---|---|---|---|
| Cancelamento reflete disponibilidade imediatamente | `booking` | `BKG-01-T1` | I | pendente (Etapa 2) |
| Semana atômica e idempotente (`REQ-25` intenção não é reserva) | `booking` | `BKG-02-T1`, `BKG-02-T2`, `BKG-02-T3` (intenção sem reserva não gera presença) | I | pendente (Etapa 2) |
| Salas sem sobreposição e adjacência permitida | `booking` | `BKG-03-T1` | I | pendente (Etapa 3) |
| Falha de notificação não corrompe reserva | `notifications` | `NOT-01-T1` | I | pendente (Etapa 2) |
| Fila sem dupla oferta e próxima pessoa elegível automática (`REQ-26`) | `waitlist` | `WL-01-T1`, `WL-02-T1` | C, I | pendente (Etapa 3) |
| `REQ-15` confirmação de uso não libera nem remove exclusividade; QR resolve a reserva no servidor | `checkin` | `CHK-01-T1`, `CHK-02-T1` (id de reserva alheia rejeitado) | I | pendente (Etapa 3) |
| Fila nega inscrição com reserva ativa na data | `waitlist` | `WL-03-T1` | I | pendente (Etapa 3) |
| Indicadores por `desk_class` sem dupla contagem, `held` fora do numerador, exceção contada | `availability`, `reports` | `DIR-026-T3` (exceção ao compartilhado), `DIR-026-T4` (períodos sobrepostos), `DIR-026-T5` (titular fora do numerador compartilhado) | U | pendente (Etapa 2) |
| Piso de supressão não configurável | `listening` | `ESC-02-T1` | I | pendente (Etapa 4) |
| Anexo de nota interna não migra na reclassificação | `helpdesk` | `ATD-03-T1` | I | pendente (Etapa 4) |
| `REQ-26` transições de atendimento com motivo; reclassificação sem expor notas internas | `helpdesk` | `ATD-01-T1`, `ATD-02-T1` | I | pendente (Etapa 4) |
| `REQ-28` conteúdo e busca respeitam controle de acesso | `content` | `CNT-01-T1` | I | pendente (Etapa 4) |
| `REQ-22` divergência de copa e nota metodológica exibidas | `actions`, `reports` | `IND-01-T1` | E | pendente (Etapa 4) |
| Supressão de grupos pequenos (`PAR-13`) | `listening` | `ESC-01-T1` | U | pendente (Etapa 4) |
| Acessibilidade dos fluxos prioritários | `components`, `design` | `A11Y-01` (axe) e `A11Y-02` (teclado e leitor de tela, manual) | A, M | pendente (Etapas 1 a 4) |
| Restauração de backup | operação | `OPS-01` | M | pendente (Etapa 5) |
