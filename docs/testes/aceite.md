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

### Reapresentação (29/09/2026)

Segundo Revisor independente, contexto limpo: baterias oficiais (53, 134 e 44 aprovados, nenhum pulado, `office_settings` com quatro linhas após cada bateria), 20 cenários de integração num banco isolado, 3 de ponta a ponta, consultas com os dois papéis e leitura do log do servidor PostgreSQL. Dos 15 achados, 12 confirmados corrigidos e 3 corrigidos em parte; 7 achados residuais. Veredito: ACEITO COM CORREÇÕES, obrigatórias 1 a 3, recomendadas 4 a 7.

| Nº | Severidade | Achado | Tratamento na mesma data |
|---|---|---|---|
| 1 | MÉDIA | Caminhos que tratam reservas de terceiros tomavam o dia e a pessoa depois do recurso (via triggers e chave estrangeira); dez deadlocks na bateria oficial, absorvidos pela nova tentativa; o teste R9 não os detectava | Corrigido: `lockDaysAndPeople` toma o dia e `for share` de cada pessoa das reservas conhecidas (e do titular anterior em transferência e reabertura) antes dos recursos, em trava, transferência, liberação, revogação, remoção de integrante, manutenção, desativação de recurso, fechamento de dia e desativação de pessoa; R9 refeito com cinco combinações em seis rodadas e prova pelo contador `pg_stat_database.deadlocks` e pela ausência de nova tentativa no log |
| 2 | BAIXA | Histórico expunha o nome do beneficiário de liberação a quem só tem `exclusive.view` | Corrigido |
| 3 | MÉDIA | Integrante desativado seguia "vigente" no grupo; grupo sem integrante ativo não aparecia em vínculo a revisar | Corrigido: desativação encerra a vigência no grupo com auditoria; `listGroups` e a lista derivada consideram só pessoa ativa; `addGroupMember` confere a situação dentro da transação com a pessoa travada; teste |
| 4 | BAIXA | Aviso de cancelamento por desativação com texto de "vínculo em revisão" para as reservas da própria pessoa | Corrigido: avisos distintos por origem; teste |
| 5 | BAIXA | Reabrir a antecessora não conferia titular ativo nem o travava antes do recurso | Corrigido: `assertHolder` e `for share` do titular anterior antes dos recursos; com ele inativo, só resta liberar; teste e rodada concorrente em R9 |
| 6 | BAIXA | `DELETE` do papel da aplicação ainda concedido em inventário, zonas, grupos, parâmetros e posições | Corrigido: migração `0006`; intenção, requisição de semana e outbox seguem apagáveis por retenção, registrado na migração |
| 7 | BAIXA | Documentação acima do provado (ordem única de locks, realocação pelo navegador, `DIR-018` ponta a ponta, rótulo T5) | Corrigido: R9 prova a ausência de deadlock; o ponta a ponta do desktop confirma com realocação pelo navegador e o do celular com cancelamento; matriz ajustada |

### Relato do Executor na segunda reapresentação (29/09/2026)

Testes executados após as correções, no mesmo ambiente: 53 de unidade, 136 de integração (dois novos: integrante desativado no grupo com aviso por origem, e reabertura recusada com titular inativo; R9 refeito com prova de ausência de deadlock pelo contador do banco e pelo log) e 44 de ponta a ponta com axe (22 por projeto, nenhum pulado; o desktop confirma a atribuição com realocação pelo navegador e o celular com cancelamento), todos aprovados; tipos, lint e build sem erros; `.log-test.ndjson` sem "Failed query", sem "params" e sem "nova tentativa". Migrações `0005` e `0006` aplicadas em rh_dev e rh_test.

### Terceira verificação (29/09/2026)

Terceiro Revisor independente, contexto limpo: baterias oficiais em três rodadas, 11 testes de integração e 2 de ponta a ponta temporários, contador de deadlocks do banco e log do servidor. Confirmou corrigidos os achados 2, 3, 4 e 6; encontrou 4 residuais. Veredito: ACEITO COM CORREÇÕES, obrigatórias 1 e 2, com a bateria de integração aprovada em três execuções consecutivas antes do aceite; recomendadas 3 e 4.

| Nº | Severidade | Achado | Tratamento na mesma data |
|---|---|---|---|
| 1 | MÉDIA | Duas inversões restantes: o encerramento da vigência no grupo durante a desativação tomava o grupo depois dos recursos; o cancelamento próprio gravava `cancelled_by` (chave da pessoa) depois do recurso; deadlocks reais absorvidos pela nova tentativa; R9 não cobria essas combinações | Corrigido: a desativação toma os grupos da pessoa antes dos recursos; o cancelamento trava a pessoa da reserva e o ator antes do recurso; o ator passa a ser travado antes dos recursos em toda mutação que grava chave dele; R9 ganhou as duas combinações (sete no total) |
| 2 | MÉDIA | Reabertura conferia a situação do titular anterior antes do lock: com desativação em voo, nascia atribuição vigente para pessoa desativada; R9 reprovava de forma intermitente | Corrigido: lock antes da leitura; a conferência enxerga a desativação concluída e recusa |
| 3 | BAIXA | Documentação acima do provado (ordem única, R9, rótulos da matriz, acesso direto ao banco, retenção de intenção e semana) | Corrigido nos quatro textos |
| 4 | BAIXA | `revokeException` conferia a permissão só dentro da transação, depois dos locks | Corrigido |

