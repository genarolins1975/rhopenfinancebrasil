# Matriz requisito, implementação e teste

Referência: 28/09/2026. Coluna "Implementação" aponta o módulo previsto enquanto não há código; passa a apontar arquivos quando existir. Coluna "Status": pendente, implementado, testado, aceito. Tipos de teste: U (unitário), I (integração com banco), C (concorrência com sessões distintas), E (ponta a ponta), A (acessibilidade), M (manual).

## Exclusividade (casos obrigatórios do prompt §23)

| Caso | Requisito | Implementação prevista | Teste | Tipo | Resultado obrigatório | Status |
|---|---|---|---|---|---|---|
| Colaborador tenta reservar mesa individual da diretoria | `DIR-008`, `DIR-021`, `DIR-022` | `availability`, `booking` | `DIR-008-T1` por API, `DIR-008-T2` por semana, `DIR-008-T3` por fila | I, E | Negação no servidor por qualquer rota | pendente (Etapa 2) |
| Usuário altera IDs no pedido | `DIR-022` | `booking`, `access` | `DIR-022-T1` | I | Sem acesso à mesa, reserva ou pessoa não autorizada | pendente (Etapa 2) |
| Diretor titular reserva sua mesa | `DIR-009` | `booking` | `DIR-009-T1` | I, E | Permitido se operacional e sem conflito | pendente (Etapa 2) |
| Outro diretor tenta essa mesma mesa | `DIR-002` | `availability` | `DIR-002-T1` | I | Negado sem exceção específica | pendente (Etapa 2) |
| Integrante autorizado reserva mesa exclusiva de grupo | `DIR-010` | `availability`, `booking` | `DIR-010-T1`, `DIR-010-T2` (integrante inativo negado) | I | Permitido conforme política e disponibilidade | pendente (Etapa 2) |
| RH trava mesa sem reservas incompatíveis | `DIR-004`, `DIR-021` | `exclusivity` | `DIR-004-T1` (mapa, lista, busca, semana, fila refletem) | I, E | Restrição consistente em todos os canais | pendente (Etapa 2) |
| RH trava mesa com reservas incompatíveis | `DIR-016` | `exclusivity` | `DIR-016-T1` (conflito explícito), `DIR-016-T2` (opções), `DIR-016-T3` (revalidação na confirmação) | I, E | Conflito explícito; nenhuma exclusão silenciosa | pendente (Etapa 2) |
| RH trava enquanto colaborador reserva | `DIR-024` | `exclusivity`, `booking` | `DIR-024-T1` (barreira de sincronização, 50 repetições), `DIR-024-T2` (trigger deferido sem lock) | C, I | Um único resultado serializável; sem reserva proibida coexistente | pendente (Etapa 2) |
| Diretor cancela ou não confirma uso | `DIR-006` | `booking`, `checkin` | `DIR-006-T1`, `DIR-006-T2` | I | Exclusividade permanece | pendente (Etapa 2) |
| Fila procura vaga para funcionário comum | `DIR-025` | `waitlist` | `DIR-025-T1` | I | Mesa exclusiva não oferecida sem exceção válida | pendente (Etapa 3) |
| Liberação temporária expira | `DIR-013` | `availability` | `DIR-013-T1` (relógio simulado, sem job) | U, I | Política volta pela vigência | pendente (Etapa 2) |
| Mesa exclusiva entra em manutenção | `DIR-020` | `availability` | `DIR-020-T1` (titular negado), `DIR-020-T2` (exceção não anula) | I | Reserva impedida também para o titular | pendente (Etapa 2) |
| Titular é desativado | `DIR-018` | `employees`, `exclusivity` | `DIR-018-T1` | I, E | Acesso revogado, vínculo em revisão, mesa não liberada | pendente (Etapa 2) |
| Usuários disputam a última vaga | `DIR-023`, `DIR-024` | `booking` | `DIR-023-T1` (N sessões, uma confirmação) | C | Uma confirmação; demais recebem conflito | pendente (Etapa 2) |
| Capacidade combina exclusividade e manutenção | `DIR-026` | `reports` | `DIR-026-T1` (união de restrições), `DIR-026-T2` (vínculo não vira utilização) | U | Sem dupla contagem ou presença fictícia | pendente (Etapa 3) |

## Demais regras DIR

