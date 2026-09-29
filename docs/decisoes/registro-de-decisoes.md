# Registro de decisões

Referência: 28/09/2026. Três categorias: requisito aprovado (vem do prompt como obrigação), parâmetro proposto (sugerido no prompt ou por esta equipe, pendente de validação do responsável) e decisão técnica proposta (escolha desta equipe, pendente de validação). Nada muda de categoria sem registro aqui.

## A. Requisitos aprovados

| ID | Requisito | Fonte |
|---|---|---|
| `REQ-01` | Cadastro fechado, sem autorregistro; convite individual, expirável, de uso único | Prompt §7 |
| `REQ-02` | Permissões no servidor, negação por padrão, incluindo anexos, exportações, buscas e endpoints auxiliares | Prompt §5 |
| `REQ-03` | Permissão `manage_executive_seat_assignments` para RH e administradores autorizados; Facilities não a recebe automaticamente | Prompt §5 |
| `REQ-04` | Atribuição de perfis privilegiados por permissão separada; RH não se promove | Prompt §5 |
| `REQ-05` | CPF como texto de 11 dígitos, separado do perfil, cifrado em repouso, índice HMAC com chave separada, mascarado por padrão, revelação auditada, ausente de logs, URLs, analytics, erros, notificações, demonstração e exportações comuns | Prompt §6 |
| `REQ-06` | Senha mínima de 15 e suporte a pelo menos 64 caracteres, sem troca periódica, bloqueio de senhas comprometidas, Argon2id preferencial | Prompt §7 |
| `REQ-07` | MFA obrigatório para perfis administrativos antes da produção | Prompt §7 |
| `REQ-08` | Três políticas de uso; separação entre política, situação operacional e reserva; atribuição com recurso, modalidade, titular ou grupo, início, término, motivo e autor | Prompt §10 e §20 |
| `REQ-09` | Persistência da trava (`DIR-006`) e exclusão de mesas exclusivas de recomendações, fila e reserva automática | Prompt §10.4 |
| `REQ-10` | Conflitos explícitos, sem exclusão silenciosa; opções de início posterior, outra mesa ou tratamento autorizado | Prompt §10.6 |
| `REQ-11` | Titular desativado: "Vínculo precisa de revisão", mesa não liberada | Prompt §10.6 |
| `REQ-12` | Ordem de cálculo de disponibilidade fixa; manutenção impede uso pelo titular | Prompt §10.7 |
| `REQ-13` | Serviço central de disponibilidade; identidade da sessão; unicidade em banco; serialização por recurso com ordem de locks, revalidação e repetição; UTC e `America/Sao_Paulo` | Prompt §11 |
| `REQ-14` | Liberação temporária por dias inteiros, retorno automático pela vigência, sem contornar manutenção ou fechamento | Prompt §10.5 |
| `REQ-15` | Confirmação de uso como declaração, nunca prova de presença ou ponto; liberação automática desativada até o piloto e jamais removendo exclusividade | Prompt §12 |
| `REQ-16` | Pesquisas identificadas e confidenciais; "anônima" só após demonstração técnica; sem entrega de respostas individuais a gestores por padrão; respostas nunca conectadas a CPF, reservas ou histórico para avaliar indivíduos | Prompt §17 |
| `REQ-17` | Indicadores sem dupla contagem; toda taxa com numerador, denominador, período, fonte e limitações; sem ranking de funcionários | Prompt §19 |
| `REQ-18` | Notificações via outbox após commit, idempotentes, com visibilidade de falhas | Prompt §20 |
| `REQ-19` | Sem DNS, produção, envio em massa, contratação ou migração destrutiva sem autorização explícita | Prompt §22 |
| `REQ-20` | Testes de concorrência com sessões distintas; os 15 casos da tabela de aceite bloqueiam a entrega se falharem | Prompt §23 |
| `REQ-21` | Nenhuma planta fictícia tratada como definitiva; mapa definitivo só após aprovação de Facilities e RH | Prompt §9 e §24 |
| `REQ-22` | Integridade dos dados da pesquisa: metodologia preservada, sem NPS, divergência de copa exibida com origem | Prompt §2 |
| `REQ-23` | Verificar formato e dígitos do CPF não verifica identidade; CPF não é chave pública, nome de usuário, componente de senha nem resposta de recuperação; senha nunca deriva de CPF ou de sufixo fixo | Prompt §6 e §7 |
| `REQ-24` | Senhas atuais jamais exibidas ao ADM; registro de eventos de segurança, não de senhas ou tokens; primeiro administrador por procedimento controlado, sem credencial fixa no código | Prompt §7 |
| `REQ-25` | Intenção presencial não garante mesa; ausência de reserva não indica falta ao trabalho; nenhuma presença ou confirmação gerada automaticamente | Prompt §8 |
| `REQ-26` | Fila processa automaticamente a próxima pessoa elegível ao expirar oferta; encaminhamento de atendimento sem exigir organograma; transições de status com motivos; notas internas separadas; reclassificação sem expor conteúdo confidencial; ocorrências agrupadas sem identidades | Prompt §12 e §14 |
| `REQ-27` | Relatos de ruído e temperatura como percepções; copa sem reserva de micro ondas nem vigilância; sem diagnósticos nem publicação de motivos de adaptações; integração voluntária; só serviços confirmados pela Associação; indicadores de atendimento sem ler queda de chamados como melhoria; sem ranking | Prompt §15, §16 e §19 |
| `REQ-28` | Buscas, anexos, exportações e endpoints auxiliares sob o mesmo controle de acesso; documentos privados fora de diretórios públicos | Prompt §5 e §16 |

