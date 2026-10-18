# Design "claro + lima"

Referência visual fornecida pelo Thiago (painel de saúde da AI-BL) e traduzida para o
FlowAI em 2026-10-18. Esta é a pele do produto a partir de agora; o documento registra as
regras para as telas que ainda serão redesenhadas.

## Regras

1. **Acento único: lima** (`--lime`, `oklch(0.91 0.19 123)`). Só aparece como
   **preenchimento** (pílula ativa, círculo, badge, barra, destaque de gráfico) com
   `--lime-foreground` (quase preto) por cima. Nunca em texto pequeno sobre fundo claro:
   o contraste é ~1,5:1 e reprova em acessibilidade.
2. **Preto é o peso.** `--primary` é quase preto no tema claro (pílulas de ação, barras de
   gráfico, números) e é **espelhado** no escuro (quase branco), então a pílula de ação
   continua legível nos dois temas.
3. **Cartão = `bg-card` + `shadow-soft`, sem borda.** A separação vem do fundo cinza da
   página (`--background`), não de contorno.
4. **Sub-painel dentro de cartão usa `bg-muted`**, que é o mesmo cinza da página — é assim
   que a referência constrói os blocos internos.
5. **Raio grande** (`--radius: 1.125rem`): como o `rounded-lg` fica maior que meia altura
   de um botão/input de 32 px, os controles viram pílula sozinhos, sem classe extra.
6. **Números grandes** em `tabular-nums` + `tracking-tight`, rótulo pequeno em
   `text-muted-foreground` em cima e legenda embaixo.
7. **Tipografia: Geist** (mantida; zero custo de performance).

## Peças novas

| Peça | Para que serve |
|---|---|
| `ui/icon-orb.tsx` | Círculo com ícone (lima/escuro/cinza/contorno). É o "selo" do produto: marca o item ativo da navegação e dá peso aos cartões. |
| `ui/action-link.tsx` | Ação principal: pílula escura com círculo lima no lugar da seta. |
| `dashboard/kpi-stat.tsx` | `KpiStat` (número hero ou de apoio) e `KpiProgress` (percentual com barra lima). |
| `dashboard/kpi-cards.tsx` | `PulseCard`, `PipelineCard`, `ServiceCard` — os 9 indicadores do dashboard agrupados em 3 cartões. |

## Telas redesenhadas nesta rodada

- **Shell:** sidebar virou cartão branco flutuante (`rounded-[28px]`) com o ativo em
  pílula lima; recolhida, vira o rail de ícones da referência (ativo em círculo lima).
  Header virou barra em pílula com o usuário em chip.
- **Dashboard:** título em duas cores + orbe lima, seleção de período em pílulas e CTA
  escura; grade de 12 colunas com cartões de larguras diferentes, gráficos sem grade,
  barras arredondadas e o pico do período em lima.

## Garantias preservadas (e2e)

- Todo indicador continua `role="group"` com `aria-label` igual ao título — é assim que
  `e2e/dashboard.spec.ts` acha "Conversas hoje", "Valor potencial" etc.
- A sidebar continua `role=complementary` nomeada "Navegação principal", com os 9 rótulos
  visíveis (recolhidos, `sr-only`) e `aria-current="page"` no ativo.
- O período continua `radiogroup`/`radio` com navegação por setas e `aria-checked`.
- Textos do banner de primeira vez e dos estados vazios ("Sem dados no período") intactos.

## Pendente

- **Telas densas** (Inbox, Pipeline, Contatos, Analytics, Automações, IA, Conhecimento,
  Configurações internas) herdam os tokens e os raios, mas ainda não foram redesenhadas.
- **Editor de automações** usa cores por tipo de nó: decidir se entram na paleta ou ficam
  como cores funcionais.
- **Login, cadastro e onboarding** ainda estão com a cara antiga.
- Sem dados de comparação com o período anterior, os cartões não têm badge de variação
  (o `+60%` da referência): exigiria mudar a RPC do dashboard.

## Como a revisão visual foi feita

Build de produção + rota temporária `/dashboard/preview` renderizando o shell e o
`DashboardView` com dados de exemplo, capturada com Playwright nos estados claro, escuro,
vazio, sidebar recolhida e celular. A rota e o script foram removidos antes do commit.
