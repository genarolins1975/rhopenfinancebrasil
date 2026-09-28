# Mapa do produto e arquitetura de informação

Referência: 28/09/2026. Parâmetros marcados como "proposto" dependem de validação registrada em `../decisoes/registro-de-decisoes.md`.

## Objetivo

Ajudar o colaborador a planejar a semana, reservar um lugar adequado, encontrar espaços para reuniões, resolver dificuldades, acessar benefícios e acompanhar melhorias do ambiente. Dar ao RH controle operacional sem editar código. Respeitar integralmente as mesas exclusivas da diretoria em todos os canais.

## Escopo da primeira versão

Incluído: cadastro e acesso dos colaboradores; reserva de mesas, salas e cabines; mesas exclusivas da diretoria (individual e de grupo); atendimento (RH, Facilities, TI); conteúdo institucional (benefícios, guia, avisos); pesquisas identificadas e confidenciais; plano de melhorias.

Fora do escopo: folha, recrutamento, ponto, avaliação de desempenho, prontuário de saúde, chatbot, gamificação, ranking de qualquer natureza, medição instrumental de ruído ou temperatura, reserva de micro ondas, vigilância de horários.

Referências conceituais (não templates): Microsoft Places, Robin, ServiceNow Employee Center, Workday, HiBob, BambooHR, Culture Amp, Qualtrics.

## Públicos e perfis

| Perfil | O que faz no portal |
|---|---|
| Colaborador | Planeja a semana, reserva, pede ajuda, lê conteúdo, responde pesquisas |
| Diretor (condição organizacional, não perfil de sistema) | Tudo o que o colaborador faz, com destaque para a mesa habitual quando tiver vínculo exclusivo |
| Gestor | Vê planos presenciais e reservas autorizadas da equipe, indicadores agregados |
| RH | Cadastro, importação, convites, conteúdo, benefícios, atendimentos RH, exclusividade da diretoria |
| Facilities | Recursos, planta, manutenção, bloqueios, reservas operacionais, atendimentos de infraestrutura |
| Administrador | Configuração operacional e permissões explicitamente concedidas |
| Administrador técnico | Integrações, configuração técnica, operação, sem leitura irrestrita de assuntos confidenciais |

## Navegação do colaborador

Cinco destinos principais, iguais no desktop (barra lateral) e no celular (barra inferior):

1. Início
2. Escritório
3. Benefícios e guia
4. Fale com RH
5. Escuta e ações

Atalho permanente "Preciso de ajuda" no cabeçalho, disponível em todas as telas.

## Árvore de rotas proposta

### Área pública (somente entrada e fluxos de autenticação)

| Rota | Função |
|---|---|
| `/` | Entrada institucional mínima, sem dados internos, com link para entrar |
| `/entrar` | Login com email corporativo e senha |
| `/convite/[token]` | Primeiro acesso: define a senha a partir de convite individual |
| `/recuperar-senha` | Solicita recuperação; resposta idêntica exista ou não a conta |
| `/redefinir-senha/[token]` | Define nova senha |
| `/mfa` | Segundo fator após senha, quando exigido |
| `/privacidade` | Aviso de privacidade |

### Portal do colaborador (autenticado)