## B. Parâmetros propostos (pendentes de validação)

| ID | Parâmetro | Valor proposto | Quem valida | Observação |
|---|---|---|---|---|
| `PAR-01` | Abertura de reservas | Quinta às 10h para a semana seguinte | RH e Facilities | Configurável em `office_settings` |
| `PAR-02` | Unidade de reserva de mesa | Dia inteiro | RH | |
| `PAR-03` | Diretor sujeito ao limite de uma reserva efetiva de mesa por dia; a unicidade por pessoa e data no banco é requisito (`REQ-13`), não parâmetro | Sim | RH | `DIR-012` |
| `PAR-04` | Confirmação atômica da semana | Tudo ou nada, com opção de aceitar seleção menor | RH | |
| `PAR-05` | Prazo de oferta da fila | 2 horas úteis (120 minutos) dentro do calendário do escritório, contadas no expediente de `PAR-43`; nunca além do fim do dia local da reserva | RH e Facilities | Configurável em `office_settings.offer_minutes` (Etapa 3) |
| `PAR-06` | Liberação automática por falta de confirmação de uso | Desativada | RH | Nunca remove exclusividade nem toca mesa de classe exclusiva; quando ativada, só depois do horário de `PAR-44` (Etapa 3) |
| `PAR-07` | Validade do convite | 7 dias | RH | |
| `PAR-08` | Validade do token de recuperação | 60 minutos | RH e ADM | Padrão da biblioteca |
| `PAR-09` | Sessão | 7 dias com renovação diária; sessões administrativas de 12 horas | ADM | Revogação imediata em eventos críticos |
| `PAR-10` | Argon2id | m = 47104 KiB, t = 1, p = 1 | ADM técnico | Alternativa m = 19456 KiB, t = 2, p = 1 |
| `PAR-11` | Limite de tentativas de login | 5 por 10 minutos por conta e por IP, com resposta neutra | ADM | |
| `PAR-12` | Tamanho máximo de anexo | 10 MB, tipos PDF, PNG, JPG, DOCX, XLSX | Facilities, RH e TI | |
| `PAR-13` | Supressão de resultados de pesquisa | Mínimo 10 respondentes por recorte, mais regra contra diferença entre totais | RH e encarregado | |
| `PAR-14` | Retenção | Ver `../dados/modelo-de-dados.md` | Encarregado e jurídico | |
| `PAR-15` | Visibilidade do nome do titular de mesa exclusiva, dos integrantes do grupo e das pessoas com reserva em conflito | RH, ADM autorizado e o próprio titular por padrão; Facilities e demais só por concessão de `exclusive.holder.view`; sem ela, a tela mostra "titular", "integrante" e "pessoa" com nome restrito | RH e diretoria | `DIR-008`; ampliado na revisão da Etapa 2 |
| `PAR-16` | Dupla aprovação para conceder `admin` e `tech_admin` | Exigida | ADM | |
| `PAR-17` | Categorias de atendimento | Infraestrutura, tecnologia, ergonomia, ruído, temperatura, copa, benefícios, assuntos de RH; assuntos de RH com fluxo restrito | RH, Facilities e TI | |
| `PAR-18` | Limites de duração e capacidade de salas e cabines | Nenhum fixado; configuração por recurso | Facilities | |
| `PAR-19` | Redirecionamento de domínio | `www` para o apex | ADM técnico | |
| `PAR-20` | Verificação de senha comprometida por serviço externo com k anonimato | Ativada | Encarregado | Envia cinco caracteres do SHA1 |
| `PAR-21` | Uso do CPF na importação | Obrigatório por linha, com HMAC para duplicidade | RH e encarregado | |
| `PAR-22` | Indicador de copa no painel | Consolidado da página 8 (17%) com nota da divergência | Facilities | `REQ-22` |
| `PAR-23` | Titular de atribuição individual | Somente pessoa ativa com condição organizacional de diretor | RH | Sem exceção prevista |
| `PAR-24` | Máscara do CPF | Apenas os dois últimos dígitos visíveis | RH e encarregado | |
| `PAR-25` | Reservas futuras na desativação | Canceladas com comunicação à pessoa e ao gestor direto; reservas de terceiros nas mesas exclusivas da pessoa que deixam de valer com a revisão do vínculo também são canceladas com comunicação; tudo listado na prévia da desativação e na auditoria; áreas afetadas acompanham pelo painel administrativo | RH | Prompt exige regra explícita, não define qual; revisto na revisão da Etapa 2 |
| `PAR-26` | Acesso do titular durante liberação nominal | Titular não reserva a mesa nas datas liberadas a outra pessoa; reservas existentes viram conflito tratado | RH e diretoria | `DIR-031` |
| `PAR-27` | Campo responsável na atribuição | Distinto do ator da sessão, que é registrado automaticamente | RH | |
| `PAR-28` | Categoria de atendimento para pedido de liberação de mesa exclusiva | Incluída nas categorias de RH | RH | Complementa `PAR-17` |
| `PAR-29` | Isenções da janela de abertura | Realocação e cancelamento administrativos isentos; titular de mesa exclusiva sujeito à janela | RH | `DIR-019` passo 2b |
| `PAR-30` | Inscrição na fila por quem já tem reserva na data | Negada; troca de mesa fica para etapa posterior | RH | |
| `PAR-31` | Piso de supressão de resultados de pesquisa | 10 respondentes, constante de código, não configurável por nenhum perfil | RH e encarregado | Complementa `PAR-13` |
| `PAR-32` | Sufixo do CPF gravado em claro para mascarar sem decifrar | Dois últimos dígitos em coluna própria, fora de exportações | Encarregado | |
| `PAR-33` | Perfis e permissões privilegiados | Só tomam efeito para pessoa ativa com segundo fator ativo | ADM | |
| `PAR-34` | Tempo máximo de espera por lock em transação de reserva | 3 segundos, com nova tentativa | ADM técnico | |
| `PAR-35` | Duração máxima de uma liberação temporária | 30 dias corridos | RH | Acima disso, encerrar a atribuição |
| `PAR-36` | Readmissão e CPF após exclusão | Mesmo cadastro reutilizado; ao apagar o CPF o HMAC permanece para impedir duplicidade | RH e encarregado | |
| `PAR-37` | Prioridade da fila sobre reserva direta | Sempre: cancelamento e reserva direta que expira uma retenção oferecem a mesa à próxima pessoa elegível da fila antes de conceder | RH | `DIR-034` |
| `PAR-38` | Dispositivo confiável no segundo fator | Desativado para todos na primeira versão: o código é pedido a cada login | ADM | Simplifica e fecha a brecha do cookie de 30 dias |
| `PAR-39` | Perfil Colaborador | Implícito para toda pessoa ativa, sem concessão | RH | |
| `PAR-40` | Escopo de `role.assign.standard` | Só os perfis Colaborador e Gestor; toda permissão direta exige `role.assign.privileged` | ADM | Revisão da Etapa 1 |
| `PAR-41` | Limite anti oráculo da importação | 5 prévias e 3.000 linhas por pessoa por hora | RH e encarregado | Revisão da Etapa 1 |
| `PAR-42` | Sessão de 12 horas para privilegiados | Conferida em toda página e toda action, não só no ambiente administrativo | ADM | Revisão da Etapa 1 |
| `PAR-43` | Expediente para contar horas úteis da oferta | 09:00 às 18:00, segunda a sexta, exceto dias fechados no calendário do escritório. Oferta para data que não é dia útil (fim de semana aberto, dia sem expediente): vale o prazo em horas úteis quando ele termina antes da data; senão, minutos corridos contados do início do horário comercial da própria data (ou da hora da oferta, se já passou), sempre limitados ao fim da data | RH e Facilities | Valor adotado pelo Executor sem fonte oficial; configurável (`business_hours_start`, `business_hours_end`); regra da data sem expediente revista na segunda revisão independente (T-08, RP-02): oferta feita à noite para o sábado não vence de madrugada |
| `PAR-44` | Horário limite da confirmação de uso, se `PAR-06` for ativado | 11:00 do dia da reserva; só é liberada a reserva que já estava confirmada antes do limite (oferta aceita conta do aceite) e cuja pessoa não declarou uso em nenhuma reserva de mesa do dia | RH | Sem efeito enquanto `PAR-06` estiver desativado; semântica da revisão independente (T-03, T-04) |
| `PAR-45` | Grade e limites de salas e cabines | Múltiplos de 15 minutos, intervalo no mesmo dia local com fim até 24:00, duração mínima de 15 minutos, horizonte em semanas igual ao das mesas; limite máximo por recurso opcional (`PAR-18`) | Facilities | Etapa 3 |

