# Planta oficial do escritório: leitura e inventário preliminar

Referência: 28/09/2026. Fonte: `571-4CP-100-OPENFINANCE-LAYOUT-R00.pdf`, recebido em 28/09/2026. O PDF não é versionado neste repositório por restrição de acesso; fica em armazenamento privado (Etapa 2, `floor_plan_version.source_file_id`). Verificação de integridade: SHA256 `a3dbabfc6c065812df62d31a966bb70d54c5d9b7857134199deac810eb1d8534`, 2.584.580 bytes.

## Identificação (evidência, selo do desenho)

| Campo | Valor |
|---|---|
| Título | Planta de layout, 4º andar, Open Finance |
| Cliente | Open Finance |
| Endereço | Rua Henrique Monteiro, 22, Pinheiros, São Paulo, SP |
| Edifício | JMA Henrique Monteiro |
| Etapa | As built |
| Emissão | 26/01/2026, revisão 00 (emissão inicial) |
| Escala | 1:50, folha 100 |
| Área de intervenção | 510 m² |
| Autoria | 4CORP Arquitetura (arquiteto responsável Roberto Andreotti; projeto Vinícius Venâncio; desenho Danilo Arruda) |
| Formato | Uma página, 84,1 x 59,4 cm, vetorial com texto extraível |

## O que o desenho mostra (evidência)

Contagem feita por extração dos rótulos de texto vetorial do PDF e conferida visualmente em recortes ampliados. Contar rótulos não é conferir móveis: a validação é de Facilities.

| Elemento | Rótulo | No desenho | Na legenda | Observação |
|---|---|---|---|---|
| Mesas de trabalho 120x70, pé cavalete | ME01 | 84 rótulos individuais | 90 unidades | O texto "STAFF 90 POSIÇÕES" está no desenho. Seis posições não têm rótulo individual localizável; divergência a validar |
| Cadeiras de trabalho linha Brizza | ME02 | 124 rótulos, dos quais 84 junto às mesas e 40 em mesas de reunião | 90 unidades | A legenda também lista ME11 (cadeiras Brix, 34 unidades) sem rótulo no desenho; provável que as cadeiras de reunião sejam ME11 |
| Sala Reunião 3 | ME03, mesa 240x140 | 1 sala, 6 cadeiras desenhadas | 1 mesa | Divisórias de vidro e drywall acústico |
| Sala Reunião 2 | ME04, mesa 320x140 | 1 sala, 8 cadeiras desenhadas | 1 mesa | |
| Sala Reunião 1 | ME05, 3 mesas 245x140 unidas | 1 sala, 20 cadeiras desenhadas | 3 mesas | Sala maior |
| Mesa de reunião aberta | ME10, mesa 360x140 | 1, com 8 cadeiras, em área aberta próxima ao CPD | 1 mesa | Não é sala fechada |
| Booth 1 e Booth 2 | MN11, conjunto Outback 200x100 | 2 ambientes fechados ladeando a recepção | 2 conjuntos | Ambientes de conversa com sofá, não estações de trabalho |
| Cabines acústicas | MN08, cabine Dematec, com banqueta MN06 | 4 cabines na zona superior esquerda | Sem quantidade na legenda; MN06 lista 4 banquetas | São os espaços para chamadas |
| Armários baixos 70x50 | ME06 | 12 rótulos | 12 unidades | |
| Lockers | ME07 | 2 posições, uma de cada lado da entrada da recepção | Sem quantidade | |
| Recepção | MN07, MN10 | 3 poltronas, 1 mesa lateral, parede de logo | | |
| Copa principal | ME09, MN03, MN05, MN04 | 2 mesas 200x80 com 12 cadeiras, 2 bistrôs altos, 4 banquetas | | Ambiente fechado à direita, com bancada MM01 |
| Copa de apoio | TP.11 | 5,96 m² junto aos sanitários | | |
| Área de convivência | MN01, MN02, MN12 | 4 sofás Spin com conectividade, 6 mesas para notebook, 4 sofás móveis | | Faixa inferior e dois pontos na área de staff |
| CPD | | 1 sala fechada, superior direita | | |
| Sanitários | TP.08, TP.09, TP.10 | Masculino 9,04 m², feminino 8,99 m², PCD 3,28 m², mais sanitário de clientes | | |
| Circulação vertical | TP.04, TP.05 | Escadas 01 e 02, elevadores, área técnica TP.12 | | Fora do escopo de reservas |

## Organização das mesas (evidência com identificação provisória)

Oito blocos de mesas em pares (duas mesas lado a lado por fileira, cadeiras para fora), separados por corredores e floreiras metálicas (MC07). Numeração provisória de cima para baixo e da esquerda para a direita, apenas para trabalho.

| Bloco provisório | Zona | Fileiras | Mesas |
|---|---|---|---|
| 1 | Superior esquerda, junto às cabines | 2 | 4 |
| 2 | Superior esquerda, junto às cabines | 3 | 6 |
| 3 | Principal, coluna 1 | 7 | 14 |
| 4 | Principal, coluna 2 | 7 | 14 |
| 5 | Principal, coluna 3 | 7 | 14 |
| 6 | Principal, coluna 4 | 6 | 12 |
| 7 | Principal, coluna 5 | 6 | 12 |
| 8 | Principal, coluna 6, junto à recepção | 4 | 8 |
| Total | | | 84 |

Arquivo de trabalho com coordenadas normalizadas: `planta-r00-extracao.json` (marcado `validado: false`).

## Inferências (não são evidência)

* As seis posições que faltam para 90 podem ser mesas sem rótulo, posições contadas na legenda por engano ou mesas previstas em outra revisão. O desenho não permite decidir.
* As cadeiras de reunião rotuladas ME02 no desenho provavelmente correspondem às 34 cadeiras Brix (ME11) da legenda: 6 mais 8 mais 20 dá 34. Coincidência numérica forte, ainda assim inferência.
* Capacidade das salas pelas cadeiras desenhadas: Reunião 3 com 6, Reunião 2 com 8, Reunião 1 com 20, mesa aberta ME10 com 8. Capacidade operacional pode ser diferente.
* Nenhuma mesa aparece identificada como de diretoria. A distribuição exclusiva é decisão do RH, não do desenho.

## O que a planta não informa

Atributos por mesa (monitor, docking, altura regulável), acessibilidade das posições, zonas silenciosas, equipamentos audiovisuais das salas além do símbolo de TV, situação operacional atual, mudanças posteriores a 26/01/2026. Nada disso será cadastrado sem verificação.

## Uso no produto

1. PDF original: armazenamento privado, referência de `floor_plan_version` com hash.
2. Arquivo de trabalho: extração acima e o SVG simplificado a ser produzido na Etapa 2 a partir dos vetores do PDF, com IDs estáveis por mesa, sala, booth e cabine.
3. Mapa operacional: versão publicada somente após Facilities e RH validarem contagem, códigos definitivos, atributos e capacidades na tela ADM de planta.

## Pendências de validação com Facilities e RH

| Item | Pergunta |
|---|---|
| Contagem | São 84 ou 90 mesas em uso? Onde estão as seis restantes? |
| Códigos | Existe numeração física das mesas? Se não, adotar os códigos do bloco e fileira? |
| Salas | Capacidade operacional de Reunião 1, 2, 3 e da mesa aberta; equipamentos disponíveis |
| Cabines e booths | As quatro cabines acústicas e os dois booths entram no motor de reservas? Com que unidade de tempo? |
| Atributos | Quais mesas têm monitor, docking ou ajuste de altura |
| Atualidade | O layout de 26/01/2026 ainda corresponde ao escritório? |
