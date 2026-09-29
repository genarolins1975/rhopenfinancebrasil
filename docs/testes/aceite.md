# Registro de aceite

## Etapa 0 (definição)

Data: 28/09/2026. Executor: sessão principal. Revisores: dois subagentes independentes com contexto limpo, sem participação na escrita, instruídos a confrontar e não repetir.

### Checklist de aceite da Etapa 0

| Critério | Situação |
|---|---|
| Repositório inspecionado e estado registrado | Atendido |
| Fontes disponíveis e ausentes declaradas; números da pesquisa transcritos com fidelidade | Atendido; o revisor 1 conferiu número a número |
| Mapa do produto, arquitetura de informação, navegação e estados de tela | Atendido após correção: padrão dos oito estados definido |
| Arquitetura com versões verificadas em fonte oficial e data | Atendido após correção: datas de publicação conferidas no registro npm |
| Matriz de permissões com separação de atribuições | Atendido após correções: administrador por concessão, RH sem reservas por perfil, troca de email com confirmação, privilégio só após segundo fator |
| Modelo de dados com constraints, locks e triggers | Atendido após reescrita: estado de atribuição derivado, `btree_gist`, lock por trigger, triggers deferidos em todas as tabelas que alteram elegibilidade, expiração preguiçosa de retenções, fuso horário |
| Política DIR completa (`DIR-001` a `DIR-036`) com fluxos de travar, vincular, transferir, encerrar, anular, liberar, revogar, conflitos, grupo e lote | Atendido após correções |
| Telas prioritárias com estados e destaque da exclusividade | Atendido após correções: marcadores ilustrativos, ações de travar e agendar, aba do grupo |
| Registro de decisões separando requisito aprovado de parâmetro pendente; perguntas bloqueantes | Atendido após correções: `PAR-23` a `PAR-36`, `DEC-13`, `DEC-14` |
| Matriz requisito, implementação e teste com os 15 casos transcritos literalmente | Atendido após correções |
| Plano por etapas com critérios de aceite coerentes com a matriz | Atendido após correção |
| Planta oficial lida; inventário preliminar marcado como não validado | Atendido |
| Nenhum código, planta fictícia como definitiva ou dado pessoal inventado | Atendido |

### Revisão 1: cobertura de requisitos

Veredito: aceito com correções. 24 achados: 1 de severidade alta, 11 médias, 12 baixas; 12 obrigatórios antes da Etapa 1. Todos os 24 aplicados em 28/09/2026. Principais: regra de elegibilidade única entre serviço e banco com semântica da liberação nominal (`DIR-031`, `PAR-26`); fluxo de transferência com as três opções de conflito; gestão dos integrantes do grupo (`DIR-032`); administrador e administrador técnico sem permissões automáticas além de configuração; invariantes de CPF, senha e intenção presencial; datas de publicação das versões; padrão dos oito estados; resultados obrigatórios transcritos literalmente.

### Revisão 2: adversarial técnica

Veredito: aceito com correções. 30 achados: 1 bloqueante, 9 de severidade alta, 18 médias, 2 baixas, com cenários executados pelo revisor no PostgreSQL 16 local. Todos incorporados em 28/09/2026. Principais: estado da atribuição derivado da vigência, com anulação como único caso fora da constraint de sobreposição (`DIR-036`); extensão `btree_gist`; lock por recurso imposto por trigger e leitura em instrução separada; triggers deferidos em `access_group_member`, `employee`, `office_calendar`, `resource` e `resource_status_period`; manutenção e fechamento sobre reservas com diálogo de conflito (`DIR-033`); retenção vencida tratada na leitura e no caminho de escrita (`DIR-034`); chave de idempotência da semana por requisição; plugin admin do Better Auth não montado e lista explícita de caminhos (`DEC-13`); troca de email com confirmação e privilégio só após segundo fator; importação sem oráculo de CPF; cifra com nonce, AAD e versão de chave; `local_today()` e `local_day_range()`; `released_on`; janela de abertura na ordem de cálculo; `desk_class` para indicadores; checks da exceção; `needs_review` só individual; confirmação de uso resolvida no servidor; fila oferecendo na transação do cancelamento; cache de sessão desativado; limite por conta; credenciais de email só por segredo; piso de supressão em código; anexos por mensagem ou nota; resposta do mapa sem identificadores de titular.

O revisor 2 pediu reapresentação dos itens 1, 3, 4, 6 e 9. Resultado registrado na seção seguinte.

### Reapresentação dos itens críticos

Terceiro revisor, contexto limpo, 28/09/2026. Método: reproduziu constraints, funções e triggers num banco de teste no PostgreSQL 16 local com duas sessões concorrentes, e leu o código de `better-auth@1.7.6` em vez de responder de memória. Veredito: aprovado com ajustes. Por item:

