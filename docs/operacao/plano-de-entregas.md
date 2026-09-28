# Plano de entregas

Referência: 28/09/2026. Cada etapa segue: especificar, implementar, testar, revisar, corrigir, testar novamente, registrar aceite. Cada entrega inclui código funcional, testes executados com evidências, instruções de operação, limitações e pendências. Build passar não significa produção pronta.

## Etapa 0. Definição (entregue em 28/09/2026)

Escopo: inspeção do repositório e dos materiais, mapa do produto, arquitetura, matriz de permissões, modelo de dados, política DIR, telas prioritárias, riscos, decisões, matriz de rastreabilidade, plano.

Aceite: revisão independente registrada em `../testes/aceite.md` e validação do responsável.

## Etapa 1. Fundação

Escopo: projeto Next.js com tokens de design e primitivas acessíveis; PostgreSQL com migrações; Better Auth com Argon2id, convite, recuperação, limite de tentativas, MFA para admin; módulo de acesso com `can()`; colaboradores com cadastro, importação CSV, CPF protegido, desativação; auditoria e outbox; ambientes de desenvolvimento e homologação com dados sintéticos; bootstrap controlado do primeiro administrador.

Aceite: testes `AUT-*`, `CPF-*`, `ACC-01`, `IMP-01` verdes; varredura de CPF em logs e respostas; axe nos fluxos de entrada; revisão independente.

Dependências: validação da Etapa 0. Envio real de convites depende do provedor de email.

## Etapa 2. Núcleo do escritório (primeiro fluxo completo)

Escopo: inventário e planta (versões, publicação, inventário sintético `DEMO` até a planta oficial); mapa e lista; serviço de disponibilidade; reserva diária e semanal atômica; mesas exclusivas individuais e de grupo; bloqueios, manutenção e exceções; tela de exclusividade com prévia, conflitos e lote; triggers deferidos; testes transacionais e de concorrência.

Aceite: os 15 casos obrigatórios da matriz verdes, incluindo `DIR-024-T1` com sessões concorrentes; revisão independente com testes adversos; nenhuma regra apenas no frontend.

Dependências: planta oficial para o mapa definitivo; composição do grupo diretoria.

## Etapa 3. Operação

Escopo: lista de espera com retenção transacional e ofertas; confirmação de uso configurável (portal e QR) desativada por padrão para liberação; salas e cabines com intervalos; Meu time; painel administrativo de reservas e fila; indicadores de capacidade sem dupla contagem; integração de calendário somente se a fonte oficial for confirmada.

Aceite: `WL-*`, `BKG-03`, `DIR-025`, `DIR-026` verdes; revisão independente.

## Etapa 4. Experiência do colaborador

Escopo: atendimento com protocolo, filas, transições, notas internas, anexos privados, ocorrências; ergonomia e conforto vinculados a solicitações concretas; benefícios, guia e avisos com fluxo editorial; pesquisas identificadas e confidenciais com supressão; "Vocês disseram. Estamos fazendo."; painel com dados históricos identificados por pesquisa e período.

Aceite: `ACC-02`, `ESC-01` verdes; revisão de privacidade do desenho de pesquisas; revisão independente.

## Etapa 5. Piloto e publicação autorizada

Escopo: testes representativos com usuários designados em homologação; revisão de segurança e privacidade; acessibilidade manual; backup e teste de restauração; treinamento do ADM com o guia; correções; procedimento de publicação com impacto e plano de retorno.

Aceite: MFA ativo para todos os perfis administrativos; `OPS-01` executado; autorização explícita para DNS, produção e convites reais.

## Guia do RH e ADM

Escrito ao longo das Etapas 1 a 4 em `guia-rh-adm.md`: cadastro e importação, primeiro acesso, desativação, publicação de planta, bloqueio para diretor, transferência, liberação temporária, resolução de conflitos e interpretação dos indicadores.
