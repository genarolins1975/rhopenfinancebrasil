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
| 1 | ALTA | RH com `employee.manage` trocava o email de convidada já privilegiada, reenviava o convite para endereço próprio e tomava a conta; reativava administrador suspenso | Corrigido: alvo com concessão privilegiada exige `role.assign.privileged` também para trocar email de convidada, reenviar e revogar convite e reativar; teste `privileged-target.test.ts` reproduz a tomada e a reativação |
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

Testes executados após estas correções: 17 de unidade, 51 de integração, 30 de ponta a ponta (15 por projeto), todos aprovados; tipos, lint e build sem erros; `.log-test.ndjson` sem "Failed query" nem "params".

### Terceira verificação (29/09/2026)

Terceiro Revisor independente, contexto limpo, com execução própria: baterias oficiais (17, 51 e 30 aprovados), 7 testes de integração e 5 de ponta a ponta adversos temporários, bootstrap 3 vezes, consultas SQL diretas, medição de tempo do login. Os 11 achados da reapresentação foram confirmados corrigidos, com 8 achados residuais. Veredito: ACEITO COM CORREÇÕES, obrigatórias 1, 6 e 7; recomendadas 2, 3, 4, 5 e 8.

| Nº | Severidade | Achado | Tratamento na mesma data |
|---|---|---|---|
| 1 | MÉDIA | Concessão privilegiada com início futuro deixava a convidada "não privilegiada" hoje e contornava a proteção; a concessão futura nem aparecia na página | Corrigido: a proteção considera toda concessão não revogada e não expirada, inclusive futura (`hasPrivilegedGrantAnyTime`); a página lista concessões agendadas com "a partir de"; teste reproduz o contorno |
| 2 | MÉDIA | Entrega esgotada deixava o convite como "enfileirado" para sempre | Corrigido: ao esgotar as tentativas o convite fica `failed` e a tela pede reenvio; teste com 10 falhas |
| 3 | BAIXA | Guarda de readmissão nunca disparava, e a documentação afirmava proteção inexistente | Corrigido: guarda removida e documentação diz que a readmissão devolve a pessoa sem perfis |
| 4 | BAIXA | Reversão na corrida real respondia 409 em JSON | Corrigido: redireciona para o perfil com aviso |
| 5 | BAIXA | Aceite do convite sem identificador de requisição | Corrigido |
| 6 | BAIXA | Matriz de permissões e guia contradiziam a regra implementada | Corrigido nas duas frases |
| 7 | BAIXA | Registro com 50 testes de integração em vez de 51 | Corrigido; contagem final abaixo |
| 8 | BAIXA | Página não encontrada na área autenticada responde HTTP 200 por causa do streaming | Registrado como `DEC-18`: aceitável na área autenticada; monitoramento usa auditoria e logs, não códigos HTTP |

Medição do Revisor (medianas de 8 tentativas de `signInEmail`): pessoa suspensa 26,9 ms, desativada 27,3 ms, email desconhecido 29,6 ms, senha errada 31,2 ms, login correto 34,8 ms. O oráculo de 2 ms desapareceu.

Observação do Revisor sem número: o servidor de produção registra "The destination stream closed early" quando o navegador aborta uma resposta durante redirecionamento na bateria ponta a ponta; ruído de log, sem defeito reproduzível.

### Situação do aceite da Etapa 1

Executor: entregue com as correções das três rodadas aplicadas e testadas (contagem final: 17 de unidade, 53 de integração, 30 de ponta a ponta; tipos, lint e build sem erros). Revisores: rejeitada na primeira revisão, aceita com correções na reapresentação e na terceira verificação; todas as correções aplicadas; as da terceira rodada foram verificadas pelos testes do Executor, sem quarta rodada independente. Responsável pelo produto: validada em 29/09/2026.

## Etapa 2 (núcleo do escritório)

Data: 29/09/2026. Executor: sessão principal. Revisor: subagente independente com contexto limpo, com acesso ao código, ao banco de teste e às baterias.

