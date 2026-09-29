# Guia do RH e do ADM

Referência: 29/09/2026. Cobre o que existe na Etapa 1. Planta, mesas exclusivas, conflitos e indicadores serão acrescentados nas etapas seguintes.

## Entrar no ambiente administrativo

1. Entre pelo portal com email corporativo e senha.
2. Perfis privilegiados (RH, Facilities, Administrador, Administrador técnico) só valem com segundo fator ativo. Sem ele, o portal leva você a Perfil, Segurança para ativar o aplicativo autenticador. Guarde os códigos de recuperação.
3. Sessões de perfil privilegiado duram 12 horas. Depois disso é preciso entrar de novo.
4. O link Ambiente administrativo aparece no menu para quem tem alguma permissão administrativa.

## Cadastrar uma pessoa

Ambiente administrativo, Colaboradores, Cadastrar pessoa.

* Nome completo, email corporativo, CPF, área, cargo, gestor, condição organizacional e data de admissão.
* O CPF é verificado no formato e nos dígitos, não na identidade. Fica cifrado e aparece mascarado.
* "Diretor" é condição organizacional. Não concede acesso ao sistema.
* Com a opção de convite marcada, o email de primeiro acesso é enfileirado na hora. A pessoa define a própria senha pelo link, válido por 7 dias e de uso único.
* Duplicidade de CPF ou de email responde "Já existe cadastro com estes dados", sem dizer de quem é. Procure a pessoa na lista.

## Importar por CSV

Colaboradores, Importar CSV.

1. Baixe o modelo e preencha uma linha por pessoa. Datas em dd/mm/aaaa. Condição: colaborador ou diretor.
2. Gere a prévia. Cada linha aparece como pronta, com erro ou em conflito, com dados mascarados. Colunas de perfil ou permissão são ignoradas: perfis são concedidos em Acessos.
3. Confirme. Só as linhas prontas entram, todas de uma vez, com convite. Se o cadastro mudou entre a prévia e a confirmação, o lote é recusado e a prévia precisa ser refeita.
4. A prévia fica cifrada por 30 minutos e é descartada depois. O arquivo não é guardado.

## Primeiro acesso e convites

* Na página da pessoa, Ações: Reenviar convite invalida o anterior; Revogar convite bloqueia o link sem desativar a pessoa.
* Convite expirado, usado ou revogado mostra a mesma mensagem à pessoa, sem explicar o motivo.
* A pessoa entra pelo login normal depois de definir a senha.

## Suspender, desativar e readmitir

* Suspender: bloqueia o login e encerra as sessões. Cadastro e perfis ficam. Use para afastamentos.
* Desativar: encerra sessões, convites, perfis e permissões, fecha o período de vínculo com a data de saída, cancela as reservas futuras da pessoa com comunicação, marca as mesas exclusivas da pessoa como "vínculo a revisar" (DIR-018) e cancela, também com comunicação, as reservas de terceiros nessas mesas que deixam de valer com a revisão (por exemplo sob liberação ao compartilhado). O diálogo de desativação mostra esses números antes da confirmação; o gestor direto recebe o resumo (PAR-25). O histórico fica.
* Readmitir: reutiliza o mesmo cadastro, abre novo período, envia novo convite e zera senha e segundo fator. Perfis antigos continuam encerrados.
* Ninguém altera a própria situação nem os próprios perfis.

## Conceder e revogar acessos

Na página da pessoa, seção Perfis e permissões, ou pela lista em Acessos.

* Perfis: Colaborador (implícito para toda pessoa ativa), Gestor, RH, Facilities, Administrador, Administrador técnico.
* Conceder Gestor exige `role.assign.standard`. Conceder RH, Facilities, Administrador, Administrador técnico ou qualquer permissão direta exige `role.assign.privileged`.
* Alterar alguém com perfil privilegiado, mesmo agendado para começar depois, exige `role.assign.privileged`: suspender, desativar, reativar, trocar o email de convidada, reenviar e revogar convite. Readmitir não exige: a pessoa volta sem perfis. Ninguém altera a própria área, gestor ou condição organizacional.
* Toda concessão tem motivo, data de início e término opcional. Tudo vai para a auditoria.
* Perfis privilegiados só produzem efeito quando a pessoa está ativa e com segundo fator.

## Revelar CPF

Só quem tem `cpf.reveal`. O botão Revelar pede o motivo; a consulta fica registrada na auditoria com nome de quem consultou.

## Auditoria

Ambiente administrativo, Auditoria, para quem tem `audit.view`. Eventos só de inserção, com antes e depois redigidos: CPF, senhas e tokens nunca aparecem. Filtre por ação, entidade ou id.

## Notificações

Os emails saem por uma fila (outbox) processada pelo worker. Na Visão geral, "Notificações pendentes" aguarda o worker; "Notificações com falha" esgotaram as tentativas e exigem ação do administrador técnico. Em desenvolvimento, os emails ficam em `.dev-mail/` e nada é enviado.