| Rota | Função |
|---|---|
| `/inicio` | "Olá, [nome]. Como será sua próxima semana?", cinco dias úteis, botão "Planejar minha semana", próximas reservas, solicitações em andamento, avisos, resumo "Vocês disseram. Estamos fazendo." |
| `/inicio/planejar` | Seleção de vários dias, intenção por dia, posições elegíveis, recursos, resumo por dia, confirmação atômica |
| `/escritorio` | Mapa interativo e alternativa em lista, filtro por data e zona |
| `/escritorio/recurso/[codigo]` | Detalhe do recurso, estado para o usuário, ação permitida |
| `/escritorio/salas` | Busca de salas e cabines por data, horário, capacidade e recursos verificados |
| `/escritorio/minhas-reservas` | Reservas futuras e passadas, cancelamento, confirmação de uso, QR |
| `/escritorio/fila` | Inscrição na lista de espera por data e ofertas recebidas |
| `/escritorio/meu-time` | Planos presenciais e reservas cuja visibilidade foi autorizada |
| `/beneficios` | Benefícios por necessidade |
| `/beneficios/[slug]` | Descrição, elegibilidade, como utilizar, documentos, contato, perguntas frequentes, atualização |
| `/guia` | Primeiros dias, escritório, benefícios, férias, reembolsos, políticas, tecnologia, contatos |
| `/guia/[slug]` | Conteúdo publicado com controle de acesso |
| `/ajuda` | Fale com RH: minhas solicitações |
| `/ajuda/nova` | Assunto, local ou recurso quando pertinente, descrição, anexo opcional |
| `/ajuda/[protocolo]` | Protocolo, área responsável, status, próxima atualização, histórico visível, confirmação, avaliação, reabertura |
| `/escuta` | Pesquisas abertas e respondidas |
| `/escuta/pesquisa/[id]` | Responder pesquisa identificada ou confidencial, com explicação do modo |
| `/escuta/acoes` | "Vocês disseram. Estamos fazendo." com tema, evidência, ação, responsável, prazo, status, resultado |
| `/perfil` | Dados básicos, preferências de notificação |
| `/perfil/seguranca` | Senha, segundo fator, sessões ativas |

### Administração (`/admin`, navegação própria)

| Rota | Função |
|---|---|
| `/admin` | "O que precisa de atenção hoje e o que pode dar problema na próxima semana?" |
| `/admin/colaboradores` | Lista, filtros, cadastro individual, convites, desativação |
| `/admin/colaboradores/importar` | CSV com modelo, prévia, validação por linha, confirmação |
| `/admin/colaboradores/[id]` | Cadastro, vínculos, perfis, CPF mascarado com revelação auditada |
| `/admin/escritorio/planta` | Versões da planta, edição de posições, aprovação, publicação |
| `/admin/escritorio/recursos` | Tabela de recursos, atributos verificados, situação operacional, manutenção, bloqueios |
| `/admin/escritorio/mesas/exclusividade` | Exclusividade da diretoria: travar, agendar, transferir, encerrar, liberar temporariamente, histórico, conflitos |
| `/admin/reservas` | Reservas por data, reserva em nome de, cancelamento administrativo com motivo |
| `/admin/fila` | Lista de espera, ofertas, expirações |
| `/admin/atendimentos` | Filas por área, triagem, notas internas, ocorrências agrupadas |
| `/admin/conteudo` | Benefícios, guia e avisos: rascunho, aprovação, publicação, revisão prevista |
| `/admin/pesquisas` | Criação, modo, período, resultados agregados com supressão |
| `/admin/acoes` | Plano de ações com evidência e fonte |
| `/admin/relatorios` | Indicadores com numerador, denominador, período, fonte e limitações |
| `/admin/acessos` | Perfis, permissões nomeadas, vigência, concessão com separação de atribuições |
| `/admin/configuracoes` | Calendário do escritório, janela de abertura, prazos, categorias, textos |
| `/admin/auditoria` | Eventos de auditoria com filtros |

## Padrão de estados de toda tela

Toda tela implementa os oito estados abaixo. `../telas/telas-prioritarias.md` registra apenas o que difere deste padrão.

