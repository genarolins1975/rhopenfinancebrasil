# Riscos

Referência: 28/09/2026. Cada linha separa evidência (o que se sabe), inferência (o que se deduz) e recomendação.

| ID | Risco | Evidência | Inferência | Recomendação |
|---|---|---|---|---|
| `RSK-01` | Corrida entre reserva e trava produzindo reserva proibida coexistente | Requisito explícito; unicidade só em reservas não cobre a interação | Sem serialização por recurso haverá janelas de inconsistência sob carga | Lock por recurso, revalidação, triggers deferidos, teste com sessões concorrentes (`DIR-024`) |
| `RSK-02` | Exposição de CPF em logs, erros, exportações ou dados de demonstração | Requisito §6 | Vazamento acidental é o caminho mais provável | Tabela separada, cifra, redação em logs, teste automatizado que varre respostas e logs por padrão de 11 dígitos |
| `RSK-03` | Escalada de privilégio por edição de cadastro ou importação | Requisito §5 | Importação CSV é vetor típico | Colunas privilegiadas ignoradas, `role.assign.privileged` separada, dupla aprovação, testes de acesso indevido |
| `RSK-04` | Inventário da planta divergente do real | Planta recebida em 28/09/2026 declara 90 posições e rotula 84 mesas; layout de 26/01/2026 | O escritório pode ter mudado; contagem e códigos precisam de conferência física | Inventário preliminar marcado como não validado; validação de Facilities e RH antes de publicar o mapa (`fontes/planta-oficial.md`) |
| `RSK-05` | Promessa de anonimato indevida em pesquisas | Requisito §17 | Logs, tokens e exportações podem reidentificar | Modo confidencial por padrão; revisão de privacidade antes de qualquer "anônimo" |
| `RSK-06` | Agenda concorrente com Outlook ou Teams para salas | Ferramenta corporativa desconhecida | Se existir Outlook, salas geridas em dois lugares geram conflito | Determinar fonte oficial por recurso antes da Etapa 3; sem integração confirmada, salas ficam informativas ou fora do piloto |
| `RSK-07` | Revogação de sessão atrasada por cache de sessão em cookie | Better Auth oferece `cookieCache` | Cache prolonga sessão revogada até expirar | Desativar cache ou limitar a segundos; revalidar no servidor em rotas sensíveis |
| `RSK-08` | Limitação de tentativas em memória falha com várias instâncias | Documentação do Better Auth | Instâncias sem estado compartilhado não somam tentativas | Armazenar limite no banco |
| `RSK-09` | Email indisponível gera confirmação falsa | Requisito §20 | | Outbox, status de entrega visível, interface baseada no banco |
| `RSK-10` | Dependência de uma pessoa para operação | Requisito §21 | | Documentação de operação, responsável nomeado, procedimentos de backup, restauração e incidente |
| `RSK-11` | Provedor sem região no Brasil ou sem contrato de tratamento | Custos e regiões não verificados | | Verificar região e contrato antes da contratação; encarregado valida |
| `RSK-12` | Mapa inacessível por teclado e leitor de tela | Requisito §4 | SVG interativo é difícil de tornar acessível | Lista equivalente sempre disponível; axe e teste manual |
| `RSK-13` | Mudanças de versão maior no ecossistema (Node 26, Drizzle 1.0, TypeScript 7) durante o projeto | Versões verificadas em 28/09/2026 | | Fixar versões no lockfile; atualizar por decisão registrada |
| `RSK-14` | Indicadores distorcidos por vínculos administrativos ou dupla contagem | Requisito §19 | | Cálculo por união de restrições; testes de capacidade combinada |
| `RSK-15` | Confirmação de uso interpretada como ponto ou presença | Requisito §12 | | Texto explícito na interface e nos relatórios |
| `RSK-16` | Convite real enviado em ambiente de teste | Requisito §22 | | Provedor em modo restrito por ambiente; lista de destinatários permitidos em homologação |
