# Política de mesas exclusivas da diretoria (regras DIR)

Referência: 28/09/2026. Esta é a regra central do produto. Toda regra abaixo vale no mapa, na lista, na busca, no planejamento semanal, nas reservas administrativas, na lista de espera, nos indicadores e em todas as APIs. Nenhuma delas é aplicada apenas na interface.

## Três dimensões, nunca um campo único

| Dimensão | Valores | Origem |
|---|---|---|
| Política de uso | compartilhada; exclusiva individual; exclusiva de grupo | `exclusive_assignment` vigente na data, ajustada por `access_exception` vigente |
| Situação operacional | operacional; em manutenção; bloqueada administrativamente; desativada | `resource_status_period` e `resource.retired_at` |
| Reserva | nenhuma; reservada por outra pessoa; minha reserva; retida por oferta da fila | `desk_booking` na data |

O estado exibido a uma pessoa em uma data é a combinação das três dimensões com a elegibilidade dessa pessoa. "Uso exclusivo" nunca significa ocupação física. Uma mesa exclusiva pode estar em manutenção; uma mesa exclusiva pode não ter reserva alguma.

## Regras

| ID | Regra |
|---|---|
| `DIR-001` | Existem três políticas de uso: compartilhada (colaboradores elegíveis), exclusiva individual (um diretor determinado) e exclusiva da diretoria (integrantes ativos do grupo autorizado). A exclusividade individual é o caso prioritário. |
| `DIR-002` | A modalidade de grupo não substitui a atribuição nominal. Nenhum diretor usa a mesa individual de outro sem exceção específica vigente. |
| `DIR-003` | Política de uso, situação operacional e reserva são dimensões separadas, armazenadas em tabelas distintas e exibidas separadamente. Não existe `is_director_desk`. |
| `DIR-004` | Atribuição exclusiva registra recurso, modalidade, titular ou grupo, início, término opcional, motivo, autor e histórico. Vigência sem término permanece até liberação autorizada e é exibida como "sem término definido", nunca como reserva de duração infinita. |
| `DIR-005` | Vincular uma mesa não é reservar nem registrar presença. Vínculos administrativos não entram em indicadores de utilização. |
| `DIR-006` | Persistência da trava: falta de reserva, ausência, trabalho remoto, cancelamento, vencimento de oferta da fila ou falta de confirmação de uso não liberam a mesa exclusiva. A trava não expira na virada da semana. A ausência do diretor não é consentimento. |
| `DIR-007` | Mesa exclusiva não aparece em recomendações, lista de espera, reserva automática ou sugestões para pessoas não autorizadas. |
| `DIR-008` | O colaborador comum vê o rótulo literal `Uso exclusivo — Diretoria` (texto do prompt, sujeito ao manual de marca) sem botão de reserva. O nome do titular só aparece para quem tem `exclusive.holder.view` ou conforme política interna de visibilidade a definir. |
| `DIR-009` | O titular vê "Sua mesa de uso exclusivo" e "Sua mesa habitual: [código]" na Home. Pode reservar e cancelar a própria utilização; isso não altera a exclusividade. |
| `DIR-010` | Em mesas de grupo, só integrantes ativos na data podem reservar, sujeitos aos mesmos controles de concorrência e unicidade. |
| `DIR-011` | RH e ADM autorizados veem vínculo, vigência e histórico. Reservar em nome do diretor exige `booking.on_behalf.create`, confirmação, registro do ator e notificação ao beneficiário. Não há impersonação. |
| `DIR-012` | O diretor continua sujeito a uma reserva efetiva de mesa por dia (parâmetro proposto). O vínculo exclusivo não conta como reserva. A interface privilegia a mesa habitual. Reserva permitida em outra posição não libera a mesa exclusiva. |
| `DIR-013` | Liberação temporária: RH ou ADM autorizado libera a mesa para pessoa específica ou para o conjunto compartilhado, por dias inteiros, com motivo e confirmação. Ao terminar a janela, a política exclusiva volta pela vigência, sem depender de job. |
| `DIR-014` | Reserva feita sob exceção não ultrapassa a janela autorizada. A exceção não contorna manutenção, bloqueio administrativo, fechamento do escritório ou outra restrição operacional. |
| `DIR-015` | O diretor não remove unilateralmente a exclusividade. Pode enviar solicitação de liberação ao RH, que não altera a regra por si só. |
| `DIR-016` | Ao travar uma mesa com reservas futuras incompatíveis, nada é apagado, cancelado, transferido ou invalidado em silêncio. A tela mostra datas e pessoas afetadas e oferece: iniciar após as reservas; escolher outra mesa; ou tratamento autorizado de cancelamento ou realocação com motivo e comunicação. Tudo é revalidado no momento da confirmação. |
| `DIR-017` | Transferir uma mesa entre diretores avalia as reservas do titular anterior; revogar acesso a um grupo avalia as reservas futuras do integrante. Nenhum estado contraditório fica escondido: reservas que passam a ser incompatíveis são listadas e tratadas com decisão explícita. |
| `DIR-018` | Titular desativado: acesso revogado, reservas futuras tratadas, atribuição marcada como "Vínculo precisa de revisão". A mesa permanece restrita até decisão do RH. |
| `DIR-019` | Ordem de cálculo de disponibilidade: conta ativa e permissão; escritório aberto; recurso operacional; bloqueios aplicáveis; política exclusiva e exceções válidas; elegibilidade; conflitos de reserva; limites individuais. A ordem é fixa e o primeiro impedimento encontrado é a razão exibida. |
| `DIR-020` | Manutenção impede uso inclusive pelo titular. Liberação temporária não anula manutenção. Cancelamento de reserva não altera política de acesso. |
| `DIR-021` | Um único serviço de disponibilidade e autorização atende mapa, lista, busca, semana, reservas administrativas, fila e integrações. |
| `DIR-022` | A identidade vem da sessão no servidor. `employee_id`, perfil, disponibilidade, titularidade ou qualquer atributo enviado pelo navegador não é prova de autorização. |
| `DIR-023` | O banco garante unicidade de reserva ativa por mesa e data e por pessoa e data; salas e cabines têm exclusão de sobreposição com intervalos semiabertos. Triggers deferidos verificam a elegibilidade no commit como segunda rede. |
| `DIR-024` | Reserva, cancelamento, retenção de oferta, atribuição, exceção, bloqueio e manutenção serializam por recurso com `select for update` em ordem crescente de id, revalidam dentro da transação, repetem em falha de serialização e respondem por idempotência. A corrida entre reservar e travar produz um único resultado coerente. |
| `DIR-025` | A fila só oferece recurso permitido à pessoa. Mesa exclusiva sem exceção vigente para a pessoa nunca é oferecida. |
| `DIR-026` | Indicadores: mesa exclusiva sem reserva não é vaga compartilhada nem ocupação confirmada. Capacidade compartilhada é calculada pela união das restrições; mesa exclusiva em manutenção é descontada uma vez. Toda taxa tem numerador, denominador, período, fonte e limitações. Indicadores históricos usam as regras vigentes no período. |
| `DIR-027` | Operações em lote têm prévia e confirmação e são atômicas: ou tudo é aplicado, ou nada. |
| `DIR-028` | Toda alteração administrativa de exclusividade, exceção ou tratamento de conflito gera evento de auditoria com ator, motivo, antes e depois, e notificação às pessoas afetadas via outbox. |
| `DIR-029` | Datas de vigência e exceção são dias locais em `America/Sao_Paulo`, inclusivas nas duas pontas. Instantes gravados em UTC. O relógio do servidor decide. |
| `DIR-030` | Alterar o desenho da planta ou reposicionar uma mesa não altera `resource.id`, não apaga reservas nem move atribuições. Trocar a identidade de uma mesa é operação explícita com motivo. |
| `DIR-031` | Uma única função de elegibilidade, com regra literal, é usada pelo serviço de disponibilidade e pelos triggers deferidos do banco. Regra: sem atribuição vigente na data, qualquer conta ativa; com atribuição e exceção `release_to_shared` na data, qualquer conta ativa, titular incluído; com atribuição e exceção `release_to_employee` na data, somente o beneficiário, titular excluído nessa data (`PAR-26`); com atribuição individual sem exceção, somente o titular; com atribuição de grupo sem exceção, somente integrantes ativos do grupo na data. |
| `DIR-032` | Remover integrante do grupo ou encerrar sua vigência avalia as reservas futuras dele nas mesas do grupo com o mesmo diálogo de conflito de `DIR-016`. A operação trava as mesas do grupo e os triggers verificam no commit. A atribuição de grupo não entra em revisão por isso; grupo sem integrante vigente aparece em "Vínculo a revisar" por consulta derivada. |
| `DIR-033` | Criar ou estender manutenção, bloqueio administrativo, fechamento do escritório ou desativação de recurso sobre reservas ativas usa o mesmo diálogo de conflito de `DIR-016`: nada é cancelado em silêncio e nada fica confirmado em mesa indisponível. Vale para mesas, salas e cabines. |
| `DIR-034` | Oferta da fila vencida não trava mesa nem pessoa: a leitura ignora retenção vencida e o caminho de escrita a expira antes de gravar. A oferta seguinte nasce na transação que liberou a mesa, seja cancelamento, seja reserva direta que expirou uma retenção (`PAR-37`); o job de expiração é conveniência, não requisito de correção. |
| `DIR-035` | A resposta do mapa, da lista, da busca e da semana carrega apenas o estado calculado e a marca "é minha"; identificadores ou nomes de titulares só quando o ator tem `exclusive.holder.view`. |
| `DIR-036` | Estado da atribuição (`agendada`, `ativa`, `encerrada`) é derivado da vigência, nunca gravado. Encerrar grava o término, nunca no passado; anular só é possível antes do início; o início não muda depois de começar; término preenchido nunca volta a nulo; atribuição encerrada fica congelada. Não existe caminho que retire uma atribuição da regra de sobreposição sem encerramento pela vigência ou anulação antes de vigorar, nem caminho que a reabra. Anular a sucessora de uma transferência exige decisão explícita sobre a mesa. |

