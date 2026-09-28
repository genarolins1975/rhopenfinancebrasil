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
| 4, mutações sem recurso | Parcial: um par (criar atribuição de grupo e remover integrante) confirmava sem lock comum; suspensão contradizia o trigger | Lock do grupo antes de derivar o conjunto e re-derivação até estabilizar; `booking_remains_valid` separada de `is_bookable`; `needs_review` de titular inativo por consulta derivada |
| 6, retenção vencida | Parcial: o `update` de expiração violava o próprio check; filtro precisava de recurso e pessoa; lock indevido em mesa de terceiros; fila contornada na reserva direta; entrada `offered` eterna | Check ajustado, filtro duplo, trigger de lock ignorando expiração, job com uma oferta por transação, expiração preguiçosa também na fila, fila antes da reserva direta (`PAR-37`) |
| 9, Better Auth | Parcial: alegações plausíveis, mas `change-email` só confirma no endereço antigo com `sendChangeEmailConfirmation`, hooks de criação de sessão não cobrem sessões existentes, `trustDevice` pulava o segundo fator por 30 dias, nome correto é `deleteUserSessions`, adaptador interno não é API estável | `DEC-13` ampliada: `disabledPaths` com caminhos exatos, hook global conferindo `employee.status`, `trustDevice` neutralizado para perfis administrativos, `emailVerified` no aceite do convite, versão fixada e testes `AUT-13` e `AUT-14`; `RSK-21` e `RSK-22` |

Todos os ajustes foram incorporados em 28/09/2026. O revisor considerou a Etapa 1 liberada com os ajustes do item 9 e a Etapa 2 dependente dos itens 1 a 4, agora incorporados; a comprovação definitiva é a bateria de testes de integração e concorrência da Etapa 2, não a leitura do texto.

### Verificações executadas

Não há código, portanto não há testes de software. Executadas: consulta ao registro npm e à documentação oficial (28/09/2026); revisão 1; revisão 2 com cenários SQL no cluster local, que confirmaram que exclusão GiST com `uuid` exige `btree_gist`, que índice parcial com `now()` é rejeitado, que `daterange` com limite superior nulo é ilimitado e que o cast de `timestamptz` para `date` em sessão UTC muda o dia entre 21:00 e 23:59 de Brasília.

### Situação do aceite

Executor: entregue. Revisores: duas revisões aceitas com correções e reapresentação aprovada com ajustes; todas as correções e ajustes aplicados. Responsável pelo produto: pendente de validação, única pergunta que bloqueia a Etapa 1.