## Primeiro administrador

Procedimento de linha de comando no servidor, executado pelo administrador técnico uma única vez: `pnpm bootstrap:admin --email <email> --name <nome> --cpf <cpf>`. Cria a pessoa com os perfis Administrador e RH e as permissões `role.assign.privileged` e `audit.view`, e enfileira o convite. Recusa rodar se já existir alguém com perfil privilegiado; a opção `--force` só funciona em desenvolvimento e teste e é recusada em homologação e produção, onde vale o procedimento de acesso emergencial. O link do convite só aparece no console em desenvolvimento e teste; nos demais ambientes chega apenas pelo email.

## Convites e envio real

Na página da pessoa, cada convite mostra enfileirado, enviado em data e hora, ou bloqueado (destinatário fora da lista permitida do ambiente), além de válido, usado, revogado ou expirado. "Enviado" só aparece depois que o worker entregou de fato. A visão geral conta as notificações bloqueadas. Revogar um convite exige motivo, que fica na auditoria.

Pessoa com perfil privilegiado (RH, Facilities, Administrador, Administrador técnico ou permissão sensível), vigente ou agendado, só é alterada por quem tem `role.assign.privileged`: isso vale para suspender, desativar, reativar, trocar o email de convidada, reenviar e revogar convite. Nome e cargo continuam editáveis pelo RH. Convite cuja entrega esgotou as tentativas aparece como "Falha na entrega" e pede reenvio.

## Planta e inventário

Em Planta, crie o rascunho a partir da extração da planta R00: zonas por bloco, 84 mesas, 4 cabines, 3 salas, a mesa aberta e 2 booths com códigos provisórios (M001 a M084, C1 a C4, R1 a R3, RA1, B1, B2). O inventário nasce marcado como não validado; Facilities e RH conferem contagem, códigos, capacidades e atributos antes de aprovar. Só versão aprovada é publicada; publicar não apaga reservas nem troca a identidade de mesa. Sem versão publicada, o portal mostra "Mapa em preparação" e a lista.

## Recursos, manutenção e bloqueio

Em Recursos, cada mesa tem atributos com marcação "verificado por, em". Manutenção e bloqueio administrativo são períodos com início, término opcional e motivo (o motivo público aparece no mapa). Criar um período sobre reservas ativas abre a prévia com as pessoas afetadas: cada reserva recebe decisão (cancelar com comunicação ou realocar para mesa disponível para a pessoa); sem decisão, nada é aplicado. Liberar um período faz a mesa voltar a partir do dia informado, sem depender de rotina. Manutenção impede uso inclusive pelo titular de mesa exclusiva.

## Calendário e parâmetros

Fechar um dia trava a data e trata as reservas ativas apenas por cancelamento com comunicação. Os parâmetros ficam em Configurações: dia e hora de abertura das reservas da semana seguinte (PAR-01, padrão quinta às 10h), horizonte em semanas e duração máxima de liberação temporária (PAR-35, 30 dias). Toda alteração é auditada.

## Exclusividade da diretoria

Tela Exclusividade, aba Mesas. Selecione a mesa e escolha a ação:

* Travar e vincular: titular (pessoa ativa com condição de diretor), início (padrão hoje; início futuro agenda), término opcional, justificativa e responsável pela decisão. "Ver impacto" mostra desde quando a mesa sai do conjunto compartilhado, dias afetados, reservas incompatíveis, sobreposição com outra atribuição (impede) e manutenção ou bloqueio vigente (informa). "Confirmar" só existe dentro da prévia e exige decisão por reserva incompatível: cancelar com motivo e mensagem, ou realocar para mesa disponível. Se algo mudou entre a prévia e a confirmação, a confirmação é recusada e a prévia precisa ser refeita.
* Travar para o grupo: mesma prévia, para integrantes ativos do grupo da diretoria. Lote: marque várias mesas, "Selecionar para lote", uma ação para todas, prévia consolidada, aplicação atômica.
* Transferir: novo titular e data; as reservas do titular anterior a partir da data entram no diálogo de conflito; reservas do novo titular em outras mesas são informadas, não canceladas.
* Encerrar: grava só o término; a mesa volta ao conjunto compartilhado no dia seguinte; nenhuma reserva é cancelada.
* Anular: só atribuição agendada. Sucessora de transferência exige decidir: liberar a mesa ou reabrir para o titular anterior.
* Liberar temporariamente: ao conjunto compartilhado (reservas do titular continuam válidas) ou a pessoa específica (o titular não reserva nas datas liberadas e as reservas dele no período entram no diálogo de conflito). Fim obrigatório, no máximo o parâmetro configurado. A exclusividade volta sozinha.
* Revogar liberação: reservas feitas sob a liberação entram no diálogo de conflito.
* Revisão do vínculo: durante a revisão ninguém reserva a mesa, nem por reserva em nome.

