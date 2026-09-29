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
| `PAR-05` | Prazo de oferta da fila | 2 horas úteis dentro do calendário do escritório | RH e Facilities | Configurável |
| `PAR-06` | Liberação automática por falta de confirmação de uso | Desativada | RH | Nunca remove exclusividade |
| `PAR-07` | Validade do convite | 7 dias | RH | |
| `PAR-08` | Validade do token de recuperação | 60 minutos | RH e ADM | Padrão da biblioteca |
| `PAR-09` | Sessão | 7 dias com renovação diária; sessões administrativas de 12 horas | ADM | Revogação imediata em eventos críticos |
| `PAR-10` | Argon2id | m = 47104 KiB, t = 1, p = 1 | ADM técnico | Alternativa m = 19456 KiB, t = 2, p = 1 |
| `PAR-11` | Limite de tentativas de login | 5 por 10 minutos por conta e por IP, com resposta neutra | ADM | |
| `PAR-12` | Tamanho máximo de anexo | 10 MB, tipos PDF, PNG, JPG, DOCX, XLSX | Facilities, RH e TI | |
| `PAR-13` | Supressão de resultados de pesquisa | Mínimo 10 respondentes por recorte, mais regra contra diferença entre totais | RH e encarregado | |
| `PAR-14` | Retenção | Ver `../dados/modelo-de-dados.md` | Encarregado e jurídico | |
| `PAR-15` | Visibilidade do nome do titular de mesa exclusiva | RH, ADM autorizado e o próprio titular por padrão; Facilities só por concessão de `exclusive.holder.view` | RH e diretoria | `DIR-008` |
| `PAR-16` | Dupla aprovação para conceder `admin` e `tech_admin` | Exigida | ADM | |
| `PAR-17` | Categorias de atendimento | Infraestrutura, tecnologia, ergonomia, ruído, temperatura, copa, benefícios, assuntos de RH; assuntos de RH com fluxo restrito | RH, Facilities e TI | |
| `PAR-18` | Limites de duração e capacidade de salas e cabines | Nenhum fixado; configuração por recurso | Facilities | |
| `PAR-19` | Redirecionamento de domínio | `www` para o apex | ADM técnico | |
| `PAR-20` | Verificação de senha comprometida por serviço externo com k anonimato | Ativada | Encarregado | Envia cinco caracteres do SHA1 |
| `PAR-21` | Uso do CPF na importação | Obrigatório por linha, com HMAC para duplicidade | RH e encarregado | |
| `PAR-22` | Indicador de copa no painel | Consolidado da página 8 (17%) com nota da divergência | Facilities | `REQ-22` |
| `PAR-23` | Titular de atribuição individual | Somente pessoa ativa com condição organizacional de diretor | RH | Sem exceção prevista |
| `PAR-24` | Máscara do CPF | Apenas os dois últimos dígitos visíveis | RH e encarregado | |
| `PAR-25` | Reservas futuras na desativação | Canceladas com notificação ao gestor e às áreas afetadas | RH | Prompt exige regra explícita, não define qual |
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

## C. Decisões técnicas propostas

| ID | Decisão | Alternativas consideradas | Status |
|---|---|---|---|
| `DEC-01` | Next.js 16 (App Router) com React 19 e TypeScript | Remix, SvelteKit | Proposta |
| `DEC-02` | PostgreSQL 18 (17 se o provedor não oferecer) | MySQL | Proposta |
| `DEC-03` | Drizzle ORM linha estável com migrações SQL explícitas | Prisma 7, Kysely | Proposta |
| `DEC-04` | Better Auth com Argon2id, MFA, admin server side, sem impersonação | Auth.js, Keycloak, Auth0, Clerk | Proposta |
| `DEC-05` | `pg-boss` para outbox e agendamentos | Cron externo, Redis | Proposta |
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
| `DEC-16` | Outbox consumida por worker próprio com `for update skip locked` na Etapa 1; `pg-boss` entra na Etapa 3, quando houver agendamentos | Adotar `pg-boss` já | Adotada na Etapa 1 |
| `DEC-17` | Identidade criada pelo adaptador interno do Better Auth com `method: "invitation"`; ids gerados pelo Better Auth; tabelas com prefixo `auth_` | Plugin admin; ids pelo banco | Adotada na Etapa 1 |
| `DEC-18` | Página não encontrada na área autenticada responde HTTP 200 com a tela "Página não encontrada", porque o streaming com estado de carregamento já iniciou a resposta; monitoramento de acesso usa auditoria e logs de aplicação, não códigos HTTP | Validar o id antes do streaming e remover o estado de carregamento do segmento | Adotada na Etapa 1 (terceira verificação, achado 8) |

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
| 28/09/2026 | Planta recebida e extraída; inventário preliminar de 84 mesas, 3 salas, 2 booths, 4 cabines, 1 mesa aberta, marcado como não validado; PDF mantido fora do repositório | Executor |