## C. Decisões técnicas propostas

| ID | Decisão | Alternativas consideradas | Status |
|---|---|---|---|
| `DEC-01` | Next.js 16 (App Router) com React 19 e TypeScript | Remix, SvelteKit | Proposta |
| `DEC-02` | PostgreSQL 18 (17 se o provedor não oferecer) | MySQL | Proposta |
| `DEC-03` | Drizzle ORM linha estável com migrações SQL explícitas | Prisma 7, Kysely | Proposta |
| `DEC-04` | Better Auth com Argon2id, MFA, admin server side, sem impersonação | Auth.js, Keycloak, Auth0, Clerk | Proposta |
| `DEC-05` | `pg-boss` para outbox e agendamentos | Cron externo, Redis | Substituída por `DEC-16` e `DEC-27` (worker próprio) |
| `DEC-06` | Node.js 24 LTS como alvo; 22 aceito | | Proposta |
| `DEC-07` | Mapa em SVG gerado do mapa operacional, com lista equivalente | Canvas, biblioteca de mapas | Proposta |
| `DEC-08` | Hospedagem: opção A (Vercel mais Neon) ou B (Railway) para piloto | C, D | Pendente de contratação autorizada |
| `DEC-09` | Email transacional por SMTP atrás de interface própria; provedor a definir | | Pendente |
| `DEC-10` | Armazenamento privado compatível com S3; provedor a definir | | Pendente |
| `DEC-11` | Executor e Revisor como subagentes independentes desta sessão; quando indisponíveis, ciclos separados declarados | | Adotada na Etapa 0 |
| `DEC-12` | Lint com ESLint e regras de acessibilidade; formatação com Prettier | Biome | Proposta |
| `DEC-13` | Plugin admin do Better Auth não montado; operações administrativas de identidade pelo adaptador interno após `can()`; handler com lista explícita de caminhos e `disabledPaths`; cache de sessão em cookie desativado; hook global conferindo `employee.status`; `sendChangeEmailConfirmation`; `trustDevice` neutralizado para perfis administrativos | Montar o plugin com `adminRoles` vazio | Proposta, verificada contra o código de `better-auth@1.7.6` em 28/09/2026 |
| `DEC-14` | Lock por recurso imposto por trigger no banco, além do protocolo da aplicação; estado de atribuição derivado da vigência; expiração preguiçosa de retenções | Confiar só na disciplina do código | Proposta |
| `DEC-15` | Prévia da importação CSV persistida cifrada (AES GCM, chave própria, AAD = id do lote) por 30 minutos, só com as linhas válidas; arquivo original nunca gravado | Reenvio do arquivo na confirmação; memória do processo | Adotada na Etapa 1 |
| `DEC-16` | Outbox consumida por worker próprio com `for update skip locked` na Etapa 1; `pg-boss` entra na Etapa 3, quando houver agendamentos | Adotar `pg-boss` já | Adotada na Etapa 1; revista por `DEC-27` (`pg-boss` não adotado) |
| `DEC-17` | Identidade criada pelo adaptador interno do Better Auth com `method: "invitation"`; ids gerados pelo Better Auth; tabelas com prefixo `auth_` | Plugin admin; ids pelo banco | Adotada na Etapa 1 |
| `DEC-18` | Página não encontrada na área autenticada responde HTTP 200 com a tela "Página não encontrada", porque o streaming com estado de carregamento já iniciou a resposta; monitoramento de acesso usa auditoria e logs de aplicação, não códigos HTTP | Validar o id antes do streaming e remover o estado de carregamento do segmento | Adotada na Etapa 1 (terceira verificação, achado 8) |
| `DEC-19` | Parâmetros do escritório (dia e hora de abertura, horizonte, duração máxima de liberação) em `office_settings`, lidos pelas funções SQL e pelo serviço; alteração exige `settings.manage` e é auditada | Constantes de código | Adotada na Etapa 2 |
| `DEC-20` | Capacidade de salas e mesa aberta inferida pelas cadeiras da planta (20, 8, 6, 8) e marcada como inferida; cabines e booths com capacidade provisória | Deixar nulo até validação | Adotada na Etapa 2, sujeita a validação de Facilities |
| `DEC-21` | Anular a sucessora de uma transferência exige decisão explícita: liberar a mesa (antecessora recebe `end_reason = transfer_cancelled`) ou reabrir para o titular anterior (nova atribuição contígua); o trigger deferido rejeita anulação sem uma das duas | Anulação simples | Adotada na Etapa 2 (DIR-036) |
| `DEC-22` | Uma única versão de planta publicada por vez; publicar aposenta a anterior; posições vivem por versão e `resource.id` não muda | Várias versões ativas | Adotada na Etapa 2 (DIR-030) |
| `DEC-23` | Fechar dia do escritório trata reservas só por cancelamento com comunicação, nunca por realocação | Realocação para outro dia | Adotada na Etapa 2 (DIR-033) |
| `DEC-24` | Dentro da semana corrente as reservas estão sempre abertas para datas de hoje em diante; a semana seguinte abre no instante configurado; semanas posteriores permanecem fechadas até a quinta da semana anterior a elas | Horizonte fixo em dias | Adotada na Etapa 2 (PAR-01) |
| `DEC-25` | Inscrição na fila só quando não há mesa disponível para a pessoa na data (além de `PAR-30`); escritório fechado ou janela fechada recusam a inscrição | Fila aberta sempre, como lista de interesse | Adotada na Etapa 3 |
| `DEC-26` | Salas e cabines seguem só o horizonte das mesas, em semanas de segunda a domingo contadas a partir da semana de hoje; a abertura semanal de quinta às 10h não se aplica a elas | Mesma janela das mesas | Adotada na Etapa 3, sujeita a validação de Facilities; cálculo corrigido na revisão independente (T-01) |
| `DEC-27` | Varreduras do escritório (oferta vencida passa à próxima pessoa, mesa livre com fila recebe oferta, liberação de `PAR-06`) rodam no mesmo worker da outbox, a cada minuto; `pg-boss` não foi adotado porque a correção não depende de agendamento (`DIR-034`) | `pg-boss` com job em `expires_at` (`DEC-16`) | Adotada na Etapa 3; revisita `DEC-16` |
| `DEC-28` | Meu time mostra só subordinados diretos ativos (`manager_employee_id`) e só o conteúdo de quem ativou o compartilhamento no próprio perfil (padrão desativado, alteração auditada); títulos de sala seguem a visibilidade da reserva | Visibilidade automática ao gestor | Adotada na Etapa 3 (matriz de permissões, "Equipe do gestor") |
| `DEC-29` | O QR carrega só `/escritorio/qr/<código>`; o servidor resolve a reserva confirmada da sessão naquele recurso e dia; sem sessão, o login devolve à própria rota por lista fechada de retorno | QR com id da reserva ou token | Adotada na Etapa 3 (`CHK-02`) |
| `DEC-30` | Toda transação que libera ou reserva mesa trava `for share` as pessoas em espera na data, antes do recurso; a oferta é gravada em ponto de salvamento por candidata e reivindica a inscrição (`waiting` para `offered`) antes de gravar a retenção; conflito com a candidata (inscrição encerrada ou reserva simultânea) pula para a próxima sem derrubar quem liberou a mesa | Oferta fora da transação, por job | Adotada na Etapa 3 (`DIR-034`, `PAR-37`) |
| `DEC-31` | Reserva direta confere primeiro a elegibilidade de quem reserva; só então, se a mesa estiver livre e houver inscrição anterior à dele na fila (a fila inteira, se ele não está nela), confirma a oferta à fila e responde conflito explícito; a oferta sobrevive à recusa da reserva direta | Reverter a oferta junto com a recusa; oferecer mesmo a quem não poderia reservar | Adotada na Etapa 3 (`PAR-37`), revista na revisão independente (EXC-02, EXC-06) |
| `DEC-32` | Operações da mesma pessoa na mesma data (inscrição, reserva, semana, aceite) serializadas por advisory lock `person_day`, tomado depois das pessoas e antes das pessoas em espera e dos recursos; a inscrição em espera é encerrada antes de gravar a reserva | Travar a pessoa `for update` | Adotada na revisão independente da Etapa 3 (CONC-02, CONC-03) |
| `DEC-33` | O trigger de lock de `waitlist_offer` só age na inserção; mudanças de estado da oferta seguem a retenção e não travam a mesa (migração `0009`) | Travar a mesa em toda atualização | Adotada na revisão independente da Etapa 3 (CONC-04) |
| `DEC-34` | Decisão do diálogo de conflito leva a situação vista na prévia; reserva relida sob lock que deixou de estar ativa não recebe decisão, email nem auditoria; reserva cuja situação mudou (oferta aceita) exige nova prévia | Casar só pelo id | Adotada na revisão independente da Etapa 3 (EXC-04, CONC-05) |
| `DEC-35` | Retirada de oferta por decisão administrativa (diálogo de conflito ou aba Mesas) mantém a pessoa na fila na mesma posição, com aviso; recusa pela própria pessoa encerra a inscrição; retirada da fila pela administração avisa com o motivo; fechamento de dia encerra as inscrições da data com aviso | Tratar retenção como reserva comum | Adotada na revisão independente da Etapa 3 (EXC-05, EXC-08, AUT-05) |
| `DEC-36` | Oferta manual só de mesa compartilhada na data, com resposta única; mesa compartilhada reservável que ainda assim não gera oferta recebe resposta neutra, sem motivo; a aba Fila mostra o código da mesa ofertada só a quem tem `exclusive.holder.view` ou `booking.admin.manage` (que já vê as reservas com nome na aba Mesas) e, aos demais, "oferta aberta"; o nome de quem reservou sala aparece só para a própria pessoa e a administração | Mensagem da regra de disponibilidade | Adotada na revisão independente da Etapa 3 (AUT-02, AUT-04); revista na segunda rodada (RP-05, AUT-04 parcial) |
| `DEC-37` | Consentimento do Meu time guarda o gestor para quem foi dado; qualquer troca de gestor (inclusive a volta ao anterior, por edição ou importação), desativação e readmissão zeram a autorização, pelo trigger `employee_manager_changed`; sem gestor direto, a ativação é recusada | Booleano sem gestor | Adotada na revisão independente da Etapa 3 (AUT-03); completada na segunda rodada (RP-07) |
| `DEC-38` | Titular de mesa individual, sem liberação vigente e fora de revisão, com a mesa livre para si na data não consome mesa compartilhada da fila: a inscrição é encerrada com aviso; a varredura oferece primeiro a mesa própria. Integrante de grupo e titular com a mesa liberada seguem na fila como qualquer pessoa, porque outra pessoa pode tomar a mesa | Tratar o titular como qualquer pessoa | Adotada na revisão independente da Etapa 3 (EXC-03); restrita na segunda rodada (RP-01) |
| `DEC-40` | Retenção da fila aparece à pessoa como oferta ("Oferecida a você"), nunca como reserva, no início, no mapa, na lista e no detalhe | Tratar como reserva | Adotada na revisão independente da Etapa 3 (INT-03) |
| `DEC-41` | Inscrições em espera de datas passadas são encerradas pela varredura como vencidas; fechar o dia de hoje ignora reservas de sala já encerradas (migração `0011`) | Deixar a limpeza manual | Adotada na revisão independente da Etapa 3 (T-02, T-09) |
| `DEC-42` | Oferta retirada pela administração tem estado próprio (`withdrawn`): a retenção é cancelada, a pessoa volta à fila na mesma posição e aquela mesa não volta a ser oferecida a ela na mesma data, nem pela varredura. Retenção já vencida não é retirada: expira com a inscrição, como qualquer oferta vencida | Registrar como vencida e deixar a varredura devolver a mesa | Adotada na segunda revisão independente da Etapa 3 (RP-03, RP-04) |
| `DEC-43` | Rede da reserva de mesa pelo banco (migração `0015`): pessoa, mesa, data, origem, autor e chave de idempotência de uma reserva são imutáveis; reserva cancelada ou vencida não reabre; confirmada só é cancelada; retenção com oferta aberta acompanha o prazo da oferta. Desativações de cadastro são serializadas entre si por lock consultivo antes de qualquer outro lock; a desativação trava, no passo de recursos, também as mesas das ofertas abertas da pessoa, inclusive vencidas e não varridas | Confiar só no código | Adotada na segunda revisão independente da Etapa 3 (CB-01 a CB-03, BDT-04 e CONC-04 parciais) |
| `DEC-44` | Decisão de conflito vinda da tela exige a situação da reserva vista na prévia; sem ela, a operação é recusada como prévia desatualizada. Reserva direta ou semana que perde a inscrição para uma oferta concorrente responde "uma mesa acabou de ser oferecida a você", não o erro genérico de unicidade. Pelo QR de sala, só a reserva em andamento ou que começa em até 15 minutos é confirmada, e a segunda leitura responde "já confirmada". Fechar o dia envia um único aviso por inscrição e registra quem fechou | Aceitar decisão sem situação; mensagens genéricas | Adotada na segunda revisão independente da Etapa 3 (CB-04, CB-05, RP-06, RP-08) |
| `DEC-39` | Mudanças de política que cancelam reservas pelo diálogo (grupo, liberação, transferência) não oferecem a mesa à fila na mesma transação; a varredura do worker oferece em até um minuto e a reserva direta respeita a ordem da fila (`DEC-31`) | Travar candidatas em todos os fluxos de exclusividade | Adotada na revisão independente da Etapa 3 (EXC-07) |