### Relato do Executor

Escopo entregue conforme `operacao/plano-de-entregas.md` e `00-estado-do-projeto.md`: banco do escritório (migrações `0003` gerada e `0004` manual: 15 tabelas, constraints de exclusão com `btree_gist`, 7 funções compartilhadas, triggers de lock, de validação e deferidos), serviços de disponibilidade, reserva, exclusividade, conflitos e escritório, telas do portal (escritório com mapa SVG e lista, detalhe, minhas reservas, semana, início) e administrativas (recursos, calendário, configurações, planta, exclusividade da diretoria, reservas), notificações e auditoria.

Testes executados no ambiente da sessão (PostgreSQL 16 local, Chromium pré-instalado), todos aprovados: 53 de unidade (36 novos: tabela de elegibilidade `DIR-031`, ordem de cálculo `DIR-019`, classe da mesa `DIR-026`, janela `PAR-01` e virada de dia `DIR-029`), 128 de integração (75 novos em `office-db`, `booking`, `exclusivity` e `office-concurrency`, entre eles `DIR-024-T1` com 50 repetições da corrida entre reserva e trava, `DIR-024-T2` sem lock da aplicação, `DIR-023-T1` com dez sessões e `DIR-033-T3` com fechamento em voo) e 42 de ponta a ponta com axe nos projetos desktop e celular (12 novos em `office.spec.ts`: rótulo literal sem botão nem nome do titular, reserva e cancelamento, mesa habitual do titular, prévia com conflito explícito, decisão por reserva, confirmação e histórico, telas administrativas sem rolagem horizontal, autorização por perfil). Tipos, lint e build sem erros; `.log-test.ndjson` sem "Failed query" nem "params".

Os 15 casos obrigatórios da seção 23 do prompt estão testados no nível do serviço e do banco, com dois parciais por desenho: `DIR-006-T2` (confirmação de uso) e `DIR-025-T1` (fluxo completo da fila) ficam para a Etapa 3, cobertos nesta etapa por `DIR-006-T1` e `DIR-025-T0`. Pendentes declarados: `DIR-030-T1` (reposicionamento sem troca de identidade, implementado sem teste), `DIR-026-T4` e `T5` (indicadores com períodos sobrepostos e titular fora do numerador), `DIR-034-T2` (oferta nascida no cancelamento, Etapa 3), salas e cabines por intervalo (tabela criada, serviço na Etapa 3), verificação manual com leitor de tela.

Limitações declaradas: inventário da planta não validado por Facilities e RH (`RSK-26`); capacidades de salas inferidas pelas cadeiras (`DEC-20`); mapa gerado das coordenadas da extração, sem o desenho arquitetônico de fundo; rótulo "Uso exclusivo — Diretoria" mantido literal como no prompt, sujeito ao manual de marca.

### Revisão independente (29/09/2026)

Revisor com contexto limpo, acesso ao código, ao banco de teste e às baterias; executou as baterias oficiais, 17 testes de integração e 6 de ponta a ponta adversos temporários, consultas SQL diretas com os papéis da aplicação e dono, 100 rodadas da corrida entre trava e reserva com três pessoas, 20 sessões pela última vaga e 2.200 comparações da janela de abertura entre SQL e serviço. Veredito: ACEITO COM CORREÇÕES, obrigatórias 1 a 7, recomendadas 8 a 15. Os 15 casos da seção 23 foram considerados provados, com ressalvas nos casos 7 (três opções do diálogo ausentes), 13 (desativação com liberação vigente) e 15 (`capacityOn` sem teste do Executor), tratadas abaixo.