| Item | Veredito | Ajuste incorporado |
|---|---|---|
| 1, duas atribuições vigentes | Parcial: constraint correta, mas a tela prometia regras de vigência que o banco não impunha (reabrir, encerrar no passado, mover o início, anular em duas etapas, anular sucessora) | Trigger de vigência em `exclusive_assignment`, checks de `ended_by` e `end_reason`, transferência atômica com sucessora verificada no commit (`DIR-036`, `DIR-036-T3`) |
| 3, triggers deferidos como rede independente | Parcial: visibilidade no commit confirmada empiricamente; faltavam locks impostos pelo banco para pessoa, grupo e dia, e a dependência do `for update` contra o `for key share` das chaves estrangeiras não estava declarada | Triggers de lock em `employee`, `access_group_member`, advisory lock do dia dentro dos triggers de reserva e calendário; realocação travando as duas mesas; `DIR-024-T2` removendo todos os locks da aplicação |
| 4, mutações sem recurso | Parcial: um par (criar atribuição de grupo e remover integrante) confirmava sem lock comum; suspensão contradizia o trigger | Lock do grupo antes de derivar o conjunto e nova derivação até estabilizar; `booking_remains_valid` separada de `is_bookable`; `needs_review` de titular inativo por consulta derivada |
| 6, retenção vencida | Parcial: o `update` de expiração violava o próprio check; filtro precisava de recurso e pessoa; lock indevido em mesa de terceiros; fila contornada na reserva direta; entrada `offered` eterna | Check ajustado, filtro duplo, trigger de lock ignorando expiração, job com uma oferta por transação, expiração preguiçosa também na fila, fila antes da reserva direta (`PAR-37`) |
| 9, Better Auth | Parcial: alegações plausíveis, mas `change-email` só confirma no endereço antigo com `sendChangeEmailConfirmation`, hooks de criação de sessão não cobrem sessões existentes, `trustDevice` pulava o segundo fator por 30 dias, nome correto é `deleteUserSessions`, adaptador interno não é API estável | `DEC-13` ampliada: `disabledPaths` com caminhos exatos, hook global conferindo `employee.status`, `trustDevice` neutralizado para perfis administrativos, `emailVerified` no aceite do convite, versão fixada e testes `AUT-13` e `AUT-14`; `RSK-21` e `RSK-22` |

Todos os ajustes foram incorporados em 28/09/2026. O revisor considerou a Etapa 1 liberada com os ajustes do item 9 e a Etapa 2 dependente dos itens 1 a 4, agora incorporados; a comprovação definitiva é a bateria de testes de integração e concorrência da Etapa 2, não a leitura do texto.

### Verificações executadas

Não há código, portanto não há testes de software. Executadas: consulta ao registro npm e à documentação oficial (28/09/2026); revisão 1; revisão 2 com cenários SQL no cluster local, que confirmaram que exclusão GiST com `uuid` exige `btree_gist`, que índice parcial com `now()` é rejeitado, que `daterange` com limite superior nulo é ilimitado e que o cast de `timestamptz` para `date` em sessão UTC muda o dia entre 21:00 e 23:59 de Brasília.

### Situação do aceite

Executor: entregue. Revisores: duas revisões aceitas com correções e reapresentação aprovada com ajustes; todas as correções e ajustes aplicados. Responsável pelo produto: pendente de validação, única pergunta que bloqueia a Etapa 1.

## Etapa 1 (fundação)

Data: 29/09/2026. Executor: sessão principal. Revisor: subagente independente com contexto limpo, com acesso ao código, ao banco de teste e às baterias de teste.

### Relato do Executor

Escopo entregue conforme `00-estado-do-projeto.md`. Testes executados no ambiente da sessão: 17 de unidade, 37 de integração com PostgreSQL real e 24 de ponta a ponta com axe (12 por projeto, desktop e celular), todos aprovados; tipos e lint sem erros; build de produção concluído. Casos cobertos por identificador na matriz de rastreabilidade (`AUT-01` a `AUT-14`, `CPF-01` a `CPF-04`, `ACC-01`, `IMP-01`, `EMP-01`, `NOT-01`, `DB-01`, `A11Y-01`).

Limitações declaradas: sem verificação manual com leitor de tela; sem provedor real de email; sem rotação automatizada de chave; fluxo de troca de email testado só no nível da configuração; reenfileiramento de revogação de sessão não coberto por teste; o limitador por IP depende do cabeçalho configurado na plataforma.

### Revisão independente (29/09/2026)

