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
| `REQ-16` | Pesquisas identificadas e confidenciais; "anônima" só após demonstração técnica; supressão abaixo de dez respondentes como parâmetro inicial; sem entrega de respostas individuais a gestores por padrão | Prompt §17 |
| `REQ-17` | Indicadores sem dupla contagem; toda taxa com numerador, denominador, período, fonte e limitações; sem ranking de funcionários | Prompt §19 |
| `REQ-18` | Notificações via outbox após commit, idempotentes, com visibilidade de falhas | Prompt §20 |
| `REQ-19` | Sem DNS, produção, envio em massa, contratação ou migração destrutiva sem autorização explícita | Prompt §22 |
| `REQ-20` | Testes de concorrência com sessões distintas; os 15 casos da tabela de aceite bloqueiam a entrega se falharem | Prompt §23 |
| `REQ-21` | Nenhuma planta fictícia tratada como definitiva; mapa definitivo só após aprovação de Facilities e RH | Prompt §9 e §24 |
| `REQ-22` | Integridade dos dados da pesquisa: metodologia preservada, sem NPS, divergência de copa exibida com origem | Prompt §2 |

## B. Parâmetros propostos (pendentes de validação)

| ID | Parâmetro | Valor proposto | Quem valida | Observação |
|---|---|---|---|---|
| `PAR-01` | Abertura de reservas | Quinta às 10h para a semana seguinte | RH e Facilities | Configurável em `office_settings` |
| `PAR-02` | Unidade de reserva de mesa | Dia inteiro | RH | |
| `PAR-03` | Limite de reservas de mesa por pessoa e dia | Uma, inclusive para diretor | RH | `DIR-012` |
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
| `PAR-15` | Visibilidade do nome do titular de mesa exclusiva | Somente RH, ADM e o próprio titular | RH e diretoria | `DIR-008` |
| `PAR-16` | Dupla aprovação para conceder `admin` e `tech_admin` | Exigida | ADM | |
| `PAR-17` | Categorias de atendimento | Infraestrutura, tecnologia, ergonomia, ruído, temperatura, copa, benefícios, assuntos de RH; assuntos de RH com fluxo restrito | RH, Facilities e TI | |
| `PAR-18` | Limites de duração e capacidade de salas e cabines | Nenhum fixado; configuração por recurso | Facilities | |
| `PAR-19` | Redirecionamento de domínio | `www` para o apex | ADM técnico | |
| `PAR-20` | Verificação de senha comprometida por serviço externo com k anonimato | Ativada | Encarregado | Envia cinco caracteres do SHA1 |
| `PAR-21` | Uso do CPF na importação | Obrigatório por linha, com HMAC para duplicidade | RH e encarregado | |
| `PAR-22` | Indicador de copa no painel | Consolidado da página 8 (17%) com nota da divergência | Facilities | `REQ-22` |

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

## D. Perguntas bloqueantes

Nenhuma pergunta bloqueia o início da Etapa 1. As pendências abaixo bloqueiam marcos específicos e serão perguntadas quando o marco se aproximar.

| Pergunta | Bloqueia | Necessária até |
|---|---|---|
| Aprovação da Etapa 0 e da stack proposta | Etapa 1 | Agora |
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
| 28/09/2026 | Planta recebida e extraída; inventário preliminar de 84 mesas, 3 salas, 2 booths, 4 cabines, 1 mesa aberta, marcado como não validado; PDF mantido fora do repositório | Executor |