## Ordem de cálculo de disponibilidade (`DIR-019`)

```
disponibilidade(pessoa, recurso, data):
  1. pessoa.status = active e can(pessoa, 'booking.self.manage')
        senão: NEGADO "conta inativa ou sem permissão"
     (em reserva em nome de alguém, o ator precisa de booking.on_behalf.create
      e o beneficiário passa por este mesmo passo)
  2. office_calendar[data].is_open
        senão: INDISPONÍVEL "escritório fechado"
  2b. data dentro do horizonte e abertura da semana já ocorrida em horário local
        senão: INDISPONÍVEL "reservas para esta data abrem em [instante]"
        (isenções em PAR-29: realocação e cancelamento administrativos;
         titular de mesa exclusiva sujeito à janela até decisão do RH)
  3. recurso não desativado e sem período de manutenção cobrindo data
        senão: INDISPONÍVEL "em manutenção" (vale para o titular)
  4. sem período de bloqueio administrativo cobrindo data
        senão: INDISPONÍVEL "bloqueada administrativamente"
  5. e 6. elegível(pessoa, recurso, data)   [regra única de DIR-031]
        A = atribuição exclusiva vigente na data (ou nenhuma)
        X = exceção vigente na data (ou nenhuma)
        sem A:                                  elegível
        A individual com needs_review:          ninguém elegível
        A e X.release_to_shared:                elegível (titular incluído)
        A e X.release_to_employee:              elegível somente se pessoa = beneficiário
        A individual sem X:                     elegível somente se pessoa = titular
        A de grupo sem X:                       elegível somente se integrante com vigência na data
        senão: NEGADO "uso exclusivo da diretoria"
  7. reserva ativa de outra pessoa na data?
        ativa = confirmed, ou held com hold_expires_at no futuro
        sim: INDISPONÍVEL "reservada"
        minha: MINHA RESERVA
  8. limites individuais: pessoa já tem reserva ativa de mesa na data?
        sim: NEGADO "você já tem reserva neste dia"
  resultado: DISPONÍVEL PARA VOCÊ
```

