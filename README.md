# Gestão Financeira Empresarial

Financeiro operacional **multiempresa** para pequenas empresas: contas a pagar e a receber, baixas parciais, transferências, fluxo de caixa realizado e projetado, conciliação manual com extrato, importação de CSV e relatórios gerenciais. Next.js + TypeScript + Supabase (Postgres com RLS), com as regras de dinheiro **dentro do banco**.

**Público:** pequenas empresas sem ERP.
**Problema:** contas a pagar e receber em planilhas, sem visão de caixa.

![Painel](docs/screenshots/painel.png)

## O que faz
- **Contas** (banco, caixa, poupança, cartão pré-pago…) com saldo **sempre calculado**: saldo inicial + movimentos efetivos. Alterar o saldo inicial exige perfil de administrador e deixa histórico.
- **Contas a pagar e a receber**: título com parcelas, vencimento, competência, contraparte, categoria, rateio por centro de custo, anexos privados. Atraso é **derivado** (nunca um status gravado).
- **Baixa** total ou parcial, com **idempotência** (duplo clique e reenvio não pagam duas vezes) e **estorno** por movimento compensatório. O livro de movimentos é imutável.
- **Transferências** entre contas (duas pernas que somam zero; não entram em receita nem despesa) e **ajustes** de saldo com motivo.
- **Recorrências** que geram títulos previstos de forma idempotente (mensal, semanal, anual…, com fim de mês tratado).
- **Fluxo de caixa**: realizado por período e **projetado** em três cenários (conservador, esperado, otimista), sempre rotulado como hipótese.
- **Importação de CSV** (extrato, títulos e histórico) com mapeamento de colunas, prévia, validação linha a linha, detecção de duplicidade e relatório de erros.
- **Conciliação manual** assistida por sugestões (valor, data, texto). Não há conexão bancária automática.
- **Painel** com 10 indicadores e 10 gráficos, **15 relatórios** com CSV auditado (neutralização de fórmulas) e **Resumo Gerencial de Receitas e Despesas** (não é DRE oficial).
- **Avisos** (vencimentos, atrasos, saldo negativo, recorrências, importações) e metas.

## Não faz (fora do escopo)
Contabilidade, emissão fiscal, conciliação bancária automática (Open Finance), boletos/PIX, folha, impostos.

## Começar em 1 minuto (com Claude Code ou Codex)

1. Abra o **Claude Code** (ou o Codex) numa pasta vazia do seu computador.
2. Copie o link deste repositório e cole no chat com o pedido abaixo:

```text
Instale o Financeiro Completo: https://github.com/pack-25-sistemas-ia/financeiro-completo
Clone numa pasta nova e siga o guia .claude/commands/instalar.md. Explique cada passo e me pergunte quando precisar de algo meu.
```

3. Pronto: o agente clona, instala, sobe o banco local e abre o sistema. Depois da primeira vez, dentro da pasta, basta digitar `/instalar` no Claude Code para refazer ou consertar a instalação.

Prefere fazer à mão? Os passos manuais estão logo abaixo.


## Começar
```bash
pnpm install
supabase start && supabase db reset     # banco local com dados fictícios (seed reproduzível)
cp .env.example .env.local              # preencha com as chaves de «supabase status»
pnpm dev
```
Empresa fictícia «Nova Horizonte Serviços Ltda.». Usuários locais (senha única `DemoLocal#2026`): `dono@demo.exemplo` (administrador), `gestor@demo.exemplo`, `analista@demo.exemplo`, `consulta@demo.exemplo`. Detalhes em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Qualidade
```bash
pnpm lint && pnpm typecheck && pnpm test      # lint, tipos, testes unitários
pnpm build
pnpm test:db                                  # Postgres 17 em Docker: testes SQL de motor, acesso A×B, métricas
pnpm test:concurrency                         # sessões paralelas reais: sem baixa duplicada, sem impasse
pnpm test:mutation                            # quebra regras críticas de propósito; todos os testes devem reprovar
pnpm test:e2e                                 # Playwright contra Supabase local e o app compilado
```
Os resultados reais de cada rodada estão em [MEMORY.md](MEMORY.md). O que não foi executado é dito como NÃO EXECUTADO.

## Documentação
[FEATURES](docs/FEATURES.md) · [Modelo financeiro](docs/FINANCIAL_MODEL.md) · [Regras de dinheiro](docs/MONEY_RULES.md) · [Regras de fluxo de caixa](docs/CASHFLOW_RULES.md) · [Indicadores](docs/METRICS.md) · [Banco de dados](docs/DATABASE.md) · [Conciliação e importação](docs/RECONCILIATION.md) · [Permissões](docs/PERMISSIONS.md) · [Arquitetura](docs/ARCHITECTURE.md) · [Decisões](docs/DECISIONS.md) · [Implantação](docs/DEPLOYMENT.md) · [Licenças](docs/OPEN_SOURCE_AUDIT.md)

## Privacidade (LGPD)
Risco estimado: **alto**. Dados tratados: nome, CPF/CNPJ opcional de contrapartes e dados financeiros. Quem implanta é o controlador dos dados; este software não substitui assessoria jurídica. Isolamento por empresa (RLS), anexos privados com URL assinada de 60 s, logs sem valores nem documentos, exportações auditadas.

> Valor de implantação ilustrativo e sem promessa de resultado: veja `catalogo/sistemas.json` no hub do Pack.