## D. Perguntas bloqueantes

A Etapa 0 e a stack foram validadas pelo responsável em 28/09/2026 ("Pode seguir em frente"). Os parâmetros da seção B seguem adotados provisoriamente com os valores propostos até validação individual. As demais pendências bloqueiam marcos posteriores e serão perguntadas quando o marco se aproximar.

| Pergunta | Bloqueia | Necessária até |
|---|---|---|
| Aprovação da Etapa 0 e da stack proposta | Etapa 1 | Recebida em 28/09/2026 |
| Domínio de email corporativo dos colaboradores e provedor de email (Microsoft 365, Google Workspace ou outro) | Envio de convites reais e decisão sobre SSO e calendário | Fim da Etapa 1 |
| Nome e email do primeiro administrador | Bootstrap em homologação | Fim da Etapa 1 |
| Upload do resultado da pesquisa | Painel com dados históricos | Etapa 4 |
| Validação da planta (84 ou 90 mesas, códigos, capacidades, atributos, quais cabines entram nas reservas) | Mapa definitivo | Aceite da Etapa 2 |
| Hospedagem, região e banco gerenciado | Homologação e produção | Etapa 5 |
| Fonte oficial de calendário corporativo (Outlook, Google ou nenhuma) para salas | Integração de calendário da Etapa 3 (`RSK-06`) | Não iniciada sem a fonte |
| Expediente para contar horas úteis (`PAR-43`) e prazo da oferta (`PAR-05`) | Piloto da fila | Etapa 5 |
| Composição do grupo "diretoria" e política de visibilidade do titular | Mesas exclusivas de grupo em homologação | Etapa 2 |