O mesmo procedimento roda na leitura (mapa e lista) e dentro da transação de escrita, após os locks. A razão retornada é a primeira falha na ordem, o que torna a explicação previsível.

## Comportamento por usuário

| Usuário | Mesa exclusiva individual de outra pessoa | Mesa exclusiva individual própria | Mesa exclusiva de grupo | Mesa compartilhada |
|---|---|---|---|---|
| Colaborador comum | Rótulo de uso exclusivo, sem botão; sem nome do titular por padrão | não se aplica | Rótulo de uso exclusivo, sem botão | Reserva normal |
| Titular | Rótulo de uso exclusivo, sem botão | "Sua mesa de uso exclusivo", reservar e cancelar a própria utilização | Se integrante ativo, reserva normal | Reserva normal, sem liberar a exclusiva |
| Outro diretor | Rótulo de uso exclusivo, sem botão, salvo exceção nominal vigente | não se aplica | Se integrante ativo, reserva normal | Reserva normal |
| RH e ADM com `manage_executive_seat_assignments` | Vê vínculo, vigência e histórico; opera a política; reserva em nome só com `booking.on_behalf.create` | idem | idem | Cancelamento administrativo com motivo |
| Facilities | Vê política como informação; opera manutenção e bloqueio; não altera exclusividade | idem | idem | Reserva operacional quando permitida |
| Beneficiário de exceção nominal | Reserva permitida somente dentro da janela | não se aplica | não se aplica | não se aplica |