| Requisito | Teste | Tipo | Status |
|---|---|---|---|
| `DIR-003` dimensões separadas | `DIR-003-T1` (mesa exclusiva em manutenção mantém as duas informações) | I | pendente (Etapa 2) |
| `DIR-005` vínculo não é reserva | `DIR-005-T1` | U | pendente (Etapa 2) |
| `DIR-007` sem recomendação | `DIR-007-T1` | I | pendente (Etapa 3) |
| `DIR-011` reserva em nome | `DIR-011-T1` (permissão), `DIR-011-T2` (ator e notificação) | I, E | pendente (Etapa 2) |
| `DIR-012` uma reserva por dia | `DIR-012-T1` | I | pendente (Etapa 2) |
| `DIR-014` reserva fora da janela | `DIR-014-T1` | I | pendente (Etapa 2) |
| `DIR-015` diretor não remove | `DIR-015-T1` | I | pendente (Etapa 2) |
| `DIR-017` transferência e revogação | `DIR-017-T1`, `DIR-017-T2` | I, E | pendente (Etapa 2) |
| `DIR-019` ordem de cálculo | `DIR-019-T1` (tabela de casos com razão esperada) | U | pendente (Etapa 2) |
| `DIR-027` lote atômico | `DIR-027-T1` | I | pendente (Etapa 2) |
| `DIR-028` auditoria e notificação | `DIR-028-T1` | I | pendente (Etapa 2) |
| `DIR-029` datas locais | `DIR-029-T1` (virada de dia em UTC e horário de Brasília) | U, I | pendente (Etapa 2) |
| `DIR-030` planta não altera identidade | `DIR-030-T1` | I | pendente (Etapa 2) |

## Acesso, cadastro e CPF

| Requisito | Teste | Tipo | Status |
|---|---|---|---|
| `REQ-01` convite expirado ou usado | `AUT-01-T1`, `AUT-01-T2` | I, E | pendente (Etapa 1) |
| `REQ-01` sem autorregistro | `AUT-02-T1` (rota de cadastro inexistente ou negada) | I | pendente (Etapa 1) |
| Troca obrigatória de senha temporária | `AUT-03-T1` | I | pendente (Etapa 1) |
| Recuperação sem revelar conta | `AUT-04-T1` | I, E | pendente (Etapa 1) |
| Limite de tentativas | `AUT-05-T1` | I | pendente (Etapa 1) |
| MFA obrigatório para admin | `AUT-06-T1` | E | pendente (Etapa 1) |
| Revogação de sessão em desativação e troca de senha | `AUT-07-T1` | I | pendente (Etapa 1) |
| `REQ-05` CPF ausente de respostas, logs, erros, exportações | `CPF-01-T1` (varredura de padrão), `CPF-01-T2` (mascaramento), `CPF-01-T3` (revelação auditada) | I, E | pendente (Etapa 1) |
| `REQ-05` HMAC para duplicidade e zeros à esquerda | `CPF-02-T1` | U, I | pendente (Etapa 1) |
| `REQ-04` sem autopromoção | `ACC-01-T1`, `ACC-01-T2` (importação ignora perfis) | I | pendente (Etapa 1) |
| Importação CSV com prévia e validação por linha | `IMP-01-T1` | I, E | pendente (Etapa 1) |
| Acesso indevido a anexos, chamados e pesquisas | `ACC-02-T1`, `ACC-02-T2`, `ACC-02-T3` | I | pendente (Etapa 4) |

## Operação e experiência

| Requisito | Teste | Tipo | Status |
|---|---|---|---|
| Cancelamento reflete disponibilidade imediatamente | `BKG-01-T1` | I | pendente (Etapa 2) |
| Semana atômica e idempotente | `BKG-02-T1`, `BKG-02-T2` | I | pendente (Etapa 2) |
| Salas sem sobreposição e adjacência permitida | `BKG-03-T1` | I | pendente (Etapa 3) |
| Falha de notificação não corrompe reserva | `NOT-01-T1` | I | pendente (Etapa 2) |
| Fila sem dupla oferta | `WL-01-T1` | C | pendente (Etapa 3) |
| Supressão de grupos pequenos | `ESC-01-T1` | U | pendente (Etapa 4) |
| Acessibilidade dos fluxos prioritários | `A11Y-01` (axe) e `A11Y-02` (teclado e leitor de tela, manual) | A, M | pendente (Etapas 1 a 4) |
| Restauração de backup | `OPS-01` | M | pendente (Etapa 5) |
