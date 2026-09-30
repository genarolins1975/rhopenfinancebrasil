# Estado do projeto

Atualizado em 29/09/2026 (Etapa 3). Branch de trabalho: `claude/new-session-0rzo0n`.

## Situação encontrada em 28/09/2026

* Repositório `genarolins1975/rhopenfinancebrasil`: sem commits, sem branches remotas, sem arquivos. Não havia alterações a preservar.
* Documento recebido: Prompt Master v2 (`Prompt_Claude_RH_Open_Finance_Brasil_v2.md`, 40.172 bytes, enviado em 28/09/2026).
* Planta `571-4CP-100-OPENFINANCE-LAYOUT-R00.pdf`: recebida em 28/09/2026 após a primeira entrega, lida e extraída. Leitura e inventário preliminar em `fontes/planta-oficial.md`; o PDF não é versionado no repositório.
* Documento ausente: `Resultado NPS.pdf`. Não estava nos uploads da sessão e não foi localizado no Google Drive conectado (busca por título em 28/09/2026). Tudo o que este repositório afirma sobre a pesquisa vem exclusivamente do texto do prompt. Ver `fontes/base-documental.md`.
* Ambiente de execução desta sessão: Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (servidor instalado e parado, cluster `16/main`), Docker cliente 29.3.1 sem daemon ativo, Playwright com Chromium instalado, 4 vCPU, 15 GB RAM.

## Etapa 0 (definição)

Status: entregue pelo Executor em 28/09/2026. Duas revisões independentes concluídas na mesma data, ambas com veredito "aceito com correções"; os 54 achados foram aplicados. Reapresentação dos cinco itens críticos a um terceiro revisor: aprovado com ajustes, verificados em banco e no código do Better Auth; ajustes aplicados. Registro completo em `testes/aceite.md`. Validada pelo responsável em 28/09/2026.

Entregue: toda a documentação listada em `docs/README.md` e o `CLAUDE.md` com invariantes.

Não entregue nesta etapa, por desenho: código de aplicação, planta digital, dados de demonstração, contratação de serviços.

## Testes executados na Etapa 0

Não há código, portanto não há testes de software. Verificações realizadas:

* Versões de pacotes consultadas no registro npm em 28/09/2026 (tabela em `arquitetura/arquitetura.md`).
* Documentação oficial consultada em 28/09/2026: cronograma de releases do Node.js, política de versões do PostgreSQL, instalação do Next.js, opções e plugins do Better Auth, cheat sheet OWASP de armazenamento de senhas, páginas de preços de Vercel, Neon, Railway e Supabase.
* Revisão independente 1 (cobertura de requisitos), revisão independente 2 (adversarial técnica, com cenários SQL executados pelo revisor no PostgreSQL 16 local) e reapresentação a terceiro revisor (cenários concorrentes com duas sessões e leitura do código de `better-auth@1.7.6`), todas concluídas em 28/09/2026; registro em `testes/aceite.md`.

## Pendências e o que cada uma bloqueia

| Pendência | Bloqueia | Não bloqueia |
|---|---|---|
| Validação da planta por Facilities e RH (84 ou 90 mesas, códigos, capacidades, atributos) | Mapa definitivo e publicação do inventário (Etapa 2, aceite final) | Motor de reservas, mesas exclusivas e testes de concorrência, que usam o inventário preliminar marcado como não validado |
| Domínio de email corporativo e provedor de envio | Envio de convites reais em homologação | Fluxo de convite implementado e testado com envio simulado |
| Hospedagem, região e banco gerenciado | Homologação e produção (Etapa 5) | Etapas 1 a 4 em ambiente local |
| Primeiro administrador (nome e email corporativo) | Bootstrap em homologação | Procedimento `pnpm bootstrap:admin` implementado |
| Manual de marca | Ajuste fino da identidade visual | Tokens provisórios em azul petróleo e amarelo |

Registro completo em `decisoes/registro-de-decisoes.md`.

