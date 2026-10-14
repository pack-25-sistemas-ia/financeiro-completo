# DATA_MODEL — Gestão Financeira Empresarial

O modelo de dados, as regras de imutabilidade, as funções e a RLS estão em [DATABASE.md](DATABASE.md). Conceitos financeiros (título → baixa → movimento, saldo, projeção) em [FINANCIAL_MODEL.md](FINANCIAL_MODEL.md).
Dados pessoais tratados: nome, CPF/CNPJ opcional de contrapartes e dados financeiros; `organization_id` em toda entidade, RLS ativa, histórico imutável onde há saldo/valor.
