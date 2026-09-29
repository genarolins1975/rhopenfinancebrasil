# Tokens de design

Referência: 29/09/2026. Fonte única: `src/app/globals.css`. Sujeitos ao manual de marca, ainda não recebido; o logotipo oficial não foi inventado.

## Cor

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#f5f7f8` | Fundo da página |
| `--color-surface` | `#ffffff` | Cartões, cabeçalhos, formulários |
| `--color-surface-muted` | `#eef2f4` | Blocos secundários, cabeçalho de tabela |
| `--color-text` | `#1b2430` | Texto principal (contraste 14,6:1 sobre a superfície) |
| `--color-text-muted` | `#55606c` | Texto secundário (contraste 6,4:1) |
| `--color-border` | `#d5dce2` | Bordas |
| `--color-primary` | `#0f4c5c` | Azul petróleo: ações primárias, links, foco (contraste 8,5:1 com branco) |
| `--color-primary-strong` | `#0a3a47` | Hover e barra administrativa |
| `--color-primary-soft` | `#e3eef1` | Fundo de item ativo e de mensagem informativa |
| `--color-accent` | `#f2b705` | Amarelo, uso contido em marcações; nunca como único sinal |
| `--color-danger`, `--color-success`, `--color-warning` | `#b42318`, `#1f7a4d`, `#8a4b00` | Estados, sempre com ícone e texto |

## Tipografia, espaçamento e forma

* Fonte do sistema (`ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial`), sem download externo.
* Tamanho base 16px, entrelinha 1,5; títulos 24px e 18px semibold.
* Escala de espaçamento do Tailwind; raio 8px; sombra única e discreta.
* Alvo de toque mínimo 40px de altura em botões e campos.

## Estados e foco

* Foco visível em tudo o que recebe teclado: contorno de 3px em azul petróleo com deslocamento de 2px.
* Estado atual da navegação anunciado por `aria-current` e por texto oculto, não só por cor.
* Mensagens de erro em `role="alert"`; sucessos e avisos em `role="status"`; todas com ícone e texto.
* Movimento reduzido respeitado (`prefers-reduced-motion`).
* Diálogos de confirmação usam `<dialog>` nativo, com título associado e fechamento por teclado.

## Componentes

`src/components/ui.tsx`: `Button`, `ButtonLink`, `Field`, `Input`, `Select`, `Textarea`, `Alert`, `Card`, `PageHeader`, `StatusBadge`, `EmptyState`, `Table`, `DefinitionList`. `src/components/forms.tsx`: `ActionForm`, `SubmitButton`, `ActionMessages`, ligados a server actions com `useActionState`. Nenhum componente decide autorização ou disponibilidade.
