# Privacidade, proteção de dados e operação

Referência: 28/09/2026. Este documento identifica decisões para validação do encarregado e do jurídico. Não é declaração de conformidade.

## Inventário de dados

| Dado | Finalidade proposta | Quem acessa | Retenção proposta | Decisão pendente |
|---|---|---|---|---|
| CPF | Identificação inequívoca do colaborador nos registros de RH e deduplicação | RH com `cpf.reveal`, sempre auditado | Enquanto exigido pela obrigação que justifica a coleta | Base legal e necessidade da coleta no portal |
| Cadastro (nome, email corporativo, área, cargo, gestor, condição, datas) | Operação do portal e gestão do vínculo | RH; básico visível a todos os colaboradores | Vínculo mais prazo legal | Base legal |
| Reservas, intenção de presença, confirmação de uso | Gestão do espaço | Pessoa, gestor no que foi autorizado, RH, Facilities | 24 meses em detalhe | Uso em indicadores agregados |
| Relatos e atendimentos, anexos | Resolver solicitações | Solicitante e área responsável; sensível só com permissão restrita | Vínculo mais 5 anos | Categorias sensíveis |
| Pesquisas | Escuta institucional | Agregado para RH e ADM; individual identificado para ninguém por padrão | Agregados; confidencial sem chave de vinculação | Modo anônimo só após demonstração |
| Logs e auditoria | Segurança e rastreabilidade | ADM técnico e ADM com `audit.view` | 5 anos para auditoria; logs técnicos 90 dias | |
| Prefixo SHA1 de senha para verificação de vazamento | Bloquear senha comprometida | Serviço externo recebe cinco caracteres | Não armazenado | Autorização do encarregado |

## Fornecedores potenciais (nenhum contratado)

Hospedagem da aplicação, banco gerenciado, email transacional, armazenamento privado, rastreamento de erros. Cada um exige: região dos dados, contrato de tratamento, política de retenção e de subprocessadores. Lista final para validação antes da Etapa 5.

## Proibições operacionais

Não enviar documentos internos, CPF ou chamados a serviços externos de inteligência artificial sem autorização específica. Não gravar CPF, senha ou token em log. Não incluir conteúdo de assuntos pessoais em email: notificações levam protocolo e link autenticado.

## Uploads

Validação de tipo por assinatura e de tamanho; armazenamento privado; download por URL assinada de curta duração após autorização; sem execução de arquivos ativos; varredura de malware como decisão pendente.

## Logs

Estruturados, com redação de campos sensíveis por lista de chaves e por padrão de 11 dígitos; identificador de requisição em toda resposta de erro; sem corpo de requisição em produção.

## Backups e restauração

Backup diário automático com retenção proposta de 30 dias; teste de restauração documentado antes do piloto e a cada trimestre; restauração pontual quando o provedor oferecer.

## Acesso emergencial (procedimento proposto)

1. Solicitação escrita com motivo e escopo.
2. Aprovação por segunda pessoa designada.
3. Credencial temporária com validade curta e registro de emissão.
4. Registro de início e fim, comandos executados quando possível.
5. Revisão posterior e registro em auditoria.

## Incidente (procedimento proposto)

1. Detecção e registro com horário.
2. Contenção: revogação de sessões, rotação de segredos afetados, bloqueio de contas.
3. Avaliação de dados afetados, com apoio do encarregado.
4. Comunicação conforme orientação jurídica.
5. Correção, verificação e relato final.

## Responsável pela operação

A definir e registrar aqui antes do piloto: nome, função, substituto, contatos. Um portal em produção não depende da memória do desenvolvedor.