### Relato do Executor na terceira reapresentação (29/09/2026)

Testes executados após as correções, no mesmo ambiente: 53 de unidade; 136 de integração em três execuções consecutivas, todas aprovadas, com o contador `pg_stat_database.deadlocks` de rh_test inalterado (65 antes e depois em cada execução) e zero linhas de "nova tentativa", "Failed query" ou "params" em `.log-test.ndjson`; 44 de ponta a ponta com axe (22 por projeto, nenhum pulado); tipos, lint e build sem erros. R9 cobre sete combinações em seis rodadas. O banco de teste passa a semear a abertura das reservas na segunda às 00:00 para que as datas relativas dos testes fiquem sempre dentro da janela, qualquer que seja o dia da semana em que a bateria rode; o teste da regra padrão de quinta às 10h fixa os próprios parâmetros.

### Situação do aceite da Etapa 2

Executor: entregue com as correções das três rodadas aplicadas e testadas. Revisores: aceita com correções nas três rodadas; todas as correções aplicadas; as da terceira rodada verificadas pelas baterias do Executor (integração em três execuções consecutivas, como exigido pelo Revisor), sem quarta rodada independente. Responsável pelo produto: validada em 29/09/2026.

## Etapa 3 (operação)

Data: 29/09/2026. Executor: sessão principal. Revisores: subagentes independentes com contexto limpo, em duas rodadas, cada lente com banco de teste isolado (`rh_test_r1` a `rh_test_r10`), acesso ao código, às baterias e aos papéis da aplicação e dono.

### Relato do Executor

Escopo entregue conforme `operacao/plano-de-entregas.md`: fila de espera com oferta transacional nascida na transação que libera a mesa (`DIR-034`, `PAR-37`), prazo em horas úteis (`PAR-05`, `PAR-43`) e varredura no worker da outbox a cada minuto (`DEC-27`); confirmação de uso pelo portal e pelo QR, com liberação por falta de confirmação desativada por padrão (`PAR-06`, `PAR-44`); salas e cabines por intervalo com agenda e horizonte próprio (`PAR-45`); Meu time com compartilhamento opt-in (`DEC-28`); painel administrativo de reservas, fila e salas; indicador de demanda não atendida. Migrações `0007` (gerada) e `0008` (funções, triggers, grants e parâmetros).

Testes executados na entrega (commit `83220ed`), no ambiente da sessão (PostgreSQL 16 local, Chromium pré-instalado): 61 de unidade e 54 de ponta a ponta com axe (desktop e celular), todos aprovados; integração com os 23 arquivos do projeto aprovados (162 de 162 na última execução antes do commit; a execução sobre o próprio commit misturou testes descartáveis que os revisores gravavam na mesma pasta, por isso a contagem dela não é usada aqui); tipos, lint e build sem erros.

### Revisão independente, primeira rodada (29/09/2026)

Seis lentes em paralelo (concorrência, exclusividade, autorização, tempo, interface, banco com documentação e testes), cada achado reproduzido e submetido a refutação por agentes distintos, com síntese final. 51 achados relatados, 49 confirmados e 2 refutados (T-08 e EXC-08, conformes às decisões registradas); 38 após deduplicação: nenhum bloqueante, 2 altos, 17 médios e 19 baixos. Nenhuma invariante do `CLAUDE.md` violada no estado entregue: em todos os casos em que a oferta tentou ir para quem não tinha direito, os triggers deferidos da `0004` recusaram o commit. Veredito: ACEITO COM CORREÇÕES.