Revisor com contexto limpo, acesso ao código, ao banco de teste e ao código do `better-auth@1.7.6`; executou as baterias oficiais e 21 testes adversos temporários. Veredito: REJEITADO, com 26 achados. Motivo declarado: falhas de autorização e exposição de dados bloqueiam o aceite pelo critério da seção 23 do prompt, e três pontos relatados como implementados (limite por hora da importação, "só o hash é gravado", captura de 23505 com detalhe redigido) não estavam.

| Nº | Severidade | Achado | Tratamento |
|---|---|---|---|
| 1 | ALTA | Gestor sem segundo fator lia colaboradores e concessões no ambiente administrativo (`report.view` liberava a área) | Corrigido: `report.view` fora da área administrativa; cada página exige permissão própria; teste ponta a ponta com gestor |
| 2 | ALTA | Troca de email deixava `employee.corporate_email` divergente, o link público emitia sessão sem senha nem segundo fator e permitia tomar o email de pessoa convidada | Corrigido: link final exige sessão e nunca emite sessão; hook sincroniza cadastro com auditoria; email já cadastrado recusado; `AUT-10-T1` |
| 3 | ALTA | Tokens de convite e recuperação em claro na outbox após a entrega | Corrigido: carga apagada na entrega, bloqueio ou desistência; token de recuperação do Better Auth em claro por 60 minutos registrado em `RSK-23` |
| 4 | ALTA | Prévia da importação sem o limite prometido (oráculo de CPF) | Corrigido: 5 prévias e 3.000 linhas por pessoa por hora (`PAR-41`), com teste |
| 5 | ALTA | Erro de banco não tratado levava parâmetros da consulta (HMAC, cifra, nome, email) ao log; entradas sem validação | Corrigido: `translateDbError` e `safeErrorInfo`; validação de UUID, datas e referências antes do banco; `CPF-03-T2` com corrida real e log capturado |
| 6 | MÉDIA | Regra das 12 horas e `requirePermission` não valiam nas actions de concessão | Corrigido: expiração em `getCurrentResult`, válida em todo caminho; actions exigem permissão (`PAR-42`) |
| 7 | MÉDIA | `discardImport` sem conferir dono nem status | Corrigido, com teste |
| 8 | MÉDIA | `role.assign.standard` concedia qualquer permissão não sensível | Corrigido: toda permissão direta exige `role.assign.privileged` (`PAR-40`) |
| 9 | MÉDIA | RH suspendia administradores; `--force` do bootstrap sem controle | Corrigido: alvo privilegiado exige `role.assign.privileged`; `--force` recusado em homologação e produção; link só em desenvolvimento e teste; lock transacional |
| 10 | MÉDIA | Cookies sem `Secure` em homologação | Corrigido: `Secure` segue o esquema `https` da URL base |
| 11 | MÉDIA | Página da pessoa com rolagem horizontal no celular | Corrigido: `min-w-0` e região rolável; teste de `scrollWidth` em todas as páginas administrativas no projeto celular |
| 12 | MÉDIA | Sem estados de erro, indisponibilidade, conexão perdida e não encontrado | Corrigido: `error.tsx`, `global-error.tsx`, `not-found.tsx`, `loading.tsx`, aviso de conexão perdida, identificador de requisição nas mensagens |
| 13 | MÉDIA | Falsa confirmação de envio de convite | Corrigido: `sent` e `sent_at` só após envio real; `blocked` por lista de destinatários |
| 14 | MÉDIA | Pessoa suspensa ou desativada recebia recuperação e redefinia senha | Corrigido: sem email para inativos; hooks negam `sign-in` e `reset-password`, com teste |
| 15 | MÉDIA | Dois "página atual" na navegação; diálogos sem nome acessível | Corrigido: comparação exata para a raiz; ids por slug; axe com diálogo aberto |
| 16 | MÉDIA | Asserções fracas (`rejects.toBeTruthy`) e casos da matriz sem teste | Corrigido: asserções por código de resposta e ausência de sessão; novos testes `AUT-07`, `AUT-10-T1`, `AUT-11` pela action, `CPF-03-T2`, limite de prévias, redação da outbox |
| 17 | MÉDIA | Documentação divergente do código | Corrigido em arquitetura, modelo de dados, matriz de permissões, guia, decisões e riscos |
| 18 | BAIXA | RH editava o próprio cadastro e virava diretor | Corrigido: autoedição de área, gestor e condição bloqueada |
| 19 | BAIXA | `mfaRequired` ignorava permissões sensíveis diretas | Corrigido |
| 20 | BAIXA | Bloqueio por conta permite negação de serviço; sucesso registrado antes do TOTP | Pendência registrada em `RSK-24` para a Etapa 5 |
| 21 | BAIXA | Modelo CSV com CPF inválido | Corrigido: CPF sintético válido |
| 22 | BAIXA | Redefinição de senha sem contexto de nome e email na política | Corrigido |
| 23 | BAIXA | Revogar convite sem motivo; reenvio sem limite | Motivo obrigatório corrigido; limite de reenvio registrado em `RSK-24` |
| 24 | BAIXA | Checagem do bootstrap fora da transação | Corrigido com `pg_advisory_xact_lock` |
| 25 | BAIXA | Sem cabeçalhos de segurança | Cabeçalhos básicos aplicados; CSP com nonce registrada em `RSK-25` para a Etapa 5 |
| 26 | BAIXA | Curingas sem escape no filtro de busca | Corrigido |

