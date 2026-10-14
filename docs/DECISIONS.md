# DECISIONS — Gestão Financeira Empresarial

| ID | Decisão | Motivo |
|---|---|---|
| D-F1 | Layout do Core na raiz (`app/`, `lib/`, `components/`), **sem `src/`** e **sem shadcn**; diretório mantém o slug do catálogo `sistemas/06-financeiro-completo` (o prompt cita `06-financeiro`). Camadas do prompt viram `lib/finance/{domain,application,infra}` | `sync-core`, `export-system` e `validate-catalog` dependem do layout/slug; sistemas 01–05 seguem igual |
| D-F2 | Dinheiro: `bigint` em centavos no banco; no TS, inteiro seguro em módulo próprio `lib/finance/money` (soma, rateio por maior resto, formatação BRL); `decimal.js` só para taxas/percentuais, convertido na fronteira. Dinero.js 2.0.2 avaliado, não adotado | Só BRL, sem conversão; menos dependência. Reavaliar se multi-moeda entrar |
| D-F3 | **Fonte de verdade do saldo** = saldo inicial + soma de `account_movements` (livro imutável); sem coluna de saldo mantida à mão | Evita saldos divergentes |
| D-F4 | Três conceitos separados: título/parcela (previsto) → baixa (`settlements`) → movimento (`account_movements`). A baixa gera o movimento **na mesma transação**, com `idempotency_key` única | Prompt §7; impede baixa duplicada |
| D-F5 | Correção só por estorno/lançamento compensatório; UPDATE/DELETE em movimentos e baixas bloqueados por trigger; auditoria sem valores em logs | Histórico auditável |
| D-F6 | Atraso é derivado (vencimento < hoje e pendente > 0), não status persistido | Prompt §9 |
| D-F7 | Regras críticas (baixa, estorno, transferência, parcelamento, rateio, recorrência) em funções SQL, com testes SQL e mutação; TS espelha o cálculo para a UI | Padrão validado nos sistemas 01–05 |
| D-F8 | Recorrência gera títulos previstos por função idempotente (`unique(rule_id, scheduled_date)`), agendável por pg_cron/rota protegida; sem processo permanente | Compatível com serverless |
| D-F9 | Nome «Resumo Gerencial de Receitas e Despesas» (nunca DRE oficial); regime (caixa × competência) sempre rotulado | Prompt §23 |
| D-F10 | O prompt colado no chat veio truncado; o texto completo foi lido do Word `sistema 06 prompt mestre.docx` (seções 34–39: fases 3–10, critérios de aceite, escopo, relatório de progresso, ordem de execução). Fases do plano alinhadas a esse texto | Fonte íntegra |
| D-F11 | Analista **não** faz baixa, estorno nem transferência; prepara títulos, importa, concilia e anexa. Importar histórico exige gestor | Quem move dinheiro responde por ele; o prompt permite ao analista «operações autorizadas» |
| D-F12 | Operações financeiras exigem **MFA** (AAL2) no banco (`fin_guard` + política restritiva), não só na interface | Dados financeiros são de risco alto (LGPD) |
| D-F13 | Rotinas (recorrência, avisos) rodam por pg_cron **ou** sob demanda ao abrir painel/recorrências; ambas idempotentes | Funciona em hospedagem sem cron e sem processo permanente |
| D-F14 | Categorias com até 3 níveis; natureza imutável; subcategoria herda a natureza | Evita relatórios por categoria misturando receita e despesa |
| D-F15 | Anexo: tipo pelos bytes (PDF/PNG/JPEG), PDF ativo recusado, bucket privado, URL assinada de 60 s. **Não** é antivírus; recomendado em produção com arquivos de terceiros | Barreira mínima honesta, sem falsa promessa |
| D-F16 | Conciliação manual 1-para-1 com sugestões pontuadas; diferença exige justificativa; sem OFX/CNAB/Open Finance | Escopo do MVP: «sem conciliação bancária automática» |
| D-F17 | Exportação CSV só para gestor/administrador, neutraliza fórmulas (`=`, `+`, `-`, `@`), BOM + separador `;` para Excel BR e registra na auditoria só quem/qual/quantas linhas | Saída de dados financeiros é evento de segurança |
| D-F18 | Lição de ambiente: tabela com FK para `organization_members` e para `organizations` quebra o embed do Core (PGRST201). FKs de avisos/preferências não referenciam `organizations`; teste estrutural 61 impede reincidência | Falha só aparecia no E2E (todos iam ao onboarding) |