| Nº | Severidade | Achado | Tratamento |
|---|---|---|---|
| 1 | ALTA | Com `PAR-06` ativa, reservas feitas depois do limite, inclusive o aceite de oferta, eram liberadas na varredura seguinte; a tela não mostrava prazo | Corrigido: instante limite do dia; só reserva confirmada antes dele é liberada (aceite conta do `decided_at`); prazo em Minhas reservas; `PAR-44`; `DIR-006-T2` refeito |
| 2 | ALTA | Salas e cabines só reserváveis até a semana seguinte | Corrigido: horizonte próprio por semanas (`DEC-26`, `PAR-45`); teste com semanas +2 a +4 aceitas e +5 recusada |
| 3 | MÉDIA | Desativação de titular com mesa liberada e fila falhava: a mesa era oferecida antes de entrar em revisão | Corrigido: fila da pessoa encerrada primeiro, revisão marcada antes das ofertas; teste |
| 4 | MÉDIA | A primeira da fila perdia a mesa para a segunda ao reservar direto | Corrigido: a reserva direta cede só a inscrições anteriores (`DEC-31` revista); teste |
| 5 | MÉDIA | Corrida entre confirmação de uso e liberação | Corrigido: lock da linha da reserva nas duas pontas; teste com intercalação fixada |
| 6 | MÉDIA | Confirmação de uso não acompanhava a realocação | Corrigido: a liberação poupa quem declarou uso em qualquer mesa do dia; teste |
| 7 | MÉDIA | Decisão dada para retenção aplicada à reserva aceita depois da prévia | Corrigido: decisão leva a situação vista na prévia (`DEC-34`); teste |
| 8 | MÉDIA | Fechar o dia de hoje impossível depois de qualquer reserva de sala encerrada | Corrigido: migração `0011`; teste |
| 9 | MÉDIA | Cancelar retenção pela aba Mesas tirava a pessoa da fila, com email de reserva cancelada | Corrigido: "Retirar oferta" mantém a posição e avisa (`DEC-35`) |
| 10 | MÉDIA | Retirar alguém da fila não avisava a pessoa | Corrigido: aviso com o motivo; ação administrativa própria |
| 11 | MÉDIA | Oferta não aceita aparecia como reserva no Início, no mapa e no detalhe | Corrigido (`DEC-40`) |
| 12 | MÉDIA | Visibilidade "Todos" do título de sala revelava o nome de quem reservou | Corrigido: nome só para a própria pessoa e a administração (`DEC-36`) |
| 13 | MÉDIA | Titular com a mesa exclusiva livre consumia mesa compartilhada da fila | Corrigido (`DEC-38`) |
| 14 | MÉDIA | Inscrição e reserva simultâneas da mesma pessoa (`PAR-30`) | Corrigido: lock consultivo por pessoa e dia (`DEC-32`); teste de 20 rodadas |
| 15 | MÉDIA | Trigger de lock da oferta travava a mesa fora de ordem na cascata; deadlock | Corrigido: lock só na inserção (`0009`, `DEC-33`) |
| 16 | MÉDIA | Deadlock entre a reivindicação da fila e a reserva direta da mesma pessoa | Corrigido: ordem única inscrição e depois índice único; teste com intercalação fixada |
| 17 | MÉDIA | QR de sala resolvia reserva encerrada | Corrigido: só reserva não encerrada |
| 18 | MÉDIA | Data impossível passava pela validação e expunha SQL | Corrigido: validação por ida e volta da data; só mensagem de domínio na tela; teste |
| 19 | MÉDIA | `WL-04-T3` não exercitava o ramo que declarava | Corrigido: teste reescrito |
| 20 | BAIXA | Pedido forjado em mesa exclusiva acionava a fila | Corrigido: elegibilidade de quem reserva primeiro (`DEC-31`) |
| 21 | BAIXA | Oferta manual e aba Fila revelavam vínculo com mesa exclusiva | Corrigido: oferta manual só de mesa compartilhada, resposta única (`DEC-36`) |
| 22 | BAIXA | Fechamento de dia decidia sobre retenção já cancelada | Corrigido: releitura sob lock; reserva inativa não recebe decisão, email nem auditoria |
| 23 | BAIXA | Mudanças de política pelo diálogo liberavam a mesa sem oferta na mesma transação | Mantido e registrado (`DEC-39`): a varredura oferece em até um minuto e a reserva direta respeita a fila |
| 24 | BAIXA | Consentimento do Meu time sobrevivia à desativação e à readmissão | Corrigido (`DEC-37`, migração `0010`) |
| 25 | BAIXA | Idempotência da reserva de sala sob concorrência | Corrigido: releitura depois do lock; teste |
| 26 | BAIXA | Inscrição de data passada nunca encerrada | Corrigido: varredura encerra (`DEC-41`) |
| 27 | BAIXA | Último trecho do dia não reservável; busca padrão inválida depois das 22h | Corrigido: fim 24:00 e trecho sugerido; testes de unidade |
| 28 | BAIXA | QR de sala levava à tela de mesa | Corrigido: QR de sala leva a Salas |
| 29 | BAIXA | Coluna Oferta mostrava oferta retirada como viva | Corrigido: rótulo pela situação |
| 30 | BAIXA | Cancelar reserva de sala já encerrada no painel | Corrigido |
| 31 | BAIXA | Capacidade e zona de sala fora da auditoria | Corrigido; teste acrescentado na terceira rodada (TR-15), que apontou a falta dele |
| 32 | BAIXA | Indicador de demanda contava oferta vencida; janela com 15 datas | Corrigido; teste acrescentado na terceira rodada (TR-15) |
| 33 | BAIXA | Rede do banco da fila parcial | Corrigido: migração `0012` (ordem de entrada, coerência no commit, oferta decidida congelada) |
| 34 | BAIXA | Concorrência com mesa exclusiva sem teste | Corrigido: R10b |
| 35 | BAIXA | Triggers e `REVOKE` da `0008` sem teste | Corrigido: `etapa3-db.test.ts` |
| 36 | BAIXA | Testes dependentes do horário | Corrigido em parte; concluído na segunda rodada (ID-07) |
| 37 | BAIXA | Código morto e asserções fracas em `waitlist.test.ts` | Corrigido |
| 38 | BAIXA | Documentação desatualizada (worker, triggers, grants) | Corrigido |

