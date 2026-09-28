# Telas prioritárias e estados

Referência: 28/09/2026. Ordem de prioridade de implementação. Estados obrigatórios em todas: carregamento, ausência de dados, sucesso, erro, conflito, indisponibilidade, conexão perdida, permissão insuficiente. A tabela de cada tela registra apenas o que difere do padrão descrito em `../produto/mapa-do-produto.md`.

## 1. Entrar, convite, recuperação e segundo fator

| Elemento | Regra |
|---|---|
| Entrar | Email corporativo e senha; erro genérico "credenciais inválidas"; limite de tentativas com mensagem neutra; sem indicação de existência de conta |
| Convite | Rota com token; mostra nome e email cadastrados mascarados; define senha (mínimo 15, até 128, medidor sem regras de composição, bloqueio de senha comprometida); token expirado ou usado mostra "convite inválido" e orientação de pedir novo ao RH, sem revelar qual das duas condições |
| Recuperação | Sempre "se o email existir, você receberá instruções"; CPF nunca é usado |
| Segundo fator | Configuração obrigatória para perfis administrativos antes de qualquer rota `/admin`; TOTP e códigos de recuperação |
| Senha temporária (se adotada) | Aleatória, única, curta validade, troca forçada no servidor antes de qualquer operação |

## 2. Início

| Elemento | Regra |
|---|---|
| Saudação | "Olá, [nome]. Como será sua próxima semana?" |
| Semana | Cinco dias úteis com intenção (presencial, remoto, não informado) e reserva confirmada diferenciadas por ícone e texto |
| Botão | "Planejar minha semana" |
| Diretor com vínculo | "Sua mesa habitual: [código]" e atalho para registrar dias de utilização; nenhuma presença é gerada automaticamente |
| Depois | Próximas reservas, solicitações em andamento, avisos relevantes (prioridade e validade), resumo "Vocês disseram. Estamos fazendo." |
| Proibido | CPF, rankings, métricas de produtividade |
| Vazio | "Você ainda não planejou a próxima semana" com o botão |

## 3. Planejar minha semana

| Elemento | Regra |
|---|---|
| Seleção | Vários dias, intenção por dia, posição elegível por dia (mesa habitual sugerida ao titular) |
| Resumo | Por dia, antes de concluir |
| Confirmação | Atômica: todos os dias ou nenhum; em conflito, mostra os dias afetados e permite aceitar seleção menor com nova confirmação |
| Repetição | Chave de idempotência; reenvio não duplica |
| Conflito | Lista dia, mesa e razão vinda do serviço de disponibilidade |

## 4. Escritório: mapa e lista

| Elemento | Regra |
|---|---|
| Mapa | SVG gerado do mapa operacional publicado; zoom; navegação por teclado entre recursos; legenda com cor, ícone e texto |
| Lista | Alternativa completa com os mesmos estados e ações, filtros por zona, tipo e estado |
| Data | Seletor de data; estados recalculados no servidor por data |
| Sem planta publicada | "Mapa em preparação" e lista disponível com inventário publicado |
| Indisponibilidade | Se o serviço de disponibilidade falhar, a tela informa e não mostra mesas como disponíveis por padrão |

## 5. Detalhe do recurso

Estado para o usuário na data, razão do estado (primeiro impedimento da ordem de cálculo), atributos verificados, ação permitida. Para o titular: "Sua mesa de uso exclusivo". Para os demais em mesa exclusiva: rótulo literal `Uso exclusivo — Diretoria` sem botão e, quando permitido, nome do titular.

## 6. Minhas reservas e fila

Reservas futuras e passadas, cancelamento com reflexo imediato, confirmação de uso pelo portal ou QR, inscrição na fila por data, ofertas com prazo visível. Cancelar reserva de mesa exclusiva pelo titular não altera a exclusividade e a tela diz isso.

## 7. Salas e cabines

Busca por data, horário, capacidade e recursos verificados; agenda legível; conflitos de intervalo; título de reunião privada oculto a quem só precisa de disponibilidade; limites de duração como configuração, não constante.

## 8. Fale com RH

Nova solicitação (assunto, local ou recurso quando pertinente, descrição, anexo opcional com validação de tipo e tamanho), lista das minhas solicitações, detalhe com protocolo, área responsável, status, próxima atualização, histórico visível, confirmação de solução, avaliação e reabertura conforme política. Assunto sensível exibe aviso de fluxo restrito.

## 9. Admin: início

Calendário da semana, demanda não atendida, recursos indisponíveis, capacidade compartilhada, mesas exclusivas, conflitos pendentes, solicitações prioritárias. Cada indicador com explicação (numerador, denominador, período, fonte, limitações) e recorte permitido ao perfil.

## 10. Admin: colaboradores e importação

Lista com filtros e busca; cadastro individual; convite (enviar, reenviar, revogar); desativação com prévia de efeitos (sessões, convites, permissões, reservas futuras, atendimentos, mesas vinculadas); CPF mascarado com botão "Revelar" que exige `cpf.reveal`, motivo e gera auditoria. Importação CSV com modelo para download, prévia por linha, validação (formato, duplicidade por HMAC, email, área), preservação de zeros à esquerda, colunas de perfil privilegiado ignoradas com aviso, confirmação.

## 11. Admin: recursos e planta

