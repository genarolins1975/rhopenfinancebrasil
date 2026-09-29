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
* Desativar: encerra sessões, convites, perfis e permissões, fecha o período de vínculo com a data de saída. O histórico fica. Reservas e mesas vinculadas terão regra própria na Etapa 2.
* Readmitir: reutiliza o mesmo cadastro, abre novo período, envia novo convite e zera senha e segundo fator. Perfis antigos continuam encerrados.
* Ninguém altera a própria situação nem os próprios perfis.

## Conceder e revogar acessos

Na página da pessoa, seção Perfis e permissões, ou pela lista em Acessos.

* Perfis: Colaborador (implícito para toda pessoa ativa), Gestor, RH, Facilities, Administrador, Administrador técnico.
* Conceder Gestor exige `role.assign.standard`. Conceder RH, Facilities, Administrador, Administrador técnico ou qualquer permissão direta exige `role.assign.privileged`.
* Suspender ou desativar alguém com perfil privilegiado exige `role.assign.privileged`. Ninguém altera a própria área, gestor ou condição organizacional.
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

Na página da pessoa, cada convite mostra enfileirado, enviado, bloqueado (destinatário fora da lista permitida de homologação) ou expirado. "Enviado" só aparece depois que o worker entregou de fato. Revogar um convite exige motivo, que fica na auditoria.