### Relato do Executor na reapresentação (29/09/2026)

Correções em worktree isolada (commits `4b302cd` a `ac2206d`), migrações `0009` a `0012`, decisões `DEC-32` a `DEC-41`. Testes executados no banco isolado `rh_test_r7`: 68 de unidade, 196 de integração (25 arquivos; `waitlist-concurrency` em oito execuções consecutivas) e 54 de ponta a ponta com axe em duas execuções, com build da worktree contra `rh_test`, todos aprovados.

### Revisão independente, segunda rodada: reverificação (29/09/2026)

Três lentes (regras e privacidade; concorrência e banco; interface, documentação e testes), contexto limpo, bancos `rh_test_r8` a `rh_test_r10`, sobre o código corrigido. Dos 51 achados da primeira rodada: 40 confirmados corrigidos, 10 corrigidos em parte (AUT-03, AUT-04, T-08, CONC-04, BDT-04, INT-03, INT-04, INT-06, INT-11, BDT-08) e 1 mantido por decisão (EXC-07, `DEC-39`). Baterias executadas pelas lentes, todas aprovadas: integração completa (196 testes em 25 arquivos, lente de concorrência e banco), arquivos da Etapa 3 (57 e 48 testes, nas outras duas lentes), unidade (68), tipos e lint; nenhuma rodou build nem ponta a ponta. Achados novos: 23, três deles relatados por duas lentes (retirada de oferta refeita pela varredura, segunda leitura do QR de sala, aviso duplo no fechamento de dia), o que dá 20 distintos.

| ID | Severidade | Achado | Tratamento |
|---|---|---|---|
| RP-01 | MÉDIA | Encerramento por mesa exclusiva livre tirava da fila integrante de grupo e titular com a mesa liberada | Corrigido: só titular individual sem liberação vigente e fora de revisão (`DEC-38` revista); dois testes |
| RP-02 | MÉDIA | Oferta para fim de semana feita à noite em dia útil vencia de madrugada | Corrigido: prazo útil quando termina antes da data; senão, minutos corridos do início do horário comercial da data (`PAR-43` revisto); testes de unidade |
| RP-03, ID-01 | MÉDIA | "Retirar oferta" era desfeito pela varredura: a mesma mesa voltava à mesma pessoa | Corrigido: estado `withdrawn` (migrações `0013` e `0014`) e exclusão da mesa para a inscrição na data (`DEC-42`); email próprio da fila; a própria oferta de quem opera não aparece como retirada; mensagens distintas de retirada e recusa; teste |
| RP-04 | BAIXA | Retirar oferta já vencida devolvia a pessoa à fila | Corrigido: a retenção vencida expira com a inscrição; teste |
| RP-05 | BAIXA | Oferta manual a titular com mesa própria livre falhava com motivo falso | Corrigido: resposta neutra quando a mesa era reservável (`DEC-36` revista); teste |
| RP-06, ID-02 | MÉDIA | Segunda leitura do QR de sala confirmava a próxima reserva do dia | Corrigido: só a reserva em andamento ou que começa em até 15 minutos; segunda leitura responde "já confirmado"; horário na tela e na mensagem; dois testes |
| RP-07 | BAIXA | Autorização do Meu time revivia com a volta do gestor anterior; sem gestor, a tela anunciava compartilhamento inexistente | Corrigido: trigger `employee_manager_changed` zera a autorização em qualquer troca (`0015`, `DEC-37`); ativação sem gestor recusada; teste |
| RP-08, ID-09 | BAIXA | Fechar o dia enviava dois avisos e encerrava inscrições sem ator | Corrigido: aviso único e ator registrado; teste |
| CB-01 | MÉDIA | Desativação oferecia mesa de oferta vencida sem travá-la no protocolo (resto de CONC-04) | Corrigido: mesas das ofertas abertas da pessoa no passo de recursos (`DEC-43`); teste com intercalação fixada e contador de deadlocks |
| CB-02 | MÉDIA | Duas desativações simultâneas de pessoas na fila da mesma data em deadlock | Corrigido: desativações serializadas por lock consultivo antes de qualquer outro (`DEC-43`); teste de seis rodadas |
| CB-03 | MÉDIA | Prazo, origem, pessoa e mesa da retenção alteráveis pela linha da reserva (resto de BDT-04) | Corrigido: migração `0015` (identidade da reserva imutável, reserva encerrada não reabre, retenção no prazo da oferta); teste |
| CB-04 | BAIXA | Decisão sem a situação da prévia valia para qualquer situação | Corrigido: situação obrigatória vinda da tela (`DEC-44`); teste |
| CB-05 | BAIXA | Reserva que perdia a inscrição para oferta concorrente recebia erro genérico | Corrigido: "uma mesa acabou de ser oferecida a você"; teste com intercalação fixada |
| ID-03 | MÉDIA | Estado e matriz citavam registro de aceite inexistente; matriz declarava "um caso por achado" | Corrigido: esta seção; matriz reescrita com o que tem e o que não tem teste automatizado |
| ID-04 | MÉDIA | R10b e `etapa3-db` com asserções que passavam sem exercitar o caso | Corrigido: R10b com decisões da prévia e os dois desfechos de cada corrida exigidos; mensagem exata no banco |
| ID-05 | BAIXA | Textos diziam que mesa exclusiva nunca é oferecida pela fila | Corrigido: "só a quem pode usá-la"; modelo de dados com `DEC-31`, `DEC-38` e `DEC-42` |
| ID-06 | BAIXA | Oferta ainda apresentada como reserva no mapa, na semana, na razão das outras mesas e no assunto dos emails | Corrigido: estilo, legenda e filtro próprios; oferta na semana; razão própria; email da fila (`DEC-40` ampliada); teste de unidade |
| ID-07 | BAIXA | Testes dependentes do horário passavam sem asserção | Corrigido: T-02 e T-05 com períodos relativos ao relógio do banco; `DIR-006-T2` afirma o desfecho na fronteira |
| ID-08 | BAIXA | Busca de salas com a data de hoje depois das 23h inválida; tela de recurso de sala com estado de mesa | Corrigido |
| ID-10 | BAIXA | Aviso de prazo de confirmação impreciso e ausente no ato da reserva | Corrigido: só para quem será atingido e na mensagem da reserva de hoje (`DEC-44`) |