Aba Grupo diretoria: integrantes com vigência; remover mostra as reservas futuras da pessoa nas mesas do grupo. Aba Conflitos pendentes: consulta dinâmica; o normal é vazia. Aba Histórico: atribuições, liberações e eventos de auditoria da mesa, inclusive decisões de conflito.

O nome do titular aparece só para quem tem `exclusive.holder.view`; o colaborador vê o rótulo "Uso exclusivo — Diretoria" sem botão. O diretor não remove a própria exclusividade; pede ao RH.

## Reservas administrativas

Em Reservas e fila, aba Mesas: reservas ativas por data, com a origem e a confirmação de uso declarada; reservar em nome de alguém exige a permissão própria, confirmação de ciência, registra quem fez e notifica a pessoa; cancelar reserva alheia exige motivo e envia comunicação. Cancelar reserva de titular nunca altera a exclusividade. Cancelar uma reserva com fila em espera gera a oferta à primeira pessoa elegível na mesma hora.

## Fila de espera

A pessoa entra na fila pelo mapa quando não há mesa disponível para ela na data, o dia está aberto e a janela de reservas abriu. Quem já tem reserva na data não entra (`PAR-30`). Quando uma mesa é liberada (cancelamento, liberação por falta de confirmação, retenção vencida, desativação de quem reservou), a primeira pessoa elegível da fila recebe a oferta: a mesa fica retida para ela pelo prazo de `PAR-05` (120 minutos úteis no expediente de `PAR-43`, nunca além do fim do dia da reserva) e ela recebe email. Aceitar confirma a reserva; recusar ou deixar vencer passa a mesa à próxima pessoa. Reserva direta de quem não está na fila nunca passa à frente (`PAR-37`). Mesa de uso exclusivo nunca é oferecida pela fila.

Aba Fila de espera (permissão `waitlist.admin`): inscrições da data por ordem de entrada, com posição, situação, oferta e prazo; oferta manual escolhendo uma mesa compartilhada disponível para a pessoa (mesma regra, ator registrado; mesa exclusiva nunca é oferecida manualmente, e o código dela fica oculto a quem não tem `exclusive.holder.view`); retirada da fila com motivo auditado, avisada à pessoa. Na aba Mesas, a linha de uma oferta da fila tem o botão "Retirar oferta": a pessoa continua na fila na mesma posição, é avisada e a mesa segue para a próxima. Fechar o dia encerra as inscrições da data com aviso. Quem tem a própria mesa de uso exclusivo livre na data sai da fila com aviso, para não consumir mesa compartilhada. O quadro de demanda não atendida mostra inscrições vivas nos próximos 14 dias. O worker da outbox roda a varredura a cada minuto; a correção não depende dele.

## Confirmação de uso e QR

A pessoa confirma o uso da própria reserva de hoje em Minhas reservas ou lendo o QR do recurso. O QR de cada recurso está no painel do recurso (Recursos, selecionar o código) e carrega só o endereço com o código; a reserva é resolvida pela sessão de quem lê. Confirmação é declaração da pessoa, nunca presença, ponto ou produtividade. A liberação de mesa sem confirmação (`PAR-06`) está desativada; quando ativada em Configurações, depois do horário de `PAR-44`, libera só mesas compartilhadas sem confirmação, avisa a pessoa e oferece a mesa à fila. Mesa exclusiva nunca é liberada. A liberação só atinge reserva que já estava confirmada antes do horário limite (oferta aceita conta do aceite) e poupa quem declarou uso em qualquer reserva de mesa do dia, inclusive depois de uma realocação. Com a liberação ativa, Minhas reservas mostra o prazo de confirmação.

## Salas e cabines

A pessoa busca por data, horário, capacidade e recursos verificados em Salas e cabines e reserva por intervalo (múltiplos de 15 minutos, até 24:00, dentro do horizonte em semanas das mesas; `PAR-45`, `DEC-26`). Reservas adjacentes convivem; sobreposição é recusada com o horário ocupado. O título é privado por padrão: terceiros e a administração veem "Reservada". No painel do recurso, Facilities registra capacidade, duração máxima por reserva (`PAR-18`) e recursos verificados. Manutenção, bloqueio, desativação e fechamento de dia listam as reservas de sala no diálogo de conflito, só com cancelamento. Aba Salas e cabines em Reservas e fila: reservas da data e cancelamento com motivo.

## Meu time

O gestor (permissão `team.view`) vê a intenção de presença e as reservas das pessoas que respondem diretamente a ele no cadastro e que ativaram o compartilhamento no próprio perfil. O compartilhamento vem desativado e cada pessoa decide. A autorização vale para o gestor vigente no momento em que é dada: se o RH trocar o gestor no cadastro, a pessoa precisa autorizar de novo; desativação e readmissão zeram a autorização.
