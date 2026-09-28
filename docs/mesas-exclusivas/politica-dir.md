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
| `DIR-008` | O colaborador comum vê o rótulo de uso exclusivo da diretoria sem botão de reserva. O nome do titular só aparece para quem tem `exclusive.holder.view` ou conforme política interna de visibilidade a definir. |
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

## Ordem de cálculo de disponibilidade (`DIR-019`)

```
disponibilidade(pessoa, recurso, data):
  1. pessoa.status = active e can(pessoa, 'booking.self.manage')
        senão: NEGADO "conta inativa ou sem permissão"
  2. office_calendar[data].is_open
        senão: INDISPONÍVEL "escritório fechado"
  3. recurso não desativado e sem período de manutenção cobrindo data
        senão: INDISPONÍVEL "em manutenção" (vale para o titular)
  4. sem período de bloqueio administrativo cobrindo data
        senão: INDISPONÍVEL "bloqueada administrativamente"
  5. atribuição exclusiva vigente na data?
        não: política = compartilhada
        sim: exceção vigente na data?
              release_to_shared: política = compartilhada nesta data
              release_to_employee: política = exclusiva para beneficiário nesta data
              nenhuma: política = exclusiva individual ou de grupo
  6. elegibilidade:
        compartilhada: elegível
        exclusiva individual: pessoa = titular
        exclusiva de grupo: pessoa é integrante ativo do grupo na data
        exceção nominal: pessoa = beneficiário
        senão: NEGADO "uso exclusivo da diretoria"
  7. reserva ativa (held ou confirmed) de outra pessoa na data?
        sim: INDISPONÍVEL "reservada"
        minha: MINHA RESERVA
  8. limites individuais: pessoa já tem reserva de mesa na data?
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
| Uso exclusivo da diretoria | "Uso exclusivo da diretoria" | Nenhuma para não autorizados; "Sua mesa de uso exclusivo" para o titular |
| Bloqueada administrativamente | "Bloqueada" com motivo público quando houver | Nenhuma |
| Em manutenção | "Em manutenção" | Nenhuma, inclusive para o titular |
| Retida por oferta | "Reservada" para terceiros; "Oferta para você até HH:MM" para o beneficiário | Aceitar ou recusar |

## Fluxos administrativos (tela ADM, Escritório, Mesas, Exclusividade da diretoria)

### Travar e vincular (criar atribuição)

1. Selecionar a mesa no mapa ou na tabela.
2. Informar modalidade (individual ou grupo), titular ou grupo, início (padrão hoje), término opcional, justificativa. O responsável é o ator da sessão.
3. Prévia obrigatória: a mesa sai do conjunto compartilhado a partir de qual data; quantos dias afetados dentro do horizonte visível; lista de reservas incompatíveis (data, pessoa, origem) a partir do início; sobreposição com outra atribuição (impede); manutenção ou bloqueio vigentes (informa).
4. Sem reservas incompatíveis: confirmar. O servidor trava o recurso, revalida, grava atribuição, auditoria e notificações (titular, RH).
5. Com reservas incompatíveis: a confirmação fica desabilitada até escolher uma opção: iniciar no dia seguinte à última reserva incompatível; escolher outra mesa; ou tratamento autorizado, que lista cada reserva com decisão individual (cancelar com motivo e mensagem, ou realocar para outra mesa disponível para aquela pessoa) e só então libera a confirmação. Tudo dentro da mesma transação: se qualquer realocação falhar na revalidação, nada é aplicado e a prévia é refeita.

### Agendar

Mesmo fluxo com início futuro. A atribuição nasce `scheduled` e passa a valer pela vigência, sem job. Reservas comuns entre hoje e o início continuam válidas; reservas no período agendado entram na prévia de conflitos.

### Transferir

1. Selecionar atribuição individual vigente e informar novo titular, data da transferência e motivo.
2. Prévia: reservas do titular anterior a partir da data (serão listadas para decisão: manter até a data, cancelar com comunicação); reservas do novo titular em outras mesas nas mesmas datas (informa, não cancela).
3. Confirmação encerra a atribuição anterior no dia anterior à transferência e cria a nova a partir dela, com `transferred_from_id`, na mesma transação.

### Encerrar

Informar data de término e motivo. Prévia mostra as reservas do titular após o término (passam a ser reservas comuns e continuam válidas, pois ele é elegível ao compartilhado) e informa que a mesa volta ao conjunto compartilhado a partir do dia seguinte. Nenhuma reserva é cancelada.

### Liberar temporariamente

1. Escolher tipo: para o conjunto compartilhado ou para pessoa específica.
2. Datas de início e fim (dias inteiros, inclusivos), motivo.
3. Prévia: dias liberados; reservas do titular nesse período (informa que serão mantidas, ou permite cancelar com comunicação, decisão explícita); manutenção ou bloqueio no período (informa que continuam valendo).
4. Confirmação grava a exceção. A volta à exclusividade é calculada pela vigência.

### Revisar vínculo (`needs_review`)

Lista atribuições cujo titular foi desativado ou cujo grupo perdeu o integrante. Opções: transferir, encerrar, manter em revisão com nota. A mesa permanece restrita enquanto estiver em revisão.

### Histórico e conflitos

Histórico por mesa e por pessoa: atribuições, exceções, transferências, encerramentos, decisões de conflito, com ator, motivo e instante. Painel de conflitos pendentes: reservas que se tornaram incompatíveis por alterações administrativas fora deste fluxo (por exemplo, integrante removido de grupo) e aguardam decisão.

### Operações em lote

Seleção múltipla na tabela, mesma ação para todas, prévia consolidada por mesa com conflitos, confirmação única, aplicação atômica. Qualquer mesa com conflito não tratado bloqueia o lote inteiro até decisão.

## Solicitação de liberação pelo diretor

O titular pode abrir, pela Home ou pelo detalhe da mesa, um pedido de liberação (datas e motivo opcional). O pedido vira atendimento de RH com categoria própria. Só a ação do RH na tela de exclusividade altera a política.