Os 14 casos de `etapa3-revisao2.test.ts` foram executados também contra o código anterior à correção (commit `ac2206d`, banco `rh_test_r7`): os 14 falham, cada um pelo motivo do seu achado; no código corrigido, os 14 passam.

### Relato do Executor na segunda reapresentação (29/09/2026)

Correções em worktree isolada (commits `e1f359a` e `2a7834f`), migrações `0013` a `0015`, decisões `DEC-42` a `DEC-44`, integradas ao branch de trabalho. Testes executados sobre o código final, com `rh_dev` e `rh_test` migrados até a `0015`: 71 de unidade; 211 de integração (26 arquivos) em três execuções consecutivas, todas aprovadas, com o contador `pg_stat_database.deadlocks` de `rh_test` inalterado em cada execução e zero linhas de "nova tentativa", "Failed query" ou "params" em `.log-test.ndjson`; 54 de ponta a ponta com axe (27 por projeto, nenhum pulado) contra o build de produção; tipos, lint e build sem erros. O servidor registrou duas vezes "The destination stream closed early" durante a bateria de ponta a ponta, aviso do Next quando o navegador sai da página durante o streaming, sem falha de teste.

A verificação adversarial dos achados novos da segunda rodada (reprodução e refutação por agentes distintos) foi interrompida por reinício do ambiente depois de 22 dos 37 agentes previstos; os achados foram tratados pelo Executor com base nas evidências das lentes e nos testes que falham no código anterior. A terceira rodada, sobre o código final, cobre essa lacuna.

### Revisão independente, terceira rodada (29/09/2026)

Três lentes (concorrência e banco; regras e privacidade; interface, documentação e testes), contexto limpo, sobre o código final (commit `7e2a4d0`), bancos `rh_test_r12` a `rh_test_r14`; cada achado novo reproduzido e submetido a refutação por agentes distintos, com síntese final. Baterias executadas pelas lentes, todas aprovadas: integração completa (211 testes em 26 arquivos, em dois bancos), arquivos da Etapa 3 (56 e 73 testes), `waitlist-concurrency` e `office-concurrency` em três execuções, unidade (71), tipos e lint; nenhuma rodou build nem ponta a ponta. Os 33 itens da segunda rodada foram reconferidos um a um, cobrindo a verificação interrompida: 30 corrigidos por completo e 3 em parte (AUT-04, ID-03, ID-10, resíduos baixos). Achados novos: 19 relatos confirmados, 15 distintos, nenhum refutado; nenhum bloqueante, 2 altos, 13 baixos. Nenhuma invariante do `CLAUDE.md` violada no estado revisado. Veredito: ACEITO COM CORREÇÕES, com os dois altos e os três resíduos a corrigir, com teste, antes do aceite.