## Estados do mapa e da lista

Cada estado combina cor, ícone e texto. Nenhum depende só de cor ou de hover.

| Estado | Texto | Ação |
|---|---|---|
| Disponível para você | "Disponível" | Reservar |
| Reservada | "Reservada" | Nenhuma; entrar na fila do dia |
| Minha reserva | "Sua reserva" | Cancelar, confirmar uso |
| Uso exclusivo da diretoria | `Uso exclusivo — Diretoria` | Nenhuma para não autorizados; "Sua mesa de uso exclusivo" para o titular |
| Bloqueada administrativamente | "Bloqueada" com motivo público quando houver | Nenhuma |
| Em manutenção | "Em manutenção" | Nenhuma, inclusive para o titular |
| Retida por oferta | "Reservada" para terceiros; "Oferta para você até HH:MM" para o beneficiário | Aceitar ou recusar |

## Fluxos administrativos (tela ADM, Escritório, Mesas, Exclusividade da diretoria)

### Travar e vincular (criar atribuição)

1. Selecionar a mesa no mapa ou na tabela.
2. Informar modalidade (individual ou grupo), titular (pessoa ativa com condição organizacional de diretor, `PAR-23`) ou grupo, início (padrão hoje), término opcional, justificativa e responsável. O campo responsável identifica quem decidiu (pessoa ou área); o ator da sessão é registrado automaticamente e pode ser diferente (`PAR-27`).
3. Prévia obrigatória: a mesa sai do conjunto compartilhado a partir de qual data; quantos dias afetados dentro do horizonte visível; lista de reservas incompatíveis (data, pessoa, origem) a partir do início; sobreposição com outra atribuição (impede); manutenção ou bloqueio vigentes (informa).
4. Sem reservas incompatíveis: confirmar. O servidor trava o recurso, revalida, grava atribuição, auditoria e notificações (titular, RH).
5. Com reservas incompatíveis: a confirmação fica desabilitada até escolher uma opção: iniciar no dia seguinte à última reserva incompatível; escolher outra mesa; ou tratamento autorizado, que lista cada reserva com decisão individual (cancelar com motivo e mensagem, ou realocar para outra mesa disponível para aquela pessoa) e só então libera a confirmação. Tudo dentro da mesma transação: se qualquer realocação falhar na revalidação, nada é aplicado e a prévia é refeita.

### Agendar

Mesmo fluxo com início futuro. A atribuição nasce `scheduled` e passa a valer pela vigência, sem job. Reservas comuns entre hoje e o início continuam válidas; reservas no período agendado entram na prévia de conflitos.

### Transferir