## Etapa 1 (fundação)

Status: implementada pelo Executor entre 28/09/2026 e 29/09/2026; rejeitada pelo primeiro Revisor com 26 achados; reapresentada e aceita com correções pelo segundo Revisor (11 achados) e pelo terceiro (8 achados residuais); todas as correções aplicadas e testadas em 29/09/2026, as da última rodada sem nova rodada independente. Validada pelo responsável em 29/09/2026 ("Pode continuar"). Registro completo em `testes/aceite.md`. Escopo e aceite em `operacao/plano-de-entregas.md`; registro em `testes/aceite.md`.

Entregue em código:

* Projeto Next.js 16 com tokens de design, primitivas acessíveis, layouts público, do portal e administrativo, e proxy de verificação otimista de sessão.
* Banco: esquema Drizzle, duas migrações SQL (tabelas, `citext`, `btree_gist`, `local_today()`, `local_day_range()`, papel `rh_app` sem `UPDATE` e `DELETE` em auditoria, seed de perfis e permissões), `timezone` por papel.
* Identidade: Better Auth sem plugin admin, handler HTTP restrito ao verificador de email (link final da troca de email exige sessão e não emite sessão; cadastro sincronizado com auditoria), Argon2id (m = 47104, t = 1, p = 1), convite individual de uso único com hash, recuperação com link para a página do portal, troca de email confirmada no endereço antigo, segundo fator TOTP com códigos de recuperação e `trustDevice` neutralizado, hooks negando pessoa inativa no login, na recuperação e em toda rota, limitador por IP em banco e por conta, sessão de 12 horas para privilegiados em todo o portal.
* Acesso: catálogo de permissões e perfis, `loadAccess` lendo sempre o banco, perfil Colaborador implícito, privilégio só com segundo fator (`PAR-33`), concessões com vigência, motivo e auditoria, separação de atribuições, permissão direta só por quem tem `role.assign.privileged`, autorização por página e por action.
* Colaboradores: cadastro, edição com histórico organizacional, convites, suspensão, desativação, readmissão, CPF cifrado (AES GCM, nonce, AAD, versão de chave) com HMAC de duplicidade e sufixo para máscara, revelação auditada, importação CSV com prévia cifrada, limite por pessoa e hora, descarte só pelo dono e aplicação atômica; erros de banco traduzidos sem vazar parâmetros ao log.
* Auditoria somente de inserção; outbox com worker `skip locked`, carga apagada após a entrega e status `blocked` por lista de destinatários; convite marcado como enviado só após envio real; bootstrap do primeiro administrador por linha de comando com lock transacional e `--force` recusado fora de desenvolvimento e teste.
* Telas: entrada, login, segundo fator, convite, recuperação, redefinição, privacidade, início, perfil, segurança, visão geral administrativa, colaboradores (lista, cadastro, detalhe com diálogos de confirmação, edição, importação), acessos e auditoria; páginas de erro, não encontrado, carregamento e aviso de conexão perdida; cabeçalhos de segurança básicos.

Testes executados em 29/09/2026 após as correções das três rodadas de revisão no ambiente desta sessão (PostgreSQL 16 local, Chromium pré-instalado):

| Bateria | Comando | Resultado |
|---|---|---|
| Unidade | `pnpm test:unit` | 17 testes, 17 aprovados |
| Integração com banco | `pnpm test:integration` | 53 testes, 53 aprovados |
| Ponta a ponta com axe (desktop e celular) | `pnpm build && pnpm test:e2e` | 30 testes, 30 aprovados |
| Tipos, lint e build | `pnpm typecheck && pnpm lint && pnpm build` | sem erros |

Fora da Etapa 1, por desenho ou pendência: verificação manual com leitor de tela (`A11Y-02`), rotação automatizada de chaves (`CPF-04-T2`), reenfileiramento de revogação falha (`AUT-14-T2`), backoff progressivo e limite de reenvio (`RSK-24`), CSP com nonce (`RSK-25`), token de recuperação em claro por 60 minutos no Better Auth (`RSK-23`), provedor real de email, hospedagem.

