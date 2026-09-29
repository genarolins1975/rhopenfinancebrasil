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
| `RSK-17` | Caminho de escrita fora do protocolo de locks (seed, importação, lote) cria estado contraditório | Revisão adversarial de 28/09/2026 | Disciplina de código não basta | Lock por recurso imposto por trigger; triggers deferidos em todas as tabelas que alteram elegibilidade; painel de conflitos como consulta; teste que remove o lock da aplicação |
| `RSK-18` | Sessão de banco em UTC erra o dia local entre 21:00 e 23:59 | Padrão dos provedores gerenciados é UTC | Vigências e exceções mudariam de dia | `timezone` por papel, `local_today()` única, proibição de `current_date`, testes de virada de dia |
| `RSK-19` | Endpoints administrativos de identidade fora da matriz do portal | Plugin admin do Better Auth expõe impersonação e troca de senha por role própria | Escalada de conta | Plugin não montado; lista explícita de caminhos; teste de 404 para toda sessão |
| `RSK-20` | Chave do CPF perdida ou sem custódia torna o dado irrecuperável | Chave fora do banco por requisito | Restauração sem chave passa no teste e falha na prática | Custódia e versão de chave; teste de restauração inclui a chave |
| `RSK-21` | Plugin SSO futuro provisiona contas sem convite | Provisionamento implícito existe no plugin | Quebraria o cadastro fechado | Provisionamento implícito desativado; vínculo só a cadastro existente |
| `RSK-22` | Adaptador interno do Better Auth muda entre versões | Não é API documentada como estável | Atualização silenciosa quebraria convite e desativação | Versão fixada; teste de integração cobrindo cada chamada |
| `RSK-23` | Token de recuperação de senha em claro em `auth_verification` por 60 minutos | Comportamento do Better Auth 1.7.6 verificado na revisão | Quem lê o banco redefine senhas nesse intervalo | Validade curta, acesso ao banco restrito e auditado; avaliar tabela própria com hash na Etapa 5 |
| `RSK-24` | Bloqueio por conta permite negação de serviço a uma pessoa específica | Cinco falhas travam a conta por dez minutos; sucesso é registrado antes do segundo fator | Terceiro impede o login de alguém repetindo senhas erradas | Registrado; backoff progressivo combinando conta e IP, limite de reenvio de recuperação e sucesso registrado após o segundo fator ficam para a Etapa 5 |
| `RSK-25` | Sem CSP com nonce | Cabeçalhos básicos aplicados; CSP pendente | Menor defesa contra injeção de script | CSP com nonce na Etapa 5, junto da revisão de segurança |