| Nº | Severidade | Achado | Tratamento na mesma data |
|---|---|---|---|
| 1 | ALTA | Prévia de realocação sem mesas de destino (a própria reserva em conflito contava como limite diário) e diálogo sem as opções "iniciar após" e "escolher outra mesa" | Corrigido: a reserva em conflito é ignorada no cálculo das opções; o diálogo passa a ter as três opções excludentes (`DIR-016`), com "Iniciar em" pré-preenchido com o dia seguinte à última reserva incompatível; testes de integração e ponta a ponta nos dois projetos |
| 2 | ALTA | Desativar titular com liberação ao compartilhado vigente e reserva de terceiro falhava no commit com erro genérico; nada aplicado, acesso mantido | Corrigido: prévia da desativação lista reservas da pessoa, vínculos que entram em revisão e reservas de terceiros que deixam de valer; a desativação cancela todas com comunicação e auditoria na mesma transação (`PAR-25` revisto); teste R4 |
| 3 | MÉDIA | Ordem de locks divergente entre serviços (recurso antes de pessoa) e desativação fora do protocolo; deadlock observado sem nova tentativa | Corrigido: pessoa e grupo sempre antes dos recursos; suspensão, desativação, reativação e readmissão sob `withOfficeTx`; teste R9 com dez rodadas |
| 4 | MÉDIA | O reset dos testes apagava `office_settings` em cascata; baterias rodavam só com os valores de fallback | Corrigido: reset e seed reinserem os quatro parâmetros; teste de `updateSetting` no SQL e no serviço |
| 5 | MÉDIA | Rolagem horizontal no celular com a prévia de impacto aberta; cenário pulado no projeto celular | Corrigido: contêineres com `min-w-0`; cenário incluído nos dois projetos com `scrollWidth <= clientWidth` com a prévia aberta |
| 6 | MÉDIA | Desativação comunicava só a pessoa desativada, não o gestor (`PAR-25`) | Corrigido: gestor direto recebe o resumo; `PAR-25` revisto no registro e no guia |
| 7 | MÉDIA | Realocação não expirava retenção vencida na mesa de destino (`DIR-034`) | Corrigido, com teste |
| 8 | BAIXA | Papel da aplicação podia apagar registros do escritório e alterar titular, mesa e modalidade de atribuição vigente | Corrigido: migração `0005` revoga `DELETE` e congela a identidade de atribuições e liberações; teste |
| 9 | BAIXA | `revokeException` consultava o banco antes de validar o id | Corrigido |
| 10 | BAIXA | Resposta do mapa carregava o id da reserva de terceiros | Corrigido: id só quando é minha (`DIR-035`) |
| 11 | BAIXA | Data de verificação de atributos e datas do ponta a ponta em UTC | Corrigido: dia local de São Paulo (`DIR-029`) |
| 12 | BAIXA | Relato omitia dois testes pulados; `capacityOn` sem teste | Corrigido: testes não são mais pulados; `capacityOn` testado contra `desk_class` do banco com seis mesas |
| 13 | BAIXA | Visão geral com texto desatualizado, sem conflitos pendentes nem explicação das taxas | Corrigido |
| 14 | BAIXA | Titular via a própria mesa liberada a outra pessoa com o rótulo genérico | Corrigido: "Liberada a outra pessoa até dd/mm" |
| 15 | BAIXA | Nomes de integrantes do grupo e de pessoas em conflito visíveis a quem só tem `exclusive.view` | Decidido e registrado: `PAR-15` ampliado; nomes só com `exclusive.holder.view` |

### Relato do Executor na reapresentação (29/09/2026)

Testes executados após as correções, no mesmo ambiente: 53 de unidade, 134 de integração (seis novos: R4 da desativação com liberação vigente, realocação com retenção vencida e prévia com mesas livres, capacidade contra `desk_class`, parâmetros configuráveis, identidade imutável e `DELETE` revogado, R9 com dez rodadas de liberação contra desativação) e 44 de ponta a ponta com axe (22 por projeto, nenhum pulado; o cenário de exclusividade cobre as três opções do diálogo, a realocação com mais de dez mesas livres e a prévia aberta no celular sem rolagem horizontal), todos aprovados; tipos, lint e build sem erros; `.log-test.ndjson` sem "Failed query" nem "params". Migração `0005` aplicada em rh_dev e rh_test.

### Reapresentação

Em execução em 29/09/2026.