| ID | Severidade | Achado | Tratamento |
|---|---|---|---|
| TR-01 | ALTA | "Retirar oferta" sem a situação vista: com aceite concorrente ou tela desatualizada, cancelava a reserva confirmada e dizia, em tela, email e auditoria, que a pessoa continuava na fila | Corrigido: o formulário envia a situação exibida; a ação recusa sem ela; o serviço compara com a situação relida sob lock e, se mudou, nada cancela; aviso, auditoria e desfecho saem da situação relida (`DEC-42`, `DEC-44`); dois testes (corrida com intercalação fixada e tela desatualizada) |
| TR-02 | ALTA | `deskClass` do serviço contava como compartilhada a mesa em revisão com liberação vigente, ao contrário do `desk_class` do banco: capacidade e rótulos errados (`DIR-026`) | Corrigido: mesa em revisão é exclusiva também no serviço; teste de integração comparando serviço, banco e `capacityOn`; teste de unidade |
| TR-03 | BAIXA | Autorização do Meu time revivia quando o próprio gestor era desativado e readmitido | Corrigido: a desativação zera as autorizações dadas à pessoa como gestora, com o número na auditoria (`DEC-37`); teste |
| TR-04 | BAIXA | Aba Fila mostrava "oferta aberta" só nas ofertas de mesa exclusiva, revelando o vínculo (resíduo de AUT-04) | Corrigido: "oferta aberta" em toda oferta para quem não tem as permissões (`DEC-36`); campo sem uso removido |
| TR-05 | BAIXA | Fechar o dia com oferta vencida e não varrida deixava a inscrição viva; depois vinha aviso falso de vencimento, sem ator | Corrigido: o fechamento expira essas ofertas e encerra as inscrições com o aviso de fechamento e o ator; teste |
| TR-06 | BAIXA | Mesa retirada continuava nas opções da oferta manual e era recusada com "tente mais tarde"; o diálogo não avisava o efeito da retirada | Corrigido: mesa retirada fora das opções e recusada com o motivo; aviso no diálogo; `DEC-42` e guia; teste |
| TR-07 | BAIXA | QR de sala perdeu o filtro do dia: entre 23:45 e 24:00, a reserva da meia-noite aparecia como de hoje e o banco recusava | Corrigido: filtro do dia restaurado junto com a janela de 15 minutos; sem teste automatizado (depende do relógio do banco) |
| TR-08 | BAIXA | Cancelamento que encontrava a reserva encerrada por outra transação respondia sempre "a oferta da fila venceu" | Corrigido: a mensagem informa a causa real; a mesa liberada por oferta vencida vai à próxima pessoa na mesma transação (pista registrada pela revisão); dois testes |
| TR-09 | BAIXA | Rede do banco aceitava estender juntos os prazos da oferta e da retenção, reabrir oferta vencida e reescrever o encerramento da reserva | Corrigido: migração `0016` (prazo até o fim do dia, só encurtar, encerramento congelado); teste |
| TR-10 | BAIXA | Lock global de desativação sob `lock_timeout` de 3 s: lote esgotava as tentativas com erro genérico | Corrigido em parte, por decisão: lock mantido, com espera própria de 12 s, sem nova tentativa e resposta específica; limite registrado na `DEC-43` e no guia; sem teste automatizado |
| TR-11 | BAIXA | Aviso de prazo de confirmação anexado à reserva de outra data (resíduo de ID-10) | Corrigido: só na reserva feita para hoje; sem teste automatizado (mensagem da ação) |
| TR-12 | BAIXA | Reserva em nome que perdia a inscrição para oferta concorrente respondia ao operador "uma mesa acabou de ser oferecida a você" | Corrigido: resposta sobre "esta pessoa"; teste |
| TR-13 | BAIXA | Aviso de encerramento da `DEC-38` sem data nem mesa | Corrigido: data e código da mesa própria; teste |
| TR-14 | BAIXA | Oferta com ★ e cor de "Disponível" na lista e no mapa; cartão dizia "Reservada para você" | Corrigido: cor própria, ☆ na lista e no mapa, "Retida para você até" (`DEC-40`); sem teste automatizado (tela) |
| TR-15 | BAIXA | Documentação de aceite, matriz, registro e estado com teste inexistente e contagens divergentes (resíduo de ID-03) | Corrigido: testes dos achados 31 e 32 da primeira rodada; contagens alinhadas (primeira rodada 38 distintos; segunda 20 distintos de 23 relatos e 10 parciais; terceira 15 distintos); matriz com a lista exata de casos por achado; pontuação do estado |

Os 13 casos de `etapa3-revisao3.test.ts` foram executados também contra o código anterior à correção (commit `7e2a4d0`, banco `rh_test_r12`): os 11 casos de TR-01 a TR-13 falham, cada um pelo motivo do seu achado; os 2 de TR-15 passam lá, como esperado, porque cobrem a falta de teste e não um defeito. No código corrigido, os 13 passam.

