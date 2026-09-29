# Estado do projeto

Atualizado em 29/09/2026. Branch de trabalho: `claude/new-session-0rzo0n`.

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

Status: implementada pelo Executor entre 28/09/2026 e 29/09/2026; rejeitada pelo primeiro Revisor com 26 achados; reapresentada e aceita com correções pelo segundo Revisor (11 achados, 5 obrigatórios), todos corrigidos na mesma data; terceira verificação em andamento. Registro completo em `testes/aceite.md`. Escopo e aceite em `operacao/plano-de-entregas.md`; registro em `testes/aceite.md`.

Entregue em código:

* Projeto Next.js 16 com tokens de design, primitivas acessíveis, layouts público, do portal e administrativo, e proxy de verificação otimista de sessão.
* Banco: esquema Drizzle, duas migrações SQL (tabelas, `citext`, `btree_gist`, `local_today()`, `local_day_range()`, papel `rh_app` sem `UPDATE` e `DELETE` em auditoria, seed de perfis e permissões), `timezone` por papel.
* Identidade: Better Auth sem plugin admin, handler HTTP restrito ao verificador de email (link final da troca de email exige sessão e não emite sessão; cadastro sincronizado com auditoria), Argon2id (m = 47104, t = 1, p = 1), convite individual de uso único com hash, recuperação com link para a página do portal, troca de email confirmada no endereço antigo, segundo fator TOTP com códigos de recuperação e `trustDevice` neutralizado, hooks negando pessoa inativa no login, na recuperação e em toda rota, limitador por IP em banco e por conta, sessão de 12 horas para privilegiados em todo o portal.
* Acesso: catálogo de permissões e perfis, `loadAccess` lendo sempre o banco, perfil Colaborador implícito, privilégio só com segundo fator (`PAR-33`), concessões com vigência, motivo e auditoria, separação de atribuições, permissão direta só por quem tem `role.assign.privileged`, autorização por página e por action.
* Colaboradores: cadastro, edição com histórico organizacional, convites, suspensão, desativação, readmissão, CPF cifrado (AES GCM, nonce, AAD, versão de chave) com HMAC de duplicidade e sufixo para máscara, revelação auditada, importação CSV com prévia cifrada, limite por pessoa e hora, descarte só pelo dono e aplicação atômica; erros de banco traduzidos sem vazar parâmetros ao log.
* Auditoria somente de inserção; outbox com worker `skip locked`, carga apagada após a entrega e status `blocked` por lista de destinatários; convite marcado como enviado só após envio real; bootstrap do primeiro administrador por linha de comando com lock transacional e `--force` recusado fora de desenvolvimento e teste.
* Telas: entrada, login, segundo fator, convite, recuperação, redefinição, privacidade, início, perfil, segurança, visão geral administrativa, colaboradores (lista, cadastro, detalhe com diálogos de confirmação, edição, importação), acessos e auditoria; páginas de erro, não encontrado, carregamento e aviso de conexão perdida; cabeçalhos de segurança básicos.

Testes executados em 29/09/2026 após as correções das duas revisões no ambiente desta sessão (PostgreSQL 16 local, Chromium pré-instalado):

| Bateria | Comando | Resultado |
|---|---|---|
| Unidade | `pnpm test:unit` | 17 testes, 17 aprovados |
| Integração com banco | `pnpm test:integration` | 50 testes, 50 aprovados |
| Ponta a ponta com axe (desktop e celular) | `pnpm build && pnpm test:e2e` | 30 testes, 30 aprovados |
| Tipos, lint e build | `pnpm typecheck && pnpm lint && pnpm build` | sem erros |

Fora da Etapa 1, por desenho ou pendência: verificação manual com leitor de tela (`A11Y-02`), rotação automatizada de chaves (`CPF-04-T2`), reenfileiramento de revogação falha (`AUT-14-T2`), backoff progressivo e limite de reenvio (`RSK-24`), CSP com nonce (`RSK-25`), token de recuperação em claro por 60 minutos no Better Auth (`RSK-23`), provedor real de email, hospedagem.

## Próximo passo

Resultado da terceira verificação, aceite do responsável; depois Etapa 2 (núcleo do escritório).