## Etapa 2 (núcleo do escritório)

Status: implementada pelo Executor em 29/09/2026; aceita com correções pelo primeiro Revisor (15 achados), pelo segundo (7 residuais) e pelo terceiro (4 residuais); todas as correções aplicadas e testadas na mesma data, as da última rodada verificadas pelas baterias do Executor em três execuções consecutivas, sem quarta rodada independente. Validada pelo responsável em 29/09/2026 ("Vamos em frente"). Registro completo em `testes/aceite.md`.

Entregue em código:

* Banco: migrações `0005` e `0006` (rede independente do código: `DELETE` revogado do papel da aplicação nas tabelas do escritório e do inventário; identidade de atribuição e de liberação imutável após a criação); migração `0003` (gerada: planta, zonas, recursos, períodos operacionais, calendário, configurações, grupo e integrantes, atribuições exclusivas, exceções, reservas de mesa e de espaço, intenção e requisição de semana) e migração `0004` (manual: constraints de exclusão, `is_eligible`, `is_bookable`, `booking_remains_valid`, `desk_class`, `booking_window_open`, `transfer_assignment`, triggers de lock por recurso, dia, pessoa e grupo, trigger de vigência da atribuição, validação de exceção, verificações deferidas no commit, grants, grupo `diretoria` e parâmetros iniciais).
* Disponibilidade: regra pura com a ordem fixa de `DIR-019` e a elegibilidade literal de `DIR-031`, testada contra as funções SQL; carregadores por data para mapa, lista, detalhe, semana e escrita; capacidade por classe sem dupla contagem (`DIR-026`).
* Reservas: reserva própria e em nome (`DIR-011`), cancelamento próprio e administrativo com comunicação, semana atômica e idempotente por chave de requisição (`BKG-02`), expiração preguiçosa de retenções (`DIR-034`), protocolo transacional com ordem de locks documentada (dias, pessoas e grupos, recursos em ordem crescente; o ator também é travado antes dos recursos), `lock_timeout`, novas tentativas e tradução de erro do banco em resposta de conflito; R9 prova ausência de deadlock em sete combinações de conflito, medida pelo contador do banco; combinações não cobertas ficam protegidas pela nova tentativa.
* Exclusividade: travar, agendar, transferir, encerrar, anular (com decisão sobre sucessora), liberar temporariamente ao compartilhado ou a pessoa, revogar liberação, grupo com vigência, revisão de vínculo, lote atômico, prévia de impacto com diálogo de conflito (cancelar com comunicação ou realocar validando a mesa de destino), auditoria e notificação por outbox (`DIR-028`), histórico por mesa, painel de conflitos por consulta dinâmica.
* Escritório: inventário e atributos verificados, manutenção e bloqueio com diálogo de conflito, liberação de período, calendário com fechamento de dia, parâmetros auditados, versões da planta (rascunho a partir da extração, aprovação, publicação única) e mapa SVG acessível gerado das posições publicadas.
* Desativação de pessoa cancela reservas futuras com comunicação e marca vínculos exclusivos para revisão (`DIR-018`, `PAR-25`); suspensão mantém reservas.
* Telas: escritório (mapa e lista com filtros e data), detalhe da mesa, minhas reservas, planejar a semana, início com semana, mesa habitual e próximas reservas; administrativas: recursos (inventário, períodos, calendário, configurações), planta, exclusividade da diretoria (abas Mesas, Grupo, Conflitos, Histórico; filtros; painel da mesa; lote) e reservas (em nome e cancelamento administrativo). Visão geral com capacidade do dia.

Testes executados em 29/09/2026 no ambiente desta sessão:

| Bateria | Comando | Resultado |
|---|---|---|
| Unidade | `pnpm test:unit` | 53 testes, 53 aprovados |
| Integração com banco | `pnpm test:integration` | 136 testes, 136 aprovados em três execuções consecutivas, sem deadlock nem nova tentativa |
| Ponta a ponta com axe (desktop e celular) | `pnpm build && pnpm test:e2e` | 44 testes, 44 aprovados, nenhum pulado |
| Tipos, lint e build | `pnpm typecheck && pnpm lint && pnpm build` | sem erros |

Fora da Etapa 2, por desenho ou pendência: fila de espera e ofertas (`DIR-025-T1`, `DIR-034-T2`, Etapa 3), confirmação de uso (`DIR-006-T2`, Etapa 3), salas e cabines por intervalo (Etapa 3), `DIR-030-T1`, validação do inventário por Facilities e RH (`RSK-26`), leitor de tela manual.

## Etapa 3 (operação)

Status: implementada pelo Executor em 29/09/2026. Primeira rodada de revisão independente em seis lentes, com reprodução e refutação por achado: aceita com correções (38 achados após deduplicação: 2 altos, 17 médios, 19 baixos). Segunda rodada, de reverificação, em três lentes: 40 correções confirmadas, 10 parciais, 1 mantida por decisão (`DEC-39`) e 20 achados novos distintos. Terceira rodada, sobre o código final, em três lentes: aceita com correções; 30 dos 33 itens da segunda rodada corrigidos por completo e 3 em parte; 15 achados novos distintos (2 altos, 13 baixos). Todas as correções das três rodadas aplicadas e testadas na mesma data; cada achado de código das rodadas 2 e 3 tem teste que falha no código anterior à correção. Registro completo em `testes/aceite.md`. Aguarda validação do responsável.

Entregue em código:

* Banco: migrações `0007` (gerada: inscrição e oferta da fila, confirmação de uso, preferência de compartilhamento), `0008` (manual: lock, consistência e identidade da oferta e da inscrição, confirmação de uso só da própria reserva do dia e imutável, `DELETE` revogado, parâmetros novos), `0009` (lock da oferta só na inserção), `0010` (gerada: gestor do consentimento), `0011` (fechar o dia ignora sala encerrada), `0012` (rede da fila: ordem de entrada congelada, coerência entre oferta, retenção e inscrição no commit, retenção só vira reserva com oferta aceita, confirmação datada pelo banco), `0013` e `0014` (oferta retirada pela administração, `DEC-42`) e `0015` (rede da reserva de mesa: identidade imutável, reserva encerrada não reabre, retenção no prazo da oferta; autorização do Meu time zerada em qualquer troca de gestor; mesa em revisão conta como exclusiva; `DEC-43`) e `0016` (prazo da oferta limitado ao dia e nunca estendido; encerramento da reserva congelado).
* Fila de espera: inscrição só sem mesa disponível e sem reserva na data (`PAR-30`, `DEC-25`); oferta transacional na liberação da mesa, com retenção e prazo de 120 minutos úteis limitado ao dia (`PAR-05`, `PAR-43`), aceite, recusa, saída, oferta manual só de mesa compartilhada, retirada administrativa com aviso e sem devolver a mesma mesa à mesma inscrição (`DEC-42`), varredura do worker (ofertas vencidas, mesas livres, inscrições de datas passadas); prioridade da fila sobre a reserva direta respeitando a ordem de entrada (`PAR-37`, `DEC-31`); mesa exclusiva nunca oferecida a inelegível (`DIR-025`, `DIR-007`); lock `person_day`, desativações serializadas e ordem de locks documentada (`DEC-30`, `DEC-32`, `DEC-33`, `DEC-43`).
* Confirmação de uso pelo portal e pelo QR do recurso (a reserva é resolvida pela sessão; login com retorno à rota do QR por lista fechada; em sala, só a reserva do dia em andamento ou que começa em até 15 minutos); liberação por falta de confirmação desativada, e, quando ativada, só de mesa compartilhada confirmada antes do limite e de quem não declarou uso no dia (`PAR-06`, `PAR-44`).
* Salas e cabines por intervalo de 15 minutos até 24:00, no horizonte das mesas, com limite por recurso, título privado por padrão, nome de quem reservou só para a própria pessoa e a administração, conflitos de manutenção, bloqueio, desativação e fechamento de dia no diálogo (só cancelamento).
* Meu time com consentimento da própria pessoa, preso ao gestor da época e zerado em qualquer troca de gestor; sem gestor, a ativação é recusada (`DEC-28`, `DEC-37`).
* Telas: fila no mapa, ofertas e confirmação em Minhas reservas, oferta pendente no Início, QR, salas, Meu time, preferência no perfil; administrativas: abas Mesas, Fila (posição, oferta manual, retirada, demanda não atendida) e Salas em Reservas e fila, indicadores de fila na visão geral, parâmetros novos, QR e atributos de sala no painel do recurso.