## E. Histórico de decisões

| Data | Decisão | Autor |
|---|---|---|
| 28/09/2026 | Etapa 0 entregue como documentação no repositório, sem código, para validação antes de implementar | Executor |
| 28/09/2026 | Inventário sintético com prefixo `DEMO` até a planta oficial | Executor |
| 28/09/2026 | Revisão independente 1 (cobertura de requisitos): aceito com correções, 24 achados, 12 obrigatórios; todos aplicados na mesma data | Executor |
| 28/09/2026 | Revisão independente 2 (adversarial técnica): aceito com correções, 30 achados, 1 bloqueante e 9 de alta severidade; todos incorporados ao modelo de dados, à política DIR, à arquitetura e à matriz de permissões na mesma data; itens 1, 3, 4, 6 e 9 reapresentados para nova revisão | Executor |
| 28/09/2026 | Reapresentação dos itens críticos a terceiro revisor: aprovado com ajustes, cinco grupos verificados em banco e no código do Better Auth; todos incorporados na mesma data | Executor |
| 28/09/2026 | Etapa 0 e stack validadas pelo responsável; parâmetros propostos adotados provisoriamente; Etapa 1 iniciada | Responsável e Executor |
| 29/09/2026 | Etapa 1: fundação implementada (projeto, banco, autenticação, acesso, colaboradores, CPF, auditoria, outbox, telas) com testes de unidade, integração e ponta a ponta; decisões `DEC-15` a `DEC-17`, parâmetros `PAR-38` e `PAR-39` | Executor |
| 29/09/2026 | Revisão independente da Etapa 1: rejeitada com 26 achados; 20 corrigidos na mesma data (autorização de página, troca de email, tokens em claro na outbox, limite anti oráculo, erros de banco, sessão de 12 horas, estados de tela, celular, acessibilidade, testes, documentação); pendências registradas em `RSK-23` a `RSK-25` e `PAR-40` a `PAR-42` | Executor |
| 29/09/2026 | Reapresentação da Etapa 1: aceita com correções pelo segundo Revisor (11 achados); todos corrigidos, entre eles a proteção de alvo privilegiado em toda operação de cadastro e convite, a recusa de endereço tomado entre os dois links da troca de email e o logger do Better Auth redirigido com redação | Executor |
| 29/09/2026 | Terceira verificação da Etapa 1: aceita com correções (8 residuais); proteção de alvo privilegiado passa a considerar concessão com início futuro, entrega esgotada marca o convite como falho, `DEC-18` registrada | Executor |
| 29/09/2026 | Etapa 1 validada pelo responsável ("Pode continuar"). Etapa 2 implementada: banco do escritório (15 tabelas, 7 funções, 20 triggers, constraints de exclusão), serviços de disponibilidade, reserva, exclusividade e escritório, telas do portal e administrativas, testes; decisões `DEC-19` a `DEC-24` | Executor |
| 29/09/2026 | Etapa 2 revisada em três rodadas independentes (15, 7 e 4 achados), todas aceitas com correções; correções aplicadas; `PAR-15` e `PAR-25` revistos; migrações `0005` e `0006` (rede independente do código) | Executor |
| 29/09/2026 | Etapa 2 validada pelo responsável ("Vamos em frente"). Etapa 3 implementada: fila de espera com oferta transacional e varredura, confirmação de uso pelo portal e pelo QR, liberação por falta de confirmação desativada, salas e cabines por intervalo, Meu time com compartilhamento opt-in, painel de reservas e fila, indicadores de demanda; migrações `0007` e `0008`; decisões `DEC-25` a `DEC-31`, parâmetros `PAR-43` a `PAR-45` | Executor |
| 29/09/2026 | Revisão independente da Etapa 3, primeira rodada: aceita com correções (38 achados após deduplicação: 2 altos, 17 médios, 19 baixos); corrigidos com migrações `0009` a `0012` e decisões `DEC-32` a `DEC-41` | Executor |
| 29/09/2026 | Segunda rodada da revisão independente da Etapa 3 (reverificação): correções da primeira rodada conferidas; 13 achados novos e 5 correções parciais tratados com migrações `0013` a `0015` e decisões `DEC-42` a `DEC-44`; `PAR-43`, `DEC-36`, `DEC-37` e `DEC-38` revistas | Executor |
| 28/09/2026 | Planta recebida e extraída; inventário preliminar de 84 mesas, 3 salas, 2 booths, 4 cabines, 1 mesa aberta, marcado como não validado; PDF mantido fora do repositório | Executor |