| Estado | Comportamento padrão |
|---|---|
| Carregamento | Esqueleto com a estrutura da tela, ações desabilitadas, anúncio de carregamento para leitor de tela; após 10 segundos, aviso de demora com opção de tentar de novo |
| Ausência de dados | Mensagem específica do contexto com a ação primária que resolve a ausência; nunca uma tabela vazia sem texto |
| Sucesso | Confirmação exibida somente após o servidor persistir; o texto diz o que foi feito e o próximo passo; o foco vai para a mensagem |
| Erro | Mensagem sem detalhes técnicos, com identificador da requisição para suporte; dados do formulário preservados; ação de tentar de novo |
| Conflito | Lista do que colidiu (data, recurso, pessoa quando permitido) e as opções devolvidas pelo serviço de disponibilidade; nada aplicado parcialmente |
| Indisponibilidade | Serviço fora ou em manutenção: leitura a partir do último estado carregado, com aviso datado; escrita desabilitada; nada exibido como disponível por padrão |
| Conexão perdida | Aviso persistente; rascunho preservado localmente quando não contém dado sensível; reenvio com a mesma chave de idempotência ao reconectar |
| Permissão insuficiente | "Esta ação não está disponível para o seu perfil", sem revelar dados do recurso protegido; caminho para pedir ajuda ao RH |

Regras gerais: nenhum botão sem função; ação inexistente não aparece; nenhuma regra depende somente de cor ou de hover.

## Requisitos de experiência das Etapas 3 e 4

Registrados aqui para não se perderem até a especificação detalhada dessas etapas.

| Área | Requisito | Fonte |
|---|---|---|
| Fila | Ao expirar uma oferta, o servidor processa automaticamente a próxima pessoa elegível; a ação manual do ADM é complementar | Prompt §12 |
| Salas e cabines | Orientação de convivência para reduzir reuniões nas mesas, publicada no guia e no detalhe das cabines | Prompt §13 |
| Atendimento | O usuário escolhe assunto e local; o encaminhamento para RH, Facilities ou TI é automático, sem exigir conhecimento do organograma | Prompt §14 |
| Atendimento | Transições de status permitidas com motivos; mensagens ao solicitante separadas de notas internas; reclassificação sem expor conteúdo confidencial à nova equipe | Prompt §14 |
| Atendimento | Indicadores de tempo de resposta, tempo de resolução, recorrência e satisfação; queda de chamados nunca é lida isoladamente como melhoria | Prompt §19 |
| Ergonomia e conforto | Solicitações concretas (mouse, apoio para pés, ajuste de cadeira, avaliação da estação); sem pedir diagnósticos; motivos de adaptações individuais nunca publicados | Prompt §15 |
| Ruído e temperatura | Relatos apresentados como percepções, nunca como medições instrumentais | Prompt §15 |
| Copa | Relatar indisponibilidade, pedir reposição, responder consultas ocasionais; sem reserva de micro ondas nem vigilância de horários | Prompt §15 |
| Integração | Atividades voluntárias em fase posterior; sem ranking de felicidade, saúde, engajamento ou assiduidade | Prompt §15 |
| Benefícios | Só serviços confirmados pela Associação são publicados | Prompt §16 |
| Conteúdo | Busca, anexos e resultados respeitam o controle de acesso da página original; documentos privados nunca em diretórios públicos | Prompt §16 |
| Escuta | Respostas nunca conectadas a CPF, reservas ou histórico de utilização para avaliar indivíduos; sem respostas individuais a gestores por padrão | Prompt §17 |

## Acessibilidade

Objetivo WCAG 2.2 AA com verificação manual e automatizada (axe no fluxo de testes ponta a ponta). Teclado completo, foco visível, contraste, leitores de tela, formulários rotulados, redução de movimento respeitada, alternativa em lista para o mapa. Nenhuma regra dependerá somente de cor ou de hover: estados do mapa combinam cor, ícone e texto.

## Identidade visual

Sóbria, acolhedora e institucional: fundo claro, tipografia legível, espaçamento generoso, hierarquia evidente. Azul petróleo e amarelo com uso contido, sujeitos ao manual de marca. Sem logotipo inventado. Tokens de cor, tipografia, espaçamento, bordas, estados e foco definidos uma vez e reutilizados. Poucos cards, sombras discretas, sem gradientes decorativos, animações mínimas.