### Relato do Executor na reapresentação (29/09/2026)

Testes executados após as correções, no mesmo ambiente: 17 de unidade, 47 de integração com PostgreSQL real, 28 de ponta a ponta com axe (14 por projeto, desktop e celular), todos aprovados; tipos, lint e build de produção sem erros. Evidências pedidas pelo revisor: teste `CPF-03-T2` com corrida de 23505 e log capturado em arquivo sem consulta, email ou CPF; teste ponta a ponta com gestor redirecionado em cinco rotas administrativas; `AUT-10-T1` completo; consulta direta ao banco de teste mostrando `outbox_event.payload = {"redacted": true}` e `invitation.token_hash` com 64 caracteres após a entrega; `scrollWidth <= clientWidth` em seis páginas administrativas e no detalhe da pessoa no projeto celular.

### Reapresentação (29/09/2026)

Segundo Revisor independente, contexto limpo, com execução própria: baterias oficiais (17, 47 e 28 aprovados, tipos, lint e build sem erros), 8 testes de integração e 6 de ponta a ponta adversos temporários, 5 execuções do bootstrap e consultas SQL diretas. Dos 20 achados verificados, 13 confirmados corrigidos e 7 corrigidos em parte, com 11 achados novos ou remanescentes. Veredito: ACEITO COM CORREÇÕES, obrigatórias 1 a 5, recomendadas 6 a 11.

| Nº | Severidade | Achado | Tratamento na mesma data |
|---|---|---|---|
| 1 | ALTA | RH com `employee.manage` trocava o email de convidada já privilegiada, reenviava o convite para endereço próprio e tomava a conta; reativava administrador suspenso | Corrigido: alvo com concessão privilegiada exige `role.assign.privileged` também para trocar email de convidada, reenviar e revogar convite, reativar e readmitir; teste `privileged-target.test.ts` reproduz a tomada e a reativação |
| 2 | MÉDIA | Endereço cadastrado para outra pessoa entre os dois links deixava identidade e cadastro divergentes, com erro 500 | Corrigido: hook recusa antes de tocar a identidade e redireciona com aviso; se o cadastro recusar, a identidade volta ao email anterior; teste com conflito entre os links e log verificado |
| 3 | MÉDIA | Consulta e parâmetros chegavam ao log pelo logger do Better Auth e por id fora do formato UUID nas páginas | Corrigido: logger do Better Auth redirecionado ao pino com redação; `getEmployee` devolve nulo para id inválido; teste ponta a ponta com id inválido |
| 4 | MÉDIA | Status de entrega do convite invisível na tela; painel ignorava `blocked`; guia afirmava o contrário | Corrigido: cartão de convites mostra enfileirado, enviado ou bloqueado; painel conta bloqueadas; teste de convite bloqueado na outbox e em `invitation` |
| 5 | MÉDIA | Aviso `confirmar-email` sem texto na tela de entrada | Corrigido, com teste ponta a ponta |
| 6 | BAIXA | Id fora do formato levava a erro genérico em vez de 404 | Corrigido (mesma correção do achado 3) |
| 7 | BAIXA | Identificador de requisição nunca preenchido nas mensagens | Corrigido: toda action passa `requestId` do ator à mensagem e ao log |
| 8 | BAIXA | Autoedição do RH falhava mesmo só no nome | Corrigido: bloqueio só quando área, gestor ou condição mudam de fato; teste |
| 9 | BAIXA | Oráculo de tempo no login de pessoa inativa (2 ms contra 33 ms) | Corrigido: o hook gasta o custo do hash de senha antes de negar |
| 10 | BAIXA | Rolagem horizontal no desktop com prévia da importação | Corrigido: `min-w-0` no conteúdo principal; teste com prévia gerada nos dois projetos |
| 11 | BAIXA | Matriz de testes acima do que existia | Corrigido: textos ajustados e testes completados (convite bloqueado, edição e prévia sem rolagem, título do limite de prévias) |

Testes executados após estas correções: 17 de unidade, 50 de integração, 30 de ponta a ponta (15 por projeto), todos aprovados; tipos, lint e build sem erros; `.log-test.ndjson` sem "Failed query" nem "params".

### Terceira verificação

Em execução em 29/09/2026.
