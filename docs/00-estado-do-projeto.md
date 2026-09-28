# Estado do projeto

Atualizado em 28/09/2026. Branch de trabalho: `claude/new-session-0rzo0n`.

## Situação encontrada em 28/09/2026

* Repositório `genarolins1975/rhopenfinancebrasil`: sem commits, sem branches remotas, sem arquivos. Não havia alterações a preservar.
* Documento recebido: Prompt Master v2 (`Prompt_Claude_RH_Open_Finance_Brasil_v2.md`, 40.172 bytes, enviado em 28/09/2026).
* Planta `571-4CP-100-OPENFINANCE-LAYOUT-R00.pdf`: recebida em 28/09/2026 após a primeira entrega, lida e extraída. Leitura e inventário preliminar em `fontes/planta-oficial.md`; o PDF não é versionado no repositório.
* Documento ausente: `Resultado NPS.pdf`. Não estava nos uploads da sessão e não foi localizado no Google Drive conectado (busca por título em 28/09/2026). Tudo o que este repositório afirma sobre a pesquisa vem exclusivamente do texto do prompt. Ver `fontes/base-documental.md`.
* Ambiente de execução desta sessão: Node 22.22.2, pnpm 10.33.0, PostgreSQL 16.13 (servidor instalado e parado, cluster `16/main`), Docker cliente 29.3.1 sem daemon ativo, Playwright com Chromium instalado, 4 vCPU, 15 GB RAM.

## Etapa 0 (definição)

Status: entregue pelo Executor em 28/09/2026. Duas revisões independentes concluídas na mesma data, ambas com veredito "aceito com correções"; os 54 achados foram aplicados. Reapresentação dos cinco itens críticos do modelo transacional e da fronteira de autenticação em curso. Registro em `testes/aceite.md`. Aguarda validação do responsável.

Entregue: toda a documentação listada em `docs/README.md` e o `CLAUDE.md` com invariantes.

Não entregue nesta etapa, por desenho: código de aplicação, planta digital, dados de demonstração, contratação de serviços.

## Testes executados na Etapa 0

Não há código, portanto não há testes de software. Verificações realizadas:

* Versões de pacotes consultadas no registro npm em 28/09/2026 (tabela em `arquitetura/arquitetura.md`).
* Documentação oficial consultada em 28/09/2026: cronograma de releases do Node.js, política de versões do PostgreSQL, instalação do Next.js, opções e plugins do Better Auth, cheat sheet OWASP de armazenamento de senhas, páginas de preços de Vercel, Neon, Railway e Supabase.
* Revisão independente 1 (cobertura de requisitos) e revisão independente 2 (adversarial técnica, com cenários SQL executados pelo revisor no PostgreSQL 16 local), ambas concluídas em 28/09/2026; registro em `testes/aceite.md`.

## Pendências e o que cada uma bloqueia

| Pendência | Bloqueia | Não bloqueia |
|---|---|---|
| Validação da Etapa 0 pelo responsável | Início da Etapa 1 | |
| Validação da planta por Facilities e RH (84 ou 90 mesas, códigos, capacidades, atributos) | Mapa definitivo e publicação do inventário (Etapa 2, aceite final) | Motor de reservas, mesas exclusivas e testes de concorrência, que usam o inventário preliminar marcado como não validado |
| Domínio de email corporativo e provedor de envio | Envio de convites reais (Etapa 1, homologação) | Desenvolvimento do fluxo de convite com envio simulado |
| Hospedagem, região e banco gerenciado | Homologação e produção (Etapa 5) | Etapas 1 a 4 em ambiente local |
| Primeiro administrador (nome e email corporativo) | Bootstrap em homologação | Desenvolvimento |
| Manual de marca | Ajuste fino da identidade visual | Tokens provisórios em azul petróleo e amarelo |

Registro completo em `decisoes/registro-de-decisoes.md`.

## Próximo passo

Validação da Etapa 0. Após validação, Etapa 1 (fundação): projeto, autenticação, permissões, colaboradores, proteção do CPF, identidade visual e ambientes.