Tabela de recursos (ID, tipo, zona, política de uso, beneficiário quando permitido, vigência, estado operacional, pendências); filtros: compartilhadas, exclusivas individuais, exclusivas de grupo, bloqueadas, manutenção, vínculo a revisar. Edição de atributos com marcação "verificado por, em". Versões da planta: rascunho, aprovação, publicação; posicionamento de elementos sobre o desenho; publicação não apaga reservas nem troca identidade de mesa.

## 12. Admin: Exclusividade da diretoria (destaque)

### Layout (desktop)

```
+==========================================================================+
| ADM  >  Escritório  >  Mesas  >  Exclusividade da diretoria              |
+==========================================================================+
| Abas: [Mesas] [Grupo diretoria] [Conflitos pendentes] [Histórico]        |
| Filtros: [Compartilhadas] [Exclusivas individuais] [Exclusivas de grupo] |
|          [Bloqueadas] [Manutenção] [Vínculo a revisar]   Busca: [______] |
+===============================+==========================================+
| Tabela (ou mapa)              | Painel da mesa selecionada               |
| ID    Zona  Política  Benef.  | [cód] · [zona] · Exclusiva individual    |
| [cód] [z]   Compart.  ...     | Titular: [nome, se permitido]            |
| [cód] [z]   Excl.ind. [nome]  | Vigência: [início] até sem término       |
| [cód] [z]   Excl.gr.  [grupo] | Situação: operacional                    |
| [cód] [z]   Compart. (manut.) | Pendências: [n] reservas incompatíveis   |
| ...                           |                                          |
|                               | Ações (mesa compartilhada):              |
|                               |   [Travar agora] [Agendar trava]         |
|                               | Ações (mesa exclusiva):                  |
|                               |   [Transferir] [Encerrar]                |
|                               |   [Liberar temporariamente]              |
|                               |   [Histórico] [Conflitos]                |
+===============================+==========================================+
| Seleção em lote: [n] mesas  [Travar para grupo] [Encerrar]  Prévia >     |
+==========================================================================+
```

Ilustrativo: códigos, zonas, nomes, quantidades e datas entre colchetes são marcadores e não vêm da planta nem de pessoas reais. As ações exibidas dependem do estado da mesa selecionada.

### Formulário de travar e vincular

Campos: mesa (preenchida pela seleção), modalidade, titular (busca por nome somente entre pessoas ativas com `org_condition = director`, `PAR-23`) ou grupo, início, término opcional, justificativa obrigatória, responsável (`PAR-27`). Botão "Ver impacto" abre a prévia; "Confirmar" só existe dentro da prévia.

### Prévia de impacto

Resumo: "A mesa [código] deixa o conjunto compartilhado a partir de [data], sem término definido." Blocos: reservas incompatíveis (tabela com data, pessoa, origem, ação escolhida), sobreposição com outra atribuição (bloqueia), manutenção ou bloqueio vigente (informa), notificações que serão enviadas.

### Diálogo de conflito

Três opções excludentes no topo: "Iniciar em [dia seguinte à última reserva incompatível]", "Escolher outra mesa", "Tratar reservas". A terceira abre a tabela de reservas com decisão por linha (cancelar com motivo e mensagem ao afetado, ou realocar para mesa disponível para a pessoa naquela data, escolhida em lista filtrada pelo serviço de disponibilidade). "Confirmar" fica desabilitado enquanto houver linha sem decisão. Na confirmação o servidor revalida tudo; se algo mudou, a prévia é reaberta com as diferenças destacadas.

### Aba Grupo diretoria

Integrantes com vigência; adicionar com data de início; remover com data de término e motivo; prévia com as reservas futuras do integrante nas mesas do grupo e o diálogo de conflito (`DIR-032`).

### Estados específicos

| Estado | Comportamento |
|---|---|
| Carregando | Esqueleto da tabela e painel; ações desabilitadas |
| Sem dados | "Nenhuma mesa cadastrada" ou "Nenhuma mesa com este filtro" |
| Sucesso | Mensagem após commit com resumo e link para histórico |
| Erro | Mensagem com identificador da requisição; nada aplicado |
| Conflito | Diálogo acima; nunca aplicação parcial |
| Indisponibilidade | Serviço fora: leitura permitida a partir do último estado carregado com aviso; escrita desabilitada |
| Conexão perdida | Formulário preservado; reenvio com a mesma chave de idempotência |
| Permissão insuficiente | Com `exclusive.view` e sem `manage_executive_seat_assignments`: modo leitura; nomes de titulares só com `exclusive.holder.view`; sem `exclusive.view`: acesso negado |

## 13. Admin: reservas e fila

Reservas por data e recurso; reserva em nome de (permissão própria, confirmação, ator registrado, notificação); cancelamento administrativo com motivo e comunicação; fila por data com ofertas, prazos e expirações; processamento automático da próxima pessoa elegível ao expirar uma oferta, com ação manual complementar do ADM.

## 14. Admin: atendimentos

Filas por área, triagem, atribuição, transições com motivo, mensagens ao solicitante e notas internas separadas visualmente e por permissão, agrupamento em ocorrência sem expor identidades, prazos configurados por área.

## Telas de etapas posteriores

Benefícios e guia, avisos, escuta e pesquisas, plano de ações, relatórios, acessos, configurações e auditoria seguem o mesmo padrão de estados e serão detalhadas no início das Etapas 3 e 4.