Testes executados em 29/09/2026 no ambiente desta sessão, sobre o código final (correções da terceira rodada):

| Bateria | Comando | Resultado |
|---|---|---|
| Unidade | `pnpm test:unit` | 72 testes, 72 aprovados |
| Integração com banco | `pnpm test:integration` | 225 testes, 225 aprovados em três execuções consecutivas; contador de deadlocks do banco inalterado e nenhuma "nova tentativa", "Failed query" ou "params" no log |
| Ponta a ponta com axe (desktop e celular) | `pnpm build && pnpm test:e2e` | 54 testes (27 por projeto), 54 aprovados, nenhum pulado |
| Tipos, lint e build | `pnpm typecheck && pnpm lint && pnpm build` | sem erros |

Fora da Etapa 3, por desenho ou pendência: integração de calendário corporativo (fonte oficial não confirmada, `RSK-31`); validação do expediente e do prazo da oferta (`PAR-43`, `RSK-29`); ofertas imediatas nas mudanças de política de exclusividade, cobertas pela varredura (`DEC-39`); leitor de tela manual.

## Demonstração do conceito (`DEC-45`)

Preparação pronta no repositório para publicar a demonstração em rhopenfinancebrasil.com na Vercel Pro com Neon, com dados fictícios, email desligado e faixa de demonstração; revisão independente com 16 achados, todos tratados (`testes/aceite.md`). Roteiro em `operacao/demo-vercel.md`. Publicação autorizada pelo responsável em 29/09/2026 (`DEC-45`). **No ar desde 30/09/2026 no endereço provisório https://rhopenfinancebrasil.vercel.app**, a partir da branch `demo` (merge do pull request 5 feito pelo responsável), com banco no Neon (PostgreSQL 16, São Paulo, plano Free). Conferido de fora em 30/09/2026: `/entrar` 200 com a faixa de demonstração; área interna redireciona para `/entrar`; rota agendada 401 sem segredo; handler de autenticação 404; HSTS; `noindex, nofollow`. Ensaio local do mesmo build com a consulta de senhas vazadas ligada: 5 contas e 48 reservas criadas; login da colaboradora e da administração por endereço diferente do `APP_BASE_URL`. Achados da execução do roteiro: `DV-17` a `DV-21`, todos corrigidos; `DV-21` era defeito do produto (aceite de convite com a consulta de vazamento ligada). Pendentes: domínio rhopenfinancebrasil.com (alteração de DNS aguarda confirmação expressa); remoção de `DEMO_ADMIN_PASSWORD`, `DEMO_PASSWORD` e `DATABASE_OWNER_URL` da Vercel e da tabela `_senhas_demo` no Neon; troca da senha da administração, que circulou na conversa; deploy de prévia da branch de trabalho criado pela Vercel apesar do bloqueio em `vercel.json` (falha sem tocar o banco, por não ter variáveis; a investigar).

## Próximo passo

Validação da Etapa 3 pelo responsável. Depois dela, Etapa 4 conforme `operacao/plano-de-entregas.md`.