### Relato do Executor na terceira reapresentação (29/09/2026)

Correções aplicadas no branch de trabalho, migração manual `0016`, decisões `DEC-36` a `DEC-38` e `DEC-40` a `DEC-44` revistas. Testes executados sobre o código corrigido, com `rh_dev` e `rh_test` migrados até a `0016`: 72 de unidade; 225 de integração (27 arquivos) em três execuções consecutivas, todas aprovadas, com o contador `pg_stat_database.deadlocks` de `rh_test` inalterado e zero linhas de "nova tentativa", "Failed query" ou "params" em `.log-test.ndjson`; 54 de ponta a ponta com axe (27 por projeto, nenhum pulado) contra o build de produção; tipos, lint e build sem erros. O servidor registrou três vezes o aviso "The destination stream closed early", sem falha de teste. A primeira execução da bateria de integração revelou que um caso antigo de `etapa3-db` estendia o prazo da oferta para provar o desalinhamento, o que a `0016` passou a recusar antes; o caso foi refeito (encurtar desalinha e é recusado no commit; estender é recusado na hora) e a validação completa foi repetida do início. Depois dela, só o texto da resposta para oferta já vencida foi ajustado ("mesa liberada, oferecida à próxima pessoa elegível, se houver"); tipos, lint e os dois arquivos de regressão afetados (27 testes) foram reexecutados e aprovados.

### Situação do aceite da Etapa 3

Executor: entregue com as correções das três rodadas aplicadas e testadas. Revisores: as três rodadas aceitas com correções; as da terceira rodada verificadas pelas baterias do Executor e pelos testes que falham no código anterior, sem quarta rodada independente, como na Etapa 2. Responsável pelo produto: validação pendente.

## Demonstração do conceito em rhopenfinancebrasil.com (`DEC-45`)

Data: 29/09/2026. Executor: sessão principal. Revisor: duas lentes independentes (segurança e privacidade; operação do deploy), com ensaio real do build de produção em bancos isolados (`rh_demo_r1`, `rh_demo_r2`) e refutação de cada achado por agente distinto.

### Relato do Executor

Preparação do repositório para publicar a demonstração na Vercel Pro com Neon, sem publicar nada: ambiente `APP_ENV=demo` (faixa em todas as telas, email desligado, sem indexação), ciclo de operação compartilhado entre o processo de fundo e a rota agendada `/api/cron/operacao`, build de produção com migração, conferência do banco e dados fictícios idempotentes, `vercel.json`, SQL de preparação do Neon e roteiro (`operacao/demo-vercel.md`). Ensaios executados: build de produção em banco vazio e repetido (idempotente), sem segredo da rota (recusado), sem a URL do dono (sem migração, banco conferido), prévia (não toca o banco); aplicação em modo demonstração com login pelo navegador (colaboradora no mapa; administração levada ao cadastro do segundo fator); rota agendada com 401 sem segredo e 200 com segredo; SQL de preparação rodado com papel sem superusuário.

### Revisão independente (29/09/2026)

17 achados relatados, 16 confirmados e 1 refutado (o indicador temporário de segundo fator durante a carga não dá poder novo a ninguém e o estado interrompido já é tratado); nenhum bloqueante, 3 médios, 13 baixos.