1. Selecionar atribuição individual vigente e informar novo titular (`PAR-23`), data da transferência, motivo e responsável.
2. Prévia: reservas do titular anterior a partir da data da transferência são incompatíveis e entram no diálogo de conflito de `DIR-016`, com as três opções: iniciar a transferência após a última reserva incompatível; escolher outra mesa para o novo titular; ou tratamento autorizado por reserva (cancelar com motivo e comunicação, ou realocar o titular anterior para mesa disponível). Reservas do novo titular em outras mesas nas mesmas datas são informadas, não canceladas.
3. Confirmação, com todas as reservas decididas, encerra a atribuição anterior no dia anterior à transferência e cria a nova a partir dela, com `transferred_from_id`, na mesma transação e com revalidação.

### Encerrar

Informar data de término (hoje ou futura) e motivo. Grava apenas o término; o estado passa a "encerrada" pela vigência (`DIR-036`). Prévia mostra as reservas do titular após o término (passam a ser reservas comuns e continuam válidas, pois ele é elegível ao compartilhado) e informa que a mesa volta ao conjunto compartilhado a partir do dia seguinte. Nenhuma reserva é cancelada.

### Anular

Só para atribuição agendada que ainda não começou. Registra quem anulou e o motivo; a atribuição sai da regra de sobreposição e do histórico ativo, mas permanece no histórico completo.

### Liberar temporariamente

1. Escolher tipo: para o conjunto compartilhado ou para pessoa específica.
2. Datas de início e fim (dias inteiros, inclusivos), motivo.
3. Prévia: dias liberados; manutenção ou bloqueio no período (continuam valendo). Na liberação para o conjunto compartilhado, as reservas do titular no período continuam válidas, pois ele é elegível ao compartilhado. Na liberação para pessoa específica, as reservas do titular no período são incompatíveis (`PAR-26`) e entram no diálogo de conflito de `DIR-016`: reduzir a janela, cancelar com comunicação ou realocar o titular. Sem decisão por reserva, não há confirmação.
4. Confirmação grava a exceção. A volta à exclusividade é calculada pela vigência. A exceção tem término obrigatório e duração máxima configurável (`PAR-35`); liberação sem fim é encerramento, não exceção.

### Revogar exceção

Revogar exceção com reserva do beneficiário, ou de terceiros no caso de liberação ao compartilhado, dentro da janela restante passa pelo diálogo de conflito de `DIR-016`; a reserva registra `access_exception_id` para que o histórico explique por que um não titular ocupou a mesa.

### Manutenção, bloqueio e fechamento

Operados por Facilities e ADM na tela de recursos e no calendário, não nesta tela, mas seguem `DIR-033`: prévia com reservas ativas afetadas (mesas, salas e cabines), decisão por reserva, revalidação e confirmação atômica.

### Revisar vínculo (`needs_review`)

Lista, por consulta derivada, atribuições individuais cujo titular não está ativo e atribuições de grupo sem integrante vigente, além das marcadas manualmente. Opções: transferir, encerrar, manter em revisão com nota. Durante a revisão de atribuição individual ninguém é elegível, nem por reserva em nome; a mesa permanece restrita.

### Gerir integrantes do grupo

Aba própria da tela: lista de integrantes do grupo com vigência, adição com data de início e remoção com data de término e motivo. A prévia da remoção lista as reservas futuras do integrante nas mesas do grupo a partir do término e aplica o diálogo de conflito de `DIR-016` (`DIR-032`). A operação trava as mesas do grupo em ordem crescente de id e é atômica.

### Histórico e conflitos

Histórico por mesa e por pessoa: atribuições, exceções, transferências, encerramentos, decisões de conflito, com ator, motivo e instante. Painel de conflitos pendentes: consulta dinâmica (`select ... where not is_bookable(...)`) sobre reservas ativas futuras, nunca lista alimentada por eventos. Com os triggers deferidos, o normal é que esteja vazio; qualquer linha indica caminho de escrita fora do protocolo e vira incidente.

### Operações em lote

Seleção múltipla na tabela, mesma ação para todas, prévia consolidada por mesa com conflitos, confirmação única, aplicação atômica. Qualquer mesa com conflito não tratado bloqueia o lote inteiro até decisão.

## Solicitação de liberação pelo diretor

O titular pode abrir, pela Home ou pelo detalhe da mesa, um pedido de liberação (datas e motivo opcional). O pedido vira atendimento de RH com categoria própria (`PAR-28`). Só a ação do RH na tela de exclusividade altera a política.