| ID | Severidade | Achado | Tratamento |
|---|---|---|---|
| DV-01 | MÉDIA | Com a branch de produção igual à de trabalho, todo commit seria publicado e migraria o banco sem autorização | Corrigido: publicação só da branch `demo`, que avança por ato do responsável; `vercel.json` desliga deploy das branches `claude/...`; `DEC-45` |
| DV-02 | MÉDIA | Tarefa a cada minuto impede o banco de dormir e esgota a cota gratuita do Neon por volta do 17º dia | Corrigido: a cada 15 minutos em dias úteis, das 08:00 às 19:59 de Brasília; cota documentada no roteiro |
| DV-03 | MÉDIA | Migração dentro do build: esquema novo sob código antigo em falha de build e credencial do dono no ambiente de execução | Corrigido em parte, por decisão: sem a URL do dono o build não migra e diz isso; o roteiro manda apagá-la depois do primeiro deploy e exige migração compatível com o código anterior; a produção separa a migração (`DEC-45`) |
| DV-04 | BAIXA | Falha de banco no build imprimia a consulta com parâmetros (hash de senha, link de convite) | Corrigido: saída de script sem consulta nem parâmetros (`safeErrorText`); teste de unidade |
| DV-05 | BAIXA | Credenciais e senhas de demonstração em variáveis legíveis; integração Neon da Vercel injeta a credencial do dono do projeto | Corrigido no roteiro: variáveis secretas marcadas Sensitive, só em Production, apagadas depois do primeiro deploy; projeto do Neon criado direto em neon.com |
| DV-06 | BAIXA | Com email desligado, a tela atribuía o bloqueio à lista de destinatários | Corrigido: "Não enviado: email desligado neste ambiente de demonstração"; a faixa avisa que nenhum email é enviado |
| DV-07 | BAIXA | Sem `CRON_SECRET`, a outbox pararia em silêncio | Corrigido: o build de produção recusa a falta do segredo; roteiro manda conferir execução com 200 |
| DV-08 | BAIXA | `bootstrap:admin --force` aceito em `APP_ENV=demo` | Corrigido: `--force` só em desenvolvimento e teste |
| DV-09 | BAIXA | Emails das contas publicados e senha compartilhada: travamento e tomada de conta durante a apresentação | Registrado no roteiro, com as mitigações e o procedimento de recomeço |
| DV-10 | BAIXA | Senha de demonstração vazada deixava a carga pela metade | Corrigido: consulta de vazamento antes de gravar; sem teste automatizado (a consulta fica desligada no banco de teste) |
| DV-11 | BAIXA | Pool sem tratador de erro derrubaria o processo quando o banco encerrasse conexão ociosa | Corrigido: tratador que registra só o código do erro |
| DV-12 | BAIXA | Integração Neon pela aba Storage conflita com o roteiro | Corrigido: o roteiro não a usa e diz por quê |
| DV-13 | BAIXA | Conexão direta justificada por premissa incorreta; o pool do Neon é compatível com `DATABASE_TZ_OPTION=off` | Corrigido: aplicação com pool, migração com conexão direta; ensaio local só com conexão direta (o pool do Neon será exercitado no primeiro deploy) |
| DV-14 | BAIXA | Passos do roteiro inexecutáveis como escritos e regra de senha inexata | Corrigido: variáveis na tela de importação, branch de produção `demo` depois da importação, "no máximo 10 dígitos no total", comentário do SQL |
| DV-15 | BAIXA | Conferência do banco testava só `DELETE` na auditoria | Corrigido: `UPDATE`, `DELETE` e `TRUNCATE`, mais a URL do dono no mesmo banco; teste de integração |
| DV-16 | BAIXA | Rota agendada e conferência do banco sem teste | Corrigido: testes de integração da rota (401 e 200 só com contagens) e da conferência (conforme, papel dono, bancos diferentes) |

### Achado na execução do roteiro (29/09/2026)

| Id | Severidade | Achado | Tratamento |
|---|---|---|---|
| DV-17 | MÉDIA | No SQL Editor do Neon, o Bloco 1 de `demo-neon.sql` falhou no segundo comando (o bloco que cria os papéis), e nenhum papel foi criado. A mensagem do Neon não foi vista; causa provável: o editor roda cada comando numa conexão própria, e a tabela temporária das senhas não existe na conexão seguinte | Corrigido: tabela comum `_senhas_demo` no banco `neondb`, apagada no novo Bloco 4; papel existente recebe a senha da tabela, e o Bloco 1 pode ser rodado de novo. Testado em PostgreSQL 16 local, com papel não superusuário com CREATEROLE e CREATEDB: falha reproduzida com a versão anterior; versão nova aprovada com um comando por conexão, com reexecução (mesmas senhas, entrada dos dois papéis com fuso America/Sao_Paulo) e com tudo numa transação só; Blocos 2, 3 e 4 aprovados. No Neon, a versão nova concluiu os cinco comandos do Bloco 1 (print do responsável, 29/09/2026) |
| DV-18 | ALTA | Nenhum deploy de produção da `demo` chegava ao build: a Vercel criou os deploys (ambiente Production, conferido na página do deploy `665fcf8`) e cancelou todos pela regra de pular builds do `vercel.json` (`ignoreCommand` com `VERCEL_ENV`), que só deixou passar o primeiro deploy da importação. Cancelados não aparecem na lista, o que parecia ausência de deploy | Corrigido: regra retirada do `vercel.json`. A proteção contra prévia segue em três camadas: deploy desligado para `claude/...`, variáveis só em Production e script de build que não toca o banco fora de produção. Validação executada: `vercel.json` lido como JSON válido; efeito conferido no próximo deploy da `demo` |
| DV-19 | MÉDIA | Primeiro deploy da `demo` que chegou ao build (`4367acb`) falhou na preparação com "falha na preparação do deploy: [consulta redigida]": a redação de segurança escondia também a causa, uma falha de conexão sem código do banco | Corrigido: a saída de script mostra a causa (código e mensagem do sistema), sem consulta, sem parâmetros e sem credencial de URL. Testes executados: unidade 78/78 (novo caso de conexão e de URL com credencial), typecheck e lint; ensaio local com endereço inexistente e porta fechada. A causa no Neon será conhecida no próximo deploy |

### Situação

Preparação pronta no repositório; publicação, branch `demo` e DNS dependem da autorização do responsável, a registrar no `DEC-45`.
